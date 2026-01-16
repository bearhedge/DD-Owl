import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function main() {
  const buffer = fs.readFileSync('/tmp/test3978.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();
  const text = result.pages.map(p => p.text).join('\n');
  
  // Find Parties section
  const match = text.match(/PARTIES INVOLVED IN THE GLOBAL OFFERING[\s\S]{0,5000}/i);
  if (match) {
    // Check if 9F is in this section
    if (match[0].includes('9F')) {
      console.log('9F IS in Parties section!');
      const idx = match[0].indexOf('9F');
      console.log('Context:', match[0].slice(Math.max(0, idx-100), idx+200));
    } else {
      console.log('9F is NOT in Parties section');
      console.log('First 1500 chars of section:');
      console.log(match[0].slice(0, 1500));
    }
  }
}
main();
