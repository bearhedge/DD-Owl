# Owl1 QCC Chrome Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension that automates data extraction from QCC (Qichacha) company registry and sends structured data to the DD Owl backend.

**Architecture:** Chrome Manifest V3 extension with content scripts injected into QCC pages. Background service worker maintains WebSocket connection to backend. User triggers extraction manually; extension scrapes visible page data and sends to backend for storage/report generation.

**Tech Stack:** Chrome Extension (Manifest V3), JavaScript (content scripts), WebSocket (ws library), Express (backend), TypeScript (backend types)

---

## Task 1: Create Extension Directory Structure

**Files:**
- Create: `/Users/home/Desktop/DD Owl/owl1-extension/manifest.json`
- Create: `/Users/home/Desktop/DD Owl/owl1-extension/background.js`
- Create: `/Users/home/Desktop/DD Owl/owl1-extension/popup/popup.html`
- Create: `/Users/home/Desktop/DD Owl/owl1-extension/popup/popup.js`
- Create: `/Users/home/Desktop/DD Owl/owl1-extension/content-scripts/qcc.js`
- Create: `/Users/home/Desktop/DD Owl/owl1-extension/icons/` (placeholder)

**Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Owl1 DD Research",
  "version": "1.0.0",
  "description": "Automated due diligence data extraction from QCC",
  "permissions": [
    "activeTab",
    "storage"
  ],
  "host_permissions": [
    "https://*.qcc.com/*",
    "https://*.qichacha.com/*",
    "http://localhost:8080/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://*.qcc.com/*", "https://*.qichacha.com/*"],
      "js": ["content-scripts/qcc.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "Owl1 DD Research"
  }
}
```

**Step 2: Create minimal background.js**

```javascript
// Owl1 Background Service Worker
console.log('Owl1 background service worker started');

let ws = null;
let isConnected = false;

// Message handler from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (message.type === 'GET_STATUS') {
    sendResponse({ connected: isConnected });
    return true;
  }

  if (message.type === 'EXTRACTED_DATA') {
    console.log('Received extracted data:', message.data);
    // TODO: Send to backend via WebSocket
    sendResponse({ success: true });
    return true;
  }

  return false;
});
```

**Step 3: Create popup/popup.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      width: 300px;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    h1 {
      font-size: 18px;
      margin: 0 0 16px 0;
    }
    .status {
      padding: 8px 12px;
      border-radius: 4px;
      margin-bottom: 16px;
    }
    .status.connected {
      background: #d4edda;
      color: #155724;
    }
    .status.disconnected {
      background: #f8d7da;
      color: #721c24;
    }
    button {
      width: 100%;
      padding: 10px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      background: #0056b3;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    #result {
      margin-top: 16px;
      padding: 8px;
      background: #f8f9fa;
      border-radius: 4px;
      font-size: 12px;
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <h1>Owl1 DD Research</h1>
  <div id="status" class="status disconnected">Checking connection...</div>
  <button id="extractBtn">Extract Company Data</button>
  <div id="result"></div>
  <script src="popup.js"></script>
</body>
</html>
```

**Step 4: Create popup/popup.js**

```javascript
// Popup script
document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const extractBtn = document.getElementById('extractBtn');
  const resultEl = document.getElementById('result');

  // Check connection status
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response && response.connected) {
      statusEl.textContent = 'Connected to backend';
      statusEl.className = 'status connected';
    } else {
      statusEl.textContent = 'Not connected (backend offline)';
      statusEl.className = 'status disconnected';
    }
  });

  // Extract button click
  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting...';
    resultEl.textContent = '';

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Check if on QCC
      if (!tab.url.includes('qcc.com') && !tab.url.includes('qichacha.com')) {
        resultEl.textContent = 'Error: Please navigate to QCC first';
        return;
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_DATA' });

      if (response && response.success) {
        resultEl.textContent = JSON.stringify(response.data, null, 2);
      } else {
        resultEl.textContent = 'Error: ' + (response?.error || 'Unknown error');
      }
    } catch (error) {
      resultEl.textContent = 'Error: ' + error.message;
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract Company Data';
    }
  });
});
```

**Step 5: Create content-scripts/qcc.js (minimal)**

