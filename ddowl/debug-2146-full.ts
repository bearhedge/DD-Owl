import axios from 'axios';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

async function debug() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2020/1231/2020123100013.pdf';

  console.log('Downloading PDF...');
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);

  console.log('Extracting banks...');
  const result = await extractBanksFromProspectus(buffer);

  console.log('\n=== RESULT ===');
  console.log('Section found:', result.sectionFound);
  console.log('Banks:', result.banks.length);
  console.log('\nFirst 5 banks:');
  result.banks.slice(0, 5).forEach((b, i) => {
    console.log(`${i}: ${b.rawRole} - ${b.bank}`);
  });

  // Check if sponsor is in the list
  const hasSponsor = result.banks.some(b => b.rawRole.toLowerCase().includes('sponsor'));
  console.log('\nHas sponsor?', hasSponsor);
}

debug().catch(console.error);
