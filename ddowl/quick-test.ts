/**
 * Quick test - run only 3 search templates to validate pipeline
 */

import { buildSearchQuery, SEARCH_TEMPLATES } from './src/searchStrings.js';
import { searchAllPages } from './src/searcher.js';
import { fetchPageContent, closeBrowser } from './src/analyzer.js';
import { extractFacts, isSameIssue, mergeFacts } from './src/factExtractor.js';
import { pool, createScreening, createIssue, addIssuePeople, addIssueOrganizations, addIssueSource, ExtractedFacts, SourceInfo } from './src/db.js';

const subjectName = process.argv[2] || '陈玉兴';
const MAX_SEARCHES = 3;

async function quickTest() {
  console.log('═'.repeat(60));
  console.log('DD OWL QUICK TEST');
  console.log('═'.repeat(60));
  console.log(`Subject: ${subjectName}`);
  console.log(`Searches: ${MAX_SEARCHES}`);
  console.log('');

  const screeningId = await createScreening(subjectName);
  console.log(`Created screening #${screeningId}`);

  interface ConsolidatedIssue {
    id: number;
    facts: ExtractedFacts;
    sources: SourceInfo[];
  }

  const consolidatedIssues: ConsolidatedIssue[] = [];
  const processedUrls = new Set<string>();

  try {
    for (let i = 0; i < MAX_SEARCHES; i++) {
      const template = SEARCH_TEMPLATES[i];
      const query = buildSearchQuery(template, subjectName);

      console.log(`\n[${i + 1}/${MAX_SEARCHES}] Search: ${query.slice(0, 50)}...`);

      const results = await searchAllPages(query, 2); // 2 pages = 20 results
      console.log(`  Found ${results.length} results`);

      for (const result of results.slice(0, 5)) { // Only first 5 per search
        if (processedUrls.has(result.link)) continue;
        processedUrls.add(result.link);

        const hostname = new URL(result.link).hostname;
        console.log(`  Fetching: ${hostname}`);

        const content = await fetchPageContent(result.link);
        if (content.length < 100) {
          console.log(`    Skipped (no content)`);
          continue;
        }

        console.log(`  Extracting facts...`);
        const facts = await extractFacts(content, subjectName, result.link);

        if (!facts) {
          console.log(`    No adverse info`);
          continue;
        }

        const sourceInfo: SourceInfo = {
          url: result.link,
          title: result.title,
          publisher: hostname,
          content: content,
          fetch_method: 'axios',
        };

        // Check for existing issue
        let matched = false;
        for (const existing of consolidatedIssues) {
          if (isSameIssue(existing.facts, facts)) {
            console.log(`    Merging into: ${existing.facts.title}`);
            existing.facts = mergeFacts(existing.facts, facts);
            existing.sources.push(sourceInfo);
            matched = true;
            break;
          }
        }

        if (!matched) {
          const color = facts.severity === 'RED' ? '\x1b[31m' : '\x1b[33m';
          console.log(`    ${color}NEW ISSUE: ${facts.title} (${facts.severity})\x1b[0m`);

          const issueId = await createIssue(screeningId, facts);
          await addIssuePeople(issueId, facts.people || []);
          await addIssueOrganizations(issueId, facts.organizations || []);
          await addIssueSource(issueId, sourceInfo, facts);

          consolidatedIssues.push({ id: issueId, facts, sources: [sourceInfo] });
        }
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('RESULTS');
    console.log('═'.repeat(60));

    const redCount = consolidatedIssues.filter(i => i.facts.severity === 'RED').length;
    const amberCount = consolidatedIssues.filter(i => i.facts.severity === 'AMBER').length;

    console.log(`Issues found: ${consolidatedIssues.length}`);
    console.log(`  RED: ${redCount}`);
    console.log(`  AMBER: ${amberCount}`);

    for (const issue of consolidatedIssues) {
      console.log(`\n${issue.facts.severity === 'RED' ? '■' : '□'} ${issue.facts.title}`);
      console.log(`  Type: ${issue.facts.issue_type}`);
      console.log(`  Status: ${issue.facts.status}`);
      console.log(`  Sources: ${issue.sources.length}`);

      if (issue.facts.summary) {
        console.log(`  Summary: ${issue.facts.summary.slice(0, 200)}...`);
      }

      if (issue.facts.people && issue.facts.people.length > 0) {
        console.log(`  People:`);
        for (const p of issue.facts.people) {
          console.log(`    - ${p.name_zh} (${p.name_en || 'N/A'}): ${p.role || 'N/A'}`);
          if (p.sentence) console.log(`      Sentence: ${p.sentence}`);
        }
      }
    }

  } finally {
    await closeBrowser();
    await pool.end();
  }
}

quickTest().catch(console.error);
