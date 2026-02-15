import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool as PgPool } from 'pg';

// Create pg-mem database and mock pool before importing reports-db
let memPool: PgPool;

function createMemPool() {
  const db = newDb();
  // pg-mem adaptor that mimics pg.Pool
  const pool = db.adapters.createPg().Pool;
  return new pool() as unknown as PgPool;
}

// Mock the db/index.js module to use pg-mem pool
vi.mock('../db/index.js', () => {
  return {
    get pool() {
      return memPool;
    },
  };
});

// Import after mock is set up
import {
  initReportsDb,
  saveReport, getReport, listReports,
  updateFindingVerdict, addMissedFlag, saveEditedReport,
  setQualityRating, listChangelog, addChangelogEntry,
  getStats, getSourceRanking, getLearnings,
  type SaveReportInput,
} from '../reports-db.js';

const sampleReport: SaveReportInput = {
  runId: 'test-run-1',
  subjectName: '許楚家',
  screenedAt: '2026-02-09T10:00:00Z',
  language: 'zh',
  nameVariations: ['许楚家', '許楚家'],
  findings: [
    { severity: 'RED', headline: 'ICAC Investigation', eventType: 'regulatory_investigation', summary: 'Subject investigated for bribery', dateRange: '2015-2017', sourceCount: 3, sourceUrls: [{ url: 'https://caixin.com/article1', title: 'ICAC probe' }] },
    { severity: 'AMBER', headline: 'Civil dispute', eventType: 'civil_litigation', summary: 'Contract dispute', dateRange: '2020', sourceCount: 1, sourceUrls: [{ url: 'https://scmp.com/article2', title: 'Lawsuit filed' }] },
  ],
  reportMarkdown: '# 許楚家\n\nAccording to Caixin...',
  costUsd: 0.42,
  durationMs: 180000,
  queriesExecuted: 28,
  totalSearchResults: 487,
};

