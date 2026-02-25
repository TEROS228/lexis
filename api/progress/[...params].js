import { getPool } from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pool = getPool();
  // params: [uid, tier] or [uid, tier, 'stats'|'learned'|'batch']
  const params = Array.isArray(req.query.params) ? req.query.params : (req.query.params ? [req.query.params] : []);
  const [uid, tier, action] = params;

  // GET /api/progress/:uid/:tier/stats
  if (req.method === 'GET' && action === 'stats') {
    try {
      const result = await pool.query(
        `SELECT status, COUNT(*) as count FROM user_progress WHERE user_uid = $1 AND tier = $2 GROUP BY status`,
        [uid, tier]
      );
      const stats = { known: 0, unsure: 0, unknown: 0, total: 0 };
      result.rows.forEach(row => {
        stats[row.status] = parseInt(row.count);
        stats.total += parseInt(row.count);
      });
      return res.json(stats);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/progress/:uid/:tier/learned
  if (req.method === 'GET' && action === 'learned') {
    try {
      const result = await pool.query(
        `SELECT DISTINCT h.word_id, h.previous_status, h.changed_at
         FROM word_progress_history h
         INNER JOIN user_progress p ON h.user_uid = p.user_uid AND h.tier = p.tier AND h.word_id = p.word_id
         WHERE h.user_uid = $1 AND h.tier = $2
           AND h.new_status = 'known' AND h.previous_status IN ('unknown', 'unsure') AND p.status = 'known'
         ORDER BY h.changed_at DESC`,
        [uid, tier]
      );
      return res.json({ words: result.rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // POST /api/progress/:uid/:tier/batch
  if (req.method === 'POST' && action === 'batch') {
    const { words } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [wordId, status] of Object.entries(words)) {
        const prevResult = await client.query(
          'SELECT status FROM user_progress WHERE user_uid = $1 AND tier = $2 AND word_id = $3',
          [uid, tier, wordId]
        );
        const previousStatus = prevResult.rows.length > 0 ? prevResult.rows[0].status : null;
        await client.query(
          `INSERT INTO user_progress (user_uid, tier, word_id, status) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_uid, tier, word_id) DO UPDATE SET status = $4, last_updated = CURRENT_TIMESTAMP`,
          [uid, tier, wordId, status]
        );
        if (previousStatus !== status) {
          await client.query(
            `INSERT INTO word_progress_history (user_uid, tier, word_id, previous_status, new_status) VALUES ($1, $2, $3, $4, $5)`,
            [uid, tier, wordId, previousStatus, status]
          );
        }
      }
      await client.query('COMMIT');
      return res.json({ success: true, count: Object.keys(words).length });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  }

  // GET /api/progress/:uid/:tier
  if (req.method === 'GET' && !action) {
    try {
      const result = await pool.query(
        'SELECT word_id, status, last_updated FROM user_progress WHERE user_uid = $1 AND tier = $2',
        [uid, tier]
      );
      const words = {};
      result.rows.forEach(row => { words[row.word_id] = row.status; });
      return res.json({ words, lastUpdated: result.rows.length > 0 ? result.rows[0].last_updated : null });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // POST /api/progress/:uid/:tier
  if (req.method === 'POST' && !action) {
    const { wordId, status } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prevResult = await client.query(
        'SELECT status FROM user_progress WHERE user_uid = $1 AND tier = $2 AND word_id = $3',
        [uid, tier, wordId]
      );
      const previousStatus = prevResult.rows.length > 0 ? prevResult.rows[0].status : null;
      const result = await client.query(
        `INSERT INTO user_progress (user_uid, tier, word_id, status) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_uid, tier, word_id) DO UPDATE SET status = $4, last_updated = CURRENT_TIMESTAMP RETURNING *`,
        [uid, tier, wordId, status]
      );
      if (previousStatus !== status) {
        await client.query(
          `INSERT INTO word_progress_history (user_uid, tier, word_id, previous_status, new_status) VALUES ($1, $2, $3, $4, $5)`,
          [uid, tier, wordId, previousStatus, status]
        );
      }
      await client.query('COMMIT');
      return res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
