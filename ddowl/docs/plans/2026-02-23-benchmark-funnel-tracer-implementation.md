# Benchmark Funnel Tracer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track where expected adverse issues are lost in the screening pipeline by tracing keywords through each phase.

**Architecture:** Extend existing benchmark infrastructure with per-phase funnel snapshots and a keyword trace engine. Snapshots are captured in-memory during screening and saved to disk after completion. A deterministic trace function replays the snapshots to report where each expected issue survived or vanished.

**Tech Stack:** TypeScript, existing DD-Owl pipeline infrastructure, file-based JSON storage.

---

### Task 1: Extend Types

**Files:**
- Modify: `ddowl/src/types.ts:190-212`

**Step 1: Add new types after existing BenchmarkResult**

Add `id` and `category` to the expected issue type, add `FunnelSnapshot` and `TraceResult` types:

```typescript
// Replace existing BenchmarkCase (lines 191-200)
export interface ExpectedIssue {
  id: string;
  description: string;
  category: string;
  keywords: string[];
  severity: 'RED' | 'AMBER';
  yearRange?: [number, number];
}

export interface BenchmarkCase {
  subject: string;
  aliases?: string[];
  type: 'person' | 'company';
  region: 'hk' | 'cn' | 'global';
  expectedIssues: ExpectedIssue[];
}

// Funnel snapshot — one per phase
export interface FunnelPhaseSnapshot {
  phase: string;
  articles: { url: string; title: string; snippet?: string; clusterId?: string; clusterLabel?: string; classification?: string; eliminationRule?: string; parked?: boolean }[];
}

export interface FunnelSnapshot {
  subject: string;
  runId: string;
  timestamp: string;
  phases: FunnelPhaseSnapshot[];
}

// Trace result per expected issue
export interface IssueTrace {
  issueId: string;
  description: string;
  found: boolean;
  lostAtPhase?: string;
  lostReason?: string;
  phasePresence: { phase: string; matchCount: number; detail?: string }[];
}

export interface TraceReport {
  subject: string;
  runId: string;
  timestamp: string;
  recall: number;
  totalExpected: number;
  totalFound: number;
  traces: IssueTrace[];
}
```

**Step 2: Commit**

```bash
git add ddowl/src/types.ts
git commit -m "feat: add FunnelSnapshot and TraceReport types for benchmark tracer"
```

---

### Task 2: Add Xiaomi Benchmark Case

**Files:**
- Modify: `ddowl/src/metrics/benchmarks.ts:1-42`

**Step 1: Add Xiaomi case to BENCHMARK_CASES array**

Add after the existing 许楚家 case. The 36 expected issues are derived from `/Users/jimmyhou/Desktop/Logs/Log1.MD`. Each issue has an `id`, `category`, `keywords` (Chinese + English), and `severity`.

Key keyword selection principle: use the most unique/specific terms from each incident — names of people, specific amounts, company names, regulation names — not generic words like "corruption" alone.

Update `getBenchmarkCase()` to also check `aliases`:

```typescript
export function getBenchmarkCase(subject: string): BenchmarkCase | undefined {
  return BENCHMARK_CASES.find(c =>
    c.subject === subject || c.aliases?.includes(subject)
  );
}
```

**Step 2: Commit**

```bash
git add ddowl/src/metrics/benchmarks.ts
git commit -m "feat: add Xiaomi benchmark case with 36 expected issues"
```

---

### Task 3: Create Funnel Snapshot Storage

**Files:**
- Modify: `ddowl/src/logging/storage.ts`

**Step 1: Add saveFunnelSnapshot and loadFunnelSnapshot**

```typescript
import { FunnelSnapshot } from '../types.js';

export function saveFunnelSnapshot(snapshot: FunnelSnapshot): void {
  ensureDir(path.join(BENCHMARKS_DIR, 'funnels'));
  const safeName = snapshot.subject.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  const filename = `${snapshot.timestamp.split('T')[0]}-${safeName}.json`;
  const filepath = path.join(BENCHMARKS_DIR, 'funnels', filename);
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
  console.log(`[BENCHMARK] Funnel snapshot saved: ${filepath}`);
}
```

**Step 2: Commit**

```bash
git add ddowl/src/logging/storage.ts
git commit -m "feat: add funnel snapshot storage for benchmark tracer"
```

---

### Task 4: Create Trace Engine

**Files:**
- Create: `ddowl/src/metrics/tracer.ts`

**Step 1: Write the trace engine**

