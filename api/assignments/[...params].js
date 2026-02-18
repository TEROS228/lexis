import { getPool } from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pool = getPool();
  const params = req.query.params || [];

  // POST /api/assignments
  if (req.method === 'POST' && params.length === 0) {
    const { classId, studentUid, teacherUid, type, target, dueDate, title, description } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO assignments (class_id, student_uid, teacher_uid, type, target, due_date, title, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [classId || null, studentUid || null, teacherUid, type, target, dueDate, title, description || null]
      );
      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/assignments/student/:uid
  if (req.method === 'GET' && params[0] === 'student') {
    try {
      const result = await pool.query(
        `SELECT a.*, u.display_name as teacher_name, c.class_name FROM assignments a
         LEFT JOIN users u ON a.teacher_uid = u.uid LEFT JOIN classes c ON a.class_id = c.id
         WHERE a.student_uid = $1 OR (a.class_id IS NOT NULL AND a.class_id IN (
           SELECT class_id FROM class_enrollments WHERE student_uid = $1
         )) ORDER BY a.due_date ASC`,
        [params[1]]
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/assignments/teacher/:uid
  if (req.method === 'GET' && params[0] === 'teacher') {
    try {
      const result = await pool.query(
        `SELECT a.*, c.class_name, u.display_name as student_name FROM assignments a
         LEFT JOIN classes c ON a.class_id = c.id LEFT JOIN users u ON a.student_uid = u.uid
         WHERE a.teacher_uid = $1 ORDER BY a.created_at DESC`,
        [params[1]]
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/assignments/:id/progress
  if (req.method === 'GET' && params.length === 2 && params[1] === 'progress') {
    try {
      const assignmentResult = await pool.query(
        `SELECT a.*, c.class_name FROM assignments a LEFT JOIN classes c ON a.class_id = c.id WHERE a.id = $1`,
        [params[0]]
      );
      if (assignmentResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const assignment = assignmentResult.rows[0];

      let students = [];
      if (assignment.class_id) {
        const r = await pool.query(
          `SELECT u.uid, u.display_name, u.email, u.photo_url FROM class_members cm JOIN users u ON cm.student_uid = u.uid WHERE cm.class_id = $1`,
          [assignment.class_id]
        );
        students = r.rows;
      } else if (assignment.student_uid) {
        const r = await pool.query(`SELECT uid, display_name, email, photo_url FROM users WHERE uid = $1`, [assignment.student_uid]);
        students = r.rows;
      }

      const studentsWithProgress = await Promise.all(students.map(async (student) => {
        let current = 0;
        if (assignment.type === 'words') {
          const r = await pool.query(`SELECT COUNT(*) FROM user_progress WHERE user_uid = $1 AND tier = 'tier2' AND status = 'known'`, [student.uid]);
          current = parseInt(r.rows[0].count);
        } else {
          const r = await pool.query(`SELECT COALESCE(SUM(duration_seconds), 0) as total FROM study_sessions WHERE user_uid = $1`, [student.uid]);
          current = Math.floor(parseInt(r.rows[0].total) / 60);
        }
        const percent = Math.min(100, Math.round((current / assignment.target) * 100));
        return { ...student, current, target: assignment.target, percent, done: current >= assignment.target };
      }));

      return res.json({ assignment, students: studentsWithProgress });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // DELETE /api/assignments/:id
  if (req.method === 'DELETE' && params.length === 1) {
    try {
      await pool.query('DELETE FROM assignments WHERE id = $1', [params[0]]);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
