/**
 * Re-scrape all deals to fix bank data
 * Run with: npx tsx src/rescrape-deals.ts
 */

import pg from 'pg';
import { extractBankDataFromPdf } from './hkex-scraper.js';
import { isCompanyName } from './bank-normalizer.js';
import * as https from 'https';
import * as fs from 'fs';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:DOMRD7x7ECUny4Pc615y9w==@35.194.142.132:5432/ddowl',
  ssl: { rejectUnauthorized: false },
});

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
      } else {
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(true); });
      }
    }).on('error', () => resolve(false));
  });
}

async function main() {
  // Get all deals with PDF links
  const deals = await pool.query(`
    SELECT DISTINCT d.id, d.company_id, c.name_en as company_name, da.source_url
    FROM deals d
    JOIN companies c ON c.id = d.company_id
    JOIN deal_appointments da ON da.deal_id = d.id
    WHERE da.source_url IS NOT NULL AND da.source_url LIKE '%.pdf'
    ORDER BY d.id
  `);

  console.log(`Found ${deals.rows.length} deals with PDF links`);

  let processed = 0;
  let updated = 0;

  for (const deal of deals.rows) {
    console.log(`\nProcessing deal ${deal.id}: ${deal.company_name}`);

    const tempPath = `/tmp/rescrape_${deal.id}.pdf`;

    try {
      const success = await downloadPdf(deal.source_url, tempPath);
      if (!success) {
        console.log(`  Failed to download PDF`);
        continue;
      }

      const buffer = fs.readFileSync(tempPath);
      if (!buffer.toString().startsWith('%PDF')) {
        console.log(`  Invalid PDF`);
        continue;
      }

      const data = await extractBankDataFromPdf(buffer);
      console.log(`  Extracted ${data.banks.length} banks`);
      if (data.companyChineseName) {
        console.log(`  Chinese name: ${data.companyChineseName}`);
      }

      // Update company Chinese name if found
      if (data.companyChineseName) {
        await pool.query(
          'UPDATE companies SET name_cn = $1 WHERE id = $2 AND (name_cn IS NULL OR name_cn = \'\')',
          [data.companyChineseName, deal.company_id]
        );
      }

      // Clear existing appointments for this deal
      await pool.query('DELETE FROM deal_appointments WHERE deal_id = $1', [deal.id]);

      // Insert new appointments
      for (const bank of data.banks) {
        // Skip if it's the company itself
        if (isCompanyName(bank.bank, deal.company_name)) {
          console.log(`    Skipping company-as-bank: ${bank.bank}`);
          continue;
        }

        // Use FULL bank name as-is from PDF (no normalization)
        const fullBankName = bank.bank;

        // Upsert bank with full name
        const bankResult = await pool.query(`
          INSERT INTO banks (name) VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `, [fullBankName]);
        const bankId = bankResult.rows[0].id;

        // Insert appointment
        await pool.query(`
          INSERT INTO deal_appointments (deal_id, bank_id, roles, raw_role, is_lead, source_url)
          VALUES ($1, $2, $3::bank_role[], $4, $5, $6)
          ON CONFLICT (deal_id, bank_id) DO UPDATE SET
            roles = EXCLUDED.roles,
            raw_role = EXCLUDED.raw_role,
            is_lead = EXCLUDED.is_lead
        `, [deal.id, bankId, bank.roles, bank.rawRole, bank.isLead, deal.source_url]);

        console.log(`    Added: ${fullBankName} as "${bank.rawRole}"`);
      }

      updated++;
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.error(`  Error:`, err);
    }

    processed++;
  }

  await pool.end();
  console.log(`\nDone! Processed ${processed} deals, updated ${updated} with new bank data.`);
}

main().catch(console.error);
