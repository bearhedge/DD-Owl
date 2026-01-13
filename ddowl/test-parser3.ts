// Test role matching
const ROLE_PATTERNS = [
  { pattern: /^(?:Joint\s+)?(?:Sole\s+)?Sponsors?$/i, roles: ['sponsor'], priority: 1 },
  { pattern: /^Sole\s+Global\s+Coordinator$/i, roles: ['coordinator'], priority: 2 },
  { pattern: /^Joint\s+Bookrunners?$/i, roles: ['bookrunner'], priority: 3 },
  { pattern: /^Joint\s+Lead\s+Managers?$/i, roles: ['lead_manager'], priority: 4 },
];

function matchRoleHeading(line: string) {
  const trimmed = line.trim();
  for (const { pattern, roles, priority } of ROLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { roles, priority, rawRole: trimmed };
    }
  }
  return null;
}

// Test lines from Modern Dental
const testLines = [
  'Sole Sponsor',
  'Sole Sponsor \t Deutsche Securities Asia Limited',
  'Sole Global Coordinator',
  'Joint Bookrunners',
  'Joint Lead Managers',
  'CIMB Securities Limited',  // This is a bank name, not a role
];

console.log('Testing role matching:');
for (const line of testLines) {
  const parts = line.split('\t');
  const roleMatch = matchRoleHeading(parts[0]);
  console.log(`Line: "${line.substring(0, 50)}" -> parts[0]="${parts[0]}" -> match:`, roleMatch ? roleMatch.rawRole : 'null');
}

// Test extractBankName logic
function extractBankName(line: string): string | null {
  let trimmed = line.trim();

  // Skip address lines
  if (trimmed.match(/^\d+.*Floor/i)) return null;
  if (trimmed.match(/^(?:Room|Unit|Suite)\s+\d/i)) return null;
  if (trimmed.match(/^(?:Tower|Building|Centre|Plaza|House)/i)) return null;
  if (trimmed.match(/^\d+\s+[A-Z]/)) return null;
  if (trimmed.match(/^(?:Hong Kong|Central|Kowloon|Wanchai|Admiralty)$/i)) return null;
  if (trimmed.match(/^(?:PRC|China|United Kingdom|Cayman Islands)$/i)) return null;
  if (trimmed.match(/Road|Street|Avenue|Square/i) && !trimmed.match(/Limited/i)) return null;

  // Must end with Limited, Ltd, Branch, etc.
  if (!trimmed.match(/Limited$|Ltd\.?$|Branch$|L\.L\.C\.?$/i)) return null;

  // Must start with capital letter
  if (!trimmed.match(/^[A-Z]|^The\s/i)) return null;

  // Reasonable length
  if (trimmed.length < 10 || trimmed.length > 120) return null;

  return trimmed;
}

console.log('\nTesting bank name extraction:');
const bankLines = [
  'Deutsche Securities Asia Limited',
  'Deutsche Bank AG, Hong Kong Branch',
  'CIMB Securities Limited',
  'ING Bank N.V.',
  '52/F, International Commerce Centre',  // Address - should be null
  'Hong Kong',  // Should be null
];

for (const line of bankLines) {
  const result = extractBankName(line);
  console.log(`"${line}" -> "${result}"`);
}
