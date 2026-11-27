import { PublicPay, type PublicPayStarted, type WaitlistJoined } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { memberAppUrl } from '../../memberAppUrl.js';
import { createCheckoutTender } from '../cards/cardTenders.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { type ClearCharges, createClearTender } from '../orders/payments.js';
import { applyCustomerReward, OrderError, type OrderDeps } from '../orders/orderService.js';
import { setOrderMember } from '../rewards/counter.js';
import { RewardsError } from '../rewards/errors.js';
import { touchShop } from './bus.js';
import { TerminalError } from './errors.js';
import { joinWaitlist } from './floor.js';
import type { Texter } from './texts.js';
import { pointByCode, pointStateFor } from './pointState.js';

/**
 * What a customer's phone does from `useclear.org/p/:code` (terminal reference, section 11). Paying
 * raises the same tender the counter would: a Clear charge the Clear app opens, or a card through a
 * checkout on the shop's own account. Nothing here takes a sign-in.
 */

/** Where the phone pages live: the member app (DECISIONS, Terminal Phase 1). */
export const phonePageBase = () => (process.env.PHONE_PAGE_BASE_URL || memberAppUrl()).replace(/\/+$/, '');

export interface PublicPayDeps {
  clear: ClearCharges;
  /** The shop's card processor, when it takes cards. */
  card: (merchant: string) => Promise<CardConnectorProvider | null>;
  /** Pricing a reward the customer puts on the bill from their rewards app. */
  orders?: OrderDeps;
  /** Where a rewards app's card checkout comes back to: `https://rewards.useclear.org`. */
  rewardsUrl?: string;
}

/** A signed-in customer paying from a shop's rewards app: who, and the shop their token is for. */
export interface PayingCustomer {
  personId: string;
  slug: string;
}

