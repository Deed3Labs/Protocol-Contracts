import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { recordPoolMovements } from './poolFunding.js';

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
  'function repayCardSpend(bytes32 ref, address member, uint256 amount)',
  'function cardRepaymentOf(bytes32 ref) view returns (uint256)',
  'function totalDrawnOf(address member) view returns (uint256)',
  'function tierCount() view returns (uint256)',
  'function drawnOf(address member, uint256 tierId) view returns (uint256)',
  'function carryRecipientOf(uint256 tierId) view returns (address)',
  'function cardSettlementAccount() view returns (address)',
];

/**
 * `held`: a dispute is open, so the purchase is kept off the chain (or taken off it) and no carry
 * accrues on it. `waived`: the member won the dispute; it will never be issued.
 */
export type OnchainStatus = 'issued' | 'failed' | 'needs_review' | 'not_needed' | 'held' | 'waived';

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

/**
 * The ref for a row: its own token, or the token with a suffix once a dispute has put it back.
 *
 * Settlement is once per ref, for good reason, and a purchase taken off the chain for a dispute and
 * then put back after the member lost it is a second settlement. A fresh ref is what lets it be
 * issued again -- and issued NOW, so carry starts from the decision, not from the original swipe.
 */
export function refFor(transactionToken: string, onchainRef: string | null): string {
  return ethers.id(onchainRef || transactionToken);
}

/** Exported so dispute enforcement can make the first pass straight away. */
export async function ensureSettlementColumns(): Promise<void> {
  await ensureColumns();
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
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_ref TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS dispute_token TEXT;
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
      onchain_ref: string | null;
      dispute_token: string | null;
    }>(
      `SELECT wallet, result, status, draws, onchain_status, onchain_cents, onchain_attempts, onchain_ref, dispute_token
         FROM ${DECISIONS} WHERE transaction_token = $1`,
      [token],
    );
    const row = rows[0];
    // Only a settled approval becomes debt. Pending can still be voided; a decline never drew.
    if (!row || row.result !== 'APPROVED' || row.status !== 'SETTLED' || !row.wallet) {
      return { transactionToken: token, action: 'none' };
    }
    if (row.onchain_status === 'needs_review' || row.onchain_status === 'waived') {
      return { transactionToken: token, action: row.onchain_status === 'waived' ? 'none' : 'needs_review' };
    }

    /*
     * A disputed purchase is not issued while the dispute is open, so no carry can start on it. One
     * already on chain is taken off by dispute enforcement -- by exactly what is still owed on it,
     * which only enforcement knows -- so this leaves it alone rather than guessing.
     */
    if (row.dispute_token) {
      if (row.onchain_status !== 'issued' && row.onchain_status !== 'held') {
        await record(token, { status: 'held', cents: 0, error: null });
      }
      return { transactionToken: token, action: 'none' };
    }
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
    const ref = refFor(token, row.onchain_ref);

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
        await recordPoolMovements(await tx.wait(1));
        await record(token, { status: 'issued', cents: target, tx: tx.hash, error: null, attempt: true });
        console.log(`[card-settlement] ${token} issued ${target}c on chain for ${row.wallet} (${tx.hash})`);
        return { transactionToken: token, action: 'settled', txHash: tx.hash };
      }

      if (target < issued) {
        const tx = await issuer.reverseCardSpend(ref, BigInt(issued - target) * CENTS_TO_UNITS);
        await recordPoolMovements(await tx.wait(1));
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
        AND (onchain_status IS DISTINCT FROM 'issued' OR reconciled_at > onchain_at OR dispute_token IS NOT NULL)
      ORDER BY decided_at ASC
      LIMIT $1`,
    [limit],
  );
  const results: SettlementSync[] = [];
  for (const row of rows) results.push(await syncCardSettlement(row.transaction_token));
  return results;
}

// ---- Fiat repayment, netted on chain -------------------------------------------------------------

/*
 * A member who repays in fiat must not still owe it on chain.
 *
 * The card purchase was paid to the merchant in fiat from the co-op's float, and the matching claim
 * was minted to that float when it settled. A fiat repayment refills the float — the claim is
 * satisfied in dollars — so on chain the float's claim is burned against the member's debt with
 * `repayCardSpend`. Nothing is on-ramped: moving the dollars onto the chain only to move them back
 * off to refill the float would be two conversions for no change.
 *
 * Reconciled to a target rather than per deposit, the same way card holds are. Our ledger knows what
 * the member still owes; the chain knows what we settled there. What should remain on chain is what
 * they owe, less the part of it that has not reached the chain yet (holds still pending, and settled
 * purchases not yet issued). If the chain holds more than that, the difference is cleared. That
 * covers the common case of a member paying before a purchase has even settled: it settles, then it
 * is cleared on the next pass.
 *
 * Carry included. Carry accrued on the tiers is written into our ledger as it accrues (so a deposit
 * pays it, first) and measured on chain through the tiers' own figures, so a repayment that covers
 * carry clears carry too. The one exception is carry owed to a pool — see readCardDebt.
 */

const NETTING = 'card_repayment_netting';

let nettingEnsured = false;
async function ensureNetting(): Promise<void> {
  const pool = getPayPool();
  if (!pool || nettingEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${NETTING} (
      wallet TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ref TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tx TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (wallet, seq)
    );
  `);
  nettingEnsured = true;
}

