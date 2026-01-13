import fs from 'fs';
import axios from 'axios';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get URL for ticker from Excel
function getUrlForTicker(ticker: number): string | null {
  const excelPath = path.join(__dirname, '../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');
  const workbook = xlsx.readFile(excelPath);
  const indexSheet = workbook.Sheets['Index'];
  const rows = xlsx.utils.sheet_to_json(indexSheet, { header: 1 }) as any[][];

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[1] === ticker) {
      return String(row[4] || '').trim();
    }
  }
  return null;
}

async function debug() {
  // Check 9608 which has undefined banks
  const ticker = 9608;
  const url = getUrlForTicker(ticker);

  console.log(`Debugging ticker ${ticker}`);
  console.log(`URL: ${url}`);

  if (!url) {
    console.log('No URL found');
    return;
  }

  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);

  // First, let's see the raw section text
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  // Find PARTIES INVOLVED section
  console.log('\n=== Searching for PARTIES INVOLVED ===');
  const idx = allText.indexOf('PARTIES INVOLVED');
  if (idx !== -1) {
    console.log(allText.slice(idx, idx + 2000).replace(/\t/g, '→TAB→'));
  }

  // Run extractor
  console.log('\n=== Running extractor ===');
  const extracted = await extractBanksFromProspectus(buffer);
  console.log('Section found:', extracted.sectionFound);
  console.log('Banks found:', extracted.banks.length);

  console.log('\n=== Bank objects ===');
  for (const bank of extracted.banks) {
    console.log(JSON.stringify(bank, null, 2));
  }

  console.log('\n=== Raw section text ===');
  if (extracted.rawSectionText) {
    console.log(extracted.rawSectionText.slice(0, 1500));
  }
}

debug().catch(console.error);
