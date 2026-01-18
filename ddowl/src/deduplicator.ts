// src/deduplicator.ts
// LLM-driven incident clustering for smart deduplication

import axios from 'axios';
import { BatchSearchResult } from './searcher.js';

// LLM Configuration (reuse same providers as triage)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';

// Types
export interface IncidentCluster {
  id: string;
  label: string;  // LLM-generated incident description
  articles: BatchSearchResult[];
  sourceTiers: number[];
}

export interface ClusteringResult {
  clusters: IncidentCluster[];
  toAnalyze: BatchSearchResult[];
  parked: BatchSearchResult[];
  stats: {
    totalArticles: number;
    totalClusters: number;
    articlesToAnalyze: number;
    articlesParked: number;
  };
}

interface BatchClusterResponse {
  clusters: number[][];  // Article indices grouped by incident
  labels: string[];      // Incident descriptions
}

// Source tier classification
const TIER_1_DOMAINS = [
  'ft.com', 'reuters.com', 'scmp.com', 'wsj.com', 'bloomberg.com',
  'gov.cn', 'csrc.gov.cn', 'sfc.hk', 'hkex.com.hk', 'icac.org.hk',
  'caixin.com', 'xinhuanet.com'
];

const TIER_2_DOMAINS = [
  'hk01.com', 'sina.com.cn', '163.com', 'eastmoney.com', 'qq.com',
  'sohu.com', 'ifeng.com', 'thepaper.cn', 'yicai.com', 'jiemian.com'
];

export function getSourceTier(url: string): 1 | 2 | 3 {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (TIER_1_DOMAINS.some(d => hostname.includes(d))) return 1;
    if (TIER_2_DOMAINS.some(d => hostname.includes(d))) return 2;
    return 3;
  } catch {
    return 3;
  }
}

// Build clustering prompt
function buildClusteringPrompt(articles: BatchSearchResult[], subjectName: string): string {
  const articleList = articles.map((a, i) => {
    const snippet = a.snippet.slice(0, 100).replace(/\n/g, ' ');
    return `${i + 1}. "${a.title}" - ${snippet}`;
  }).join('\n');

  return `You are clustering news articles about "${subjectName}" by INCIDENT.
Same news event/story = same cluster. Different events = different clusters.

Articles:
${articleList}

Rules:
- Articles about the same event (even from different angles/sources) = same cluster
- Articles about different events (even if same person) = different clusters
- If unsure, keep articles separate (don't over-merge)
- Label each cluster with a short incident description (e.g., "AC Milan破产案", "证监会调查")

Output ONLY valid JSON (no markdown, no explanation):
{"clusters": [[1,2], [3,4,5], [6]], "labels": ["incident 1", "incident 2", "incident 3"]}`;
}

// Call LLM for clustering (with fallback chain)
async function callLLMForClustering(prompt: string): Promise<BatchClusterResponse> {
  const providers = [];

  // Build provider list in priority order
  if (GEMINI_API_KEY) {
    providers.push({
      name: 'Gemini',
      call: async () => {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 4096,
            },
          },
          { timeout: 60000 }
        );
        const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return text;
      }
    });
  }

  if (DEEPSEEK_API_KEY) {
    providers.push({
      name: 'DeepSeek',
      call: async () => {
        const response = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 4096,
          },
          {
            headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
            timeout: 60000,
          }
        );
        return response.data.choices?.[0]?.message?.content || '';
      }
    });
  }

  if (KIMI_API_KEY) {
    providers.push({
      name: 'Kimi',
      call: async () => {
        const response = await axios.post(
          'https://api.moonshot.cn/v1/chat/completions',
          {
            model: 'moonshot-v1-8k',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 4096,
          },
          {
            headers: { Authorization: `Bearer ${KIMI_API_KEY}` },
            timeout: 60000,
          }
        );
        return response.data.choices?.[0]?.message?.content || '';
      }
    });
  }

  // Try providers in order
  for (const provider of providers) {
    try {
      console.log(`[CLUSTER] Trying DD Owl (${provider.name})...`);
      const responseText = await provider.call();

      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = responseText.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      // Find JSON object in response
      const jsonStart = jsonStr.indexOf('{');
      const jsonEnd = jsonStr.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
      }

      const parsed = JSON.parse(jsonStr) as BatchClusterResponse;
      console.log(`[CLUSTER] DD Owl returned ${parsed.clusters.length} clusters`);
      return parsed;
    } catch (err: any) {
      console.error(`[CLUSTER] ${provider.name} failed:`, err.message);
      continue;
    }
  }

  throw new Error('All LLM providers failed for clustering');
}

