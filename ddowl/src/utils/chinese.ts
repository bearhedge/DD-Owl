/**
 * Chinese Simplified/Traditional Conversion Utilities
 *
 * Handles conversion between Simplified Chinese (used in mainland China)
 * and Traditional Chinese (used in Hong Kong, Taiwan, Apple Daily, etc.)
 */

// @ts-ignore - opencc-js doesn't have TypeScript types
import * as OpenCC from 'opencc-js';

// Create converter for Simplified → Traditional (Taiwan standard)
const s2tConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });

// Create converter for Traditional → Simplified
const t2sConverter = OpenCC.Converter({ from: 'tw', to: 'cn' });

/**
 * Convert Simplified Chinese to Traditional Chinese
 * @param text - Text in Simplified Chinese
 * @returns Text in Traditional Chinese
 */
export function toTraditional(text: string): string {
  if (!text) return text;
  return s2tConverter(text);
}

/**
 * Convert Traditional Chinese to Simplified Chinese
 * @param text - Text in Traditional Chinese
 * @returns Text in Simplified Chinese
 */
export function toSimplified(text: string): string {
  if (!text) return text;
  return t2sConverter(text);
}

/**
 * Check if text contains Simplified Chinese characters
 * (i.e., would be different when converted to Traditional)
 */
export function hasSimplifiedChars(text: string): boolean {
  if (!text) return false;
  return text !== toTraditional(text);
}

/**
 * Check if text contains Traditional Chinese characters
 * (i.e., would be different when converted to Simplified)
 */
export function hasTraditionalChars(text: string): boolean {
  if (!text) return false;
  return text !== toSimplified(text);
}

/**
 * Get both Simplified and Traditional variants of a name
 * Returns array with unique values only
 */
export function getChineseVariants(name: string): string[] {
  if (!name) return [];

  const variants = new Set<string>();
  variants.add(name); // Original

  const traditional = toTraditional(name);
  if (traditional !== name) {
    variants.add(traditional);
  }

  const simplified = toSimplified(name);
  if (simplified !== name) {
    variants.add(simplified);
  }

  return Array.from(variants);
}
