/**
 * Chinese Name Batch Coordinator
 *
 * Coordinates batch extraction of Chinese company names from HKEX prospectuses.
 * Outputs data for the hkex-chinese-name-extractor agent.
 *
 * Usage:
 *   tsx chinese-name-batch.ts prepare [batchSize]  - Prepare next batch for extraction
 *   tsx chinese-name-batch.ts record <ticker> <chineseName> - Record extracted name
 *   tsx chinese-name-batch.ts fail <ticker> <reason> - Mark extraction as failed
 *   tsx chinese-name-batch.ts status - Show batch status
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import {
  loadProgress,
  saveProgress,
  findDealsToProcess,
  getNextBatch,
  markCompleted,
  markFailed,
  downloadAndExtractPdf,
  getStats,
  extractChineseNameFromText,
  type DealToProcess,
  type ExtractionProgress
} from './extract-chinese-names.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const BATCH_FILE = path.join(PROJECT_ROOT, 'ddowl/current-batch.json');

interface BatchData {
  deals: Array<{
    ticker: string;
    company: string;
    url: string;
    textContent: string;
    pageCount: number;
  }>;
  created: string;
  batchSize: number;
}

/**
 * Prepare next batch of deals for extraction
 */
async function prepareBatch(batchSize: number = 20): Promise<void> {
  const progress = loadProgress();
  const batch = getNextBatch(progress, batchSize);

  if (batch.length === 0) {
    console.log('No more deals to process!');
    const stats = getStats();
    console.log(`\nFinal Statistics:`);
    console.log(`  Completed: ${stats.completed}`);
    console.log(`  Failed: ${stats.failed}`);
    console.log(`  Remaining: ${stats.pending}`);
    return;
  }

  console.log(`Preparing batch of ${batch.length} deals...`);

  const batchData: BatchData = {
    deals: [],
    created: new Date().toISOString(),
    batchSize: batch.length
  };

  for (const deal of batch) {
    console.log(`  Downloading ${deal.ticker}: ${deal.company}...`);
    try {
      const { text, pageCount } = await downloadAndExtractPdf(
        deal.prospectusUrl,
        deal.ticker,
        3  // First 3 pages
      );

      batchData.deals.push({
        ticker: deal.ticker,
        company: deal.company,
        url: deal.prospectusUrl,
        textContent: text,
        pageCount
      });

      console.log(`    ✓ ${pageCount} pages, ${text.length} chars`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`    ✗ Failed: ${errorMsg}`);
      markFailed(progress, deal.ticker, errorMsg);
    }
  }

  // Save batch data
  fs.writeFileSync(BATCH_FILE, JSON.stringify(batchData, null, 2));

  console.log(`\nBatch prepared with ${batchData.deals.length} deals.`);
  console.log(`Batch file: ${BATCH_FILE}`);
  console.log(`\nNext step: Run agent extraction on each deal.`);
}

/**
 * Record a successful extraction
 */
function recordExtraction(ticker: string, chineseName: string): void {
  const progress = loadProgress();

  if (!progress.pending.includes(ticker) && !progress.completed[ticker]) {
    console.log(`Warning: ${ticker} is not in pending list`);
  }

  markCompleted(progress, ticker, chineseName);
  console.log(`✓ Recorded: ${ticker} -> ${chineseName}`);
}

/**
 * Mark extraction as failed
 */
function recordFailure(ticker: string, reason: string): void {
  const progress = loadProgress();
  markFailed(progress, ticker, reason);
  console.log(`✗ Marked failed: ${ticker} - ${reason}`);
}

/**
 * Show current batch status
 */
