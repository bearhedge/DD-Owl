/**
 * Person Research Orchestrator
 *
 * Coordinates the full DD research flow for a person:
 * 1. Extract all affiliations from person profile page
 * 2. Visit each affiliated company
 * 3. Find the person and get appointment dates
 * 4. Combine all data
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import { WebSocket } from 'ws';
import {
  createSession,
  getActiveSession,
  updateSession,
  setAffiliations,
  addCompanyDetail,
  addCompanyError,
  completeSession,
  failSession,
  PersonAffiliation,
  CompanyDetail,
} from './research-session.js';

let browser: Browser | null = null;
let page: Page | null = null;
let isRunning = false;
let shouldStop = false;
let wsConnection: WebSocket | null = null;

// Message handler for extension responses
let pendingResponse: ((data: any) => void) | null = null;
let responseTimeout: NodeJS.Timeout | null = null;

export function setResearchWsConnection(ws: WebSocket): void {
  wsConnection = ws;
}

export function handleExtensionResponse(data: any): void {
  if (pendingResponse) {
    if (responseTimeout) clearTimeout(responseTimeout);
    pendingResponse(data);
    pendingResponse = null;
    responseTimeout = null;
  }
}

async function sendToExtension(message: any, timeoutMs: number = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }

    pendingResponse = resolve;
    responseTimeout = setTimeout(() => {
      pendingResponse = null;
      reject(new Error('Extension response timeout'));
    }, timeoutMs);

    wsConnection.send(JSON.stringify({
      ...message,
      timestamp: new Date().toISOString(),
    }));
  });
}

function broadcastProgress(): void {
  const session = getActiveSession();
  if (!session || !wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;

  wsConnection.send(JSON.stringify({
    type: 'RESEARCH_PROGRESS',
    data: {
      sessionId: session.id,
      subjectName: session.subjectName,
      status: session.status,
      currentStep: session.currentStep,
      progress: session.progress,
    },
    timestamp: new Date().toISOString(),
  }));
}

export async function connectToChrome(debugPort: number = 9222): Promise<boolean> {
  try {
    browser = await puppeteer.connect({
      browserURL: `http://localhost:${debugPort}`,
      defaultViewport: null,
    });

    const pages = await browser.pages();
    page = pages.find(p => p.url().includes('qcc.com')) || pages[0];

    console.log('Connected to Chrome for research, current page:', page?.url());
    return true;
  } catch (error) {
    console.error('Failed to connect to Chrome:', error);
    return false;
  }
}

export async function startPersonResearch(personName: string, personUrl: string): Promise<void> {
  if (isRunning) {
    console.log('Research already in progress');
    return;
  }

  shouldStop = false;
  isRunning = true;

  // Create session
  const session = createSession(personName, personUrl);
  console.log(`Starting research on: ${personName}`);
  console.log(`Session ID: ${session.id}`);

  try {
    // Step 1: Connect to Chrome
    updateSession({
      status: 'extracting_affiliations',
      currentStep: 'Connecting to Chrome...',
    });
    broadcastProgress();

    if (!browser) {
      const connected = await connectToChrome();
      if (!connected) {
        throw new Error('Failed to connect to Chrome. Start with --remote-debugging-port=9222');
      }
    }

    // Step 2: Navigate to person profile
    updateSession({ currentStep: 'Navigating to person profile...' });
    broadcastProgress();

    await page!.goto(personUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Step 3: Extract affiliations from both tabs (current + historical)
    updateSession({ currentStep: 'Extracting current affiliations...' });
    broadcastProgress();

    const allAffiliations: PersonAffiliation[] = [];

    // Extract current affiliations
    const currentData = await sendToExtension({
      type: 'EXTRACT_AFFILIATIONS',
      data: { tab: 'current' },
    });

    if (currentData.affiliations) {
      for (const aff of currentData.affiliations) {
        allAffiliations.push({ ...aff, isCurrent: true });
      }
    }

    // Switch to historical tab and extract
    updateSession({ currentStep: 'Extracting historical affiliations...' });
    broadcastProgress();

    await sendToExtension({
      type: 'SWITCH_TAB',
      data: { tab: 'historical' },
    });

    await new Promise(r => setTimeout(r, 1500));

    const historicalData = await sendToExtension({
      type: 'EXTRACT_AFFILIATIONS',
      data: { tab: 'historical' },
    });

    if (historicalData.affiliations) {
      for (const aff of historicalData.affiliations) {
        allAffiliations.push({ ...aff, isCurrent: false });
      }
    }

    setAffiliations(allAffiliations);
    console.log(`Found ${allAffiliations.length} affiliations (${allAffiliations.filter(a => a.isCurrent).length} current, ${allAffiliations.filter(a => !a.isCurrent).length} historical)`);

    // Step 4: Visit each company page
    updateSession({
      status: 'crawling_companies',
      currentStep: 'Starting company crawl...',
    });
    broadcastProgress();

    for (let i = 0; i < allAffiliations.length; i++) {
      if (shouldStop) {
        console.log('Research stopped by user');
        break;
      }

      const affiliation = allAffiliations[i];
      const progress = `(${i + 1}/${allAffiliations.length})`;

      updateSession({
        currentStep: `${progress} Visiting: ${affiliation.companyName}`,
      });
      broadcastProgress();

      try {
        // Navigate to company page
        await page!.goto(affiliation.companyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        // Get company basic info (registration number)
        const companyBasic = await sendToExtension({
          type: 'GET_COMPANY_BASIC',
        });

        // Find the person and get their roles/dates
        const personData = await sendToExtension({
          type: 'FIND_PERSON_IN_COMPANY',
          data: { personName },
        });

        const companyDetail: CompanyDetail = {
          companyName: affiliation.companyName,
          companyUrl: affiliation.companyUrl,
          registrationNumber: companyBasic.data?.registrationNumber || personData.data?.registrationNumber || '',
          roles: personData.data?.roles || [{
            role: affiliation.role,
            percentage: affiliation.shareholdingPercent,
          }],
        };

        addCompanyDetail(affiliation.companyUrl, companyDetail);
        console.log(`  ✓ ${affiliation.companyName}: ${companyDetail.registrationNumber}`);

      } catch (error: any) {
        console.error(`  ✗ ${affiliation.companyName}: ${error.message}`);
        addCompanyError(affiliation.companyName, error.message);
      }

      // Rate limiting delay
      await new Promise(r => setTimeout(r, 1500));
    }

    // Step 5: Complete
    completeSession();
    broadcastProgress();

    console.log('Research complete!');
    console.log(`Successful: ${getActiveSession()?.progress.companiesCompleted}`);
    console.log(`Failed: ${getActiveSession()?.progress.companiesFailed}`);

  } catch (error: any) {
    console.error('Research failed:', error);
    failSession(error.message);
    broadcastProgress();
  } finally {
    isRunning = false;
  }
}

export function stopPersonResearch(): void {
  console.log('Stopping research...');
  shouldStop = true;
}

export function getResearchStatus(): {
  running: boolean;
  connected: boolean;
  session: any;
} {
  return {
    running: isRunning,
    connected: !!browser,
    session: getActiveSession() ? {
      id: getActiveSession()!.id,
      subjectName: getActiveSession()!.subjectName,
      status: getActiveSession()!.status,
      currentStep: getActiveSession()!.currentStep,
      progress: getActiveSession()!.progress,
    } : null,
  };
}

export async function disconnectResearch(): Promise<void> {
  shouldStop = true;
  isRunning = false;

  if (browser) {
    await browser.disconnect();
    browser = null;
    page = null;
  }
}
