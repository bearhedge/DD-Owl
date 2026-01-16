// src/triage.ts
import axios from 'axios';

// LLM Configuration for Triage with Fallback Chain
// Priority: Gemini 2.5 Pro (best for triage) → DeepSeek → Kimi
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

interface LLMProvider {
  name: string;
  url: string;
  model: string;
  apiKey: string;
  timeout: number;
  isGemini?: boolean;
}

// Build provider list in priority order (only include configured providers)
function getProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];

  // 1. Gemini 2.5 Pro (PRIMARY for triage - 1M context, best accuracy)
  if (GEMINI_API_KEY) {
    providers.push({
      name: 'Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-06-05:generateContent',
      model: 'gemini-2.5-pro-preview-06-05',
      apiKey: GEMINI_API_KEY,
      timeout: 180000,
      isGemini: true,
    });
  }

  // 2. DeepSeek (fallback)
  if (DEEPSEEK_API_KEY) {
    providers.push({
      name: 'DeepSeek',
      url: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat',
      apiKey: DEEPSEEK_API_KEY,
      timeout: 120000,
    });
  }

  // 3. Kimi (last resort fallback)
  if (KIMI_API_KEY) {
    providers.push({
      name: 'Kimi',
      url: 'https://api.moonshot.ai/v1/chat/completions',
      model: 'moonshot-v1-8k',
      apiKey: KIMI_API_KEY,
      timeout: 120000,
    });
  }

  return providers;
}

