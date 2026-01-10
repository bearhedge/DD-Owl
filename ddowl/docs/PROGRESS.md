# DD Owl - Development Progress

## Current State (January 2026)

### What We Built

**DD Owl** is an automated L0 due diligence screening tool that:
1. Takes a Chinese name as input
2. Runs 16 search templates with adverse terms (insider trading, fraud, corruption, etc.)
3. Fetches and analyzes articles from Chinese news sources
4. Produces investment bank-quality DD reports with footnote citations

### Architecture

```
Input (Name) → Search (Serper API) → Fetch (axios + Puppeteer) → Extract (Kimi LLM) → Report
```

### Key Components

| File | Purpose |
|------|---------|
| `src/server.ts` | Express server with V1 and V2 API endpoints |
| `src/searcher.ts` | Google search via Serper API (10 pages per query) |
| `src/analyzer.ts` | Web scraping with encoding detection (GB2312/GBK support) |
| `src/extract.ts` | Two-pass extraction: relevance check → narrative writing |
| `src/searchStrings.ts` | 16 search templates with Chinese adverse terms |

### Deployed

- **URL**: https://ddowl-397870885229.asia-east1.run.app
- **V2 Endpoint**: `/api/screen/v2?name=陈玉兴`
- **Region**: asia-east1 (Cloud Run)

### Features Implemented

1. **Hybrid Scraping**: axios-first with Puppeteer fallback (100% coverage)
2. **Chinese Encoding**: Proper GB2312/GBK detection and decoding
3. **Deduplication**: Same issue from multiple sources → consolidated into one
4. **Footnote Citations**: Every fact cited with `^1^` style footnotes
5. **Source Synthesis**: LLM combines multiple sources into one narrative

### Report Output Format

```
ISSUE 1: INSIDER_TRADING

HEADLINE: Convicted of insider trading (2008), sentenced to 2.5 years imprisonment

Chen Yuxing was convicted of insider trading.^1^ He was sentenced to 2.5 years
in prison and fined CNY 40.37 million.^2^ Co-conspirators included Wang Xiangdong
(王向东) and Luo Gaofeng (罗高峰).^1,3^

**Sources:**
1. [Sina News](https://news.sina.com.cn/...)
2. [Charltons Law Newsletter](https://www.charltonslaw.com/...)
3. [Economic Information Daily](http://jjckb.xinhuanet.com/...)
```

### Database (GCP PostgreSQL)

- **Host**: 35.194.142.132
- **Database**: ddowl
- **Tables**: Reference tables for jurisdictions, authorities, issue types (currently unused - simplified approach preferred)

### What's Working

- [x] Search all 10 pages per query (100 results)
- [x] Process all unique URLs across 16 search templates
- [x] Chinese character encoding (GB2312, GBK)
- [x] Deduplication by shared Chinese names/entities
- [x] Footnote citations at sentence level
- [x] Professional DD report format

### Known Issues / TODO

- [ ] Some Kimi API 400 errors when content is too long (need to truncate better)
- [ ] V2 endpoint can be slow (many articles to analyze)
- [ ] Frontend UI not updated for V2 report format
- [ ] No persistence of screening results to database yet

---

## HKEX IPO Tracker (In Progress)

### Purpose
Track active IPO applications on HKEX to identify BD opportunities:
- Which companies are filing for IPO
- Which banks are appointed as Sponsors/Coordinators/Bookrunners
- Lead banks = decision makers for third-party DD engagements

### Components Built

| File | Purpose |
|------|---------|
| `src/hkex-scraper.ts` | Puppeteer-based scraper for HKEX OC announcements |

### Features Implemented

1. **Disclaimer Bypass**: Puppeteer clicks "ACCEPT" button on HKEX warning page
2. **Active Applications Listing**: Scrapes yearly index for all OC announcements
3. **PDF Download**: Downloads OC announcement PDFs with session cookies
4. **Bank Extraction**: Extracts bank names and roles from PDF text:
   - Pattern matching for "has appointed X as sponsor/coordinator"
   - Role headings followed by bank names
   - Handles multi-line text

### Extraction Output

```typescript
interface OCAnnouncementData {
  company: string;
  companyChineseName?: string;
  appointmentDate: string;
  banks: BankAppointment[];
  sourceUrl: string;
}

interface BankAppointment {
  bank: string;
  role: 'Sponsor' | 'Coordinator' | 'Bookrunner' | 'Other';
  isLead: boolean;  // true if Sponsor or Coordinator
}
```

### Test Results (Jan 7, 2026)

| Company | Bank | Role |
|---------|------|------|
| BioRay Biopharmaceutical | Huatai Financial, J.P. Morgan | Sponsor |
| Hangzhou Diagens | Huatai Financial | Coordinator |
| GRANDPA'S FARM | CMB International Capital | Sponsor |

### Next Steps

- [ ] Improve company name extraction (some PDFs not parsing correctly)
- [ ] Add API endpoint for HKEX data
- [ ] Store results in database
- [ ] Add GEM board support (currently Main Board only)
- [ ] Build dashboard UI for IPO pipeline

### Environment Variables Required

```
SERPER_API_KEY=xxx
KIMI_API_KEY=xxx
```

### Test Commands

```bash
# Local test
SERPER_API_KEY=xxx KIMI_API_KEY=xxx npx tsx test-extract.ts "陈玉兴"

# Production
curl "https://ddowl-397870885229.asia-east1.run.app/api/screen/v2?name=陈玉兴"
```
