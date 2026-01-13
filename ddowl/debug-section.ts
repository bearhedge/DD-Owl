import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function findSection() {
  const buffer = fs.readFileSync('/tmp/jiashili.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();

  const allText = result.pages.map(p => p.text).join('\n');

  console.log('Total text length:', allText.length);
  console.log('Total pages:', result.pages.length);

  // Search for various patterns
  const patterns = [
    /PARTIES INVOLVED/gi,
    /Directors and Parties/gi,
    /Sole Sponsor/gi,
    /Joint Sponsors/gi,
    /Global Coordinator/gi,
    /Joint Bookrunners/gi,
    /Alliance/gi,
  ];

  for (const regex of patterns) {
    let match;
    let count = 0;
    while ((match = regex.exec(allText)) !== null && count < 2) {
      const context = allText.substring(match.index - 30, match.index + 150);
      console.log(`\n=== Found "${regex.source}" at position ${match.index} ===`);
      console.log(context.replace(/\n/g, '\\n'));
      count++;
    }
    regex.lastIndex = 0;
  }
}

findSection().catch(console.error);
