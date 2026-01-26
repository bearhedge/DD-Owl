/**
 * Simplified fact extraction
 *
 * Two-pass approach:
 * 1. Quick relevance check (simple JSON)
 * 2. Write professional narrative (prose)
 */

import axios from 'axios';

const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2';

export interface Finding {
  isRelevant: boolean;
  issueType?: string;
  headline?: string;
  narrative?: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourcePublisher?: string;
}

/**
 * Pass 1: Quick relevance check
 */
async function checkRelevance(
  content: string,
  subjectName: string
): Promise<{ relevant: boolean; issueType?: string; reason?: string }> {
  const prompt = `Does this article contain adverse information about "${subjectName}"?

Article content (excerpt):
${content.slice(0, 3000)}

Answer in this exact format (one line each):
RELEVANT: yes or no
ISSUE_TYPE: (if relevant) one of: criminal, regulatory, civil, fraud, insider_trading, corruption, sanctions, other
REASON: brief explanation

Example:
RELEVANT: yes
ISSUE_TYPE: insider_trading
REASON: Article discusses Chen Yuxing's conviction for insider trading in 2008`;

  try {
    const response = await axios.post(
      KIMI_URL,
      {
        model: 'kimi-k2', // K2 for quick check
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KIMI_API_KEY}`,
        },
        timeout: 30000,
      }
    );

    const text = response.data.choices?.[0]?.message?.content || '';

    const relevantMatch = text.match(/RELEVANT:\s*(yes|no)/i);
    const issueMatch = text.match(/ISSUE_TYPE:\s*(\w+)/i);
    const reasonMatch = text.match(/REASON:\s*(.+)/i);

    const relevant = relevantMatch?.[1]?.toLowerCase() === 'yes';

    return {
      relevant,
      issueType: relevant ? issueMatch?.[1] : undefined,
      reason: reasonMatch?.[1],
    };
  } catch (error) {
    console.error('Relevance check error:', error);
    return { relevant: false, reason: 'Error checking relevance' };
  }
}

/**
 * Pass 2: Write professional narrative
 */
async function writeNarrative(
  content: string,
  subjectName: string,
  issueType: string,
  sourceUrl: string
): Promise<{ headline: string; narrative: string } | null> {
  const prompt = `You are a senior due diligence analyst writing a professional report for investment banks (Morgan Stanley, Goldman Sachs level).

SUBJECT: "${subjectName}"
ISSUE TYPE: ${issueType}
SOURCE URL: ${sourceUrl}

ARTICLE CONTENT:
${content.slice(0, 10000)}

Write a professional due diligence finding about "${subjectName}" based ONLY on facts in this article.

FORMAT:
1. HEADLINE: One sentence summarizing the finding (e.g., "Convicted of insider trading (2008), sentenced to 2.5 years imprisonment")

2. NARRATIVE: 2-4 paragraphs covering:
   - What happened (chronological, with specific dates)
   - Who was involved (Chinese names with pinyin in parentheses, e.g., "Wang Xiangdong (王向东)")
   - Financial amounts (CNY with USD equivalent)
   - Legal details (charges, case numbers if available, court, verdict)
   - Outcome (sentences, fines, regulatory actions)

RULES:
- Only include facts explicitly stated in the article
- Do NOT invent or assume any details
- Use professional language: "convicted of", "allegedly involved in", "sentenced to"
- If a detail is not in the article, do not include it
- Write in English
- Cite the source publication if mentioned in the article

Output format:
HEADLINE: [one sentence]

NARRATIVE:
[2-4 paragraphs]`;

  try {
    const response = await axios.post(
      KIMI_URL,
      {
        model: KIMI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KIMI_API_KEY}`,
        },
        timeout: 90000,
      }
    );

    const text = response.data.choices?.[0]?.message?.content || '';

    const headlineMatch = text.match(/HEADLINE:\s*(.+?)(?:\n|NARRATIVE)/s);
    const narrativeMatch = text.match(/NARRATIVE:\s*([\s\S]+)/);

    if (!headlineMatch || !narrativeMatch) {
      console.error('Could not parse narrative response');
      return null;
    }

    return {
      headline: headlineMatch[1].trim(),
      narrative: narrativeMatch[1].trim(),
    };
  } catch (error) {
    console.error('Narrative generation error:', error);
    return null;
  }
}

