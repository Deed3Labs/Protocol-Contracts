import Stripe from 'stripe';
import { type Address, type BalanceItem, CardDeclined, type CardConnectorProvider, type Payout, type PaymentSnapshot, ReaderUnavailable, type RefundSnapshot } from './connector.js';

/**
 * Stripe as a card connector: Connect, Standard accounts, direct charges (card-processing prompt,
 * "Decisions already made"). Checked against Stripe's docs on 2026-09-24:
 *
 * - **Standard accounts are created with controller properties, not `type`.** Stripe now marks the
 *   account types as legacy and points integrations at controller properties. The values below are
 *   exactly the ones Stripe maps to a Standard account (the merchant pays Stripe's fees, Stripe
 *   covers negative balances and collects requirements, and the merchant gets the full Dashboard),
 *   and Stripe reports such an account back as `type: "standard"`. Nothing about the decision
 *   changes, only how it's asked for. docs.stripe.com/connect/migrate-to-controller-properties
 * - **Prefill before the first Account Link.** Once a link exists, the platform can't read or write
 *   the account's KYC details. docs.stripe.com/connect/standard-accounts
 * - **Account Links are single-use and expire within minutes.** Stripe sends the owner to
 *   `refresh_url` when one has been used or has expired, and the app asks for a fresh one.
 *   docs.stripe.com/api/account_links/create
 *
 * Terminal and payments (card-processing prompt, Phase 4), checked 2026-09-24:
 *
 * - **Direct charges: everything is made on the shop's account** with the `Stripe-Account` header
 *   (the SDK's `stripeAccount` option): the Location, readers, connection tokens, PaymentIntents and
 *   refunds. A connection token given a location only works with readers at that location.
 *   docs.stripe.com/terminal/features/connect?connect-charge-type=direct
 * - **A card-present PaymentIntent** has `payment_method_types: ['card_present']`; with
 *   `capture_method: 'manual'` a processed payment waits in `requires_capture`, and **must be
 *   captured within 2 days** or the hold is released. The SDK confirms it on the device, never the
 *   server. docs.stripe.com/terminal/payments/collect-card-payment
 * - **A tip after the tap** is an incremental authorisation: asked for when the PaymentIntent is
 *   made, possible on Visa, Mastercard, Amex and Discover with the reader online, at most 10
 *   attempts; a decline leaves the original hold. (On-receipt "overcapture" tipping is US-only and
 *   limited to some merchant categories, so it isn't relied on.)
 *   docs.stripe.com/terminal/features/incremental-authorizations
 * - **Capture and increments take `application_fee_amount`**, so Clear's fee is recomputed on the
 *   final amount.
 * - **Refunds take `refund_application_fee`** (default false; proportional on a partial refund).
 *   docs.stripe.com/api/refunds/create
 * - **Offline payments are created by the device**, not the server, and can't be incremented. See
 *   the seam in cardTenders.ts. docs.stripe.com/terminal/features/operate-offline/overview
 * - **Smart readers are driven from the server** (Stripe's recommendation for the S700/S710 and
 *   WisePOS E: the JS SDK needs the reader on the same local network). `process_payment_intent`
 *   answers at once and the reader works asynchronously; the outcome arrives as
 *   `terminal.reader.action_succeeded` / `action_failed` and on the PaymentIntent. A reader that's
 *   mid-payment refuses new work (`terminal_reader_busy`), one silent for 2 minutes is offline
 *   (`terminal_reader_offline`), and `terminal_reader_timeout` may be a false negative, so it's
 *   safe to try again. `cancel_action` is refused while a card is being authorised.
 *   docs.stripe.com/terminal/payments/collect-card-payment?terminal-sdk-platform=server-driven
 */

let client: Stripe | null = null;

export function stripeKey(): string {
  return (process.env.STRIPE_SECRET_KEY || '').trim();
}

/** Live or test, from the key. Connect endpoints in production receive both, so events are checked against it. */
export function stripeLivemode(): boolean {
  return /^(sk|rk)_live_/.test(stripeKey());
}

