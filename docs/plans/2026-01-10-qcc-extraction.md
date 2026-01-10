# QCC Data Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension that extracts structured company/person data from QCC (企查查) with one click.

**Architecture:** Content script extracts DOM data, sends to background worker, stores in backend via WebSocket. Manual mode first, then add Puppeteer automation.

**Tech Stack:** Chrome Extension (Manifest V3), TypeScript backend, WebSocket, Puppeteer

---

## Task 1: Get Debug Output from Mainland Company

**Files:**
- Read: `owl1-extension/content-scripts/qcc.js` (already has debug capture)

**Step 1: Navigate to test company on QCC**

User action:
1. Open Chrome with DD Owl extension loaded
2. Activate GoLink VPN
3. Go to qcc.com, login if needed
4. Search for "绍兴上虞任盛投资有限公司"
5. Click into the company profile

**Step 2: Reload extension and extract**

User action:
1. Go to chrome://extensions
2. Click refresh on DD Owl
3. Go back to QCC company page, refresh the page
4. Click DD Owl extension icon
5. Click "Extract Company Data"
6. Copy the full JSON output

**Step 3: Analyze the debug output**

Expected: JSON with `_debug` field containing:
- `h1s`: Array of h1 elements on page
- `infoSections`: Elements matching common info selectors
- `labeledDivs`: Divs containing registration labels (商业登记号码, 公司编号, etc.)
- `tables`: First 3 tables on page

---

## Task 2: Fix Company Name Selector

**Files:**
- Modify: `owl1-extension/content-scripts/qcc.js:95-106`

**Step 1: Update company name extraction**

Based on debug output, the company name is in `h1.copy-value`. Update selector:

```javascript
// 1. Extract company name from header
// QCC uses h1.copy-value for the company name
const h1El = document.querySelector('h1.copy-value');
if (h1El) {
  data.companyName = h1El.textContent.trim();
} else {
  // Fallback: extract from page title (format: "Company Name - 企查查")
  const titleMatch = document.title.match(/^(.+?)\s*-\s*企查查/);
  if (titleMatch) {
    data.companyName = titleMatch[1].trim();
  }
}
```

**Step 2: Reload and test**

1. Reload extension in chrome://extensions
2. Refresh QCC page
3. Click Extract
4. Verify: `companyName` should be "绍兴上虞任盛投资有限公司"

---

## Task 3: Fix Registration Info Extraction

**Files:**
- Modify: `owl1-extension/content-scripts/qcc.js:131-158`

**Step 1: Identify registration info section from debug output**

Look at `_debug.labeledDivs` and `_debug.infoSections` to find where these fields live:
- 统一社会信用代码 (Unified Social Credit Code)
- 法定代表人 (Legal Representative)
- 注册资本 (Registered Capital)
- 成立日期 (Established Date)
- 企业状态 (Operating Status)

**Step 2: Update extraction logic based on actual DOM**

The extraction logic depends on what we find in the debug output. Common patterns:
- `div.detail-content` with label/value pairs
- `table.cominfo-table` with rows
- `span[class*="label"]` + `span[class*="value"]` pairs

**Step 3: Reload and test**

1. Reload extension
2. Refresh QCC page
3. Click Extract
4. Verify fields are populated correctly

---

## Task 4: Fix Shareholders Extraction

**Files:**
- Modify: `owl1-extension/content-scripts/qcc.js:160-190`

**Step 1: Identify shareholders section from debug output**

Look for section containing:
- 股东信息 (Shareholder Information)
- Names with percentages
- Links to shareholder profiles

**Step 2: Update shareholders extraction**

```javascript
// Extract shareholders with links
const shareholderSection = findSectionByTitle('股东信息') || findSectionByTitle('股东');
if (shareholderSection) {
  const rows = shareholderSection.querySelectorAll('tr, [class*="item"]');
  rows.forEach(row => {
    const nameEl = row.querySelector('a');
    const percentEl = row.querySelector('[class*="percent"], [class*="ratio"]');
    if (nameEl) {
      data.shareholders.push({
        name: nameEl.textContent.trim(),
        profileUrl: nameEl.href,
        percentage: percentEl?.textContent?.trim() || '',
        type: nameEl.href.includes('/run/') ? 'individual' : 'corporate'
      });
    }
  });
}
```

**Step 3: Reload and test**

Verify `shareholders` array contains correct names, percentages, and profile URLs.

---

## Task 5: Fix Directors/Executives Extraction

**Files:**
- Modify: `owl1-extension/content-scripts/qcc.js:192-212`

**Step 1: Identify personnel section**

Look for:
- 主要人员 (Key Personnel)
- 高管信息 (Executive Information)
- Names with positions

**Step 2: Update directors extraction**

Similar pattern to shareholders - find the section, extract rows with names and positions.

**Step 3: Reload and test**

Verify `directors` array contains correct names and positions.

---

## Task 6: Remove Debug Code and Clean Up

**Files:**
- Modify: `owl1-extension/content-scripts/qcc.js`
- Modify: `owl1-extension/popup/popup.js`

**Step 1: Remove debug output from extraction**

Delete or comment out the `_debug` field population code.

**Step 2: Restore summary view in popup**

```javascript
// Show summary instead of raw JSON
const summary = formatExtractedSummary(response.data);
resultEl.textContent = summary;
```

**Step 3: Test final extraction**

1. Reload extension
2. Extract from mainland company
3. Verify clean output with all fields populated
4. Verify popup shows readable summary

---

## Task 7: Test on Multiple Page Types

**Step 1: Test mainland company**

Company: 绍兴上虞任盛投资有限公司
Expected: All registration info, shareholders, directors populated

**Step 2: Test Hong Kong company**

Company: Bear Hedge Limited
Expected: Limited data (HK companies have less info on QCC)

**Step 3: Test person profile**

Click into a director/shareholder from company page
Expected: Person's name, all company affiliations

**Step 4: Document any failures**

Note which fields fail and on which page types for future fixes.

---

## Task 8: Start Backend Server

**Files:**
- Run: `ddowl/src/server.ts`

**Step 1: Start the backend**

```bash
cd "/Users/home/Desktop/DD Owl/ddowl"
npm run dev
```

Expected output:
```
DD Owl running on port 8080
WebSocket server available at ws://localhost:8080/ws
```

**Step 2: Verify extension connects**

1. Open extension popup
2. Check "Backend" status shows "Connected" (green)

**Step 3: Extract and verify backend receives data**

1. Click Extract on QCC page
2. Check backend terminal for "Received extracted data" log

---

## Verification Checklist

- [ ] Company name extracts correctly
- [ ] Registration info (统一社会信用代码, 法定代表人, 注册资本, 成立日期) extracts
- [ ] Shareholders list with names, percentages, and profile links
- [ ] Directors list with names and positions
- [ ] Extension shows "Connected" when backend running
- [ ] Backend receives and logs extracted data
- [ ] Works on mainland China company
- [ ] Gracefully handles HK company (limited data)
