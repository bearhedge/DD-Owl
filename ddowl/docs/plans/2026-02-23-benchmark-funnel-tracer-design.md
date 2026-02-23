# Benchmark Funnel Tracer

## Problem

Our screening pipeline takes thousands of articles and funnels them down to a final report. Along the way, real adverse issues can get accidentally dropped — a filter removes the article, clustering merges it into the wrong group, or the categorizer marks it GREEN when it's actually adverse.

We have no way to know which issues were lost or where in the pipeline they disappeared.

## Solution

A "tracking dye" system. For benchmark subjects (e.g., Xiaomi), we define the known ground-truth issues with identifying keywords. After a screening run, we trace each expected issue through every pipeline phase to find where it survived or vanished.

The output is a recall report: "31/36 issues found. 5 lost. Issue X lost at Phase 3 (categorized GREEN)."

## Scope

- Only activates for subjects with a benchmark case defined
- Zero overhead for normal screenings
- No UI — report goes to stdout/Cloud Run logs
- No automatic fixing — just diagnosis
- Works for companies, persons, and subsidiaries

## Benchmark Case Structure

```typescript
interface ExpectedIssue {
  id: string;                    // "xiaomi-corruption-ouwen-2024"
  description: string;           // Human-readable summary
  category: string;              // "corruption" | "esg" | "litigation" | "regulatory" | "product" | "tax"
  severity: 'RED' | 'AMBER';
  keywords: string[];            // Chinese + English keywords to match
  yearRange?: [number, number];  // Optional year filter
}

interface BenchmarkCase {
  subject: string;               // "小米科技有限责任公司" or "许楚家"
  aliases?: string[];            // Alternative names that also trigger this benchmark
  type: 'company' | 'person';
  region: string;
  expectedIssues: ExpectedIssue[];
}
```

## Funnel Snapshot Capture

At each phase boundary, when `isBenchmarkRun` is true, snapshot the article list:

| Phase | What to save |
|-------|-------------|
| 2.0 Elimination | Passed articles + eliminated articles with rule |
| 2.1 Title Dedupe | Surviving articles + removed duplicates |
| 2.5 Clustering | Cluster assignments (clusterId, label, articles, parked flag) |
| 3.0 Categorize | Classification per cluster (RED/AMBER/GREEN) |
| 4.0 Analyze | Findings with severity and fetch status |
| 5.0 Consolidate | Final merged findings |

Stored as a single JSON file: `logs/benchmarks/<subject>-<timestamp>.json`

## Keyword Trace Algorithm

After Phase 5 completes:

```
For each ExpectedIssue:
  1. Search Phase 2.0 articles for keyword matches
     → "Found in N articles" or "0 articles — never gathered"
     → Check eliminated list: "M articles eliminated by rule X"

  2. Search Phase 2.1 for surviving matches
     → "N survived dedupe, M removed"

  3. Search Phase 2.5 for cluster assignments
     → "Mapped to cluster #X" or "Parked"

  4. Search Phase 3.0 for classification
     → "Cluster #X → RED/AMBER" or "GREEN — LOST HERE"

  5. Search Phase 4.0 for findings
     → "ADVERSE" or "FAILED (fetch error)"

  6. Search Phase 5.0 for final output
     → "Finding #F" or "Merged into #G"

  Result: FOUND or LOST at Phase X (with reason)
```

## Output Format

```
=== BENCHMARK: 小米科技有限责任公司 ===
Recall: 31/36 (86%)

FOUND (31):
  [1] Ou Wen & Chen Bingxu corruption (2024) → Finding #3 (RED)
  [2] India tax evasion multi-case → Finding #7 (RED)
  ...

LOST (5):
  [32] Coolpad patent suits (2018-2020)
    Phase 2.0: 2 articles matched keywords
    Phase 2.5: Clustered → incident #847 "Coolpad诉讼"
    Phase 3.0: Classified GREEN ← LOST HERE
    Reason: Categorizer saw "voluntarily withdraw" → marked non-adverse

  [34] Yuan Gong Yi patent suit (2018)
    Phase 2.0: 0 articles matched ← LOST HERE
    Reason: Search queries did not return results with these keywords
```

## Files to Modify

| File | Change |
|------|--------|
| `ddowl/src/metrics/benchmarks.ts` | Expand types, add Xiaomi case (36 issues from Log1.MD) |
| `ddowl/src/metrics/tracer.ts` | **New** — keyword trace engine |
| `ddowl/src/server.ts` | Funnel snapshot capture at phase boundaries, trigger trace after Phase 5 |
| `ddowl/src/logging/storage.ts` | `saveFunnelSnapshot()` / `loadFunnelSnapshot()` |

## Ground Truth: Xiaomi (36 issues)

Source: `/Users/jimmyhou/Desktop/Logs/Log1.MD`

Categories:
- Corruption/bribery: 4 issues (Ou Wen/Chen Bingxu 2024, Zhao Qian/Hao Liang 2019, VP Wang Liming 2019, internal anti-corruption 139 cases 2020-2022)
- ESG: 4 issues (Uyghur labor, Greenpeace ranking, Jiangsu wastewater, employee overwork death 2024, HR layoff threats 2022)
- Product: 7 issues (M365 scooter recall, Mi 13 warranty, SU7 crash Haikou, SU7 brake failure, 12315 complaints, smartphone quality, air conditioner)
- Regulatory: 6 issues (India app ban, BSI censorship probe, Italy fine, Jiefu Ruitong fine, false advertising, Taiwan sales fraud)
- Tax: 3 issues (MoF accounting irregularities, India tax evasion multi-case, DRI import tax)
- Antitrust: 2 issues (India CCI collusion, Poland UOKiK price-fixing)
- Litigation: 7 issues (Noyb data privacy, Beijing Tianmi Cross-Strait, patent suits 2024, Fractus Netherlands, Yuan Gong Yi, Coolpad, Ericsson India)
- IP: 1 issue (Zunpai trade secret)
- Smartphone demand manipulation (2013): 1 issue
