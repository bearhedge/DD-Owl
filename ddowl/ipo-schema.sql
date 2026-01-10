-- IPO Tracker Schema
-- Run this on Cloud SQL ddowl database

-- Enums
DO $$ BEGIN
    CREATE TYPE board AS ENUM ('mainBoard', 'gem');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE deal_status AS ENUM ('active', 'listed', 'withdrawn', 'lapsed', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE bank_role AS ENUM ('sponsor', 'coordinator', 'bookrunner', 'leadManager', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE bank_tier AS ENUM ('tier1', 'tier2', 'tier3', 'boutique');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Companies (IPO applicants)
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name_en VARCHAR(300) NOT NULL,
    name_cn VARCHAR(200),
    sector VARCHAR(100),
    incorporation_place VARCHAR(100),
    stock_code VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS companies_name_en_idx ON companies(name_en);
CREATE INDEX IF NOT EXISTS companies_name_cn_idx ON companies(name_cn);

-- Banks (sponsors, coordinators, bookrunners)
CREATE TABLE IF NOT EXISTS banks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    short_name VARCHAR(50),
    tier bank_tier,
    headquarters VARCHAR(100),
    parent_bank VARCHAR(200),
    website VARCHAR(300),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS banks_name_idx ON banks(name);
CREATE INDEX IF NOT EXISTS banks_tier_idx ON banks(tier);

-- Deals (IPO applications/listings)
CREATE TABLE IF NOT EXISTS deals (
    id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(id),
    board board DEFAULT 'mainBoard',
    status deal_status DEFAULT 'active',
    filing_date DATE,
    listing_date DATE,
    withdrawn_date DATE,
    hkex_app_id VARCHAR(50),
    prospectus_url VARCHAR(500),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deals_company_idx ON deals(company_id);
CREATE INDEX IF NOT EXISTS deals_status_idx ON deals(status);
CREATE INDEX IF NOT EXISTS deals_board_idx ON deals(board);
CREATE INDEX IF NOT EXISTS deals_filing_date_idx ON deals(filing_date);

-- Deal Appointments (bank-deal relationships)
CREATE TABLE IF NOT EXISTS deal_appointments (
    id SERIAL PRIMARY KEY,
    deal_id INTEGER REFERENCES deals(id) NOT NULL,
    bank_id INTEGER REFERENCES banks(id) NOT NULL,
    role bank_role NOT NULL,
    is_lead BOOLEAN DEFAULT FALSE,
    appointed_date DATE,
    terminated_date DATE,
    source_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appointments_deal_idx ON deal_appointments(deal_id);
CREATE INDEX IF NOT EXISTS appointments_bank_idx ON deal_appointments(bank_id);
CREATE INDEX IF NOT EXISTS appointments_role_idx ON deal_appointments(role);
CREATE INDEX IF NOT EXISTS appointments_lead_idx ON deal_appointments(is_lead);

-- OC Announcements (source documents)
CREATE TABLE IF NOT EXISTS oc_announcements (
    id SERIAL PRIMARY KEY,
    deal_id INTEGER REFERENCES deals(id),
    announcement_date DATE,
    pdf_url VARCHAR(500) NOT NULL,
    pdf_hash VARCHAR(64),
    parsed_data JSONB,
    extraction_confidence DECIMAL(3,2),
    parsed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oc_deal_idx ON oc_announcements(deal_id);
CREATE INDEX IF NOT EXISTS oc_date_idx ON oc_announcements(announcement_date);
CREATE INDEX IF NOT EXISTS oc_url_idx ON oc_announcements(pdf_url);

-- Scrape Runs (track scraper executions)
CREATE TABLE IF NOT EXISTS scrape_runs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50) DEFAULT 'hkex',
    board board,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    announcements_found INTEGER DEFAULT 0,
    announcements_parsed INTEGER DEFAULT 0,
    new_deals INTEGER DEFAULT 0,
    new_appointments INTEGER DEFAULT 0,
    errors JSONB,
    status VARCHAR(20) DEFAULT 'running'
);

-- View: Active IPO Pipeline
CREATE OR REPLACE VIEW ipo_pipeline AS
SELECT
    d.id as deal_id,
    c.name_en as company_name,
    c.name_cn as company_name_cn,
    d.board,
    d.status,
    d.filing_date,
    COUNT(DISTINCT da.bank_id) as bank_count,
    STRING_AGG(DISTINCT b.short_name, ', ') as banks,
    STRING_AGG(DISTINCT CASE WHEN da.is_lead THEN b.short_name END, ', ') as lead_banks
FROM deals d
JOIN companies c ON c.id = d.company_id
LEFT JOIN deal_appointments da ON da.deal_id = d.id
LEFT JOIN banks b ON b.id = da.bank_id
WHERE d.status = 'active'
GROUP BY d.id, c.name_en, c.name_cn, d.board, d.status, d.filing_date
ORDER BY d.filing_date DESC;

-- View: Bank Rankings
CREATE OR REPLACE VIEW bank_rankings AS
SELECT
    b.id as bank_id,
    b.name as bank_name,
    b.short_name,
    b.tier,
    COUNT(DISTINCT da.deal_id) as total_deals,
    COUNT(DISTINCT CASE WHEN da.role = 'sponsor' THEN da.deal_id END) as sponsor_deals,
    COUNT(DISTINCT CASE WHEN da.role = 'coordinator' THEN da.deal_id END) as coordinator_deals,
    COUNT(DISTINCT CASE WHEN da.is_lead THEN da.deal_id END) as lead_deals
FROM banks b
LEFT JOIN deal_appointments da ON da.bank_id = b.id
LEFT JOIN deals d ON d.id = da.deal_id AND d.status = 'active'
GROUP BY b.id, b.name, b.short_name, b.tier
ORDER BY total_deals DESC;
