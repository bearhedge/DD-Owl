// src/triage.ts
import axios from 'axios';

// LLM Configuration for Triage with Fallback Chain
// Priority: Kimi K2 → DeepSeek → Gemini
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

  // 1. DeepSeek (primary - cheaper)
  if (DEEPSEEK_API_KEY) {
    providers.push({
      name: 'DeepSeek',
      url: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat',
      apiKey: DEEPSEEK_API_KEY,
      timeout: 120000,
    });
  }

  // 2. Kimi (fallback for content moderation issues)
  if (KIMI_API_KEY) {
    providers.push({
      name: 'Kimi',
      url: 'https://api.moonshot.ai/v1/chat/completions',
      model: 'moonshot-v1-8k',
      apiKey: KIMI_API_KEY,
      timeout: 120000,
    });
  }

  // 3. Gemini (last resort fallback)
  if (GEMINI_API_KEY) {
    providers.push({
      name: 'Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      model: 'gemini-2.0-flash',
      apiKey: GEMINI_API_KEY,
      timeout: 120000,
      isGemini: true,
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
 * Categorize ALL search results in a single LLM call.
 * This replaces the per-query triage with one batch call.
 */
export async function categorizeAll(
  results: BatchSearchResult[],
  subjectName: string
): Promise<CategorizedOutput> {
  if (results.length === 0) {
    return { red: [], amber: [], green: [] };
  }

  const providers = getProviders();
  if (providers.length === 0) {
    return {
      red: [],
      amber: results.map(r => ({
        ...r,
        category: 'AMBER' as const,
        reason: 'no api keys configured'
      })),
      green: []
    };
  }

  // Format all results as numbered list with query context
  const resultsText = results.map((r, i) =>
    `${i + 1}. [Query: ${r.query}]\n   Title: ${r.title}\n   Snippet: ${r.snippet}`
  ).join('\n\n');

  const prompt = `You are a senior due diligence analyst. You have ${results.length} search results about "${subjectName}".

TASK: Categorize each result as RED, AMBER, or GREEN based on title and snippet.

CATEGORIES:
- RED: Clear adverse info - crime, fraud, sanctions, conviction, arrest, prosecution
- AMBER: Possible adverse info - lawsuit, investigation, allegations, regulatory inquiry
- GREEN: No adverse info, neutral mention, or subject not mentioned

RULES:
1. The subject name "${subjectName}" should appear in title or snippet for RED/AMBER
2. If article is about a different person with similar name → GREEN
3. Corporate directory listings, job sites, aggregators → GREEN
4. News about crime/fraud that doesn't name the subject → GREEN

SEARCH RESULTS:
${resultsText}

Return JSON with classification for each result (use 1-indexed):
{
  "classifications": [
    {"index": 1, "category": "GREEN", "reason": "corporate directory"},
    {"index": 2, "category": "RED", "reason": "criminal conviction mentioned"},
    {"index": 3, "category": "AMBER", "reason": "investigation mentioned"}
  ]
}`;

  // Try each provider in order
  let rawText = '';
  let lastError = '';

  for (const provider of providers) {
    console.log(`[CATEGORIZE] Trying ${provider.name} for ${results.length} results...`);

    try {
      if (provider.isGemini) {
        rawText = await callGeminiAPI(provider, prompt);
      } else {
        rawText = await callOpenAICompatibleAPI(provider, prompt);
      }

      console.log(`[CATEGORIZE] ✓ ${provider.name} succeeded`);
      break;

    } catch (error: any) {
      const errorMessage = error?.response?.data?.error?.message
        || error?.response?.status
        || error?.message
        || 'unknown error';

      console.error(`[CATEGORIZE] ✗ ${provider.name} failed: ${errorMessage}`);
      lastError = `${provider.name}: ${errorMessage}`;

      if (isContentModerationError(error)) {
        console.log(`[CATEGORIZE] Content moderation error, trying next provider...`);
        continue;
      }
      continue;
    }
  }

  if (!rawText) {
    console.error(`[CATEGORIZE] All providers failed. Last error: ${lastError}`);
    return {
      red: [],
      amber: results.map(r => ({
        ...r,
        category: 'AMBER' as const,
        reason: `all apis failed: ${lastError}`
      })),
      green: []
    };
  }

  console.log('[CATEGORIZE] LLM response (first 500 chars):', rawText.slice(0, 500));

  // Parse response
  const text = rawText.replace(/```json\s*/gi, '').replace(/```/g, '');
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    console.error('[CATEGORIZE] No JSON found in response');
    return {
      red: [],
      amber: results.map(r => ({ ...r, category: 'AMBER' as const, reason: 'parse failed' })),
      green: []
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      red: [],
      amber: results.map(r => ({ ...r, category: 'AMBER' as const, reason: 'parse failed' })),
      green: []
    };
  }

  if (!parsed.classifications || !Array.isArray(parsed.classifications)) {
    return {
      red: [],
      amber: results.map(r => ({ ...r, category: 'AMBER' as const, reason: 'parse failed' })),
      green: []
    };
  }

  const output: CategorizedOutput = { red: [], amber: [], green: [] };

  for (const c of parsed.classifications) {
    const result = results[c.index - 1];
    if (!result) continue;

    const normalizedCategory = typeof c.category === 'string'
      ? c.category.toUpperCase()
      : 'AMBER';
    const validCategory = ['RED', 'AMBER', 'GREEN'].includes(normalizedCategory)
      ? normalizedCategory as 'RED' | 'AMBER' | 'GREEN'
      : 'AMBER';

    const categorized: CategorizedResult = {
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      query: result.query,
      category: validCategory,
      reason: c.reason || 'no reason given'
    };

    if (validCategory === 'RED') output.red.push(categorized);
    else if (validCategory === 'AMBER') output.amber.push(categorized);
    else output.green.push(categorized);
  }

  console.log(`[CATEGORIZE] Done: ${output.red.length} RED, ${output.amber.length} AMBER, ${output.green.length} GREEN`);
  return output;
}
