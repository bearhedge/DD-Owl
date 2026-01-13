import axios from 'axios';
import { PDFParse } from 'pdf-parse';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

async function test() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/0606/ltn20180606051.pdf';
  console.log('Testing Country Garden Services (6098)...\n');

  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);

  // Get raw text for debugging
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  // Search for Goldman
  console.log('=== Search for Goldman in PDF ===');
  let idx = 0;
  while ((idx = allText.indexOf('Goldman', idx)) !== -1) {
    console.log('Found at', idx + ':', allText.slice(idx, idx + 100).replace(/\n/g, '\\n'));
    idx += 10;
  }

  // Run extractor
  const extracted = await extractBanksFromProspectus(buffer);
  console.log('\n=== Extractor result ===');
  console.log('Section found:', extracted.sectionFound);
  console.log('Banks found:', extracted.banks.length);

  for (const b of extracted.banks) {
    console.log('  -', b.bankNormalized, '(' + b.roles.join(', ') + ')');
  }

  if (extracted.rawSectionText) {
    console.log('\n=== Section text (first 2000 chars) ===');
    console.log(extracted.rawSectionText.slice(0, 2000));
  }
}

test().catch(console.error);