// Cluster a single batch of articles
async function clusterBatch(
  articles: BatchSearchResult[],
  subjectName: string,
  batchIndex: number
): Promise<{ clusters: IncidentCluster[]; articleIndexOffset: number }> {
  if (articles.length === 0) {
    return { clusters: [], articleIndexOffset: 0 };
  }

  const prompt = buildClusteringPrompt(articles, subjectName);

  try {
    const response = await callLLMForClustering(prompt);

    const clusters: IncidentCluster[] = response.clusters.map((indices, i) => {
      const clusterArticles = indices
        .map(idx => articles[idx - 1])  // Convert 1-based to 0-based
        .filter(Boolean);

      return {
        id: `batch${batchIndex}-cluster${i}`,
        label: response.labels[i] || `Incident ${i + 1}`,
        articles: clusterArticles,
        sourceTiers: clusterArticles.map(a => getSourceTier(a.url)),
      };
    });

    return { clusters, articleIndexOffset: articles.length };
  } catch (err: any) {
    console.error(`[CLUSTER] Batch ${batchIndex} failed:`, err.message);
    // Fallback: each article is its own cluster
    const clusters: IncidentCluster[] = articles.map((article, i) => ({
      id: `batch${batchIndex}-fallback${i}`,
      label: article.title.slice(0, 30),
      articles: [article],
      sourceTiers: [getSourceTier(article.url)],
    }));
    return { clusters, articleIndexOffset: articles.length };
  }
}

// Merge clusters with similar labels across batches
function mergeSimilarClusters(allClusters: IncidentCluster[]): IncidentCluster[] {
  if (allClusters.length <= 1) return allClusters;

  const merged: IncidentCluster[] = [];
  const used = new Set<number>();

  for (let i = 0; i < allClusters.length; i++) {
    if (used.has(i)) continue;

    const cluster = { ...allClusters[i], articles: [...allClusters[i].articles] };
    used.add(i);

    // Find clusters with similar labels
    for (let j = i + 1; j < allClusters.length; j++) {
      if (used.has(j)) continue;

      const other = allClusters[j];
      const similarity = calculateLabelSimilarity(cluster.label, other.label);

      if (similarity > 0.6) {
        // Merge clusters
        cluster.articles.push(...other.articles);
        cluster.sourceTiers.push(...other.sourceTiers);
        used.add(j);
        console.log(`[CLUSTER] Merged "${cluster.label}" with "${other.label}" (similarity: ${similarity.toFixed(2)})`);
      }
    }

    merged.push(cluster);
  }

  return merged;
}

// Calculate label similarity (simple character overlap for Chinese)
function calculateLabelSimilarity(label1: string, label2: string): number {
  // Extract Chinese characters
  const chars1 = new Set(label1.match(/[\u4e00-\u9fff]/g) || []);
  const chars2 = new Set(label2.match(/[\u4e00-\u9fff]/g) || []);

  if (chars1.size === 0 || chars2.size === 0) {
    // Fallback to simple substring check for English
    const l1 = label1.toLowerCase();
    const l2 = label2.toLowerCase();
    if (l1.includes(l2) || l2.includes(l1)) return 0.8;
    return 0;
  }

  // Jaccard similarity
  const intersection = [...chars1].filter(c => chars2.has(c)).length;
  const union = new Set([...chars1, ...chars2]).size;

  return intersection / union;
}

