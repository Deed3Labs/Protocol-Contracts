import { SetShopDomain, type DomainShop, type ShopDomain } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { RewardsError } from './errors.js';
import { shopAppRow, toShopApp } from './shopApp.js';
import type { VercelDomains, VercelDomainState } from './vercel.js';

/**
 * A shop's own domain (add-on, rewards spec Phase 7). Using a domain adds it to the rewards Vercel
 * project, which serves the app there and issues its certificate. The shop adds one record where it
 * bought the domain (a CNAME for a subdomain, an A record at the root), and a TXT too when Vercel asks
 * for one. A job checks pending domains until Vercel sees the record; then `useclear.org/s/:slug`
 * forwards there. On its own domain a customer confirms their number once: the sign-in can't cross.
 */

interface DomainRow {
  domain: string;
  merchant: string;
  status: ShopDomain['status'];
  record: ShopDomain['record'] | string;
  verification?: ShopDomain['verification'] | string | null;
  checked_at: Date | string | null;
  verified_at: Date | string | null;
}

const json = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);

function toDomain(r: DomainRow, slug: string): ShopDomain {
  return {
    domain: r.domain,
    shopSlug: slug,
    status: r.status,
    record: json(r.record),
    verification: r.verification ? json<NonNullable<ShopDomain['verification']>>(r.verification) : null,
    checkedAt: iso(r.checked_at),
    verifiedAt: iso(r.verified_at),
  };
}

/** Where Vercel's answer leaves a domain: live once it's the project's and the DNS points at Vercel. */
async function apply(q: Queryable, domain: string, state: VercelDomainState, now: Date): Promise<DomainRow> {
  const live = state.verified && !state.misconfigured;
  const { rows: was } = await q.query<{ status: string }>('SELECT status FROM rewards.shop_domains WHERE domain = $1', [domain]);
  const { rows } = await q.query<DomainRow>(
    `UPDATE rewards.shop_domains SET checked_at = $2, verification = $3,
        status = CASE WHEN $4 THEN 'verified' ELSE 'pending' END,
        verified_at = CASE WHEN $4 THEN COALESCE(verified_at, $2) ELSE NULL END
      WHERE domain = $1 RETURNING *`,
    [domain, now.toISOString(), state.verification ? JSON.stringify(state.verification) : null, live],
  );
  // Going live (or dropping off) changes the public config, which is cached by its version.
  if ((was[0]?.status === 'verified') !== live) await q.query('UPDATE rewards.shop_apps SET config_version = config_version + 1, updated_at = now() WHERE merchant = $1', [rows[0]!.merchant]);
  return rows[0]!;
}

export async function setDomain(q: Queryable, input: { merchant: string; body: unknown; vercel: VercelDomains | null; now?: Date }): Promise<ShopDomain> {
  const now = input.now ?? new Date();
  const parsed = SetShopDomain.safeParse({ domain: String((input.body as { domain?: unknown })?.domain ?? '').trim().toLowerCase() });
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'That isn’t a domain', 'invalid');
  const app = await shopAppRow(q, input.merchant);
  if (!app) throw new RewardsError('Set up the shop’s app first', 'conflict');
  const slug = toShopApp(app).slug;
  const domain = parsed.data.domain;
  if (/(^|\.)useclear\.org$/.test(domain)) throw new RewardsError('That’s one of Clear’s addresses. Use a domain the shop owns', 'invalid');
  const { rows: taken } = await q.query<{ merchant: string }>('SELECT merchant FROM rewards.shop_domains WHERE domain = $1 AND removed_at IS NULL', [domain]);
  if (taken[0] && taken[0].merchant !== input.merchant) throw new RewardsError('That domain is another shop’s', 'conflict');
  const labels = domain.split('.');
  // A subdomain points at Vercel by CNAME; an apex needs Vercel's A record.
  const record = labels.length > 2 ? { type: 'CNAME' as const, name: labels[0]!, value: 'cname.vercel-dns.com' } : { type: 'A' as const, name: '@', value: '76.76.21.21' };
  // One live domain a shop: the one it had comes off the project too.
  const { rows: before } = await q.query<{ domain: string }>('UPDATE rewards.shop_domains SET removed_at = now() WHERE merchant = $1 AND removed_at IS NULL AND domain <> $2 RETURNING domain', [input.merchant, domain]);
  for (const b of before) await input.vercel?.remove(b.domain).catch(() => undefined);
  await q.query(
    `INSERT INTO rewards.shop_domains (domain, merchant, record) VALUES ($1,$2,$3)
     ON CONFLICT (domain) DO UPDATE SET removed_at = NULL, status = 'pending', record = EXCLUDED.record, verified_at = NULL, checked_at = NULL, verification = NULL`,
    [domain, input.merchant, JSON.stringify(record)],
  );
  if (!input.vercel) return toDomain({ domain, merchant: input.merchant, status: 'pending', record, checked_at: null, verified_at: null }, slug);
  try {
    return toDomain(await apply(q, domain, await input.vercel.add(domain), now), slug);
  } catch (e) {
    // Vercel refused it (taken on a project of its own, or not a domain it can serve): said, and kept as failed.
    await q.query(`UPDATE rewards.shop_domains SET status = 'failed', checked_at = $2 WHERE domain = $1`, [domain, now.toISOString()]);
    throw new RewardsError(`Vercel couldn’t add it: ${(e as Error).message}`, 'unavailable');
  }
}

