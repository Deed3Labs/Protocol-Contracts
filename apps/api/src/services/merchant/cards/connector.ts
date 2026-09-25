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

/** A card payment as the processor sees it. */
export interface PaymentSnapshot {
  paymentId: string;
  /**
   * - `waiting`: created, no card yet (or a card was declined and nothing is held)
   * - `authorised`: a hold on the card, not yet captured
   * - `captured`: taken
   * - `cancelled`: voided, or expired uncaptured
   * - `processing`: in flight at the processor
   */
  state: 'waiting' | 'authorised' | 'captured' | 'cancelled' | 'processing';
  /** What the payment is for, tip included. */
  amountCents: number;
  /** Held on the card and capturable now; 0 unless authorised. */
  capturableCents: number;
  /** Set when the last attempt was declined. The code, never shown to the counter. */
  declineCode: string | null;
  card: { brand: string | null; last4: string | null } | null;
  /** The card allows raising the hold (a tip added after the tap). */
  incrementalSupported: boolean;
}

export interface RefundSnapshot {
  refundId: string;
  state: 'succeeded' | 'pending' | 'failed';
  failureReason: string | null;
}

export class CardDeclined extends Error {
  constructor(readonly code: string | null) {
    super('The card was declined');
    this.name = 'CardDeclined';
  }
}

export class ReaderUnavailable extends Error {
  constructor(
    readonly reason: 'busy' | 'offline' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'ReaderUnavailable';
  }
}

export interface Address {
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface CardConnectorProvider {
  readonly provider: CardProviderName;
  /** Whether the processor can take Clear's fee off each sale. Stripe can; a provider that can't is billed monthly (Phase 9). */
  readonly supportsPlatformFee: boolean;
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

  // ---- Readers ---------------------------------------------------------------------------------
  /** The shop's one reader location on its own account, at its address. */
  createLocation(account: string, input: { name: string; address: Address }): Promise<{ locationId: string }>;
  /** For the reader SDKs, scoped to the shop's location. */
  connectionToken(account: string, locationId: string): Promise<{ secret: string }>;
  /** A smart reader, by the code it shows on its screen. */
  registerReader(account: string, input: { registrationCode: string; label: string; locationId: string }): Promise<{ externalReaderId: string; label: string }>;

  // ---- Payments --------------------------------------------------------------------------------
  /** A card-present payment, captured later. `amountCents` includes the tip. */
  createPayment(
    account: string,
    input: { amountCents: number; applicationFeeCents: number; metadata: Record<string, string>; idempotencyKey: string },
  ): Promise<{ snapshot: PaymentSnapshot; clientSecret: string }>;
  getPayment(account: string, paymentId: string): Promise<PaymentSnapshot>;
  /** Raise the hold to a new total. Throws CardDeclined if the card won't take it; the old hold stands. */
  raiseAuthorisation(account: string, paymentId: string, input: { amountCents: number; applicationFeeCents: number }): Promise<PaymentSnapshot>;
  capture(account: string, paymentId: string, input: { amountCents: number; applicationFeeCents: number; idempotencyKey: string }): Promise<PaymentSnapshot>;
  /**
   * Sends a payment to a smart reader (server-driven): the reader asks for the card and authorises.
   * Asynchronous; the outcome comes back on the payment. Throws ReaderUnavailable if the reader is
   * busy, offline or didn't answer.
   */
  presentOnReader(account: string, externalReaderId: string, paymentId: string): Promise<void>;
  /** Clears whatever the smart reader is asking for. Refused (ReaderUnavailable 'busy') mid-authorisation. */
  clearReader(account: string, externalReaderId: string): Promise<void>;
  /** Void: releases the hold. Safe to repeat. */
  cancel(account: string, paymentId: string): Promise<PaymentSnapshot>;
  refund(
    account: string,
    paymentId: string,
    input: { amountCents: number; refundApplicationFee: boolean; idempotencyKey: string; metadata: Record<string, string> },
  ): Promise<RefundSnapshot>;
}
