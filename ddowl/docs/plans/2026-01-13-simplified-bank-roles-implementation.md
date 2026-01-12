# Simplified Bank Roles - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify bank role data model to binary (Decision Maker vs Other), eliminate duplicates, update UI with yellow sponsor highlighting.

**Architecture:** Migrate existing data by grouping bank-role rows into single bank entries with is_decision_maker flag. Update API to return grouped response. Update UI to two-section layout.

**Tech Stack:** TypeScript, SQLite, HTML/CSS/JS

---

## Task 1: Update Database Schema

**Files:**
- Modify: `src/ipo-schema.sql`

**Step 1: Add new columns to schema**

Add `is_decision_maker` and `raw_roles` columns, change unique constraint:

```sql
-- Bank roles in IPO deals (UPDATED)
CREATE TABLE IF NOT EXISTS ipo_bank_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL,
    bank_id INTEGER NOT NULL,
    raw_name TEXT,  -- Original name from prospectus
    is_decision_maker INTEGER DEFAULT 0,  -- 1 if sponsor
    is_lead INTEGER DEFAULT 0,  -- 1 if lead sponsor
    raw_roles TEXT,  -- JSON array of original role texts
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deal_id) REFERENCES ipo_deals(id),
    FOREIGN KEY (bank_id) REFERENCES banks(id),
    UNIQUE(deal_id, bank_id)  -- ONE row per bank per deal
);
```

**Step 2: Commit**

```bash
git add src/ipo-schema.sql
git commit -m "schema: simplify ipo_bank_roles to one row per bank per deal"
```

---

## Task 2: Update Import Script

**Files:**
- Modify: `import-to-db.ts`

**Step 1: Update insertRole statement**

Replace old insertRole with new logic that groups by bank:

```typescript
const insertRole = db.prepare(`
  INSERT OR REPLACE INTO ipo_bank_roles (deal_id, bank_id, raw_name, is_decision_maker, is_lead, raw_roles)
  VALUES (?, ?, ?, ?, ?, ?)
`);
```

**Step 2: Update bank import logic**

Replace the bank import loop (lines 126-135) with grouping logic:

```typescript
if (result?.banks) {
  // Group banks by normalized name
  const bankGroups = new Map<string, { name: string; rawName: string; rawRoles: string[]; isDecisionMaker: boolean; isLead: boolean }>();

  for (const bank of result.banks) {
    const key = bank.normalized;
    if (!bankGroups.has(key)) {
      bankGroups.set(key, {
        name: bank.normalized,
        rawName: bank.name,
        rawRoles: [],
        isDecisionMaker: false,
        isLead: false,
      });
    }
    const group = bankGroups.get(key)!;

    // Add raw role if not already present
    if (bank.rawRole && !group.rawRoles.includes(bank.rawRole)) {
      group.rawRoles.push(bank.rawRole);
    }

    // Check if this is a sponsor (decision maker)
    if (bank.rawRole && bank.rawRole.toLowerCase().includes('sponsor')) {
      group.isDecisionMaker = true;
      // Check if lead sponsor
      if (bank.rawRole.toLowerCase().includes('lead')) {
        group.isLead = true;
      }
    }
  }

  // Insert one row per bank
  for (const [normalized, group] of bankGroups) {
    insertBank.run(normalized);
    const bankRow = getBank.get(normalized) as { id: number } | undefined;
    if (!bankRow) continue;

    insertRole.run(
      dealId,
      bankRow.id,
      group.rawName,
      group.isDecisionMaker ? 1 : 0,
      group.isLead ? 1 : 0,
      JSON.stringify(group.rawRoles)
    );
  }
}
```

**Step 3: Run TypeScript check**

Run: `npx tsc import-to-db.ts --noEmit --esModuleInterop --module NodeNext --moduleResolution NodeNext --skipLibCheck`
Expected: No errors

**Step 4: Commit**

```bash
git add import-to-db.ts
git commit -m "feat: update import to group banks with decision maker flag"
```

---

## Task 3: Re-import Data

**Step 1: Run the import**

Run: `npx tsx import-to-db.ts`
Expected: Import completes with ~1100 deals, fewer bank-role rows (no duplicates)

**Step 2: Verify the data**

