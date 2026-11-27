import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { CHAIN_ERROR_FRAGMENTS, chainErrorReason, decodeChainError, describeCardRefusal } from './chainErrors.js';
import { syncClrusdEncumbrance } from './encumbranceSync.js';
import { notificationStore } from '../notificationStore.js';
import { coveredBorrowerOf, ensureAuthTables, recordCreditFeeReversal } from '../lithic/authStore.js';
import { releaseDraws, type Draw } from '../lithic/authDecision.js';
import {
  creditFeeSettings,
  feeDrawsLeft,
  heldFeeCents,
  liveFeeCents,
  setChainMaxCardCreditFee,
  type CreditFeeStatus,
} from '../lithic/cardCreditFee.js';

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
 *
 * The card credit fee (decision 55). A purchase that carried one at the swipe settles with
 * `settleCardSpendWithFee`, which draws the purchase and the fee together; everything else settles
 * with `settleCardSpend` exactly as before. The fee is charged only while the chain still accepts it
 * (`maxCardCreditFee`): one it no longer accepts is waived and the purchase settles without it,
 * rather than failing a purchase over 30¢. A full refund after settlement brings the purchase to
 * zero and the contract gives the fee back on that reversal; a partial one keeps it.
 *
 * Authorized first (audit M-2). Settlement may draw only up to an authorization recorded for the
 * same ref and member, while the member was in good standing, within a per-purchase cap
 * (`cardTxCap`) and a per-day cap. The Auth Stream answers Lithic from a snapshot and never calls
 * out, so the authorization is recorded on chain straight after it answers (`authorizeCardOnChain`);
 * settlement records it then if that did not land. A refusal (frozen or defaulted member, a cap, no
 * room on the line) is stored as a sentence, and the purchase goes to a person rather than a loop.
 */

const DECISIONS = 'lithic_auth_decisions';
const MAX_ATTEMPTS = 5;
/** Ledger units are the reserve token's six decimals; cents are two. */
const CENTS_TO_UNITS = 10n ** 4n;

