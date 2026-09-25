import type { Queryable } from '../../../db/db.js';
import type { CardConnectorProvider, CardProviderName } from './connector.js';
import { defaultCardConnector } from './stripeConnector.js';

/**
 * Which card connectors this server has (card-processing prompt, Phase 9). Routes and jobs ask here
 * rather than importing a processor's connector, so a shop is served by the connector it actually
 * connected with, and a second provider is one entry below rather than a change at every call site.
 *
 * Square has a stub (squareConnector.ts) and a note on what building it takes (SQUARE.md). It isn't
 * handed out until it's built: a shop can't be offered a processor whose every call would fail.
 */

const FACTORIES: Record<CardProviderName, () => CardConnectorProvider | null> = {
  stripe: defaultCardConnector,
  square: () => null,
};

let overrides: Partial<Record<CardProviderName, CardConnectorProvider | null>> | null = null;

/** The named connector, or null when it isn't configured on this server. */
export function cardConnector(name: CardProviderName): CardConnectorProvider | null {
  if (overrides && name in overrides) return overrides[name] ?? null;
  return FACTORIES[name]();
}

/** Every configured connector: what the jobs run over (capture safety, payouts, reconciliation). */
export function cardConnectors(): CardConnectorProvider[] {
  return (Object.keys(FACTORIES) as CardProviderName[]).map(cardConnector).filter((c): c is CardConnectorProvider => c !== null);
}

/** The processor a shop connecting for the first time is sent to. */
export function connectorForNewShops(): CardConnectorProvider | null {
  return cardConnector('stripe');
}

/**
 * The connector a shop takes cards through: its live connection's provider, or the one for new
 * shops when it hasn't connected. Null when that provider isn't configured here.
 */
export async function connectorForShop(q: Queryable, merchant: string): Promise<CardConnectorProvider | null> {
  const { rows } = await q.query<{ provider: CardProviderName }>(
    'SELECT provider FROM merchant.card_connectors WHERE merchant = $1 AND disconnected_at IS NULL',
    [merchant],
  );
  return rows[0] ? cardConnector(rows[0].provider) : connectorForNewShops();
}

/** Tests: stand in connectors by name. `null` restores the configured ones. */
export function setCardConnectorsForTest(next: Partial<Record<CardProviderName, CardConnectorProvider | null>> | null): void {
  overrides = next;
}