// Select best articles per cluster based on source tier
// Assigns clusterId and clusterLabel to each article for downstream use
function selectBestArticles(
  clusters: IncidentCluster[],
  maxPerCluster: number
): { toAnalyze: BatchSearchResult[]; parked: BatchSearchResult[] } {
  const toAnalyze: BatchSearchResult[] = [];
  const parked: BatchSearchResult[] = [];

  for (const cluster of clusters) {
    // Sort articles by source tier (tier 1 first)
    const sorted = cluster.articles
      .map((article, i) => ({ article, tier: cluster.sourceTiers[i] }))
      .sort((a, b) => a.tier - b.tier);

    // Keep best N articles, assign cluster info to ALL articles
    sorted.forEach(({ article }, i) => {
      // Attach cluster info to article (for downstream consolidation)
      const enrichedArticle: BatchSearchResult = {
        ...article,
        clusterId: cluster.id,
        clusterLabel: cluster.label,
      };

      if (i < maxPerCluster) {
        toAnalyze.push(enrichedArticle);
      } else {
        parked.push(enrichedArticle);
      }
    });
  }

  return { toAnalyze, parked };
}

// Main entry point: cluster articles by incident using LLM
export async function clusterByIncidentLLM(
  articles: BatchSearchResult[],
  subjectName: string,
  maxPerCluster: number = 3
): Promise<ClusteringResult> {
  console.log(`[CLUSTER] Starting clustering for ${articles.length} articles about "${subjectName}"`);

  if (articles.length === 0) {
    return {
      clusters: [],
      toAnalyze: [],
      parked: [],
      stats: { totalArticles: 0, totalClusters: 0, articlesToAnalyze: 0, articlesParked: 0 },
    };
  }

  // If few articles, don't bother clustering
  if (articles.length <= maxPerCluster) {
    console.log(`[CLUSTER] Only ${articles.length} articles, skipping clustering`);
    return {
      clusters: [{
        id: 'single-cluster',
        label: 'All articles',
        articles,
        sourceTiers: articles.map(a => getSourceTier(a.url)),
      }],
      toAnalyze: articles,
      parked: [],
      stats: {
        totalArticles: articles.length,
        totalClusters: 1,
        articlesToAnalyze: articles.length,
        articlesParked: 0,
      },
    };
  }

  // Split into batches of 40 articles each
  const BATCH_SIZE = 40;
  const batches: BatchSearchResult[][] = [];
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    batches.push(articles.slice(i, i + BATCH_SIZE));
  }
  console.log(`[CLUSTER] Split into ${batches.length} batches`);

  // Process batches in parallel
  const batchResults = await Promise.all(
    batches.map((batch, i) => clusterBatch(batch, subjectName, i))
  );

  // Collect all clusters
  let allClusters: IncidentCluster[] = [];
  for (const result of batchResults) {
    allClusters.push(...result.clusters);
  }
  console.log(`[CLUSTER] Got ${allClusters.length} clusters before merging`);

  // Merge similar clusters across batches
  const mergedClusters = mergeSimilarClusters(allClusters);
  console.log(`[CLUSTER] ${mergedClusters.length} clusters after merging`);

  // Log cluster summary
  console.log(`[CLUSTER] Identified ${mergedClusters.length} incidents:`);
  for (let i = 0; i < mergedClusters.length; i++) {
    const cluster = mergedClusters[i];
    const tier1 = cluster.articles.filter((_, j) => cluster.sourceTiers[j] === 1).length;
    const tier2 = cluster.articles.filter((_, j) => cluster.sourceTiers[j] === 2).length;
    const tier3 = cluster.articles.filter((_, j) => cluster.sourceTiers[j] === 3).length;
    console.log(`[CLUSTER]   ${i + 1}. "${cluster.label}" - ${cluster.articles.length} articles (T1:${tier1} T2:${tier2} T3:${tier3})`);
  }

  // Select best articles per cluster
  const { toAnalyze, parked } = selectBestArticles(mergedClusters, maxPerCluster);

  const result: ClusteringResult = {
    clusters: mergedClusters,
    toAnalyze,
    parked,
    stats: {
      totalArticles: articles.length,
      totalClusters: mergedClusters.length,
      articlesToAnalyze: toAnalyze.length,
      articlesParked: parked.length,
    },
  };

  console.log(`[CLUSTER] Done: ${articles.length} articles -> ${mergedClusters.length} incidents -> ${toAnalyze.length} to analyze, ${parked.length} parked`);

  return result;
}
