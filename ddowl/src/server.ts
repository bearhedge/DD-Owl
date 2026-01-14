import 'dotenv/config';

// Prevent unhandled promise rejections from crashing the server
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] Promise:', promise, 'Reason:', reason);
  // Don't exit - let the server continue running
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error);
  // Don't exit for non-fatal errors
  if (error.message?.includes('ECONNRESET') || error.message?.includes('ETIMEDOUT')) {
    console.log('[RECOVERY] Ignoring network error, continuing...');
    return;
  }
});

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { SEARCH_TEMPLATES, buildSearchQuery } from './searchStrings.js';
import { searchAllPages, searchAllEngines, SearchProgressCallback } from './searcher.js';
import { isBaiduAvailable } from './baiduSearcher.js';
import { fetchPageContent, analyzeWithLLM, closeBrowser, quickScan } from './analyzer.js';
import { triageSearchResults, TriageResult } from './triage.js';
import { consolidateFindings } from './consolidator.js';
import { generateFullReport } from './reportGenerator.js';
import { RawFinding, ConsolidatedFinding } from './types.js';
import { extractFinding, isSameFinding, mergeFindings, Finding } from './extract.js';
import { detectCategory } from './searchStrings.js';
import { DDOwlReport, DDOwlReportV2, Issue, AnalyzedResult } from './types.js';
import { ipoRouter } from './ipo-api.js';
import { initWSServer, getWSServer } from './ws-server.js';
import { getQueueStats } from './database.js';
import { generatePersonReport, generateCompanyReport, saveReport } from './report.js';
import { getSessionStatus, getSessionResults, clearSession } from './research-session.js';
import { getResearchStatus, startPersonResearch, stopPersonResearch } from './person-research.js';
import { generateWordReport } from './word-report.js';
import { loadHistory, markRunClean, getRunDiff } from './run-tracker.js';
import { validateDeals } from './validator.js';
import { initLogDirectories, saveScreeningLog as saveLog, loadScreeningLog as loadLog, listScreeningLogs, saveBenchmarkResult, loadBenchmarkResults } from './logging/storage.js';
import { MetricsTracker } from './metrics/tracker.js';
import { evaluateBenchmark, getBenchmarkCase } from './metrics/benchmarks.js';

// URL validation to filter out corrupted URLs (e.g., Baidu tracking URLs)
function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    // Must be http or https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Filter out known bad patterns
    if (url.includes('nourl.') || url.includes('.baidu.com/link')) return false;
    return true;
  } catch {
    return false;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize log directories
initLogDirectories();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// IPO Tracker API routes
app.use('/api/ipo', ipoRouter);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'ddowl' });
});

