import axios from 'axios';
import { PDFParse } from 'pdf-parse';

async function debug() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2022/1216/2022121600138.pdf';
  console.log('KANZHUN 2022 document...\n');

  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  // Find PARTIES INVOLVED
  let idx = allText.indexOf('PARTIES INVOLVED');
  while (idx !== -1) {
    console.log('Found at ' + idx + ':');
    console.log(allText.slice(idx, idx + 1000).replace(/\t/g, '→TAB→'));
    console.log('---\n');
    idx = allText.indexOf('PARTIES INVOLVED', idx + 20);
  }
}

debug().catch(console.error);
