# Data Lock-in Verification System - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a robust verification system to iteratively review and lock-in the IPO bank extraction dataset.

**Architecture:** Run tracker saves versioned snapshots to git, verification UI shows diff between runs with sample review, automated validator flags suspicious extractions.

**Tech Stack:** TypeScript, SQLite, HTML/CSS/JS (vanilla), Express API

---

## Task 1: Create Run Tracker Module

**Files:**
- Create: `src/run-tracker.ts`
- Create: `runs/.gitkeep`

**Step 1: Create runs directory**

```bash
mkdir -p runs && touch runs/.gitkeep
```

**Step 2: Write the run-tracker module**

```typescript
// src/run-tracker.ts
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const RUNS_DIR = path.join(process.cwd(), 'runs');
const HISTORY_FILE = path.join(RUNS_DIR, 'run-history.json');

interface RunMetadata {
  run_id: string;
  timestamp: string;
  deals_processed: number;
  deals_with_banks: number;
  deals_without_banks: number;
  total_banks: number;
  total_relationships: number;
  git_commit: string;
  issues_found: number;
  is_clean: boolean;
}

interface RunHistory {
  runs: RunMetadata[];
  current_clean_streak: number;
  locked: boolean;
}

export function getNextRunId(): string {
  const history = loadHistory();
  const nextNum = history.runs.length + 1;
  return String(nextNum).padStart(3, '0');
}

export function loadHistory(): RunHistory {
  if (!fs.existsSync(HISTORY_FILE)) {
    return { runs: [], current_clean_streak: 0, locked: false };
  }
  return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
}

export function saveRun(results: any[], metadata: Partial<RunMetadata>): RunMetadata {
  const runId = getNextRunId();
  const timestamp = new Date().toISOString();
  const date = timestamp.split('T')[0];

  // Save results snapshot
  const snapshotFile = path.join(RUNS_DIR, `run-${runId}-${date}.json`);
  fs.writeFileSync(snapshotFile, JSON.stringify(results, null, 2));

  // Get git commit
  let gitCommit = 'none';
  try {
    gitCommit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch (e) {}

  const run: RunMetadata = {
    run_id: runId,
    timestamp,
    deals_processed: metadata.deals_processed || 0,
    deals_with_banks: metadata.deals_with_banks || 0,
    deals_without_banks: metadata.deals_without_banks || 0,
    total_banks: metadata.total_banks || 0,
    total_relationships: metadata.total_relationships || 0,
    git_commit: gitCommit,
    issues_found: 0,
    is_clean: false,
  };

  // Update history
  const history = loadHistory();
  history.runs.push(run);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  return run;
}

export function markRunClean(runId: string, issuesFound: number): void {
  const history = loadHistory();
  const run = history.runs.find(r => r.run_id === runId);
  if (run) {
    run.issues_found = issuesFound;
    run.is_clean = issuesFound === 0;

    if (run.is_clean) {
      history.current_clean_streak++;
    } else {
      history.current_clean_streak = 0;
    }

    if (history.current_clean_streak >= 3) {
      history.locked = true;
    }

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  }
}

export function getRunDiff(runId: string, prevRunId: string): any {
  const currentFile = fs.readdirSync(RUNS_DIR).find(f => f.includes(`run-${runId}`));
  const prevFile = fs.readdirSync(RUNS_DIR).find(f => f.includes(`run-${prevRunId}`));

  if (!currentFile || !prevFile) return null;

  const current = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, currentFile), 'utf8'));
  const prev = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, prevFile), 'utf8'));

  const currentMap = new Map(current.map((r: any) => [r.ticker, r]));
  const prevMap = new Map(prev.map((r: any) => [r.ticker, r]));

  const changes: any[] = [];

  for (const [ticker, curr] of currentMap) {
    const previous = prevMap.get(ticker);
    if (!previous) {
      changes.push({ ticker, type: 'added', current: curr });
    } else if (JSON.stringify(curr.banks) !== JSON.stringify(previous.banks)) {
      changes.push({ ticker, type: 'changed', current: curr, previous });
    }
  }

  for (const [ticker, prev] of prevMap) {
    if (!currentMap.has(ticker)) {
      changes.push({ ticker, type: 'removed', previous: prev });
    }
  }

  return changes;
}
```

**Step 3: Run TypeScript check**

Run: `npx tsc src/run-tracker.ts --noEmit --esModuleInterop --module NodeNext --moduleResolution NodeNext`
Expected: No errors

**Step 4: Commit**

