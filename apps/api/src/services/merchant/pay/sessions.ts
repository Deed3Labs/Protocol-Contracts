import { randomUUID } from 'node:crypto';
import { PAY_OVER_TIME_MIN_CENTS } from '@clear/domain';
import { contrastRatio, PublicPay, type PaySession, type PublicPayStarted } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { memberAppUrl } from '../../memberAppUrl.js';
import { createCheckoutTender } from '../cards/cardTenders.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { createOrder, getOrder, type OrderDeps, OrderError, quoteLines } from '../orders/orderService.js';
import { type ClearCharges, createClearTender, discardOrder } from '../orders/payments.js';
import { touchShop } from '../terminal/bus.js';
import { cardsOn, type LinkRow, linkBySlug, linkLines, linkQuote, linkState, orderSummary, payBase, PayError, payShop } from './links.js';
import { testClearCharges } from './testMode.js';
import { itemForPrice } from './v1.js';
import { insertApiPayment, paymentForOrder } from './events.js';
import { overTimeOnline } from './overTime.js';

/**
 * A payment-scoped session: one payment, from one link (Phase 3) or one website (Phase 5). The link
 * page starts one when someone taps a way to pay, which makes the link's order; the page then follows
 * the session until it's paid. Paying goes the phone pay page's way: Clear raises the counter's own
 * Clear tender, which the Clear app opens; card is a checkout on the shop's own processor.
 */

/** A link's session lasts as long as its Clear charge can wait for an answer. */
export const LINK_SESSION_MS = 24 * 60 * 60 * 1000;

export interface PaySessionDeps {
  orders: OrderDeps;
  clear: ClearCharges;
  /** The shop's card processor, when it takes cards. */
  card: (merchant: string) => Promise<CardConnectorProvider | null>;
}

export interface SessionRow {
  id: string;
  merchant: string;
  livemode: boolean;
  kind: 'modal' | 'link';
  order_id: string | null;
  link_id: string | null;
  origin: string | null;
  options: ModalOptions | string;
  approval_id: string | null;
  expires_at: Date | string;
}

/** What a modal session was made with (`POST /v1/modal_sessions`). */
export interface ModalOptions {
  price?: string;
  quantity?: number;
  accent?: string;
  logo?: string;
  locale?: string;
  email?: string;
  methods?: Array<'clear' | 'card'>;
}

const SESSION_ID = /^(ps|ms)_[0-9a-f]{32}$/;
export const optionsOf = (s: Pick<SessionRow, 'options'>): ModalOptions => (typeof s.options === 'string' ? (JSON.parse(s.options) as ModalOptions) : s.options) ?? {};

async function openLink(db: Db, slug: string, now: Date): Promise<LinkRow> {
  const link = await linkBySlug(db, slug);
  if (!link) throw new PayError('There’s no payment at this address', 'not_found');
  const state = linkState(link, now);
  if (state === 'expired') throw new PayError('This link has expired', 'expired');
  if (state === 'inactive') throw new PayError('This link has been turned off', 'inactive');
  return link;
}

/**
 * `POST /api/l/:slug/session`: makes the link's order, priced and taxed here from the link alone (an
 * amount, or its item and quantity), and the session that follows it. Nothing in the request is used.
 */
export async function startLinkSession(db: Db, deps: PaySessionDeps, input: { slug: string; now?: Date }): Promise<{ session: string }> {
  const now = input.now ?? new Date();
  const link = await openLink(db, input.slug, now);
  await linkQuote(db, deps.orders, link);
  const order = await createOrder(db, deps.orders, {
    merchant: link.merchant,
    staffId: null,
    lines: linkLines(link),
    customer: null,
    now,
    online: { source: 'link', detail: link.slug, livemode: link.livemode },
  }).catch((error) => {
    if (error instanceof OrderError) throw new PayError(error.code === 'out_of_stock' ? error.message : 'This link can’t be paid right now', 'unavailable');
    throw error;
  });
  const id = `ps_${randomUUID().replace(/-/g, '')}`;
  const card = await cardsOn(db, link.merchant);
  await db.transaction(async (tx) => {
    // A link's sale is a payment too: listed and retrievable through the API, and in its webhooks.
    await insertApiPayment(tx, { merchant: link.merchant, orderId: order.id, livemode: link.livemode, via: 'link', methods: card ? ['clear', 'card'] : ['clear'], now });
    await tx.query(
      `INSERT INTO payments.pay_sessions (id, merchant, livemode, kind, order_id, link_id, created_at, expires_at) VALUES ($1,$2,$3,'link',$4,$5,$6,$7)`,
      [id, link.merchant, link.livemode, order.id, link.id, now, new Date(now.getTime() + LINK_SESSION_MS)],
    );
  });
  return { session: id };
}

