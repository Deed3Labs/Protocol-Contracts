import { randomUUID } from 'node:crypto';
import {
  BRAND_PRESETS,
  Brand,
  brandContrast,
  earnLabels,
  EarnRules,
  EarnRulesInput,
  giveBack,
  OfferPatch,
  pointsWord,
  PointsName,
  Reward,
  RewardInput,
  ShopAppPatch,
  type DiscountCode,
  type EarnSummary,
  type GiveBack,
  type OfferView,
  type PublicShopApp,
  type RewardView,
  type ShopApp,
} from '@clear/merchant-contracts';
import { shopSlug } from '@clear/domain';
import type { Queryable } from '../../../db/db.js';
import { listDiscountCodes } from '../catalog/catalogService.js';
import { RewardsError } from './errors.js';
import { fontUsable } from './fonts.js';

/**
 * A shop's app: its address, look, points name and offers (`rewards.shop_apps`), its earning rules
 * (`rewards.earn_rules`, versioned) and its rewards (`rewards.rewards`). Public through
 * `GET /api/s/:slug`; edited in Settings › Shop app.
 */

export interface ShopAppRow {
  merchant: string;
  slug: string;
  enabled: boolean;
  brand: Brand | string;
  points_name: PointsName | string;
  offer_code_ids: string[];
  lat: number | null;
  lng: number | null;
  config_version: number;
  updated_at: Date | string;
}

const json = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);
const iso = (d: Date | string) => new Date(d).toISOString();

/** A new shop's rules: a point per dollar, nothing else, never expiring. */
export const DEFAULT_RULES: Omit<EarnRules, 'version' | 'effectiveAt'> = {
  unit: 'dollars',
  pointsPer: 1,
  perAmountCents: 100,
  visitMinCents: 0,
  cardSize: 10,
  keepTheChange: false,
  clearMultiplier: 1,
  boosts: [],
  joinBonus: 0,
  birthdayRewardId: null,
  referralBonus: null,
  expiry: 'never',
};

