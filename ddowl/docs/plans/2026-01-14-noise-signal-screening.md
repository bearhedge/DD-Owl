# NOISE vs SIGNAL Screening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor screening with hybrid noise elimination - programmatic for obvious garbage, LLM for categorization, then eliminate GREENs.

**Architecture:** Two-stage filtering: (1) FREE programmatic elimination catches obvious noise (job sites, corporate aggregators, missing dirty words), with .gov.cn bypass for authoritative sources; (2) LLM categorizes survivors as RED/AMBER/GREEN, then GREENs are eliminated. Only RED+AMBER get deep analysis.

**Tech Stack:** TypeScript, DeepSeek API, existing searcher.ts/triage.ts/server.ts

---

## Task 1: Create Dirty Word Equivalents Data File

**Files:**
- Create: `src/data/dirtyWordEquivalents.ts`

**Step 1: Create the data directory**

Run: `mkdir -p /Users/home/Desktop/DD\ Owl/ddowl/src/data`
Expected: Directory created (or already exists)

**Step 2: Create the equivalents mapping file**

Create `src/data/dirtyWordEquivalents.ts`:

```typescript
/**
 * Semantic equivalents mapping for dirty words.
 * Maps each dirty word to its variants (simplified <-> traditional, synonyms).
 * Used by programmatic eliminator Rule 4 to check if dirty words are present.
 */

export const DIRTY_WORD_EQUIVALENTS: Record<string, string[]> = {
  // === CRIME / CRIMINAL ===
  '贪污': ['貪污', '腐败', '腐敗', 'corruption', '贪腐', '貪腐'],
  '贿赂': ['賄賂', '受贿', '受賄', '行贿', '行賄', 'bribery', '索贿', '索賄'],
  '诈骗': ['詐騙', '欺诈', '欺詐', 'fraud', '骗局', '騙局'],
  '诈骗者': ['詐騙者', '骗子', '騙子'],
  '洗钱': ['洗錢', '洗黑钱', '洗黑錢', 'money laundering'],
  '谋杀': ['謀殺', 'murder', '杀人', '殺人'],
  '强奸': ['強姦', 'rape', '性侵'],
  '抢劫': ['搶劫', 'robbery', '打劫'],
  '盗窃': ['盜竊', '偷窃', '偷竊', 'theft', '窃取', '竊取'],
  '窃贼': ['竊賊', '小偷'],
  '逃犯': ['逃犯', 'fugitive'],

  // === LEGAL / COURT ===
  '被拘': ['被拘', '拘留', '拘捕', 'detained', 'arrested'],
  '被诉': ['被訴', '起诉', '起訴', 'prosecuted', 'sued'],
  '被起诉': ['被起訴', '遭起诉', '遭起訴'],
  '逮捕': ['逮捕', 'arrest', '抓捕'],
  '判决': ['判決', 'verdict', '宣判'],
  '审判': ['審判', 'trial', '庭审', '庭審'],
  '开庭': ['開庭', 'court hearing'],
  '监禁': ['監禁', 'imprisonment', '入狱', '入獄'],
  '收监': ['收監', 'incarcerated'],
  '假释': ['假釋', 'parole'],
  '定罪': ['定罪', 'convicted', '有罪'],
  '轻罪': ['輕罪', 'misdemeanor'],
  '重罪': ['重罪', 'felony'],

  // === FINANCIAL CRIME ===
  '内幕交易': ['內幕交易', '内线交易', '內線交易', 'insider trading'],
  '操纵股价': ['操縱股價', '股价操纵', '股價操縱', 'stock manipulation'],
  '操纵市场': ['操縱市場', 'market manipulation'],
  '操纵证券': ['操縱證券', 'securities manipulation'],
  '非法交易': ['非法交易', 'illegal trading'],
  '内幕消息': ['內幕消息', 'insider information'],

  // === REGULATORY ===
  '证监会': ['證監會', 'SFC', 'CSRC', '证期局', '證期局'],
  '处罚': ['處罰', 'penalty', '惩罚', '懲罰'],
  '罚款': ['罰款', 'fine', '被罚款', '被罰款'],
  '裁罚': ['裁罰', 'sanction'],
  '处分': ['處分', 'disciplinary action'],
  '警告': ['警告', 'warning'],
  '禁止': ['禁止', 'banned', '禁令'],
  '撤职': ['撤職', 'removed from position'],
  '停职': ['停職', 'suspended'],
  '制裁': ['制裁', 'sanction', '资产冻结', '資產凍結'],

  // === CORPORATE ===
  '破产': ['破產', 'bankruptcy', '清算'],
  '违约': ['違約', 'default'],
  '纠纷': ['糾紛', 'dispute'],
  '诉讼': ['訴訟', 'lawsuit', '官司'],

  // === INVESTIGATION ===
  '调查': ['調查', 'investigation', '查处', '查處'],
  '双规': ['雙規', 'shuanggui'],
  '检察官': ['檢察官', 'prosecutor'],
  '监察': ['監察', 'supervision', '纪检', '紀檢'],

  // === MISC ADVERSE ===
  '违法': ['違法', 'illegal', '违纪', '違紀'],
  '舞弊': ['舞弊', 'malpractice', '造假'],
  '虚假': ['虛假', 'false', '假帐', '假帳'],
  '黑手党': ['黑手黨', 'mafia', '黑社会', '黑社會'],
  '敲诈勒索': ['敲詐勒索', 'extortion', '勒索'],
  '回扣': ['回扣', 'kickback'],
  '走私': ['走私', 'smuggling'],

  // === LABOR / HUMAN RIGHTS ===
  '强迫劳动': ['強迫勞動', 'forced labor', '强制劳动', '強制勞動'],
  '强迫劳工': ['強迫勞工', 'forced workers'],
  '童工': ['童工', 'child labor'],
  '奴隶': ['奴隸', 'slave', '仆人', '僕人', '仆役', '僕役'],
  '剥削': ['剝削', 'exploitation'],
  '被贩卖': ['被販賣', 'trafficked'],
  '被绑架': ['被綁架', 'kidnapped'],

  // === TERRORISM / EXTREMISM ===
  '恐怖主义': ['恐怖主義', 'terrorism'],
  '恐怖分子': ['恐怖分子', 'terrorist'],
  '极端主义': ['極端主義', 'extremism'],
  '极端主义者': ['極端主義者', 'extremist'],

  // === DRUGS ===
  '毒贩': ['毒販', 'drug dealer'],
  '药物成瘾': ['藥物成癮', 'drug addiction'],
  '滥用药物': ['濫用藥物', 'drug abuse'],
  '麻药': ['麻藥', 'narcotics'],

  // === SINGLE CHARS (catch-all) ===
  '欺': ['欺', '欺骗', '欺騙'],
  '骗': ['騙', '诈骗', '詐騙'],
  '抢': ['搶', '抢劫', '搶劫'],
  '姦': ['姦', '强奸', '強姦'],
  '贿': ['賄', '贿赂', '賄賂'],
  '滥': ['濫', '滥用', '濫用'],
  '狱': ['獄', '监狱', '監獄'],
  '盗': ['盜', '盗窃', '盜竊'],
  '窃': ['竊', '窃取', '竊取'],
  '赌': ['賭', '赌博', '賭博'],
};

/**
 * Get all equivalent terms for a dirty word.
 * Returns the word itself plus all its equivalents.
 */
export function getEquivalents(word: string): string[] {
  const equivalents = DIRTY_WORD_EQUIVALENTS[word];
  if (equivalents) {
    return [word, ...equivalents];
  }
  // Check if this word is an equivalent of another
  for (const [key, values] of Object.entries(DIRTY_WORD_EQUIVALENTS)) {
    if (values.includes(word)) {
      return [key, ...values];
    }
  }
  return [word];
}

/**
 * Check if any dirty word (or its equivalents) appears in text.
 */
export function hasDirtyWordMatch(text: string, dirtyWords: string[]): boolean {
  const textLower = text.toLowerCase();
  for (const word of dirtyWords) {
    const equivalents = getEquivalents(word);
    for (const equiv of equivalents) {
      if (textLower.includes(equiv.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}
```

