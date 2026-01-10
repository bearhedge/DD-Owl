/**
 * Test harness for iterating on LLM summary quality
 *
 * Usage: SERPER_API_KEY=xxx KIMI_API_KEY=xxx npx tsx test-subject.ts "徐明星"
 *
 * Shows full pipeline output so you can tune prompts
 */

import axios from 'axios';
import { SEARCH_TEMPLATES, buildSearchQuery, detectCategory } from './src/searchStrings.js';
import { fetchPageContent, analyzeWithLLM } from './src/analyzer.js';

const SERPER_API_KEY = process.env.SERPER_API_KEY || '';
const subjectName = process.argv[2] || '徐明星';
const MAX_RESULTS_PER_SEARCH = 3; // Limit for faster iteration

interface TestResult {
  url: string;
  title: string;
  searchTerm: string;
  category: string;
  contentLength: number;
  contentPreview: string;
  severity: 'RED' | 'AMBER' | 'GREEN';
  headline: string;
  summary: string;
}

async function search(query: string): Promise<Array<{link: string, title: string, snippet: string}>> {
  try {
    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: query, gl: 'cn', hl: 'zh-cn', num: 10 },
      { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' } }
    );
    return (response.data.organic || []).slice(0, MAX_RESULTS_PER_SEARCH);
  } catch (e) {
    console.error(`Search failed: ${query}`);
    return [];
  }
}

async function runTest() {
  console.log('='.repeat(70));
  console.log(`DD OWL TEST HARNESS - Subject: ${subjectName}`);
  console.log('='.repeat(70));
  console.log(`Search templates: ${SEARCH_TEMPLATES.length}`);
  console.log(`Results per search: ${MAX_RESULTS_PER_SEARCH}`);
  console.log('');

  const results: TestResult[] = [];
  const seenUrls = new Set<string>();

  // Test first 3 search templates for faster iteration
  const templatesToTest = SEARCH_TEMPLATES.slice(0, 3);

  for (let i = 0; i < templatesToTest.length; i++) {
    const template = templatesToTest[i];
    const query = buildSearchQuery(template, subjectName);
    const category = detectCategory(query);

    console.log('-'.repeat(70));
    console.log(`[${i + 1}/${templatesToTest.length}] SEARCH: ${query.slice(0, 60)}...`);
    console.log(`Category: ${category}`);
    console.log('-'.repeat(70));

    const searchResults = await search(query);
    console.log(`Found ${searchResults.length} results\n`);

    for (const result of searchResults) {
      if (seenUrls.has(result.link)) continue;
      seenUrls.add(result.link);

      const hostname = new URL(result.link).hostname;
      console.log(`  FETCH: ${hostname}`);
      console.log(`  Title: ${result.title.slice(0, 60)}`);

      // Fetch content
      const content = await fetchPageContent(result.link);
      console.log(`  Content: ${content.length} chars`);

      if (content.length > 50) {
        // Show content preview
        const preview = content.slice(0, 200).replace(/\n/g, ' ');
        console.log(`  Preview: "${preview}..."`);

        // Analyze with LLM
        console.log(`  ANALYZING...`);
        const analysis = await analyzeWithLLM(content, subjectName, query);

        // Color code the severity
        const severityColor = analysis.severity === 'RED' ? '\x1b[31m' :
                             analysis.severity === 'AMBER' ? '\x1b[33m' : '\x1b[32m';
        console.log(`  ${severityColor}SEVERITY: ${analysis.severity}\x1b[0m`);
        if (analysis.headline) {
          console.log(`  HEADLINE: ${analysis.headline}`);
        }
        console.log(`  SUMMARY: ${analysis.summary}`);

        results.push({
          url: result.link,
          title: result.title,
          searchTerm: query,
          category,
          contentLength: content.length,
          contentPreview: preview,
          severity: analysis.severity,
          headline: analysis.headline,
          summary: analysis.summary,
        });
      } else {
        console.log(`  SKIPPED: Content too short`);
      }

      console.log('');
    }
  }

  // Summary
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const red = results.filter(r => r.severity === 'RED');
  const amber = results.filter(r => r.severity === 'AMBER');
  const green = results.filter(r => r.severity === 'GREEN');

  console.log(`Total analyzed: ${results.length}`);
  console.log(`\x1b[31mRED:   ${red.length}\x1b[0m`);
  console.log(`\x1b[33mAMBER: ${amber.length}\x1b[0m`);
  console.log(`\x1b[32mGREEN: ${green.length}\x1b[0m`);

  if (red.length > 0) {
    console.log('\n--- RED FLAGS ---');
    red.forEach(r => {
      console.log(`\n[${r.category}] ${new URL(r.url).hostname}`);
      if (r.headline) console.log(`Headline: ${r.headline}`);
      console.log(`Summary: ${r.summary}`);
      console.log(`Source: ${r.url}`);
    });
  }

  if (amber.length > 0) {
    console.log('\n--- AMBER FLAGS ---');
    amber.forEach(r => {
      console.log(`\n[${r.category}] ${new URL(r.url).hostname}`);
      if (r.headline) console.log(`Headline: ${r.headline}`);
      console.log(`Summary: ${r.summary}`);
      console.log(`Source: ${r.url}`);
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log('To iterate on prompts, edit: src/analyzer.ts (analyzeWithLLM function)');
  console.log('='.repeat(70));
}

runTest().catch(console.error);
