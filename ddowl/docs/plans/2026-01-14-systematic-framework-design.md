# DD Owl Systematic Framework Design

## Core Philosophy
**Optimize for RECALL** - Never miss an adverse finding. False positives are acceptable (analyst reviews them). False negatives are not.

---

## System Architecture

### 1. Data Flow
```
Subject Input
    ↓
┌─────────────────────────────────────────┐
│  SEARCH FRAMEWORK                       │
│  - Domain taxonomy (which sites matter) │
│  - Dirty word categories                │
│  - Subject-adaptive strategies          │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  SEARCH EXECUTION                       │
│  - Google (Serper API)                  │
│  - Baidu (SerpAPI)                      │
│  - Direct site searches                 │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  TRIAGE & ANALYSIS                      │
│  - LLM classification                   │
│  - Content fetching                     │
│  - Deduplication                        │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  LOGGING & BENCHMARKING                 │
│  - Complete event log (GCS)             │
│  - Metrics tracking                     │
│  - Comparison vs expected findings      │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  FEEDBACK LOOP                          │
│  - Human marks TP/FP/FN                 │
│  - System learns which sources work     │
│  - Dirty words effectiveness tracking   │
└─────────────────────────────────────────┘
```

---

## Component 1: Search Framework

### Domain Taxonomy
Categorize sources by **authority level** and **region**:

```typescript
// src/domains.ts
export const DOMAIN_TAXONOMY = {
  // Tier 1: Regulatory/Official (MUST search)
  regulatory: {
    hk: ['hkexnews.hk', 'sfc.hk', 'hkma.gov.hk', 'icris.cr.gov.hk'],
    cn: ['csrc.gov.cn', 'safe.gov.cn', 'pboc.gov.cn', 'samr.gov.cn'],
    global: ['sec.gov', 'fca.org.uk', 'ofac.treasury.gov']
  },

  // Tier 2: Financial News (HIGH value)
  financial_news: {
    hk: ['hkej.com', 'aastocks.com', 'etnet.com.hk'],
    cn: ['caixin.com', 'yicai.com', '21jingji.com', 'nbd.com.cn'],
    global: ['reuters.com', 'bloomberg.com', 'ft.com']
  },

  // Tier 3: General News (MEDIUM value)
  general_news: {
    hk: ['scmp.com', 'thestandard.com.hk'],
    cn: ['sina.com.cn', 'sohu.com', '163.com', 'qq.com'],
    global: ['bbc.com', 'nytimes.com']
  },

  // Tier 4: Social/Discussion (needs verification)
  social: {
    cn: ['zhihu.com', 'weibo.com', 'tieba.baidu.com'],
    hk: ['lihkg.com', 'discuss.com.hk']
  },

  // Tier 5: Archives (historical)
  archives: {
    hk: ['collection.news'],  // Apple Daily archive
    cn: ['web.archive.org']
  },

  // Tier 6: Corporate Registries
  registries: {
    hk: ['icris.cr.gov.hk'],
    cn: ['gsxt.gov.cn', 'qixin.com', 'tianyancha.com', 'qichacha.com']
  }
};
```

### Dirty Word Categories
Organize by **issue type**, not random lists:

