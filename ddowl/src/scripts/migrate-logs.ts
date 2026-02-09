import { initReportsDb, saveReport } from '../reports-db.js';
import { initLogDirectories, listScreeningLogs, loadScreeningLog } from '../logging/storage.js';

initLogDirectories();
initReportsDb();

const logs = listScreeningLogs();
console.log(`Found ${logs.length} screening logs to migrate`);

let migrated = 0;
let skipped = 0;

for (const log of logs) {
  try {
    const data = loadScreeningLog(log.subject, log.runId);
    if (!data || !data.findings || data.findings.length === 0) {
      skipped++;
      continue;
    }

    saveReport({
      runId: data.runId || data.metrics?.runId || `migrated-${Date.now()}`,
      subjectName: data.subject || log.subject,
      screenedAt: data.savedAt || data.metrics?.startTime || new Date().toISOString(),
      language: 'zh',
      nameVariations: [],
      findings: data.findings.map((f: any) => ({
        severity: f.severity || 'AMBER',
        headline: f.headline || f.title || 'Unknown',
        eventType: f.eventType || f.triageClassification || 'unknown',
        summary: f.summary || '',
        dateRange: f.dateRange,
        sourceCount: f.sourceCount || f.sources?.length || 1,
        sourceUrls: f.sources || [{ url: f.url || '', title: f.title || '' }],
      })),
      costUsd: data.metrics?.totalCostUSD || 0,
      durationMs: data.metrics?.durationMs || 0,
      queriesExecuted: data.metrics?.queriesExecuted || 0,
      totalSearchResults: data.metrics?.totalSearchResults || 0,
    });

    migrated++;
    console.log(`  Migrated: ${log.subject} (${log.runId})`);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      skipped++;
    } else {
      console.error(`  Failed: ${log.subject} (${log.runId}): ${err.message}`);
    }
  }
}

console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
