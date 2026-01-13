import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function main() {
  const buffer = fs.readFileSync('/tmp/test-url.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  // Find stock code
  const patterns = [
    /Stock Code[:\s]+(\d{4,5})/gi,
    /股份代號[:\s]+(\d{4,5})/gi,
    /Code[:\s]+(\d{4,5})/gi,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(allText)) !== null) {
      console.log('Found stock code:', match[1], 'at position', match.index);
      break;
    }
    regex.lastIndex = 0;
  }

  // Also look for company name in first 2000 chars
  console.log('\nFirst 500 chars:');
  console.log(allText.slice(0, 500));
}

main();