export async function sessionRow(db: Db, id: string): Promise<SessionRow> {
  if (!SESSION_ID.test(id)) throw new PayError('This payment has ended', 'not_found');
  const { rows } = await db.query<SessionRow>('SELECT * FROM payments.pay_sessions WHERE id = $1', [id]);
  if (!rows[0]) throw new PayError('This payment has ended', 'not_found');
  return rows[0];
}

async function linkOf(db: Db, s: SessionRow): Promise<LinkRow | null> {
  if (!s.link_id) return null;
  const { rows } = await db.query<LinkRow>('SELECT * FROM payments.payment_links WHERE id = $1', [s.link_id]);
  return rows[0] ?? null;
}

/** The lines a modal session for a price sells: its item and quantity. */
async function priceLines(db: Db, s: SessionRow): Promise<unknown[]> {
  const o = optionsOf(s);
  if (!o.price) throw new PayError('This payment has ended', 'not_found');
  const { itemId } = await itemForPrice(db, s.merchant, o.price).catch(() => {
    throw new PayError('This item isn’t for sale right now', 'unavailable');
  });
  return [{ itemId, quantity: o.quantity ?? 1, optionIds: [] }];
}

/**
 * The session's order, made the first time the customer acts on a price's modal (so a click that never
 * pays makes no order and holds no stock). A link's and a payment's already have theirs.
 */
export async function ensureSessionOrder(db: Db, deps: PaySessionDeps, s: SessionRow, now = new Date()): Promise<string> {
  if (s.order_id) return s.order_id;
  const order = await createOrder(db, deps.orders, {
    merchant: s.merchant,
    staffId: null,
    lines: await priceLines(db, s),
    customer: null,
    now,
    online: { source: 'online', detail: s.origin, livemode: s.livemode },
  }).catch((error) => {
    if (error instanceof OrderError) throw new PayError(error.code === 'out_of_stock' ? error.message : 'This can’t be paid right now', 'unavailable');
    throw error;
  });
  const methods = optionsOf(s).methods ?? ['clear'];
  const won = await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>('UPDATE payments.pay_sessions SET order_id = $2 WHERE id = $1 AND order_id IS NULL RETURNING id', [s.id, order.id]);
    if (!rows[0]) return false;
    await insertApiPayment(tx, { merchant: s.merchant, orderId: order.id, livemode: s.livemode, via: 'modal', methods, now });
    return true;
  });
  if (!won) {
    // Two taps at once: the first order stands, this one goes.
    await discardOrder(db, { merchant: s.merchant, orderId: order.id, staffId: null }).catch(() => undefined);
    return (await sessionRow(db, s.id)).order_id!;
  }
  s.order_id = order.id;
  return order.id;
}

/** The Clear side for this session: Clear's, or test mode's own, which never touches the chain. */
export const clearFor = (db: Db, deps: PaySessionDeps, s: Pick<SessionRow, 'livemode'>): ClearCharges => (s.livemode ? deps.clear : testClearCharges(db));

