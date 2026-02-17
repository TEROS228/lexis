import { getPool } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pool = getPool();
  const { uid, email, displayName, photoURL } = req.body;

  try {
    const checkUser = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);

    if (checkUser.rows.length > 0) {
      const updateResult = await pool.query(
        `UPDATE users SET last_login = CURRENT_TIMESTAMP,
          display_name = COALESCE($2, display_name),
          photo_url = COALESCE($3, photo_url)
         WHERE uid = $1 RETURNING *`,
        [uid, displayName || null, photoURL || null]
      );
      return res.json({ isNewUser: false, user: updateResult.rows[0] });
    }

    const result = await pool.query(
      `INSERT INTO users (uid, email, display_name, photo_url) VALUES ($1, $2, $3, $4) RETURNING *`,
      [uid, email, displayName, photoURL]
    );
    res.json({ isNewUser: true, user: result.rows[0] });
  } catch (error) {
    console.error('DB Error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}
