import type { CardAvailability } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { cardAvailability } from './availability.js';
import type { CardConnectorProvider } from './connector.js';
import { connectorStore } from './connectorStore.js';

/**
 * Connecting a shop's card processor, and whether it can take cards (card-processing prompt,
 * Phase 3). Provider-neutral: the processor comes in as a CardConnectorProvider.
 */

export class CardsError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'no_shop',
  ) {
    super(message);
    this.name = 'CardsError';
  }
}

/** How stale a not-yet-enabled status may be before availability asks the processor again. */
export const STATUS_REFRESH_MS = 15_000;

/**
 * The link the owner follows to connect cards, or to finish connecting them.
 *
 * One account per shop, however many times the button is pressed: the check and the account's
 * creation happen under a per-shop lock, and the processor call carries an idempotency key, so a
 * retry after a crash between the two finds the same account instead of opening a second.
 */
export async function connectCards(
  db: Db,
  provider: CardConnectorProvider,
  input: { merchant: string; staffId: string; ownerEmail: string | null; appUrl: string },
): Promise<{ url: string }> {
  const connector = await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`card_connect:${input.merchant}`]);
    const live = await connectorStore.live(tx, input.merchant);
    if (live) return live;

    const { rows } = await tx.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
    if (!rows[0]) throw new CardsError('No shop for this merchant', 'no_shop');
    // A shop that disconnected and comes back gets a fresh account and a fresh key.
    const attempt = await connectorStore.count(tx, input.merchant);
    const { externalAccountId } = await provider.createAccount({
      merchant: input.merchant,
      businessName: rows[0].name,
      email: input.ownerEmail,
      idempotencyKey: `clear-card-connect:${input.merchant}:${attempt}`,
    });
    return connectorStore.insert(tx, {
      merchant: input.merchant,
      provider: provider.provider,
      externalAccountId,
      connectedBy: input.staffId,
    });
  });

  if (connector.charges_enabled && connector.details_submitted) {
    return { url: provider.dashboardUrl(connector.external_account_id) };
  }
  const pane = `${input.appUrl.replace(/\/+$/, '')}/settings/payments`;
  return provider.onboardingLink(connector.external_account_id, {
    returnUrl: `${pane}?cards=returned`,
    refreshUrl: `${pane}?cards=refresh`,
  });
}

/**
 * Can this shop take a card right now.
 *
 * Webhooks keep the stored status current, but an owner coming back from onboarding shouldn't have
 * to wait for one: while a connector isn't taking charges yet, a status older than a few seconds is
 * checked with the processor directly. A processor that can't be reached leaves the stored answer.
 */
export async function availabilityFor(db: Db, provider: CardConnectorProvider | null, merchant: string, now = new Date()): Promise<CardAvailability> {
  const latest = await connectorStore.latest(db, merchant);
  if (provider && latest && !latest.disconnected_at && !latest.charges_enabled && latest.provider === provider.provider) {
    const age = now.getTime() - new Date(latest.updated_at).getTime();
    if (age > STATUS_REFRESH_MS) {
      try {
        const status = await provider.accountStatus(latest.external_account_id);
        await connectorStore.applyStatus(db, { provider: provider.provider, externalAccountId: latest.external_account_id, at: now, ...status });
        return cardAvailability(await connectorStore.latest(db, merchant));
      } catch (error) {
        console.warn('Card status refresh failed; answering from the stored status:', error instanceof Error ? error.message : error);
      }
    }
  }
  return cardAvailability(latest);
}
