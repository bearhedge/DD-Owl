# Simplified Bank Roles Data Model - Design Specification

## Problem Statement

The current role normalization system is over-engineered:
- Multiple role categories (sponsor, coordinator, bookrunner, lead_manager, other)
- Same bank appears multiple times with different roles (cluttered UI)
- Role normalization unreliable due to naming variations in prospectuses
- Users only care about one distinction: **Decision Makers vs Other Banks**

## Design Goals

1. **Simplify data model** - Binary classification: decision maker or not
2. **One bank per deal** - No duplicates in UI
3. **Preserve raw data** - Keep original text for verification
4. **Highlight sponsors** - They hire DD firms, they're the key relationship

---

## Database Schema Changes

### Current Schema (ipo_bank_roles)

```sql
CREATE TABLE ipo_bank_roles (
    id INTEGER PRIMARY KEY,
    deal_id INTEGER NOT NULL,
    bank_id INTEGER NOT NULL,
    raw_name TEXT,
    role TEXT NOT NULL,  -- 'sponsor', 'coordinator', 'bookrunner', 'lead_manager', 'other'
    is_lead INTEGER DEFAULT 0,
    raw_role TEXT,
    UNIQUE(deal_id, bank_id, role)  -- One row per bank+role combo
);
```

**Problem:** Goldman Sachs with 4 roles = 4 rows = 4 duplicate entries in UI.

### New Schema (ipo_bank_roles)

```sql
CREATE TABLE ipo_bank_roles (
    id INTEGER PRIMARY KEY,
    deal_id INTEGER NOT NULL,
    bank_id INTEGER NOT NULL,
    raw_name TEXT,                    -- Original name from prospectus
    is_decision_maker INTEGER DEFAULT 0,  -- 1 if raw_role contains "Sponsor"
    is_lead INTEGER DEFAULT 0,            -- 1 if "Lead" + "Sponsor" (highest rank)
    raw_roles TEXT,                   -- JSON array of all original role texts
    UNIQUE(deal_id, bank_id)          -- ONE row per bank per deal
);
```

**Benefits:**
- Goldman Sachs = 1 row regardless of how many roles
- Simple boolean: are they a decision maker?
- Raw roles preserved as JSON for verification

---

## Classification Logic

```
if raw_role contains "Sponsor":
    is_decision_maker = true
    if raw_role contains "Lead":
        is_lead = true

else:
    is_decision_maker = false
    is_lead = false
```

### Examples

| Raw Role Text | is_decision_maker | is_lead |
|---------------|-------------------|---------|
| "Joint Sponsors" | true | false |
| "Sole Sponsor" | true | false |
| "Lead Sponsor" | true | true |
| "Joint Global Coordinators" | false | false |
| "Joint Bookrunners and Joint Lead Managers" | false | false |

---

## Migration Strategy

### Option A: Add columns, migrate data (Recommended)

1. Add new columns to existing table
2. Run migration script to populate from existing data
3. Update UI and API to use new columns
4. Keep old columns for now (can remove later)

```sql
-- Add new columns
ALTER TABLE ipo_bank_roles ADD COLUMN is_decision_maker INTEGER DEFAULT 0;
-- is_lead already exists
ALTER TABLE ipo_bank_roles ADD COLUMN raw_roles TEXT;

-- Migration: Group by deal+bank, aggregate roles
-- (Run via TypeScript migration script)
```

### Option B: New table with fresh import

1. Create new table `ipo_bank_roles_v2`
2. Re-run parser with new logic
3. Swap tables

**Recommendation:** Option A - less disruptive, preserves data.

---

## UI Design

### Deal Card (Collapsed)

```
[6622] Zhaoke Ophthalmology Limited    ▶    2 sponsors | 5 other banks
```

### Deal Card (Expanded)

```
[6622] Zhaoke Ophthalmology Limited    ▼    2 sponsors | 5 other banks
       [View PDF]

┌─────────────────────────────────────────────────────────────────┐
│  DECISION MAKERS                              [yellow background]│
│  ─────────────────────────────────────────────────────────────  │
│  Goldman Sachs (Asia) L.L.C.                            [LEAD]  │
│  Raw: "Joint Sponsors"                                          │
│                                                                 │
│  Jefferies Hong Kong Limited                            [LEAD]  │
│  Raw: "Joint Sponsors"                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  OTHER BANKS                                                    │
│  ─────────────────────────────────────────────────────────────  │
│  Haitong International Securities Company Limited               │
│  Fosun Hani Securities Limited                                  │
│  Macquarie Capital Limited                                      │
│  SPDB International Capital Limited                             │
│  VMS Securities Limited                                         │
└─────────────────────────────────────────────────────────────────┘

  [✓ Correct]  [✗ Has Issue ▼]
```

### Visual Hierarchy

| Element | Style |
|---------|-------|
| Decision Makers section | Yellow/gold background (#FEF3C7) |
| LEAD badge | Gold pill (#F59E0B) |
| Other Banks section | Neutral gray background (#374151) |
| Raw role text | Small, muted (#9CA3AF) |

---

## API Changes

### GET /api/verify/sample

**Current response:**
```json
{
  "ticker": 6622,
  "banks": [
    { "name": "Goldman Sachs", "role": "sponsor", "is_lead": 1 },
    { "name": "Goldman Sachs", "role": "coordinator", "is_lead": 1 },
    { "name": "Goldman Sachs", "role": "bookrunner", "is_lead": 1 },
    ...
  ]
}
```

**New response:**
```json
{
  "ticker": 6622,
  "decision_makers": [
    { "name": "Goldman Sachs", "raw_name": "Goldman Sachs (Asia) L.L.C.", "is_lead": true, "raw_roles": ["Joint Sponsors"] }
  ],
  "other_banks": [
    { "name": "Haitong", "raw_name": "Haitong International Securities Company Limited", "raw_roles": ["Joint Global Coordinators"] }
  ]
}
```

---

## Validator Changes

### Remove

- `NO_SPONSOR` flag (unreliable with old role detection)

### Update

- `NO_DECISION_MAKER` - Flag if zero banks have `is_decision_maker = 1`
- `SINGLE_DECISION_MAKER` - Flag if only 1 decision maker (unusual)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/ipo-schema.sql` | Add new columns |
| `src/prospectus-parser.ts` | Simplify role extraction logic |
| `src/bank-normalizer.ts` | Remove complex role normalization |
| `import-to-db.ts` | Update import to use new schema |
| `src/server.ts` | Update /api/verify/sample response |
| `src/validator.ts` | Update flags |
| `verify-lockin.html` | Update UI to new design |

---

## Implementation Order

1. **Schema migration** - Add columns, write migration script
2. **Parser update** - Simplify to decision maker detection
3. **Import script** - Re-import with new logic
4. **API update** - Return grouped response
5. **UI update** - New two-section layout
6. **Validator update** - New flags

---

## Success Criteria

- [ ] Each bank appears once per deal (no duplicates)
- [ ] Decision makers highlighted in yellow
- [ ] LEAD badge shows for lead sponsors
- [ ] Raw role text visible for verification
- [ ] NO_DECISION_MAKER flag works correctly
