/**
 * DD Owl Screening Pipeline
 *
 * Orchestrates the full screening process:
 * 1. Search for articles
 * 2. Fetch and extract facts
 * 3. Deduplicate and consolidate issues
 * 4. Store in database
 * 5. Generate report
 */

import { SEARCH_TEMPLATES, buildSearchQuery } from './searchStrings.js';
import { searchAllPages } from './searcher.js';
import { fetchPageContent, closeBrowser } from './analyzer.js';
import { extractFacts, isSameIssue, mergeFacts } from './factExtractor.js';
import {
  pool,
  ExtractedFacts,
  SourceInfo,
  createScreening,
  updateScreening,
  createIssue,
  findExistingIssue,
  addIssuePeople,
  addIssueOrganizations,
  addIssueAuthorities,
  addIssueEvents,
  addIssueAmounts,
  addIssueLegal,
  addIssueSource,
  isSourceProcessed,
} from './db.js';

export interface ScreeningProgress {
  type: 'search' | 'fetch' | 'extract' | 'issue' | 'complete' | 'error';
  searchIndex?: number;
  totalSearches?: number;
  currentQuery?: string;
  url?: string;
  title?: string;
  issueTitle?: string;
  severity?: string;
  totalIssues?: number;
  redCount?: number;
  amberCount?: number;
  message?: string;
}

export interface ScreeningResult {
  screeningId: number;
  subject: string;
  issues: ConsolidatedIssue[];
  stats: {
    searchesCompleted: number;
    articlesFetched: number;
    articlesAnalyzed: number;
    issuesFound: number;
    redFlags: number;
    amberFlags: number;
  };
}

interface ConsolidatedIssue {
  id: number;
  facts: ExtractedFacts;
  sources: SourceInfo[];
}

/**
 * Run a full screening on a subject
 */
