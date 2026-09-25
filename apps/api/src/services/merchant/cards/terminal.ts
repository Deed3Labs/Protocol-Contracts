import { randomUUID } from 'node:crypto';
import type { Reader } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import type { CardConnectorProvider } from './connector.js';
import { type ConnectorRow, connectorStore } from './connectorStore.js';

/**
 * Readers and what the reader SDKs need (card-processing prompt, Phases 4 and 5): the shop's one
 * reader location, connection tokens scoped to it, smart readers registered by code, and M2 and Tap
 * to Pay readers recorded once the installed app connects them.
 */

export class TerminalError extends Error {
  constructor(
    message: string,
    readonly code: 'cards_unavailable' | 'address_needed' | 'reader_unknown',
  ) {
    super(message);
    this.name = 'TerminalError';
  }
}

/** The shop's live connector, if it can take cards. */
export async function takingCards(q: Queryable, merchant: string): Promise<ConnectorRow> {
  const live = await connectorStore.live(q, merchant);
  if (!live || !live.charges_enabled) throw new TerminalError('This shop is not set up to take cards', 'cards_unavailable');
  return live;
}

/**
 * The shop's reader location on its own processor account, made the first time it's needed. Uses
 * the shop's address, which is also what sales tax is worked out from.
 */
export async function ensureLocation(db: Db, provider: CardConnectorProvider, merchant: string): Promise<{ connector: ConnectorRow; locationId: string }> {
  const connector = await takingCards(db, merchant);
  if (connector.terminal_location_id) return { connector, locationId: connector.terminal_location_id };

  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`terminal_location:${merchant}`]);
    const { rows } = await tx.query<ConnectorRow & { terminal_location_id: string | null }>(
      'SELECT * FROM merchant.card_connectors WHERE id = $1',
      [connector.id],
    );
    const current = rows[0]!;
    if (current.terminal_location_id) return { connector: current, locationId: current.terminal_location_id };

    const { rows: shops } = await tx.query<{
      name: string;
      address_line1: string | null;
      address_line2: string | null;
      address_city: string | null;
      address_region: string | null;
      address_postal_code: string | null;
      address_country: string;
    }>('SELECT * FROM merchant.profiles WHERE merchant = $1', [merchant]);
    const shop = shops[0]!;
    if (!shop.address_line1 || !shop.address_city || !shop.address_region || !shop.address_postal_code) {
      throw new TerminalError('Add the shop’s address in Settings first: card readers and sales tax both need it', 'address_needed');
    }
    const { locationId } = await provider.createLocation(connector.external_account_id, {
      name: shop.name,
      address: {
        line1: shop.address_line1,
        line2: shop.address_line2,
        city: shop.address_city,
        region: shop.address_region,
        postalCode: shop.address_postal_code,
        country: shop.address_country,
      },
    });
    await tx.query('UPDATE merchant.card_connectors SET terminal_location_id = $2, updated_at = now() WHERE id = $1', [connector.id, locationId]);
    return { connector: { ...current, terminal_location_id: locationId }, locationId };
  });
}

export async function connectionToken(db: Db, provider: CardConnectorProvider, merchant: string): Promise<{ secret: string }> {
  const { connector, locationId } = await ensureLocation(db, provider, merchant);
  return provider.connectionToken(connector.external_account_id, locationId);
}

interface ReaderRow {
  id: string;
  merchant: string;
  provider: 'stripe';
  type: Reader['type'];
  external_reader_id: string;
  label: string;
  location_id: string | null;
  last_seen_at: Date | string | null;
}

const toReader = (r: ReaderRow): Reader => ({
  id: r.id,
  shop: r.merchant,
  provider: r.provider,
  type: r.type,
  externalReaderId: r.external_reader_id,
  label: r.label,
  locationId: r.location_id,
  lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
});

export async function listReaders(q: Queryable, merchant: string): Promise<Reader[]> {
  const { rows } = await q.query<ReaderRow>('SELECT * FROM merchant.readers WHERE merchant = $1 AND removed_at IS NULL ORDER BY created_at', [merchant]);
  return rows.map(toReader);
}

/** A smart reader (S700, WisePOS E), registered on the shop's account with the code on its screen. */
export async function registerSmartReader(
  db: Db,
  provider: CardConnectorProvider,
  input: { merchant: string; registrationCode: string; label: string },
): Promise<Reader> {
  const { connector, locationId } = await ensureLocation(db, provider, input.merchant);
  const reader = await provider.registerReader(connector.external_account_id, { registrationCode: input.registrationCode, label: input.label, locationId });
  const { rows } = await db.query<ReaderRow>(
    `INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label, location_id, last_seen_at)
     VALUES ($1, $2, $3, $4, 'smart', $5, $6, $7, now())
     ON CONFLICT (merchant, provider, external_reader_id) WHERE removed_at IS NULL
     DO UPDATE SET label = EXCLUDED.label, location_id = EXCLUDED.location_id, last_seen_at = now()
     RETURNING *`,
    [`rdr_${randomUUID()}`, input.merchant, connector.id, provider.provider, reader.externalReaderId, reader.label, locationId],
  );
  return toReader(rows[0]!);
}

/**
 * An M2 or Tap to Pay reader the installed app has connected. The processor knows these by the SDK
 * connection, so this only records them, for the reader list and for which reader took a payment.
 * Recording the same one again just marks it seen.
 */
export async function recordReader(
  db: Db,
  input: { merchant: string; type: 'm2' | 'tap_to_pay'; externalReaderId: string; label: string; deviceId: string | null },
): Promise<Reader> {
  const connector = await takingCards(db, input.merchant);
  const { rows } = await db.query<ReaderRow>(
    `INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label, location_id, device_id, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (merchant, provider, external_reader_id) WHERE removed_at IS NULL
     DO UPDATE SET label = EXCLUDED.label, last_seen_at = now()
     RETURNING *`,
    [`rdr_${randomUUID()}`, input.merchant, connector.id, connector.provider, input.type, input.externalReaderId, input.label, connector.terminal_location_id, input.deviceId],
  );
  return toReader(rows[0]!);
}
