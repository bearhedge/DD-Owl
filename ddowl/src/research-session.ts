/**
 * Research Session Manager
 *
 * Tracks state of DD research on a person, coordinating:
 * 1. Person profile extraction (affiliations)
 * 2. Company page visits for each affiliation
 * 3. Data combination and report generation
 */

export interface PersonAffiliation {
  companyName: string;
  companyUrl: string;
  status: 'active' | 'cancelled' | 'revoked' | string;
  role: string;
  shareholdingPercent: string;
  isCurrent: boolean;
}

export interface CompanyDetail {
  companyName: string;
  companyUrl: string;
  registrationNumber: string;
  roles: RoleDetail[];
}

export interface RoleDetail {
  role: string;
  percentage?: string;
  appointmentDate?: string;
  resignationDate?: string;
}

export interface CombinedAffiliation {
  companyName: string;
  companyNameEnglish?: string;
  registrationNumber: string;
  status: string;
  roles: RoleDetail[];
  isCurrent: boolean;
}

export interface ResearchSession {
  id: string;
  subjectName: string;
  subjectUrl: string;
  status: 'idle' | 'extracting_affiliations' | 'crawling_companies' | 'completed' | 'failed';

  // Progress
  currentStep: string;
  progress: {
    affiliationsExtracted: number;
    companiesTotal: number;
    companiesCompleted: number;
    companiesFailed: number;
  };

  // Data
  affiliations: PersonAffiliation[];
  companyDetails: Map<string, CompanyDetail>;
  combined: CombinedAffiliation[];

  // Timestamps
  startedAt: string;
  updatedAt: string;
  completedAt?: string;

  // Errors
  errors: Array<{ company: string; error: string }>;
}

// In-memory session store (single active session for now)
let activeSession: ResearchSession | null = null;

export function createSession(subjectName: string, subjectUrl: string): ResearchSession {
  activeSession = {
    id: `session_${Date.now()}`,
    subjectName,
    subjectUrl,
    status: 'idle',
    currentStep: 'Waiting to start',
    progress: {
      affiliationsExtracted: 0,
      companiesTotal: 0,
      companiesCompleted: 0,
      companiesFailed: 0,
    },
    affiliations: [],
    companyDetails: new Map(),
    combined: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errors: [],
  };
  return activeSession;
}

export function getActiveSession(): ResearchSession | null {
  return activeSession;
}

export function updateSession(updates: Partial<ResearchSession>): ResearchSession | null {
  if (!activeSession) return null;

  Object.assign(activeSession, updates, {
    updatedAt: new Date().toISOString(),
  });

  return activeSession;
}

export function setAffiliations(affiliations: PersonAffiliation[]): void {
  if (!activeSession) return;

  activeSession.affiliations = affiliations;
  activeSession.progress.affiliationsExtracted = affiliations.length;
  activeSession.progress.companiesTotal = affiliations.length;
  activeSession.updatedAt = new Date().toISOString();
}

export function addCompanyDetail(companyUrl: string, detail: CompanyDetail): void {
  if (!activeSession) return;

  activeSession.companyDetails.set(companyUrl, detail);
  activeSession.progress.companiesCompleted++;
  activeSession.updatedAt = new Date().toISOString();
}

export function addCompanyError(companyName: string, error: string): void {
  if (!activeSession) return;

  activeSession.errors.push({ company: companyName, error });
  activeSession.progress.companiesFailed++;
  activeSession.updatedAt = new Date().toISOString();
}

export function combineData(): CombinedAffiliation[] {
  if (!activeSession) return [];

  const combined: CombinedAffiliation[] = [];

  for (const affiliation of activeSession.affiliations) {
    const companyDetail = activeSession.companyDetails.get(affiliation.companyUrl);

    // Format status for display
    let statusDisplay = '';
    if (affiliation.status !== 'active' && affiliation.status !== '存续') {
      statusDisplay = affiliation.status === 'cancelled' || affiliation.status === '注销'
        ? '(Dissolved)'
        : affiliation.status === 'revoked' || affiliation.status === '吊销'
          ? '(Revoked)'
          : `(${affiliation.status})`;
    }

    combined.push({
      companyName: statusDisplay
        ? `${affiliation.companyName} ${statusDisplay}`
        : affiliation.companyName,
      registrationNumber: companyDetail?.registrationNumber || '',
      status: affiliation.status,
      roles: companyDetail?.roles || [{
        role: affiliation.role,
        percentage: affiliation.shareholdingPercent,
      }],
      isCurrent: affiliation.isCurrent,
    });
  }

  activeSession.combined = combined;
  return combined;
}

export function completeSession(): void {
  if (!activeSession) return;

  combineData();
  activeSession.status = 'completed';
  activeSession.currentStep = 'Research complete';
  activeSession.completedAt = new Date().toISOString();
  activeSession.updatedAt = new Date().toISOString();
}

export function failSession(reason: string): void {
  if (!activeSession) return;

  activeSession.status = 'failed';
  activeSession.currentStep = `Failed: ${reason}`;
  activeSession.updatedAt = new Date().toISOString();
}

export function clearSession(): void {
  activeSession = null;
}

export function getSessionStatus() {
  if (!activeSession) {
    return { active: false };
  }

  return {
    active: true,
    id: activeSession.id,
    subjectName: activeSession.subjectName,
    status: activeSession.status,
    currentStep: activeSession.currentStep,
    progress: activeSession.progress,
    errors: activeSession.errors,
    startedAt: activeSession.startedAt,
    updatedAt: activeSession.updatedAt,
  };
}

export function getSessionResults() {
  if (!activeSession) return null;

  return {
    subjectName: activeSession.subjectName,
    subjectUrl: activeSession.subjectUrl,
    currentAffiliations: activeSession.combined.filter(a => a.isCurrent),
    historicalAffiliations: activeSession.combined.filter(a => !a.isCurrent),
    errors: activeSession.errors,
    completedAt: activeSession.completedAt,
  };
}
