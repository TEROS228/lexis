import pg from 'pg';
const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 1, // Vercel serverless - use minimal connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Initialize streak columns if they don't exist (run once)
    pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_activity_date TIMESTAMP
    `).catch(err => console.error('Error adding streak columns:', err));
  }
  return pool;
}

export default getPool();
