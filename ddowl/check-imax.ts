import { PDFParse } from 'pdf-parse';
import fs from "fs";

async function main() {
  const buffer = fs.readFileSync("/tmp/imax.pdf");
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const text = result.pages.map((p: any) => p.text).join("\n");
  
  // Find the actual Parties section (not the table of contents reference)
  const matches = [...text.matchAll(/parties\s+involved\s+in\s+the\s+global\s+offering/gi)];
  console.log("Found", matches.length, "matches\n");
  
  for (let i = 0; i < matches.length; i++) {
    const idx = matches[i].index!;
    console.log("=== MATCH", i+1, "at position", idx, "===");
    console.log(text.slice(idx, idx + 1500));
    console.log("\n---\n");
  }
}

main();
