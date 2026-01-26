import fs from 'fs';

interface Bank {
  name: string;
  normalized: string;
  roles: string[];
  isLead: boolean;
  rawRole: string;
}

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  banks?: Bank[];
}

const results: ImportResult[] = JSON.parse(fs.readFileSync('.listed-import-results-mainBoard.json', 'utf8'));

// Check specific tickers mentioned
const tickers = [2146, 9608, 9999, 6623, 2191];

for (const ticker of tickers) {
  const deal = results.find(r => r.ticker === ticker);
  if (deal) {
    console.log(`=== ${ticker} - ${deal.company} ===`);
    console.log(`Banks: ${deal.banksFound}`);
    if (deal.banks) {
      deal.banks.forEach(b => {
        console.log(`  - ${b.normalized} | Full: ${b.name} | Roles: ${b.roles.join(', ')}`);
      });
    }
    console.log('');
  }
}

// Find all undefined/missing banks
console.log('=== UNDEFINED OR MISSING BANK NAMES ===');
let undefinedCount = 0;
for (const r of results) {
  if (r.banks) {
    for (const b of r.banks) {
      const hasIssue = (
        b.normalized === undefined ||
        b.normalized === 'undefined' ||
        b.normalized === '' ||
        b.name === undefined ||
        b.name === ''
      );
      if (hasIssue) {
        console.log(`${r.ticker} - ${r.company}: ${JSON.stringify(b)}`);
        undefinedCount++;
      }
    }
  }
}
console.log(`\nTotal undefined: ${undefinedCount}`);

// Check for "Unknown" normalized names
console.log('\n=== BANKS WITH "Unknown" NORMALIZED NAME ===');
let unknownCount = 0;
for (const r of results) {
  if (r.banks) {
    for (const b of r.banks) {
      if (b.normalized === 'Unknown' || b.normalized?.includes('Unknown')) {
        console.log(`${r.ticker}: ${b.name} -> ${b.normalized}`);
        unknownCount++;
      }
    }
  }
}
console.log(`Total unknown: ${unknownCount}`);
