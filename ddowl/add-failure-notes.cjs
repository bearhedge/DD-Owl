const fs = require('fs');
const results = JSON.parse(fs.readFileSync('.historical-import-results.json', 'utf8'));

// Add notes to failures
const updated = results.map(r => {
  if (r.success === false) {
    let note = '';
    if (r.error === 'Download failed') {
      note = 'Source unavailable - likely privatized, delisted, or acquired';
    } else if (r.error === 'Invalid PDF') {
      note = 'HTML redirect page - needs manual PDF link extraction (recoverable)';
    } else if (r.error === 'No banks found in section') {
      note = 'Section found but parser could not extract banks (recoverable with parser fix)';
    } else if (r.error === 'Parties Involved section not found') {
      note = 'Different prospectus format - section title variation (recoverable with parser fix)';
    }
    return { ...r, note };
  }
  return r;
});

fs.writeFileSync('.historical-import-results.json', JSON.stringify(updated, null, 2));

// Summary
const failures = updated.filter(r => r.success === false);
console.log('Updated ' + failures.length + ' failed entries with notes');
console.log('');
console.log('Breakdown:');
const byError = {};
failures.forEach(f => {
  if (!byError[f.error]) byError[f.error] = 0;
  byError[f.error]++;
});
for (const [err, count] of Object.entries(byError)) {
  console.log('  ' + err + ': ' + count);
}