Run: `sqlite3 data/ddowl.db "SELECT COUNT(*) FROM ipo_bank_roles"`
Expected: Fewer rows than before (was 17,378, should be ~5,000-8,000 now)

Run: `sqlite3 data/ddowl.db "SELECT b.name, r.is_decision_maker, r.is_lead, r.raw_roles FROM ipo_bank_roles r JOIN banks b ON b.id = r.bank_id WHERE r.deal_id = (SELECT id FROM ipo_deals WHERE ticker = 6622) LIMIT 5"`
Expected: Goldman Sachs shows is_decision_maker=1, raw_roles contains "Joint Sponsors"

**Step 3: Commit the run snapshot**

```bash
git add runs/
git commit -m "data: re-import with simplified bank roles, run 002"
```

---

## Task 4: Update API Endpoint

**Files:**
- Modify: `src/server.ts`

**Step 1: Update /api/verify/sample query**

Replace the bank query (around line 812) with grouped response:

```typescript
// Get banks for each deal - grouped by decision maker status
for (const deal of deals) {
  const allBanks = db.prepare(`
    SELECT b.name, r.raw_name, r.is_decision_maker, r.is_lead, r.raw_roles
    FROM ipo_bank_roles r
    JOIN banks b ON b.id = r.bank_id
    WHERE r.deal_id = (SELECT id FROM ipo_deals WHERE ticker = ?)
  `).all(deal.ticker) as any[];

  deal.decision_makers = allBanks
    .filter(b => b.is_decision_maker)
    .map(b => ({
      name: b.name,
      raw_name: b.raw_name,
      is_lead: b.is_lead === 1,
      raw_roles: JSON.parse(b.raw_roles || '[]'),
    }));

  deal.other_banks = allBanks
    .filter(b => !b.is_decision_maker)
    .map(b => ({
      name: b.name,
      raw_name: b.raw_name,
      raw_roles: JSON.parse(b.raw_roles || '[]'),
    }));
}
```

**Step 2: Test the endpoint**

Run: `curl -s "http://localhost:8080/api/verify/sample?n=1" | python3 -m json.tool | head -30`
Expected: Response has `decision_makers` and `other_banks` arrays

**Step 3: Commit**

```bash
git add src/server.ts
git commit -m "api: return grouped decision_makers and other_banks"
```

---

## Task 5: Update Validator

**Files:**
- Modify: `src/validator.ts`

**Step 1: Replace NO_SPONSOR with NO_DECISION_MAKER**

Update the validator to use new column:

```typescript
// Flag: No decision maker (sponsor)
const noDecisionMaker = db.prepare(`
  SELECT d.ticker, d.company
  FROM ipo_deals d
  WHERE d.has_bank_info = 1
  AND NOT EXISTS (
    SELECT 1 FROM ipo_bank_roles r
    WHERE r.deal_id = d.id AND r.is_decision_maker = 1
  )
`).all() as any[];

for (const deal of noDecisionMaker) {
  flags.push({
    ticker: deal.ticker,
    company: deal.company,
    flag: 'NO_DECISION_MAKER',
    severity: 'high',
    details: 'No sponsor/decision maker found',
  });
}
```

**Step 2: Update SINGLE_BANK to check decision makers**

```typescript
// Flag: Single decision maker only (unusual)
const singleDecisionMaker = db.prepare(`
  SELECT d.ticker, d.company, COUNT(*) as dm_count
  FROM ipo_deals d
  JOIN ipo_bank_roles r ON r.deal_id = d.id
  WHERE d.has_bank_info = 1 AND r.is_decision_maker = 1
  GROUP BY d.ticker
  HAVING dm_count = 1
`).all() as any[];

for (const deal of singleDecisionMaker) {
  flags.push({
    ticker: deal.ticker,
    company: deal.company,
    flag: 'SINGLE_DECISION_MAKER',
    severity: 'medium',
    details: 'Only 1 decision maker - verify this is correct',
  });
}
```

**Step 3: Remove old SINGLE_BANK and NO_SPONSOR logic**

Delete the old flag code that used the `role` column.

**Step 4: Commit**

```bash
git add src/validator.ts
git commit -m "validator: use is_decision_maker flag, remove old role-based flags"
```

---

## Task 6: Update Verification UI

