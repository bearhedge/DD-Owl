// DD Owl Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const backendStatusEl = document.getElementById('backendStatus');
  const manualModeBtn = document.getElementById('manualModeBtn');
  const autoModeBtn = document.getElementById('autoModeBtn');
  const autoStatusEl = document.getElementById('autoStatus');
  const autoProgressEl = document.getElementById('autoProgress');
  const autoCurrentUrlEl = document.getElementById('autoCurrentUrl');
  const extractedListEl = document.getElementById('extractedList');
  const manualControlsEl = document.getElementById('manualControls');
  const extractBtn = document.getElementById('extractBtn');
  const copyBtn = document.getElementById('copyBtn');
  const sendToBackendBtn = document.getElementById('sendToBackendBtn');
  const generateReportBtn = document.getElementById('generateReportBtn');
  const takeOverBtn = document.getElementById('takeOverBtn');
  const stopAutoBtn = document.getElementById('stopAutoBtn');
  const startAutoBtn = document.getElementById('startAutoBtn');
  const queueStatusEl = document.getElementById('queueStatus');
  const resultEl = document.getElementById('result');

  let currentMode = 'manual';
  let lastExtractedData = null;

  // Update status display
  function updateStatus(response) {
    const statusDot = backendStatusEl.querySelector('.status-dot');
    const statusValue = backendStatusEl.querySelector('.status-value');

    if (response && response.connected) {
      backendStatusEl.className = 'status-row connected';
      statusDot.className = 'status-dot green';
      statusValue.textContent = 'Connected';
    } else {
      backendStatusEl.className = 'status-row disconnected';
      statusDot.className = 'status-dot red';
      statusValue.textContent = 'Disconnected';
    }

    // Update Puppeteer status if available
    if (response && response.puppeteerStatus) {
      const ps = response.puppeteerStatus;

      if (ps.running) {
        autoStatusEl.classList.add('active');
        startAutoBtn.textContent = 'Running...';
        startAutoBtn.disabled = true;

        if (ps.progress) {
          autoProgressEl.textContent = `${ps.progress.current}/${ps.progress.total}`;
        }

        if (ps.currentUrl) {
          autoCurrentUrlEl.textContent = ps.currentUrl.slice(0, 50) + '...';
        }

        if (ps.lastExtracted && ps.lastExtracted.length > 0) {
          extractedListEl.innerHTML = ps.lastExtracted
            .map(name => `<div class="extracted-item">${name}</div>`)
            .join('');
        }
      } else {
        autoStatusEl.classList.remove('active');
        startAutoBtn.textContent = 'Start Auto Crawl';
        startAutoBtn.disabled = false;
      }
    }

    // Update queue stats if available
    if (response && response.queueStats) {
      const stats = response.queueStats;
      const pending = stats.find(s => s.status === 'pending')?.count || 0;
      const completed = stats.find(s => s.status === 'completed')?.count || 0;
      document.getElementById('queuePending').textContent = pending;
      document.getElementById('queueCompleted').textContent = completed;

      // Show queue status if there's anything in the queue
      if (pending > 0 || completed > 0) {
        queueStatusEl.style.display = 'flex';
      }
    }
  }

  // Check connection status
  function checkStatus() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, updateStatus);
  }

  // Initial status check
  checkStatus();

  // Periodic status updates
  setInterval(checkStatus, 3000);

  // Mode switching
  manualModeBtn.addEventListener('click', () => {
    currentMode = 'manual';
    manualModeBtn.classList.add('active');
    autoModeBtn.classList.remove('active');
    manualControlsEl.style.display = 'block';
  });

  autoModeBtn.addEventListener('click', () => {
    currentMode = 'auto';
    autoModeBtn.classList.add('active');
    manualModeBtn.classList.remove('active');
    // Show auto mode controls
    startAutoBtn.style.display = 'block';
    queueStatusEl.style.display = 'flex';
  });

  // Start auto crawl
  startAutoBtn.addEventListener('click', () => {
    startAutoBtn.textContent = 'Starting...';
    startAutoBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'START_AUTO_MODE' }, (response) => {
      if (response && response.success) {
        startAutoBtn.textContent = 'Running...';
      } else {
        startAutoBtn.textContent = 'Start Auto Crawl';
        startAutoBtn.disabled = false;
        resultEl.textContent = 'Failed to start auto mode. Make sure Chrome is started with --remote-debugging-port=9222';
        resultEl.classList.add('visible');
      }
    });
  });

  // Extract button click (Manual Mode)
  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting...';
    resultEl.textContent = '';
    resultEl.classList.remove('visible');
    sendToBackendBtn.style.display = 'none';

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Check if on QCC
      if (!tab.url.includes('qcc.com') && !tab.url.includes('qichacha.com')) {
        resultEl.textContent = 'Error: Navigate to QCC first (qcc.com or qichacha.com)';
        resultEl.classList.add('visible');
        return;
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_DATA' });

      if (response && response.success) {
        lastExtractedData = response.data;

        // Show RAW JSON for debugging (temporarily)
        resultEl.textContent = JSON.stringify(response.data, null, 2);
        resultEl.classList.add('visible');

        // Show copy, send, and report buttons
        copyBtn.style.display = 'block';
        sendToBackendBtn.style.display = 'block';
        generateReportBtn.style.display = 'block';
        generateReportBtn.dataset.url = response.data.sourceUrl;
        generateReportBtn.dataset.type = response.data.pageType;

        // Auto-send to backend if connected
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
          if (status && status.connected) {
            sendToBackend(response.data);
          }
        });
      } else {
        resultEl.textContent = 'Error: ' + (response?.error || 'Extraction failed');
        resultEl.classList.add('visible');
      }
    } catch (error) {
      resultEl.textContent = 'Error: ' + error.message + '\n\nTip: Try refreshing the QCC page.';
      resultEl.classList.add('visible');
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract Company Data';
    }
  });

  // Copy JSON button
  copyBtn.addEventListener('click', async () => {
    if (lastExtractedData) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(lastExtractedData, null, 2));
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy JSON';
        }, 1500);
      } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = JSON.stringify(lastExtractedData, null, 2);
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy JSON';
        }, 1500);
      }
    }
  });

  // Send to backend button
  sendToBackendBtn.addEventListener('click', () => {
    if (lastExtractedData) {
      sendToBackend(lastExtractedData);
    }
  });

  // Generate report button
  generateReportBtn.addEventListener('click', async () => {
    const url = generateReportBtn.dataset.url;
    const pageType = generateReportBtn.dataset.type;

    if (!url) {
      resultEl.textContent = 'Error: No URL to generate report for';
      resultEl.classList.add('visible');
      return;
    }

    generateReportBtn.textContent = 'Generating...';
    generateReportBtn.disabled = true;

    try {
      const endpoint = pageType === 'person_profile'
        ? 'http://localhost:8080/api/report/person'
        : 'http://localhost:8080/api/report/company';

      const response = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`);
      const result = await response.json();

      if (result.success) {
        generateReportBtn.textContent = 'Report Saved!';
        resultEl.textContent = `Report saved to:\n${result.path}`;
        resultEl.classList.add('visible');
      } else {
        generateReportBtn.textContent = 'Failed';
        resultEl.textContent = `Error: ${result.error}`;
        resultEl.classList.add('visible');
      }
    } catch (error) {
      generateReportBtn.textContent = 'Error';
      resultEl.textContent = `Error: ${error.message}\n\nMake sure the backend is running.`;
      resultEl.classList.add('visible');
    }

    setTimeout(() => {
      generateReportBtn.textContent = 'Generate Report';
      generateReportBtn.disabled = false;
    }, 3000);
  });

  // Take over from Puppeteer
  takeOverBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TAKE_OVER' }, (response) => {
      if (response && response.success) {
        autoStatusEl.classList.remove('active');
      }
    });
  });

  // Stop auto mode
  stopAutoBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_AUTO_MODE' }, (response) => {
      if (response && response.success) {
        autoStatusEl.classList.remove('active');
      }
    });
  });

  // Send data to backend
  function sendToBackend(data) {
    chrome.runtime.sendMessage({
      type: 'EXTRACTED_DATA',
      data: data
    }, (response) => {
      if (response && response.sentToBackend) {
        sendToBackendBtn.textContent = 'Sent!';
        sendToBackendBtn.disabled = true;
        setTimeout(() => {
          sendToBackendBtn.textContent = 'Send to Backend';
          sendToBackendBtn.disabled = false;
        }, 2000);
      } else {
        sendToBackendBtn.textContent = 'Failed (offline)';
        setTimeout(() => {
          sendToBackendBtn.textContent = 'Send to Backend';
        }, 2000);
      }
    });
  }

  // Format extracted data summary
  function formatExtractedSummary(data) {
    if (data.pageType === 'search_results') {
      return `Search Results\n` +
        `Found: ${data.resultCount} companies\n` +
        `URL: ${data.sourceUrl}\n\n` +
        data.results.slice(0, 5).map(r => `- ${r.companyName}`).join('\n') +
        (data.resultCount > 5 ? `\n... and ${data.resultCount - 5} more` : '');
    }

    // Company profile
    const lines = [];
    lines.push(`Company Profile`);
    lines.push(`─────────────────`);

    if (data.companyName) lines.push(`Name: ${data.companyName}`);
    if (data.jurisdiction) lines.push(`Jurisdiction: ${data.jurisdiction}`);
    if (data.status) lines.push(`Status: ${data.status}`);
    if (data.establishedDate) lines.push(`Established: ${data.establishedDate}`);
    if (data.companyNumber) lines.push(`Company #: ${data.companyNumber}`);
    if (data.businessRegNumber) lines.push(`BR #: ${data.businessRegNumber}`);

    if (data.shareholders && data.shareholders.length > 0) {
      lines.push(`\nShareholders: ${data.shareholders.length}`);
      data.shareholders.slice(0, 3).forEach(s => {
        lines.push(`  - ${s.name}${s.percentage ? ` (${s.percentage})` : ''}`);
      });
    }

    if (data.directors && data.directors.length > 0) {
      lines.push(`\nDirectors: ${data.directors.length}`);
      data.directors.slice(0, 3).forEach(d => {
        lines.push(`  - ${d.name}${d.position ? ` (${d.position})` : ''}`);
      });
    }

    if (data.legalCases) lines.push(`\nLegal Cases: ${data.legalCases}`);
    if (data.businessRisks) lines.push(`Business Risks: ${data.businessRisks}`);

    if (data._linkedProfiles && data._linkedProfiles.length > 0) {
      lines.push(`\nLinked Profiles: ${data._linkedProfiles.length}`);
    }

    return lines.join('\n');
  }
});
