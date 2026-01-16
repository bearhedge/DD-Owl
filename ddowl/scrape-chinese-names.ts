/**
 * Scrape Chinese company names from prospectus PDFs
 */
import Database from 'better-sqlite3';
import { extractBankDataFromPdf } from './src/hkex-scraper.js';
import * as https from 'https';
import * as fs from 'fs';

async function downloadPdf(url: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location!, (res2) => {
          res2.pipe(file);
          file.on('finish', () => { file.close(); resolve(true); });
        }).on('error', () => resolve(false));
      } else if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(true); });
      } else {
        file.close();
        resolve(false);
      }
    }).on('error', () => resolve(false));
  });
}

async function main() {
  const db = new Database('data/ddowl.db');

  // Get all deals with prospectus URLs but no Chinese name
  const deals = db.prepare(`
    SELECT ticker, company, prospectus_url
    FROM ipo_deals
    WHERE prospectus_url IS NOT NULL
    AND (company_cn IS NULL OR company_cn = '')
    ORDER BY ticker DESC
  `).all() as { ticker: number; company: string; prospectus_url: string }[];

  console.log(`Found ${deals.length} deals without Chinese names`);

  let processed = 0;
  let found = 0;
  let errors = 0;

  for (const deal of deals) {
    const tempPath = `/tmp/scrape_${deal.ticker}.pdf`;

    try {
      console.log(`[${++processed}/${deals.length}] Processing ${deal.ticker} ${deal.company}...`);

      // Download PDF
      const success = await downloadPdf(deal.prospectus_url, tempPath);
      if (!success) {
        console.log(`  Failed to download PDF`);
        errors++;
        continue;
      }

      // Read and validate PDF
      const buffer = fs.readFileSync(tempPath);
      if (buffer.length < 100 || !buffer.toString('utf8', 0, 10).includes('%PDF')) {
        console.log(`  Invalid PDF (${buffer.length} bytes)`);
        errors++;
        continue;
      }

      // Extract Chinese name
      const result = await extractBankDataFromPdf(buffer);

      if (result.companyChineseName) {
        db.prepare('UPDATE ipo_deals SET company_cn = ? WHERE ticker = ?')
          .run(result.companyChineseName, deal.ticker);
        console.log(`  Found: ${result.companyChineseName}`);
        found++;
      } else {
        console.log(`  No Chinese name found`);
      }

      // Clean up temp file
      fs.unlinkSync(tempPath);

      // Small delay to be nice to HKEX servers
      await new Promise(r => setTimeout(r, 300));

    } catch (err: any) {
      console.error(`  Error: ${err.message}`);
      errors++;
      // Clean up temp file on error
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }

    // Progress update every 50
    if (processed % 50 === 0) {
      console.log(`\n--- Progress: ${processed}/${deals.length}, Found: ${found}, Errors: ${errors} ---\n`);
    }
  }

  console.log(`\nDone! Processed: ${processed}, Found: ${found}, Errors: ${errors}`);
  db.close();
}

main().catch(console.error);
