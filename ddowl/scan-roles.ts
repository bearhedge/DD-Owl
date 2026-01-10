/**
 * Scan PDFs to discover all role variations
 */

import { PDFParse } from 'pdf-parse';
import * as fs from 'fs';
import * as https from 'https';

async function downloadPdf(url: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
    }).on('error', () => resolve(false));
  });
}

async function extractRolesFromPdf(pdfPath: string): Promise<string[]> {
  const buffer = fs.readFileSync(pdfPath);
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  const result = await parser.getText();

  const allText = result.pages.map(p => p.text).join('\n');

  const rolePatterns: string[] = [];

  // Pattern 1: "has appointed X as [role]"
  const appointedMatches = allText.matchAll(/has\s+appointed\s+[\s\S]+?as\s+(?:its?\s+)?(?:the\s+)?((?:sole\s+|joint\s+)?(?:global\s+)?(?:overall\s+)?(?:sponsor|coordinator|co-ordinator|bookrunner|lead\s*manager)(?:\s+and\s+(?:overall\s+)?(?:coordinator|sponsor))?)/gi);
  for (const match of appointedMatches) {
    rolePatterns.push(match[1].trim());
  }

  // Pattern 2: Role headings like "Overall Coordinator" followed by bank names
  const headingMatches = allText.matchAll(/^((?:Joint\s+)?(?:Sole\s+)?(?:Global\s+)?(?:Overall\s+)?(?:Sponsor|Coordinator|Co-ordinator|Bookrunner|Lead\s*Manager)(?:s)?(?:\s+and\s+(?:Overall\s+)?(?:Coordinator|Sponsor))?)\s*$/gim);
  for (const match of headingMatches) {
    rolePatterns.push(match[1].trim());
  }

  return [...new Set(rolePatterns)];
}

async function main() {
  // Sample PDFs from the database
  const pdfUrls = [
    'https://www1.hkexnews.hk/app/sehk/2025/108018/documents/sehk25123102450.pdf', // Beijing Roborock
    'https://www1.hkexnews.hk/app/sehk/2025/108017/documents/sehk25123102766.pdf', // Coosea
    'https://www1.hkexnews.hk/app/sehk/2025/108020/documents/sehk25123102768.pdf', // Suzhou ecMAX
    'https://www1.hkexnews.hk/app/sehk/2025/107664/documents/sehk25082903701.pdf', // Baige
  ];

  const allRoles = new Set<string>();

  for (let i = 0; i < pdfUrls.length; i++) {
    const url = pdfUrls[i];
    const tempPath = `/tmp/scan_pdf_${i}.pdf`;

    console.log(`\nDownloading: ${url}`);
    await downloadPdf(url, tempPath);

    if (fs.existsSync(tempPath)) {
      const roles = await extractRolesFromPdf(tempPath);
      console.log(`Found roles:`);
      roles.forEach(r => {
        console.log(`  - "${r}"`);
        allRoles.add(r.toLowerCase());
      });
      fs.unlinkSync(tempPath);
    }
  }

  console.log('\n=== ALL UNIQUE ROLES ===');
  [...allRoles].sort().forEach(r => console.log(`"${r}"`));
}

main().catch(console.error);
