/**
 * Prospectus Parser - Extract bank appointments from full HKEX prospectuses
 *
 * Unlike OC announcements (2-3 pages), prospectuses are 100+ pages.
 * Bank info is in the "Parties Involved in the Global Offering" section.
 */

import { PDFParse } from 'pdf-parse';
import { isLikelyBank, normalizeBankName, NormalizedRole } from './bank-normalizer.js';

/**
 * Validate that a bank name looks legitimate (not garbage/typo/artifact)
 * Must either match a known bank OR have proper financial institution keywords
 */
function isValidBankName(name: string): boolean {
  // Too short - likely garbage
  if (name.length < 10) return false;

  // Contains quote artifacts
  if (name.includes('"') || name.includes('"') || name.includes('"')) return false;

  // Contains tab or multiple spaces in a row (parsing artifact)
  if (name.includes('\t') || /\s{3,}/.test(name)) return false;

  // Contains newline (multiline garbage)
  if (name.includes('\n')) return false;

  // Must end with a proper financial entity suffix
  const validSuffixes = [
    /Limited$/i,
    /Ltd\.?$/i,
    /LLC$/i,
    /L\.L\.C\.?$/i,
    /plc$/i,
    /PLC$/i,
    /Inc\.?$/i,
    /Corporation$/i,
    /Corp\.?$/i,
    /Bank$/i,
    /Branch$/i,
    /AG$/i,
    /S\.A\.?$/i,
    /N\.V\.?$/i,
    /GmbH$/i,
    /Company$/i,
  ];

  const hasValidSuffix = validSuffixes.some(suffix => suffix.test(name.trim()));
  if (!hasValidSuffix) return false;

  // Check for garbage patterns
  const garbagePatterns = [
    /^and\s/i,                    // Starts with "and"
    /^the\s*$/i,                  // Just "the"
    /citizens through/i,          // Known garbage
    /\d{4,}/,                     // Contains 4+ digit numbers (dates, etc)
    /^[a-z]/,                     // Starts with lowercase (parsing error)
    /[<>{}[\]]/,                  // Contains brackets/braces
    /https?:/i,                   // Contains URLs
    /\.(com|org|net|hk)/i,        // Contains domains
    /hospital/i,                  // Not a bank
    /medical/i,                   // Not a bank
    /pharmaceutical/i,            // Not a bank
    /technology co/i,             // Not a bank
    /GROUP CO\.,? LTD/i,          // Company, not bank
    /does not/i,                  // Prose pattern
    /will not/i,                  // Prose pattern
    /shall not/i,                 // Prose pattern
    /is not/i,                    // Prose pattern
    /are not/i,                   // Prose pattern
    /\.\s+[A-Z]/,                 // Multiple sentences combined (". A")
    /Limited\s+and\s+/i,          // "Limited and" - combined entries
    /Limited\s*,\s*[A-Z]/,        // "Limited, X" - multiple entities
    /^Futures Limited$/i,         // Incomplete name
    /^Securities Limited$/i,      // Incomplete name
    /^Capital Limited$/i,         // Incomplete name
    /^Investment Limited$/i,      // Incomplete name
    /NOMINEES LIMITED/i,          // Nominee company, not bank
    /NOMINEE LIMITED/i,           // Nominee company, not bank
    /CUSTODIAN/i,                 // Custodian, not bank
    /TRUSTEE/i,                   // Trustee, not bank
  ];

  for (const pattern of garbagePatterns) {
    if (pattern.test(name)) return false;
  }

  // Should have at least one capital letter word (proper noun)
  if (!/[A-Z][a-z]/.test(name) && !/[A-Z]{2,}/.test(name)) return false;

  // Must contain financial institution keywords OR match known bank patterns
  const upper = name.toUpperCase();
  const financialKeywords = [
    'BANK', 'SECURITIES', 'CAPITAL', 'INVESTMENT', 'ASSET',
    'MORGAN', 'GOLDMAN', 'CITI', 'CREDIT SUISSE', 'UBS',
    'HSBC', 'STANDARD CHARTERED', 'DEUTSCHE', 'BARCLAYS',
    'J.P.', 'JP MORGAN', 'MERRILL', 'NOMURA', 'MIZUHO',
    'CLSA', 'BOCI', 'CICC', 'CITIC', 'BOCOM', 'CCB', 'ICBC',
    'CMB', 'ABCI', 'HAITONG', 'GUOTAI', 'HUATAI', 'CHINA MERCHANTS',
    'CHINA INTERNATIONAL', 'CHINA RENAISSANCE', 'DBS', 'MACQUARIE',
    'BNP', 'SOCIETE GENERALE', 'ING', 'NATIXIS', 'JEFFERIES',
    'STIFEL', 'PIPER', 'RAYMOND JAMES', 'CANACCORD',
    'INTERNATIONAL', 'ASIA', 'HONG KONG', 'FAR EAST', 'PACIFIC',
    'FUTU', 'TIGER', 'LIVERMORE', 'VALUABLE', 'YUNFENG',
    'FINANCIAL', 'CORPORATE FINANCE', 'ADVISORY', 'PARTNERS',
    'AMTD', 'GLOBAL MARKETS',
  ];

  const hasFinancialKeyword = financialKeywords.some(kw => upper.includes(kw));
  if (!hasFinancialKeyword) {
    // Last check: if it ends with "Securities Limited" or "Capital Limited" it's probably valid
    if (!/(Securities|Capital|Bank|Investment)\s+(Limited|Ltd|plc)$/i.test(name)) {
      return false;
    }
  }

  return true;
}

/**
 * More lenient check for financial advisors that may not have typical bank keywords
 * Used when we have role context (e.g., under "Sole Sponsor" header)
 */
function isLikelyFinancialAdvisor(name: string): boolean {
  // Must end with Limited/Branch/L.L.C./AG/S.A./Plc/Bank/CIB/N.V.
  if (!name.match(/Limited$|Ltd\.?$|Branch$|L\.L\.C\.?$|N\.V\.?$|AG$|S\.A\.?$|Plc$|Bank$|CIB$/i)) return false;

  // Check for company keywords that indicate it's NOT a financial advisor
  const upper = name.toUpperCase();
  const companyKeywords = [
    'TECHNOLOGY CO', 'BIOTECH', 'PHARMACEUTICAL', 'BIOPHARMACEUTICAL',
    'ELECTRONICS CO', 'SEMICONDUCTOR', 'SOFTWARE', 'DIGITAL TECH',
    'MEDICAL CO', 'HEALTHCARE CO', 'THERAPEUTICS', 'BIOSCIENCE',
    'ENERGY CO', 'SOLAR', 'ELECTRIC CO', 'MOTOR CO', 'AUTOMOTIVE',
    'FOOD CO', 'BEVERAGE', 'CONSUMER', 'RETAIL', 'E-COMMERCE',
    'MANUFACTURING', 'INDUSTRIAL CO', 'MACHINERY', 'EQUIPMENT CO',
    'CONSTRUCTION', 'PROPERTY', 'REAL ESTATE', 'HOLDINGS LIMITED',
    'ENTERTAINMENT', 'MEDIA CO', 'EDUCATION', 'TOURISM',
    'AGRICULTURE', 'MINING', 'RESOURCES CO', 'ROBOTICS',
    'CLOUD CO', 'INFORMATION TECH', 'LOGISTICS', 'SUPPLY CHAIN',
    'GROUP LIMITED', 'CO., LTD', 'COMPANY LIMITED',
  ];

  for (const keyword of companyKeywords) {
    if (upper.includes(keyword)) {
      return false;
    }
  }

  // Check for financial advisor indicators
  const advisorKeywords = [
    'INTERNATIONAL', 'CAPITAL', 'SECURITIES', 'PARTNERS', 'ADVISORS',
    'ADVISORY', 'INVESTMENT', 'FINANCE', 'FINANCIAL', 'CORPORATE',
    'ASIA', 'HONG KONG', 'CONSULTING',
  ];

  for (const keyword of advisorKeywords) {
    if (upper.includes(keyword)) {
      return true;
    }
  }

  return false;
}

