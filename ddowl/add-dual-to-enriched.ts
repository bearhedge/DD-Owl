/**
 * Add dual listing column to baseline-enriched.csv
 * Uses HK+SH (Shanghai) or HK+SZ (Shenzhen) format based on A-share code
 */
import * as fs from 'fs';
import * as path from 'path';

const ENRICHED_CSV = path.join(import.meta.dirname, 'public/baseline-enriched.csv');
const PROGRESS_FILE = path.join(import.meta.dirname, '.dual-listing-progress.json');

interface DualListingResult {
  isDualListing: boolean;
  confidence: string;
  aShareCode?: string;
}

interface Progress {
  completed: Record<string, DualListingResult>;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
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
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function escapeCSV(val: string): string {
  if (!val) return '""';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return `"${val}"`;
}

function getDualListingValue(result: DualListingResult | undefined): string {
  if (!result?.isDualListing) return '';

  const code = result.aShareCode || '';
  if (code.startsWith('6')) {
    return 'HK+SH';  // Shanghai
  } else if (code.startsWith('0') || code.startsWith('3')) {
    return 'HK+SZ';  // Shenzhen
  } else if (code) {
    return 'HK+A';   // Unknown exchange
  }
  return '';
}

function main() {
  // Load dual listing progress
  if (!fs.existsSync(PROGRESS_FILE)) {
    console.error('Dual listing progress file not found:', PROGRESS_FILE);
    process.exit(1);
  }
  const progress: Progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  console.log(`Loaded ${Object.keys(progress.completed).length} dual listing results`);

  // Count by exchange
  let shanghai = 0, shenzhen = 0;
  for (const result of Object.values(progress.completed)) {
    if (result.isDualListing && result.aShareCode) {
      if (result.aShareCode.startsWith('6')) shanghai++;
      else if (result.aShareCode.startsWith('0') || result.aShareCode.startsWith('3')) shenzhen++;
    }
  }
  console.log(`  Shanghai (HK+SH): ${shanghai}`);
  console.log(`  Shenzhen (HK+SZ): ${shenzhen}`);

  // Read current enriched CSV
  const content = fs.readFileSync(ENRICHED_CSV, 'utf-8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());

  const oldHeader = lines[0];
  const oldColumns = parseCSVLine(oldHeader);
  console.log(`\nCurrent columns: ${oldColumns.join(', ')}`);

  // Check if is_dual_listing already exists
  const dualIdx = oldColumns.findIndex(c => c === 'is_dual_listing');
  const hasExistingDual = dualIdx >= 0;

  // Build new header
  const newHeader = hasExistingDual
    ? oldHeader  // Keep existing header
    : oldHeader + ',is_dual_listing';

  const newRows: string[] = [newHeader];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const ticker = values[0].replace(/"/g, '');

    const dualResult = progress.completed[ticker];
    const dualValue = getDualListingValue(dualResult);

    if (hasExistingDual) {
      // Update existing column
      values[dualIdx] = dualValue;
      newRows.push(values.map(v => escapeCSV(v.replace(/^"|"$/g, ''))).join(','));
    } else {
      // Append new column
      newRows.push(lines[i] + ',' + escapeCSV(dualValue));
    }
  }

  // Write updated CSV with BOM for Excel compatibility
  fs.writeFileSync(ENRICHED_CSV, '\uFEFF' + newRows.join('\n'));
  console.log(`\nUpdated ${ENRICHED_CSV}`);
  console.log(`Total rows: ${newRows.length - 1}`);

  // Show sample dual listings
  console.log('\nSample dual listings:');
  let shown = 0;
  for (let i = 1; i < newRows.length && shown < 5; i++) {
    const values = parseCSVLine(newRows[i]);
    const lastVal = values[values.length - 1].replace(/"/g, '');
    if (lastVal.startsWith('HK+')) {
      const ticker = values[0].replace(/"/g, '');
      const company = values[1].replace(/"/g, '').slice(0, 40);
      console.log(`  ${ticker}: ${company} - ${lastVal}`);
      shown++;
    }
  }
}

main();