```bash
git add src/run-tracker.ts runs/.gitkeep
git commit -m "feat: add run tracker for versioned extraction snapshots"
```

---

## Task 2: Create Automated Validator

**Files:**
- Create: `src/validator.ts`

**Step 1: Write the validator module**

```typescript
// src/validator.ts
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'ddowl.db');

interface ValidationFlag {
  ticker: number;
  company: string;
  flag: string;
  severity: 'high' | 'medium' | 'low';
  details: string;
}

export function validateDeals(): ValidationFlag[] {
  const db = new Database(DB_PATH, { readonly: true });
  const flags: ValidationFlag[] = [];

  // Flag: Single bank only
  const singleBank = db.prepare(`
    SELECT d.ticker, d.company, d.banks_extracted
    FROM ipo_deals d
    WHERE d.has_bank_info = 1 AND d.banks_extracted = 1
  `).all() as any[];

  for (const deal of singleBank) {
    flags.push({
      ticker: deal.ticker,
      company: deal.company,
      flag: 'SINGLE_BANK',
      severity: 'high',
      details: 'Only 1 bank extracted - unusual for IPO',
    });
  }

  // Flag: No sponsor
  const noSponsor = db.prepare(`
    SELECT d.ticker, d.company
    FROM ipo_deals d
    WHERE d.has_bank_info = 1
    AND NOT EXISTS (
      SELECT 1 FROM ipo_bank_roles r
      WHERE r.deal_id = d.ticker AND r.role = 'sponsor'
    )
  `).all() as any[];

  for (const deal of noSponsor) {
    flags.push({
      ticker: deal.ticker,
      company: deal.company,
      flag: 'NO_SPONSOR',
      severity: 'high',
      details: 'No sponsor role found',
    });
  }

  // Flag: Duplicate bank in same deal
  const duplicates = db.prepare(`
    SELECT d.ticker, d.company, b.name, COUNT(*) as cnt
    FROM ipo_deals d
    JOIN ipo_bank_roles r ON r.deal_id = d.ticker
    JOIN banks b ON b.id = r.bank_id
    WHERE d.has_bank_info = 1
    GROUP BY d.ticker, b.id
    HAVING cnt > 1
  `).all() as any[];

  for (const dup of duplicates) {
    flags.push({
      ticker: dup.ticker,
      company: dup.company,
      flag: 'DUPLICATE_BANK',
      severity: 'medium',
      details: `Bank "${dup.name}" appears ${dup.cnt} times`,
    });
  }

  db.close();
  return flags;
}

export function getFlaggedDeals(): Map<number, ValidationFlag[]> {
  const flags = validateDeals();
  const byTicker = new Map<number, ValidationFlag[]>();

  for (const flag of flags) {
    if (!byTicker.has(flag.ticker)) {
      byTicker.set(flag.ticker, []);
    }
    byTicker.get(flag.ticker)!.push(flag);
  }

  return byTicker;
}
```

**Step 2: Run TypeScript check**

Run: `npx tsc src/validator.ts --noEmit --esModuleInterop --module NodeNext --moduleResolution NodeNext`
Expected: No errors

**Step 3: Commit**

```bash
git add src/validator.ts
git commit -m "feat: add automated validator for flagging suspicious extractions"
```

---

## Task 3: Add Verification API Endpoints

**Files:**
- Modify: `src/server.ts`

**Step 1: Add imports at top of server.ts**

Add after existing imports:
```typescript
import { loadHistory, markRunClean, getRunDiff } from './run-tracker.js';
import { validateDeals, getFlaggedDeals } from './validator.js';
```

**Step 2: Add verification endpoints**

