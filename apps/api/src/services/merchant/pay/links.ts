import { randomBytes, randomUUID } from 'node:crypto';
import { contrastRatio, CreatePaymentLink, type MerchantPaymentLink, type PayOrder, type PayShop, type PublicLink } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { cardAvailability } from '../cards/availability.js';
import { connectorStore } from '../cards/connectorStore.js';
import { type OrderDeps, OrderError, quoteLines } from '../orders/orderService.js';
import { audit } from '../security/audit.js';
import { getSettings } from '../shop/shopService.js';

/**
 * Payment links (pay spec §5): a stored payment the shop texts, emails or prints, opened at
 * `pay.useclear.org/l/:slug` with no code from anyone. An amount (what the customer pays, no tax
 * added) or an Inventory item and a quantity (priced and taxed as the counter would, when it's paid).
 * Each payment makes a new order, `source: 'link'`, with nobody at the shop behind it.
 */

export class PayError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_found' | 'expired' | 'inactive' | 'conflict' | 'unavailable' | 'forbidden' | 'too_many',
  ) {
    super(message);
    this.name = 'PayError';
  }
}

export const PAY_STATUS: Record<PayError['code'], number> = { invalid: 422, not_found: 404, expired: 410, inactive: 410, conflict: 409, unavailable: 409, forbidden: 403, too_many: 429 };

/** Where the link pages and the modal live. */
export const payBase = () => (process.env.PAY_BASE_URL || 'https://pay.useclear.org').replace(/\/+$/, '');

const EXPIRY_DAYS = { never: null, '7d': 7, '30d': 30 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LinkRow {
  id: string;
  merchant: string;
  slug: string;
  livemode: boolean;
  amount_cents: string | number | null;
  item_id: string | null;
  quantity: number | null;
  note: string | null;
  expires_at: Date | string | null;
  allow_over_time: boolean;
  created_by: string | null;
  created_at: Date | string;
  deactivated_at: Date | string | null;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

// ---- Slugs ---------------------------------------------------------------------------------------

/** Lower-case letters and digits a person can read back: no 0/o, 1/l/i. */
const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function suffix(n = 6): string {
  const bytes = randomBytes(n);
  return [...bytes].map((b) => SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length]).join('');
}

/**
 * The shop's part of a link's address: its rewards app's slug where it has one, else its everyday name
 * squashed ("Mi Casa Tacos" → "micasa", as rewards derives "Mi Casa").
 */
export async function shopSlugBase(q: Queryable, merchant: string): Promise<string> {
  const { rows: app } = await q.query<{ slug: string }>('SELECT slug FROM rewards.shop_apps WHERE merchant = $1', [merchant]);
  if (app[0]) return app[0].slug.slice(0, 24).replace(/-+$/, '');
  const { rows } = await q.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [merchant]);
  const words = (rows[0]?.name ?? '').trim().split(/\s+/).filter(Boolean);
  const everyday = words.length >= 3 ? words.slice(0, -1) : words;
  const base = everyday.join('').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 24);
  return base.length >= 2 ? base : 'shop';
}

// ---- The shop and the order, as the pages show them -------------------------------------------------

/** "MC" for Mi Casa Tacos: the header's mark when the shop has no logo. */
export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Clear's paper: a shop's colour has to stand out on it to be used (rewards' 3:1, `brandContrast`). */
const CLEAR_PAPER = '#DFE3DE';

/**
 * The shop as Clear's pages show it: its name, its logo, and its colour as the accent where it has a
 * shop app and the colour reads on Clear's paper. Everything else on the page is Clear's, so a fake is
 * easier to spot (pay DECISIONS, Phase 3).
 */
export async function payShop(q: Queryable, merchant: string): Promise<PayShop> {
  type Brand = { logoUrl?: string | null; colour?: string };
  const { rows } = await q.query<{ name: string; enabled: boolean | null; brand: Brand | string | null }>(
    `SELECT p.name, a.enabled, a.brand FROM merchant.profiles p LEFT JOIN rewards.shop_apps a ON a.merchant = p.merchant WHERE p.merchant = $1`,
    [merchant],
  );
  const r = rows[0];
  if (!r) throw new PayError('No such shop', 'not_found');
  const brand: Brand | null = r.enabled ? (typeof r.brand === 'string' ? (JSON.parse(r.brand) as Brand) : r.brand) : null;
  const logo = brand?.logoUrl && /^https:\/\//.test(brand.logoUrl) ? brand.logoUrl : null;
  const colour = brand?.colour && /^#[0-9A-Fa-f]{6}$/.test(brand.colour) && contrastRatio(brand.colour, CLEAR_PAPER) >= 3 ? brand.colour : null;
  return { name: r.name, initials: initialsOf(r.name), logoUrl: logo, accent: colour };
}

/** "Taco tray for 12, 2 × Agua fresca, gallon": the member screen's one line. */
export const orderSummary = (lines: Array<{ name: string; quantity: number }>) =>
  lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name)).join(', ');

