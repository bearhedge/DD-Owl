/**
 * Investigate "Section not found" failures to understand format variations
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

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  error?: string;
}

async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    // Handle HTML redirect pages
    if (url.endsWith('.htm')) {
      const htmlResp = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = htmlResp.data;

      // Find any PDF link
      const match = html.match(/href="([^"]+\.pdf)"/i);
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
  const results: ImportResult[] = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const sectionNotFound = results.filter(r => r.error === 'Parties Involved section not found');

  console.log(`Investigating ${sectionNotFound.length} "Section not found" cases\n`);

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

  for (const failure of sectionNotFound) {
    const url = tickerToUrl[failure.ticker];
    console.log(`\n=== [${failure.ticker}] ${failure.company} ===`);
    console.log(`URL: ${url}\n`);

    const buffer = await downloadPdf(url);
    if (!buffer) {
      console.log('Failed to download');
      continue;
    }

    // Parse PDF and look for section titles
    const uint8Array = new Uint8Array(buffer);
    const parser = new PDFParse(uint8Array);
    const result = await parser.getText();
    const allText = result.pages.map(p => p.text).join('\n');

    // Search for potential section titles
    const patterns = [
      /PARTIES INVOLVED/gi,
      /DIRECTORS AND PARTIES/gi,
      /CORPORATE INFORMATION/gi,
      /SPONSOR/gi,
      /Joint Sponsor/gi,
      /UNDERWRITERS/gi,
      /PLACING AGENTS/gi,
    ];

    console.log('Found section-like headings:');
    for (const pattern of patterns) {
      const matches = allText.match(pattern);
      if (matches) {
        console.log(`  "${pattern.source}": ${matches.length} matches`);
      }
    }

    // Show context around "Sponsor" if found
    const sponsorIdx = allText.search(/\bSponsor\b/i);
    if (sponsorIdx > 0) {
      const context = allText.slice(Math.max(0, sponsorIdx - 200), sponsorIdx + 500);
      console.log('\nContext around "Sponsor":');
      console.log('---');
      console.log(context.slice(0, 700));
      console.log('---');
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

investigate().catch(console.error);
