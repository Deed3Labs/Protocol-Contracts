import { getPayPool } from '../../config/postgres.js';

/*
 * The Face ID credentials the server itself can check.
 *
 * Privy's passkeys sign members in, but Privy never gives the server their public keys, so an
 * assertion from one proves nothing here. These are Clear's own: registered with this API, public key
 * kept, so a Face ID check can be verified server-side rather than taken on the app's word.
 *
 * Keyed by the Privy user id, not a wallet: one person, however many wallets they link.
 */

const TABLE = 'member_step_up_credentials';

export interface StepUpCredential {
  credentialId: string;
  userId: string;
  rpId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      credential_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      public_key BYTEA NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      transports TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_user_idx ON ${TABLE} (user_id);
  `);
  ensured = true;
}

interface Row {
  credential_id: string;
  user_id: string;
  rp_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
}

const toCredential = (r: Row): StepUpCredential => ({
  credentialId: r.credential_id,
  userId: r.user_id,
  rpId: r.rp_id,
  publicKey: Uint8Array.from(r.public_key),
  counter: Number(r.counter),
  transports: r.transports ?? [],
});

/*
 * Whether a member has any, read on every guarded request -- so remembered for a minute, and
 * forgotten the moment one is added or removed through this process.
 */
const enrolledCache = new Map<string, { enrolled: boolean; until: number }>();
const ENROLLED_CACHE_MS = 60_000;

export const stepUpStore = {
  available(): boolean {
    return Boolean(getPayPool());
  },

  async listFor(userId: string): Promise<StepUpCredential[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<Row>(`SELECT * FROM ${TABLE} WHERE user_id = $1 ORDER BY created_at`, [userId]);
    return rows.map(toCredential);
  },

  async enrolled(userId: string): Promise<boolean> {
    const hit = enrolledCache.get(userId);
    if (hit && hit.until > Date.now()) return hit.enrolled;
    const enrolled = (await this.listFor(userId)).length > 0;
    enrolledCache.set(userId, { enrolled, until: Date.now() + ENROLLED_CACHE_MS });
    return enrolled;
  },

  async add(c: StepUpCredential): Promise<void> {
    const pool = getPayPool();
    if (!pool) throw new Error('No database for step-up credentials.');
    await ensureTable();
    await pool.query(
      `INSERT INTO ${TABLE} (credential_id, user_id, rp_id, public_key, counter, transports)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (credential_id) DO NOTHING`,
      [c.credentialId, c.userId, c.rpId, Buffer.from(c.publicKey), c.counter, c.transports],
    );
    enrolledCache.delete(c.userId);
  },

  async markUsed(credentialId: string, counter: number): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await pool.query(`UPDATE ${TABLE} SET counter = $2, last_used_at = NOW() WHERE credential_id = $1`, [credentialId, counter]);
  },

  async removeAll(userId: string): Promise<number> {
    const pool = getPayPool();
    if (!pool) return 0;
    await ensureTable();
    const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE user_id = $1`, [userId]);
    enrolledCache.delete(userId);
    return rowCount ?? 0;
  },
};
