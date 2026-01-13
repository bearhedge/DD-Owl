/**
 * Historical Import - Import historical HKEX IPO deals from Excel + scrape banks from prospectuses
 *
 * Usage:
 *   npx tsx src/historical-import.ts              # Run full import
 *   npx tsx src/historical-import.ts --test 10   # Test on first 10 deals
 *   npx tsx src/historical-import.ts --resume    # Resume from last position
 */

import xlsx from 'xlsx';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { extractBanksFromProspectus, ProspectusBankAppointment } from './prospectus-parser.js';
import { normalizeBankName } from './bank-normalizer.js';

const { Pool } = pg;

// ES Module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const EXCEL_PATH = path.join(__dirname, '../../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');
const PROGRESS_FILE = path.join(__dirname, '../.historical-import-progress.json');
const RESULTS_FILE = path.join(__dirname, '../.historical-import-results.json');
const URL_OVERRIDES_FILE = path.join(__dirname, '../url-overrides.json');
const TEMP_PDF_DIR = '/tmp/historical-pdfs';

// Load URL overrides
interface UrlOverride {
  company: string;
  correctUrl: string;
  reason?: string;
}

interface UrlOverrides {
  description: string;
  overrides: Record<string, UrlOverride>;
}

function loadUrlOverrides(): Record<string, string> {
  try {
    if (fs.existsSync(URL_OVERRIDES_FILE)) {
      const data = JSON.parse(fs.readFileSync(URL_OVERRIDES_FILE, 'utf-8')) as UrlOverrides;
      const overrides: Record<string, string> = {};
      for (const [ticker, override] of Object.entries(data.overrides)) {
        overrides[ticker] = override.correctUrl;
      }
      console.log(`Loaded ${Object.keys(overrides).length} URL overrides`);
      return overrides;
    }
  } catch (e) {
    console.warn('Failed to load URL overrides:', e);
  }
  return {};
}

const urlOverrides = loadUrlOverrides();

interface DealRow {
  ticker: number;
  company: string;
  type: string;
  prospectusUrl: string;
  date: string;
}

interface ImportProgress {
  lastProcessedIndex: number;
  totalDeals: number;
  successCount: number;
  failCount: number;
  skippedCount: number;
  startedAt: string;
}

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  banks?: Array<{ name: string; roles: string[] }>;
}

/**
 * Read deals from Excel
 */
function readDealsFromExcel(): DealRow[] {
  console.log('Reading Excel file:', EXCEL_PATH);

  const workbook = xlsx.readFile(EXCEL_PATH);
  const indexSheet = workbook.Sheets['Index'];
  const rows = xlsx.utils.sheet_to_json(indexSheet, { header: 1 }) as any[][];

  const deals: DealRow[] = [];

  // Skip header rows (first 2 rows based on structure)
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[4]) continue; // Skip rows without prospectus URL

    const ticker = row[1];
    const company = row[2];
    const type = row[3];
    const prospectusUrl = row[4];
    const date = row[5];

    if (ticker && company) {
      const tickerNum = typeof ticker === 'number' ? ticker : parseInt(ticker);
      // Check for URL override
      const overrideUrl = urlOverrides[String(tickerNum)];
      const finalUrl = overrideUrl || String(prospectusUrl || '').trim();

      if (finalUrl) {
        deals.push({
          ticker: tickerNum,
          company: String(company).trim(),
          type: String(type || '').trim(),
          prospectusUrl: finalUrl,
          date: String(date || '').trim(),
        });
      }
    }
  }

  console.log(`Found ${deals.length} deals with prospectus URLs`);
  return deals;
}

/**
 * Download PDF from URL using axios
 */
async function downloadPdf(url: string, outputPath: string): Promise<boolean> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (response.status !== 200) {
      return false;
    }

    fs.writeFileSync(outputPath, Buffer.from(response.data));
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Parse date string (DD/MM/YYYY) to ISO date
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Save progress to file
 */
function saveProgress(progress: ImportProgress): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

/**
 * Load progress from file
 */
function loadProgress(): ImportProgress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

/**
 * Save results to file (replace existing entry for same ticker)
 */
function saveResult(result: ImportResult): void {
  let results: ImportResult[] = [];
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    }
  } catch (e) {
    results = [];
  }
  // Replace existing entry for same ticker, or append if new
  const existingIndex = results.findIndex(r => r.ticker === result.ticker);
  if (existingIndex >= 0) {
    results[existingIndex] = result;
  } else {
    results.push(result);
  }
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

