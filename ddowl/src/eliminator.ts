/**
 * Programmatic Noise Eliminator
 *
 * Eliminates obvious noise BEFORE sending to LLM (saves cost).
 * Government domains (.gov.cn) bypass all rules.
 */

import { BatchSearchResult } from './searcher.js';
import { hasDirtyWordMatch } from './constants/dirtyWordEquivalents.js';

// ============================================================
// TYPES
// ============================================================

export type EliminationReason =
  | 'gov_domain_bypass'      // Not eliminated - .gov.cn protected
  | 'noise_domain'           // Rule 1: job sites, corporate aggregators
  | 'noise_title_pattern'    // Rule 2: job posting keywords
  | 'name_char_separation'   // Rule 3: "张,三" instead of "张三"
  | 'missing_dirty_word'     // Rule 4: no dirty word present
  | 'part_of_longer_name';   // Rule 5: 2-char name appears only as part of 3-char names

export interface EliminatedResult extends BatchSearchResult {
  reason: EliminationReason;
}

export interface EliminationResult {
  passed: BatchSearchResult[];
  eliminated: EliminatedResult[];
  bypassed: EliminatedResult[];  // .gov.cn domains (passed but tracked)
}

export interface EliminationBreakdown {
  gov_domain_bypass: number;
  noise_domain: number;
  noise_title_pattern: number;
  name_char_separation: number;
  missing_dirty_word: number;
  part_of_longer_name: number;
}

// ============================================================
// CONSTANTS
// ============================================================

// Noise domains - job sites and corporate aggregators
const NOISE_DOMAINS = [
  // Job sites
  'linkedin.com', 'indeed.com', '58.com', 'zhipin.com',
  'lagou.com', 'liepin.com', 'boss.zhipin.com', 'glassdoor.com',
  '51job.com', 'zhaopin.com', 'kanzhun.com',
  // Corporate aggregators (searched separately)
  'qichacha.com', 'tianyancha.com', 'qixin.com', 'aiqicha.com',
  // Problematic sites (hang, block, or return garbage)
  'xueqiu.com', 'douyin.com',
];

// Noise title patterns - job posting keywords
const NOISE_TITLE_PATTERNS = [
  '招聘', '职位', '求职', '简历', '应聘', '急招', '招人',
  '薪资', '薪酬', '待遇', '福利', '五险一金',
];

// ============================================================
// ELIMINATION FUNCTIONS
// ============================================================

/**
 * Rule 1: Check if URL is a noise domain
 */
function isNoiseDomain(url: string): boolean {
  if (!url) return false;
  return NOISE_DOMAINS.some(d => url.includes(d));
}

/**
 * Rule 2: Check if title contains noise patterns
 */
function hasNoiseTitlePattern(title: string): boolean {
  if (!title) return false;
  return NOISE_TITLE_PATTERNS.some(p => title.includes(p));
}

/**
 * Rule 3: Check if name characters appear separated by punctuation
 * E.g., "张,三" or "张;三" instead of "张三"
 */
function hasNameCharSeparation(text: string, name: string): boolean {
  // If name appears intact, not separated
  if (text.includes(name)) return false;

  const chars = name.split('');
  if (chars.length < 2) return false;

  // Check for patterns like "张,三" or "张 三" when "张三" doesn't appear
  const separatorPattern = chars.join('[,;，；、\\s]+');
  return new RegExp(separatorPattern).test(text);
}

/**
 * Rule 5: Check if 2-char name only appears as part of 3-char names
 * E.g., searching "李原" but finding "李原地" or "盛李原" (different people)
 */
function isOnlyPartOfLongerName(text: string, name: string): boolean {
  // Only applies to 2-character Chinese names
  if (name.length !== 2) return false;

  // Check if the name even appears in the text
  if (!text.includes(name)) return false;

  const chineseCharRegex = /[\u4e00-\u9fff]/;

  // Common Chinese grammatical particles that follow names (not part of names)
  const nonNameChars = ['被', '在', '的', '是', '等', '與', '与', '和', '或', '及', '為', '为', '已', '曾', '因', '于', '對', '对', '向', '从', '從'];

  let index = 0;
  let hasStandaloneOccurrence = false;

  while ((index = text.indexOf(name, index)) !== -1) {
    const charBefore = index > 0 ? text[index - 1] : '';
    const charAfter = text[index + name.length] || '';

    const hasChineBefore = chineseCharRegex.test(charBefore);
    const hasChineAfter = chineseCharRegex.test(charAfter);

    // Check if this is part of a longer name
    const isPartOfLongerBefore = hasChineBefore && !nonNameChars.includes(charBefore);
    const isPartOfLongerAfter = hasChineAfter && !nonNameChars.includes(charAfter);

    // If neither before nor after is a name character, this is a standalone occurrence
    if (!isPartOfLongerBefore && !isPartOfLongerAfter) {
      hasStandaloneOccurrence = true;
      break;
    }

    index++;
  }

  // Eliminate if ALL occurrences are part of longer names (no standalone)
  return !hasStandaloneOccurrence;
}

