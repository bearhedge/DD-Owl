# Entity Resolution: Soft-Signal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional user context (company/role) to anchor entity resolution, and change from hard-gate filtering to soft-signal annotation so no adverse media is ever auto-dismissed.

**Architecture:** User provides optional freeform context via UI → passed as query param → anchors profile seed → categorization annotates `entityMatch`/`entityReason` on each result instead of filtering to GREEN → findings display entity badge for analyst review.

**Tech Stack:** TypeScript, HTML/CSS (vanilla), SSE events

**Design doc:** `docs/plans/2026-02-23-entity-resolution-design.md`

---

### Task 1: Add "Known as" input field to UI

**Files:**
- Modify: `ddowl/public/index.html:1761` (after Screen button row, before Name Variations)

**Step 1: Add the context input field**

Insert after line 1761 (`</div>` closing the input-group), before the Name Variations section (line 1763):

```html
        <!-- Entity Context (optional) -->
        <div style="margin-top: 8px;">
          <input
            type="text"
            id="contextInput"
            placeholder="Further info (e.g. VP at 中國建設銀行, Shenzhen)"
            style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; color: #666;"
          >
        </div>
```

**Step 2: Pass context in startScreening()**

In `startScreening()` (~line 3992), after `const language = selectedLanguages.join(',');`, add:

```js
const context = document.getElementById('contextInput').value.trim();
```

In `connectSSE()` (~line 4073), after `const languageParam = ...;`, add:

```js
const contextParam = context ? `&context=${encodeURIComponent(context)}` : '';
```

And append `${contextParam}` to the URL string on line 4081.

**Step 3: Verify manually**

Open the UI, confirm the input field appears below the name input and above Name Variations. Type a context string, click Screen, and confirm the URL includes `&context=...` in browser dev tools Network tab.

**Step 4: Commit**

```bash
git add ddowl/public/index.html
git commit -m "feat: add optional 'Known as' context field to screening UI"
```

---

### Task 2: Parse context param in server.ts

**Files:**
- Modify: `ddowl/src/server.ts:1098-1108`

**Step 1: Extract context from query params**

After line 1108 (`const lastSeenArticle = ...`), add:

```ts
const subjectContext = (req.query.context as string) || '';
```

**Step 2: Log it**

After the new line, add:

```ts
if (subjectContext) {
  console.log(`[V4] Entity context provided: "${subjectContext}"`);
}
```

**Step 3: Commit**

```bash
git add ddowl/src/server.ts
git commit -m "feat: parse entity context query param in screen/v4"
```

---

### Task 3: Inject user context into profile seed prompt

**Files:**
- Modify: `ddowl/src/server.ts:1915-1935` (the person profile prompt)

**Step 1: Add verified context block to person profile prompt**

In the person profile prompt (line 1915, the `: \`` branch), change:

```ts
: `You are a due diligence analyst. Given these search results about "${subjectName}", extract a preliminary subject profile.

SEARCH RESULTS:
${snippetSummary}

Extract ONLY facts that appear in multiple results or are stated clearly. Mark uncertain facts.
```

To:

```ts
: `You are a due diligence analyst. Given these search results about "${subjectName}", extract a preliminary subject profile.
${subjectContext ? `
VERIFIED CONTEXT (from the requesting analyst — treat as ground truth):
${subjectContext}

Use this context to identify the correct individual in the search results. Prioritize results that match this context.
` : ''}
SEARCH RESULTS:
${snippetSummary}

Extract ONLY facts that appear in multiple results or are stated clearly. Mark uncertain facts.
```

**Step 2: Verify build compiles**

Run: `cd ddowl && npx tsc --noEmit 2>&1 | grep server.ts`
Expected: No errors.

**Step 3: Commit**

```bash
git add ddowl/src/server.ts
git commit -m "feat: inject user context as ground truth into profile seed prompt"
```

---

### Task 4: Add entityMatch fields to CategorizedResult type

**Files:**
- Modify: `ddowl/src/triage.ts:613-622`

**Step 1: Add entity fields to CategorizedResult interface**

Change the interface at line 613:

```ts
export interface CategorizedResult {
  url: string;
  title: string;
  snippet: string;
  query: string;
  category: 'RED' | 'AMBER' | 'GREEN';
  reason: string;
  clusterId?: string;
  clusterLabel?: string;
  entityMatch?: 'confirmed' | 'likely' | 'uncertain' | 'unlikely';
  entityReason?: string;
}
```

**Step 2: Verify build compiles**

Run: `cd ddowl && npx tsc --noEmit 2>&1 | grep triage.ts`
Expected: No errors (fields are optional, no callers break).

**Step 3: Commit**

```bash
git add ddowl/src/triage.ts
git commit -m "feat: add entityMatch/entityReason fields to CategorizedResult"
```

---

### Task 5: Change categorization prompt from hard-gate to soft-signal

**Files:**
- Modify: `ddowl/src/triage.ts:717-726` (entity resolution block in categorizeBatch)
- Modify: `ddowl/src/triage.ts:730-731` (JSON output format)

**Step 1: Replace the hard-gate entity resolution block**

Change lines 717-726 from:

```ts
${subjectProfile && (subjectProfile.currentRole || subjectProfile.associatedCompanies.length > 0 || subjectProfile.nationality.length > 0) ? `
SUBJECT PROFILE (use for entity verification):
${subjectProfile.currentRole ? `- Role: ${subjectProfile.currentRole.title} at ${subjectProfile.currentRole.company}` : ''}
${subjectProfile.industry.length > 0 ? `- Industry: ${subjectProfile.industry.join(', ')}` : ''}
${subjectProfile.associatedCompanies.length > 0 ? `- Companies: ${subjectProfile.associatedCompanies.map(c => c.name).join(', ')}` : ''}
${subjectProfile.nationality.length > 0 ? `- Nationality: ${subjectProfile.nationality.join(', ')}` : ''}
${subjectProfile.ageRange ? `- Age: ${subjectProfile.ageRange}` : ''}

