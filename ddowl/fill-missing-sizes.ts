/**
 * Fill Missing IPO Deal Sizes
 *
 * One-time script to extract deal sizes from prospectus PDFs
 * using regex pattern matching on the first 5 pages (deal page).
 */

import XLSX from 'xlsx';
import { PDFParse } from 'pdf-parse';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Excel file path
const EXCEL_PATH = '/Users/home/Desktop/DD Owl/Reference files/Main Board/Listed/HKEX_IPO_Listed.xlsx';

// PDF cache directory
const PDF_CACHE_DIR = './pdf-cache';

// Patterns to extract offer price (avoid matching "Nominal value")
const PRICE_PATTERNS = [
  // "Maximum Offer Price: HK$X.XX" - most reliable
  /Maximum\s*(?:Public\s*)?Offer\s*Price[:\s]+HK\$\s*([\d.]+)/gi,
  // "Offer Price: HK$X.XX" or "Offer Price HK$X.XX" (but not "Nominal")
  /(?:Final\s+)?Offer\s*Price[:\s]+(?:Not\s+more\s+than\s+)?HK\$\s*([\d.]+)/gi,
  // "HK$X.XX per Offer Share" (must have "Offer" to avoid nominal value)
  /HK\$\s*([\d.]+)\s*per\s+Offer\s*(?:Share|Unit)/gi,
  // "not more than HK$X.XX" in offer context
  /not\s+more\s+than\s+HK\$\s*([\d.]+)/gi,
  // Price range format "HK$X.XX to HK$Y.YY" - take the higher one
  /HK\$\s*[\d.]+\s*to\s*HK\$\s*([\d.]+)/gi,
];

// Patterns to extract number of shares/units
// IMPORTANT: Order matters! Total-specific patterns should come FIRST to avoid
// matching subset categories (Public, Placing) before the aggregate total.
const SHARES_PATTERNS = [
  // PRIORITY 1: Explicit total/aggregate patterns (most reliable)
  // "Total number of Shares/Units: X,XXX,XXX"
  /Total\s+(?:number\s+of\s+)?(?:Offer\s+|H\s+)?(?:Shares|Units)[:\s]+([\d,]+)/gi,
  // "Aggregate: X,XXX,XXX Shares/Units"
  /(?:Total|Aggregate)[:\s]*([\d,]+)\s*(?:Offer\s+|H\s+)?(?:Shares|Units)/gi,

  // PRIORITY 2: "(comprising" indicates aggregate total (e.g., "259,200,000 Shares (comprising...")
  // This pattern catches total shares when followed by breakdown of subcategories
  /([\d,]+)\s*(?:Offer\s*)?(?:Shares|Units)\s*\(comprising/gi,

  // PRIORITY 3: "Number of Offer Shares under the Global/Share Offering"
  /Number\s+of\s+(?:Offer\s+)?(?:Shares|Units)\s+under\s+(?:the\s+)?(?:Share|Global)\s+Offering\s*[:\s]+\s*([\d,]+)/gi,
  // "Global Offering: X,XXX,XXX Shares/Units"
  /Global\s+Offering[:\s]*([\d,]+)\s*(?:Offer\s+|H\s+)?(?:Shares|Units)/gi,

  // PRIORITY 4: Generic patterns (may match subsets - use as fallback)
  // "Number of Offer Shares: X,XXX,XXX" or "Number of Units: X,XXX,XXX"
  /Number\s+of\s+(?:Offer\s+|H\s+)?(?:Shares|Units)[:\s]+([\d,]+)/gi,
  // "X,XXX,XXX Offer Shares (subject to/under/in...)"
  /([\d,]+)\s*(?:Offer\s*|H\s*)?(?:Shares|Units)\s*(?:\(subject to|under|in)/gi,
];

interface MissingDeal {
  ticker: number;
  company: string;
  type: string;
  rowIndex?: number; // Optional - only set if deal exists in Excel
}

interface ExtractedMetrics {
  ticker: number;
  price: number | null;
  shares: number | null;
  sizeHKDm: number | null;
  source: string;
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
  // Read enriched CSV
  const csvPath = 'public/baseline-enriched.csv';
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const lines = csv.split('\n');

  // Parse headers (first line)
  const headers = parseCSVLine(lines[0].replace(/^\uFEFF/, '')); // Remove BOM
  const tickerIdx = headers.indexOf('ticker');
  const companyIdx = headers.indexOf('company');
  const typeIdx = headers.indexOf('type');
  const sizeIdx = headers.indexOf('size_hkdm');

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
      });
    }
  }

  return missing;
}