export interface CardDebtPosition {
  /** What our ledger says the member owes: every credit tier, and carry. */
  offchainOwedCents: number;
  /** The part of that which has not reached the chain: pending holds, and settled-but-unissued. */
  notOnChainCents: number;
  /** What the member's tiers hold on chain right now, carry included. */
  onChainCents: number;
  /** How much to clear now. Zero when the chain is already right. */
  toClearCents: number;
}

/** The target, as a pure function so it can be tested without a database or a chain. */
export function cardDebtToClear(input: {
  offchainOwedCents: number;
  notOnChainCents: number;
  onChainCents: number;
}): CardDebtPosition {
  const onChainCents = Math.max(0, input.onChainCents);
  const shouldBeOnChain = Math.max(0, input.offchainOwedCents - input.notOnChainCents);
  return {
    offchainOwedCents: input.offchainOwedCents,
    notOnChainCents: input.notOnChainCents,
    onChainCents,
    toClearCents: Math.max(0, onChainCents - shouldBeOnChain),
  };
}

/*
 * Carry, from the chain's own figures.
 *
 * What the member's tiers hold is everything issued, less everything cleared, plus whatever carry
 * has accrued since. We know the first two, so the third falls out — and it includes carry that has
 * accrued but not yet been written onto the ledger, because `totalDrawnOf` reads through the index.
 *
 * This assumes the revolving tiers hold card debt only, which is true while the card is the only
 * thing that draws on them. A member spending StableCredit directly would draw here too, and that
 * draw would be read as carry; the day that path is live, this needs the issuer's own carry events.
 */
export function carryAccruedCents(input: { drawnCents: number; issuedCents: number; clearedCents: number }): number {
  return Math.max(0, input.drawnCents - input.issuedCents + input.clearedCents);
}

const LEDGER = 'lithic_ledger_entries';

/**
 * Write carry that has accrued on chain into our ledger, so a deposit can pay it.
 *
 * Reconciled to a lifetime total: the ledger's carry debits should add up to all the carry that has
 * ever accrued. The external id is that total, so running this twice at the same figure writes
 * nothing the second time.
 */
