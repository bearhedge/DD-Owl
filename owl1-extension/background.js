// DD Owl Background Service Worker
console.log('DD Owl background service worker started');

const WS_URL = 'ws://localhost:8080/ws';
const RECONNECT_INTERVAL = 30000; // 30 seconds between retries (less spammy)

let ws = null;
let isConnected = false;
let reconnectTimer = null;
let connectionAttempts = 0;
const MAX_SILENT_ATTEMPTS = 3; // Only log first few attempts
let puppeteerStatus = {
  running: false,
  currentUrl: null,
  progress: null,
  lastExtracted: []
};

// ============================================
// AUTO-RESEARCH (Extension-based, no Puppeteer)
// ============================================
let autoResearchState = {
  running: false,
  queue: [],           // Array of { name, url, role }
  currentIndex: 0,
  currentTabId: null,
  personName: '',
  results: [],         // Collected extraction results
  startTime: null
};

// Random delay between 5-10 seconds to appear human
function randomDelay() {
  return 5000 + Math.random() * 5000;
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start auto-research for a list of companies
async function startAutoResearch(personName, companies) {
  if (autoResearchState.running) {
    console.log('Auto-research already running');
    return { success: false, error: 'Already running' };
  }

  console.log(`Starting auto-research for ${personName} with ${companies.length} companies`);

  autoResearchState = {
    running: true,
    queue: companies,
    currentIndex: 0,
    currentTabId: null,
    personName: personName,
    results: [],
    startTime: Date.now()
  };

  // Start processing queue
  processAutoResearchQueue();

  return { success: true, total: companies.length };
}

// Stop auto-research
function stopAutoResearch() {
  console.log('Stopping auto-research');

  // Close current tab if open
  if (autoResearchState.currentTabId) {
    chrome.tabs.remove(autoResearchState.currentTabId).catch(() => {});
  }

  const results = autoResearchState.results;
  autoResearchState = {
    running: false,
    queue: [],
    currentIndex: 0,
    currentTabId: null,
    personName: '',
    results: [],
    startTime: null
  };

  return { success: true, results };
}

// Process the auto-research queue
async function processAutoResearchQueue() {
  while (autoResearchState.running && autoResearchState.currentIndex < autoResearchState.queue.length) {
    const company = autoResearchState.queue[autoResearchState.currentIndex];
    console.log(`Processing ${autoResearchState.currentIndex + 1}/${autoResearchState.queue.length}: ${company.name}`);

    // Notify popup of progress
    broadcastAutoResearchProgress();

    try {
      // Open company page in new tab (inactive to not disrupt user)
      const tab = await chrome.tabs.create({
        url: company.url,
        active: false
      });
      autoResearchState.currentTabId = tab.id;

      // Wait for page to load and content script to extract
      const extractedData = await waitForExtraction(tab.id, 30000);

      if (extractedData) {
        autoResearchState.results.push({
          company: company.name,
          role: company.role,
          url: company.url,
          data: extractedData,
          extractedAt: new Date().toISOString()
        });

        // Send to backend
        sendWSMessage({
          type: 'AUTO_RESEARCH_RESULT',
          data: {
            personName: autoResearchState.personName,
            companyIndex: autoResearchState.currentIndex,
            totalCompanies: autoResearchState.queue.length,
            result: extractedData
          }
        });
      }

      // Close the tab
      await chrome.tabs.remove(tab.id).catch(() => {});
      autoResearchState.currentTabId = null;

    } catch (error) {
      console.error(`Error processing ${company.name}:`, error);
      autoResearchState.results.push({
        company: company.name,
        role: company.role,
        url: company.url,
        error: error.message,
        extractedAt: new Date().toISOString()
      });
    }

    autoResearchState.currentIndex++;

    // Random delay before next company (5-10 seconds)
    if (autoResearchState.running && autoResearchState.currentIndex < autoResearchState.queue.length) {
      const delay = randomDelay();
      console.log(`Waiting ${Math.round(delay/1000)}s before next company...`);
      await sleep(delay);
    }
  }

  // All done
  if (autoResearchState.running) {
    console.log('Auto-research completed!');

    // Send completion to backend
    sendWSMessage({
      type: 'AUTO_RESEARCH_COMPLETED',
      data: {
        personName: autoResearchState.personName,
        totalCompanies: autoResearchState.queue.length,
        results: autoResearchState.results,
        duration: Date.now() - autoResearchState.startTime
      }
    });

    // Broadcast completion
    broadcastAutoResearchProgress();

    autoResearchState.running = false;
  }
}

// Wait for content script to extract data from a tab
function waitForExtraction(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // Listen for tab updates (page load)
    const checkExtraction = async () => {
      if (Date.now() - startTime > timeout) {
        resolve(null);
        return;
      }

      try {
        // Try to send extraction message
        const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_DATA' });
        if (response && response.success) {
          resolve(response.data);
          return;
        }
      } catch (e) {
        // Content script not ready yet, wait and retry
      }

      // Retry after 1 second
      setTimeout(checkExtraction, 1000);
    };

    // Wait for page to load first
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Give content script time to initialize
        setTimeout(checkExtraction, 1500);
      }
    });
  });
}

