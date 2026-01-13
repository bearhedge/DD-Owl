import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function findSection() {
  const buffer = fs.readFileSync('/tmp/imax.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();

  const allText = result.pages.map(p => p.text).join('\n');

  // Search for sponsor/coordinator patterns
  const patterns = [
    /Global Coordinator.*?Limited/gis,
    /Sole Sponsor.*?Limited/gis,
    /Credit Suisse/gi,
    /Goldman Sachs/gi,
    /Morgan Stanley/gi,
    /BOCI/gi,
  ];

  for (const regex of patterns) {
    let match;
    let count = 0;
    while ((match = regex.exec(allText)) !== null && count < 3) {
      const context = allText.substring(Math.max(0, match.index - 50), match.index + 200);
      console.log(`\n=== Found "${regex.source.slice(0,30)}..." at position ${match.index} ===`);
      console.log(context.replace(/\n/g, '\\n'));
      count++;
    }
    regex.lastIndex = 0;
  }
}

findSection().catch(console.error);
