import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function findSection() {
  const buffer = fs.readFileSync('/tmp/jiashili.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();

  const allText = result.pages.map(p => p.text).join('\n');

  // Use the EXACT regex from the parser
  const regex = /(?:DIRECTORS AND )?PARTIES INVOLVED IN THE (?:GLOBAL )?OFFERING/gi;
  let match;

  while ((match = regex.exec(allText)) !== null) {
    const index = match.index;
    const contextAfter = allText.substring(index, index + 500);

    console.log(`\n=== Found at position ${index} ===`);
    console.log('Match:', match[0]);

    // Check TOC
    const isTOC = contextAfter.match(/\.\s*\.\s*\.\s*\d+/) || contextAfter.match(/^\S+\s+\.\s+\./);
    console.log('Is TOC entry:', !!isTOC);

    // Check role heading - EXACTLY as parser does
    const hasRoleHeading = contextAfter.match(/(Sole|Joint)\s+(Sponsors?|Bookrunners?|Coordinators?|Global\s+Coordinators?)/i);
    console.log('Has role heading:', !!hasRoleHeading);
    if (hasRoleHeading) {
      console.log('Role found:', hasRoleHeading[0]);
    }

    console.log('\nContext (first 500 chars):');
    console.log(contextAfter.replace(/\n/g, '\\n'));
  }
}

findSection().catch(console.error);
