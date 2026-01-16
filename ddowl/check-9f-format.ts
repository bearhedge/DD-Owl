import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function main() {
  const buffer = fs.readFileSync('/tmp/test3978.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();
  const text = result.pages.map(p => p.text).join('\n');
  
  // Find all 9F mentions with context
  const matches = text.match(/.{0,80}9F.{0,80}/gi);
  if (matches) {
    console.log('9F mentions in 3978:');
    matches.forEach((m, i) => console.log(`[${i}] "${m.trim()}"`));
  }
}
main();