export interface ProspectusBankAppointment {
  bank: string;
  bankNormalized: string;
  roles: NormalizedRole[];
  isLead: boolean;
  rawRole: string;
}

// Role headings in prospectuses (order matters - used for hierarchy)
const ROLE_PATTERNS: Array<{ pattern: RegExp; roles: NormalizedRole[]; priority: number }> = [
  // Sponsor patterns (highest priority)
  { pattern: /^(?:Joint\s+)?(?:Sole\s+)?Sponsors?$/i, roles: ['sponsor'], priority: 1 },
  // Sponsor and compliance adviser
  { pattern: /^(?:Joint\s+)?(?:Sole\s+)?Sponsors?\s+and\s+(?:compliance\s+)?adviser$/i, roles: ['sponsor'], priority: 1 },

  // Sponsor + Coordinator combo
  { pattern: /^(?:Joint\s+)?Sponsors?\s*(?:and|,)\s*(?:Overall\s+)?Coordinators?$/i, roles: ['sponsor', 'coordinator'], priority: 1 },

  // Coordinator + Sponsor combo (e.g., "Sole Global Coordinator and" meaning also Sponsor)
  { pattern: /^(?:Joint\s+)?(?:Sole\s+)?(?:Global\s+)?Coordinators?\s+and$/i, roles: ['coordinator', 'sponsor'], priority: 1 },

  // Coordinator patterns
  { pattern: /^(?:Joint\s+)?(?:Global\s+)?(?:Overall\s+)?Coordinators?$/i, roles: ['coordinator'], priority: 2 },

  // Multi-role patterns (Coordinator + Bookrunner + Lead Manager combos)
  { pattern: /^Joint\s+Global\s+Coordinators?,?\s*(?:Joint\s+)?Bookrunners?\s+and\s+(?:Joint\s+)?Lead\s*Managers?$/i, roles: ['coordinator', 'bookrunner', 'lead_manager'], priority: 2 },
  { pattern: /^(?:Joint\s+)?Bookrunners?\s+and\s+(?:Joint\s+)?Lead\s*Managers?$/i, roles: ['bookrunner', 'lead_manager'], priority: 3 },

  // Bookrunner patterns
  { pattern: /^(?:Joint\s+)?(?:Global\s+)?Bookrunners?$/i, roles: ['bookrunner'], priority: 3 },

  // Lead Manager patterns
  { pattern: /^(?:Joint\s+)?Lead\s*Managers?$/i, roles: ['lead_manager'], priority: 4 },

  // Other roles we recognize but treat as lower priority
  { pattern: /^(?:Sole\s+)?Financial\s+Advisor$/i, roles: ['other'], priority: 5 },
  { pattern: /^(?:Joint\s+)?Financial\s+Advisors?$/i, roles: ['other'], priority: 5 },
  { pattern: /^(?:Joint\s+)?(?:Sole\s+)?Placing\s+Agents?$/i, roles: ['other'], priority: 5 },

  // Listing Agent patterns
  { pattern: /^(?:Sole\s+)?Listing\s+Agent$/i, roles: ['other'], priority: 5 },
  { pattern: /^(?:Joint\s+)?Listing\s+Agents?$/i, roles: ['other'], priority: 5 },

  // Compliance Adviser (sometimes a separate role from sponsor)
  { pattern: /^(?:Sole\s+)?Compliance\s+Adviser$/i, roles: ['other'], priority: 5 },

  // Secondary listing / share offer roles
  { pattern: /^Capital\s+Market\s+Intermediar(?:y|ies)$/i, roles: ['bookrunner'], priority: 3 },
  { pattern: /^(?:Hong Kong\s+)?Underwriters?$/i, roles: ['bookrunner'], priority: 3 },

  // GEM Board specific patterns
  { pattern: /^(?:Joint\s+)?Bookrunners?,?\s*(?:Joint\s+)?Lead\s*Managers?\s+and\s+(?:Public\s+Offer\s+)?Underwriters?$/i, roles: ['bookrunner', 'lead_manager'], priority: 3 },
  { pattern: /^(?:Public\s+Offer\s+)?Underwriters?$/i, roles: ['bookrunner'], priority: 3 },
  { pattern: /^(?:Placing\s+)?Underwriters?$/i, roles: ['bookrunner'], priority: 3 },

  // Receiving Bank (rare but exists)
  { pattern: /^Receiving\s+Bank$/i, roles: ['other'], priority: 5 },
];

/**
 * Parse roles from complex multi-role heading (e.g., "Joint Sponsors, Joint Representatives, Joint Global Coordinators, Joint Bookrunners and Joint Lead Managers")
 */
function parseComplexRoleHeading(text: string): { roles: NormalizedRole[]; priority: number } | null {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

  // Skip if it doesn't look like a role heading
  if (!normalized.match(/sponsor|coordinator|bookrunner|manager|representative|listing\s+agent|financial\s+advisor|placing\s+agent|intermediar|underwriter/i)) {
    return null;
  }

  // Skip if it contains "Limited" (it's a bank name, not a role)
  if (normalized.includes('limited')) {
    return null;
  }

  const roles: NormalizedRole[] = [];
  let priority = 99;

  if (normalized.includes('sponsor')) {
    roles.push('sponsor');
    priority = Math.min(priority, 1);
  }
  if (normalized.includes('coordinator')) {
    roles.push('coordinator');
    priority = Math.min(priority, 2);
  }
  if (normalized.includes('bookrunner')) {
    roles.push('bookrunner');
    priority = Math.min(priority, 3);
  }
  if (normalized.includes('lead') && normalized.includes('manager')) {
    roles.push('lead_manager');
    priority = Math.min(priority, 4);
  }
  if (normalized.includes('representative')) {
    // Representatives are similar to coordinators
    if (!roles.includes('coordinator')) {
      roles.push('coordinator');
      priority = Math.min(priority, 2);
    }
  }
  if (normalized.includes('listing') && normalized.includes('agent')) {
    roles.push('other');
    priority = Math.min(priority, 5);
  }
  if (normalized.includes('financial') && normalized.includes('advisor')) {
    roles.push('other');
    priority = Math.min(priority, 5);
  }
  if (normalized.includes('placing') && normalized.includes('agent')) {
    roles.push('other');
    priority = Math.min(priority, 5);
  }
  if (normalized.includes('intermediar')) {
    if (!roles.includes('bookrunner')) {
      roles.push('bookrunner');
      priority = Math.min(priority, 3);
    }
  }
  if (normalized.includes('underwriter')) {
    // Underwriters are similar to bookrunners (GEM Board uses this term)
    if (!roles.includes('bookrunner')) {
      roles.push('bookrunner');
      priority = Math.min(priority, 3);
    }
  }

  if (roles.length > 0) {
    return { roles, priority };
  }
  return null;
}

