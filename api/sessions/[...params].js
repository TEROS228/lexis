import { getPool } from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pool = getPool();

  // Parse URL to get path segments
  const urlPath = req.url.split('?')[0]; // Remove query string
  const pathSegments = urlPath.split('/').filter(Boolean); // ['api', 'sessions', ...]
  const params = pathSegments.slice(2); // Remove 'api' and 'sessions'

  console.log('Sessions API:', { method: req.method, params, url: req.url, pathSegments });

  // POST /api/sessions
  if (req.method === 'POST' && params.length === 0) {
    const { userUid, tier, durationSeconds, wordsReviewed, knownCount, unsureCount, unknownCount, completed } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO study_sessions (user_uid, tier, duration_seconds, words_reviewed, known_count, unsure_count, unknown_count, completed, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING *`,
        [userUid, tier || 'tier2', durationSeconds, wordsReviewed, knownCount, unsureCount, unknownCount, completed || false]
      );
      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/sessions/:uid/stats
  if (req.method === 'GET' && params[1] === 'stats') {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as total_sessions, COALESCE(SUM(duration_seconds), 0) as total_seconds,
         COALESCE(SUM(words_reviewed), 0) as total_words_reviewed,
         COUNT(*) FILTER (WHERE completed = true) as completed_sessions
         FROM study_sessions WHERE user_uid = $1`,
        [params[0]]
      );
      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/sessions/:uid
  if (req.method === 'GET' && params.length === 1) {
    try {
      const result = await pool.query(
        `SELECT * FROM study_sessions WHERE user_uid = $1 ORDER BY started_at DESC LIMIT 50`,
        [params[0]]
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  console.error('No matching route:', { method: req.method, params });
  res.status(405).json({
    error: 'Method not allowed',
    debug: { method: req.method, params, paramsLength: params.length }
  });
}
