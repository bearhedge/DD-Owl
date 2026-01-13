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
  const resultContentEl = document.getElementById('resultContent');
  const copyIconBtn = document.getElementById('copyIconBtn');
  const getFullDetailsBtn = document.getElementById('getFullDetailsBtn');
  const researchStatusEl = document.getElementById('researchStatus');
  const researchSubjectEl = document.getElementById('researchSubject');
  const researchStepEl = document.getElementById('researchStep');
  const researchProgressEl = document.getElementById('researchProgress');
  const researchProgressBarEl = document.getElementById('researchProgressBar');
  const stopResearchBtn = document.getElementById('stopResearchBtn');

  // AI Agent elements
  const agentStatusEl = document.getElementById('agentStatus');
  const agentStateEl = document.getElementById('agentState');
  const agentTaskEl = document.getElementById('agentTask');
  const agentStepEl = document.getElementById('agentStep');
  const toolCallsEl = document.getElementById('toolCalls');
  const stopAgentBtn = document.getElementById('stopAgentBtn');

  // Auto-Research elements (extension-based, no Puppeteer)
  const researchAllBtn = document.getElementById('researchAllBtn');
  const autoResearchStatusEl = document.getElementById('autoResearchStatus');
  const autoResearchPersonEl = document.getElementById('autoResearchPerson');
  const autoResearchCompanyEl = document.getElementById('autoResearchCompany');
  const autoResearchCountEl = document.getElementById('autoResearchCount');
  const autoResearchProgressBarEl = document.getElementById('autoResearchProgressBar');
  const stopAutoResearchBtn = document.getElementById('stopAutoResearchBtn');

  let currentMode = 'manual';
  let lastExtractedData = null;
  let agentTaskId = null;

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

    // Update research status if available
    if (response && response.researchStatus && response.researchStatus.status) {
      const rs = response.researchStatus;
      researchStatusEl.classList.add('active');
      researchSubjectEl.textContent = rs.subjectName || '-';
      researchStepEl.textContent = rs.currentStep || 'Processing...';

      if (rs.progress) {
        const { companiesCompleted, companiesTotal } = rs.progress;
        researchProgressEl.textContent = `${companiesCompleted} / ${companiesTotal} companies`;
        const pct = companiesTotal > 0 ? (companiesCompleted / companiesTotal) * 100 : 0;
        researchProgressBarEl.style.width = `${pct}%`;
      }

      if (rs.status === 'completed') {
        researchStepEl.textContent = 'Research complete!';
        researchProgressBarEl.style.width = '100%';
      }
    } else {
      researchStatusEl.classList.remove('active');
    }

    // Update AI agent status if available
    if (response && response.agentStatus) {
      updateAgentStatus(response.agentStatus);
    }

    // Update auto-research status (extension-based)
    if (response && response.autoResearchStatus) {
      updateAutoResearchStatus(response.autoResearchStatus);
    }
  }

  // Update auto-research status UI
  function updateAutoResearchStatus(status) {
    if (!status || !status.running) {
      autoResearchStatusEl.classList.remove('active');
      return;
    }

    autoResearchStatusEl.classList.add('active');
    autoResearchPersonEl.textContent = status.personName || '-';
    autoResearchCompanyEl.textContent = status.currentCompany ?
      `Currently: ${status.currentCompany}` : 'Preparing...';
    autoResearchCountEl.textContent = `${status.completedCount || 0} / ${status.totalCompanies || 0} companies`;

    const pct = status.totalCompanies > 0 ?
      ((status.completedCount || 0) / status.totalCompanies) * 100 : 0;
    autoResearchProgressBarEl.style.width = `${pct}%`;
  }

  // Update AI agent status UI
  function updateAgentStatus(status) {
    if (!status || !status.taskId) {
      agentStatusEl.classList.remove('active');
      return;
    }

    agentStatusEl.classList.add('active');
    agentTaskId = status.taskId;

    // Update state badge
    agentStateEl.textContent = status.status || 'running';
    agentStateEl.className = 'agent-state ' + (status.status || 'running');

    // Update current step
    agentStepEl.textContent = status.currentStep || '-';

    // Show stop button if running
    stopAgentBtn.style.display = status.status === 'running' ? 'block' : 'none';

    // Update tool calls list
    if (status.toolCalls && status.toolCalls.length > 0) {
      toolCallsEl.innerHTML = status.toolCalls.map(tc => `
        <div class="tool-call">
          <span class="tool-icon ${tc.status}"></span>
          <span class="tool-name">${tc.tool}</span>
        </div>
        ${tc.observation ? `<div class="tool-observation">${tc.observation.slice(0, 50)}...</div>` : ''}
      `).join('');

      // Auto-scroll to bottom
      toolCallsEl.scrollTop = toolCallsEl.scrollHeight;
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
        resultContentEl.textContent = 'Failed to start auto mode. Make sure Chrome is started with --remote-debugging-port=9222';
        resultEl.classList.add('visible');
      }
    });
  });

  // Extract button click (Manual Mode)
  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting...';
    resultContentEl.textContent = '';
    resultEl.classList.remove('visible');
    sendToBackendBtn.style.display = 'none';

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Check if on supported site
      if (!tab.url.includes('qcc.com') && !tab.url.includes('qichacha.com') && !tab.url.includes('tianyancha.com')) {
        resultContentEl.textContent = 'Error: Navigate to QCC or Tianyancha first';
        resultEl.classList.add('visible');
        return;
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_DATA' });

      if (response && response.success) {
        lastExtractedData = response.data;
        const currentCount = response.data.currentAffiliations?.length || 0;
        const historicalCount = response.data.historicalAffiliations?.length || 0;

        // Show extraction complete
        extractBtn.textContent = 'Generating report...';
        resultContentEl.textContent = `Extracted: ${currentCount} current, ${historicalCount} historical affiliations\n\nSending to backend...`;
        resultEl.classList.add('visible');

        // Send to backend to generate Word report
        try {
          const reportResponse = await fetch('http://localhost:8080/api/dd/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response.data)
          });
          const reportResult = await reportResponse.json();

          if (reportResult.success) {
            resultContentEl.textContent = `Complete!\n\n${currentCount} current, ${historicalCount} historical affiliations\n\nReport ready:`;

            // Show download link
            const linkEl = document.createElement('a');
            linkEl.href = `http://localhost:8080${reportResult.reportUrl}`;
            linkEl.textContent = reportResult.filename;
            linkEl.target = '_blank';
            linkEl.style.display = 'block';
            linkEl.style.marginTop = '8px';
            linkEl.style.color = '#007bff';
            resultContentEl.appendChild(linkEl);
          } else {
            resultContentEl.textContent = `Extracted ${currentCount} current, ${historicalCount} historical\n\nBackend error: ${reportResult.error}`;
          }
        } catch (fetchError) {
          resultContentEl.textContent = `Extracted ${currentCount} current, ${historicalCount} historical\n\nBackend offline - cannot generate report`;
        }

        // Show copy button for raw JSON
        copyBtn.style.display = 'block';
      } else {
        resultContentEl.textContent = 'Error: ' + (response?.error || 'Extraction failed');
        resultEl.classList.add('visible');
      }
    } catch (error) {
      resultContentEl.textContent = 'Error: ' + error.message + '\n\nTip: Try refreshing the page.';
      resultEl.classList.add('visible');
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract Data';
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

  // Copy icon button (at top of result area)
  copyIconBtn.addEventListener('click', async () => {
    if (lastExtractedData) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(lastExtractedData, null, 2));
        copyIconBtn.textContent = '\u2713';
        setTimeout(() => {
          copyIconBtn.innerHTML = '&#x2398;';
        }, 1500);
      } catch (err) {
        const textArea = document.createElement('textarea');
        textArea.value = JSON.stringify(lastExtractedData, null, 2);
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        copyIconBtn.textContent = '\u2713';
        setTimeout(() => {
          copyIconBtn.innerHTML = '&#x2398;';
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
      resultContentEl.textContent = 'Error: No URL to generate report for';
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
        resultContentEl.textContent = `Report saved to:\n${result.path}`;
        resultEl.classList.add('visible');
      } else {
        generateReportBtn.textContent = 'Failed';
        resultContentEl.textContent = `Error: ${result.error}`;
        resultEl.classList.add('visible');
      }
    } catch (error) {
      generateReportBtn.textContent = 'Error';
      resultContentEl.textContent = `Error: ${error.message}\n\nMake sure the backend is running.`;
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

  // Get Full Details button - starts AI agent for person research
  getFullDetailsBtn.addEventListener('click', () => {
    const personName = getFullDetailsBtn.dataset.personName;
    const personUrl = getFullDetailsBtn.dataset.personUrl;

    if (!personName || !personUrl) {
      resultContentEl.textContent = 'Error: Extract data first to get person info';
      resultEl.classList.add('visible');
      return;
    }

    getFullDetailsBtn.textContent = 'Starting AI Agent...';
    getFullDetailsBtn.disabled = true;

    // Start AI agent via backend
    chrome.runtime.sendMessage({
      type: 'START_AI_AGENT',
      task: `Research ${personName} and create a DD report. Their QCC profile is at: ${personUrl}`
    }, (response) => {
      if (response && response.success) {
        agentStatusEl.classList.add('active');
        agentTaskEl.textContent = `Researching: ${personName}`;
        agentStepEl.textContent = 'Initializing...';
        agentStateEl.textContent = 'running';
        agentStateEl.className = 'agent-state running';
        stopAgentBtn.style.display = 'block';

        resultContentEl.textContent = `Started AI Agent for: ${personName}\n\nThe agent will autonomously gather all company affiliations, registration numbers, and appointment dates.`;
        resultEl.classList.add('visible');
      } else {
        resultContentEl.textContent = 'Error: Failed to start AI agent. Make sure backend is connected and Chrome is started with --remote-debugging-port=9222';
        resultEl.classList.add('visible');
      }

      getFullDetailsBtn.textContent = 'Get Full Details (AI Agent)';
      getFullDetailsBtn.disabled = false;
    });
  });

  // Stop research button
  stopResearchBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_PERSON_RESEARCH' }, (response) => {
      if (response && response.success) {
        researchStatusEl.classList.remove('active');
        resultContentEl.textContent = 'Research stopped by user';
        resultEl.classList.add('visible');
      }
    });
  });

  // Stop AI agent button
  stopAgentBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_AI_AGENT' }, (response) => {
      if (response && response.success) {
        agentStatusEl.classList.remove('active');
        stopAgentBtn.style.display = 'none';
        resultContentEl.textContent = 'AI Agent stopped by user';
        resultEl.classList.add('visible');
      }
    });
  });

  // Research All Companies button (extension-based, no Puppeteer)
  researchAllBtn.addEventListener('click', async () => {
    const personName = researchAllBtn.dataset.personName;

    researchAllBtn.textContent = 'Getting company URLs...';
    researchAllBtn.disabled = true;

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Request company URLs from content script
      const urlResponse = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_COMPANY_URLS' });

      if (!urlResponse || !urlResponse.success) {
        throw new Error(urlResponse?.error || 'Failed to extract company URLs');
      }

      const companies = urlResponse.companies;
      if (companies.length === 0) {
        throw new Error('No company URLs found on this page');
      }

      resultContentEl.textContent = `Found ${companies.length} companies. Starting auto-research...\n\n` +
        `This will open each company in a new tab with 5-10 second delays between each to avoid detection.\n\n` +
        `You can continue working - tabs open in background.`;
      resultEl.classList.add('visible');

      // Start auto-research
      chrome.runtime.sendMessage({
        type: 'START_AUTO_RESEARCH',
        personName: urlResponse.personName || personName,
        companies: companies
      }, (response) => {
        if (response && response.success) {
          // Show progress UI
          autoResearchStatusEl.classList.add('active');
          autoResearchPersonEl.textContent = urlResponse.personName || personName;
          autoResearchCountEl.textContent = `0 / ${companies.length} companies`;
          autoResearchProgressBarEl.style.width = '0%';

          resultContentEl.textContent = `Auto-research started for ${companies.length} companies.\n\n` +
            `Random delays of 5-10 seconds between each company to appear human.`;
        } else {
          resultContentEl.textContent = `Error: ${response?.error || 'Failed to start auto-research'}`;
        }
      });

    } catch (error) {
      resultContentEl.textContent = `Error: ${error.message}`;
      resultEl.classList.add('visible');
    } finally {
      researchAllBtn.textContent = 'Research All Companies';
      researchAllBtn.disabled = false;
    }
  });

  // Stop auto-research button
  stopAutoResearchBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_AUTO_RESEARCH' }, (response) => {
      if (response && response.success) {
        autoResearchStatusEl.classList.remove('active');
        resultContentEl.textContent = `Auto-research stopped.\n\nCompleted: ${response.results?.length || 0} companies`;
        resultEl.classList.add('visible');
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