/** "MC" from "Mi Casa Tacos". */
export function monogramOf(name: string): string {
  const words = name.replace(/['’]/g, '').split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const letters = words.slice(0, 2).map((w) => w.charAt(0).toUpperCase());
  return (letters.join('') || 'C').slice(0, 2);
}

export function defaultBrand(name: string): Brand {
  const ink = BRAND_PRESETS.ink;
  return {
    logoUrl: null,
    monogram: monogramOf(name),
    colour: ink.colour,
    onColour: ink.onColour,
    paper: ink.paper,
    paper2: ink.paper2,
    headingFont: { kind: 'preset', preset: 'grotesque' },
    textFont: { kind: 'preset', preset: 'instrument_sans' },
  };
}

export function toShopApp(r: ShopAppRow): ShopApp {
  return {
    slug: r.slug,
    enabled: r.enabled,
    brand: json<Brand>(r.brand),
    pointsName: json<PointsName>(r.points_name),
    offerCodeIds: r.offer_code_ids ?? [],
    configVersion: r.config_version,
    updatedAt: iso(r.updated_at),
  };
}

export async function shopAppRow(q: Queryable, merchant: string): Promise<ShopAppRow | null> {
  const { rows } = await q.query<ShopAppRow>('SELECT * FROM rewards.shop_apps WHERE merchant = $1', [merchant]);
  return rows[0] ?? null;
}

/** The shop behind a slug. Only a shop that has turned its app on, unless `includeOff`. */
export async function shopBySlug(q: Queryable, slug: string, opts: { includeOff?: boolean } = {}): Promise<(ShopAppRow & { name: string; timezone: string }) | null> {
  const { rows } = await q.query<ShopAppRow & { name: string; timezone: string | null }>(
    `SELECT a.*, p.name, p.timezone FROM rewards.shop_apps a JOIN merchant.profiles p ON p.merchant = a.merchant WHERE a.slug = $1`,
    [slug.toLowerCase()],
  );
  const r = rows[0];
  if (!r || (!r.enabled && !opts.includeOff)) return null;
  return { ...r, timezone: r.timezone ?? 'America/Los_Angeles' };
}

/** Settings › Shop app makes the shop's app on first open: off, in Clear's look, a point a dollar. */
export async function ensureShopApp(q: Queryable, merchant: string, by: string | null): Promise<ShopAppRow> {
  const found = await shopAppRow(q, merchant);
  if (found) return found;
  const { rows: shop } = await q.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [merchant]);
  if (!shop[0]) throw new RewardsError('No such shop', 'not_found');
  const base = shopSlug(shop[0].name).slice(0, 32).replace(/-+$/, '') || 'shop';
  let slug = base.length >= 2 ? base : `${base}-shop`;
  for (let i = 2; ; i += 1) {
    const { rows } = await q.query('SELECT 1 FROM rewards.shop_apps WHERE slug = $1', [slug]);
    if (!rows[0]) break;
    slug = `${base.slice(0, 28)}-${i}`;
  }
  await q.query(`INSERT INTO rewards.shop_apps (merchant, slug, brand) VALUES ($1,$2,$3) ON CONFLICT (merchant) DO NOTHING`, [merchant, slug, JSON.stringify(defaultBrand(shop[0].name))]);
  await q.query(`INSERT INTO rewards.earn_rules (merchant, version, rules, created_by) VALUES ($1, 1, $2, $3) ON CONFLICT DO NOTHING`, [merchant, JSON.stringify(DEFAULT_RULES), by]);
  return (await shopAppRow(q, merchant))!;
}

// ---- Rules ----------------------------------------------------------------------------------------

/** The rules in force at a moment: the newest version effective by then. */
export async function rulesAt(q: Queryable, merchant: string, at = new Date()): Promise<EarnRules> {
  const { rows } = await q.query<{ version: number; effective_at: Date | string; rules: object | string }>(
    `SELECT version, effective_at, rules FROM rewards.earn_rules WHERE merchant = $1 AND effective_at <= $2 ORDER BY version DESC LIMIT 1`,
    [merchant, at.toISOString()],
  );
  const r = rows[0];
  if (!r) return { ...DEFAULT_RULES, version: 1, effectiveAt: at.toISOString() };
  return EarnRules.parse({ ...json<object>(r.rules), version: r.version, effectiveAt: iso(r.effective_at) });
}

export async function rulesByVersion(q: Queryable, merchant: string, version: number): Promise<EarnRules | null> {
  const { rows } = await q.query<{ version: number; effective_at: Date | string; rules: object | string }>(
    'SELECT version, effective_at, rules FROM rewards.earn_rules WHERE merchant = $1 AND version = $2',
    [merchant, version],
  );
  const r = rows[0];
  return r ? EarnRules.parse({ ...json<object>(r.rules), version: r.version, effectiveAt: iso(r.effective_at) }) : null;
}

/** A save of the rules is a new version, effective now. Boosts without an id get one. */
export async function saveRules(q: Queryable, merchant: string, by: string | null, body: unknown, now = new Date()): Promise<EarnRules> {
  const parsed = EarnRulesInput.safeParse(body);
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'Those rules aren’t valid', 'invalid');
  const r = parsed.data;
  if (r.unit === 'visits' && r.visitMinCents < 0) throw new RewardsError('A visit needs a minimum', 'invalid');
  if (r.birthdayRewardId) {
    const { rows } = await q.query('SELECT 1 FROM rewards.rewards WHERE id = $1 AND merchant = $2 AND archived_at IS NULL', [r.birthdayRewardId, merchant]);
    if (!rows[0]) throw new RewardsError('That birthday reward isn’t one of yours', 'invalid');
  }
  const rules = { ...r, boosts: r.boosts.map((b) => ({ ...b, id: b.id ?? `bst_${randomUUID().slice(0, 8)}` })) };
  const { rows } = await q.query<{ v: number }>('SELECT COALESCE(max(version), 0) + 1 AS v FROM rewards.earn_rules WHERE merchant = $1', [merchant]);
  const version = Number(rows[0]!.v);
  await q.query('INSERT INTO rewards.earn_rules (merchant, version, effective_at, rules, created_by) VALUES ($1,$2,$3,$4,$5)', [merchant, version, now.toISOString(), JSON.stringify(rules), by]);
  return EarnRules.parse({ ...rules, version, effectiveAt: now.toISOString() });
}

// ---- Rewards --------------------------------------------------------------------------------------

