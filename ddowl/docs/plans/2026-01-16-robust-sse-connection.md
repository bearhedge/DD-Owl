# Robust SSE Connection + API Credit Protection

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make SSE connections robust, stable, and permanent while preventing API credit waste from reconnection storms.

**Architecture:** Defense-in-depth with 5 layers: (1) abort on client disconnect, (2) request deduplication, (3) resumeFrom support for V4, (4) AbortSignal propagation to API calls, (5) faster heartbeat. Each layer independently prevents a failure mode.

**Tech Stack:** Node.js/Express SSE, AbortController/AbortSignal, axios with signal support

---

## Task 1: Add AbortController and Client Disconnect Handler

**Files:**
- Modify: `src/server.ts:843-850` (V4 endpoint, after heartbeat setup)

**Step 1: Read the current heartbeat setup**

Verify current code at line 843-846:
```typescript
// Heartbeat
const heartbeat = setInterval(() => {
  res.write(': keepalive\n\n');
}, 5000);
```

**Step 2: Add AbortController and disconnect handler**

Add immediately after heartbeat setup (after line 846):
```typescript
  // Abort controller for cancelling operations on client disconnect
  const abortController = new AbortController();
  const { signal } = abortController;

  // Handle client disconnect
  res.on('close', () => {
    console.log(`[V4] Client disconnected for: ${subjectName}`);
    abortController.abort();
    clearInterval(heartbeat);
  });
```

**Step 3: Verify syntax**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(sse): add abort controller and client disconnect handler"
```

---

## Task 2: Add Request Deduplication

**Files:**
- Modify: `src/server.ts:70` (add global map after imports)
- Modify: `src/server.ts:787-795` (V4 endpoint start)

**Step 1: Add global activeScreenings map**

Add after line 70 (after `initLogDirectories();`):
```typescript
// Track active screenings to prevent duplicates
const activeScreenings = new Map<string, AbortController>();
```

**Step 2: Add deduplication logic to V4 endpoint**

Add after `const language = ...` line (~795), before SSE setup:
```typescript
  // Cancel any existing screening for this subject
  const screeningKey = subjectName.toLowerCase();
  if (activeScreenings.has(screeningKey)) {
    console.log(`[V4] Cancelling existing screening for: ${subjectName}`);
    activeScreenings.get(screeningKey)!.abort();
    activeScreenings.delete(screeningKey);
  }
```

**Step 3: Register new screening after abortController is created**

Add after `const { signal } = abortController;`:
```typescript
  activeScreenings.set(screeningKey, abortController);
```

**Step 4: Clean up on completion**

Find the `res.end()` calls in V4 (around lines 948, 1029, 1073, 1260, 1265) and add before each:
```typescript
    activeScreenings.delete(screeningKey);
```

Also add in the catch block (~line 1261):
```typescript
    activeScreenings.delete(screeningKey);
```

**Step 5: Verify syntax**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat(sse): add request deduplication to prevent concurrent screenings"
```

---

## Task 3: Add resumeFrom Support to V4

**Files:**
- Modify: `src/server.ts:790` (V4 parameter parsing)
- Modify: `src/server.ts:893` (searchAll call)

**Step 1: Parse resumeFrom parameter**

Add after language parsing (~line 791):
```typescript
  const resumeFrom = parseInt(req.query.resumeFrom as string) || 0;
```

**Step 2: Modify searchAll call to support resume**

The current searchAll at ~line 893 searches all templates. We need to skip completed ones.

