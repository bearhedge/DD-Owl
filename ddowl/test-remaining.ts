import axios from 'axios';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';
import { PDFParse } from 'pdf-parse';

const tests = [
  { ticker: 6098, company: 'Country Garden Services', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/0606/ltn20180606051.pdf' },
  { ticker: 1933, company: 'OneForce Holdings', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/0212/ltn20180212037.pdf' },
];

async function test() {
  for (const t of tests) {
    console.log('\n' + '='.repeat(60));
    console.log(t.ticker + ' - ' + t.company);
    console.log('='.repeat(60));

    const resp = await axios.get(t.url, { responseType: 'arraybuffer', timeout: 120000 });
    const buffer = Buffer.from(resp.data);

    const extracted = await extractBanksFromProspectus(buffer);
    console.log('Section found:', extracted.sectionFound);
    console.log('Banks found:', extracted.banks.length);

    for (const b of extracted.banks) {
      console.log('  -', b.bankNormalized, '(' + b.roles.join(', ') + ')');
    }

    if (extracted.banks.length === 0) {
      // Debug: look for sponsor patterns
      const parser = new PDFParse(new Uint8Array(buffer));
      const result = await parser.getText();
      const allText = result.pages.map(p => p.text).join('\n');
      
      console.log('\nDEBUG - Searching for sponsor patterns...');
      const patterns = ['Sole Sponsor', 'Joint Sponsor', 'PARTIES INVOLVED'];
      for (const p of patterns) {
        const idx = allText.indexOf(p);
        if (idx !== -1) {
          console.log(p + ' at ' + idx + ':');
          console.log(allText.slice(idx, idx + 400).replace(/\t/g, '→TAB→').replace(/\n/g, '\\n'));
        }
      }
      
      if (extracted.rawSectionText) {
        console.log('\nSection extracted:');
        console.log(extracted.rawSectionText.slice(0, 500));
      }
    }
  }
}

test().catch(console.error);
