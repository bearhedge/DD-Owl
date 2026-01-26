/**
 * List remaining fixable failures with details
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_FILE = path.join(__dirname, '../.listed-import-results-mainBoard.json');

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  error?: string;
  note?: string;
}

async function listFailures() {
  const results: ImportResult[] = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

  // Read Excel for more details
  const wb = xlsx.readFile(path.join(__dirname, '../../Reference files/Main Board/Listed/HKEX_IPO_Listed.xlsx'));

  // Index sheet for URLs
  const indexSheet = wb.Sheets['Index'];
  const indexRows = xlsx.utils.sheet_to_json(indexSheet, { header: 1 }) as any[][];

  // Deals sheet for more info
  const dealsSheet = wb.Sheets['Deals'];
  const dealsRows = xlsx.utils.sheet_to_json(dealsSheet, { header: 1 }) as any[][];

  // Build lookup maps
  const tickerToUrl: Record<number, string> = {};
  const tickerToDate: Record<number, string> = {};
  for (let i = 2; i < indexRows.length; i++) {
    const ticker = indexRows[i][1];
    const url = indexRows[i][4];
    const date = indexRows[i][5];
    if (ticker) {
      tickerToUrl[ticker] = String(url || '');
      tickerToDate[ticker] = String(date || '');
    }
  }

  const tickerToSize: Record<number, number> = {};
  const tickerToType: Record<number, string> = {};
  for (let i = 2; i < dealsRows.length; i++) {
    const ticker = dealsRows[i][0];
    const type = dealsRows[i][2];
    const size = dealsRows[i][9];
    if (ticker) {
      tickerToType[ticker] = String(type || '');
      tickerToSize[ticker] = Number(size) || 0;
    }
  }

  // Get fixable failures (not "Download failed")
  const fixable = results.filter(r =>
    r.success === false &&
    r.error !== 'Download failed'
  );

  // Sort by deal size (largest first)
  fixable.sort((a, b) => (tickerToSize[b.ticker] || 0) - (tickerToSize[a.ticker] || 0));

  console.log('=== REMAINING FIXABLE FAILURES ===\n');
  console.log(`Total: ${fixable.length} deals\n`);

  // Group by error type
  const byError: Record<string, ImportResult[]> = {};
  fixable.forEach(f => {
    const err = f.error || 'Unknown';
    if (!byError[err]) byError[err] = [];
    byError[err].push(f);
  });

  for (const [error, deals] of Object.entries(byError)) {
    console.log(`\n--- ${error} (${deals.length}) ---\n`);
    console.log('Ticker | Company | Date | Size (HKDm) | Type | URL');
    console.log('-------|---------|------|-------------|------|----');

    deals.forEach(d => {
      const date = tickerToDate[d.ticker] || '-';
      const size = tickerToSize[d.ticker] ? tickerToSize[d.ticker].toLocaleString() : '-';
      const type = tickerToType[d.ticker] || '-';
      const url = tickerToUrl[d.ticker] || '-';
      const shortUrl = url.length > 50 ? url.slice(0, 47) + '...' : url;

      console.log(`${d.ticker} | ${d.company.slice(0, 40)} | ${date} | ${size} | ${type.slice(0, 15)} | ${shortUrl}`);
    });
  }

  // Also output as JSON for easier use
  const output = fixable.map(d => ({
    ticker: d.ticker,
    company: d.company,
    error: d.error,
    date: tickerToDate[d.ticker],
    sizeHKDm: tickerToSize[d.ticker],
    type: tickerToType[d.ticker],
    url: tickerToUrl[d.ticker],
  }));

  fs.writeFileSync(
    path.join(__dirname, '../.remaining-failures.json'),
    JSON.stringify(output, null, 2)
  );
  console.log('\n\nSaved to .remaining-failures.json');
}

listFailures().catch(console.error);
