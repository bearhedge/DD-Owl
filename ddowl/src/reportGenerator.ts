// src/reportGenerator.ts
// Generates professional DD write-ups from screening findings

import axios from 'axios';
import { ConsolidatedFinding } from './types.js';
import { CleanEntityResult } from './reports-db.js';

// LLM Configuration (same fallback chain as other modules)
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// Provider configuration
interface LLMProvider {
  name: string;
  url: string;
  model: string;
  apiKey: string;
}

function getProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];

  // Kimi k2 is primary — best for bilingual extraction and Chinese content
  if (KIMI_API_KEY) {
    providers.push({
      name: 'Kimi',
      url: 'https://api.moonshot.ai/v1/chat/completions',
      model: process.env.KIMI_MODEL || 'kimi-k2',
      apiKey: KIMI_API_KEY,
    });
  }

  // DeepSeek as fallback
  if (DEEPSEEK_API_KEY) {
    providers.push({
      name: 'DeepSeek',
      url: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat',
      apiKey: DEEPSEEK_API_KEY,
    });
  }

  return providers;
}

// Streaming callback type
export type StreamCallback = (chunk: string) => void;

// --- Source metadata classification ---

export interface SourceMetadata {
  outletName: string;
  outletNameChinese: string;
  mediaType: string;
}

