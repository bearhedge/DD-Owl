// src/validator.ts
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'ddowl.db');

interface ValidationFlag {
  ticker: number;
  company: string;
  flag: string;
  severity: 'high' | 'medium' | 'low';
  details: string;
}

export function validateDeals(): ValidationFlag[] {
  const db = new Database(DB_PATH, { readonly: true });
  const flags: ValidationFlag[] = [];

  // Flag: Single bank only
  const singleBank = db.prepare(`
    SELECT d.ticker, d.company, d.banks_extracted
    FROM ipo_deals d
    WHERE d.has_bank_info = 1 AND d.banks_extracted = 1
  `).all() as any[];

  for (const deal of singleBank) {
    flags.push({
      ticker: deal.ticker,
      company: deal.company,
      flag: 'SINGLE_BANK',
      severity: 'high',
      details: 'Only 1 bank extracted - unusual for IPO',
    });
  }

  // Flag: No sponsor
  const noSponsor = db.prepare(`
    SELECT d.ticker, d.company
    FROM ipo_deals d
    WHERE d.has_bank_info = 1
    AND NOT EXISTS (
      SELECT 1 FROM ipo_bank_roles r
      WHERE r.deal_id = d.ticker AND r.role = 'sponsor'
    )
  `).all() as any[];

  for (const deal of noSponsor) {
    flags.push({
      ticker: deal.ticker,
      company: deal.company,
      flag: 'NO_SPONSOR',
      severity: 'high',
      details: 'No sponsor role found',
    });
  }

  // Flag: Duplicate bank in same deal
  const duplicates = db.prepare(`
    SELECT d.ticker, d.company, b.name, COUNT(*) as cnt
    FROM ipo_deals d
    JOIN ipo_bank_roles r ON r.deal_id = d.ticker
    JOIN banks b ON b.id = r.bank_id
    WHERE d.has_bank_info = 1
    GROUP BY d.ticker, b.id
    HAVING cnt > 1
  `).all() as any[];

  for (const dup of duplicates) {
    flags.push({
      ticker: dup.ticker,
      company: dup.company,
      flag: 'DUPLICATE_BANK',
      severity: 'medium',
      details: `Bank "${dup.name}" appears ${dup.cnt} times`,
    });
  }

  db.close();
  return flags;
}

export function getFlaggedDeals(): Map<number, ValidationFlag[]> {
  const flags = validateDeals();
  const byTicker = new Map<number, ValidationFlag[]>();

  for (const flag of flags) {
    if (!byTicker.has(flag.ticker)) {
      byTicker.set(flag.ticker, []);
    }
    byTicker.get(flag.ticker)!.push(flag);
  }

  return byTicker;
}
