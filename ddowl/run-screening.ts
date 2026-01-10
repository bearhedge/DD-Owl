/**
 * DD Owl Screening Runner
 *
 * Usage: SERPER_API_KEY=xxx KIMI_API_KEY=xxx npx tsx run-screening.ts "陈玉兴"
 */

import { runScreening, generateReport } from './src/screener.js';
import { pool } from './src/db.js';

const subjectName = process.argv[2];

if (!subjectName) {
  console.error('Usage: npx tsx run-screening.ts "Subject Name"');
  console.error('Example: npx tsx run-screening.ts "陈玉兴"');
  process.exit(1);
}

if (!process.env.SERPER_API_KEY) {
  console.error('SERPER_API_KEY environment variable required');
  process.exit(1);
}

if (!process.env.KIMI_API_KEY) {
  console.error('KIMI_API_KEY environment variable required');
  process.exit(1);
}

async function main() {
  console.log('═'.repeat(60));
  console.log('DD OWL SCREENING');
  console.log('═'.repeat(60));
  console.log(`Subject: ${subjectName}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  try {
    const result = await runScreening(subjectName, (progress) => {
      switch (progress.type) {
        case 'search':
          console.log(`\n[SEARCH ${progress.searchIndex}/${progress.totalSearches}] ${progress.currentQuery}`);
          break;
        case 'fetch':
          // Quiet - too many fetches
          break;
        case 'extract':
          console.log(`  [EXTRACT] ${new URL(progress.url!).hostname}`);
          break;
        case 'issue':
          const color = progress.severity === 'RED' ? '\x1b[31m' : '\x1b[33m';
          console.log(`  ${color}[${progress.severity}] ${progress.issueTitle}\x1b[0m`);
          break;
        case 'complete':
          console.log(`\n[COMPLETE] Found ${progress.totalIssues} issues (${progress.redCount} RED, ${progress.amberCount} AMBER)`);
          break;
        case 'error':
          console.error(`\n[ERROR] ${progress.message}`);
          break;
      }
    });

    // Generate and print report
    console.log('\n');
    const report = generateReport(result);
    console.log(report);

    // Print database info
    console.log('\n');
    console.log('Database Records Created:');
    console.log(`  Screening ID: ${result.screeningId}`);
    console.log(`  Issues: ${result.issues.length}`);
    console.log(`  Total sources: ${result.issues.reduce((sum, i) => sum + i.sources.length, 0)}`);

  } catch (error) {
    console.error('Screening failed:', error);
  } finally {
    await pool.end();
  }
}

main();