```typescript
// src/dirtywords.ts
export const DIRTY_WORD_CATEGORIES = {
  // Category 1: Criminal
  criminal: {
    zh_simplified: ['贪污', '受贿', '行贿', '诈骗', '侵占', '挪用', '盗窃', '洗钱'],
    zh_traditional: ['貪污', '受賄', '行賄', '詐騙', '侵占', '挪用', '盜竊', '洗錢'],
    english: ['corruption', 'bribery', 'fraud', 'embezzlement', 'theft', 'money laundering']
  },

  // Category 2: Financial Misconduct
  financial: {
    zh_simplified: ['内幕交易', '操纵股价', '非法集资', '虚假陈述', '财务造假'],
    zh_traditional: ['內幕交易', '操縱股價', '非法集資', '虛假陳述', '財務造假'],
    english: ['insider trading', 'market manipulation', 'illegal fundraising', 'accounting fraud']
  },

  // Category 3: Regulatory Actions
  regulatory: {
    zh_simplified: ['证监会', '处罚', '罚款', '警告', '禁入', '吊销', '撤销'],
    zh_traditional: ['證監會', '處罰', '罰款', '警告', '禁入', '吊銷', '撤銷'],
    english: ['SFC', 'SEC', 'penalty', 'fine', 'ban', 'revoke', 'sanction']
  },

  // Category 4: Legal Proceedings
  legal: {
    zh_simplified: ['起诉', '判决', '审判', '拘留', '逮捕', '监禁', '缓刑'],
    zh_traditional: ['起訴', '判決', '審判', '拘留', '逮捕', '監禁', '緩刑'],
    english: ['prosecution', 'verdict', 'trial', 'arrest', 'detention', 'imprisonment']
  },

  // Category 5: Corporate Issues
  corporate: {
    zh_simplified: ['破产', '清算', '债务', '违约', '重组', '停牌', '除牌'],
    zh_traditional: ['破產', '清算', '債務', '違約', '重組', '停牌', '除牌'],
    english: ['bankruptcy', 'liquidation', 'default', 'restructuring', 'delisting']
  },

  // Category 6: Sanctions/Blacklists
  sanctions: {
    zh_simplified: ['制裁', '黑名单', '资产冻结', '禁令', '失信'],
    zh_traditional: ['制裁', '黑名單', '資產凍結', '禁令', '失信'],
    english: ['sanction', 'blacklist', 'asset freeze', 'OFAC', 'SDN']
  }
};
```

---

## Component 2: Logging & Benchmarking

### Log Storage (Google Cloud Storage)
```typescript
// src/logging.ts
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucket = storage.bucket('ddowl-logs');

export async function saveScreeningLog(log: ScreeningLog): Promise<string> {
  const filename = `screenings/${log.subject}/${log.runId}.json`;
  const file = bucket.file(filename);

  await file.save(JSON.stringify(log, null, 2), {
    contentType: 'application/json',
    metadata: {
      subject: log.subject,
      timestamp: log.timestamp,
      redCount: log.stats.red.toString(),
      amberCount: log.stats.amber.toString()
    }
  });

  return `gs://ddowl-logs/${filename}`;
}
```

### Benchmark Test Cases
```typescript
// src/benchmarks.ts
interface BenchmarkCase {
  subject: string;
  expectedFindings: {
    headline: string;
    severity: 'RED' | 'AMBER';
    keywords: string[];  // Key terms that should appear
  }[];
}

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    subject: '许楚家',
    expectedFindings: [
      {
        headline: 'Yang Xiancai corruption case involvement',
        severity: 'RED',
        keywords: ['杨贤才', '腐败', '司法']
      },
      {
        headline: 'Jingxuan Hotel violent seizure',
        severity: 'RED',
        keywords: ['京轩酒店', '暴力', '强占']
      },
      {
        headline: 'Xinno Technology Park debt dispute',
        severity: 'AMBER',
        keywords: ['信诺科技园', '3.37亿', '债务']
      },
      {
        headline: 'SFC concentration warning',
        severity: 'AMBER',
        keywords: ['证监会', '股权集中', '警告']
      },
      {
        headline: 'Hui Brothers illegal fundraising',
        severity: 'RED',
        keywords: ['汇兄弟', '非法集资']
      }
    ]
  }
];
```

### Metrics Tracking
```typescript
// src/metrics.ts
interface ScreeningMetrics {
  runId: string;
  subject: string;
  timestamp: string;

  // Search metrics
  totalQueries: number;
  totalResultsFound: number;
  uniqueUrlsProcessed: number;

  // Classification metrics
  triageRed: number;
  triageYellow: number;
  triageGreen: number;

  // Analysis metrics
  contentFetchSuccess: number;
  contentFetchFailed: number;
  analysisCompleted: number;

  // Output metrics
  finalRed: number;
  finalAmber: number;
  consolidationRatio: number;  // before/after dedup

