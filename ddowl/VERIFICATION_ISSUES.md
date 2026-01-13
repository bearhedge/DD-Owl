# Verification Issues Log

## Systematic Issues Identified

### 1. Line-Joining Error: "Central Hong Kong" Prefix
**Affected deals:** 2168, 2443
**Pattern:** Bank names get "Central Hong Kong" prefixed from previous line
**Root cause:** `preprocessLines()` incorrectly joins location text with bank names
**Fix needed:** Improve line joining logic to not join location names (Central, Hong Kong, etc.)

### 2. Missing CLSA Pattern
**Affected deals:** 6613, 2443, 6990, 9930
**Pattern:** CLSA Limited and CLSA Global Markets variants not captured
**Root cause:** No fallback pattern for CLSA
**Fixed:** Added `/\bCLSA[^,\n]*Limited/gi` pattern

### 3. Missing International Offering Banks (PLC)
**Affected deals:** 6060, 772
**Pattern:** Morgan Stanley & Co. International plc, JP Morgan Securities plc, Merrill Lynch International
**Root cause:** 
  - Fallback was de-duping by normalized name (so Asia Limited and International plc merged)
  - No patterns for entities without "Limited" suffix
**Fixed:** 
  - Changed fallback dedup key from normalized to raw name
  - Added PLC patterns and "Merrill Lynch International" pattern

### 4. Role Prefix Not Stripped
**Affected deals:** 6199, 1557, 2597
**Patterns:** 
  - "Compliance Advisor" (vs "Adviser")
  - "Placing Underwriters"
  - "Public Offer Underwriters"  
  - "and Capital Market Intermediary"
**Fixed:** Added to rolePrefixPattern

### 5. Wrong Section Parsed
**Affected deals:** 1931 (IVD Medical)
**Pattern:** Completely wrong banks extracted
**Root cause:** Section finder picked up "Sole Sponsor" from connected transactions section instead of Parties Involved
**Fix needed:** Improve section detection to find actual "PARTIES INVOLVED IN THE GLOBAL OFFERING" section

### 6. Missing Banks: ABCI Securities vs ABCI Capital
**Pattern:** Sometimes ABCI Securities captured but not ABCI Capital, or vice versa
**Root cause:** Different entities with same normalized name
**Fix:** Already handled by raw name dedup

## Verified Deals (Locked)
<!-- Deals marked as correct should be added here and not re-extracted -->

## Action Items
- [ ] Fix "Central Hong Kong" line-joining issue in preprocessLines()
- [ ] Improve section finder to avoid wrong "Sole Sponsor" text
- [ ] Add lock-in mechanism to prevent re-extraction of verified deals
- [ ] Add CLSA Global Markets patterns
