import axios from 'axios';
import { PDFParse } from 'pdf-parse';

async function debug() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2022/1216/2022121600138.pdf';
  console.log('Debugging URL 1...\n');

  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  // Print first 3000 chars to understand the document
  console.log('=== First 3000 chars ===');
  console.log(allText.slice(0, 3000));

  // Search for company name patterns
  console.log('\n=== Search for stock code ===');
  const stockMatch = allText.match(/Stock\s*Code[:\s]+(\d+)/i);
  console.log('Stock code:', stockMatch ? stockMatch[1] : 'Not found');

  // Search for sponsor pattern
  console.log('\n=== Search for sponsor patterns ===');
  const sponsorIdx = allText.indexOf('Joint Sponsors');
  if (sponsorIdx !== -1) {
    console.log('Found Joint Sponsors at', sponsorIdx);
    console.log(allText.slice(sponsorIdx, sponsorIdx + 500).replace(/\t/g, '→TAB→'));
  }
}

debug().catch(console.error);
