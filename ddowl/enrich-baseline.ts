/**
 * Enrich baseline data with:
 * 1. Deal metrics from Excel (shares, price, size)
 * 2. Chinese names from HKEX scraping
 * 3. Dates extracted from PDF URLs (for Unavailable/numeric dates)
 */
import XLSX from 'xlsx';
import fs from 'fs';
import Database from 'better-sqlite3';

interface DealMetrics {
  ticker: number;
  shares: number | null;
  hkShares: number | null;
  intlShares: number | null;
  price: number | null;
  sizeHKDm: number | null;
}

// Minimum deal size threshold - show "-" for anything below
const MIN_DEAL_SIZE_HKDM = 10;

interface BaselineRow {
  ticker: string;
  company: string;
  type: string;
  date: string;
  bank_normalized: string;
  is_sponsor: string;
  raw_role: string;
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
  prospectusUrl: string | null;
}

async function main() {
  console.log('Starting enrichment...');

  // Step 1: Load Excel deal metrics
  const metrics = loadExcelMetrics();
  console.log(`Loaded ${metrics.size} deal metrics from Excel`);

  // Step 1b: Load dates and PDF URLs from Index sheet
  const { dates, pdfUrls } = loadDatesAndUrlsFromIndex();
  console.log(`Loaded ${dates.size} dates and ${pdfUrls.size} PDF URLs from Excel Index sheet`);

  // Step 1c: Load prospectus URLs from database (fallback for when Index sheet has "Unavailable")
  const dbUrls = loadProspectusUrls();
  // Merge: database URLs fill in gaps where Index sheet has no URL
  for (const [ticker, url] of dbUrls) {
    if (!pdfUrls.has(ticker)) {
      pdfUrls.set(ticker, url);
    }
  }
  console.log(`Total PDF URLs after merging: ${pdfUrls.size}`);

  // Step 2: Load current baseline
  const baseline = loadBaseline();
  console.log(`Loaded ${baseline.length} baseline entries`);

  // Step 3: Load Chinese names from database with full name preference
  const chineseNames = loadChineseNames();

  // Step 4: Merge and enrich
  const enriched = enrichData(baseline, metrics, chineseNames, dates, pdfUrls);
  console.log(`Enriched ${enriched.length} deals`);

  // Step 5: Save enriched baseline
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

function loadDatesAndUrlsFromIndex(): { dates: Map<number, string>; pdfUrls: Map<number, string> } {
  const wb = XLSX.readFile('/Users/home/Desktop/DD Owl/Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');
  const ws = wb.Sheets['Index'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

  const dates = new Map<number, string>();
  const pdfUrls = new Map<number, string>();

  // Row 0 is empty, row 1 is headers, data starts at row 2
  // Columns: [empty, Ticker, Company, Type, Documents, Date, Info]
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const ticker = row[1]; // Column B
    const url = row[4];    // Column E - Documents (PDF URL)
    const date = row[5];   // Column F
    if (ticker) {
      if (date) {
        dates.set(ticker, String(date));
      }
      if (url && typeof url === 'string' && url.startsWith('http')) {
        pdfUrls.set(ticker, url);
      }
    }
  }

  return { dates, pdfUrls };
}

/**
 * Extract date from PDF URL
 * Pattern: https://www1.hkexnews.hk/listedco/listconews/sehk/YYYY/MMDD/filename.pdf
 * Also handles: /gem/YYYY/MMDD/ and case variations like /SEHK/
 * Returns date in DD/MM/YYYY format
 */
function extractDateFromUrl(url: string): string | null {
  if (!url) return null;

  // Pattern: /sehk/YYYY/MMDD/ or /gem/YYYY/MMDD/ (case insensitive)
  const match = url.match(/\/(sehk|gem)\/(\d{4})\/(\d{2})(\d{2})\//i);
  if (match) {
    const [_, _board, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }
  return null;
}

/**
 * Convert Excel serial date to DD/MM/YYYY string
 * Excel serial date: days since 1900-01-01 (with the 1900 leap year bug)
 */
function excelDateToString(serial: number): string {
  // Excel's epoch is December 30, 1899 (due to the 1900 leap year bug)
  // The formula: (serial - 25569) * 86400 * 1000 converts to Unix timestamp
  const date = new Date((serial - 25569) * 86400 * 1000);
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Check if a date string is actually an Excel serial number
 */
function isExcelSerialDate(dateStr: string): boolean {
  // Excel serial dates are 5-digit numbers (e.g., 41894, 45235)
  return /^\d{5}$/.test(dateStr.trim());
}

/**
 * Check if date is unavailable or needs fixing
 */
function needsDateFix(dateStr: string | undefined | null): boolean {
  if (!dateStr) return true;
  const d = dateStr.trim().toLowerCase();
  return d === 'unavailable' || d === '' || isExcelSerialDate(dateStr);
}

// Manual date overrides for companies with wrong/missing dates
const KNOWN_DATES: Record<number, string> = {
  1970: '08/10/2015',  // IMAX China - was showing garbage "2"
  7801: '16/09/2022',  // Interra Acquisition - SPAC, URL not on HKEX
  9877: '10/10/2022',  // Jenscare Scientific - URL not on HKEX
};

/**
 * Fix date formatting issues (e.g., "26/1/2021" -> "26/01/2021")
 */
function fixDateFormat(dateStr: string): string {
  if (!dateStr) return dateStr;
  // Match D/M/YYYY or DD/M/YYYY patterns
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [_, day, month, year] = match;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }
  return dateStr;
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

// Manual Chinese name overrides for companies where PDF extraction failed
// Use FULL legal names ending with 有限公司, 控股, 集團 where possible
const KNOWN_CHINESE_NAMES: Record<number, string> = {
  // ADRs and well-known companies
  9999: '網易公司',
  9898: '微博公司',
  9618: '京東集團股份有限公司',
  9626: '嗶哩嗶哩股份有限公司',
  2605: '美達凱控股有限公司',

  // Major HK/China companies with full names
  6993: '藍月亮集團控股有限公司',
  6869: '長飛光纖光纜股份有限公司',
  6858: '本間高爾夫有限公司',
  6606: '諾輝健康科技有限公司',
  6183: '中國綠色食品控股有限公司',
  6181: '老鋪黃金股份有限公司',
  6169: '中國宇華教育集團有限公司',
  6166: '中國恒大產業集團有限公司',
  6138: '哈爾濱銀行股份有限公司',
  6116: '拉夏貝爾服飾股份有限公司',
  6099: '招商證券股份有限公司',
  6088: '鴻騰精密科技股份有限公司',
  6066: '中信建投證券股份有限公司',
  6055: '中煙國際(香港)有限公司',
  3866: '青島銀行股份有限公司',
  3600: '現代牙科集團有限公司',

  // Tech companies
  2590: '北京極智嘉科技股份有限公司',
  2597: '北京訊眾通信技術股份有限公司',
  1304: '峰岹科技(深圳)股份有限公司',
  6613: '藍思科技股份有限公司',
  2076: '看準科技有限公司',               // Kanzhun - Phase 2 fix
  1828: '富衛集團有限公司',
  9660: '地平線機器人控股有限公司',        // Horizon Robotics
  2382: '舜宇光學科技(集團)有限公司',
  9888: '百度集團股份有限公司',
  9988: '阿里巴巴集團控股有限公司',
  3690: '美團控股有限公司',
  700: '騰訊控股有限公司',
  9961: '攜程集團有限公司',
  1810: '小米集團控股有限公司',
  9866: '蔚來控股有限公司',
  9868: '小鵬汽車有限公司',
  2015: '理想汽車控股有限公司',
  285: '比亞迪電子(國際)有限公司',
  1211: '比亞迪股份有限公司',

  // Full names from search-chinese-names.ts
  9680: '如祺出行控股有限公司',
  9638: '法拉帝(意大利)股份有限公司',
  9933: '冠豪國際控股有限公司',
  6866: '佐力科創小額貸款股份有限公司',
  6886: '華泰證券股份有限公司',
  6860: '指尖悅動有限公司',
  6161: '標達保險(控股)有限公司',
  6139: '金茂投資管理有限公司',
  6113: '優腦思行銷方案集團有限公司',
  6090: '盛世民安控股有限公司',

  // Fix abbreviated names with full versions
  1530: '三生製藥控股有限公司',           // Was "三生製藥"
  1244: '思路迪醫藥股份有限公司',         // Fix incomplete name

  // SPACs (no Chinese names needed)
  7855: '',
  7836: '',
  7827: '',
  7801: '',

  // Foreign companies (no Chinese name)
  3668: '',  // Yancoal Australia
  1245: '',  // Niraku GC Holdings (Japan)
  3395: '',  // Persta Resources (Canada)

  // Phase 2 fixes - batch 1 (24 companies)
  3880: '泰德醫藥股份有限公司',
  9881: '容大合眾（廈門）科技集團股份公司',
  2596: '宜賓市商業銀行股份有限公司',
  2577: '英諾賽科（蘇州）科技股份有限公司',
  1471: '眾淼控股（青島）股份有限公司',
  2495: '上海聲通信息科技股份有限公司',
  2545: '中贛通信集團控股有限公司',
  2559: '嘀嗒出行',
  2479: '天聚地合（蘇州）科技股份有限公司',
  2228: '晶泰科技',
  2505: 'EDA集團控股有限公司',
  2517: '鍋圈食品（上海）股份有限公司',
  9890: '中旭未來',
  2415: '梅斯健康控股有限公司',
  2433: '中天建設（湖南）集團有限公司',
  3660: '360數科',
  3931: '中創新航科技股份有限公司',
  692: '康灃生物科技（上海）股份有限公司',
  2391: '塗鴉智能',
  2390: '知乎',
  1024: '快手科技',
  2125: '稻草熊娛樂集團',
  6618: '京東健康',
  1209: '華潤萬象生活',

  // Phase 2 fixes - batch 2 (Definitely Need - 30 companies)
  13: '和黃醫藥',
  95: '綠景（中國）地產投資有限公司',
  520: '呷哺呷哺餐飲管理（中國）控股有限公司',
  839: '中國教育集團控股有限公司',
  1156: '中國新能源有限公司',
  1317: '中國楓葉教育集團有限公司',
  1337: '雷蛇',  // Delisted 2022
  1357: '美圖公司',
  1456: '國聯證券股份有限公司',
  1503: '招商局商業房地產投資信託基金',
  1508: '中國再保險（集團）股份有限公司',
  1551: '廣州農村商業銀行股份有限公司',
  1599: '北京城建設計發展集團股份有限公司',
  1610: '中糧家佳康食品有限公司',
  1671: '天津天保能源股份有限公司',
  1739: '齊屹科技',
  1763: '中國同輻股份有限公司',
  1801: '信達生物製藥',
  1873: '維亞生物科技控股集團',
  1896: '貓眼娛樂',
  1970: 'IMAX中國控股有限公司',
  2057: '中通快遞',
  2298: '都市麗人（中國）控股有限公司',
  2518: '汽車之家',
  2552: '華領醫藥',
  2616: '基石藥業',
  2618: '京東物流',
  3650: '卡路里科技',
  6608: '百融雲創',
  6820: '友誼時光股份有限公司',

  // Phase 2 fixes - batch 2 (Probably Need - 22 companies with confirmed Chinese names)
  1310: '香港寬頻有限公司',
  1330: '綠色動力環保集團股份有限公司',
  1415: '高偉電子',
  1438: '富貴生命國際有限公司',
  1442: '鷹輝物流有限公司',
  1478: '丘鈦科技（集團）有限公司',
  1509: '和美醫療控股有限公司',
  1526: '瑞慈醫療',
  1612: '永勝醫療控股有限公司',
  1617: '南方通信控股有限公司',
  1619: '天合化工集團有限公司',
  1647: '雄岸科技集團有限公司',
  1675: '亞信科技控股有限公司',
  1696: '復銳醫療科技有限公司',
  1809: '浦林成山控股有限公司',
  1839: '中集車輛（集團）股份有限公司',
  2189: '嘉濤（香港）控股有限公司',
  2360: '優品360控股有限公司',
  2511: '君聖泰醫藥',
  2528: '尚晉（國際）控股有限公司',
  3358: '榮威國際',
  9606: '映恩生物',

  // Phase 2 fixes - batch 3 (Corrections for wrong Chinese names from database)
  788: '中國鐵塔股份有限公司',    // Was wrongly 中信建投國際
  1651: '津上精密機床（中國）有限公司',  // Was wrongly 香港資產管理
  6068: '睿見教育國際控股有限公司',  // Was wrongly 以誠心服務社會 (a slogan)

  // Phase 2 fixes - batch 4 (Incomplete Chinese names - adding full legal names)
  1274: '知行汽車科技（蘇州）股份有限公司',  // Was 知行汽車科技
  1635: '上海大眾公用事業（集團）股份有限公司',  // Was 上海大眾公用事業
  2235: '微泰醫療器械（杭州）股份有限公司',  // Was 微泰醫療器械
  2252: '上海微創醫療機器人（集團）股份有限公司',  // Was 上海微创医疗机器人
  2281: '瀘州興瀘水務（集團）股份有限公司',  // Was 瀘州市興瀘水務
  2291: '樂普心泰醫療科技（上海）股份有限公司',  // Was 樂普心泰醫療科技
  2565: '派格生物醫藥（杭州）股份有限公司',  // Was 派格生物醫藥
  6922: '康灃生物科技（上海）股份有限公司',  // Was 康灃生物科技
  9663: '國鴻氫能科技（嘉興）股份有限公司',  // Was 國鴻氫能科技
  9995: '榮昌生物製藥（煙台）股份有限公司',  // Was 榮昌生物製藥
  2599: '祥生控股（集團）有限公司',  // Was 祥生控股
  6893: '衍生集團（國際）控股有限公司',  // Was 衍生集團

  // Phase 2 fixes - batch 5 (More incomplete Chinese names)
  2589: '滬上阿姨（上海）實業股份有限公司',  // Was 實業股份有限公司 (missing prefix)
  2315: '百奧賽圖（北京）醫藥科技股份有限公司',  // Was 醫藥科技股份有限公司 (missing prefix)

  // Phase 2 fixes - batch 6 (Missing province/city in brackets)
  6821: '凱萊英醫藥集團（天津）股份有限公司',  // Was 凱萊英醫藥集團 (missing 天津)
  1541: '宜明昂科生物醫藥技術（上海）股份有限公司',  // Was 宜明昂科生物醫藥技術 (missing 上海)
  2617: '藥捷安康（南京）科技股份有限公司',  // Was 科技股份有限公司 (garbage - missing everything)
  2500: '杭州啓明醫療器械股份有限公司',  // Was 杭州明醫療器械股份有限公司 (missing 啓 character)

  // Phase 3 fixes - Data Quality Audit (24 companies)
  865: '第一電訊集團有限公司',              // First Mobile Group
  933: '非凡領越有限公司',                  // VIVA GOODS (formerly 非凡中國)
  1367: '恒寶企業控股有限公司',             // Hanbo Enterprises (now SFund International)
  1490: '車市控股有限公司',                 // Cheshi Holdings (now Cheshi Technology)
  1499: '前進控股集團有限公司',             // LEAP Holdings (now OKG Technology)
  1721: 'FSM控股集團有限公司',              // FSM Holdings
  2483: 'K Cash金融科技股份有限公司',       // K Cash Corporation
  2561: '維昇藥業（上海）有限公司',         // VISEN Pharmaceuticals
  3958: '東方證券股份有限公司',             // DFZQ (Orient Securities)
  6998: '嘉和生物藥業控股有限公司',         // JHBP (Genor Biopharma)

  // Foreign companies without Chinese names (skip)
  1025: '',   // KNT Holdings - HK company, uses English name
  1376: '',   // Raffles Interior - Singapore company
  1401: '',   // Sprocomm Intelligence - now Future Machine, uses English
  1416: '',   // CTR Holdings - Singapore company
  1463: '',   // C-Link Squared - Malaysia company
  1489: '',   // GC Construction - HK company, English name
  1552: '',   // BHCC Holding - Singapore company
  1650: '',   // Hygieia Group - Singapore company
  1653: '',   // MOS House Group - HK company, uses English name
  1655: '',   // Okura Holdings - Japan company
  1693: '',   // BGMC International - Malaysia company
  1707: '',   // Geotech Holdings - HK company, English name
  1726: '',   // HKE Holdings - HK company, uses English name
  1742: '',   // HPC Holdings - Singapore company
};

// Company status notes for delisted/privatized/suspended companies (appended to company name)
const COMPANY_STATUS_NOTES: Record<number, string> = {
  // Privatized companies
  1337: '[Privatized 2022]',
  1821: '[Privatized 2024]',
  1992: '[Privatized 2025]',
  3799: '[Privatized 2023]',
  1381: '[Privatized 2025]',
  6600: '[Privatized 2024]',
  1438: '[Privatized 2016]',
  1035: '[Privatized 2020]',

  // Delisted companies (fraud/suspended/failed requirements)
  1619: '[Delisted 2020]',
  1761: '[Delisted 2024]',
  2014: '[Delisted 2022]',
  1573: '[Delisted 2021]',
  2599: '[Delisted 2024]',
  1859: '[Delisted 2025]',
  2718: '[Delisted 2024]',
  1365: '[Delisted]',
  1492: '[Delisted]',

  // SPACs
  7836: '[SPAC - Pending De-SPAC]',
  7841: '[SPAC - Merged to 2562]',
  7801: '[SPAC - Delisted 2025]',
  7827: '[SPAC - Delisted 2025]',
  7855: '[SPAC - Merged to Seyond]',

};

/**
 * Check if a Chinese name is garbage (just suffix or truncated)
 * These are invalid extractions that only contain company type suffixes
 */
function isGarbageChineseName(name: string): boolean {
  if (!name) return true;
  // Just suffixes without actual company name (truncated extraction artifacts)
  const garbagePatterns = [
    /^[份股控集]?[份股]?有限公司$/,
    /^控股有限公司$/,
    /^股份有限公司$/,
    /^集團有限公司$/,
    /^集團控股有限公司$/,
    /^有限公司$/,
  ];
  if (garbagePatterns.some(p => p.test(name))) return true;
  // Names ending with 公司 must have at least 6 chars (e.g., "XX有限公司" minimum)
  // Otherwise they're truncated garbage
  if (name.endsWith('公司') && name.length < 6) return true;
  return false;
}

/**
 * Check if a Chinese name is a "full" legal name
 * Full names typically end with 有限公司, 股份有限公司, etc.
 */
function isFullChineseName(name: string): boolean {
  if (!name) return false;
  return name.endsWith('有限公司') ||
         name.endsWith('股份公司') ||
         name.endsWith('股份有限公司') ||
         name.endsWith('控股有限公司') ||
         name.endsWith('集團有限公司');
}

/**
 * Choose the better Chinese name between two options
 * Prefers: longer names, names ending with proper legal suffixes
 */
function chooseBetterChineseName(name1: string | null, name2: string | null): string | null {
  if (!name1) return name2;
  if (!name2) return name1;

  // Prefer full legal names
  const is1Full = isFullChineseName(name1);
  const is2Full = isFullChineseName(name2);

  if (is1Full && !is2Full) return name1;
  if (is2Full && !is1Full) return name2;

  // Both are full or both are short - prefer longer one
  return name1.length >= name2.length ? name1 : name2;
}

function loadProspectusUrls(): Map<number, string> {
  const db = new Database('data/ddowl.db', { readonly: true });
  const rows = db.prepare("SELECT ticker, prospectus_url FROM ipo_deals WHERE prospectus_url IS NOT NULL AND prospectus_url != ''").all() as { ticker: number; prospectus_url: string }[];
  const map = new Map<number, string>();
  for (const r of rows) {
    if (r.prospectus_url && r.prospectus_url.includes('hkex')) {
      map.set(r.ticker, r.prospectus_url);
    }
  }
  db.close();
  console.log(`Loaded ${map.size} prospectus URLs from database`);
  return map;
}

function loadChineseNames(): Map<string, string> {
  const db = new Database('data/ddowl.db', { readonly: true });
  const rows = db.prepare("SELECT ticker, company_cn FROM ipo_deals WHERE company_cn IS NOT NULL AND company_cn != ''").all() as { ticker: number; company_cn: string }[];
  const map = new Map<string, string>();

  // First pass: load from database, preferring full names, filtering garbage
  for (const r of rows) {
    const ticker = String(r.ticker);
    const existing = map.get(ticker);
    const better = chooseBetterChineseName(existing || null, r.company_cn);
    if (better && !isGarbageChineseName(better)) {
      map.set(ticker, better);
    }
  }

  // Second pass: apply manual overrides (these take precedence if non-empty)
  // Manual overrides are authoritative - they represent verified full names
  for (const [ticker, name] of Object.entries(KNOWN_CHINESE_NAMES)) {
    if (name === '') {
      // Empty string means explicitly no Chinese name (SPACs, foreign companies)
      map.delete(ticker);
    } else {
      // Manual override takes precedence
      map.set(ticker, name);
    }
  }

  db.close();
  console.log(`Loaded ${map.size} Chinese company names from database`);
  return map;
}

// Bank family mappings - variants that should consolidate to one canonical name
const BANK_FAMILIES: Record<string, string[]> = {
  'Bank of China': ['BOCI', 'Bank of China International', 'Bank of China (UK)', 'Bank of China Group Investment', 'BOC International'],
  'ICBC': ['ICBC International', 'ICBCI'],
  'CCB': ['CCB International', 'CCBI', 'China Construction Bank International'],
  'CMB': ['CMB International', 'CMBI', 'China Merchants Securities', 'China Merchants Bank International'],
  'CITIC': ['CITIC Securities', 'CITICPE Holdings', 'CITIC CLSA'],
  'Guotai Junan': ['Guotai Junan Capital', 'Guotai Junan Securities', 'GTJA Securities', 'GTJA'],
  'Southwest Securities': ['Southwest Securities Capital', 'Southwest Securities Brokerage'],
  'Haitong': ['Haitong International', 'Haitong Securities'],
  'BOCOM': ['BOCOM International', 'Bank of Communications International'],
  'Huatai': ['Huatai Securities', 'Huatai International', 'Huatai Financial'],
  'Dakin': ['Dakin Capital', 'Dakin Securities'],
  'Innovax': ['Innovax Capital', 'Innovax Securities'],
  'AMTD': ['AMTD Global Markets', 'AMTD Asset Management'],
  'CEB': ['CEB International', 'China Everbright', 'China Everbright Securities'],
  'Caitong': ['Caitong International Capital', 'Caitong International Securities'],
  'Dongxing': ['Dongxing Securities'],
  'Changjiang': ['Changjiang Corporate Finance', 'Changjiang Securities Brokerage'],
  'Fortune': ['Fortune Financial Capital', 'Fortune Securities'],
  'Lego': ['Lego Corporate Finance', 'Lego Securities'],
  'Ample': ['Ample Capital', 'Ample Orient Capital'],
  'First Shanghai': ['First Shanghai Capital', 'First Shanghai Securities'],
  'Quam': ['Quam Capital', 'Quam Securities'],
  'Soochow': ['Soochow Securities International Capital', 'Soochow Securities International Brokerage'],
  'Yue Xiu': ['Yue Xiu Capital', 'Yue Xiu Securities'],
  'Zhongtai': ['Zhongtai', 'Zhongtai Securities', 'Zhongtai International'],
  'Shenwan Hongyuan': ['Shenwan Hongyuan', 'SWS', 'Shenwan'],
  'AVIC': ['AVIC International Holding', 'Avic International Holdings', 'AVIC Joy Holdings', 'AVIC Real Estate Holding'],
  'AVICT': ['AVICT Global Asset Management', 'Avict Global Holdings', 'AVICT Global Holdings'],
  'Deutsche Bank': ['Deutsche Bank', 'Deutsche Securities Asia', 'Deutsche Securities'],
  'J.P. Morgan': ['J.P. Morgan', 'JP Morgan', 'JPMorgan'],
  'Citi': ['Citi', 'Citigroup', 'Citibank'],
  'China Tonghai': ['China Tonghai Capital', 'China Tonghai Securities'],
  'Kingsway': ['Kingsway Capital', 'Kingsway Financial Services Group', 'Kingsway SW Securities'],
  'Essence': ['Essence Corporate Finance', 'Essence International Securities', 'Essence Securities'],
  'China Investment Securities': ['China Investment Securities International Capital', 'China Investment Securities International Brokerage'],
  'Elstone': ['Elstone Capital', 'Elstone Securities'],
  'Asia Financial': ['Asia Financial Capital', 'Asia Financial (Securities)'],
  'Halcyon': ['Halcyon Capital', 'Halcyon Securities'],
  'Sunfund': ['Sunfund Capital', 'Sunfund Securities'],
  'Mason': ['Mason Global Capital', 'Mason Securities'],
  'Oriental Patron': ['Oriental Patron Asia', 'Oriental Patron Securities'],
  'RaffAello': ['RaffAello Capital', 'RaffAello Securities'],
  'HeungKong': ['HeungKong Capital', 'HeungKong Securities'],
  'China Sunrise': ['China Sunrise Capital', 'China Sunrise Securities (International)'],
  'Qilu': ['Qilu International Capital', 'Qilu International Securities'],
  'Tanrich': ['Tanrich Capital', 'Tanrich Securities', 'Tanrich Asia-Pac Securities'],
  'Emperor': ['Emperor Corporate Finance', 'Emperor Capital', 'Emperor Securities'],
  'Shanxi Securities': ['Shanxi Securities International Capital', 'Shanxi Securities International'],
  'Kingston': ['Kingston Corporate Finance', 'Kingston Securities'],
  'Eddid': ['Eddid Capital', 'Eddid Securities and Futures'],
};

// Build reverse lookup: variant → canonical
const BANK_CANONICAL: Map<string, string> = new Map();
for (const [canonical, variants] of Object.entries(BANK_FAMILIES)) {
  BANK_CANONICAL.set(canonical.toUpperCase(), canonical);
  for (const variant of variants) {
    BANK_CANONICAL.set(variant.toUpperCase(), canonical);
  }
}

function normalizeBankToFamily(name: string): string {
  const upper = name.toUpperCase();

  // Direct match
  if (BANK_CANONICAL.has(upper)) {
    return BANK_CANONICAL.get(upper)!;
  }

  // Partial match - check if name contains a known variant
  for (const [variant, canonical] of BANK_CANONICAL.entries()) {
    if (upper.includes(variant)) {
      return canonical;
    }
  }

  return name; // Return original if no match
}

function consolidateBanks(banks: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const bank of banks) {
    const normalized = normalizeBankToFamily(bank);
    const key = normalized.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}

// Determine if a bank is actually a sponsor based on raw_role text
// Fixes bug where banks are marked sponsor because role text mentions "Sponsor" in passing
function isActualSponsor(rawRole: string, isSponsorFlag: string): boolean {
  if (isSponsorFlag !== 'Y') return false;
  if (!rawRole) return false;

  const role = rawRole.toLowerCase();

  // TRUE sponsor patterns - role IS sponsor
  const trueSponsorPatterns = [
    /^(joint\s+)?sponsors?(\s+\(|$)/i,              // "Joint Sponsors" or "Sponsor" at start
    /^sole\s+sponsor/i,                              // "Sole Sponsor"
    /^sponsor\s+and\s+(overall\s+)?coordinator/i,   // "Sponsor and Coordinator"
    /^(joint\s+)?sponsor[,\s]/i,                    // "Joint Sponsor," at start
  ];

  // FALSE sponsor patterns - role MENTIONS sponsor but isn't sponsor
  const falseSponsorPatterns = [
    /sponsors?,\s+and\s+\(ii\)/i,                   // "(i) the Joint Sponsors, and (ii) the other..."
    /the\s+(joint\s+)?sponsors?,?\s+and/i,          // "the Joint Sponsors and..."
    /other\s+than\s+.*sponsor/i,                    // "other than the Sponsors"
  ];

  // Check false patterns first (more specific)
  for (const pattern of falseSponsorPatterns) {
    if (pattern.test(rawRole)) return false;
  }

  // Check true patterns
  for (const pattern of trueSponsorPatterns) {
    if (pattern.test(rawRole)) return true;
  }

  // Default: trust the is_sponsor flag if no pattern matched
  return true;
}

function enrichData(
  baseline: BaselineRow[],
  metrics: Map<number, DealMetrics>,
  chineseNames: Map<string, string>,
  dates: Map<number, string>,
  pdfUrls: Map<number, string>
): EnrichedDeal[] {
  const dealMap = new Map<string, EnrichedDeal>();

  for (const row of baseline) {
    const ticker = row.ticker;
    let deal = dealMap.get(ticker);

    if (!deal) {
      const tickerNum = parseInt(ticker);
      const m = metrics.get(tickerNum) || {} as DealMetrics;

      // Get date: first check manual overrides, then Excel, then row data
      let date = KNOWN_DATES[tickerNum] || dates.get(tickerNum) || row.date || '';

      // Fix dates: if unavailable or Excel serial, try to extract from PDF URL
      if (needsDateFix(date)) {
        const pdfUrl = pdfUrls.get(tickerNum);
        if (pdfUrl) {
          const urlDate = extractDateFromUrl(pdfUrl);
          if (urlDate) {
            date = urlDate;
          }
        }
        // If still an Excel serial number, convert it
        if (isExcelSerialDate(date)) {
          date = excelDateToString(parseInt(date));
        }
        // If still "Unavailable", set to empty string
        if (date.toLowerCase() === 'unavailable') {
          date = '';
        }
      }

      // Fix date formatting (e.g., "26/1/2021" -> "26/01/2021")
      date = fixDateFormat(date);

      // Apply deal size threshold - show null for sizes below minimum
      let sizeHKDm = m.sizeHKDm;
      if (sizeHKDm !== null && sizeHKDm < MIN_DEAL_SIZE_HKDM) {
        // Size is suspiciously low - likely placeholder value
        sizeHKDm = null;
      }

      // Get company name and append status note if exists
      let companyName = cleanCompanyName(row.company);
      const statusNote = COMPANY_STATUS_NOTES[tickerNum];
      if (statusNote) {
        companyName = `${companyName} ${statusNote}`;
      }

      deal = {
        ticker,
        company: companyName,
        companyCn: chineseNames.get(ticker) || null,
        type: row.type,
        date,
        shares: m.shares || null,
        price: m.price || null,
        sizeHKDm,
        sponsors: [],
        others: [],
        prospectusUrl: pdfUrls.get(tickerNum) || null,
      };
      dealMap.set(ticker, deal);
    }

    const bank = cleanBankName(row.bank_normalized);
    // Pass company name for self-reference detection
    if (!bank || isGarbageBank(bank, deal.company)) continue;

    // Fix sponsor detection: only treat as sponsor if role is actually "Sponsor"
    // not if it just mentions "Sponsor" in a compound role like "Sponsors, and (ii) the other Joint Bookrunners"
    const isTrueSponsor = isActualSponsor(row.raw_role, row.is_sponsor);

    if (isTrueSponsor) {
      if (!deal.sponsors.includes(bank)) deal.sponsors.push(bank);
      deal.others = deal.others.filter(b => b !== bank);
    } else if (!deal.sponsors.includes(bank) && !deal.others.includes(bank)) {
      deal.others.push(bank);
    }
  }

  // Manual sponsor overrides for deals where parser failed
  const SPONSOR_OVERRIDES: Record<string, string[]> = {
    '3750': ['CICC', 'China Securities', 'J.P. Morgan', 'Bank of America'], // CATL - parser failed
    '1970': ['Morgan Stanley'],                                              // IMAX China - sole sponsor
    '1612': ['BOSC International'],                                          // Vincent Medical - sole sponsor
    '2191': ['Credit Suisse', 'DBS', 'J.P. Morgan'],                        // SF REIT - joint sponsors
    '1931': ['BOCI'],                                                        // IVD Medical - sole sponsor
  };

  // Apply overrides
  for (const [ticker, sponsors] of Object.entries(SPONSOR_OVERRIDES)) {
    const deal = dealMap.get(ticker);
    if (deal) {
      for (const sponsor of sponsors) {
        const normalized = normalizeBankToFamily(sponsor);
        if (!deal.sponsors.includes(normalized)) {
          deal.sponsors.push(normalized);
        }
        deal.others = deal.others.filter(b => b.toUpperCase() !== normalized.toUpperCase());
      }
    }
  }

  // Apply bank family consolidation to each deal
  const deals = Array.from(dealMap.values());
  for (const deal of deals) {
    deal.sponsors = consolidateBanks(deal.sponsors);
    deal.others = consolidateBanks(deal.others);

    // Remove from others if now in sponsors (after normalization)
    const sponsorKeys = new Set(deal.sponsors.map(s => s.toUpperCase()));
    deal.others = deal.others.filter(o => !sponsorKeys.has(o.toUpperCase()));
  }

  return deals;
}

function cleanCompanyName(name: string): string {
  // Only remove stock class markers (-W, -B, -S), keep full name including "Limited", "Co.", etc.
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

function isGarbageBank(name: string, companyName?: string): boolean {
  if (!name || name.length < 3) return true;
  if (name.length > 100) return true; // Too long - likely prose

  const garbage = [
    // Original patterns
    /^futures$/i,
    /^securities$/i,
    /^capital$/i,
    /is a$/i,
    /Financial adviser/i,
    /joint stock/i,
    /into a/i,
    /Limited:$/i,

    // Prose fragments
    /was incorporated/i,
    /will be/i,
    /is a company/i,
    /is an exempted/i,
    /Your task/i,
    /Future is /i,
    /Future has /i,
    /Future\u2019s /i,           // right single quotation mark (')
    /Future's /i,               // straight apostrophe

    // Truncated entries
    /\($/,                      // ends with open paren
    /\. [A-Z]/,                 // period + space + capital (two entities joined)
    /\) is /i,                  // ") is an exempted" etc

    // Incomplete names
    /^Futures and Securities$/i,
    /^Futures Brokerage/i,
    /^Futures Corporation/i,
    /^Futures \(/i,             // "Futures (H.K.)" etc
    /^Future Development$/i,
    /^Future Holdings$/i,
    /^Future Management$/i,
    /^Future Pearl$/i,
    /^Future Global$/i,
    /^Future Optimal$/i,
    /^Future Holding$/i,
    /^Future$/i,
    /^Future VIPKID$/i,
    /^Future\u2019s Safe$/i,    // right single quotation mark variant
    /^Future's Safe$/i,         // straight apostrophe variant
    /^Future [A-Z]/i,           // "Future X" pattern - catches Future VIPKID, Future Pearl, etc.

    // Non-banks
    /Engineering$/i,            // Citiwell Engineering
    /Fashion$/i,                // Future Lifestyle Fashion
    /Commission of Hong Kong/i, // Regulators
    /Development$/i,            // Cities Development, etc.

    // Role prefixes not stripped
    /^Other Public Offer Underwriters/i,

    // Investment funds (cornerstone investors)
    /Investment Partnership/i,
    /Investment Fund$/i,

    // Location prefixes (parsing errors)
    /^Sheung Wan Hong Kong /i,
    /^Central Hong Kong /i,

    // Garbage phrases
    /Entities include/i,
  ];

  if (garbage.some(p => p.test(name))) return true;

  // Self-reference detection: filter if bank name matches company name
  if (companyName) {
    const bankUpper = name.toUpperCase().replace(/\s+/g, ' ');
    const companyUpper = companyName.toUpperCase().replace(/\s+/g, ' ');

    // Exact match
    if (bankUpper === companyUpper) return true;

    // Bank contains company name or vice versa (for cases like "MS GROUP HOLDINGS" vs "MS Group Holdings Limited")
    const bankCore = bankUpper.replace(/(LIMITED|LTD|COMPANY|CO|HOLDINGS|HOLDING|GROUP|INC|CORP)\.?/gi, '').trim();
    const companyCore = companyUpper.replace(/(LIMITED|LTD|COMPANY|CO|HOLDINGS|HOLDING|GROUP|INC|CORP)\.?/gi, '').trim();
    if (bankCore && companyCore && (bankCore === companyCore || bankCore.includes(companyCore) || companyCore.includes(bankCore))) {
      // Only if bank doesn't look like an actual bank
      if (!name.match(/Securities|Capital|Bank|Financial|Brokers|Investment/i)) {
        return true;
      }
    }
  }

  return false;
}

function saveEnrichedBaseline(deals: EnrichedDeal[]): void {
  const headers = ['ticker', 'company', 'company_cn', 'type', 'date', 'shares', 'price_hkd', 'size_hkdm', 'sponsors', 'others', 'prospectus_url'];

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
    d.prospectusUrl || '',
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  fs.writeFileSync('public/baseline-enriched.csv', '\uFEFF' + csv);
  console.log(`Saved ${deals.length} deals to public/baseline-enriched.csv`);
}

main();
