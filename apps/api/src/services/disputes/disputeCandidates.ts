import { getPayPool, getPostgresPool } from '../../config/postgres.js';
import type { DisputeKind } from './disputeStore.js';

/*
 * What a member can dispute: their most recent payment of each kind.
 *
 * Read on the server, from the tables that record each kind, and only ever the member's own rows.
 * The client is never trusted to say what a transaction was or how much it was for — a dispute is a
 * claim on money, so the amount and the name are copied from here into the dispute, not from the
 * request.
 *
 *   card    — an approved authorization still holding money (a voided one has nothing to dispute)
 *   partner — a charge from a Clear Partner the member approved
 *   member  — a send the member made to somebody else
 *
 * A payment that already has a live dispute is left out, so the same charge cannot be disputed twice.
 */

export interface DisputeCandidate {
  kind: DisputeKind;
  ref: string;
  label: string;
  amountCents: number;
  at: string;
}

/** Newest first, per kind. The modal shows the most recent of each, as the reference does. */
const PER_KIND = 5;

async function cardCandidates(wallet: string): Promise<DisputeCandidate[]> {
  const pool = getPayPool();
  if (!pool) return [];
  const { rows } = await pool.query<{
    transaction_token: string;
    amount_cents: string;
    net_cents: string | null;
    merchant: unknown;
    decided_at: Date;
  }>(
    `SELECT transaction_token, amount_cents, net_cents, merchant, decided_at
       FROM lithic_auth_decisions
      WHERE wallet = $1 AND result = 'APPROVED' AND COALESCE(net_cents, amount_cents) > 0
      ORDER BY decided_at DESC
      LIMIT $2`,
    [wallet, PER_KIND],
  ).catch(() => ({ rows: [] }));
  return rows.map((row) => {
    const merchant = (row.merchant ?? {}) as Record<string, unknown>;
    const name = typeof merchant.descriptor === 'string' && merchant.descriptor.trim() ? merchant.descriptor.trim() : 'Card purchase';
    return {
      kind: 'card' as const,
      ref: row.transaction_token,
      label: name,
      // What is still held is what is in dispute; a partial reversal has already given some back.
      amountCents: row.net_cents === null ? Number(row.amount_cents) : Number(row.net_cents),
      at: row.decided_at.toISOString(),
    };
  });
}

async function partnerCandidates(wallet: string): Promise<DisputeCandidate[]> {
  const pool = getPostgresPool();
  if (!pool) return [];
  const { rows } = await pool.query<{ code: string; merchant_name: string; amount_cents: string; created_at: Date }>(
    `SELECT code, merchant_name, amount_cents, created_at
       FROM charge_requests
      WHERE member_wallet = $1 AND status = 'approved'
      ORDER BY created_at DESC
      LIMIT $2`,
    [wallet, PER_KIND],
  ).catch(() => ({ rows: [] }));
  return rows.map((row) => ({
    kind: 'partner' as const,
    ref: row.code,
    label: row.merchant_name,
    amountCents: Number(row.amount_cents),
    at: row.created_at.toISOString(),
  }));
}

async function memberCandidates(wallet: string): Promise<DisputeCandidate[]> {
  const pool = getPostgresPool();
  if (!pool) return [];
  // principal_usdc is in USDC base units (6 decimals); cents are 4 of those places fewer.
  const { rows } = await pool.query<{ transfer_id: string; principal_usdc: string; memo: string | null; created_at: Date }>(
    `SELECT transfer_id, principal_usdc, memo, created_at
       FROM send_transfers
      WHERE LOWER(sender_wallet) = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [wallet, PER_KIND],
  ).catch(() => ({ rows: [] }));
  return rows.map((row) => ({
    kind: 'member' as const,
    ref: row.transfer_id,
    // The recipient is stored encrypted and is not decrypted just to draw a list. The memo is theirs.
    label: row.memo?.trim() ? `Send · ${row.memo.trim()}` : 'Send',
    amountCents: Math.round(Number(row.principal_usdc) / 10_000),
    at: row.created_at.toISOString(),
  }));
}

export async function disputeCandidates(wallet: string, exclude: Set<string>): Promise<DisputeCandidate[]> {
  const w = wallet.trim().toLowerCase();
  const [card, partner, member] = await Promise.all([cardCandidates(w), partnerCandidates(w), memberCandidates(w)]);
  return [...card, ...partner, ...member].filter((c) => !exclude.has(c.ref) && c.amountCents > 0);
}

/** One candidate, re-read from source — what a filing is checked against, never the client's copy. */
export async function findCandidate(
  wallet: string,
  kind: DisputeKind,
  ref: string,
): Promise<DisputeCandidate | null> {
  const w = wallet.trim().toLowerCase();
  const list = kind === 'card' ? await cardCandidates(w) : kind === 'partner' ? await partnerCandidates(w) : await memberCandidates(w);
  return list.find((c) => c.ref === ref) ?? null;
}
