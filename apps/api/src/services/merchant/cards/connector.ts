/**
 * The card-connector interface (card-processing prompt, "Other card providers"): what the rest of
 * the merchant back office needs from a card processor, with nothing Stripe-shaped in it. Stripe is
 * the first implementation (stripeConnector.ts); a Square one would sit beside it. Only the
 * connector files import a processor's SDK.
 */

export type CardProviderName = 'stripe';

export interface ConnectorAccountStatus {
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

export interface CardConnectorProvider {
  readonly provider: CardProviderName;
  /**
   * Opens the shop's own processor account. `idempotencyKey` makes a retried request return the
   * account the first one opened rather than a second account.
   */
  createAccount(input: {
    merchant: string;
    businessName: string;
    email: string | null;
    idempotencyKey: string;
  }): Promise<{ externalAccountId: string }>;
  /** A single-use link into the processor's hosted onboarding. */
  onboardingLink(externalAccountId: string, urls: { returnUrl: string; refreshUrl: string }): Promise<{ url: string }>;
  /** Where an already-connected shop manages its account. */
  dashboardUrl(externalAccountId: string): string;
  /** The account's status, asked of the processor directly rather than waiting for a webhook. */
  accountStatus(externalAccountId: string): Promise<ConnectorAccountStatus>;
}
