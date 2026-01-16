# Findings Consolidation Implementation Plan

**Date:** 2026-01-13
**Feature:** Deduplicate and consolidate screening findings by incident
**Problem:** Multiple articles about the same incident appear as separate flags (e.g., ICAC investigation shows 4 times)

---

## Overview

Implement two-stage consolidation to group findings by incident and synthesize them into comprehensive, deduplicated results.

**Current state:** 4 separate amber flags for one ICAC investigation
**Target state:** 1 consolidated amber flag with details from all 4 sources

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT FLOW                                  │
├─────────────────────────────────────────────────────────────────┤
│ Search → Pre-screen → Quick scan → Deep analyze → Output        │
│                                            ↓                     │
│                                    [Raw findings list]           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    NEW FLOW                                      │
├─────────────────────────────────────────────────────────────────┤
│ Search → Pre-screen → Quick scan → Deep analyze                  │
│                                            ↓                     │
│                              [Extract fingerprint per finding]   │
│                                            ↓                     │
│                              [Group by fingerprint similarity]   │
│                                            ↓                     │
│                              [LLM consolidates each group]       │
│                                            ↓                     │
│                              [Output consolidated findings]      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Phase 1: Fingerprint Extraction

#### Task 1.1: Define fingerprint schema
**File:** `src/types.ts`
**Changes:**
- Add `FindingFingerprint` interface:
  ```typescript
  interface FindingFingerprint {
    eventType: string;      // e.g., "regulatory_investigation", "criminal_charge", "lawsuit"
    entities: string[];     // e.g., ["ICAC", "Hong Kong"]
    yearRange: string;      // e.g., "2015-2017"
    subjectRole: string;    // e.g., "executive_director", "legal_representative"
  }
  ```
- Extend `Finding` interface to include `fingerprint` field

#### Task 1.2: Create fingerprint extractor
**File:** `src/consolidator.ts` (new file)
**Function:** `extractFingerprint(headline: string, summary: string): FindingFingerprint`
**Logic:**
- Use regex patterns to extract years (e.g., `/\b(19|20)\d{2}\b/g`)
- Use keyword matching for event types:
  - "ICAC", "investigation", "probe" → `regulatory_investigation`
  - "lawsuit", "court", "writ" → `legal_proceedings`
  - "arrested", "convicted", "sentenced" → `criminal_charge`
  - "penalty", "fine", "violation" → `administrative_penalty`
  - "fraud", "scam", "embezzlement" → `financial_misconduct`
- Extract named entities (organizations, agencies)

#### Task 1.3: Integrate fingerprinting into analysis
**File:** `src/server.ts`
**Changes:**
- After `analyzeWithLLM()` returns, call `extractFingerprint()`
- Attach fingerprint to finding object before pushing to `allFindings`

---

### Phase 2: Similarity Grouping

#### Task 2.1: Create similarity scoring function
**File:** `src/consolidator.ts`
**Function:** `calculateSimilarity(fp1: FindingFingerprint, fp2: FindingFingerprint): number`
**Logic:**
- eventType match: +0.4
- overlapping entities: +0.3 (scaled by overlap ratio)
- overlapping year range: +0.3
- Return score 0-1

#### Task 2.2: Create grouping function
**File:** `src/consolidator.ts`
**Function:** `groupFindingsBySimilarity(findings: Finding[], threshold: number): Finding[][]`
**Logic:**
- Use simple clustering: iterate through findings
- For each finding, check similarity against existing groups
- If similarity > threshold (e.g., 0.6), add to that group
- Otherwise, create new group
- Return array of finding groups

---

### Phase 3: LLM Consolidation

#### Task 3.1: Create consolidation prompt
**File:** `src/consolidator.ts`
**Function:** `consolidateGroup(findings: Finding[], subjectName: string): Promise<ConsolidatedFinding>`
**Prompt design:**
```
You are consolidating multiple due diligence findings about the same incident.

Subject: {subjectName}

Findings to consolidate:
1. {finding1.headline} - {finding1.summary} (Source: {finding1.url})
2. {finding2.headline} - {finding2.summary} (Source: {finding2.url})
...

Create ONE consolidated finding that:
1. Combines all facts from all sources
2. Uses the most severe classification (RED > AMBER > GREEN)
3. Creates a comprehensive headline
4. Writes a detailed summary with all relevant facts
5. Notes the number of corroborating sources

Return JSON:
{
  "headline": "...",
  "summary": "...",
  "severity": "RED|AMBER",
  "sourceCount": N,
  "dateRange": "YYYY-YYYY",
  "eventType": "..."
}
```