The trace engine takes a `FunnelSnapshot` and a `BenchmarkCase`, then for each expected issue, searches through each phase's articles for keyword matches.

```typescript
import { BenchmarkCase, FunnelSnapshot, IssueTrace, TraceReport } from '../types.js';

function keywordMatchesText(keywords: string[], text: string): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

export function traceFunnel(snapshot: FunnelSnapshot, benchmark: BenchmarkCase): TraceReport {
  const traces: IssueTrace[] = [];

  for (const issue of benchmark.expectedIssues) {
    const phasePresence: IssueTrace['phasePresence'] = [];
    let found = false;
    let lostAtPhase: string | undefined;
    let lostReason: string | undefined;
    let lastSeenPhase: string | undefined;

    for (const phase of snapshot.phases) {
      const matches = phase.articles.filter(a => {
        const text = `${a.title || ''} ${a.snippet || ''} ${a.clusterLabel || ''}`;
        return keywordMatchesText(issue.keywords, text);
      });

      phasePresence.push({
        phase: phase.phase,
        matchCount: matches.length,
        detail: matches.length > 0
          ? matches.slice(0, 3).map(m => m.title?.slice(0, 60)).join('; ')
          : undefined,
      });

      if (matches.length > 0) {
        lastSeenPhase = phase.phase;

        // Check if all matches were eliminated/parked/GREEN
        if (phase.phase === 'elimination') {
          const eliminated = matches.filter(m => m.eliminationRule);
          if (eliminated.length === matches.length) {
            lostAtPhase = 'elimination';
            lostReason = `All ${matches.length} articles eliminated (rules: ${[...new Set(eliminated.map(e => e.eliminationRule))].join(', ')})`;
          }
        }
        if (phase.phase === 'categorize') {
          const greened = matches.filter(m => m.classification === 'GREEN');
          if (greened.length === matches.length) {
            lostAtPhase = 'categorize';
            lostReason = `All ${matches.length} matching clusters classified GREEN`;
          }
        }
        if (phase.phase === 'clustering') {
          const parked = matches.filter(m => m.parked);
          if (parked.length === matches.length) {
            lostAtPhase = 'clustering';
            lostReason = `All ${matches.length} articles parked (not in top 5 per cluster)`;
          }
        }
      }

      // Final phase — if matches exist here, it's FOUND
      if (phase.phase === 'consolidate' && matches.length > 0) {
        found = true;
        lostAtPhase = undefined;
        lostReason = undefined;
      }
    }

    // If never found in any phase
    if (!found && !lostAtPhase) {
      if (!lastSeenPhase) {
        lostAtPhase = 'gather';
        lostReason = 'No articles with matching keywords were gathered';
      } else {
        lostAtPhase = lastSeenPhase;
        lostReason = `Last seen at ${lastSeenPhase} but not in final output`;
      }
    }

    traces.push({
      issueId: issue.id,
      description: issue.description,
      found,
      lostAtPhase: found ? undefined : lostAtPhase,
      lostReason: found ? undefined : lostReason,
      phasePresence,
    });
  }

  const totalFound = traces.filter(t => t.found).length;

  return {
    subject: snapshot.subject,
    runId: snapshot.runId,
    timestamp: new Date().toISOString(),
    recall: benchmark.expectedIssues.length > 0
      ? Math.round((totalFound / benchmark.expectedIssues.length) * 100) / 100
      : 1,
    totalExpected: benchmark.expectedIssues.length,
    totalFound,
    traces,
  };
}

export function printTraceReport(report: TraceReport): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`BENCHMARK: ${report.subject}`);
  console.log(`Recall: ${report.totalFound}/${report.totalExpected} (${Math.round(report.recall * 100)}%)`);
  console.log('='.repeat(60));

  const found = report.traces.filter(t => t.found);
  const lost = report.traces.filter(t => !t.found);

  if (found.length > 0) {
    console.log(`\nFOUND (${found.length}):`);
    for (const t of found) {
      const lastPhase = t.phasePresence.filter(p => p.matchCount > 0).pop();
      console.log(`  [OK] ${t.description} → ${lastPhase?.detail?.slice(0, 50) || ''}`);
    }
  }

  if (lost.length > 0) {
    console.log(`\nLOST (${lost.length}):`);
    for (const t of lost) {
      console.log(`  [MISS] ${t.description}`);
      for (const p of t.phasePresence) {
        if (p.matchCount > 0) {
          console.log(`    ${p.phase}: ${p.matchCount} matches — ${p.detail || ''}`);
        }
      }
      console.log(`    LOST AT: ${t.lostAtPhase} — ${t.lostReason}`);
    }
  }

  console.log(`\n${'='.repeat(60)}\n`);
}
```