**Step 3: Verify compilation**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit src/data/dirtyWordEquivalents.ts`
Expected: No errors

**Step 4: Commit**

```bash
cd /Users/home/Desktop/DD\ Owl/ddowl
git add src/data/dirtyWordEquivalents.ts
git commit -m "feat(data): add dirty word semantic equivalents mapping

- Maps ~60 dirty words to simplified/traditional/synonym variants
- Includes getEquivalents() and hasDirtyWordMatch() helpers
- Used by programmatic eliminator Rule 4

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Programmatic Eliminator Module

**Files:**
- Create: `src/eliminator.ts`

**Step 1: Create the eliminator module**

Create `src/eliminator.ts`:

```typescript
import { BatchSearchResult } from './searcher.js';
import { hasDirtyWordMatch } from './data/dirtyWordEquivalents.js';

// ============================================================
// TYPES
// ============================================================

export type EliminationReason =
  | 'gov_domain_bypass'      // Not eliminated - .gov.cn protected
  | 'noise_domain'           // Rule 1: job sites, corporate aggregators
  | 'noise_title_pattern'    // Rule 2: job posting keywords
  | 'name_char_separation'   // Rule 3: "张,三" instead of "张三"
  | 'missing_dirty_word';    // Rule 4: no dirty word present

export interface EliminationResult {
  passed: BatchSearchResult[];
  eliminated: Array<BatchSearchResult & { reason: EliminationReason }>;
  bypassed: Array<BatchSearchResult & { reason: 'gov_domain_bypass' }>;
}

// ============================================================
// CONSTANTS
// ============================================================

// Government domains that bypass all elimination rules
const GOV_DOMAINS = ['.gov.cn', '.court.gov'];

// Noise domains - job sites and corporate aggregators
const NOISE_DOMAINS = [
  // Job sites
  'linkedin.com', 'indeed.com', '58.com', 'zhipin.com',
  'lagou.com', 'liepin.com', 'boss.zhipin.com', 'glassdoor.com',
  // Corporate aggregators (searched separately)
  'qichacha.com', 'tianyancha.com', 'qixin.com', 'aiqicha.com',
];

// Noise title patterns - job posting keywords
const NOISE_TITLE_PATTERNS = ['招聘', '职位', '求职', '简历', '应聘', '招人', '急招'];

// ============================================================
// ELIMINATION FUNCTIONS
// ============================================================

/**
 * Check if URL is a government domain (protected from elimination)
 */
function isGovDomain(url: string): boolean {
  return GOV_DOMAINS.some(d => url.includes(d));
}

/**
 * Rule 1: Check if URL is a noise domain
 */
function isNoiseDomain(url: string): boolean {
  return NOISE_DOMAINS.some(d => url.includes(d));
}

/**
 * Rule 2: Check if title contains noise patterns
 */
function hasNoiseTitlePattern(title: string): boolean {
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
 * Rule 4: Check if dirty words from query are missing
 * If only subject name appears but no dirty words, likely not relevant
 */
function isMissingDirtyWord(
  result: BatchSearchResult,
  subjectName: string
): boolean {
  // Extract dirty words from the search template that found this result
  const template = result.searchTemplate || '';

  // Parse dirty words from template (format: "XXX" word1 | word2 | word3)
  const dirtyWordPart = template.replace(/^"[^"]*"\s*/, '');
  const dirtyWords = dirtyWordPart
    .split('|')
    .map(w => w.trim())
    .filter(w => w.length > 0);

  if (dirtyWords.length === 0) return false;

  // Check if text contains subject name
  const text = `${result.title} ${result.snippet}`;
  const hasName = text.includes(subjectName);

  // Check if any dirty word (or equivalent) appears
  const hasDirtyWord = hasDirtyWordMatch(text, dirtyWords);

  // Eliminate if: has name but no dirty word
  return hasName && !hasDirtyWord;
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
  const eliminated: Array<BatchSearchResult & { reason: EliminationReason }> = [];
  const bypassed: Array<BatchSearchResult & { reason: 'gov_domain_bypass' }> = [];

  for (const result of results) {
    // BYPASS: Government domains skip all rules
    if (isGovDomain(result.url)) {
      bypassed.push({ ...result, reason: 'gov_domain_bypass' });
      passed.push(result); // Gov domains pass through
      continue;
    }

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
    const text = `${result.title} ${result.snippet}`;
    if (hasNameCharSeparation(text, subjectName)) {
      eliminated.push({ ...result, reason: 'name_char_separation' });
      continue;
    }

    // Rule 4: Missing dirty word
    if (isMissingDirtyWord(result, subjectName)) {
      eliminated.push({ ...result, reason: 'missing_dirty_word' });
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
  eliminated: Array<{ reason: EliminationReason }>
): Record<EliminationReason, number> {
  return {
    gov_domain_bypass: eliminated.filter(e => e.reason === 'gov_domain_bypass').length,
    noise_domain: eliminated.filter(e => e.reason === 'noise_domain').length,
    noise_title_pattern: eliminated.filter(e => e.reason === 'noise_title_pattern').length,
    name_char_separation: eliminated.filter(e => e.reason === 'name_char_separation').length,
    missing_dirty_word: eliminated.filter(e => e.reason === 'missing_dirty_word').length,
  };
}
```

