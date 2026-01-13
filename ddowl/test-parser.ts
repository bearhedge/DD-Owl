import axios from 'axios';
import { PDFParse } from 'pdf-parse';
import { isLikelyBank, normalizeBankName } from './src/bank-normalizer.js';

async function test() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2015/1203/ltn20151203011.pdf';
  console.log('Downloading Modern Dental (3600)...');
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const textResult = await parser.getText();

  const allText = textResult.pages.map(p => p.text).join('\n');

  // Find the Parties Involved section - copied from prospectus-parser.ts
  const sectionPatterns = [
    /OTHER PARTIES INVOLVED IN THE (?:GLOBAL )?OFFERING\s*\n([\s\S]+?)(?=\nLegal Adviser|\nOur Legal Adviser|\nAuditor|\nCORPORATE INFORMATION|$)/i,
    /PARTIES INVOLVED IN THE (?:GLOBAL )?OFFERING\s*\n([\s\S]+?)(?=\nCORPORATE INFORMATION|\nHISTORY AND|\nDIRECTORS AND SENIOR|$)/i,
    /DIRECTORS AND PARTIES INVOLVED IN THE (?:GLOBAL )?OFFERING\s*\n([\s\S]+?)(?=\nCORPORATE INFORMATION|\nHISTORY AND|$)/i,
  ];

  for (const pattern of sectionPatterns) {
    const matches = [...allText.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))];
    for (const match of matches) {
      if (match && match[1]) {
        const content = match[1];
        const hasTabFormat = content.match(/Sponsors?\s*\t/i);
        const hasBankContent = content.match(/Limited|Securities.*Limited|Capital.*Limited|Bank.*Limited/i) && content.length > 500;

        console.log('\n=== Pattern match found ===');
        console.log('Index:', match.index);
        console.log('Content length:', content.length);
        console.log('Has tab format:', !!hasTabFormat);
        console.log('Has bank content:', !!hasBankContent);
        console.log('First 1000 chars:', content.substring(0, 1000));
      }
    }
  }

  // Find the Sponsor sub-section within the content
  const sponsorIdx = allText.indexOf('Sole Sponsor');
  if (sponsorIdx >= 0) {
    console.log('\n=== Sole Sponsor location ===');
    console.log('Index:', sponsorIdx);
    console.log('Context (2000 chars):');
    console.log(allText.substring(sponsorIdx, sponsorIdx + 2000));
  }

  // Test bank name extraction
  console.log('\n=== Testing bank name extraction ===');
  const testNames = [
    'Deutsche Securities Asia Limited',
    'Deutsche Bank AG, Hong Kong Branch',
    'CIMB Securities Limited',
    'Mizuho Securities Asia Limited',
    'ING Bank N.V.',
  ];

  for (const name of testNames) {
    const isBank = isLikelyBank(name);
    const normalized = normalizeBankName(name);
    console.log(`${name}: isBank=${isBank}, normalized=${normalized.canonical}`);
  }
}

test().catch(console.error);
