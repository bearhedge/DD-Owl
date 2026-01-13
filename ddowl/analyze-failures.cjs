const fs = require('fs');
const results = JSON.parse(fs.readFileSync('.historical-import-results.json', 'utf8'));

// Categorize failures
const failures = results.filter(r => r.success === false);
const byReason = {};

failures.forEach(f => {
  const reason = f.error || 'Unknown';
  if (byReason[reason] === undefined) byReason[reason] = [];
  byReason[reason].push({ ticker: f.ticker, company: f.company });
});

console.log('=== FAILURE BREAKDOWN ===\n');
for (const [reason, deals] of Object.entries(byReason)) {
  console.log(reason + ': ' + deals.length + ' deals');
}

console.log('\n=== SAMPLE FAILURES BY CATEGORY ===\n');
for (const [reason, deals] of Object.entries(byReason)) {
  console.log('--- ' + reason + ' (' + deals.length + ') ---');
  deals.slice(0, 8).forEach(d => console.log('  ' + d.ticker + ': ' + d.company));
  if (deals.length > 8) console.log('  ... and ' + (deals.length - 8) + ' more');
  console.log('');
}