const SOURCE_METADATA_MAP: Record<string, SourceMetadata> = {
  // Major financial media
  'finance.sina.com.cn': { outletName: 'Sina Finance', outletNameChinese: '新浪财经', mediaType: 'mainstream financial portal' },
  'sina.com.cn': { outletName: 'Sina', outletNameChinese: '新浪', mediaType: 'mainstream portal' },
  'caixin.com': { outletName: 'Caixin', outletNameChinese: '财新', mediaType: 'financial investigative media' },
  'yicai.com': { outletName: 'Yicai', outletNameChinese: '第一财经', mediaType: 'mainstream business media' },
  'cls.cn': { outletName: 'CLS', outletNameChinese: '财联社', mediaType: 'financial news agency' },
  'stcn.com': { outletName: 'Securities Times', outletNameChinese: '证券时报', mediaType: 'securities media' },
  'cs.com.cn': { outletName: 'China Securities Journal', outletNameChinese: '中国证券报', mediaType: 'securities media' },
  'cnstock.com': { outletName: 'Shanghai Securities News', outletNameChinese: '上海证券报', mediaType: 'securities media' },
  'nbd.com.cn': { outletName: 'National Business Daily', outletNameChinese: '每日经济新闻', mediaType: 'business media' },
  'hexun.com': { outletName: 'Hexun', outletNameChinese: '和讯', mediaType: 'financial portal' },
  'eastmoney.com': { outletName: 'East Money', outletNameChinese: '东方财富', mediaType: 'financial portal' },
  '21jingji.com': { outletName: '21st Century Business Herald', outletNameChinese: '21世纪经济报道', mediaType: 'business media' },
  'jrj.com.cn': { outletName: 'JRJ', outletNameChinese: '金融界', mediaType: 'financial portal' },

  // Mainstream news
  'thepaper.cn': { outletName: 'The Paper', outletNameChinese: '澎湃新闻', mediaType: 'mainstream news' },
  'bjnews.com.cn': { outletName: 'The Beijing News', outletNameChinese: '新京报', mediaType: 'mainstream media' },
  'chinanews.com': { outletName: 'China News Service', outletNameChinese: '中国新闻网', mediaType: 'state news agency' },
  'people.com.cn': { outletName: "People's Daily", outletNameChinese: '人民日报', mediaType: 'state media' },
  'xinhuanet.com': { outletName: 'Xinhua', outletNameChinese: '新华社', mediaType: 'state news agency' },
  'cctv.com': { outletName: 'CCTV', outletNameChinese: '央视', mediaType: 'state broadcaster' },
  'china.com.cn': { outletName: 'China.com.cn', outletNameChinese: '中国网', mediaType: 'state media portal' },
  'ce.cn': { outletName: 'China Economic Net', outletNameChinese: '中国经济网', mediaType: 'economic media' },
  'infzm.com': { outletName: 'Southern Weekly', outletNameChinese: '南方周末', mediaType: 'investigative media' },
  'nandu.com': { outletName: 'Southern Metropolis Daily', outletNameChinese: '南方都市报', mediaType: 'mainstream media' },
  'ifeng.com': { outletName: 'Phoenix News', outletNameChinese: '凤凰网', mediaType: 'mainstream portal' },
  'sohu.com': { outletName: 'Sohu', outletNameChinese: '搜狐', mediaType: 'mainstream portal' },
  '163.com': { outletName: 'NetEase', outletNameChinese: '网易', mediaType: 'mainstream portal' },
  'qq.com': { outletName: 'Tencent News', outletNameChinese: '腾讯新闻', mediaType: 'mainstream portal' },
  'huanqiu.com': { outletName: 'Global Times', outletNameChinese: '环球时报', mediaType: 'state media' },
  'gmw.cn': { outletName: 'Guangming Daily', outletNameChinese: '光明日报', mediaType: 'state media' },
  'takungpao.com': { outletName: 'Ta Kung Pao', outletNameChinese: '大公报', mediaType: 'Hong Kong media' },
  'wenweipo.com': { outletName: 'Wen Wei Po', outletNameChinese: '文汇报', mediaType: 'Hong Kong media' },

  // Legal & government
  'court.gov.cn': { outletName: 'China Judgements Online', outletNameChinese: '中国裁判文书网', mediaType: 'court records' },
  'spp.gov.cn': { outletName: "Supreme People's Procuratorate", outletNameChinese: '最高人民检察院', mediaType: 'government body' },
  'ccdi.gov.cn': { outletName: 'CCDI', outletNameChinese: '中央纪委国家监委', mediaType: 'government body' },
  'csrc.gov.cn': { outletName: 'CSRC', outletNameChinese: '中国证监会', mediaType: 'financial regulator' },
  'safe.gov.cn': { outletName: 'SAFE', outletNameChinese: '国家外汇管理局', mediaType: 'financial regulator' },
  'pbc.gov.cn': { outletName: 'PBOC', outletNameChinese: '中国人民银行', mediaType: 'central bank' },
  'samr.gov.cn': { outletName: 'SAMR', outletNameChinese: '国家市场监督管理总局', mediaType: 'government regulator' },

  // Tech & specialty
  'cnbeta.com': { outletName: 'cnBeta', outletNameChinese: 'cnBeta', mediaType: 'tech news aggregator' },
  '36kr.com': { outletName: '36Kr', outletNameChinese: '36氪', mediaType: 'tech media' },
  'leiphone.com': { outletName: 'LeiPhone', outletNameChinese: '雷锋网', mediaType: 'tech media' },
  'huxiu.com': { outletName: 'Huxiu', outletNameChinese: '虎嗅', mediaType: 'business & tech media' },

  // International
  'scmp.com': { outletName: 'South China Morning Post', outletNameChinese: '南华早报', mediaType: 'English-language media (HK)' },
  'reuters.com': { outletName: 'Reuters', outletNameChinese: '路透社', mediaType: 'international wire service' },
  'bloomberg.com': { outletName: 'Bloomberg', outletNameChinese: '彭博社', mediaType: 'international financial media' },
  'ft.com': { outletName: 'Financial Times', outletNameChinese: '金融时报', mediaType: 'international financial media' },
  'wsj.com': { outletName: 'Wall Street Journal', outletNameChinese: '华尔街日报', mediaType: 'international financial media' },
  'nytimes.com': { outletName: 'New York Times', outletNameChinese: '纽约时报', mediaType: 'international media' },
  'bbc.com': { outletName: 'BBC', outletNameChinese: 'BBC', mediaType: 'international media' },

  // Corporate registries
  'tianyancha.com': { outletName: 'Tianyancha', outletNameChinese: '天眼查', mediaType: 'corporate registry' },
  'qichacha.com': { outletName: 'Qichacha', outletNameChinese: '企查查', mediaType: 'corporate registry' },
  'aiqicha.com': { outletName: 'Aiqicha', outletNameChinese: '爱企查', mediaType: 'corporate registry' },
};

export function classifySource(url: string, title?: string): SourceMetadata {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    // Try exact match first
    if (SOURCE_METADATA_MAP[hostname]) {
      return SOURCE_METADATA_MAP[hostname];
    }

    // Try parent domain match (e.g., news.sina.com.cn → sina.com.cn)
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (SOURCE_METADATA_MAP[parent]) {
        return SOURCE_METADATA_MAP[parent];
      }
    }

    // Unknown domain — extract readable name
    const domainName = parts.length >= 2 ? parts[parts.length - 2] : hostname;
    return {
      outletName: hostname,
      outletNameChinese: '',
      mediaType: 'online media outlet',
    };
  } catch {
    return { outletName: 'unknown source', outletNameChinese: '', mediaType: 'online source' };
  }
}

