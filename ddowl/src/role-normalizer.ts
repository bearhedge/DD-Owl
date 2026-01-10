/**
 * Role Normalizer - Maps raw PDF role text to normalized categories
 */

export type NormalizedRole = 'sponsor' | 'coordinator' | 'bookrunner' | 'leadManager' | 'other';

// Map raw role text (lowercase) to normalized roles
const ROLE_MAPPINGS: Record<string, NormalizedRole[]> = {
  // Sponsor variants
  'sponsor': ['sponsor'],
  'sole sponsor': ['sponsor'],
  'joint sponsor': ['sponsor'],
  'joint sponsors': ['sponsor'],
  'listing sponsor': ['sponsor'],

  // Dual roles (Sponsor + Coordinator)
  'sponsor and overall coordinator': ['sponsor', 'coordinator'],
  'sole sponsor and overall coordinator': ['sponsor', 'coordinator'],
  'joint sponsor and overall coordinator': ['sponsor', 'coordinator'],
  'sponsor and coordinator': ['sponsor', 'coordinator'],
  'sponsor overall coordinator': ['sponsor', 'coordinator'],
  'sole sponsor overall coordinator': ['sponsor', 'coordinator'],
  'joint sponsor overall coordinator': ['sponsor', 'coordinator'],
  'sponsor overall coordinator and overall coordinator': ['sponsor', 'coordinator'],

  // Coordinator variants
  'overall coordinator': ['coordinator'],
  'overall coordinators': ['coordinator'],
  'joint overall coordinator': ['coordinator'],
  'joint overall coordinators': ['coordinator'],
  'global coordinator': ['coordinator'],
  'joint global coordinator': ['coordinator'],
  'joint global coordinators': ['coordinator'],
  'coordinator': ['coordinator'],
  'joint coordinator': ['coordinator'],

  // Bookrunner variants
  'bookrunner': ['bookrunner'],
  'joint bookrunner': ['bookrunner'],
  'joint bookrunners': ['bookrunner'],
  'global bookrunner': ['bookrunner'],
  'joint global bookrunner': ['bookrunner'],

  // Lead Manager variants
  'lead manager': ['leadManager'],
  'joint lead manager': ['leadManager'],
  'joint lead managers': ['leadManager'],
};

/**
 * Normalize raw role text to standard categories
 */
export function normalizeRole(rawRole: string): NormalizedRole[] {
  const key = rawRole.toLowerCase().trim()
    .replace(/\s+/g, ' ')  // normalize whitespace
    .replace(/[-–—]/g, ' '); // normalize dashes

  // Direct match
  if (ROLE_MAPPINGS[key]) {
    return ROLE_MAPPINGS[key];
  }

  // Fuzzy matching for variations
  const roles: NormalizedRole[] = [];

  if (key.includes('sponsor')) {
    roles.push('sponsor');
  }
  if (key.includes('coordinator') || key.includes('co-ordinator')) {
    roles.push('coordinator');
  }
  if (key.includes('bookrunner') || key.includes('book runner')) {
    roles.push('bookrunner');
  }
  if (key.includes('lead manager') || key.includes('manager')) {
    if (!roles.includes('bookrunner')) {
      roles.push('leadManager');
    }
  }

  return roles.length > 0 ? roles : ['other'];
}

/**
 * Check if role is a decision-maker (sponsor or coordinator)
 */
export function isLeadRole(roles: NormalizedRole[]): boolean {
  return roles.includes('sponsor') || roles.includes('coordinator');
}

/**
 * Get display priority for sorting (lower = more important)
 */
export function getRolePriority(roles: NormalizedRole[]): number {
  if (roles.includes('sponsor')) return 1;
  if (roles.includes('coordinator')) return 2;
  if (roles.includes('bookrunner')) return 3;
  if (roles.includes('leadManager')) return 4;
  return 5;
}
