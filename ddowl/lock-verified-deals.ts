/**
 * Lock Verified Deals
 * 
 * This script marks deals as verified so they won't be re-extracted.
 * Usage: npx tsx lock-verified-deals.ts <ticker1> <ticker2> ...
 */

import fs from 'fs';

const RESULTS_FILE = '.listed-import-results-mainBoard.json';

function main() {
  const tickers = process.argv.slice(2).map(t => parseInt(t));
  
  if (tickers.length === 0) {
    console.log('Usage: npx tsx lock-verified-deals.ts <ticker1> <ticker2> ...');
    console.log('Example: npx tsx lock-verified-deals.ts 772 6060 1931');
    return;
  }
  
  const results: any[] = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  
  let locked = 0;
  for (const deal of results) {
    if (tickers.includes(deal.ticker)) {
      deal.verified = true;
      deal.verifiedAt = new Date().toISOString();
      console.log(`Locked ticker ${deal.ticker}: ${deal.company}`);
      locked++;
    }
  }
  
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\nLocked ${locked} deals`);
}

main();