/**
 * Get prospectus URL from database
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

  // Check cache
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  // Ensure cache directory exists
  if (!fs.existsSync(PDF_CACHE_DIR)) {
    fs.mkdirSync(PDF_CACHE_DIR, { recursive: true });
  }

  try {
    console.log(`  Downloading PDF for ${ticker}...`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/pdf',
      },
    });

    if (!response.ok) {
      console.log(`  HTTP ${response.status} for ${ticker}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Verify it's a PDF
    if (!buffer.slice(0, 5).toString().startsWith('%PDF')) {
      console.log(`  Not a PDF for ${ticker}`);
      return null;
    }

    // Cache the PDF
    fs.writeFileSync(cachePath, buffer);
    return buffer;
  } catch (err) {
    console.log(`  Download error for ${ticker}: ${err}`);
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

  // Get first N pages
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
    // Reset lastIndex for global patterns
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
 * Extract number of shares from PDF text
 */
function extractShares(text: string): number | null {
  for (const pattern of SHARES_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const shares = parseNumber(match[1]);
      // Sanity check: shares should be > 1 million
      if (shares && shares >= 1_000_000) {
        return shares;
      }
    }
  }
  return null;
}

/**
 * Check if this is a non-IPO listing (no deal size)
 * Returns the type: 'TRANSFER', 'INTRODUCTION', or null if it's a regular IPO
 */
function getNonIpoType(text: string, dealType: string): 'TRANSFER' | 'INTRODUCTION' | null {
  const typeUpper = dealType.toUpperCase();
  const textUpper = text.toUpperCase();

  // Check for Transfer of Listing first (more specific)
  if (typeUpper.includes('TRANSFER') || /TRANSFER\s+OF\s+LISTING/i.test(text)) {
    return 'TRANSFER';
  }

  // Check for Listing by Introduction
  if (typeUpper.includes('INTRODUCTION') || /LISTING\s+BY\s+(?:WAY\s+OF\s+)?INTRODUCTION/i.test(text)) {
    return 'INTRODUCTION';
  }

  // Check for "no new shares" pattern (usually introduction)
  if (/no\s+(?:new\s+)?shares\s+(?:will\s+be|are\s+being)\s+issued/i.test(text)) {
    return 'INTRODUCTION';
  }

  return null;
}

/**
 * Extract deal metrics from prospectus PDF
 */
async function extractDealMetrics(
  ticker: number,
  pdfBuffer: Buffer,
  dealType: string
): Promise<ExtractedMetrics> {
  const text = await extractPdfText(pdfBuffer, 5);

  // Check for non-IPO listing types (Transfer or Introduction)
  const nonIpoType = getNonIpoType(text, dealType);
  if (nonIpoType === 'TRANSFER') {
    return {
      ticker,
      price: null,
      shares: null,
      sizeHKDm: null,
      source: `TRANSFER: Transfer of Listing - no IPO size`,
    };
  }
  if (nonIpoType === 'INTRODUCTION') {
    return {
      ticker,
      price: null,
      shares: null,
      sizeHKDm: null,
      source: `INTRODUCTION: Listing by Introduction - no IPO size`,
    };
  }

  const price = extractPrice(text);
  const shares = extractShares(text);

  let sizeHKDm: number | null = null;
  let source = '';

  if (price && shares) {
    sizeHKDm = (price * shares) / 1_000_000;
    source = `Extracted: ${shares.toLocaleString()} shares × HK$${price}`;
  } else if (price && !shares) {
    source = `PARTIAL_EXTRACT: Found price HK$${price} but shares pattern not matched - check prospectus format`;
  } else if (shares && !price) {
    source = `PARTIAL_EXTRACT: Found ${shares.toLocaleString()} shares but price pattern not matched - check prospectus format`;
  } else {
    // Provide more detail about what we found in the text
    const hasHKD = text.includes('HK$');
    const hasShares = /shares/i.test(text);
    const hasOffer = /offer/i.test(text);
    const textLength = text.length;
    source = `NO_MATCH: Text has ${textLength} chars, HK$: ${hasHKD}, "shares": ${hasShares}, "offer": ${hasOffer} - patterns didn't match`;
  }

  return { ticker, price, shares, sizeHKDm, source };
}