interface RewardRow {
  id: string;
  name: string;
  gives: Reward['gives'] | string;
  cost: number;
  limit_per: Reward['limit'];
  clear_members_only: boolean;
  note: string | null;
}

const toReward = (r: RewardRow): Reward => ({ id: r.id, name: r.name, gives: json(r.gives), cost: r.cost, limit: r.limit_per, clearMembersOnly: r.clear_members_only, note: r.note });

export async function rewardsFor(q: Queryable, merchant: string): Promise<Reward[]> {
  const { rows } = await q.query<RewardRow>('SELECT * FROM rewards.rewards WHERE merchant = $1 AND archived_at IS NULL ORDER BY cost, created_at', [merchant]);
  return rows.map(toReward);
}

export async function rewardById(q: Queryable, merchant: string, id: string): Promise<Reward | null> {
  const { rows } = await q.query<RewardRow>('SELECT * FROM rewards.rewards WHERE id = $1 AND merchant = $2 AND archived_at IS NULL', [id, merchant]);
  return rows[0] ? toReward(rows[0]) : null;
}

async function checkRewardItems(q: Queryable, merchant: string, input: RewardIn): Promise<void> {
  if (input.gives.kind !== 'item') return;
  const { rows } = await q.query<{ n: string | number }>('SELECT count(*) AS n FROM commerce.catalog_items WHERE merchant = $1 AND id = ANY($2::text[])', [merchant, input.gives.itemIds]);
  if (Number(rows[0]!.n) !== new Set(input.gives.itemIds).size) throw new RewardsError('One of those items isn’t in your inventory', 'invalid');
}

type RewardIn = ReturnType<typeof RewardInput.parse>;

