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

    // Create classes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        teacher_uid TEXT NOT NULL,
        class_name TEXT NOT NULL,
        class_code TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create class_enrollments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_enrollments (
        id SERIAL PRIMARY KEY,
        class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
        student_uid TEXT NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(class_id, student_uid)
      )
    `);

    // Create assignments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS assignments (
        id SERIAL PRIMARY KEY,
        teacher_uid TEXT NOT NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        target INTEGER NOT NULL,
        due_date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
})();

// CORS configuration
const allowedOrigins = [
  'https://lexis-eight.vercel.app',
  'https://wordlex.online',
  'https://www.wordlex.online',
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
  console.log('📝 Creating/updating user:', { uid, email, displayName });
  try {
    const result = await pool.query(
      `INSERT INTO users (uid, email, display_name, photo_url, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (uid) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         photo_url = EXCLUDED.photo_url
       RETURNING *`,
      [uid, email, displayName, photoURL]
    );
    console.log('✅ User result:', { uid: result.rows[0].uid, email: result.rows[0].email, role: result.rows[0].role });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating user:', error);
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

// ============ CLASSES API ============

// Get all classes for a teacher
app.get('/api/classes/teacher/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const result = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM class_enrollments WHERE class_id = c.id) as student_count
       FROM classes c
       WHERE c.teacher_uid = $1
       ORDER BY c.created_at DESC`,
      [uid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error loading classes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new class
app.post('/api/classes', async (req, res) => {
  try {
    const { teacherUid, className } = req.body;

    // Generate unique 6-character code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const result = await pool.query(
      'INSERT INTO classes (teacher_uid, class_name, class_code) VALUES ($1, $2, $3) RETURNING *',
      [teacherUid, className, code]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get class details with students
app.get('/api/classes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get class info
    const classResult = await pool.query('SELECT * FROM classes WHERE id = $1', [id]);
    if (classResult.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Get students
    const studentsResult = await pool.query(
      `SELECT u.uid, u.email, u.display_name, u.photo_url, ce.joined_at
       FROM class_enrollments ce
       JOIN users u ON ce.student_uid = u.uid
       WHERE ce.class_id = $1
       ORDER BY ce.joined_at DESC`,
      [id]
    );

    res.json({
      class: classResult.rows[0],
      students: studentsResult.rows
    });
  } catch (error) {
    console.error('Error loading class:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a class
app.delete('/api/classes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM classes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get students in a class
app.get('/api/classes/:id/students', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT cs.*, u.email, u.display_name, u.photo_url
       FROM class_enrollments cs
       LEFT JOIN users u ON cs.student_uid = u.uid
       WHERE cs.class_id = $1
       ORDER BY cs.joined_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error loading students:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ASSIGNMENTS API ============

// Get all assignments for a teacher
app.get('/api/assignments/teacher/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const result = await pool.query(
      `SELECT a.*, c.class_name
       FROM assignments a
       LEFT JOIN classes c ON a.class_id = c.id
       WHERE a.teacher_uid = $1
       ORDER BY a.created_at DESC`,
      [uid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error loading assignments:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new assignment
app.post('/api/assignments', async (req, res) => {
  try {
    const { teacher_uid, class_id, title, description, type, target, due_date } = req.body;

    const result = await pool.query(
      `INSERT INTO assignments (teacher_uid, class_id, title, description, type, target, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [teacher_uid, class_id, title, description, type, target, due_date]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete an assignment
app.delete('/api/assignments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM assignments WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting assignment:', error);
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