/**
 * Get a human-readable label for why size is missing
 */
function getSizeLabel(result: ExtractedMetrics, dealType: string, company: string): string {
  const source = result.source;
  const companyUpper = company.toUpperCase();

  // Check for SPAC
  if (companyUpper.includes('SPAC') || companyUpper.includes('ACQUISITION CORP')) {
    return 'SPAC';
  }

  // Check for Transfer of Listing (check source first, then dealType)
  if (source.startsWith('TRANSFER:') || dealType.toLowerCase().includes('transfer')) {
    return 'Transfer of Listing';
  }

  // Check for Listing by Introduction
  if (source.startsWith('INTRODUCTION:') || source.includes('LISTING_BY_INTRO') || dealType.toLowerCase().includes('introduction')) {
    return 'Listing by Introduction';
  }

  // Partial extract - we found some data but not enough
  if (source.includes('PARTIAL_EXTRACT')) {
    return 'Unavailable (partial data)';
  }

  // No URL
  if (source.includes('NO_URL')) {
    return 'Unavailable - No Prospectus URL';
  }

  // Download failed
  if (source.includes('DOWNLOAD_FAILED')) {
    return 'Unavailable - PDF Download Failed';
  }

  // No match - patterns didn't work
  if (source.includes('NO_MATCH')) {
    return 'Unavailable (format)';
  }

  return 'Unavailable - Unknown';
}

/**
 * Update Excel file with extracted sizes
 * Adds new rows for deals not in Deals sheet
 * Labels deals without sizes with their category
 */