export async function runScreening(
  subjectName: string,
  onProgress?: (progress: ScreeningProgress) => void
): Promise<ScreeningResult> {
  const sendProgress = onProgress || (() => {});

  // Create screening record
  const screeningId = await createScreening(subjectName);
  console.log(`Created screening #${screeningId} for: ${subjectName}`);

  const consolidatedIssues: ConsolidatedIssue[] = [];
  const processedUrls = new Set<string>();
  let articlesFetched = 0;
  let articlesAnalyzed = 0;

  try {
    // Process each search template
    for (let i = 0; i < SEARCH_TEMPLATES.length; i++) {
      const template = SEARCH_TEMPLATES[i];
      const query = buildSearchQuery(template, subjectName);

      sendProgress({
        type: 'search',
        searchIndex: i + 1,
        totalSearches: SEARCH_TEMPLATES.length,
        currentQuery: query.slice(0, 80),
      });

      console.log(`\n[${i + 1}/${SEARCH_TEMPLATES.length}] Searching: ${query.slice(0, 60)}...`);

      // Search with pagination
      const searchResults = await searchAllPages(query, 3); // 3 pages = 30 results
      console.log(`  Found ${searchResults.length} results`);

      // Process each result
      for (const result of searchResults) {
        // Skip if already processed
        if (processedUrls.has(result.link)) continue;
        processedUrls.add(result.link);

        // Skip if already in database
        if (await isSourceProcessed(result.link)) {
          console.log(`  Skipping (already processed): ${result.link.slice(0, 50)}`);
          continue;
        }

        sendProgress({
          type: 'fetch',
          url: result.link,
          title: result.title,
        });

        // Fetch content
        const content = await fetchPageContent(result.link);
        articlesFetched++;

        if (content.length < 100) {
          console.log(`  Skipping (no content): ${result.link.slice(0, 50)}`);
          continue;
        }

        sendProgress({
          type: 'extract',
          url: result.link,
          title: result.title,
        });

        // Extract facts
        console.log(`  Extracting facts from: ${new URL(result.link).hostname}`);
        const facts = await extractFacts(content, subjectName, result.link);
        articlesAnalyzed++;

        if (!facts) {
          console.log(`  No adverse info found`);
          continue;
        }

        // Create source info
        const sourceInfo: SourceInfo = {
          url: result.link,
          title: result.title,
          publisher: extractPublisher(result.link),
          content: content,
          fetch_method: 'axios', // TODO: track actual method
        };

        // Check if this is a new issue or matches an existing one
        let matchedIssue: ConsolidatedIssue | undefined;

        for (const existing of consolidatedIssues) {
          if (isSameIssue(existing.facts, facts)) {
            matchedIssue = existing;
            break;
          }
        }

        if (matchedIssue) {
          // Merge facts into existing issue
          console.log(`  Merging into existing issue: ${matchedIssue.facts.title}`);
          matchedIssue.facts = mergeFacts(matchedIssue.facts, facts);
          matchedIssue.sources.push(sourceInfo);

          // Add source to database
          await addIssueSource(matchedIssue.id, sourceInfo, facts);
        } else {
          // Create new issue
          console.log(`  NEW ISSUE: ${facts.title} (${facts.severity})`);

          const issueId = await createIssue(screeningId, facts);

          // Add all related data
          await addIssuePeople(issueId, facts.people);
          await addIssueOrganizations(issueId, facts.organizations);
          await addIssueAuthorities(issueId, facts.authorities, result.link);
          await addIssueEvents(issueId, facts.events);
          await addIssueAmounts(issueId, facts.amounts);
          await addIssueLegal(issueId, facts.legal);
          await addIssueSource(issueId, sourceInfo, facts);

          const newIssue: ConsolidatedIssue = {
            id: issueId,
            facts: facts,
            sources: [sourceInfo],
          };
          consolidatedIssues.push(newIssue);

          sendProgress({
            type: 'issue',
            issueTitle: facts.title,
            severity: facts.severity,
            totalIssues: consolidatedIssues.length,
            redCount: consolidatedIssues.filter(i => i.facts.severity === 'RED').length,
            amberCount: consolidatedIssues.filter(i => i.facts.severity === 'AMBER').length,
          });
        }
      }
    }

    // Calculate final stats
    const redCount = consolidatedIssues.filter(i => i.facts.severity === 'RED').length;
    const amberCount = consolidatedIssues.filter(i => i.facts.severity === 'AMBER').length;

    // Update screening record
    await updateScreening(screeningId, {
      status: 'completed',
      searches_completed: SEARCH_TEMPLATES.length,
      articles_fetched: articlesFetched,
      articles_analyzed: articlesAnalyzed,
      issues_found: consolidatedIssues.length,
      red_flags: redCount,
      amber_flags: amberCount,
      green_count: articlesAnalyzed - consolidatedIssues.length,
      completed_at: new Date(),
    });

    sendProgress({
      type: 'complete',
      totalIssues: consolidatedIssues.length,
      redCount,
      amberCount,
    });

    return {
      screeningId,
      subject: subjectName,
      issues: consolidatedIssues,
      stats: {
        searchesCompleted: SEARCH_TEMPLATES.length,
        articlesFetched,
        articlesAnalyzed,
        issuesFound: consolidatedIssues.length,
        redFlags: redCount,
        amberFlags: amberCount,
      },
    };
  } catch (error) {
    console.error('Screening error:', error);

    await updateScreening(screeningId, {
      status: 'failed',
    });

    sendProgress({
      type: 'error',
      message: error instanceof Error ? error.message : 'Screening failed',
    });

    throw error;
  } finally {
    await closeBrowser();
  }
}

/**
 * Generate a professional report from screening results
 */
