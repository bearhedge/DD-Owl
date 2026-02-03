import { Redis } from '@upstash/redis';
import { BatchSearchResult } from './searcher.js';
import { CategorizedResult } from './triage.js';
import { RawFinding, ConsolidatedFinding } from './types.js';
import { ClusteringResult, IncidentCluster } from './deduplicator.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface DetectedCompany {
  english: string;
  chinese: string;
  source: string;  // URL where we found this company (required for consistency with server.ts)
}

export interface ScreeningSession {
  name: string;
  variations: string[];
  language: string;
  gatheredResults: BatchSearchResult[];
  categorized: { red: CategorizedResult[]; amber: CategorizedResult[]; green: CategorizedResult[] };
  passedElimination: BatchSearchResult[];
  detectedCompanies?: DetectedCompany[];  // Associated companies from SFC/registry pages
  currentPhase: 'gather' | 'eliminate' | 'cluster' | 'categorize' | 'analyze' | 'consolidate' | 'complete';
  currentIndex: number;
  findings: RawFinding[];
  consolidatedFindings?: ConsolidatedFinding[];  // Stored after consolidation phase
  clusterResult?: ClusteringResult;  // Stored after clustering phase

  // === Granular progress tracking for mid-phase resume ===

  // Phase 1: Gather progress
  gatherIndex?: number;           // Which query template completed (1-indexed: 1 to N)

  // Phase 1.5: Company Expansion progress
  companyExpansionIndex?: number; // Which company we've searched (1-indexed)

  // Phase 2.5: Clustering progress
  clusterBatchIndex?: number;     // Which batch we've clustered (1-indexed)
  clusterBatchResults?: IncidentCluster[]; // Clusters found so far (before merge)

  // Phase 3: Categorize progress
  categorizeBatchIndex?: number;  // Which batch we've categorized (1-indexed)
  categorizePartialResults?: {    // Partial categorization results
    red: CategorizedResult[];
    amber: CategorizedResult[];
    green: CategorizedResult[];
  };

  // === Pause/Resume support ===
  isPaused?: boolean;   // true = server should stop processing
  pausedAt?: number;    // Timestamp when paused

  // === Event replay for reconnection ===
  recentEvents?: { type: string; data: any; timestamp: number }[];  // Last N events for replay
  lastEventIndex?: number;  // Index of last event sent to client

  // === Connection ownership ===
  connectionId?: string;  // ID of the connection that owns this session
}

const SESSION_TTL = 14400; // 4 hours in seconds

export async function createSession(sessionId: string, session: ScreeningSession): Promise<void> {
  await redis.set(`session:${sessionId}`, JSON.stringify(session), { ex: SESSION_TTL });
  console.log(`[SESSION] Created session ${sessionId} for ${session.name}`);
}

export async function getSession(sessionId: string): Promise<ScreeningSession | null> {
  const data = await redis.get<string>(`session:${sessionId}`);
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export async function updateSession(sessionId: string, updates: Partial<ScreeningSession>, connectionId?: string): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session) {
    console.error(`[SESSION] ERROR: Cannot update session ${sessionId} - session not found!`);
    return false;
  }

  // If connectionId is provided and doesn't match, reject the update (stale connection)
  if (connectionId && session.connectionId && session.connectionId !== connectionId) {
    console.log(`[SESSION] REJECTED update from stale connection ${connectionId}, current owner is ${session.connectionId}`);
    return false;
  }

  const updated = { ...session, ...updates };
  await redis.set(`session:${sessionId}`, JSON.stringify(updated), { ex: SESSION_TTL });

  // Log critical updates for debugging resume issues
  if (updates.currentIndex !== undefined || updates.currentPhase !== undefined) {
    console.log(`[SESSION] Updated ${sessionId}: phase=${updated.currentPhase}, index=${updated.currentIndex}, findings=${updated.findings?.length || 0}`);
  }
  return true;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
  console.log(`[SESSION] Deleted session ${sessionId}`);
}
