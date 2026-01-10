/**
 * Database connection using Drizzle ORM
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

// Get database URL from environment
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('DATABASE_URL not set, database operations will fail');
}

// Create connection pool
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl?.includes('34.') || databaseUrl?.includes('35.') ? { rejectUnauthorized: false } : false,
});

// Create drizzle instance with schema
export const db = drizzle(pool, { schema });

// Export schema for easy access
export * from './schema.js';

// Helper to close pool on shutdown
export async function closeDb() {
  await pool.end();
}