export function generateReport(result: ScreeningResult): string {
  const lines: string[] = [];

  lines.push('═'.repeat(80));
  lines.push(`DD OWL SCREENING REPORT`);
  lines.push('═'.repeat(80));
  lines.push('');
  lines.push(`Subject: ${result.subject}`);
  lines.push(`Date: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`Screening ID: ${result.screeningId}`);
  lines.push('');
  lines.push('─'.repeat(80));
  lines.push('SUMMARY');
  lines.push('─'.repeat(80));
  lines.push(`Searches Completed: ${result.stats.searchesCompleted}`);
  lines.push(`Articles Analyzed: ${result.stats.articlesAnalyzed}`);
  lines.push(`Issues Found: ${result.stats.issuesFound}`);
  lines.push(`  RED Flags: ${result.stats.redFlags}`);
  lines.push(`  AMBER Flags: ${result.stats.amberFlags}`);
  lines.push('');

  // Recommendation
  let recommendation: string;
  if (result.stats.redFlags > 0) {
    recommendation = 'ESCALATE - Red flags detected. Requires immediate L1 review.';
  } else if (result.stats.amberFlags > 3) {
    recommendation = 'REVIEW - Multiple amber flags. Recommend L1 review.';
  } else if (result.stats.amberFlags > 0) {
    recommendation = 'MONITOR - Minor flags detected. Document and proceed with caution.';
  } else {
    recommendation = 'CLEAR - No adverse information found. Proceed with standard onboarding.';
  }
  lines.push(`Recommendation: ${recommendation}`);
  lines.push('');

  // RED Issues first
  const redIssues = result.issues.filter(i => i.facts.severity === 'RED');
  if (redIssues.length > 0) {
    lines.push('═'.repeat(80));
    lines.push('RED FLAGS');
    lines.push('═'.repeat(80));

    for (const issue of redIssues) {
      lines.push('');
      lines.push(`■ ${issue.facts.title}`);
      if (issue.facts.timeframe) {
        lines.push(`  Timeframe: ${issue.facts.timeframe}`);
      }
      lines.push(`  Status: ${issue.facts.status}`);
      lines.push('');

      if (issue.facts.summary) {
        lines.push(`  ${issue.facts.summary}`);
        lines.push('');
      }

      // Key people
      if (issue.facts.people.length > 0) {
        lines.push('  Individuals Involved:');
        for (const person of issue.facts.people) {
          const marker = person.is_subject ? '>>>' : '   ';
          lines.push(`  ${marker} ${person.name_zh} (${person.name_en || 'N/A'})`);
          if (person.role) lines.push(`       Role: ${person.role}`);
          if (person.outcome) lines.push(`       Outcome: ${person.outcome}`);
          if (person.sentence) lines.push(`       Sentence: ${person.sentence}`);
          if (person.fine) lines.push(`       Fine: ${person.fine}`);
        }
        lines.push('');
      }

      // Legal details
      if (issue.facts.legal.length > 0) {
        lines.push('  Legal Details:');
        for (const legal of issue.facts.legal) {
          if (legal.case_number) lines.push(`    Case No.: ${legal.case_number}`);
          if (legal.court_zh) lines.push(`    Court: ${legal.court_zh}`);
          if (legal.charge) lines.push(`    Charge: ${legal.charge}`);
          if (legal.verdict) lines.push(`    Verdict: ${legal.verdict}`);
        }
        lines.push('');
      }

      // Sources
      lines.push(`  Sources (${issue.sources.length}):`);
      for (const source of issue.sources) {
        lines.push(`    - ${source.publisher || new URL(source.url).hostname}`);
        lines.push(`      ${source.url}`);
      }
    }
  }

  // AMBER Issues
  const amberIssues = result.issues.filter(i => i.facts.severity === 'AMBER');
  if (amberIssues.length > 0) {
    lines.push('');
    lines.push('═'.repeat(80));
    lines.push('AMBER FLAGS');
    lines.push('═'.repeat(80));

    for (const issue of amberIssues) {
      lines.push('');
      lines.push(`□ ${issue.facts.title}`);
      if (issue.facts.timeframe) {
        lines.push(`  Timeframe: ${issue.facts.timeframe}`);
      }
      lines.push(`  Status: ${issue.facts.status}`);

      if (issue.facts.summary) {
        lines.push('');
        lines.push(`  ${issue.facts.summary}`);
      }

      lines.push('');
      lines.push(`  Sources (${issue.sources.length}):`);
      for (const source of issue.sources) {
        lines.push(`    - ${source.url}`);
      }
    }
  }

  lines.push('');
  lines.push('═'.repeat(80));
  lines.push('END OF REPORT');
  lines.push('═'.repeat(80));

  return lines.join('\n');
}

/**
 * Extract publisher name from URL
 */
function extractPublisher(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Map known domains to publisher names
    const publishers: Record<string, string> = {
      'www.spp.gov.cn': 'Supreme People\'s Procuratorate',
      'www.court.gov.cn': 'Supreme People\'s Court',
      'www.csrc.gov.cn': 'CSRC',
      'news.sina.com.cn': 'Sina News',
      'finance.sina.com.cn': 'Sina Finance',
      'news.qq.com': 'QQ News',
      'finance.qq.com': 'QQ Finance',
      'www.thepaper.cn': 'The Paper',
      'www.caixin.com': 'Caixin',
      'finance.caixin.com': 'Caixin Finance',
      'www.xinhuanet.com': 'Xinhua',
      'news.xinhuanet.com': 'Xinhua',
      'www.chinadaily.com.cn': 'China Daily',
      'www.bjnews.com.cn': 'Beijing News',
      'www.163.com': 'NetEase',
      'www.sohu.com': 'Sohu',
      'jjckb.xinhuanet.com': 'Economic Information Daily',
      'www.charltonslaw.com': 'Charltons Law',
    };
    return publishers[hostname] || hostname;
  } catch {
    return 'Unknown';
  }
}
