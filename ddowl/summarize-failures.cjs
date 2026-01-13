const fs = require('fs');
const xlsx = require('xlsx');

const results = JSON.parse(fs.readFileSync('.historical-import-results.json', 'utf8'));

// Read Excel to get URLs
const wb = xlsx.readFile('../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');
const sheet = wb.Sheets['Index'];
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

// Build ticker to URL map
const tickerToUrl = {};
for (let i = 2; i < rows.length; i++) {
  const ticker = rows[i][1];
  const url = rows[i][4];
  if (ticker) tickerToUrl[ticker] = url;
}

// Analyze download failures
const downloadFailed = results.filter(r => r.error === 'Download failed');
let noUrl = 0;
let hasUrl = 0;
downloadFailed.forEach(f => {
  const url = tickerToUrl[f.ticker];
  if (url && String(url).startsWith('http')) hasUrl++;
  else noUrl++;
});

console.log('=== FINAL FAILURE SUMMARY ===\n');
console.log('Total failures: ' + results.filter(r => r.success === false).length);
console.log('');
console.log('Download failed: ' + downloadFailed.length);
console.log('  - No URL in Excel: ' + noUrl + ' (not fixable)');
console.log('  - Has URL but failed: ' + hasUrl + ' (retryable)');
console.log('');

const noBanks = results.filter(r => r.error === 'No banks found in section').length;
const invalidPdf = results.filter(r => r.error === 'Invalid PDF').length;
const noSection = results.filter(r => r.error === 'Parties Involved section not found').length;

console.log('No banks found in section: ' + noBanks + ' (parser fixable)');
console.log('Invalid PDF (HTML pages): ' + invalidPdf + ' (HTML->PDF redirect fixable)');
console.log('Section not found: ' + noSection + ' (format variation fixable)');
console.log('');
console.log('=== POTENTIALLY RECOVERABLE ===');
console.log('Parser fixes: ' + (noBanks + noSection));
console.log('HTML redirect fixes: ' + invalidPdf);
console.log('Retry with URL: ' + hasUrl);
console.log('TOTAL RECOVERABLE: ' + (noBanks + noSection + invalidPdf + hasUrl));
console.log('');
console.log('NOT RECOVERABLE (no source): ' + noUrl);
