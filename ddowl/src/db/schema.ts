/**
 * DD Owl Database Schema - Drizzle ORM
 *
 * IPO Tracker Tables + DD Screening Tables
 */

import { pgTable, serial, varchar, text, timestamp, integer, boolean, decimal, date, jsonb, index, pgEnum, doublePrecision } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================
// ENUMS
// ============================================================

export const boardEnum = pgEnum('board', ['mainBoard', 'gem']);
export const dealStatusEnum = pgEnum('deal_status', ['active', 'listed', 'withdrawn', 'lapsed', 'rejected']);
export const bankRoleEnum = pgEnum('bank_role', ['sponsor', 'coordinator', 'bookrunner', 'leadManager', 'other']);
export const bankTierEnum = pgEnum('bank_tier', ['tier1', 'tier2', 'tier3', 'boutique']);

// ============================================================
// IPO TRACKER TABLES
// ============================================================

/**
 * Companies - IPO applicants
 */
export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  nameEn: varchar('name_en', { length: 300 }).notNull(),
  nameCn: varchar('name_cn', { length: 200 }),
  sector: varchar('sector', { length: 100 }),
  industry: varchar('industry', { length: 200 }),
  subIndustry: varchar('sub_industry', { length: 200 }),
  incorporationPlace: varchar('incorporation_place', { length: 100 }),
  stockCode: varchar('stock_code', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  nameEnIdx: index('companies_name_en_idx').on(table.nameEn),
  nameCnIdx: index('companies_name_cn_idx').on(table.nameCn),
}));

/**
 * Banks - Sponsors, coordinators, bookrunners
 */
export const banks = pgTable('banks', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull().unique(),
  shortName: varchar('short_name', { length: 50 }),
  tier: bankTierEnum('tier'),
  headquarters: varchar('headquarters', { length: 100 }),
  parentBank: varchar('parent_bank', { length: 200 }),
  website: varchar('website', { length: 300 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  nameIdx: index('banks_name_idx').on(table.name),
  tierIdx: index('banks_tier_idx').on(table.tier),
}));

/**
 * Deals - IPO applications/listings
 */
export const deals = pgTable('deals', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id),
  board: boardEnum('board').default('mainBoard'),
  status: dealStatusEnum('status').default('active'),
  filingDate: date('filing_date'),
  listingDate: date('listing_date'),
  withdrawnDate: date('withdrawn_date'),
  hkexAppId: varchar('hkex_app_id', { length: 50 }),
  dealType: varchar('deal_type', { length: 100 }),
  sharesOffered: decimal('shares_offered', { precision: 15, scale: 0 }),
  priceHkd: decimal('price_hkd', { precision: 10, scale: 2 }),
  sizeHkdm: decimal('size_hkdm', { precision: 12, scale: 3 }),
  isDualListing: boolean('is_dual_listing').default(false),
  prospectusUrl: varchar('prospectus_url', { length: 500 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  companyIdx: index('deals_company_idx').on(table.companyId),
  statusIdx: index('deals_status_idx').on(table.status),
  boardIdx: index('deals_board_idx').on(table.board),
  filingDateIdx: index('deals_filing_date_idx').on(table.filingDate),
}));

/**
 * Deal Appointments - Bank-Deal relationships
 */
export const dealAppointments = pgTable('deal_appointments', {
  id: serial('id').primaryKey(),
  dealId: integer('deal_id').references(() => deals.id).notNull(),
  bankId: integer('bank_id').references(() => banks.id).notNull(),
  roles: bankRoleEnum('roles').array(),  // normalized roles
  rawRole: varchar('raw_role', { length: 200 }),  // original PDF text
  isLead: boolean('is_lead').default(false),
  appointedDate: date('appointed_date'),
  terminatedDate: date('terminated_date'),
  sourceUrl: varchar('source_url', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  dealIdx: index('appointments_deal_idx').on(table.dealId),
  bankIdx: index('appointments_bank_idx').on(table.bankId),
  leadIdx: index('appointments_lead_idx').on(table.isLead),
}));

/**
 * OC Announcements - Source documents
 */
export const ocAnnouncements = pgTable('oc_announcements', {
  id: serial('id').primaryKey(),
  dealId: integer('deal_id').references(() => deals.id),
  announcementDate: date('announcement_date'),
  pdfUrl: varchar('pdf_url', { length: 500 }).notNull(),
  pdfHash: varchar('pdf_hash', { length: 64 }),
  parsedData: jsonb('parsed_data'),
  extractionConfidence: decimal('extraction_confidence', { precision: 3, scale: 2 }),
  parsedAt: timestamp('parsed_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  dealIdx: index('oc_deal_idx').on(table.dealId),
  dateIdx: index('oc_date_idx').on(table.announcementDate),
  urlIdx: index('oc_url_idx').on(table.pdfUrl),
}));

/**
 * Scrape Runs - Track scraper executions
 */
export const scrapeRuns = pgTable('scrape_runs', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 50 }).default('hkex'),  // hkex, sgx, etc.
  board: boardEnum('board'),
  startedAt: timestamp('started_at').defaultNow(),
  completedAt: timestamp('completed_at'),
  announcementsFound: integer('announcements_found').default(0),
  announcementsParsed: integer('announcements_parsed').default(0),
  newDeals: integer('new_deals').default(0),
  newAppointments: integer('new_appointments').default(0),
  errors: jsonb('errors'),
  status: varchar('status', { length: 20 }).default('running'),
});

