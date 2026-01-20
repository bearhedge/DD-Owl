import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import puppeteer, { Browser } from 'puppeteer';
import { SearchResult, AnalyzedResult } from './types.js';
import { detectCategory } from './searchStrings.js';
import { validateClaims, buildNarrativeFromClaims, ValidatedClaim } from './quoteValidator.js';

// LLM Configuration - supports DeepSeek (preferred) or Kimi fallback
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';

// Use DeepSeek if available, otherwise fall back to Kimi
const LLM_API_KEY = DEEPSEEK_API_KEY || KIMI_API_KEY;
const LLM_URL = DEEPSEEK_API_KEY
  ? 'https://api.deepseek.com/v1/chat/completions'
  : 'https://api.moonshot.ai/v1/chat/completions';
const LLM_MODEL = DEEPSEEK_API_KEY ? 'deepseek-chat' : (process.env.KIMI_MODEL || 'kimi-k2');

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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
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

// Analyze content with Kimi/Moonshot - Quote-Grounded Anti-Hallucination Version
export async function analyzeWithLLM(
  content: string,
  subjectName: string,
  searchTerm: string,
  sourceUrl?: string
): Promise<{ isAdverse: boolean; severity: 'RED' | 'AMBER' | 'GREEN' | 'REVIEW'; headline: string; summary: string }> {
  if (!content || content.length < 50) {
    console.error(`[ANALYZE FAIL] Content too short (${content?.length || 0} chars) - requires manual review`);
    return { isAdverse: false, severity: 'REVIEW', headline: 'Content fetch failed', summary: 'Unable to fetch page content - requires manual review' };
  }

  if (!LLM_API_KEY) {
    console.error('[ANALYZE FAIL] No LLM API key configured');
    return { isAdverse: false, severity: 'REVIEW', headline: 'LLM not configured', summary: 'LLM API key not configured - requires manual review' };
  }

  // Store full content for quote validation (before truncation)
  const fullContent = content;
  const truncatedContent = content.slice(0, 6000);

  const prompt = `You are a senior due diligence analyst. Extract factual claims about "${subjectName}" from this article.

ARTICLE CONTENT:
${truncatedContent}

CRITICAL ANTI-HALLUCINATION RULES:
1. Every factual claim MUST include an EXACT QUOTE from the article text above
2. If you cannot quote the exact text, do NOT make the claim
3. Do NOT infer, assume, or generate any details not explicitly written in the article
4. It is MUCH better to return fewer claims than to fabricate quotes
5. Quotes must be in the original language (Chinese if article is Chinese)

OUTPUT FORMAT (JSON only):
{
  "mentions_subject": true/false,
  "is_adverse": true/false,
  "severity": "RED" | "AMBER" | "GREEN",
  "headline": "[Name (中文名)] [action/event] (year)",
  "media_outlet": "Name of the publication if stated",
  "claims": [
    {
      "claim_en": "English description of this specific fact",
      "claim_zh": "Chinese version of the claim",
      "quote": "EXACT text from article (copy-paste, do not paraphrase)",
      "quote_location": "approximate location in article"
    }
  ]
}

SEVERITY GUIDE:
- RED: Criminal conviction, sanctions, serious fraud, money laundering
- AMBER: Regulatory investigation, civil litigation, allegations, historical issues
- GREEN: No adverse information, or name not actually mentioned

CLAIM EXAMPLES (showing required quote format):

Good claim (has exact quote):
{
  "claim_en": "Chen was sentenced to 2.5 years imprisonment",
  "claim_zh": "陈某被判处有期徒刑2年6个月",
  "quote": "被告人陈某犯内幕交易罪，判处有期徒刑二年六个月",
  "quote_location": "judgment section"
}

Bad claim (DO NOT do this - fabricated quote):
{
  "claim_en": "Chen was fined 500,000 RMB",
  "claim_zh": "陈某被罚款50万",
  "quote": "罚款人民币五十万元",  // ← If this text is NOT in the article, this is HALLUCINATION
  "quote_location": "penalty section"
}

If the article does NOT mention "${subjectName}" or has NO adverse information, return:
{
  "mentions_subject": false,
  "is_adverse": false,
  "severity": "GREEN",
  "headline": "",
  "media_outlet": "",
  "claims": []
}`;

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
      console.error(`[ANALYZE FAIL] No JSON in LLM response: ${text.slice(0, 200)}`);
      return { isAdverse: false, severity: 'REVIEW', headline: 'Analysis parse failed', summary: 'LLM response could not be parsed - requires manual review' };
    }

    const analysis = JSON.parse(jsonMatch[0]);

    if (!analysis.mentions_subject) {
      return { isAdverse: false, severity: 'GREEN', headline: '', summary: 'Subject not mentioned' };
    }

    // ANTI-HALLUCINATION: Validate claims against source content
    const rawClaims = analysis.claims || [];
    let validatedClaims: ValidatedClaim[] = [];

    if (rawClaims.length > 0) {
      console.log(`[QUOTE_VALIDATION] Validating ${rawClaims.length} claims against source content`);
      validatedClaims = validateClaims(rawClaims, fullContent, sourceUrl);
      console.log(`[QUOTE_VALIDATION] ${validatedClaims.length}/${rawClaims.length} claims passed validation`);

      // If ALL claims were rejected, downgrade to GREEN (likely hallucination)
      if (validatedClaims.length === 0 && rawClaims.length > 0) {
        console.log(`[HALLUCINATION_DETECTED] All ${rawClaims.length} claims rejected - downgrading to GREEN`);
        return {
          isAdverse: false,
          severity: 'GREEN',
          headline: '',
          summary: 'No verifiable adverse information found'
        };
      }
    }

    // Build narrative from validated claims only
    let summary: string;
    if (validatedClaims.length > 0) {
      summary = buildNarrativeFromClaims(validatedClaims, sourceUrl || 'the source', analysis.media_outlet);
    } else if (analysis.is_adverse) {
      // LLM said adverse but no claims provided - flag for review
      summary = 'Potential adverse information detected but could not be verified - requires manual review';
    } else {
      summary = 'No adverse information found';
    }

    return {
      isAdverse: analysis.is_adverse && validatedClaims.length > 0,
      severity: validatedClaims.length > 0 ? (analysis.severity || 'GREEN') : 'GREEN',
      headline: validatedClaims.length > 0 ? (analysis.headline || '') : '',
      summary: summary,
    };
  } catch (error: any) {
    console.error(`[ANALYZE FAIL] LLM error: ${error?.message || error}`);
    return { isAdverse: false, severity: 'REVIEW', headline: 'Analysis error', summary: `Analysis failed: ${error?.message || 'Unknown error'} - requires manual review` };
  }
}

// Full analysis pipeline for a single search result
export async function analyzeResult(
  result: SearchResult,
  subjectName: string,
  searchTerm: string
): Promise<AnalyzedResult> {
  const content = await fetchPageContent(result.link);
  // Pass sourceUrl for quote validation logging
  const analysis = await analyzeWithLLM(content, subjectName, searchTerm, result.link);

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
