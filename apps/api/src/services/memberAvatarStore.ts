import { getPostgresPool } from '../config/postgres.js';

/*
 * Member avatar blobs in Postgres (no external storage needed). The image is stored here and
 * served via a short public URL (/api/avatars/:memberId) so the member's avatar_url stays under
 * the 2048-char cap while the photo persists across refresh, devices, and browsers.
 */
const TABLE = 'member_avatars';
let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      member_id INTEGER PRIMARY KEY,
      image_data BYTEA NOT NULL,
      content_type TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  ensured = true;
}

export const memberAvatarStore = {
  isConfigured(): boolean {
    return Boolean(getPostgresPool());
  },

  async put(memberId: number, data: Buffer, contentType: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTable();
    await pool.query(
      `INSERT INTO ${TABLE} (member_id, image_data, content_type) VALUES ($1, $2, $3)
       ON CONFLICT (member_id) DO UPDATE SET image_data = EXCLUDED.image_data, content_type = EXCLUDED.content_type, updated_at = now()`,
      [memberId, data, contentType],
    );
  },

  async get(memberId: number): Promise<{ data: Buffer; contentType: string } | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTable();
    const r = await pool.query(`SELECT image_data, content_type FROM ${TABLE} WHERE member_id = $1`, [memberId]);
    if (!r.rows[0]) return null;
    return { data: r.rows[0].image_data as Buffer, contentType: r.rows[0].content_type as string };
  },

  async remove(memberId: number): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTable();
    await pool.query(`DELETE FROM ${TABLE} WHERE member_id = $1`, [memberId]);
  },
};
