/**
 * Regenerate baseline-export.csv from listed-import-results JSON
 * This ensures all banks from prospectus parsing are included
 */
import fs from 'fs';

interface Bank {
  name: string;
  normalized: string;
  roles: string[];
  isLead: boolean;
  rawRole: string;
}

interface ImportResult {
  ticker: number;
  company: string;
  type?: string;
  date?: string;
  success: boolean;
  banks?: Bank[];
}

const RESULTS_FILE = '.listed-import-results-mainBoard.json';
const OUTPUT_FILE = 'public/baseline-export.csv';

function main() {
  console.log('Loading results from', RESULTS_FILE);
  const results: ImportResult[] = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

  const successful = results.filter(r => r.success && r.banks && r.banks.length > 0);
  console.log(`Found ${successful.length} successful imports with banks`);

  // CSV headers
  const headers = [
    'ticker',
    'company',
    'type',
    'date',
    'bank_raw',
    'bank_normalized',
    'raw_role',
    'is_sponsor',
    'is_coordinator',
    'is_bookrunner',
    'is_lead_manager',
    'is_lead'
  ];

  const rows: string[][] = [];

  for (const result of successful) {
    for (const bank of result.banks!) {
      const row = [
        String(result.ticker),
        result.company,
        result.type || 'Global offering',
        result.date || '',
        bank.name,
        bank.normalized,
        bank.rawRole,
        bank.roles.includes('sponsor') ? 'Y' : 'N',
        bank.roles.includes('coordinator') ? 'Y' : 'N',
        bank.roles.includes('bookrunner') ? 'Y' : 'N',
        bank.roles.includes('lead_manager') ? 'Y' : 'N',
        bank.isLead ? 'Y' : 'N'
      ];
      rows.push(row);
    }
  }

  // Sort by ticker
  rows.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

  // Generate CSV
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(escape).join(','))
  ].join('\n');

  fs.writeFileSync(OUTPUT_FILE, csv);
  console.log(`Wrote ${rows.length} rows to ${OUTPUT_FILE}`);

  // Verify AVICT for 6613
  const avictRows = rows.filter(r => r[0] === '6613' && r[5].includes('AVICT'));
  if (avictRows.length > 0) {
    console.log('\n✓ AVICT found for ticker 6613');
  } else {
    console.log('\n✗ AVICT NOT found for ticker 6613');
  }

  // Show all banks for 6613
  const banks6613 = rows.filter(r => r[0] === '6613');
  console.log(`\nBanks for Lens Technology (6613): ${banks6613.length}`);
  banks6613.forEach(r => console.log(`  - ${r[5]} (${r[6]})`));
}

main();