/**
 * Main import function
 */
async function runImport(options: { test?: number; resume?: boolean; saveToDb?: boolean } = {}) {
  const { test, resume, saveToDb = false } = options;

  // Create temp directory
  if (!fs.existsSync(TEMP_PDF_DIR)) {
    fs.mkdirSync(TEMP_PDF_DIR, { recursive: true });
  }

  // Read deals from Excel
  const allDeals = readDealsFromExcel();
  let deals = allDeals;
  let startIndex = 0;

  // Handle resume
  if (resume) {
    const progress = loadProgress();
    if (progress) {
      startIndex = progress.lastProcessedIndex + 1;
      console.log(`Resuming from index ${startIndex} (${startIndex}/${allDeals.length})`);
    }
  }

  // Handle test mode
  if (test) {
    deals = allDeals.slice(startIndex, startIndex + test);
    console.log(`Test mode: processing ${deals.length} deals`);
  } else {
    deals = allDeals.slice(startIndex);
  }

  // Initialize progress
  const progress: ImportProgress = {
    lastProcessedIndex: startIndex - 1,
    totalDeals: allDeals.length,
    successCount: 0,
    failCount: 0,
    skippedCount: 0,
    startedAt: new Date().toISOString(),
  };

  // Database connection (optional)
  let pool: pg.Pool | null = null;
  if (saveToDb) {
    const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:DOMRD7x7ECUny4Pc615y9w==@35.194.142.132:5432/ddowl';
    pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    console.log('Connected to database');
  }

  console.log('\n=== Starting Historical Import ===\n');

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    const globalIndex = startIndex + i;
    const pdfPath = path.join(TEMP_PDF_DIR, `${deal.ticker}.pdf`);

    console.log(`[${globalIndex + 1}/${allDeals.length}] ${deal.ticker} - ${deal.company}`);

    try {
      // Download PDF
      console.log(`  Downloading: ${deal.prospectusUrl.slice(0, 60)}...`);
      const downloaded = await downloadPdf(deal.prospectusUrl, pdfPath);

      if (!downloaded || !fs.existsSync(pdfPath)) {
        console.log(`  ✗ Download failed`);
        progress.failCount++;
        saveResult({
          ticker: deal.ticker,
          company: deal.company,
          success: false,
          banksFound: 0,
          error: 'Download failed',
        });
        continue;
      }

      // Verify PDF
      const buffer = fs.readFileSync(pdfPath);
      if (buffer.slice(0, 5).toString() !== '%PDF-') {
        console.log(`  ✗ Invalid PDF`);
        progress.failCount++;
        fs.unlinkSync(pdfPath);
        saveResult({
          ticker: deal.ticker,
          company: deal.company,
          success: false,
          banksFound: 0,
          error: 'Invalid PDF',
        });
        continue;
      }

      // Extract banks
      const result = await extractBanksFromProspectus(buffer);

      if (!result.sectionFound) {
        console.log(`  ✗ Section not found`);
        progress.failCount++;
        fs.unlinkSync(pdfPath);
        saveResult({
          ticker: deal.ticker,
          company: deal.company,
          success: false,
          banksFound: 0,
          error: 'Parties Involved section not found',
        });
        continue;
      }

      if (result.banks.length === 0) {
        console.log(`  ✗ No banks extracted`);
        progress.failCount++;
        fs.unlinkSync(pdfPath);
        saveResult({
          ticker: deal.ticker,
          company: deal.company,
          success: false,
          banksFound: 0,
          error: 'No banks found in section',
        });
        continue;
      }

      // Success!
      const leads = result.banks.filter(b => b.isLead).length;
      console.log(`  ✓ Banks: ${result.banks.length} (${leads} leads)`);

      progress.successCount++;

      // Log bank names
      result.banks.forEach(b => {
        const marker = b.isLead ? '★' : ' ';
        console.log(`    ${marker} ${b.bankNormalized} [${b.roles.join(', ')}]`);
      });

      // Save to results file - keep BOTH raw name and normalized name
      saveResult({
        ticker: deal.ticker,
        company: deal.company,
        success: true,
        banksFound: result.banks.length,
        banks: result.banks.map(b => ({
          name: b.bank,           // Full raw name from PDF
          normalized: b.bankNormalized,  // Short normalized name for matching
          roles: [...b.roles],
          isLead: b.isLead,
          rawRole: b.rawRole,
        })),
      });

      // Save to database (if enabled)
      if (pool && saveToDb) {
        await saveDealToDatabase(pool, deal, result.banks);
      }

      // Clean up PDF
      fs.unlinkSync(pdfPath);

    } catch (error: any) {
      console.log(`  ✗ Error: ${error.message}`);
      progress.failCount++;
      saveResult({
        ticker: deal.ticker,
        company: deal.company,
        success: false,
        banksFound: 0,
        error: error.message,
      });

      // Clean up PDF on error
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }
    }

    // Update progress
    progress.lastProcessedIndex = globalIndex;
    saveProgress(progress);

    // Small delay to be nice to HKEX
    await new Promise(r => setTimeout(r, 200));
  }

  // Final summary
  console.log('\n=== Import Complete ===');
  console.log(`Total processed: ${progress.successCount + progress.failCount}`);
  console.log(`Successful: ${progress.successCount}`);
  console.log(`Failed: ${progress.failCount}`);

  if (pool) {
    await pool.end();
  }
}