// --- Stage 1: Structured fact extraction per source ---

export interface ReportExtractedFacts {
  outlet: { en: string; zh: string; mediaType: string };
  publishDate: string;
  persons: { en: string; zh: string; role: string }[];
  companies: { en: string; zh: string; stockCode?: string }[];
  amounts: { original: string; usd: string; context: string }[];
  regulatoryBodies: { en: string; zh: string }[];
  courts: { en: string; zh: string }[];
  keyDates: { date: string; event: string }[];
  outcome: string;
  subjectStatus: string;
  keyFacts: string[];
}

export async function extractFactsForReport(
  articleContent: string,
  snippet: string,
  sourceUrl: string,
  sourceTitle: string,
  subjectName: string,
  sourceMetadata: SourceMetadata
): Promise<ReportExtractedFacts> {
  const contentToAnalyze = articleContent && articleContent.length > 100
    ? articleContent.slice(0, 10000)
    : `TITLE: ${sourceTitle}\nSNIPPET: ${snippet}`;

  const isSnippetOnly = !articleContent || articleContent.length <= 100;

  const prompt = `Extract structured facts from this article for a due diligence report.

SUBJECT: ${subjectName}
SOURCE: ${sourceUrl}
OUTLET: ${sourceMetadata.outletName} (${sourceMetadata.outletNameChinese || 'N/A'})

${isSnippetOnly ? 'NOTE: Full article unavailable. Extract what you can from title/snippet only.\n' : ''}CONTENT:
${contentToAnalyze}

Return ONLY valid JSON with this exact structure:
{
  "outlet": { "en": "${sourceMetadata.outletName}", "zh": "${sourceMetadata.outletNameChinese || ''}", "mediaType": "${sourceMetadata.mediaType}" },
  "publishDate": "Month YYYY or empty string if unknown",
  "persons": [{ "en": "English name", "zh": "中文名", "role": "their role/title" }],
  "companies": [{ "en": "Company Name", "zh": "公司中文名", "stockCode": "optional" }],
  "amounts": [{ "original": "CNY 7.5 million", "usd": "USD 1.05 million", "context": "fine imposed" }],
  "regulatoryBodies": [{ "en": "English name", "zh": "中文名" }],
  "courts": [{ "en": "English name", "zh": "中文名" }],
  "keyDates": [{ "date": "March 2019", "event": "what happened" }],
  "outcome": "final outcome or current status",
  "subjectStatus": "was convicted/was not fined/is under investigation/etc",
  "keyFacts": ["specific factual bullet 1", "specific factual bullet 2"]
}

RULES:
- Extract ONLY facts explicitly stated in the content
- Include Chinese characters (中文) for all entity names
- Convert monetary amounts to both original currency and USD
- If information is not available, use empty string or empty array
- Do NOT invent or hallucinate any detail`;

  const providers = getProviders();

  for (const provider of providers) {
    try {
      const response = await axios.post(
        provider.url,
        {
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          timeout: 60000,
        }
      );

      const text = response.data.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`[REPORT] ✓ Facts extracted from ${sourceUrl} via ${provider.name}`);
        return parsed as ReportExtractedFacts;
      }
    } catch (err: any) {
      console.log(`[REPORT] ✗ Fact extraction failed with ${provider.name}: ${err.message}`);
      continue;
    }
  }

  // Fallback: return minimal facts from metadata
  return {
    outlet: { en: sourceMetadata.outletName, zh: sourceMetadata.outletNameChinese, mediaType: sourceMetadata.mediaType },
    publishDate: '',
    persons: [],
    companies: [],
    amounts: [],
    regulatoryBodies: [],
    courts: [],
    keyDates: [],
    outcome: '',
    subjectStatus: '',
    keyFacts: [snippet || sourceTitle],
  };
}

// --- Stage 2: Constrained prose generation from extracted facts ---