```javascript
// QCC Content Script
console.log('Owl1 QCC content script loaded on:', window.location.href);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  if (message.type === 'EXTRACT_DATA') {
    try {
      const data = extractPageData();
      sendResponse({ success: true, data: data });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  return false;
});

// Basic extraction function (to be expanded)
function extractPageData() {
  const url = window.location.href;
  const pageTitle = document.title;

  return {
    sourceUrl: url,
    pageTitle: pageTitle,
    extractedAt: new Date().toISOString(),
    pageType: detectPageType(),
    rawText: document.body.innerText.substring(0, 1000) // First 1000 chars for testing
  };
}

function detectPageType() {
  const url = window.location.href;
  if (url.includes('/firm/') || url.includes('/company/')) {
    return 'company_profile';
  }
  if (url.includes('/search')) {
    return 'search_results';
  }
  return 'unknown';
}
```

**Step 6: Create icons directory with placeholder**

```bash
mkdir -p "/Users/home/Desktop/DD Owl/owl1-extension/icons"
```

**Step 7: Verify extension loads**

1. Open Chrome
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `/Users/home/Desktop/DD Owl/owl1-extension`
6. Verify extension appears without errors
7. Click extension icon, verify popup opens

**Step 8: Commit**

```bash
cd "/Users/home/Desktop/DD Owl"
git add owl1-extension/
git commit -m "feat(owl1): create chrome extension scaffold with basic popup and content script"
```

---

## Task 2: Add WebSocket Connection to Background Service Worker

**Files:**
- Modify: `/Users/home/Desktop/DD Owl/owl1-extension/background.js`

**Step 1: Update background.js with WebSocket logic**

```javascript
// Owl1 Background Service Worker
console.log('Owl1 background service worker started');

const BACKEND_WS_URL = 'ws://localhost:8080/ws';
let ws = null;
let isConnected = false;
let reconnectInterval = null;

// Connect to backend WebSocket
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  console.log('Connecting to backend WebSocket...');

  try {
    ws = new WebSocket(BACKEND_WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
      isConnected = true;
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      isConnected = false;
      ws = null;
      // Try to reconnect every 5 seconds
      if (!reconnectInterval) {
        reconnectInterval = setInterval(connectWebSocket, 5000);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      console.log('WebSocket message:', event.data);
      try {
        const message = JSON.parse(event.data);
        handleBackendMessage(message);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
  }
}

// Handle messages from backend
function handleBackendMessage(message) {
  console.log('Backend message:', message);
  // TODO: Handle commands from backend (e.g., trigger extraction)
}

// Send data to backend
function sendToBackend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  console.error('WebSocket not connected');
  return false;
}

// Message handler from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (message.type === 'GET_STATUS') {
    sendResponse({ connected: isConnected });
    return true;
  }

  if (message.type === 'EXTRACTED_DATA') {
    console.log('Received extracted data:', message.data);
    const sent = sendToBackend({
      type: 'QCC_EXTRACTION',
      data: message.data,
      timestamp: new Date().toISOString()
    });
    sendResponse({ success: sent });
    return true;
  }

  return false;
});

// Initialize WebSocket connection
connectWebSocket();
```

**Step 2: Update popup.js to send extracted data to background**

```javascript
// Popup script
document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const extractBtn = document.getElementById('extractBtn');
  const resultEl = document.getElementById('result');

  // Check connection status
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response && response.connected) {
      statusEl.textContent = 'Connected to backend';
      statusEl.className = 'status connected';
    } else {
      statusEl.textContent = 'Not connected (backend offline)';
      statusEl.className = 'status disconnected';
    }
  });

  // Extract button click
  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting...';
    resultEl.textContent = '';

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Check if on QCC
      if (!tab.url.includes('qcc.com') && !tab.url.includes('qichacha.com')) {
        resultEl.textContent = 'Error: Please navigate to QCC first';
        return;
      }

      // Send message to content script to extract
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_DATA' });

      if (response && response.success) {
        resultEl.textContent = 'Extracted:\n' + JSON.stringify(response.data, null, 2);

        // Send to background to forward to backend
        chrome.runtime.sendMessage({
          type: 'EXTRACTED_DATA',
          data: response.data
        }, (bgResponse) => {
          if (bgResponse && bgResponse.success) {
            resultEl.textContent += '\n\n[Sent to backend]';
          } else {
            resultEl.textContent += '\n\n[Failed to send to backend]';
          }
        });
      } else {
        resultEl.textContent = 'Error: ' + (response?.error || 'Unknown error');
      }
    } catch (error) {
      resultEl.textContent = 'Error: ' + error.message;
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract Company Data';
    }
  });
});
```

