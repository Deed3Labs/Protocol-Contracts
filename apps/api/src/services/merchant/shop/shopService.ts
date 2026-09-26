import { DEFAULT_SETTINGS, type Shop, ShopHours, ShopPatch, ShopSettings, ShopSettingsPatch } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { connectorStore } from '../cards/connectorStore.js';
import { markSetup } from '../setup/setupService.js';

/**
 * The shop and its settings (card-processing prompt, Phase 2 `merchant`; Phase 5: what the app
 * needs from the server). Everyone on shift reads them, because the counter's screens follow them:
 * which payment methods show, the tip presets, whether cards can be stored offline and up to what.
 * Only an owner changes them. The server enforces them (principle 7); the app only displays.
 */

export class ShopError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid',
  ) {
    super(message);
    this.name = 'ShopError';
  }
}

interface ProfileRow {
  merchant: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  address_country: string;
  timezone: string;
  currency: 'usd';
  card_plan: 'payg' | 'paid';
  card_plan_fee_cents: number | null;
  clear_tier: 'founding' | 'standard';
  paid_now_bps: number;
  over_time_bps: number;
  category: string | null;
  listing_line: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

export async function getShop(q: Queryable, merchant: string): Promise<Shop> {
  const { rows } = await q.query<ProfileRow>(
    `SELECT p.*, t.paid_now_bps, t.over_time_bps FROM merchant.profiles p
       JOIN merchant.clear_tiers t ON t.tier = p.clear_tier
      WHERE p.merchant = $1`,
    [merchant],
  );
  const p = rows[0];
  if (!p) throw new ShopError('No such shop', 'not_found');
  const complete = p.address_line1 && p.address_city && p.address_region && p.address_postal_code;
  return {
    id: p.merchant,
    name: p.name,
    address: complete
      ? { line1: p.address_line1!, line2: p.address_line2, city: p.address_city!, region: p.address_region!, postalCode: p.address_postal_code!, country: p.address_country }
      : null,
    timezone: p.timezone,
    currency: p.currency,
    cardPlan: p.card_plan === 'paid' ? { kind: 'paid', feeCents: Number(p.card_plan_fee_cents) } : { kind: 'payg' },
    clearTier: { tier: p.clear_tier, paidNowBps: Number(p.paid_now_bps), overTimeBps: Number(p.over_time_bps) },
    listing: { category: p.category, oneLine: p.listing_line, phone: p.contact_phone, email: p.contact_email },
  };
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the shop is, and its timezone. The address sets sales tax (Phase 6) and the card reader
 * location: when it changes and the shop already has a location on its processor account, the
 * location follows. The shop only takes US addresses for now (Clear's cards and tax are US).
 */
export async function updateShop(db: Db, provider: CardConnectorProvider | null, input: { merchant: string; patch: unknown }): Promise<Shop> {
  const parsed = ShopPatch.safeParse(input.patch);
  if (!parsed.success) throw new ShopError(parsed.error.issues[0]?.message ?? 'That isn’t a valid change to the shop', 'invalid');
  const { address, timezone, name, listing } = parsed.data;
  if (listing?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(listing.email)) throw new ShopError('That isn’t an email address', 'invalid');
  if (timezone !== undefined && !validTimezone(timezone)) throw new ShopError(`${timezone} isn’t a timezone`, 'invalid');
  if (address && address.country !== 'US') throw new ShopError('Clear shops are in the US for now', 'invalid');

  await db.query(
    `UPDATE merchant.profiles SET
        address_line1 = COALESCE($2, address_line1),
        address_line2 = CASE WHEN $2 IS NULL THEN address_line2 ELSE $3 END,
        address_city = COALESCE($4, address_city),
        address_region = COALESCE($5, address_region),
        address_postal_code = COALESCE($6, address_postal_code),
        address_country = COALESCE($7, address_country),
        timezone = COALESCE($8, timezone),
        name = COALESCE($9, name),
        category = CASE WHEN $10 THEN $11 ELSE category END,
        listing_line = CASE WHEN $12 THEN $13 ELSE listing_line END,
        contact_phone = CASE WHEN $14 THEN $15 ELSE contact_phone END,
        contact_email = CASE WHEN $16 THEN $17 ELSE contact_email END
      WHERE merchant = $1`,
    [
      input.merchant,
      address?.line1 ?? null,
      address?.line2 ?? null,
      address?.city ?? null,
      address?.region.toUpperCase() ?? null,
      address?.postalCode ?? null,
      address?.country ?? null,
      timezone ?? null,
      name ?? null,
      // A listing field is changed only when it's in the patch; null clears it.
      listing ? 'category' in listing : false,
      listing?.category || null,
      listing ? 'oneLine' in listing : false,
      listing?.oneLine || null,
      listing ? 'phone' in listing : false,
      listing?.phone || null,
      listing ? 'email' in listing : false,
      listing?.email?.toLowerCase() || null,
    ],
  );
  const shop = await getShop(db, input.merchant);

  if (address && provider) {
    const live = await connectorStore.live(db, input.merchant);
    if (live?.terminal_location_id) {
      // The processor's record of where the readers are. If this fails the shop's address is still
      // saved, and the next change tries again; card payments don't depend on it.
      await provider
        .updateLocation(live.external_account_id, live.terminal_location_id, { name: shop.name, address: shop.address! })
        .catch((error) => console.warn('Reader location update failed:', error instanceof Error ? error.message : error));
    }
  }
  return shop;
}

interface SettingsRow {
  accept_card: boolean;
  accept_cash: boolean;
  accept_split: boolean;
  tips_enabled: boolean;
  tips_mode: 'amounts' | 'percentages';
  tips_presets: number[];
  tips_go_to: 'raiser' | 'hours';
  starting_cash_cents: string | number;
  break_minutes: number;
  break_after_minutes: number;
  notify_end_of_day: boolean;
  notify_email: string | null;
  two_counts: boolean;
  one_person_close: 'owner_next_morning' | 'wait_for_second';
  offline_cards_enabled: boolean;
  offline_cards_limit_cents: string | number;
  prices_include_tax: boolean;
  discount_limit_counter: number;
  discount_limit_manager: number;
  discount_limit_owner: number | null;
  updated_at: Date | string;
}

const fromRow = (r: SettingsRow): ShopSettings => ({
  paymentMethods: { card: r.accept_card, cash: r.accept_cash, split: r.accept_split },
  tips: { enabled: r.tips_enabled, mode: r.tips_mode, presets: r.tips_presets.map(Number), goTo: r.tips_go_to },
  startingCashCents: Number(r.starting_cash_cents),
  breaks: { minutes: Number(r.break_minutes), afterMinutes: Number(r.break_after_minutes) },
  notifications: { endOfDay: r.notify_end_of_day ?? true, email: r.notify_email ?? null },
  twoCounts: r.two_counts,
  onePersonClose: r.one_person_close,
  offlineCards: { enabled: r.offline_cards_enabled, limitCents: Number(r.offline_cards_limit_cents) },
  tax: { pricesIncludeTax: r.prices_include_tax },
  discountLimits: { counter: r.discount_limit_counter, manager: r.discount_limit_manager, owner: r.discount_limit_owner },
  updatedAt: new Date(r.updated_at).toISOString(),
});

/** The shop's settings, or the defaults for a shop that's never changed them. */
export async function getSettings(q: Queryable, merchant: string): Promise<ShopSettings> {
  const { rows } = await q.query<SettingsRow>('SELECT * FROM merchant.shop_settings WHERE merchant = $1', [merchant]);
  if (rows[0]) return fromRow(rows[0]);
  const { rows: shop } = await q.query<{ created_at: Date | string }>('SELECT created_at FROM merchant.profiles WHERE merchant = $1', [merchant]);
  if (!shop[0]) throw new ShopError('No such shop', 'not_found');
  return { ...DEFAULT_SETTINGS, updatedAt: new Date(shop[0].created_at).toISOString() };
}

/** What the contract's shape can't say on its own. */
function rulesFor(s: Omit<ShopSettings, 'updatedAt'>): string | null {
  if (!s.paymentMethods.card && !s.paymentMethods.cash) return 'Keep at least one of card and cash on: Clear alone can’t pay for everything';
  if (s.tips.enabled && s.tips.presets.length === 0) return 'Tips need at least one preset';
  if (s.tips.mode === 'percentages' && s.tips.presets.some((p) => p > 100)) return 'A tip preset is at most 100%';
  if (new Set(s.tips.presets).size !== s.tips.presets.length) return 'Each tip preset once';
  if (s.discountLimits.counter > s.discountLimits.manager) return 'Counter staff can’t be allowed more off than managers';
  if (s.discountLimits.owner !== null && s.discountLimits.owner < s.discountLimits.manager) return 'Owners can’t be allowed less off than managers';
  return null;
}

/**
 * Owners only (checked by the route). A patch replaces whole groups (payment methods, tips …), then
 * the merged settings are checked as a whole, so a change that only makes sense alongside another
 * can't slip in half.
 */
export async function updateSettings(db: Db, input: { merchant: string; staffId: string; patch: unknown }): Promise<ShopSettings> {
  const parsed = ShopSettingsPatch.safeParse(input.patch);
  if (!parsed.success) throw new ShopError(parsed.error.issues[0]?.message ?? 'Those settings aren’t valid', 'invalid');
  const { updatedAt: _ignored, ...current } = await getSettings(db, input.merchant);
  const next = { ...current, ...parsed.data };
  const whole = ShopSettings.omit({ updatedAt: true }).safeParse(next);
  if (!whole.success) throw new ShopError(whole.error.issues[0]?.message ?? 'Those settings aren’t valid', 'invalid');
  const broken = rulesFor(whole.data);
  if (broken) throw new ShopError(broken, 'invalid');
  const s = whole.data;

  const { rows } = await db.query<SettingsRow>(
    `INSERT INTO merchant.shop_settings (merchant, accept_card, accept_cash, accept_split, tips_enabled, tips_mode, tips_presets, tips_go_to,
       starting_cash_cents, two_counts, one_person_close, offline_cards_enabled, offline_cards_limit_cents,
       discount_limit_counter, discount_limit_manager, discount_limit_owner, updated_by, prices_include_tax, break_minutes, break_after_minutes, notify_end_of_day, notify_email, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, now())
     ON CONFLICT (merchant) DO UPDATE SET
       accept_card = EXCLUDED.accept_card, accept_cash = EXCLUDED.accept_cash, accept_split = EXCLUDED.accept_split,
       tips_enabled = EXCLUDED.tips_enabled, tips_mode = EXCLUDED.tips_mode, tips_presets = EXCLUDED.tips_presets, tips_go_to = EXCLUDED.tips_go_to,
       starting_cash_cents = EXCLUDED.starting_cash_cents, two_counts = EXCLUDED.two_counts, one_person_close = EXCLUDED.one_person_close,
       offline_cards_enabled = EXCLUDED.offline_cards_enabled, offline_cards_limit_cents = EXCLUDED.offline_cards_limit_cents,
       discount_limit_counter = EXCLUDED.discount_limit_counter, discount_limit_manager = EXCLUDED.discount_limit_manager,
       discount_limit_owner = EXCLUDED.discount_limit_owner, updated_by = EXCLUDED.updated_by,
       prices_include_tax = EXCLUDED.prices_include_tax, break_minutes = EXCLUDED.break_minutes,
       break_after_minutes = EXCLUDED.break_after_minutes, notify_end_of_day = EXCLUDED.notify_end_of_day,
       notify_email = EXCLUDED.notify_email, updated_at = now()
     RETURNING *`,
    [
      input.merchant,
      s.paymentMethods.card,
      s.paymentMethods.cash,
      s.paymentMethods.split,
      s.tips.enabled,
      s.tips.mode,
      s.tips.presets,
      s.tips.goTo,
      s.startingCashCents,
      s.twoCounts,
      s.onePersonClose,
      s.offlineCards.enabled,
      s.offlineCards.limitCents,
      s.discountLimits.counter,
      s.discountLimits.manager,
      s.discountLimits.owner,
      input.staffId,
      s.tax.pricesIncludeTax,
      s.breaks.minutes,
      s.breaks.afterMinutes,
      s.notifications.endOfDay,
      s.notifications.email,
    ],
  );
  // Set up the till: starting cash, and tips and discounts, count as done once saved.
  if (parsed.data.startingCashCents !== undefined) await markSetup(db, input.merchant, 'cash');
  if (parsed.data.tips !== undefined || parsed.data.discountLimits !== undefined) await markSetup(db, input.merchant, 'tips');
  return fromRow(rows[0]!);
}

// ---- Hours ----------------------------------------------------------------------------------------

const hhmm = (t: string) => t.slice(0, 5);
const isoDay = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);

/** The shop's week (Monday first; a day with no row is closed) and the dates that differ, from today on. */
export async function getHours(q: Queryable, merchant: string): Promise<ShopHours> {
  const { rows: week } = await q.query<{ weekday: number; opens: string; closes: string }>(
    'SELECT weekday, opens::text, closes::text FROM merchant.shop_hours WHERE merchant = $1',
    [merchant],
  );
  const { rows: dates } = await q.query<{ on_date: Date | string; label: string; opens: string | null; closes: string | null }>(
    'SELECT on_date, label, opens::text, closes::text FROM merchant.shop_closures WHERE merchant = $1 AND on_date >= CURRENT_DATE - 1 ORDER BY on_date',
    [merchant],
  );
  return {
    week: Array.from({ length: 7 }, (_, day) => {
      const r = week.find((w) => Number(w.weekday) === day);
      return { day, open: r ? { from: hhmm(r.opens), to: hhmm(r.closes) } : null };
    }),
    dates: dates.map((d) => ({ date: isoDay(d.on_date), label: d.label, open: d.opens && d.closes ? { from: hhmm(d.opens), to: hhmm(d.closes) } : null })),
  };
}

/** Owners only (checked by the route): the whole week and the dates, replaced together. */
export async function saveHours(db: Db, input: { merchant: string; hours: unknown }): Promise<ShopHours> {
  const parsed = ShopHours.safeParse(input.hours);
  if (!parsed.success) throw new ShopError(parsed.error.issues[0]?.message ?? 'Those hours aren’t valid', 'invalid');
  const h = parsed.data;
  if (new Set(h.week.map((w) => w.day)).size !== 7) throw new ShopError('One row for each day of the week', 'invalid');
  if (new Set(h.dates.map((d) => d.date)).size !== h.dates.length) throw new ShopError('Each date once', 'invalid');
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM merchant.shop_hours WHERE merchant = $1', [input.merchant]);
    for (const w of h.week) {
      if (w.open) await tx.query('INSERT INTO merchant.shop_hours (merchant, weekday, opens, closes) VALUES ($1,$2,$3,$4)', [input.merchant, w.day, w.open.from, w.open.to]);
    }
    await tx.query('DELETE FROM merchant.shop_closures WHERE merchant = $1', [input.merchant]);
    for (const d of h.dates) {
      await tx.query('INSERT INTO merchant.shop_closures (merchant, on_date, label, opens, closes) VALUES ($1,$2,$3,$4,$5)', [input.merchant, d.date, d.label, d.open?.from ?? null, d.open?.to ?? null]);
    }
  });
  return getHours(db, input.merchant);
}
