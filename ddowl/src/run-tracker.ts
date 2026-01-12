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
    const previous = prevMap.get(ticker) as any;
    if (!previous) {
      changes.push({ ticker, type: 'added', current: curr });
    } else if (JSON.stringify((curr as any).banks) !== JSON.stringify(previous.banks)) {
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
