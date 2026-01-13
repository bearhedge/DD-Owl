import axios from 'axios';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

async function test() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2015/1203/ltn20151203011.pdf';
  console.log('Downloading Modern Dental (3600)...');
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);

  const result = await extractBanksFromProspectus(buffer);
  console.log('Section found:', result.sectionFound);
  console.log('Banks found:', result.banks.length);

  if (result.banks.length > 0) {
    console.log('\nExtracted banks:');
    for (const bank of result.banks) {
      console.log(`- ${bank.bank} (${bank.rawRole}) -> ${bank.bankNormalized}`);
    }
  }

  if (result.rawSectionText) {
    console.log('\nRaw section text (first 2000 chars):');
    console.log(result.rawSectionText.substring(0, 2000));
  }
}

test().catch(console.error);