// Patterns that indicate end of bank section (not banks)
// NOTE: "Receiving Bank" and "Compliance Adviser" removed - they can be roles, not section ends
const END_SECTION_PATTERNS = [
  /^Legal\s+Adviser/i,
  /^Auditor/i,
  /^Reporting\s+Accountant/i,
  /^Industry\s+Consultant/i,
  /^Property\s+Valuer/i,
  /^Hong Kong\s+Share\s+Registrar/i,
  /^Note:/i,
  /^Registered\s+Office/i,
  /^Principal.*Office/i,
  /^CORPORATE\s+INFORMATION/i,
  /^HISTORY\s+AND/i,
];

/**
 * Check if a match is a Table of Contents entry (has dots and page number)
 */
function isTOCEntry(context: string): boolean {
  // TOC entries look like: "Parties Involved in the Global Offering . . . . . 68"
  return /\.\s*\.\s*\.\s*\d+/.test(context);
}

/**
 * Find and extract the "Parties Involved" section from prospectus text
 */
function findPartiesSection(text: string): string | null {
  // Find ALL occurrences of "PARTIES INVOLVED" and filter out TOC entries
  // Match various formats:
  // - "PARTIES INVOLVED IN THE GLOBAL OFFERING" (Main Board)
  // - "PARTIES INVOLVED IN THE OFFERING"
  // - "PARTIES INVOLVED IN THE SPIN-OFF"
  // - "PARTIES INVOLVED IN THE INTRODUCTION" (Listing by Introduction)
  // - "PARTIES INVOLVED IN THE SHARE OFFER" (GEM Board)
  // - "PARTIES INVOLVED IN THE PLACING" (GEM Board)
  // - "DIRECTORS AND PARTIES INVOLVED IN THE GLOBAL OFFERING"
  // - "DIRECTORS AND PARTIES INVOLVED IN THE SHARE OFFER" (GEM Board)
  // - "PARTIES INVOLVED" (as standalone sub-section header)
  const regex = /(?:DIRECTORS AND )?PARTIES INVOLVED(?:\s+IN THE (?:GLOBAL )?(?:OFFERING|SPIN-OFF|INTRODUCTION|SHARE OFFER|PLACING))?/gi;
  let match;
  const candidates: Array<{ index: number; content: string }> = [];

  while ((match = regex.exec(text)) !== null) {
    const index = match.index;
    const contextAfter = text.substring(index, index + 500);

    // Skip TOC entries (have dots and page number)
    if (isTOCEntry(contextAfter)) {
      continue;
    }

    // Skip mentions in prose (e.g., "... parties involved in the Global Offering...")
    // Real sections have role headings like "Sole Sponsor", "Joint Sponsors", "Joint Bookrunners" etc. within 500 chars
    const hasRoleHeading = contextAfter.match(/(Sole|Joint)\s+(Sponsors?|Bookrunners?|Coordinators?|Global\s+Coordinators?)/i);
    if (!hasRoleHeading) {
      continue;
    }

    // Extract section content up to ending markers
    // NOTE: "Receiving Bank" and "Compliance Adviser" removed - they can be roles
    const sectionStart = index;
    const endMarkers = [
      /\nLegal Advis[eo]r[s]?(?:\s+to the Company)?(?:\s+as to Hong Kong law)?/i,
      /\nOur Legal Advis[eo]r/i,
      /\nAuditor[s]?(?:\s+and Reporting Accountant)?/i,
      /\nReporting Accountant/i,
      /\nIndustry Consultant/i,
      /\nProperty Valuer/i,
      /\nRegistered Office/i,
      /\nCORPORATE INFORMATION/i,
      /\nHISTORY AND/i,
    ];

    let endIndex = text.length;
    for (const endPattern of endMarkers) {
      const endMatch = text.substring(sectionStart).match(endPattern);
      if (endMatch && endMatch.index !== undefined && endMatch.index > 0) {
        const candidateEnd = sectionStart + endMatch.index;
        if (candidateEnd < endIndex && candidateEnd > sectionStart + 100) {
          endIndex = candidateEnd;
        }
      }
    }

    const content = text.substring(sectionStart, endIndex);

    // Validate: section should have bank content (ends with Limited, Branch, etc.)
    if (content.match(/Limited|Branch|L\.L\.C\./i) && content.length < 20000) {
      candidates.push({ index, content });
    }
  }

  // Return the first valid candidate
  if (candidates.length > 0) {
    // Prefer candidates with tab format, then line-break format
    const withTab = candidates.find(c => c.content.match(/Sponsors?\s*\t/i));
    if (withTab) {
      return withTab.content;
    }

    // Accept line-break format: "Sole Sponsor" on one line, bank name on next
    const withLineBreak = candidates.find(c =>
      c.content.match(/(Sole|Joint)\s+Sponsors?[\s\S]*?\n[\s\S]*?Limited/i)
    );
    if (withLineBreak) {
      return withLineBreak.content;
    }

    // Return first candidate as fallback
    return candidates[0].content;
  }

  // FALLBACK 1: Look for section headers with tab format
  const fallbackMatch = text.match(/(?:Joint\s+)?(?:Sole\s+)?Sponsors?\s*\t[\s\S]+?(?=Legal\s+Adviser|Auditor|Compliance Adviser|Receiving Bank|Registered Office)/i);
  if (fallbackMatch) {
    return fallbackMatch[0];
  }

  // FALLBACK 2: Cover page format (older prospectuses)
  const coverMatch = text.match(/(?:Global Coordinator.*?Sponsor|Sole Sponsor|Joint Sponsors?)\s*\n([\s\S]{200,2000}?)(?=IMPORTANT|SUMMARY|EXPECTED)/i);
  if (coverMatch) {
    return coverMatch[0];
  }

  return null;
}

/**
 * Check if a line is a role heading
 */
function matchRoleHeading(line: string): { roles: NormalizedRole[]; priority: number; rawRole: string } | null {
  const trimmed = line.trim();

  // First try exact patterns
  for (const { pattern, roles, priority } of ROLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { roles, priority, rawRole: trimmed };
    }
  }

  // Then try complex multi-role parsing (for mega-deal formats)
  const complexMatch = parseComplexRoleHeading(trimmed);
  if (complexMatch) {
    return { ...complexMatch, rawRole: trimmed };
  }

  return null;
}

/**
 * Check if line indicates end of bank listings
 */
