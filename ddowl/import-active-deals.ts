/**
 * Import Active Deals from HKEX IPO Analysis Excel
 *
 * Parses the Excel file and groups by company to create active-deals.csv
 * Output columns: company, oc_date, sponsors, others, document_url
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bank name normalization map
const bankNormalization: Record<string, string> = {
  'China International Capital Corporation Hong Kong Securities Limited': 'CICC',
  'CICC': 'CICC',
  'CLSA Limited': 'CLSA',
  'Citigroup Global Markets Asia Limited': 'Citi',
  'CMB International Capital Limited': 'CMB',
  'CMB International Capital Corporation Limited': 'CMB',
  'China Merchants Securities (HK) Co., Limited': 'CMS',
  'Haitong International Securities Company Limited': 'Haitong',
  'Huatai International Holdings Limited': 'Huatai',
  'Huatai Financial Holdings (Hong Kong) Limited': 'Huatai',
  'Goldman Sachs (Asia) L.L.C.': 'Goldman Sachs',
  'Morgan Stanley Asia Limited': 'Morgan Stanley',
  'UBS Securities Asia Limited': 'UBS',
  'UBS AG Hong Kong Branch': 'UBS',
  'J.P. Morgan Securities (Asia Pacific) Limited': 'JPMorgan',
  'BofA Securities': 'BofA',
  'Credit Suisse (Hong Kong) Limited': 'Credit Suisse',
  'Deutsche Bank AG, Hong Kong Branch': 'Deutsche Bank',
  'HSBC Corporate Finance (Hong Kong) Limited': 'HSBC',
  'Guotai Junan Capital Limited': 'Guotai Junan',
  'Guotai Junan Securities (Hong Kong) Limited': 'Guotai Junan',
  'GF Capital (Hong Kong) Limited': 'GF Securities',
  'GF Securities (Hong Kong) Brokerage Limited': 'GF Securities',
  'CITIC Securities Company Limited': 'CITIC',
  'CITIC Securities Brokerage (HK) Limited': 'CITIC',
  'China Securities (International) Corporate Finance Company Limited': 'China Securities',
  'China Galaxy International Securities (Hong Kong) Co., Limited': 'China Galaxy',
  'BOC International Holdings Limited': 'BOCI',
  'SBI China Capital Financial Services Limited': 'SBI',
  'ABCI Capital Limited': 'ABCI',
  'CEB International Capital Corporation Limited': 'CEB',
  'China Everbright Securities (HK) Limited': 'CEB',
  'Jefferies Hong Kong Limited': 'Jefferies',
  'Macquarie Capital Limited': 'Macquarie',
  'DBS Asia Capital Limited': 'DBS',
  'SPDB International Capital Limited': 'SPDB',
  'Orient Securities (Hong Kong) Limited': 'Orient Securities',
  'Dongxing Securities (Hong Kong) Company Limited': 'Dongxing',
  'First Shanghai Capital Limited': 'First Shanghai',
  'Soochow Securities International Brokerage Limited': 'Soochow',
  'Southwest Securities (HK) Capital Limited': 'Southwest Securities',
  'Zhongtai International Capital Limited': 'Zhongtai',
  'Fosun Hani Securities Limited': 'Fosun Hani',
  'Fosun Hani Capital Limited': 'Fosun Hani',
  'Valuable Capital Limited': 'Valuable Capital',
  'CCB International Capital Limited': 'CCB',
  'ICBC International Capital Limited': 'ICBC',
  'ICBC International Securities Limited': 'ICBC',
  'Bank of China International Holdings Limited': 'BOCI',
  'Changjiang Securities Brokerage (HK) Limited': 'Changjiang',
  'Industrial Securities (Hong Kong) Brokerage Limited': 'Industrial Securities',
  'Tiger Brokers (Hong Kong) Global Limited': 'Tiger Brokers',
  'Futu Securities International (Hong Kong) Limited': 'Futu',
  'Livermore Holdings Limited': 'Livermore',
};

function normalizeBank(fullName: string): string {
  // Check exact match first
  if (bankNormalization[fullName]) {
    return bankNormalization[fullName];
  }

  // Check partial matches
  const fullNameLower = fullName.toLowerCase();
  for (const [key, value] of Object.entries(bankNormalization)) {
    if (fullNameLower.includes(key.toLowerCase())) {
      return value;
    }
  }

  // Apply common simplifications
  let name = fullName
    .replace(/\s*\(Hong Kong\)\s*/gi, ' ')
    .replace(/\s*\(HK\)\s*/gi, ' ')
    .replace(/\s*Limited$/i, '')
    .replace(/\s*Ltd\.?$/i, '')
    .replace(/\s*Company$/i, '')
    .replace(/\s*Corporation$/i, '')
    .replace(/\s*Co\.,?\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If still too long, try to extract core name
  if (name.length > 25) {
    // Try to find the main entity name before qualifiers
    const parts = name.split(/\s+(International|Capital|Securities|Brokerage|Financial|Holdings|Corporate|Finance)/i);
    if (parts[0] && parts[0].length >= 3) {
      name = parts[0].trim();
    }
  }

  return name;
}

