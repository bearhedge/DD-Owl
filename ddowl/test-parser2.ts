import axios from 'axios';
import { PDFParse } from 'pdf-parse';

async function test() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2015/1203/ltn20151203011.pdf';
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const textResult = await parser.getText();

  const allText = textResult.pages.map(p => p.text).join('\n');

  // Find all matches of "parties involved" in the text
  console.log('=== Finding all "parties involved" matches ===\n');
  const searchPattern = /parties involved in the (?:global )?offering/gi;
  let searchMatch;
  let count = 0;
  while ((searchMatch = searchPattern.exec(allText)) !== null) {
    count++;
    const context = allText.substring(Math.max(0, searchMatch.index - 100), searchMatch.index + 150);
    console.log(`Match ${count} at index ${searchMatch.index}:`);
    console.log(context.replace(/\n/g, ' ').substring(0, 200));
    console.log('---');
    if (count > 10) break;
  }
}

test().catch(console.error);
