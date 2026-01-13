import axios from 'axios';
import { PDFParse } from 'pdf-parse';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

const urls = [
  { url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2022/1216/2022121600138.pdf', note: 'User provided URL 1' },
  { url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2014/0617/ltn20140617033.pdf', note: 'Hang Fat Ginseng (911)' },
  { url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/0606/ltn20180606051.pdf', note: 'Country Garden (6098)' },
  { url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0625/2025062500135.pdf', note: 'KANZHUN (2076)' },
];

async function test() {
  for (const { url, note } of urls) {
    console.log('\n' + '='.repeat(80));
    console.log(note);
    console.log(url);
    console.log('='.repeat(80));

    try {
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
      const buffer = Buffer.from(resp.data);

      // Check if HTML
      const text = buffer.toString('utf8', 0, 500);
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        console.log('ERROR: Got HTML page, not PDF');
        continue;
      }

      // Get company name from first page
      const parser = new PDFParse(new Uint8Array(buffer));
      const result = await parser.getText();
      const allText = result.pages.map(p => p.text).join('\n');
      
      // Try to extract company name
      const companyMatch = allText.slice(0, 3000).match(/([A-Z][A-Za-z\s&\(\)]+(?:Holdings|Group|Company|Corporation|Limited))/);
      console.log('Company hint:', companyMatch ? companyMatch[1].trim() : 'Unknown');

      // Run extractor
      const extracted = await extractBanksFromProspectus(buffer);
      console.log('\nExtractor result:');
      console.log('  Section found:', extracted.sectionFound);
      console.log('  Banks found:', extracted.banks.length);

      if (extracted.banks.length > 0) {
        for (const b of extracted.banks) {
          console.log('    -', b.bankNormalized, '(' + b.roles.join(', ') + ')');
        }
      } else if (extracted.rawSectionText) {
        console.log('  Section preview:', extracted.rawSectionText.slice(0, 400).replace(/\n/g, '\\n'));
      }

    } catch (err: any) {
      console.log('ERROR:', err.message);
    }
  }
}

test().catch(console.error);