function updateExcelWithSizes(results: ExtractedMetrics[], missingDeals: MissingDeal[]): void {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets['Deals'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

  // Build ticker-to-row mapping and deal info mapping
  const tickerToRow = new Map<number, number>();
  for (let i = 2; i < data.length; i++) {
    const ticker = data[i][0];
    if (ticker && typeof ticker === 'number') {
      tickerToRow.set(ticker, i);
    }
  }

  const dealInfoMap = new Map<number, MissingDeal>();
  for (const deal of missingDeals) {
    dealInfoMap.set(deal.ticker, deal);
  }

  let updated = 0;
  let added = 0;
  let labeled = 0;
  const newRows: any[][] = [];

  for (const result of results) {
    const dealInfo = dealInfoMap.get(result.ticker);
    const rowIndex = tickerToRow.get(result.ticker);

    // If we have a size, add/update normally
    if (result.sizeHKDm !== null) {
      if (rowIndex === undefined) {
        // Deal not in Deals sheet - add to newRows for appending
        if (dealInfo) {
          newRows.push([
            result.ticker,
            dealInfo.company,
            dealInfo.type,
            result.shares || '-',
            '-', // HK Shares
            '-', // Intl Shares
            '-', // Pub Shares
            '-', // Placing Shares
            result.price || '-',
            result.sizeHKDm,
            result.source,
          ]);
          added++;
        }
      } else {
        // Update existing row with size
        const sizeAddr = XLSX.utils.encode_cell({ r: rowIndex, c: 10 });
        ws[sizeAddr] = { t: 'n', v: Math.round(result.sizeHKDm * 1000) / 1000 };

        if (result.price) {
          const priceAddr = XLSX.utils.encode_cell({ r: rowIndex, c: 9 });
          const existingPrice = ws[priceAddr]?.v;
          if (!existingPrice || existingPrice === '-' || existingPrice === '') {
            ws[priceAddr] = { t: 'n', v: result.price };
          }
        }

        if (result.shares) {
          const sharesAddr = XLSX.utils.encode_cell({ r: rowIndex, c: 4 });
          const existingShares = ws[sharesAddr]?.v;
          if (!existingShares || existingShares === '-' || existingShares === '') {
            ws[sharesAddr] = { t: 'n', v: result.shares };
          }
        }
        updated++;
      }
    } else {
      // No size extracted - add with label
      if (dealInfo) {
        const label = getSizeLabel(result, dealInfo.type, dealInfo.company);

        if (rowIndex === undefined) {
          // Add new row with label instead of size
          newRows.push([
            result.ticker,
            dealInfo.company,
            dealInfo.type,
            '-',  // Shares
            '-',  // HK Shares
            '-',  // Intl Shares
            '-',  // Pub Shares
            '-',  // Placing Shares
            '-',  // Price
            label, // Size column gets the label
            result.source, // Info column
          ]);
          labeled++;
        } else {
          // Update existing row with label
          const sizeAddr = XLSX.utils.encode_cell({ r: rowIndex, c: 10 });
          ws[sizeAddr] = { t: 's', v: label };
          labeled++;
        }
      }
    }
  }

  // Append new rows to the Deals sheet
  if (newRows.length > 0) {
    const startRow = data.length; // Next row after existing data
    for (let i = 0; i < newRows.length; i++) {
      const row = newRows[i];
      for (let c = 0; c < row.length; c++) {
        // Column B is index 1, so add 1 to column index
        const cellAddr = XLSX.utils.encode_cell({ r: startRow + i, c: c + 1 });
        const value = row[c];
        if (typeof value === 'number') {
          ws[cellAddr] = { t: 'n', v: value };
        } else {
          ws[cellAddr] = { t: 's', v: String(value) };
        }
      }
    }

    // Update worksheet range to include new rows
    const newRange = `B1:N${startRow + newRows.length}`;
    ws['!ref'] = newRange;
  }

  console.log(`\nUpdating Excel: ${updated} existing rows updated, ${added} new rows with sizes, ${labeled} labeled (no size)`);
  XLSX.writeFile(wb, EXCEL_PATH);
  console.log(`Saved to ${EXCEL_PATH}`);
}

/**
 * Main function
 */
async function main() {
  console.log('=== Fill Missing IPO Deal Sizes ===\n');

  // Step 1: Find missing deals
  console.log('Step 1: Finding deals with missing sizes...');
  const missingDeals = findMissingDeals();
  console.log(`Found ${missingDeals.length} deals with missing sizes\n`);

  if (missingDeals.length === 0) {
    console.log('No missing deals found. Done!');
    return;
  }

  // Show first 20
  console.log('First 20 missing deals:');
  for (const deal of missingDeals.slice(0, 20)) {
    console.log(`  ${deal.ticker}: ${deal.company} (${deal.type})`);
  }
  console.log('');

  // Step 2: Process each deal
  console.log('Step 2: Extracting metrics from PDFs...\n');
  const results: ExtractedMetrics[] = [];

  for (let i = 0; i < missingDeals.length; i++) {
    const deal = missingDeals[i];
    console.log(`[${i + 1}/${missingDeals.length}] Processing ${deal.ticker}: ${deal.company} (type: ${deal.type})`);

    // Get PDF URL
    const pdfUrl = getProspectusUrl(deal.ticker);
    if (!pdfUrl) {
      const reason = `NO_URL: No prospectus URL in database for ticker ${deal.ticker}`;
      console.log(`  ${reason}`);
      results.push({ ticker: deal.ticker, price: null, shares: null, sizeHKDm: null, source: reason });
      continue;
    }

    // Download PDF
    const pdfBuffer = await downloadPdf(pdfUrl, deal.ticker);
    if (!pdfBuffer) {
      const reason = `DOWNLOAD_FAILED: Could not fetch PDF from ${pdfUrl}`;
      console.log(`  ${reason}`);
      results.push({ ticker: deal.ticker, price: null, shares: null, sizeHKDm: null, source: reason });
      continue;
    }

    // Extract metrics
    try {
      const metrics = await extractDealMetrics(deal.ticker, pdfBuffer, deal.type);
      results.push(metrics);
      console.log(`  ${metrics.source}`);

      if (metrics.sizeHKDm) {
        console.log(`  → Size: HK$${metrics.sizeHKDm.toFixed(2)}m`);
      }
    } catch (err) {
      const reason = `EXTRACT_ERROR: ${String(err)}`;
      console.log(`  ${reason}`);
      results.push({ ticker: deal.ticker, price: null, shares: null, sizeHKDm: null, source: reason });
    }

    // Small delay to be nice to HKEX servers
    await new Promise(r => setTimeout(r, 500));
  }

  // Step 3: Summary
  console.log('\n=== Summary ===');
  const extracted = results.filter(r => r.sizeHKDm !== null);
  const noMetrics = results.filter(r => r.sizeHKDm === null);

  // Categorize failures
  const listingByIntro = noMetrics.filter(r => r.source.startsWith('LISTING_BY_INTRO'));
  const partialExtract = noMetrics.filter(r => r.source.startsWith('PARTIAL_EXTRACT'));
  const noMatch = noMetrics.filter(r => r.source.startsWith('NO_MATCH'));
  const noUrl = noMetrics.filter(r => r.source.startsWith('NO_URL'));
  const downloadFailed = noMetrics.filter(r => r.source.startsWith('DOWNLOAD_FAILED'));
  const extractError = noMetrics.filter(r => r.source.startsWith('EXTRACT_ERROR'));

  console.log(`\n✅ Successfully extracted: ${extracted.length}`);
  console.log(`\n❌ Not extracted: ${noMetrics.length}`);
  console.log(`   - Listing by Introduction (no IPO): ${listingByIntro.length}`);
  console.log(`   - Partial extract (price or shares only): ${partialExtract.length}`);
  console.log(`   - Pattern not matched: ${noMatch.length}`);
  console.log(`   - No URL in database: ${noUrl.length}`);
  console.log(`   - Download failed: ${downloadFailed.length}`);
  console.log(`   - Extraction error: ${extractError.length}`);

  if (extracted.length > 0) {
    console.log('\n--- Extracted sizes ---');
    for (const r of extracted) {
      console.log(`  ${r.ticker}: HK$${r.sizeHKDm?.toFixed(2)}m`);
    }
  }

  if (partialExtract.length > 0) {
    console.log('\n--- Partial extracts (MANUAL REVIEW - patterns need fixing) ---');
    for (const r of partialExtract) {
      console.log(`  ${r.ticker}: ${r.source}`);
    }
  }

  if (noMatch.length > 0) {
    console.log('\n--- No pattern match (MANUAL REVIEW - check PDF format) ---');
    for (const r of noMatch) {
      console.log(`  ${r.ticker}: ${r.source}`);
    }
  }

  if (listingByIntro.length > 0) {
    console.log('\n--- Listing by Introduction (expected - no IPO) ---');
    for (const r of listingByIntro) {
      console.log(`  ${r.ticker}: ${r.source}`);
    }
  }

  if (noUrl.length > 0 || downloadFailed.length > 0) {
    console.log('\n--- URL/Download issues ---');
    for (const r of [...noUrl, ...downloadFailed]) {
      console.log(`  ${r.ticker}: ${r.source}`);
    }
  }

  // Step 4: Update Excel (pass ALL results, not just extracted - so we can label missing ones)
  console.log('\nStep 3: Updating Excel file...');
  updateExcelWithSizes(results, missingDeals);
  console.log('\nDone! Run `npm run enrich` to regenerate baseline-enriched.csv');
}

// Run if called directly
main().catch(console.error);
