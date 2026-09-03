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

/**
 * Re-exported from the domain rather than declared again.
 *
 * This was a second copy of the same union, and when 'manager' was added to the domain the two
 * disagreed — the compiler caught it here, but a duplicated type is a promise to drift. One
 * definition, both apps and the API.
 */
export type { StaffRole } from '@clear/domain';
type StaffRoleLocal = import('@clear/domain').StaffRole;

export interface StaffRow {
  id: string;
  merchant: string;
  name: string;
  role: StaffRoleLocal;
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
  role: StaffRoleLocal;
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
    role: StaffRoleLocal;
    /** A 4-digit PIN for counter staff; a real password for an owner. */
    secret: string;
    email?: string;
  }): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();

    // Everyone on the shift screen has a four-digit PIN, owners included — it starts a shift and
    // attributes charges, and that is all it does. An owner's AUTHORITY comes from signing in with
    // Privy, never from anything stored here: Clear holds no owner credential.
    if (!/^\d{4}$/.test(input.secret)) {
      throw new Error('A PIN is exactly four digits.');
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
  async signInWithPin(merchant: string, pin: string, staffId?: string): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool || !/^\d{4}$/.test(pin)) return null;
    await ensureMerchantSchema();

    const gate = attemptLimiter(merchant);
    if (!gate.allowed) return null;

    // A name is picked first, so the PIN is checked against that person. A bare PIN field asks a
    // writer to remember which of four codes is theirs, which is the most common reason somebody
    // borrows a colleague's — and a borrowed code makes the name on every charge row a lie.
    const { rows } = staffId
      ? await pool.query<DbStaff>(
          `SELECT * FROM ${MERCHANT_SCHEMA}.staff WHERE merchant = $1 AND active = true AND id = $2`,
          [normalizeMerchant(merchant), staffId],
        )
      : await pool.query<DbStaff>(
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

  /**
   * The shift roster — names and roles, nothing else.
   *
   * What the "Who's on the counter?" screen shows before anyone has signed in. Deliberately
   * carries no secrets and no charge counts: it is a list of first names at a shop somebody
   * already knows the address of, which is close to public, and it is the price of not asking a
   * writer to remember which of four codes is theirs.
   */
  async roster(merchant: string): Promise<{ id: string; name: string; role: StaffRoleLocal }[]> {
    const rows = await this.list(merchant);
    // The owner appears here too. Mike works the counter, and making him sign in differently to
    // raise a charge is a reason to hand the tablet to Jen instead.
    return rows.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, role: r.role }));
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

  /** The staff row a Privy account owns at this shop, if any. */
  async findByPrivyUser(merchant: string, privyUserId: string): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();
    const { rows } = await pool.query<DbStaff>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.staff
        WHERE merchant = $1 AND privy_user_id = $2 AND active = true`,
      [normalizeMerchant(merchant), privyUserId],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },

  /**
   * Every shop this Privy user owns.
   *
   * A tablet that has not been enrolled yet does not know which shop it belongs to — that is the
   * whole point of enrollment, and the reason the merchant address used to have to be baked into
   * the build. So owner sign-in cannot require the merchant up front: the owner proves who they
   * are with Privy, and this says what that entitles them to. Almost always one row.
   */
  async shopsForPrivyUser(privyUserId: string): Promise<StaffRow[]> {
    const pool = getMerchantPool();
    if (!pool || !privyUserId) return [];
    await ensureMerchantSchema();
    const { rows } = await pool.query<DbStaff>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.staff
        WHERE privy_user_id = $1 AND role = 'owner' AND active = true
        ORDER BY created_at ASC`,
      [privyUserId],
    );
    return rows.map(toRow);
  },

  /**
   * Bind a staff row to the Privy user who owns it.
   *
   * Separate from `add` because it only ever applies to owners, and because the two facts are
   * established by different acts: the row is Clear's record of a person on the roster, the Privy
   * id is who authenticated. Owner sign-in matches on this column, so a shop whose owner is not
   * linked is a shop nobody can administer.
   */
  async linkPrivyUser(staffId: string, privyUserId: string): Promise<void> {
    const pool = getMerchantPool();
    if (!pool) return;
    await ensureMerchantSchema();
    await pool.query(`UPDATE ${MERCHANT_SCHEMA}.staff SET privy_user_id = $2 WHERE id = $1`, [
      staffId,
      privyUserId,
    ]);
  },

  /**
   * Reset somebody's PIN — reference section 08, "an owner can reset it in Staff".
   *
   * The same four-digit rule as `add`, and the same hashing, because a PIN set here and a PIN set
   * at onboarding have to be interchangeable. Nothing reads the old one first: an owner resetting a
   * writer's PIN does not know it, which is usually why they are resetting it.
   */
  async setPin(staffId: string, pin: string): Promise<boolean> {
    const pool = getMerchantPool();
    if (!pool) return false;
    await ensureMerchantSchema();

    if (!/^\d{4}$/.test(pin)) throw new Error('A PIN is exactly four digits.');

    const { rowCount } = await pool.query(
      `UPDATE ${MERCHANT_SCHEMA}.staff SET secret = $2 WHERE id = $1`,
      [staffId, await hashSecret(pin)],
    );
    return (rowCount ?? 0) > 0;
  },

  async setActive(id: string, active: boolean): Promise<void> {
    const pool = getMerchantPool();
    if (!pool) return;
    await ensureMerchantSchema();
    await pool.query(`UPDATE ${MERCHANT_SCHEMA}.staff SET active = $2 WHERE id = $1`, [id, active]);
  },
};
