import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import puppeteer, { Browser } from 'puppeteer';
import { SearchResult, AnalyzedResult } from './types.js';
import { detectCategory } from './searchStrings.js';

// LLM Configuration - supports DeepSeek (preferred) or Kimi fallback
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';

// Use DeepSeek if available, otherwise fall back to Kimi
const LLM_API_KEY = DEEPSEEK_API_KEY || KIMI_API_KEY;
const LLM_URL = DEEPSEEK_API_KEY
  ? 'https://api.deepseek.com/v1/chat/completions'
  : 'https://api.moonshot.ai/v1/chat/completions';
const LLM_MODEL = DEEPSEEK_API_KEY ? 'deepseek-chat' : (process.env.KIMI_MODEL || 'moonshot-v1-8k');

// Shared browser instance for Puppeteer fallback
let browser: Browser | null = null;

// Page pool to limit concurrent Puppeteer pages
const MAX_CONCURRENT_PAGES = 2;
let activePages = 0;
const pageQueue: Array<() => void> = [];

async function acquirePage(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return;
  }
  await new Promise<void>(resolve => pageQueue.push(resolve));
  activePages++;
}

function releasePage(): void {
  activePages--;
  const next = pageQueue.shift();
  if (next) next();
}

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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

// Detect encoding from HTML content or headers
function detectEncoding(html: Buffer, contentType?: string): string {
  // Check Content-Type header
  if (contentType) {
    const match = contentType.match(/charset=([^\s;]+)/i);
    if (match) return match[1].toLowerCase();
  }

  // Check HTML meta tags
  const htmlStr = html.toString('ascii');

  // <meta charset="xxx">
  const charsetMatch = htmlStr.match(/<meta[^>]+charset=["']?([^"'\s>]+)/i);
  if (charsetMatch) return charsetMatch[1].toLowerCase();

  // <meta http-equiv="Content-Type" content="text/html; charset=xxx">
  const contentTypeMatch = htmlStr.match(/content=["'][^"']*charset=([^"'\s;]+)/i);
  if (contentTypeMatch) return contentTypeMatch[1].toLowerCase();

  // Default to UTF-8
  return 'utf-8';
}

// Normalize encoding names
function normalizeEncoding(encoding: string): string {
  const map: Record<string, string> = {
    'gb2312': 'gbk',
    'gb_2312': 'gbk',
    'gb-2312': 'gbk',
    'gbk': 'gbk',
    'gb18030': 'gb18030',
    'big5': 'big5',
    'utf8': 'utf-8',
    'utf-8': 'utf-8',
  };
  return map[encoding.toLowerCase()] || 'utf-8';
}

// Fast fetch with axios (with proper encoding handling)
async function fetchWithAxios(url: string): Promise<string> {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    maxRedirects: 5,
    responseType: 'arraybuffer', // Get raw bytes
  });

  const buffer = Buffer.from(response.data);
  const contentType = response.headers['content-type'];

  // Detect and decode with correct encoding
  const detectedEncoding = detectEncoding(buffer, contentType);
  const encoding = normalizeEncoding(detectedEncoding);

  let html: string;
  try {
    html = iconv.decode(buffer, encoding);
  } catch {
    // Fallback to UTF-8
    html = buffer.toString('utf-8');
  }

  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside, .ad, .advertisement').remove();
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
}

// Fallback fetch with Puppeteer for JS-rendered pages
async function fetchWithPuppeteer(url: string): Promise<string> {
  await acquirePage();
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 500));

    // Dismiss any login/subscription popups that block content
    const closeSelectors = [
      '.close', '.modal-close', '[class*="close"]', '[class*="Close"]',
      '.login-close', '.popup-close', '.dialog-close',
      'button[aria-label="Close"]', 'button[aria-label="关闭"]',
      '.modal .close-btn', '.overlay-close',
      'i.close', 'span.close', 'div.close',
      '[class*="dismiss"]', '[class*="cancel"]'
    ];

    for (const selector of closeSelectors) {
      try {
        const closeBtn = await page.$(selector);
        if (closeBtn) {
          const isVisible = await closeBtn.evaluate((el: Element) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          });
          if (isVisible) {
            await closeBtn.click();
            await new Promise(r => setTimeout(r, 300));
            break; // Only need to close one popup
          }
        }
      } catch { /* ignore selector errors */ }
    }

    // Also try pressing Escape key to dismiss modals
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 200));

    const text = await page.evaluate(() => {
      const body = document.body;
      if (!body) return '';
      const unwanted = body.querySelectorAll('script, style, nav, footer, header, aside');
      unwanted.forEach(el => el.remove());
      return body.innerText?.replace(/\s+/g, ' ').trim() || '';
    });

    return text.slice(0, 8000);
  } finally {
    await page.close();
    releasePage();
  }
}

// Hybrid fetch: axios first, Puppeteer fallback
export async function fetchPageContent(url: string): Promise<string> {
  // Try axios first (faster, 90% success rate)
  try {
    const text = await fetchWithAxios(url);
    if (text.length > 100) {
      return text;
    }
  } catch (error) {
    // axios failed, will try Puppeteer
  }

  // Fallback to Puppeteer for JS-rendered or protected pages
  try {
    const text = await fetchWithPuppeteer(url);
    return text;
  } catch (error) {
    console.error(`Both methods failed for ${url}`);
    return '';
  }
}