Add before the server.listen() call:
```typescript
// === VERIFICATION ENDPOINTS ===

// Get run history
app.get('/api/runs', (req, res) => {
  const history = loadHistory();
  res.json(history);
});

// Get sample deals for review
app.get('/api/verify/sample', async (req, res) => {
  const n = parseInt(req.query.n as string) || 20;
  const db = new Database(path.join(process.cwd(), 'data', 'ddowl.db'), { readonly: true });

  // Get random sample
  const deals = db.prepare(`
    SELECT d.ticker, d.company, d.prospectus_url, d.banks_extracted
    FROM ipo_deals d
    WHERE d.has_bank_info = 1
    ORDER BY RANDOM()
    LIMIT ?
  `).all(n) as any[];

  // Get banks for each deal
  for (const deal of deals) {
    deal.banks = db.prepare(`
      SELECT b.name, r.raw_name, r.role, r.is_lead, r.raw_role
      FROM ipo_bank_roles r
      JOIN banks b ON b.id = r.bank_id
      WHERE r.deal_id = ?
    `).all(deal.ticker);
  }

  db.close();
  res.json(deals);
});

// Get flagged deals
app.get('/api/verify/flags', (req, res) => {
  const flags = validateDeals();
  res.json(flags);
});

// Get lock-in progress
app.get('/api/verify/progress', (req, res) => {
  const history = loadHistory();
  const recentRuns = history.runs.slice(-5);
  res.json({
    total_runs: history.runs.length,
    current_clean_streak: history.current_clean_streak,
    locked: history.locked,
    recent_runs: recentRuns,
    target_streak: 3,
  });
});

// Mark run as reviewed
app.post('/api/verify/complete-review', express.json(), (req, res) => {
  const { run_id, issues_found } = req.body;
  markRunClean(run_id, issues_found);
  res.json({ success: true });
});

// Get diff between runs
app.get('/api/runs/:id/diff/:prevId', (req, res) => {
  const diff = getRunDiff(req.params.id, req.params.prevId);
  res.json(diff || []);
});
```

**Step 3: Verify server compiles**

Run: `npx tsc src/server.ts --noEmit --esModuleInterop --module NodeNext --moduleResolution NodeNext --skipLibCheck`
Expected: No errors (or only existing errors)

**Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: add verification API endpoints"
```

---

## Task 4: Create Verification UI

**Files:**
- Create: `verify-lockin.html`

**Step 1: Write the verification UI**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Lock-in Verification</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { margin-bottom: 20px; }

    .progress-bar { background: #16213e; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .progress-bar h2 { margin-bottom: 10px; font-size: 18px; }
    .streak { display: flex; gap: 10px; margin: 10px 0; }
    .streak-item { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
    .streak-item.clean { background: #10b981; }
    .streak-item.dirty { background: #ef4444; }
    .streak-item.pending { background: #374151; border: 2px dashed #6b7280; }
    .locked { background: #10b981; padding: 10px; border-radius: 4px; text-align: center; font-weight: bold; }

    .controls { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .btn { padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-secondary { background: #374151; color: white; }
    .btn-success { background: #10b981; color: white; }
    .btn-danger { background: #ef4444; color: white; }

    .sample-info { background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px; }

    .deals { display: flex; flex-direction: column; gap: 15px; }
    .deal { background: #16213e; border-radius: 8px; overflow: hidden; }
    .deal-header { padding: 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .deal-header:hover { background: #1e3a5f; }
    .ticker { background: #10b981; padding: 4px 8px; border-radius: 4px; font-weight: bold; margin-right: 10px; }
    .company { flex: 1; }
    .stats { display: flex; gap: 10px; }
    .stat { background: #374151; padding: 4px 8px; border-radius: 4px; font-size: 12px; }

    .deal-body { padding: 0 15px 15px; display: none; }
    .deal.expanded .deal-body { display: block; }

    .banks-section { margin-top: 10px; }
    .banks-section h4 { color: #9ca3af; margin-bottom: 8px; font-size: 12px; text-transform: uppercase; }
    .bank { padding: 8px; background: #0f172a; border-radius: 4px; margin-bottom: 5px; }
    .bank-name { font-weight: bold; }
    .bank-normalized { color: #9ca3af; font-size: 12px; }
    .bank-roles { margin-top: 4px; }
    .role { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-right: 4px; }
    .role-sponsor { background: #fbbf24; color: black; }
    .role-coordinator { background: #f59e0b; color: black; }
    .role-bookrunner { background: #3b82f6; }
    .role-lead_manager { background: #6366f1; }
    .role-other { background: #6b7280; }

    .deal-actions { margin-top: 15px; display: flex; gap: 10px; }
    .issue-type { padding: 8px; border-radius: 4px; background: #374151; border: 1px solid #4b5563; color: white; }

    .flags { margin-bottom: 5px; }
    .flag { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-right: 4px; }
    .flag-high { background: #ef4444; }
    .flag-medium { background: #f59e0b; color: black; }
    .flag-low { background: #6b7280; }

    .changed { border-left: 3px solid #fbbf24; }
    .pdf-link { color: #3b82f6; text-decoration: none; font-size: 12px; }
    .pdf-link:hover { text-decoration: underline; }

    #issues-counter { font-size: 24px; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Data Lock-in Verification</h1>

  <div class="progress-bar">
    <h2>Lock-in Progress</h2>
    <div class="streak" id="streak"></div>
    <div id="progress-status"></div>
  </div>

  <div class="controls">
    <button class="btn btn-primary" onclick="loadSample()">Load New Sample (20)</button>
    <button class="btn btn-secondary" onclick="loadFlagged()">Show Flagged Deals</button>
    <button class="btn btn-secondary" onclick="expandAll()">Expand All</button>
    <button class="btn btn-secondary" onclick="collapseAll()">Collapse All</button>
  </div>

  <div class="sample-info" id="sample-info">
    <strong>Sample Review</strong>
    <p>Issues marked: <span id="issues-counter">0</span> / <span id="total-deals">0</span></p>
  </div>

  <div class="deals" id="deals"></div>

  <div class="controls" style="margin-top: 20px;">
    <button class="btn btn-success" onclick="completeReview()">Complete Review</button>
  </div>

  <script>
    let currentDeals = [];
    let issuesMarked = new Set();
    let flaggedDeals = new Map();

    async function loadProgress() {
      const res = await fetch('/api/verify/progress');
      const data = await res.json();

      const streak = document.getElementById('streak');
      streak.innerHTML = '';

      for (let i = 0; i < 3; i++) {
        const run = data.recent_runs[data.recent_runs.length - 3 + i];
        const div = document.createElement('div');
        div.className = 'streak-item ' + (run ? (run.is_clean ? 'clean' : 'dirty') : 'pending');
        div.textContent = run ? (run.is_clean ? '✓' : '✗') : '?';
        streak.appendChild(div);
      }

      const status = document.getElementById('progress-status');
      if (data.locked) {
        status.innerHTML = '<div class="locked">🎉 DATASET LOCKED - 3 consecutive clean runs achieved!</div>';
      } else {
        status.innerHTML = `<p>Clean streak: ${data.current_clean_streak} / 3</p><p>Total runs: ${data.total_runs}</p>`;
      }
    }

    async function loadFlags() {
      const res = await fetch('/api/verify/flags');
      const flags = await res.json();
      flaggedDeals.clear();
      for (const flag of flags) {
        if (!flaggedDeals.has(flag.ticker)) {
          flaggedDeals.set(flag.ticker, []);
        }
        flaggedDeals.get(flag.ticker).push(flag);
      }
    }

    async function loadSample() {
      await loadFlags();
      const res = await fetch('/api/verify/sample?n=20');
      currentDeals = await res.json();
      issuesMarked.clear();
      renderDeals();
    }

    async function loadFlagged() {
      await loadFlags();
      const res = await fetch('/api/verify/sample?n=100');
      const allDeals = await res.json();
      currentDeals = allDeals.filter(d => flaggedDeals.has(d.ticker));
      issuesMarked.clear();
      renderDeals();
    }

    function renderDeals() {
      const container = document.getElementById('deals');
      container.innerHTML = '';
      document.getElementById('total-deals').textContent = currentDeals.length;
      document.getElementById('issues-counter').textContent = issuesMarked.size;

      for (const deal of currentDeals) {
        const flags = flaggedDeals.get(deal.ticker) || [];
        const div = document.createElement('div');
        div.className = 'deal' + (flags.length ? ' changed' : '');
        div.innerHTML = `
          <div class="deal-header" onclick="toggleDeal(${deal.ticker})">
            <div>
              <span class="ticker">${deal.ticker}</span>
              <span class="company">${deal.company}</span>
            </div>
            <div class="stats">
              <span class="stat">${deal.banks?.length || 0} banks</span>
              <span class="stat">${deal.banks?.filter(b => b.role === 'sponsor').length || 0} sponsors</span>
            </div>
          </div>
          <div class="deal-body">
            ${flags.length ? `<div class="flags">${flags.map(f => `<span class="flag flag-${f.severity}">${f.flag}</span>`).join('')}</div>` : ''}
            <a href="${deal.prospectus_url}" target="_blank" class="pdf-link">📄 View PDF</a>
            <div class="banks-section">
              <h4>Decision Makers</h4>
              ${renderBanks(deal.banks?.filter(b => b.role === 'sponsor' || b.role === 'coordinator') || [])}
              <h4>Bookrunners</h4>
              ${renderBanks(deal.banks?.filter(b => b.role === 'bookrunner') || [])}
              <h4>Lead Managers</h4>
              ${renderBanks(deal.banks?.filter(b => b.role === 'lead_manager') || [])}
              <h4>Other</h4>
              ${renderBanks(deal.banks?.filter(b => b.role === 'other') || [])}
            </div>
            <div class="deal-actions">
              <button class="btn btn-success" onclick="markCorrect(${deal.ticker})">✓ Correct</button>
              <button class="btn btn-danger" onclick="markIssue(${deal.ticker})">✗ Has Issue</button>
              <select class="issue-type" id="issue-${deal.ticker}">
                <option value="">Issue type...</option>
                <option value="wrong_banks">Wrong banks</option>
                <option value="missing_banks">Missing banks</option>
                <option value="normalization">Normalization issue</option>
                <option value="wrong_roles">Wrong roles</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        `;
        container.appendChild(div);
      }
    }

    function renderBanks(banks) {
      if (!banks.length) return '<p style="color: #6b7280; font-size: 12px;">None</p>';
      return banks.map(b => `
        <div class="bank">
          <div class="bank-name">${b.raw_name || b.name}</div>
          <div class="bank-normalized">Normalized: ${b.name}</div>
          <div class="bank-roles">
            <span class="role role-${b.role}">${b.role}</span>
            ${b.is_lead ? '<span class="role" style="background:#fbbf24;color:black;">LEAD</span>' : ''}
          </div>
        </div>
      `).join('');
    }

    function toggleDeal(ticker) {
      const deals = document.querySelectorAll('.deal');
      deals.forEach(d => {
        if (d.querySelector('.ticker').textContent == ticker) {
          d.classList.toggle('expanded');
        }
      });
    }

    function expandAll() {
      document.querySelectorAll('.deal').forEach(d => d.classList.add('expanded'));
    }

    function collapseAll() {
      document.querySelectorAll('.deal').forEach(d => d.classList.remove('expanded'));
    }

    function markCorrect(ticker) {
      issuesMarked.delete(ticker);
      document.getElementById('issues-counter').textContent = issuesMarked.size;
    }

    function markIssue(ticker) {
      issuesMarked.add(ticker);
      document.getElementById('issues-counter').textContent = issuesMarked.size;
    }

    async function completeReview() {
      const history = await (await fetch('/api/verify/progress')).json();
      const runId = history.recent_runs[history.recent_runs.length - 1]?.run_id || '001';

      await fetch('/api/verify/complete-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, issues_found: issuesMarked.size })
      });

      alert(`Review complete! ${issuesMarked.size} issues found.`);
      loadProgress();
    }

    // Initialize
    loadProgress();
  </script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add verify-lockin.html
git commit -m "feat: add data lock-in verification UI"
```

