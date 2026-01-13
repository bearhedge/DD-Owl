import axios from 'axios';
import { PDFParse } from 'pdf-parse';

async function debug() {
  // Ernest Borel - check the actual sponsor section
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2014/0630/ltn20140630123.pdf';
  console.log('Debugging Ernest Borel...\n');

  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);

  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  // Find "Sole Sponsor" with various patterns
  console.log('=== Searching for Sole Sponsor patterns ===\n');

  // Look for all "Sole Sponsor" occurrences
  let idx = 0;
  while ((idx = allText.indexOf('Sole Sponsor', idx)) !== -1) {
    const context = allText.slice(idx, idx + 300);
    const hasTab = context.includes('\t');
    console.log(`Found at ${idx} (has tab: ${hasTab}):`);
    console.log(context.replace(/\t/g, '→TAB→').slice(0, 200));
    console.log('---');
    idx += 10;
  }

  // Try the regex
  console.log('\n=== Testing regex ===');
  const regex = /(?:Joint\s+)?(?:Sole\s+)?Sponsors?\s*\t([A-Z][^\n]+(?:Limited|L\.L\.C\.?))/gi;
  let match;
  while ((match = regex.exec(allText)) !== null) {
    console.log(`Match at ${match.index}: ${match[0].slice(0, 100)}`);
  }
}

debug().catch(console.error);
