# Data Lock-in Verification System

## Goal

Build a robust, iterative system to verify and lock-in the IPO bank extraction dataset.

**Exit Criteria:** Zero issues found in 3 consecutive sample reviews → dataset locked → final large sample check → done.

## Current State

- **1,100 deals** with bank data (97%)
- **35 deals** WIP (need alternative document formats)
- **569 unique banks**
- **17,378 bank-deal relationships**

---

## System Components

### 1. Run Tracker (Git-based Versioning)

Each parser run creates a versioned snapshot:

```
ddowl/
  runs/
    run-001-2026-01-13.json    # Full results snapshot
    run-002-2026-01-14.json
    ...
  run-history.json              # Summary of all runs with metadata
```

**Run metadata:**
```json
{
  "run_id": "001",
  "timestamp": "2026-01-13T10:30:00Z",
  "deals_processed": 1135,
  "deals_with_banks": 1100,
  "total_banks": 569,
  "total_relationships": 17378,
  "changes_from_previous": {
    "deals_changed": 12,
    "banks_added": 5,
    "banks_removed": 2
  },
  "git_commit": "abc123"
}
```

**Workflow:**
1. Run parser → generate results
2. Save to `runs/run-XXX-YYYY-MM-DD.json`
3. Update `run-history.json`
4. Git commit with message: "Run XXX: 1100 deals, 569 banks"

---

### 2. Verification UI

**URL:** `/verify` or `verify-lockin.html`

**Features:**

#### Sample Review Panel
- Load 20 random deals (configurable)
- For each deal show:
  - Ticker, company name
  - PDF link (opens in new tab)
  - Banks extracted with roles
  - **Diff indicators** if changed from previous run (highlighted)

#### Diff View
- Compare current run vs previous run
- Highlight:
  - 🟢 New banks added
  - 🔴 Banks removed
  - 🟡 Role changes
  - ⚪ Unchanged

#### Issue Marking
- Per deal: Mark as "Has Issue" with dropdown:
  - Wrong banks extracted
  - Missing banks
  - Normalization issue
  - Role incorrect
  - Other (free text)

#### Progress Tracker
```
Run: 004
Sample: 20 deals reviewed
Issues found: 0

Lock-in Progress:
[✓] Run 002: 0 issues
[✓] Run 003: 0 issues
[✓] Run 004: 0 issues ← CURRENT
━━━━━━━━━━━━━━━━━━━━
🎉 3 consecutive clean runs!
Ready for final verification.
```

#### Final Verification Mode
- When 3 clean runs achieved
- Load 100 deals for final check
- If clean → DATASET LOCKED

---

### 3. Automated Validator

Flags suspicious extractions for priority review:

| Flag | Condition | Priority |
|------|-----------|----------|
| `SINGLE_BANK` | Only 1 bank extracted | High |
| `NO_SPONSOR` | No sponsor role found | High |
| `UNKNOWN_BANK` | Name not in known banks list | Medium |
| `DUPLICATE_BANK` | Same bank twice in deal | Medium |
| `ROLE_MISMATCH` | Sponsor but not lead, etc. | Low |

**Flagged deals shown first** in verification UI.

---

### 4. Bank Normalization Review

Separate view to review bank name mappings:

- List all 569 unique normalized names
- Show count of deals per bank
- **Auto-detect likely duplicates** using fuzzy matching:
  - "CICC" vs "China International Capital Corporation"
  - "Haitong" vs "Haitong International"
- Mark duplicates for merge
- Update normalizer rules

---

## Data Schema Updates

### New: `verification_status` table
```sql
CREATE TABLE verification_status (
  deal_ticker INTEGER PRIMARY KEY,
  status TEXT,  -- 'unreviewed', 'verified', 'has_issue'
  issue_type TEXT,
  issue_notes TEXT,
  reviewed_in_run TEXT,
  reviewed_at TIMESTAMP
);
```

### New: `run_history` table
```sql
CREATE TABLE run_history (
  run_id TEXT PRIMARY KEY,
  timestamp TIMESTAMP,
  deals_processed INTEGER,
  deals_with_banks INTEGER,
  total_banks INTEGER,
  git_commit TEXT,
  issues_found INTEGER,
  is_clean BOOLEAN
);
```

---

## Implementation Files

| File | Purpose |
|------|---------|
| `verify-lockin.html` | New verification UI |
| `src/run-tracker.ts` | Run versioning and comparison |
| `src/validator.ts` | Automated validation flags |
| `src/server.ts` | New API endpoints |
| `runs/` | Run snapshots directory |

### API Endpoints

```
GET  /api/runs                    # List all runs
GET  /api/runs/:id                # Get specific run
GET  /api/runs/:id/diff/:prev_id  # Diff between runs
GET  /api/verify/sample?n=20      # Random sample for review
POST /api/verify/mark             # Mark deal as verified/issue
GET  /api/verify/progress         # Lock-in progress status
GET  /api/validate/flags          # Get flagged deals
GET  /api/banks/duplicates        # Likely duplicate bank names
```

---

## Workflow Summary

```
┌─────────────────────────────────────────────────────────┐
│                    ITERATION LOOP                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Run parser (npx tsx src/historical-import.ts)       │
│            ↓                                             │
│  2. Save run snapshot (runs/run-XXX.json)               │
│            ↓                                             │
│  3. Git commit                                           │
│            ↓                                             │
│  4. Open verification UI                                 │
│            ↓                                             │
│  5. Review 20 random deals + flagged deals              │
│            ↓                                             │
│  ┌────────────────────────────────────────┐             │
│  │  Issues found?                          │             │
│  │  YES → Note issues → Fix parser → Loop  │             │
│  │  NO  → Clean run! Check progress        │             │
│  └────────────────────────────────────────┘             │
│            ↓                                             │
│  6. 3 consecutive clean runs?                           │
│     NO  → Continue to next iteration                    │
│     YES → Final verification (100 deals)                │
│            ↓                                             │
│  7. Final check clean? → DATASET LOCKED                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Success Metrics

- **Accuracy:** <5% issue rate in samples
- **Completeness:** 1,100+ deals with bank data
- **Consistency:** Same results on re-run
- **Lock-in:** 3 consecutive clean runs achieved

---

## Next Steps

1. Build run tracker (`src/run-tracker.ts`)
2. Build validator (`src/validator.ts`)
3. Build verification UI (`verify-lockin.html`)
4. Add API endpoints to server
5. Run first iteration
