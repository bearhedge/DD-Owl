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

  // Flag: No decision maker (sponsor)
  const noDecisionMaker = db.prepare(`
    SELECT d.ticker, d.company
    FROM ipo_deals d
    WHERE d.has_bank_info = 1
    AND NOT EXISTS (
      SELECT 1 FROM ipo_bank_roles r
      WHERE r.deal_id = d.id AND r.is_decision_maker = 1
    )
  `).all() as any[];

  for (const deal of noDecisionMaker) {
    flags.push({
      ticker: deal.ticker,
      company: deal.company,
      flag: 'NO_DECISION_MAKER',
      severity: 'high',
      details: 'No sponsor/decision maker found',
    });
  }

  // Flag: Single decision maker only (unusual - most IPOs have multiple sponsors)
  const singleDecisionMaker = db.prepare(`
    SELECT d.ticker, d.company, COUNT(*) as dm_count
    FROM ipo_deals d
    JOIN ipo_bank_roles r ON r.deal_id = d.id
    WHERE d.has_bank_info = 1 AND r.is_decision_maker = 1
    GROUP BY d.ticker
    HAVING dm_count = 1
  `).all() as any[];

  for (const deal of singleDecisionMaker) {
    flags.push({
      ticker: deal.ticker,
      company: deal.company,
      flag: 'SINGLE_DECISION_MAKER',
      severity: 'medium',
      details: 'Only 1 decision maker - verify this is correct',
    });
  }

  // Flag: Single bank total (very unusual)
  const singleBank = db.prepare(`
    SELECT d.ticker, d.company
    FROM ipo_deals d
    WHERE d.has_bank_info = 1 AND d.banks_extracted = 1
  `).all() as any[];

  for (const deal of singleBank) {
    flags.push({
      ticker: deal.ticker,
      company: deal.company,
      flag: 'SINGLE_BANK',
      severity: 'high',
      details: 'Only 1 bank total - unusual for IPO',
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
