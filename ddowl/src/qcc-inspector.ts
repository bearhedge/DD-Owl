/**
 * QCC DOM Inspector
 *
 * Connects to an existing Chrome browser (with GoLink VPN active)
 * and dumps the DOM structure of QCC company pages for selector development.
 *
 * Usage:
 * 1. Open Chrome with remote debugging:
 *    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 * 2. Enable GoLink VPN extension in Chrome
 * 3. Navigate to QCC and login manually
 * 4. Run: npx tsx src/qcc-inspector.ts [url]
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';

const CHROME_DEBUG_PORT = 9222;

async function connectToChrome(): Promise<Browser> {
  try {
    // Connect to existing Chrome instance with remote debugging enabled
    const browserURL = `http://127.0.0.1:${CHROME_DEBUG_PORT}`;
    console.log(`Connecting to Chrome at ${browserURL}...`);

    const browser = await puppeteer.connect({
      browserURL,
      defaultViewport: null,
    });

    console.log('Connected to Chrome successfully');
    return browser;
  } catch (error) {
    console.error('Failed to connect to Chrome.');
    console.error('Make sure Chrome is running with remote debugging:');
    console.error('/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
    throw error;
  }
}

async function getCurrentQCCPage(browser: Browser): Promise<Page | null> {
  const pages = await browser.pages();

  for (const page of pages) {
    const url = page.url();
    if (url.includes('qcc.com') || url.includes('qichacha.com')) {
      return page;
    }
  }

  return null;
}

async function dumpPageStructure(page: Page): Promise<void> {
  const url = page.url();
  console.log(`\nAnalyzing: ${url}\n`);

  // Determine output filename based on URL
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const isCompanyProfile = url.includes('/firm/') || url.includes('/firm_');
  const isSearchResults = url.includes('/search') || url.includes('/web/search');

  let outputName = 'qcc-unknown';
  if (isCompanyProfile) outputName = 'qcc-company-profile';
  if (isSearchResults) outputName = 'qcc-search-results';

  const outputDir = path.join(process.cwd(), 'qcc-dom-dumps');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Dump full HTML
  const html = await page.content();
  const htmlPath = path.join(outputDir, `${outputName}-${timestamp}.html`);
  fs.writeFileSync(htmlPath, html);
  console.log(`Full HTML saved to: ${htmlPath}`);

  // Extract and analyze key elements
  const analysis = await page.evaluate(() => {
    const result: any = {
      url: window.location.href,
      title: document.title,
      pageType: 'unknown',
      elements: {},
    };

    // Detect page type
    if (result.url.includes('/firm/') || result.url.includes('/firm_')) {
      result.pageType = 'company_profile';
    } else if (result.url.includes('/search') || result.url.includes('/web/search')) {
      result.pageType = 'search_results';
    }

    // Find company name candidates
    result.elements.companyNameCandidates = [];
    const h1s = document.querySelectorAll('h1');
    h1s.forEach((h1, i) => {
      result.elements.companyNameCandidates.push({
        index: i,
        tag: 'h1',
        text: h1.textContent?.trim().slice(0, 100),
        className: h1.className,
        id: h1.id,
      });
    });

    // Find elements with "title" or "name" in class
    const titleElements = document.querySelectorAll('[class*="title"], [class*="name"], [class*="firm"]');
    titleElements.forEach((el, i) => {
      if (i < 20) { // Limit to first 20
        result.elements.companyNameCandidates.push({
          index: h1s.length + i,
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 100),
          className: el.className,
          id: (el as HTMLElement).id,
        });
      }
    });

    // Find all tables (registration info is usually in tables)
    result.elements.tables = [];
    const tables = document.querySelectorAll('table');
    tables.forEach((table, tableIndex) => {
      const tableInfo: any = {
        index: tableIndex,
        className: table.className,
        id: table.id,
        rows: [],
      };

      const rows = table.querySelectorAll('tr');
      rows.forEach((row, rowIndex) => {
        if (rowIndex < 15) { // Limit rows per table
          const cells: string[] = [];
          row.querySelectorAll('td, th').forEach(cell => {
            cells.push(cell.textContent?.trim().slice(0, 80) || '');
          });
          if (cells.length > 0) {
            tableInfo.rows.push(cells);
          }
        }
      });

      if (tableInfo.rows.length > 0) {
        result.elements.tables.push(tableInfo);
      }
    });

    // Find section headers (股东信息, 主要人员, etc.)
    result.elements.sectionHeaders = [];
    const headers = document.querySelectorAll('h2, h3, h4, [class*="header"], [class*="section"]');
    headers.forEach((header, i) => {
      const text = header.textContent?.trim() || '';
      if (text.length > 0 && text.length < 50) {
        result.elements.sectionHeaders.push({
          index: i,
          tag: header.tagName.toLowerCase(),
          text: text,
          className: header.className,
        });
      }
    });

    // Find links to other company profiles
    result.elements.profileLinks = [];
    const profileLinks = document.querySelectorAll('a[href*="/firm/"], a[href*="/run/"]');
    profileLinks.forEach((link, i) => {
      if (i < 30) { // Limit to first 30
        result.elements.profileLinks.push({
          text: link.textContent?.trim().slice(0, 50),
          href: (link as HTMLAnchorElement).href,
          type: (link as HTMLAnchorElement).href.includes('/run/') ? 'individual' : 'company',
        });
      }
    });

    // Find tab elements (法律诉讼, 经营风险 counts)
    result.elements.tabs = [];
    const tabs = document.querySelectorAll('[class*="tab"], [role="tab"], [class*="nav"] a, [class*="menu"] a');
    tabs.forEach((tab, i) => {
      const text = tab.textContent?.trim() || '';
      if (text.length > 0 && text.length < 30) {
        result.elements.tabs.push({
          index: i,
          text: text,
          className: tab.className,
        });
      }
    });

    // Find div/section elements that might contain registration info
    result.elements.infoPanels = [];
    const panels = document.querySelectorAll('[class*="info"], [class*="detail"], [class*="basic"], [class*="cominfo"]');
    panels.forEach((panel, i) => {
      if (i < 10) {
        const text = panel.textContent?.trim().slice(0, 200) || '';
        result.elements.infoPanels.push({
          index: i,
          tag: panel.tagName.toLowerCase(),
          className: panel.className,
          textPreview: text,
        });
      }
    });

    // Look for specific Chinese labels
    result.elements.labelValuePairs = [];
    const allText = document.body.innerText;
    const labels = [
      '企业名称', '公司名称', '商业登记号码', '公司编号', '企业状态',
      '成立日期', '企业类型', '办事处地址', '注册地址', '法定代表人',
      '注册资本', '股东信息', '主要人员', '董事', '最终受益人'
    ];

    labels.forEach(label => {
      const regex = new RegExp(`${label}[：:]*\\s*([^\\n]+)`, 'g');
      let match;
      while ((match = regex.exec(allText)) !== null) {
        result.elements.labelValuePairs.push({
          label: label,
          value: match[1].trim().slice(0, 100),
        });
      }
    });

    return result;
  });

  // Save analysis JSON
  const analysisPath = path.join(outputDir, `${outputName}-analysis-${timestamp}.json`);
  fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
  console.log(`Analysis saved to: ${analysisPath}`);

  // Print summary
  console.log('\n=== PAGE ANALYSIS SUMMARY ===\n');
  console.log(`Page Type: ${analysis.pageType}`);
  console.log(`Title: ${analysis.title}`);

  console.log('\n--- Company Name Candidates ---');
  analysis.elements.companyNameCandidates.slice(0, 10).forEach((el: any) => {
    console.log(`  [${el.tag}${el.className ? '.' + el.className.split(' ')[0] : ''}] "${el.text}"`);
  });

  console.log('\n--- Tables Found ---');
  analysis.elements.tables.forEach((table: any) => {
    console.log(`  Table ${table.index} (class="${table.className}")`);
    table.rows.slice(0, 5).forEach((row: string[]) => {
      console.log(`    ${row.join(' | ')}`);
    });
    if (table.rows.length > 5) {
      console.log(`    ... (${table.rows.length - 5} more rows)`);
    }
  });

  console.log('\n--- Section Headers ---');
  analysis.elements.sectionHeaders.slice(0, 15).forEach((h: any) => {
    console.log(`  [${h.tag}] "${h.text}"`);
  });

  console.log('\n--- Label/Value Pairs Found ---');
  analysis.elements.labelValuePairs.forEach((pair: any) => {
    console.log(`  ${pair.label}: ${pair.value}`);
  });

  console.log('\n--- Profile Links ---');
  analysis.elements.profileLinks.slice(0, 10).forEach((link: any) => {
    console.log(`  [${link.type}] ${link.text} -> ${link.href.slice(0, 60)}...`);
  });

  console.log('\n--- Tabs ---');
  analysis.elements.tabs.slice(0, 10).forEach((tab: any) => {
    console.log(`  "${tab.text}"`);
  });
}

async function navigateAndDump(browser: Browser, url: string): Promise<void> {
  const page = await browser.newPage();

  console.log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait a bit for dynamic content
  await new Promise(r => setTimeout(r, 2000));

  await dumpPageStructure(page);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetUrl = args[0];

  console.log('QCC DOM Inspector');
  console.log('=================\n');

  const browser = await connectToChrome();

  try {
    if (targetUrl) {
      // Navigate to specific URL
      await navigateAndDump(browser, targetUrl);
    } else {
      // Analyze current QCC page if open
      const qccPage = await getCurrentQCCPage(browser);

      if (qccPage) {
        await dumpPageStructure(qccPage);
      } else {
        console.log('No QCC page found in open tabs.');
        console.log('Either:');
        console.log('  1. Navigate to a QCC page in Chrome, then run this script again');
        console.log('  2. Provide a URL as argument: npx tsx src/qcc-inspector.ts https://www.qcc.com/firm/...');
      }
    }
  } finally {
    // Don't close the browser - we're just inspecting
    console.log('\nInspection complete. Browser left open.');
  }
}

main().catch(console.error);
