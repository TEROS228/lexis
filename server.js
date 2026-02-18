import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 4000;

// PostgreSQL connection
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    })
  : new Pool({
      host: 'localhost',
      port: 5432,
      database: 'lexis_db',
      user: process.env.DB_USER || process.env.USER,
      password: process.env.DB_PASSWORD || '',
    });

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// Keep-alive ping
app.get('/ping', (req, res) => res.json({ ok: true }));

// ============ USERS API ============

// Get or create user
app.post('/api/users', async (req, res) => {
  const { uid, email, displayName, photoURL } = req.body;

  try {
    // Check if user exists
    const checkUser = await pool.query(
      'SELECT * FROM users WHERE uid = $1',
      [uid]
    );

    if (checkUser.rows.length > 0) {
      // Update last login and display_name/photo_url in case they changed
      const updateResult = await pool.query(
        `UPDATE users SET last_login = CURRENT_TIMESTAMP,
          display_name = COALESCE($2, display_name),
          photo_url = COALESCE($3, photo_url)
         WHERE uid = $1 RETURNING *`,
        [uid, displayName || null, photoURL || null]
      );
      return res.json({ isNewUser: false, user: updateResult.rows[0] });
    }

    // Create new user
    const result = await pool.query(
      `INSERT INTO users (uid, email, display_name, photo_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [uid, email, displayName, photoURL]
    );

    res.json({ isNewUser: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error creating/getting user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user by UID
app.get('/api/users/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE uid = $1',
      [req.params.uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update user role and language
app.patch('/api/users/:uid', async (req, res) => {
  const { role, nativeLanguage } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users
       SET role = COALESCE($1, role),
           native_language = COALESCE($2, native_language),
           updated_at = CURRENT_TIMESTAMP
       WHERE uid = $3
       RETURNING *`,
      [role, nativeLanguage, req.params.uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PROGRESS API ============

// Get user progress for a tier
app.get('/api/progress/:uid/:tier', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT word_id, status, last_updated FROM user_progress WHERE user_uid = $1 AND tier = $2',
      [req.params.uid, req.params.tier]
    );

    // Convert to object format like Firestore
    const words = {};
    result.rows.forEach(row => {
      words[row.word_id] = row.status;
    });

    res.json({
      words,
      lastUpdated: result.rows.length > 0 ? result.rows[0].last_updated : null
    });
  } catch (error) {
    console.error('Error getting progress:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save word progress
app.post('/api/progress/:uid/:tier', async (req, res) => {
  const { wordId, status } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get previous status
    const prevResult = await client.query(
      'SELECT status FROM user_progress WHERE user_uid = $1 AND tier = $2 AND word_id = $3',
      [req.params.uid, req.params.tier, wordId]
    );
    const previousStatus = prevResult.rows.length > 0 ? prevResult.rows[0].status : null;

    // Update progress
    const result = await client.query(
      `INSERT INTO user_progress (user_uid, tier, word_id, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_uid, tier, word_id)
       DO UPDATE SET status = $4, last_updated = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.params.uid, req.params.tier, wordId, status]
    );

    // Save history only if status changed
    if (previousStatus !== status) {
      await client.query(
        `INSERT INTO word_progress_history (user_uid, tier, word_id, previous_status, new_status)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.uid, req.params.tier, wordId, previousStatus, status]
      );
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving progress:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Batch save progress
app.post('/api/progress/:uid/:tier/batch', async (req, res) => {
  const { words } = req.body; // { wordId: status, ... }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const [wordId, status] of Object.entries(words)) {
      // Get previous status
      const prevResult = await client.query(
        'SELECT status FROM user_progress WHERE user_uid = $1 AND tier = $2 AND word_id = $3',
        [req.params.uid, req.params.tier, wordId]
      );
      const previousStatus = prevResult.rows.length > 0 ? prevResult.rows[0].status : null;

      // Update progress
      await client.query(
        `INSERT INTO user_progress (user_uid, tier, word_id, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_uid, tier, word_id)
         DO UPDATE SET status = $4, last_updated = CURRENT_TIMESTAMP`,
        [req.params.uid, req.params.tier, wordId, status]
      );

      // Save history only if status changed
      if (previousStatus !== status) {
        await client.query(
          `INSERT INTO word_progress_history (user_uid, tier, word_id, previous_status, new_status)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.params.uid, req.params.tier, wordId, previousStatus, status]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, count: Object.keys(words).length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error batch saving progress:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get progress statistics
app.get('/api/progress/:uid/:tier/stats', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        status,
        COUNT(*) as count
       FROM user_progress
       WHERE user_uid = $1 AND tier = $2
       GROUP BY status`,
      [req.params.uid, req.params.tier]
    );

    const stats = {
      known: 0,
      unsure: 0,
      unknown: 0,
      total: 0
    };

    result.rows.forEach(row => {
      stats[row.status] = parseInt(row.count);
      stats.total += parseInt(row.count);
    });

    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get learned words (words that moved from unknown/unsure to known)
app.get('/api/progress/:uid/:tier/learned', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT h.word_id, h.previous_status, h.changed_at
       FROM word_progress_history h
       INNER JOIN user_progress p ON h.user_uid = p.user_uid
         AND h.tier = p.tier
         AND h.word_id = p.word_id
       WHERE h.user_uid = $1
         AND h.tier = $2
         AND h.new_status = 'known'
         AND h.previous_status IN ('unknown', 'unsure')
         AND p.status = 'known'
       ORDER BY h.changed_at DESC`,
      [req.params.uid, req.params.tier]
    );

    res.json({ words: result.rows });
  } catch (error) {
    console.error('Error getting learned words:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CLASSES API ============

// Generate unique class code
function generateClassCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create a new class
app.post('/api/classes', async (req, res) => {
  const { teacherUid, className } = req.body;

  try {
    // Generate unique class code
    let classCode;
    let isUnique = false;

    while (!isUnique) {
      classCode = generateClassCode();
      const checkResult = await pool.query(
        'SELECT id FROM classes WHERE class_code = $1',
        [classCode]
      );
      isUnique = checkResult.rows.length === 0;
    }

    // Create class
    const result = await pool.query(
      `INSERT INTO classes (class_code, class_name, teacher_uid)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [classCode, className, teacherUid]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all classes for a teacher
app.get('/api/classes/teacher/:teacherUid', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM class_enrollments WHERE class_id = c.id) as student_count
       FROM classes c
       WHERE c.teacher_uid = $1
       ORDER BY c.created_at DESC`,
      [req.params.teacherUid]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting teacher classes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get class details with students
app.get('/api/classes/:classId', async (req, res) => {
  try {
    const classResult = await pool.query(
      'SELECT * FROM classes WHERE id = $1',
      [req.params.classId]
    );

    if (classResult.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const studentsResult = await pool.query(
      `SELECT u.uid, u.email, u.display_name, u.photo_url, ce.joined_at
       FROM class_enrollments ce
       JOIN users u ON ce.student_uid = u.uid
       WHERE ce.class_id = $1
       ORDER BY ce.joined_at DESC`,
      [req.params.classId]
    );

    res.json({
      class: classResult.rows[0],
      students: studentsResult.rows
    });
  } catch (error) {
    console.error('Error getting class details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Join a class with code
app.post('/api/classes/join', async (req, res) => {
  const { studentUid, classCode } = req.body;

  try {
    // Find class by code
    const classResult = await pool.query(
      'SELECT id FROM classes WHERE class_code = $1',
      [classCode.toUpperCase()]
    );

    if (classResult.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const classId = classResult.rows[0].id;

    // Enroll student
    await pool.query(
      `INSERT INTO class_enrollments (class_id, student_uid)
       VALUES ($1, $2)
       ON CONFLICT (class_id, student_uid) DO NOTHING`,
      [classId, studentUid]
    );

    res.json({ success: true, classId });
  } catch (error) {
    console.error('Error joining class:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get student's classes
app.get('/api/classes/student/:studentUid', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.display_name as teacher_name
       FROM class_enrollments ce
       JOIN classes c ON ce.class_id = c.id
       JOIN users u ON c.teacher_uid = u.uid
       WHERE ce.student_uid = $1
       ORDER BY ce.joined_at DESC`,
      [req.params.studentUid]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting student classes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get student progress for a teacher (all tiers)
app.get('/api/classes/student/:studentUid/progress', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT tier, status, COUNT(*) as count
       FROM user_progress
       WHERE user_uid = $1
       GROUP BY tier, status
       ORDER BY tier, status`,
      [req.params.studentUid]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting student progress:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a class
app.delete('/api/classes/:classId', async (req, res) => {
  try {
    await pool.query('DELETE FROM classes WHERE id = $1', [req.params.classId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ SESSIONS API ============

// Save a study session
app.post('/api/sessions', async (req, res) => {
  const { userUid, tier, durationSeconds, wordsReviewed, knownCount, unsureCount, unknownCount, completed } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO study_sessions (user_uid, tier, duration_seconds, words_reviewed, known_count, unsure_count, unknown_count, completed, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userUid, tier || 'tier2', durationSeconds, wordsReviewed, knownCount, unsureCount, unknownCount, completed || false]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get sessions for a user
app.get('/api/sessions/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM study_sessions
       WHERE user_uid = $1
       ORDER BY started_at DESC
       LIMIT 50`,
      [req.params.uid]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get session stats for a user (total time, total sessions)
app.get('/api/sessions/:uid/stats', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(duration_seconds), 0) as total_seconds,
        COALESCE(SUM(words_reviewed), 0) as total_words_reviewed,
        COUNT(*) FILTER (WHERE completed = true) as completed_sessions
       FROM study_sessions
       WHERE user_uid = $1`,
      [req.params.uid]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting session stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ASSIGNMENTS API ============

// Create assignments table if not exists
pool.query(`
  CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    student_uid VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
    teacher_uid VARCHAR(255) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('words', 'time')),
    target INTEGER NOT NULL,
    due_date TIMESTAMP NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).catch(err => console.error('Error creating assignments table:', err));

// Create assignment (for whole class or specific student)
app.post('/api/assignments', async (req, res) => {
  const { classId, studentUid, teacherUid, type, target, dueDate, title, description } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO assignments (class_id, student_uid, teacher_uid, type, target, due_date, title, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [classId || null, studentUid || null, teacherUid, type, target, dueDate, title, description || null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get assignments for a student (by uid — includes class assignments they belong to)
app.get('/api/assignments/student/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, u.display_name as teacher_name,
              c.class_name
       FROM assignments a
       LEFT JOIN users u ON a.teacher_uid = u.uid
       LEFT JOIN classes c ON a.class_id = c.id
       WHERE a.student_uid = $1
          OR (a.class_id IS NOT NULL AND a.class_id IN (
                SELECT class_id FROM class_enrollments WHERE student_uid = $1
              ))
       ORDER BY a.due_date ASC`,
      [req.params.uid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting student assignments:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get assignments created by teacher
app.get('/api/assignments/teacher/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, c.class_name,
              u.display_name as student_name
       FROM assignments a
       LEFT JOIN classes c ON a.class_id = c.id
       LEFT JOIN users u ON a.student_uid = u.uid
       WHERE a.teacher_uid = $1
       ORDER BY a.created_at DESC`,
      [req.params.uid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting teacher assignments:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get assignment progress (who completed, who didn't)
app.get('/api/assignments/:id/progress', async (req, res) => {
  try {
    const assignmentResult = await pool.query(
      `SELECT a.*, c.class_name FROM assignments a LEFT JOIN classes c ON a.class_id = c.id WHERE a.id = $1`,
      [req.params.id]
    );
    if (assignmentResult.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const assignment = assignmentResult.rows[0];

    let students = [];

    // Get students: either class members or single student
    if (assignment.class_id) {
      const classStudents = await pool.query(
        `SELECT u.uid, u.display_name, u.email, u.photo_url FROM class_members cm JOIN users u ON cm.student_uid = u.uid WHERE cm.class_id = $1`,
        [assignment.class_id]
      );
      students = classStudents.rows;
    } else if (assignment.student_uid) {
      const studentResult = await pool.query(
        `SELECT uid, display_name, email, photo_url FROM users WHERE uid = $1`,
        [assignment.student_uid]
      );
      students = studentResult.rows;
    }

    // For each student calculate progress
    const studentsWithProgress = await Promise.all(students.map(async (student) => {
      let current = 0;

      if (assignment.type === 'words') {
        const progressResult = await pool.query(
          `SELECT COUNT(*) FROM user_progress WHERE user_uid = $1 AND tier = 'tier2' AND status = 'known'`,
          [student.uid]
        );
        current = parseInt(progressResult.rows[0].count);
      } else {
        // type = 'time' — sum of session durations
        const sessionResult = await pool.query(
          `SELECT COALESCE(SUM(duration_seconds), 0) as total FROM study_sessions WHERE user_uid = $1`,
          [student.uid]
        );
        current = Math.floor(parseInt(sessionResult.rows[0].total) / 60); // convert to minutes
      }

      const target = assignment.target;
      const percent = Math.min(100, Math.round((current / target) * 100));
      const done = current >= target;

      return { ...student, current, target, percent, done };
    }));

    res.json({ assignment, students: studentsWithProgress });
  } catch (error) {
    console.error('Error getting assignment progress:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete assignment
app.delete('/api/assignments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM assignments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting assignment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'postgresql' });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 API server running on http://localhost:${port}`);
  console.log(`📊 Database: PostgreSQL (lexis_db)`);
});

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await pool.end();
  process.exit(0);
});
