/**
 * Extract Missing IPO Deal Sizes
 *
 * Batch extracts deal values (shares × price) from prospectus PDFs
 * for deals that show "-" in the UI due to missing size_hkdm data.
 *
 * Formula: size_hkdm = (shares × price_hkd) / 1,000,000
 *
 * Outputs:
 * - Console summary with extraction results
 * - extracted-sizes.json for successful extractions
 * - missing-sizes-review.csv for manual review of failures
 */

import { PDFParse } from 'pdf-parse';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// PDF cache directory
const PDF_CACHE_DIR = './pdf-cache';

// Output files
const EXTRACTED_JSON = 'extracted-sizes.json';
const REVIEW_CSV = 'missing-sizes-review.csv';

// Patterns to extract offer price
const PRICE_PATTERNS = [
  // "Maximum Offer Price: HK$X.XX" - most reliable
  /Maximum\s*(?:Public\s*)?Offer\s*Price[:\s]+HK\$\s*([\d.]+)/gi,
  // "Offer Price: HK$X.XX" or "Offer Price HK$X.XX"
  /(?:Final\s+)?Offer\s*Price[:\s]+(?:Not\s+more\s+than\s+)?HK\$\s*([\d.]+)/gi,
  // "HK$X.XX per Offer Share" (must have "Offer" to avoid nominal value)
  /HK\$\s*([\d.]+)\s*per\s+Offer\s*(?:Share|Unit)/gi,
  // "not more than HK$X.XX" in offer context
  /not\s+more\s+than\s+HK\$\s*([\d.]+)/gi,
  // Price range format "HK$X.XX to HK$Y.YY" - take the higher one
  /HK\$\s*[\d.]+\s*to\s*HK\$\s*([\d.]+)/gi,
];

