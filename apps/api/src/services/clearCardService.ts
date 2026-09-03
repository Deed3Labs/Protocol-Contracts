import Stripe from 'stripe';
import { getPostgresPool } from '../config/postgres.js';

/*
 * Clear card (Bridge + Stripe Issuing) — P2 scaffold. FEATURE-FLAGGED: entirely inert until
 * STRIPE_SECRET_KEY is set, so nothing runs in prod/dev without real credentials.
 *
 * Model (per apidocs.bridge.xyz/platform/cards/overview/stripe-issuing):
 *  - Bridge manages the Cardholder: create/lookup a Bridge customer, request the "cards" endorsement
 *    (KYC), then read `stripe_cardholder_id` off the customer. The card debits the user's own wallet
 *    just-in-time from their on-chain USDC, via a one-time on-chain approval to Bridge's spender.
 *  - Card CRUD + secure display run through STRIPE: issuing.cards.create (linked to the cardholder),
 *    and an ephemeral key so the client renders the PAN/CVV in a PCI-compliant Stripe Issuing Element.
 *
 * TODO(bridge-access): the exact "cards" endorsement request/poll shape + the crypto_wallet linkage on
 * the card are confirmed with our Bridge implementation contact once the endorsement is enabled. Those
 * spots are marked below; until then ensureCardholder() returns { pending } and the UI shows "activating".
 */
const TABLE = 'clear_cards';

export interface ClearCardRecord {
  ownerWallet: string;
  bridgeCustomerId: string | null;
  stripeCardholderId: string | null;
  stripeCardId: string | null;
  status: string; // 'pending' | 'active' | 'inactive' | 'canceled'
  last4: string | null;
  brand: string | null;
}

let stripeClient: Stripe | null = null;

function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

export function isConfigured(): boolean {
  return !!stripe() && !!getPostgresPool();
}

let ensured = false;
async function ensureTable(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      owner_wallet TEXT PRIMARY KEY,
      bridge_customer_id TEXT,
      stripe_cardholder_id TEXT,
      stripe_card_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last4 TEXT,
      brand TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  ensured = true;
}

const norm = (w: string) => w.trim().toLowerCase();

function mapRow(r: Record<string, unknown>): ClearCardRecord {
  return {
    ownerWallet: String(r.owner_wallet),
    bridgeCustomerId: (r.bridge_customer_id as string) ?? null,
    stripeCardholderId: (r.stripe_cardholder_id as string) ?? null,
    stripeCardId: (r.stripe_card_id as string) ?? null,
    status: String(r.status ?? 'pending'),
    last4: (r.last4 as string) ?? null,
    brand: (r.brand as string) ?? null,
  };
}

export async function getCard(wallet: string): Promise<ClearCardRecord | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensureTable();
  const r = await pool.query(`SELECT * FROM ${TABLE} WHERE owner_wallet = $1 LIMIT 1`, [norm(wallet)]);
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

async function upsert(wallet: string, patch: Partial<ClearCardRecord>): Promise<ClearCardRecord> {
  const pool = getPostgresPool();
  if (!pool) throw new Error('DB not configured');
  await ensureTable();
  const r = await pool.query(
    `INSERT INTO ${TABLE} (owner_wallet, bridge_customer_id, stripe_cardholder_id, stripe_card_id, status, last4, brand)
       VALUES ($1,$2,$3,$4,COALESCE($5,'pending'),$6,$7)
     ON CONFLICT (owner_wallet) DO UPDATE SET
       bridge_customer_id = COALESCE(EXCLUDED.bridge_customer_id, ${TABLE}.bridge_customer_id),
       stripe_cardholder_id = COALESCE(EXCLUDED.stripe_cardholder_id, ${TABLE}.stripe_cardholder_id),
       stripe_card_id = COALESCE(EXCLUDED.stripe_card_id, ${TABLE}.stripe_card_id),
       status = COALESCE(EXCLUDED.status, ${TABLE}.status),
       last4 = COALESCE(EXCLUDED.last4, ${TABLE}.last4),
       brand = COALESCE(EXCLUDED.brand, ${TABLE}.brand),
       updated_at = now()
     RETURNING *`,
    [norm(wallet), patch.bridgeCustomerId ?? null, patch.stripeCardholderId ?? null, patch.stripeCardId ?? null, patch.status ?? null, patch.last4 ?? null, patch.brand ?? null],
  );
  return mapRow(r.rows[0]);
}

/**
 * Ensure a Stripe cardholder exists for this member via Bridge's "cards" endorsement.
 * TODO(bridge-access): wire the real Bridge customer create/lookup + cards-endorsement request + poll
 * for `stripe_cardholder_id` once the endorsement is enabled on our account. Until then this stays
 * pending so the flow is inert and the UI shows "activating soon".
 */
export async function ensureCardholder(
  wallet: string,
  _profile: { email: string | null; name: string | null },
): Promise<{ cardholderId: string | null; pending: boolean }> {
  const existing = await getCard(wallet);
  if (existing?.stripeCardholderId) return { cardholderId: existing.stripeCardholderId, pending: false };
  // TODO(bridge-access): POST /customers (+ request "cards" endorsement) → poll GET /customers/{id}
  // → stripe_cardholder_id. Store bridge_customer_id + stripe_cardholder_id via upsert().
  return { cardholderId: null, pending: true };
}

/** Issue a virtual card for a ready cardholder (Stripe Issuing). */
export async function issueCard(
  wallet: string,
  args: { cardholderId: string; walletAddress: string; chainId: number },
): Promise<ClearCardRecord> {
  const s = stripe();
  if (!s) throw new Error('Cards not configured');
  const card = await s.issuing.cards.create({
    cardholder: args.cardholderId,
    currency: 'usd',
    type: 'virtual',
    status: 'active',
    // TODO(bridge-access): attach Bridge's crypto_wallet linkage (chain/currency/address) per Bridge's
    // card-create contract so authorizations JIT-debit the user's USDC. Kept in metadata for now.
    metadata: { clear_wallet: args.walletAddress, clear_chain: String(args.chainId) },
  });
  return upsert(wallet, {
    stripeCardholderId: args.cardholderId,
    stripeCardId: card.id,
    status: card.status,
    last4: card.last4 ?? null,
    brand: card.brand ?? null,
  });
}

/**
 * Ephemeral key so the client can render the PAN/CVV in a Stripe Issuing Element. The Stripe.js issuing
 * flow requires a client-generated `nonce` (from stripe.createEphemeralKeyNonce) and the client's
 * Stripe.js apiVersion, both passed through here.
 */
export async function ephemeralKey(cardId: string, nonce: string, stripeApiVersion: string): Promise<string> {
  const s = stripe();
  if (!s) throw new Error('Cards not configured');
  const key = await s.ephemeralKeys.create(
    { issuing_card: cardId, nonce },
    { apiVersion: stripeApiVersion },
  );
  return key.secret as string;
}

/** Freeze / unfreeze. */
export async function setActive(wallet: string, cardId: string, active: boolean): Promise<ClearCardRecord> {
  const s = stripe();
  if (!s) throw new Error('Cards not configured');
  const card = await s.issuing.cards.update(cardId, { status: active ? 'active' : 'inactive' });
  return upsert(wallet, { status: card.status });
}