**Step 2: Verify compilation**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit src/eliminator.ts`
Expected: No errors (or minor import issues to fix)

**Step 3: Commit**

```bash
cd /Users/home/Desktop/DD\ Owl/ddowl
git add src/eliminator.ts
git commit -m "feat(eliminator): add programmatic noise eliminator

- BYPASS: .gov.cn domains skip all rules (authoritative sources)
- Rule 1: Noise domains (job sites, corporate aggregators)
- Rule 2: Noise title patterns (招聘, 求职, etc.)
- Rule 3: Name char separation (张,三 instead of 张三)
- Rule 4: Missing dirty word (only name present)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update Triage to Categorize (Not Eliminate)

**Files:**
- Modify: `src/triage.ts`

**Step 1: Read current triage.ts to understand structure**

Run: Read `src/triage.ts` to see current implementation

**Step 2: Update the LLM prompt to categorize only**

Modify the `triageSearchResults` or `categorizeAll` function to use this prompt:

```typescript
const prompt = `You are a due diligence analyst categorizing ${results.length} search results about "${subjectName}".

For EACH result, categorize as:
- RED: Clear adverse info (crime, conviction, fraud, sanctions, arrest, imprisonment)
- AMBER: Possible adverse info (investigation, lawsuit, allegations, regulatory inquiry)
- GREEN: Not adverse (different person, neutral mention, irrelevant content)

