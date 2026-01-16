// src/consolidator.ts
// Consolidates duplicate findings about the same incident

import axios from 'axios';
import { FindingFingerprint, RawFinding, ConsolidatedFinding } from './types.js';

// LLM Configuration (same as triage.ts)
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Event type patterns for classification
const EVENT_TYPE_PATTERNS: { type: string; patterns: RegExp[] }[] = [
  {
    type: 'regulatory_investigation',
    patterns: [/ICAC/i, /廉政公署/i, /investigation/i, /调查/i, /probe/i, /inquiry/i]
  },
  {
    type: 'criminal_charge',
    patterns: [/arrested/i, /convicted/i, /sentenced/i, /被捕/i, /判刑/i, /定罪/i, /criminal/i]
  },
  {
    type: 'legal_proceedings',
    patterns: [/lawsuit/i, /court/i, /writ/i, /诉讼/i, /法院/i, /起诉/i, /defendant/i, /被告/i]
  },
  {
    type: 'administrative_penalty',
    patterns: [/penalty/i, /fine/i, /violation/i, /罚款/i, /处罚/i, /违规/i, /warning/i, /警告/i]
  },
  {
    type: 'financial_misconduct',
    patterns: [/fraud/i, /scam/i, /embezzlement/i, /诈骗/i, /欺诈/i, /挪用/i, /manipulation/i]
  },
  {
    type: 'traffic_violation',
    patterns: [/drink.?driv/i, /酒驾/i, /醉驾/i, /traffic/i, /交通/i, /驾驶/i, /license/i]
  }
];

// Entity patterns to extract
const ENTITY_PATTERNS: RegExp[] = [
  /ICAC/gi,
  /廉政公署/g,
  /Hong Kong/gi,
  /香港/g,
  /High Court/gi,
  /高等法院/g,
  /证监会/g,
  /SFC/gi,
  /SEC/gi,
  /FBI/gi,
  /police/gi,
  /警方/g,
];

/**
 * Extract a fingerprint from a finding for similarity matching
 */
export function extractFingerprint(headline: string, summary: string): FindingFingerprint {
  const text = `${headline} ${summary}`;

  // Extract event type
  let eventType = 'other';
  for (const { type, patterns } of EVENT_TYPE_PATTERNS) {
    if (patterns.some(p => p.test(text))) {
      eventType = type;
      break;
    }
  }

  // Extract years
  const yearMatches = text.match(/\b(19|20)\d{2}\b/g) || [];
  const years = [...new Set(yearMatches.map(y => parseInt(y)))].sort();

  // Extract entities
  const entities: string[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      entities.push(...matches.map(m => m.toLowerCase()));
    }
  }
  const uniqueEntities = [...new Set(entities)];

  // Extract key terms (nouns and important words)
  const keywords = extractKeywords(text);

  return {
    eventType,
    entities: uniqueEntities,
    years,
    keywords
  };
}

/**
 * Extract important keywords from text
 */
function extractKeywords(text: string): string[] {
  // Important terms to look for
  const importantTerms = [
    'icac', 'investigation', 'arrested', 'fraud', 'lawsuit', 'court',
    'penalty', 'fine', 'conviction', 'suspended', 'terminated',
    '调查', '逮捕', '诈骗', '诉讼', '法院', '罚款', '判决', '停职',
    'director', 'executive', 'chairman', 'ceo',
    '董事', '执行', '主席', '总裁'
  ];

  const textLower = text.toLowerCase();
  return importantTerms.filter(term => textLower.includes(term));
}

/**
 * Calculate similarity score between two fingerprints (0-1)
 */
export function calculateSimilarity(fp1: FindingFingerprint, fp2: FindingFingerprint): number {
  let score = 0;

  // Event type match: +0.4
  if (fp1.eventType === fp2.eventType && fp1.eventType !== 'other') {
    score += 0.4;
  }

  // Entity overlap: +0.3 (scaled)
  const entityOverlap = fp1.entities.filter(e => fp2.entities.includes(e)).length;
  const maxEntities = Math.max(fp1.entities.length, fp2.entities.length, 1);
  score += 0.3 * (entityOverlap / maxEntities);

  // Year overlap: +0.2
  const yearOverlap = fp1.years.filter(y => fp2.years.includes(y)).length;
  if (yearOverlap > 0) {
    score += 0.2;
  } else if (fp1.years.length > 0 && fp2.years.length > 0) {
    // Check if years are within 2 years of each other
    const minDiff = Math.min(
      ...fp1.years.flatMap(y1 => fp2.years.map(y2 => Math.abs(y1 - y2)))
    );
    if (minDiff <= 2) {
      score += 0.1;
    }
  }

  // Keyword overlap: +0.1
  const keywordOverlap = fp1.keywords.filter(k => fp2.keywords.includes(k)).length;
  if (keywordOverlap >= 2) {
    score += 0.1;
  }

  return Math.min(score, 1);
}

/**
 * Group findings by similarity
 */
