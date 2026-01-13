// src/triage.ts
import axios from 'axios';

const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions';

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

export async function triageSearchResults(
  results: SearchResult[],
  subjectName: string
): Promise<TriageOutput> {
  if (results.length === 0) {
    return { red: [], yellow: [], green: [] };
  }

  const resultsText = results.map((r, i) =>
    `${i + 1}. Title: ${r.title}\n   Snippet: ${r.snippet}`
  ).join('\n\n');

  const prompt = `You are screening search results for adverse media about "${subjectName}".

For each result, classify as:
- RED: Subject DIRECTLY involved in adverse activity (crime, fraud, sanctions, regulatory action)
- YELLOW: Unclear or ambiguous, needs more investigation
- GREEN: Obviously irrelevant (poetry, fiction, recipes, awards, generic company news)

IMPORTANT:
- When in doubt between YELLOW and GREEN, choose YELLOW
- Only GREEN if clearly NO connection to adverse media
- Subject just being mentioned in company news is GREEN unless adverse

SEARCH RESULTS:
${resultsText}

Return JSON only:
{
  "classifications": [
    {"index": 1, "classification": "GREEN", "reason": "award ceremony"},
    {"index": 2, "classification": "YELLOW", "reason": "regulatory mention unclear"},
    {"index": 3, "classification": "RED", "reason": "fraud investigation"}
  ]
}`;

  const response = await axios.post(
    KIMI_URL,
    {
      model: 'moonshot-v1-8k',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KIMI_API_KEY}`,
      },
      timeout: 60000,
    }
  );

  const text = response.data.choices?.[0]?.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: treat all as YELLOW
    return {
      red: [],
      yellow: results.map(r => ({ ...r, classification: 'YELLOW' as const, reason: 'parse failed' })),
      green: []
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const output: TriageOutput = { red: [], yellow: [], green: [] };

  for (const c of parsed.classifications) {
    const result = results[c.index - 1];
    if (!result) continue;

    const triaged: TriageResult = {
      url: result.url,
      title: result.title,
      classification: c.classification,
      reason: c.reason
    };

    if (c.classification === 'RED') output.red.push(triaged);
    else if (c.classification === 'YELLOW') output.yellow.push(triaged);
    else output.green.push(triaged);
  }

  return output;
}
