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
