-- ============================================================
-- DD OWL DATABASE SCHEMA
-- Due Diligence Knowledge Base
-- ============================================================

-- ============================================================
-- REFERENCE TABLES (institutional knowledge, grows over time)
-- ============================================================

-- Jurisdictions (countries, regions)
CREATE TABLE jurisdictions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  name_zh VARCHAR(100),
  region VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Issue types (categories of adverse findings)
CREATE TABLE issue_types (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  name_zh VARCHAR(100),
  severity_default VARCHAR(10) CHECK (severity_default IN ('RED', 'AMBER')),
  description TEXT,
  parent_type_id INTEGER REFERENCES issue_types(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Authority types
CREATE TABLE authority_types (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  name_zh VARCHAR(100),
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Authorities (regulatory bodies, courts, law enforcement)
CREATE TABLE authorities (
  id SERIAL PRIMARY KEY,
  name_zh VARCHAR(200) NOT NULL,
  name_en VARCHAR(300) NOT NULL,
  abbreviation VARCHAR(30),
  jurisdiction_id INTEGER REFERENCES jurisdictions(id),
  authority_type_id INTEGER REFERENCES authority_types(id),
  parent_authority_id INTEGER REFERENCES authorities(id),
  level VARCHAR(20) CHECK (level IN ('national', 'provincial', 'municipal', 'district')),
  website VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- CASE TABLES (per screening)
-- ============================================================

-- Screenings (each time we run a name)
CREATE TABLE screenings (
  id SERIAL PRIMARY KEY,
  subject_name_zh VARCHAR(100) NOT NULL,
  subject_name_en VARCHAR(200),
  subject_aliases TEXT[],
  subject_dob VARCHAR(50),
  subject_id_number VARCHAR(50),
  subject_company VARCHAR(200),
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'archived')),
  searches_completed INTEGER DEFAULT 0,
  articles_fetched INTEGER DEFAULT 0,
  articles_analyzed INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,
  red_flags INTEGER DEFAULT 0,
  amber_flags INTEGER DEFAULT 0,
  green_count INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  report_json JSONB,
  notes TEXT
);

-- Issues (adverse findings, deduplicated)
CREATE TABLE issues (
  id SERIAL PRIMARY KEY,
  screening_id INTEGER REFERENCES screenings(id) ON DELETE CASCADE,
  issue_type_id INTEGER REFERENCES issue_types(id),
  issue_hash VARCHAR(64),
  title VARCHAR(500) NOT NULL,
  title_zh VARCHAR(500),
  timeframe VARCHAR(100),
  date_start DATE,
  date_end DATE,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('RED', 'AMBER')),
  status VARCHAR(30) CHECK (status IN ('convicted', 'charged', 'alleged', 'investigated', 'settled', 'acquitted', 'ongoing', 'historical', 'unknown')),
  jurisdiction_id INTEGER REFERENCES jurisdictions(id),
  summary TEXT,
  summary_zh TEXT,
  confidence_score DECIMAL(3,2),
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by VARCHAR(100),
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- People involved in issues
CREATE TABLE issue_people (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  name_zh VARCHAR(100) NOT NULL,
  name_en VARCHAR(200),
  aliases TEXT[],
  role TEXT,
  title VARCHAR(200),
  organization VARCHAR(200),
  outcome TEXT,
  sentence VARCHAR(200),
  fine_amount VARCHAR(100),
  fine_amount_raw NUMERIC,
  is_subject BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Organizations involved in issues
CREATE TABLE issue_organizations (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  name_zh VARCHAR(300) NOT NULL,
  name_en VARCHAR(400),
  stock_code VARCHAR(20),
  role TEXT,
  outcome TEXT,
  fine_amount VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Authorities involved in issues
CREATE TABLE issue_authorities (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  authority_id INTEGER REFERENCES authorities(id),
  authority_name_raw VARCHAR(300),
  action TEXT,
  action_date DATE,
  document_number VARCHAR(200),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Timeline events
CREATE TABLE issue_events (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  event_date VARCHAR(100),
  event_date_parsed DATE,
  event_type VARCHAR(50),
  description TEXT NOT NULL,
  description_zh TEXT,
  sort_order INTEGER,
  source_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Financial amounts
CREATE TABLE issue_amounts (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  description VARCHAR(300),
  description_zh VARCHAR(300),
  amount_cny VARCHAR(100),
  amount_usd VARCHAR(100),
  amount_cny_raw NUMERIC,
  amount_usd_raw NUMERIC,
  amount_type VARCHAR(50) CHECK (amount_type IN ('profit', 'loss', 'fine', 'settlement', 'contract', 'bribe', 'embezzlement', 'other')),
  currency VARCHAR(10) DEFAULT 'CNY',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Legal details
CREATE TABLE issue_legal (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  case_number VARCHAR(200),
  case_number_normalized VARCHAR(200),
  court_zh VARCHAR(300),
  court_en VARCHAR(400),
  court_level VARCHAR(30) CHECK (court_level IN ('supreme', 'higher', 'intermediate', 'basic', 'other')),
  charge TEXT,
  charge_zh TEXT,
  verdict VARCHAR(50) CHECK (verdict IN ('guilty', 'not_guilty', 'settled', 'dismissed', 'pending', 'unknown')),
  verdict_date DATE,
  appeal_status VARCHAR(50),
  appeal_outcome VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Source articles
CREATE TABLE issue_sources (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_hash VARCHAR(64),
  title VARCHAR(600),
  title_zh VARCHAR(600),
  publisher VARCHAR(300),
  publisher_type VARCHAR(50) CHECK (publisher_type IN ('government', 'court', 'regulator', 'news_major', 'news_minor', 'legal_database', 'academic', 'blog', 'social_media', 'other')),
  publish_date VARCHAR(100),
  publish_date_parsed DATE,
  language VARCHAR(10) DEFAULT 'zh',
  fetched_at TIMESTAMP DEFAULT NOW(),
  fetch_method VARCHAR(20) CHECK (fetch_method IN ('axios', 'puppeteer', 'manual')),
  content_hash VARCHAR(64),
  content_length INTEGER,
  raw_content TEXT,
  extracted_facts JSONB,
  is_primary BOOLEAN DEFAULT FALSE,
  reliability_score DECIMAL(3,2),
  notes TEXT
);

-- Search queries that led to findings
CREATE TABLE issue_searches (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
  screening_id INTEGER REFERENCES screenings(id) ON DELETE CASCADE,
  search_query TEXT NOT NULL,
  search_category VARCHAR(100),
  search_engine VARCHAR(50) DEFAULT 'serper',
  searched_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- AUDIT & LEARNING TABLES
-- ============================================================

-- New authorities discovered (for review and addition)
CREATE TABLE discovered_authorities (
  id SERIAL PRIMARY KEY,
  name_raw VARCHAR(400) NOT NULL,
  context TEXT,
  source_url TEXT,
  reviewed BOOLEAN DEFAULT FALSE,
  added_to_authorities BOOLEAN DEFAULT FALSE,
  authority_id INTEGER REFERENCES authorities(id),
  discovered_at TIMESTAMP DEFAULT NOW()
);

-- Extraction feedback (for improving prompts)
CREATE TABLE extraction_feedback (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id),
  source_id INTEGER REFERENCES issue_sources(id),
  field_name VARCHAR(100),
  extracted_value TEXT,
  correct_value TEXT,
  feedback_type VARCHAR(50) CHECK (feedback_type IN ('missing', 'incorrect', 'hallucination', 'good')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_screenings_subject ON screenings(subject_name_zh);
CREATE INDEX idx_screenings_status ON screenings(status);
CREATE INDEX idx_issues_screening ON issues(screening_id);
CREATE INDEX idx_issues_type ON issues(issue_type_id);
CREATE INDEX idx_issues_severity ON issues(severity);
CREATE INDEX idx_issues_hash ON issues(issue_hash);
CREATE INDEX idx_issue_people_name ON issue_people(name_zh);
CREATE INDEX idx_issue_people_subject ON issue_people(is_subject);
CREATE INDEX idx_issue_orgs_name ON issue_organizations(name_zh);
CREATE INDEX idx_issue_sources_url ON issue_sources(url_hash);
CREATE INDEX idx_issue_sources_content ON issue_sources(content_hash);
CREATE INDEX idx_authorities_name ON authorities(name_zh);
CREATE INDEX idx_authorities_abbrev ON authorities(abbreviation);
CREATE INDEX idx_discovered_auth_reviewed ON discovered_authorities(reviewed);

-- ============================================================
-- VIEWS
-- ============================================================

-- Summary view of screenings with issue counts by type
CREATE VIEW screening_summary AS
SELECT
  s.id,
  s.subject_name_zh,
  s.subject_name_en,
  s.status,
  s.started_at,
  s.completed_at,
  COUNT(DISTINCT i.id) as total_issues,
  COUNT(DISTINCT CASE WHEN i.severity = 'RED' THEN i.id END) as red_issues,
  COUNT(DISTINCT CASE WHEN i.severity = 'AMBER' THEN i.id END) as amber_issues,
  COUNT(DISTINCT src.id) as total_sources
FROM screenings s
LEFT JOIN issues i ON i.screening_id = s.id
LEFT JOIN issue_sources src ON src.issue_id = i.id
GROUP BY s.id;

-- Full issue details view
CREATE VIEW issue_details AS
SELECT
  i.*,
  it.name_en as issue_type_name,
  it.name_zh as issue_type_name_zh,
  j.name_en as jurisdiction_name,
  s.subject_name_zh,
  s.subject_name_en,
  COUNT(DISTINCT ip.id) as people_count,
  COUNT(DISTINCT io.id) as org_count,
  COUNT(DISTINCT isrc.id) as source_count
FROM issues i
LEFT JOIN issue_types it ON it.id = i.issue_type_id
LEFT JOIN jurisdictions j ON j.id = i.jurisdiction_id
LEFT JOIN screenings s ON s.id = i.screening_id
LEFT JOIN issue_people ip ON ip.issue_id = i.id
LEFT JOIN issue_organizations io ON io.issue_id = i.id
LEFT JOIN issue_sources isrc ON isrc.issue_id = i.id
GROUP BY i.id, it.name_en, it.name_zh, j.name_en, s.subject_name_zh, s.subject_name_en;