/**
 * Main extraction function
 */
export async function extractFinding(
  content: string,
  subjectName: string,
  sourceUrl: string,
  sourceTitle?: string
): Promise<Finding> {
  // Pass 1: Check relevance
  const relevance = await checkRelevance(content, subjectName);

  if (!relevance.relevant) {
    return {
      isRelevant: false,
      sourceUrl,
      sourceTitle,
    };
  }

  // Pass 2: Write narrative
  const result = await writeNarrative(
    content,
    subjectName,
    relevance.issueType || 'other',
    sourceUrl
  );

  if (!result) {
    return {
      isRelevant: false,
      sourceUrl,
      sourceTitle,
    };
  }

  // Extract publisher from URL
  const publisher = extractPublisher(sourceUrl);

  return {
    isRelevant: true,
    issueType: relevance.issueType,
    headline: result.headline,
    narrative: result.narrative,
    sourceUrl,
    sourceTitle,
    sourcePublisher: publisher,
  };
}

function extractPublisher(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const publishers: Record<string, string> = {
      'www.spp.gov.cn': 'Supreme People\'s Procuratorate',
      'www.court.gov.cn': 'Supreme People\'s Court',
      'news.sina.com.cn': 'Sina News',
      'finance.sina.com.cn': 'Sina Finance',
      'www.thepaper.cn': 'The Paper (澎湃新闻)',
      'www.caixin.com': 'Caixin (财新)',
      'finance.caixin.com': 'Caixin Finance',
      'www.xinhuanet.com': 'Xinhua News Agency',
      'jjckb.xinhuanet.com': 'Economic Information Daily (经济参考报)',
      'www.chinadaily.com.cn': 'China Daily',
      'www.bjnews.com.cn': 'Beijing News (新京报)',
      'paper.cnstock.com': 'China Securities Journal (中国证券报)',
      'www.cs.com.cn': 'China Securities Journal',
      'www.charltonslaw.com': 'Charltons Law Newsletter',
      'xsba.vip': 'Criminal Case Database',
    };
    return publishers[hostname] || hostname;
  } catch {
    return 'Unknown';
  }
}

/**
 * Check if two findings are about the same issue (for deduplication)
 *
 * Looks for shared key identifiers:
 * - Same issue type
 * - Shared Chinese names or company names
 * - Shared key terms (case numbers, specific amounts)
 */
export function isSameFinding(f1: Finding, f2: Finding): boolean {
  if (!f1.narrative || !f2.narrative) return false;

  // Same issue type required
  if (f1.issueType !== f2.issueType) return false;

  const text1 = (f1.headline || '') + ' ' + f1.narrative;
  const text2 = (f2.headline || '') + ' ' + f2.narrative;

  // Extract Chinese names/terms (2+ chars)
  const chinesePattern = /[\u4e00-\u9fa5]{2,}/g;
  const chinese1 = new Set(text1.match(chinesePattern) || []);
  const chinese2 = new Set(text2.match(chinesePattern) || []);

  // Find shared Chinese terms (excluding very common words)
  const commonChinese = [...chinese1].filter(term =>
    chinese2.has(term) &&
    !['中国', '公司', '人民', '法院', '有限', '股份'].includes(term)
  );

  // If 2+ shared Chinese names/terms, likely same issue
  if (commonChinese.length >= 2) return true;

  // Also check for shared pinyin names (e.g., "Wang Xiangdong", "Chen Yuxing")
  const pinyinPattern = /[A-Z][a-z]+ [A-Z][a-z]+/g;
  const pinyin1 = new Set(text1.match(pinyinPattern) || []);
  const pinyin2 = new Set(text2.match(pinyinPattern) || []);
  const commonPinyin = [...pinyin1].filter(name => pinyin2.has(name));

  // If shared pinyin name + same issue type, likely same
  if (commonPinyin.length >= 1) return true;

  return false;
}