export async function generateWriteUpFromFacts(
  finding: ConsolidatedFinding,
  factsBySource: ReportExtractedFacts[],
  subjectName: string,
  footnoteStartIndex: number,
  onChunk: StreamCallback
): Promise<{ text: string; footnotesUsed: number }> {
  const sourcesText = finding.sources.map((s, i) => `[${footnoteStartIndex + i}]  ${s.url}`).join('\n');
  const footnotesUsed = finding.sources.length;
  const isRed = finding.severity === 'RED';
  const detailLevel = isRed ? '3-4 paragraphs with full detail' : '1-2 paragraphs, key facts only';

  // Serialize facts for the prompt
  const factsJson = JSON.stringify(factsBySource, null, 2);

  const systemPrompt = `You are a senior due diligence analyst at a professional risk consulting firm. You write factual, neutral, professional DD report findings.

Your ONLY job is to assemble the extracted facts below into fluent professional DD English prose. You must NOT add any information not present in the facts.`;

  const userPrompt = `Write a professional due diligence finding using ONLY these verified facts.

SUBJECT: ${subjectName}
ISSUE HEADLINE: ${finding.headline}
ISSUE SUMMARY: ${finding.summary}

EXTRACTED FACTS (from ${factsBySource.length} source(s)):
${factsJson}

SOURCE URLs:
${sourcesText}

FORMAT RULES:
1. HEADLINE: Clear headline with year range in parentheses
   Format: [Issue description] ([Year] or [Year – Year])

2. OPENING SENTENCE: Start with source attribution
   Format: "According to [article/media type] published by [outlet name] ([中文名]) in [Month Year], [subject]..."

3. ENTITY NAMES: Always use actual Chinese characters in parentheses
   CORRECT: "Ministry of Commerce (商务部)"
   WRONG: "Ministry of Commerce (Shangwubu)"
   Format for persons: "Full Name (中文名, \\"Short\\")"

4. SPECIFICITY: Use exact numbers, dates, amounts from facts. NEVER summarize vaguely.

5. AMOUNTS: Always include USD conversion
   Format: CNY X million (USD Y million)

6. BODY: Topic sentence → Context → Specific facts → Outcome

7. SUB-INCIDENTS: When multiple separate incidents exist, list as bullet points.

8. CLOSING: End with neutral status
   Examples: "No information was found indicating X was further investigated."
   "Research did not find any information suggesting..."

9. INLINE REFERENCES: Use [${footnoteStartIndex}], [${footnoteStartIndex + 1}], etc. inline after relevant claims.
   Do NOT add a trailing "Sources:" block.

10. MULTI-SOURCE: When facts come from multiple sources, show corroboration.
    "According to [Source A]... This was corroborated by [Source B], which reported..."

STRICT RULES:
- Write ${detailLevel}
- Do NOT include severity labels (RED, AMBER)
- Do NOT editorialize or use dramatic language
- Do NOT invent dates, amounts, names, or outcomes not present in the facts
- Use inline [N] references only — NO trailing "Sources:" section
- Neutral, factual tone throughout

EXAMPLE OUTPUT (multi-source):
Short-seller report alleging misrepresentation of hotel count (2019 – 2020)

According to a research report published by Bonitas Research in September 2019, H World Group Limited (华住集团有限公司, "H World") was accused of materially overstating its hotel count. The report alleged that H World claimed to operate approximately 5,618 hotels, when Bonitas' investigation identified only 3,666 open hotels — a 34.8% overstatement.[1]

Chinese media outlets including Sina Finance (新浪财经) and Yicai Global (第一财经) reported on the allegations. H World subsequently issued a formal response denying the allegations, stating they were "without merit." No regulatory action was taken against H World.[2]

Now write the finding:`;

  const providers = getProviders();
  let fullResponse = '';

  for (const provider of providers) {
    try {
      console.log(`[REPORT] Generating fact-based write-up with ${provider.name} (streaming)...`);

      const response = await axios.post(
        provider.url,
        {
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          stream: true,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          timeout: 120000,
          responseType: 'stream',
        }
      );

      const streamResult = await new Promise<string>((resolve, reject) => {
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          buffer += text;

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullResponse += content;
                  onChunk(content);
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        });

        response.data.on('end', () => {
          console.log(`[REPORT] ✓ Fact-based write-up generated with ${provider.name}`);
          resolve(fullResponse);
        });

        response.data.on('error', (err: Error) => {
          reject(err);
        });
      });

      return { text: streamResult, footnotesUsed };
    } catch (error: any) {
      console.log(`[REPORT] ✗ ${provider.name} fact-based streaming failed: ${error.message}`);

      // Try non-streaming fallback
      try {
        const response = await axios.post(
          provider.url,
          {
            model: provider.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
            },
            timeout: 120000,
          }
        );

        const content = response.data.choices?.[0]?.message?.content || '';
        if (content) {
          onChunk(content);
          return { text: content, footnotesUsed };
        }
      } catch (fallbackError: any) {
        console.log(`[REPORT] ✗ ${provider.name} fact-based non-streaming also failed: ${fallbackError.message}`);
      }
      continue;
    }
  }

  // Fallback
  const fallback = `${finding.headline}\n\n${finding.summary}`;
  onChunk(fallback);
  return { text: fallback, footnotesUsed };
}

