import { type BalanceItem, CardDeclined, type CardConnectorProvider, type CardProviderName, type ConnectorAccountStatus, type Payout, type PaymentSnapshot, ReaderUnavailable, type RefundSnapshot } from './connector.js';

/**
 * A card processor for tests: behaves like Stripe where the merchant code depends on it (manual
 * capture, holds, increments, idempotency keys, refunds), and lets a test play the customer (tap,
 * decline) and the processor (a card that can't be raised, a refund that's still pending).
 *
 * Tests only. Nothing in production imports it.
 */

interface FakePayment {
  id: string;
  account: string;
  amount: number;
  capturable: number;
  fee: number;
  state: PaymentSnapshot['state'];
  declineCode: string | null;
  card: { brand: string; last4: string } | null;
  incremental: boolean;
  metadata: Record<string, string>;
  captured: number;
  refunded: number;
}

/**
 * `platformFee: false` plays a processor that can't take Clear's fee off a sale: it refuses any
 * payment, raise or capture that asks it to, so a test proves the fee went to the monthly bill.
 */
export function fakeProvider(opts: { provider?: CardProviderName; platformFee?: boolean } = {}) {
  const platformFee = opts.platformFee ?? true;
  const noFee = (cents: number) => {
    if (!platformFee && cents !== 0) throw new Error('This processor can’t take a platform fee');
  };
  let seq = 0;
  const id = (p: string) => `${p}_fake_${++seq}_${Math.random().toString(36).slice(2, 6)}`;
  const payments = new Map<string, FakePayment>();
  const byKey = new Map<string, string>();
  const status = new Map<string, ConnectorAccountStatus>();
  const refundByKey = new Map<string, RefundSnapshot>();
  const calls = {
    create: [] as string[],
    links: [] as Array<{ account: string; returnUrl: string; refreshUrl: string }>,
    status: 0,
    locations: [] as Array<{ account: string; name: string }>,
    tokens: [] as Array<{ account: string; locationId: string }>,
    locationUpdates: [] as Array<{ account: string; locationId: string; name: string; city: string }>,
    raises: [] as Array<{ paymentId: string; amountCents: number; applicationFeeCents: number }>,
    captures: [] as Array<{ paymentId: string; amountCents: number; applicationFeeCents: number }>,
    cancels: [] as string[],
    refunds: [] as Array<{ paymentId: string; amountCents: number; refundApplicationFee: boolean }>,
    presented: [] as Array<{ reader: string; paymentId: string }>,
    cleared: [] as string[],
  };
  /** The shop's processor balance: charges on capture (Stripe's in-person 2.7% + 5¢), refunds, and anything a test adds. */
  const balance: Array<BalanceItem & { payoutId: string | null }> = [];
  const payoutsById = new Map<string, Payout>();
  const stripeFee = (cents: number) => Math.round(cents * 0.027) + 5;
  const knobs = {
    raiseDeclines: false,
    refundState: 'succeeded' as RefundSnapshot['state'],
    reader: 'ready' as 'ready' | 'busy' | 'offline',
  };

  const snap = (p: FakePayment): PaymentSnapshot => ({
    paymentId: p.id,
    state: p.state,
    amountCents: p.amount,
    capturableCents: p.state === 'authorised' ? p.capturable : 0,
    declineCode: p.declineCode,
    card: p.card,
    incrementalSupported: p.incremental,
  });
  const get = (paymentId: string) => {
    const p = payments.get(paymentId);
    if (!p) throw new Error(`no such payment ${paymentId}`);
    return p;
  };

  const provider: CardConnectorProvider = {
    provider: opts.provider ?? 'stripe',
    supportsPlatformFee: platformFee,
    authorisationHoldMs: 2 * 24 * 60 * 60 * 1000,
    async createAccount({ idempotencyKey }) {
      calls.create.push(idempotencyKey);
      return { externalAccountId: id('acct') };
    },
    async onboardingLink(account, urls) {
      calls.links.push({ account, ...urls });
      return { url: `https://connect.example/setup/${account}` };
    },
    dashboardUrl: () => 'https://dashboard.example/',
    async accountStatus(account) {
      calls.status += 1;
      return status.get(account) ?? { chargesEnabled: false, detailsSubmitted: false };
    },
    async createLocation(account, { name }) {
      calls.locations.push({ account, name });
      return { locationId: id('tml') };
    },
    async updateLocation(account, locationId, { name, address }) {
      calls.locationUpdates.push({ account, locationId, name, city: address.city });
    },
    async connectionToken(account, locationId) {
      calls.tokens.push({ account, locationId });
      return { secret: `pst_test_${locationId}` };
    },
    async registerReader(_account, { registrationCode, label }) {
      if (registrationCode === 'bad-code') throw new Error('No reader with that code');
      return { externalReaderId: id('tmr'), label };
    },
    async createPayment(account, { amountCents, applicationFeeCents, metadata, idempotencyKey }) {
      noFee(applicationFeeCents);
      const existing = byKey.get(idempotencyKey);
      if (existing) return { snapshot: snap(get(existing)), clientSecret: `${existing}_secret` };
      const p: FakePayment = { id: id('pi'), account, amount: amountCents, capturable: 0, fee: applicationFeeCents, state: 'waiting', declineCode: null, card: null, incremental: false, metadata, captured: 0, refunded: 0 };
      payments.set(p.id, p);
      byKey.set(idempotencyKey, p.id);
      return { snapshot: snap(p), clientSecret: `${p.id}_secret` };
    },
    async getPayment(_account, paymentId) {
      return snap(get(paymentId));
    },
    async raiseAuthorisation(_account, paymentId, input) {
      noFee(input.applicationFeeCents);
      calls.raises.push({ paymentId, ...input });
      const p = get(paymentId);
      if (knobs.raiseDeclines) throw new CardDeclined('insufficient_funds');
      p.amount = input.amountCents;
      p.capturable = input.amountCents;
      p.fee = input.applicationFeeCents;
      return snap(p);
    },
    async capture(_account, paymentId, input) {
      noFee(input.applicationFeeCents);
      const p = get(paymentId);
      if (p.state === 'captured') return snap(p);
      calls.captures.push({ paymentId, ...input });
      if (p.state !== 'authorised') throw new Error(`cannot capture a ${p.state} payment`);
      if (input.amountCents > p.capturable) throw new CardDeclined('amount_too_large');
      p.captured = input.amountCents;
      p.amount = input.amountCents;
      p.fee = input.applicationFeeCents;
      p.state = 'captured';
      const sf = stripeFee(input.amountCents);
      balance.push({ id: id('txn'), type: 'charge', amountCents: input.amountCents, processorFeeCents: sf, platformFeeCents: input.applicationFeeCents, netCents: input.amountCents - sf - input.applicationFeeCents, paymentId: p.id, createdAt: new Date().toISOString(), payoutId: null });
      return snap(p);
    },
    async presentOnReader(_account, reader, paymentId) {
      if (knobs.reader !== 'ready') throw new ReaderUnavailable(knobs.reader, `reader ${knobs.reader}`);
      calls.presented.push({ reader, paymentId });
    },
    async clearReader(_account, reader) {
      if (knobs.reader === 'busy') throw new ReaderUnavailable('busy', 'reader busy');
      calls.cleared.push(reader);
    },
    async getPayout(_account, payoutId) {
      const p = payoutsById.get(payoutId);
      if (!p) throw new Error(`no such payout ${payoutId}`);
      return p;
    },
    async listPayouts() {
      return [...payoutsById.values()].reverse();
    },
    async payoutItems(_account, payoutId) {
      return balance.filter((b) => b.payoutId === payoutId).map(({ payoutId: _p, ...b }) => b);
    },
    async balanceItems() {
      return balance.map(({ payoutId: _p, ...b }) => b);
    },
    async cancel(_account, paymentId) {
      calls.cancels.push(paymentId);
      const p = get(paymentId);
      if (p.state === 'captured') throw new Error('cannot cancel a captured payment');
      p.state = 'cancelled';
      return snap(p);
    },
    async refund(_account, paymentId, { amountCents, refundApplicationFee, idempotencyKey }) {
      const done = refundByKey.get(idempotencyKey);
      if (done) return done;
      calls.refunds.push({ paymentId, amountCents, refundApplicationFee });
      const p = get(paymentId);
      if (amountCents > p.captured - p.refunded) throw new Error('refund exceeds what was captured');
      p.refunded += amountCents;
      balance.push({ id: id('txn'), type: 'refund', amountCents: -amountCents, processorFeeCents: 0, platformFeeCents: 0, netCents: -amountCents, paymentId: p.id, createdAt: new Date().toISOString(), payoutId: null });
      const r: RefundSnapshot = { refundId: id('re'), state: knobs.refundState, failureReason: knobs.refundState === 'failed' ? 'expired_or_canceled_card' : null };
      refundByKey.set(idempotencyKey, r);
      return r;
    },
  };

  /** The customer taps. `incremental`: the card allows a tip to be raised later. */
  const tap = (paymentId: string, opts: { brand?: string; last4?: string; incremental?: boolean } = {}) => {
    const p = get(paymentId);
    p.state = 'authorised';
    p.capturable = p.amount;
    p.declineCode = null;
    p.card = { brand: opts.brand ?? 'visa', last4: opts.last4 ?? '4242' };
    p.incremental = opts.incremental ?? true;
  };
  const decline = (paymentId: string, code = 'insufficient_funds') => {
    const p = get(paymentId);
    p.state = 'waiting';
    p.declineCode = code;
  };

  /** The processor pays out everything not yet paid out (an automatic payout), in the given state. */
  const payout = (status: Payout['status'] = 'paid', opts: { amountOffCents?: number } = {}) => {
    const items = balance.filter((b) => b.payoutId === null);
    const p: Payout = { id: id('po'), status, amountCents: items.reduce((s, b) => s + b.netCents, 0) - (opts.amountOffCents ?? 0), arrivalDate: '2026-09-28', automatic: true };
    for (const b of items) b.payoutId = p.id;
    payoutsById.set(p.id, p);
    return p;
  };
  /** A dispute or other adjustment in the balance. */
  const adjust = (amountCents: number, paymentId: string | null = null) =>
    balance.push({ id: id('txn'), type: 'adjustment', amountCents, processorFeeCents: 0, platformFeeCents: 0, netCents: amountCents, paymentId, createdAt: new Date().toISOString(), payoutId: null });
  const setPayoutStatus = (payoutId: string, status: Payout['status']) => {
    payoutsById.get(payoutId)!.status = status;
  };

  return { provider, calls, status, payments, knobs, tap, decline, balance, payout, adjust, setPayoutStatus };
}
