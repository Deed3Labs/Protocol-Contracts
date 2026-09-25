import { CardDeclined, type CardConnectorProvider, type ConnectorAccountStatus, type PaymentSnapshot, ReaderUnavailable, type RefundSnapshot } from './connector.js';

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

export function fakeProvider() {
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
    raises: [] as Array<{ paymentId: string; amountCents: number; applicationFeeCents: number }>,
    captures: [] as Array<{ paymentId: string; amountCents: number; applicationFeeCents: number }>,
    cancels: [] as string[],
    refunds: [] as Array<{ paymentId: string; amountCents: number; refundApplicationFee: boolean }>,
    presented: [] as Array<{ reader: string; paymentId: string }>,
    cleared: [] as string[],
  };
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
    provider: 'stripe',
    supportsPlatformFee: true,
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
    async connectionToken(account, locationId) {
      calls.tokens.push({ account, locationId });
      return { secret: `pst_test_${locationId}` };
    },
    async registerReader(_account, { registrationCode, label }) {
      if (registrationCode === 'bad-code') throw new Error('No reader with that code');
      return { externalReaderId: id('tmr'), label };
    },
    async createPayment(account, { amountCents, applicationFeeCents, metadata, idempotencyKey }) {
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
      calls.raises.push({ paymentId, ...input });
      const p = get(paymentId);
      if (knobs.raiseDeclines) throw new CardDeclined('insufficient_funds');
      p.amount = input.amountCents;
      p.capturable = input.amountCents;
      p.fee = input.applicationFeeCents;
      return snap(p);
    },
    async capture(_account, paymentId, input) {
      const p = get(paymentId);
      if (p.state === 'captured') return snap(p);
      calls.captures.push({ paymentId, ...input });
      if (p.state !== 'authorised') throw new Error(`cannot capture a ${p.state} payment`);
      if (input.amountCents > p.capturable) throw new CardDeclined('amount_too_large');
      p.captured = input.amountCents;
      p.amount = input.amountCents;
      p.fee = input.applicationFeeCents;
      p.state = 'captured';
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

  return { provider, calls, status, payments, knobs, tap, decline };
}
