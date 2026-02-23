/**
 * Re-extract Missing Data — Re-run improved prospectus parsers on deals with gaps
 *
 * Targets listed deals that have a prospectus_url but are missing price_hkd or sector.
 * Excludes Introduction/Transfer/SPAC deals where null price is structurally correct.
 *
 * Uses the improved extractPricingFromProspectus and extractSectorFromProspectus
 * (expanded page range, additional regex patterns) to fill data gaps.
 *
 * Usage:
 *   npx tsx src/scripts/reextract-missing-data.ts              # dry-run
 *   npx tsx src/scripts/reextract-missing-data.ts --apply       # apply DB updates
 *   npx tsx src/scripts/reextract-missing-data.ts --test 3      # test first 3 deals
 */

import pg from 'pg';
import fs from 'fs';
import axios from 'axios';
import {
  extractPricingFromProspectus,
  extractSectorFromProspectus,
} from '../prospectus-parser.js';

const { Pool } = pg;

// ── Config ──────────────────────────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:DOMRD7x7ECUny4Pc615y9w==@104.199.131.94:5432/ddowl';
const DRY_RUN = !process.argv.includes('--apply');
const TEST_LIMIT = process.argv.includes('--test')
  ? parseInt(process.argv[process.argv.indexOf('--test') + 1]) || 3
  : 0;

const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});

// Deal types where null price is structurally correct (no offering)
const NO_PRICE_DEAL_TYPES = [
  'Introduction',
  'Listing by introduction',
  'Transfer of Listing',
  'SPAC',
  'De-SPAC',
];

// ── PDF download ────────────────────────────────────────────────────────
async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    if (response.status !== 200) return null;
    const buf = Buffer.from(response.data);
    // Verify it's a PDF
    if (buf.slice(0, 5).toString() !== '%PDF-') return null;
    return buf;
  } catch {
    return null;
  }
}

// ── Types ───────────────────────────────────────────────────────────────
interface DealToReextract {
  dealId: number;
  companyId: number;
  companyName: string;
  stockCode: string;
  prospectusUrl: string;
  dealType: string | null;
  currentPrice: number | null;
  currentSector: string | null;
  currentShares: number | null;
}

interface ReextractResult {
  stockCode: string;
  companyName: string;
  missingFields: string[];
  priceHkd: number | null;
  sharesOffered: number | null;
  sizeHkdm: number | null;
  dealType: string | null;
  sectorFound: string | null;
  sectorConfidence: string;
  priceFixed: boolean;
  sectorFixed: boolean;
  sharesFixed: boolean;
  error?: string;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (pass --apply to update DB) ===' : '=== APPLYING CHANGES ===');
  if (TEST_LIMIT) console.log(`Test mode: processing first ${TEST_LIMIT} deals`);
  console.log();

  // ─── Find deals with data gaps ────────────────────────────────────
  // Listed deals with prospectus_url but missing price_hkd, shares_offered, or sector
  // Exclude deal types where null price is structurally correct
  const dealsResult = await pool.query(`
    SELECT d.id as deal_id, d.company_id, c.name_en as company_name,
           c.stock_code, d.prospectus_url, d.deal_type,
           d.price_hkd, c.sector, d.shares_offered
    FROM deals d
    JOIN companies c ON c.id = d.company_id
    WHERE d.status = 'listed'
      AND d.prospectus_url IS NOT NULL
      AND (
        (d.price_hkd IS NULL AND d.deal_type NOT IN ($1, $2, $3, $4, $5))
        OR c.sector IS NULL
        OR (d.shares_offered IS NULL AND d.price_hkd IS NOT NULL)
      )
    ORDER BY d.listing_date DESC
  `, NO_PRICE_DEAL_TYPES);

