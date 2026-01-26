import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read results
const results = JSON.parse(fs.readFileSync('.listed-import-results-mainBoard.json', 'utf8'));

// Read Excel for URLs
const wb = xlsx.readFile(path.join(__dirname, '../Reference files/Main Board/Listed/HKEX_IPO_Listed.xlsx'));
const indexSheet = wb.Sheets['Index'];
const indexRows = xlsx.utils.sheet_to_json(indexSheet, { header: 1 }) as any[][];
const dealsSheet = wb.Sheets['Deals'];
const dealsRows = xlsx.utils.sheet_to_json(dealsSheet, { header: 1 }) as any[][];

// Build lookup maps
const tickerToUrl: Record<number, string> = {};
for (let i = 2; i < indexRows.length; i++) {
  const ticker = indexRows[i][1];
  const url = indexRows[i][4];
  if (ticker) {
    tickerToUrl[ticker] = String(url || '');
  }
}

const tickerToSize: Record<number, number> = {};
for (let i = 2; i < dealsRows.length; i++) {
  const ticker = dealsRows[i][0];
  const size = dealsRows[i][9];
  if (ticker) {
    tickerToSize[ticker] = Number(size) || 0;
  }
}

// Get failures with details
const failures = results
  .filter((r: any) => !r.success)
  .map((r: any) => ({
    ticker: r.ticker,
    company: r.company,
    error: r.error,
    sizeHKDm: tickerToSize[r.ticker] || null,
    url: tickerToUrl[r.ticker] || null,
  }));

// Read HTML template
let html = fs.readFileSync('failures-review.html', 'utf8');

// Inject data
html = html.replace('FAILURES_DATA', JSON.stringify(failures, null, 2));

// Write final HTML
fs.writeFileSync('failures-review.html', html);

console.log('Generated failures-review.html with', failures.length, 'failures');
console.log('Open in browser: file://' + path.resolve('failures-review.html'));
