import Stripe from 'stripe';
import type { HardwareOrder, HardwareOrderLine, HardwareOrders, HardwareOrderStatus } from '@clear/merchant-contracts';

/**
 * Settings › Devices › On order: the hardware a shop reserved on useclear.org.
 *
 * The site (Deed3Labs/clearpath-website) takes the deposit through ITS Stripe account and keeps the
 * reservation on that PaymentIntent's metadata until this API holds reservations itself:
 *   kind = "reservation", shop_id = the shop (its org wallet address, as the shop token's `sub`),
 *   r1 = "slug/variant/qty/price/deposit/ships", s1 = the line's status (see below).
 * So this reads that Stripe account, with SHOP_STRIPE_SECRET_KEY (the site's STRIPE_SECRET_KEY). The
 * site's owner scripts (scripts/shop) move the statuses:
 *   reserved · building:<start date> · shipped:<date>:<pi> · awaiting-payment:<date>:<invoice> ·
 *   refunded:<date>:<refund>
 *
 * Cancel keeps the site's promise ("Refundable in full until we start building yours. We email you
 * before we do."): a reserved line, or one building whose start date is still ahead, is refunded in
 * full. The refund's idempotency key is the one the site's refund-deposit script uses for the same
 * line, so the two can never refund it twice.
 */

/** The slice of Stripe this needs, so tests can stand in for it. */
export interface ShopStripe {
  paymentIntents: {
    search(params: { query: string; limit?: number; page?: string }): Promise<{ data: Stripe.PaymentIntent[]; has_more: boolean; next_page?: string | null }>;
    retrieve(id: string): Promise<Stripe.PaymentIntent>;
    update(id: string, params: { metadata: Record<string, string> }): Promise<Stripe.PaymentIntent>;
  };
  refunds: {
    create(params: { payment_intent: string; amount: number; metadata?: Record<string, string> }, opts?: { idempotencyKey?: string }): Promise<{ id: string }>;
  };
}

export class HardwareOrderError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'locked',
    readonly status: number,
  ) {
    super(message);
  }
}

let cached: Stripe | null = null;
/** The site's Stripe, or null until its key is set here. */
export function shopStripe(env = process.env): ShopStripe | null {
  const key = env.SHOP_STRIPE_SECRET_KEY;
  if (!key) return null;
  cached ??= new Stripe(key);
  return cached;
}

/**
 * The hardware the site sells, by slug and variant, for the line's name. Mirrors the site's catalog
 * (clearpath-website content/shop.ts); a slug this doesn't know still shows, by its slug.
 */
const NAMES: Record<string, { name: string; variants?: Record<string, string> }> = {
  'clear-point': { name: 'Clear Point', variants: { table: 'Table', counter: 'Counter', ten: 'Ten for tables' } },
  'clear-tap': { name: 'Clear Tap', variants: { dock: 'Dock only', m2: 'With an M2' } },
  'clear-counter': { name: 'Clear Counter', variants: { '8': '8-inch', '10': '10-inch' } },
  'clear-drawer': { name: 'Clear Drawer' },
  'label-printer': { name: 'Label printer' },
  'pay-case': { name: 'Point Pay case', variants: { table: 'Table', large: 'Counter' } },
  'tap-phone': { name: 'Clear Tap Phone' },
  'clear-stand': { name: 'Clear Stand' },
  'drawer-panels': {
    name: 'Drawer panels',
    variants: { paper: 'Face · Paper or Cobalt', walnut: 'Face · Walnut', logo: 'Face · your logo', mount: 'Top · Mount', wood: 'Top · Walnut or cork', insert: 'Insert · wider slots', lid: 'Locking lid' },
  },
  'full-counter': { name: 'Full counter' },
};

export function nameOf(slug: string, variant: string): string {
  const p = NAMES[slug];
  if (!p) return `${slug} (${variant})`;
  const v = p.variants?.[variant];
  return v ? `${p.name}, ${v}` : p.name;
}

const STATUSES: readonly HardwareOrderStatus[] = ['reserved', 'building', 'shipped', 'awaiting-payment', 'refunded'];