/** Check again: asks Vercel where the domain stands (or, without Vercel set up, stamps the record). */
export async function checkDomain(q: Queryable, merchant: string, vercel: VercelDomains | null, now = new Date()): Promise<ShopDomain> {
  const app = await shopAppRow(q, merchant);
  const { rows } = await q.query<DomainRow>('SELECT * FROM rewards.shop_domains WHERE merchant = $1 AND removed_at IS NULL', [merchant]);
  const d = rows[0];
  if (!app || !d) throw new RewardsError('Add a domain first', 'not_found');
  const slug = toShopApp(app).slug;
  if (!vercel) {
    const { rows: stamped } = await q.query<DomainRow>('UPDATE rewards.shop_domains SET checked_at = $2 WHERE domain = $1 RETURNING *', [d.domain, now.toISOString()]);
    return toDomain(stamped[0]!, slug);
  }
  return toDomain(await apply(q, d.domain, await vercel.state(d.domain), now), slug);
}

/**
 * The verification job: every domain still pending, looked at again. A domain that has gone quiet
 * for a week is looked at hourly rather than every run. Returns how many went live.
 */
export async function checkPendingDomains(q: Queryable, vercel: VercelDomains | null, now = new Date()): Promise<number> {
  if (!vercel) return 0;
  const { rows } = await q.query<{ domain: string }>(
    `SELECT domain FROM rewards.shop_domains WHERE removed_at IS NULL AND status = 'pending'
       AND (checked_at IS NULL OR created_at > $1::timestamptz - interval '7 days' OR checked_at < $1::timestamptz - interval '1 hour')`,
    [now.toISOString()],
  );
  let live = 0;
  for (const r of rows) {
    try {
      const row = await apply(q, r.domain, await vercel.state(r.domain), now);
      if (row.status === 'verified') live += 1;
    } catch (e) {
      console.error(`[rewards] domain ${r.domain}:`, (e as Error).message);
    }
  }
  return live;
}

/** Which shop a verified domain is: the app on that domain opens the shop at `/`. */
export async function domainShop(q: Queryable, host: string): Promise<DomainShop> {
  const { rows } = await q.query<{ slug: string }>(
    `SELECT a.slug FROM rewards.shop_domains d JOIN rewards.shop_apps a ON a.merchant = d.merchant
      WHERE d.domain = $1 AND d.removed_at IS NULL AND d.status = 'verified' AND a.enabled`,
    [host.trim().toLowerCase().replace(/:\d+$/, '')],
  );
  if (!rows[0]) throw new RewardsError('No shop is on that domain', 'not_found');
  return { slug: rows[0].slug };
}

/** The verified domain a shop's public config names, so its `/s/:slug` link forwards there. */
export async function verifiedDomain(q: Queryable, merchant: string): Promise<string | null> {
  const { rows } = await q.query<{ domain: string }>(`SELECT domain FROM rewards.shop_domains WHERE merchant = $1 AND removed_at IS NULL AND status = 'verified'`, [merchant]);
  return rows[0]?.domain ?? null;
}
