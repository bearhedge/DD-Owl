/**
 * Investigate "No banks found" failures
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import xlsx from 'xlsx';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_FILE = path.join(__dirname, '../.listed-import-results-mainBoard.json');

async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
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

async function investigate() {
  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const noBanks = results.filter((r: any) => r.error === 'No banks found in section');

  console.log(`Investigating ${noBanks.length} "No banks found" cases\n`);

  // Read Excel for URLs
  const wb = xlsx.readFile(path.join(__dirname, '../../Reference files/Main Board/Listed/HKEX_IPO_Listed.xlsx'));
  const sheet = wb.Sheets['Index'];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  const tickerToUrl: Record<number, string> = {};
  for (let i = 2; i < rows.length; i++) {
    const ticker = rows[i][1];
    const url = rows[i][4];
    if (ticker) tickerToUrl[ticker] = String(url);
  }

  // Sample 5 cases
  const samples = noBanks.slice(0, 5);

  for (const failure of samples) {
    const url = tickerToUrl[failure.ticker];
    console.log(`\n=== [${failure.ticker}] ${failure.company} ===`);
    console.log(`URL: ${url}\n`);

    const buffer = await downloadPdf(url);
    if (!buffer) {
      console.log('Failed to download');
      continue;
    }

    const parser = new PDFParse(new Uint8Array(buffer));
    const result = await parser.getText();
    const allText = result.pages.map(p => p.text).join('\n');

    // Find section
    const sectionMatch = allText.match(/PARTIES INVOLVED[^\n]*\n([\s\S]{500,3000}?)(?=CORPORATE INFORMATION|HISTORY AND|BUSINESS|$)/i);

    if (sectionMatch) {
      console.log('Section content (first 1500 chars):');
      console.log('---');
      console.log(sectionMatch[1].slice(0, 1500));
      console.log('---');

      // Look for bank-like names
      const bankPatterns = sectionMatch[1].match(/[A-Z][A-Za-z\s&]+(?:Limited|Ltd\.?|Securities|Capital|Bank)/gi);
      console.log('\nPotential bank names found:');
      const unique = [...new Set(bankPatterns || [])];
      unique.slice(0, 10).forEach(b => console.log('  ' + b));
    } else {
      console.log('Could not find PARTIES INVOLVED section');
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

investigate().catch(console.error);
