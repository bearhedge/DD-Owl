export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export interface AnalyzedResult {
  url: string;
  title: string;
  snippet: string;
  isAdverse: boolean;
  severity: 'RED' | 'AMBER' | 'GREEN';
  headline: string;
  summary: string;
  searchTerm: string;
  category: string;
}

export interface DDOwlReport {
  subject: string;
  timestamp: string;
  searchesCompleted: number;
  totalResultsAnalyzed: number;
  flags: {
    red: AnalyzedResult[];
    amber: AnalyzedResult[];
    green: number;
  };
  recommendedAction: string;
}

// New report format with consolidated issues and footnotes
export interface Issue {
  issueType: string;
  headline: string;
  narrative: string;  // Contains ^1^ style footnotes
  sources: string[];
}

export interface DDOwlReportV2 {
  subject: string;
  timestamp: string;
  searchesCompleted: number;
  articlesAnalyzed: number;
  issues: Issue[];
  overallRisk: 'RED' | 'AMBER' | 'GREEN';
  recommendedAction: string;
}

export interface ProgressUpdate {
  type: 'progress' | 'result' | 'complete' | 'error';
  searchIndex?: number;
  totalSearches?: number;
  currentTerm?: string;
  result?: AnalyzedResult;
  report?: DDOwlReport;
  message?: string;
}
