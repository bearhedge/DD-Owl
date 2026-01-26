import fs from 'fs';

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  banks?: Array<{ name: string; roles: string[] }>;
}

const results: ImportResult[] = JSON.parse(fs.readFileSync('.listed-import-results-mainBoard.json', 'utf8'));

console.log('=== Historical Import Results ===');
console.log('Total deals processed:', results.length);

const successful = results.filter(r => r.success);
const failed = results.filter(r => r.success === false);

console.log('Successful:', successful.length);
console.log('Failed:', failed.length);
console.log('Success rate:', (successful.length / results.length * 100).toFixed(1) + '%');

// Group failures by error type
const errorGroups: Record<string, number> = {};
for (const f of failed) {
  const err = f.error || 'Unknown';
  errorGroups[err] = (errorGroups[err] || 0) + 1;
}

console.log('\n=== Failure Breakdown ===');
const sortedErrors = Object.entries(errorGroups).sort((a, b) => b[1] - a[1]);
for (const [err, count] of sortedErrors) {
  console.log(`${count} - ${err}`);
}

// List specific failures
console.log('\n=== Failed Deals ===');
for (const f of failed) {
  console.log(`${f.ticker} - ${f.company} [${f.error}]`);
}