**Files:**
- Modify: `verify-lockin.html`

**Step 1: Update deal stats display**

Change collapsed view to show decision makers count:

```javascript
<span class="stat">${deal.decision_makers?.length || 0} sponsors</span>
<span class="stat">${deal.other_banks?.length || 0} other</span>
```

**Step 2: Update renderDeals function**

Replace the banks-section HTML with two-section layout:

```javascript
<div class="banks-section">
  <div class="decision-makers">
    <h4>DECISION MAKERS</h4>
    ${renderDecisionMakers(deal.decision_makers || [])}
  </div>
  <div class="other-banks">
    <h4>OTHER BANKS</h4>
    ${renderOtherBanks(deal.other_banks || [])}
  </div>
</div>
```

**Step 3: Add renderDecisionMakers function**

```javascript
function renderDecisionMakers(banks) {
  if (!banks.length) return '<p class="empty">None found</p>';
  return banks.map(b => `
    <div class="bank decision-maker">
      <div class="bank-name">${b.raw_name}</div>
      ${b.is_lead ? '<span class="lead-badge">LEAD</span>' : ''}
      <div class="bank-normalized">Normalized: ${b.name}</div>
      <div class="bank-raw-roles">Raw: ${b.raw_roles.join(', ')}</div>
    </div>
  `).join('');
}
```

**Step 4: Add renderOtherBanks function**

```javascript
function renderOtherBanks(banks) {
  if (!banks.length) return '<p class="empty">None</p>';
  return banks.map(b => `
    <div class="bank">
      <div class="bank-name">${b.raw_name}</div>
      <div class="bank-normalized">Normalized: ${b.name}</div>
    </div>
  `).join('');
}
```

**Step 5: Update CSS styles**

Add styles for decision makers section:

```css
.decision-makers {
  background: #FEF3C7;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 15px;
}
.decision-makers h4 {
  color: #92400E;
  margin-bottom: 10px;
}
.decision-maker {
  background: #FDE68A;
  border-radius: 4px;
  padding: 10px;
  margin-bottom: 8px;
}
.lead-badge {
  background: #F59E0B;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  margin-left: 8px;
}
.other-banks {
  background: #374151;
  border-radius: 8px;
  padding: 15px;
}
.other-banks h4 {
  color: #9CA3AF;
  margin-bottom: 10px;
}
.bank-raw-roles {
  font-size: 11px;
  color: #6B7280;
  margin-top: 4px;
}
.empty {
  color: #6B7280;
  font-size: 12px;
  font-style: italic;
}
```

**Step 6: Commit**

```bash
git add verify-lockin.html
git commit -m "ui: two-section layout with yellow decision makers"
```

---

## Task 7: Test Full System

**Step 1: Restart server**

Run: `lsof -ti:8080 | xargs kill -9; sleep 1; npx tsx src/server.ts &`

**Step 2: Open UI and verify**

Open: `http://localhost:8080/verify-lockin`
- Click "Load New Sample (20)"
- Expand a deal
- Verify: Decision makers section is yellow with LEAD badges
- Verify: Other banks section is gray
- Verify: No duplicate banks

**Step 3: Test deal 6622 specifically**

Run: `curl -s "http://localhost:8080/api/verify/sample?n=100" | python3 -c "import sys,json; d=json.load(sys.stdin); print([x for x in d if x['ticker']==6622])"`
Expected: Goldman Sachs and Jefferies in decision_makers with is_lead=true

**Step 4: Verify flags endpoint**

Run: `curl -s "http://localhost:8080/api/verify/flags" | python3 -m json.tool | head -20`
Expected: NO_DECISION_MAKER flags (not NO_SPONSOR)

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete simplified bank roles implementation"
git push origin main
```

---

## Verification Checklist

- [ ] Schema updated with is_decision_maker, raw_roles columns
- [ ] Import groups banks (no duplicates per deal)
- [ ] API returns decision_makers and other_banks arrays
- [ ] Validator uses NO_DECISION_MAKER flag
- [ ] UI shows yellow Decision Makers section
- [ ] UI shows LEAD badge for lead sponsors
- [ ] Deal 6622 shows Goldman Sachs + Jefferies as decision makers
- [ ] No duplicate banks in any deal