/**
 * Deal Validations - Manual validation tracking
 */
export const dealValidations = pgTable('deal_validations', {
  id: serial('id').primaryKey(),
  dealId: integer('deal_id').references(() => deals.id).notNull().unique(),
  isCorrect: boolean('is_correct'),
  notes: text('notes'),
  validatedAt: timestamp('validated_at').defaultNow(),
});

// ============================================================
// RELATIONS
// ============================================================

export const companiesRelations = relations(companies, ({ many }) => ({
  deals: many(deals),
}));

export const banksRelations = relations(banks, ({ many }) => ({
  appointments: many(dealAppointments),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  company: one(companies, {
    fields: [deals.companyId],
    references: [companies.id],
  }),
  appointments: many(dealAppointments),
  announcements: many(ocAnnouncements),
}));

export const dealAppointmentsRelations = relations(dealAppointments, ({ one }) => ({
  deal: one(deals, {
    fields: [dealAppointments.dealId],
    references: [deals.id],
  }),
  bank: one(banks, {
    fields: [dealAppointments.bankId],
    references: [banks.id],
  }),
}));

export const ocAnnouncementsRelations = relations(ocAnnouncements, ({ one }) => ({
  deal: one(deals, {
    fields: [ocAnnouncements.dealId],
    references: [deals.id],
  }),
}));

// ============================================================
// TYPES
// ============================================================

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

export type Bank = typeof banks.$inferSelect;
export type NewBank = typeof banks.$inferInsert;

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;

export type DealAppointment = typeof dealAppointments.$inferSelect;
export type NewDealAppointment = typeof dealAppointments.$inferInsert;

export type OCAnnouncement = typeof ocAnnouncements.$inferSelect;
export type NewOCAnnouncement = typeof ocAnnouncements.$inferInsert;

// ============================================================
// DD SCREENING REPORT TABLES
// ============================================================

export const ddReports = pgTable('dd_reports', {
  id: serial('id').primaryKey(),
  runId: text('run_id').unique().notNull(),
  subjectName: text('subject_name').notNull(),
  screenedAt: text('screened_at').notNull(),
  language: text('language').notNull().default('zh'),
  nameVariations: text('name_variations').notNull().default('[]'),
  findingCount: integer('finding_count').notNull().default(0),
  redCount: integer('red_count').notNull().default(0),
  amberCount: integer('amber_count').notNull().default(0),
  reportMarkdown: text('report_markdown'),
  cleanResultsJson: text('clean_results_json'),
  screeningStatsJson: text('screening_stats_json'),
  editedMarkdown: text('edited_markdown'),
  editDistance: doublePrecision('edit_distance'),
  qualityRating: integer('quality_rating'),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  queriesExecuted: integer('queries_executed').notNull().default(0),
  totalSearchResults: integer('total_search_results').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  subjectIdx: index('dd_reports_subject_idx').on(table.subjectName),
  screenedAtIdx: index('dd_reports_screened_at_idx').on(table.screenedAt),
}));

export const ddFindings = pgTable('dd_findings', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id').references(() => ddReports.id, { onDelete: 'cascade' }).notNull(),
  severity: text('severity').notNull(),
  headline: text('headline').notNull(),
  eventType: text('event_type').notNull().default('unknown'),
  summary: text('summary').notNull().default(''),
  dateRange: text('date_range'),
  sourceCount: integer('source_count').notNull().default(1),
  sourceUrls: text('source_urls').notNull().default('[]'),
  includedInReport: integer('included_in_report').notNull().default(1),
  humanVerdict: text('human_verdict'),
  wrongReason: text('wrong_reason'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  reportIdx: index('dd_findings_report_idx').on(table.reportId),
  verdictIdx: index('dd_findings_verdict_idx').on(table.humanVerdict),
}));

export const ddMissedFlags = pgTable('dd_missed_flags', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id').references(() => ddReports.id, { onDelete: 'cascade' }).notNull(),
  description: text('description').notNull(),
  severity: text('severity').notNull().default('RED'),
  eventType: text('event_type'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  reportIdx: index('dd_missed_flags_report_idx').on(table.reportId),
}));

export const ddSources = pgTable('dd_sources', {
  id: serial('id').primaryKey(),
  domain: text('domain').unique().notNull(),
  timesSeen: integer('times_seen').notNull().default(0),
  timesInFinding: integer('times_in_finding').notNull().default(0),
  timesConfirmed: integer('times_confirmed').notNull().default(0),
  timesWrong: integer('times_wrong').notNull().default(0),
  reliabilityScore: doublePrecision('reliability_score'),
  firstSeen: timestamp('first_seen').defaultNow(),
  lastSeen: timestamp('last_seen').defaultNow(),
}, (table) => ({
  domainIdx: index('dd_sources_domain_idx').on(table.domain),
  reliabilityIdx: index('dd_sources_reliability_idx').on(table.reliabilityScore),
}));

export const ddLearningRules = pgTable('dd_learning_rules', {
  id: serial('id').primaryKey(),
  ruleType: text('rule_type').notNull(),
  ruleText: text('rule_text').notNull(),
  sourceFeedbackCount: integer('source_feedback_count').notNull().default(0),
  active: integer('active').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
});

export const ddChangelog = pgTable('dd_changelog', {
  id: serial('id').primaryKey(),
  date: text('date').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull().default('prompt'),
  createdAt: timestamp('created_at').defaultNow(),
});
