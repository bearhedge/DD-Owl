import { PDFParse } from 'pdf-parse';
import fs from "fs";

async function main() {
  const buffer = fs.readFileSync("/tmp/kanzhun.pdf");
  const parser = new PDFParse(new Uint8Array(buffer));
  const result = await parser.getText();
  const text = result.pages.map((p: any) => p.text).join("\n");
  
  // Find "Directors and Parties Involved in the Introduction" section
  const idx = text.indexOf("DIRECTORS AND PARTIES INVOLVED IN THE INTRODUCTION");
  if (idx > -1) {
    console.log("=== DIRECTORS AND PARTIES INVOLVED ===\n");
    console.log(text.slice(idx, idx + 4000));
  } else {
    // Try lowercase
    const idx2 = text.toLowerCase().indexOf("directors and parties involved");
    if (idx2 > -1) {
      console.log("=== Found at", idx2, "===\n");
      console.log(text.slice(idx2, idx2 + 4000));
    }
  }
}

main();
