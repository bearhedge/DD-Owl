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
 * Extract identity signals from text to distinguish different people with same name
 */
function extractIdentitySignals(text: string): {
  companies: string[];
  titles: string[];
  locations: string[];
  gender: 'male' | 'female' | 'unknown';
  isVictim: boolean;
} {
  const textLower = text.toLowerCase();

  // Extract company names (look for patterns like "of XXX Company", "XXX Limited", etc.)
  const companyPatterns = [
    /(?:of|at|from)\s+([A-Z][A-Za-z\s]+(?:Limited|Ltd|Inc|Corp|Group|Holdings|Energy|Bank|Securities))/gi,
    /([A-Z][A-Za-z\s]+(?:Limited|Ltd|Inc|Corp|Group|Holdings|Energy|Bank|Securities))/gi,
    /([\u4e00-\u9fff]+(?:公司|集团|银行|证券|能源|有限))/g,
  ];
  const companies: string[] = [];
  for (const pattern of companyPatterns) {
    const matches = text.match(pattern);
    if (matches) companies.push(...matches.map(m => m.trim().toLowerCase()));
  }

  // Extract job titles
  const titlePatterns = [
    /(?:Chairman|CEO|Director|Executive|Manager|President|Vice President|CFO|COO)/gi,
    /(?:董事长|总裁|总经理|执行董事|董事|经理|主任|主席)/g,
  ];
  const titles: string[] = [];
  for (const pattern of titlePatterns) {
    const matches = text.match(pattern);
    if (matches) titles.push(...matches.map(m => m.toLowerCase()));
  }

  // Extract locations
  const locationPatterns = [
    /(?:Hong Kong|Beijing|Shanghai|Shenzhen|Guangzhou|Hunan|Zhejiang|Sichuan)/gi,
    /(?:香港|北京|上海|深圳|广州|湖南|浙江|四川|醴陵|株洲)/g,
  ];
  const locations: string[] = [];
  for (const pattern of locationPatterns) {
    const matches = text.match(pattern);
    if (matches) locations.push(...matches.map(m => m.toLowerCase()));
  }

  // Detect gender
  let gender: 'male' | 'female' | 'unknown' = 'unknown';
  if (/\b(her|she|女|girlfriend|wife|母亲|女士)\b/i.test(text)) gender = 'female';
  else if (/\b(his|he|男|boyfriend|husband|父亲|先生)\b/i.test(text)) gender = 'male';

  // Detect if person is victim (not perpetrator)
  const isVictim = /victim|killed by|murdered by|被杀|遇害|受害者|former boyfriend|前男友/.test(textLower);

  return {
    companies: [...new Set(companies)],
    titles: [...new Set(titles)],
    locations: [...new Set(locations)],
    gender,
    isVictim,
  };
}

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

  // Extract identity signals
  const identity = extractIdentitySignals(text);

  return {
    eventType,
    entities: uniqueEntities,
    years,
    keywords,
    // Add identity fields (extend the interface)
    ...identity,
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
 * Returns 0 if identity signals conflict (different people)
 */
export function calculateSimilarity(fp1: FindingFingerprint, fp2: FindingFingerprint): number {
  // CRITICAL: Check identity conflicts FIRST - if these conflict, NEVER merge
  const fp1Identity = fp1 as any; // Extended with identity fields
  const fp2Identity = fp2 as any;

  // Conflict: One is victim, other is perpetrator
  if (fp1Identity.isVictim !== fp2Identity.isVictim &&
      (fp1Identity.isVictim === true || fp2Identity.isVictim === true)) {
    console.log('[CONSOLIDATE] Identity conflict: victim vs perpetrator - not merging');
    return 0;
  }

  // Conflict: Different genders (if both known)
  if (fp1Identity.gender !== 'unknown' && fp2Identity.gender !== 'unknown' &&
      fp1Identity.gender !== fp2Identity.gender) {
    console.log('[CONSOLIDATE] Identity conflict: different genders - not merging');
    return 0;
  }

  // Conflict: Different companies (if both have companies and NO overlap)
  const companies1 = fp1Identity.companies || [];
  const companies2 = fp2Identity.companies || [];
  if (companies1.length > 0 && companies2.length > 0) {
    const companyOverlap = companies1.some((c1: string) =>
      companies2.some((c2: string) => c1.includes(c2) || c2.includes(c1))
    );
    if (!companyOverlap) {
      console.log(`[CONSOLIDATE] Identity conflict: different companies (${companies1[0]} vs ${companies2[0]}) - not merging`);
      return 0;
    }
  }

  // Conflict: Different job titles at different organizations
  const titles1 = fp1Identity.titles || [];
  const titles2 = fp2Identity.titles || [];
  if (titles1.length > 0 && titles2.length > 0 && companies1.length > 0 && companies2.length > 0) {
    const titleOverlap = titles1.some((t1: string) => titles2.includes(t1));
    const companyOverlap = companies1.some((c1: string) =>
      companies2.some((c2: string) => c1.includes(c2) || c2.includes(c1))
    );
    if (!titleOverlap && !companyOverlap) {
      console.log('[CONSOLIDATE] Identity conflict: different titles at different orgs - not merging');
      return 0;
    }
  }

  // No identity conflicts - proceed with similarity calculation
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

  // Company/title match bonus: +0.2 (strong identity signal)
  if (companies1.length > 0 && companies2.length > 0) {
    const companyMatch = companies1.some((c1: string) =>
      companies2.some((c2: string) => c1.includes(c2) || c2.includes(c1))
    );
    if (companyMatch) score += 0.2;
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
 * Uses clusterId from Phase 2.5 for grouping when available, falls back to fingerprint matching
 */
export async function consolidateFindings(
  findings: RawFinding[],
  subjectName: string
): Promise<ConsolidatedFinding[]> {
  if (findings.length === 0) return [];

  console.log(`[CONSOLIDATE] Processing ${findings.length} findings...`);

  // Check how many have cluster info from Phase 2.5
  const withCluster = findings.filter(f => f.clusterId);
  const withoutCluster = findings.filter(f => !f.clusterId);
  console.log(`[CONSOLIDATE] ${withCluster.length} with cluster info, ${withoutCluster.length} without`);

  // Group by clusterId first (from Phase 2.5 incident clustering)
  const clusterGroups = new Map<string, RawFinding[]>();
  for (const f of withCluster) {
    const key = f.clusterId!;
    if (!clusterGroups.has(key)) {
      clusterGroups.set(key, []);
    }
    clusterGroups.get(key)!.push(f);
  }

  // For findings without clusterId, fall back to fingerprint-based grouping
  let fallbackGroups: RawFinding[][] = [];
  if (withoutCluster.length > 0) {
    const findingsWithFp = withoutCluster.map(f => ({
      ...f,
      fingerprint: extractFingerprint(f.headline, f.summary)
    }));
    fallbackGroups = groupFindingsBySimilarity(findingsWithFp, 0.5);
    console.log(`[CONSOLIDATE] Fallback: grouped ${withoutCluster.length} findings into ${fallbackGroups.length} groups`);
  }

  // Combine all groups
  const allGroups: RawFinding[][] = [
    ...Array.from(clusterGroups.values()),
    ...fallbackGroups
  ];
  console.log(`[CONSOLIDATE] Total ${allGroups.length} groups (${clusterGroups.size} from clustering, ${fallbackGroups.length} from fallback)`);

  const consolidated: ConsolidatedFinding[] = [];

  for (const group of allGroups) {
    // Add fingerprints if not already present
    const groupWithFp = group.map(f => ({
      ...f,
      fingerprint: f.fingerprint || extractFingerprint(f.headline, f.summary)
    }));

    if (groupWithFp.length === 1) {
      // Single finding - no consolidation needed
      const f = groupWithFp[0];
      consolidated.push({
        headline: f.headline,
        summary: f.summary,
        severity: f.severity,
        eventType: f.fingerprint?.eventType || 'other',
        dateRange: f.fingerprint?.years.join('-') || '',
        sourceCount: 1,
        sources: [{ url: f.url, title: f.title }],
        clusterId: f.clusterId,
        clusterLabel: f.clusterLabel,
      });
    } else {
      // Multiple findings - consolidate with LLM
      const label = groupWithFp[0].clusterLabel || 'same incident';
      console.log(`[CONSOLIDATE] Merging ${groupWithFp.length} findings about "${label}"`);
      const merged = await consolidateGroupWithLLM(groupWithFp, subjectName);
      // Preserve cluster info in consolidated result
      merged.clusterId = groupWithFp[0].clusterId;
      merged.clusterLabel = groupWithFp[0].clusterLabel;
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