interface ExcelRow {
  Company: string;
  Bank: string;
  Role: string;
  Source: string;
  Document: string;
  Appointment: string;
}

interface ActiveDeal {
  company: string;
  ocDate: string;
  sponsors: string[];
  others: string[];
  documentUrl: string;
}

function parseOCDate(documentStr: string): string | null {
  // Format: "OC Announcement - 10/07/2025"
  const match = documentStr.match(/OC Announcement\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
  if (match) {
    return match[1]; // Returns DD/MM/YYYY
  }
  return null;
}

function formatDateForCSV(dateStr: string): string {
  // Input: DD/MM/YYYY, Output: DD/MM/YYYY (keep same format as historical)
  return dateStr;
}

function main() {
  const excelPath = path.resolve(__dirname, '../Reference files/1. HKEX IPO Active (Live)/HKEX_IPO_Analysis_2025v2 (1).xlsx');
  const outputPath = path.resolve(__dirname, 'public/active-deals.csv');

  console.log('Reading Excel file:', excelPath);

  if (!fs.existsSync(excelPath)) {
    console.error('Excel file not found:', excelPath);
    process.exit(1);
  }

  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows: ExcelRow[] = XLSX.utils.sheet_to_json(worksheet);

  console.log(`Found ${rows.length} rows`);

  // Group by company
  const dealMap = new Map<string, ActiveDeal>();

  for (const row of rows) {
    const company = row.Company?.trim();
    if (!company) continue;

    const ocDate = parseOCDate(row.Document || '');
    const bankName = normalizeBank(row.Bank || '');
    const role = row.Role || '';
    const documentUrl = row.Source || '';

    if (!dealMap.has(company)) {
      dealMap.set(company, {
        company,
        ocDate: ocDate || '',
        sponsors: [],
        others: [],
        documentUrl: documentUrl
      });
    }

    const deal = dealMap.get(company)!;

    // Update to most recent OC date if this one is newer
    if (ocDate && ocDate > deal.ocDate) {
      deal.ocDate = ocDate;
      deal.documentUrl = documentUrl; // Use URL from most recent OC announcement
    }

    // Categorize bank by role
    const isSponsor = role.toLowerCase().includes('sponsor');

    if (isSponsor) {
      if (!deal.sponsors.includes(bankName)) {
        deal.sponsors.push(bankName);
      }
    } else {
      if (!deal.others.includes(bankName)) {
        deal.others.push(bankName);
      }
    }
  }

  console.log(`Grouped into ${dealMap.size} unique companies`);

  // Convert to array and sort by OC date (most recent first)
  const deals = Array.from(dealMap.values()).sort((a, b) => {
    // Parse DD/MM/YYYY for comparison
    const parseDate = (d: string) => {
      const parts = d.split('/');
      if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime();
      }
      return 0;
    };
    return parseDate(b.ocDate) - parseDate(a.ocDate);
  });

  // Generate CSV
  const csvHeader = 'company,oc_date,sponsors,others,document_url';
  const csvRows = deals.map(deal => {
    const escapeCsv = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
      escapeCsv(deal.company),
      escapeCsv(deal.ocDate),
      escapeCsv(deal.sponsors.join('; ')),
      escapeCsv(deal.others.join('; ')),
      escapeCsv(deal.documentUrl)
    ].join(',');
  });

  const csvContent = [csvHeader, ...csvRows].join('\n');

  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  console.log(`Wrote ${deals.length} deals to ${outputPath}`);

  // Print sample
  console.log('\nSample output (first 5):');
  deals.slice(0, 5).forEach(deal => {
    console.log(`  ${deal.company}`);
    console.log(`    OC Date: ${deal.ocDate}`);
    console.log(`    Sponsors: ${deal.sponsors.join(', ')}`);
    console.log(`    Others: ${deal.others.join(', ')}`);
    console.log('');
  });
}

main();
