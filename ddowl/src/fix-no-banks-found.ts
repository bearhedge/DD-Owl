/**
 * Fix "No banks found in section" failures by re-running the improved parser
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { extractBanksFromProspectus } from './prospectus-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_FILE = path.join(__dirname, '../.listed-import-results-mainBoard.json');

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  error?: string;
  note?: string;
  banks?: any[];
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadPDF(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    // Check if HTML redirect page
    const text = Buffer.from(resp.data).toString('utf8', 0, 1000);
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      console.log('  → Got HTML page instead of PDF, skipping');
      return null;
    }

    return Buffer.from(resp.data);
  } catch (error: any) {
    console.log('  → Download failed:', error.message);
    return null;
  }
}

async function fixNoBanksFound() {
  console.log('Loading results...');
  const results: ImportResult[] = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

  // Load remaining failures with URLs
  const failuresFile = path.join(__dirname, '../.remaining-failures.json');
  const failures = JSON.parse(fs.readFileSync(failuresFile, 'utf8'));

  // Filter to only "No banks found in section" errors
  const noBanksErrors = failures.filter((f: any) =>
    f.error === 'No banks found in section' && f.url
  );

  console.log(`Found ${noBanksErrors.length} "No banks found" cases to retry\n`);

  let fixed = 0;
  let stillFailed = 0;

  for (let i = 0; i < noBanksErrors.length; i++) {
    const failure = noBanksErrors[i];
    console.log(`[${i + 1}/${noBanksErrors.length}] ${failure.ticker} - ${failure.company.slice(0, 40)}`);
    console.log(`  URL: ${failure.url}`);

    // Download PDF
    const buffer = await downloadPDF(failure.url);
    if (!buffer) {
      stillFailed++;
      continue;
    }

    // Try to extract banks
    try {
      const result = await extractBanksFromProspectus(buffer);

      if (result.banks.length > 0) {
        console.log(`  ✓ Fixed! Found ${result.banks.length} banks`);
        result.banks.slice(0, 3).forEach(b => {
          console.log(`    - ${b.bankNormalized} [${b.roles.join(', ')}]`);
        });
        if (result.banks.length > 3) {
          console.log(`    ... and ${result.banks.length - 3} more`);
        }

        // Update the result in the main results file
        const idx = results.findIndex(r => r.ticker === failure.ticker);
        if (idx >= 0) {
          results[idx].success = true;
          results[idx].error = undefined;
          results[idx].banks = result.banks;
        }
        fixed++;
      } else {
        console.log(`  ✗ Still no banks found`);
        if (result.rawSectionText) {
          console.log(`  Section preview: ${result.rawSectionText.slice(0, 200)}...`);
        }
        stillFailed++;
      }
    } catch (error: any) {
      console.log(`  ✗ Parse error: ${error.message}`);
      stillFailed++;
    }

    // Rate limit
    await delay(500);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Fixed: ${fixed}`);
  console.log(`Still failed: ${stillFailed}`);
  console.log(`Total: ${noBanksErrors.length}`);

  // Save updated results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log('\nSaved updated results to .listed-import-results-mainBoard.json');
}

fixNoBanksFound().catch(console.error);
