import axios from 'axios';
import { PDFParse } from 'pdf-parse';

async function test() {
  // Modern Dental (3600)
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2015/1203/ltn20151203011.pdf';
  console.log('Downloading Modern Dental (3600)...');
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);

  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const textResult = await parser.getText();

  // Join all page texts
  let text = '';
  if (textResult && textResult.pages) {
    for (const page of textResult.pages) {
      text += page.text + '\n';
    }
  }
  console.log('Total text length:', text.length);

  // Find the actual section (skip TOC entries by looking for the one with substantial content)
  const pattern = /(?:DIRECTORS\s+AND\s+)?PARTIES\s+INVOLVED\s+IN\s+THE\s+(?:GLOBAL\s+)?OFFERING/gi;
  let match;
  let lastMatch = null;
  while ((match = pattern.exec(text)) !== null) {
    // Get a larger chunk to see if this is the actual section (not TOC)
    const preview = text.substring(match.index, match.index + 500);
    // TOC entries have lots of dots (...) while actual sections have real content
    if (!preview.includes('...........')) {
      lastMatch = match;
    }
  }

  if (lastMatch) {
    // Now look for Sponsor/bank info starting from this section
    const sectionStart = lastMatch.index;
    const sectionText = text.substring(sectionStart, sectionStart + 20000);

    // Find "Sponsor" or "Joint Sponsors" or "Sole Sponsor"
    const sponsorMatch = sectionText.match(/(?:SOLE\s+)?(?:JOINT\s+)?SPONSORS?/i);
    if (sponsorMatch) {
      const sponsorIndex = sectionStart + sponsorMatch.index!;
      console.log('Found Sponsor section at index:', sponsorIndex);
      console.log('Preview (5000 chars after Sponsor):');
      console.log(text.substring(sponsorIndex, sponsorIndex + 5000));
    } else {
      console.log('Section found but no Sponsor keyword');
      console.log('Section preview (5000 chars):');
      console.log(sectionText.substring(0, 5000));
    }
  } else {
    console.log('Section not found');
  }
}
test().catch(console.error);