export function stripeClient(): Stripe | null {
  const key = stripeKey();
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

const STATE: Record<Stripe.PaymentIntent.Status, PaymentSnapshot['state']> = {
  requires_payment_method: 'waiting',
  requires_confirmation: 'waiting',
  requires_action: 'waiting',
  processing: 'processing',
  requires_capture: 'authorised',
  succeeded: 'captured',
  canceled: 'cancelled',
};

/** A PaymentIntent retrieved with `expand: ['latest_charge']`, as the connector's snapshot. */
export function paymentSnapshot(pi: Stripe.PaymentIntent): PaymentSnapshot {
  const charge = typeof pi.latest_charge === 'object' && pi.latest_charge ? pi.latest_charge : null;
  const present = charge?.payment_method_details?.card_present ?? null;
  return {
    paymentId: pi.id,
    state: STATE[pi.status] ?? 'processing',
    amountCents: pi.amount,
    capturableCents: pi.amount_capturable ?? 0,
    declineCode: pi.status === 'requires_payment_method' && pi.last_payment_error ? (pi.last_payment_error.decline_code ?? pi.last_payment_error.code ?? 'declined') : null,
    card: present ? { brand: present.brand ?? null, last4: present.last4 ?? null } : null,
    incrementalSupported: Boolean(present?.incremental_authorization_supported),
  };
}

const EXPAND = ['latest_charge'];

const READER_ERRORS: Record<string, ['busy' | 'offline' | 'timeout', string]> = {
  terminal_reader_busy: ['busy', 'The reader is busy with another payment. Finish or cancel that one first.'],
  terminal_reader_offline: ['offline', 'The reader is offline. Check it’s on and connected to the internet.'],
  terminal_reader_timeout: ['timeout', 'The reader didn’t answer in time. Try again.'],
};

async function readerAware<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const code = error instanceof Stripe.errors.StripeError ? error.code : undefined;
    const known = code ? READER_ERRORS[code] : undefined;
    if (known) throw new ReaderUnavailable(known[0], known[1]);
    throw error;
  }
}

const stripeAddress = (a: Address) => ({
  line1: a.line1,
  ...(a.line2 ? { line2: a.line2 } : {}),
  city: a.city,
  state: a.region,
  postal_code: a.postalCode,
  country: a.country,
});

async function declineAware<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof Stripe.errors.StripeCardError) throw new CardDeclined(error.decline_code ?? error.code ?? null);
    throw error;
  }
}

export function stripeConnector(stripe: Stripe): CardConnectorProvider {
  const connector: CardConnectorProvider = {
    provider: 'stripe',
    supportsPlatformFee: true,

    async createAccount({ merchant, businessName, email, idempotencyKey }) {
      const account = await stripe.accounts.create(
        {
          controller: {
            fees: { payer: 'account' },
            losses: { payments: 'stripe' },
            requirement_collection: 'stripe',
            stripe_dashboard: { type: 'full' },
          },
          country: 'US',
          ...(email ? { email } : {}),
          business_profile: { name: businessName },
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: { clear_merchant: merchant },
        },
        { idempotencyKey },
      );
      return { externalAccountId: account.id };
    },

    async onboardingLink(externalAccountId, { returnUrl, refreshUrl }) {
      const link = await stripe.accountLinks.create({
        account: externalAccountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl,
      });
      return { url: link.url };
    },

    dashboardUrl() {
      // A Standard account signs in to its own Dashboard; Stripe routes it to the right account.
      return 'https://dashboard.stripe.com/';
    },

    async accountStatus(externalAccountId) {
      const account = await stripe.accounts.retrieve(externalAccountId);
      return { chargesEnabled: account.charges_enabled, detailsSubmitted: account.details_submitted };
    },

    async createLocation(account, { name, address }) {
      const location = await stripe.terminal.locations.create({ display_name: name, address: stripeAddress(address) }, { stripeAccount: account });
      return { locationId: location.id };
    },

    async updateLocation(account, locationId, { name, address }) {
      await stripe.terminal.locations.update(locationId, { display_name: name, address: stripeAddress(address) }, { stripeAccount: account });
    },

    async connectionToken(account, locationId) {
      const token = await stripe.terminal.connectionTokens.create({ location: locationId }, { stripeAccount: account });
      return { secret: token.secret };
    },

    async registerReader(account, { registrationCode, label, locationId }) {
      const reader = await stripe.terminal.readers.create(
        { registration_code: registrationCode, label, location: locationId },
        { stripeAccount: account },
      );
      return { externalReaderId: reader.id, label: reader.label ?? label };
    },

    async createPayment(account, { amountCents, applicationFeeCents, metadata, idempotencyKey }) {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          payment_method_types: ['card_present'],
          capture_method: 'manual',
          ...(applicationFeeCents > 0 ? { application_fee_amount: applicationFeeCents } : {}),
          payment_method_options: { card_present: { request_incremental_authorization_support: true } },
          metadata,
          expand: EXPAND,
        },
        { stripeAccount: account, idempotencyKey },
      );
      if (!pi.client_secret) throw new Error(`PaymentIntent ${pi.id} came back without a client secret`);
      return { snapshot: paymentSnapshot(pi), clientSecret: pi.client_secret };
    },

    async getPayment(account, paymentId) {
      return paymentSnapshot(await stripe.paymentIntents.retrieve(paymentId, { expand: EXPAND }, { stripeAccount: account }));
    },

    async raiseAuthorisation(account, paymentId, { amountCents, applicationFeeCents }) {
      return declineAware(async () =>
        paymentSnapshot(
          await stripe.paymentIntents.incrementAuthorization(
            paymentId,
            { amount: amountCents, ...(applicationFeeCents > 0 ? { application_fee_amount: applicationFeeCents } : {}), expand: EXPAND },
            { stripeAccount: account },
          ),
        ),
      );
    },

    async capture(account, paymentId, { amountCents, applicationFeeCents, idempotencyKey }) {
      return declineAware(async () =>
        paymentSnapshot(
          await stripe.paymentIntents.capture(
            paymentId,
            { amount_to_capture: amountCents, application_fee_amount: applicationFeeCents, expand: EXPAND },
            { stripeAccount: account, idempotencyKey },
          ),
        ),
      );
    },

    async presentOnReader(account, externalReaderId, paymentId) {
      await readerAware(() =>
        stripe.terminal.readers.processPaymentIntent(
          externalReaderId,
          { payment_intent: paymentId, process_config: { enable_customer_cancellation: true } },
          { stripeAccount: account },
        ),
      );
    },

    async clearReader(account, externalReaderId) {
      await readerAware(() => stripe.terminal.readers.cancelAction(externalReaderId, {}, { stripeAccount: account }));
    },

    async cancel(account, paymentId) {
      try {
        return paymentSnapshot(await stripe.paymentIntents.cancel(paymentId, { expand: EXPAND }, { stripeAccount: account }));
      } catch (error) {
        // Already cancelled (a repeat, or it expired): the result is what we wanted.
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'payment_intent_unexpected_state') {
          const snapshot = await connector.getPayment(account, paymentId);
          if (snapshot.state === 'cancelled') return snapshot;
        }
        throw error;
      }
    },

    async refund(account, paymentId, { amountCents, refundApplicationFee, idempotencyKey, metadata }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentId, amount: amountCents, refund_application_fee: refundApplicationFee, metadata },
        { stripeAccount: account, idempotencyKey },
      );
      return refundSnapshot(refund);
    },

    async getPayout(account, payoutId) {
      return toPayout(await stripe.payouts.retrieve(payoutId, {}, { stripeAccount: account }));
    },

    async listPayouts(account, since) {
      const out: Payout[] = [];
      for await (const p of stripe.payouts.list({ created: { gte: Math.floor(since.getTime() / 1000) }, limit: 100 }, { stripeAccount: account })) out.push(toPayout(p));
      return out;
    },

    async payoutItems(account, payoutId) {
      const out: BalanceItem[] = [];
      for await (const b of stripe.balanceTransactions.list({ payout: payoutId, limit: 100, expand: ['data.source'] }, { stripeAccount: account })) {
        if (b.type !== 'payout') out.push(balanceItem(b));
      }
      return out;
    },

    async balanceItems(account, since) {
      const out: BalanceItem[] = [];
      for await (const b of stripe.balanceTransactions.list({ created: { gte: Math.floor(since.getTime() / 1000) }, limit: 100, expand: ['data.source'] }, { stripeAccount: account })) {
        if (b.type !== 'payout') out.push(balanceItem(b));
      }
      return out;
    },
  };
  return connector;
}

