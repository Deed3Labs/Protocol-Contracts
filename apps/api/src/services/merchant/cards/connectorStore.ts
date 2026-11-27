import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../../db/db.js';
import type { CardProviderName, ConnectorAccountStatus } from './connector.js';

/** merchant.card_connectors: one live row per shop, and every disconnected one kept. */

export interface ConnectorRow {
  id: string;
  merchant: string;
  provider: CardProviderName;
  external_account_id: string;
  charges_enabled: boolean;
  details_submitted: boolean;
  terminal_location_id: string | null;
  status_at: Date | string | null;
  updated_at: Date | string;
  disconnected_at: Date | string | null;
}

export const connectorStore = {
  /** The shop's connector, if it has one connected. */
  async live(q: Queryable, merchant: string): Promise<ConnectorRow | null> {
    const { rows } = await q.query<ConnectorRow>(
      'SELECT * FROM merchant.card_connectors WHERE merchant = $1 AND disconnected_at IS NULL',
      [merchant],
    );
    return rows[0] ?? null;
  },

  /** The live connector, or failing that the most recently disconnected one. */
  async latest(q: Queryable, merchant: string): Promise<ConnectorRow | null> {
    const { rows } = await q.query<ConnectorRow>(
      `SELECT * FROM merchant.card_connectors WHERE merchant = $1
        ORDER BY (disconnected_at IS NULL) DESC, created_at DESC LIMIT 1`,
      [merchant],
    );
    return rows[0] ?? null;
  },

  async count(q: Queryable, merchant: string): Promise<number> {
    const { rows } = await q.query<{ n: number | string }>('SELECT count(*) AS n FROM merchant.card_connectors WHERE merchant = $1', [merchant]);
    return Number(rows[0]?.n ?? 0);
  },

  async insert(q: Queryable, input: { merchant: string; provider: CardProviderName; externalAccountId: string; connectedBy: string | null }): Promise<ConnectorRow> {
    const { rows } = await q.query<ConnectorRow>(
      `INSERT INTO merchant.card_connectors (id, merchant, provider, external_account_id, connected_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [`cc_${randomUUID()}`, input.merchant, input.provider, input.externalAccountId, input.connectedBy],
    );
    return rows[0]!;
  },

  /**
   * What the processor says about an account, as of `at`. Applied only to a live connector, and
   * only if it's at least as new as what's stored: webhooks arrive out of order, and a late one
   * mustn't undo a newer status or bring a disconnected account back.
   */
  async applyStatus(
    q: Queryable,
    input: { provider: CardProviderName; externalAccountId: string; at: Date } & ConnectorAccountStatus,
  ): Promise<boolean> {
    const { rows } = await q.query<{ id: string }>(
      `UPDATE merchant.card_connectors
          SET charges_enabled = $3, details_submitted = $4, status_at = $5, updated_at = now()
        WHERE provider = $1 AND external_account_id = $2 AND disconnected_at IS NULL
          AND (status_at IS NULL OR status_at <= $5)
        RETURNING id`,
      [input.provider, input.externalAccountId, input.chargesEnabled, input.detailsSubmitted, input.at.toISOString()],
    );
    return rows.length > 0;
  },

  /** The merchant disconnected. Cards lock; the row and everything that points at it stay. */
  async markDisconnected(q: Queryable, input: { provider: CardProviderName; externalAccountId: string; at: Date }): Promise<boolean> {
    const { rows } = await q.query<{ id: string }>(
      `UPDATE merchant.card_connectors
          SET disconnected_at = $3, charges_enabled = false, updated_at = now()
        WHERE provider = $1 AND external_account_id = $2 AND disconnected_at IS NULL
        RETURNING id`,
      [input.provider, input.externalAccountId, input.at.toISOString()],
    );
    return rows.length > 0;
  },
};
