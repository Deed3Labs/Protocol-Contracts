import Stripe from 'stripe';
import type { CardConnectorProvider } from './connector.js';

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

export function stripeConnector(stripe: Stripe): CardConnectorProvider {
  return {
    provider: 'stripe',

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
  };
}

/** The configured connector, or null when the processor isn't set up in this environment. */
export function defaultCardConnector(): CardConnectorProvider | null {
  const stripe = stripeClient();
  return stripe ? stripeConnector(stripe) : null;
}