/** Pay what's left on the bill the Point is showing. */
export async function publicPay(db: Db, deps: PublicPayDeps, input: { code: string; request: unknown; now?: Date; customer?: PayingCustomer | null }): Promise<PublicPayStarted> {
  const parsed = PublicPay.safeParse(input.request);
  if (!parsed.success) throw new TerminalError('Clear or card', 'invalid');
  const p = await pointByCode(db, input.code);
  if (!p) throw new TerminalError('No Point has that code', 'not_found');
  const { state } = await pointStateFor(db, p.deviceId, input.now ?? new Date());
  if (state.kind !== 'bill') throw new TerminalError('There’s no bill here right now', 'conflict');
  if (input.customer) await customerOnBill(db, deps, { merchant: p.merchant, orderId: state.orderId, customer: input.customer, rewardId: parsed.data.rewardId ?? null });
  else if (parsed.data.rewardId) throw new TerminalError('Sign in to use a reward', 'forbidden');
  const { rows } = await db.query<{ raised_by: string; total_cents: string | number; number: number | null; name: string }>(
    `SELECT o.raised_by, o.total_cents, o.number, p.name FROM commerce.orders o JOIN merchant.profiles p ON p.merchant = o.merchant WHERE o.id = $1`,
    [state.orderId],
  );
  const { rows: covered } = await db.query<{ cents: string | number }>(
    `SELECT COALESCE(sum(amount_cents), 0) AS cents FROM payments.tenders WHERE order_id = $1 AND status IN ('pending','authorised','approved','captured','partly_refunded','refunded')`,
    [state.orderId],
  );
  const order = rows[0]!;
  const left = Number(order.total_cents) - Number(covered[0]?.cents ?? 0);
  // The page's own key, kept apart from the counter's.
  const key = `phone:${parsed.data.idempotencyKey}`;

  if (parsed.data.method === 'clear') {
    // A second tap, or a member scanning after the page started it: the Clear charge already waiting.
    const { rows: waiting } = await db.query<{ clear_charge_code: string }>(
      `SELECT clear_charge_code FROM payments.tenders WHERE order_id = $1 AND method = 'clear' AND status = 'pending' AND clear_charge_code IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [state.orderId],
    );
    if (waiting[0]) return { method: 'clear', chargeCode: waiting[0].clear_charge_code, url: `${memberAppUrl().replace(/\/+$/, '')}/c/${waiting[0].clear_charge_code}` };
    if (left <= 0) throw new TerminalError('This bill is being paid already', 'conflict');
    const tender = await createClearTender(db, deps.clear, {
      merchant: p.merchant,
      orderId: state.orderId,
      staffId: order.raised_by,
      tender: { amountCents: left, tipCents: 0, idempotencyKey: key },
    });
    touchShop(p.merchant);
    if (!tender.clearChargeCode) throw new TerminalError('Clear couldn’t take this one', 'conflict');
    return { method: 'clear', chargeCode: tender.clearChargeCode, url: `${memberAppUrl().replace(/\/+$/, '')}/c/${tender.clearChargeCode}` };
  }

  const card = await deps.card(p.merchant);
  if (!card) throw new TerminalError('This shop doesn’t take cards here', 'conflict');
  if (left <= 0) throw new TerminalError('This bill is being paid already', 'conflict');
  const back = input.customer && deps.rewardsUrl ? `${deps.rewardsUrl.replace(/\/+$/, '')}/s/${input.customer.slug}` : `${phonePageBase()}/p/${input.code.toUpperCase()}`;
  const started = await createCheckoutTender(db, card, {
    merchant: p.merchant,
    orderId: state.orderId,
    amountCents: left,
    lineName: order.number !== null ? `${order.name} · order ${order.number}` : order.name,
    successUrl: input.customer ? `${back}/paid/${encodeURIComponent(state.orderId)}` : `${back}?paid=1`,
    cancelUrl: back,
    idempotencyKey: key,
  });
  touchShop(p.merchant);
  return { method: 'card', checkoutUrl: started.url };
}

/** Join the wait list from a door Point's page. */
export async function publicJoinWaitlist(db: Db, input: { code: string; request: unknown; memberWallet?: string | null; texter?: Texter; now?: Date }): Promise<WaitlistJoined> {
  const p = await pointByCode(db, input.code);
  if (!p) throw new TerminalError('No Point has that code', 'not_found');
  const { point } = await pointStateFor(db, p.deviceId, input.now ?? new Date());
  if (point.settings.placement !== 'door') throw new TerminalError('This Point doesn’t take names', 'conflict');
  return joinWaitlist(db, { merchant: p.merchant, request: input.request, memberWallet: input.memberWallet ?? null, texter: input.texter, now: input.now });
}

/**
 * The rewards app pays a Point's bill signed in (rewards spec, section 3): the customer goes on the
 * order, so card earns as Clear does, with the reward they switched on as its one discount. Only on
 * this shop's bills, with this shop's token.
 */
async function customerOnBill(db: Db, deps: PublicPayDeps, input: { merchant: string; orderId: string; customer: PayingCustomer; rewardId: string | null }): Promise<void> {
  const { rows } = await db.query('SELECT 1 FROM rewards.shop_apps WHERE merchant = $1 AND slug = $2', [input.merchant, input.customer.slug]);
  if (!rows[0]) throw new TerminalError('This bill is at another shop', 'forbidden');
  try {
    if (input.rewardId) {
      if (!deps.orders) throw new TerminalError('Rewards can’t be used here', 'conflict');
      await applyCustomerReward(db, deps.orders, { merchant: input.merchant, orderId: input.orderId, personId: input.customer.personId, rewardId: input.rewardId });
    } else {
      await db.transaction((tx) => setOrderMember(tx, { merchant: input.merchant, orderId: input.orderId, personId: input.customer.personId, by: null, via: 'app' }));
    }
  } catch (error) {
    if (error instanceof OrderError) throw new TerminalError(error.message, error.code === 'not_found' ? 'not_found' : error.code === 'invalid' ? 'invalid' : 'conflict');
    if (error instanceof RewardsError) throw new TerminalError(error.message, error.code === 'not_found' ? 'not_found' : error.code === 'invalid' ? 'invalid' : error.code === 'forbidden' ? 'forbidden' : 'conflict');
    throw error;
  }
}
