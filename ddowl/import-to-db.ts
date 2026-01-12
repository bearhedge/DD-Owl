/**
 * Import all IPO data into the centralized SQLite database
 * - Deals from Excel
 * - Bank relationships from JSON results
 * - URL overrides
 *
 * Run: npx tsx import-to-db.ts
 */

import Database from 'better-sqlite3';
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveRun } from './src/run-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'data/ddowl.db'));

// Disable foreign keys during import
db.pragma('foreign_keys = OFF');

// Run schema
console.log('Creating tables...');
const schema = fs.readFileSync(path.join(__dirname, 'src/ipo-schema.sql'), 'utf8');
db.exec(schema);

// Clear existing data for clean import
db.exec('DELETE FROM ipo_bank_roles');
db.exec('DELETE FROM ipo_deals');
db.exec('DELETE FROM banks');
db.exec('DELETE FROM url_overrides');

// Load Excel data
console.log('Loading Excel data...');
const excelPath = path.join(__dirname, '../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');
const workbook = xlsx.readFile(excelPath);
const indexSheet = workbook.Sheets['Index'];
const rows = xlsx.utils.sheet_to_json(indexSheet, { header: 1 }) as any[][];

// Load JSON results - prefer successful results over failed ones
console.log('Loading bank extraction results...');
const results = JSON.parse(fs.readFileSync('.historical-import-results.json', 'utf8'));
const resultsMap = new Map<number, any>();
for (const r of results) {
  const existing = resultsMap.get(r.ticker);
  // Only overwrite if: no existing, or new one is successful, or existing failed
  if (!existing || r.success || !existing.success) {
    if (!existing || r.success) {
      resultsMap.set(r.ticker, r);
    }
  }
}

// Load URL overrides
console.log('Loading URL overrides...');
const overrides = JSON.parse(fs.readFileSync('url-overrides.json', 'utf8'));

// Prepare statements
const insertDeal = db.prepare(`
  INSERT OR REPLACE INTO ipo_deals (ticker, company, type, prospectus_url, listing_date, has_bank_info, banks_extracted, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertBank = db.prepare(`INSERT OR IGNORE INTO banks (name) VALUES (?)`);
const getBank = db.prepare(`SELECT id FROM banks WHERE name = ?`);
const insertRole = db.prepare(`
  INSERT OR REPLACE INTO ipo_bank_roles (deal_id, bank_id, raw_name, is_decision_maker, is_lead, raw_roles)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const getDeal = db.prepare(`SELECT id FROM ipo_deals WHERE ticker = ?`);
const insertOverride = db.prepare(`
  INSERT OR REPLACE INTO url_overrides (ticker, correct_url, excel_url, reason)
  VALUES (?, ?, ?, ?)
`);

// Helper to parse Excel date
function parseExcelDate(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  return null;
}

// Import deals
console.log('Importing deals...');
let dealCount = 0;

const importAll = db.transaction(() => {
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[1]) continue;

    const ticker = typeof row[1] === 'number' ? row[1] : parseInt(row[1]);
    if (isNaN(ticker)) continue;

    const company = String(row[2] || '').trim();
    const type = String(row[3] || '').trim();
    let prospectusUrl = String(row[4] || '').trim();
    const listingDate = parseExcelDate(row[5]);

    // Check for URL override
    const override = overrides.overrides[String(ticker)];
    if (override?.correctUrl) {
      prospectusUrl = override.correctUrl;
    }

    // Get bank extraction results
    const result = resultsMap.get(ticker);
    const hasBankInfo = result?.success ? 1 : 0;
    const banksExtracted = result?.banksFound || 0;
    const notes = result?.note || (result?.error && result.error !== 'Invalid URL' ? result.error : null);

    insertDeal.run(ticker, company, type, prospectusUrl, listingDate, hasBankInfo, banksExtracted, notes);
    dealCount++;

    const dealRow = getDeal.get(ticker) as { id: number } | undefined;
    if (!dealRow) continue;
    const dealId = dealRow.id;

    if (result?.banks) {
      // Group banks by normalized name - one row per bank per deal
      const bankGroups = new Map<string, {
        name: string;
        rawName: string;
        rawRoles: string[];
        isDecisionMaker: boolean;
        isLead: boolean
      }>();

      for (const bank of result.banks) {
        const key = bank.normalized;
        if (!bankGroups.has(key)) {
          bankGroups.set(key, {
            name: bank.normalized,
            rawName: bank.name,
            rawRoles: [],
            isDecisionMaker: false,
            isLead: false,
          });
        }
        const group = bankGroups.get(key)!;

        // Add raw role if not already present
        if (bank.rawRole && !group.rawRoles.includes(bank.rawRole)) {
          group.rawRoles.push(bank.rawRole);
        }

        // Check if this is a sponsor (decision maker)
        if (bank.rawRole && bank.rawRole.toLowerCase().includes('sponsor')) {
          group.isDecisionMaker = true;
          // Check if lead sponsor
          if (bank.rawRole.toLowerCase().includes('lead')) {
            group.isLead = true;
          }
        }
      }

      // Insert one row per bank
      for (const [normalized, group] of bankGroups) {
        insertBank.run(normalized);
        const bankRow = getBank.get(normalized) as { id: number } | undefined;
        if (!bankRow) continue;

        insertRole.run(
          dealId,
          bankRow.id,
          group.rawName,
          group.isDecisionMaker ? 1 : 0,
          group.isLead ? 1 : 0,
          JSON.stringify(group.rawRoles)
        );
      }
    }
  }

  // Import URL overrides
  for (const [ticker, override] of Object.entries(overrides.overrides)) {
    const o = override as any;
    insertOverride.run(parseInt(ticker), o.correctUrl, o.excelUrl, o.reason);
  }
});

