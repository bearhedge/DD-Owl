// src/reportGenerator.ts
// Generates professional DD write-ups from screening findings

import axios from 'axios';
import { ConsolidatedFinding } from './types.js';

// LLM Configuration (same fallback chain as other modules)
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// Provider configuration
interface LLMProvider {
  name: string;
  url: string;
  model: string;
  apiKey: string;
}

function getProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];

  if (KIMI_API_KEY) {
    providers.push({
      name: 'Kimi',
      url: 'https://api.moonshot.ai/v1/chat/completions',
      model: 'moonshot-v1-8k',
      apiKey: KIMI_API_KEY,
    });
  }

  if (DEEPSEEK_API_KEY) {
    providers.push({
      name: 'DeepSeek',
      url: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat',
      apiKey: DEEPSEEK_API_KEY,
    });
  }

  return providers;
}

// Streaming callback type
export type StreamCallback = (chunk: string) => void;

/**
 * Generate write-up for a single finding with streaming
 */
export async function generateWriteUp(
  finding: ConsolidatedFinding,
  subjectName: string,
  onChunk: StreamCallback
): Promise<string> {
  const isRed = finding.severity === 'RED';
  const detailLevel = isRed ? '3-4 paragraphs with full detail' : '1-2 paragraphs, key facts only';

  const sourcesText = finding.sources.map((s, i) => `- ${s.url}`).join('\n');

  const prompt = `Write a professional due diligence finding following this EXACT format and style.

SUBJECT: ${subjectName}
ISSUE HEADLINE: ${finding.headline}
ISSUE SUMMARY: ${finding.summary}
SOURCE URLs:
${sourcesText}

FORMAT RULES (follow exactly):

1. HEADLINE: Write a clear headline with year range in parentheses
   Format: [Issue description] ([Year] or [Year – Year])
   Example: "Involvement in his uncle Yang Xiancai judicial corruption case (2008 – 2010)"

2. OPENING SENTENCE: Always start with source attribution
   Format: "According to [article/media type] published by [outlet name] in [Month Year], [subject]..."
   Examples:
   - "According to an article published by Shanghai Securities News (上海证券报) in December 2007, Chen Yuxing..."
   - "According to mainstream media articles in November 2020, Hui's Brothers Currency Exchange Group..."
   - "According to an article published by 22ja.com (深圳生活网) in April 2013, Xu..."

3. NAMES: Include Chinese characters and short form
   Format: Full Name (中文, "Short")
   Example: "Yang Xiancai (杨贤才, "Yang")"

4. AMOUNTS: Always include USD conversion
   Format: CNY X million (USD Y million)
   Example: "CNY 7.5 million (USD 1.05 million)"

5. BODY: Topic sentence → Context → Specific facts → Outcome
   - Include specific dates when available
   - Include roles/titles
   - Include company names with Chinese if available
   - Include case numbers if available

6. CLOSING: End with neutral status update
   Examples:
   - "No information was found indicating X was further investigated or charged."
   - "Research did not find any information suggesting..."
   - "X was not penalized or accused of any wrongdoing for the issue."
   - "No further details relating to the issue were found."

STRICT RULES:
- Do NOT include severity labels (RED, AMBER, etc.)
- Do NOT editorialize or use dramatic language
- Do NOT add meta-commentary about the report
- Do NOT use footnote numbers or "Ibid."
- Do NOT use bullet points unless listing multiple sub-incidents
- Keep tone neutral and factual throughout
- Write ${detailLevel}

EXAMPLE OUTPUT:
Involvement in his uncle Yang Xiancai judicial corruption case (2008 – 2010)

According to an article published in December 2023, Xu was involved in a corruption scandal involving Yang Xiancai (杨贤才, "Yang"), the former director of the Guangdong Higher People's Court Enforcement Bureau (广东省高级人民法院原执行局局长). Xu, then the chairman of Shenzhen Zhaobangji Group, received CNY 7.5 million (USD 1.05 million) from Yang in exchange for 10% equity in a commercial plaza project in Shenzhen Dongmen (东门) in 2006, which was held by Yang's son Yang Bin (杨彬). The article noted that the funds involved in the transaction were proceeds from Yang's bribery activities.

When investigators carried out asset recovery in January 2009, Xu returned the CNY 7.5 million (USD 1.05 million) and claimed he didn't know the proceeds had been from Yang's illegal gains. No information was found in online research indicating Xu was further investigated or charged in the issue.

Now write the finding for the issue described above:`;

  const providers = getProviders();
  let fullResponse = '';

  for (const provider of providers) {
    try {
      console.log(`[REPORT] Generating write-up with ${provider.name} (streaming)...`);

      // Use streaming for better UX
      const response = await axios.post(
        provider.url,
        {
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          stream: true,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          timeout: 120000,
          responseType: 'stream',
        }
      );

      // Process SSE stream
      return await new Promise<string>((resolve, reject) => {
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          buffer += text;

          // Process complete SSE messages
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullResponse += content;
                  onChunk(content);
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        });

        response.data.on('end', () => {
          console.log(`[REPORT] ✓ Write-up generated with ${provider.name}`);
          resolve(fullResponse);
        });

        response.data.on('error', (err: Error) => {
          reject(err);
        });
      });

    } catch (error: any) {
      console.log(`[REPORT] ✗ ${provider.name} streaming failed: ${error.message || error}`);

      // Try non-streaming fallback
      try {
        console.log(`[REPORT] Trying ${provider.name} non-streaming...`);
        const response = await axios.post(
          provider.url,
          {
            model: provider.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
            },
            timeout: 120000,
          }
        );

        const content = response.data.choices?.[0]?.message?.content || '';
        if (content) {
          console.log(`[REPORT] ✓ Write-up generated with ${provider.name} (non-streaming)`);
          onChunk(content);
          return content;
        }
      } catch (fallbackError: any) {
        console.log(`[REPORT] ✗ ${provider.name} non-streaming also failed: ${fallbackError.message}`);
      }
      continue;
    }
  }

  // Fallback: return basic formatted info
  const fallback = `${finding.headline}\n\n${finding.summary}\n\nNo additional details were found in online research.`;
  onChunk(fallback);
  return fallback;
}

/**
 * Generate full report with streaming
 */
export async function generateFullReport(
  subjectName: string,
  findings: ConsolidatedFinding[],
  onChunk: StreamCallback
): Promise<void> {
  // Simple header - just subject name
  const header = `# ${subjectName}\n\n`;
  onChunk(header);

  // Collect all sources for footer
  let allSources: { url: string; title: string }[] = [];

  // Generate write-up for each finding (no identity grouping headers)
  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];

    // Add separator between findings
    if (i > 0) {
      onChunk('\n---\n\n');
    }

    // Generate the write-up
    await generateWriteUp(finding, subjectName, onChunk);
    onChunk('\n\n');

    // Collect sources
    for (const source of finding.sources) {
      allSources.push(source);
    }
  }

  // Footer with all sources
  onChunk('---\n\n**Sources:**\n');
  const uniqueSources = [...new Map(allSources.map(s => [s.url, s])).values()];
  for (let i = 0; i < uniqueSources.length; i++) {
    onChunk(`${i + 1}. ${uniqueSources[i].url}\n`);
  }
}