**Step 3: Reload extension and verify**

1. Go to `chrome://extensions`
2. Click reload button on Owl1 extension
3. Open extension popup
4. Check status shows "Not connected" (backend not running yet)

**Step 4: Commit**

```bash
cd "/Users/home/Desktop/DD Owl"
git add owl1-extension/
git commit -m "feat(owl1): add WebSocket connection to background service worker"
```

---

## Task 3: Add WebSocket Support to Backend

**Files:**
- Modify: `/Users/home/Desktop/DD Owl/ddowl/src/server.ts`
- Modify: `/Users/home/Desktop/DD Owl/ddowl/package.json`

**Step 1: Install ws dependency**

```bash
cd "/Users/home/Desktop/DD Owl/ddowl"
npm install ws
npm install -D @types/ws
```

**Step 2: Add WebSocket server to server.ts**

Add this code after the existing Express app setup (around line 25):

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

// ... existing code ...

// Create HTTP server from Express app
const server = createServer(app);

// WebSocket server for extension communication
const wss = new WebSocketServer({ server, path: '/ws' });

const connectedClients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  console.log('Extension connected via WebSocket');
  connectedClients.add(ws);

  // Send welcome message
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Connected to DD Owl backend' }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received from extension:', message.type);

      if (message.type === 'QCC_EXTRACTION') {
        handleQCCExtraction(message.data);
        ws.send(JSON.stringify({ type: 'ACK', message: 'Data received' }));
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Extension disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    connectedClients.delete(ws);
  });
});

// Handle extracted QCC data
function handleQCCExtraction(data: any) {
  console.log('=== QCC Extraction Received ===');
  console.log('URL:', data.sourceUrl);
  console.log('Page Type:', data.pageType);
  console.log('Extracted At:', data.extractedAt);
  console.log('Data:', JSON.stringify(data, null, 2));
  // TODO: Store in database, generate report
}