const ISSUER_ABI = [
  'function authorizeCardSpend(bytes32 ref, address member, uint256 amount)',
  'function cardAuthorizationOf(bytes32 ref) view returns (address member, uint256 amount)',
  'function settleCardSpend(bytes32 ref, address member, uint256 amount)',
  // Decision 55: the card credit fee. Before the RevolvingIssuer upgrade these revert.
  'function settleCardSpendWithFee(bytes32 ref, address member, uint256 amount, uint256 fee)',
  'function maxCardCreditFee() view returns (uint256)',
  // `returned` is the amount given back so far: returnCardCreditFee credits part or all of a fee
  // back (MB-04 §5.4(f)), and the full-refund return gives back whatever is left.
  'function cardCreditFeeOf(bytes32 ref) view returns (uint256 fee, uint256 returned)',
  'function returnCardCreditFee(bytes32 ref, uint256 amount)',
  'event CardCreditFeeCharged(bytes32 indexed ref, address indexed member, uint256 fee)',
  'event CardCreditFeeReturned(bytes32 indexed ref, address indexed member, uint256 fee)',
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
  // Phase 2b (12.7): card spending draws against Savings only within the member's own allowance.
  'function savingsDrawAllowance(address member) view returns (uint256)',
  'function tierAt(uint256 tierId) view returns (bytes32 kind, uint256 ratePerCycle, bool active)',
  'function headroomOf(address member, uint256 tierId) view returns (uint256)',
  // The custom errors, so a revert arrives decoded rather than as calldata.
  ...CHAIN_ERROR_FRAGMENTS,
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
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_auth_status TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_auth_cents BIGINT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_auth_tx TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS onchain_auth_error TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_draws JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_status TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_at TIMESTAMPTZ;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_target_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_returned_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_status TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_tx TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_error TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_attempts INTEGER NOT NULL DEFAULT 0;
  `);
  ensured = true;
}

/** Did the chain answer "no" (a revert), rather than fail to answer? */
function isRevert(error: unknown): boolean {
  return (error as { code?: string })?.code === 'CALL_EXCEPTION';
}

/**
 * The chain's bound on the card credit fee, in ledger units. A revert reads as zero: the
 * RevolvingIssuer before the upgrade has no such function, and has no fee. Anything else (a timeout,
 * a rate limit) is thrown, because "we could not ask" is not "no fee allowed".
 */
export async function readMaxCardCreditFee(issuer: ethers.Contract): Promise<bigint> {
  try {
    return BigInt(await issuer.maxCardCreditFee());
  } catch (error) {
    if (isRevert(error)) return 0n;
    throw error;
  }
}

/**
 * The fee the chain charged for a purchase, and how much of it has been given back, in ledger units.
 * A revert reads as none.
 */
export async function readCardCreditFee(issuer: ethers.Contract, ref: string): Promise<{ fee: bigint; returned: bigint }> {
  try {
    const [fee, returned] = (await issuer.cardCreditFeeOf(ref)) as [bigint, bigint];
    return { fee: BigInt(fee), returned: BigInt(returned) };
  } catch (error) {
    if (isRevert(error)) return { fee: 0n, returned: 0n };
    throw error;
  }
}

/**
 * Read `maxCardCreditFee` and cache it for the Auth Stream, which never calls out (decision 55).
 *
 * Off the authorization path: the card settlement sweeper runs this at startup and on every pass.
 * Nothing is read while the API's own setting is off, or while nothing can settle on chain (a fee
 * decided then could never be charged, so it must not be decided). An unreachable chain keeps the
 * last read until it ages out (cardCreditFee.ts), after which the fee is off until a read succeeds.
 */
export async function refreshCardCreditFeeCap(): Promise<bigint | null> {
  if (creditFeeSettings().cents <= 0 || !isCardSettlementConfigured()) return null;
  const issuer = issuerFor(chainProvider(resolveChainId()));
  if (!issuer) return null;
  try {
    const units = await readMaxCardCreditFee(issuer);
    setChainMaxCardCreditFee(units);
    return units;
  } catch (error) {
    console.warn('[card-credit-fee] maxCardCreditFee unreadable, keeping the last read:', chainErrorReason(error));
    return null;
  }
}

function issuerFor(signerOrProvider: ethers.ContractRunner): ethers.Contract | null {
  const address = getContractAddress(resolveChainId(), 'RevolvingIssuer');
  return address ? new ethers.Contract(address, ISSUER_ABI, signerOrProvider) : null;
}

/** Why a call failed, short enough to store and specific enough to act on. */
function reasonOf(error: unknown): string {
  return (describeCardRefusal(decodeChainError(error)) ?? chainErrorReason(error)).slice(0, 400);
}

/**
 * Phase 2b (12.7): when the line has no room, say whether it is because Savings count only as far as
 * the member authorized card spending against them. `authorizeCardSpend` takes the Savings tier's
 * room only up to `savingsDrawAllowance(member)`, so a member with savings and no allowance is
 * refused for "no room" while their savings sit there. Null when that is not the reason.
 */
export async function savingsAllowanceShort(issuer: ethers.Contract, member: string, error: unknown): Promise<string | null> {
  if (decodeChainError(error)?.name !== 'RevolvingIssuerCardHeadroom') return null;
  try {
    const count = Number(await issuer.tierCount());
    for (let i = 0; i < count; i++) {
      const [kind, , active] = (await issuer.tierAt(i)) as [string, bigint, boolean];
      if (!active || ethers.decodeBytes32String(kind) !== 'SAVINGS') continue;
      const [room, allowed] = (await Promise.all([issuer.headroomOf(member, i), issuer.savingsDrawAllowance(member)])) as [bigint, bigint];
      if (room <= allowed) return null;
      const dollars = (units: bigint) =>
        (Number(units / CENTS_TO_UNITS) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      return allowed === 0n
        ? `Savings can back card spending only once the member allows it, and they have not (${dollars(room)} of savings room unused). They can allow it in Settings.`
        : `Savings can back only ${dollars(allowed)} more of card spending, the amount the member allowed (${dollars(room)} of savings room). They can raise it in Settings.`;
    }
  } catch {
    /* the plain reason stands */
  }
  return null;
}

/** A card rule refused it: no retry will change that, so a person looks. */
function isCardRefusal(error: unknown): boolean {
  return describeCardRefusal(decodeChainError(error)) !== null;
}

/**
 * Make sure the chain holds an authorization for this ref and member before it is settled, and say
 * how much it allows.
 *
 * An authorization recorded at approval is used as it is. One that never landed is recorded now,
 * for what is being settled: the contract applies the same standing, cap and headroom checks either
 * way, so a late one can only be refused, never widen anything.
 */
async function ensureAuthorized(
  issuer: ethers.Contract,
  ref: string,
  member: string,
  units: bigint,
): Promise<{ authorized: bigint; tx?: string }> {
  const [authorizedFor, amount] = (await issuer.cardAuthorizationOf(ref)) as [string, bigint];
  if (authorizedFor !== ethers.ZeroAddress) {
    if (authorizedFor.toLowerCase() !== member.toLowerCase()) {
      throw new Error(`the authorization for this purchase names ${authorizedFor}, not ${member}`);
    }
    return { authorized: amount };
  }
  const tx = await issuer.authorizeCardSpend(ref, member, units);
  await tx.wait(1);
  return { authorized: units, tx: tx.hash };
}

async function record(
  token: string,
  fields: {
    status: OnchainStatus | null;
    cents?: number | null;
    tx?: string | null;
    error?: string | null;
    attempt?: boolean;
    /** The card credit fee's new state, when this step changed it. */
    feeStatus?: CreditFeeStatus | null;
    /** What the chain says has been given back of the fee, when this step read it. */
    feeReturnedCents?: number | null;
  },
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
            onchain_at = now(),
            fee_status = COALESCE($7, fee_status),
            fee_at = CASE WHEN $7::text IS NULL THEN fee_at ELSE now() END,
            fee_returned_cents = GREATEST(fee_returned_cents, COALESCE($8, 0))
      WHERE transaction_token = $1`,
    [
      token,
      fields.status,
      fields.cents ?? null,
      fields.tx ?? null,
      fields.error ?? null,
      fields.attempt ? 1 : 0,
      fields.feeStatus ?? null,
      fields.feeReturnedCents ?? null,
    ],
  );
}

/** The fee's draws, as stored. */
function feeDrawsOf(raw: unknown): Draw[] {
  return Array.isArray(raw) ? (raw as Draw[]).filter((d) => d && d.source !== 'cash' && Number(d.amountCents) > 0) : [];
}

