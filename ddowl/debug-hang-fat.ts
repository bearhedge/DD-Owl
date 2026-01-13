import axios from 'axios';
import { PDFParse } from 'pdf-parse';

async function debug() {
  // Hang Fat Ginseng
  const url = 'https://www1.hkexnews.hk/listedco/listconews/sehk/2014/0617/ltn20140617033.pdf';
  console.log('Debugging Hang Fat Ginseng...\n');

  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(resp.data);
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const allText = result.pages.map(p => p.text).join('\n');

  // Look at context around "Sole Sponsor \t" at 134752
  console.log('=== Context around index 134752 (Sole Sponsor \\t) ===');
  console.log(allText.slice(134600, 135400).replace(/\t/g, '→TAB→'));
  
  // Look at cover page (index 0-2000)
  console.log('\n=== Cover page (first 2000 chars) ===');
  console.log(allText.slice(0, 2000).replace(/\t/g, '→TAB→'));
  
  // Search for "CMB International" which is the bookrunner
  console.log('\n=== Search for CMB International ===');
  let idx = 0;
  while ((idx = allText.indexOf('CMB International', idx)) !== -1) {
    console.log(`Found at ${idx}:`);
    console.log(allText.slice(Math.max(0, idx - 100), idx + 150).replace(/\t/g, '→TAB→'));
    console.log('---');
    idx += 10;
  }
  
  // Look for "PARTIES INVOLVED IN THE GLOBAL OFFERING" actual section (not TOC)
  console.log('\n=== Searching for actual PARTIES INVOLVED section ===');
  const partiesMatches = [...allText.matchAll(/PARTIES INVOLVED IN THE GLOBAL OFFERING/gi)];
  for (const match of partiesMatches) {
    const context = allText.slice(match.index!, match.index! + 2000);
    // Check if this is the actual section (has tabs or role headings followed by bank names)
    const hasTab = context.includes('\t');
    const hasSponsorRole = context.match(/Sole\s+Sponsor\s*[\n\t]/i);
    console.log(`Found at ${match.index}, hasTab: ${hasTab}, hasSponsorRole: ${!!hasSponsorRole}`);
    if (hasTab || hasSponsorRole) {
      console.log('Content:');
      console.log(context.slice(0, 1500).replace(/\t/g, '→TAB→'));
      console.log('---');
    }
  }
}

debug().catch(console.error);