/**
 * Rule 4: Check if dirty words from query are missing
 * If only subject name appears but no dirty words, likely not relevant
 */
function isMissingDirtyWord(
  result: BatchSearchResult,
  subjectName: string
): boolean {
  // Extract dirty words from the search query that found this result
  // Query format: "张三" 贪污 | 贿赂 | 诈骗
  const query = result.query || '';

  // Parse dirty words from query (format: "XXX" word1 | word2 | word3)
  const dirtyWordPart = query.replace(/^"[^"]*"\s*/, '');
  const dirtyWords = dirtyWordPart
    .split('|')
    .map(w => w.trim())
    .filter(w => w.length > 0);

  // If no dirty words in query, don't eliminate (probably a site search)
  if (dirtyWords.length === 0) return false;

  // Check if text contains subject name
  const text = `${result.title || ''} ${result.snippet || ''}`;
  const hasName = text.includes(subjectName);

  // If name doesn't appear, let LLM decide (might still be relevant)
  if (!hasName) return false;

  // Check if any dirty word (or equivalent) appears
  const hasDirtyWord = hasDirtyWordMatch(text, dirtyWords);

  // Eliminate if: has name but no dirty word
  return !hasDirtyWord;
}

// ============================================================
// MAIN ELIMINATION FUNCTION
// ============================================================

/**
 * Eliminate obvious noise from search results.
 * Government domains (.gov.cn) bypass all rules.
 */
export function eliminateObviousNoise(
  results: BatchSearchResult[],
  subjectName: string
): EliminationResult {
  const passed: BatchSearchResult[] = [];
  const eliminated: EliminatedResult[] = [];
  const bypassed: EliminatedResult[] = [];

  for (const result of results) {
    // Rule 1: Noise domains
    if (isNoiseDomain(result.url)) {
      eliminated.push({ ...result, reason: 'noise_domain' });
      continue;
    }

    // Rule 2: Noise title patterns
    if (hasNoiseTitlePattern(result.title)) {
      eliminated.push({ ...result, reason: 'noise_title_pattern' });
      continue;
    }

    // Rule 3: Name character separation
    const text = `${result.title || ''} ${result.snippet || ''}`;
    if (hasNameCharSeparation(text, subjectName)) {
      eliminated.push({ ...result, reason: 'name_char_separation' });
      continue;
    }

    // Rule 4: DISABLED - was too aggressive, eliminating relevant adverse media
    // Articles found by one category query but containing another category were being eliminated
    // Let the LLM analyze all results properly instead
    // if (isMissingDirtyWord(result, subjectName)) {
    //   eliminated.push({ ...result, reason: 'missing_dirty_word' });
    //   continue;
    // }

    // Rule 5: 2-char name only appears as part of 3-char names (different person)
    if (isOnlyPartOfLongerName(text, subjectName)) {
      eliminated.push({ ...result, reason: 'part_of_longer_name' });
      continue;
    }

    // Passed all rules
    passed.push(result);
  }

  return { passed, eliminated, bypassed };
}

/**
 * Get breakdown of elimination reasons
 */
export function getEliminationBreakdown(
  eliminated: EliminatedResult[],
  bypassed: EliminatedResult[]
): EliminationBreakdown {
  return {
    gov_domain_bypass: bypassed.length,
    noise_domain: eliminated.filter(e => e.reason === 'noise_domain').length,
    noise_title_pattern: eliminated.filter(e => e.reason === 'noise_title_pattern').length,
    name_char_separation: eliminated.filter(e => e.reason === 'name_char_separation').length,
    missing_dirty_word: eliminated.filter(e => e.reason === 'missing_dirty_word').length,
    part_of_longer_name: eliminated.filter(e => e.reason === 'part_of_longer_name').length,
  };
}