  // Benchmark metrics (if test case exists)
  expectedFindings?: number;
  foundExpected?: number;
  recall?: number;  // foundExpected / expectedFindings
  falsePositives?: number;
  precision?: number;  // truePositives / (truePositives + falsePositives)
  f1Score?: number;
}
```

---

## Component 3: Feedback Loop

### Human Review Interface
Add to the UI:
- Each finding has "Correct" / "Incorrect" buttons
- Track which findings are TP (true positive) vs FP (false positive)
- Track missed findings (FN - false negative) via manual input

### Learning System
```typescript
// src/learning.ts
interface FeedbackRecord {
  runId: string;
  findingUrl: string;
  humanVerdict: 'TP' | 'FP' | 'FN';
  searchQuery: string;      // Which query found this
  sourcesDomain: string;    // Which domain
  dirtyWordsUsed: string[]; // Which dirty words matched
  timestamp: string;
}

// Aggregate feedback to improve search
interface SourceEffectiveness {
  domain: string;
  totalHits: number;
  truePositives: number;
  falsePositives: number;
  precision: number;
}

interface DirtyWordEffectiveness {
  word: string;
  category: string;
  totalHits: number;
  truePositives: number;
  falsePositives: number;
  precision: number;
}
```

---

## KPIs Dashboard

### Primary Metrics
| Metric | Definition | Target |
|--------|------------|--------|
| **Recall** | % of known findings captured | >95% |
| **Precision** | % of flags that are true positives | >70% |
| **F1 Score** | Harmonic mean of precision/recall | >80% |
| **Coverage** | % of target domains searched | 100% |

### Secondary Metrics
| Metric | Definition | Target |
|--------|------------|--------|
| Search depth | Avg pages per query | 5+ |
| Content fetch rate | % of URLs successfully fetched | >80% |
| Processing time | Time to complete screening | <15 min |
| Consolidation ratio | Findings before/after dedup | <3x |

---

## Implementation Phases

### Phase 1: Foundation (This Week)
- [ ] Set up GCS bucket for logs
- [ ] Implement log saving to GCS
- [ ] Create log viewer API endpoint
- [ ] Add benchmark test cases

### Phase 2: Search Framework (Next Week)
- [ ] Implement domain taxonomy
- [ ] Restructure dirty words by category
- [ ] Create query builder using framework
- [ ] Add all Tier 1-3 domains

### Phase 3: Metrics & Feedback (Week After)
- [ ] Implement metrics tracking
- [ ] Add benchmark comparison
- [ ] Build feedback UI (TP/FP buttons)
- [ ] Create KPI dashboard

### Phase 4: Learning Loop (Ongoing)
- [ ] Track source effectiveness
- [ ] Track dirty word effectiveness
- [ ] Auto-adjust search strategies
- [ ] Continuous improvement

---

## Files Structure

```
ddowl/
├── src/
│   ├── framework/
│   │   ├── domains.ts        # Domain taxonomy
│   │   ├── dirtywords.ts     # Dirty word categories
│   │   ├── strategy.ts       # Subject-adaptive strategies
│   │   └── queryBuilder.ts   # Dynamic query generation
│   ├── logging/
│   │   ├── gcs.ts            # GCS integration
│   │   ├── logger.ts         # Screening log collector
│   │   └── viewer.ts         # Log viewing API
│   ├── metrics/
│   │   ├── tracker.ts        # Metrics collection
│   │   ├── benchmarks.ts     # Test cases
│   │   └── dashboard.ts      # KPI aggregation
│   └── feedback/
│       ├── collector.ts      # Human feedback collection
│       └── learning.ts       # Effectiveness tracking
├── data/
│   └── benchmarks/
│       └── xu-chujia.json    # Benchmark case: 许楚家
└── docs/
    └── plans/
        └── 2026-01-14-systematic-framework-design.md  # This document
```

---

## Next Steps

1. **Immediate:** Set up GCS and implement log saving
2. **Then:** Create benchmark test case for 许楚家 with known findings
3. **Then:** Run screening and measure recall
4. **Then:** Iterate on search framework to improve recall