  let deals: DealToReextract[] = dealsResult.rows.map(r => ({
    dealId: r.deal_id,
    companyId: r.company_id,
    companyName: r.company_name,
    stockCode: r.stock_code,
    prospectusUrl: r.prospectus_url,
    dealType: r.deal_type,
    currentPrice: r.price_hkd ? parseFloat(r.price_hkd) : null,
    currentSector: r.sector,
    currentShares: r.shares_offered ? parseInt(r.shares_offered) : null,
  }));

  if (TEST_LIMIT) {
    deals = deals.slice(0, TEST_LIMIT);
  }

  // Summarize what's missing
  const missingPrice = deals.filter(d => d.currentPrice === null && !NO_PRICE_DEAL_TYPES.includes(d.dealType || '')).length;
  const missingSector = deals.filter(d => d.currentSector === null).length;
  const missingShares = deals.filter(d => d.currentShares === null && d.currentPrice !== null).length;

  console.log(`Found ${deals.length} deals with data gaps:`);
  console.log(`  - Missing price: ${missingPrice}`);
  console.log(`  - Missing sector: ${missingSector}`);
  console.log(`  - Missing shares (with price): ${missingShares}`);
  console.log();

  if (deals.length === 0) {
    console.log('Nothing to re-extract!');
    await pool.end();
    return;
  }

  // ─── Process each deal ────────────────────────────────────────────
  const results: ReextractResult[] = [];
  let priceFixed = 0;
  let sectorFixed = 0;
  let sharesFixed = 0;
  let downloadFails = 0;
  const remainingFailures: string[] = [];

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    const missing: string[] = [];
    if (deal.currentPrice === null && !NO_PRICE_DEAL_TYPES.includes(deal.dealType || '')) missing.push('price');
    if (deal.currentSector === null) missing.push('sector');
    if (deal.currentShares === null && deal.currentPrice !== null) missing.push('shares');

    console.log(`[${i + 1}/${deals.length}] ${deal.stockCode} - ${deal.companyName} (missing: ${missing.join(', ')})`);

    const result: ReextractResult = {
      stockCode: deal.stockCode,
      companyName: deal.companyName,
      missingFields: missing,
      priceHkd: null,
      sharesOffered: null,
      sizeHkdm: null,
      dealType: null,
      sectorFound: null,
      sectorConfidence: 'none',
      priceFixed: false,
      sectorFixed: false,
      sharesFixed: false,
    };