/** An amount link's one line: a quick sale, exempt, so its amount is what the customer pays. */
export function linkLines(link: Pick<LinkRow, 'amount_cents' | 'item_id' | 'quantity'>): unknown[] {
  return link.item_id
    ? [{ itemId: link.item_id, quantity: link.quantity ?? 1, optionIds: [] }]
    : [{ itemId: null, name: 'Payment', note: null, amountCents: Number(link.amount_cents), taxKind: 'exempt' }];
}

/** What paying this link comes to now: the item's price and the shop's tax, or the amount. */
export async function linkQuote(db: Db, deps: OrderDeps, link: LinkRow): Promise<PayOrder> {
  const q = await quoteLines(db, deps, link.merchant, linkLines(link)).catch((error) => {
    if (error instanceof OrderError) throw new PayError('This link’s item isn’t for sale any more', 'inactive');
    throw error;
  });
  const lines = q.lines.map((l) => ({ name: l.name, quantity: l.quantity, lineCents: l.lineCents }));
  return { lines, subtotalCents: q.subtotal, taxCents: q.tax, totalCents: q.total, summary: orderSummary(lines) };
}

/** Whether the shop takes card here: its processor connected and card on in Settings. */
export async function cardsOn(q: Queryable, merchant: string): Promise<boolean> {
  const settings = await getSettings(q, merchant);
  return cardAvailability(await connectorStore.latest(q, merchant)).available && settings.paymentMethods.card;
}

export function linkState(link: Pick<LinkRow, 'deactivated_at' | 'expires_at'>, now: Date): PublicLink['state'] {
  if (link.deactivated_at) return 'inactive';
  if (link.expires_at && new Date(link.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'open';
}

// ---- The merchant app ------------------------------------------------------------------------------

async function toMerchantLink(db: Db, deps: OrderDeps, row: LinkRow): Promise<MerchantPaymentLink> {
  let name = 'Payment';
  let totalCents = Number(row.amount_cents ?? 0);
  if (row.item_id) {
    const { rows } = await db.query<{ name: string }>('SELECT name FROM commerce.catalog_items WHERE id = $1', [row.item_id]);
    name = rows[0]?.name ?? 'An item';
    totalCents = await linkQuote(db, deps, row).then((q) => q.totalCents, () => 0);
  }
  return {
    id: row.id,
    livemode: row.livemode,
    slug: row.slug,
    url: `${payBase()}/l/${row.slug}`,
    name,
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    itemId: row.item_id,
    quantity: row.quantity,
    // An item that's since been archived reads $0.00; the link page refuses it.
    totalCents: Math.max(totalCents, 1),
    note: row.note,
    expiresAt: iso(row.expires_at),
    allowOverTime: row.allow_over_time,
    active: !row.deactivated_at,
    createdAt: iso(row.created_at)!,
    createdBy: row.created_by,
  };
}

/** What a link is for, from the merchant app or the public API. */
export interface LinkSpec {
  merchant: string;
  /** Staff, or null when the public API made it. */
  staffId: string | null;
  livemode: boolean;
  what: { amountCents: number } | { itemId: string; quantity: number };
  note: string | null;
  expiresAt: Date | null;
  allowOverTime: boolean;
  now?: Date;
}

/** Makes a link: its item checked (on sale, nothing to choose), and an address nobody has. */
export async function makeLink(db: Db, spec: LinkSpec): Promise<LinkRow> {
  if ('itemId' in spec.what) {
    const { rows } = await db.query<{ archived_at: unknown }>('SELECT archived_at FROM commerce.catalog_items WHERE id = $1 AND merchant = $2', [spec.what.itemId, spec.merchant]);
    if (!rows[0] || rows[0].archived_at) throw new PayError('That item isn’t for sale', 'invalid');
    const { rows: required } = await db.query('SELECT 1 FROM commerce.option_groups WHERE item_id = $1 AND required LIMIT 1', [spec.what.itemId]);
    if (required[0]) throw new PayError('An item with options to choose can’t be a link yet. Use an amount.', 'invalid');
  }
  const base = await shopSlugBase(db, spec.merchant);
  const id = `plink_${randomUUID().replace(/-/g, '')}`;
  const amount = 'amountCents' in spec.what ? spec.what.amountCents : null;
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { rows } = await tx.query<LinkRow>(
        `INSERT INTO payments.payment_links (id, merchant, slug, livemode, amount_cents, item_id, quantity, note, expires_at, allow_over_time, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (slug) DO NOTHING RETURNING *`,
        [
          id,
          spec.merchant,
          `${base}-${suffix()}`,
          spec.livemode,
          amount,
          'itemId' in spec.what ? spec.what.itemId : null,
          'itemId' in spec.what ? spec.what.quantity : null,
          spec.note,
          spec.expiresAt,
          spec.allowOverTime,
          spec.staffId,
          spec.now ?? new Date(),
        ],
      );
      if (rows[0]) {
        await audit(tx, { merchant: spec.merchant, actor: spec.staffId, action: 'payment_link.created', ref: { type: 'payment_link', id }, amountCents: amount, detail: { slug: rows[0].slug }, source: spec.staffId ? null : 'online' });
        return rows[0];
      }
    }
    throw new Error('Couldn’t find a free address for the link');
  });
}

