import { randomUUID } from 'node:crypto';
import { PAY_OVER_TIME_MIN_CENTS } from '@clear/domain';
import { PublicPay, type PaySession, type PublicPayStarted } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { memberAppUrl } from '../../memberAppUrl.js';
import { createCheckoutTender } from '../cards/cardTenders.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { createOrder, getOrder, type OrderDeps, OrderError } from '../orders/orderService.js';
import { type ClearCharges, createClearTender } from '../orders/payments.js';
import { touchShop } from '../terminal/bus.js';
import { cardsOn, type LinkRow, linkBySlug, linkLines, linkQuote, linkState, payBase, PayError, payShop } from './links.js';
import { insertApiPayment } from './events.js';
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

interface SessionRow {
  id: string;
  merchant: string;
  livemode: boolean;
  kind: 'modal' | 'link';
  order_id: string | null;
  link_id: string | null;
  expires_at: Date | string;
}

const SESSION_ID = /^ps_[0-9a-f]{32}$/;

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

async function sessionRow(db: Db, id: string): Promise<SessionRow & { order_id: string }> {
  if (!SESSION_ID.test(id)) throw new PayError('This payment has ended', 'not_found');
  const { rows } = await db.query<SessionRow>('SELECT * FROM payments.pay_sessions WHERE id = $1', [id]);
  const s = rows[0];
  if (!s || !s.order_id) throw new PayError('This payment has ended', 'not_found');
  return s as SessionRow & { order_id: string };
}

async function linkOf(db: Db, s: SessionRow): Promise<LinkRow | null> {
  if (!s.link_id) return null;
  const { rows } = await db.query<LinkRow>('SELECT * FROM payments.payment_links WHERE id = $1', [s.link_id]);
  return rows[0] ?? null;
}

/** `GET /api/pay/:session`: what the page shows, from the order as it stands. Polled while it waits. */
export async function paySessionView(db: Db, deps: PaySessionDeps, input: { session: string; now?: Date }): Promise<PaySession> {
  const now = input.now ?? new Date();
  const s = await sessionRow(db, input.session);
  const order = await getOrder(db, s.merchant, s.order_id);
  const link = await linkOf(db, s);
  const paid = order.status === 'paid' || order.status === 'partly_refunded' || order.status === 'refunded';
  const ended = new Date(s.expires_at).getTime() <= now.getTime() || (link !== null && linkState(link, now) !== 'open');
  const state: PaySession['state'] = paid ? 'paid' : order.status === 'voided' ? 'canceled' : ended ? 'expired' : 'open';
  const lines = order.lines.map((l) => ({ name: l.name, quantity: l.quantity, lineCents: l.lineCents }));
  return {
    id: s.id,
    livemode: s.livemode,
    shop: await payShop(db, s.merchant),
    order: {
      lines,
      subtotalCents: order.subtotalCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      summary: lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name)).join(', '),
    },
    methods: { clear: true, card: await cardsOn(db, s.merchant) },
    overTime: Boolean(link?.allow_over_time) && overTimeOnline(s.livemode) && order.totalCents >= PAY_OVER_TIME_MIN_CENTS,
    shopHost: null,
    link: link ? { note: link.note, expiresAt: link.expires_at ? new Date(link.expires_at).toISOString() : null } : null,
    state,
    expiresAt: new Date(s.expires_at).toISOString(),
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
  const order = await getOrder(db, s.merchant, s.order_id);
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
    const tender = await createClearTender(db, deps.clear, {
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
  const back = link ? `${payBase()}/l/${link.slug}` : payBase();
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