type FeeRow = {
  wallet: string | null;
  card_token?: string | null;
  fee_draws: unknown;
  fee_returned_cents?: string | number | null;
};

/**
 * The fee is back in the member's books: waived at settlement, or returned with a full refund. Only
 * what is left of it: a part already credited back (returnCardCreditFee) was booked when it was.
 */
async function bookFeeReversal(
  token: string,
  row: FeeRow,
  eventType: 'card_credit_fee_waived' | 'card_credit_fee_returned',
): Promise<void> {
  const pool = getPayPool();
  if (!pool || !row.wallet) return;
  await ensureAuthTables();
  const left = feeDrawsLeft(feeDrawsOf(row.fee_draws), Number(row.fee_returned_cents ?? 0) || 0);
  await recordCreditFeeReversal(pool, row.wallet, token, row.card_token ?? null, left, eventType);
}

/** Whether the member is a covered borrower now (MB-04 §5.10). Unreadable reads as not covered. */
async function isCoveredBorrower(wallet: string): Promise<boolean> {
  return (await coveredBorrowerOf(wallet).catch(() => null)) === true;
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
      card_token: string | null;
      fee_cents: string | number | null;
      fee_draws: unknown;
      fee_status: string | null;
      fee_returned_cents: string | number | null;
    }>(
      `SELECT wallet, result, status, draws, onchain_status, onchain_cents, onchain_attempts, onchain_ref, dispute_token,
              card_token, fee_cents, fee_draws, fee_status, fee_returned_cents
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
    const feeCents = Number(row.fee_cents ?? 0) || 0;
    /*
     * A purchase refunded in full on chain whose fee was charged but not yet recorded as returned: the
     * reversal landed and the read of the fee after it did not. Asked of the chain, never assumed.
     */
    const feeReturnUnrecorded = target === 0 && issued === 0 && row.onchain_status === 'issued' && row.fee_status === 'charged';

    if (target === issued && !feeReturnUnrecorded) {
      if (target === 0 && row.onchain_status !== 'not_needed' && row.onchain_status !== 'issued') {
        // Paid entirely from cash: nothing to issue, and saying so stops the sweep asking again.
        await record(token, { status: 'not_needed', cents: 0 });
      }
      return { transactionToken: token, action: 'none' };
    }

    const signer = new ethers.Wallet(settlerKey(), chainProvider(resolveChainId()));
    const issuer = issuerFor(writesAs(signer));
    if (!issuer) return { transactionToken: token, action: 'skipped', error: 'No RevolvingIssuer address' };
    const ref = refFor(token, row.onchain_ref);

    try {
      if (feeReturnUnrecorded) {
        const feeStatus = await feeReturnedOnChain(issuer, ref, token, row);
        if (feeStatus) await record(token, { status: 'issued', error: null, feeStatus, feeReturnedCents: feeCents });
        return { transactionToken: token, action: feeStatus ? 'reversed' : 'none' };
      }

      if (issued === 0) {
        // A settlement that landed before we could record it is a success, not a retry.
        const [member, amount] = (await issuer.cardSettlementOf(ref)) as [string, bigint];
        if (member !== ethers.ZeroAddress) {
          const cents = Number(amount / CENTS_TO_UNITS);
          // The fee went with it or it did not, and the chain says which: never charged twice.
          let feeStatus: CreditFeeStatus | null = null;
          if (row.fee_status === 'held') {
            const { fee } = await readCardCreditFee(issuer, ref);
            feeStatus = fee > 0n ? 'charged' : 'waived';
            if (feeStatus === 'waived') await bookFeeReversal(token, row, 'card_credit_fee_waived');
          }
          await record(token, { status: 'issued', cents, error: null, feeStatus });
          return { transactionToken: token, action: 'recovered' };
        }
        // Only up to what was authorized for this purchase and member (audit M-2).
        const units = BigInt(target) * CENTS_TO_UNITS;
        /*
         * The card credit fee decided at the swipe, if the chain still takes it. Asked now rather
         * than trusted from the swipe: the bound can have been lowered since, and a fee above it
         * reverts. One the chain no longer accepts is waived, and the purchase settles without it.
         */
        const feeDue = row.fee_status === 'held' && feeCents > 0;
        let feeUnits = 0n;
        if (feeDue) {
          const wanted = BigInt(feeCents) * CENTS_TO_UNITS;
          const max = await readMaxCardCreditFee(issuer);
          // A member who became a covered borrower since the swipe pays none either (MB-04 §5.10).
          const covered = await isCoveredBorrower(row.wallet);
          if (max >= wanted && !covered) feeUnits = wanted;
          else console.warn(`[card-settlement] ${token} card credit fee ${feeCents}c waived: ${covered ? 'covered borrower' : `the chain allows ${max} units`}`);
        }
        const { authorized } = await ensureAuthorized(issuer, ref, row.wallet, units + feeUnits);
        if (authorized < units + feeUnits) {
          // Cleared above its authorization (a tip, a fuel pump). The chain settles a purchase once
          // and no further than it was approved, so the difference is a person's decision. The fee
          // is the one decided at the swipe: a higher clearing does not add another.
          await record(token, {
            status: 'needs_review',
            error:
              `settled credit ${target}c${feeUnits > 0n ? ` and its ${feeCents}c card credit fee` : ''} is more than the ` +
              `${Number(authorized / CENTS_TO_UNITS)}c authorized on chain`,
          });
          return { transactionToken: token, action: 'needs_review' };
        }
        const tx =
          feeUnits > 0n
            ? await issuer.settleCardSpendWithFee(ref, row.wallet, units, feeUnits)
            : await issuer.settleCardSpend(ref, row.wallet, units);
        await tx.wait(1);
        const feeStatus: CreditFeeStatus | null = feeDue ? (feeUnits > 0n ? 'charged' : 'waived') : null;
        if (feeStatus === 'waived') await bookFeeReversal(token, row, 'card_credit_fee_waived');
        await record(token, { status: 'issued', cents: target, tx: tx.hash, error: null, attempt: true, feeStatus });
        const withFee = feeStatus === 'charged' ? ` with a ${feeCents}c card credit fee` : '';
        console.log(`[card-settlement] ${token} issued ${target}c on chain for ${row.wallet}${withFee} (${tx.hash})`);
        // A draw on savings moves the CLRUSD lock: keep its last-known record current (audit M-3).
        await syncClrusdEncumbrance(resolveChainId(), row.wallet, writesAs(signer));
        return { transactionToken: token, action: 'settled', txHash: tx.hash };
      }

      if (target < issued) {
        const tx = await issuer.reverseCardSpend(ref, BigInt(issued - target) * CENTS_TO_UNITS);
        await tx.wait(1);
        // Brought to zero: the contract gave the fee back on this reversal. A partial refund keeps it.
        const feeStatus = target === 0 && row.fee_status === 'charged' ? await feeReturnedOnChain(issuer, ref, token, row) : null;
        await record(token, {
          status: 'issued',
          cents: target,
          tx: tx.hash,
          error: null,
          attempt: true,
          feeStatus,
          feeReturnedCents: feeStatus ? feeCents : null,
        });
        console.log(`[card-settlement] ${token} gave back ${issued - target}c on chain${feeStatus ? ' and its card credit fee' : ''} (${tx.hash})`);
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
      // A card rule saying no (standing, a cap, no room) says it again on every retry.
      const status: OnchainStatus = attempts >= MAX_ATTEMPTS || isCardRefusal(error) ? 'needs_review' : 'failed';
      await record(token, { status, error: reason, attempt: true });
      console.error(`[card-settlement] ${token} ${status} (attempt ${attempts}): ${reason}`);
      return { transactionToken: token, action: status, error: reason };
    }
  } finally {
    inFlight.delete(token);
  }
}

/**
 * After a reversal brought a purchase to zero: whether the contract gave its fee back, and if it did,
 * the books follow. Null when the chain does not say so (or could not be read): the fee stays charged
 * and the next pass asks again. Never throws, because the reversal itself has landed and must be
 * recorded whatever this read does.
 */
async function feeReturnedOnChain(
  issuer: ethers.Contract,
  ref: string,
  token: string,
  row: FeeRow,
): Promise<CreditFeeStatus | null> {
  /*
   * TODO(MB-04, the full-refund rule on carry): the fee is returned here, but carry that accrued on
   * the fee before the refund is not credited back, because no carry-credit mechanism exists on chain
   * yet (the contracts side is checking). When one does, credit that carry here too.
   */
  try {
    const { fee, returned } = await readCardCreditFee(issuer, ref);
    if (fee === 0n || returned < fee) {
      console.warn(`[card-settlement] ${token} refunded in full, but the chain has not returned its card credit fee`);
      return null;
    }
    await bookFeeReversal(token, row, 'card_credit_fee_returned');
    return 'returned';
  } catch (error) {
    console.warn(`[card-settlement] ${token} card credit fee return unread: ${chainErrorReason(error)}`);
    return null;
  }
}

/**
 * Settled purchases whose chain position may not match yet: never attempted, failed, or issued and
 * since refunded (or refunded in full with its fee's return not yet recorded). Bounded, oldest first,
 * so a backlog drains rather than starving.
 */
export async function sweepCardSettlements(limit = 25): Promise<SettlementSync[]> {
  if (!isCardSettlementConfigured()) return [];
  await ensureColumns();
  const pool = getPayPool()!;
  const { rows } = await pool.query<{ transaction_token: string }>(
    `SELECT transaction_token FROM ${DECISIONS}
      WHERE result = 'APPROVED' AND status = 'SETTLED'
        AND (onchain_status IS NULL OR onchain_status IN ('failed', 'issued'))
        AND (onchain_status IS DISTINCT FROM 'issued' OR reconciled_at > onchain_at OR dispute_token IS NOT NULL
             OR (fee_status = 'charged' AND COALESCE(onchain_cents, 0) = 0))
      ORDER BY decided_at ASC
      LIMIT $1`,
    [limit],
  );
  const results: SettlementSync[] = [];
  for (const row of rows) results.push(await syncCardSettlement(row.transaction_token));
  return results;
}

// ---- Crediting a card credit fee back (returnCardCreditFee) ---------------------------------------

/*
 * Part or all of a charged fee given back by the settler, apart from the full-refund return the
 * contract makes by itself. Today's one reason is the CFL cap (MB-04 §5.4(f)): carry plus the fee may
 * never exceed the CFL maximum, and the excess is credited back by that cycle's statement at the
 * latest (cardFeeCap.ts asks; this does it).
 *
 * The same three rules as settlement. Reconciled to a target: the row says how much of the fee should
 * have been credited back in total, the chain says how much has been (`cardCreditFeeOf`), and only the
 * difference is sent, so a retry or a lost receipt can never credit twice. Every attempt's outcome is
 * stored beside the purchase (`fee_return_*`), and five failures stop the retries for a person.
 */

export interface FeeCreditSync {
  transactionToken: string;
  action: 'none' | 'credited' | 'recovered' | 'failed' | 'needs_review' | 'skipped';
  /** What has been credited back of the fee in total, after this step. */
  creditedCents?: number;
  txHash?: string;
  error?: string;
}

/**
 * Ask for a charged fee to be credited back up to `totalCents` in all (never more than the fee, and
 * never lowering an earlier ask), then do it. Idempotent: asking for the same total twice credits once.
 */
export async function creditBackCardCreditFee(transactionToken: string, totalCents: number, reason: string): Promise<FeeCreditSync> {
  const token = transactionToken.trim();
  if (!token || !isCardSettlementConfigured()) return { transactionToken: token, action: 'skipped' };
  await ensureColumns();
  const cents = Math.max(0, Math.round(totalCents));
  await getPayPool()!.query(
    `UPDATE ${DECISIONS}
        SET fee_return_target_cents = LEAST(fee_cents, GREATEST(fee_return_target_cents, $2)),
            fee_return_status = CASE WHEN LEAST(fee_cents, GREATEST(fee_return_target_cents, $2)) > fee_returned_cents
                                     THEN COALESCE(NULLIF(fee_return_status, 'done'), 'pending') ELSE fee_return_status END,
            fee_return_error = CASE WHEN fee_return_status = 'needs_review' THEN fee_return_error ELSE $3 END
      WHERE transaction_token = $1 AND fee_status = 'charged'`,
    [token, cents, `asked: ${reason}`.slice(0, 400)],
  );
  return syncCardCreditFeeReturn(token);
}

const feeCreditsInFlight = new Set<string>();

/** Bring what the chain has credited back of one fee up to what should have been. Safe to call any time. */
export async function syncCardCreditFeeReturn(transactionToken: string): Promise<FeeCreditSync> {
  const token = transactionToken.trim();
  if (!token || !isCardSettlementConfigured()) return { transactionToken: token, action: 'skipped' };
  if (feeCreditsInFlight.has(token)) return { transactionToken: token, action: 'skipped' };
  feeCreditsInFlight.add(token);
  try {
    await ensureColumns();
    const pool = getPayPool()!;
    const { rows } = await pool.query<{
      wallet: string | null;
      card_token: string | null;
      onchain_ref: string | null;
      fee_cents: string | number | null;
      fee_draws: unknown;
      fee_status: string | null;
      fee_return_target_cents: string | number | null;
      fee_returned_cents: string | number | null;
      fee_return_status: string | null;
      fee_return_attempts: number | null;
    }>(
      `SELECT wallet, card_token, onchain_ref, fee_cents, fee_draws, fee_status, fee_return_target_cents, fee_returned_cents,
              fee_return_status, fee_return_attempts
         FROM ${DECISIONS} WHERE transaction_token = $1`,
      [token],
    );
    const row = rows[0];
    if (!row || row.fee_status !== 'charged' || !row.wallet) return { transactionToken: token, action: 'none' };
    if (row.fee_return_status === 'needs_review') return { transactionToken: token, action: 'needs_review' };
    const feeCents = Number(row.fee_cents ?? 0) || 0;
    const target = Math.min(feeCents, Number(row.fee_return_target_cents ?? 0) || 0);
    const booked = Number(row.fee_returned_cents ?? 0) || 0;
    if (target <= booked) return { transactionToken: token, action: 'none', creditedCents: booked };

    const signer = new ethers.Wallet(settlerKey(), chainProvider(resolveChainId()));
    const issuer = issuerFor(writesAs(signer));
    if (!issuer) return { transactionToken: token, action: 'skipped', error: 'No RevolvingIssuer address' };
    const ref = refFor(token, row.onchain_ref);

    try {
      // What the chain has already given back: a credit that landed before it was recorded is not sent again.
      const { returned } = await readCardCreditFee(issuer, ref);
      let creditedCents = Number(returned / CENTS_TO_UNITS);
      let txHash: string | null = null;
      if (creditedCents < target) {
        const tx = await issuer.returnCardCreditFee(ref, BigInt(target - creditedCents) * CENTS_TO_UNITS);
        await tx.wait(1);
        txHash = tx.hash;
        creditedCents = target;
      }
      // The books follow the chain: credit the tiers for what moved since they were last told, dearest first.
      const moved = Math.max(0, creditedCents - booked);
      if (moved > 0) {
        await ensureAuthTables();
        const left = feeDrawsLeft(feeDrawsOf(row.fee_draws), booked);
        await recordCreditFeeReversal(pool, row.wallet, token, row.card_token, releaseDraws(left, moved), 'card_credit_fee_credit', creditedCents);
      }
      await pool.query(
        `UPDATE ${DECISIONS}
            SET fee_returned_cents = GREATEST(fee_returned_cents, $2),
                fee_return_status = 'done',
                fee_return_tx = COALESCE($3, fee_return_tx),
                fee_return_error = NULL,
                fee_return_attempts = fee_return_attempts + $4,
                fee_status = CASE WHEN $2 >= fee_cents THEN 'returned' ELSE fee_status END,
                fee_at = now()
          WHERE transaction_token = $1`,
        [token, creditedCents, txHash, txHash ? 1 : 0],
      );
      console.log(`[card-credit-fee] ${token} ${creditedCents}c of ${feeCents}c credited back${txHash ? ` (${txHash})` : ' (already on chain)'}`);
      return { transactionToken: token, action: txHash ? 'credited' : 'recovered', creditedCents, ...(txHash ? { txHash } : {}) };
    } catch (error) {
      const reason = reasonOf(error);
      const attempts = (row.fee_return_attempts ?? 0) + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'needs_review' : 'failed';
      await pool.query(
        `UPDATE ${DECISIONS} SET fee_return_status = $2, fee_return_error = $3, fee_return_attempts = $4 WHERE transaction_token = $1`,
        [token, status, reason, attempts],
      );
      console.error(`[card-credit-fee] ${token} credit back ${status} (attempt ${attempts}): ${reason}`);
      return { transactionToken: token, action: status, error: reason };
    }
  } finally {
    feeCreditsInFlight.delete(token);
  }
}

/** Fees with a credit back asked for and not yet on chain. Bounded, oldest first. */
export async function sweepCardCreditFeeReturns(limit = 25): Promise<FeeCreditSync[]> {
  if (!isCardSettlementConfigured()) return [];
  await ensureColumns();
  const { rows } = await getPayPool()!.query<{ transaction_token: string }>(
    `SELECT transaction_token FROM ${DECISIONS}
      WHERE fee_status = 'charged' AND fee_return_target_cents > fee_returned_cents
        AND fee_return_status IS DISTINCT FROM 'needs_review'
      ORDER BY decided_at ASC
      LIMIT $1`,
    [limit],
  );
  const results: FeeCreditSync[] = [];
  for (const row of rows) results.push(await syncCardCreditFeeReturn(row.transaction_token));
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
 * Carry included. Carry accrued on the tiers is written into our ledger as it accrues and measured
 * on chain through the tiers' own figures, so a repayment that covers carry clears carry too. The
 * one exception is carry owed to a pool — see readCardDebt.
 *
 * Phase 2b (section 12.2 as replaced): a deposit no longer pays the line. With auto-clear OFF a
 * Spendable deposit changes no credit position (acceptance 19), and with it ON the clearing happens
 * on chain (`repayForMember`, the auto-clear sweep) and is booked from that transaction, on the
 * `chain` rail. So nothing books a fiat repayment from a deposit any more, and this target-based
 * netting acts only on fiat settlements already in the books from before. It is left running because
 * the target is still right: with no fiat repayment booked, what should be on chain is everything
 * owed, and it clears nothing.
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
/** Lifetime carry the ledger has recorded for a member. */
async function recordedCarryCents(wallet: string): Promise<number> {
  return getPayPool()!
    .query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ${LEDGER}
        WHERE wallet = $1 AND account = 'member_credit_carry' AND direction = 'debit'`,
      [wallet],
    )
    .then((r) => Number(r.rows[0]?.total ?? 0));
}

