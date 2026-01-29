/**
 * A+H Dual Listing Detection Script
 *
 * Identifies Hong Kong listed companies that are also listed on mainland China
 * exchanges (A+H shares) by searching with the Chinese company name.
 *
 * Usage: npx tsx add-dual-listing.ts [--limit N] [--test]
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

const CSV_PATH = path.join(import.meta.dirname, 'public/baseline-enriched-with-sectors.csv');
const PROGRESS_FILE = path.join(import.meta.dirname, '.dual-listing-progress.json');

const SERPER_API_KEY = process.env.SERPER_API_KEY || '0b236ff71804037088bf133f768543f9558205bf';

interface CompanyRow {
  ticker: string;
  company: string;
  companyCn: string;
  sector: string;
  sectorCode: string;
  type: string;
  date: string;
  shares: string;
  priceHkd: string;
  sizeHkdm: string;
  sponsors: string;
  others: string;
  prospectusUrl: string;
}

interface Progress {
  completed: Record<string, { isDualListing: boolean; confidence: string; aShareCode?: string }>;
  lastUpdated: string;
}

/**
 * Parse CSV with proper quote handling
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim().replace(/^"|"$/g, ''));

  return values;
}

/**
 * Load companies from CSV
 */
function loadCompanies(): CompanyRow[] {
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split('\n');
  const companies: CompanyRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    companies.push({
      ticker: values[0] || '',
      company: values[1] || '',
      companyCn: values[2] || '',
      sector: values[3] || '',
      sectorCode: values[4] || '',
      type: values[5] || '',
      date: values[6] || '',
      shares: values[7] || '',
      priceHkd: values[8] || '',
      sizeHkdm: values[9] || '',
      sponsors: values[10] || '',
      others: values[11] || '',
      prospectusUrl: values[12] || '',
    });
  }

  return companies;
}

/**
 * Load or initialize progress
 */
function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { completed: {}, lastUpdated: '' };
}

/**
 * Save progress
 */
function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Common Traditional to Simplified Chinese mappings for company names
const TRAD_TO_SIMP: Record<string, string> = {
  '證': '证', '國': '国', '華': '华', '業': '业', '開': '开', '發': '发',
  '電': '电', '訊': '讯', '醫': '医', '藥': '药', '銀': '银', '際': '际',
  '經': '经', '濟': '济', '貿': '贸', '運': '运', '輸': '输', '環': '环',
  '態': '态', '機': '机', '構': '构', '設': '设', '計': '计', '務': '务',
  '財': '财', '產': '产', '動': '动', '車': '车', '廠': '厂', '廣': '广',
  '東': '东', '書': '书', '學': '学', '會': '会', '類': '类', '術': '术',
  '飛': '飞', '導': '导', '體': '体', '製': '制', '無': '无', '線': '线',
  '網': '网', '聯': '联', '資': '资', '訂': '订', '購': '购', '營': '营',
  '創': '创', '實': '实', '驗': '验', '場': '场', '邊': '边', '遠': '远',
  '進': '进', '達': '达', '優': '优', '質': '质', '團': '团', '僑': '侨',
  '鋼': '钢', '鐵': '铁', '礦': '矿', '壓': '压', '測': '测', '試': '试',
  '錫': '锡', '陽': '阳', '陰': '阴', '雲': '云', '龍': '龙', '鳳': '凤',
  '島': '岛', '師': '师', '廳': '厅', '縣': '县', '區': '区', '寶': '宝',
  '貝': '贝', '長': '长', '門': '门', '問': '问', '關': '关', '馬': '马',
  '風': '风', '飲': '饮', '餐': '餐', '齊': '齐', '齒': '齿', '龜': '龟',
};

function toSimplified(text: string): string {
  let result = text;
  for (const [trad, simp] of Object.entries(TRAD_TO_SIMP)) {
    result = result.split(trad).join(simp);
  }
  return result;
}