describe('Reports Database (PostgreSQL)', () => {
  beforeEach(async () => {
    // Create a fresh in-memory Postgres for each test
    memPool = createMemPool();
    await initReportsDb();
  });

  afterEach(async () => {
    if (memPool) {
      await memPool.end();
    }
  });

  // --- Schema ---

  it('should create all tables on init', async () => {
    // Verify tables exist by querying them (pg-mem doesn't support pg_tables)
    for (const table of ['dd_reports', 'dd_findings', 'dd_missed_flags', 'dd_sources', 'dd_learning_rules', 'dd_changelog']) {
      const { rows } = await memPool.query(`SELECT count(*) as c FROM ${table}`);
      expect(parseInt(rows[0].c)).toBe(0);
    }
  });

  // --- CRUD ---

  it('should save and retrieve a report', async () => {
    const id = await saveReport(sampleReport);
    expect(id).toBeGreaterThan(0);

    const report = await getReport(id);
    expect(report).not.toBeNull();
    expect(report!.subject_name).toBe('許楚家');
    expect(report!.finding_count).toBe(2);
    expect(report!.red_count).toBe(1);
    expect(report!.amber_count).toBe(1);
    expect(report!.report_markdown).toContain('許楚家');
  });

  it('should save findings linked to report', async () => {
    const id = await saveReport(sampleReport);
    const report = await getReport(id);
    expect(report!.findings).toHaveLength(2);
    expect(report!.findings[0].headline).toBe('ICAC Investigation');
    expect(report!.findings[0].severity).toBe('RED');
  });

  it('should list reports with pagination', async () => {
    await saveReport(sampleReport);
    await saveReport({ ...sampleReport, runId: 'test-run-2', subjectName: 'John Smith' });

    const result = await listReports({ limit: 10, offset: 0 });
    expect(result.reports).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('should search reports via ILIKE', async () => {
    await saveReport(sampleReport);
    await saveReport({ ...sampleReport, runId: 'test-run-2', subjectName: 'John Smith', reportMarkdown: '# John Smith\nNo issues found.' });

    const results = await listReports({ search: '許楚家' });
    expect(results.reports).toHaveLength(1);
    expect(results.reports[0].subject_name).toBe('許楚家');
  });

  // --- Review operations ---

  it('should update finding verdict to CONFIRMED', async () => {
    const reportId = await saveReport(sampleReport);
    const report = await getReport(reportId);
    const findingId = report!.findings[0].id;

    await updateFindingVerdict(findingId, 'CONFIRMED');
    const updated = await getReport(reportId);
    expect(updated!.findings[0].human_verdict).toBe('CONFIRMED');
  });

  it('should update finding verdict to WRONG with reason', async () => {
    const reportId = await saveReport(sampleReport);
    const report = await getReport(reportId);
    const findingId = report!.findings[0].id;

    await updateFindingVerdict(findingId, 'WRONG', 'name_collision');
    const updated = await getReport(reportId);
    expect(updated!.findings[0].human_verdict).toBe('WRONG');
    expect(updated!.findings[0].wrong_reason).toBe('name_collision');
  });

  it('should add a missed flag', async () => {
    const reportId = await saveReport(sampleReport);
    await addMissedFlag(reportId, { description: 'Subject is on OFAC sanctions list', severity: 'RED', eventType: 'sanctions' });

    const report = await getReport(reportId);
    expect(report!.missed_flags).toHaveLength(1);
    expect(report!.missed_flags[0].description).toContain('OFAC');
  });

  it('should save edited report and compute edit distance', async () => {
    const reportId = await saveReport(sampleReport);
    const editedMarkdown = '# 許楚家\n\nAccording to Caixin, the subject was investigated by ICAC. Additional context here.';

    await saveEditedReport(reportId, editedMarkdown);
    const report = await getReport(reportId);
    expect(report!.edited_markdown).toBe(editedMarkdown);
    expect(report!.edit_distance).toBeGreaterThan(0);
    expect(report!.edit_distance).toBeLessThan(1);
  });

  // --- Stats ---

  it('should compute accuracy stats', async () => {
    const reportId = await saveReport(sampleReport);
    const report = await getReport(reportId);

    await updateFindingVerdict(report!.findings[0].id, 'CONFIRMED');
    await updateFindingVerdict(report!.findings[1].id, 'WRONG', 'name_collision');
    await addMissedFlag(reportId, { description: 'Missed sanctions', severity: 'RED' });

    const stats = await getStats();
    expect(stats.totalReports).toBe(1);
    expect(stats.totalFindings).toBe(2);
    expect(stats.confirmed).toBe(1);
    expect(stats.wrong).toBe(1);
    expect(stats.missed).toBe(1);
    expect(stats.accuracy).toBeCloseTo(0.5);
  });

  it('should rank sources by reliability', async () => {
    await saveReport(sampleReport);
    const report = await getReport(1);
    await updateFindingVerdict(report!.findings[0].id, 'CONFIRMED');
    await updateFindingVerdict(report!.findings[1].id, 'WRONG');

    const ranking = await getSourceRanking(10);
    expect(ranking.length).toBeGreaterThan(0);
    const caixin = ranking.find(s => s.domain === 'caixin.com');
    expect(caixin).toBeDefined();
    expect(caixin!.reliability_score).toBe(1.0);
  });

  it('should generate learnings from feedback patterns', async () => {
    for (let i = 0; i < 5; i++) {
      const id = await saveReport({ ...sampleReport, runId: `run-${i}` });
      const r = await getReport(id);
      await updateFindingVerdict(r!.findings[1].id, 'WRONG', 'name_collision');
    }

    const learnings = await getLearnings();
    expect(learnings.wrongPatterns.length).toBeGreaterThan(0);
    expect(learnings.wrongPatterns[0].reason).toBe('name_collision');
    expect(learnings.wrongPatterns[0].count).toBe(5);
  });

  // --- Quality rating ---

  it('should set and retrieve quality rating', async () => {
    const reportId = await saveReport(sampleReport);
    await setQualityRating(reportId, 7);
    const report = await getReport(reportId);
    expect(report!.quality_rating).toBe(7);
  });

  it('should include avgQualityRating in stats', async () => {
    const id1 = await saveReport(sampleReport);
    const id2 = await saveReport({ ...sampleReport, runId: 'test-run-2', subjectName: 'Test 2' });
    await setQualityRating(id1, 6);
    await setQualityRating(id2, 8);
    const stats = await getStats();
    expect(stats.avgQualityRating).toBe(7);
  });

  // --- Changelog ---

  it('should create changelog table on init', async () => {
    const { rows } = await memPool.query('SELECT count(*) as c FROM dd_changelog');
    expect(parseInt(rows[0].c)).toBe(0);
  });

  it('should add and list changelog entries', async () => {
    const id = await addChangelogEntry('2026-02-15', 'Improved report prompt specificity', 'prompt');
    expect(id).toBeGreaterThan(0);

    const entries = await listChangelog();
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toContain('specificity');
    expect(entries[0].category).toBe('prompt');
  });

  // --- Upsert ---

  it('should upsert on duplicate run_id', async () => {
    await saveReport(sampleReport);
    // Same runId, updated data
    await saveReport({ ...sampleReport, costUsd: 0.99 });

    const result = await listReports();
    expect(result.total).toBe(1);
    const report = await getReport(result.reports[0].id);
    expect(report!.cost_usd).toBe(0.99);
  });
});
