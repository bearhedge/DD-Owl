/**
 * Browser Bridge
 *
 * Handles communication between the AI agent and Chrome extension.
 * Uses WebSocket to send commands and receive responses.
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import { WebSocket } from 'ws';
import { BrowserBridge } from './tools/types.js';

// Pending response handlers
type ResponseHandler = {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class ChromeBrowserBridge implements BrowserBridge {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private wsConnection: WebSocket | null = null;
  private pendingResponses: Map<string, ResponseHandler> = new Map();
  private messageCounter = 0;
  private connected = false;

  /**
   * Connect to Chrome with remote debugging
   */
  async connect(debugPort: number = 9222): Promise<boolean> {
    try {
      this.browser = await puppeteer.connect({
        browserURL: `http://localhost:${debugPort}`,
        defaultViewport: null,
      });

      const pages = await this.browser.pages();
      this.page = pages.find(p => p.url().includes('qcc.com')) || pages[0];

      console.log('Browser bridge connected to Chrome:', this.page?.url());
      this.connected = true;
      return true;
    } catch (error) {
      console.error('Failed to connect to Chrome:', error);
      this.connected = false;
      return false;
    }
  }

  /**
   * Set the WebSocket connection for extension communication
   */
  setWebSocket(ws: WebSocket): void {
    this.wsConnection = ws;

    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: any): void {
    // Check if this is a response to a pending request
    if (message.requestId && this.pendingResponses.has(message.requestId)) {
      const handler = this.pendingResponses.get(message.requestId)!;
      clearTimeout(handler.timeout);
      this.pendingResponses.delete(message.requestId);

      if (message.error) {
        handler.reject(new Error(message.error));
      } else {
        handler.resolve(message);
      }
    }
  }

  /**
   * Check if connected to Chrome
   */
  isConnected(): boolean {
    return this.connected && !!this.browser && !!this.page;
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('Not connected to Chrome');
    }

    await this.page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for dynamic content
    await new Promise(r => setTimeout(r, 2000));
  }

  /**
   * Send message to Chrome extension and wait for response
   */
  async sendToExtension(type: string, data?: any, timeoutMs: number = 15000): Promise<any> {
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const requestId = `req_${++this.messageCounter}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error(`Extension response timeout for ${type}`));
      }, timeoutMs);

      // Store handler
      this.pendingResponses.set(requestId, { resolve, reject, timeout });

      // Send message
      this.wsConnection!.send(JSON.stringify({
        type: 'TOOL_EXECUTION',
        requestId,
        toolMessage: { type, ...data },
        timestamp: new Date().toISOString(),
      }));
    });
  }

  /**
   * Get current page URL
   */
  async getCurrentUrl(): Promise<string> {
    if (!this.page) {
      throw new Error('Not connected to Chrome');
    }
    return this.page.url();
  }

  /**
   * Take a screenshot (for debugging)
   */
  async screenshot(): Promise<Buffer> {
    if (!this.page) {
      throw new Error('Not connected to Chrome');
    }
    return await this.page.screenshot() as Buffer;
  }

  /**
   * Disconnect from Chrome
   */
  async disconnect(): Promise<void> {
    this.connected = false;

    // Clear pending responses
    for (const [id, handler] of this.pendingResponses) {
      clearTimeout(handler.timeout);
      handler.reject(new Error('Bridge disconnected'));
    }
    this.pendingResponses.clear();

    if (this.browser) {
      await this.browser.disconnect();
      this.browser = null;
      this.page = null;
    }
  }
}

// Singleton instance
let bridgeInstance: ChromeBrowserBridge | null = null;

export function getBrowserBridge(): ChromeBrowserBridge {
  if (!bridgeInstance) {
    bridgeInstance = new ChromeBrowserBridge();
  }
  return bridgeInstance;
}

export function createBrowserBridge(): ChromeBrowserBridge {
  return new ChromeBrowserBridge();
}
