import axios from 'axios';
import { ExtractedFacts, getIssueTypes, getAuthorities } from './db.js';

const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions';
const KIMI_MODEL = process.env.KIMI_MODEL || 'moonshot-v1-32k'; // Use larger context for detailed extraction

// Cache for reference data
let issueTypesCache: Array<{code: string, name_en: string, name_zh: string}> | null = null;
let authoritiesCache: Array<{name_zh: string, name_en: string, abbreviation: string}> | null = null;

async function getIssueTypesReference(): Promise<string> {
  if (!issueTypesCache) {
    issueTypesCache = await getIssueTypes();
  }
  return issueTypesCache.map(t => `${t.code}: ${t.name_en} (${t.name_zh})`).join('\n');
}

async function getAuthoritiesReference(): Promise<string> {
  if (!authoritiesCache) {
    authoritiesCache = await getAuthorities();
  }
  return authoritiesCache.map(a => `${a.name_zh} (${a.abbreviation || a.name_en})`).join(', ');
}

/**
 * Extract structured facts from article content
 */
export async function extractFacts(
  content: string,
  subjectName: string,
  sourceUrl: string
): Promise<ExtractedFacts | null> {
  if (!KIMI_API_KEY) {
    console.error('KIMI_API_KEY not configured');
    return null;
  }

  if (!content || content.length < 100) {
    return null;
  }

  const issueTypesRef = await getIssueTypesReference();
  const authoritiesRef = await getAuthoritiesReference();

  const prompt = `You are a senior due diligence analyst extracting structured facts from a Chinese news article.

SUBJECT OF INVESTIGATION: "${subjectName}"

ARTICLE CONTENT:
${content.slice(0, 12000)}

SOURCE URL: ${sourceUrl}

YOUR TASK:
1. Determine if this article contains adverse information about "${subjectName}" specifically (not someone with a similar name)
2. If YES, extract ALL factual details into the structured format below
3. If NO adverse information about the subject, return {"no_adverse_info": true}

IMPORTANT RULES:
- Only extract facts that are EXPLICITLY stated in the article
- Do NOT invent, assume, or hallucinate any details
- Include Chinese names with pinyin transliteration
- Convert all amounts to both CNY and USD (use approximate rate 1 USD = 7 CNY if not stated)
- Extract exact dates when available (format: YYYY-MM-DD or "Month YYYY")
- For authorities/regulators, use their full official Chinese name

ISSUE TYPES (use exact code):
${issueTypesRef}

KNOWN AUTHORITIES (for reference):
${authoritiesRef}

OUTPUT FORMAT (JSON only, no other text):
{
  "no_adverse_info": false,
  "issue_type": "insider_trading",  // Use code from list above
  "title": "Hangxiao Steel Structure Insider Trading Case",
  "title_zh": "杭萧钢构内幕交易案",
  "timeframe": "2007-2008",
  "status": "convicted",  // convicted|charged|alleged|investigated|settled|acquitted|ongoing|historical|unknown
  "severity": "RED",  // RED or AMBER
  "jurisdiction": "CN",  // Country code

  "events": [
    {"date": "2007-02-11", "description": "Chen Yuxing obtained insider information from Luo Gaofeng", "description_zh": "陈玉兴从罗高峰处获得内幕信息"},
    {"date": "2007-02-12", "description": "Chen Yuxing instructed Wang Xiangdong to purchase shares"}
  ],

  "people": [
    {
      "name_zh": "陈玉兴",
      "name_en": "Chen Yuxing",
      "role": "Former securities office staff, obtained insider information",
      "title": "Former employee",
      "organization": "Hangxiao Steel Structure",
      "outcome": "Convicted of illegally obtaining insider information",
      "sentence": "2.5 years imprisonment",
      "fine": "CNY 40.37 million",
      "is_subject": true
    },
    {
      "name_zh": "罗高峰",
      "name_en": "Luo Gaofeng",
      "role": "Deputy director of securities office, leaked information",
      "outcome": "Convicted of leaking insider information",
      "sentence": "1.5 years imprisonment",
      "is_subject": false
    }
  ],

  "organizations": [
    {
      "name_zh": "杭萧钢构",
      "name_en": "Hangxiao Steel Structure Co., Ltd.",
      "stock_code": "600477.SH",
      "role": "Listed company, source of insider information"
    }
  ],

  "authorities": [
    {
      "name_zh": "中国证监会",
      "name_en": "China Securities Regulatory Commission",
      "action": "Investigated and imposed administrative penalties",
      "document_number": "证监罚字[2008]XX号"
    },
    {
      "name_zh": "浙江省丽水市中级人民法院",
      "name_en": "Lishui Intermediate People's Court, Zhejiang Province",
      "action": "Criminal trial court of first instance"
    }
  ],

  "amounts": [
    {
      "description": "Illegal trading profits confiscated",
      "amount_cny": "CNY 40.37 million",
      "amount_usd": "USD 5.68 million",
      "amount_type": "profit"
    },
    {
      "description": "Fine imposed on Chen Yuxing",
      "amount_cny": "CNY 40.37 million",
      "amount_usd": "USD 5.68 million",
      "amount_type": "fine"
    }
  ],

  "legal": [
    {
      "case_number": "（2007）丽中刑初字第44号",
      "court_zh": "丽水市中级人民法院",
      "court_en": "Lishui Intermediate People's Court",
      "charge": "Illegally obtaining insider information",
      "charge_zh": "非法获取内幕信息罪",
      "verdict": "guilty",
      "verdict_date": "2008-02-04"
    }
  ],

  "summary": "Chen Yuxing was convicted of insider trading in relation to Hangxiao Steel Structure Co., Ltd. in February 2008. He obtained material non-public information about a CNY 34.4 billion contract from former colleague Luo Gaofeng and instructed Wang Xiangdong to purchase shares, resulting in illegal profits of CNY 40.37 million. Chen was sentenced to 2.5 years imprisonment and fined CNY 40.37 million.",
  "summary_zh": "陈玉兴因杭萧钢构内幕交易案于2008年2月被定罪。他从前同事罗高峰处获得关于344亿元合同的重大非公开信息，并指示王向东购买股票，获得非法利润4037万元。陈玉兴被判处有期徒刑2年6个月，并处罚金4037万元。"
}

If there is NO adverse information about "${subjectName}" in this article, return:
{"no_adverse_info": true, "reason": "Subject not mentioned" | "No adverse information found" | "Different person with similar name"}`;

  try {
    const response = await axios.post(
      KIMI_URL,
      {
        model: KIMI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KIMI_API_KEY}`,
        },
        timeout: 120000, // 2 minutes for detailed extraction
      }
    );

    const text = response.data.choices?.[0]?.message?.content || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in LLM response');
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);

    // Check if no adverse info
    if (result.no_adverse_info) {
      console.log(`No adverse info: ${result.reason || 'unknown reason'}`);
      return null;
    }

    // Validate required fields
    if (!result.issue_type || !result.title || !result.severity) {
      console.error('Missing required fields in extraction');
      return null;
    }

    return result as ExtractedFacts;
  } catch (error) {
    console.error('Fact extraction error:', error);
    return null;
  }
}

/**
 * Determine if two extracted facts represent the same issue
 */
export function isSameIssue(facts1: ExtractedFacts, facts2: ExtractedFacts): boolean {
  // Same issue type is required
  if (facts1.issue_type !== facts2.issue_type) return false;

  // Check for overlapping timeframe
  if (facts1.timeframe && facts2.timeframe) {
    // Extract years and check overlap
    const years1: string[] = facts1.timeframe.match(/\d{4}/g) || [];
    const years2: string[] = facts2.timeframe.match(/\d{4}/g) || [];
    const hasOverlap = years1.some(y => years2.includes(y));
    if (!hasOverlap) return false;
  }

  // Ensure arrays exist
  const people1Arr = facts1.people || [];
  const people2Arr = facts2.people || [];
  const orgs1Arr = facts1.organizations || [];
  const orgs2Arr = facts2.organizations || [];
  const legal1Arr = facts1.legal || [];
  const legal2Arr = facts2.legal || [];

  // Check for overlapping people (especially the subject)
  const people1 = people1Arr.map(p => p.name_zh);
  const people2 = people2Arr.map(p => p.name_zh);
  const commonPeople = people1.filter(p => people2.includes(p));
  if (commonPeople.length === 0) return false;

  // Check for overlapping organizations
  const orgs1 = orgs1Arr.map(o => o.name_zh);
  const orgs2 = orgs2Arr.map(o => o.name_zh);
  const commonOrgs = orgs1.filter(o => orgs2.includes(o));

  // If same issue type, timeframe overlap, same people, and same orgs - it's the same issue
  if (commonOrgs.length > 0) return true;

  // Check for matching case numbers
  const caseNums1 = legal1Arr.map(l => l.case_number).filter(Boolean) as string[];
  const caseNums2 = legal2Arr.map(l => l.case_number).filter(Boolean) as string[];
  const commonCases = caseNums1.filter(c => caseNums2.includes(c));
  if (commonCases.length > 0) return true;

  // Similar titles suggest same issue
  const titleSimilarity = calculateSimilarity(facts1.title.toLowerCase(), facts2.title.toLowerCase());
  if (titleSimilarity > 0.6) return true;

  return false;
}

/**
 * Merge facts from a new source into existing facts
 */
export function mergeFacts(existing: ExtractedFacts, newFacts: ExtractedFacts): ExtractedFacts {
  // Ensure arrays exist (LLM might return incomplete data)
  existing.events = existing.events || [];
  existing.people = existing.people || [];
  existing.organizations = existing.organizations || [];
  existing.authorities = existing.authorities || [];
  existing.amounts = existing.amounts || [];
  existing.legal = existing.legal || [];

  newFacts.events = newFacts.events || [];
  newFacts.people = newFacts.people || [];
  newFacts.organizations = newFacts.organizations || [];
  newFacts.authorities = newFacts.authorities || [];
  newFacts.amounts = newFacts.amounts || [];
  newFacts.legal = newFacts.legal || [];

  // Merge events (avoid duplicates by date+description)
  const existingEventKeys = new Set(existing.events.map(e => `${e.date}|${e.description}`));
  const newEvents = newFacts.events.filter(e => !existingEventKeys.has(`${e.date}|${e.description}`));
  existing.events = [...existing.events, ...newEvents];

  // Merge people (avoid duplicates by name)
  const existingPeopleNames = new Set(existing.people.map(p => p.name_zh));
  for (const person of newFacts.people) {
    if (!existingPeopleNames.has(person.name_zh)) {
      existing.people.push(person);
    } else {
      // Update existing person with new details
      const existingPerson = existing.people.find(p => p.name_zh === person.name_zh);
      if (existingPerson) {
        existingPerson.role = existingPerson.role || person.role;
        existingPerson.outcome = existingPerson.outcome || person.outcome;
        existingPerson.sentence = existingPerson.sentence || person.sentence;
        existingPerson.fine = existingPerson.fine || person.fine;
      }
    }
  }

  // Merge organizations
  const existingOrgNames = new Set(existing.organizations.map(o => o.name_zh));
  const newOrgs = newFacts.organizations.filter(o => !existingOrgNames.has(o.name_zh));
  existing.organizations = [...existing.organizations, ...newOrgs];

  // Merge authorities
  const existingAuthNames = new Set(existing.authorities.map(a => a.name_zh));
  const newAuths = newFacts.authorities.filter(a => !existingAuthNames.has(a.name_zh));
  existing.authorities = [...existing.authorities, ...newAuths];

  // Merge amounts (avoid duplicates by description)
  const existingAmountDescs = new Set(existing.amounts.map(a => a.description));
  const newAmounts = newFacts.amounts.filter(a => !existingAmountDescs.has(a.description));
  existing.amounts = [...existing.amounts, ...newAmounts];

  // Merge legal (avoid duplicates by case number)
  const existingCaseNums = new Set(existing.legal.map(l => l.case_number).filter(Boolean));
  const newLegal = newFacts.legal.filter(l => !l.case_number || !existingCaseNums.has(l.case_number));
  existing.legal = [...existing.legal, ...newLegal];

  // Update summary if new one is longer/better
  if (newFacts.summary && (!existing.summary || newFacts.summary.length > existing.summary.length)) {
    existing.summary = newFacts.summary;
  }
  if (newFacts.summary_zh && (!existing.summary_zh || newFacts.summary_zh.length > existing.summary_zh.length)) {
    existing.summary_zh = newFacts.summary_zh;
  }

  return existing;
}

/**
 * Simple string similarity (Jaccard index on words)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 2));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}