// Main screening endpoint with Server-Sent Events
app.get('/api/screen', async (req: Request, res: Response) => {
  const subjectName = req.query.name as string;

  if (!subjectName || subjectName.trim().length < 2) {
    res.status(400).json({ error: 'Please provide a valid name (2+ characters)' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const redFlags: AnalyzedResult[] = [];
    const amberFlags: AnalyzedResult[] = [];
    let greenCount = 0;
    let totalAnalyzed = 0;
    const seenUrls = new Set<string>();

    // Process each search template
    for (let i = 0; i < SEARCH_TEMPLATES.length; i++) {
      const template = SEARCH_TEMPLATES[i];
      const query = buildSearchQuery(template, subjectName);

      sendEvent({
        type: 'progress',
        searchIndex: i + 1,
        totalSearches: SEARCH_TEMPLATES.length,
        currentTerm: query.slice(0, 80),
      });

      // Search with pagination (Google + Baidu)
      const searchResults = await searchAllEngines(query, 5, 2);

      // Analyze each result
      for (const result of searchResults) {
        // Skip duplicates
        if (seenUrls.has(result.link)) continue;
        seenUrls.add(result.link);

        // Skip PDFs and other non-HTML content
        const lowerUrl = result.link.toLowerCase();
        if (lowerUrl.endsWith('.pdf') || lowerUrl.endsWith('.doc') || lowerUrl.endsWith('.docx')) {
          continue;
        }

        // Send fetch event
        sendEvent({
          type: 'fetch',
          url: result.link,
          title: result.title,
        });

        // Fetch page content with error handling
        let content = '';
        try {
          content = await fetchPageContent(result.link);
        } catch (fetchErr) {
          console.error(`Fetch failed for ${result.link}:`, fetchErr);
          continue;
        }

        if (content.length > 50) {
          // Send analyze event
          sendEvent({
            type: 'analyze',
            url: result.link,
            title: result.title,
          });

          // Analyze with LLM (with error handling)
          let analysis;
          try {
            analysis = await analyzeWithLLM(content, subjectName, query);
          } catch (llmErr) {
            console.error(`LLM analysis failed for ${result.link}:`, llmErr);
            continue;
          }
          totalAnalyzed++;

          const analyzed: AnalyzedResult = {
            url: result.link,
            title: result.title,
            snippet: result.snippet,
            isAdverse: analysis.isAdverse,
            severity: analysis.severity,
            headline: analysis.headline,
            summary: analysis.summary,
            searchTerm: query,
            category: detectCategory(query),
          };

          if (analyzed.severity === 'RED') {
            redFlags.push(analyzed);
            sendEvent({ type: 'result', result: analyzed });
          } else if (analyzed.severity === 'AMBER') {
            amberFlags.push(analyzed);
            sendEvent({ type: 'result', result: analyzed });
          } else {
            greenCount++;
          }
        }

        // Small delay to avoid overwhelming APIs
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // Generate final report
    const report: DDOwlReport = {
      subject: subjectName,
      timestamp: new Date().toISOString(),
      searchesCompleted: SEARCH_TEMPLATES.length,
      totalResultsAnalyzed: totalAnalyzed,
      flags: {
        red: redFlags,
        amber: amberFlags,
        green: greenCount,
      },
      recommendedAction: determineAction(redFlags.length, amberFlags.length),
    };

    sendEvent({ type: 'complete', report });
    res.end();
  } catch (error) {
    console.error('Screening error:', error);
    sendEvent({ type: 'error', message: 'Screening failed. Please try again.' });
    res.end();
  }
});

function determineAction(redCount: number, amberCount: number): string {
  if (redCount > 0) {
    return 'ESCALATE - Red flags detected. Requires immediate L1 review.';
  }
  if (amberCount > 3) {
    return 'REVIEW - Multiple amber flags. Recommend L1 review.';
  }
  if (amberCount > 0) {
    return 'MONITOR - Minor flags detected. Document and proceed with caution.';
  }
  return 'CLEAR - No adverse information found. Proceed with standard onboarding.';
}

// V2 API - New extraction pipeline with footnote citations
app.get('/api/screen/v2', async (req: Request, res: Response) => {
  const subjectName = req.query.name as string;

  if (!subjectName || subjectName.trim().length < 2) {
    res.status(400).json({ error: 'Please provide a valid name (2+ characters)' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const findings: Finding[] = [];
    const processedUrls = new Set<string>();
    let articlesAnalyzed = 0;

    // Process each search template
    for (let i = 0; i < SEARCH_TEMPLATES.length; i++) {
      const template = SEARCH_TEMPLATES[i];
      const query = buildSearchQuery(template, subjectName);

      sendEvent({
        type: 'progress',
        searchIndex: i + 1,
        totalSearches: SEARCH_TEMPLATES.length,
        currentTerm: query.slice(0, 80),
      });

      // Search all pages with dual engines (Google + Baidu)
      const searchResults = await searchAllEngines(query, 10, 3);

      // Process all results from this search
      for (const result of searchResults) {
        if (processedUrls.has(result.link)) continue;
        processedUrls.add(result.link);

        // Skip PDFs and other non-HTML content
        const lowerUrl = result.link.toLowerCase();
        if (lowerUrl.endsWith('.pdf') || lowerUrl.endsWith('.doc') || lowerUrl.endsWith('.docx')) {
          continue;
        }

        sendEvent({
          type: 'fetch',
          url: result.link,
          title: result.title,
        });

        let content = '';
        try {
          content = await fetchPageContent(result.link);
        } catch (fetchErr) {
          console.error(`Fetch failed for ${result.link}:`, fetchErr);
          continue;
        }
        if (content.length < 100) continue;

        sendEvent({
          type: 'analyze',
          url: result.link,
        });

        articlesAnalyzed++;
        let finding;
        try {
          finding = await extractFinding(content, subjectName, result.link, result.title);
        } catch (extractErr) {
          console.error(`Extract failed for ${result.link}:`, extractErr);
          continue;
        }

        if (finding.isRelevant) {
          findings.push(finding);
          sendEvent({
            type: 'finding',
            issueType: finding.issueType,
            headline: finding.headline,
            source: finding.sourcePublisher,
          });
        }

        // Small delay
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // Deduplicate findings
    sendEvent({ type: 'status', message: 'Consolidating findings...' });

    const grouped: Finding[][] = [];
    for (const finding of findings) {
      let matched = false;
      for (const group of grouped) {
        if (isSameFinding(group[0], finding)) {
          group.push(finding);
          matched = true;
          break;
        }
      }
      if (!matched) {
        grouped.push([finding]);
      }
    }

    // Merge with citations
    const merged = await Promise.all(grouped.map(g => mergeFindings(g)));

    // Build issues array
    const issues: Issue[] = merged.map(f => ({
      issueType: f.issueType || 'other',
      headline: f.headline || '',
      narrative: f.narrative || '',
      sources: [f.sourceUrl],
    }));

    // Determine overall risk
    const hasRed = issues.some(i =>
      ['criminal', 'fraud', 'corruption', 'sanctions'].includes(i.issueType)
    );
    const hasAmber = issues.some(i =>
      ['regulatory', 'civil', 'insider_trading'].includes(i.issueType)
    );

    const overallRisk: 'RED' | 'AMBER' | 'GREEN' = hasRed ? 'RED' : hasAmber ? 'AMBER' : 'GREEN';

    // Generate report
    const report: DDOwlReportV2 = {
      subject: subjectName,
      timestamp: new Date().toISOString(),
      searchesCompleted: SEARCH_TEMPLATES.length,
      articlesAnalyzed,
      issues,
      overallRisk,
      recommendedAction: determineActionV2(issues.length, overallRisk),
    };

    sendEvent({ type: 'complete', report });
    res.end();
  } catch (error) {
    console.error('Screening error:', error);
    sendEvent({ type: 'error', message: 'Screening failed. Please try again.' });
    res.end();
  }
});

function determineActionV2(issueCount: number, risk: 'RED' | 'AMBER' | 'GREEN'): string {
  if (risk === 'RED') {
    return 'ESCALATE - Serious adverse findings. Requires immediate L1 review.';
  }
  if (risk === 'AMBER') {
    return 'REVIEW - Adverse findings detected. Recommend L1 review.';
  }
  if (issueCount > 0) {
    return 'MONITOR - Minor issues found. Document and proceed with caution.';
  }
  return 'CLEAR - No adverse information found. Proceed with standard onboarding.';
}

// V3 API - Smart 3-stage triage screening
app.get('/api/screen/v3', async (req: Request, res: Response) => {
  const subjectName = req.query.name as string;
  const resumeFrom = parseInt(req.query.resumeFrom as string) || 0;

  if (!subjectName || subjectName.trim().length < 2) {
    res.status(400).json({ error: 'Name required (2+ chars)' });
    return;
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Collect all events for logging
  const eventLog: any[] = [];
  const sendEvent = (data: any) => {
    const event = { timestamp: new Date().toISOString(), ...data };
    eventLog.push(event);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat to prevent timeout (5s for better connection stability)
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 5000);

  try {
    const allFindings: RawFinding[] = [];
    const triageLog: any[] = [];
    const processedUrls = new Set<string>();
    let totalSearchResults = 0;
    let totalSkippedDuplicates = 0;
    let totalFetched = 0;
    let totalAnalyzed = 0;
    let totalCleared = 0;

    for (let i = 0; i < SEARCH_TEMPLATES.length; i++) {
      try {
        // Skip queries already completed before reconnect
        if (i < resumeFrom) {
          sendEvent({
            type: 'query_skipped',
            queryIndex: i + 1,
            reason: 'Already processed before reconnect'
          });
          continue;
        }

        const template = SEARCH_TEMPLATES[i];
        const query = buildSearchQuery(template, subjectName);

        // Stage 0: Search
        sendEvent({
          type: 'query_start',
          queryIndex: i + 1,
          totalQueries: SEARCH_TEMPLATES.length,
          query: query
        });

        // Progress callback to send page-by-page results to frontend
        const searchProgress: SearchProgressCallback = (event) => {
          if (event.type === 'page_results' && event.results && event.results.length > 0) {
            sendEvent({
              type: 'search_page',
              engine: event.engine,
              page: event.page,
              maxPages: event.maxPages,
              results: event.results.map(r => ({ title: r.title, url: r.link })),
              totalSoFar: event.totalSoFar
            });
          } else if (event.type === 'page_end' && event.results?.length === 0) {
            sendEvent({
              type: 'search_page_empty',
              engine: event.engine,
              page: event.page,
              message: `No more results after page ${(event.page || 1) - 1}`
            });
          }
        };

        const searchResults = await searchAllEngines(query, 20, 10, searchProgress);
      totalSearchResults += searchResults.length;

      sendEvent({
        type: 'search_results',
        queryIndex: i + 1,
        found: searchResults.length
      });

      if (searchResults.length === 0) continue;

      // Filter out already-processed URLs (deduplication)
      const newResults = searchResults.filter(r => !processedUrls.has(r.link));
      const duplicatesSkipped = searchResults.length - newResults.length;
      totalSkippedDuplicates += duplicatesSkipped;

      if (duplicatesSkipped > 0) {
        sendEvent({
          type: 'duplicates_skipped',
          count: duplicatesSkipped,
          total: searchResults.length
        });
      }

      if (newResults.length === 0) continue;

      // Stage 1: Triage - classify each result
      sendEvent({ type: 'triage_start', count: newResults.length });

      const triage = await triageSearchResults(
        newResults.map(r => ({ title: r.title, snippet: r.snippet, url: r.link })),
        subjectName
      );

      // Mark all triaged URLs as processed
      for (const item of [...triage.green, ...triage.yellow, ...triage.red]) {
        processedUrls.add(item.url);
      }

      // Send each item's classification with reason
      for (const item of triage.green) {
        sendEvent({
          type: 'triage_item',
          classification: 'GREEN',
          title: item.title,
          reason: item.reason,
          action: 'SKIP'
        });
      }
      for (const item of triage.yellow) {
        sendEvent({
          type: 'triage_item',
          classification: 'YELLOW',
          title: item.title,
          reason: item.reason,
          action: 'QUICK_SCAN'
        });
      }
      for (const item of triage.red) {
        sendEvent({
          type: 'triage_item',
          classification: 'RED',
          title: item.title,
          reason: item.reason,
          action: 'ANALYZE'
        });
      }

      triageLog.push({
        query: query.slice(0, 60),
        red: triage.red.length,
        yellow: triage.yellow.length,
        green: triage.green.length
      });

      sendEvent({
        type: 'triage_summary',
        red: triage.red.length,
        yellow: triage.yellow.length,
        green: triage.green.length,
        skipped: triage.green.length,
        toInvestigate: triage.red.length + triage.yellow.length
      });

      // Count cleared results
      totalCleared += triage.green.length;

      // Stage 2: Quick scan YELLOW results
      const toAnalyze: TriageResult[] = [...triage.red];

      for (const item of triage.yellow) {
        sendEvent({
          type: 'quick_scan_start',
          url: item.url,
          title: item.title,
          triageReason: item.reason
        });

        const scan = await quickScan(item.url, subjectName);
        totalFetched++;

        sendEvent({
          type: 'quick_scan_result',
          url: item.url,
          title: item.title,
          shouldAnalyze: scan.shouldAnalyze,
          reason: scan.reason,
          action: scan.shouldAnalyze ? 'ANALYZE' : 'SKIP'
        });

        if (scan.shouldAnalyze) {
          toAnalyze.push(item);
        } else {
          totalCleared++;
        }
      }

      // Stage 3: Deep analysis
      for (const item of toAnalyze) {
        sendEvent({
          type: 'analyze_start',
          url: item.url,
          title: item.title,
          fromTriage: item.classification
        });

        try {
          const content = await fetchPageContent(item.url);
          totalFetched++;

          if (content.length < 100) {
            // Don't silently clear - flag for manual review since triage thought it was worth investigating
            // But skip if URL is invalid
            if (!isValidUrl(item.url)) {
              console.warn(`[WARN] Skipping invalid URL: ${item.url}`);
              totalCleared++;
              continue;
            }
            allFindings.push({
              url: item.url,
              title: item.title,
              severity: item.classification === 'RED' ? 'RED' : 'AMBER',
              headline: 'Content unavailable - manual review required',
              summary: `Triage flagged as ${item.classification}: "${item.reason}". Could not fetch page content.`,
              triageClassification: item.classification,
              fetchFailed: true
            });
            sendEvent({
              type: 'analyze_result',
              url: item.url,
              title: item.title,
              isAdverse: true,
              severity: item.classification === 'RED' ? 'RED' : 'AMBER',
              headline: 'Content unavailable - manual review required',
              summary: `Triage reason: ${item.reason}`,
              action: 'FLAG_MANUAL_REVIEW'
            });
            continue;
          }

          const analysis = await analyzeWithLLM(content, subjectName, query);
          totalAnalyzed++;

          sendEvent({
            type: 'analyze_result',
            url: item.url,
            title: item.title,
            isAdverse: analysis.isAdverse,
            severity: analysis.severity,
            headline: analysis.headline,
            summary: analysis.summary,
            action: analysis.isAdverse ? 'FLAG' : 'CLEAR'
          });

          if (analysis.isAdverse) {
            // Skip invalid URLs
            if (!isValidUrl(item.url)) {
              console.warn(`[WARN] Skipping invalid URL: ${item.url}`);
              totalCleared++;
            } else {
              allFindings.push({
                url: item.url,
                title: item.title,
                severity: analysis.severity as 'RED' | 'AMBER',
                headline: analysis.headline,
                summary: analysis.summary,
                triageClassification: item.classification
              });
            }
          } else {
            totalCleared++;
          }
        } catch (err) {
          console.error(`Analysis failed for ${item.url}:`, err);
          sendEvent({
            type: 'analyze_error',
            url: item.url,
            error: 'Failed to fetch/analyze'
          });
        }
      }

        // Rate limit delay: wait 3 seconds before next query to avoid API throttling
        if (i < SEARCH_TEMPLATES.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (queryError: any) {
        // Isolate per-query errors - don't crash the entire screening
        console.error(`Query ${i + 1} failed:`, queryError);
        sendEvent({
          type: 'query_error',
          queryIndex: i + 1,
          error: queryError.message || 'Unknown error'
        });
        // Continue to next query
      }
    }

    // Consolidate findings (deduplicate same incidents from multiple sources)
    clearInterval(heartbeat);

    let consolidatedFindings: ConsolidatedFinding[] = [];
    if (allFindings.length > 0) {
      sendEvent({ type: 'consolidating', count: allFindings.length });
      consolidatedFindings = await consolidateFindings(allFindings, subjectName);
      sendEvent({
        type: 'consolidated',
        before: allFindings.length,
        after: consolidatedFindings.length
      });
    }

    const redFindings = consolidatedFindings.filter(f => f.severity === 'RED');
    const amberFindings = consolidatedFindings.filter(f => f.severity === 'AMBER');

    sendEvent({
      type: 'complete',
      stats: {
        totalSearchResults,
        totalSkippedDuplicates,
        totalFetched,
        totalAnalyzed,
        totalCleared,
        findings: consolidatedFindings.length,
        red: redFindings.length,
        amber: amberFindings.length
      },
      findings: consolidatedFindings,
      triageLog
    });

    // Save complete activity log to JSON file for auditing
    try {
      const fs = await import('fs');
      const sanitizedName = subjectName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
      const runId = `${sanitizedName}-${Date.now()}`;
      const logPath = path.join(__dirname, '../runs', `screening-${runId}.json`);

      const logData = {
        runId,
        subject: subjectName,
        timestamp: new Date().toISOString(),
        totalEvents: eventLog.length,
        stats: {
          totalSearchResults,
          totalSkippedDuplicates,
          totalFetched,
          totalAnalyzed,
          totalCleared,
          findings: consolidatedFindings.length,
          red: redFindings.length,
          amber: amberFindings.length
        },
        findings: consolidatedFindings,
        triageLog,
        eventLog
      };

      fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
      console.log(`[LOG] Saved screening log to ${logPath}`);
    } catch (logError) {
      console.error('[LOG] Failed to save screening log:', logError);
    }

    res.end();
  } catch (error) {
    clearInterval(heartbeat);
    console.error('V3 screening error:', error);
    sendEvent({ type: 'error', message: 'Screening failed' });
    res.end();
  } finally {
    await closeBrowser();
  }
});

// Serve frontend
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/ipo', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/ipo.html'));
});

app.get('/screening', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/verify-import', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/verify-import.html'));
});

// Historical import verification API
import xlsx from 'xlsx';
import fs from 'fs';

app.get('/api/import-results', (req: Request, res: Response) => {
  const resultsPath = path.join(__dirname, '../.historical-import-results.json');
  try {
    if (fs.existsSync(resultsPath)) {
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      res.json(results);
    } else {
      res.json([]);
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to load results' });
  }
});

app.get('/api/deal-pdf-url/:ticker', (req: Request, res: Response) => {
  const ticker = parseInt(req.params.ticker);
  const excelPath = path.join(__dirname, '../../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');

  try {
    const workbook = xlsx.readFile(excelPath);
    const indexSheet = workbook.Sheets['Index'];
    const rows = xlsx.utils.sheet_to_json(indexSheet, { header: 1 }) as any[][];

    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[1] === ticker) {
        res.json({ url: row[4] || null });
        return;
      }
    }
    res.json({ url: null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read Excel' });
  }
});

// Verification endpoint - shows all deals with URLs and banks for fact-checking
app.get('/api/ipo/verify-data', async (req: Request, res: Response) => {
  try {
    const dbPath = path.join(__dirname, '../data/ddowl.db');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const deals = db.prepare(`
      SELECT d.ticker, d.company, d.prospectus_url, d.banks_extracted, d.type, d.notes
      FROM ipo_deals d
      WHERE d.has_bank_info = 1
      ORDER BY d.banks_extracted DESC
    `).all();

    const result = deals.map((d: any) => {
      const banks = db.prepare(`
        SELECT b.name, r.role, r.is_lead, r.raw_role, r.raw_name
        FROM ipo_bank_roles r
        JOIN banks b ON b.id = r.bank_id
        WHERE r.deal_id = (SELECT id FROM ipo_deals WHERE ticker = ?)
      `).all(d.ticker);

      // Group by bank (normalized name)
      const bankMap = new Map();
      for (const b of banks as any[]) {
        if (!bankMap.has(b.name)) {
          bankMap.set(b.name, {
            name: b.name,
            raw_name: b.raw_name || b.name,  // Include raw name from PDF
            roles: [],
            is_lead: b.is_lead
          });
        }
        bankMap.get(b.name).roles.push(b.role);
      }

      return {
        ...d,
        banks: Array.from(bankMap.values())
      };
    });

    db.close();
    res.json(result);
  } catch (e) {
    console.error('Verify data error:', e);
    res.status(500).json({ error: 'Failed to load data', details: String(e) });
  }
});

// Serve verify-banks.html
app.get('/verify-banks', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../verify-banks.html'));
});

// Create HTTP server for both Express and WebSocket
const server = http.createServer(app);

// Initialize WebSocket server
const wsServer = initWSServer(server);

// API endpoint to get extracted QCC data
app.get('/api/qcc/extracted', (req: Request, res: Response) => {
  const ws = getWSServer();
  if (ws) {
    res.json({
      success: true,
      data: ws.getExtractedData(),
      count: ws.getExtractedData().length,
    });
  } else {
    res.status(500).json({ error: 'WebSocket server not initialized' });
  }
});

// API endpoint to clear extracted data
app.post('/api/qcc/clear', (req: Request, res: Response) => {
  const ws = getWSServer();
  if (ws) {
    ws.clearExtractedData();
    res.json({ success: true, message: 'Extracted data cleared' });
  } else {
    res.status(500).json({ error: 'WebSocket server not initialized' });
  }
});

// API endpoint for crawl queue status
app.get('/api/queue', (req: Request, res: Response) => {
  res.json(getQueueStats());
});

// API endpoint to generate person report
app.get('/api/report/person', async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: 'URL parameter required' });
      return;
    }

    const buffer = await generatePersonReport(url);
    const filename = `person-report-${Date.now()}.docx`;
    const filePath = await saveReport(buffer, filename);

    res.json({ success: true, path: filePath, filename });
  } catch (error: any) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to generate DD write-up report with streaming
app.post('/api/report/generate', async (req: Request, res: Response) => {
  const { subjectName, findings } = req.body;

  if (!subjectName || !findings || !Array.isArray(findings)) {
    res.status(400).json({ error: 'subjectName and findings array required' });
    return;
  }

  // Set up SSE for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendChunk = (content: string) => {
    res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
  };

  // Heartbeat to prevent timeout (5s for better connection stability)
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 5000);

  try {
    console.log(`[REPORT] Starting report generation for ${subjectName} with ${findings.length} findings`);

    await generateFullReport(subjectName, findings as ConsolidatedFinding[], sendChunk);

    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();
  } catch (error: any) {
    clearInterval(heartbeat);
    console.error('[REPORT] Generation error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

// API endpoint to generate company report
app.get('/api/report/company', async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: 'URL parameter required' });
      return;
    }

    const buffer = await generateCompanyReport(url);
    const filename = `company-report-${Date.now()}.docx`;
    const filePath = await saveReport(buffer, filename);

    res.json({ success: true, path: filePath, filename });
  } catch (error: any) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PERSON RESEARCH API ENDPOINTS