// Broadcast progress to popup
function broadcastAutoResearchProgress() {
  // This will be picked up by popup's periodic status check
}

// Get auto-research status
function getAutoResearchStatus() {
  if (!autoResearchState.running) {
    return { running: false };
  }

  const current = autoResearchState.queue[autoResearchState.currentIndex];
  return {
    running: true,
    personName: autoResearchState.personName,
    currentCompany: current ? current.name : null,
    currentIndex: autoResearchState.currentIndex,
    totalCompanies: autoResearchState.queue.length,
    completedCount: autoResearchState.results.length,
    results: autoResearchState.results
  };
}

// Connect to WebSocket server (silently fails if backend not running)
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  connectionAttempts++;

  // Only log first few attempts to avoid spam
  if (connectionAttempts <= MAX_SILENT_ATTEMPTS) {
    console.log('Connecting to backend...');
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('Backend connected');
      isConnected = true;
      connectionAttempts = 0; // Reset on success
      clearReconnectTimer();
      sendWSMessage({ type: 'GET_STATUS' });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWSMessage(message);
      } catch (error) {
        // Silent parse errors
      }
    };

    ws.onclose = () => {
      isConnected = false;
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // Silent - don't log errors, just mark disconnected
      isConnected = false;
    };
  } catch (error) {
    // Silent failure
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, RECONNECT_INTERVAL);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function sendWSMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      ...message,
      timestamp: new Date().toISOString()
    }));
    return true;
  }
  return false;
}

function handleWSMessage(message) {
  console.log('Received from server:', message.type);

  switch (message.type) {
    case 'STATUS_RESPONSE':
      // Initial or requested status update
      if (message.data) {
        puppeteerStatus = {
          ...puppeteerStatus,
          running: message.data.puppeteerRunning || false,
          lastExtracted: message.data.lastExtracted || []
        };
      }
      break;

    case 'PUPPETEER_STATUS':
      // Puppeteer automation status update
      if (message.data) {
        puppeteerStatus = {
          running: message.data.running,
          currentUrl: message.data.currentUrl,
          progress: message.data.progress,
          lastExtracted: message.data.lastExtracted || []
        };
      }
      break;

    case 'EXTRACTION_ACK':
      console.log('Extraction acknowledged:', message.data?.message);
      break;

    case 'NAVIGATE_TO':
      // Server wants us to trigger extraction on a specific tab
      // This is used when Puppeteer navigates and needs extension to extract
      if (message.data?.url) {
        triggerExtractionOnUrl(message.data.url);
      }
      break;

    // Research orchestrator messages
    case 'EXTRACT_AFFILIATIONS':
      handleResearchMessage('EXTRACT_AFFILIATIONS', message.data);
      break;

    case 'SWITCH_TAB':
      handleResearchMessage('SWITCH_TAB', message.data);
      break;

    case 'FIND_PERSON_IN_COMPANY':
      handleResearchMessage('FIND_PERSON_IN_COMPANY', message.data);
      break;

    case 'GET_COMPANY_BASIC':
      handleResearchMessage('GET_COMPANY_BASIC', message.data);
      break;

    // Research progress (broadcast to popup for display)
    case 'RESEARCH_PROGRESS':
    case 'RESEARCH_STARTED':
    case 'RESEARCH_COMPLETED':
    case 'RESEARCH_FAILED':
    case 'RESEARCH_STOPPED':
      // Store status and notify popup
      researchStatus = message.data || {};
      break;

    // AI Agent progress
    case 'AGENT_PROGRESS':
    case 'AGENT_COMPLETED':
    case 'AGENT_FAILED':
      agentStatus = message.data || {};
      break;

    case 'ERROR':
      console.error('Server error:', message.data);
      break;
  }
}

// Store research status for popup
let researchStatus = {};

// Store AI agent status for popup
let agentStatus = {};

// Handle research messages that need to forward to content script and respond
async function handleResearchMessage(type, data) {
  try {
    // Find QCC or Tianyancha tab
    let tabs = await chrome.tabs.query({ url: '*://www.qcc.com/*' });
    if (tabs.length === 0) {
      tabs = await chrome.tabs.query({ url: '*://www.tianyancha.com/*' });
    }
    if (tabs.length === 0) {
      sendWSMessage({
        type: 'EXTENSION_RESPONSE',
        data: { success: false, error: 'No QCC tab found' }
      });
      return;
    }

    const targetTab = tabs[0];

    // Forward message to content script
    const response = await chrome.tabs.sendMessage(targetTab.id, {
      type: type,
      ...data
    });

    // Send response back to server
    sendWSMessage({
      type: 'EXTENSION_RESPONSE',
      data: response
    });

  } catch (error) {
    console.error(`Error handling ${type}:`, error);
    sendWSMessage({
      type: 'EXTENSION_RESPONSE',
      data: { success: false, error: error.message }
    });
  }
}

