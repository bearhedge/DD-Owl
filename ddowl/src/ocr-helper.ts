/**
 * OCR helper for extracting Chinese text from images
 * Uses Tesseract CLI with Chinese (Traditional + Simplified) language support
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Run OCR on an image buffer and extract Chinese text
 * @param imageBuffer - PNG/JPEG image data
 * @returns Extracted text from image
 */
export async function ocrImage(imageBuffer: Buffer | Uint8Array): Promise<string> {
  const tempDir = '/tmp';
  const inputPath = path.join(tempDir, `ocr_input_${Date.now()}.png`);
  const outputBase = path.join(tempDir, `ocr_output_${Date.now()}`);
  const outputPath = outputBase + '.txt';

  try {
    // Write image to temp file
    fs.writeFileSync(inputPath, imageBuffer);

    // Run Tesseract with Chinese (Traditional + Simplified) + English
    // Use chi_tra (Traditional) as primary since HK uses Traditional Chinese
    execSync(
      `tesseract "${inputPath}" "${outputBase}" -l chi_tra+chi_sim+eng --psm 6`,
      { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Read output
    if (fs.existsSync(outputPath)) {
      return fs.readFileSync(outputPath, 'utf-8');
    }
    return '';

  } catch (err: any) {
    console.error('OCR error:', err.message);
    return '';
  } finally {
    // Cleanup temp files
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

/**
 * Extract Chinese company name from OCR text
 * Looks for patterns like: XXX有限公司, XXX控股, XXX集團
 */
export function extractChineseCompanyName(ocrText: string): string | null {
  if (!ocrText) return null;

  // Find all Chinese character sequences
  const chineseMatches = ocrText.match(/[\u4e00-\u9fa5]{4,}/g) || [];

  // Priority 1: Find text ending with company suffixes
  for (const match of chineseMatches) {
    if (match.match(/(有限公司|股份公司|股份有限公司)$/)) {
      return match;
    }
  }

  // Priority 2: Find text ending with 控股 or 集團
  for (const match of chineseMatches) {
    if (match.match(/(控股|集團)$/)) {
      return match;
    }
  }

  // Priority 3: Take first reasonably long Chinese string (8+ chars)
  const longMatch = chineseMatches.find(m => m.length >= 8);
  if (longMatch) {
    // Skip common non-company phrases
    const skipPatterns = [
      /^香港聯合交易所/,
      /^中華人民共和國/,
      /^根據香港法例/,
      /^本公司董事會/,
    ];
    if (!skipPatterns.some(p => p.test(longMatch))) {
      return longMatch;
    }
  }

  return null;
}
