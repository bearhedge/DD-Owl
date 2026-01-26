import { extractBanksFromProspectus } from './src/prospectus-parser.js';
import fs from 'fs';

async function main() {
  const buffer = fs.readFileSync('/tmp/test2540.pdf');
  const result = await extractBanksFromProspectus(buffer);
  
  // Read results file
  const resultsFile = '.listed-import-results-mainBoard.json';
  let results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  
  // Find ALL indices for ticker 2540 and update them all
  let count = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i].ticker === 2540) {
      results[i].banks = result.banks.map(b => ({
        name: b.bank,
        normalized: b.bankNormalized,
        rawRole: b.rawRole,
      }));
      results[i].banksFound = result.banks.length;
      count++;
    }
  }
  
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`Updated ${count} entries for ticker 2540 with ${result.banks.length} banks`);
  console.log('Including:', result.banks.map(b => b.bank).filter(n => n.includes('Long')));
}
main();
