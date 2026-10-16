import { randomUUID } from 'node:crypto';
import { AddAllowedSite, allowedOrigin, type AllowedSite, type ApiKey, type NewSecretKey, ROLLED_KEY_HOURS } from '@clear/merchant-contracts';
import { isClearVersion, LATEST_VERSION, type ClearVersion } from '@clear/public-api-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { audit } from '../security/audit.js';
import { PayError } from './links.js';
import { randomBase62, sha256 } from './secrets.js';

/**
 * API keys and allowed websites (pay spec §6, §8). A shop has one publishable and one secret key per
 * mode. A publishable key is public: kept in full, it can only read prices and start a modal from an
 * allowed website. A secret key is kept as a hash and shown once; rolling it makes a new one and keeps
 * the old one working for 24 hours.
 */

interface KeyRow {
  id: string;
  merchant: string;
  kind: 'publishable' | 'secret';
  livemode: boolean;
  token: string | null;
  last4: string;
  pinned_version: string;
  created_by: string | null;
  created_at: Date | string;
  rolled_at: Date | string | null;
  expires_at: Date | string | null;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const pinned = (v: string): ClearVersion => (isClearVersion(v) ? v : LATEST_VERSION);

export const toApiKey = (r: KeyRow): ApiKey => ({
  id: r.id,
  kind: r.kind,
  livemode: r.livemode,
  token: r.token,
  last4: r.last4,
  createdAt: iso(r.created_at)!,
  createdBy: r.created_by,
  rolledAt: iso(r.rolled_at),
  expiresAt: iso(r.expires_at),
  pinnedVersion: pinned(r.pinned_version),
});

const mode = (livemode: boolean) => (livemode ? 'live' : 'test');

async function insertKey(tx: Queryable, input: { merchant: string; kind: 'publishable' | 'secret'; livemode: boolean; staffId: string | null }): Promise<{ row: KeyRow; token: string }> {
  const token = `clear_${input.kind === 'publishable' ? 'pk' : 'sk'}_${mode(input.livemode)}_${randomBase62(24)}`;
  const { rows } = await tx.query<KeyRow>(
    `INSERT INTO payments.api_keys (id, merchant, kind, livemode, token, secret_hash, last4, pinned_version, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      `key_${randomUUID().replace(/-/g, '')}`,
      input.merchant,
      input.kind,
      input.livemode,
      input.kind === 'publishable' ? token : null,
      input.kind === 'secret' ? sha256(token) : null,
      token.slice(-4),
      LATEST_VERSION,
      input.staffId,
    ],
  );
  return { row: rows[0]!, token };
}

/** Developers' "Make keys": the mode's publishable and secret keys, the first time. */
export async function createKeys(db: Db, input: { merchant: string; staffId: string; livemode: boolean }): Promise<NewSecretKey> {
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`api_keys:${input.merchant}:${input.livemode}`]);
    const { rows } = await tx.query('SELECT 1 FROM payments.api_keys WHERE merchant = $1 AND livemode = $2 AND rolled_at IS NULL LIMIT 1', [input.merchant, input.livemode]);
    if (rows[0]) throw new PayError('This shop has its keys for this mode already. Roll the secret key to replace it.', 'conflict');
    await insertKey(tx, { ...input, kind: 'publishable' });
    const secret = await insertKey(tx, { ...input, kind: 'secret' });
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'api_keys.created', ref: { type: 'api_key', id: secret.row.id }, detail: { livemode: input.livemode } });
    return { key: toApiKey(secret.row), secret: secret.token };
  });
}

/** Roll: a new secret key now, the old one good for 24 more hours. */
export async function rollSecretKey(db: Db, input: { merchant: string; staffId: string; keyId: string; now?: Date }): Promise<NewSecretKey> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<KeyRow>(`SELECT * FROM payments.api_keys WHERE id = $1 AND merchant = $2 AND kind = 'secret' FOR UPDATE`, [input.keyId, input.merchant]);
    const old = rows[0];
    if (!old) throw new PayError('No such key', 'not_found');
    if (old.rolled_at) throw new PayError('That key has been rolled already', 'conflict');
    await tx.query('UPDATE payments.api_keys SET rolled_at = $2, expires_at = $3 WHERE id = $1', [old.id, now, new Date(now.getTime() + ROLLED_KEY_HOURS * 3600_000)]);
    const fresh = await insertKey(tx, { merchant: input.merchant, kind: 'secret', livemode: old.livemode, staffId: input.staffId });
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'api_keys.rolled', ref: { type: 'api_key', id: fresh.row.id }, detail: { rolled: old.id, livemode: old.livemode } });
    return { key: toApiKey(fresh.row), secret: fresh.token };
  });
}

/** Every key the shop has, current first: what Developers lists (it shows only the current ones). */
export async function listKeys(q: Queryable, merchant: string, now = new Date()): Promise<ApiKey[]> {
  const { rows } = await q.query<KeyRow>(
    `SELECT * FROM payments.api_keys WHERE merchant = $1 AND (expires_at IS NULL OR expires_at > $2) ORDER BY rolled_at IS NOT NULL, created_at DESC`,
    [merchant, now],
  );
  return rows.map(toApiKey);
}

/** Who a bearer key is: the shop, the kind, the mode and its pinned version. Null when it isn't a key we know. */
export interface KeyAuth {
  merchant: string;
  keyId: string;
  kind: 'publishable' | 'secret';
  livemode: boolean;
  pinnedVersion: ClearVersion;
}

export type KeyLookup = { ok: true; auth: KeyAuth } | { ok: false; code: 'key_invalid' | 'key_expired' };

export async function authenticateKey(q: Queryable, token: string, now = new Date()): Promise<KeyLookup> {
  const m = /^clear_(pk|sk)_(test|live)_[0-9A-Za-z]{24}$/.exec(token);
  if (!m) return { ok: false, code: 'key_invalid' };
  const { rows } = await q.query<KeyRow>(m[1] === 'pk' ? 'SELECT * FROM payments.api_keys WHERE token = $1' : 'SELECT * FROM payments.api_keys WHERE secret_hash = $1', [
    m[1] === 'pk' ? token : sha256(token),
  ]);
  const r = rows[0];
  if (!r) return { ok: false, code: 'key_invalid' };
  if (r.expires_at && new Date(r.expires_at).getTime() <= now.getTime()) return { ok: false, code: 'key_expired' };
  return { ok: true, auth: { merchant: r.merchant, keyId: r.id, kind: r.kind, livemode: r.livemode, pinnedVersion: pinned(r.pinned_version) } };
}

// ---- Allowed websites ----------------------------------------------------------------------------

interface SiteRow {
  merchant: string;
  origin: string;
  test_only: boolean;
  added_by: string | null;
  added_at: Date | string;
}

const toSite = (r: SiteRow): AllowedSite => ({ origin: r.origin, addedAt: iso(r.added_at)!, addedBy: r.added_by, testOnly: r.test_only });

export async function listSites(q: Queryable, merchant: string): Promise<AllowedSite[]> {
  const { rows } = await q.query<SiteRow>('SELECT * FROM payments.allowed_sites WHERE merchant = $1 ORDER BY added_at', [merchant]);
  return rows.map(toSite);
}

/** "Add a site": an origin only, https only; localhost for test keys. */
export async function addSite(db: Db, input: { merchant: string; staffId: string; request: unknown; now?: Date }): Promise<AllowedSite> {
  const parsed = AddAllowedSite.safeParse(input.request);
  if (!parsed.success) throw new PayError('Type the website’s address', 'invalid');
  const site = allowedOrigin(parsed.data.site);
  if (!site.ok) throw new PayError(site.reason, 'invalid');
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<SiteRow>(
      `INSERT INTO payments.allowed_sites (merchant, origin, test_only, added_by, added_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (merchant, origin) DO NOTHING RETURNING *`,
      [input.merchant, site.origin, site.testOnly, input.staffId, input.now ?? new Date()],
    );
    if (!rows[0]) throw new PayError('That website is on the list already', 'conflict');
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'allowed_site.added', detail: { origin: site.origin } });
    return toSite(rows[0]);
  });
}

export async function removeSite(db: Db, input: { merchant: string; staffId: string; origin: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query('DELETE FROM payments.allowed_sites WHERE merchant = $1 AND origin = $2 RETURNING origin', [input.merchant, input.origin]);
    if (!rows[0]) throw new PayError('That website isn’t on the list', 'not_found');
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'allowed_site.removed', detail: { origin: input.origin } });
  });
}

/** Whether a page at `origin` may use this shop's key in this mode. Loopback origins are test only. */
export async function originAllowed(q: Queryable, input: { merchant: string; origin: string | undefined; livemode: boolean }): Promise<boolean> {
  if (!input.origin) return false;
  const { rows } = await q.query<{ test_only: boolean }>('SELECT test_only FROM payments.allowed_sites WHERE merchant = $1 AND origin = $2', [input.merchant, input.origin]);
  const r = rows[0];
  return Boolean(r) && !(r!.test_only && input.livemode);
}