/**
 * Search for A+H dual listing status
 *
 * Strategy: Search for company + A股 code and verify the code
 * actually belongs to this company by doing a reverse lookup.
 */
async function searchDualListing(
  companyCn: string,
  companyEn: string,
  ticker: string
): Promise<{ isDualListing: boolean; confidence: string; aShareCode?: string }> {
  if (!companyCn) {
    return { isDualListing: false, confidence: 'none' };
  }

  // Strip common suffixes that might not appear in A-share name
  let cleanedName = companyCn
    .replace(/控股有限公司$/, '')
    .replace(/有限公司$/, '')
    .replace(/股份有限公司$/, '')
    .replace(/集團$/, '')
    .replace(/集团$/, '')
    .trim();

  // Need at least 2 characters for a meaningful match
  if (cleanedName.length < 2) {
    return { isDualListing: false, confidence: 'none' };
  }

  // Convert to simplified Chinese for matching
  const simplifiedName = toSimplified(cleanedName);

  // First search: find potential A-share code using the original name
  const query = `"${cleanedName}" A股 股票代码`;

  try {
    const resp = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num: 8 },
      {
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const data = resp.data;

    // Collect text from search results
    const results: string[] = [];

    if (data.answerBox?.snippet) results.push(data.answerBox.snippet);
    if (data.knowledgeGraph?.description) results.push(data.knowledgeGraph.description);

    for (const r of (data.organic || [])) {
      const text = `${r.title || ''} ${r.snippet || ''}`;
      results.push(text);
    }

    // Look for A-share stock codes
    const aShareCodePattern = /\b(600\d{3}|601\d{3}|603\d{3}|688\d{3}|000\d{3}|001\d{3}|002\d{3}|300\d{3}|301\d{3})\b/g;

    // Find codes that appear in results containing the company name (either traditional or simplified)
    const candidateCodes: string[] = [];
    // Require at least 3 characters for matching to avoid false positives
    const matchLength = Math.min(4, simplifiedName.length);
    if (matchLength < 3) {
      return { isDualListing: false, confidence: 'none' };
    }
    const matchName = simplifiedName.substring(0, matchLength);

    for (const result of results) {
      // Check if result contains the company name (convert result to simplified for matching)
      const resultSimplified = toSimplified(result);
      if (!resultSimplified.includes(matchName)) {
        continue;
      }
      const codes = result.match(aShareCodePattern) || [];
      for (const code of codes) {
        if (!candidateCodes.includes(code)) {
          candidateCodes.push(code);
        }
      }
    }

    if (candidateCodes.length === 0) {
      return { isDualListing: false, confidence: 'medium' };
    }

    // Second search: verify the code by reverse lookup
    // Search for the code and check if the company name appears
    await new Promise((r) => setTimeout(r, 300));

    for (const code of candidateCodes.slice(0, 2)) { // Check max 2 codes
      const verifyResp = await axios.post(
        'https://google.serper.dev/search',
        { q: `${code} 股票 公司名称`, num: 3 },
        {
          headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );

      const verifyData = verifyResp.data;
      const verifyText = [
        verifyData.answerBox?.snippet || '',
        verifyData.knowledgeGraph?.description || '',
        ...(verifyData.organic || []).map((r: any) => `${r.title || ''} ${r.snippet || ''}`),
      ].join(' ');

      // Check if the reverse lookup contains the company name (use simplified)
      // Require at least 3 character match for verification
      const verifyTextSimplified = toSimplified(verifyText);
      if (verifyTextSimplified.includes(matchName)) {
        return {
          isDualListing: true,
          confidence: 'high',
          aShareCode: code
        };
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    return { isDualListing: false, confidence: 'medium' };
  } catch (err: any) {
    console.error(`    Search error: ${err.message}`);
    return { isDualListing: false, confidence: 'low' };
  }
}

/**
 * Escape CSV value
 */
function escapeCSV(s: string): string {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Write updated CSV with dual listing column
 */
function writeUpdatedCSV(companies: CompanyRow[], progress: Progress): void {
  const header = 'ticker,company,company_cn,sector,sector_code,type,date,shares,price_hkd,size_hkdm,sponsors,others,prospectus_url,is_dual_listing';
  const rows: string[] = [header];

  for (const company of companies) {
    const result = progress.completed[company.ticker];
    // Determine exchange: 6xxxxx = Shanghai (SH), 0xxxxx/3xxxxx = Shenzhen (SZ)
    let isDualListing = '';
    if (result?.isDualListing && result.aShareCode) {
      if (result.aShareCode.startsWith('6')) {
        isDualListing = 'HK+SH';
      } else if (result.aShareCode.startsWith('0') || result.aShareCode.startsWith('3')) {
        isDualListing = 'HK+SZ';
      } else {
        isDualListing = 'HK+A';  // Unknown exchange, fallback
      }
    }

    rows.push([
      escapeCSV(company.ticker),
      escapeCSV(company.company),
      escapeCSV(company.companyCn),
      escapeCSV(company.sector),
      escapeCSV(company.sectorCode),
      escapeCSV(company.type),
      escapeCSV(company.date),
      escapeCSV(company.shares),
      escapeCSV(company.priceHkd),
      escapeCSV(company.sizeHkdm),
      escapeCSV(company.sponsors),
      escapeCSV(company.others),
      escapeCSV(company.prospectusUrl),
      isDualListing,
    ].join(','));
  }

  fs.writeFileSync(CSV_PATH, rows.join('\n'));
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let testMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--test') {
      testMode = true;
      limit = limit || 20; // Default test limit
    }
  }

  console.log('='.repeat(60));
  console.log('A+H Dual Listing Detection');
  console.log('='.repeat(60));

  const companies = loadCompanies();
  const progress = loadProgress();

  console.log(`Total companies: ${companies.length}`);
  console.log(`Already processed: ${Object.keys(progress.completed).length}`);

  // Filter to companies with Chinese names that haven't been processed
  const toProcess = companies.filter(
    (c) => c.companyCn && !progress.completed[c.ticker]
  );

  console.log(`Companies with Chinese names to process: ${toProcess.length}`);

  if (limit) {
    console.log(`Limit: ${limit}`);
  }
  if (testMode) {
    console.log('TEST MODE: Will not write to CSV');
  }
  console.log('');

  const processCount = limit ? Math.min(limit, toProcess.length) : toProcess.length;
  let processed = 0;
  let dualListedCount = 0;

  for (let i = 0; i < processCount; i++) {
    const company = toProcess[i];
    processed++;

    process.stdout.write(
      `[${processed}/${processCount}] ${company.ticker}: ${company.companyCn.slice(0, 20)}... `
    );

    const result = await searchDualListing(company.companyCn, company.company, company.ticker);
    progress.completed[company.ticker] = result;

    if (result.isDualListing) {
      dualListedCount++;
      console.log(`A+H [${result.confidence}]${result.aShareCode ? ` (${result.aShareCode})` : ''}`);
    } else {
      console.log('HK only');
    }

    // Save progress every 10 companies
    if (processed % 10 === 0) {
      saveProgress(progress);
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 400));
  }

  // Final save
  saveProgress(progress);

  // Update CSV (unless test mode)
  if (!testMode) {
    console.log('\nUpdating CSV...');
    writeUpdatedCSV(companies, progress);
    console.log(`Updated: ${CSV_PATH}`);
  }

  // Summary
  const totalDualListed = Object.values(progress.completed).filter((r) => r.isDualListing).length;
  const totalProcessed = Object.keys(progress.completed).length;

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Processed this run: ${processed}`);
  console.log(`A+H found this run: ${dualListedCount}`);
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total A+H dual listings: ${totalDualListed}`);
  console.log(`Remaining: ${companies.filter((c) => c.companyCn && !progress.completed[c.ticker]).length}`);
}

main().catch(console.error);