/**
 * Merge narratives from multiple sources with proper footnote citations
 */
export async function mergeFindings(findings: Finding[]): Promise<Finding> {
  if (findings.length === 0) throw new Error('No findings to merge');
  if (findings.length === 1) {
    // Single source - add footnote to each sentence
    const f = findings[0];
    const narrative = addFootnotesToSingleSource(f.narrative || '', 1);
    return {
      ...f,
      narrative: narrative + `\n\n**Sources:**\n1. [${f.sourcePublisher}](${f.sourceUrl})`,
    };
  }

  // Multiple sources - synthesize with LLM
  const synthesized = await synthesizeWithCitations(findings);

  if (!synthesized) {
    // Fallback: use best narrative with simple footnotes
    findings.sort((a, b) => (b.narrative?.length || 0) - (a.narrative?.length || 0));
    const best = findings[0];
    return {
      ...best,
      narrative: best.narrative + '\n\n**Sources:**\n' +
        findings.map((f, i) => `${i + 1}. [${f.sourcePublisher}](${f.sourceUrl})`).join('\n'),
    };
  }

  // Pick best headline
  let bestHeadline = findings[0].headline;
  for (const f of findings) {
    if (f.headline && /convicted|sentenced|guilty|fined/i.test(f.headline)) {
      bestHeadline = f.headline;
      break;
    }
  }

  return {
    ...findings[0],
    headline: bestHeadline,
    narrative: synthesized,
  };
}

/**
 * Add footnote to end of each sentence for single-source findings
 */
function addFootnotesToSingleSource(narrative: string, footnoteNum: number): string {
  // Add superscript footnote after periods (but not abbreviations like "Co." or "Ltd.")
  return narrative
    .replace(/\.(\s+)(?=[A-Z])/g, `.^${footnoteNum}^$1`)
    .replace(/\.$/g, `.^${footnoteNum}^`);
}

/**
 * Use LLM to synthesize multiple source narratives with proper citations
 */
async function synthesizeWithCitations(findings: Finding[]): Promise<string | null> {
  // Build source reference list
  const sourceList = findings.map((f, i) =>
    `[${i + 1}] ${f.sourcePublisher} - ${f.sourceUrl}`
  ).join('\n');

  // Build content from each source
  const sourceContent = findings.map((f, i) =>
    `SOURCE [${i + 1}] - ${f.sourcePublisher}:\n${f.narrative}`
  ).join('\n\n---\n\n');

  const prompt = `You are synthesizing multiple source narratives about the same issue into ONE consolidated narrative with proper footnote citations.

SOURCES:
${sourceList}

CONTENT FROM EACH SOURCE:
${sourceContent}

INSTRUCTIONS:
1. Write ONE consolidated narrative that combines all the facts
2. After EACH factual claim, add a superscript footnote number like this: "sentenced to 2.5 years.^1^"
3. If multiple sources confirm the same fact, cite all of them: "convicted of insider trading.^1,2^"
4. Use the source numbers [1], [2], [3] etc. from the list above
5. At the end, list all sources in markdown format

OUTPUT FORMAT:
[Your synthesized narrative with ^1^ style footnotes after each fact]

**Sources:**
1. [Publisher Name](URL)
2. [Publisher Name](URL)
...

RULES:
- Every factual claim MUST have a footnote
- Do not invent facts not in the sources
- Write in professional English
- Keep chronological order where possible`;

  try {
    const response = await axios.post(
      KIMI_URL,
      {
        model: KIMI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KIMI_API_KEY}`,
        },
        timeout: 90000,
      }
    );

    return response.data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('Synthesis error:', error);
    return null;
  }
}
