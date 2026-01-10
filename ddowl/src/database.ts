import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(__dirname, '../data/ddowl.db'));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    qcc_url TEXT UNIQUE,
    extracted_at TEXT,
    raw_json TEXT
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    qcc_url TEXT UNIQUE,
    unified_credit_code TEXT,
    legal_representative TEXT,
    registered_capital TEXT,
    established_date TEXT,
    operating_status TEXT,
    extracted_at TEXT,
    raw_json TEXT
  );

  CREATE TABLE IF NOT EXISTS affiliations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER,
    company_id INTEGER,
    position TEXT,
    appointment_date TEXT,
    resignation_date TEXT,
    status TEXT,
    FOREIGN KEY (person_id) REFERENCES persons(id),
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS crawl_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    type TEXT CHECK(type IN ('person', 'company')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    parent_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

export function savePerson(data: any) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO persons (name, qcc_url, extracted_at, raw_json)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(data.personName, data.sourceUrl, data.extractedAt, JSON.stringify(data));
}

export function saveCompany(data: any) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO companies (name, qcc_url, unified_credit_code, legal_representative,
      registered_capital, established_date, operating_status, extracted_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    data.companyName,
    data.sourceUrl,
    data.unifiedSocialCreditCode,
    data.legalRepresentative,
    data.registeredCapital,
    data.establishedDate,
    data.operatingStatus,
    data.extractedAt,
    JSON.stringify(data)
  );
}

export function queueUrl(url: string, type: 'person' | 'company', parentUrl?: string) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO crawl_queue (url, type, parent_url)
    VALUES (?, ?, ?)
  `);
  return stmt.run(url, type, parentUrl);
}

export function getNextInQueue() {
  const stmt = db.prepare(`
    SELECT * FROM crawl_queue WHERE status = 'pending' ORDER BY id LIMIT 1
  `);
  return stmt.get();
}

export function markQueueItem(id: number, status: 'processing' | 'completed' | 'failed') {
  const stmt = db.prepare(`UPDATE crawl_queue SET status = ? WHERE id = ?`);
  return stmt.run(status, id);
}

export function getQueueStats() {
  const stmt = db.prepare(`
    SELECT status, COUNT(*) as count FROM crawl_queue GROUP BY status
  `);
  return stmt.all();
}

export default db;