/** New charge › Send a link. Owners and managers. */
export async function createPaymentLink(
  db: Db,
  deps: OrderDeps,
  input: { merchant: string; staffId: string; request: unknown; now?: Date },
): Promise<MerchantPaymentLink> {
  const parsed = CreatePaymentLink.safeParse(input.request);
  if (!parsed.success) throw new PayError(parsed.error.issues[0]?.message ?? 'That link isn’t valid', 'invalid');
  const r = parsed.data;
  const now = input.now ?? new Date();
  const days = EXPIRY_DAYS[r.expires];
  const row = await makeLink(db, {
    merchant: input.merchant,
    staffId: input.staffId,
    livemode: true,
    what: r.for === 'item' ? { itemId: r.itemId, quantity: r.quantity } : { amountCents: r.amountCents },
    note: r.note,
    expiresAt: days === null ? null : new Date(now.getTime() + days * DAY_MS),
    allowOverTime: r.allowOverTime,
    now,
  });
  return toMerchantLink(db, deps, row);
}

export async function listPaymentLinks(db: Db, deps: OrderDeps, merchant: string): Promise<MerchantPaymentLink[]> {
  const { rows } = await db.query<LinkRow>('SELECT * FROM payments.payment_links WHERE merchant = $1 ORDER BY created_at DESC LIMIT 200', [merchant]);
  const out: MerchantPaymentLink[] = [];
  for (const r of rows) out.push(await toMerchantLink(db, deps, r));
  return out;
}

/** Turns a link off for good: it says so to anyone who opens it, and takes no more payments. */
export async function deactivatePaymentLink(db: Db, deps: OrderDeps, input: { merchant: string; staffId: string; id: string }): Promise<MerchantPaymentLink> {
  const row = await db.transaction(async (tx) => {
    const { rows } = await tx.query<LinkRow>(
      `UPDATE payments.payment_links SET deactivated_at = COALESCE(deactivated_at, now()), deactivated_by = COALESCE(deactivated_by, $3)
        WHERE id = $1 AND merchant = $2 RETURNING *`,
      [input.id, input.merchant, input.staffId],
    );
    if (!rows[0]) throw new PayError('No such link', 'not_found');
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'payment_link.deactivated', ref: { type: 'payment_link', id: input.id }, detail: { slug: rows[0].slug } });
    return rows[0];
  });
  return toMerchantLink(db, deps, row);
}

// ---- The link page ---------------------------------------------------------------------------------

export async function linkBySlug(q: Queryable, slug: string): Promise<LinkRow | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug)) return null;
  const { rows } = await q.query<LinkRow>('SELECT * FROM payments.payment_links WHERE slug = $1', [slug]);
  return rows[0] ?? null;
}

/** `GET /api/l/:slug`: the shop, what it comes to with tax, the note and the expiry. No sign-in. */
export async function publicLink(db: Db, deps: OrderDeps, slug: string, now = new Date()): Promise<PublicLink> {
  const link = await linkBySlug(db, slug);
  if (!link) throw new PayError('There’s no payment at this address', 'not_found');
  const state = linkState(link, now);
  const shop = await payShop(db, link.merchant);
  // Priced even when expired, so the page can say what it was for.
  const order = await linkQuote(db, deps, link).catch((error) => {
    if (error instanceof PayError) return null;
    throw error;
  });
  return {
    slug: link.slug,
    shop,
    // A link that can't be priced any more (its item archived) reads as inactive, with no lines;
    // the contract's total must be positive, and the page shows no figure for an inactive link.
    order: order ?? { lines: [], subtotalCents: 0, taxCents: 0, totalCents: 1, summary: '' },
    note: link.note,
    expiresAt: iso(link.expires_at),
    state: order ? state : state === 'open' ? 'inactive' : state,
    methods: { clear: true, card: await cardsOn(db, link.merchant) },
  };
}
