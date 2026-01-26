/**
 * HKEX OC Announcement Scraper
 *
 * Uses Puppeteer to:
 * 1. Accept the disclaimer
 * 2. Download OC announcement PDFs
 * 3. Extract bank/role data from last pages
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { PDFParse } from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeRole, isLeadRole, NormalizedRole } from './role-normalizer.js';

// Types for extracted data
export interface BankAppointment {
  bank: string;
  rawRole: string;  // Original text from PDF
  roles: NormalizedRole[];  // Normalized categories
  isLead: boolean;  // true if Sponsor or Coordinator (decision makers)
}

export interface OCAnnouncementData {
  company: string;
  companyChineseName?: string;
  appointmentDate: string;
  banks: BankAppointment[];
  sourceUrl: string;
}

/**
 * Extract bank appointment data from PDF buffer
 */
export async function extractBankDataFromPdf(pdfBuffer: Buffer): Promise<{
  company: string;
  companyChineseName?: string;
  banks: BankAppointment[];
}> {
  const uint8Array = new Uint8Array(pdfBuffer);

  // Configure CMap for Chinese font support
  const cMapUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/cmaps/');
  const parser = new PDFParse({
    data: uint8Array,
    cMapUrl: cMapUrl,
    cMapPacked: true,
  });
  const result = await parser.getText();

  const banks: BankAppointment[] = [];
  let company = '';
  let companyChineseName = '';

  // Use first 2 pages for company name extraction (cover page + first content page)
  const frontPages = result.pages.slice(0, 2).map(p => p.text).join('\n');
  // All pages for bank extraction
  const allText = result.pages.map(p => p.text).join('\n');

  // Extract company name from front pages - look for standard patterns
  const companyPatterns = [
    // All caps company name followed by Chinese or "(Incorporated..."
    /^([A-Z][A-Z\s']+(?:HOLDINGS\s+)?LIMITED)\s*$/m,
    // Standard mixed case
    /^([A-Z][A-Za-z\s]+(?:Co\.,?\s*Ltd\.?|Limited|Inc\.?))\s*$/m,
    // From "This announcement is made by" or "order of"
    /announcing.*?of\s+([A-Z][A-Za-z\s,']+(?:Ltd\.?|Limited))/i,
    /order.*?of\s+([A-Z][A-Za-z\s,']+(?:Ltd\.?|Limited))/i,
    // From "providing information about"
    /providing\s+information\s+about\s+([A-Z][A-Za-z\s,']+(?:Ltd\.?|Limited))/i,
  ];

  for (const pattern of companyPatterns) {
    const match = frontPages.match(pattern);
    if (match && match[1].length > 10 && match[1].length < 100) {
      // Clean up and normalize
      company = match[1]
        .trim()
        .replace(/\s+/g, ' ');
      break;
    }
  }

  // Extract Chinese company name from FRONT PAGES ONLY
  // Look for Chinese text near English company name on cover page
  // First, normalize spaces between Chinese characters (PDFs often have "北 京" instead of "北京")
  const normalizedFrontPages = frontPages.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
  // Apply normalization multiple times to handle "北 京 極" -> "北京 極" -> "北京極"
  const fullyNormalized = normalizedFrontPages
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
  const chineseMatches = fullyNormalized.match(/[\u4e00-\u9fa5]{4,}/g) || [];

  // First try: Find Chinese text that ends with company suffixes
  for (const match of chineseMatches) {
    // Skip if it's JUST a suffix (not a real company name)
    if (match === '有限公司' || match === '股份有限公司' || match === '股份公司') continue;

    // Good patterns: ends with 有限公司, 股份有限公司, 控股, etc.
    if (match.match(/(有限公司|股份公司|控股|集團)$/)) {
      companyChineseName = match;
      break;
    }
  }

  // Second try: Find any reasonably long Chinese string (likely company name on cover)
  if (!companyChineseName && chineseMatches.length > 0) {
    // Skip common non-company phrases
    const skipPatterns = [
      /^香港聯合交易所/,  // Hong Kong Stock Exchange
      /^中華人民共和國/,  // PRC
      /^根據香港/,        // According to HK
      /^本公司/,          // This company
      /^本集團/,          // This group
    ];

    for (const match of chineseMatches) {
      if (match.length >= 6 && !skipPatterns.some(p => p.test(match))) {
        companyChineseName = match;
        break;
      }
    }
  }

  // Check ALL pages for bank data
  const allPagesForBanks = result.pages.map(p => p.text).join('\n');
  const lines = allPagesForBanks.split('\n').map(l => l.trim());

  // Method 1: Inline pattern "has appointed [BANK(S)] as [ROLE]"
  // Join all text and look for this pattern
  const fullText = lines.join(' ');
  const inlinePattern = /has\s+appointed\s+([A-Z][A-Za-z\s\(\)\.,']+?Limited(?:\s+and\s+[A-Z][A-Za-z\s\(\)\.,']+?Limited)*)\s+as\s+its?\s+((?:sole\s+)?(?:joint\s+)?(?:sponsor[–\-]?overall\s+coordinator|overall\s+coordinator|sponsor|bookrunner)(?:\s+and\s+(?:overall\s+)?coordinator)?)/gi;

  let inlineMatch;
  while ((inlineMatch = inlinePattern.exec(fullText)) !== null) {
    const bankNamesRaw = inlineMatch[1].trim();
    const rawRole = inlineMatch[2].trim();

    // Split multiple banks (e.g., "Bank A Limited and Bank B Limited")
    const bankNames = bankNamesRaw.split(/\s+and\s+/i).map(b => b.trim());

    for (const bankName of bankNames) {
      // Skip if bank name matches company name
      if (bankName.toLowerCase() === company.toLowerCase()) continue;

      if (!banks.find(b => b.bank === bankName)) {
        const roles = normalizeRole(rawRole);
        banks.push({
          bank: bankName,
          rawRole: rawRole,
          roles: roles,
          isLead: isLeadRole(roles),
        });
      }
    }
  }

  // Method 2: List format - "has appointed the following [role]:" then bank names on separate lines
  let currentRole = '';
  let inBankSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] || '';
    const combinedLine = line + ' ' + nextLine; // Handle split lines

    // Check for "has appointed the following [role]:" pattern
    const appointedMatch = combinedLine.match(/has\s+appointed\s+(?:the\s+)?following\s+((?:overall\s+)?(?:sponsor|coordinator|bookrunner)s?)/i);
    if (appointedMatch) {
      currentRole = appointedMatch[1].trim();
      inBankSection = true;
      continue;
    }

    // Check for standalone role headings (like "Sole Sponsor – Overall Coordinator" or "Overall Coordinators")
    if (line.match(/^((?:Sole\s+|Joint\s+)?Sponsor(?:\s*[–\-]\s*Overall\s+Coordinator)?|Overall\s+Coordinator|Joint\s+(?:Global\s+)?(?:Overall\s+)?Coordinator|Bookrunner|Lead\s+Manager)/i) &&
        !line.match(/appointed|obligation|syndicate/i)) {
      // Use the exact text as the role (preserve "Sponsor – Overall Coordinator")
      currentRole = line.replace(/s?\s*$/, ''); // Remove trailing 's' if plural
      inBankSection = true;
      continue;
    }

    // Check if line is a bank name (ends with Limited/Ltd and starts with capital)
    const isBankName =
      line.match(/Limited$/i) &&
      line.match(/^[A-Z]/) &&
      line.length > 10 &&
      line.length < 120 &&
      !line.match(/Stock Exchange|joint stock|liability|jurisdiction|disclaimer|announcement/i);

    if (isBankName && inBankSection && currentRole) {
      const bankName = line;

      // Skip if it's the company being listed
      if (bankName.toLowerCase() === company.toLowerCase()) continue;
      if (bankName.match(/Holdings\s+Limited$/i) && !bankName.match(/Capital|Securities|Financial|Bank/i)) continue;

      // Add if not already present
      if (!banks.find(b => b.bank === bankName)) {
        const roles = normalizeRole(currentRole);
        banks.push({
          bank: bankName,
          rawRole: currentRole,
          roles: roles,
          isLead: isLeadRole(roles),
        });
      }
    }

    // End bank section on certain keywords
    if (line.match(/^(Further announcement|Compliance Adviser|Legal Adviser|Auditor|By order|Hong Kong,)/i)) {
      inBankSection = false;
    }
  }

  // Method 3: DEFINITIONS section format - "Role" \t Bank1, Bank2 and Bank3
  // This captures banks from prospectus glossary sections
  const definitionsRoles = [
    'Sole Sponsor',
    'Joint Sponsors',
    'Sponsor',
    'Sole Overall Coordinator',
    'Joint Overall Coordinators',
    'Overall Coordinator',
    'Sole Global Coordinator',
    'Joint Global Coordinators',
    'Global Coordinator',
    'Joint Bookrunners',
    'Bookrunner',
    'Joint Lead Managers',
    'Lead Manager',
  ];

  for (const roleName of definitionsRoles) {
    // Match "Role" followed by tab/spaces and bank names
    const pattern = new RegExp(
      `"${roleName}s?"\\s+([A-Z][^"]+?)(?=\\s*"[A-Z]|DEFINITIONS|$)`,
      'gi'
    );

    let match;
    while ((match = pattern.exec(allText)) !== null) {
      const bankText = match[1].trim();
      // Split on comma and "and" to get individual banks
      const bankNames = bankText
        .replace(/\s+/g, ' ')
        .split(/,\s*|\s+and\s+/i)
        .map(b => b.trim())
        .filter(b => b.match(/Limited$/i) && b.length > 5 && b.length < 100);

      for (const bankName of bankNames) {
        if (bankName.toLowerCase() === company.toLowerCase()) continue;
        if (bankName.match(/Holdings\s+Limited$/i) && !bankName.match(/Capital|Securities|Financial|Bank|Markets/i)) continue;

        if (!banks.find(b => b.bank === bankName)) {
          const roles = normalizeRole(roleName);
          banks.push({
            bank: bankName,
            rawRole: roleName,
            roles: roles,
            isLead: isLeadRole(roles),
          });
        }
      }
    }
  }

  return {
    company,
    companyChineseName,
    banks,
  };
}

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Accept HKEX disclaimer and get a session that can access PDFs
 */
async function acceptDisclaimer(page: Page): Promise<void> {
  // Go to the main app index
  await page.goto('https://www1.hkexnews.hk/app/appindex.html', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  // Wait for the page to fully load
  await new Promise(r => setTimeout(r, 2000));

  try {
    // The HKEX disclaimer has:
    // 1. A checkbox "Please don't remind me anymore"
    // 2. An "ACCEPT" button and "DO NOT ACCEPT" button

    // First, try to click the ACCEPT button directly
    // Look for button or link with "ACCEPT" text (but not "DO NOT ACCEPT")
    const acceptClicked = await page.evaluate(() => {
      // Find all clickable elements
      const elements = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
      for (const el of elements) {
        const text = el.textContent?.trim().toUpperCase() || '';
        // Match "ACCEPT" but not "DO NOT ACCEPT"
        if (text === 'ACCEPT' || text === 'I ACCEPT' || text === 'AGREE') {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (acceptClicked) {
      console.log('Clicked ACCEPT button');
      await new Promise(r => setTimeout(r, 2000));
    } else {
      // Try finding by class or other attributes
      const acceptBtn = await page.$('.accept-btn, #accept, [data-action="accept"]');
      if (acceptBtn) {
        await acceptBtn.click();
        console.log('Clicked accept button by selector');
        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.log('No disclaimer accept button found');
      }
    }
  } catch (e) {
    console.log('Disclaimer handling error:', e);
  }
}

/**
 * Download an OC announcement PDF
 * The trick is to accept the disclaimer first, then fetch the PDF using the same session
 */
export async function downloadOCPdf(pdfUrl: string, outputPath: string): Promise<boolean> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // First accept disclaimer on the main app page
    await acceptDisclaimer(page);

    // Use page.evaluate with fetch to download the PDF with cookies
    // This keeps us in the same session/context
    console.log(`Fetching PDF from: ${pdfUrl}`);

    const pdfData = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, {
          credentials: 'include',
          headers: {
            'Accept': 'application/pdf,*/*',
          },
        });

        if (!response.ok) {
          return { error: `HTTP ${response.status}`, status: response.status };
        }

        const contentType = response.headers.get('content-type') || '';
        console.log('Content-Type:', contentType);

        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        // Convert to base64 to pass back to Node
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        return { data: btoa(binary), contentType, size: uint8Array.length };
      } catch (e: any) {
        return { error: e.message };
      }
    }, pdfUrl);

    if ('error' in pdfData && pdfData.error) {
      console.error('Fetch error:', pdfData.error);

      // Fallback: try direct navigation
      console.log('Trying direct navigation fallback...');
      const response = await page.goto(pdfUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      if (response) {
        const contentType = response.headers()['content-type'] || '';
        console.log('Direct nav content-type:', contentType);

        if (contentType.includes('pdf')) {
          const buffer = await response.buffer();
          fs.writeFileSync(outputPath, buffer);
          console.log(`Downloaded via direct nav: ${outputPath} (${buffer.length} bytes)`);
          return true;
        }

        // Check if we landed on a page with the PDF embedded
        const pageContent = await page.content();
        if (pageContent.includes('embed') || pageContent.includes('iframe')) {
          // Look for embedded PDF source
          const embedSrc = await page.evaluate(() => {
            const embed = document.querySelector('embed, iframe, object');
            return embed?.getAttribute('src') || embed?.getAttribute('data');
          });

          if (embedSrc) {
            console.log('Found embedded PDF:', embedSrc);
            const embedUrl = embedSrc.startsWith('http') ? embedSrc : `https://www1.hkexnews.hk${embedSrc}`;
            const embedResponse = await page.goto(embedUrl, { waitUntil: 'networkidle2' });
            if (embedResponse) {
              const buffer = await embedResponse.buffer();
              fs.writeFileSync(outputPath, buffer);
              console.log(`Downloaded embedded PDF: ${outputPath}`);
              return true;
            }
          }
        }
      }

      return false;
    }

    // Got the PDF data via fetch
    const buffer = Buffer.from(pdfData.data as string, 'base64');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Downloaded: ${outputPath} (${buffer.length} bytes)`);
    return true;

  } catch (error) {
    console.error('Download error:', error);
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Get list of active IPO applications from HKEX
 */
export async function getActiveApplications(): Promise<Array<{
  company: string;
  date: string;
  documentType: string;
  url: string;
}>> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // First accept disclaimer
    await acceptDisclaimer(page);

    // Navigate to the yearly index for main board
    await page.goto('https://www1.hkexnews.hk/app/appyearlyindex.html?lang=en&board=mainBoard', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for content to load
    await new Promise(r => setTimeout(r, 3000));

    // Take a screenshot for debugging
    await page.screenshot({ path: '/tmp/hkex_page.png', fullPage: true });
    console.log('Screenshot saved to /tmp/hkex_page.png');

    // Get page HTML for debugging
    const html = await page.content();
    console.log('Page title:', await page.title());
    console.log('Page URL:', page.url());
    console.log('HTML length:', html.length);

    // Look for the actual data table or list
    const applications = await page.evaluate(() => {
      const results: Array<{
        company: string;
        date: string;
        documentType: string;
        url: string;
      }> = [];

      // Debug: log all links on the page
      const allLinks = document.querySelectorAll('a');
      console.log('Total links found:', allLinks.length);

      // Find all links that might be OC announcements
      allLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.trim() || '';
        const parentText = link.parentElement?.textContent?.trim().slice(0, 200) || '';

        // Look for OC announcement links
        if (href.includes('.pdf') &&
            (text.toLowerCase().includes('oc') ||
             text.toLowerCase().includes('announcement') ||
             text.toLowerCase().includes('appointment') ||
             href.toLowerCase().includes('oc'))) {

          // Try to find date nearby
          const dateMatch = parentText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);

          // Use the browser's resolved href (link.href) which handles relative paths correctly
          const fullUrl = (link as HTMLAnchorElement).href;

          results.push({
            company: parentText.split('\n')[0]?.slice(0, 100) || 'Unknown',
            date: dateMatch ? dateMatch[1] : '',
            documentType: text.slice(0, 100),
            url: fullUrl,
          });
        }
      });

      // Also look for table rows with document info
      const tables = document.querySelectorAll('table');
      tables.forEach(table => {
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          const links = row.querySelectorAll('a[href*=".pdf"]');

          links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const text = link.textContent?.trim() || '';
            const rowText = row.textContent || '';
            const dateMatch = rowText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);

            if (href && (text.toLowerCase().includes('oc') ||
                        text.toLowerCase().includes('coordinator') ||
                        text.toLowerCase().includes('appointment'))) {
              // Use the browser's resolved href
              const fullUrl = (link as HTMLAnchorElement).href;

              results.push({
                company: cells[0]?.textContent?.trim().slice(0, 100) || rowText.slice(0, 100),
                date: dateMatch ? dateMatch[1] : '',
                documentType: text,
                url: fullUrl,
              });
            }
          });
        });
      });

      return results;
    });

    console.log(`Found ${applications.length} OC announcements`);
    return applications;
  } catch (error) {
    console.error('Error getting applications:', error);
    return [];
  } finally {
    await page.close();
  }
}

/**
 * Scrape all active OC announcements and extract bank data
 */
export async function scrapeActiveOCData(): Promise<OCAnnouncementData[]> {
  const results: OCAnnouncementData[] = [];

  const apps = await getActiveApplications();
  const ocApps = apps.filter(app =>
    app.documentType.toLowerCase().includes('oc') &&
    app.documentType.toLowerCase().includes('announcement')
  );

  console.log(`Found ${ocApps.length} OC announcements to process`);

  for (let i = 0; i < ocApps.length; i++) {
    const app = ocApps[i];
    console.log(`Processing ${i + 1}/${ocApps.length}: ${app.url}`);

    const tempPath = `/tmp/oc_temp_${i}.pdf`;

    try {
      const success = await downloadOCPdf(app.url, tempPath);
      if (success) {
        const buffer = fs.readFileSync(tempPath);
        const header = buffer.slice(0, 5).toString();

        if (header === '%PDF-') {
          const data = await extractBankDataFromPdf(buffer);

          if (data.banks.length > 0) {
            results.push({
              company: data.company || 'Unknown',
              companyChineseName: data.companyChineseName,
              appointmentDate: app.date,
              banks: data.banks,
              sourceUrl: app.url,
            });
          }
        }

        // Clean up temp file
        fs.unlinkSync(tempPath);
      }
    } catch (err) {
      console.error(`Error processing ${app.url}:`, err);
    }
  }

  return results;
}

// Test function
async function test() {
  console.log('Testing HKEX scraper...\n');

  // Quick test with first 3 OC announcements
  const apps = await getActiveApplications();
  const ocApps = apps.filter(app =>
    app.documentType.toLowerCase().includes('oc') &&
    app.documentType.toLowerCase().includes('announcement')
  ).slice(0, 3);

  console.log(`Testing extraction on ${ocApps.length} OC announcements:\n`);

  for (const app of ocApps) {
    const tempPath = '/tmp/test_oc.pdf';
    const success = await downloadOCPdf(app.url, tempPath);

    if (success) {
      const buffer = fs.readFileSync(tempPath);
      const data = await extractBankDataFromPdf(buffer);

      console.log(`Company: ${data.company}`);
      console.log(`Chinese: ${data.companyChineseName}`);
      console.log(`Banks:`);
      data.banks.forEach(b => {
        console.log(`  - ${b.bank} | Raw: "${b.rawRole}" | Roles: [${b.roles.join(', ')}] | Lead: ${b.isLead}`);
      });
      console.log('');
    }
  }

  await closeBrowser();
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  test().catch(console.error);
}
