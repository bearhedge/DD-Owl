import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function findSection() {
  const buffer = fs.readFileSync('/tmp/pingan.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();

  const allText = result.pages.map(p => p.text).join('\n');

  // Find ALL occurrences of "PARTIES INVOLVED"
  const regex = /PARTIES INVOLVED/gi;
  let match;
  while ((match = regex.exec(allText)) !== null) {
    const context = allText.substring(match.index - 50, match.index + 500);
    console.log('Found at position ' + match.index + ':');
    console.log(context);
    console.log('\n---\n');
  }

  // Also search for "Directors and Parties"
  const regex2 = /Directors.*Parties/gi;
  while ((match = regex2.exec(allText)) !== null) {
    const context = allText.substring(match.index - 50, match.index + 500);
    console.log('Directors+Parties at position ' + match.index + ':');
    console.log(context);
    console.log('\n---\n');
  }
}

findSection().catch(console.error);
