import { PDFParse } from 'pdf-parse';
import fs from "fs";

async function check(file: string, name: string) {
  const buffer = fs.readFileSync(file);
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const text = result.pages.map((p: any) => p.text).join("\n");
  
  console.log("=== " + name + " ===");
  console.log("Total pages:", result.pages.length);
  
  const partiesMatch = text.match(/parties\s+involved/gi);
  console.log("Found 'Parties Involved':", partiesMatch ? partiesMatch.length + " times" : "NO");
  
  const sponsorMatch = text.match(/sole\s+sponsor|joint\s+sponsor/gi);
  console.log("Found Sponsor mentions:", sponsorMatch ? sponsorMatch.length : "NO");
  
  const idx = text.toLowerCase().indexOf("parties involved");
  if (idx > -1) {
    console.log("\nSnippet:");
    console.log(text.slice(idx, idx + 800));
  } else {
    console.log("\nNo 'Parties Involved' found. Searching for 'Sponsor'...");
    const sidx = text.toLowerCase().indexOf("sponsor");
    if (sidx > -1) {
      console.log(text.slice(Math.max(0, sidx - 100), sidx + 500));
    }
  }
}

async function main() {
  await check("/tmp/imax.pdf", "IMAX (1970)");
  console.log("\n\n");
  await check("/tmp/kanzhun.pdf", "KANZHUN (2076)");
}

main();
