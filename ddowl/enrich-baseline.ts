/**
 * Enrich baseline data with:
 * 1. Deal metrics from Excel (shares, price, size)
 * 2. Chinese names from HKEX scraping
 */
import XLSX from 'xlsx';
import fs from 'fs';

interface DealMetrics {
  ticker: number;
  shares: number | null;
  hkShares: number | null;
  intlShares: number | null;
  price: number | null;
  sizeHKDm: number | null;
}

interface BaselineRow {
  ticker: string;
  company: string;
  type: string;
  date: string;
  bank_normalized: string;
  is_sponsor: string;
}

interface EnrichedDeal {
  ticker: string;
  company: string;
  companyCn: string | null;
  type: string;
  date: string;
  shares: number | null;
  price: number | null;
  sizeHKDm: number | null;
  sponsors: string[];
  others: string[];
}

async function main() {
  console.log('Starting enrichment...');

  // Step 1: Load Excel deal metrics
  const metrics = loadExcelMetrics();
  console.log(`Loaded ${metrics.size} deal metrics from Excel`);

  // Step 2: Load current baseline
  const baseline = loadBaseline();
  console.log(`Loaded ${baseline.length} baseline entries`);

  // Step 3: Merge and enrich
  const enriched = enrichData(baseline, metrics);
  console.log(`Enriched ${enriched.length} deals`);

  // Step 4: Save enriched baseline
  saveEnrichedBaseline(enriched);
  console.log('Done!');
}

function loadExcelMetrics(): Map<number, DealMetrics> {
  const wb = XLSX.readFile('/Users/home/Desktop/DD Owl/Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');
  const ws = wb.Sheets['Deals'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

  const metrics = new Map<number, DealMetrics>();

  // Skip header rows (0 and 1)
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const ticker = row[0];
    if (!ticker || typeof ticker !== 'number') continue;

    metrics.set(ticker, {
      ticker,
      shares: parseNumber(row[3]),
      hkShares: parseNumber(row[4]),
      intlShares: parseNumber(row[5]),
      price: parseNumber(row[8]),
      sizeHKDm: parseNumber(row[9]),
    });
  }

  return metrics;
}

function parseNumber(val: any): number | null {
  if (val === null || val === undefined || val === '-' || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function loadBaseline(): BaselineRow[] {
  const csv = fs.readFileSync('public/baseline-export.csv', 'utf-8');
  const lines = csv.split('\n');
  const headers = parseCSVLine(lines[0]);

  const rows: BaselineRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row: any = {};
    headers.forEach((h, idx) => row[h] = values[idx] || '');
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function enrichData(baseline: BaselineRow[], metrics: Map<number, DealMetrics>): EnrichedDeal[] {
  const dealMap = new Map<string, EnrichedDeal>();

  for (const row of baseline) {
    const ticker = row.ticker;
    let deal = dealMap.get(ticker);

    if (!deal) {
      const m = metrics.get(parseInt(ticker)) || {} as DealMetrics;
      deal = {
        ticker,
        company: cleanCompanyName(row.company),
        companyCn: null,
        type: row.type,
        date: row.date,
        shares: m.shares || null,
        price: m.price || null,
        sizeHKDm: m.sizeHKDm || null,
        sponsors: [],
        others: [],
      };
      dealMap.set(ticker, deal);
    }

    const bank = cleanBankName(row.bank_normalized);
    if (!bank || isGarbageBank(bank)) continue;

    if (row.is_sponsor === 'Y') {
      if (!deal.sponsors.includes(bank)) deal.sponsors.push(bank);
      deal.others = deal.others.filter(b => b !== bank);
    } else if (!deal.sponsors.includes(bank) && !deal.others.includes(bank)) {
      deal.others.push(bank);
    }
  }

  return Array.from(dealMap.values());
}

function cleanCompanyName(name: string): string {
  return name.replace(/\s+-\s*[WBS]$/i, '').trim();
}

function cleanBankName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\s*Company$/i, '')
    .replace(/\s*Co\.?$/i, '')
    .replace(/\s*Limited$/i, '')
    .replace(/\s*Ltd\.?$/i, '')
    .trim();
}

function isGarbageBank(name: string): boolean {
  if (!name || name.length < 3) return true;
  const garbage = [
    /^futures$/i,
    /^securities$/i,
    /^capital$/i,
    /is a$/i,
    /Financial adviser/i,
    /joint stock/i,
    /into a/i,
    /Limited:$/i,
  ];
  return garbage.some(p => p.test(name));
}

function saveEnrichedBaseline(deals: EnrichedDeal[]): void {
  const headers = ['ticker', 'company', 'company_cn', 'type', 'date', 'shares', 'price_hkd', 'size_hkdm', 'sponsors', 'others'];

  const rows = deals.map(d => [
    d.ticker,
    d.company,
    d.companyCn || '',
    d.type,
    d.date,
    d.shares || '',
    d.price || '',
    d.sizeHKDm || '',
    d.sponsors.join('; '),
    d.others.join('; '),
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  fs.writeFileSync('public/baseline-enriched.csv', '\uFEFF' + csv);
  console.log(`Saved ${deals.length} deals to public/baseline-enriched.csv`);
}

main();