    try {
      // Download prospectus PDF
      const pdfBuffer = await downloadPdf(deal.prospectusUrl);
      if (!pdfBuffer) {
        console.log('  ✗ Download failed');
        result.error = 'PDF download failed';
        downloadFails++;
        remainingFailures.push(`${deal.stockCode} ${deal.companyName} - Download failed`);
        results.push(result);
        continue;
      }

      // Re-extract pricing (if price or shares missing)
      let newPrice: number | null = null;
      let newShares: number | null = null;
      let newSize: number | null = null;
      let newDealType: string | null = null;

      if (missing.includes('price') || missing.includes('shares')) {
        const pricing = await extractPricingFromProspectus(pdfBuffer);
        result.priceHkd = pricing.priceHkd;
        result.sharesOffered = pricing.sharesOffered;
        result.sizeHkdm = pricing.sizeHkdm;
        result.dealType = pricing.dealType;

        // Only use newly extracted values for fields that are currently missing
        if (missing.includes('price') && pricing.priceHkd) {
          newPrice = pricing.priceHkd;
          result.priceFixed = true;
          priceFixed++;
          console.log(`  ✓ Price: HK$${pricing.priceHkd} (raw: "${pricing.rawPriceText}")`);
        } else if (missing.includes('price')) {
          console.log(`  ✗ Price: still not found`);
          remainingFailures.push(`${deal.stockCode} ${deal.companyName} - Price extraction failed`);
        }

        if (missing.includes('shares') && pricing.sharesOffered) {
          newShares = pricing.sharesOffered;
          result.sharesFixed = true;
          sharesFixed++;
          console.log(`  ✓ Shares: ${pricing.sharesOffered.toLocaleString()}`);
        } else if (missing.includes('shares')) {
          console.log(`  ✗ Shares: still not found`);
        }

        // Recalculate size if we now have both price and shares
        const effectivePrice = newPrice || deal.currentPrice;
        const effectiveShares = newShares || deal.currentShares;
        if (effectivePrice && effectiveShares) {
          newSize = Math.round((effectivePrice * effectiveShares / 1_000_000) * 1000) / 1000;
        }
        newDealType = pricing.dealType;
      }

      // Re-extract sector (if missing)
      let newSector: string | null = null;
      let sectorConfidence = 'none';

      if (missing.includes('sector')) {
        const sectorResult = await extractSectorFromProspectus(pdfBuffer);
        result.sectorFound = sectorResult.sectorName;
        result.sectorConfidence = sectorResult.confidence;
        sectorConfidence = sectorResult.confidence;

        if (sectorResult.sectorName && sectorResult.confidence !== 'none') {
          newSector = sectorResult.sectorName;
          result.sectorFixed = true;
          sectorFixed++;
          console.log(`  ✓ Sector: ${sectorResult.sectorName} (${sectorResult.confidence})`);
        } else {
          console.log(`  ✗ Sector: still not found`);
          remainingFailures.push(`${deal.stockCode} ${deal.companyName} - Sector extraction failed`);
        }
      }

      // Update database (COALESCE ensures we don't overwrite existing good data)
      if (!DRY_RUN && (newPrice || newShares || newSize || newDealType || newSector)) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Update deal record — only fill in missing fields
          if (newPrice || newShares || newSize || newDealType) {
            await client.query(`
              UPDATE deals SET
                price_hkd = COALESCE(price_hkd, $2),
                shares_offered = COALESCE(shares_offered, $3),
                size_hkdm = COALESCE(size_hkdm, $4),
                deal_type = COALESCE(deal_type, $5),
                updated_at = NOW()
              WHERE id = $1
            `, [deal.dealId, newPrice, newShares, newSize, newDealType]);
          }

          // Update company sector if missing
          if (newSector) {
            await client.query(`
              UPDATE companies SET
                sector = COALESCE(sector, $2),
                updated_at = NOW()
              WHERE id = $1 AND sector IS NULL
            `, [deal.companyId, newSector]);
          }

          await client.query('COMMIT');
          console.log('  ✓ Database updated');
        } catch (dbError) {
          await client.query('ROLLBACK');
          console.error('  ✗ Database error:', dbError instanceof Error ? dbError.message : dbError);
          result.error = `DB error: ${dbError instanceof Error ? dbError.message : dbError}`;
        } finally {
          client.release();
        }
      }
    } catch (error) {
      console.error(`  ✗ Error:`, error instanceof Error ? error.message : error);
      result.error = error instanceof Error ? error.message : String(error);
      remainingFailures.push(`${deal.stockCode} ${deal.companyName} - Error: ${result.error}`);
    }

    results.push(result);

    // Small delay between deals to avoid overwhelming PDF host
    await new Promise(r => setTimeout(r, 300));
  }

  // ─── Summary ──────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  console.log(`Total deals processed: ${deals.length}`);
  console.log(`Download failures: ${downloadFails}`);
  console.log(`Prices fixed: ${priceFixed}`);
  console.log(`Shares fixed: ${sharesFixed}`);
  console.log(`Sectors fixed: ${sectorFixed}`);

  if (remainingFailures.length > 0) {
    console.log(`\n=== Remaining Failures (${remainingFailures.length}) ===`);
    for (const item of remainingFailures) {
      console.log(`  - ${item}`);
    }
  }

  // Save results to file
  const resultsPath = '/tmp/reextract-results.json';
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${resultsPath}`);

  if (DRY_RUN) {
    console.log('\n=== DRY RUN COMPLETE ===');
    console.log('Run with --apply to update the database.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