/**
 * Generate write-up for a single finding with streaming.
 * When articleContent is provided, the LLM uses the actual article text as ground truth.
 * When missing, it generates from metadata only and notes limited source access.
 * footnoteStartIndex controls the starting [N] for inline references.
 * Returns { text, footnotesUsed } where footnotesUsed is the count of footnotes.
 */
export async function generateWriteUp(
  finding: ConsolidatedFinding,
  subjectName: string,
  onChunk: StreamCallback,
  articleContent?: string,
  footnoteStartIndex: number = 1
): Promise<{ text: string; footnotesUsed: number }> {
  const isRed = finding.severity === 'RED';
  const detailLevel = isRed ? '3-4 paragraphs with full detail' : '1-2 paragraphs, key facts only';

  const sourcesText = finding.sources.map((s, i) => `[${footnoteStartIndex + i}]  ${s.url}`).join('\n');
  const footnotesUsed = finding.sources.length;

  // Build article section for the prompt
  const articleSection = articleContent
    ? `ARTICLE TEXT (use as ground truth — cross-reference claims against this):
${articleContent.slice(0, 8000)}

`
    : `NOTE: Full article text was not available. Write based on the metadata below only.
State what IS known from the source metadata. Do NOT hedge or apologize for limited access.

`;

  const prompt = `Write a professional due diligence finding following this EXACT format and style.

SUBJECT: ${subjectName}
ISSUE HEADLINE: ${finding.headline}
ISSUE SUMMARY: ${finding.summary}
${articleSection}SOURCE URLs:
${sourcesText}

FORMAT RULES (follow exactly):

1. HEADLINE: Write a clear headline with year range in parentheses
   Format: [Issue description] ([Year] or [Year – Year])
   Example: "Involvement in his uncle Yang Xiancai judicial corruption case (2008 – 2010)"

2. OPENING SENTENCE: Always start with source attribution
   Format: "According to [article/media type] published by [outlet name] in [Month Year], [subject]..."
   Examples:
   - "According to an article published by Shanghai Securities News (上海证券报) in December 2007, Chen Yuxing..."
   - "According to mainstream media articles in November 2020, Hui's Brothers Currency Exchange Group..."
   - "According to an article published by 22ja.com (深圳生活网) in April 2013, Xu..."

3. ENTITY NAMES: Always use actual Chinese characters in parentheses, NEVER pinyin/romanization.
   CORRECT: "All Seasons Hotel Beijing Andingmen (全季酒店北京安定门店)"
   WRONG: "Ji Hotel (Quanji Jiudian)"
   CORRECT: "Ministry of Commerce (商务部)"
   WRONG: "Ministry of Commerce (Shangwubu)"
   Format: Full Name (中文, "Short")
   Example: "Yang Xiancai (杨贤才, "Yang")"

4. SPECIFICITY EXTRACTION: Pull exact numbers, percentages, monetary amounts, dates,
   regulatory body names, court names, and case numbers directly from the article text.
   NEVER summarize numbers vaguely (e.g., "overstating hotels") when the article gives
   specific figures (e.g., "claimed 688 hotels; alleged 1,952").

5. AMOUNTS: Always include USD conversion
   Format: CNY X million (USD Y million)
   Example: "CNY 7.5 million (USD 1.05 million)"

6. BODY: Topic sentence → Context → Specific facts → Outcome
   - Include specific dates when available
   - Include roles/titles
   - Include company names with Chinese if available
   - Include case numbers if available

7. SUB-INCIDENTS: When a finding contains MULTIPLE separate sub-incidents (e.g., multiple safety
   violations at different locations), list each as a bullet point with: date, location
   (English + 中文), specific details, outcome/resolution.

8. CROSS-REFERENCING: If this finding relates to another finding about the same subject
   (e.g., a lawsuit arising from a data breach), include: "Please see above for more
   information on [topic]."

9. CLOSING: End with neutral status update
   Examples:
   - "No information was found indicating X was further investigated or charged."
   - "Research did not find any information suggesting..."
   - "X was not penalized or accused of any wrongdoing for the issue."
   - "No further details relating to the issue were found."

10. INLINE REFERENCES: Use [${footnoteStartIndex}], [${footnoteStartIndex + 1}], etc. inline after
    relevant claims referencing the SOURCE URLs above. Do NOT add a trailing "Sources:" block —
    footnotes will be consolidated separately at the end of the full report.

STRICT RULES:
- Do NOT include severity labels (RED, AMBER, etc.)
- Do NOT editorialize or use dramatic language
- Do NOT add meta-commentary about the report
- Do NOT use bullet points unless listing multiple sub-incidents
- Keep tone neutral and factual throughout
- Write ${detailLevel}
- Use inline [N] references only — NO trailing "Sources:" section
- NEVER write hedging phrases like:
  - "requires further manual review of the source material"
  - "the full content was not automatically accessible"
  - "the available summaries confirm the identification of risk terms"
  Instead, state what IS known and close neutrally.

EXAMPLE OUTPUT 1 (multi-source consolidation with specific numbers):
Short-seller report alleging misrepresentation of hotel count and hygiene concerns (2019 – 2020)

According to a research report published by Bonitas Research in September 2019, H World Group Limited (华住集团有限公司, "H World"), formerly known as Huazhu Group, was accused of materially overstating its hotel count. The report alleged that H World claimed to operate approximately 5,618 hotels, when Bonitas' investigation identified only 3,666 open hotels — a 34.8% overstatement. The report further alleged that franchised RevPAR (Revenue Per Available Room) was overstated by approximately 25.4%. Bonitas took a short position against H World's stock (NASDAQ: HTHT).[${footnoteStartIndex}]

Chinese media outlets including Sina Finance (新浪财经) and Yicai Global (第一财经) reported on the Bonitas allegations. According to Yicai Global, H World's stock dropped approximately 3.3% on the day the report was published. H World subsequently issued a formal response denying the allegations, stating they were "without merit and contain numerous errors." No regulatory action was taken against H World in connection with these allegations. The stock price subsequently recovered.[${footnoteStartIndex + 1}]

EXAMPLE OUTPUT 2 (bullet-point sub-incidents with Chinese hotel names):
Fire safety and hygiene violations at multiple hotels (2019 – 2020)

According to local government enforcement records, several H World-operated hotels received administrative penalties for fire safety and hygiene violations:

- In June 2019, All Seasons Hotel Beijing Andingmen (全季酒店北京安定门店) was fined CNY 10,000 (USD 1,405) by the Dongcheng District Fire Department (东城区消防救援支队) for failing to maintain fire emergency exits in operable condition.
- In September 2019, Hanting Hotel Nantong Xinghu (汉庭酒店南通星湖101店) was fined CNY 40,000 (USD 5,620) by the Chongchuan District Health Bureau (崇川区卫生健康委员会) for failing to comply with public hygiene regulations.
- In March 2020, JI Hotel Shanghai Hongqiao (全季酒店上海虹桥店) was issued a warning by the Minhang District Fire Department (闵行区消防救援支队) for blocked fire exits during a routine inspection.

No information was found indicating that these violations resulted in major operational disruptions or led to broader regulatory actions against H World at the corporate level.

Now write the finding for the issue described above:`;

  const providers = getProviders();
  let fullResponse = '';

  for (const provider of providers) {
    try {
      console.log(`[REPORT] Generating write-up with ${provider.name} (streaming)...`);

      // Use streaming for better UX
      const response = await axios.post(
        provider.url,
        {
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          stream: true,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          timeout: 120000,
          responseType: 'stream',
        }
      );

      // Process SSE stream
      const streamResult = await new Promise<string>((resolve, reject) => {
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          buffer += text;

          // Process complete SSE messages
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullResponse += content;
                  onChunk(content);
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        });

        response.data.on('end', () => {
          console.log(`[REPORT] ✓ Write-up generated with ${provider.name}`);
          resolve(fullResponse);
        });

        response.data.on('error', (err: Error) => {
          reject(err);
        });
      });
      return { text: streamResult, footnotesUsed };

    } catch (error: any) {
      console.log(`[REPORT] ✗ ${provider.name} streaming failed: ${error.message || error}`);

      // Try non-streaming fallback
      try {
        console.log(`[REPORT] Trying ${provider.name} non-streaming...`);
        const response = await axios.post(
          provider.url,
          {
            model: provider.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
            },
            timeout: 120000,
          }
        );

        const content = response.data.choices?.[0]?.message?.content || '';
        if (content) {
          console.log(`[REPORT] ✓ Write-up generated with ${provider.name} (non-streaming)`);
          onChunk(content);
          return { text: content, footnotesUsed };
        }
      } catch (fallbackError: any) {
        console.log(`[REPORT] ✗ ${provider.name} non-streaming also failed: ${fallbackError.message}`);
      }
      continue;
    }
  }

  // Fallback: return basic formatted info
  const fallback = `${finding.headline}\n\n${finding.summary}\n\nNo additional details were found in online research.`;
  onChunk(fallback);
  return { text: fallback, footnotesUsed };
}

