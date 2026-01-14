import { BenchmarkCase, BenchmarkResult, ConsolidatedFinding } from '../types.js';

// Benchmark cases with known issues
export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    subject: '许楚家',
    type: 'person',
    region: 'hk',
    expectedIssues: [
      {
        description: 'Yang Xiancai corruption case involvement',
        keywords: ['杨贤才', '腐败', '司法', '贿赂'],
        severity: 'RED',
      },
      {
        description: 'Jingxuan Hotel violent seizure',
        keywords: ['京轩酒店', '暴力', '强占', '打砸'],
        severity: 'RED',
      },
      {
        description: 'Xinno Technology Park debt dispute',
        keywords: ['信诺科技园', '3.37亿', '债务', '纠纷'],
        severity: 'AMBER',
      },
      {
        description: 'SFC concentration warning',
        keywords: ['证监会', '股权集中', '警告', 'SFC'],
        severity: 'AMBER',
      },
      {
        description: 'Hui Brothers illegal fundraising',
        keywords: ['汇兄弟', '非法集资', '诈骗'],
        severity: 'RED',
      },
    ],
  },
];

// Find benchmark case by subject
export function getBenchmarkCase(subject: string): BenchmarkCase | undefined {
  return BENCHMARK_CASES.find(c => c.subject === subject);
}

// Evaluate screening results against benchmark
export function evaluateBenchmark(
  subject: string,
  findings: ConsolidatedFinding[],
  runId: string
): BenchmarkResult | null {
  const benchmark = getBenchmarkCase(subject);
  if (!benchmark) return null;

  const matchedIssues: string[] = [];
  const missedIssues: string[] = [];

  // Check each expected issue
  for (const expected of benchmark.expectedIssues) {
    const found = findings.some(finding => {
      // Check if any keyword appears in headline or summary
      const text = `${finding.headline} ${finding.summary}`.toLowerCase();
      return expected.keywords.some(kw => text.includes(kw.toLowerCase()));
    });

    if (found) {
      matchedIssues.push(expected.description);
    } else {
      missedIssues.push(expected.description);
    }
  }

  const recall = benchmark.expectedIssues.length > 0
    ? matchedIssues.length / benchmark.expectedIssues.length
    : 1;

  return {
    subject,
    runId,
    timestamp: new Date().toISOString(),
    expectedCount: benchmark.expectedIssues.length,
    foundCount: matchedIssues.length,
    recall: Math.round(recall * 100) / 100,
    matchedIssues,
    missedIssues,
  };
}
