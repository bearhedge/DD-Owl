# Entity Resolution: Soft-Signal Design

## Problem

When two people share the same name, the pipeline cannot distinguish them. The current hard-gate approach (Phase 0.9 bio search + GREEN filter) risks false negatives — dismissing real adverse media about the target because the LLM incorrectly matched it to a different person.

For DD, missing real adverse media is the worst possible error.

## Design Principles

1. **The system informs, the analyst decides.** No auto-dismissal of adverse media, ever.
2. **Conservative by default.** Only mark "unlikely match" when dead certain. Ambiguous = pass through.
3. **User context as ground truth.** When the analyst provides company/role, that anchors the profile.
4. **Zero behavior change when no context provided.** Empty context = pipeline behaves exactly as before.

## Changes

### 1. UI: Optional "Known as" Field

- Single freeform text input below the name field
- Placeholder: `e.g. VP at 中國建設銀行, Shenzhen`
- Passed as `&context=...` query param to `/api/screen/v4`
- If empty, no entity resolution occurs

### 2. Profile Seed: User Context as Ground Truth

- User-provided context prepended to profile prompt as:
  `VERIFIED CONTEXT (from the requesting analyst): VP at 中國建設銀行, Shenzhen`
- This anchors the profile — LLM fills in details around the known facts
- Bio search (Phase 0.9) still runs to supplement, but user context takes priority

### 3. Categorization: Annotate, Don't Filter

Current (hard gate):
- Different-person articles marked GREEN with reason "Different individual"
- Article never reaches analyze phase

New (soft signal):
- Articles stay in their natural category (RED/AMBER/GREEN based on content keywords)
- New fields added to each categorized result:
  - `entityMatch: "confirmed" | "likely" | "uncertain" | "unlikely"`
  - `entityReason: string` (e.g. "Article from 1930, subject is modern VP")
- An "unlikely" article with real adverse keywords stays AMBER/RED — still analyzed

### 4. Analyze Phase: Entity Context

- Profile + entity match score passed to analyzer as context
- Analyzer can note entity uncertainty in findings but never dismisses based on entity alone

### 5. Report: Entity Confidence Badge

- Findings display entity match as visual badge
- "unlikely match" findings get indicator but remain in report
- Analyst can manually dismiss after reviewing

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| LLM marks real adverse as "unlikely match" | Soft signal only — article still analyzed and reported |
| User provides wrong context | Profile seed cross-references with search results, flags contradictions |
| No context provided | No entity resolution block in prompt — identical to pre-change behavior |
| Profile seed returns empty | No entity annotation — all articles treated as "uncertain" |

## Rollback of Hard Gate

The current GREEN hard-gate in `triage.ts` (lines 717-726) must be changed from:
```
mark it GREEN with reason "Different individual"
```
to:
```
add entityMatch field but keep original RED/AMBER/GREEN category
```
