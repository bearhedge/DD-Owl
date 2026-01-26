const fs = require('fs');
const xlsx = require('xlsx');

const results = JSON.parse(fs.readFileSync('.listed-import-results-mainBoard.json', 'utf8'));
const downloadFailed = results.filter(r => r.error === 'Download failed');

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

console.log('=== DOWNLOAD FAILURES - URL CHECK ===\n');

const hasUrl = [];
const noUrl = [];

downloadFailed.forEach(f => {
  const url = tickerToUrl[f.ticker];
  if (url && url.startsWith('http')) {
    hasUrl.push({ ticker: f.ticker, company: f.company, url: url });
  } else {
    noUrl.push({ ticker: f.ticker, company: f.company, url: url || 'MISSING' });
  }
});

console.log('Has valid URL but download failed: ' + hasUrl.length);
hasUrl.slice(0, 10).forEach(d => {
  console.log('  ' + d.ticker + ': ' + d.company);
  console.log('    URL: ' + d.url.slice(0, 70) + '...');
});
if (hasUrl.length > 10) console.log('  ... and ' + (hasUrl.length - 10) + ' more\n');

console.log('\nNo URL or invalid URL: ' + noUrl.length);
noUrl.forEach(d => {
  console.log('  ' + d.ticker + ': ' + d.company + ' [' + d.url + ']');
});
