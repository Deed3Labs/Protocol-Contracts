import { SetShopDomain, type ShopDomain } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { RewardsError } from './errors.js';
import { shopAppRow, toShopApp } from './shopApp.js';

/**
 * A shop's own domain (add-on). This records the domain and the DNS record the shop must add; adding
 * it to the rewards Vercel project and the check that verifies it are Phase 7.
 */
export async function setDomain(q: Queryable, input: { merchant: string; body: unknown }): Promise<ShopDomain> {
  const parsed = SetShopDomain.safeParse({ domain: String((input.body as { domain?: unknown })?.domain ?? '').trim().toLowerCase() });
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'That isn’t a domain', 'invalid');
  const app = await shopAppRow(q, input.merchant);
  if (!app) throw new RewardsError('Set up the shop’s app first', 'conflict');
  const domain = parsed.data.domain;
  const { rows: taken } = await q.query<{ merchant: string }>('SELECT merchant FROM rewards.shop_domains WHERE domain = $1 AND removed_at IS NULL', [domain]);
  if (taken[0] && taken[0].merchant !== input.merchant) throw new RewardsError('That domain is another shop’s', 'conflict');
  const labels = domain.split('.');
  // A subdomain points at Vercel by CNAME; an apex needs Vercel's A record.
  const record = labels.length > 2 ? { type: 'CNAME' as const, name: labels[0]!, value: 'cname.vercel-dns.com' } : { type: 'A' as const, name: '@', value: '76.76.21.21' };
  await q.query('UPDATE rewards.shop_domains SET removed_at = now() WHERE merchant = $1 AND removed_at IS NULL AND domain <> $2', [input.merchant, domain]);
  await q.query(
    `INSERT INTO rewards.shop_domains (domain, merchant, record) VALUES ($1,$2,$3) ON CONFLICT (domain) DO UPDATE SET removed_at = NULL, status = 'pending', record = EXCLUDED.record`,
    [domain, input.merchant, JSON.stringify(record)],
  );
  return { domain, shopSlug: toShopApp(app).slug, status: 'pending', record, checkedAt: null, verifiedAt: null };
}

/**
 * Check again: reads the record as it stands and stamps when it was looked at. Asking Vercel whether
 * the record is in place is Phase 7's; until then a domain stays pending.
 */
export async function checkDomain(q: Queryable, merchant: string): Promise<ShopDomain> {
  const app = await shopAppRow(q, merchant);
  const { rows } = await q.query<{ domain: string; status: ShopDomain['status']; record: ShopDomain['record'] | string; checked_at: Date | null; verified_at: Date | null }>(
    'UPDATE rewards.shop_domains SET checked_at = now() WHERE merchant = $1 AND removed_at IS NULL RETURNING domain, status, record, checked_at, verified_at',
    [merchant],
  );
  const d = rows[0];
  if (!app || !d) throw new RewardsError('Add a domain first', 'not_found');
  return {
    domain: d.domain,
    shopSlug: toShopApp(app).slug,
    status: d.status,
    record: typeof d.record === 'string' ? JSON.parse(d.record) : d.record,
    checkedAt: d.checked_at ? new Date(d.checked_at).toISOString() : null,
    verifiedAt: d.verified_at ? new Date(d.verified_at).toISOString() : null,
  };
}
