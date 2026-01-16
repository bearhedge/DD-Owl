import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function main() {
  const buffer = fs.readFileSync('/tmp/test2540.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();
  const text = result.pages.map(p => p.text).join('\n');
  
  // Find actual Parties section (not TOC)
  const allMatches = [...text.matchAll(/PARTIES INVOLVED/gi)];
  console.log('Found', allMatches.length, 'mentions of PARTIES INVOLVED');
  
  for (let i = 0; i < allMatches.length; i++) {
    const idx = allMatches[i].index!;
    const context = text.slice(idx, idx + 500);
    // Skip TOC entries (have dots and page numbers)
    if (context.match(/\.\s*\.\s*\.\s*\d+/)) {
      console.log(`\n[${i}] TOC entry - skipping`);
      continue;
    }
    console.log(`\n[${i}] ACTUAL SECTION:`);
    console.log(text.slice(idx, idx + 1500));
  }
}
main();