---

## Task 5: Create Initial Run Snapshot

**Files:**
- Modify: `import-to-db.ts` (add run tracking)

**Step 1: Update import-to-db.ts to save run**

Add at the end of the import script, after database save:
```typescript
import { saveRun } from './src/run-tracker.js';

// After importing to DB, save run snapshot
const runMetadata = saveRun(results, {
  deals_processed: results.length,
  deals_with_banks: results.filter(r => r.success).length,
  deals_without_banks: results.filter(r => !r.success).length,
  total_banks: uniqueBanks.size,
  total_relationships: totalRelationships,
});
console.log(`\nRun ${runMetadata.run_id} saved to runs/`);
```

**Step 2: Run the import to create first snapshot**

Run: `npx tsx import-to-db.ts`
Expected: Creates `runs/run-001-2026-01-13.json` and updates `run-history.json`

**Step 3: Commit the run**

```bash
git add runs/ import-to-db.ts
git commit -m "feat: integrate run tracking into import, create run 001"
```

---

## Task 6: Test the Full System

**Step 1: Start the server**

Run: `npx tsx src/server.ts`
Expected: Server starts on port 3000

**Step 2: Open verification UI**

Open: `http://localhost:3000/verify-lockin.html`
Expected: UI loads with progress bar and sample button

**Step 3: Test sample loading**

Click "Load New Sample (20)"
Expected: 20 random deals appear with bank details

**Step 4: Test flagged deals**

Click "Show Flagged Deals"
Expected: Deals with validation flags appear (SINGLE_BANK, NO_SPONSOR, etc.)

**Step 5: Complete a review**

- Expand deals, verify against PDFs
- Mark any issues found
- Click "Complete Review"
Expected: Progress updates, streak increments if 0 issues

---

## Verification Checklist

1. [ ] `runs/` directory exists with `.gitkeep`
2. [ ] `src/run-tracker.ts` compiles without errors
3. [ ] `src/validator.ts` compiles without errors
4. [ ] Server starts and `/api/verify/sample` returns deals
5. [ ] `/api/verify/flags` returns validation flags
6. [ ] `verify-lockin.html` loads and displays deals
7. [ ] Complete review updates progress
8. [ ] Run snapshots saved to `runs/` directory
