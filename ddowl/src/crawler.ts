import puppeteer, { Browser, Page } from 'puppeteer-core';
import { getNextInQueue, markQueueItem } from './database.js';
import { WebSocket } from 'ws';

let browser: Browser | null = null;
let page: Page | null = null;
let isRunning = false;
let wsConnection: WebSocket | null = null;

export async function connectToChrome(debugPort: number = 9222): Promise<boolean> {
  try {
    browser = await puppeteer.connect({
      browserURL: `http://localhost:${debugPort}`,
      defaultViewport: null
    });

    const pages = await browser.pages();
    page = pages.find(p => p.url().includes('qcc.com')) || pages[0];

    console.log('Connected to Chrome, current page:', page?.url());
    return true;
  } catch (error) {
    console.error('Failed to connect to Chrome:', error);
    return false;
  }
}

export function setWsConnection(ws: WebSocket): void {
  wsConnection = ws;
}

export async function startCrawling(): Promise<void> {
  if (isRunning) {
    console.log('Crawler already running');
    return;
  }

  if (!browser || !page) {
    console.log('Not connected to Chrome');
    return;
  }

  isRunning = true;
  console.log('Starting crawl...');

  while (isRunning) {
    const nextItem = getNextInQueue() as any;
    if (!nextItem) {
      console.log('Queue empty, stopping');
      break;
    }

    markQueueItem(nextItem.id, 'processing');
    console.log('Processing:', nextItem.url);

    try {
      // Navigate to URL
      await page.goto(nextItem.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000)); // Wait for dynamic content

      // Tell extension to extract via WebSocket
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify({
          type: 'NAVIGATE_TO',
          data: { url: nextItem.url },
          timestamp: new Date().toISOString()
        }));
      }

      // Wait for extraction (extension will send data back via WebSocket)
      await new Promise(r => setTimeout(r, 3000));

      // Handle pagination - keep extracting until no more pages
      let hasNextPage = true;
      let pageCount = 1;
      const maxPages = 10; // Safety limit

      while (hasNextPage && isRunning && pageCount < maxPages) {
        // Check if there's pagination and more pages
        const pagination = await page.evaluate(() => {
          const nextBtn = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)');
          return { hasNext: !!nextBtn };
        });

        if (pagination.hasNext) {
          console.log(`Clicking to page ${pageCount + 1}...`);
          await page.click('.ant-pagination-next');
          await new Promise(r => setTimeout(r, 2000));
          pageCount++;

          // Extract this page too
          if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            wsConnection.send(JSON.stringify({
              type: 'NAVIGATE_TO',
              data: { url: page.url() },
              timestamp: new Date().toISOString()
            }));
          }
          await new Promise(r => setTimeout(r, 3000));
        } else {
          hasNextPage = false;
        }
      }

      markQueueItem(nextItem.id, 'completed');
      console.log('Completed:', nextItem.url, `(${pageCount} pages)`);

    } catch (error) {
      console.error('Error processing:', nextItem.url, error);
      markQueueItem(nextItem.id, 'failed');
    }

    // Small delay between profiles to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  isRunning = false;
  console.log('Crawl finished');
}

export function stopCrawling(): void {
  console.log('Stopping crawler...');
  isRunning = false;
}

export function getCrawlerStatus(): { running: boolean; connected: boolean; currentUrl?: string } {
  return {
    running: isRunning,
    connected: !!browser,
    currentUrl: page?.url()
  };
}

export async function disconnectFromChrome(): Promise<void> {
  if (browser) {
    await browser.disconnect();
    browser = null;
    page = null;
  }
}