IMPORTANT: The EXACT name "${subjectName}" must appear in title or snippet to be RED or AMBER.
If the article is about a DIFFERENT person, mark GREEN even with adverse keywords.

RESULTS:
${resultsText}

Return JSON array:
[
  {"index": 1, "category": "RED", "reason": "criminal conviction for fraud"},
  {"index": 2, "category": "AMBER", "reason": "under investigation by CSRC"},
  {"index": 3, "category": "GREEN", "reason": "different person named 王建祥"},
  {"index": 4, "category": "GREEN", "reason": "neutral company mention, no adverse info"}
]`;
```

**Step 3: Update return type**

```typescript
export interface LLMCategorizationResult {
  red: CategorizedResult[];
  amber: CategorizedResult[];
  green: CategorizedResult[];  // These will be eliminated after categorization
}
```

**Step 4: Verify compilation**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit src/triage.ts`
Expected: No errors

**Step 5: Commit**

```bash
cd /Users/home/Desktop/DD\ Owl/ddowl
git add src/triage.ts
git commit -m "refactor(triage): update LLM to categorize as RED/AMBER/GREEN

- LLM now categorizes only, does not eliminate
- GREEN results eliminated after categorization
- Clearer prompt with exact name matching requirement

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update V4 Endpoint with New Flow

**Files:**
- Modify: `src/server.ts`

**Step 1: Add imports at top of server.ts**

```typescript
import { eliminateObviousNoise, getEliminationBreakdown } from './eliminator.js';
```

**Step 2: Update V4 endpoint flow**

Find the V4 endpoint and update to this structure:

```typescript
// PHASE 1: GATHER
const allResults = await searchAll(subject, SEARCH_TEMPLATES);
sendEvent({ type: 'gathered', count: allResults.length });

// PHASE 2: PROGRAMMATIC ELIMINATION (FREE)
const { passed, eliminated: progEliminated, bypassed } = eliminateObviousNoise(allResults, subject);
const breakdown = getEliminationBreakdown(progEliminated);
sendEvent({
  type: 'programmatic_elimination',
  before: allResults.length,
  after: passed.length,
  eliminated: progEliminated.length,
  govBypassed: bypassed.length,
  breakdown,
});

// PHASE 3: LLM CATEGORIZE
const categorized = await categorizeAll(passed, subject);
sendEvent({
  type: 'llm_categorization',
  red: categorized.red.length,
  amber: categorized.amber.length,
  green: categorized.green.length,
});

// PHASE 4: ELIMINATE GREENs (implicit)
const toAnalyze = [...categorized.red, ...categorized.amber];
sendEvent({
  type: 'greens_eliminated',
  count: categorized.green.length,
  remaining: toAnalyze.length,
});

// PHASE 5: ANALYZE (fetch + deep analysis on RED + AMBER only)
for (const result of toAnalyze) {
  // ... existing fetch and analyze logic
}

// PHASE 6: CONSOLIDATE
const findings = await consolidateFindings(analyzed);
```

