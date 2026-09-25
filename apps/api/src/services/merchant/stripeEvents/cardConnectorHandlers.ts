import type Stripe from 'stripe';
import { connectorStore } from '../cards/connectorStore.js';
import type { Handlers } from './inbox.js';

/**
 * Connect events about a shop's own Stripe account (card-processing prompt, Phase 3).
 *
 * Both identify the account by the event's top-level `account` (docs.stripe.com/connect/webhooks).
 * Neither creates a connector: an event for an account no shop connected through us changes nothing.
 */
export const cardConnectorHandlers: Handlers = {
  /** Charges enabled and details submitted, as of when Stripe raised the event. */
  'account.updated': async (tx, event) => {
    const account = event.data.object as Stripe.Account;
    await connectorStore.applyStatus(tx, {
      provider: 'stripe',
      externalAccountId: event.account ?? account.id,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
      at: new Date(event.created * 1000),
    });
  },

  /**
   * The merchant disconnected Clear from their Stripe account. Cards lock straight away, and every
   * tender, reader and deposit that points at this connector keeps pointing at it.
   */
  'account.application.deauthorized': async (tx, event) => {
    if (!event.account) return;
    await connectorStore.markDisconnected(tx, {
      provider: 'stripe',
      externalAccountId: event.account,
      at: new Date(event.created * 1000),
    });
  },
};