importAll();

// Summary stats
const totalBanks = (db.prepare('SELECT COUNT(*) as c FROM banks').get() as any).c;
const totalRelationships = (db.prepare('SELECT COUNT(*) as c FROM ipo_bank_roles').get() as any).c;
const dealsWithBanks = (db.prepare('SELECT COUNT(*) as c FROM ipo_deals WHERE has_bank_info = 1').get() as any).c;
const dealsWithoutBanks = (db.prepare('SELECT COUNT(*) as c FROM ipo_deals WHERE has_bank_info = 0').get() as any).c;

console.log('\n=== Import Complete ===');
console.log(`Deals: ${dealCount}`);
console.log(`  With bank data: ${dealsWithBanks}`);
console.log(`  Without bank data: ${dealsWithoutBanks}`);
console.log(`Banks: ${totalBanks}`);
console.log(`Bank-Deal Roles: ${totalRelationships}`);
console.log(`URL Overrides: ${(db.prepare('SELECT COUNT(*) as c FROM url_overrides').get() as any).c}`);

console.log('\nTop 10 Banks:');
const topBanks = db.prepare(`
  SELECT b.name, COUNT(DISTINCT r.deal_id) as deals
  FROM banks b JOIN ipo_bank_roles r ON r.bank_id = b.id
  GROUP BY b.id ORDER BY deals DESC LIMIT 10
`).all() as { name: string; deals: number }[];
for (const b of topBanks) console.log(`  ${b.name}: ${b.deals} deals`);

db.pragma('foreign_keys = ON');
db.close();
console.log('\nDatabase saved to data/ddowl.db');

// Save run snapshot for verification system
const successfulResults = [...resultsMap.values()].filter(r => r.success);
const runMetadata = saveRun(successfulResults, {
  deals_processed: dealCount,
  deals_with_banks: dealsWithBanks,
  deals_without_banks: dealsWithoutBanks,
  total_banks: totalBanks,
  total_relationships: totalRelationships,
});
console.log(`\nRun ${runMetadata.run_id} saved to runs/`);