/**
 * Save deal and banks to database
 */
async function saveDealToDatabase(
  pool: pg.Pool,
  deal: DealRow,
  banks: ProspectusBankAppointment[]
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Upsert company
    const companyResult = await client.query(`
      INSERT INTO companies (name_en, stock_code)
      VALUES ($1, $2)
      ON CONFLICT (name_en) DO UPDATE SET
        stock_code = COALESCE(EXCLUDED.stock_code, companies.stock_code),
        updated_at = NOW()
      RETURNING id
    `, [deal.company, deal.ticker.toString()]);
    const companyId = companyResult.rows[0].id;

    // Parse listing date
    const listingDate = parseDate(deal.date);

    // Upsert deal (status = 'listed' for historical)
    const dealResult = await client.query(`
      INSERT INTO deals (company_id, status, listing_date, prospectus_url)
      VALUES ($1, 'listed', $2, $3)
      ON CONFLICT ON CONSTRAINT deals_company_id_key DO UPDATE SET
        listing_date = COALESCE(EXCLUDED.listing_date, deals.listing_date),
        prospectus_url = COALESCE(EXCLUDED.prospectus_url, deals.prospectus_url),
        updated_at = NOW()
      RETURNING id
    `, [companyId, listingDate, deal.prospectusUrl]);

    let dealId = dealResult.rows[0]?.id;

    // If deal doesn't exist (conflict didn't match), find or create
    if (!dealId) {
      const existingDeal = await client.query(
        'SELECT id FROM deals WHERE company_id = $1 LIMIT 1',
        [companyId]
      );
      if (existingDeal.rows.length > 0) {
        dealId = existingDeal.rows[0].id;
      } else {
        const newDealResult = await client.query(`
          INSERT INTO deals (company_id, status, listing_date, prospectus_url)
          VALUES ($1, 'listed', $2, $3)
          RETURNING id
        `, [companyId, listingDate, deal.prospectusUrl]);
        dealId = newDealResult.rows[0].id;
      }
    }

    // Insert banks and appointments
    for (const bank of banks) {
      // Upsert bank
      const bankResult = await client.query(`
        INSERT INTO banks (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `, [bank.bank]);

      let bankId = bankResult.rows[0]?.id;
      if (!bankId) {
        const existingBank = await client.query('SELECT id FROM banks WHERE name = $1', [bank.bank]);
        bankId = existingBank.rows[0]?.id;
      }

      if (bankId && dealId) {
        // Map role to DB enum (leadManager -> leadManager, lead_manager won't match)
        const dbRoles = bank.roles.map(r => {
          if (r === 'lead_manager') return 'leadManager';
          return r;
        });

        // Insert appointment
        await client.query(`
          INSERT INTO deal_appointments (deal_id, bank_id, roles, is_lead, source_url)
          VALUES ($1, $2, $3::bank_role[], $4, $5)
          ON CONFLICT (deal_id, bank_id) DO UPDATE SET
            roles = EXCLUDED.roles,
            is_lead = EXCLUDED.is_lead
        `, [dealId, bankId, dbRoles, bank.isLead, deal.prospectusUrl]);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// CLI
const args = process.argv.slice(2);
const isTest = args.includes('--test');
const testCount = isTest ? parseInt(args[args.indexOf('--test') + 1]) || 10 : undefined;
const isResume = args.includes('--resume');
const saveToDb = args.includes('--db');

runImport({
  test: testCount,
  resume: isResume,
  saveToDb,
}).catch(console.error);
