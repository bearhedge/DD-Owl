// Baidu Search via SerpAPI
// Provides Baidu search results to complement Google/Serper for Chinese content

import axios from 'axios';
import { SearchResult } from './types.js';

// SerpAPI supports Baidu search with better reliability than direct API
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';
const SERPAPI_URL = 'https://serpapi.com/search.json';

interface SerpApiBaiduResult {
  organic_results?: Array<{
    title: string;
    link: string;
    snippet?: string;
    position: number;
  }>;
}

/**
 * Search Baidu via SerpAPI
 */
export async function searchBaidu(
  query: string,
  page: number = 1,
  resultsPerPage: number = 10
): Promise<SearchResult[]> {
  if (!SERPAPI_KEY) {
    // Silently skip if no API key configured
    return [];
  }

  try {
    const response = await axios.get<SerpApiBaiduResult>(SERPAPI_URL, {
      params: {
        engine: 'baidu',
        q: query,
        api_key: SERPAPI_KEY,
        start: (page - 1) * resultsPerPage,
        num: resultsPerPage,
      },
      timeout: 30000,
    });

    if (!response.data.organic_results) {
      return [];
    }

    return response.data.organic_results.map((result) => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet || '',
    }));
  } catch (error: any) {
    console.error(`[BAIDU] Search error for "${query}":`, error.message || error);
    return [];
  }
}

/**
 * Search Baidu with pagination
 */
export async function searchBaiduAllPages(
  query: string,
  maxPages: number = 3 // Baidu pages are expensive on SerpAPI, limit to 3
): Promise<SearchResult[]> {
  if (!SERPAPI_KEY) {
    return [];
  }

  const allResults: SearchResult[] = [];
  const seenUrls = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const results = await searchBaidu(query, page);

    if (results.length === 0) {
      break;
    }

    for (const result of results) {
      if (!seenUrls.has(result.link)) {
        seenUrls.add(result.link);
        allResults.push(result);
      }
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return allResults;
}

/**
 * Check if Baidu search is available
 */
export function isBaiduAvailable(): boolean {
  return !!SERPAPI_KEY;
}