export function groupFindingsBySimilarity(
  findings: RawFinding[],
  threshold: number = 0.5
): RawFinding[][] {
  if (findings.length === 0) return [];
  if (findings.length === 1) return [[findings[0]]];

  // Extract fingerprints for all findings
  const findingsWithFp = findings.map(f => ({
    finding: f,
    fingerprint: f.fingerprint || extractFingerprint(f.headline, f.summary)
  }));

  const groups: RawFinding[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < findingsWithFp.length; i++) {
    if (assigned.has(i)) continue;

    const group: RawFinding[] = [findingsWithFp[i].finding];
    assigned.add(i);

    // Find similar findings
    for (let j = i + 1; j < findingsWithFp.length; j++) {
      if (assigned.has(j)) continue;

      const similarity = calculateSimilarity(
        findingsWithFp[i].fingerprint,
        findingsWithFp[j].fingerprint
      );

      if (similarity >= threshold) {
        group.push(findingsWithFp[j].finding);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Get the highest severity from a group
 */
function getHighestSeverity(findings: RawFinding[]): 'RED' | 'AMBER' {
  return findings.some(f => f.severity === 'RED') ? 'RED' : 'AMBER';
}

/**
 * Consolidate a group of similar findings using LLM
 */
async function consolidateGroupWithLLM(
  findings: RawFinding[],
  subjectName: string
): Promise<ConsolidatedFinding> {
  const findingsText = findings.map((f, i) =>
    `${i + 1}. Headline: ${f.headline}\n   Summary: ${f.summary}\n   Source: ${f.url}`
  ).join('\n\n');

  const prompt = `You are consolidating multiple due diligence findings about "${subjectName}" that describe the SAME incident.

FINDINGS TO CONSOLIDATE:
${findingsText}

Create ONE consolidated finding that:
1. Combines ALL facts from all sources (dates, amounts, names, case numbers)
2. Uses the most complete and accurate details
3. Creates a comprehensive headline (one sentence)
4. Writes a detailed professional summary combining all information
5. Identifies the date range of the incident

Return JSON only:
{
  "headline": "Concise headline describing the incident",
  "summary": "Detailed 2-4 sentence professional summary with all facts from all sources",
  "eventType": "regulatory_investigation|criminal_charge|legal_proceedings|administrative_penalty|financial_misconduct|traffic_violation|other",
  "dateRange": "YYYY or YYYY-YYYY"
}`;

  // Try LLM providers in order
  const providers = [
    { name: 'Kimi', url: 'https://api.moonshot.ai/v1/chat/completions', key: KIMI_API_KEY, model: 'moonshot-v1-8k' },
    { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', key: DEEPSEEK_API_KEY, model: 'deepseek-chat' },
  ].filter(p => p.key);

  for (const provider of providers) {
    try {
      console.log(`[CONSOLIDATE] Trying ${provider.name} (${provider.model})...`);
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
            'Authorization': `Bearer ${provider.key}`,
          },
          timeout: 60000,
        }
      );

      const rawText = response.data.choices?.[0]?.message?.content || '';
      const text = rawText.replace(/```json\s*/gi, '').replace(/```/g, '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        console.log(`[CONSOLIDATE] ✓ ${provider.name} succeeded`);
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          headline: parsed.headline || findings[0].headline,
          summary: parsed.summary || findings[0].summary,
          severity: getHighestSeverity(findings),
          eventType: parsed.eventType || 'other',
          dateRange: parsed.dateRange || '',
          sourceCount: findings.length,
          sources: findings.map(f => ({ url: f.url, title: f.title }))
        };
      }
    } catch (error: any) {
      console.log(`[CONSOLIDATE] ✗ ${provider.name} failed: ${error.message || error}`);
      continue;
    }
  }

  // Fallback: use first finding's details
  console.log('[CONSOLIDATE] All LLM providers failed, using fallback');
  return {
    headline: findings[0].headline,
    summary: findings.map(f => f.summary).join(' | '),
    severity: getHighestSeverity(findings),
    eventType: 'other',
    dateRange: '',
    sourceCount: findings.length,
    sources: findings.map(f => ({ url: f.url, title: f.title }))
  };
}

/**
 * Main consolidation function
 */
export async function consolidateFindings(
  findings: RawFinding[],
  subjectName: string
): Promise<ConsolidatedFinding[]> {
  if (findings.length === 0) return [];

  console.log(`[CONSOLIDATE] Processing ${findings.length} findings...`);

  // Add fingerprints to findings
  const findingsWithFp = findings.map(f => ({
    ...f,
    fingerprint: extractFingerprint(f.headline, f.summary)
  }));

  // Group by similarity
  const groups = groupFindingsBySimilarity(findingsWithFp, 0.5);
  console.log(`[CONSOLIDATE] Grouped into ${groups.length} unique incidents`);

  const consolidated: ConsolidatedFinding[] = [];

  for (const group of groups) {
    if (group.length === 1) {
      // Single finding - no consolidation needed
      const f = group[0];
      consolidated.push({
        headline: f.headline,
        summary: f.summary,
        severity: f.severity,
        eventType: f.fingerprint?.eventType || 'other',
        dateRange: f.fingerprint?.years.join('-') || '',
        sourceCount: 1,
        sources: [{ url: f.url, title: f.title }]
      });
    } else {
      // Multiple findings - consolidate with LLM
      console.log(`[CONSOLIDATE] Merging ${group.length} findings about same incident`);
      const merged = await consolidateGroupWithLLM(group, subjectName);
      consolidated.push(merged);
    }
  }

  // Sort by severity (RED first) then by source count (more sources = more credible)
  consolidated.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'RED' ? -1 : 1;
    }
    return b.sourceCount - a.sourceCount;
  });

  return consolidated;
}