// Quick scan for YELLOW result filtering (lightweight pre-analysis)
export async function quickScan(
  url: string,
  subjectName: string
): Promise<{ shouldAnalyze: boolean; reason: string }> {
  // Fetch first 1500 chars only
  let content = '';
  try {
    content = await fetchPageContent(url);
    content = content.slice(0, 1500);
  } catch {
    return { shouldAnalyze: false, reason: 'fetch failed' };
  }

  if (content.length < 100) {
    return { shouldAnalyze: false, reason: 'no content' };
  }

  const prompt = `First 1500 characters of article:
${content}

Question: Does this article contain adverse information about "${subjectName}"?
(Adverse = crime, fraud, regulatory action, sanctions, litigation, misconduct)

Answer in JSON:
{"shouldAnalyze": true/false, "reason": "5 words max"}`;

  try {
    const response = await axios.post(
      LLM_URL,
      {
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LLM_API_KEY}`,
        },
        timeout: 30000,
      }
    );

    const rawText = response.data.choices?.[0]?.message?.content || '';
    // Strip markdown code blocks that DeepSeek wraps around JSON
    const text = rawText.replace(/```json\s*/gi, '').replace(/```/g, '');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        shouldAnalyze: typeof parsed.shouldAnalyze === 'boolean'
          ? parsed.shouldAnalyze
          : parsed.shouldAnalyze === true || parsed.shouldAnalyze === 'true',
        reason: String(parsed.reason || 'unknown')
      };
    }
  } catch (error) {
    console.error(`Quick scan error for ${url}:`, error);
    return { shouldAnalyze: true, reason: 'scan error, defaulting yes' };
  }

  return { shouldAnalyze: true, reason: 'parse failed, defaulting yes' };
}

// Analyze content with Kimi/Moonshot
export async function analyzeWithLLM(
  content: string,
  subjectName: string,
  searchTerm: string
): Promise<{ isAdverse: boolean; severity: 'RED' | 'AMBER' | 'GREEN'; headline: string; summary: string }> {
  if (!content || content.length < 50) {
    return { isAdverse: false, severity: 'GREEN', headline: '', summary: 'Unable to fetch content' };
  }

  if (!LLM_API_KEY) {
    return { isAdverse: false, severity: 'GREEN', headline: '', summary: 'LLM API key not configured' };
  }

  const prompt = `You are a senior due diligence analyst writing a professional report for investment banks. Analyze this content about "${subjectName}".

Content:
${content.slice(0, 6000)}

INSTRUCTIONS:
1. Does this content specifically mention "${subjectName}" (the exact person, not someone with a similar name)?
2. If yes, extract ALL factual details about any adverse information.
3. Write a professional narrative summary in English, like you would see in a due diligence report for Morgan Stanley or Goldman Sachs.

IMPORTANT RULES:
- Only include facts that are ACTUALLY in the article. Do not invent or assume details.
- Include specific details when available: dates, amounts (CNY and USD equivalent), case numbers, co-conspirators' names (Chinese with pinyin), sentences, fines
- Use professional language: "convicted of", "sentenced to", "allegedly involved in", "charged with"
- If the article mentions other people involved, include their names and roles
- Do NOT include information from the search query - only what's in the article content

Respond in JSON format ONLY:
{
  "mentions_subject": true/false,
  "is_adverse": true/false,
  "severity": "RED" | "AMBER" | "GREEN",
  "headline": "One-line finding, e.g.: Convicted of insider trading (2008), sentenced to 2.5 years imprisonment",
  "summary": "Professional 2-4 sentence narrative with specific facts from the article. Include dates, amounts, case numbers, co-conspirators if mentioned."
}

Severity guide:
- RED: Criminal conviction, sanctions, serious fraud, money laundering
- AMBER: Regulatory investigation, civil litigation, allegations without conviction, historical issues
- GREEN: No adverse information, or subject not actually mentioned`;

  try {
    const response = await axios.post(
      LLM_URL,
      {
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LLM_API_KEY}`,
        },
        timeout: 60000,
      }
    );

    const rawText = response.data.choices?.[0]?.message?.content || '';
    // Strip markdown code blocks that DeepSeek wraps around JSON
    const text = rawText.replace(/```json\s*/gi, '').replace(/```/g, '');

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in response:', text.slice(0, 200));
      return { isAdverse: false, severity: 'GREEN', headline: '', summary: 'Analysis failed - no JSON' };
    }

    const analysis = JSON.parse(jsonMatch[0]);

    if (!analysis.mentions_subject) {
      return { isAdverse: false, severity: 'GREEN', headline: '', summary: 'Subject not mentioned' };
    }

    return {
      isAdverse: analysis.is_adverse || false,
      severity: analysis.severity || 'GREEN',
      headline: analysis.headline || '',
      summary: analysis.summary || 'No summary',
    };
  } catch (error) {
    console.error('LLM analysis error:', error);
    return { isAdverse: false, severity: 'GREEN', headline: '', summary: 'Analysis error' };
  }
}

// Full analysis pipeline for a single search result
export async function analyzeResult(
  result: SearchResult,
  subjectName: string,
  searchTerm: string
): Promise<AnalyzedResult> {
  const content = await fetchPageContent(result.link);
  const analysis = await analyzeWithLLM(content, subjectName, searchTerm);

  return {
    url: result.link,
    title: result.title,
    snippet: result.snippet,
    isAdverse: analysis.isAdverse,
    severity: analysis.severity,
    headline: analysis.headline,
    summary: analysis.summary,
    searchTerm: searchTerm,
    category: detectCategory(searchTerm),
  };
}
