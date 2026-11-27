import type { CardConnectorProvider } from './connector.js';

/**
 * Square, as a stub (card-processing prompt, Phase 9: "leave a stub and a written note"). It
 * implements the whole connector interface so the compiler holds Square to the same shape as
 * Stripe, and every call refuses: the registry doesn't hand it out, so a shop is never offered it.
 *
 * What building it takes, checked against Square's docs: SQUARE.md beside this file.
 *
 * The two properties are already known, and are what the rest of the back office reads:
 *   - Square takes a platform fee (`app_fee_money`, on payments and on Terminal checkouts), so
 *     Clear's fee comes off each sale as it does on Stripe; no monthly bill.
 *   - An uncaptured card-present payment holds for at most 36 hours (`delay_duration`, then
 *     `delay_action` CANCEL), so the safety capture acts at 24 hours rather than Stripe's 36.
 */

export class NotBuilt extends Error {
  constructor(what: string) {
    super(`The Square connector isn't built yet (${what}). See apps/api/src/services/merchant/cards/SQUARE.md.`);
    this.name = 'NotBuilt';
  }
}

const refuse = (what: string) => async (): Promise<never> => {
  throw new NotBuilt(what);
};

export function squareConnector(): CardConnectorProvider {
  return {
    provider: 'square',
    supportsPlatformFee: true,
    authorisationHoldMs: 36 * 60 * 60 * 1000,

    // Connect: OAuth into the seller's existing Square account; Square opens no accounts for us.
    createAccount: refuse('createAccount'),
    onboardingLink: refuse('onboardingLink'),
    dashboardUrl: () => {
      throw new NotBuilt('dashboardUrl');
    },
    accountStatus: refuse('accountStatus'),

    // Readers: Square Terminal by device code, tied to a Square location.
    createLocation: refuse('createLocation'),
    updateLocation: refuse('updateLocation'),
    connectionToken: refuse('connectionToken'),
    registerReader: refuse('registerReader'),
    presentOnReader: refuse('presentOnReader'),
    clearReader: refuse('clearReader'),

    // Payments: delayed capture (autocomplete false), UpdatePayment for tips, CancelPayment, RefundPayment.
    createPayment: refuse('createPayment'),
    getPayment: refuse('getPayment'),
    raiseAuthorisation: refuse('raiseAuthorisation'),
    capture: refuse('capture'),
    cancel: refuse('cancel'),
    refund: refuse('refund'),

    // Deposits: Payouts API and payout entries.
    getPayout: refuse('getPayout'),
    listPayouts: refuse('listPayouts'),
    payoutItems: refuse('payoutItems'),
    balanceItems: refuse('balanceItems'),
  };
}
