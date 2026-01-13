/**
 * WebSocket Server for DD Owl Extension Communication
 *
 * Handles bidirectional communication between:
 * - Chrome Extension (extraction, status display)
 * - Puppeteer Navigator (automation commands)
 * - Backend (data storage, job management)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import {
  WSMessage,
  QCCCompanyProfile,
  QCCSearchResponse,
  PuppeteerStatusMessage,
} from './qcc-types.js';
import { savePerson, saveCompany, queueUrl, getQueueStats } from './database.js';
import { connectToChrome, startCrawling, stopCrawling, getCrawlerStatus, setWsConnection } from './crawler.js';
import {
  startPersonResearch,
  stopPersonResearch,
  getResearchStatus,
  setResearchWsConnection,
  handleExtensionResponse,
} from './person-research.js';
import { getSessionStatus, getSessionResults, clearSession } from './research-session.js';
import { runAgent, DDOwlAgent } from './agent/orchestrator.js';
import { getBrowserBridge } from './agent/browser-bridge.js';

interface ExtensionClient {
  ws: WebSocket;
  tabId?: number;
  url?: string;
}

interface PuppeteerState {
  running: boolean;
  currentUrl?: string;
  progress?: { current: number; total: number };
  lastExtracted: string[];
}

export class DDOwlWSServer {
  private wss: WebSocketServer;
  private extensionClients: Map<WebSocket, ExtensionClient> = new Map();
  private puppeteerState: PuppeteerState = {
    running: false,
    lastExtracted: [],
  };
  private extractedData: (QCCCompanyProfile | QCCSearchResponse)[] = [];
  private currentAgent: DDOwlAgent | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupHandlers();
    console.log('WebSocket server initialized on /ws');
  }

  private setupHandlers(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New WebSocket connection');

      this.extensionClients.set(ws, { ws });

      ws.on('message', (data: Buffer) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
        this.extensionClients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.extensionClients.delete(ws);
      });

      // Send initial status
      this.sendToClient(ws, {
        type: 'STATUS_RESPONSE',
        data: {
          connected: true,
          puppeteerRunning: this.puppeteerState.running,
          extractedCount: this.extractedData.length,
        },
      });
    });
  }

  private handleMessage(ws: WebSocket, message: WSMessage): void {
    console.log('Received message:', message.type);

    switch (message.type) {
      case 'GET_STATUS':
        const crawlerStatus = getCrawlerStatus();
        this.sendToClient(ws, {
          type: 'STATUS_RESPONSE',
          data: {
            connected: true,
            puppeteerRunning: crawlerStatus.running,
            puppeteerConnected: crawlerStatus.connected,
            currentUrl: crawlerStatus.currentUrl,
            extractedCount: this.extractedData.length,
            lastExtracted: this.puppeteerState.lastExtracted.slice(-5),
            queueStats: getQueueStats(),
          },
        });
        break;

      case 'EXTRACTED_DATA':
        this.handleExtractedData(ws, message.data);
        break;

      case 'START_AUTO_MODE':
        this.startAutoMode(message.data);
        break;

      case 'STOP_AUTO_MODE':
        this.stopAutoMode();
        break;

      case 'TAKE_OVER':
        this.handleTakeOver();
        break;

      // Person research handlers
      case 'START_PERSON_RESEARCH':
        this.handleStartResearch(ws, message.data);
        break;

      case 'STOP_PERSON_RESEARCH':
        this.handleStopResearch();
        break;

      case 'GET_RESEARCH_STATUS':
        this.sendToClient(ws, {
          type: 'RESEARCH_STATUS_RESPONSE',
          data: {
            ...getResearchStatus(),
            sessionDetails: getSessionStatus(),
          },
        });
        break;

      case 'GET_RESEARCH_RESULTS':
        this.sendToClient(ws, {
          type: 'RESEARCH_RESULTS_RESPONSE',
          data: getSessionResults(),
        });
        break;

      case 'CLEAR_RESEARCH_SESSION':
        clearSession();
        this.sendToClient(ws, {
          type: 'SESSION_CLEARED',
          data: { success: true },
        });
        break;

      // Extension response (for FIND_PERSON_IN_COMPANY, GET_COMPANY_BASIC, etc.)
      case 'EXTENSION_RESPONSE':
        handleExtensionResponse(message.data);
        break;

      // AI Agent handlers
      case 'START_AI_AGENT':
        this.handleStartAgent(ws, message.data);
        break;

      case 'STOP_AI_AGENT':
        this.handleStopAgent();
        break;

      // Tool execution from agent (forwarded to extension)
      case 'TOOL_EXECUTION':
        // Forward to extension and wait for response
        this.forwardToExtension(message);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  private handleExtractedData(ws: WebSocket, data: any): void {
    console.log('Received extracted data:', data.sourceUrl);

    // Store the data in memory
    this.extractedData.push(data);

    // Save to SQLite database and queue linked profiles
    try {
      if (data.pageType === 'person_profile') {
        savePerson(data);
        console.log('Saved person to database:', data.personName);
        // Queue all affiliated companies
        data.companies?.forEach((c: any) => {
          if (c.profileUrl) {
            queueUrl(c.profileUrl, 'company', data.sourceUrl);
          }
        });
      } else if (data.pageType === 'company_profile') {
        saveCompany(data);
        console.log('Saved company to database:', data.companyName);
        // Queue linked profiles (shareholders, directors, investments)
        data.linkedProfiles?.forEach((p: any) => {
          if (p.url) {
            queueUrl(p.url, p.type === 'person' ? 'person' : 'company', data.sourceUrl);
          }
        });
      }
    } catch (error) {
      console.error('Database save error:', error);
    }

    // Track company/person name for UI
    if ('companyName' in data && data.companyName) {
      this.puppeteerState.lastExtracted.push(data.companyName);
    } else if ('personName' in data && data.personName) {
      this.puppeteerState.lastExtracted.push(data.personName);
    }
    // Keep only last 20
    if (this.puppeteerState.lastExtracted.length > 20) {
      this.puppeteerState.lastExtracted.shift();
    }

    // Acknowledge receipt with queue stats
    this.sendToClient(ws, {
      type: 'EXTRACTION_ACK',
      data: {
        success: true,
        totalExtracted: this.extractedData.length,
        message: `Saved ${data.pageType}`,
        queueStats: getQueueStats(),
      },
    });

    // Broadcast update to all clients
    this.broadcastPuppeteerStatus();
  }

  private async startAutoMode(config: any): Promise<void> {
    console.log('Starting auto mode:', config);

    // Get first client's WebSocket for crawler to use
    const firstClient = this.extensionClients.values().next().value;
    if (firstClient) {
      setWsConnection(firstClient.ws);
    }

    // Connect to Chrome with remote debugging
    const connected = await connectToChrome();
    if (!connected) {
      this.broadcast({
        type: 'ERROR',
        data: { message: 'Failed to connect to Chrome. Start Chrome with: open -a "Google Chrome" --args --remote-debugging-port=9222' }
      });
      return;
    }

    this.puppeteerState.running = true;
    this.puppeteerState.currentUrl = config?.startUrl;
    this.puppeteerState.progress = { current: 0, total: config?.maxProfiles || 0 };

    this.broadcastPuppeteerStatus();
    this.broadcast({ type: 'AUTO_MODE_STARTED', data: { message: 'Crawler started' } });

    // Start crawling in background
    startCrawling().then(() => {
      this.puppeteerState.running = false;
      this.broadcastPuppeteerStatus();
      this.broadcast({ type: 'AUTO_MODE_STOPPED', data: { message: 'Crawl complete' } });
    });
  }

  private stopAutoMode(): void {
    console.log('Stopping auto mode');
    stopCrawling();
    this.puppeteerState.running = false;
    this.puppeteerState.currentUrl = undefined;

    this.broadcastPuppeteerStatus();
    this.broadcast({ type: 'AUTO_MODE_STOPPED', data: { message: 'Crawler stopped by user' } });
  }

  private handleTakeOver(): void {
    console.log('User taking over from Puppeteer');
    stopCrawling();
    this.puppeteerState.running = false;

    this.broadcastPuppeteerStatus();
    this.broadcast({ type: 'AUTO_MODE_STOPPED', data: { message: 'User took over' } });
  }

  private async handleStartResearch(ws: WebSocket, data: any): Promise<void> {
    const { personName, personUrl } = data;
    console.log('Starting person research:', personName);

    // Set the WebSocket connection for research orchestrator
    setResearchWsConnection(ws);

    this.sendToClient(ws, {
      type: 'RESEARCH_STARTED',
      data: { personName, personUrl },
    });

    // Start research in background
    startPersonResearch(personName, personUrl).then(() => {
      this.broadcast({
        type: 'RESEARCH_COMPLETED',
        data: getSessionResults(),
      });
    }).catch((error) => {
      this.broadcast({
        type: 'RESEARCH_FAILED',
        data: { error: error.message },
      });
    });
  }

  private handleStopResearch(): void {
    console.log('Stopping person research');
    stopPersonResearch();

    this.broadcast({
      type: 'RESEARCH_STOPPED',
      data: { message: 'Research stopped by user' },
    });
  }

  private async handleStartAgent(ws: WebSocket, data: any): Promise<void> {
    const { task } = data;
    console.log('Starting AI agent with task:', task);

    // Set WebSocket for browser bridge
    const browserBridge = getBrowserBridge();
    browserBridge.setWebSocket(ws);

    // Create agent with progress callback
    this.currentAgent = new DDOwlAgent({
      onProgress: (progress) => {
        this.broadcast({
          type: 'AGENT_PROGRESS',
          data: progress,
        });
      },
    });

    // Run agent in background
    runAgent(task, (progress) => {
      this.broadcast({
        type: 'AGENT_PROGRESS',
        data: progress,
      });
    }).then((result) => {
      this.currentAgent = null;
      this.broadcast({
        type: result.success ? 'AGENT_COMPLETED' : 'AGENT_FAILED',
        data: result,
      });
    }).catch((error) => {
      this.currentAgent = null;
      this.broadcast({
        type: 'AGENT_FAILED',
        data: { error: error.message },
      });
    });
  }

  private handleStopAgent(): void {
    console.log('Stopping AI agent');
    // Note: Currently no graceful stop mechanism - agent will complete current iteration
    this.currentAgent = null;

    this.broadcast({
      type: 'AGENT_FAILED',
      data: { error: 'Agent stopped by user' },
    });
  }

  private forwardToExtension(message: WSMessage): void {
    // Forward tool execution message to extension
    const firstClient = this.extensionClients.values().next().value;
    if (firstClient) {
      this.sendToClient(firstClient.ws, message);
    }
  }

  private broadcastPuppeteerStatus(): void {
    const statusMessage: PuppeteerStatusMessage = {
      type: 'PUPPETEER_STATUS',
      data: {
        running: this.puppeteerState.running,
        currentUrl: this.puppeteerState.currentUrl,
        progress: this.puppeteerState.progress,
        lastExtracted: this.puppeteerState.lastExtracted.slice(-5),
      },
    };

    this.broadcast(statusMessage);
  }

  private sendToClient(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  private broadcast(message: WSMessage): void {
    const payload = JSON.stringify({
      ...message,
      timestamp: new Date().toISOString(),
    });

    this.extensionClients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    });
  }

  // Public API for Puppeteer to report status
  public updatePuppeteerStatus(status: Partial<PuppeteerState>): void {
    Object.assign(this.puppeteerState, status);
    this.broadcastPuppeteerStatus();
  }

  // Public API to get extracted data
  public getExtractedData(): (QCCCompanyProfile | QCCSearchResponse)[] {
    return this.extractedData;
  }

  // Public API to clear extracted data
  public clearExtractedData(): void {
    this.extractedData = [];
    this.puppeteerState.lastExtracted = [];
  }
}

// Singleton for use across the application
let wsServerInstance: DDOwlWSServer | null = null;

export function initWSServer(server: Server): DDOwlWSServer {
  if (!wsServerInstance) {
    wsServerInstance = new DDOwlWSServer(server);
  }
  return wsServerInstance;
}

export function getWSServer(): DDOwlWSServer | null {
  return wsServerInstance;
}
