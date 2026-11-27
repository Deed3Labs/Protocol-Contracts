import { createHash, randomBytes } from 'node:crypto';
import { MERCHANT_SCHEMA, ensureMerchantSchema, getMerchantPool } from '../../config/merchantDb.js';
import { type StaffRow, staffStore } from './staffStore.js';

/**
 * Merchant sessions.
 *
 * **Bearer tokens, not cookies.** The member app and the merchant app have different auth models
 * and must never see each other's session. A cookie is the easiest way to get that wrong — one
 * `Domain=.useclear.org` and both surfaces share a session — so this surface does not use cookies
 * at all. The token travels in `Authorization`, which cannot be scoped to a parent domain by
 * accident and is never sent cross-origin by the browser on its own.
 *
 * Only the SHA-256 of a token is stored. A leaked sessions table is then a list of hashes rather
 * than a set of working sessions. SHA-256 rather than scrypt is right here and wrong for a PIN:
 * the token is 256 bits of randomness, so there is nothing to brute-force and no reason to pay a
 * KDF's cost on every authenticated request.
 */

/** A shift, roughly. Long enough not to interrupt a counter; short enough that a lost tablet ages out. */
const SESSION_TTL_HOURS = 12;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface MerchantSession {
  staff: StaffRow;
  merchant: string;
  expiresAt: string;
}

export const sessionStore = {
  async create(staff: StaffRow): Promise<{ token: string; expiresAt: string } | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);

    await pool.query(
      `INSERT INTO ${MERCHANT_SCHEMA}.sessions (token_hash, staff_id, merchant, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [hashToken(token), staff.id, staff.merchant, expiresAt.toISOString()],
    );

    // Opportunistic cleanup. A sweep job for a table this small would be more machinery than the
    // problem deserves, and an expired row is refused on read regardless.
    await pool
      .query(`DELETE FROM ${MERCHANT_SCHEMA}.sessions WHERE expires_at < now()`)
      .catch(() => undefined);

    return { token, expiresAt: expiresAt.toISOString() };
  },

  async resolve(token: string): Promise<MerchantSession | null> {
    const pool = getMerchantPool();
    if (!pool || !token) return null;
    await ensureMerchantSchema();

    const { rows } = await pool.query<{ staff_id: string; merchant: string; expires_at: string }>(
      `SELECT staff_id, merchant, expires_at FROM ${MERCHANT_SCHEMA}.sessions
        WHERE token_hash = $1 AND expires_at > now()`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row) return null;

    // Read the staff row rather than trusting the session's copy: a staff member deactivated
    // mid-shift should stop working on their next request, not at the end of the shift.
    const staff = await staffStore.get(row.staff_id);
    if (!staff || !staff.active) return null;

    return { staff, merchant: row.merchant, expiresAt: new Date(row.expires_at).toISOString() };
  },

  async destroy(token: string): Promise<void> {
    const pool = getMerchantPool();
    if (!pool || !token) return;
    await ensureMerchantSchema();
    await pool.query(`DELETE FROM ${MERCHANT_SCHEMA}.sessions WHERE token_hash = $1`, [
      hashToken(token),
    ]);
  },
};