export async function createReward(q: Queryable, merchant: string, body: unknown): Promise<Reward> {
  const parsed = RewardInput.safeParse(body);
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'That reward isn’t valid', 'invalid');
  await checkRewardItems(q, merchant, parsed.data);
  const r = parsed.data;
  const { rows } = await q.query<RewardRow>(
    `INSERT INTO rewards.rewards (id, merchant, name, gives, cost, limit_per, clear_members_only, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [`rwd_${randomUUID()}`, merchant, r.name, JSON.stringify(r.gives), r.cost, r.limit, r.clearMembersOnly, r.note],
  );
  await bumpConfig(q, merchant);
  return toReward(rows[0]!);
}

/**
 * Changing a reward retires the old one and adds the new, so an order or claim that named the old
 * one keeps what it was when it was used.
 */
export async function updateReward(q: Queryable, merchant: string, id: string, body: unknown, by: string | null = null): Promise<Reward> {
  if (!(await rewardById(q, merchant, id))) throw new RewardsError('No such reward', 'not_found');
  const created = await createReward(q, merchant, body);
  await q.query('UPDATE rewards.rewards SET archived_at = now() WHERE id = $1 AND merchant = $2', [id, merchant]);
  await carryBirthday(q, merchant, by, new Map([[id, created.id]]));
  return created;
}

/**
 * The birthday reward is named by id, and an edit makes a new reward under a new id. Without this the
 * rules would keep naming the retired one, and the birthday reward would quietly stop being given
 * (the ledger skips an archived reward). Saves a new rules version naming the new id.
 */
async function carryBirthday(q: Queryable, merchant: string, by: string | null, moved: Map<string, string>): Promise<void> {
  const current = await rulesAt(q, merchant);
  const next = current.birthdayRewardId ? moved.get(current.birthdayRewardId) : undefined;
  if (!next) return;
  const { version: _v, effectiveAt: _e, ...input } = current;
  await saveRules(q, merchant, by, { ...input, birthdayRewardId: next });
}

/**
 * New costs for some rewards (Settings › Shop app's re-price, when Earn by changes unit). Each changed
 * one is re-made like an edit; returns the old id → new id, so the rules saved with it can follow.
 */
async function repriceRewards(q: Queryable, merchant: string, costs: Array<{ id: string; cost: number }>): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  for (const { id, cost } of costs) {
    const r = await rewardById(q, merchant, id);
    if (!r) throw new RewardsError('One of those rewards isn’t one of yours', 'invalid');
    if (r.cost === cost) continue;
    const created = await createReward(q, merchant, { name: r.name, gives: r.gives, cost, limit: r.limit, clearMembersOnly: r.clearMembersOnly, note: r.note });
    await q.query('UPDATE rewards.rewards SET archived_at = now() WHERE id = $1 AND merchant = $2', [id, merchant]);
    moved.set(id, created.id);
  }
  return moved;
}

export async function removeReward(q: Queryable, merchant: string, id: string): Promise<void> {
  const { rows } = await q.query('UPDATE rewards.rewards SET archived_at = now() WHERE id = $1 AND merchant = $2 AND archived_at IS NULL RETURNING id', [id, merchant]);
  if (!rows[0]) throw new RewardsError('No such reward', 'not_found');
  await bumpConfig(q, merchant);
}

async function bumpConfig(q: Queryable, merchant: string): Promise<void> {
  await q.query('UPDATE rewards.shop_apps SET config_version = config_version + 1, updated_at = now() WHERE merchant = $1', [merchant]);
}

/** Catalogue prices, for what an item reward is worth. */
export async function pricesFor(q: Queryable, merchant: string): Promise<(itemId: string) => number | null> {
  const { rows } = await q.query<{ id: string; price_cents: string | number }>('SELECT id, price_cents FROM commerce.catalog_items WHERE merchant = $1', [merchant]);
  const m = new Map(rows.map((r) => [r.id, Number(r.price_cents)]));
  return (id) => m.get(id) ?? null;
}

export async function giveBackFor(q: Queryable, merchant: string, rulesBody?: unknown): Promise<GiveBack> {
  let rules = await rulesAt(q, merchant);
  if (rulesBody !== undefined) {
    const parsed = EarnRulesInput.safeParse(rulesBody);
    if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'Those rules aren’t valid', 'invalid');
    rules = EarnRules.parse({ ...parsed.data, boosts: parsed.data.boosts.map((b, i) => ({ ...b, id: b.id ?? `new_${i}` })), version: rules.version, effectiveAt: rules.effectiveAt });
  }
  return giveBack(rules, await rewardsFor(q, merchant), await pricesFor(q, merchant));
}

// ---- What the app says --------------------------------------------------------------------------

export function earnSummary(rules: EarnRules, name: PointsName): EarnSummary {
  return { unit: rules.unit, ...earnLabels(rules, name), cardSize: rules.unit === 'visits' ? rules.cardSize : null, joinBonus: rules.joinBonus };
}

export function rewardView(r: Reward, name: PointsName): RewardView {
  const cost = `${r.cost} ${pointsWord(name, r.cost)}`;
  return { id: r.id, name: r.name, detail: r.note ? `${cost} · ${r.note}` : cost, cost: r.cost, clearMembersOnly: r.clearMembersOnly };
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** When an offer works, as its row says it: "Tue", "Nov", "Ends Oct 31", "From Nov 1". */
export function offerWhen(c: { days: number[] | null; starts_at: Date | string | null; ends_at: Date | string | null }, timeZone: string, now = new Date()): string {
  if (c.days?.length) return c.days.map((d) => DAY[d]).join(', ');
  const fmt = (d: Date | string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone, ...o }).format(new Date(d));
  if (c.starts_at && c.ends_at) {
    // A window inside one month is the month: Mike's Tire's "Winter check · Nov".
    const last = new Date(new Date(c.ends_at).getTime() - 1);
    if (fmt(c.starts_at, { year: 'numeric', month: 'short' }) === fmt(last, { year: 'numeric', month: 'short' })) return fmt(c.starts_at, { month: 'short' });
  }
  if (c.starts_at && new Date(c.starts_at) > now) return `From ${fmt(c.starts_at, { month: 'short', day: 'numeric' })}`;
  if (c.ends_at) return `Ends ${fmt(new Date(new Date(c.ends_at).getTime() - 1), { month: 'short', day: 'numeric' })}`;
  return '';
}

/**
 * The shop's offers: its discount codes switched on for the app, in the order it chose, that haven't
 * ended, for this audience.
 */
export async function offersFor(
  q: Queryable,
  app: ShopAppRow,
  timeZone: string,
  who: { member: boolean; clearMember: boolean },
  now = new Date(),
): Promise<OfferView[]> {
  const { rows } = await q.query<{
    id: string;
    code: string;
    percent: number | null;
    amount_cents: string | number | null;
    starts_at: Date | null;
    ends_at: Date | null;
    audience: OfferView['audience'];
    offer_title: string | null;
    offer_detail: string | null;
    days: number[] | null;
  }>(
    `SELECT * FROM commerce.discount_codes WHERE merchant = $1 AND show_in_app AND archived_at IS NULL AND (ends_at IS NULL OR ends_at > $2)`,
    [app.merchant, now.toISOString()],
  );
  const order = new Map((app.offer_code_ids ?? []).map((id, i) => [id, i]));
  return rows
    .filter((c) => c.audience === 'everyone' || (c.audience === 'members' && who.member) || (c.audience === 'clear_members' && who.clearMember))
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
    .map((c) => ({
      codeId: c.id,
      code: c.code,
      title: c.offer_title ?? c.code,
      detail: c.offer_detail ?? (c.percent !== null ? `${c.percent}% off` : `$${(Number(c.amount_cents) / 100).toFixed(2)} off`),
      when: offerWhen(c, timeZone, now),
      audience: c.audience,
    }));
}

/** "A point for every dollar, and a free agua fresca at 75." */
export function pitchFor(rules: EarnRules, name: PointsName, rewards: Reward[]): string {
  const first = rewards[0];
  const one = pointsWord(name, 1);
  const rate =
    rules.unit === 'visits'
      ? `A ${one} every visit`
      : rules.pointsPer === 1 && rules.perAmountCents === 100
        ? `A ${one} for every dollar`
        : `${rules.pointsPer} ${pointsWord(name, rules.pointsPer)} for every $${rules.perAmountCents / 100}`;
  return first ? `${rate}, and a ${first.name.replace(/^Free /, 'free ')} at ${first.cost}.` : `${rate}.`;
}

/** `GET /api/s/:slug`: everything the app needs to dress itself, public and cached by version. */
export async function publicShopApp(q: Queryable, slug: string, now = new Date()): Promise<PublicShopApp> {
  const shop = await shopBySlug(q, slug);
  if (!shop) throw new RewardsError('No shop has that address', 'not_found');
  const app = toShopApp(shop);
  const rules = await rulesAt(q, shop.merchant, now);
  const rewards = await rewardsFor(q, shop.merchant);
  const { rows: fonts } = await q.query<{ id: string }>('SELECT id FROM rewards.shop_app_fonts WHERE merchant = $1 AND removed_at IS NULL', [shop.merchant]);
  const base = (process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
  return {
    slug: app.slug,
    name: shop.name,
    brand: app.brand,
    fonts: Object.fromEntries(fonts.map((f) => [f.id, `${base}/api/s/${app.slug}/fonts/${f.id}.woff2`])),
    pointsName: app.pointsName,
    earn: earnSummary(rules, app.pointsName),
    pitch: pitchFor(rules, app.pointsName, rewards),
    rewards: rewards.map((r) => rewardView(r, app.pointsName)),
    offers: await offersFor(q, shop, shop.timezone, { member: false, clearMember: false }, now),
    configVersion: app.configVersion,
    // Its own domain, once verified: the shop's useclear.org link forwards there.
    domain: (await q.query<{ domain: string }>(`SELECT domain FROM rewards.shop_domains WHERE merchant = $1 AND removed_at IS NULL AND status = 'verified'`, [shop.merchant])).rows[0]?.domain ?? null,
  };
}

/** `GET /api/s/:slug/manifest.webmanifest`: each shop's link installs as its own app. */
export async function manifestFor(q: Queryable, slug: string): Promise<Record<string, unknown>> {
  const shop = await shopBySlug(q, slug);
  if (!shop) throw new RewardsError('No shop has that address', 'not_found');
  const app = toShopApp(shop);
  const scope = `/s/${app.slug}/`;
  const icons = app.brand.logoUrl
    ? [
        { src: app.brand.logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: app.brand.logoUrl, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ]
    : [];
  return {
    id: scope,
    name: shop.name,
    short_name: shop.name.length > 12 ? shop.name.split(/\s+/).slice(0, 2).join(' ') : shop.name,
    start_url: scope,
    scope,
    display: 'standalone',
    theme_color: app.brand.colour,
    background_color: app.brand.paper,
    icons,
  };
}

// ---- Settings › Shop app ------------------------------------------------------------------------

/** Saves what Settings changed. A new slug must be free; colours must pass the contrast checks. */
export async function patchShopApp(q: Queryable, merchant: string, staffId: string, body: unknown): Promise<void> {
  const parsed = ShopAppPatch.safeParse(body);
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'Those settings aren’t valid', 'invalid');
  const p = parsed.data;
  const row = await ensureShopApp(q, merchant, staffId);
  const current = toShopApp(row);
  if (p.slug && p.slug !== current.slug) {
    const { rows } = await q.query('SELECT 1 FROM rewards.shop_apps WHERE slug = $1 AND merchant <> $2', [p.slug, merchant]);
    if (rows[0]) throw new RewardsError('That address is taken', 'conflict');
  }
  const brand = p.brand ? Brand.parse({ ...current.brand, ...p.brand }) : current.brand;
  const problems = brandContrast(brand);
  if (problems.length) throw new RewardsError(problems[0]!, 'invalid');
  for (const f of [brand.headingFont, brand.textFont]) {
    if (f.kind !== 'uploaded') continue;
    if (!(await fontUsable(q, merchant, f.fontId))) throw new RewardsError('That font isn’t one you uploaded, or it didn’t pass its checks', 'invalid');
  }
  if (p.offerCodeIds) {
    const { rows } = await q.query<{ n: string | number }>('SELECT count(*) AS n FROM commerce.discount_codes WHERE merchant = $1 AND id = ANY($2::text[])', [merchant, p.offerCodeIds]);
    if (Number(rows[0]!.n) !== new Set(p.offerCodeIds).size) throw new RewardsError('One of those offers isn’t one of your codes', 'invalid');
    // Choosing the offers is the switch: the app shows exactly these.
    await q.query('UPDATE commerce.discount_codes SET show_in_app = (id = ANY($2::text[])) WHERE merchant = $1', [merchant, p.offerCodeIds]);
  }
  await q.query(
    `UPDATE rewards.shop_apps SET slug = $2, enabled = $3, brand = $4, points_name = $5, offer_code_ids = $6, config_version = config_version + 1, updated_at = now() WHERE merchant = $1`,
    [merchant, p.slug ?? current.slug, p.enabled ?? current.enabled, JSON.stringify(brand), JSON.stringify(p.pointsName ?? current.pointsName), p.offerCodeIds ?? current.offerCodeIds],
  );
  // Re-priced rewards first, so rules saved alongside can name them; all in the caller's transaction.
  const moved = p.rewardCosts?.length ? await repriceRewards(q, merchant, p.rewardCosts) : new Map<string, string>();
  if (p.rules) {
    const birthday = p.rules.birthdayRewardId ? (moved.get(p.rules.birthdayRewardId) ?? p.rules.birthdayRewardId) : null;
    await saveRules(q, merchant, staffId, { ...p.rules, birthdayRewardId: birthday });
  } else if (moved.size) {
    await carryBirthday(q, merchant, staffId, moved);
  }
}

/**
 * Settings › Discounts: a code's Show in app switch and who sees it. On puts it last among the
 * app's offers; off takes it out. The app's order stays the shop's.
 */
export async function updateOffer(q: Queryable, merchant: string, staffId: string, codeId: string, body: unknown): Promise<DiscountCode> {
  const parsed = OfferPatch.safeParse(body);
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'That isn’t valid', 'invalid');
  const p = parsed.data;
  const { rows } = await q.query<{ id: string }>('SELECT id FROM commerce.discount_codes WHERE merchant = $1 AND id = $2 AND archived_at IS NULL', [merchant, codeId]);
  if (!rows[0]) throw new RewardsError('No such code', 'not_found');
  if (p.audience) await q.query('UPDATE commerce.discount_codes SET audience = $3 WHERE merchant = $1 AND id = $2', [merchant, codeId, p.audience]);
  if (p.showInApp !== undefined) {
    const current = toShopApp(await ensureShopApp(q, merchant, staffId));
    const ids = current.offerCodeIds.filter((id) => id !== codeId);
    await patchShopApp(q, merchant, staffId, { offerCodeIds: p.showInApp ? [...ids, codeId] : ids });
  }
  return (await listDiscountCodes(q, merchant)).find((c) => c.id === codeId)!;
}
