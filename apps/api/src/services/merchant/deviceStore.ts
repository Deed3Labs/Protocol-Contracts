import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MERCHANT_SCHEMA, ensureMerchantSchema, getMerchantPool } from '../../config/merchantDb.js';

/**
 * Enrolled devices — reference section 19.
 *
 * **The device is the security boundary; the PIN is not.** Four digits on a counter tablet will be
 * watched and shared, so a guessed PIN is not the risk worth designing against — a lost tablet is.
 * What makes that survivable is the sentence on the enrollment screen: remove it any time, from any
 * device. That promise is only true if revocation is a server-side row update that takes effect on
 * the very next request, which is what `revoke` and `resolve` below are.
 *
 * **A device holds no signing material.** Section 20 settles this: Clear's backend holds one P-256
 * authorization key per merchant organization and does the signing; the tablet only asks. So the
 * token here is a session against Clear and nothing more. A stolen tablet carries no key, there is
 * one key per merchant to rotate rather than one per tablet, and the wallet policy cap applies to
 * every device at once. It is also why the enrollment screen's claim — enforced by policy, not by
 * this app — is honest.
 *
 * Only the SHA-256 of the token is stored, for the same reason as `sessionStore`: a leaked table
 * should be a list of hashes, not a set of working devices. SHA-256 rather than scrypt because the
 * token is 256 bits of randomness — there is nothing to brute-force and no reason to pay a KDF's
 * cost on every request a counter makes.
 *
 * No expiry. A shift session ages out in twelve hours because a writer goes home; a tablet stays
 * enrolled until an owner removes it, and an enrollment that silently lapsed mid-morning would be
 * indistinguishable at the counter from a broken app.
 */

/** The reference's default, and the only one it offers to change. */
export const DEFAULT_IDLE_LOCK_SECONDS = 300;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const normalizeMerchant = (m: string) => m.trim().toLowerCase();

export interface DeviceRow {
  id: string;
  merchant: string;
  label: string;
  idleLockSeconds: number;
  enrolledBy: string;
  enrolledAt: string;
  revokedAt: string | null;
}

interface DeviceDbRow {
  id: string;
  merchant: string;
  label: string;
  idle_lock_seconds: number;
  enrolled_by: string;
  enrolled_at: string;
  revoked_at: string | null;
}

const toDevice = (r: DeviceDbRow): DeviceRow => ({
  id: r.id,
  merchant: r.merchant,
  label: r.label,
  idleLockSeconds: r.idle_lock_seconds,
  enrolledBy: r.enrolled_by,
  enrolledAt: new Date(r.enrolled_at).toISOString(),
  revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
});

export const deviceStore = {
  /**
   * Enroll this tablet. Done once, by the owner, on the tablet itself.
   *
   * The token is returned exactly once and never again — it goes straight into the tablet's
   * storage. There is no "show me the token" route, because a token an owner can re-read from a
   * list is a token that can be copied onto a second device without anybody enrolling it.
   */
  async enroll(input: {
    merchant: string;
    label: string;
    enrolledBy: string;
    idleLockSeconds?: number;
  }): Promise<{ device: DeviceRow; token: string } | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();

    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const label = input.label.trim() || 'Counter tablet';

    const { rows } = await pool.query<DeviceDbRow>(
      `INSERT INTO ${MERCHANT_SCHEMA}.devices
         (id, merchant, label, token_hash, idle_lock_seconds, enrolled_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, merchant, label, idle_lock_seconds, enrolled_by, enrolled_at, revoked_at`,
      [
        id,
        normalizeMerchant(input.merchant),
        label,
        hashToken(token),
        input.idleLockSeconds ?? DEFAULT_IDLE_LOCK_SECONDS,
        input.enrolledBy,
      ],
    );

    const row = rows[0];
    if (!row) return null;
    return { device: toDevice(row), token };
  },

  /**
   * Which shop this tablet belongs to.
   *
   * A revoked device resolves to nothing, which is what makes removal instant. The merchant comes
   * from this row rather than from the request body: before enrollment the app had to be told its
   * own merchant address by an environment variable, which only ever worked for a single-shop
   * build. The tablet now learns which shop it is from the token it was enrolled with.
   */
  async resolve(token: string): Promise<DeviceRow | null> {
    const pool = getMerchantPool();
    if (!pool || !token) return null;
    await ensureMerchantSchema();

    const { rows } = await pool.query<DeviceDbRow>(
      `SELECT id, merchant, label, idle_lock_seconds, enrolled_by, enrolled_at, revoked_at
         FROM ${MERCHANT_SCHEMA}.devices
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(token)],
    );
    const row = rows[0];
    return row ? toDevice(row) : null;
  },

  /** Every tablet this shop has, revoked ones included — an owner needs to see what they removed. */
  async list(merchant: string): Promise<DeviceRow[]> {
    const pool = getMerchantPool();
    if (!pool) return [];
    await ensureMerchantSchema();

    const { rows } = await pool.query<DeviceDbRow>(
      `SELECT id, merchant, label, idle_lock_seconds, enrolled_by, enrolled_at, revoked_at
         FROM ${MERCHANT_SCHEMA}.devices
        WHERE merchant = $1
        ORDER BY revoked_at IS NOT NULL, enrolled_at DESC`,
      [normalizeMerchant(merchant)],
    );
    return rows.map(toDevice);
  },

  /**
   * Remove a tablet. Scoped by merchant so an id from one shop cannot revoke another's.
   *
   * The row is kept rather than deleted: charges reference the device that raised them, and an
   * owner asking "what was that tablet we lost in March" deserves an answer.
   */
  async revoke(id: string, merchant: string): Promise<boolean> {
    const pool = getMerchantPool();
    if (!pool) return false;
    await ensureMerchantSchema();

    const { rowCount } = await pool.query(
      `UPDATE ${MERCHANT_SCHEMA}.devices
          SET revoked_at = now()
        WHERE id = $1 AND merchant = $2 AND revoked_at IS NULL`,
      [id, normalizeMerchant(merchant)],
    );
    return (rowCount ?? 0) > 0;
  },

  /** Renaming is the one thing about an enrolled device an owner can change after the fact. */
  async rename(id: string, merchant: string, label: string): Promise<boolean> {
    const pool = getMerchantPool();
    if (!pool) return false;
    await ensureMerchantSchema();

    const trimmed = label.trim();
    if (!trimmed) return false;

    const { rowCount } = await pool.query(
      `UPDATE ${MERCHANT_SCHEMA}.devices SET label = $3
        WHERE id = $1 AND merchant = $2 AND revoked_at IS NULL`,
      [id, normalizeMerchant(merchant), trimmed],
    );
    return (rowCount ?? 0) > 0;
  },
};
