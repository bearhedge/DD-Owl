/**
 * DD Owl Scraping Benchmark
 *
 * Tests axios vs Puppeteer success rates on real search results
 * Run with: SERPER_API_KEY=xxx npx tsx benchmark.ts
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

const SERPER_API_KEY = process.env.SERPER_API_KEY || '';
const TEST_SUBJECT = '徐明星';
const MAX_URLS = 50; // Test first 50 unique URLs

interface FetchResult {
  url: string;
  axios: {
    success: boolean;
    contentLength: number;
    time: number;
    error?: string;
  };
  puppeteer: {
    success: boolean;
    contentLength: number;
    time: number;
    error?: string;
  };
}

// Search Serper for URLs
async function getSearchUrls(): Promise<string[]> {
  const queries = [
    `"${TEST_SUBJECT}" 洗钱`,
    `"${TEST_SUBJECT}" 欺诈`,
    `"${TEST_SUBJECT}" 调查`,
    `"${TEST_SUBJECT}" 被捕`,
    `"${TEST_SUBJECT}" 诉讼`,
  ];

  const urls = new Set<string>();

  for (const query of queries) {
    try {
      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: query, gl: 'cn', hl: 'zh-cn', num: 20 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' } }
      );

      for (const result of response.data.organic || []) {
        urls.add(result.link);
        if (urls.size >= MAX_URLS) break;
      }
    } catch (e) {
      console.error(`Search failed for: ${query}`);
    }

    if (urls.size >= MAX_URLS) break;
  }

  return Array.from(urls);
}

// Fetch with axios
async function fetchWithAxios(url: string): Promise<{ success: boolean; contentLength: number; time: number; error?: string }> {
  const start = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, aside').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    return {
      success: text.length > 100,
      contentLength: text.length,
      time: Date.now() - start,
    };
  } catch (e: any) {
    return {
      success: false,
      contentLength: 0,
      time: Date.now() - start,
      error: e.code || e.message?.slice(0, 50),
    };
  }
}

// Fetch with Puppeteer
async function fetchWithPuppeteer(
  browser: puppeteer.Browser,
  url: string
): Promise<{ success: boolean; contentLength: number; time: number; error?: string }> {
  const start = Date.now();
  let page: puppeteer.Page | null = null;

  try {
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    // Wait a bit for JS to render
    await new Promise(r => setTimeout(r, 1000));

    const text = await page.evaluate(() => {
      const body = document.body;
      if (!body) return '';

      // Remove unwanted elements
      const unwanted = body.querySelectorAll('script, style, nav, footer, header, aside, .ad, .advertisement');
      unwanted.forEach(el => el.remove());

      return body.innerText?.replace(/\s+/g, ' ').trim() || '';
    });

    await page.close();

    return {
      success: text.length > 100,
      contentLength: text.length,
      time: Date.now() - start,
    };
  } catch (e: any) {
    if (page) await page.close().catch(() => {});
    return {
      success: false,
      contentLength: 0,
      time: Date.now() - start,
      error: e.message?.slice(0, 50),
    };
  }
}

async function runBenchmark() {
  console.log('='.repeat(60));
  console.log('DD OWL SCRAPING BENCHMARK');
  console.log('='.repeat(60));
  console.log(`Subject: ${TEST_SUBJECT}`);
  console.log(`Max URLs: ${MAX_URLS}`);
  console.log('');

  // Get URLs
  console.log('Fetching search results from Serper...');
  const urls = await getSearchUrls();
  console.log(`Found ${urls.length} unique URLs to test\n`);

  if (urls.length === 0) {
    console.error('No URLs found. Check SERPER_API_KEY.');
    process.exit(1);
  }

  // Launch Puppeteer
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const results: FetchResult[] = [];

  // Test each URL
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const hostname = new URL(url).hostname;

    process.stdout.write(`[${i + 1}/${urls.length}] ${hostname.slice(0, 30).padEnd(30)} `);

    // Test axios
    const axiosResult = await fetchWithAxios(url);
    process.stdout.write(axiosResult.success ? 'AXIOS:OK ' : 'AXIOS:FAIL ');

    // Test Puppeteer
    const puppeteerResult = await fetchWithPuppeteer(browser, url);
    process.stdout.write(puppeteerResult.success ? 'PPTR:OK ' : 'PPTR:FAIL ');

    // Show content lengths
    console.log(`(${axiosResult.contentLength}/${puppeteerResult.contentLength} chars)`);

    results.push({
      url,
      axios: axiosResult,
      puppeteer: puppeteerResult,
    });

    // Small delay
    await new Promise(r => setTimeout(r, 200));
  }

  await browser.close();

  // Calculate stats
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));

  const axiosSuccess = results.filter(r => r.axios.success).length;
  const puppeteerSuccess = results.filter(r => r.puppeteer.success).length;
  const bothSuccess = results.filter(r => r.axios.success && r.puppeteer.success).length;
  const eitherSuccess = results.filter(r => r.axios.success || r.puppeteer.success).length;
  const axiosOnly = results.filter(r => r.axios.success && !r.puppeteer.success).length;
  const puppeteerOnly = results.filter(r => !r.axios.success && r.puppeteer.success).length;
  const bothFail = results.filter(r => !r.axios.success && !r.puppeteer.success).length;

  const axiosAvgTime = results.reduce((sum, r) => sum + r.axios.time, 0) / results.length;
  const puppeteerAvgTime = results.reduce((sum, r) => sum + r.puppeteer.time, 0) / results.length;

  console.log(`\nTotal URLs tested: ${results.length}`);
  console.log('');
  console.log('SUCCESS RATES:');
  console.log(`  axios only:      ${axiosSuccess}/${results.length} (${(axiosSuccess/results.length*100).toFixed(1)}%)`);
  console.log(`  Puppeteer only:  ${puppeteerSuccess}/${results.length} (${(puppeteerSuccess/results.length*100).toFixed(1)}%)`);
  console.log(`  Either method:   ${eitherSuccess}/${results.length} (${(eitherSuccess/results.length*100).toFixed(1)}%)`);
  console.log('');
  console.log('BREAKDOWN:');
  console.log(`  Both succeed:    ${bothSuccess}`);
  console.log(`  axios only:      ${axiosOnly} (axios works, Puppeteer fails)`);
  console.log(`  Puppeteer only:  ${puppeteerOnly} (Puppeteer works, axios fails)`);
  console.log(`  Both fail:       ${bothFail}`);
  console.log('');
  console.log('AVERAGE TIME:');
  console.log(`  axios:           ${axiosAvgTime.toFixed(0)}ms`);
  console.log(`  Puppeteer:       ${puppeteerAvgTime.toFixed(0)}ms`);
  console.log(`  Speed ratio:     Puppeteer is ${(puppeteerAvgTime/axiosAvgTime).toFixed(1)}x slower`);

  // Show failures
  if (bothFail > 0) {
    console.log('\nURLs THAT FAILED BOTH METHODS:');
    results.filter(r => !r.axios.success && !r.puppeteer.success).forEach(r => {
      console.log(`  ${new URL(r.url).hostname}: axios=${r.axios.error}, pptr=${r.puppeteer.error}`);
    });
  }

  // Recommendation
  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDATION');
  console.log('='.repeat(60));

  if (puppeteerOnly > axiosOnly) {
    console.log(`Puppeteer recovers ${puppeteerOnly} URLs that axios misses.`);
    console.log('Recommend: axios first, Puppeteer fallback.');
  } else if (axiosOnly > puppeteerOnly) {
    console.log(`Surprisingly, axios succeeds on ${axiosOnly} URLs where Puppeteer fails.`);
    console.log('Recommend: axios first, Puppeteer fallback.');
  } else {
    console.log('Both methods have similar coverage.');
    console.log('Recommend: axios only (faster) unless you need the extra coverage.');
  }

  console.log(`\nCombined coverage: ${(eitherSuccess/results.length*100).toFixed(1)}%`);
  console.log(`Unfetchable: ${bothFail} URLs (${(bothFail/results.length*100).toFixed(1)}%)`);
}

runBenchmark().catch(console.error);
