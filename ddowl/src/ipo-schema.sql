-- IPO Deals table
CREATE TABLE IF NOT EXISTS ipo_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker INTEGER UNIQUE NOT NULL,
    company TEXT NOT NULL,
    type TEXT,  -- 'Global offering', 'Listing by introduction', etc.
    prospectus_url TEXT,
    listing_date TEXT,
    has_bank_info INTEGER DEFAULT 0,  -- 1 = yes, 0 = no
    banks_extracted INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Banks master table (normalized bank names)
CREATE TABLE IF NOT EXISTS banks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,  -- Normalized name (e.g., 'Goldman Sachs')
    aliases TEXT,  -- JSON array of aliases
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Bank roles in IPO deals (simplified: decision maker vs other)
CREATE TABLE IF NOT EXISTS ipo_bank_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL,
    bank_id INTEGER NOT NULL,
    raw_name TEXT,  -- Original name from prospectus
    is_decision_maker INTEGER DEFAULT 0,  -- 1 if sponsor (they hire DD firms)
    is_lead INTEGER DEFAULT 0,  -- 1 if lead sponsor (highest rank)
    raw_roles TEXT,  -- JSON array of original role texts from prospectus
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deal_id) REFERENCES ipo_deals(id),
    FOREIGN KEY (bank_id) REFERENCES banks(id),
    UNIQUE(deal_id, bank_id)  -- ONE row per bank per deal
);

-- URL overrides for prospectuses with wrong URLs in Excel
CREATE TABLE IF NOT EXISTS url_overrides (
    ticker INTEGER PRIMARY KEY,
    correct_url TEXT,
    excel_url TEXT,
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ipo_deals_ticker ON ipo_deals(ticker);
CREATE INDEX IF NOT EXISTS idx_ipo_deals_listing_date ON ipo_deals(listing_date);
CREATE INDEX IF NOT EXISTS idx_ipo_bank_roles_deal ON ipo_bank_roles(deal_id);
CREATE INDEX IF NOT EXISTS idx_ipo_bank_roles_bank ON ipo_bank_roles(bank_id);
CREATE INDEX IF NOT EXISTS idx_banks_name ON banks(name);