// Check if error is content moderation related (should trigger fallback)
function isContentModerationError(error: any): boolean {
  const errorMessage = error?.response?.data?.error?.message || error?.message || '';
  const errorCode = error?.response?.data?.error?.code || '';

  // DeepSeek content moderation
  if (errorMessage.includes('Content Exists Risk')) return true;
  if (errorCode === 'content_filter') return true;

  // Kimi content moderation
  if (errorMessage.includes('content policy')) return true;
  if (errorMessage.includes('sensitive')) return true;

  // Rate limits should also trigger fallback
  if (error?.response?.status === 429) return true;

  return false;
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface TriageResult {
  url: string;
  title: string;
  classification: 'RED' | 'YELLOW' | 'GREEN';
  reason: string;
}

export interface TriageOutput {
  red: TriageResult[];
  yellow: TriageResult[];
  green: TriageResult[];
}

// Helper to call Gemini API (different format from OpenAI-compatible APIs)
async function callGeminiAPI(provider: LLMProvider, prompt: string): Promise<string> {
  const response = await axios.post(
    `${provider.url}?key=${provider.apiKey}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: provider.timeout,
    }
  );
  return response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Helper to call OpenAI-compatible APIs (DeepSeek, Kimi)
async function callOpenAICompatibleAPI(provider: LLMProvider, prompt: string): Promise<string> {
  const response = await axios.post(
    provider.url,
    {
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      timeout: provider.timeout,
    }
  );
  return response.data.choices?.[0]?.message?.content || '';
}

export async function triageSearchResults(
  results: SearchResult[],
  subjectName: string
): Promise<TriageOutput> {
  if (results.length === 0) {
    return { red: [], yellow: [], green: [] };
  }

  const providers = getProviders();
  if (providers.length === 0) {
    return {
      red: [],
      yellow: results.map(r => ({ ...r, classification: 'YELLOW' as const, reason: 'no api keys configured' })),
      green: []
    };
  }

  const resultsText = results.map((r, i) =>
    `${i + 1}. Title: ${r.title}\n   Snippet: ${r.snippet}`
  ).join('\n\n');

  const prompt = `You are a senior due diligence analyst screening search results about "${subjectName}".

⚠️ CRITICAL RULE - READ CAREFULLY:
The EXACT name "${subjectName}" MUST appear in the title or snippet to be flagged RED or YELLOW.
If the article is about a DIFFERENT person (e.g., 罗保铭, 王建祥, 张新起), mark it GREEN even if it contains crime keywords.
Do NOT flag articles just because they contain words like "corruption", "bribery", "fraud" - the subject name MUST be present.

CLASSIFICATION RULES:

1. NAME DETECTION - Does the exact name "${subjectName}" appear in title or snippet?
   NO → GREEN with reason "No name match" (STOP HERE - do not continue)
   YES → Continue to step 2

2. SUBJECT VERIFICATION - Is it about "${subjectName}" or a different person?
   Article is about someone else → GREEN "Different individual"
   Cannot determine → YELLOW "Name match - verify identity"
   Confirmed about "${subjectName}" → Continue to step 3

3. ADVERSE CONTENT - What type of content about "${subjectName}"?
   Clearly adverse (crime, fraud, sanctions, arrest) → RED with specific reason
   Possibly adverse or unclear → YELLOW with specific reason
   Neutral/positive content → GREEN "Neutral mention"

USE THESE STANDARD REASONS:
GREEN reasons:
- "No name match" (name not found)
- "Different individual" (clearly different person)
- "Neutral mention" (same person, no adverse info)
- "Partial match only" (name is substring of other text)

YELLOW reasons:
- "Name match - verify identity" (name found but cannot confirm same person)
- "Name match - context unclear" (same person but unclear if adverse)
- "Possible adverse mention" (hints at issues, needs verification)

RED reasons:
- "Criminal activity mentioned" (crime, fraud, theft)
- "Regulatory action mentioned" (sanctions, fines, bans)
- "Legal proceedings mentioned" (lawsuit, prosecution, arrest)
- "Financial misconduct mentioned" (fraud, manipulation, embezzlement)

SEARCH RESULTS:
${resultsText}

Return JSON only:
{
  "classifications": [
    {"index": 1, "classification": "GREEN", "reason": "No name match"},
    {"index": 2, "classification": "YELLOW", "reason": "Name match - verify identity"},
    {"index": 3, "classification": "RED", "reason": "Criminal activity mentioned"}
  ]
}`;

  // Try each provider in order until one succeeds
  let rawText = '';
  let lastError = '';

  for (const provider of providers) {
    console.log(`[PRE-SCREEN] Trying ${provider.name} (${provider.model})...`);

    try {
      if (provider.isGemini) {
        rawText = await callGeminiAPI(provider, prompt);
      } else {
        rawText = await callOpenAICompatibleAPI(provider, prompt);
      }

      console.log(`[PRE-SCREEN] ✓ ${provider.name} succeeded`);
      break; // Success! Exit the loop

    } catch (error: any) {
      const errorMessage = error?.response?.data?.error?.message
        || error?.response?.status
        || error?.message
        || 'unknown error';

      console.error(`[PRE-SCREEN] ✗ ${provider.name} failed: ${errorMessage}`);
      lastError = `${provider.name}: ${errorMessage}`;

      // Check if we should try the next provider
      if (isContentModerationError(error)) {
        console.log(`[PRE-SCREEN] Content moderation error, trying next provider...`);
        continue;
      }

      // For other errors (network, timeout), also try next provider
      continue;
    }
  }

  // If all providers failed
  if (!rawText) {
    console.error(`[PRE-SCREEN] All providers failed. Last error: ${lastError}`);
    return {
      red: [],
      yellow: results.map(r => ({ ...r, classification: 'YELLOW' as const, reason: `all apis failed: ${lastError}` })),
      green: []
    };
  }
  console.log('Triage LLM response (first 500 chars):', rawText.slice(0, 500));

  // Strip markdown code blocks that DeepSeek wraps around JSON
  const text = rawText.replace(/```json\s*/gi, '').replace(/```/g, '');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: treat all as YELLOW
    console.error('No JSON found in triage response. Full text:', text);
    return {
      red: [],
      yellow: results.map(r => ({ ...r, classification: 'YELLOW' as const, reason: 'parse failed' })),
      green: []
    };
  }

  // Fix #2: Wrap JSON.parse in try-catch for malformed JSON
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      red: [],
      yellow: results.map(r => ({ ...r, classification: 'YELLOW' as const, reason: 'parse failed' })),
      green: []
    };
  }

  // Fix #3: Validate that parsed.classifications exists and is an array
  if (!parsed.classifications || !Array.isArray(parsed.classifications)) {
    return {
      red: [],
      yellow: results.map(r => ({ ...r, classification: 'YELLOW' as const, reason: 'parse failed' })),
      green: []
    };
  }

  const output: TriageOutput = { red: [], yellow: [], green: [] };

  for (const c of parsed.classifications) {
    const result = results[c.index - 1];
    if (!result) continue;

    // Fix #4: Normalize classification to uppercase and validate
    const normalizedClassification = typeof c.classification === 'string'
      ? c.classification.toUpperCase()
      : 'YELLOW';
    const validClassification = ['RED', 'YELLOW', 'GREEN'].includes(normalizedClassification)
      ? normalizedClassification as 'RED' | 'YELLOW' | 'GREEN'
      : 'YELLOW';

    const triaged: TriageResult = {
      url: result.url,
      title: result.title,
      classification: validClassification,
      reason: c.reason
    };

    if (validClassification === 'RED') output.red.push(triaged);
    else if (validClassification === 'YELLOW') output.yellow.push(triaged);
    else output.green.push(triaged);
  }

  return output;
}

// ============================================================================
// BATCH CATEGORIZATION: Single LLM call for all search results
// ============================================================================

import { BatchSearchResult } from './searcher.js';

export interface CategorizedResult {
  url: string;
  title: string;
  snippet: string;
  query: string;
  category: 'RED' | 'AMBER' | 'GREEN';
  reason: string;
}

export interface CategorizedOutput {
  red: CategorizedResult[];
  amber: CategorizedResult[];
  green: CategorizedResult[];
}

/**
 * Categorize a batch of search results (max 50 at a time to stay under token limits)
 */
async function categorizeBatch(
  results: BatchSearchResult[],
  subjectName: string,
  batchOffset: number = 0
): Promise<CategorizedOutput> {
  const providers = getProviders();
  if (providers.length === 0) {
    return {
      red: [],
      amber: results.map(r => ({ ...r, category: 'AMBER' as const, reason: 'no api keys configured' })),
      green: []
    };
  }

  // Format results as numbered list
  const resultsText = results.map((r, i) =>
    `${i + 1}. Title: ${r.title.slice(0, 80)}\n   Snippet: ${(r.snippet || '').slice(0, 150)}`
  ).join('\n\n');

  const prompt = `Categorize ${results.length} search results about "${subjectName}" as RED/AMBER/GREEN.

CHINESE ADVERSE KEYWORDS - FLAG THESE:
RED (severe):
- 腐败/贪污/贿赂/受贿/行贿 = corruption/bribery
- 诈骗/欺诈/骗取 = fraud
- 洗钱 = money laundering
- 非法集资/非法吸收 = illegal fundraising
- 判刑/入狱/拘留/逮捕 = sentenced/imprisoned/detained/arrested
- 制裁/黑名单 = sanctions/blacklist

AMBER (investigate):
- 证监会/SFC/监管 = regulatory body mention
- 股权集中/异常交易 = concentration warning/unusual trading
- 调查/涉嫌/被查 = investigation/suspected/under inquiry
- 诉讼/起诉/纠纷 = lawsuit/prosecution/dispute
- 债务/欠款/违约 = debt/default
- 内幕交易 = insider trading

GREEN: No adverse keywords, different person, neutral business news

IMPORTANT: If title/snippet contains ANY of the above keywords about "${subjectName}", mark RED or AMBER accordingly. Do NOT mark GREEN if adverse keywords are present.

RESULTS:
${resultsText}

Return JSON only:
{"classifications":[{"index":1,"category":"GREEN","reason":"neutral"},{"index":2,"category":"RED","reason":"corruption mentioned"}]}`;

  let rawText = '';
  for (const provider of providers) {
    console.log(`[CATEGORIZE] Batch at offset ${batchOffset}: trying ${provider.name}...`);
    try {
      rawText = provider.isGemini
        ? await callGeminiAPI(provider, prompt)
        : await callOpenAICompatibleAPI(provider, prompt);
      console.log(`[CATEGORIZE] ✓ ${provider.name} succeeded`);
      break;
    } catch (error: any) {
      console.error(`[CATEGORIZE] ✗ ${provider.name} failed: ${error.message}`);
      continue;
    }
  }

  if (!rawText) {
    return { red: [], amber: results.map(r => ({ ...r, category: 'AMBER' as const, reason: 'api failed' })), green: [] };
  }

  // Parse response
  const text = rawText.replace(/```json\s*/gi, '').replace(/```/g, '');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { red: [], amber: results.map(r => ({ ...r, category: 'AMBER' as const, reason: 'parse failed' })), green: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { red: [], amber: results.map(r => ({ ...r, category: 'AMBER' as const, reason: 'parse failed' })), green: [] };
  }

  if (!parsed.classifications || !Array.isArray(parsed.classifications)) {
    console.error(`[CATEGORIZE] No classifications array in response`);
    return { red: [], amber: results.map(r => ({ ...r, category: 'AMBER' as const, reason: 'parse failed' })), green: [] };
  }

  console.log(`[CATEGORIZE] Got ${parsed.classifications.length} classifications for ${results.length} items`);

  // Track which items got classified
  const classifiedIndices = new Set<number>();
  const output: CategorizedOutput = { red: [], amber: [], green: [] };

  for (const c of parsed.classifications) {
    const result = results[c.index - 1];
    if (!result) continue;
    classifiedIndices.add(c.index - 1);
    const cat = (typeof c.category === 'string' ? c.category.toUpperCase() : 'AMBER') as 'RED' | 'AMBER' | 'GREEN';
    const validCat = ['RED', 'AMBER', 'GREEN'].includes(cat) ? cat : 'AMBER';
    const categorized = { ...result, category: validCat, reason: c.reason || 'no reason' };
    if (validCat === 'RED') output.red.push(categorized);
    else if (validCat === 'AMBER') output.amber.push(categorized);
    else output.green.push(categorized);
  }

  // Any items not classified default to AMBER (investigate)
  for (let i = 0; i < results.length; i++) {
    if (!classifiedIndices.has(i)) {
      console.warn(`[CATEGORIZE] Item ${i + 1} not classified, defaulting to AMBER: ${results[i].title?.slice(0, 50)}`);
      output.amber.push({ ...results[i], category: 'AMBER', reason: 'not classified by model' });
    }
  }

  return output;
}

/**
 * Categorize ALL search results in batches to avoid token limits.
 */
export async function categorizeAll(
  results: BatchSearchResult[],
  subjectName: string
): Promise<CategorizedOutput> {
  if (results.length === 0) {
    return { red: [], amber: [], green: [] };
  }

  const BATCH_SIZE = 50;
  const output: CategorizedOutput = { red: [], amber: [], green: [] };

  // Process in batches
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);
    console.log(`[CATEGORIZE] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(results.length/BATCH_SIZE)} (${batch.length} items)`);

    const batchResult = await categorizeBatch(batch, subjectName, i);
    output.red.push(...batchResult.red);
    output.amber.push(...batchResult.amber);
    output.green.push(...batchResult.green);
  }

  console.log(`[CATEGORIZE] Done: ${output.red.length} RED, ${output.amber.length} AMBER, ${output.green.length} GREEN`);
  return output;
}
