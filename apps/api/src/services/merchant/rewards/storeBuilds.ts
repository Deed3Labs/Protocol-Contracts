import { randomUUID } from 'node:crypto';
import { StoreBuild } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { RewardsError } from './errors.js';
import { shopBySlug, toShopApp } from './shopApp.js';

/**
 * Store app builds (add-on, rewards spec Phase 7): records only. One per shop and platform: the
 * bundle id, the version, the shop config it was built from, and where review stands. Clear's people
 * write them (scripts/store-build.ts) as a build goes through the shop's own developer accounts;
 * nothing here builds or submits (docs/rewards-reference/store-builds.md). Settings › Shop app reads
 * them.
 */

interface BuildRow {
  id: string;
  platform: StoreBuild['platform'];
  bundle_id: string;
  version: string;
  config_version: number;
  review: StoreBuild['review'];
  note: string | null;
  updated_at: Date | string;
}

const toBuild = (b: BuildRow): StoreBuild => ({
  id: b.id,
  platform: b.platform,
  bundleId: b.bundle_id,
  version: b.version,
  configVersion: b.config_version,
  review: b.review,
  note: b.note,
  updatedAt: new Date(b.updated_at).toISOString(),
});

/** A build record, made or brought up to date. Its config version is the shop's config as it is now. */
export async function recordStoreBuild(
  q: Queryable,
  input: { slug: string; platform: StoreBuild['platform']; bundleId: string; version: string; review: StoreBuild['review']; note?: string | null },
): Promise<StoreBuild> {
  const shop = await shopBySlug(q, input.slug, { includeOff: true });
  if (!shop) throw new RewardsError('No shop has that address', 'not_found');
  const app = toShopApp(shop);
  const parsed = StoreBuild.omit({ id: true, updatedAt: true }).safeParse({ platform: input.platform, bundleId: input.bundleId, version: input.version, configVersion: app.configVersion, review: input.review, note: input.note ?? null });
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'That build isn’t valid', 'invalid');
  const b = parsed.data;
  const { rows: updated } = await q.query<BuildRow>(
    `UPDATE rewards.store_builds SET bundle_id = $3, version = $4, config_version = $5, review = $6, note = $7, updated_at = now()
      WHERE merchant = $1 AND platform = $2 RETURNING *`,
    [shop.merchant, b.platform, b.bundleId, b.version, b.configVersion, b.review, b.note],
  );
  if (updated[0]) return toBuild(updated[0]);
  const { rows } = await q.query<BuildRow>(
    `INSERT INTO rewards.store_builds (id, merchant, platform, bundle_id, version, config_version, review, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [`stb_${randomUUID()}`, shop.merchant, b.platform, b.bundleId, b.version, b.configVersion, b.review, b.note],
  );
  return toBuild(rows[0]!);
}

export async function storeBuilds(q: Queryable, slug: string): Promise<StoreBuild[]> {
  const shop = await shopBySlug(q, slug, { includeOff: true });
  if (!shop) throw new RewardsError('No shop has that address', 'not_found');
  const { rows } = await q.query<BuildRow>('SELECT * FROM rewards.store_builds WHERE merchant = $1 ORDER BY platform', [shop.merchant]);
  return rows.map(toBuild);
}
