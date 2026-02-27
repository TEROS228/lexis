import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Database pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20, // More connections for VPS
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Initialize database
(async () => {
  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_activity_date TIMESTAMP
    `);
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
})();

// CORS configuration
const allowedOrigins = [
  'https://lexis-eight.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ USERS API ============

app.post('/api/users', async (req, res) => {
  const { uid, email, displayName, photoURL } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO users (uid, email, display_name, photo_url, role, created_at)
       VALUES ($1, $2, $3, $4, 'student', CURRENT_TIMESTAMP)
       ON CONFLICT (uid) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         photo_url = EXCLUDED.photo_url
       RETURNING *`,
      [uid, email, displayName, photoURL]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:uid', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE uid = $1', [req.params.uid]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/users/:uid', async (req, res) => {
  const { role, nativeLanguage } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET role = $1, native_language = $2 WHERE uid = $3 RETURNING *`,
      [role, nativeLanguage, req.params.uid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PROGRESS API ============

app.get('/api/progress/:uid/:tier', async (req, res) => {
  const { uid, tier } = req.params;
  try {
    const result = await pool.query(
      'SELECT words, updated_at FROM progress WHERE user_uid = $1 AND tier = $2',
      [uid, tier]
    );
    if (result.rows.length === 0) {
      return res.json({ words: {}, lastUpdated: null });
    }
    res.json({ words: result.rows[0].words, lastUpdated: result.rows[0].updated_at });
  } catch (error) {
    console.error('Error getting progress:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/progress/:uid/:tier', async (req, res) => {
  const { uid, tier } = req.params;
  const { wordId, status } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO progress (user_uid, tier, words, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (user_uid, tier) DO UPDATE SET
         words = progress.words || $3,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [uid, tier, { [wordId]: status }]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving progress:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/progress/:uid/:tier/batch', async (req, res) => {
  const { uid, tier } = req.params;
  const { words } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO progress (user_uid, tier, words, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (user_uid, tier) DO UPDATE SET
         words = $3,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [uid, tier, words]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving batch progress:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/progress/:uid/:tier/stats', async (req, res) => {
  const { uid, tier } = req.params;
  try {
    const result = await pool.query(
      `SELECT
        COUNT(CASE WHEN value = 'known' THEN 1 END) as known,
        COUNT(CASE WHEN value = 'unsure' THEN 1 END) as unsure,
        COUNT(CASE WHEN value = 'unknown' THEN 1 END) as unknown,
        COUNT(*) as total
       FROM progress, jsonb_each_text(words)
       WHERE user_uid = $1 AND tier = $2`,
      [uid, tier]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/progress/:uid/:tier/learned', async (req, res) => {
  const { uid, tier } = req.params;
  try {
    const result = await pool.query(
      `SELECT jsonb_object_keys(words) as word_id
       FROM progress, jsonb_each_text(words)
       WHERE user_uid = $1 AND tier = $2 AND value = 'known'`,
      [uid, tier]
    );
    res.json({ words: result.rows.map(r => r.word_id) });
  } catch (error) {
    console.error('Error getting learned words:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ SESSIONS API ============

app.post('/api/sessions', async (req, res) => {
  const { userUid, tier, durationSeconds, wordsReviewed, knownCount, unsureCount, unknownCount, completed } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO study_sessions (user_uid, tier, duration_seconds, words_reviewed, known_count, unsure_count, unknown_count, completed, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING *`,
      [userUid, tier || 'tier2', durationSeconds, wordsReviewed, knownCount, unsureCount, unknownCount, completed || false]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving session:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM study_sessions WHERE user_uid = $1 ORDER BY started_at DESC LIMIT 50`,
      [req.params.uid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:uid/stats', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as total_sessions, COALESCE(SUM(duration_seconds), 0) as total_seconds,
       COALESCE(SUM(words_reviewed), 0) as total_words_reviewed,
       COUNT(*) FILTER (WHERE completed = true) as completed_sessions
       FROM study_sessions WHERE user_uid = $1`,
      [req.params.uid]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting session stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ STREAK API ============

app.get('/api/streak/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT current_streak, longest_streak, last_activity_date,
              CASE
                WHEN last_activity_date::date = CURRENT_DATE THEN true
                ELSE false
              END as streak_earned_today
       FROM users WHERE uid = $1`,
      [req.params.uid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting streak:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/streak/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      `WITH old_data AS (
        SELECT last_activity_date FROM users WHERE uid = $1
      ),
      updated AS (
        UPDATE users
        SET
          current_streak = CASE
            WHEN last_activity_date::date = CURRENT_DATE - INTERVAL '1 day' THEN current_streak + 1
            WHEN last_activity_date::date = CURRENT_DATE THEN current_streak
            ELSE 1
          END,
          longest_streak = CASE
            WHEN last_activity_date::date = CURRENT_DATE - INTERVAL '1 day'
              AND current_streak + 1 > longest_streak THEN current_streak + 1
            WHEN last_activity_date::date = CURRENT_DATE
              AND current_streak > longest_streak THEN current_streak
            WHEN (last_activity_date IS NULL OR last_activity_date::date < CURRENT_DATE - INTERVAL '1 day')
              AND 1 > longest_streak THEN 1
            ELSE longest_streak
          END,
          last_activity_date = CASE
            WHEN last_activity_date IS NULL OR last_activity_date::date < CURRENT_DATE THEN NOW()
            ELSE last_activity_date
          END
        WHERE uid = $1
        RETURNING current_streak, longest_streak, last_activity_date
      )
      SELECT
        updated.current_streak,
        updated.longest_streak,
        updated.last_activity_date,
        CASE
          WHEN old_data.last_activity_date IS NULL
            OR old_data.last_activity_date::date < CURRENT_DATE THEN true
          ELSE false
        END as streak_increased
      FROM updated, old_data`,
      [req.params.uid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating streak:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/streak/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users
       SET current_streak = 0, last_activity_date = NULL
       WHERE uid = $1
       RETURNING current_streak, longest_streak, last_activity_date`,
      [req.params.uid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error resetting streak:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CLASSES API ============
// (simplified version - add full implementation later)

app.get('/api/classes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM classes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ASSIGNMENTS API ============
// (simplified version - add full implementation later)

app.get('/api/assignments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM assignments ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  process.exit(0);
});
