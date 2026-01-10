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

    case 'ERROR':
      console.error('Server error:', message.data);
      break;
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
      puppeteerStatus: puppeteerStatus
    });
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