async function recordCarry(wallet: string, accruedCents: number): Promise<number> {
  const pool = getPayPool()!;
  const recorded = await recordedCarryCents(wallet);
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

async function readCardDebt(
  wallet: string,
  issuer: ethers.Contract,
  /** False reads only: carry accrued since the last sweep is reported, not written. */
  record = true,
): Promise<CardDebtPosition & { carryHeldElsewhere: boolean; unrecordedCarryCents: number }> {
  const pool = getPayPool()!;

  /*
   * Per purchase: what is on chain for it (`onchain_cents`, whatever its status -- a disputed or won
   * purchase can still have a part on chain that the member had already paid), and what of its
   * credit has not reached the chain yet. A disputed purchase's unpaid part is set aside in its own
   * ledger accounts and taken off the chain, so it is left out of both.
   */
  /*
   * The card credit fee is counted on the same terms as the purchase (decision 55): owed in the
   * ledger from the swipe, not on chain while it is held, on chain (and so part of what was issued)
   * once charged. Left out of `issued`, a charged fee would read as 30¢ of carry.
   */
  const { rows } = await pool.query<{
    draws: unknown;
    onchain_status: string | null;
    onchain_cents: string | null;
    dispute_token: string | null;
    fee_cents: string | number | null;
    fee_status: string | null;
    fee_returned_cents: string | number | null;
  }>(
    `SELECT draws, onchain_status, onchain_cents, dispute_token, fee_cents, fee_status, fee_returned_cents FROM ${DECISIONS}
      WHERE wallet = $1 AND result = 'APPROVED'
        AND (COALESCE(net_cents, amount_cents) > 0 OR COALESCE(onchain_cents, 0) > 0 OR fee_status = 'charged')`,
    [wallet],
  );
  let notOnChain = 0;
  let issued = 0;
  for (const row of rows) {
    const onChainForRow = Number(row.onchain_cents ?? 0);
    issued += onChainForRow;
    // What of the card credit fee the chain still carries: charged, less anything credited back.
    if (row.fee_status === 'charged') issued += liveFeeCents(row.fee_cents, row.fee_status, row.fee_returned_cents);
    if (row.dispute_token || row.onchain_status === 'waived' || row.onchain_status === 'held') continue;
    notOnChain +=
      Math.max(0, creditCentsOf(row.draws) - (row.onchain_status === 'issued' ? onChainForRow : 0)) +
      heldFeeCents(row.fee_cents, row.fee_status);
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

  // Independent reads, issued together so they share one multicall.
  const [totalDrawn, accountRaw, tierCountRaw] = (await Promise.all([
    issuer.totalDrawnOf(wallet),
    issuer.cardSettlementAccount(),
    issuer.tierCount(),
  ])) as [bigint, string, bigint];
  const drawnCents = Number(totalDrawn / CENTS_TO_UNITS);

  /*
   * Carry is cleared against the settlement account's claim, so it can only be cleared here when
   * that account is where the carry went. A tier funded by the LendingPool sends its carry to the
   * pool's depositors, who are owed on-chain money; that carry has to be paid in USDC, not netted.
   */
  const account = String(accountRaw).toLowerCase();
  const tierIds = Array.from({ length: Number(tierCountRaw) }, (_, t) => t);
  const byTier = (await Promise.all(
    tierIds.map((t) => Promise.all([issuer.drawnOf(wallet, t), issuer.carryRecipientOf(t)])),
  )) as Array<[bigint, string]>;
  const carryHeldElsewhere = byTier.some(
    ([drawn, recipient]) => drawn !== 0n && String(recipient).toLowerCase() !== account,
  );

  const accrued = carryAccruedCents({ drawnCents, issuedCents: issued, clearedCents: cleared });
  let unrecordedCarryCents = 0;
  if (!carryHeldElsewhere) {
    if (record) await recordCarry(wallet, accrued);
    else unrecordedCarryCents = Math.max(0, accrued - (await recordedCarryCents(wallet)));
  }

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
  return {
    ...cardDebtToClear({ offchainOwedCents: owed, notOnChainCents: notOnChain, onChainCents: onChain }),
    carryHeldElsewhere,
    unrecordedCarryCents,
  };
}

/**
 * Card credit across every member: what our books say should be on chain, and what is. Read only.
 *
 * The reconciler's credit-issuance check. Per member it is the same reading the netting job acts
 * on -- ledger owed, less purchases not yet settled on chain -- plus carry that has accrued on chain
 * since the sweep last wrote it into the ledger, which is the chain being ahead of the books by a
 * known amount rather than drift. Nothing is written. Null if any member cannot be read: a partial
 * sum would report drift that is only a failed read.
 */
export async function cardCreditBooksVsChain(): Promise<{ expectedCents: number; onChainCents: number } | null> {
  const pool = getPayPool();
  const issuer = issuerFor(chainProvider(resolveChainId()));
  if (!pool || !issuer) return null;
  try {
    await ensureColumns();
    const { rows } = await pool.query<{ wallet: string }>(
      `SELECT DISTINCT wallet FROM ${DECISIONS} WHERE result = 'APPROVED' AND wallet IS NOT NULL`,
    );
    let expectedCents = 0;
    let onChainCents = 0;
    for (const { wallet } of rows) {
      const position = await readCardDebt(wallet, issuer, false);
      expectedCents += Math.max(0, position.offchainOwedCents - position.notOnChainCents) + position.unrecordedCarryCents;
      onChainCents += position.onChainCents;
    }
    return { expectedCents, onChainCents };
  } catch (error) {
    console.error('[reconcile] card credit read failed:', error);
    return null;
  }
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
    const issuer = issuerFor(writesAs(signer));
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
      await tx.wait(1);
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
  const issuer = issuerFor(writesAs(signer));
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
  const { rows } = await pool.query<{
    onchain_ref: string | null;
    onchain_cents: string | null;
    wallet: string | null;
    card_token: string | null;
    fee_cents: string | number | null;
    fee_draws: unknown;
    fee_status: string | null;
    fee_returned_cents: string | number | null;
  }>(
    `SELECT onchain_ref, onchain_cents, wallet, card_token, fee_cents, fee_draws, fee_status, fee_returned_cents
       FROM ${DECISIONS} WHERE transaction_token = $1`,
    [transactionToken],
  );
  const row = rows[0];
  if (!row) return null;
  const issuer = await settlerIssuer();
  const ref = refFor(transactionToken, row.onchain_ref);
  const tx = await issuer.reverseCardSpend(ref, BigInt(cents) * CENTS_TO_UNITS);
  await tx.wait(1);
  const left = Math.max(0, Number(row.onchain_cents ?? 0) - cents);
  // Taken off to zero: the contract gave the card credit fee back with it, so the books say so too.
  const feeStatus = left === 0 && row.fee_status === 'charged' ? await feeReturnedOnChain(issuer, ref, transactionToken, row) : null;
  await record(transactionToken, {
    status: 'held',
    cents: left,
    tx: tx.hash,
    error: null,
    attempt: true,
    feeStatus,
    feeReturnedCents: feeStatus ? Number(row.fee_cents ?? 0) || 0 : null,
  });
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
  const { rows } = await pool.query<{ wallet: string; onchain_cents: string | null; onchain_ref: string | null; onchain_tx: string | null }>(
    `SELECT wallet, onchain_cents, onchain_ref, onchain_tx FROM ${DECISIONS} WHERE transaction_token = $1`,
    [transactionToken],
  );
  const row = rows[0];
  if (!row) return null;
  // Already recorded under this reference: a retry after a success must not count the cents twice.
  if (row.onchain_ref === freshRef) return row.onchain_tx;
  const issuer = await settlerIssuer();
  const ref = ethers.id(freshRef);
  const [member] = (await issuer.cardSettlementOf(ref)) as [string, bigint];
  let hash: string | null = null;
  if (member === ethers.ZeroAddress) {
    // A fresh ref is a fresh purchase to the contract: it is authorized before it settles (audit
    // M-2), under the same standing and caps. A member in default cannot be re-issued; that refusal
    // is thrown as a sentence and the sweep leaves it for a person.
    const units = BigInt(cents) * CENTS_TO_UNITS;
    try {
      await ensureAuthorized(issuer, ref, row.wallet, units);
      const tx = await issuer.settleCardSpend(ref, row.wallet, units);
      await tx.wait(1);
      hash = tx.hash;
    } catch (error) {
      throw new Error(`re-issue refused: ${reasonOf(error)}`);
    }
    await syncClrusdEncumbrance(resolveChainId(), row.wallet, issuer.runner as ethers.ContractRunner);
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

// ---- Authorization at approval (audit M-2) ---------------------------------------------------------

export type AuthorizationOutcome = 'authorized' | 'already' | 'not_needed' | 'refused' | 'failed' | 'skipped';

/**
 * Record on chain what the Auth Stream just approved: the credit part of the purchase, for this ref
 * and member.
 *
 * Called straight after the Auth Stream has answered Lithic, never before: that endpoint answers
 * from a snapshot and must not wait on a chain. So this cannot change the card's answer; what it
 * does is put the approval on chain while the member's standing is the one the approval was given
 * under, which is what `settleCardSpend` later requires. A refusal here (frozen or defaulted, over
 * the per-purchase cap, more than the line can hold) is stored beside the decision as a sentence;
 * settlement then tries once more and, refused again, hands the purchase to a person.
 */
export async function authorizeCardOnChain(transactionToken: string): Promise<AuthorizationOutcome> {
  const token = transactionToken.trim();
  if (!token || !isCardSettlementConfigured()) return 'skipped';
  await ensureColumns();
  const pool = getPayPool()!;
  const { rows } = await pool.query<{
    wallet: string | null;
    result: string;
    draws: unknown;
    onchain_auth_status: string | null;
    onchain_ref: string | null;
    fee_cents: string | number | null;
    fee_status: string | null;
  }>(
    `SELECT wallet, result, draws, onchain_auth_status, onchain_ref, fee_cents, fee_status FROM ${DECISIONS} WHERE transaction_token = $1`,
    [token],
  );
  const row = rows[0];
  if (!row || row.result !== 'APPROVED' || !row.wallet) return 'skipped';
  if (row.onchain_auth_status === 'authorized') return 'already';
  // The credit part plus the card credit fee (decision 55): settlement draws both, and may draw only
  // what was authorized.
  const cents = creditCentsOf(row.draws) + heldFeeCents(row.fee_cents, row.fee_status);
  const setAuth = (status: string, fields: { cents?: number; tx?: string | null; error?: string | null }) =>
    pool.query(
      `UPDATE ${DECISIONS} SET onchain_auth_status = $2, onchain_auth_cents = COALESCE($3, onchain_auth_cents),
              onchain_auth_tx = COALESCE($4, onchain_auth_tx), onchain_auth_error = $5
        WHERE transaction_token = $1`,
      [token, status, fields.cents ?? null, fields.tx ?? null, fields.error ?? null],
    );
  if (cents <= 0) {
    await setAuth('not_needed', { cents: 0 });
    return 'not_needed';
  }

  const signer = new ethers.Wallet(settlerKey(), chainProvider(resolveChainId()));
  const issuer = issuerFor(writesAs(signer));
  if (!issuer) return 'skipped';
  const ref = refFor(token, row.onchain_ref);
  try {
    const [settledFor] = (await issuer.cardSettlementOf(ref)) as [string, bigint];
    if (settledFor !== ethers.ZeroAddress) {
      await setAuth('authorized', { cents, error: null });
      return 'already';
    }
    const { tx } = await ensureAuthorized(issuer, ref, row.wallet, BigInt(cents) * CENTS_TO_UNITS);
    await setAuth('authorized', { cents, tx: tx ?? null, error: null });
    return tx ? 'authorized' : 'already';
  } catch (error) {
    const refused = isCardRefusal(error);
    const allowanceShort = await savingsAllowanceShort(issuer, row.wallet, error);
    const reason = (allowanceShort ?? reasonOf(error)).slice(0, 400);
    await setAuth(refused ? 'refused' : 'failed', { error: reason });
    // Phase 2b (12.7): the member can fix this one themselves, so they are told how.
    if (allowanceShort) {
      await notificationStore
        .emit({
          wallet: row.wallet,
          kind: 'card',
          title: 'Your card needs your OK to use Savings',
          body: 'This purchase needed your Savings, and card spending can draw on them only as far as you allow. Set how much in Settings, Permissions.',
          data: { transactionToken: token },
          dedupeKey: `savings-allowance:${token}`,
        })
        .catch(() => null);
    }
    console.error(`[card-authorization] ${token} ${refused ? 'refused' : 'failed'}: ${reason}`);
    return refused ? 'refused' : 'failed';
  }
}