// ============================================================

// Start person research - crawl all affiliations
app.post('/api/research/start', async (req: Request, res: Response) => {
  try {
    const { personName, personUrl } = req.body;

    if (!personName || !personUrl) {
      res.status(400).json({ error: 'personName and personUrl required' });
      return;
    }

    // Start research in background (don't await)
    startPersonResearch(personName, personUrl);

    res.json({
      success: true,
      message: 'Research started',
      status: getSessionStatus(),
    });
  } catch (error: any) {
    console.error('Research start error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get research status
app.get('/api/research/status', (req: Request, res: Response) => {
  res.json({
    ...getResearchStatus(),
    session: getSessionStatus(),
  });
});

// Get research results
app.get('/api/research/results', (req: Request, res: Response) => {
  const results = getSessionResults();
  if (!results) {
    res.status(404).json({ error: 'No research session found' });
    return;
  }
  res.json(results);
});

// Stop research
app.post('/api/research/stop', (req: Request, res: Response) => {
  stopPersonResearch();
  res.json({ success: true, message: 'Research stopped' });
});

// Clear research session
app.post('/api/research/clear', (req: Request, res: Response) => {
  clearSession();
  res.json({ success: true, message: 'Session cleared' });
});

// ============================================================
// AI AGENT API ENDPOINTS
// ============================================================

import { runAgent, DDOwlAgent } from './agent/orchestrator.js';
import { AgentProgress, AgentResult } from './agent/tools/types.js';

// Store running agents
const runningAgents: Map<string, { agent: DDOwlAgent; result?: AgentResult }> = new Map();

// Start agent task with SSE progress streaming
app.post('/api/agent/run', async (req: Request, res: Response) => {
  const { task } = req.body;

  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type: string, data: any) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const agent = new DDOwlAgent({
      onProgress: (progress: AgentProgress) => {
        sendEvent('progress', progress);
      },
    });

    const taskId = agent.getProgress().taskId;
    runningAgents.set(taskId, { agent });

    sendEvent('started', { taskId, task });

    // Run agent
    const result = await agent.run(task);

    // Store result
    runningAgents.set(taskId, { agent, result });

    sendEvent('complete', {
      taskId,
      success: result.success,
      response: result.response,
      error: result.error,
      toolCallCount: result.toolCallCount,
      duration: result.duration,
    });

    // Clean up after 5 minutes
    setTimeout(() => runningAgents.delete(taskId), 5 * 60 * 1000);

  } catch (error: any) {
    sendEvent('error', { error: error.message });
  }

  res.end();
});

// Get agent result (non-streaming)
app.get('/api/agent/result/:taskId', (req: Request, res: Response) => {
  const { taskId } = req.params;
  const agentData = runningAgents.get(taskId);

  if (!agentData) {
    res.status(404).json({ error: 'Agent task not found' });
    return;
  }

  res.json({
    taskId,
    progress: agentData.agent.getProgress(),
    result: agentData.result,
    data: agentData.agent.getData(),
  });
});

// Simple run endpoint (non-streaming, for testing)
app.post('/api/agent/run-sync', async (req: Request, res: Response) => {
  const { task } = req.body;

  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  try {
    console.log(`[Agent API] Starting task: ${task}`);
    const result = await runAgent(task);
    res.json(result);
  } catch (error: any) {
    console.error('[Agent API] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DD TABLE FORMATTING ENDPOINT
// ============================================================

// Format extracted person profile into DD table
app.post('/api/dd/format-table', (req: Request, res: Response) => {
  const data = req.body;

  if (!data || !data.affiliations) {
    res.status(400).json({ error: 'Invalid data - need affiliations array' });
    return;
  }

  const personName = data.personName || 'Unknown';
  const affiliations = data.affiliations || [];
  const currentAffiliations = data.currentAffiliations || [];
  const historicalAffiliations = data.historicalAffiliations || [];

  // Format role with shareholding
  const formatRole = (aff: any): string => {
    const parts: string[] = [];
    if (aff.role) parts.push(aff.role);
    if (aff.shareholding) parts.push(aff.shareholding);
    return parts.join(' ') || '-';
  };

  // Build markdown table
  let markdown = `# DD Report: ${personName}\n\n`;
  markdown += `Source: ${data.source || 'Unknown'}\n`;
  markdown += `Extracted: ${data.extractedAt || new Date().toISOString()}\n\n`;

  // Current affiliations table
  if (currentAffiliations.length > 0) {
    markdown += `## Current Affiliations (${currentAffiliations.length})\n\n`;
    markdown += `| # | Company Name | Registration # | Role/Shareholding | Appointment Date |\n`;
    markdown += `|---|--------------|----------------|-------------------|------------------|\n`;
    currentAffiliations.forEach((aff: any, idx: number) => {
      markdown += `| ${idx + 1} | ${aff.companyName} | TBD | ${formatRole(aff)} | TBD |\n`;
    });
    markdown += `\n`;
  }

  // Historical affiliations table
  if (historicalAffiliations.length > 0) {
    markdown += `## Historical Affiliations (${historicalAffiliations.length})\n\n`;
    markdown += `| # | Company Name | Registration # | Role/Shareholding | Appointment Date |\n`;
    markdown += `|---|--------------|----------------|-------------------|------------------|\n`;
    historicalAffiliations.forEach((aff: any, idx: number) => {
      markdown += `| ${idx + 1} | ${aff.companyName} | TBD | ${formatRole(aff)} | TBD |\n`;
    });
    markdown += `\n`;
  }

  // If no current/historical split, use main affiliations
  if (currentAffiliations.length === 0 && historicalAffiliations.length === 0 && affiliations.length > 0) {
    markdown += `## All Affiliations (${affiliations.length})\n\n`;
    markdown += `| # | Company Name | Registration # | Role/Shareholding | Appointment Date |\n`;
    markdown += `|---|--------------|----------------|-------------------|------------------|\n`;
    affiliations.forEach((aff: any, idx: number) => {
      markdown += `| ${idx + 1} | ${aff.companyName} | TBD | ${formatRole(aff)} | TBD |\n`;
    });
    markdown += `\n`;
  }

  // Risk summary
  if (data.riskInfo) {
    markdown += `## Risk Summary\n\n`;
    markdown += `- Self Risk: ${data.riskInfo.selfRisk || 0}\n`;
    markdown += `- Related Risk: ${data.riskInfo.relatedRisk || 0}\n`;
    markdown += `- Warnings: ${data.riskInfo.warnings || 0}\n`;
  }

  res.json({
    success: true,
    personName,
    currentCount: currentAffiliations.length,
    historicalCount: historicalAffiliations.length,
    totalCount: affiliations.length,
    markdown,
  });
});

// Generate Word report from extracted data
app.post('/api/dd/report', async (req: Request, res: Response) => {
  try {
    const data = req.body;

    if (!data || !data.personName) {
      res.status(400).json({ error: 'Missing personName' });
      return;
    }

    const filename = await generateWordReport({
      personName: data.personName,
      currentAffiliations: data.currentAffiliations || [],
      historicalAffiliations: data.historicalAffiliations || []
    });

    const reportUrl = `/reports/${filename}`;

    res.json({
      success: true,
      filename,
      reportUrl,
      currentCount: data.currentAffiliations?.length || 0,
      historicalCount: data.historicalAffiliations?.length || 0
    });
  } catch (error: any) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DATA LOCK-IN VERIFICATION ENDPOINTS
// ============================================================

// Get run history
app.get('/api/runs', (req: Request, res: Response) => {
  const history = loadHistory();
  res.json(history);
});

// Get sample deals for review
app.get('/api/verify/sample', async (req: Request, res: Response) => {
  const n = parseInt(req.query.n as string) || 20;
  const dbPath = path.join(__dirname, '../data/ddowl.db');
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath, { readonly: true });

  // Get random sample
  const deals = db.prepare(`
    SELECT d.ticker, d.company, d.prospectus_url, d.banks_extracted
    FROM ipo_deals d
    WHERE d.has_bank_info = 1
    ORDER BY RANDOM()
    LIMIT ?
  `).all(n) as any[];

  // Get banks for each deal - grouped by decision maker status
  for (const deal of deals) {
    const allBanks = db.prepare(`
      SELECT b.name, r.raw_name, r.is_decision_maker, r.is_lead, r.raw_roles
      FROM ipo_bank_roles r
      JOIN banks b ON b.id = r.bank_id
      WHERE r.deal_id = (SELECT id FROM ipo_deals WHERE ticker = ?)
    `).all(deal.ticker) as any[];

    deal.decision_makers = allBanks
      .filter(b => b.is_decision_maker)
      .map(b => ({
        name: b.name,
        raw_name: b.raw_name,
        is_lead: b.is_lead === 1,
        raw_roles: JSON.parse(b.raw_roles || '[]'),
      }));

    deal.other_banks = allBanks
      .filter(b => !b.is_decision_maker)
      .map(b => ({
        name: b.name,
        raw_name: b.raw_name,
        raw_roles: JSON.parse(b.raw_roles || '[]'),
      }));
  }

  db.close();
  res.json(deals);
});

// Get flagged deals
app.get('/api/verify/flags', (req: Request, res: Response) => {
  const flags = validateDeals();
  res.json(flags);
});

// Get lock-in progress
app.get('/api/verify/progress', (req: Request, res: Response) => {
  const history = loadHistory();
  const recentRuns = history.runs.slice(-5);
  res.json({
    total_runs: history.runs.length,
    current_clean_streak: history.current_clean_streak,
    locked: history.locked,
    recent_runs: recentRuns,
    target_streak: 3,
  });
});

// Mark run as reviewed
app.post('/api/verify/complete-review', (req: Request, res: Response) => {
  const { run_id, issues_found } = req.body;
  markRunClean(run_id, issues_found);
  res.json({ success: true });
});

// Get diff between runs
app.get('/api/runs/:id/diff/:prevId', (req: Request, res: Response) => {
  const diff = getRunDiff(req.params.id, req.params.prevId);
  res.json(diff || []);
});

// Serve verification UI
app.get('/verify-lockin', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../verify-lockin.html'));
});

// ============================================================
// SCREENING LOG API (L0 Learning Loop)
// ============================================================

const SCREENING_LOG_PATH = path.join(__dirname, '../data/screening-log.json');

function loadScreeningLog() {
  try {
    return JSON.parse(fs.readFileSync(SCREENING_LOG_PATH, 'utf8'));
  } catch {
    return { project: '', subjects: [], learning_log: [] };
  }
}

function saveScreeningLog(log: any) {
  fs.writeFileSync(SCREENING_LOG_PATH, JSON.stringify(log, null, 2));
}

// Get current screening log
app.get('/api/screening-log', (req: Request, res: Response) => {
  res.json(loadScreeningLog());
});

// Save DD Owl run results for a subject
app.post('/api/screening-log/ddowl-run', (req: Request, res: Response) => {
  const { subject_name, red_flags, amber_flags, sources_checked } = req.body;
  const log = loadScreeningLog();

  const subject = log.subjects.find((s: any) => s.name === subject_name);
  if (!subject) {
    res.status(404).json({ error: 'Subject not found in log' });
    return;
  }

  subject.ddowl_run = {
    timestamp: new Date().toISOString(),
    red_flags: red_flags || [],
    amber_flags: amber_flags || [],
    sources_checked: sources_checked || 0
  };

  saveScreeningLog(log);
  res.json({ success: true, subject });
});

// Add human findings for a subject
app.post('/api/screening-log/human-finding', (req: Request, res: Response) => {
  const { subject_name, issue, source, severity, notes } = req.body;
  const log = loadScreeningLog();

  const subject = log.subjects.find((s: any) => s.name === subject_name);
  if (!subject) {
    res.status(404).json({ error: 'Subject not found in log' });
    return;
  }

  subject.human_findings.push({
    issue,
    source,
    severity,
    notes,
    added_at: new Date().toISOString()
  });

  saveScreeningLog(log);
  res.json({ success: true, subject });
});

// Record comparison (matches, false negatives, false positives)
app.post('/api/screening-log/comparison', (req: Request, res: Response) => {
  const { subject_name, false_negatives, false_positives, matches, notes } = req.body;
  const log = loadScreeningLog();

  const subject = log.subjects.find((s: any) => s.name === subject_name);
  if (!subject) {
    res.status(404).json({ error: 'Subject not found in log' });
    return;
  }

  subject.comparison = {
    false_negatives: false_negatives || [],
    false_positives: false_positives || [],
    matches: matches || [],
    compared_at: new Date().toISOString()
  };
  subject.notes = notes || subject.notes;

  // Add to learning log
  if (false_negatives?.length > 0 || false_positives?.length > 0) {
    log.learning_log.push({
      subject: subject_name,
      timestamp: new Date().toISOString(),
      false_negatives,
      false_positives,
      notes
    });
  }

  saveScreeningLog(log);
  res.json({ success: true, subject });
});

// Get learning insights (aggregated)
app.get('/api/screening-log/insights', (req: Request, res: Response) => {
  const log = loadScreeningLog();

  const allFalseNegatives: any[] = [];
  const allFalsePositives: any[] = [];

  for (const entry of log.learning_log) {
    allFalseNegatives.push(...(entry.false_negatives || []));
    allFalsePositives.push(...(entry.false_positives || []));
  }

  res.json({
    total_subjects: log.subjects.length,
    completed_comparisons: log.subjects.filter((s: any) => s.comparison).length,
    total_false_negatives: allFalseNegatives.length,
    total_false_positives: allFalsePositives.length,
    false_negatives: allFalseNegatives,
    false_positives: allFalsePositives
  });
});

// ============================================================
// SCREENING LOGS API
// ============================================================

// List all screening logs
app.get('/api/logs', (req: Request, res: Response) => {
  const subject = req.query.subject as string | undefined;
  const logs = listScreeningLogs(subject);
  res.json(logs);
});

// Get specific screening log
app.get('/api/logs/:subject/:runId', (req: Request, res: Response) => {
  const { subject, runId } = req.params;
  const log = loadLog(subject, runId);

  if (!log) {
    res.status(404).json({ error: 'Log not found' });
    return;
  }

  res.json(log);
});

// Get benchmark results
app.get('/api/benchmarks', (req: Request, res: Response) => {
  const subject = req.query.subject as string | undefined;
  const results = loadBenchmarkResults(subject);
  res.json(results);
});

// Get benchmark case definition
app.get('/api/benchmarks/case/:subject', (req: Request, res: Response) => {
  const { subject } = req.params;
  const benchmarkCase = getBenchmarkCase(subject);

  if (!benchmarkCase) {
    res.status(404).json({ error: 'Benchmark case not found' });
    return;
  }

  res.json(benchmarkCase);
});

server.listen(PORT, () => {
  console.log(`DD Owl running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/ws`);
  console.log(`Search templates loaded: ${SEARCH_TEMPLATES.length}`);
  console.log(`Search engines: Serper (Google)${isBaiduAvailable() ? ' + SerpAPI (Baidu)' : ''}`);
  console.log(`Scraping: axios-first with Puppeteer fallback (100% coverage)`);
});

// Cleanup browser on shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await closeBrowser();
  process.exit(0);
});
