/**
 * Test IPO bank extraction
 */
import { extractBankDataFromPdf } from './src/hkex-scraper.js';
import * as fs from 'fs';

async function test(path: string, name: string) {
  console.log('\n' + '='.repeat(50));
  console.log('Testing: ' + name);
  console.log('='.repeat(50));

  const buffer = fs.readFileSync(path);
  const data = await extractBankDataFromPdf(buffer);

  console.log('Banks found: ' + data.banks.length);
  data.banks.forEach(b => {
    console.log('  - ' + b.bank);
    console.log('    Role: ' + b.rawRole);
  });
}

async function main() {
  await test('/tmp/roborock.pdf', 'Beijing Roborock');
  await test('/tmp/ecmax.pdf', 'Suzhou ecMAX');
  await test('/tmp/coosea.pdf', 'Coosea');
  await test('/tmp/hoosun.pdf', 'Hoosun Technology');
}

main().catch(console.error);
