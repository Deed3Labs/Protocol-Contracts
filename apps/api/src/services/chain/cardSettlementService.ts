import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';

/*
 * A settled card purchase becomes debt on chain — build plan §4, step 4.
 *
 * Until this existed, a card charge was only ever a HOLD. It was recorded in our own ledger at
 * authorization and adjusted when it settled, but nothing reached the contracts: the member's line
 * never drew, no StableCredit was issued, and carry — which accrues on a tier's position — never
 * started. The build plan said issuance happens at settlement; nothing did it.
 *
 * So at settlement the CREDIT part of the purchase is drawn on the RevolvingIssuer through
 * `settleCardSpend`, which fills the tiers cheapest first and records the purchase on the ledger
 * with the claim going to the co-op's card float. The cash part is the member's own money and is not
 * issued as credit.
 *
 * Three rules make this safe to run from a webhook and a retry loop at once:
 *
 *   Once per purchase, enforced by the contract. The ref is the hashed Lithic transaction token, and
 *   the issuer refuses a second settlement of the same ref — so a redelivered webhook or a retry that
 *   raced one cannot draw twice. Before sending we also ask the contract whether it already has it,
 *   which turns a lost receipt into a recorded success rather than a wasted transaction.
 *
 *   Stored outcome, never silence. Every attempt writes what happened beside the transaction: the
 *   transaction hash on success, the error and a count on failure. After five failures it stops
 *   retrying and says `needs_review`, because a purchase the line cannot hold is a person's problem,
 *   not a loop's.
 *
 *   The chain's split is the true one. The contract draws its own tiers cheapest first, which may
 *   not match how our hold split the charge. Once issued, the hold's credit part stops being shown as
 *   pending (see heldDrawsByTier) — the chain is carrying it now, and counting both would show the
 *   member the same purchase twice.
 *
 * Refunds after settlement run the other way: when a settled purchase's credit part falls, the
 * difference is given back with `reverseCardSpend`.
 */

const DECISIONS = 'lithic_auth_decisions';
const MAX_ATTEMPTS = 5;
/** Ledger units are the reserve token's six decimals; cents are two. */
const CENTS_TO_UNITS = 10n ** 4n;

const ISSUER_ABI = [
  'function settleCardSpend(bytes32 ref, address member, uint256 amount)',
  'function reverseCardSpend(bytes32 ref, uint256 amount)',
  'function cardSettlementOf(bytes32 ref) view returns (address member, uint256 amount)',
  'function isCardSettler(address) view returns (bool)',
];

export type OnchainStatus = 'issued' | 'failed' | 'needs_review' | 'not_needed';

export interface SettlementSync {
  transactionToken: string;
  action: 'none' | 'settled' | 'recovered' | 'reversed' | 'failed' | 'needs_review' | 'skipped';
  txHash?: string;
  error?: string;
}

function resolveChainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

function settlerKey(): string {
  return (process.env.CARD_SETTLER_PRIVATE_KEY || '').trim();
}

export function isCardSettlementConfigured(): boolean {
  return settlerKey().length > 0 && Boolean(getPayPool());
}

/** The ref the contract keys a purchase by. Hashed so the on-chain record carries no Lithic id. */
export function refOf(transactionToken: string): string {
  return ethers.id(transactionToken);
}

/** The credit part of a hold — everything not drawn from the member's own cash. */
export function creditCentsOf(draws: unknown): number {
  if (!Array.isArray(draws)) return 0;
  let total = 0;
  for (const draw of draws as Array<{ source?: unknown; amountCents?: unknown }>) {
    const cents = Number(draw?.amountCents ?? 0);
    if (String(draw?.source ?? 'cash') !== 'cash' && Number.isFinite(cents) && cents > 0) total += cents;
  }
  return Math.round(total);
}

