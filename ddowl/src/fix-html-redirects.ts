/**
 * Fix HTML redirect failures - these are .htm pages that link to actual PDFs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import xlsx from 'xlsx';
import { extractBanksFromProspectus } from './prospectus-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_FILE = path.join(__dirname, '../.historical-import-results.json');

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  note?: string;
  banks?: any[];
}

async function fetchHtmlAndFindPdf(htmlUrl: string): Promise<string | null> {
  try {
    const response = await axios.get(htmlUrl, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const html = response.data;

    // Look for "Parties Involved" or "Directors and Parties" PDF link
    const patterns = [
      /href="([^"]+\.pdf)"[^>]*>.*?(?:Parties Involved|Directors and Parties)/i,
      /href="([^"]+\.pdf)"[^>]*>.*?(?:Directors, Supervisors and Parties)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const pdfPath = match[1];
        // Construct full URL
        const baseUrl = htmlUrl.substring(0, htmlUrl.lastIndexOf('/') + 1);
        return baseUrl + pdfPath;
      }
    }

    // Fallback: look for any PDF with "parties" in the link text
    const fallbackMatch = html.match(/href="([^"]+\.pdf)"[^>]*>[^<]*parties[^<]*/i);
    if (fallbackMatch) {
      const baseUrl = htmlUrl.substring(0, htmlUrl.lastIndexOf('/') + 1);
      return baseUrl + fallbackMatch[1];
    }

    return null;
  } catch (error) {
    return null;
  }
}

async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    return Buffer.from(response.data);
  } catch (error) {
    return null;
  }
}

async function fixHtmlRedirects() {
  // Read results
  const results: ImportResult[] = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

  // Find HTML redirect failures
  const htmlFailures = results.filter(r => r.error === 'Invalid PDF');

  console.log(`Found ${htmlFailures.length} HTML redirect failures to fix\n`);

  // Read Excel for URLs
  const wb = xlsx.readFile(path.join(__dirname, '../../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx'));
  const sheet = wb.Sheets['Index'];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  // Build ticker to URL map
  const tickerToUrl: Record<number, string> = {};
  for (let i = 2; i < rows.length; i++) {
    const ticker = rows[i][1];
    const url = rows[i][4];
    if (ticker) tickerToUrl[ticker] = String(url);
  }

  let fixed = 0;
  let failed = 0;

  for (const failure of htmlFailures) {
    const htmlUrl = tickerToUrl[failure.ticker];

    console.log(`[${failure.ticker}] ${failure.company}`);
    console.log(`  HTML: ${htmlUrl}`);

    // Find PDF link in HTML
    const pdfUrl = await fetchHtmlAndFindPdf(htmlUrl);

    if (!pdfUrl) {
      console.log(`  ✗ Could not find Parties Involved PDF link`);
      failed++;
      continue;
    }

    console.log(`  PDF: ${pdfUrl}`);

    // Download PDF
    const pdfBuffer = await downloadPdf(pdfUrl);

    if (!pdfBuffer) {
      console.log(`  ✗ Failed to download PDF`);
      failed++;
      continue;
    }

    // Verify it's a PDF
    if (pdfBuffer.slice(0, 5).toString() !== '%PDF-') {
      console.log(`  ✗ Downloaded file is not a valid PDF`);
      failed++;
      continue;
    }

    // Parse banks
    const result = await extractBanksFromProspectus(pdfBuffer);

    if (!result.sectionFound) {
      console.log(`  ✗ Section not found in PDF`);
      // Update result
      const idx = results.findIndex(r => r.ticker === failure.ticker);
      if (idx >= 0) {
        results[idx].error = 'Parties Involved section not found';
        results[idx].note = 'HTML redirect resolved but section not found in PDF';
      }
      failed++;
      continue;
    }

    if (result.banks.length === 0) {
      console.log(`  ✗ No banks extracted`);
      const idx = results.findIndex(r => r.ticker === failure.ticker);
      if (idx >= 0) {
        results[idx].error = 'No banks found in section';
        results[idx].note = 'HTML redirect resolved but no banks extracted';
      }
      failed++;
      continue;
    }

    // Success!
    console.log(`  ✓ Found ${result.banks.length} banks`);
    result.banks.forEach(b => {
      const marker = b.isLead ? '★' : ' ';
      console.log(`    ${marker} ${b.bankNormalized} [${b.roles.join(', ')}]`);
    });

    // Update results
    const idx = results.findIndex(r => r.ticker === failure.ticker);
    if (idx >= 0) {
      results[idx] = {
        ticker: failure.ticker,
        company: failure.company,
        success: true,
        banksFound: result.banks.length,
        banks: result.banks.map(b => ({
          name: b.bank,
          normalized: b.bankNormalized,
          roles: [...b.roles],
          isLead: b.isLead,
          rawRole: b.rawRole,
        })),
      };
    }

    fixed++;
    console.log('');

    // Small delay
    await new Promise(r => setTimeout(r, 300));
  }

  // Save updated results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  console.log('\n=== Summary ===');
  console.log(`Fixed: ${fixed}`);
  console.log(`Failed: ${failed}`);
}

fixHtmlRedirects().catch(console.error);
