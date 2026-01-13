/**
 * Re-import all historical deals with the updated parser
 *
 * This script processes ALL deals from the Excel file using the latest parser.
 * Run this after making parser improvements to apply them across all deals.
 */

import fs from 'fs';
import axios from 'axios';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  banks?: any[];
}

interface ExcelDeal {
  ticker: number;
  company: string;
  type: string;
  prospectusUrl: string;
  date: string;
}

// Load URL overrides
function loadUrlOverrides(): Record<string, { correctUrl: string | null; reason?: string }> {
  try {
    const overridesPath = path.join(__dirname, 'url-overrides.json');
    const data = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    return data.overrides || {};
  } catch {
    return {};
  }
}

// Read all deals from Excel
function readExcel(): ExcelDeal[] {
  const excelPath = path.join(__dirname, '../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');
  const workbook = xlsx.readFile(excelPath);
  const indexSheet = workbook.Sheets['Index'];
  const rows = xlsx.utils.sheet_to_json(indexSheet, { header: 1 }) as any[][];

  // Load URL overrides
  const urlOverrides = loadUrlOverrides();

  const deals: ExcelDeal[] = [];

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[1]) continue;

    const ticker = typeof row[1] === 'number' ? row[1] : parseInt(row[1]);
    if (isNaN(ticker)) continue;

    // Check for URL override
    const override = urlOverrides[String(ticker)];
    let prospectusUrl = String(row[4] || '').trim();

    if (override) {
      if (override.correctUrl === null) {
        // Skip this deal (e.g., Listing by Introduction)
        continue;
      }
      prospectusUrl = override.correctUrl;
    }

    deals.push({
      ticker,
      company: String(row[2] || '').trim(),
      type: String(row[3] || '').trim(),
      prospectusUrl,
      date: String(row[5] || '').trim(),
    });
  }

  return deals;
}

// Extract PDF URL from HTML index page
async function getPdfFromHtmlIndex(htmlUrl: string): Promise<string | null> {
  try {
    const resp = await axios.get(htmlUrl, { timeout: 30000 });
    const html = resp.data as string;
    const baseUrl = htmlUrl.substring(0, htmlUrl.lastIndexOf('/') + 1);

    // Find the line containing "Parties Involved" (case insensitive) and extract the PDF href
    const lines = html.split('\n');
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      if (lineLower.includes('parties involved') || lineLower.includes('parties in the global')) {
        const pdfMatch = line.match(/href="([^"]+\.pdf)"/i);
        if (pdfMatch) {
          const pdfPath = pdfMatch[1].replace(/^\.\//, '');
          return baseUrl + pdfPath;
        }
      }
    }

    // Fallback: look for any link with "Directors and Parties"
    const directorsPartiesMatch = html.match(/href="([^"]+\.pdf)"[^>]*>[^<]*Directors[^<]*Parties/i);
    if (directorsPartiesMatch) {
      const pdfPath = directorsPartiesMatch[1].replace(/^\.\//, '');
      return baseUrl + pdfPath;
    }

    // If not found, try to get first PDF (often the full prospectus)
    const firstPdfMatch = html.match(/href="([^"]+\.pdf)"/i);
    if (firstPdfMatch) {
      const pdfPath = firstPdfMatch[1].replace(/^\.\//, '');
      return baseUrl + pdfPath;
    }

    return null;
  } catch {
    return null;
  }
}

// Process a single deal
async function processDeal(deal: ExcelDeal): Promise<ImportResult> {
  if (!deal.prospectusUrl) {
    return {
      ticker: deal.ticker,
      company: deal.company,
      success: false,
      banksFound: 0,
      error: 'No prospectus URL',
    };
  }

  try {
    let pdfUrl = deal.prospectusUrl;

    // If it's an HTML index page, extract the actual PDF URL
    if (deal.prospectusUrl.toLowerCase().endsWith('.htm') || deal.prospectusUrl.toLowerCase().endsWith('.html')) {
      const extractedUrl = await getPdfFromHtmlIndex(deal.prospectusUrl);
      if (!extractedUrl) {
        return {
          ticker: deal.ticker,
          company: deal.company,
          success: false,
          banksFound: 0,
          error: 'Could not find PDF in HTML index',
        };
      }
      pdfUrl = extractedUrl;
    }

    const resp = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });
    const buffer = Buffer.from(resp.data);

    const extracted = await extractBanksFromProspectus(buffer);

    if (extracted.banks.length > 0) {
      return {
        ticker: deal.ticker,
        company: deal.company,
        success: true,
        banksFound: extracted.banks.length,
        banks: extracted.banks.map(b => ({
          name: b.bank,
          normalized: b.bankNormalized,
          roles: [...b.roles],
          isLead: b.isLead,
          rawRole: b.rawRole,
        })),
      };
    } else {
      return {
        ticker: deal.ticker,
        company: deal.company,
        success: false,
        banksFound: 0,
        error: extracted.sectionFound ? 'No banks extracted from section' : 'Section not found',
      };
    }
  } catch (err: any) {
    return {
      ticker: deal.ticker,
      company: deal.company,
      success: false,
      banksFound: 0,
      error: err.message || 'Unknown error',
    };
  }
}

// Delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  // Parse command line args
  const args = process.argv.slice(2);
  const startFrom = args.find(a => a.startsWith('--from='))?.split('=')[1];
  const limitTo = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const tickerFilter = args.find(a => a.startsWith('--ticker='))?.split('=')[1];
  const concurrency = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');

  console.log('Loading deals from Excel...');
  let deals = readExcel();
  console.log(`Found ${deals.length} deals in Excel`);

  // Filter if specified
  if (tickerFilter) {
    const tickers = tickerFilter.split(',').map(t => parseInt(t.trim()));
    deals = deals.filter(d => tickers.includes(d.ticker));
    console.log(`Filtering to ${deals.length} deals: ${tickers.join(', ')}`);
  }
  if (startFrom) {
    const idx = deals.findIndex(d => d.ticker === parseInt(startFrom));
    if (idx > 0) {
      deals = deals.slice(idx);
      console.log(`Starting from ticker ${startFrom}, ${deals.length} deals remaining`);
    }
  }
  if (limitTo) {
    deals = deals.slice(0, parseInt(limitTo));
    console.log(`Limiting to first ${deals.length} deals`);
  }

  // Load existing results to preserve any manual fixes
  let existingResults: ImportResult[] = [];
  try {
    existingResults = JSON.parse(fs.readFileSync('.historical-import-results.json', 'utf8'));
    console.log(`Loaded ${existingResults.length} existing results`);
  } catch {
    console.log('No existing results found, starting fresh');
  }

  const results: ImportResult[] = [...existingResults];
  const tickersToProcess = new Set(deals.map(d => d.ticker));

  // Remove deals we're about to re-process
  const filteredResults = results.filter(r => !tickersToProcess.has(r.ticker));

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  console.log(`\nProcessing ${deals.length} deals with concurrency ${concurrency}...`);
  console.log('Press Ctrl+C to stop (progress is saved after each batch)\n');

  // Process in batches
  for (let i = 0; i < deals.length; i += concurrency) {
    const batch = deals.slice(i, i + concurrency);

    const batchResults = await Promise.all(batch.map(deal => processDeal(deal)));

    for (const result of batchResults) {
      filteredResults.push(result);
      processed++;
      if (result.success) {
        succeeded++;
        console.log(`✓ ${result.ticker} - ${result.company}: ${result.banksFound} banks`);
      } else {
        failed++;
        console.log(`✗ ${result.ticker} - ${result.company}: ${result.error}`);
      }
    }

    // Save progress after each batch
    fs.writeFileSync('.historical-import-results.json', JSON.stringify(filteredResults, null, 2));

    // Progress update
    const pct = ((processed / deals.length) * 100).toFixed(1);
    console.log(`\n--- Progress: ${processed}/${deals.length} (${pct}%) | Success: ${succeeded} | Failed: ${failed} ---\n`);

    // Small delay between batches to avoid overwhelming the server
    if (i + concurrency < deals.length) {
      await delay(500);
    }
  }

  // Final summary
  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Total processed: ${processed}`);
  console.log(`Successful: ${succeeded} (${((succeeded / processed) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed}`);

  // List failures
  const failures = filteredResults.filter(r => !r.success);
  if (failures.length > 0) {
    console.log('\n=== FAILED DEALS ===');
    for (const f of failures.slice(0, 20)) {
      console.log(`${f.ticker} - ${f.company}: ${f.error}`);
    }
    if (failures.length > 20) {
      console.log(`... and ${failures.length - 20} more`);
    }
  }

  console.log('\nResults saved to .historical-import-results.json');
  console.log('Run: npx tsx generate-review-page.ts to regenerate the review page');
}

main().catch(console.error);