/** One line out of the metadata, or null when it doesn't parse (skipped, never guessed at). */
export function lineOf(meta: Record<string, string>, n: number, today: string): HardwareOrderLine | null {
  const raw = meta[`r${n}`];
  if (!raw) return null;
  const [slug, variant, qty, unit, dep, ...ships] = raw.split('/');
  const q = Number(qty), u = Number(unit), d = Number(dep);
  if (!slug || !variant || !Number.isInteger(q) || q < 1 || !Number.isInteger(u) || !Number.isInteger(d) || d > u) return null;
  const [s, date] = (meta[`s${n}`] ?? 'reserved').split(':');
  const status = STATUSES.includes(s as HardwareOrderStatus) ? (s as HardwareOrderStatus) : 'reserved';
  const startsOn = status === 'building' && date ? date : null;
  return {
    n,
    slug,
    variant,
    name: nameOf(slug, variant),
    qty: q,
    depositCents: d * q,
    balanceCents: (u - d) * q,
    ships: ships.join('/'),
    status,
    startsOn,
    cancellable: status === 'reserved' || (status === 'building' && !!startsOn && startsOn > today),
  };
}

export function orderOf(pi: Stripe.PaymentIntent, today: string): HardwareOrder {
  const lines: HardwareOrderLine[] = [];
  for (let n = 1; pi.metadata[`r${n}`]; n++) {
    const l = lineOf(pi.metadata, n, today);
    if (l) lines.push(l);
  }
  return { id: pi.id, placedAt: new Date(pi.created * 1000).toISOString(), lines };
}

const isShop = (merchant: string) => /^0x[0-9a-f]{40}$/.test(merchant);
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** This shop's reservations, newest first. Paid ones only (the site's webhook stamps reserved_at). */
export async function hardwareOrders(stripe: ShopStripe | null, merchant: string, today = todayIso()): Promise<HardwareOrders> {
  const m = merchant.toLowerCase();
  if (!stripe || !isShop(m)) return { configured: !!stripe, orders: [] };
  const found: Stripe.PaymentIntent[] = [];
  let page: string | undefined;
  do {
    const res = await stripe.paymentIntents.search({
      query: `metadata['kind']:'reservation' AND metadata['shop_id']:'${m}' AND status:'succeeded'`,
      limit: 100,
      ...(page ? { page } : {}),
    });
    found.push(...res.data);
    page = res.has_more ? res.next_page ?? undefined : undefined;
  } while (page);
  return {
    configured: true,
    orders: found
      .filter((pi) => pi.metadata.shop_id === m && pi.metadata.reserved_at)
      .sort((a, b) => b.created - a.created)
      .map((pi) => orderOf(pi, today)),
  };
}

/** Cancel one line and refund its deposit in full, if building hasn't started. */
export async function cancelHardwareLine(stripe: ShopStripe, merchant: string, orderId: string, n: number, today = todayIso()): Promise<void> {
  const m = merchant.toLowerCase();
  if (!/^pi_[A-Za-z0-9]+$/.test(orderId)) throw new HardwareOrderError('No such order.', 'not_found', 404);
  const pi = await stripe.paymentIntents.retrieve(orderId).catch(() => null);
  // Another shop's order is not found, not forbidden: it says nothing about whether it exists.
  if (!pi || pi.metadata.kind !== 'reservation' || pi.metadata.shop_id !== m || pi.status !== 'succeeded') throw new HardwareOrderError('No such order.', 'not_found', 404);
  const line = lineOf(pi.metadata, n, today);
  if (!line) throw new HardwareOrderError('No such line on that order.', 'not_found', 404);
  if (!line.cancellable) {
    throw new HardwareOrderError(
      line.status === 'building'
        ? 'Building has started, so this one can’t be cancelled here. Reply to our email, or write to support@useclear.org.'
        : `This one is ${line.status === 'awaiting-payment' ? 'waiting on its invoice' : line.status} already.`,
      'locked',
      409,
    );
  }
  const refund = await stripe.refunds.create(
    { payment_intent: pi.id, amount: line.depositCents, metadata: { reason: 'cancelled in the merchant app', lines: String(n) } },
    { idempotencyKey: `refund-${pi.id}-${n}` },
  );
  await stripe.paymentIntents.update(pi.id, { metadata: { [`s${n}`]: `refunded:${today}:${refund.id}` } });
}
