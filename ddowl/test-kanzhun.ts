import axios from 'axios';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

async function test() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0625/2025062500135.pdf';
  console.log('Testing KANZHUN 2025...\n');

  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);

  const extracted = await extractBanksFromProspectus(buffer);
  console.log('Section found:', extracted.sectionFound);
  console.log('Banks found:', extracted.banks.length);

  for (const b of extracted.banks) {
    console.log('  -', b.bankNormalized, '(' + b.roles.join(', ') + ')');
  }

  if (extracted.banks.length === 0 && extracted.rawSectionText) {
    console.log('\nSection preview:');
    console.log(extracted.rawSectionText.slice(0, 1000));
  }
}

test().catch(console.error);