async function recordCarry(wallet: string, accruedCents: number): Promise<number> {
  const pool = getPayPool()!;
  const recorded = await pool
    .query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ${LEDGER}
        WHERE wallet = $1 AND account = 'member_credit_carry' AND direction = 'debit'`,
      [wallet],
    )
    .then((r) => Number(r.rows[0]?.total ?? 0));
  const add = accruedCents - recorded;
  if (add <= 0) return 0;
  const group = `carry:${wallet}:${accruedCents}`;
  await pool.query(
    `INSERT INTO ${LEDGER} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
     VALUES ($1, $2, 'member_credit_carry', 'debit', $3, 'chain', 'carry_accrual', $1, $4::jsonb),
            ($1, $2, 'coop_carry_receivable', 'credit', $3, 'chain', 'carry_accrual', $1, $4::jsonb)
     ON CONFLICT DO NOTHING`,
    [group, wallet, add, JSON.stringify({ accruedTotalCents: accruedCents })],
  );
  console.log(`[card-carry] ${wallet} recorded ${add}c of carry (lifetime ${accruedCents}c)`);
  return add;
}

async function readCardDebt(wallet: string, issuer: ethers.Contract): Promise<CardDebtPosition & { carryHeldElsewhere: boolean }> {
  const pool = getPayPool()!;

  /*
   * Per purchase: what is on chain for it (`onchain_cents`, whatever its status -- a disputed or won
   * purchase can still have a part on chain that the member had already paid), and what of its
   * credit has not reached the chain yet. A disputed purchase's unpaid part is set aside in its own
   * ledger accounts and taken off the chain, so it is left out of both.
   */
  const { rows } = await pool.query<{
    draws: unknown;
    onchain_status: string | null;
    onchain_cents: string | null;
    dispute_token: string | null;
  }>(
    `SELECT draws, onchain_status, onchain_cents, dispute_token FROM ${DECISIONS}
      WHERE wallet = $1 AND result = 'APPROVED'
        AND (COALESCE(net_cents, amount_cents) > 0 OR COALESCE(onchain_cents, 0) > 0)`,
    [wallet],
  );
  let notOnChain = 0;
  let issued = 0;
  for (const row of rows) {
    const onChainForRow = Number(row.onchain_cents ?? 0);
    issued += onChainForRow;
    if (row.dispute_token || row.onchain_status === 'waived' || row.onchain_status === 'held') continue;
    notOnChain += Math.max(0, creditCentsOf(row.draws) - (row.onchain_status === 'issued' ? onChainForRow : 0));
  }

  // Everything that came off the card tiers on chain: fiat netting, and repayments the member made
  // in USDC (what the tiers absorbed). Both lowered `drawn`, so both belong in `cleared`, or the
  // difference would read as carry.
  const netted = await pool
    .query<{ total: string }>(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ${NETTING} WHERE wallet = $1 AND status = 'done'`, [wallet])
    .then((r) => Number(r.rows[0]?.total ?? 0));
  const repaidInUsdc = await pool
    .query<{ total: string }>(`SELECT COALESCE(SUM(revolving_cents), 0) AS total FROM card_onchain_repayments WHERE wallet = $1`, [wallet])
    .then((r) => Number(r.rows[0]?.total ?? 0))
    .catch(() => 0);
  const cleared = netted + repaidInUsdc;

  const drawnCents = Number(((await issuer.totalDrawnOf(wallet)) as bigint) / CENTS_TO_UNITS);

  /*
   * Carry is cleared against the settlement account's claim, so it can only be cleared here when
   * that account is where the carry went. A tier funded by the LendingPool sends its carry to the
   * pool's depositors, who are owed on-chain money; that carry has to be paid in USDC, not netted.
   */
  const account = String(await issuer.cardSettlementAccount()).toLowerCase();
  let carryHeldElsewhere = false;
  const tiers = Number(await issuer.tierCount());
  for (let t = 0; t < tiers; t++) {
    const drawn = (await issuer.drawnOf(wallet, t)) as bigint;
    if (drawn === 0n) continue;
    if (String(await issuer.carryRecipientOf(t)).toLowerCase() !== account) carryHeldElsewhere = true;
  }

  const accrued = carryAccruedCents({ drawnCents, issuedCents: issued, clearedCents: cleared });
  if (!carryHeldElsewhere) await recordCarry(wallet, accrued);

  /*
   * What the member owes in our ledger, carry included, ignoring repayments made in USDC.
   *
   * Only FIAT repayments are netted against the float's claim, because only fiat refills the float.
   * A deposit on the Bridge rail lands as USDC in the member's own wallet; our ledger counts it as
   * paying the card debt, but the float got nothing, so burning the float's claim for it would be
   * wrong. That debt stays on chain until it is repaid there in USDC — the separate USDC path.
   */
  const owed = await pool
    .query<{ net: string }>(
      `SELECT COALESCE(SUM(GREATEST(net, 0)), 0) AS net FROM (
         SELECT SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END) AS net
           FROM ${LEDGER}
          WHERE wallet = $1 AND account LIKE 'member_credit_%' AND account NOT LIKE 'member_credit_disputed_%'
            AND NOT (direction = 'credit' AND event_type = 'credit_settlement' AND rail = 'chain')
          GROUP BY account) t`,
      [wallet],
    )
    .then((r) => Number(r.rows[0]?.net ?? 0));

  // Carry that belongs to the pool is left on chain rather than counted as clearable.
  const onChain = carryHeldElsewhere ? Math.max(0, issued - cleared) : drawnCents;
  return { ...cardDebtToClear({ offchainOwedCents: owed, notOnChainCents: notOnChain, onChainCents: onChain }), carryHeldElsewhere };
}