/**
 * A balance transaction, with Stripe's fee split (checked in test mode, 2026-09-25: a direct charge
 * with an application fee carries `fee_details` of `stripe_fee` and `application_fee`; a refund
 * that keeps the application fee carries none). Only for automatic payouts can Stripe say which
 * transactions a payout settled (docs.stripe.com/reports/payout-reconciliation).
 */
export function balanceItem(b: Stripe.BalanceTransaction): BalanceItem {
  const fee = (type: string) => b.fee_details.filter((f) => f.type === type).reduce((s, f) => s + f.amount, 0);
  const source = typeof b.source === 'string' ? null : (b.source as { payment_intent?: string | { id: string } | null } | null);
  const pi = source?.payment_intent ?? null;
  return {
    id: b.id,
    type: b.type,
    amountCents: b.amount,
    // Everything that isn't Clear's is the processor's (its fee, and any tax on it).
    processorFeeCents: b.fee - fee('application_fee'),
    platformFeeCents: fee('application_fee'),
    netCents: b.net,
    paymentId: typeof pi === 'string' ? pi : (pi?.id ?? null),
    createdAt: new Date(b.created * 1000).toISOString(),
  };
}

const toPayout = (p: Stripe.Payout): Payout => ({
  id: p.id,
  status: p.status as Payout['status'],
  amountCents: p.amount,
  arrivalDate: new Date(p.arrival_date * 1000).toISOString().slice(0, 10),
  automatic: p.automatic,
});

export function refundSnapshot(refund: Stripe.Refund): RefundSnapshot {
  const state: RefundSnapshot['state'] =
    refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' || refund.status === 'canceled' ? 'failed' : 'pending';
  return { refundId: refund.id, state, failureReason: refund.failure_reason ?? null };
}

/** The configured connector, or null when the processor isn't set up in this environment. */
export function defaultCardConnector(): CardConnectorProvider | null {
  const stripe = stripeClient();
  return stripe ? stripeConnector(stripe) : null;
}