/**
 * Generate clean entity write-up using template language
 * LLM writes ONLY the descriptive clause; template wrapper is added programmatically
 */
export async function generateCleanWriteUp(
  entityName: string,
  searchResults: CleanEntityResult[],
  subjectName: string,
  onChunk: StreamCallback
): Promise<string> {
  const resultsText = searchResults.slice(0, 20).map(r =>
    `- ${r.title} (${r.url})\n  ${r.snippet}`
  ).join('\n');

  const prompt = `Given these search results for "${entityName}" (a subject in a due diligence screening for "${subjectName}"), write ONE sentence describing what the search results primarily relate to.

SEARCH RESULTS:
${resultsText}

Write ONLY the descriptive clause. Examples:
- "its operations as a subsidiary of Hainan Jinpan, as recorded by the company's Shanghai stock exchange filings"
- "its business registration records and corporate filings on mainstream aggregator websites"
- "his role as chairman of ABC Corp, as recorded by stock exchange announcements and corporate media"

Rules:
- One sentence only, no period at end
- Describe what the sources ARE ABOUT, not what they say
- Reference source types (stock filings, media, corporate records, etc.)
- Include relationship to parent subject if evident
- Neutral tone, professional English`;

  const providers = getProviders();

  for (const provider of providers) {
    try {
      console.log(`[REPORT] Generating clean write-up for "${entityName}" with ${provider.name}...`);
      const response = await axios.post(
        provider.url,
        {
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          timeout: 30000,
        }
      );

      const clause = response.data.choices?.[0]?.message?.content?.trim();
      if (clause) {
        console.log(`[REPORT] ✓ Clean write-up for "${entityName}" via ${provider.name}`);
        // Build the full template block
        const sourceList = searchResults.map(r => r.url).join('\n');
        const block = `Media and online coverage of ${entityName} is mainly neutral. Online and media references to ${entityName} primarily relate to ${clause}.[1]\nOnline and media research found no significant negative issues with the subject.\n\n[1]  ${sourceList}`;
        onChunk(block);
        return block;
      }
    } catch (err: any) {
      console.log(`[REPORT] ✗ ${provider.name} clean write-up failed: ${err.message}`);
      continue;
    }
  }

  // Fallback: generic clause
  const sourceList = searchResults.map(r => r.url).join('\n');
  const fallback = `Media and online coverage of ${entityName} is mainly neutral. Online and media references to ${entityName} primarily relate to its business operations and corporate filings.[1]\nOnline and media research found no significant negative issues with the subject.\n\n[1]  ${sourceList}`;
  onChunk(fallback);
  return fallback;
}

