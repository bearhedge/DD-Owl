import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function main() {
  const buffer = fs.readFileSync('/tmp/imax.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  const idx = allText.indexOf('DIRECTORS AND PARTIES INVOLVED');
  if (idx >= 0) {
    console.log('=== Section at position', idx, '===');
    console.log(allText.substring(idx, idx + 2000));
  } else {
    // Try just PARTIES INVOLVED
    const idx2 = allText.indexOf('PARTIES INVOLVED');
    if (idx2 >= 0) {
      console.log('=== PARTIES INVOLVED at position', idx2, '===');
      console.log(allText.substring(idx2, idx2 + 2000));
    }
  }
}
main();