let ensured = false;
async function ensureColumns(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_status TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_cents BIGINT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_tx TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_error TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_at TIMESTAMPTZ;
  `);
  ensured = true;
}

function issuerFor(signerOrProvider: ethers.Signer | ethers.Provider): ethers.Contract | null {
  const address = getContractAddress(resolveChainId(), 'RevolvingIssuer');
  return address ? new ethers.Contract(address, ISSUER_ABI, signerOrProvider) : null;
}

/** Why a call failed, short enough to store and specific enough to act on. */
function reasonOf(error: unknown): string {
  const e = error as { shortMessage?: string; reason?: string; message?: string; revert?: { name?: string } };
  return (e?.revert?.name || e?.reason || e?.shortMessage || e?.message || String(error)).slice(0, 400);
}

async function record(
  token: string,
  fields: { status: OnchainStatus | null; cents?: number | null; tx?: string | null; error?: string | null; attempt?: boolean },
): Promise<void> {
  const pool = getPayPool();
  if (!pool) return;
  await pool.query(
    `UPDATE ${DECISIONS}
        SET onchain_status = $2,
            onchain_cents = COALESCE($3, onchain_cents),
            onchain_tx = COALESCE($4, onchain_tx),
            onchain_error = $5,
            onchain_attempts = onchain_attempts + $6,
            onchain_at = now()
      WHERE transaction_token = $1`,
    [token, fields.status, fields.cents ?? null, fields.tx ?? null, fields.error ?? null, fields.attempt ? 1 : 0],
  );
}

/** One purchase at a time in this process; the contract's once-only rule covers other processes. */
const inFlight = new Set<string>();

/**
 * Bring one transaction's on-chain position in line with what settled.
 *
 * Safe to call on every event and from the sweep: it compares what the chain should hold with what
 * we recorded it holding, and does nothing when they agree.
 */
export async function syncCardSettlement(transactionToken: string): Promise<SettlementSync> {
  const token = transactionToken.trim();
  if (!token || !isCardSettlementConfigured()) return { transactionToken: token, action: 'skipped' };
  if (inFlight.has(token)) return { transactionToken: token, action: 'skipped' };
  inFlight.add(token);

  try {
    await ensureColumns();
    const pool = getPayPool()!;
    const { rows } = await pool.query<{
      wallet: string | null;
      result: string;
      status: string | null;
      draws: unknown;
      onchain_status: string | null;
      onchain_cents: string | null;
      onchain_attempts: number;
    }>(
      `SELECT wallet, result, status, draws, onchain_status, onchain_cents, onchain_attempts
         FROM ${DECISIONS} WHERE transaction_token = $1`,
      [token],
    );
    const row = rows[0];
    // Only a settled approval becomes debt. Pending can still be voided; a decline never drew.
    if (!row || row.result !== 'APPROVED' || row.status !== 'SETTLED' || !row.wallet) {
      return { transactionToken: token, action: 'none' };
    }
    if (row.onchain_status === 'needs_review') return { transactionToken: token, action: 'needs_review' };

    const target = creditCentsOf(row.draws);
    const issued = row.onchain_status === 'issued' ? Number(row.onchain_cents ?? 0) : 0;

    if (target === issued) {
      if (target === 0 && row.onchain_status !== 'not_needed' && row.onchain_status !== 'issued') {
        // Paid entirely from cash: nothing to issue, and saying so stops the sweep asking again.
        await record(token, { status: 'not_needed', cents: 0 });
      }
      return { transactionToken: token, action: 'none' };
    }

    const signer = new ethers.Wallet(settlerKey(), chainProvider(resolveChainId()));
    const issuer = issuerFor(signer);
    if (!issuer) return { transactionToken: token, action: 'skipped', error: 'No RevolvingIssuer address' };
    const ref = refOf(token);

    try {
      if (issued === 0) {
        // A settlement that landed before we could record it is a success, not a retry.
        const [member, amount] = (await issuer.cardSettlementOf(ref)) as [string, bigint];
        if (member !== ethers.ZeroAddress) {
          const cents = Number(amount / CENTS_TO_UNITS);
          await record(token, { status: 'issued', cents, error: null });
          return { transactionToken: token, action: 'recovered' };
        }
        const tx = await issuer.settleCardSpend(ref, row.wallet, BigInt(target) * CENTS_TO_UNITS);
        await tx.wait(1);
        await record(token, { status: 'issued', cents: target, tx: tx.hash, error: null, attempt: true });
        console.log(`[card-settlement] ${token} issued ${target}c on chain for ${row.wallet} (${tx.hash})`);
        return { transactionToken: token, action: 'settled', txHash: tx.hash };
      }

      if (target < issued) {
        const tx = await issuer.reverseCardSpend(ref, BigInt(issued - target) * CENTS_TO_UNITS);
        await tx.wait(1);
        await record(token, { status: 'issued', cents: target, tx: tx.hash, error: null, attempt: true });
        console.log(`[card-settlement] ${token} gave back ${issued - target}c on chain (${tx.hash})`);
        return { transactionToken: token, action: 'reversed', txHash: tx.hash };
      }

      // Settled for more than was issued. The contract settles a purchase once, so the difference
      // cannot be added by this path — it needs a person, not another attempt.
      await record(token, {
        status: 'needs_review',
        error: `settled credit rose from ${issued}c to ${target}c after issuance`,
      });
      return { transactionToken: token, action: 'needs_review' };
    } catch (error) {
      const reason = reasonOf(error);
      const attempts = (row.onchain_attempts ?? 0) + 1;
      const status: OnchainStatus = attempts >= MAX_ATTEMPTS ? 'needs_review' : 'failed';
      await record(token, { status, error: reason, attempt: true });
      console.error(`[card-settlement] ${token} ${status} (attempt ${attempts}): ${reason}`);
      return { transactionToken: token, action: status, error: reason };
    }
  } finally {
    inFlight.delete(token);
  }
}

/**
 * Settled purchases whose chain position may not match yet: never attempted, failed, or issued and
 * since refunded. Bounded, oldest first, so a backlog drains rather than starving.
 */
export async function sweepCardSettlements(limit = 25): Promise<SettlementSync[]> {
  if (!isCardSettlementConfigured()) return [];
  await ensureColumns();
  const pool = getPayPool()!;
  const { rows } = await pool.query<{ transaction_token: string }>(
    `SELECT transaction_token FROM ${DECISIONS}
      WHERE result = 'APPROVED' AND status = 'SETTLED'
        AND (onchain_status IS NULL OR onchain_status IN ('failed', 'issued'))
        AND (onchain_status IS DISTINCT FROM 'issued' OR reconciled_at > onchain_at)
      ORDER BY decided_at ASC
      LIMIT $1`,
    [limit],
  );
  const results: SettlementSync[] = [];
  for (const row of rows) results.push(await syncCardSettlement(row.transaction_token));
  return results;
}
