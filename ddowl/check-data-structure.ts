import fs from 'fs';

const results = JSON.parse(fs.readFileSync('.historical-import-results.json', 'utf8'));

// Find first working deal and first undefined deal
const working = results.find((r: any) => r.success && r.banks?.[0]?.normalized && r.banks[0].normalized !== 'undefined');
const broken = results.find((r: any) => r.success && r.banks?.[0]?.normalized === undefined);

console.log('=== WORKING DEAL ===');
if (working) {
  console.log(`Ticker: ${working.ticker}`);
  console.log('First bank structure:', JSON.stringify(working.banks[0], null, 2));
}

console.log('\n=== BROKEN DEAL ===');
if (broken) {
  console.log(`Ticker: ${broken.ticker}`);
  console.log('First bank structure:', JSON.stringify(broken.banks[0], null, 2));
}

// Count how many deals have undefined banks
let undefinedDeals = 0;
let workingDeals = 0;

for (const r of results) {
  if (r.success && r.banks && r.banks.length > 0) {
    if (r.banks[0].normalized === undefined || r.banks[0].normalized === 'undefined') {
      undefinedDeals++;
    } else {
      workingDeals++;
    }
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Deals with proper bank data: ${workingDeals}`);
console.log(`Deals with undefined bank data: ${undefinedDeals}`);