/**
 * Generate full report with streaming — covers all entities (flagged + clean)
 * Emits intro paragraph, findings with sequential [N] footnotes, and consolidated source list.
 */
export async function generateFullReport(
  subjectName: string,
  findings: ConsolidatedFinding[],
  cleanResults: Record<string, CleanEntityResult[]>,
  nameVariations: string[],
  onChunk: StreamCallback
): Promise<void> {
  // Determine which name variations have findings
  const flaggedEntities = new Set<string>();
  const findingsByEntity = new Map<string, ConsolidatedFinding[]>();

  for (const finding of findings) {
    // Match finding to name variation via source query or headline
    let matched = false;
    for (const nv of nameVariations) {
      const nvLower = nv.toLowerCase();
      // Check if any source relates to this name variation
      const relatesTo = finding.sources.some(s =>
        s.title.toLowerCase().includes(nvLower) || s.url.toLowerCase().includes(nvLower)
      ) || finding.headline.toLowerCase().includes(nvLower) || finding.summary.toLowerCase().includes(nvLower);

      if (relatesTo) {
        flaggedEntities.add(nv);
        if (!findingsByEntity.has(nv)) findingsByEntity.set(nv, []);
        findingsByEntity.get(nv)!.push(finding);
        matched = true;
      }
    }
    // If no match found, attribute to the first (primary) name variation
    if (!matched && nameVariations.length > 0) {
      const primary = nameVariations[0];
      flaggedEntities.add(primary);
      if (!findingsByEntity.has(primary)) findingsByEntity.set(primary, []);
      findingsByEntity.get(primary)!.push(finding);
    }
  }

  // Global footnote tracking
  let footnoteIndex = 1;
  const allSourceUrls: string[] = [];

  // Emit intro paragraph
  const coverage = findings.length > 3 ? 'extensive' : 'limited';
  // Generate a clean clause for intro from first clean entity if available
  let introClause = '';
  const firstCleanEntity = nameVariations.find(nv => !flaggedEntities.has(nv) && cleanResults[nv]?.length > 0);
  if (firstCleanEntity && cleanResults[firstCleanEntity]?.length > 0) {
    introClause = ` Online and media references to ${findings.length > 0 ? 'it' : 'them'} mostly relate to its business operations and corporate filings.`;
  }

  onChunk(`Media & Internet Searches\n\nSearches conducted of the media and internet retrieved ${coverage} coverage for ${subjectName}.${introClause}\n\n`);

  let blockIndex = 0;

  // Process each name variation in order
  for (const nv of nameVariations) {
    if (blockIndex > 0) {
      onChunk('\n\n');
    }

    if (flaggedEntities.has(nv)) {
      // Flagged entity: generate write-up from findings
      const entityFindings = findingsByEntity.get(nv) || [];
      for (let i = 0; i < entityFindings.length; i++) {
        if (i > 0) onChunk('\n\n');
        // Pass article content if available for richer, grounded write-ups
        const articleContent = entityFindings[i].articleContents?.map(ac => ac.content).join('\n\n---\n\n');
        const result = await generateWriteUp(entityFindings[i], subjectName, onChunk, articleContent || undefined, footnoteIndex);
        // Add snippet-based annotation if finding was based on metadata only
        if (entityFindings[i].snippetBased) {
          onChunk('\n\nNote: This finding is based on source metadata; full article content was not accessible at time of screening.');
        }
        // Collect source URLs for consolidated footnotes
        for (const src of entityFindings[i].sources) {
          allSourceUrls.push(src.url);
        }
        footnoteIndex += result.footnotesUsed;
      }
    } else if (cleanResults[nv] && cleanResults[nv].length > 0) {
      // Clean entity: generate template-based write-up
      await generateCleanWriteUp(nv, cleanResults[nv], subjectName, onChunk);
      // Clean write-ups have their own inline [1] — not tracked globally
    } else {
      // Entity with no results at all — still include with generic template
      const block = `Media and online coverage of ${nv} is mainly neutral. Online and media references to ${nv} primarily relate to its business operations and corporate filings.\nOnline and media research found no significant negative issues with the subject.`;
      onChunk(block);
    }

    blockIndex++;
  }

  // Also process any clean entities not in nameVariations (edge case)
  for (const [entity, results] of Object.entries(cleanResults)) {
    if (!nameVariations.includes(entity) && results.length > 0) {
      onChunk('\n\n');
      await generateCleanWriteUp(entity, results, subjectName, onChunk);
      blockIndex++;
    }
  }

  // Emit consolidated footnotes at the end
  if (allSourceUrls.length > 0) {
    onChunk('\n\n---\n\n');
    const footnoteBlock = allSourceUrls.map((url, i) => `[${i + 1}]  ${url}`).join('\n');
    onChunk(footnoteBlock);
  }
}