const walletsInFlight = new Set<string>();

export interface RepaymentSync {
  wallet: string;
  action: 'none' | 'cleared' | 'recovered' | 'failed' | 'needs_review' | 'skipped';
  cents?: number;
  txHash?: string;
  error?: string;
}

/** Bring a member's on-chain card debt down to what they still owe. Safe to call any time. */
export async function syncCardRepayment(walletInput: string): Promise<RepaymentSync> {
  const wallet = walletInput.trim().toLowerCase();
  if (!wallet || !isCardSettlementConfigured()) return { wallet, action: 'skipped' };
  if (walletsInFlight.has(wallet)) return { wallet, action: 'skipped' };
  walletsInFlight.add(wallet);

  try {
    await ensureColumns();
    await ensureNetting();
    const pool = getPayPool()!;
    const signer = new ethers.Wallet(settlerKey(), chainProvider(resolveChainId()));
    const issuer = issuerFor(signer);
    if (!issuer) return { wallet, action: 'skipped', error: 'No RevolvingIssuer address' };

    const position = await readCardDebt(wallet, issuer);
    if (position.carryHeldElsewhere) {
      console.warn(`[card-carry] ${wallet} has carry owed to a pool — left on chain, needs a USDC repayment`);
    }
    if (position.toClearCents <= 0) return { wallet, action: 'none' };

    // Resume an unfinished attempt under its own ref, so a retry can never clear twice.
    const open = await pool.query<{ seq: number; ref: string; attempts: number; status: string }>(
      `SELECT seq, ref, attempts, status FROM ${NETTING}
        WHERE wallet = $1 AND status IN ('pending', 'failed', 'needs_review')
        ORDER BY seq DESC LIMIT 1`,
      [wallet],
    );
    let attempt = open.rows[0];
    if (attempt?.status === 'needs_review') return { wallet, action: 'needs_review' };

    if (attempt) {
      const already = (await issuer.cardRepaymentOf(attempt.ref)) as bigint;
      if (already > 0n) {
        const cents = Number(already / CENTS_TO_UNITS);
        await pool.query(
          `UPDATE ${NETTING} SET status = 'done', amount_cents = $3, error = NULL, updated_at = now() WHERE wallet = $1 AND seq = $2`,
          [wallet, attempt.seq, cents],
        );
        return { wallet, action: 'recovered', cents };
      }
      await pool.query(`UPDATE ${NETTING} SET amount_cents = $3, updated_at = now() WHERE wallet = $1 AND seq = $2`, [
        wallet,
        attempt.seq,
        position.toClearCents,
      ]);
    } else {
      const next = await pool.query<{ seq: number }>(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM ${NETTING} WHERE wallet = $1`, [wallet]);
      const seq = Number(next.rows[0].seq);
      const ref = ethers.id(`card-repay:${wallet}:${seq}`);
      await pool.query(`INSERT INTO ${NETTING} (wallet, seq, ref, amount_cents) VALUES ($1, $2, $3, $4)`, [
        wallet,
        seq,
        ref,
        position.toClearCents,
      ]);
      attempt = { seq, ref, attempts: 0, status: 'pending' };
    }

    try {
      const tx = await issuer.repayCardSpend(attempt.ref, wallet, BigInt(position.toClearCents) * CENTS_TO_UNITS);
      await recordPoolMovements(await tx.wait(1));
      await pool.query(
        `UPDATE ${NETTING} SET status = 'done', tx = $3, error = NULL, attempts = attempts + 1, updated_at = now()
          WHERE wallet = $1 AND seq = $2`,
        [wallet, attempt.seq, tx.hash],
      );
      console.log(`[card-repayment] ${wallet} cleared ${position.toClearCents}c on chain (${tx.hash})`);
      return { wallet, action: 'cleared', cents: position.toClearCents, txHash: tx.hash };
    } catch (error) {
      const reason = reasonOf(error);
      const attempts = (attempt.attempts ?? 0) + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'needs_review' : 'failed';
      await pool.query(
        `UPDATE ${NETTING} SET status = $3, error = $4, attempts = $5, updated_at = now() WHERE wallet = $1 AND seq = $2`,
        [wallet, attempt.seq, status, reason, attempts],
      );
      console.error(`[card-repayment] ${wallet} ${status} (attempt ${attempts}): ${reason}`);
      return { wallet, action: status, error: reason };
    }
  } finally {
    walletsInFlight.delete(wallet);
  }
}

/** Every member with card debt on chain — the sweep's list for repayment netting. */
export async function walletsWithCardDebtOnChain(): Promise<string[]> {
  if (!isCardSettlementConfigured()) return [];
  await ensureColumns();
  const { rows } = await getPayPool()!.query<{ wallet: string }>(
    `SELECT DISTINCT wallet FROM ${DECISIONS} WHERE onchain_status = 'issued' AND wallet IS NOT NULL`,
  );
  return rows.map((r) => r.wallet);
}

// ---- Dispute enforcement's on-chain steps ----------------------------------------------------------

async function settlerIssuer(): Promise<ethers.Contract> {
  const signer = new ethers.Wallet(settlerKey(), chainProvider(resolveChainId()));
  const issuer = issuerFor(signer);
  if (!issuer) throw new Error('No RevolvingIssuer address');
  return issuer;
}

/**
 * Take a disputed purchase's unpaid part off the chain, so no carry accrues on it while it is open.
 * By an exact amount, which enforcement works out from what is still owed on the purchase: a part
 * the member already paid has been cleared on chain and is not there to take off.
 */
export async function reverseForDispute(transactionToken: string, cents: number): Promise<string | null> {
  if (cents <= 0 || !isCardSettlementConfigured()) return null;
  await ensureColumns();
  const pool = getPayPool()!;
  const { rows } = await pool.query<{ onchain_ref: string | null; onchain_cents: string | null }>(
    `SELECT onchain_ref, onchain_cents FROM ${DECISIONS} WHERE transaction_token = $1`,
    [transactionToken],
  );
  const row = rows[0];
  if (!row) return null;
  const issuer = await settlerIssuer();
  const tx = await issuer.reverseCardSpend(refFor(transactionToken, row.onchain_ref), BigInt(cents) * CENTS_TO_UNITS);
  await recordPoolMovements(await tx.wait(1));
  const left = Math.max(0, Number(row.onchain_cents ?? 0) - cents);
  await record(transactionToken, { status: 'held', cents: left, tx: tx.hash, error: null, attempt: true });
  console.log(`[card-settlement] ${transactionToken} ${cents}c taken off chain for a dispute (${tx.hash})`);
  return tx.hash;
}

/**
 * Put a disputed purchase's part back on chain after the member lost or withdrew, under a fresh ref
 * so it is issued NOW: carry starts from the decision, and the time in dispute costs nothing.
 */
export async function reissueAfterDispute(transactionToken: string, cents: number, freshRef: string): Promise<string | null> {
  if (cents <= 0 || !isCardSettlementConfigured()) return null;
  await ensureColumns();
  const pool = getPayPool()!;
  const { rows } = await pool.query<{ wallet: string; onchain_cents: string | null }>(
    `SELECT wallet, onchain_cents FROM ${DECISIONS} WHERE transaction_token = $1`,
    [transactionToken],
  );
  const row = rows[0];
  if (!row) return null;
  const issuer = await settlerIssuer();
  const ref = ethers.id(freshRef);
  const [member] = (await issuer.cardSettlementOf(ref)) as [string, bigint];
  let hash: string | null = null;
  if (member === ethers.ZeroAddress) {
    const tx = await issuer.settleCardSpend(ref, row.wallet, BigInt(cents) * CENTS_TO_UNITS);
    await recordPoolMovements(await tx.wait(1));
    hash = tx.hash;
  }
  await pool.query(
    `UPDATE ${DECISIONS} SET onchain_status = 'issued', onchain_cents = COALESCE(onchain_cents, 0) + $2,
            onchain_ref = $3, onchain_tx = COALESCE($4, onchain_tx), onchain_error = NULL, onchain_at = now()
      WHERE transaction_token = $1`,
    [transactionToken, cents, freshRef, hash],
  );
  console.log(`[card-settlement] ${transactionToken} ${cents}c back on chain after a dispute (${hash ?? 'already there'})`);
  return hash;
}
