import { PDFParse } from 'pdf-parse';
import fs from 'fs';
import axios from 'axios';

async function checkPDF(ticker: number, url: string) {
  console.log(`\n=== Checking ${ticker} for 9F Prime ===`);
  
  let buffer: Buffer;
  const cacheFile = `/tmp/test${ticker}.pdf`;
  
  if (fs.existsSync(cacheFile)) {
    buffer = fs.readFileSync(cacheFile);
  } else {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    buffer = Buffer.from(response.data);
    fs.writeFileSync(cacheFile, buffer);
  }
  
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();
  const text = result.pages.map(p => p.text).join('\n');
  
  // Search for 9F
  const match9f = text.match(/.{0,50}9F.{0,100}/gi);
  if (match9f) {
    console.log('Found 9F mentions:');
    match9f.slice(0, 5).forEach(m => console.log(`  "${m.trim()}"`));
  } else {
    console.log('9F NOT found in PDF');
  }
}

async function main() {
  await checkPDF(3978, 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/1212/ltn20181212009.pdf');
  await checkPDF(1845, 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/1219/ltn20181219009.pdf');
}
main();
