/**
 * Chinese Simplified/Traditional Conversion Utilities
 *
 * Handles conversion between Simplified Chinese (used in mainland China)
 * and Traditional Chinese (used in Hong Kong, Taiwan, Apple Daily, etc.)
 *
 * Uses DeepSeek LLM for intelligent name variant generation (surname-aware)
 * Falls back to OpenCC for basic conversion
 */

// @ts-ignore - opencc-js doesn't have TypeScript types
import * as OpenCC from 'opencc-js';
import axios from 'axios';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

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
 * Basic OpenCC-based variant generation (fallback)
 * Only generates simplified and traditional via OpenCC
 * Does NOT handle surname-specific variants - use getChineseVariantsLLM for that
 */
export function getChineseVariants(name: string): string[] {
  if (!name) return [];

  const variants = new Set<string>();

  // Get fully simplified version
  const simplified = toSimplified(name);
  variants.add(simplified);

  // Get fully traditional version (via OpenCC)
  const traditional = toTraditional(name);
  variants.add(traditional);

  return Array.from(variants);
}

/**
 * Use DeepSeek LLM to generate intelligent Chinese name variants
 * DeepSeek understands surname-specific character usage (e.g., 钟→鍾 for surnames)
 * Falls back to OpenCC-based conversion if DeepSeek fails
 */
export async function getChineseVariantsLLM(name: string): Promise<string[]> {
  if (!name) return [];

  // Fallback if no API key
  if (!DEEPSEEK_API_KEY) {
    console.log('[chinese] No DeepSeek API key, using OpenCC fallback');
    return getChineseVariants(name);
  }

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are a Chinese language expert. Generate all realistic simplified and traditional Chinese variants for a person's name.

Rules:
1. Include the fully simplified version (mainland China style)
2. Include all valid traditional versions (Hong Kong/Taiwan style)
3. For surnames with multiple traditional forms (e.g., 钟→鐘/鍾, 于→於/于, 范→範/范), include ALL valid surname variants
4. NEVER mix simplified and traditional in the same name (e.g., "鍾乐晖" is invalid)
5. Return ONLY a JSON array of strings, nothing else

Example:
Input: 钟乐晖
Output: ["钟乐晖", "鐘樂暉", "鍾樂暉"]

Example:
Input: 范冰冰
Output: ["范冰冰", "范冰冰"]  (surname 范 stays 范 in traditional for this surname)`
          },
          {
            role: 'user',
            content: name
          }
        ],
        temperature: 0,
        max_tokens: 200,
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const content = response.data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.log('[chinese] DeepSeek returned empty, using fallback');
      return getChineseVariants(name);
    }

    // Parse JSON array from response
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`[chinese] DeepSeek variants for "${name}":`, parsed);
      return parsed;
    }

    return getChineseVariants(name);
  } catch (error: any) {
    console.error('[chinese] DeepSeek error, using fallback:', error.message);
    return getChineseVariants(name);
  }
}
