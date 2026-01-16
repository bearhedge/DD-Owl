import { PDFParse } from 'pdf-parse';
import fs from "fs";

async function main() {
  const buffer = fs.readFileSync("/tmp/kanzhun.pdf");
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const text = result.pages.map((p: any) => p.text).join("\n");
  
  // Find parties involved section
  const idx = text.toLowerCase().indexOf("parties involved in the introduction");
  if (idx > -1) {
    console.log("=== PARTIES INVOLVED IN THE INTRODUCTION ===\n");
    console.log(text.slice(idx, idx + 3000));
  }
  
  // Also search for sponsor
  const sidx = text.search(/sole\s+sponsor|joint\s+sponsor/i);
  if (sidx > -1) {
    console.log("\n\n=== SPONSOR SECTION ===\n");
    console.log(text.slice(sidx, sidx + 1000));
  }
}

main();
