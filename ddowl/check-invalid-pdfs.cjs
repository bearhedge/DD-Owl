const fs = require('fs');
const xlsx = require('xlsx');

const results = JSON.parse(fs.readFileSync('.listed-import-results-mainBoard.json', 'utf8'));
const invalidPdf = results.filter(r => r.error === 'Invalid PDF');

// Read Excel to get URLs
const wb = xlsx.readFile('../Reference files/Main Board/Listed/HKEX_IPO_Listed.xlsx');
const sheet = wb.Sheets['Index'];
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

// Build ticker to URL map
const tickerToUrl = {};
for (let i = 2; i < rows.length; i++) {
  const ticker = rows[i][1];
  const url = rows[i][4];
  if (ticker) tickerToUrl[ticker] = url;
}

console.log('=== INVALID PDF - URL CHECK ===\n');

invalidPdf.forEach(f => {
  const url = tickerToUrl[f.ticker];
  console.log(f.ticker + ': ' + f.company);
  console.log('  URL: ' + (url || 'MISSING'));
  console.log('');
});