Replace the search section (~lines 888-916) with:
```typescript
    // Search with all name variants combined using OR in each query
    // Skip queries before resumeFrom (already completed in previous connection)
    const allResults: BatchSearchResult[] = [];
    let searchesDone = resumeFrom;

    for (let i = 0; i < selectedTemplates.length; i++) {
      // Skip already-completed queries on resume
      if (i < resumeFrom) {
        sendEvent({
          type: 'query_skipped',
          queryIndex: i + 1,
          reason: 'Already completed before reconnect'
        });
        continue;
      }

      const template = selectedTemplates[i];

      // Build query with all name variants using OR
      let query: string;
      if (nameVariations.length === 1) {
        query = template.replace('{NAME}', nameVariations[0]);
      } else {
        const orClause = '(' + nameVariations.map(n => `"${n}"`).join(' OR ') + ')';
        query = template.replace('"{NAME}"', orClause);
      }

      sendEvent({
        type: 'query_start',
        queryIndex: i + 1,
        totalQueries: selectedTemplates.length,
        query,
      });

      // Search Google (Serper) - up to 5 pages
      const MAX_PAGES = 5;
      const googleResults: SearchResult[] = [];

      for (let page = 1; page <= MAX_PAGES; page++) {
        // Check if aborted
        if (signal.aborted) {
          console.log(`[V4] Search aborted for: ${subjectName}`);
          return;
        }

        const pageResults = await searchGoogle(query, page, 10);

        sendEvent({
          type: 'search_page',
          queryIndex: i + 1,
          totalQueries: selectedTemplates.length,
          page,
          pageResults: pageResults.length,
        });

        if (pageResults.length === 0) break;
        googleResults.push(...pageResults);
        if (pageResults.length < 10) break;
        await new Promise(r => setTimeout(r, 200));
      }

      for (const r of googleResults) {
        allResults.push({
          url: r.link,
          title: r.title,
          snippet: r.snippet,
          query: template,
        });
      }

      searchesDone++;
      sendEvent({
        type: 'search_progress',
        queryIndex: i + 1,
        totalQueries: selectedTemplates.length,
        query,
        resultsFound: googleResults.length,
        totalSoFar: allResults.length,
      });

      await new Promise(r => setTimeout(r, 500));
    }
```

**Step 3: Verify syntax**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(sse): add resumeFrom support to V4 endpoint"
```

---

## Task 4: Add AbortSignal to Searcher

**Files:**
- Modify: `src/searcher.ts:24-45` (searchGoogle function)

**Step 1: Add signal parameter to searchGoogle**

Change function signature at line 24:
```typescript
export async function searchGoogle(
  query: string,
  page: number = 1,
  resultsPerPage: number = 10,
  signal?: AbortSignal
): Promise<SearchResult[]> {
```

**Step 2: Pass signal to axios**

Update axios call at ~line 30:
```typescript
    const response = await axios.post<SerperResponse>(
      SERPER_URL,
      {
        q: query,
        hl: 'zh-cn',
        num: resultsPerPage,
        page: page,
      },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        signal,
      }
    );
```

**Step 3: Handle abort error gracefully**

Update catch block at ~line 56:
```typescript
  } catch (error: any) {
    if (error.name === 'CanceledError' || signal?.aborted) {
      console.log(`Search cancelled for query "${query}" page ${page}`);
      return [];
    }
    console.error(`Search error for query "${query}" page ${page}:`, error);
    return [];
  }
```

**Step 4: Verify syntax**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/searcher.ts
git commit -m "feat(searcher): add AbortSignal support for cancellable searches"
```

---

## Task 5: Reduce Heartbeat Interval

**Files:**
- Modify: `src/server.ts:846` (heartbeat interval)

**Step 1: Change heartbeat from 5s to 2s**

Change line 846 from:
```typescript
}, 5000);
```

To:
```typescript
}, 2000);
```

**Step 2: Update comment**

Change line 843-844 from:
```typescript
  // Heartbeat to prevent timeout (5s for better connection stability)
```

To:
```typescript
  // Heartbeat to prevent timeout (2s for robust connection stability)
```

**Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat(sse): reduce heartbeat interval to 2s for better stability"
```

---

## Task 6: Build, Deploy, and Verify

**Step 1: Build**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && npm run build`
Expected: Build succeeds

**Step 2: Deploy**

Run: `cd /Users/home/Desktop/DD\ Owl/ddowl && gcloud run deploy ddowl --source . --region asia-east1 --no-cpu-throttling`
Expected: Deployment succeeds

**Step 3: Test connection stability**

Run: `curl -sN --max-time 60 "https://ddowl.com/api/screen/v4?name=test&language=chinese" 2>&1 | grep -c "^data:"`
Expected: 50+ events received without drops

**Step 4: Test abort on disconnect**

1. Start screening in browser
2. Close tab mid-screening
3. Check Cloud Run logs for: `[V4] Client disconnected for: <name>`

**Step 5: Test request deduplication**

1. Start screening for "test"
2. Refresh page immediately
3. Check Cloud Run logs for: `[V4] Cancelling existing screening for: test`

**Step 6: Final commit**

```bash
git add .
git commit -m "feat(sse): complete robust SSE implementation with defense-in-depth"
```

---

## Verification Checklist

- [ ] Connection stays stable for 5+ minutes
- [ ] Heartbeat events every 2 seconds
- [ ] Client disconnect triggers abort log
- [ ] Duplicate requests cancel previous
- [ ] resumeFrom skips completed queries
- [ ] API calls stop after abort
