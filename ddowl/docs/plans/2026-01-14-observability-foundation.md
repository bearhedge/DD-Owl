# Observability Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add metrics tracking, cost estimation, and structured logging to DD Owl screenings to enable recall measurement.

**Architecture:** Create a logging/metrics layer that captures every screening event with timestamps, token counts, and costs. Store in local JSON files organized by subject/runId. Expose via API for historical viewing.

**Tech Stack:** TypeScript, Node.js fs module, existing Express server

---

## Task 1: Add Type Definitions

**Files:**
- Modify: `src/types.ts:90` (append at end)

**Step 1: Write the type definitions**

Add these interfaces to the end of `src/types.ts`:

```typescript
// ============================================================
// METRICS & LOGGING TYPES
// ============================================================

// Cost tracking per LLM call
export interface CostEstimate {
  provider: 'deepseek' | 'kimi' | 'gemini';
  operation: 'triage' | 'quickscan' | 'analysis' | 'consolidation';
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
}

// Per-screening metrics
export interface ScreeningMetrics {
  runId: string;
  subject: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;

  // Search metrics
  queriesExecuted: number;
  totalSearchResults: number;
  uniqueUrlsProcessed: number;
  duplicatesSkipped: number;

  // Triage metrics
  triageRed: number;
  triageYellow: number;
  triageGreen: number;

  // Analysis metrics
  fetchAttempted: number;
  fetchSucceeded: number;
  fetchFailed: number;
  analysisCompleted: number;

  // Output metrics
  findingsRed: number;
  findingsAmber: number;
  totalCleared: number;
  consolidationRatio: number;

  // Cost tracking
  costs: CostEstimate[];
  totalCostUSD: number;
}

// Benchmark case definition
export interface BenchmarkCase {
  subject: string;
  type: 'person' | 'company';
  region: 'hk' | 'cn' | 'global';
  expectedIssues: {
    description: string;
    keywords: string[];
    severity: 'RED' | 'AMBER';
  }[];
}

// Benchmark result
export interface BenchmarkResult {
  subject: string;
  runId: string;
  timestamp: string;
  expectedCount: number;
  foundCount: number;
  recall: number;
  matchedIssues: string[];
  missedIssues: string[];
}
```

**Step 2: Verify types compile**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit src/types.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add ScreeningMetrics, CostEstimate, BenchmarkCase interfaces

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Metrics Tracker Module

**Files:**
- Create: `src/metrics/tracker.ts`
- Create: `src/metrics/costs.ts`

**Step 1: Create the costs module with provider pricing**

Create `src/metrics/costs.ts`:

```typescript
// LLM provider pricing (USD per 1M tokens)
// Prices as of January 2026
export const PROVIDER_PRICING = {
  deepseek: {
    input: 0.14,   // $0.14 per 1M input tokens
    output: 0.28,  // $0.28 per 1M output tokens
  },
  kimi: {
    input: 0.70,   // ¥5 per 1M ≈ $0.70
    output: 1.40,  // ¥10 per 1M ≈ $1.40
  },
  gemini: {
    input: 0.075,  // $0.075 per 1M input tokens (Flash)
    output: 0.30,  // $0.30 per 1M output tokens (Flash)
  },
} as const;

export type Provider = keyof typeof PROVIDER_PRICING;

export function estimateCost(
  provider: Provider,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PROVIDER_PRICING[provider];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

// Estimate tokens from string length (rough approximation)
// Chinese: ~1.5 chars per token, English: ~4 chars per token
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}
```

**Step 2: Verify costs module compiles**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit src/metrics/costs.ts`
Expected: No errors

**Step 3: Create the tracker module**

Create `src/metrics/tracker.ts`:

```typescript
import { ScreeningMetrics, CostEstimate } from '../types.js';
import { estimateCost, estimateTokens, Provider } from './costs.js';

export class MetricsTracker {
  private metrics: ScreeningMetrics;

  constructor(subject: string) {
    this.metrics = {
      runId: `${this.sanitizeName(subject)}-${Date.now()}`,
      subject,
      startTime: new Date().toISOString(),
      queriesExecuted: 0,
      totalSearchResults: 0,
      uniqueUrlsProcessed: 0,
      duplicatesSkipped: 0,
      triageRed: 0,
      triageYellow: 0,
      triageGreen: 0,
      fetchAttempted: 0,
      fetchSucceeded: 0,
      fetchFailed: 0,
      analysisCompleted: 0,
      findingsRed: 0,
      findingsAmber: 0,
      totalCleared: 0,
      consolidationRatio: 0,
      costs: [],
      totalCostUSD: 0,
    };
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  }

