/**
 * Re-process the 3 parser failures with updated parser
 */
import fs from 'fs';
import axios from 'axios';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

const RESULTS_FILE = '.historical-import-results.json';

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  banks?: any[];
  note?: string;
}

const targets = [
  { ticker: 3750, company: 'Contemporary Amperex Technology Co., Limited', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0512/2025051200005.pdf' },
  { ticker: 3358, company: 'Bestway Global Holding Inc.', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2017/1106/ltn20171106046_c.pdf' },
  { ticker: 6893, company: 'Hin Sang Group (International) Holding Co. Ltd.', url: 'http://www.hkexnews.hk/listedco/listconews/SEHK/2014/0930/LTN20140930053.pdf' },
];

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

async function main() {
  // Load existing results
  let results: ImportResult[] = [];
  if (fs.existsSync(RESULTS_FILE)) {
    results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  }

  for (const target of targets) {
    console.log(`\nProcessing ${target.ticker} - ${target.company}`);

    // Download PDF
    const buffer = await downloadPdf(target.url);
    if (!buffer) {
      console.log('  Download failed');
      continue;
    }

    // Verify PDF
    if (buffer.slice(0, 5).toString() !== '%PDF-') {
      console.log('  Invalid PDF');
      continue;
    }

    // Extract banks
    try {
      const result = await extractBanksFromProspectus(buffer);

      const newResult: ImportResult = {
        ticker: target.ticker,
        company: target.company,
        success: result.sectionFound && result.banks.length > 0,
        banksFound: result.banks.length,
        banks: result.banks.map(b => ({
          name: b.bank,
          normalized: b.bankNormalized,
          roles: [...b.roles],
          isLead: b.isLead,
          rawRole: b.rawRole,
        })),
      };

      if (!result.sectionFound) {
        newResult.error = 'Parties Involved section not found';
        newResult.note = 'Parser updated but section still not found';
      } else if (result.banks.length === 0) {
        newResult.error = 'No banks found in section';
      }

      // Update in results array
      const existingIndex = results.findIndex(r => r.ticker === target.ticker);
      if (existingIndex >= 0) {
        results[existingIndex] = newResult;
        console.log(`  Updated existing entry`);
      } else {
        results.push(newResult);
        console.log(`  Added new entry`);
      }

      console.log(`  Success: ${newResult.success}, Banks: ${newResult.banksFound}`);
      if (newResult.banks && newResult.banks.length > 0) {
        newResult.banks.slice(0, 5).forEach(b => {
          console.log(`    - ${b.normalized}`);
        });
      }
    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // Save updated results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log('\nResults file updated');
}

main().catch(console.error);