#### Task 3.2: Create main consolidation orchestrator
**File:** `src/consolidator.ts`
**Function:** `consolidateFindings(findings: Finding[], subjectName: string): Promise<ConsolidatedFinding[]>`
**Logic:**
1. Extract fingerprints for all findings
2. Group by similarity
3. For groups with 1 finding: pass through unchanged
4. For groups with 2+ findings: call LLM to consolidate
5. Return consolidated list

---

### Phase 4: Server Integration

#### Task 4.1: Add consolidation step to screening endpoint
**File:** `src/server.ts`
**Location:** After all queries complete, before `sendEvent({ type: 'complete' })`
**Changes:**
- Send event: `{ type: 'consolidating', count: allFindings.length }`
- Call `consolidateFindings(allFindings, subjectName)`
- Replace `allFindings` with consolidated results
- Update stats to reflect consolidated counts

#### Task 4.2: Add new SSE event types
**File:** `src/server.ts`
**New events:**
- `consolidating`: Notify frontend that consolidation is in progress
- `consolidated`: Send final consolidated findings

---

### Phase 5: Frontend Updates

#### Task 5.1: Update activity log for consolidation
**File:** `public/index.html`
**Changes:**
- Handle `consolidating` event: show "Consolidating X findings..."
- Handle `consolidated` event: show "Consolidated into Y unique incidents"

#### Task 5.2: Update results display
**File:** `public/index.html`
**Changes:**
- Show source count badge on each finding card (e.g., "4 sources")
- Update the finding card layout to show:
  - Headline
  - Summary (consolidated from all sources)
  - Source count
  - Expandable list of source URLs

#### Task 5.3: Fix "Clear" count
**File:** `public/index.html` and `src/server.ts`
**Changes:**
- Track `totalCleared` count in server (sum of GREEN classifications)
- Send in `complete` event stats
- Display in UI instead of hardcoded 0

---

### Phase 6: Testing & Refinement

#### Task 6.1: Test with known duplicate case
- Run screening for "侯晓兵"
- Verify ICAC findings consolidate into 1
- Verify details from all 4 sources are preserved

#### Task 6.2: Edge case testing
- Single finding (no consolidation needed)
- All findings are unique (no grouping)
- Mixed severities in one group (should use highest)

#### Task 6.3: Adjust similarity threshold
- Test with different threshold values (0.5, 0.6, 0.7)
- Find optimal balance between over-grouping and under-grouping

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/types.ts` | Modify | Add fingerprint and consolidated finding types |
| `src/consolidator.ts` | Create | New module for all consolidation logic |
| `src/server.ts` | Modify | Integrate consolidation step, fix clear count |
| `public/index.html` | Modify | Handle new events, show source counts, fix clear display |

---

## Success Criteria

1. ICAC investigation (4 sources) → 1 consolidated AMBER finding
2. Consolidated finding contains details from all sources
3. UI shows "4 sources" badge on the finding
4. "Clear" count shows actual number of cleared results
5. No regression in screening accuracy or speed

---

## Estimated Complexity

- Phase 1 (Fingerprinting): Low - regex and keyword matching
- Phase 2 (Grouping): Low - simple clustering algorithm
- Phase 3 (LLM Consolidation): Medium - prompt engineering, API call
- Phase 4 (Server Integration): Low - straightforward integration
- Phase 5 (Frontend): Low - UI updates
- Phase 6 (Testing): Medium - edge cases and tuning

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Over-consolidation (grouping unrelated findings) | Conservative similarity threshold (0.6+) |
| Under-consolidation (missing obvious duplicates) | Include multiple similarity signals |
| LLM consolidation errors | Validate output, fallback to first finding if parse fails |
| Added latency | Only consolidate if 2+ findings in a group |

---

## Dependencies

- Existing LLM fallback chain (Kimi → DeepSeek → Gemini)
- No new npm packages required
