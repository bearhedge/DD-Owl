import axios from 'axios';
import { SearchResult } from './types.js';

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
        gl: 'cn', // China
        hl: 'zh-cn', // Chinese
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

export async function searchAllPages(
  query: string,
  maxPages: number = 10
): Promise<SearchResult[]> {
  const allResults: SearchResult[] = [];
  const seenUrls = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const results = await searchGoogle(query, page);

    if (results.length === 0) {
      // No more results
      break;
    }

    for (const result of results) {
      if (!seenUrls.has(result.link)) {
        seenUrls.add(result.link);
        allResults.push(result);
      }
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return allResults;
}