// Patterns to extract number of shares - ordered by priority
const SHARES_PATTERNS = [
  // PRIORITY 1: "Number of Offer Shares under the Global Offering"
  {
    pattern: /Number\s+of\s+(?:Offer\s+)?(?:Shares|Units)\s+under\s+(?:the\s+)?(?:Share|Global)\s+Offering\s*[:\s]+\s*([\d,]+)/gi,
    name: 'Number under Global Offering',
    priority: 1,
  },
  // PRIORITY 1: Total/Aggregate explicit mention
  {
    pattern: /Total\s+(?:number\s+of\s+)?(?:Offer\s+)?(?:Shares|Units)[:\s]+([\d,]+)/gi,
    name: 'Total shares explicit',
    priority: 1,
  },
  // PRIORITY 1: Aggregate pattern
  {
    pattern: /(?:Total|Aggregate)[:\s]*([\d,]+)\s*(?:Offer\s+)?(?:Shares|Units)/gi,
    name: 'Aggregate shares',
    priority: 1,
  },
  // PRIORITY 2: "(comprising" indicates aggregate/total
  {
    pattern: /([\d,]+)\s*(?:Offer\s*)?(?:Shares|Units)\s*\(comprising/gi,
    name: 'Shares (comprising - total)',
    priority: 2,
  },
  // PRIORITY 2: Global Offering pattern
  {
    pattern: /Global\s+Offering[:\s]*([\d,]+)\s*(?:Offer\s+)?(?:Shares|Units)/gi,
    name: 'Global Offering shares',
    priority: 2,
  },
  // PRIORITY 3: Generic patterns (may match subsets)
  {
    pattern: /([\d,]+)\s*(?:Offer\s*)?(?:Shares|Units)\s*(?:\(subject to|under|in)/gi,
    name: 'Shares (subject to/under/in)',
    priority: 3,
  },
  {
    pattern: /Number\s+of\s+(?:Offer\s+)?(?:Shares|Units)[:\s]+([\d,]+)/gi,
    name: 'Number of Shares generic',
    priority: 3,
  },
];

interface MissingDeal {
  ticker: number;
  company: string;
  type: string;
  prospectusUrl: string | null;
}

interface ExtractionResult {
  ticker: number;
  company: string;
  type: string;
  price: number | null;
  shares: number | null;
  sizeHKDm: number | null;
  patternUsed: string;
  status: 'SUCCESS' | 'PARTIAL' | 'NO_MATCH' | 'INTRODUCTION' | 'TRANSFER' | 'NO_URL' | 'DOWNLOAD_FAILED' | 'ERROR';
  details: string;
  prospectusUrl: string | null;
}

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Find deals with missing size from the enriched CSV
 */
function findMissingDeals(): MissingDeal[] {
  const csvPath = 'public/baseline-enriched.csv';
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const lines = csv.split('\n');

  const headers = parseCSVLine(lines[0].replace(/^\uFEFF/, ''));
  const tickerIdx = headers.indexOf('ticker');
  const companyIdx = headers.indexOf('company');
  const typeIdx = headers.indexOf('type');
  const sizeIdx = headers.indexOf('size_hkdm');
  const urlIdx = headers.indexOf('prospectus_url');

  const missing: MissingDeal[] = [];
  const seen = new Set<number>();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);

    const ticker = parseInt(values[tickerIdx]);
    if (isNaN(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);

    const sizeHKDm = values[sizeIdx]?.trim();

    // Check if size is missing (empty string)
    if (!sizeHKDm || sizeHKDm === '') {
      missing.push({
        ticker,
        company: values[companyIdx] || 'Unknown',
        type: values[typeIdx] || 'Unknown',
        prospectusUrl: values[urlIdx] || null,
      });
    }
  }

  return missing;
}

/**
 * Get prospectus URL from database if not in CSV
 */
function getProspectusUrl(ticker: number): string | null {
  const db = new Database('data/ddowl.db', { readonly: true });
  const deal = db.prepare('SELECT prospectus_url FROM ipo_deals WHERE ticker = ?').get(ticker) as any;
  db.close();
  return deal?.prospectus_url || null;
}

/**
 * Download PDF to cache if not already present
 */
async function downloadPdf(url: string, ticker: number): Promise<Buffer | null> {
  const cachePath = path.join(PDF_CACHE_DIR, `${ticker}.pdf`);

  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  if (!fs.existsSync(PDF_CACHE_DIR)) {
    fs.mkdirSync(PDF_CACHE_DIR, { recursive: true });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/pdf',
      },
    });

    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.slice(0, 5).toString().startsWith('%PDF')) {
      return null;
    }

    fs.writeFileSync(cachePath, buffer);
    return buffer;
  } catch (err) {
    return null;
  }
}

/**
 * Extract text from first N pages of PDF
 */
async function extractPdfText(pdfBuffer: Buffer, maxPages: number = 5): Promise<string> {
  const cMapUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/cmaps/');
  const parser = new PDFParse({
    data: new Uint8Array(pdfBuffer),
    cMapUrl: cMapUrl,
    cMapPacked: true,
  });

  const result = await parser.getText();
  const pages = result.pages.slice(0, maxPages);
  return pages.map(p => p.text).join('\n');
}

/**
 * Parse number from string (handles comma-separated values)
 */
function parseNumber(str: string): number | null {
  if (!str) return null;
  const cleaned = str.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Extract offer price from PDF text
 */
function extractPrice(text: string): number | null {
  for (const pattern of PRICE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const price = parseNumber(match[1]);
      if (price && price > 0 && price < 10000) {
        return price;
      }
    }
  }
  return null;
}

/**
 * Extract shares using improved patterns with priority ordering
 */
function extractShares(text: string): { shares: number | null; patternName: string } {
  const sortedPatterns = [...SHARES_PATTERNS].sort((a, b) => a.priority - b.priority);

  const allMatches: Array<{
    shares: number;
    patternName: string;
    priority: number;
  }> = [];

  for (const { pattern, name, priority } of sortedPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const shares = parseNumber(match[1]);
      if (shares && shares >= 1_000_000) {
        allMatches.push({ shares, patternName: name, priority });
      }
    }
  }

  if (allMatches.length === 0) {
    return { shares: null, patternName: 'NO_MATCH' };
  }

  // Sort by: priority first, then by share count (prefer larger = likely total)
  allMatches.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.shares - a.shares;
  });

  return { shares: allMatches[0].shares, patternName: allMatches[0].patternName };
}