function showStatus(): void {
  const stats = getStats();

  console.log('=== Chinese Name Extraction Status ===\n');
  console.log(`Total deals in CSV: ${stats.total}`);
  console.log(`Missing Chinese names: ${stats.missingChinese}`);
  console.log(`With prospectus URLs: ${stats.withUrls}`);
  console.log('');
  console.log(`Completed: ${stats.completed}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Pending: ${stats.pending}`);
  console.log('');
  console.log(`Progress: ${Math.round((stats.completed / stats.withUrls) * 100)}%`);

  // Show current batch if exists
  if (fs.existsSync(BATCH_FILE)) {
    const batch: BatchData = JSON.parse(fs.readFileSync(BATCH_FILE, 'utf-8'));
    console.log(`\nCurrent batch: ${batch.deals.length} deals from ${batch.created}`);
    console.log('Deals in batch:');
    batch.deals.forEach(d => {
      const progress = loadProgress();
      const status = progress.completed[d.ticker] ? '✓' :
                     progress.failed[d.ticker] ? '✗' : '○';
      console.log(`  ${status} ${d.ticker}: ${d.company}`);
    });
  }
}

/**
 * Output deal content for agent processing
 */
function outputDealForAgent(index: number): void {
  if (!fs.existsSync(BATCH_FILE)) {
    console.error('No batch prepared. Run: tsx chinese-name-batch.ts prepare');
    process.exit(1);
  }

  const batch: BatchData = JSON.parse(fs.readFileSync(BATCH_FILE, 'utf-8'));

  if (index < 0 || index >= batch.deals.length) {
    console.error(`Invalid index. Batch has ${batch.deals.length} deals (0-${batch.deals.length - 1})`);
    process.exit(1);
  }

  const deal = batch.deals[index];

  console.log('='.repeat(80));
  console.log(`DEAL ${index + 1}/${batch.deals.length}`);
  console.log(`Ticker: ${deal.ticker}`);
  console.log(`Company: ${deal.company}`);
  console.log(`URL: ${deal.url}`);
  console.log(`Pages: ${deal.pageCount}`);
  console.log('='.repeat(80));
  console.log('\nPROSPECTUS CONTENT (First 3 pages):\n');
  console.log(deal.textContent);
  console.log('\n' + '='.repeat(80));
  console.log(`\nExtract the Chinese company name for: ${deal.company}`);
  console.log('The Chinese name typically appears on the cover page near the English name.');
  console.log('='.repeat(80));
}

/**
 * List all deals in current batch
 */
function listBatch(): void {
  if (!fs.existsSync(BATCH_FILE)) {
    console.error('No batch prepared. Run: tsx chinese-name-batch.ts prepare');
    process.exit(1);
  }

  const batch: BatchData = JSON.parse(fs.readFileSync(BATCH_FILE, 'utf-8'));
  const progress = loadProgress();

  console.log(`Current batch: ${batch.deals.length} deals\n`);

  batch.deals.forEach((deal, i) => {
    const completed = progress.completed[deal.ticker];
    const failed = progress.failed[deal.ticker];
    const status = completed ? `✓ ${completed}` :
                   failed ? `✗ ${failed}` : '○ pending';

    console.log(`${i}. [${deal.ticker}] ${deal.company}`);
    console.log(`   Status: ${status}`);
  });
}

/**
 * Fetch Chinese company name from etnet.com.hk
 * URL pattern: https://www.etnet.com.hk/www/tc/stocks/realtime/quote.php?code=XXXXX
 *
 * Title format: "XXXX.HK 港股報價 | 中文名 | ENGLISH NAME | 香港即時股票股價 - etnet..."
 * If no Chinese name, format is: "XXXX.HK 港股報價 | ENGLISH | ENGLISH | ..."
 */