// Change app.listen to server.listen at the bottom
// Replace:
// app.listen(PORT, () => {
// With:
server.listen(PORT, () => {
  console.log(`DD Owl running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`Search templates loaded: ${SEARCH_TEMPLATES.length}`);
});
```

**Step 3: Verify backend compiles**

```bash
cd "/Users/home/Desktop/DD Owl/ddowl"
npm run build
```

Expected: No TypeScript errors

**Step 4: Start backend and test WebSocket**

```bash
npm run dev
```

Expected output includes: `WebSocket endpoint: ws://localhost:8080/ws`

**Step 5: Test extension connection**

1. With backend running, open Chrome
2. Go to `chrome://extensions`, reload Owl1 extension
3. Click extension icon
4. Status should show "Connected to backend"

**Step 6: Commit**

```bash
cd "/Users/home/Desktop/DD Owl"
git add ddowl/
git commit -m "feat(backend): add WebSocket server for extension communication"
```

---

## Task 4: Create QCC Types

**Files:**
- Create: `/Users/home/Desktop/DD Owl/ddowl/src/qcc-types.ts`

**Step 1: Create qcc-types.ts**

```typescript
import { z } from 'zod';

// Shareholder schema
export const ShareholderSchema = z.object({
  name: z.string(),
  investmentAmount: z.string().optional(),
  percentage: z.string().optional(),
  subscriptionDate: z.string().optional(),
  type: z.enum(['individual', 'corporate']).optional(),
});

export type Shareholder = z.infer<typeof ShareholderSchema>;

// Executive schema
export const ExecutiveSchema = z.object({
  name: z.string(),
  position: z.string(),
});

export type Executive = z.infer<typeof ExecutiveSchema>;

// Risk summary schema
export const RiskSummarySchema = z.object({
  legalCasesTotal: z.number().optional(),
  asDefendant: z.number().optional(),
  asPlaintiff: z.number().optional(),
  administrativePenalties: z.number().optional(),
  abnormalOperations: z.boolean().optional(),
  seriousViolations: z.boolean().optional(),
  taxArrears: z.number().optional(),
});

export type RiskSummary = z.infer<typeof RiskSummarySchema>;

// Related company schema
export const RelatedCompanySchema = z.object({
  name: z.string(),
  percentage: z.string().optional(),
});

export type RelatedCompany = z.infer<typeof RelatedCompanySchema>;

// Full QCC Company Profile schema
export const QCCCompanyProfileSchema = z.object({
  // Basic Information
  companyName: z.string(),
  legalRepresentative: z.string().optional(),
  registeredCapital: z.string().optional(),
  paidInCapital: z.string().optional(),
  establishedDate: z.string().optional(),
  operatingStatus: z.string().optional(),
  unifiedSocialCreditCode: z.string().optional(),
  organizationCode: z.string().optional(),
  taxpayerNumber: z.string().optional(),
  companyType: z.string().optional(),
  industry: z.string().optional(),
  approvalDate: z.string().optional(),
  registrationAuthority: z.string().optional(),
  businessScope: z.string().optional(),
  registeredAddress: z.string().optional(),

  // Shareholders
  shareholders: z.array(ShareholderSchema).optional(),

  // Key Personnel
  executives: z.array(ExecutiveSchema).optional(),

  // Risk Information
  riskSummary: RiskSummarySchema.optional(),

  // Related Companies
  subsidiaries: z.array(RelatedCompanySchema).optional(),
  investments: z.array(RelatedCompanySchema).optional(),

  // Metadata
  sourceUrl: z.string(),
  extractedAt: z.string(),
  pageType: z.string().optional(),
});

export type QCCCompanyProfile = z.infer<typeof QCCCompanyProfileSchema>;

// Search result schema
export const QCCSearchResultSchema = z.object({
  companyName: z.string(),
  legalRep: z.string().optional(),
  registeredCapital: z.string().optional(),
  establishedDate: z.string().optional(),
  status: z.string().optional(),
  profileUrl: z.string(),
});

export type QCCSearchResult = z.infer<typeof QCCSearchResultSchema>;

// Validate extracted data
export function validateQCCProfile(data: unknown): QCCCompanyProfile | null {
  try {
    return QCCCompanyProfileSchema.parse(data);
  } catch (error) {
    console.error('QCC profile validation failed:', error);
    return null;
  }
}
```

**Step 2: Verify types compile**

```bash
cd "/Users/home/Desktop/DD Owl/ddowl"
npm run build
```

Expected: No TypeScript errors

**Step 3: Commit**

```bash
cd "/Users/home/Desktop/DD Owl"
git add ddowl/src/qcc-types.ts
git commit -m "feat(types): add QCC company profile TypeScript types with Zod validation"
```

---

## Task 5: Build QCC Company Profile Extraction

**Files:**
- Modify: `/Users/home/Desktop/DD Owl/owl1-extension/content-scripts/qcc.js`

**Step 1: Update qcc.js with full extraction logic**

```javascript
// QCC Content Script - Full Extraction
console.log('Owl1 QCC content script loaded on:', window.location.href);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  if (message.type === 'EXTRACT_DATA') {
    try {
      const pageType = detectPageType();
      let data;

      if (pageType === 'company_profile') {
        data = extractCompanyProfile();
      } else if (pageType === 'search_results') {
        data = extractSearchResults();
      } else {
        data = { error: 'Unknown page type', pageType, url: window.location.href };
      }

      sendResponse({ success: true, data: data });
    } catch (error) {
      console.error('Extraction error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  return false;
});

// Detect what type of QCC page we're on
function detectPageType() {
  const url = window.location.href;
  // Company profile pages have /firm/ or /company/ in URL
  if (url.includes('/firm/') || url.includes('/firm_') || url.includes('/company/')) {
    return 'company_profile';
  }
  // Search results
  if (url.includes('/search') || url.includes('/web/search')) {
    return 'search_results';
  }
  return 'unknown';
}

// Extract company profile data
function extractCompanyProfile() {
  const data = {
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    pageType: 'company_profile',

    // Basic info - will be populated by selectors
    companyName: '',
    legalRepresentative: '',
    registeredCapital: '',
    paidInCapital: '',
    establishedDate: '',
    operatingStatus: '',
    unifiedSocialCreditCode: '',
    companyType: '',
    industry: '',
    registrationAuthority: '',
    businessScope: '',
    registeredAddress: '',

    // Arrays
    shareholders: [],
    executives: [],
    subsidiaries: [],
    investments: [],

    // Risk
    riskSummary: {}
  };

  // Extract company name from header
  const nameEl = document.querySelector('.company-name, h1.name, .firm-name, .cominfo-hd .name');
  if (nameEl) {
    data.companyName = nameEl.textContent.trim();
  }

  // Extract basic info table
  // QCC uses various class names, try multiple selectors
  const infoRows = document.querySelectorAll('.cominfo-normal tr, .basic-info tr, .detail-list li, .info-table tr');
  infoRows.forEach(row => {
    const label = row.querySelector('td:first-child, .label, th')?.textContent?.trim() || '';
    const value = row.querySelector('td:last-child, .value, td:nth-child(2)')?.textContent?.trim() || '';

    // Map Chinese labels to our fields
    if (label.includes('法定代表人') || label.includes('法人')) {
      data.legalRepresentative = value;
    } else if (label.includes('注册资本')) {
      data.registeredCapital = value;
    } else if (label.includes('实缴资本')) {
      data.paidInCapital = value;
    } else if (label.includes('成立日期') || label.includes('成立时间')) {
      data.establishedDate = value;
    } else if (label.includes('经营状态') || label.includes('企业状态')) {
      data.operatingStatus = value;
    } else if (label.includes('统一社会信用代码') || label.includes('信用代码')) {
      data.unifiedSocialCreditCode = value;
    } else if (label.includes('企业类型') || label.includes('公司类型')) {
      data.companyType = value;
    } else if (label.includes('所属行业') || label.includes('行业')) {
      data.industry = value;
    } else if (label.includes('登记机关')) {
      data.registrationAuthority = value;
    } else if (label.includes('经营范围')) {
      data.businessScope = value;
    } else if (label.includes('注册地址') || label.includes('企业地址')) {
      data.registeredAddress = value;
    }
  });

  // Try to extract from specific QCC selectors if above didn't work
  if (!data.companyName) {
    const altName = document.querySelector('[class*="company"][class*="name"]');
    if (altName) data.companyName = altName.textContent.trim();
  }

  // Extract shareholders table
  const shareholderRows = document.querySelectorAll('.shareholder-table tr, .stock-table tr, [class*="shareholder"] tr');
  shareholderRows.forEach((row, index) => {
    if (index === 0) return; // Skip header
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
      const shareholder = {
        name: cells[0]?.textContent?.trim() || '',
        percentage: cells[1]?.textContent?.trim() || '',
        investmentAmount: cells[2]?.textContent?.trim() || '',
        type: 'corporate' // Default, could be refined
      };
      if (shareholder.name) {
        data.shareholders.push(shareholder);
      }
    }
  });

  // Extract executives/key personnel
  const executiveRows = document.querySelectorAll('.executive-table tr, .member-table tr, [class*="executive"] tr, [class*="personnel"] tr');
  executiveRows.forEach((row, index) => {
    if (index === 0) return; // Skip header
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
      const executive = {
        name: cells[0]?.textContent?.trim() || '',
        position: cells[1]?.textContent?.trim() || ''
      };
      if (executive.name) {
        data.executives.push(executive);
      }
    }
  });

  // Extract risk summary from sidebar/badges
  const riskEl = document.querySelector('.risk-panel, [class*="risk"]');
  if (riskEl) {
    const riskText = riskEl.textContent;
    // Try to parse numbers from risk indicators
    const caseMatch = riskText.match(/法律诉讼[^\d]*(\d+)/);
    if (caseMatch) {
      data.riskSummary.legalCasesTotal = parseInt(caseMatch[1]);
    }
    const penaltyMatch = riskText.match(/行政处罚[^\d]*(\d+)/);
    if (penaltyMatch) {
      data.riskSummary.administrativePenalties = parseInt(penaltyMatch[1]);
    }
  }

  return data;
}

// Extract search results
function extractSearchResults() {
  const results = [];

  // QCC search results are usually in list items or cards
  const items = document.querySelectorAll('.search-result-item, .result-item, .company-item, [class*="search"][class*="item"]');

  items.forEach(item => {
    const result = {
      companyName: '',
      legalRep: '',
      registeredCapital: '',
      establishedDate: '',
      status: '',
      profileUrl: ''
    };

    // Get company name and link
    const nameLink = item.querySelector('a[href*="/firm/"], a[href*="/company/"], .company-name a');
    if (nameLink) {
      result.companyName = nameLink.textContent.trim();
      result.profileUrl = nameLink.href;
    }

    // Get other info from text
    const text = item.textContent;
    const legalRepMatch = text.match(/法定代表人[：:]\s*([^\s]+)/);
    if (legalRepMatch) result.legalRep = legalRepMatch[1];

    const capitalMatch = text.match(/注册资本[：:]\s*([^\s]+)/);
    if (capitalMatch) result.registeredCapital = capitalMatch[1];

    const dateMatch = text.match(/成立日期[：:]\s*([\d-]+)/);
    if (dateMatch) result.establishedDate = dateMatch[1];

    if (result.companyName) {
      results.push(result);
    }
  });

  return {
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    pageType: 'search_results',
    resultCount: results.length,
    results: results
  };
}
```

**Step 2: Reload extension**

1. Go to `chrome://extensions`
2. Click reload on Owl1 extension

**Step 3: Test extraction (requires QCC access)**

1. Ensure GoLink VPN is active
2. Navigate to qcc.com or qichacha.com
3. Login if needed
4. Search for a company
5. Click on a company profile
6. Click Owl1 extension icon
7. Click "Extract Company Data"
8. Verify JSON output in popup

**Step 4: Commit**

```bash
cd "/Users/home/Desktop/DD Owl"
git add owl1-extension/
git commit -m "feat(owl1): add full QCC company profile and search results extraction"
```

---

## Task 6: Integration Test with "Bear Hedge Limited"

**Files:**
- No new files, testing existing implementation

**Step 1: Start backend**

```bash
cd "/Users/home/Desktop/DD Owl/ddowl"
npm run dev
```

Verify: "WebSocket endpoint: ws://localhost:8080/ws" appears in logs

**Step 2: Prepare browser**

1. Open Chrome with GoLink VPN extension
2. Activate GoLink VPN (verify connection to China)
3. Go to `chrome://extensions`
4. Reload Owl1 extension
5. Open extension popup, verify "Connected to backend"

**Step 3: Navigate to QCC**

1. Go to https://www.qcc.com or https://www.qichacha.com
2. Login with your credentials (handle SMS verification if needed)

**Step 4: Search for test company**

1. Search for "Bear Hedge Limited" in QCC search bar
2. If no results with English, try Chinese equivalent
3. Note: May need to search "贝尔对冲" or similar

**Step 5: Extract from search results**

1. On search results page, click Owl1 extension icon
2. Click "Extract Company Data"
3. Verify search results JSON appears in popup
4. Check backend logs show received data

**Step 6: Extract from company profile**

1. Click on a company from search results
2. On company profile page, click Owl1 extension icon
3. Click "Extract Company Data"
4. Verify company profile JSON appears in popup
5. Check backend logs show full company data

**Step 7: Verify data structure**

Check that extracted data includes:
- companyName
- legalRepresentative
- registeredCapital
- establishedDate
- operatingStatus
- shareholders array
- executives array

**Step 8: Document any issues**

If selectors don't work for QCC's current DOM structure:
1. Use browser DevTools to inspect actual class names
2. Update qcc.js selectors accordingly
3. Reload extension and test again

**Step 9: Final commit**

```bash
cd "/Users/home/Desktop/DD Owl"
git add -A
git commit -m "test(owl1): verify QCC extraction with Bear Hedge Limited"
```

---

## Summary

After completing all tasks, you will have:

1. **Chrome Extension** (`owl1-extension/`) with:
   - Manifest V3 configuration
   - Background service worker with WebSocket
   - Content script for QCC data extraction
   - Popup UI for triggering extraction

2. **Backend WebSocket** in `ddowl/src/server.ts`:
   - WebSocket server at `/ws` endpoint
   - Receives extracted data from extension
   - Logs data (ready for storage/report generation)

3. **TypeScript Types** in `ddowl/src/qcc-types.ts`:
   - Zod schemas for validation
   - TypeScript interfaces for QCC data

## Next Steps (Phase 2)

After this phase works:
1. Store extracted data in database
2. Build Word document report generator
3. Add TYC cross-referencing
4. Add ICRIS (Hong Kong) integration
5. Build web dashboard for job management
