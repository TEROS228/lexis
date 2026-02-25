import { getPool } from '../_db.js';

function generateClassCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pool = getPool();
  const params = Array.isArray(req.query.params) ? req.query.params : (req.query.params ? [req.query.params] : []);

  // POST /api/classes (no params)
  if (req.method === 'POST' && params.length === 0) {
    const { teacherUid, className } = req.body;
    try {
      let classCode, isUnique = false;
      while (!isUnique) {
        classCode = generateClassCode();
        const check = await pool.query('SELECT id FROM classes WHERE class_code = $1', [classCode]);
        isUnique = check.rows.length === 0;
      }
      const result = await pool.query(
        `INSERT INTO classes (class_code, class_name, teacher_uid) VALUES ($1, $2, $3) RETURNING *`,
        [classCode, className, teacherUid]
      );
      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // POST /api/classes/join
  if (req.method === 'POST' && params[0] === 'join') {
    const { studentUid, classCode } = req.body;
    try {
      const classResult = await pool.query('SELECT id FROM classes WHERE class_code = $1', [classCode.toUpperCase()]);
      if (classResult.rows.length === 0) return res.status(404).json({ error: 'Class not found' });
      const classId = classResult.rows[0].id;
      await pool.query(
        `INSERT INTO class_enrollments (class_id, student_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [classId, studentUid]
      );
      return res.json({ success: true, classId });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/classes/teacher/:uid
  if (req.method === 'GET' && params[0] === 'teacher') {
    const teacherUid = params[1];
    try {
      const result = await pool.query(
        `SELECT c.*, (SELECT COUNT(*) FROM class_enrollments WHERE class_id = c.id) as student_count
         FROM classes c WHERE c.teacher_uid = $1 ORDER BY c.created_at DESC`,
        [teacherUid]
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/classes/student/:uid
  if (req.method === 'GET' && params[0] === 'student' && params.length === 2) {
    const studentUid = params[1];
    try {
      const result = await pool.query(
        `SELECT c.*, u.display_name as teacher_name FROM class_enrollments ce
         JOIN classes c ON ce.class_id = c.id JOIN users u ON c.teacher_uid = u.uid
         WHERE ce.student_uid = $1 ORDER BY ce.joined_at DESC`,
        [studentUid]
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/classes/student/:uid/progress
  if (req.method === 'GET' && params[0] === 'student' && params[2] === 'progress') {
    const studentUid = params[1];
    try {
      const result = await pool.query(
        `SELECT tier, status, COUNT(*) as count FROM user_progress WHERE user_uid = $1 GROUP BY tier, status ORDER BY tier, status`,
        [studentUid]
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/classes/:classId
  if (req.method === 'GET' && params.length === 1) {
    const classId = params[0];
    try {
      const classResult = await pool.query('SELECT * FROM classes WHERE id = $1', [classId]);
      if (classResult.rows.length === 0) return res.status(404).json({ error: 'Class not found' });
      const studentsResult = await pool.query(
        `SELECT u.uid, u.email, u.display_name, u.photo_url, ce.joined_at
         FROM class_enrollments ce JOIN users u ON ce.student_uid = u.uid
         WHERE ce.class_id = $1 ORDER BY ce.joined_at DESC`,
        [classId]
      );
      return res.json({ class: classResult.rows[0], students: studentsResult.rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // DELETE /api/classes/:classId
  if (req.method === 'DELETE' && params.length === 1) {
    const classId = params[0];
    try {
      await pool.query('DELETE FROM classes WHERE id = $1', [classId]);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
