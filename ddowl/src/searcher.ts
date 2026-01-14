import axios from 'axios';
import { SearchResult } from './types.js';
import { searchBaidu, isBaiduAvailable } from './baiduSearcher.js';

const SERPER_API_KEY = process.env.SERPER_API_KEY || '';
const SERPER_URL = 'https://google.serper.dev/search';

export interface SerperResponse {
  organic: Array<{
    title: string;
    link: string;
    snippet: string;
    position: number;
  }>;
  searchParameters: {
    q: string;
    gl: string;
    hl: string;
    num: number;
    page: number;
  };
}

export async function searchGoogle(
  query: string,
  page: number = 1,
  resultsPerPage: number = 10
): Promise<SearchResult[]> {
  try {
    const response = await axios.post<SerperResponse>(
      SERPER_URL,
      {
        q: query,
        hl: 'zh-cn', // Chinese language preference
        num: resultsPerPage,
        page: page,
      },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.data.organic) {
      return [];
    }

    return response.data.organic.map((result) => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet || '',
    }));
  } catch (error) {
    console.error(`Search error for query "${query}" page ${page}:`, error);
    return [];
  }
}

// Callback type for progress reporting
export type SearchProgressCallback = (event: {
  type: 'page_start' | 'page_results' | 'page_end' | 'search_complete';
  engine: 'google' | 'baidu';
  page?: number;
  maxPages?: number;
  results?: SearchResult[];
  totalSoFar?: number;
}) => void;

export async function searchAllPages(
  query: string,
  maxPages: number = 10,
  onProgress?: SearchProgressCallback
): Promise<SearchResult[]> {
  const allResults: SearchResult[] = [];
  const seenUrls = new Set<string>();

  // Run Serper (Google) search
  for (let page = 1; page <= maxPages; page++) {
    onProgress?.({ type: 'page_start', engine: 'google', page, maxPages });

    const results = await searchGoogle(query, page);

    if (results.length === 0) {
      onProgress?.({ type: 'page_end', engine: 'google', page, maxPages, results: [], totalSoFar: allResults.length });
      break;
    }

    const newResults: SearchResult[] = [];
    for (const result of results) {
      if (!seenUrls.has(result.link)) {
        seenUrls.add(result.link);
        allResults.push(result);
        newResults.push(result);
      }
    }

    onProgress?.({ type: 'page_results', engine: 'google', page, maxPages, results: newResults, totalSoFar: allResults.length });

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  onProgress?.({ type: 'search_complete', engine: 'google', totalSoFar: allResults.length });
  return allResults;
}

/**
 * Search both Google (Serper) and Baidu, with progress callback
 * Runs sequentially so we can report progress in order
 */
export async function searchAllEngines(
  query: string,
  maxGooglePages: number = 10,
  maxBaiduPages: number = 3,
  onProgress?: SearchProgressCallback
): Promise<SearchResult[]> {
  const seenUrls = new Set<string>();
  const allResults: SearchResult[] = [];

  // Run Google search first with progress reporting
  const googleResults = await searchAllPages(query, maxGooglePages, onProgress);

  // Merge Google results
  for (const result of googleResults) {
    if (!seenUrls.has(result.link)) {
      seenUrls.add(result.link);
      allResults.push(result);
    }
  }

  // Run Baidu search with progress reporting
  if (isBaiduAvailable()) {
    const baiduResults = await searchBaiduPages(query, maxBaiduPages, onProgress);
    let baiduUnique = 0;
    for (const result of baiduResults) {
      if (!seenUrls.has(result.link)) {
        seenUrls.add(result.link);
        allResults.push(result);
        baiduUnique++;
      }
    }
    if (baiduUnique > 0) {
      onProgress?.({ type: 'search_complete', engine: 'baidu', totalSoFar: baiduUnique });
    }
  }

  return allResults;
}

/**
 * Helper: Search Baidu with pagination
 */
async function searchBaiduPages(
  query: string,
  maxPages: number,
  onProgress?: SearchProgressCallback
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    onProgress?.({ type: 'page_start', engine: 'baidu', page, maxPages });

    const pageResults = await searchBaidu(query, page);
    if (pageResults.length === 0) {
      onProgress?.({ type: 'page_end', engine: 'baidu', page, maxPages, results: [], totalSoFar: results.length });
      break;
    }

    const newResults: SearchResult[] = [];
    for (const result of pageResults) {
      if (!seenUrls.has(result.link)) {
        seenUrls.add(result.link);
        results.push(result);
        newResults.push(result);
      }
    }

    onProgress?.({ type: 'page_results', engine: 'baidu', page, maxPages, results: newResults, totalSoFar: results.length });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return results;
}

// ============================================================================
// BATCH SEARCH: Run all queries, gather all URLs
// ============================================================================

export interface BatchSearchResult {
  url: string;
  title: string;
  snippet: string;
  query: string;  // the dirty word template that found this
}

export type BatchSearchProgressCallback = (event: {
  type: 'query_start' | 'query_complete' | 'all_complete';
  queryIndex?: number;
  totalQueries?: number;
  query?: string;
  resultsFound?: number;
  totalResultsSoFar?: number;
}) => void;

/**
 * Run all search queries (dirty word templates) and gather all URLs.
 * Searches BOTH Google (Serper) AND Baidu for each query.
 * This is the first step: gather everything, categorize later.
 */
export async function searchAll(
  subject: string,
  searchTemplates: string[],
  onProgress?: BatchSearchProgressCallback
): Promise<BatchSearchResult[]> {
  const allResults: BatchSearchResult[] = [];
  const hasBaidu = isBaiduAvailable();

  for (let i = 0; i < searchTemplates.length; i++) {
    const template = searchTemplates[i];
    const query = template.replace('{name}', subject);

    onProgress?.({
      type: 'query_start',
      queryIndex: i + 1,
      totalQueries: searchTemplates.length,
      query,
    });

    // Search Google (Serper) - 1 page, 10 results
    const googleResults = await searchGoogle(query, 1, 10);
    for (const r of googleResults) {
      allResults.push({
        url: r.link,
        title: r.title,
        snippet: r.snippet,
        query: template,
      });
    }

    // Search Baidu if available - 1 page
    let baiduCount = 0;
    if (hasBaidu) {
      const baiduResults = await searchBaidu(query, 1);
      for (const r of baiduResults) {
        allResults.push({
          url: r.link,
          title: r.title,
          snippet: r.snippet,
          query: template,
        });
        baiduCount++;
      }
    }

    onProgress?.({
      type: 'query_complete',
      queryIndex: i + 1,
      totalQueries: searchTemplates.length,
      query,
      resultsFound: googleResults.length + baiduCount,
      totalResultsSoFar: allResults.length,
    });

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  onProgress?.({
    type: 'all_complete',
    totalResultsSoFar: allResults.length,
  });

  return allResults;
}