async function fetchChineseNameFromEtnet(ticker: string): Promise<string | null> {
  // Pad ticker to 5 digits (etnet uses 5-digit codes)
  const paddedTicker = ticker.padStart(5, '0');
  const url = `https://www.etnet.com.hk/www/tc/stocks/realtime/quote.php?code=${paddedTicker}`;

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      },
      timeout: 15000
    });

    const html = response.data as string;

    // Extract title: "XXXX.HK 港股報價 | 中文名 | ENGLISH NAME | 香港即時股票股價 - etnet..."
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (!titleMatch) return null;

    const title = titleMatch[1];
    // Split by | and get parts
    const parts = title.split('|').map(p => p.trim());

    // parts[0] = "XXXX.HK 港股報價"
    // parts[1] = Chinese name (or English if no Chinese)
    // parts[2] = English name
    // parts[3] = "香港即時股票股價 - etnet..."

    if (parts.length >= 3) {
      const chinesePart = parts[1];
      const englishPart = parts[2];

      // Check if the Chinese part actually has Chinese characters
      // and is different from the English part (some stocks show English twice)
      if (/[\u4e00-\u9fff]/.test(chinesePart)) {
        // Validate it's not just generic page text
        const skipTerms = ['港股', '報價', '即時', '股票', '股價', '香港'];
        const isGenericText = skipTerms.some(term => chinesePart.includes(term));

        if (!isGenericText && chinesePart.length >= 2 && chinesePart.length <= 30) {
          return chinesePart;
        }
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract Chinese names from web sources for all pending/failed deals
 */
async function extractFromWeb(maxDeals: number = 0): Promise<void> {
  const progress = loadProgress();

  // Get tickers to process - both pending AND failed (web might succeed where PDF failed)
  let tickersToProcess = [...progress.pending];

  // Also retry failed ones (except download errors)
  const failedToRetry = Object.entries(progress.failed)
    .filter(([_, reason]) => !reason.includes('Download error'))
    .map(([ticker, _]) => ticker);
  tickersToProcess = [...tickersToProcess, ...failedToRetry];

  if (maxDeals > 0) {
    tickersToProcess = tickersToProcess.slice(0, maxDeals);
  }

  console.log(`\n=== Web-Based Chinese Name Extraction ===`);
  console.log(`Processing ${tickersToProcess.length} deals (pending + retrying failed)...\n`);

  let successCount = 0;
  let failCount = 0;

  for (const ticker of tickersToProcess) {
    process.stdout.write(`[${ticker}] `);

    const chineseName = await fetchChineseNameFromEtnet(ticker);

    if (chineseName) {
      // Remove from failed if it was there
      if (progress.failed[ticker]) {
        delete progress.failed[ticker];
      }
      markCompleted(progress, ticker, chineseName);
      console.log(`✓ ${chineseName}`);
      successCount++;
    } else {
      // Only mark as failed if not already completed
      if (!progress.completed[ticker]) {
        markFailed(progress, ticker, 'Web extraction failed - name not found on etnet');
        console.log(`✗ Not found on etnet`);
      } else {
        console.log(`- Already completed`);
      }
      failCount++;
    }

    // Small delay to be nice to the server
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== Results ===`);
  console.log(`Extracted successfully: ${successCount}`);
  console.log(`Failed: ${failCount}`);

  const stats = getStats();
  console.log(`\n=== Overall Progress ===`);
  console.log(`Completed: ${stats.completed}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Remaining: ${stats.pending}`);
}

/**
 * Extract Chinese names using regex from all pending deals
 * - Downloads/caches PDFs
 * - Extracts text from first 3 pages
 * - Attempts regex extraction
 * - Auto-records successes, marks failures for manual review
 */
async function extractWithRegex(maxDeals: number = 0): Promise<void> {
  const progress = loadProgress();
  const dealsToProcess = findDealsToProcess();
  const tickerToInfo = new Map(dealsToProcess.map(d => [d.ticker, d]));

  // Get deals to process (either all pending or limited)
  let pendingTickers = [...progress.pending];
  if (maxDeals > 0) {
    pendingTickers = pendingTickers.slice(0, maxDeals);
  }

  console.log(`\n=== Regex Chinese Name Extraction ===`);
  console.log(`Processing ${pendingTickers.length} deals...\n`);

  let successCount = 0;
  let failCount = 0;
  let noChineseCount = 0;
  let downloadErrorCount = 0;

  for (const ticker of pendingTickers) {
    const deal = tickerToInfo.get(ticker);
    if (!deal) {
      console.log(`[${ticker}] No deal info found, skipping`);
      continue;
    }

    process.stdout.write(`[${ticker}] ${deal.company.substring(0, 30).padEnd(30)} `);

    try {
      // Download/cache PDF and extract text
      const { text, pageCount } = await downloadAndExtractPdf(
        deal.prospectusUrl,
        ticker,
        3  // First 3 pages
      );

      // Attempt regex extraction
      const chineseName = extractChineseNameFromText(text);

      if (chineseName) {
        markCompleted(progress, ticker, chineseName);
        console.log(`✓ ${chineseName}`);
        successCount++;
      } else {
        // Check if there are ANY Chinese characters in the text
        const hasAnyChinese = /[\u4e00-\u9fff]/.test(text);
        if (hasAnyChinese) {
          // Chinese chars present but no valid company name found
          markFailed(progress, ticker, 'Chinese chars found but no valid company name pattern');
          console.log(`? Chinese found but no valid name pattern`);
          failCount++;
        } else {
          // No Chinese characters at all (encoding issue)
          markFailed(progress, ticker, 'No Chinese characters in PDF text (encoding issue)');
          console.log(`✗ No Chinese in text (encoding issue)`);
          noChineseCount++;
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      markFailed(progress, ticker, `Download error: ${errorMsg}`);
      console.log(`✗ Download failed: ${errorMsg.substring(0, 50)}`);
      downloadErrorCount++;
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Extracted successfully: ${successCount}`);
  console.log(`Chinese found but no valid name: ${failCount}`);
  console.log(`No Chinese in text (encoding): ${noChineseCount}`);
  console.log(`Download errors: ${downloadErrorCount}`);
  console.log(`Total processed: ${pendingTickers.length}`);

  const stats = getStats();
  console.log(`\n=== Overall Progress ===`);
  console.log(`Completed: ${stats.completed}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Remaining: ${stats.pending}`);
}

// CLI interface
const command = process.argv[2];

switch (command) {
  case 'prepare':
    const batchSize = parseInt(process.argv[3] || '20', 10);
    prepareBatch(batchSize);
    break;

  case 'extract-regex':
    const maxDeals = parseInt(process.argv[3] || '0', 10);
    extractWithRegex(maxDeals);
    break;

  case 'extract-web':
    const maxWebDeals = parseInt(process.argv[3] || '0', 10);
    extractFromWeb(maxWebDeals);
    break;

  case 'record':
    const ticker = process.argv[3];
    const chineseName = process.argv.slice(4).join(' ');
    if (!ticker || !chineseName) {
      console.error('Usage: tsx chinese-name-batch.ts record <ticker> <chineseName>');
      process.exit(1);
    }
    recordExtraction(ticker, chineseName);
    break;

  case 'fail':
    const failTicker = process.argv[3];
    const reason = process.argv.slice(4).join(' ');
    if (!failTicker || !reason) {
      console.error('Usage: tsx chinese-name-batch.ts fail <ticker> <reason>');
      process.exit(1);
    }
    recordFailure(failTicker, reason);
    break;

  case 'status':
    showStatus();
    break;

  case 'get':
    const dealIndex = parseInt(process.argv[3] || '0', 10);
    outputDealForAgent(dealIndex);
    break;

  case 'list':
    listBatch();
    break;

  default:
    console.log('Chinese Name Batch Coordinator');
    console.log('');
    console.log('Usage: tsx chinese-name-batch.ts <command> [args]');
    console.log('');
    console.log('Commands:');
    console.log('  extract-web [max]    - Extract names from etnet.com.hk (RECOMMENDED)');
    console.log('  extract-regex [max]  - Extract names using PDF regex (0 = all pending)');
    console.log('  prepare [batchSize]  - Prepare next batch (default: 20)');
    console.log('  status               - Show extraction status');
    console.log('  list                 - List deals in current batch');
    console.log('  get <index>          - Output deal content for agent');
    console.log('  record <ticker> <cn> - Record extracted Chinese name');
    console.log('  fail <ticker> <msg>  - Mark extraction as failed');
}