**Step 2: Commit**

```bash
git add ddowl/src/metrics/tracer.ts
git commit -m "feat: add keyword trace engine for benchmark funnel analysis"
```

---

### Task 5: Add Funnel Snapshots to Pipeline

**Files:**
- Modify: `ddowl/src/server.ts`

**Step 1: Import and initialize**

At the top of `server.ts`, add imports:

```typescript
import { traceFunnel, printTraceReport } from './metrics/tracer.js';
import { saveFunnelSnapshot } from './logging/storage.js';
import { FunnelPhaseSnapshot, FunnelSnapshot } from './types.js';
```

**Step 2: After getBenchmarkCase check (near line 48), inside the V4 screening handler, add benchmark flag + accumulator**

After the `subjectName` is set (around line 1400), add:

```typescript
const benchmarkCase = getBenchmarkCase(subjectName);
const isBenchmarkRun = !!benchmarkCase;
const funnelPhases: FunnelPhaseSnapshot[] = [];
```

**Step 3: Add snapshot at Phase 2.0 (Elimination) — after line ~2220**

After `eliminateObviousNoise()` returns and `passed`/`eliminated` arrays are populated:

```typescript
if (isBenchmarkRun) {
  funnelPhases.push({
    phase: 'elimination',
    articles: [
      ...passed.map(a => ({ url: a.url, title: a.title, snippet: a.snippet })),
      ...eliminated.map(a => ({ url: a.url, title: a.title, snippet: a.snippet, eliminationRule: a.rule })),
    ],
  });
}
```

**Step 4: Add snapshot at Phase 2.5 (Clustering) — after clustering completes (~line 2500)**

After `clusterResult` is set:

```typescript
if (isBenchmarkRun && clusterResult) {
  funnelPhases.push({
    phase: 'clustering',
    articles: [
      ...clusterResult.toAnalyze.map(a => ({ url: a.url, title: a.title, snippet: a.snippet, clusterId: a.clusterId, clusterLabel: a.clusterLabel })),
      ...clusterResult.parked.map(a => ({ url: a.url, title: a.title, snippet: a.snippet, clusterId: a.clusterId, clusterLabel: a.clusterLabel, parked: true })),
    ],
  });
}
```

**Step 5: Add snapshot at Phase 3 (Categorize) — after categorization completes (~line 2690)**

After `categorized` array is populated:

```typescript
if (isBenchmarkRun) {
  funnelPhases.push({
    phase: 'categorize',
    articles: categorized.map(a => ({
      url: a.url, title: a.title, snippet: a.snippet,
      clusterId: a.clusterId, clusterLabel: a.clusterLabel,
      classification: a.classification,
    })),
  });
}
```

**Step 6: Add snapshot at Phase 5 (Consolidate) — after consolidated findings (~line 3100)**

After `consolidatedFindings` is set:

```typescript
if (isBenchmarkRun) {
  funnelPhases.push({
    phase: 'consolidate',
    articles: consolidatedFindings.map(f => ({
      url: f.url || '', title: f.headline, snippet: f.summary,
    })),
  });
}
```

**Step 7: Run trace after Phase 5 — near line 3227 (where evaluateBenchmark is currently called)**

Replace or augment the existing `evaluateBenchmark` call:

```typescript
if (isBenchmarkRun && benchmarkCase) {
  const snapshot: FunnelSnapshot = {
    subject: subjectName,
    runId: metrics.runId,
    timestamp: new Date().toISOString(),
    phases: funnelPhases,
  };
  saveFunnelSnapshot(snapshot);
  const traceReport = traceFunnel(snapshot, benchmarkCase);
  printTraceReport(traceReport);
}
```

**Step 8: Commit**

```bash
git add ddowl/src/server.ts
git commit -m "feat: capture funnel snapshots and run benchmark trace after Phase 5"
```

---

### Task 6: Push and Verify

**Step 1: Build**

```bash
cd ddowl && npm run build
```

Ensure no TypeScript errors.

**Step 2: Push**

```bash
git push origin main
```

**Step 3: Run a Xiaomi screening and check Cloud Run logs for the trace report**

Look for `[BENCHMARK]` and the `=== BENCHMARK ===` trace output in logs.
