/**
 * Process only the tickers that have URL overrides but haven't succeeded yet
 */
import fs from 'fs';
import axios from 'axios';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

const RESULTS_FILE = '.historical-import-results.json';
const URL_OVERRIDES_FILE = 'url-overrides.json';

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  banks?: any[];
}

interface UrlOverride {
  company: string;
  correctUrl: string;
  reason?: string;
}

async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return Buffer.from(response.data);
  } catch (e) {
    return null;
  }
}

function saveResult(result: ImportResult): void {
  let results: ImportResult[] = [];
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    }
  } catch (e) {
    results = [];
  }
  const existingIndex = results.findIndex(r => r.ticker === result.ticker);
  if (existingIndex >= 0) {
    results[existingIndex] = result;
  } else {
    results.push(result);
  }
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

async function main() {
  // Load URL overrides
  const overridesData = JSON.parse(fs.readFileSync(URL_OVERRIDES_FILE, 'utf8'));
  const overrides: Record<string, UrlOverride> = overridesData.overrides;

  // Load existing results to find which ones haven't succeeded
  let results: ImportResult[] = [];
  if (fs.existsSync(RESULTS_FILE)) {
    results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  }

  // Find succeeded tickers
  const succeeded = new Set<number>();
  results.forEach(r => {
    if (r.success) succeeded.add(r.ticker);
  });

  // Process overrides that haven't succeeded
  const toProcess: Array<{ ticker: number; company: string; url: string }> = [];
  for (const [tickerStr, override] of Object.entries(overrides)) {
    const ticker = parseInt(tickerStr);
    if (!succeeded.has(ticker)) {
      toProcess.push({
        ticker,
        company: override.company,
        url: override.correctUrl,
      });
    }
  }

  console.log(`Found ${toProcess.length} tickers to process\n`);

  let successCount = 0;
  let failCount = 0;

  for (const target of toProcess) {
    console.log(`[${target.ticker}] ${target.company}`);
    console.log(`  URL: ${target.url.slice(0, 60)}...`);

    const buffer = await downloadPdf(target.url);
    if (!buffer) {
      console.log('  ✗ Download failed\n');
      failCount++;
      saveResult({
        ticker: target.ticker,
        company: target.company,
        success: false,
        banksFound: 0,
        error: 'Download failed',
      });
      continue;
    }

    if (buffer.slice(0, 5).toString() !== '%PDF-') {
      console.log('  ✗ Invalid PDF\n');
      failCount++;
      saveResult({
        ticker: target.ticker,
        company: target.company,
        success: false,
        banksFound: 0,
        error: 'Invalid PDF',
      });
      continue;
    }

    try {
      const result = await extractBanksFromProspectus(buffer);

      if (!result.sectionFound) {
        console.log('  ✗ Section not found\n');
        failCount++;
        saveResult({
          ticker: target.ticker,
          company: target.company,
          success: false,
          banksFound: 0,
          error: 'Parties Involved section not found',
        });
        continue;
      }

      if (result.banks.length === 0) {
        console.log('  ✗ No banks found\n');
        failCount++;
        saveResult({
          ticker: target.ticker,
          company: target.company,
          success: false,
          banksFound: 0,
          error: 'No banks found in section',
        });
        continue;
      }

      // Success!
      const leads = result.banks.filter(b => b.isLead).length;
      console.log(`  ✓ ${result.banks.length} banks (${leads} leads)`);
      result.banks.slice(0, 5).forEach(b => {
        console.log(`    - ${b.bankNormalized}`);
      });
      if (result.banks.length > 5) {
        console.log(`    ... and ${result.banks.length - 5} more`);
      }
      console.log();

      successCount++;
      saveResult({
        ticker: target.ticker,
        company: target.company,
        success: true,
        banksFound: result.banks.length,
        banks: result.banks.map(b => ({
          name: b.bank,
          normalized: b.bankNormalized,
          roles: [...b.roles],
          isLead: b.isLead,
          rawRole: b.rawRole,
        })),
      });

    } catch (e: any) {
      console.log(`  ✗ Error: ${e.message}\n`);
      failCount++;
      saveResult({
        ticker: target.ticker,
        company: target.company,
        success: false,
        banksFound: 0,
        error: e.message,
      });
    }

    // Small delay
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n=== Summary ===');
  console.log(`Processed: ${toProcess.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

main().catch(console.error);