  getRunId(): string {
    return this.metrics.runId;
  }

  // Search tracking
  recordQuery(resultsFound: number): void {
    this.metrics.queriesExecuted++;
    this.metrics.totalSearchResults += resultsFound;
  }

  recordUrlProcessed(isDuplicate: boolean): void {
    if (isDuplicate) {
      this.metrics.duplicatesSkipped++;
    } else {
      this.metrics.uniqueUrlsProcessed++;
    }
  }

  // Triage tracking
  recordTriage(red: number, yellow: number, green: number): void {
    this.metrics.triageRed += red;
    this.metrics.triageYellow += yellow;
    this.metrics.triageGreen += green;
  }

  // Fetch tracking
  recordFetch(success: boolean): void {
    this.metrics.fetchAttempted++;
    if (success) {
      this.metrics.fetchSucceeded++;
    } else {
      this.metrics.fetchFailed++;
    }
  }

  // Analysis tracking
  recordAnalysis(isAdverse: boolean, severity?: 'RED' | 'AMBER'): void {
    this.metrics.analysisCompleted++;
    if (isAdverse && severity === 'RED') {
      this.metrics.findingsRed++;
    } else if (isAdverse && severity === 'AMBER') {
      this.metrics.findingsAmber++;
    } else {
      this.metrics.totalCleared++;
    }
  }

  // Consolidation tracking
  recordConsolidation(beforeCount: number, afterCount: number): void {
    this.metrics.consolidationRatio = beforeCount > 0 ? beforeCount / afterCount : 0;
  }

  // Cost tracking
  recordLLMCall(
    provider: Provider,
    operation: CostEstimate['operation'],
    inputText: string,
    outputText: string
  ): void {
    const inputTokens = estimateTokens(inputText);
    const outputTokens = estimateTokens(outputText);
    const cost = estimateCost(provider, inputTokens, outputTokens);

    this.metrics.costs.push({
      provider,
      operation,
      inputTokens,
      outputTokens,
      estimatedCostUSD: cost,
    });

    this.metrics.totalCostUSD = Math.round(
      this.metrics.costs.reduce((sum, c) => sum + c.estimatedCostUSD, 0) * 1_000_000
    ) / 1_000_000;
  }

  // Finalize
  finalize(): ScreeningMetrics {
    this.metrics.endTime = new Date().toISOString();
    this.metrics.durationMs =
      new Date(this.metrics.endTime).getTime() -
      new Date(this.metrics.startTime).getTime();
    return this.metrics;
  }

  getMetrics(): ScreeningMetrics {
    return { ...this.metrics };
  }
}
```

**Step 4: Verify tracker module compiles**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit src/metrics/tracker.ts`
Expected: No errors

**Step 5: Commit**

```bash
git add src/metrics/
git commit -m "feat(metrics): add MetricsTracker and cost estimation

- Track queries, triage, fetch, analysis metrics
- Estimate LLM costs by provider (DeepSeek, Kimi, Gemini)
- Token estimation for Chinese/English text

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Storage Module

**Files:**
- Create: `src/logging/storage.ts`

**Step 1: Create the storage module**

Create `src/logging/storage.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ScreeningMetrics, BenchmarkResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base paths
const LOGS_DIR = path.join(__dirname, '../../logs');
const SCREENINGS_DIR = path.join(LOGS_DIR, 'screenings');
const METRICS_DIR = path.join(LOGS_DIR, 'metrics');
const BENCHMARKS_DIR = path.join(LOGS_DIR, 'benchmarks');

// Ensure directories exist
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Initialize all log directories
export function initLogDirectories(): void {
  ensureDir(SCREENINGS_DIR);
  ensureDir(METRICS_DIR);
  ensureDir(BENCHMARKS_DIR);
}

