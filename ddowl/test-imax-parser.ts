import { extractBanksFromProspectus } from './src/prospectus-parser.js';
import fs from "fs";

async function main() {
  const buffer = fs.readFileSync("/tmp/imax.pdf");
  const result = await extractBanksFromProspectus(buffer);
  
  console.log("Section found:", result.sectionFound);
  console.log("Banks extracted:", result.banks.length);
  
  if (result.banks.length > 0) {
    console.log("\nBanks:");
    for (const b of result.banks) {
      console.log(" -", b.bank, "(" + b.rawRole + ")");
    }
  }
  
  if (result.rawSectionText) {
    console.log("\n=== RAW SECTION TEXT (first 2000 chars) ===");
    console.log(result.rawSectionText.slice(0, 2000));
  }
}

main();
