import type { CardAvailability } from '@clear/merchant-contracts';
import type { ConnectorRow } from './connectorStore.js';

/**
 * The one flag the app reads (card-processing prompt, Phase 3): cards are open only when the shop
 * has a connected account that can take charges. Everything else is locked, with the reason for the
 * Settings copy.
 */
export function cardAvailability(latest: Pick<ConnectorRow, 'charges_enabled' | 'details_submitted' | 'disconnected_at'> | null): CardAvailability {
  if (!latest) return { available: false, reason: 'not_connected' };
  if (latest.disconnected_at) return { available: false, reason: 'disconnected' };
  if (latest.charges_enabled) return { available: true };
  if (!latest.details_submitted) return { available: false, reason: 'details_pending' };
  return { available: false, reason: 'charges_disabled' };
}
