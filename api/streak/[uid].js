import pool from '../_db.js';

export default async function handler(req, res) {
  const { uid } = req.query;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Get current streak
      const result = await pool.query(
        `SELECT current_streak, longest_streak, last_activity_date,
                CASE
                  WHEN last_activity_date::date = CURRENT_DATE THEN true
                  ELSE false
                END as streak_earned_today
         FROM users
         WHERE uid = $1`,
        [uid]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json(result.rows[0]);

    } else if (req.method === 'POST') {
      // Update streak after session completion
      const result = await pool.query(
        `WITH old_data AS (
          SELECT last_activity_date FROM users WHERE uid = $1
        ),
        updated AS (
          UPDATE users
          SET
            current_streak = CASE
              -- If last activity was yesterday, increment streak
              WHEN last_activity_date::date = CURRENT_DATE - INTERVAL '1 day' THEN current_streak + 1
              -- If last activity was today, keep current streak
              WHEN last_activity_date::date = CURRENT_DATE THEN current_streak
              -- If last activity was before yesterday or NULL, reset to 1
              ELSE 1
            END,
            longest_streak = CASE
              -- Update longest if new streak is higher
              WHEN last_activity_date::date = CURRENT_DATE - INTERVAL '1 day'
                AND current_streak + 1 > longest_streak THEN current_streak + 1
              WHEN last_activity_date::date = CURRENT_DATE
                AND current_streak > longest_streak THEN current_streak
              WHEN (last_activity_date IS NULL OR last_activity_date::date < CURRENT_DATE - INTERVAL '1 day')
                AND 1 > longest_streak THEN 1
              ELSE longest_streak
            END,
            last_activity_date = CASE
              -- Only update if it's a new day or NULL
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
        [uid]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json(result.rows[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Streak API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