// Save screening log
export function saveScreeningLog(
  subject: string,
  runId: string,
  data: {
    metrics: ScreeningMetrics;
    findings: any[];
    eventLog: any[];
    triageLog?: any[];
  }
): string {
  const sanitizedSubject = subject.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  const subjectDir = path.join(SCREENINGS_DIR, sanitizedSubject);
  ensureDir(subjectDir);

  const filename = `${runId}.json`;
  const filepath = path.join(subjectDir, filename);

  const logData = {
    runId,
    subject,
    savedAt: new Date().toISOString(),
    ...data,
  };

  fs.writeFileSync(filepath, JSON.stringify(logData, null, 2));
  return filepath;
}

// Load screening log
export function loadScreeningLog(subject: string, runId: string): any | null {
  const sanitizedSubject = subject.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  const filepath = path.join(SCREENINGS_DIR, sanitizedSubject, `${runId}.json`);

  if (!fs.existsSync(filepath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

// List all screening logs for a subject
export function listScreeningLogs(subject?: string): { subject: string; runId: string; savedAt: string }[] {
  ensureDir(SCREENINGS_DIR);

  const results: { subject: string; runId: string; savedAt: string }[] = [];

  const subjects = subject
    ? [subject.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')]
    : fs.readdirSync(SCREENINGS_DIR).filter(f =>
        fs.statSync(path.join(SCREENINGS_DIR, f)).isDirectory()
      );

  for (const subj of subjects) {
    const subjDir = path.join(SCREENINGS_DIR, subj);
    if (!fs.existsSync(subjDir)) continue;

    const files = fs.readdirSync(subjDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(subjDir, file), 'utf8'));
        results.push({
          subject: data.subject || subj,
          runId: data.runId || file.replace('.json', ''),
          savedAt: data.savedAt || data.metrics?.startTime || 'unknown',
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return results.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

// Save daily metrics aggregate
export function saveDailyMetrics(date: string, metrics: ScreeningMetrics[]): void {
  ensureDir(path.join(METRICS_DIR, 'daily'));
  const filepath = path.join(METRICS_DIR, 'daily', `${date}.json`);

  const aggregate = {
    date,
    screeningCount: metrics.length,
    totalCostUSD: metrics.reduce((sum, m) => sum + m.totalCostUSD, 0),
    totalQueries: metrics.reduce((sum, m) => sum + m.queriesExecuted, 0),
    totalFindings: metrics.reduce((sum, m) => sum + m.findingsRed + m.findingsAmber, 0),
    metrics,
  };

  fs.writeFileSync(filepath, JSON.stringify(aggregate, null, 2));
}

// Save benchmark result
export function saveBenchmarkResult(result: BenchmarkResult): void {
  ensureDir(path.join(BENCHMARKS_DIR, 'results'));
  const filename = `${result.timestamp.split('T')[0]}-${result.subject.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.json`;
  const filepath = path.join(BENCHMARKS_DIR, 'results', filename);

  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
}

// Load benchmark results
export function loadBenchmarkResults(subject?: string): BenchmarkResult[] {
  const resultsDir = path.join(BENCHMARKS_DIR, 'results');
  ensureDir(resultsDir);

  const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
  const results: BenchmarkResult[] = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8'));
      if (!subject || data.subject === subject) {
        results.push(data);
      }
    } catch {
      // Skip invalid files
    }
  }

  return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
```

**Step 2: Verify storage module compiles**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit src/logging/storage.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/logging/
git commit -m "feat(logging): add local file storage for screening logs

- Save/load screening logs by subject/runId
- List all logs with metadata
- Support daily metrics aggregation
- Support benchmark result storage

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create Benchmark Module

**Files:**
- Create: `src/metrics/benchmarks.ts`

**Step 1: Create the benchmark module with 许楚家 case**

Create `src/metrics/benchmarks.ts`:

```typescript
import { BenchmarkCase, BenchmarkResult, ConsolidatedFinding } from '../types.js';

// Benchmark cases with known issues
export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    subject: '许楚家',
    type: 'person',
    region: 'hk',
    expectedIssues: [
      {
        description: 'Yang Xiancai corruption case involvement',
        keywords: ['杨贤才', '腐败', '司法', '贿赂'],
        severity: 'RED',
      },
      {
        description: 'Jingxuan Hotel violent seizure',
        keywords: ['京轩酒店', '暴力', '强占', '打砸'],
        severity: 'RED',
      },
      {
        description: 'Xinno Technology Park debt dispute',
        keywords: ['信诺科技园', '3.37亿', '债务', '纠纷'],
        severity: 'AMBER',
      },
      {
        description: 'SFC concentration warning',
        keywords: ['证监会', '股权集中', '警告', 'SFC'],
        severity: 'AMBER',
      },
      {
        description: 'Hui Brothers illegal fundraising',
        keywords: ['汇兄弟', '非法集资', '诈骗'],
        severity: 'RED',
      },
    ],
  },
];

// Find benchmark case by subject
export function getBenchmarkCase(subject: string): BenchmarkCase | undefined {
  return BENCHMARK_CASES.find(c => c.subject === subject);
}

// Evaluate screening results against benchmark
export function evaluateBenchmark(
  subject: string,
  findings: ConsolidatedFinding[],
  runId: string
): BenchmarkResult | null {
  const benchmark = getBenchmarkCase(subject);
  if (!benchmark) return null;

  const matchedIssues: string[] = [];
  const missedIssues: string[] = [];

  // Check each expected issue
  for (const expected of benchmark.expectedIssues) {
    const found = findings.some(finding => {
      // Check if any keyword appears in headline or summary
      const text = `${finding.headline} ${finding.summary}`.toLowerCase();
      return expected.keywords.some(kw => text.includes(kw.toLowerCase()));
    });

    if (found) {
      matchedIssues.push(expected.description);
    } else {
      missedIssues.push(expected.description);
    }
  }

  const recall = benchmark.expectedIssues.length > 0
    ? matchedIssues.length / benchmark.expectedIssues.length
    : 1;

  return {
    subject,
    runId,
    timestamp: new Date().toISOString(),
    expectedCount: benchmark.expectedIssues.length,
    foundCount: matchedIssues.length,
    recall: Math.round(recall * 100) / 100,
    matchedIssues,
    missedIssues,
  };
}
```

**Step 2: Verify benchmark module compiles**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit src/metrics/benchmarks.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/metrics/benchmarks.ts
git commit -m "feat(benchmarks): add 许楚家 benchmark case with 5 known issues

- Yang Xiancai corruption case
- Jingxuan Hotel violent seizure
- Xinno Technology Park debt dispute
- SFC concentration warning
- Hui Brothers illegal fundraising

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Log Viewing API Endpoint

**Files:**
- Modify: `src/server.ts`

**Step 1: Add imports at top of server.ts (after line 42)**

Add after the existing imports:

```typescript
import { initLogDirectories, saveScreeningLog, loadScreeningLog, listScreeningLogs, saveBenchmarkResult } from './logging/storage.js';
import { MetricsTracker } from './metrics/tracker.js';
import { evaluateBenchmark, getBenchmarkCase } from './metrics/benchmarks.js';
```

**Step 2: Initialize log directories at server startup (before app.use statements, around line 65)**

Add:

```typescript
// Initialize log directories
initLogDirectories();
```

**Step 3: Add API endpoints for log viewing (before the `server.listen` call, around line 1490)**

Add:

```typescript
// ============================================================
// SCREENING LOGS API
// ============================================================

// List all screening logs
app.get('/api/logs', (req: Request, res: Response) => {
  const subject = req.query.subject as string | undefined;
  const logs = listScreeningLogs(subject);
  res.json(logs);
});

// Get specific screening log
app.get('/api/logs/:subject/:runId', (req: Request, res: Response) => {
  const { subject, runId } = req.params;
  const log = loadScreeningLog(subject, runId);

  if (!log) {
    res.status(404).json({ error: 'Log not found' });
    return;
  }

  res.json(log);
});

// Get benchmark results
app.get('/api/benchmarks', (req: Request, res: Response) => {
  const subject = req.query.subject as string | undefined;
  const { loadBenchmarkResults } = require('./logging/storage.js');
  const results = loadBenchmarkResults(subject);
  res.json(results);
});

// Get benchmark case definition
app.get('/api/benchmarks/case/:subject', (req: Request, res: Response) => {
  const { subject } = req.params;
  const benchmarkCase = getBenchmarkCase(subject);

  if (!benchmarkCase) {
    res.status(404).json({ error: 'Benchmark case not found' });
    return;
  }

  res.json(benchmarkCase);
});
```

**Step 4: Verify server compiles**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit`
Expected: No errors

**Step 5: Test the endpoints**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npm run dev &`
Then: `curl http://localhost:8080/api/logs`
Expected: `[]` (empty array since no logs yet)

Run: `curl http://localhost:8080/api/benchmarks/case/许楚家`
Expected: JSON with benchmark case definition

**Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat(api): add /api/logs and /api/benchmarks endpoints

- GET /api/logs - list all screening logs
- GET /api/logs/:subject/:runId - get specific log
- GET /api/benchmarks - list benchmark results
- GET /api/benchmarks/case/:subject - get benchmark definition

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Integrate Metrics into V3 Screening

**Files:**
- Modify: `src/server.ts` (V3 endpoint, lines 395-770)

**Step 1: Create MetricsTracker at start of V3 endpoint**

Find line ~424 (after `const allFindings: RawFinding[] = [];`) and add:

```typescript
    // Initialize metrics tracker
    const tracker = new MetricsTracker(subjectName);
```

**Step 2: Track search queries**

Find line ~478 (after `const searchResults = await searchAllEngines...`) and add:

```typescript
      tracker.recordQuery(searchResults.length);
```

**Step 3: Track triage results**

Find line ~562 (after the triage summary sendEvent) and add:

```typescript
      tracker.recordTriage(triage.red.length, triage.yellow.length, triage.green.length);
```

**Step 4: Track fetch and analysis**

Find the quick scan and analysis sections. After each `fetchPageContent` call, add:

```typescript
        tracker.recordFetch(content.length >= 100);
```

After each `analyzeWithLLM` call, add:

```typescript
          tracker.recordAnalysis(analysis.isAdverse, analysis.severity as 'RED' | 'AMBER' | undefined);
```

**Step 5: Track consolidation**

Find line ~701 (after consolidateFindings call) and modify to:

```typescript
      consolidatedFindings = await consolidateFindings(allFindings, subjectName);
      tracker.recordConsolidation(allFindings.length, consolidatedFindings.length);
```

**Step 6: Save metrics and evaluate benchmark at end**

Replace the existing log saving section (lines ~729-759) with:

```typescript
    // Finalize metrics
    const metrics = tracker.finalize();

    // Evaluate against benchmark if applicable
    const benchmarkResult = evaluateBenchmark(subjectName, consolidatedFindings, metrics.runId);
    if (benchmarkResult) {
      saveBenchmarkResult(benchmarkResult);
      sendEvent({
        type: 'benchmark',
        recall: benchmarkResult.recall,
        matched: benchmarkResult.matchedIssues,
        missed: benchmarkResult.missedIssues,
      });
    }

    // Save complete screening log
    try {
      const logPath = saveScreeningLog(subjectName, metrics.runId, {
        metrics,
        findings: consolidatedFindings,
        eventLog,
        triageLog,
      });
      console.log(`[LOG] Saved screening log to ${logPath}`);
    } catch (logError) {
      console.error('[LOG] Failed to save screening log:', logError);
    }
```

**Step 7: Verify server compiles**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit`
Expected: No errors

**Step 8: Run a test screening**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npm run dev`
Open: `http://localhost:8080` and run screening for "许楚家"
Verify: Logs appear in `logs/screenings/许楚家/` directory
Verify: Benchmark result appears in `logs/benchmarks/results/`

**Step 9: Commit**

```bash
git add src/server.ts
git commit -m "feat(metrics): integrate MetricsTracker into V3 screening

- Track queries, triage, fetch, analysis metrics
- Auto-evaluate benchmark cases
- Save structured logs to logs/ directory

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After completing all tasks:

1. **Type compilation**: `npx tsc --noEmit` passes
2. **Server starts**: `npm run dev` runs without errors
3. **API endpoints work**:
   - `curl http://localhost:8080/api/logs` returns array
   - `curl http://localhost:8080/api/benchmarks/case/许楚家` returns benchmark
4. **Screening creates logs**: Run screening, check `logs/screenings/` has files
5. **Benchmark evaluation**: Check `logs/benchmarks/results/` has results
6. **Metrics populated**: Log files contain `metrics` object with all fields

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/types.ts` | Modify | Add ScreeningMetrics, CostEstimate, BenchmarkCase, BenchmarkResult |
| `src/metrics/costs.ts` | Create | LLM provider pricing and token estimation |
| `src/metrics/tracker.ts` | Create | MetricsTracker class |
| `src/metrics/benchmarks.ts` | Create | Benchmark cases and evaluation |
| `src/logging/storage.ts` | Create | Local file storage for logs |
| `src/server.ts` | Modify | Add API endpoints and integrate tracking |
