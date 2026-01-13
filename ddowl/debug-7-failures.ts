import fs from 'fs';
import axios from 'axios';
import { PDFParse } from 'pdf-parse';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

const failures = [
  { ticker: 6098, company: 'Country Garden Services', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/0606/ltn20180606049.pdf' },
  { ticker: 1856, company: 'Ernest Borel', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2014/0630/ltn20140630123.pdf' },
  { ticker: 911, company: 'Hang Fat Ginseng', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2014/0617/ltn20140617033.pdf' },
  { ticker: 2076, company: 'KANZHUN', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0625/2025062500135.pdf' },
  { ticker: 1933, company: 'OneForce Holdings', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/0212/ltn20180212037.pdf' },
  { ticker: 2489, company: 'Persistence Resources', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2023/1214/2023121400075.pdf' },
  { ticker: 3738, company: 'Vobile Group', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2017/1219/ltn20171219007.pdf' },
];

async function debug() {
  for (const f of failures) {
    console.log('\n' + '='.repeat(80));
    console.log(`${f.ticker} - ${f.company}`);
    console.log('='.repeat(80));
    console.log('URL:', f.url);

    try {
      const resp = await axios.get(f.url, { responseType: 'arraybuffer', timeout: 120000 });
      const buffer = Buffer.from(resp.data);

      // Check if HTML
      const text = buffer.toString('utf8', 0, 500);
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        console.log('ERROR: Got HTML page, not PDF');
        continue;
      }

      // Parse PDF
      const parser = new PDFParse(new Uint8Array(buffer));
      const result = await parser.getText();
      const allText = result.pages.map(p => p.text).join('\n');

      // Search for sponsor patterns
      console.log('\nSearching for sponsor patterns...');

      const patterns = [
        { name: 'Joint Sponsors\\t', regex: /Joint Sponsors?\s*\t/i },
        { name: 'Sole Sponsor\\t', regex: /Sole Sponsor\s*\t/i },
        { name: 'PARTIES INVOLVED', regex: /PARTIES INVOLVED/i },
        { name: 'Sponsor (any)', regex: /(?:Joint |Sole )?Sponsors?(?:\s|$)/i },
      ];

      for (const p of patterns) {
        const match = allText.match(p.regex);
        if (match) {
          console.log(`  Found "${p.name}" at index ${match.index}`);
          console.log(`  Context: ${allText.slice(match.index!, match.index! + 300).replace(/\n/g, '\\n').slice(0, 200)}...`);
        }
      }

      // Run extractor
      const extracted = await extractBanksFromProspectus(buffer);
      console.log('\nExtractor result:');
      console.log('  Section found:', extracted.sectionFound);
      console.log('  Banks found:', extracted.banks.length);

      if (extracted.banks.length > 0) {
        extracted.banks.forEach(b => console.log(`    - ${b.bankNormalized}`));
      } else if (extracted.rawSectionText) {
        console.log('  Section preview:', extracted.rawSectionText.slice(0, 300).replace(/\n/g, '\\n'));
      }

    } catch (err: any) {
      console.log('ERROR:', err.message);
    }
  }
}

debug().catch(console.error);
