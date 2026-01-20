/**
 * Quote Validator - Anti-Hallucination System
 *
 * Validates that LLM-extracted quotes actually exist in source articles.
 * Handles Chinese text normalization (full-width/half-width, whitespace, punctuation).
 */

export interface ValidatedClaim {
  claim_en: string;
  claim_zh: string;
  quote: string;
  quote_location?: string;
  validated: boolean;
}

export interface RejectionLog {
  sourceUrl: string;
  claimAttempted: string;
  quoteClaimed: string;
  reason: 'quote_not_found' | 'quote_too_short' | 'quote_empty';
}

/**
 * Normalize Chinese text for comparison.
 * Handles common variations in encoding, punctuation, and whitespace.
 */
export function normalizeChineseText(text: string): string {
  return text
    // Normalize all whitespace to empty (Chinese text often has inconsistent spacing)
    .replace(/\s+/g, '')
    // Full-width to half-width numbers (０-９ → 0-9)
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // Full-width to half-width letters (Ａ-Ｚ, ａ-ｚ)
    .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // Remove common Chinese punctuation for matching
    .replace(/[，。！？；：""''（）【】、·《》]/g, '')
    // Remove common English punctuation
    .replace(/[,.!?;:"'()\[\]]/g, '')
    // Lowercase for case-insensitive matching
    .toLowerCase();
}

/**
 * Calculate character-level similarity between two strings of equal length.
 */
function calculateSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / a.length;
}

/**
 * Find if a quote exists in the article text.
 * Uses exact matching first, then fuzzy matching for OCR/encoding variations.
 *
 * @param quote - The quote claimed by the LLM
 * @param articleText - The full article text
 * @param threshold - Minimum similarity for fuzzy match (default 0.85 = 85%)
 * @returns true if quote found, false otherwise
 */
export function findQuoteInArticle(
  quote: string,
  articleText: string,
  threshold = 0.85
): boolean {
  // Reject empty or very short quotes
  if (!quote || quote.length < 4) {
    return false;
  }

  const normalizedQuote = normalizeChineseText(quote);
  const normalizedArticle = normalizeChineseText(articleText);

  // Skip if normalized quote is too short (might be all punctuation)
  if (normalizedQuote.length < 3) {
    return false;
  }

  // Exact substring match first (fast path)
  if (normalizedArticle.includes(normalizedQuote)) {
    return true;
  }

  // Sliding window fuzzy match for OCR/encoding variations
  // Only do this for reasonable quote lengths to avoid false positives
  if (normalizedQuote.length >= 6 && normalizedQuote.length <= 200) {
    const quoteLen = normalizedQuote.length;
    for (let i = 0; i <= normalizedArticle.length - quoteLen; i++) {
      const window = normalizedArticle.slice(i, i + quoteLen);
      const similarity = calculateSimilarity(normalizedQuote, window);
      if (similarity >= threshold) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate an array of claims against article text.
 * Returns only claims where the quote was found in the source.
 * Logs rejected claims for monitoring.
 *
 * @param claims - Array of claims with quotes
 * @param articleText - The full article text
 * @param sourceUrl - URL for logging purposes
 * @returns Array of validated claims (only those with verified quotes)
 */
export function validateClaims(
  claims: Array<{ claim_en: string; claim_zh: string; quote: string; quote_location?: string }>,
  articleText: string,
  sourceUrl?: string
): ValidatedClaim[] {
  const results: ValidatedClaim[] = [];

  for (const claim of claims) {
    // Check for empty quote
    if (!claim.quote || claim.quote.trim().length === 0) {
      const rejection: RejectionLog = {
        sourceUrl: sourceUrl || 'unknown',
        claimAttempted: claim.claim_en,
        quoteClaimed: claim.quote || '',
        reason: 'quote_empty'
      };
      console.log(`[HALLUCINATION_BLOCKED]`, JSON.stringify(rejection));
      continue;
    }

    // Check for too-short quote
    if (claim.quote.length < 4) {
      const rejection: RejectionLog = {
        sourceUrl: sourceUrl || 'unknown',
        claimAttempted: claim.claim_en,
        quoteClaimed: claim.quote,
        reason: 'quote_too_short'
      };
      console.log(`[HALLUCINATION_BLOCKED]`, JSON.stringify(rejection));
      continue;
    }

    // Validate quote exists in article
    const validated = findQuoteInArticle(claim.quote, articleText);

    if (validated) {
      results.push({ ...claim, validated: true });
    } else {
      const rejection: RejectionLog = {
        sourceUrl: sourceUrl || 'unknown',
        claimAttempted: claim.claim_en,
        quoteClaimed: claim.quote.slice(0, 100) + (claim.quote.length > 100 ? '...' : ''),
        reason: 'quote_not_found'
      };
      console.log(`[HALLUCINATION_BLOCKED]`, JSON.stringify(rejection));
    }
  }

  return results;
}

/**
 * Build a narrative summary from validated claims.
 * Used to reconstruct the finding text after validation.
 */
export function buildNarrativeFromClaims(
  claims: ValidatedClaim[],
  sourceUrl: string,
  mediaOutlet?: string
): string {
  if (claims.length === 0) {
    return '';
  }

  const outlet = mediaOutlet || extractDomainName(sourceUrl);
  const claimTexts = claims.map(c => c.claim_en).join(' ');

  return `According to ${outlet}, ${claimTexts}`;
}

/**
 * Extract a readable domain name from URL.
 */
function extractDomainName(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Remove www. prefix
    return hostname.replace(/^www\./, '');
  } catch {
    return 'the source';
  }
}