/**
 * Check if this is a non-IPO listing (no deal size)
 */
function getNonIpoType(text: string, dealType: string): 'TRANSFER' | 'INTRODUCTION' | null {
  const typeUpper = dealType.toUpperCase();

  if (typeUpper.includes('TRANSFER') || /TRANSFER\s+OF\s+LISTING/i.test(text)) {
    return 'TRANSFER';
  }

  if (typeUpper.includes('INTRODUCTION') || /LISTING\s+BY\s+(?:WAY\s+OF\s+)?INTRODUCTION/i.test(text)) {
    return 'INTRODUCTION';
  }

  if (/no\s+(?:new\s+)?shares\s+(?:will\s+be|are\s+being)\s+issued/i.test(text)) {
    return 'INTRODUCTION';
  }

  return null;
}

/**
 * Extract deal metrics from prospectus PDF
 */
async function extractDealMetrics(deal: MissingDeal, pdfBuffer: Buffer): Promise<ExtractionResult> {
  const text = await extractPdfText(pdfBuffer, 5);

  // Check for non-IPO listing types
  const nonIpoType = getNonIpoType(text, deal.type);
  if (nonIpoType === 'TRANSFER') {
    return {
      ticker: deal.ticker,
      company: deal.company,
      type: deal.type,
      price: null,
      shares: null,
      sizeHKDm: null,
      patternUsed: 'N/A',
      status: 'TRANSFER',
      details: 'Transfer of Listing - no IPO size',
      prospectusUrl: deal.prospectusUrl,
    };
  }
  if (nonIpoType === 'INTRODUCTION') {
    return {
      ticker: deal.ticker,
      company: deal.company,
      type: deal.type,
      price: null,
      shares: null,
      sizeHKDm: null,
      patternUsed: 'N/A',
      status: 'INTRODUCTION',
      details: 'Listing by Introduction - no IPO size',
      prospectusUrl: deal.prospectusUrl,
    };
  }

  const price = extractPrice(text);
  const { shares, patternName } = extractShares(text);

  if (price && shares) {
    const sizeHKDm = (price * shares) / 1_000_000;
    return {
      ticker: deal.ticker,
      company: deal.company,
      type: deal.type,
      price,
      shares,
      sizeHKDm: Math.round(sizeHKDm * 100) / 100, // Round to 2 decimals
      patternUsed: patternName,
      status: 'SUCCESS',
      details: `${shares.toLocaleString()} shares × HK$${price} = HK$${sizeHKDm.toFixed(2)}m`,
      prospectusUrl: deal.prospectusUrl,
    };
  }

  if (price && !shares) {
    return {
      ticker: deal.ticker,
      company: deal.company,
      type: deal.type,
      price,
      shares: null,
      sizeHKDm: null,
      patternUsed: patternName,
      status: 'PARTIAL',
      details: `Found price HK$${price} but shares pattern not matched`,
      prospectusUrl: deal.prospectusUrl,
    };
  }

  if (shares && !price) {
    return {
      ticker: deal.ticker,
      company: deal.company,
      type: deal.type,
      price: null,
      shares,
      sizeHKDm: null,
      patternUsed: patternName,
      status: 'PARTIAL',
      details: `Found ${shares.toLocaleString()} shares but price pattern not matched`,
      prospectusUrl: deal.prospectusUrl,
    };
  }

  return {
    ticker: deal.ticker,
    company: deal.company,
    type: deal.type,
    price: null,
    shares: null,
    sizeHKDm: null,
    patternUsed: 'NO_MATCH',
    status: 'NO_MATCH',
    details: 'No shares or price patterns matched in PDF text',
    prospectusUrl: deal.prospectusUrl,
  };
}

/**
 * Generate KNOWN_SIZES entries for enrich-baseline.ts
 */