function isEndOfBankSection(line: string): boolean {
  const trimmed = line.trim();
  return END_SECTION_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Extract bank name from a line (handles multi-line bank names)
 */
function extractBankName(line: string): string | null {
  let trimmed = line.trim();

  // Strip role prefixes (e.g., "Financial Adviser Karl Thomson..." → "Karl Thomson...")
  const rolePrefixPattern = /^(?:Financial\s+Advis[eo]r?s?|Sole\s+Sponsor|Joint\s+Sponsors?|Compliance\s+Advis[eo]r?|Receiving\s+Bank|Legal\s+Advis[eo]r?s?|Auditor|Placing\s+Underwriters?|Public\s+Offer\s+Underwriters?|and\s+Capital\s+Market\s+Intermediar(?:y|ies))\s*/i;
  trimmed = trimmed.replace(rolePrefixPattern, '');

  // Strip location prefixes from line-joining errors (e.g., "Central Hong Kong CMB..." → "CMB...")
  // Apply multiple times to handle nested prefixes like "Central Hong Kong"
  const locationPrefixPattern = /^(?:Central\s+Hong\s+Kong|Hong\s+Kong|Central|Kowloon|Admiralty|Wan\s*Chai)\s+(?=[A-Z])/i;
  trimmed = trimmed.replace(locationPrefixPattern, '');
  trimmed = trimmed.replace(locationPrefixPattern, ''); // Second pass for nested prefixes

  // Skip lines containing regulatory disclaimers
  if (trimmed.match(/regulated\s+activit(?:y|ies)|under\s+the\s+SFO|Type\s+\d+\s+licence|corporate\s+finance\)/i)) {
    return null;
  }

  // Skip lines that start with parenthetical content (likely regulatory notes)
  if (trimmed.match(/^\([a-z]/i) && !trimmed.match(/^\(Hong Kong\)/i)) {
    return null;
  }

  // Skip address lines - expanded patterns
  if (trimmed.match(/^\d+.*Floor/i)) return null;
  if (trimmed.match(/^(?:Room|Unit|Suite)\s+\d/i)) return null;
  if (trimmed.match(/^(?:Tower|Building|Centre|Plaza|House)\b/i)) return null;
  if (trimmed.match(/^\d+\s+[A-Z]/)) return null; // Street addresses
  // Expanded Hong Kong location list
  if (trimmed.match(/^(?:Hong Kong|Central|Kowloon|Wan\s*Chai|Wanchai|Admiralty|Tsim\s*Sha\s*Tsui|Causeway\s*Bay|Quarry\s*Bay|North\s*Point|Sheung\s*Wan)$/i)) return null;
  if (trimmed.match(/^(?:PRC|China|United Kingdom|Cayman Islands|Singapore|Japan|United States)$/i)) return null;
  if (trimmed.match(/Road|Street|Avenue|Square/i) && !trimmed.match(/Limited/i)) return null;
  // Floor indicators
  if (trimmed.match(/^\d+\/F\b/i)) return null;
  if (trimmed.match(/^Level\s+\d/i)) return null;

  // Skip role clarifications in parentheses
  if (trimmed.match(/^\(in relation to/i)) return null;
  if (trimmed.match(/^\(.*only\)$/i)) return null;

  // Extract bank name, stripping ", or NICKNAME" suffixes and trailing "("
  let bankMatch = trimmed.match(/^(.+?(?:Limited|Branch|L\.L\.C\.?)),?\s+or\s+/i);
  if (bankMatch) {
    trimmed = bankMatch[1];
  }

  // Strip trailing " (" (Chinese name opening paren)
  trimmed = trimmed.replace(/\s*\($/, '');

  // Must end with Limited, Ltd, Branch, L.L.C., N.V., AG, S.A., Plc, Bank, CIB, or similar
  if (!trimmed.match(/Limited$|Ltd\.?$|Branch$|L\.L\.C\.?$|N\.V\.?$|AG$|S\.A\.?$|Plc$|Bank$|CIB$/i)) return null;

  // Must start with capital letter, digit, or "The"
  if (!trimmed.match(/^[A-Z0-9]|^The\s/i)) return null;

  // Reasonable length
  if (trimmed.length < 10 || trimmed.length > 120) return null;

  // Skip false positives that contain certain phrases
  if (trimmed.match(/Articles of Association|Alibaba Partnership|to nominate/i)) return null;

  return trimmed;
}

/**
 * Pre-process lines to join multi-line bank names and multi-line role headings
 * Bank names like "China International Capital Corporation\nHong Kong Securities Limited"
 * or "China International Capital Corporation Hong Kong\nSecurities Limited"
 * Role headings like "Joint Sponsors, Joint\nRepresentatives, Joint Global\nCoordinators"
 * need to be joined into single lines
 */
function preprocessLines(lines: string[]): string[] {
  const result: string[] = [];
  let pendingBankName = '';
  let pendingRoleHeading = '';

  // Helper to strip control characters (like \u0002) from strings
  // PDF parsing can leave these artifacts
  const stripControlChars = (str: string) => str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Helper to check if line looks like a role heading (not a bank name)
  const isRoleLine = (line: string) => {
    const lower = line.toLowerCase();
    // Must have role keywords and NOT be a bank name (no "limited")
    return (lower.includes('sponsor') || lower.includes('coordinator') ||
            lower.includes('bookrunner') || lower.includes('manager') ||
            lower.includes('representative') || lower.match(/^joint\s/) ||
            lower.match(/^\(in alphabetical/)) &&
           !lower.includes('limited') && !lower.includes('securities') &&
           !lower.includes('corporation');
  };

  // Helper to check if line is a continuation of a bank name (e.g., "Securities Limited")
  const isBankContinuation = (line: string) => {
    const trimmed = line.trim();
    // Lines that complete a bank name: "Securities Limited", "Limited", "Capital Limited", etc.
    // Also handles "Securities Limited (" where Chinese name follows
    // Also handles "(Hong Kong) Limited" format common in Chinese bank names
    return trimmed.match(/^(?:Securities|Capital|Holdings|Asia|Hong Kong|China|International|Corporation)?\s*Limited(?:\s*\()?$/i) ||
           trimmed.match(/^\(Hong Kong\)\s+Limited$/i) ||  // "(Hong Kong) Limited" continuation
           trimmed.match(/^\([A-Z][a-z]+\)\s+Limited$/i) || // "(Singapore) Limited" etc.
           trimmed.match(/^Limited,?\s+or\s+/i) ||  // "Limited, or HSBC"
           trimmed.match(/^(?:Hong Kong|Asia|Pacific|China)\s*$/i) ||  // Geographic continuations
           trimmed.match(/^Hong Kong Securities Limited/i);  // CICC pattern
  };

  // Helper to check if line starts a bank name
  const startsWithBankName = (line: string) => {
    const trimmed = line.trim();
    // Check if line starts with capital letter and contains bank keywords
    // Use word boundary to properly match keywords at end
    return trimmed.match(/^[A-Z][A-Za-z\s&\(\)]*\b(?:Corporation|International|Capital|Securities|Group|Holdings|Bank|Banking|Finance|Financial|Partners|Sachs|Stanley|Suisse|Morgan|Barclays|Deutsche|Goldman|Merrill|Huatai|Haitong|CICC|HSBC|UBS|BNP|BOCI|CMB|ICBC|CCB|BOCOM)\b/i);
  };

  // Helper to check if a combined line forms a complete bank name
  const isCompleteBankName = (line: string) => {
    // Matches "Limited", "Limited,", "Limited, or", "Limited, or NICKNAME"
    // Also matches "Limited (" where Chinese name follows, or "L.L.C.", "AG", "S.A.", "Plc", "Bank", "CIB"
    return line.match(/Limited(?:\s*\()?(?:,?\s*(?:or(?:\s+\w+)?)?)?$|Ltd\.?$|L\.L\.C\.?$|N\.V\.?$|AG$|S\.A\.?$|Plc$|Bank$|CIB$/i);
  };

  // Helper to extract bank name from line that may have ", or NICKNAME" or trailing "(" suffix
  const cleanBankName = (line: string): string => {
    // Extract up to "Limited" or "L.L.C." and strip any trailing " ("
    const match = line.match(/^(.+?(?:Limited|L\.L\.C\.?))/i);
    return match ? match[1] : line.replace(/\s*\($/, '');
  };

  for (let i = 0; i < lines.length; i++) {
    // Strip control characters and trim
    let line = stripControlChars(lines[i]).trim();

    // Skip empty lines
    if (!line) {
      // Flush any pending items
      if (pendingRoleHeading) {
        result.push(pendingRoleHeading);
        pendingRoleHeading = '';
      }
      if (pendingBankName) {
        result.push(pendingBankName);
        pendingBankName = '';
      }
      continue;
    }

    // Skip page numbers and headers
    if (line.match(/^–\s*\d+\s*–$/)) continue;
    if (line === 'DIRECTORS AND PARTIES INVOLVED IN THE GLOBAL OFFERING') continue;

    // IMPORTANT: Handle lines with tabs FIRST (before role line check)
    // Otherwise "Sole Sponsor \t BankName" is incorrectly treated as a role heading
    if (line.includes('\t')) {
      // Flush any pending role heading
      if (pendingRoleHeading) {
        result.push(pendingRoleHeading);
        pendingRoleHeading = '';
      }

      const parts = line.split('\t');
      const rolesPart = parts[0].trim();
      const bankPart = parts.slice(1).join(' ').trim();

      // Check if first part is a role header
      const isRoleHeader = rolesPart.match(/^(?:Joint|Sole|Senior)\s/i) ||
                           rolesPart.match(/Sponsor|Coordinator|Bookrunner|Manager|Representative/i);

      if (isRoleHeader && bankPart) {
        result.push(rolesPart);
        // Check if bank part is complete (Limited or Branch)
        if (isCompleteBankName(bankPart) || bankPart.match(/Branch,?\s+or\s+\w+$/i)) {
          // Extract the bank name, stripping ", or NICKNAME"
          const bankMatch = bankPart.match(/^(.+?(?:Limited|Branch))/i);
          result.push(bankMatch ? bankMatch[1] : bankPart);
        } else if (startsWithBankName(bankPart)) {
          pendingBankName = bankPart;
        } else {
          result.push(bankPart);
        }
        continue;
      }
    }

    // Check if this is part of a multi-line role heading (only for lines WITHOUT tabs)
    if (isRoleLine(line) && !pendingBankName && !line.includes('\t')) {
      if (pendingRoleHeading) {
        pendingRoleHeading += ' ' + line;
      } else {
        pendingRoleHeading = line;
      }
      continue;
    }

    // If we have a pending role heading and this line is NOT a role line, flush it
    if (pendingRoleHeading && !isRoleLine(line)) {
      result.push(pendingRoleHeading);
      pendingRoleHeading = '';
    }

    // Check if this line continues a pending bank name
    if (pendingBankName) {
      if (isBankContinuation(line) || line.match(/Limited$/i)) {
        // Join with pending bank name
        const combined = pendingBankName + ' ' + line;
        // Extract just the bank name (strip ", or HSBC" suffixes)
        const bankMatch = combined.match(/^(.+?Limited)/i);
        if (bankMatch) {
          result.push(bankMatch[1]);
        } else {
          result.push(combined);
        }
        pendingBankName = '';
        continue;
      } else if (startsWithBankName(line)) {
        // This is a new bank name, flush the pending one
        result.push(pendingBankName);
        pendingBankName = '';
        // Fall through to process this line
      } else {
        // Not a continuation - flush pending and process this line
        result.push(pendingBankName);
        pendingBankName = '';
      }
    }

    // Check if this line contains a role + bank combination (no tab)
    // e.g., "Lead Managers The Hongkong and Shanghai Banking Corporation"
    // e.g., "Sole Sponsor and compliance adviser LY Capital Limited"
    // e.g., "Sole Global Coordinator Founder Securities (Hong Kong) Limited"
    const roleInlineMatch = line.match(/^((?:Joint\s+)?(?:Sole\s+)?(?:Global\s+)?(?:Lead\s+)?(?:Sponsors?|Bookrunners?|Managers?|Coordinators?)(?:\s+and\s+(?:compliance\s+)?(?:Sole\s+)?(?:Lead\s+)?(?:adviser|Sponsors?|Bookrunners?|Managers?|Coordinators?))*)\s+([A-Z][A-Za-z\s\(\)&]+Limited)$/i);
    if (roleInlineMatch) {
      const rolePart = roleInlineMatch[1];
      const bankPart = roleInlineMatch[2];
      result.push(rolePart);
      if (isCompleteBankName(bankPart)) {
        result.push(bankPart);
      } else if (startsWithBankName(bankPart) || bankPart.match(/^The\s+/i)) {
        pendingBankName = bankPart;
      } else {
        result.push(bankPart);
      }
      continue;
    }

    // Check if line has role + partial bank name (bank name wraps to next line)
    // e.g., "Joint Sponsors China International Capital Corporation Hong Kong"
    // followed by "                Securities Limited"
    const rolePartialBankMatch = line.match(/^((?:Joint\s+)?(?:Sole\s+)?(?:Global\s+)?(?:Lead\s+)?(?:Co-?lead\s+)?(?:Sponsors?|Bookrunners?|Managers?|Coordinators?))\s+([A-Z][A-Za-z\s\(\)&,\.]+)$/i);
    if (rolePartialBankMatch) {
      const rolePart = rolePartialBankMatch[1];
      const bankPart = rolePartialBankMatch[2].trim();
      // Check if bank part looks like start of bank name (not ending with Limited)
      if (startsWithBankName(bankPart) && !isCompleteBankName(bankPart)) {
        result.push(rolePart);
        pendingBankName = bankPart;
        continue;
      }
    }

    // If line ends with "Limited" (possibly with ", or NICKNAME"), it's a complete bank name
    if (isCompleteBankName(line)) {
      result.push(cleanBankName(line));
      continue;
    }

    // Check if this looks like the start of a bank name
    if (startsWithBankName(line) || line.match(/^(?:The\s+)?[A-Z][A-Za-z\s&]+(?:Hong Kong|Corporation|Capital|Securities|Bank)$/i)) {
      pendingBankName = line;
      continue;
    }

    // Skip address lines and other non-bank content
    if (line.match(/^\d+.*(?:Floor|\/F)/i)) continue;
    if (line.match(/^(?:Room|Unit|Suite)\s+\d/i)) continue;
    if (line.match(/^(?:\d+\s+)?[A-Z][a-z]+\s+(?:Road|Street|Avenue|Square|Centre|Plaza)/i)) continue;
    if (line.match(/^(?:Central|Hong Kong|Kowloon|United Kingdom|Canary Wharf|London)$/i)) continue;
    if (line.match(/^\d+\s+[A-Z]/)) continue;
    if (line.match(/^\(.*only\)$/i)) continue;  // Role clarifications

    // Otherwise, add the line as-is
    result.push(line);
  }

  // Flush any remaining pending items
  if (pendingRoleHeading) {
    result.push(pendingRoleHeading);
  }
  if (pendingBankName) {
    result.push(pendingBankName);
  }

  return result;
}

/**
 * Parse banks from the Parties Involved section
 */
function parseBanksFromSection(sectionText: string): ProspectusBankAppointment[] {
  const banks: ProspectusBankAppointment[] = [];
  const seenBanks = new Map<string, ProspectusBankAppointment>();

  // Pre-process to join multi-line bank names
  const rawLines = sectionText.split('\n');
  const lines = preprocessLines(rawLines);

  let currentRoles: NormalizedRole[] = [];
  let currentPriority = 99;
  let currentRawRole = '';

  for (const line of lines) {
    // Check if we've hit the end of bank listings
    if (isEndOfBankSection(line)) {
      break;
    }

    // Check for role heading (may be separated by tab from bank name)
    const parts = line.split('\t');
    const roleMatch = matchRoleHeading(parts[0]);

    if (roleMatch) {
      currentRoles = roleMatch.roles;
      currentPriority = roleMatch.priority;
      currentRawRole = roleMatch.rawRole;

      // Check if bank name follows on same line after tab
      if (parts.length > 1) {
        const bankName = extractBankName(parts[1]);
        if (bankName && isLikelyBank(bankName)) {
          addBank(bankName, currentRoles, currentPriority, currentRawRole, seenBanks);
        }
      }
      continue;
    }

    // Try to extract bank name from this line
    const bankName = extractBankName(line);
    if (bankName && currentRoles.length > 0) {
      // When we have a role context (sponsor/coordinator/etc), be lenient about bank name validation
      // Since the role header tells us it's a financial advisor
      const isValid = isLikelyBank(bankName) || isLikelyFinancialAdvisor(bankName);
      if (isValid) {
        addBank(bankName, currentRoles, currentPriority, currentRawRole, seenBanks);
      }
    }
  }

  return Array.from(seenBanks.values());
}

/**
 * Add bank to the map, merging roles if already seen
 */
function addBank(
  bankName: string,
  roles: NormalizedRole[],
  priority: number,
  rawRole: string,
  seenBanks: Map<string, ProspectusBankAppointment>
): void {
  const { canonical } = normalizeBankName(bankName);
  const key = canonical.toLowerCase();

  if (seenBanks.has(key)) {
    // Merge roles - keep highest priority (lowest number) role info
    const existing = seenBanks.get(key)!;
    const mergedRoles = [...new Set([...existing.roles, ...roles])];
    const keepExisting = existing.isLead || roles.includes('sponsor') || roles.includes('coordinator');

    seenBanks.set(key, {
      ...existing,
      roles: mergedRoles,
      isLead: existing.isLead || roles.includes('sponsor') || roles.includes('coordinator'),
    });
  } else {
    seenBanks.set(key, {
      bank: bankName,
      bankNormalized: canonical,
      roles,
      isLead: roles.includes('sponsor') || roles.includes('coordinator'),
      rawRole,
    });
  }
}

/**
 * Fallback extraction for two-column PDF layouts
 * Searches for known bank name patterns anywhere in the text
 */
function fallbackBankExtraction(fullText: string): ProspectusBankAppointment[] {
  const seenBanks = new Map<string, ProspectusBankAppointment>();

  // Common bank name patterns to search for
  // Use word boundaries to prevent partial matches
  const bankPatterns = [
    /\bMorgan Stanley[^,\n]*Limited/gi,
    /\bGoldman Sachs[^,\n]*L\.?L\.?C\.?/gi,
    /\bChina International Capital[^,\n]*Limited/gi,
    /\bBOCI Asia[^,\n]*Limited/gi,
    /\bBank of China[^,\n]*Limited/gi,
    /\bHSBC[^,\n]*Limited/gi,
    /\bThe Hong\s*kong and Shanghai Banking[^,\n]*Limited/gi,
    /\bHong\s*kong and Shanghai Banking[^,\n]*Limited/gi,
    /\bJ\.?P\.?\s*Morgan[^,\n]*Limited/gi,
    /\bCiti(?:group|bank)?[^,\n]*Limited/gi,
    /\bUBS AG\b/gi,
    /\bUBS Securities[^,\n]*Limited/gi,
    /\bCredit Suisse[^,\n]*Limited/gi,
    /\bDeutsche Bank[^,\n]*Limited/gi,
    /\bBNP Paribas[^,\n]*Limited/gi,
    /\bHaitong[^,\n]*Limited/gi,
    /\bAMTD[^,\n]*Limited/gi,
    /\bChina Industrial Securities[^,\n]*Limited/gi,
    /\bGuotai Junan[^,\n]*Limited/gi,
    /\bCCB International[^,\n]*Limited/gi,
    /\bICBC International[^,\n]*Limited/gi,
    /\bCMB International[^,\n]*Limited/gi,
    /\bCITIC[^,\n]*Limited/gi,
    /\bMacquarie[^,\n]*Limited/gi,
    /\bNomura[^,\n]*Limited/gi,
    /\bBarclays[^,\n]*Limited/gi,
    /\bBofA[^,\n]*Limited/gi,
    /\bMerrill Lynch[^,\n]*Limited/gi,
    /\bABCI[^,\n]*Limited/gi,
    /\bBOCOM[^,\n]*Limited/gi,
    /\bFutu[^,\n]*Limited/gi,
    /\bTiger Brokers[^,\n]*Limited/gi,
    // PLC endings for international offering banks
    /\bMorgan Stanley[^,\n]*Plc/gi,
    /\bJ\.?P\.?\s*Morgan[^,\n]*Plc/gi,
    // International entities (no Limited/Plc suffix)
    /\bMerrill Lynch International\b/gi,
    /\bCredit Suisse International\b/gi,
    // Additional broker patterns
    /\bLong\s*bridge[^,\n]*Limited/gi,
    /\bZINVEST[^,\n]*Limited/gi,
    /\bCLSA[^,\n]*Limited/gi,
    /\bCLSA Global Markets[^,\n]*/gi,
    /\bAVIC[T]?[^,\n]*Limited/gi,
    // International offering entities (without "Asia" or location suffix)
    /\bCitigroup Global Markets Limited\b/gi,
    /\bCredit Suisse Securities[^,\n]*Limited/gi,
    /\bUBS Securities LLC\b/gi,
    /\bGoldman Sachs International\b/gi,
  ];

  for (const pattern of bankPatterns) {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      const bankName = match[0].trim();
      if (bankName.length > 10 && bankName.length < 100) {
        const { canonical } = normalizeBankName(bankName);
        // Use raw name as key to preserve different entities (e.g., HK vs International)
        const key = bankName.toLowerCase();

        if (!seenBanks.has(key)) {
          seenBanks.set(key, {
            bank: bankName,
            bankNormalized: canonical,
            roles: ['other'] as NormalizedRole[],
            isLead: false,
            rawRole: 'Fallback extraction',
          });
        }
      }
    }
  }

  // Try to determine roles based on context
  for (const [key, bank] of seenBanks.entries()) {
    // Slice first, then escape to avoid breaking escape sequences
    const bankRegex = new RegExp(bank.bank.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // Check if this bank appears near role keywords
    const sponsorMatch = fullText.match(new RegExp('Sponsor[^\\n]*' + bankRegex.source, 'i')) ||
                         fullText.match(new RegExp(bankRegex.source + '[^\\n]*Sponsor', 'i'));
    const coordinatorMatch = fullText.match(new RegExp('Coordinator[^\\n]*' + bankRegex.source, 'i')) ||
                              fullText.match(new RegExp(bankRegex.source + '[^\\n]*Coordinator', 'i'));
    const bookrunnerMatch = fullText.match(new RegExp('Bookrunner[^\\n]*' + bankRegex.source, 'i')) ||
                             fullText.match(new RegExp(bankRegex.source + '[^\\n]*Bookrunner', 'i'));

    const roles: NormalizedRole[] = [];
    if (sponsorMatch) roles.push('sponsor');
    if (coordinatorMatch) roles.push('coordinator');
    if (bookrunnerMatch) roles.push('bookrunner');

    if (roles.length > 0) {
      bank.roles = roles;
      bank.isLead = roles.includes('sponsor') || roles.includes('coordinator');
      bank.rawRole = 'Fallback: ' + roles.join(', ');
    }
  }

  return Array.from(seenBanks.values());
}

// GICS Sector definitions
export const GICS_SECTORS = {
  10: 'Energy',
  15: 'Materials',
  20: 'Industrials',
  25: 'Consumer Discretionary',
  30: 'Consumer Staples',
  35: 'Health Care',
  40: 'Financials',
  45: 'Information Technology',
  50: 'Communication Services',
  55: 'Utilities',
  60: 'Real Estate',
} as const;

export type GICSSectorCode = keyof typeof GICS_SECTORS;
export type GICSSectorName = typeof GICS_SECTORS[GICSSectorCode];

// Sector keyword patterns - order matters (more specific patterns first)
// Patterns use word boundaries and require strong signals to avoid false positives
const SECTOR_PATTERNS: Array<{ sector: GICSSectorCode; pattern: RegExp; weight: number }> = [
  // Health Care - high weight, specific medical terms
  { sector: 35, pattern: /\b(pharmaceutical company|biotech company|biopharmaceutical|bio-pharmaceutical|medical device|hospital|healthcare provider|drug development|vaccine company|clear aligner|orthodontic|dental|clinical trial|oncology|therapeutics|diagnostic|CRO|clinical research|oncology therapies|drug candidates)\b/i, weight: 3 },
  { sector: 35, pattern: /\b(pharmaceutical|biotech|biotechnology|vaccine|medicine|medical)\b/i, weight: 1 },

  // Energy - specific power/energy terms, before Utilities
  { sector: 10, pattern: /\b(nuclear power|power producer|power generation|IPP|independent power producer|oil and gas|petroleum|renewable energy|solar power|wind power|coal-fired|gas-fired)\b/i, weight: 3 },
  { sector: 10, pattern: /\b(oil|gas|petroleum|solar|wind|crude|refining|LNG)\b/i, weight: 1 },

  // Utilities - water/waste treatment, electricity distribution
  { sector: 55, pattern: /\b(wastewater treatment|water treatment|water supply|sewage|waste management|electric utility|gas utility|power distribution)\b/i, weight: 3 },
  { sector: 55, pattern: /\b(utility|utilities)\b/i, weight: 1 },

  // Financials - banks and financial institutions, avoid "insurance" in risk context
  { sector: 40, pattern: /\b(commercial bank|city bank|regional bank|banking institution|asset management|securities company|brokerage|wealth management|insurance company|insurer)\b/i, weight: 3 },
  { sector: 40, pattern: /\b(bank(?:ing)?|securities|brokerage|lending|mortgage)\b/i, weight: 1 },

  // Information Technology - tech companies
  { sector: 45, pattern: /\b(software company|SaaS|cloud computing|cloud platform|AI company|artificial intelligence|semiconductor|fintech|robotics|IT services|cybersecurity|data center)\b/i, weight: 3 },
  { sector: 45, pattern: /\b(software|technology|digital platform|mobile app|big data|machine learning)\b/i, weight: 1 },

  // Consumer Staples - food and beverage, before Consumer Discretionary
  { sector: 30, pattern: /\b(food company|beverage company|packaged drinking water|quick-frozen food|dairy company|grocery|supermarket|agriculture|farming)\b/i, weight: 3 },
  { sector: 30, pattern: /\b(food|beverage|dairy|meat|tobacco|cosmetic)\b/i, weight: 1 },

  // Consumer Discretionary - retail, auto, hospitality
  { sector: 25, pattern: /\b(retailer|chain store|mobile phone retailer|used vehicle|automobile dealer|restaurant chain|hotel|hospitality|e-commerce|fashion|apparel|luxury)\b/i, weight: 3 },
  { sector: 25, pattern: /\b(retail|restaurant|hotel|automobile|automotive|apparel|fashion|travel|tourism)\b/i, weight: 1 },

  // Materials - chemicals, mining, materials
  { sector: 15, pattern: /\b(gold mining|mining company|chemical company|steel company|cement|biodegradable|new materials|packaging materials)\b/i, weight: 3 },
  { sector: 15, pattern: /\b(chemical|mining|metals|steel|cement|packaging|paper|aluminum|copper|gold|lithium)\b/i, weight: 1 },

  // Industrials - manufacturing, construction, logistics
  { sector: 20, pattern: /\b(construction company|engineering company|logistics company|manufacturing|machinery|aerospace|defense|building material|rail transit|urban rail)\b/i, weight: 3 },
  { sector: 20, pattern: /\b(construction|logistics|engineering|industrial|freight|shipping|transportation|railway|airline)\b/i, weight: 1 },

  // Real Estate
  { sector: 60, pattern: /\b(property management|real estate|property developer|REIT|residential property|commercial property)\b/i, weight: 3 },
  { sector: 60, pattern: /\b(property|real estate|residential|commercial property|landlord|rental)\b/i, weight: 1 },

  // Communication Services
  { sector: 50, pattern: /\b(media company|advertising company|telecom|telecommunications|out-of-home media|broadcasting|streaming|social media)\b/i, weight: 3 },
  { sector: 50, pattern: /\b(media|advertising|telecom|broadcasting|publishing)\b/i, weight: 1 },
];

export interface SectorExtraction {
  sectorCode: GICSSectorCode | null;
  sectorName: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  matchedKeywords: string[];
  overviewText: string;
}

/**
 * Find and extract the Overview/Summary section from prospectus text
 * Strategy: Find "OVERVIEW" or "SUMMARY" section header, then extract text after it
 */
function findOverviewSection(text: string): string | null {
  // Strategy 1: Look for standalone OVERVIEW section (most common in HKEX prospectuses)
  // The pattern is: \nOVERVIEW\n followed by business description
  const overviewMatch = text.match(/\nOVERVIEW\n([\s\S]{0,3000})/);
  if (overviewMatch && overviewMatch[1]) {
    const content = overviewMatch[1].trim();
    // Validate it looks like actual business content
    // Accept: "We are...", "Founded in..., we are...", "Established in..., we..."
    if (content.match(/^(?:Founded|Established|Incorporated)?\s*(?:in\s+\d{4},?\s*)?we\s+(are|have|were|provide|operate|develop|offer|manufacture|focus)/i)) {
      return content.slice(0, 1500);
    }
    // Also accept if it starts directly with "We are"
    if (content.match(/^We\s+(are|have|were|provide|operate|develop|offer|manufacture)/i)) {
      return content.slice(0, 1500);
    }
  }

  // Strategy 2: Look for SUMMARY section
  const summaryMatch = text.match(/\nSUMMARY\n([\s\S]{0,3000})/);
  if (summaryMatch && summaryMatch[1]) {
    const content = summaryMatch[1].trim();
    if (content.match(/^(?:Founded|Established|Incorporated)?\s*(?:in\s+\d{4},?\s*)?we\s+(are|have|were|provide|operate|develop|offer|manufacture|focus)/i) ||
        content.match(/^We\s+(are|have|were|provide|operate|develop|offer|manufacture)/i)) {
      return content.slice(0, 1500);
    }
  }

  // Strategy 3: Look for OUR BUSINESS section
  const businessMatch = text.match(/\nOUR BUSINESS\n([\s\S]{0,3000})/);
  if (businessMatch && businessMatch[1]) {
    return businessMatch[1].trim().slice(0, 1500);
  }

  // Strategy 4: Find the first substantial "we are a [type] company" pattern
  // This captures "Founded in 2014, we are a bio-pharmaceutical company..."
  const foundedMatch = text.match(/\n((?:Founded|Established|Incorporated)\s+in\s+\d{4},?\s+we\s+are\s+[^.]{50,500}\.)/i);
  if (foundedMatch && foundedMatch[1]) {
    const startIdx = text.indexOf(foundedMatch[1]);
    if (startIdx > 0) {
      return text.slice(startIdx, startIdx + 1500);
    }
  }

  // Strategy 5: Find the first substantial "We are..." paragraph
  const weAreMatch = text.match(/\n(We are [^.]{100,1000}\.)/);
  if (weAreMatch && weAreMatch[1]) {
    const startIdx = text.indexOf(weAreMatch[1]);
    if (startIdx > 0) {
      return text.slice(startIdx, startIdx + 1500);
    }
  }

  // Strategy 6: Look for BUSINESS OVERVIEW in industry section
  const industryMatch = text.match(/BUSINESS OVERVIEW[\s\S]{0,500}(We\s+(?:are|have|provide)[^.]{50,500}\.)/);
  if (industryMatch && industryMatch[1]) {
    return industryMatch[1];
  }

  return null;
}

/**
 * Extract sector from prospectus text using Overview section analysis
 * Uses weighted keyword matching for better accuracy
 */
export function extractSectorFromText(fullText: string): SectorExtraction {
  // Find Overview section
  const overviewText = findOverviewSection(fullText);

  if (!overviewText) {
    return {
      sectorCode: null,
      sectorName: null,
      confidence: 'none',
      matchedKeywords: [],
      overviewText: '',
    };
  }

  // Clean text for matching (remove extra whitespace)
  const cleanText = overviewText.replace(/\s+/g, ' ').trim();

  // Track weighted scores per sector
  const sectorScores = new Map<GICSSectorCode, { score: number; keywords: string[] }>();

  for (const { sector, pattern, weight } of SECTOR_PATTERNS) {
    const match = cleanText.match(pattern);
    if (match) {
      const existing = sectorScores.get(sector) || { score: 0, keywords: [] };
      existing.score += weight;
      existing.keywords.push(match[0]);
      sectorScores.set(sector, existing);
    }
  }

  if (sectorScores.size === 0) {
    return {
      sectorCode: null,
      sectorName: null,
      confidence: 'none',
      matchedKeywords: [],
      overviewText: cleanText.slice(0, 500),
    };
  }

  // Find sector with highest weighted score
  let bestSector: GICSSectorCode | null = null;
  let bestScore = 0;
  let bestKeywords: string[] = [];

  for (const [sector, data] of sectorScores.entries()) {
    if (data.score > bestScore) {
      bestScore = data.score;
      bestSector = sector;
      bestKeywords = data.keywords;
    }
  }

  // Determine confidence based on weighted score
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (bestScore >= 4) {
    confidence = 'high';
  } else if (bestScore >= 2) {
    confidence = 'medium';
  }

  return {
    sectorCode: bestSector,
    sectorName: bestSector ? GICS_SECTORS[bestSector] : null,
    confidence,
    matchedKeywords: bestKeywords,
    overviewText: cleanText.slice(0, 500),
  };
}

/**
 * Extract sector from a prospectus PDF buffer
 */
export async function extractSectorFromProspectus(pdfBuffer: Buffer): Promise<SectorExtraction> {
  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    const parser = new PDFParse(uint8Array);
    const result = await parser.getText();

    const allText = result.pages.map(p => p.text).join('\n');
    return extractSectorFromText(allText);
  } catch (error) {
    console.error('Error extracting sector from prospectus:', error);
    return {
      sectorCode: null,
      sectorName: null,
      confidence: 'none',
      matchedKeywords: [],
      overviewText: '',
    };
  }
}

/**
 * Main entry point: Extract bank appointments from a prospectus PDF
 */
export async function extractBanksFromProspectus(pdfBuffer: Buffer): Promise<{
  banks: ProspectusBankAppointment[];
  sectionFound: boolean;
  rawSectionText?: string;
}> {
  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    const parser = new PDFParse(uint8Array);
    const result = await parser.getText();

    const allText = result.pages.map(p => p.text).join('\n');

    // Find the Parties Involved section
    const sectionText = findPartiesSection(allText);

    if (!sectionText) {
      return { banks: [], sectionFound: false };
    }

    // Parse banks from the section
    let banks = parseBanksFromSection(sectionText);

    // CONDITIONAL FALLBACK: Only run fallback when main extraction finds nothing.
    // If main extraction found banks, skip fallback (it adds garbage from unrelated mentions).
    // If main extraction found NOTHING, use fallback as our only source.
    // See: https://github.com/bearhedge/DD-Owl investigation Jan 2026
    if (banks.length === 0) {
      const fallbackBanks = fallbackBankExtraction(allText);
      banks = fallbackBanks;
    }

    // Filter out garbage/invalid bank names
    const validBanks = banks.filter(b => isValidBankName(b.bank));

    return {
      banks: validBanks,
      sectionFound: true,
      rawSectionText: sectionText.slice(0, 5000), // For debugging
    };
  } catch (error) {
    console.error('Error parsing prospectus:', error);
    return { banks: [], sectionFound: false };
  }
}

/**
 * Test the parser on a sample PDF
 */
async function test() {
  const fs = await import('fs');

  const testFile = '/tmp/sample_prospectus.pdf';
  if (!fs.existsSync(testFile)) {
    console.log('No test file found at', testFile);
    console.log('Download a sample with: curl -o /tmp/sample_prospectus.pdf "https://www1.hkexnews.hk/listedco/listconews/sehk/2022/1118/2022111800021.pdf"');
    return;
  }

  const buffer = fs.readFileSync(testFile);
  const result = await extractBanksFromProspectus(buffer);

  console.log('Section found:', result.sectionFound);
  console.log('\nBanks extracted:', result.banks.length);
  console.log('\n--- Bank Details ---');

  // Sort by role priority
  const rolePriority: Record<NormalizedRole, number> = {
    sponsor: 1,
    coordinator: 2,
    bookrunner: 3,
    lead_manager: 4,
    other: 5,
  };

  const sorted = [...result.banks].sort((a, b) => {
    const aPriority = Math.min(...a.roles.map(r => rolePriority[r]));
    const bPriority = Math.min(...b.roles.map(r => rolePriority[r]));
    return aPriority - bPriority;
  });

  for (const bank of sorted) {
    console.log(`${bank.isLead ? '★' : ' '} ${bank.bankNormalized}`);
    console.log(`   Raw: ${bank.bank}`);
    console.log(`   Roles: ${bank.roles.join(', ')}`);
    console.log(`   From: "${bank.rawRole}"`);
    console.log('');
  }
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  test().catch(console.error);
}