ENTITY RESOLUTION: If an article is clearly about a DIFFERENT "${subjectName}" (different era, different industry, different geography, or different role than the profile above), mark it GREEN with reason "Different individual".
` : ''}
```

To:

```ts
${subjectProfile && (subjectProfile.currentRole || subjectProfile.associatedCompanies.length > 0 || subjectProfile.nationality.length > 0) ? `
SUBJECT PROFILE (for entity matching — do NOT change RED/AMBER/GREEN based on this):
${subjectProfile.currentRole ? `- Role: ${subjectProfile.currentRole.title} at ${subjectProfile.currentRole.company}` : ''}
${subjectProfile.industry.length > 0 ? `- Industry: ${subjectProfile.industry.join(', ')}` : ''}
${subjectProfile.associatedCompanies.length > 0 ? `- Companies: ${subjectProfile.associatedCompanies.map(c => c.name).join(', ')}` : ''}
${subjectProfile.nationality.length > 0 ? `- Nationality: ${subjectProfile.nationality.join(', ')}` : ''}
${subjectProfile.ageRange ? `- Age: ${subjectProfile.ageRange}` : ''}

ENTITY MATCHING: For each result, assess whether it refers to the subject above. Add "entityMatch" field:
- "confirmed": Article clearly about this specific person (matching company, role, or unique details)
- "likely": Probable match but not certain
- "uncertain": Cannot determine (default if unsure)
- "unlikely": Clearly a different person (different era, industry, geography)
Keep the RED/AMBER/GREEN category based on CONTENT — never change category based on entity match. An "unlikely" match with real adverse keywords must still be RED/AMBER.
` : ''}
```

**Step 2: Update the JSON output format instruction**

Change line 731 from:

```ts
{"classifications":[{"index":1,"category":"GREEN","reason":"neutral"},{"index":2,"category":"RED","reason":"corruption mentioned"}]}`;
```

To:

```ts
{"classifications":[{"index":1,"category":"GREEN","reason":"neutral","entityMatch":"uncertain"},{"index":2,"category":"RED","reason":"corruption mentioned","entityMatch":"confirmed","entityReason":"matches VP role at company X"}]}
If no subject profile is provided, omit entityMatch and entityReason fields.`;
```

**Step 3: Update the response parser to extract entity fields**

Find the response parsing section in `categorizeBatch` where classifications are mapped to output arrays (~line 750-783). Read that section and add `entityMatch` and `entityReason` extraction from the parsed JSON, passing them into the `CategorizedResult` objects pushed to `output.red`, `output.amber`, `output.green`.

For each push like:
```ts
output.red.push({ ...relevant[idx], category: 'RED', reason: item.reason });
```
Change to:
```ts
output.red.push({ ...relevant[idx], category: 'RED', reason: item.reason, entityMatch: item.entityMatch, entityReason: item.entityReason });
```

**Step 4: Verify build compiles**

Run: `cd ddowl && npx tsc --noEmit 2>&1 | grep triage.ts`
Expected: No errors.

**Step 5: Commit**

```bash
git add ddowl/src/triage.ts
git commit -m "feat: change entity resolution from hard-gate to soft-signal annotation"
```

---

### Task 6: Surface entity match in SSE events to UI

**Files:**
- Modify: `ddowl/src/server.ts:2537-2542` (categorized_item sendEvent calls)

**Step 1: Add entity fields to categorized_item events**

Change the sendEvent calls at lines 2539 and 2542 to include entity fields:

```ts
sendEvent({ type: 'categorized_item', category: 'RED', title: item.title, snippet: item.snippet, query: item.query, reason: item.reason, url: item.url, entityMatch: item.entityMatch, entityReason: item.entityReason });
```

```ts
sendEvent({ type: 'categorized_item', category: 'AMBER', title: item.title, snippet: item.snippet, query: item.query, reason: item.reason, url: item.url, entityMatch: item.entityMatch, entityReason: item.entityReason });
```

**Step 2: Commit**

```bash
git add ddowl/src/server.ts
git commit -m "feat: include entityMatch in categorized_item SSE events"
```

---

### Task 7: Display entity match badge in UI

**Files:**
- Modify: `ddowl/public/index.html` (where categorized_item events are rendered)

**Step 1: Find the categorized_item event handler**

Search for `categorized_item` in index.html to find where RED/AMBER items are rendered to the DOM.

**Step 2: Add entity badge**

When rendering a categorized item, if `data.entityMatch` exists and is not `"uncertain"`, show a small badge:
- `confirmed` → green dot, no label needed
- `likely` → no badge (default assumption)
- `unlikely` → orange badge: `⚠ Possible different person`

The badge should be informational only — the item stays in its RED/AMBER list.

**Step 3: Verify manually**

Screen a name with context provided, confirm entity badges appear on relevant items.

**Step 4: Commit**

```bash
git add ddowl/public/index.html
git commit -m "feat: display entity match badge on categorized items in UI"
```

---

### Task 8: Build verification and push

**Step 1: Full build check**

Run: `cd ddowl && npm run build 2>&1 | grep -E '(error TS|triage\.ts|server\.ts)'`
Expected: No errors in server.ts or triage.ts.

**Step 2: Push to main**

```bash
git push origin main
```

**Step 3: Monitor Cloud Build**

Watch for build success in Cloud Build logs.
