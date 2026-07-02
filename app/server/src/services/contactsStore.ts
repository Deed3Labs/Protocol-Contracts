import crypto from 'crypto';
import { getPostgresPool } from '../config/postgres.js';

/*
 * User contacts + the member directory lookup. Contacts are per-owner (wallet-scoped). The directory
 * lets a user who types a known email/phone auto-fill the recipient's wallet: we match the SHA-256
 * of the email/phone against members' email_hash/phone_hash (already maintained on profile save) and
 * return their primary_wallet — unless that member opted out (on-by-default discovery). Exact-match
 * only; hashes are one-way so no PII is exposed. See memberStore for how the hashes are written.
 */
const TABLE = 'contacts';
const OPTOUT = 'member_directory_optout';
let ensured = false;

// Identical to memberStore.sha256Hex (plain sha256 hex, no normalization) so hashes line up.
function sha256Hex(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

// Candidate hashes covering common formatting differences (so a contact typed slightly differently
// still matches the stored hash).
function emailHashes(email: string): string[] {
  const e = email.trim();
  return [...new Set([e, e.toLowerCase()])].filter(Boolean).map(sha256Hex);
}
function phoneHashes(phone: string): string[] {
  const p = phone.trim();
  const digits = p.replace(/[^0-9]/g, '');
  return [...new Set([p, digits, digits ? `+${digits}` : ''])].filter(Boolean).map(sha256Hex);
}

async function ensureTables(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      owner_wallet TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      wallet_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS contacts_owner_idx ON ${TABLE} (owner_wallet);
    CREATE TABLE IF NOT EXISTS ${OPTOUT} (
      wallet TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  ensured = true;
}

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  wallet: string | null;
}

function rowToContact(r: Record<string, unknown>): Contact {
  return {
    id: String(r.id),
    name: String(r.name),
    email: r.email ? String(r.email) : null,
    phone: r.phone ? String(r.phone) : null,
    wallet: r.wallet_address ? String(r.wallet_address) : null,
  };
}

export const contactsStore = {
  isConfigured(): boolean {
    return Boolean(getPostgresPool());
  },

  async list(owner: string): Promise<Contact[]> {
    const pool = getPostgresPool();
    if (!pool) return [];
    await ensureTables();
    const r = await pool.query(`SELECT * FROM ${TABLE} WHERE owner_wallet = $1 ORDER BY name ASC`, [owner]);
    return r.rows.map(rowToContact);
  },

  async add(owner: string, c: Omit<Contact, 'id'>): Promise<Contact> {
    const pool = getPostgresPool();
    if (!pool) throw new Error('Postgres not configured');
    await ensureTables();
    const id = crypto.randomUUID();
    const r = await pool.query(
      `INSERT INTO ${TABLE} (id, owner_wallet, name, email, phone, wallet_address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, owner, c.name, c.email, c.phone, c.wallet],
    );
    return rowToContact(r.rows[0]);
  },

  async update(owner: string, id: string, c: Partial<Omit<Contact, 'id'>>): Promise<Contact | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const r = await pool.query(
      `UPDATE ${TABLE} SET
         name = COALESCE($3, name),
         email = COALESCE($4, email),
         phone = COALESCE($5, phone),
         wallet_address = COALESCE($6, wallet_address)
       WHERE owner_wallet = $1 AND id = $2 RETURNING *`,
      [owner, id, c.name ?? null, c.email ?? null, c.phone ?? null, c.wallet ?? null],
    );
    return r.rows[0] ? rowToContact(r.rows[0]) : null;
  },

  async remove(owner: string, id: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`DELETE FROM ${TABLE} WHERE owner_wallet = $1 AND id = $2`, [owner, id]);
  },

  /** Directory lookup: email/phone → a member's primary wallet (exact hash match, opt-out aware). */
  async lookupWallet(email?: string, phone?: string): Promise<{ wallet: string; matchedOn: 'email' | 'phone' } | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const eHashes = email ? emailHashes(email) : [];
    const pHashes = phone ? phoneHashes(phone) : [];
    if (eHashes.length === 0 && pHashes.length === 0) return null;
    // Match either the saved profile contact (member_profile_public.email_hash/phone_hash) OR the
    // login identity the member signed up with (members.reown_email_hash/reown_phone_hash). LEFT JOIN
    // so members who never saved a profile contact are still discoverable by their login email/phone.
    // The contact hashes live on member_profile_private (email_hash/phone_hash), set when a member saves
    // a profile contact; the login identity lives on members (reown_email_hash/reown_phone_hash). Match
    // either, LEFT JOIN so members without a private profile still resolve by their login email/phone.
    const r = await pool.query(
      `SELECT m.primary_wallet AS wallet,
              (p.email_hash = ANY($1) OR m.reown_email_hash = ANY($1)) AS by_email
         FROM members m
         LEFT JOIN member_profile_private p ON p.member_id = m.id
        WHERE (p.email_hash = ANY($1) OR p.phone_hash = ANY($2)
               OR m.reown_email_hash = ANY($1) OR m.reown_phone_hash = ANY($2))
          AND m.primary_wallet IS NOT NULL
          AND lower(m.primary_wallet) NOT IN (SELECT wallet FROM ${OPTOUT})
        LIMIT 1`,
      [eHashes, pHashes],
    );
    const row = r.rows[0];
    if (!row?.wallet) return null;
    return { wallet: String(row.wallet), matchedOn: row.by_email ? 'email' : 'phone' };
  },

  async isOptedOut(wallet: string): Promise<boolean> {
    const pool = getPostgresPool();
    if (!pool) return false;
    await ensureTables();
    const r = await pool.query(`SELECT 1 FROM ${OPTOUT} WHERE wallet = $1`, [wallet.toLowerCase()]);
    return (r.rowCount ?? 0) > 0;
  },

  async setOptout(wallet: string, optout: boolean): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    if (optout) {
      await pool.query(`INSERT INTO ${OPTOUT} (wallet) VALUES ($1) ON CONFLICT (wallet) DO NOTHING`, [wallet.toLowerCase()]);
    } else {
      await pool.query(`DELETE FROM ${OPTOUT} WHERE wallet = $1`, [wallet.toLowerCase()]);
    }
  },
};
