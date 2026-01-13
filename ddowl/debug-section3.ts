import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function findSection() {
  const buffer = fs.readFileSync('/tmp/jiashili.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();

  const allText = result.pages.map(p => p.text).join('\n');

  // Search for sponsor-related patterns
  const patterns = [
    /Sole Global Coordinator.*?Limited/gis,
    /Industrial Securities/gi,
    /First Shanghai/gi,
    /Sponsor\s*\n/gi,
    /Bookrunner\s*\n/gi,
  ];

  for (const regex of patterns) {
    let match;
    let count = 0;
    while ((match = regex.exec(allText)) !== null && count < 3) {
      const context = allText.substring(Math.max(0, match.index - 100), match.index + 300);
      console.log(`\n=== Found "${regex.source.slice(0,30)}..." at position ${match.index} ===`);
      console.log(context.replace(/\n/g, '\\n'));
      count++;
    }
    regex.lastIndex = 0;
  }
}

findSection().catch(console.error);
