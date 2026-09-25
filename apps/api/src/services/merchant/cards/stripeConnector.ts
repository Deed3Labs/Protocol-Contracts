import Stripe from 'stripe';
import { CardDeclined, type CardConnectorProvider, type PaymentSnapshot, type RefundSnapshot } from './connector.js';

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
      const location = await stripe.terminal.locations.create(
        {
          display_name: name,
          address: {
            line1: address.line1,
            ...(address.line2 ? { line2: address.line2 } : {}),
            city: address.city,
            state: address.region,
            postal_code: address.postalCode,
            country: address.country,
          },
        },
        { stripeAccount: account },
      );
      return { locationId: location.id };
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
  };
  return connector;
}

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
