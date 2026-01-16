import { PDFParse } from 'pdf-parse';
import fs from 'fs';

async function main() {
  const buffer = fs.readFileSync('/tmp/test2540.pdf');
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();
  const text = result.pages.map(p => p.text).join('\n');
  
  // Search for Longbridge
  if (text.toLowerCase().includes('longbridge')) {
    console.log('Found Longbridge in text!');
    const idx = text.toLowerCase().indexOf('longbridge');
    console.log('Context:', text.slice(Math.max(0, idx-100), idx+100));
  } else {
    console.log('Longbridge NOT found in extracted text');
  }
  
  // Search for 9F Prime  
  if (text.toLowerCase().includes('9f prime')) {
    console.log('\nFound 9F Prime in text!');
  } else {
    console.log('9F Prime NOT found in extracted text');
  }
  
  // Show a sample of the Parties section
  const partiesMatch = text.match(/PARTIES INVOLVED[\s\S]{0,3000}/i);
  if (partiesMatch) {
    console.log('\n--- PARTIES SECTION SAMPLE ---');
    console.log(partiesMatch[0].slice(0, 2000));
  }
}
main();
