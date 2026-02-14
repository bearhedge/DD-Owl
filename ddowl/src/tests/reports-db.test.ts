import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initReportsDb, getReportsDb, closeReportsDb,
  saveReport, getReport, listReports,
  updateFindingVerdict, addMissedFlag, saveEditedReport,
  setQualityRating, listChangelog, addChangelogEntry,
  getStats, getSourceRanking, getLearnings,
  type SaveReportInput,
} from '../reports-db.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(import.meta.dirname, '../../data/test-reports.db');

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

describe('Reports Database', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    initReportsDb(TEST_DB_PATH);
  });

  afterEach(() => {
    closeReportsDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    // Clean up WAL files
    for (const ext of ['-wal', '-shm']) {
      const p = TEST_DB_PATH + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  // --- Schema ---

  it('should create all tables on init', () => {
    const db = getReportsDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('reports');
    expect(names).toContain('findings');
    expect(names).toContain('missed_flags');
    expect(names).toContain('sources');
    expect(names).toContain('learning_rules');
  });

  it('should enable WAL mode', () => {
    const db = getReportsDb();
    const result = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
  });

  // --- CRUD ---

  it('should save and retrieve a report', () => {
    const id = saveReport(sampleReport);
    expect(id).toBeGreaterThan(0);

    const report = getReport(id);
    expect(report).not.toBeNull();
    expect(report!.subject_name).toBe('許楚家');
    expect(report!.finding_count).toBe(2);
    expect(report!.red_count).toBe(1);
    expect(report!.amber_count).toBe(1);
    expect(report!.report_markdown).toContain('許楚家');
  });

  it('should save findings linked to report', () => {
    const id = saveReport(sampleReport);
    const report = getReport(id)!;
    expect(report.findings).toHaveLength(2);
    expect(report.findings[0].headline).toBe('ICAC Investigation');
    expect(report.findings[0].severity).toBe('RED');
  });

  it('should list reports with pagination', () => {
    saveReport(sampleReport);
    saveReport({ ...sampleReport, runId: 'test-run-2', subjectName: 'John Smith' });

    const result = listReports({ limit: 10, offset: 0 });
    expect(result.reports).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('should search reports via FTS', () => {
    saveReport(sampleReport);
    saveReport({ ...sampleReport, runId: 'test-run-2', subjectName: 'John Smith', reportMarkdown: '# John Smith\nNo issues found.' });

    const results = listReports({ search: '許楚家' });
    expect(results.reports).toHaveLength(1);
    expect(results.reports[0].subject_name).toBe('許楚家');
  });

  // --- Review operations ---

  it('should update finding verdict to CONFIRMED', () => {
    const reportId = saveReport(sampleReport);
    const report = getReport(reportId)!;
    const findingId = report.findings[0].id;

    updateFindingVerdict(findingId, 'CONFIRMED');
    const updated = getReport(reportId)!;
    expect(updated.findings[0].human_verdict).toBe('CONFIRMED');
  });

  it('should update finding verdict to WRONG with reason', () => {
    const reportId = saveReport(sampleReport);
    const report = getReport(reportId)!;
    const findingId = report.findings[0].id;

    updateFindingVerdict(findingId, 'WRONG', 'name_collision');
    const updated = getReport(reportId)!;
    expect(updated.findings[0].human_verdict).toBe('WRONG');
    expect(updated.findings[0].wrong_reason).toBe('name_collision');
  });

  it('should add a missed flag', () => {
    const reportId = saveReport(sampleReport);
    addMissedFlag(reportId, { description: 'Subject is on OFAC sanctions list', severity: 'RED', eventType: 'sanctions' });

    const report = getReport(reportId)!;
    expect(report.missed_flags).toHaveLength(1);
    expect(report.missed_flags[0].description).toContain('OFAC');
  });

  it('should save edited report and compute edit distance', () => {
    const reportId = saveReport(sampleReport);
    const editedMarkdown = '# 許楚家\n\nAccording to Caixin, the subject was investigated by ICAC. Additional context here.';

    saveEditedReport(reportId, editedMarkdown);
    const report = getReport(reportId)!;
    expect(report.edited_markdown).toBe(editedMarkdown);
    expect(report.edit_distance).toBeGreaterThan(0);
    expect(report.edit_distance).toBeLessThan(1);
  });

  // --- Stats ---

  it('should compute accuracy stats', () => {
    const reportId = saveReport(sampleReport);
    const report = getReport(reportId)!;

    updateFindingVerdict(report.findings[0].id, 'CONFIRMED');
    updateFindingVerdict(report.findings[1].id, 'WRONG', 'name_collision');
    addMissedFlag(reportId, { description: 'Missed sanctions', severity: 'RED' });

    const stats = getStats();
    expect(stats.totalReports).toBe(1);
    expect(stats.totalFindings).toBe(2);
    expect(stats.confirmed).toBe(1);
    expect(stats.wrong).toBe(1);
    expect(stats.missed).toBe(1);
    expect(stats.accuracy).toBeCloseTo(0.5);
  });

  it('should rank sources by reliability', () => {
    saveReport(sampleReport);
    const report = getReport(1)!;
    updateFindingVerdict(report.findings[0].id, 'CONFIRMED');
    updateFindingVerdict(report.findings[1].id, 'WRONG');

    const ranking = getSourceRanking(10);
    expect(ranking.length).toBeGreaterThan(0);
    const caixin = ranking.find(s => s.domain === 'caixin.com');
    expect(caixin).toBeDefined();
    expect(caixin!.reliability_score).toBe(1.0);
  });

  it('should generate learnings from feedback patterns', () => {
    for (let i = 0; i < 5; i++) {
      const id = saveReport({ ...sampleReport, runId: `run-${i}` });
      const r = getReport(id)!;
      updateFindingVerdict(r.findings[1].id, 'WRONG', 'name_collision');
    }

    const learnings = getLearnings();
    expect(learnings.wrongPatterns.length).toBeGreaterThan(0);
    expect(learnings.wrongPatterns[0].reason).toBe('name_collision');
    expect(learnings.wrongPatterns[0].count).toBe(5);
  });

  // --- Quality rating ---

  it('should set and retrieve quality rating', () => {
    const reportId = saveReport(sampleReport);
    setQualityRating(reportId, 7);
    const report = getReport(reportId)!;
    expect(report.quality_rating).toBe(7);
  });

  it('should include avgQualityRating in stats', () => {
    const id1 = saveReport(sampleReport);
    const id2 = saveReport({ ...sampleReport, runId: 'test-run-2', subjectName: 'Test 2' });
    setQualityRating(id1, 6);
    setQualityRating(id2, 8);
    const stats = getStats();
    expect(stats.avgQualityRating).toBe(7);
  });

  // --- Changelog ---

  it('should create changelog table on init', () => {
    const db = getReportsDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain('changelog');
  });

  it('should add and list changelog entries', () => {
    const id = addChangelogEntry('2026-02-15', 'Improved report prompt specificity', 'prompt');
    expect(id).toBeGreaterThan(0);

    const entries = listChangelog();
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toContain('specificity');
    expect(entries[0].category).toBe('prompt');
  });
});