**Step 3: Verify compilation**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit`
Expected: No errors

**Step 4: Test the endpoint**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npm run dev`
Then: `curl "http://localhost:8080/api/screen/v4?name=许楚家"`

Expected: See SSE events for each phase:
- `gathered`
- `programmatic_elimination` with breakdown
- `llm_categorization` with RED/AMBER/GREEN counts
- `greens_eliminated`
- Analysis events
- Final findings

**Step 5: Commit**

```bash
cd /Users/home/Desktop/DD\ Owl/ddowl
git add src/server.ts
git commit -m "feat(v4): integrate programmatic elimination + categorization flow

- Phase 1: Gather search results
- Phase 2: Programmatic elimination (4 rules + .gov.cn bypass)
- Phase 3: LLM categorization (RED/AMBER/GREEN)
- Phase 4: Eliminate GREENs
- Phase 5: Analyze RED + AMBER only
- Phase 6: Consolidate findings

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Comprehensive Logging

**Files:**
- Modify: `src/server.ts` or create `src/screening-tracker.ts`

**Step 1: Create tracker structure**

```typescript
interface ScreeningTracker {
  runId: string;
  subject: string;
  startTime: string;

  gathered: {
    count: number;
    results: Array<{ url: string; title: string; template: string }>;
  };

  programmaticElimination: {
    passed: Array<{ url: string; title: string }>;
    bypassed: Array<{ url: string; title: string; reason: 'gov_domain_bypass' }>;
    eliminated: {
      noise_domain: Array<{ url: string; title: string }>;
      noise_title_pattern: Array<{ url: string; title: string }>;
      name_char_separation: Array<{ url: string; title: string }>;
      missing_dirty_word: Array<{ url: string; title: string }>;
    };
  };

  llmCategorization: {
    red: Array<{ url: string; title: string; reason: string }>;
    amber: Array<{ url: string; title: string; reason: string }>;
    green: Array<{ url: string; title: string; reason: string }>;
  };

  analyzed: {
    adverse: Array<{ url: string; severity: string; headline: string }>;
    cleared: Array<{ url: string; reason: string }>;
    failed: Array<{ url: string; error: string }>;
  };

  consolidated: Array<{ headline: string; severity: string; sourceCount: number }>;
}
```

**Step 2: Save tracker to logs directory**

```typescript
// At end of screening
const logPath = saveScreeningLog(subject, tracker.runId, tracker);
console.log(`[LOG] Saved to ${logPath}`);
```

**Step 3: Verify logs are created**

Run screening, then check: `ls -la /Users/home/Desktop/DD\ Owl/ddowl/logs/screenings/`
Expected: JSON files with full tracker data

**Step 4: Commit**

```bash
cd /Users/home/Desktop/DD\ Owl/ddowl
git add src/
git commit -m "feat(logging): add comprehensive screening tracker

- Track all results at each stage
- Log programmatic elimination breakdown
- Log LLM categorization decisions
- Log analysis outcomes
- Save to logs/screenings/ directory

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

- [ ] `src/data/dirtyWordEquivalents.ts` created and committed
- [ ] `src/eliminator.ts` created with 4 rules + .gov.cn bypass
- [ ] `src/triage.ts` updated to categorize as RED/AMBER/GREEN
- [ ] `src/server.ts` updated with new V4 flow
- [ ] Comprehensive logging in place
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run dev` starts without errors
- [ ] Test screening shows correct SSE events
- [ ] Logs saved to `logs/screenings/` directory

---

## End-to-End Test

```bash
# Start server
cd /Users/home/Desktop/DD\ Owl/ddowl && npm run dev

# Run test screening
curl "http://localhost:8080/api/screen/v4?name=许楚家"
```

**Verify SSE events show:**
1. `gathered` - total search results
2. `programmatic_elimination` - breakdown by rule, gov bypassed count
3. `llm_categorization` - RED/AMBER/GREEN counts
4. `greens_eliminated` - count eliminated
5. Analysis progress events
6. Final findings

**Verify logs:**
```bash
ls -la logs/screenings/许楚家/
cat logs/screenings/许楚家/*.json | head -100
```
