import type { CardStarted } from '@clear/merchant-contracts';
import { z } from 'zod';
import type { Db } from '../../../db/db.js';
import { createOnlineCardTender, TenderError } from '../cards/cardTenders.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { connectorStore } from '../cards/connectorStore.js';
import { getOrder } from '../orders/orderService.js';
import { syncClearTender } from '../orders/payments.js';
import { settleOrder } from '../orders/settle.js';
import { addPayer } from '../rewards/counter.js';
import { cardsOn, PayError } from './links.js';
import type { PayClaims } from './secrets.js';
import { clearFor, ensureSessionOrder, optionsOf, sessionRow, type PaySessionDeps, type SessionRow } from './sessions.js';

/**
 * Pay by card in the modal and on the link page (pay spec §3; pay DECISIONS, Phase 1 "Card in the
 * modal" and Phase 6): Stripe's fields in Clear's frame, on the shop's own connected account. The
 * amount is the order's, and Clear's fee is set here, as at the counter.
 *
 * Test and live never mix: a test-mode session's card runs only on a test key (this environment's, when
 * it is one). On a live key it isn't offered, so test mode can never take real money.
 */

const StartCard = z.object({ idempotencyKey: z.string().min(8).max(200) });

/** Clear's publishable key for the processor's fields, matching the secret key's mode; null when not set. */
export function publishableKey(livemode: boolean): string | null {
  const key = (process.env.STRIPE_PUBLISHABLE_KEY ?? '').trim();
  if (!key) return null;
  return key.startsWith(livemode ? 'pk_live_' : 'pk_test_') ? key : null;
}

/** Whether the processor here takes this session's kind of money: a test session never on a live key. */
export const cardModeOk = (provider: Pick<CardConnectorProvider, 'livemode'>, sessionLivemode: boolean) => sessionLivemode || provider.livemode === false;

/** Card on this session: the shop takes cards, the modal allows it, the mode fits and the fields can load. */
export async function cardOnline(db: Db, deps: PaySessionDeps, s: Pick<SessionRow, 'merchant' | 'kind' | 'livemode' | 'options'>): Promise<boolean> {
  if (s.kind === 'modal' && !(optionsOf(s).methods ?? []).includes('card')) return false;
  if (!(await cardsOn(db, s.merchant))) return false;
  const provider = await deps.card(s.merchant).catch(() => null);
  if (!provider?.createOnlinePayment || !cardModeOk(provider, s.livemode)) return false;
  return publishableKey(provider.livemode !== false) !== null;
}

/**
 * `POST /api/checkout/:session/card` (`X-Pay-Session` when signed in): the fields' PaymentIntent. A
 * signed-in member who switches to card has their waiting Clear charge withdrawn, and is the order's
 * payer, so the shop's points follow the card.
 */
export async function startCard(db: Db, deps: PaySessionDeps, input: { session: string; claims: PayClaims | null; request: unknown; now?: Date }): Promise<CardStarted> {
  const now = input.now ?? new Date();
  const parsed = StartCard.safeParse(input.request);
  if (!parsed.success) throw new PayError('Try again', 'invalid');
  const s = await sessionRow(db, input.session);
  if (new Date(s.expires_at).getTime() <= now.getTime()) throw new PayError('This payment has ended. Start again on the shop’s page.', 'expired');
  if (!(await cardOnline(db, deps, s))) throw new PayError('Card isn’t available here', 'unavailable');
  const provider = (await deps.card(s.merchant))!;
  const orderId = await ensureSessionOrder(db, deps, s, now);

  await withdrawWaitingClear(db, deps, s, orderId);
  if (input.claims?.w) await addPayer(db, { orderId, wallet: input.claims.w });

  const order = await getOrder(db, s.merchant, orderId);
  if (order.status === 'paid') throw new PayError('This has been paid', 'conflict');
  const source = s.kind === 'link' ? 'link' : 'online';
  try {
    const started = await createOnlineCardTender(db, provider, {
      merchant: s.merchant,
      orderId,
      amountCents: order.remainingCents,
      idempotencyKey: `${source}:${s.id}:card:${parsed.data.idempotencyKey}`,
      source,
    });
    return { clientSecret: started.clientSecret, stripeAccount: started.account, publishableKey: publishableKey(provider.livemode !== false)!, amountCents: started.amountCents };
  } catch (error) {
    if (error instanceof TenderError) throw new PayError(error.message, error.code === 'over_remaining' || error.code === 'order_closed' ? 'conflict' : 'unavailable');
    throw error;
  }
}

/** A Clear charge nobody has answered yet, on this order: withdrawn, so the card can take the whole of it. */
async function withdrawWaitingClear(db: Db, deps: PaySessionDeps, s: SessionRow, orderId: string): Promise<void> {
  const clear = clearFor(db, deps, s);
  const { rows } = await db.query<{ id: string; clear_charge_code: string | null }>(
    `SELECT id, clear_charge_code FROM payments.tenders WHERE order_id = $1 AND method = 'clear' AND status = 'pending'`,
    [orderId],
  );
  for (const t of rows) {
    if (t.clear_charge_code) await clear.cancel(t.clear_charge_code, s.merchant).catch(() => false);
    const synced = await syncClearTender(db, clear, { merchant: s.merchant, tenderId: t.id, actor: null });
    // Approved in the meantime: the member paid with Clear after all, and the card isn't needed.
    if (synced.status === 'approved') throw new PayError('This has been paid', 'conflict');
    if (synced.status === 'pending') {
      await db.transaction(async (tx) => {
        await tx.query(`UPDATE payments.tenders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'`, [t.id]);
        await settleOrder(tx, { merchant: s.merchant, orderId, actor: null });
      });
    }
  }
}

/** Clear's pay host, where the link page and the modal's frame live. */
const payHost = () => new URL(process.env.PAY_BASE_URL || 'https://pay.useclear.org').hostname;

/**
 * Wallets in the fields (Apple Pay, Google Pay) need the page's domain registered on the shop's own
 * account: the shop's website, and Clear's pay host that frames the fields. Best effort, after a site is
 * added; a local test site can't be registered and doesn't need to be.
 */
export async function registerWalletDomains(db: Db, provider: CardConnectorProvider | null, input: { merchant: string; origin: string }): Promise<string[]> {
  if (!provider?.registerPaymentDomain) return [];
  const connector = await connectorStore.latest(db, input.merchant);
  if (!connector || connector.disconnected_at) return [];
  const domains = [new URL(input.origin).hostname, payHost()].filter((d) => d !== 'localhost' && d !== '127.0.0.1' && !d.endsWith('.localhost'));
  const done: string[] = [];
  for (const domain of [...new Set(domains)]) {
    try {
      await provider.registerPaymentDomain(connector.external_account_id, domain);
      done.push(domain);
    } catch (error) {
      console.warn(`[pay] wallet domain ${domain} for ${input.merchant} not registered: ${(error as Error).message}`);
    }
  }
  return done;
}
