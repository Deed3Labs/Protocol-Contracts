import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { MERCHANT_SCHEMA, ensureMerchantSchema, getMerchantPool } from '../../config/merchantDb.js';

const scrypt = promisify(scryptCb) as (
  secret: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Staff, and the secrets they sign in with.
 *
 * Two roles, not a permission matrix: `counter` and `owner`. A shop with four staff does not want
 * checkboxes, and if a third is ever needed it will be "manager" and can wait until somebody asks.
 *
 * **A four-digit PIN is a weak secret and is treated like one.** There are only ten thousand of
 * them, so the defence cannot be the secret's strength — it has to be the cost of each guess and a
 * cap on how many guesses are possible. scrypt supplies the first; `attemptLimiter` below supplies
 * the second. A PIN is also scoped to one merchant, so an attacker must know which shop they are
 * attacking before a guess means anything.
 */

/** OWASP's floor for scrypt, and about 100ms on the API's hardware — deliberate, not incidental. */
const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

export type StaffRole = 'counter' | 'owner';

export interface StaffRow {
  id: string;
  merchant: string;
  name: string;
  role: StaffRole;
  email: string | null;
  active: boolean;
  createdAt: string;
}

const normalizeMerchant = (m: string) => m.trim().toLowerCase();

/** `scrypt$N$r$p$salt$hash`, so the parameters travel with the hash and can be raised later. */
async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(secret, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(secret, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  // Constant-time: a length check first, because timingSafeEqual throws on a mismatch.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * How many failed attempts a shop gets before its sign-in closes for a while.
 *
 * Keyed by merchant rather than by staff member, because the attacker guessing PINs does not know
 * whose PIN they are guessing — they are guessing at the shop. In-process and therefore per-
 * instance; it is a speed bump for the obvious attack, not a distributed rate limiter, and it
 * should become one if the API ever runs more than one instance.
 */
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 5 * 60 * 1000;

export function attemptLimiter(merchant: string): { allowed: boolean; retryInSeconds?: number } {
  const key = normalizeMerchant(merchant);
  const entry = attempts.get(key);
  if (!entry) return { allowed: true };
  if (Date.now() > entry.until) {
    attempts.delete(key);
    return { allowed: true };
  }
  if (entry.count < MAX_ATTEMPTS) return { allowed: true };
  return { allowed: false, retryInSeconds: Math.ceil((entry.until - Date.now()) / 1000) };
}

function recordFailure(merchant: string): void {
  const key = normalizeMerchant(merchant);
  const entry = attempts.get(key);
  const next = entry && Date.now() <= entry.until ? entry.count + 1 : 1;
  attempts.set(key, { count: next, until: Date.now() + LOCKOUT_MS });
}

function clearFailures(merchant: string): void {
  attempts.delete(normalizeMerchant(merchant));
}

interface DbStaff {
  id: string;
  merchant: string;
  name: string;
  role: StaffRole;
  secret: string;
  email: string | null;
  active: boolean;
  created_at: string;
}

const toRow = (r: DbStaff): StaffRow => ({
  id: r.id,
  merchant: r.merchant,
  name: r.name,
  role: r.role,
  email: r.email,
  active: r.active,
  createdAt: new Date(r.created_at).toISOString(),
});

export const staffStore = {
  isConfigured(): boolean {
    return getMerchantPool() !== null;
  },

  async list(merchant: string): Promise<StaffRow[]> {
    const pool = getMerchantPool();
    if (!pool) return [];
    await ensureMerchantSchema();
    const { rows } = await pool.query<DbStaff>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.staff WHERE merchant = $1 ORDER BY role DESC, created_at ASC`,
      [normalizeMerchant(merchant)],
    );
    return rows.map(toRow);
  },

  async get(id: string): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();
    const { rows } = await pool.query<DbStaff>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.staff WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },

  async add(input: {
    merchant: string;
    name: string;
    role: StaffRole;
    /** A 4-digit PIN for counter staff; a real password for an owner. */
    secret: string;
    email?: string;
  }): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();

    // An owner reaches money, so their secret has to be a password rather than four digits.
    if (input.role === 'owner' && input.secret.length < 8) {
      throw new Error('An owner needs a password of at least 8 characters.');
    }
    if (input.role === 'counter' && !/^\d{4}$/.test(input.secret)) {
      throw new Error('A counter PIN is exactly four digits.');
    }

    const id = `stf_${randomUUID()}`;
    const { rows } = await pool.query<DbStaff>(
      `INSERT INTO ${MERCHANT_SCHEMA}.staff (id, merchant, name, role, secret, email)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        id,
        normalizeMerchant(input.merchant),
        input.name.trim(),
        input.role,
        await hashSecret(input.secret),
        input.email?.trim().toLowerCase() ?? null,
      ],
    );
    return toRow(rows[0]);
  },

  /**
   * Find the staff member a PIN belongs to, within one shop.
   *
   * Every active counter PIN at the shop is checked, which is what makes "type your PIN" work with
   * no username. **Every candidate is verified even after one matches**, so the time taken does not
   * reveal how many staff a shop has or where in the list a PIN sits.
   */
  async signInWithPin(merchant: string, pin: string): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool || !/^\d{4}$/.test(pin)) return null;
    await ensureMerchantSchema();

    const gate = attemptLimiter(merchant);
    if (!gate.allowed) return null;

    const { rows } = await pool.query<DbStaff>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.staff WHERE merchant = $1 AND active = true`,
      [normalizeMerchant(merchant)],
    );

    let found: DbStaff | null = null;
    for (const row of rows) {
      const ok = await verifySecret(pin, row.secret);
      if (ok && !found) found = row;
    }

    if (!found) {
      recordFailure(merchant);
      return null;
    }
    clearFailures(merchant);
    return toRow(found);
  },

  /** An owner signs in with email and password, because they reach money. */
  async signInWithPassword(
    merchant: string,
    email: string,
    password: string,
  ): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();

    const gate = attemptLimiter(merchant);
    if (!gate.allowed) return null;

    const { rows } = await pool.query<DbStaff>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.staff
        WHERE merchant = $1 AND active = true AND lower(email) = lower($2)`,
      [normalizeMerchant(merchant), email.trim()],
    );

    const row = rows[0];
    // Verify against a decoy when there is no such email, so a missing account and a wrong
    // password take the same time and cannot be told apart.
    const stored = row?.secret ?? (await hashSecret('no-such-account'));
    const ok = await verifySecret(password, stored);

    if (!row || !ok) {
      recordFailure(merchant);
      return null;
    }
    clearFailures(merchant);
    return toRow(row);
  },

  /**
   * Check an owner's code without starting a session for them.
   *
   * Step three of a refund: an owner walks to the counter and authorises one act. The writer stays
   * signed in, because the owner is approving something rather than starting a shift.
   */
  async verifyOwnerSecret(merchant: string, secret: string): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();

    const gate = attemptLimiter(merchant);
    if (!gate.allowed) return null;

    const { rows } = await pool.query<DbStaff>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.staff
        WHERE merchant = $1 AND active = true AND role = 'owner'`,
      [normalizeMerchant(merchant)],
    );

    let found: DbStaff | null = null;
    for (const row of rows) {
      const ok = await verifySecret(secret, row.secret);
      if (ok && !found) found = row;
    }
    if (!found) {
      recordFailure(merchant);
      return null;
    }
    clearFailures(merchant);
    return toRow(found);
  },

  async setActive(id: string, active: boolean): Promise<void> {
    const pool = getMerchantPool();
    if (!pool) return;
    await ensureMerchantSchema();
    await pool.query(`UPDATE ${MERCHANT_SCHEMA}.staff SET active = $2 WHERE id = $1`, [id, active]);
  },
};
