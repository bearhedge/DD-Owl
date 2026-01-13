import axios from 'axios';
import { PDFParse } from 'pdf-parse';

async function debug() {
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2014/0617/ltn20140617033.pdf';
  console.log('Debugging Hang Fat Ginseng section detection...\n');

  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  // Find ALL occurrences of "PARTIES INVOLVED"
  console.log('=== All "PARTIES INVOLVED" occurrences ===');
  let idx = 0;
  let count = 0;
  while ((idx = allText.indexOf('PARTIES INVOLVED', idx)) !== -1) {
    count++;
    const context = allText.slice(idx, idx + 600);
    const hasTab = context.includes('\t');
    const hasCoordinator = context.match(/Coordinator/i);
    console.log(`\n[${count}] Found at index ${idx}:`);
    console.log(`Has tab: ${hasTab}, Has Coordinator: ${!!hasCoordinator}`);
    console.log(context.slice(0, 500).replace(/\t/g, '→TAB→').replace(/\n/g, '\\n'));
    idx += 10;
  }
  
  // The correct section is at index 134664 based on earlier debug
  console.log('\n\n=== Content around index 134600 (correct section) ===');
  console.log(allText.slice(134600, 135500).replace(/\t/g, '→TAB→'));
}

debug().catch(console.error);