async function triggerExtractionOnUrl(url) {
  // Find tab with this URL
  const tabs = await chrome.tabs.query({});
  const targetTab = tabs.find(tab => tab.url === url || tab.url?.startsWith(url.split('?')[0]));

  if (targetTab) {
    try {
      const response = await chrome.tabs.sendMessage(targetTab.id, { type: 'EXTRACT_DATA' });
      if (response && response.success) {
        // Send extracted data to server
        sendWSMessage({
          type: 'EXTRACTED_DATA',
          data: response.data
        });
      }
    } catch (error) {
      console.error('Failed to extract from tab:', error);
    }
  }
}

// Message handler from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (message.type === 'GET_STATUS') {
    sendResponse({
      connected: isConnected,
      puppeteerStatus: puppeteerStatus,
      researchStatus: researchStatus,
      agentStatus: agentStatus,
      autoResearchStatus: getAutoResearchStatus()
    });
    return true;
  }

  // Start extension-based auto-research (no Puppeteer)
  if (message.type === 'START_AUTO_RESEARCH') {
    startAutoResearch(message.personName, message.companies).then(result => {
      sendResponse(result);
    });
    return true; // Keep channel open for async response
  }

  // Stop auto-research
  if (message.type === 'STOP_AUTO_RESEARCH') {
    const result = stopAutoResearch();
    sendResponse(result);
    return true;
  }

  // Get company URLs from content script (for Research All button)
  if (message.type === 'GET_COMPANY_URLS') {
    // Forward to content script on QCC or Tianyancha tab
    (async () => {
      let tabs = await chrome.tabs.query({ url: '*://www.qcc.com/*' });
      if (tabs.length === 0) {
        tabs = await chrome.tabs.query({ url: '*://www.tianyancha.com/*' });
      }
      if (tabs.length === 0) {
        sendResponse({ success: false, error: 'No QCC or Tianyancha tab found' });
        return;
      }
      try {
        const response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT_COMPANY_URLS' });
        sendResponse(response);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // Start AI agent
  if (message.type === 'START_AI_AGENT') {
    const sent = sendWSMessage({
      type: 'START_AI_AGENT',
      data: { task: message.task }
    });
    sendResponse({ success: sent });
    return true;
  }

  // Stop AI agent
  if (message.type === 'STOP_AI_AGENT') {
    const sent = sendWSMessage({ type: 'STOP_AI_AGENT' });
    agentStatus = {};
    sendResponse({ success: sent });
    return true;
  }

  // Start person research
  if (message.type === 'START_PERSON_RESEARCH') {
    const sent = sendWSMessage({
      type: 'START_PERSON_RESEARCH',
      data: {
        personName: message.personName,
        personUrl: message.personUrl
      }
    });
    sendResponse({ success: sent });
    return true;
  }

  // Stop person research
  if (message.type === 'STOP_PERSON_RESEARCH') {
    const sent = sendWSMessage({ type: 'STOP_PERSON_RESEARCH' });
    sendResponse({ success: sent });
    return true;
  }

  // Get research results
  if (message.type === 'GET_RESEARCH_RESULTS') {
    sendWSMessage({ type: 'GET_RESEARCH_RESULTS' });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'EXTRACTED_DATA') {
    console.log('Received extracted data:', message.data);

    // Send to backend via WebSocket
    const sent = sendWSMessage({
      type: 'EXTRACTED_DATA',
      data: message.data
    });

    sendResponse({
      success: true,
      sentToBackend: sent,
      backendConnected: isConnected
    });
    return true;
  }

  if (message.type === 'START_AUTO_MODE') {
    const sent = sendWSMessage({
      type: 'START_AUTO_MODE',
      data: message.config
    });
    sendResponse({ success: sent });
    return true;
  }

  if (message.type === 'STOP_AUTO_MODE') {
    const sent = sendWSMessage({ type: 'STOP_AUTO_MODE' });
    sendResponse({ success: sent });
    return true;
  }

  if (message.type === 'TAKE_OVER') {
    const sent = sendWSMessage({ type: 'TAKE_OVER' });
    sendResponse({ success: sent });
    return true;
  }

  return false;
});

// Start WebSocket connection when service worker starts
connectWebSocket();

// Keep service worker alive with periodic heartbeat
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendWSMessage({ type: 'GET_STATUS' });
  }
}, 25000);