function generateKnownSizesCode(results: ExtractionResult[]): string {
  const successful = results.filter(r => r.status === 'SUCCESS' && r.sizeHKDm !== null);
  if (successful.length === 0) return '';

  const lines = successful.map(r => {
    return `  ${r.ticker}: ${r.sizeHKDm}, // ${r.company} - ${r.shares?.toLocaleString()} × HK$${r.price}`;
  });

  return `// Add to KNOWN_SIZES in enrich-baseline.ts:\nconst KNOWN_SIZES: Record<number, number> = {\n${lines.join('\n')}\n};`;
}

/**
 * Save review CSV for manual inspection
 */
function saveReviewCsv(results: ExtractionResult[]): void {
  const headers = ['Ticker', 'Company', 'Type', 'Status', 'Price', 'Shares', 'Size (HKDm)', 'Pattern', 'Details', 'Prospectus URL'];

  const rows = results.map(r => [
    r.ticker,
    `"${r.company.replace(/"/g, '""')}"`,
    r.type,
    r.status,
    r.price || '',
    r.shares?.toLocaleString() || '',
    r.sizeHKDm || '',
    r.patternUsed,
    `"${r.details.replace(/"/g, '""')}"`,
    r.prospectusUrl || '',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(REVIEW_CSV, csv);
}

/**
 * Main function
 */
async function main() {
  console.log('=== Extract Missing IPO Deal Sizes ===\n');

  // Step 1: Find missing deals
  console.log('Step 1: Finding deals with missing sizes...');
  const missingDeals = findMissingDeals();
  console.log(`Found ${missingDeals.length} deals with missing sizes\n`);

  if (missingDeals.length === 0) {
    console.log('No missing deals found. Done!');
    return;
  }

  // Fill in missing URLs from database
  for (const deal of missingDeals) {
    if (!deal.prospectusUrl) {
      deal.prospectusUrl = getProspectusUrl(deal.ticker);
    }
  }

  // Step 2: Process each deal
  console.log('Step 2: Extracting metrics from PDFs...\n');
  const results: ExtractionResult[] = [];

  for (let i = 0; i < missingDeals.length; i++) {
    const deal = missingDeals[i];
    console.log(`[${i + 1}/${missingDeals.length}] ${deal.ticker}: ${deal.company}`);

    if (!deal.prospectusUrl) {
      results.push({
        ticker: deal.ticker,
        company: deal.company,
        type: deal.type,
        price: null,
        shares: null,
        sizeHKDm: null,
        patternUsed: 'N/A',
        status: 'NO_URL',
        details: 'No prospectus URL available',
        prospectusUrl: null,
      });
      console.log('  -> No URL');
      continue;
    }

    const pdfBuffer = await downloadPdf(deal.prospectusUrl, deal.ticker);
    if (!pdfBuffer) {
      results.push({
        ticker: deal.ticker,
        company: deal.company,
        type: deal.type,
        price: null,
        shares: null,
        sizeHKDm: null,
        patternUsed: 'N/A',
        status: 'DOWNLOAD_FAILED',
        details: `Could not download PDF from ${deal.prospectusUrl}`,
        prospectusUrl: deal.prospectusUrl,
      });
      console.log('  -> Download failed');
      continue;
    }

    try {
      const result = await extractDealMetrics(deal, pdfBuffer);
      results.push(result);

      if (result.status === 'SUCCESS') {
        console.log(`  -> SUCCESS: HK$${result.sizeHKDm}m (${result.patternUsed})`);
      } else {
        console.log(`  -> ${result.status}: ${result.details}`);
      }
    } catch (err) {
      results.push({
        ticker: deal.ticker,
        company: deal.company,
        type: deal.type,
        price: null,
        shares: null,
        sizeHKDm: null,
        patternUsed: 'N/A',
        status: 'ERROR',
        details: `Extraction error: ${err}`,
        prospectusUrl: deal.prospectusUrl,
      });
      console.log(`  -> ERROR: ${err}`);
    }

    // Small delay
    await new Promise(r => setTimeout(r, 300));
  }

  // Step 3: Summary
  console.log('\n' + '='.repeat(80));
  console.log('=== EXTRACTION SUMMARY ===');
  console.log('='.repeat(80));

  const byStatus = {
    SUCCESS: results.filter(r => r.status === 'SUCCESS'),
    PARTIAL: results.filter(r => r.status === 'PARTIAL'),
    NO_MATCH: results.filter(r => r.status === 'NO_MATCH'),
    INTRODUCTION: results.filter(r => r.status === 'INTRODUCTION'),
    TRANSFER: results.filter(r => r.status === 'TRANSFER'),
    NO_URL: results.filter(r => r.status === 'NO_URL'),
    DOWNLOAD_FAILED: results.filter(r => r.status === 'DOWNLOAD_FAILED'),
    ERROR: results.filter(r => r.status === 'ERROR'),
  };

  console.log(`\nTotal processed: ${results.length}`);
  console.log(`  SUCCESS (extracted size): ${byStatus.SUCCESS.length}`);
  console.log(`  PARTIAL (price or shares only): ${byStatus.PARTIAL.length}`);
  console.log(`  NO_MATCH (pattern failed): ${byStatus.NO_MATCH.length}`);
  console.log(`  INTRODUCTION (no IPO): ${byStatus.INTRODUCTION.length}`);
  console.log(`  TRANSFER (no IPO): ${byStatus.TRANSFER.length}`);
  console.log(`  NO_URL: ${byStatus.NO_URL.length}`);
  console.log(`  DOWNLOAD_FAILED: ${byStatus.DOWNLOAD_FAILED.length}`);
  console.log(`  ERROR: ${byStatus.ERROR.length}`);

  // Step 4: Save outputs
  console.log('\n' + '='.repeat(80));
  console.log('=== OUTPUTS ===');
  console.log('='.repeat(80));

  // Save successful extractions to JSON
  const extracted = byStatus.SUCCESS.map(r => ({
    ticker: r.ticker,
    company: r.company,
    price: r.price,
    shares: r.shares,
    sizeHKDm: r.sizeHKDm,
    pattern: r.patternUsed,
  }));
  fs.writeFileSync(EXTRACTED_JSON, JSON.stringify(extracted, null, 2));
  console.log(`\nSaved ${extracted.length} successful extractions to ${EXTRACTED_JSON}`);

  // Save review CSV
  saveReviewCsv(results);
  console.log(`Saved all results to ${REVIEW_CSV} for manual review`);

  // Generate code for KNOWN_SIZES
  if (byStatus.SUCCESS.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('=== CODE TO ADD TO enrich-baseline.ts ===');
    console.log('='.repeat(80));
    console.log(generateKnownSizesCode(byStatus.SUCCESS));
  }

  // Show deals needing manual review
  const needsReview = [...byStatus.PARTIAL, ...byStatus.NO_MATCH, ...byStatus.NO_URL, ...byStatus.DOWNLOAD_FAILED, ...byStatus.ERROR];
  if (needsReview.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('=== DEALS NEEDING MANUAL REVIEW ===');
    console.log('='.repeat(80));
    for (const r of needsReview) {
      console.log(`  ${r.ticker}: ${r.company} - ${r.status}: ${r.details}`);
    }
  }

  // Show introductions/transfers (expected - no IPO)
  const nonIpo = [...byStatus.INTRODUCTION, ...byStatus.TRANSFER];
  if (nonIpo.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('=== NON-IPO LISTINGS (Expected - No Deal Size) ===');
    console.log('='.repeat(80));
    for (const r of nonIpo) {
      console.log(`  ${r.ticker}: ${r.company} - ${r.status}`);
    }
  }

  console.log('\nDone!');
  console.log('\nNext steps:');
  console.log('1. Review extracted-sizes.json and verify a few samples');
  console.log('2. Add KNOWN_SIZES entries to enrich-baseline.ts');
  console.log('3. Run: npx tsx enrich-baseline.ts');
}

main().catch(console.error);