/** A modal's accent: the shop's colour, when it reads on Clear's paper (3:1); else Clear's ink. */
const accentOf = (hex: string | undefined) => (hex && /^#[0-9A-Fa-f]{6}$/.test(hex) && contrastRatio(hex, '#DFE3DE') >= 3 ? hex : null);

/** `GET /api/checkout/:session`: what the page shows, from the order as it stands. Polled while it waits. */
export async function paySessionView(db: Db, deps: PaySessionDeps, input: { session: string; now?: Date }): Promise<PaySession> {
  const now = input.now ?? new Date();
  const s = await sessionRow(db, input.session);
  const link = await linkOf(db, s);
  const o = optionsOf(s);
  let order: PaySession['order'];
  let status: string = 'open';
  if (s.order_id) {
    const row = await getOrder(db, s.merchant, s.order_id);
    status = row.status;
    const lines = row.lines.map((l) => ({ name: l.name, quantity: l.quantity, lineCents: l.lineCents }));
    order = { lines, subtotalCents: row.subtotalCents, taxCents: row.taxCents, totalCents: row.totalCents, summary: orderSummary(lines) };
  } else {
    const q = await quoteLines(db, deps.orders, s.merchant, await priceLines(db, s));
    const lines = q.lines.map((l) => ({ name: l.name, quantity: l.quantity, lineCents: l.lineCents }));
    order = { lines, subtotalCents: q.subtotal, taxCents: q.tax, totalCents: q.total, summary: orderSummary(lines) };
  }
  const paid = status === 'paid' || status === 'partly_refunded' || status === 'refunded';
  const ended = new Date(s.expires_at).getTime() <= now.getTime() || (link !== null && linkState(link, now) !== 'open');
  const state: PaySession['state'] = paid ? 'paid' : status === 'voided' ? 'canceled' : ended ? 'expired' : 'open';
  const card = await cardsOn(db, s.merchant);
  const methods = s.kind === 'modal' ? { clear: (o.methods ?? ['clear']).includes('clear'), card: card && (o.methods ?? []).includes('card') } : { clear: true, card };
  const shop = await payShop(db, s.merchant);
  const allowsOverTime = s.kind === 'link' ? Boolean(link?.allow_over_time) : methods.clear;
  return {
    id: s.id,
    livemode: s.livemode,
    shop: s.kind === 'modal' ? { ...shop, accent: accentOf(o.accent) ?? shop.accent, logoUrl: o.logo ?? shop.logoUrl } : shop,
    order,
    methods,
    overTime: allowsOverTime && overTimeOnline(s.livemode) && order.totalCents >= PAY_OVER_TIME_MIN_CENTS,
    shopHost: s.origin ? new URL(s.origin).host : null,
    link: link ? { note: link.note, expiresAt: link.expires_at ? new Date(link.expires_at).toISOString() : null } : null,
    state,
    expiresAt: new Date(s.expires_at).toISOString(),
    payment: s.order_id ? await paymentForOrder(db, s.order_id).then((p) => (p ? { id: p.id, reference: p.reference } : null)) : null,
    prefillEmail: o.email ?? null,
  };
}

/**
 * `POST /api/pay/:session/pay` with `{ method, idempotencyKey }`: pay what's left on the session's
 * order. The amount is the order's; nothing in the request can change it.
 */
export async function payInSession(db: Db, deps: PaySessionDeps, input: { session: string; request: unknown; now?: Date }): Promise<PublicPayStarted> {
  const now = input.now ?? new Date();
  const parsed = PublicPay.safeParse(input.request);
  if (!parsed.success) throw new PayError('Clear or card', 'invalid');
  if (parsed.data.rewardId) throw new PayError('Rewards can’t be used on a link', 'invalid');
  const s = await sessionRow(db, input.session);
  const link = await linkOf(db, s);
  if (link) await openLink(db, link.slug, now);
  if (new Date(s.expires_at).getTime() <= now.getTime()) throw new PayError('This payment has ended. Open the link again.', 'expired');
  const order = await getOrder(db, s.merchant, await ensureSessionOrder(db, deps, s, now));
  if (order.status === 'voided') throw new PayError('This payment has ended. Open the link again.', 'expired');
  const source = s.kind === 'link' ? 'link' : 'online';
  const key = `${source}:${s.id}:${parsed.data.idempotencyKey}`;

  if (parsed.data.method === 'clear') {
    // A second tap: the Clear charge already waiting.
    const { rows: waiting } = await db.query<{ clear_charge_code: string }>(
      `SELECT clear_charge_code FROM payments.tenders WHERE order_id = $1 AND method = 'clear' AND status = 'pending' AND clear_charge_code IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [order.id],
    );
    const url = (code: string) => `${memberAppUrl().replace(/\/+$/, '')}/c/${code}`;
    if (waiting[0]) return { method: 'clear', chargeCode: waiting[0].clear_charge_code, url: url(waiting[0].clear_charge_code) };
    if (order.remainingCents <= 0) throw new PayError('This is being paid already', 'conflict');
    const tender = await createClearTender(db, clearFor(db, deps, s), {
      merchant: s.merchant,
      orderId: order.id,
      staffId: null,
      tender: { amountCents: order.remainingCents, tipCents: 0, idempotencyKey: key },
      source,
    });
    touchShop(s.merchant);
    if (!tender.clearChargeCode) throw new PayError('Clear couldn’t take this one', 'unavailable');
    return { method: 'clear', chargeCode: tender.clearChargeCode, url: url(tender.clearChargeCode) };
  }

  const card = (await cardsOn(db, s.merchant)) ? await deps.card(s.merchant) : null;
  if (!card) throw new PayError('This shop doesn’t take cards here', 'unavailable');
  if (order.remainingCents <= 0) throw new PayError('This is being paid already', 'conflict');
  const shop = await payShop(db, s.merchant);
  const back = link ? `${payBase()}/l/${link.slug}` : `${payBase()}/m/${s.id}`;
  const summary = order.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name)).join(', ');
  const started = await createCheckoutTender(db, card, {
    merchant: s.merchant,
    orderId: order.id,
    amountCents: order.remainingCents,
    lineName: `${shop.name} · ${summary}`.slice(0, 120),
    successUrl: `${back}?s=${s.id}&paid=1`,
    cancelUrl: `${back}?s=${s.id}`,
    idempotencyKey: key,
    source,
  });
  touchShop(s.merchant);
  return { method: 'card', checkoutUrl: started.url };
}
