import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { MERCHANT_SCHEMA, ensureMerchantSchema, getMerchantPool } from '../../config/merchantDb.js';
import { poolDb } from '../../db/db.js';
import { PinLocked, pinGate, recordPinFailure } from './security/pinGuard.js';

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
 * cap on how many guesses are possible. scrypt supplies the first; security/pinGuard.ts supplies
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
  /** False until the person picks their four digits on their first shift. */
  pinSet: boolean;
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
 * The shop's PIN gate: throws PinLocked while it's shut. Every PIN checked here counts against the
 * same shop-wide limit (security/pinGuard.ts), whatever it's for.
 */
async function gate(merchant: string): Promise<void> {
  const pool = getMerchantPool();
  if (!pool) return;
  const g = await pinGate(poolDb(pool), normalizeMerchant(merchant));
  if (!g.allowed) throw new PinLocked(g.retryInSeconds);
}

async function recordFailure(merchant: string, source: 'session' | 'approval', staffId?: string): Promise<void> {
  const pool = getMerchantPool();
  if (pool) await recordPinFailure(poolDb(pool), { merchant: normalizeMerchant(merchant), source, staffId });
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
  pinSet: r.secret !== '',
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
    /**
     * An empty secret means "not set yet" — reference section 08.
     *
     * The owner does not choose somebody else's PIN: the person sets four digits the first time
     * they start a shift. A PIN chosen for you is one you write down, and a written-down PIN makes
     * the staff name on a charge row a guess.
     *
     * `signInWithPin` already refuses anything that does not verify, and an empty stored secret
     * verifies against nothing, so a pending row cannot start a shift until it is set.
     */
    if (input.secret !== '' && !/^\d{4}$/.test(input.secret)) {
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
        input.secret === '' ? '' : await hashSecret(input.secret),
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
  async signInWithPin(merchant: string, pin: string, staffId?: string, source: 'session' | 'approval' = 'approval'): Promise<StaffRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();
    // Throws PinLocked while the shop is shut; the routes answer 429 with when to try again.
    await gate(merchant);
    if (!/^\d{4}$/.test(pin)) {
      await recordFailure(merchant, source, staffId);
      return null;
    }

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
      await recordFailure(merchant, source, staffId);
      return null;
    }
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
  async roster(merchant: string): Promise<{ id: string; name: string; role: StaffRoleLocal; pinSet: boolean }[]> {
    const rows = await this.list(merchant);
    // The owner appears here too. Mike works the counter, and making him sign in differently to
    // raise a charge is a reason to hand the tablet to Jen instead.
    // Whether each person has had a first shift: the screen offers "Pick a PIN" to someone who hasn't.
    return rows.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, role: r.role, pinSet: r.pinSet }));
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

    await gate(merchant);

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
      await recordFailure(merchant, 'approval');
      return null;
    }
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

  /**
   * A first shift: the person picks their own four digits — reference section 08.
   *
   * Only while their PIN isn't set (a new person, or one an owner or manager reset), and the write
   * is conditional on that, so two tablets racing can't both set it.
   *
   * **A PIN is unique within the shop.** An approval (a discount over the limit, a void, a refund)
   * is a PIN with no name, matched against everyone, so a counter PIN that equalled a manager's
   * would approve as the manager. A taken PIN is refused, and the refusal counts against the
   * shop's PIN limit like a wrong guess: saying "taken" says someone has it, which is worth as much
   * to a guesser as a wrong PIN is.
   */
  async setFirstPin(merchant: string, staffId: string, pin: string): Promise<'set' | 'taken' | 'not_pending'> {
    const pool = getMerchantPool();
    if (!pool) return 'not_pending';
    await ensureMerchantSchema();
    await gate(merchant);
    if (!/^\d{4}$/.test(pin)) throw new Error('A PIN is exactly four digits.');

    const { rows } = await pool.query<DbStaff>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.staff WHERE merchant = $1 AND active = true`,
      [normalizeMerchant(merchant)],
    );
    const me = rows.find((r) => r.id === staffId);
    if (!me || me.secret !== '') return 'not_pending';
    // Every PIN is checked, as at sign-in, so the time taken says nothing about who has which.
    let taken = false;
    for (const row of rows) {
      if (row.id !== staffId && row.secret !== '' && (await verifySecret(pin, row.secret))) taken = true;
    }
    if (taken) {
      await recordFailure(merchant, 'session', staffId);
      return 'taken';
    }
    const { rowCount } = await pool.query(
      `UPDATE ${MERCHANT_SCHEMA}.staff SET secret = $3 WHERE id = $1 AND merchant = $2 AND secret = ''`,
      [staffId, normalizeMerchant(merchant), await hashSecret(pin)],
    );
    return (rowCount ?? 0) > 0 ? 'set' : 'not_pending';
  },

  /**
   * Clear somebody's PIN, so they pick a new one on their next shift. An owner or a manager does
   * this in Staff; they never choose it for them, for the reason `add` gives.
   */
  async clearPin(staffId: string): Promise<boolean> {
    const pool = getMerchantPool();
    if (!pool) return false;
    await ensureMerchantSchema();
    const { rowCount } = await pool.query(`UPDATE ${MERCHANT_SCHEMA}.staff SET secret = '' WHERE id = $1`, [staffId]);
    return (rowCount ?? 0) > 0;
  },

  async setActive(id: string, active: boolean): Promise<void> {
    const pool = getMerchantPool();
    if (!pool) return;
    await ensureMerchantSchema();
    await pool.query(`UPDATE ${MERCHANT_SCHEMA}.staff SET active = $2 WHERE id = $1`, [id, active]);
  },
};
