/**
 * Re-run "Section not found" failures with updated parser
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import xlsx from 'xlsx';
import { extractBanksFromProspectus } from './prospectus-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_FILE = path.join(__dirname, '../.historical-import-results.json');

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  note?: string;
  banks?: any[];
}

async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    // Handle HTML redirect pages
    if (url.endsWith('.htm')) {
      const htmlResp = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = htmlResp.data;

      const match = html.match(/href="([^"]+\.pdf)"[^>]*>.*?(?:Parties|Director)/i);
      if (match) {
        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
        url = baseUrl + match[1];
      }
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    return Buffer.from(response.data);
  } catch (error) {
    return null;
  }
}

async function fixSectionNotFound() {
  const results: ImportResult[] = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const failures = results.filter(r => r.error === 'Parties Involved section not found');

  console.log(`Re-running ${failures.length} "Section not found" cases\n`);

  // Read Excel for URLs
  const wb = xlsx.readFile(path.join(__dirname, '../../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx'));
  const sheet = wb.Sheets['Index'];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  const tickerToUrl: Record<number, string> = {};
  for (let i = 2; i < rows.length; i++) {
    const ticker = rows[i][1];
    const url = rows[i][4];
    if (ticker) tickerToUrl[ticker] = String(url);
  }

  let fixed = 0;
  let stillFailed = 0;

  for (const failure of failures) {
    const url = tickerToUrl[failure.ticker];
    console.log(`[${failure.ticker}] ${failure.company}`);

    const buffer = await downloadPdf(url);
    if (!buffer) {
      console.log(`  ✗ Download failed`);
      stillFailed++;
      continue;
    }

    // Verify PDF
    if (buffer.slice(0, 5).toString() !== '%PDF-') {
      console.log(`  ✗ Invalid PDF`);
      stillFailed++;
      continue;
    }

    const result = await extractBanksFromProspectus(buffer);

    if (!result.sectionFound) {
      console.log(`  ✗ Section still not found`);
      stillFailed++;
      continue;
    }

    if (result.banks.length === 0) {
      console.log(`  ✗ Section found but no banks extracted`);
      const idx = results.findIndex(r => r.ticker === failure.ticker);
      if (idx >= 0) {
        results[idx].error = 'No banks found in section';
        results[idx].note = 'Section found after parser update but no banks extracted';
      }
      stillFailed++;
      continue;
    }

    // Success!
    console.log(`  ✓ Found ${result.banks.length} banks`);
    result.banks.forEach(b => {
      const marker = b.isLead ? '★' : ' ';
      console.log(`    ${marker} ${b.bankNormalized} [${b.roles.join(', ')}]`);
    });

    const idx = results.findIndex(r => r.ticker === failure.ticker);
    if (idx >= 0) {
      results[idx] = {
        ticker: failure.ticker,
        company: failure.company,
        success: true,
        banksFound: result.banks.length,
        banks: result.banks.map(b => ({
          name: b.bank,
          normalized: b.bankNormalized,
          roles: [...b.roles],
          isLead: b.isLead,
          rawRole: b.rawRole,
        })),
      };
    }

    fixed++;
    console.log('');
    await new Promise(r => setTimeout(r, 300));
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  console.log('\n=== Summary ===');
  console.log(`Fixed: ${fixed}`);
  console.log(`Still failed: ${stillFailed}`);
}

fixSectionNotFound().catch(console.error);
