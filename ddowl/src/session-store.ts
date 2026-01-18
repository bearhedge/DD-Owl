import { Redis } from '@upstash/redis';
import { BatchSearchResult } from './searcher.js';
import { CategorizedResult } from './triage.js';
import { RawFinding, ConsolidatedFinding } from './types.js';
import { ClusteringResult } from './deduplicator.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface ScreeningSession {
  name: string;
  variations: string[];
  language: string;
  gatheredResults: BatchSearchResult[];
  categorized: { red: CategorizedResult[]; amber: CategorizedResult[]; green: CategorizedResult[] };
  passedElimination: BatchSearchResult[];
  currentPhase: 'gather' | 'eliminate' | 'cluster' | 'categorize' | 'analyze' | 'consolidate' | 'complete';
  currentIndex: number;
  findings: RawFinding[];
  consolidatedFindings?: ConsolidatedFinding[];  // Stored after consolidation phase
  clusterResult?: ClusteringResult;  // Stored after clustering phase
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

export async function updateSession(sessionId: string, updates: Partial<ScreeningSession>): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  const updated = { ...session, ...updates };
  await redis.set(`session:${sessionId}`, JSON.stringify(updated), { ex: SESSION_TTL });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
  console.log(`[SESSION] Deleted session ${sessionId}`);
}
