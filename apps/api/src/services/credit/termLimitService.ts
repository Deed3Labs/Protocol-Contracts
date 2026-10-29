import { ethers } from 'ethers';
import { getPayPool, getPostgresPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from '../chain/provider.js';
import { lithicStore } from '../lithic/lithicStore.js';
import { getLithic } from '../lithic/lithicClient.js';
import { estimateMonthlyDeposit } from '../lithic/snapshotService.js';
import { termLimitSkip, termLimitTarget } from './termLimitRule.js';
import { asOperator } from '../chain/operatorQueue.js';

/*
 * Setting term limits without an operator at a terminal.
 *
 * Until this, the only way a member got a term limit was scripts/set_term_limit.ts, run by hand --
 * so every member who had not been underwritten by name had a limit of zero, and every split plan
 * they tried reverted. This applies termLimitRule.ts instead: the starter line once their identity
 * check has passed, and more as they pay on time.
 *
 * It only ever raises. The first `setTermLimit` also opens the member's StableCredit line, which is
 * why it waits for a verified identity rather than handing a line to every wallet that signs in.
 *
 * Everything that touches the chain or a database comes in as `deps`, so the behaviour can be
 * tested with none of them.
 */

const ISSUER_ABI = [
  'function termLimitOf(address member) view returns (uint256)',
  'function termSuspended(address member) view returns (bool)',
  'function defaultedAt(address member) view returns (uint64)',
  'function totalArrearsOf(address member) view returns (uint256)',
  'function setTermLimit(address member, uint256 limit)',
];

/** Ledger units are six decimals; a cent is 10^4 of them. */
const UNITS_PER_CENT = 10_000n;

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}
const operatorKey = () => (process.env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();
const issuerAddress = () => getContractAddress(chainId(), 'TermIssuer');

/**
 * Whether limits are set automatically. On in test (Base Sepolia) unless switched off, and off
 * everywhere else until `AUTO_TERM_LIMITS=on`: the figures are a proposal, and handing real credit
 * lines to real members waits for them to be signed off. Anything other than `on` or unset is off.
 */
export function autoTermLimitsOn(): boolean {
  const flag = (process.env.AUTO_TERM_LIMITS ?? '').trim();
  if (flag === 'on') return true;
  if (flag) return false;
  return chainId() === 84532;
}

/** The issuer, the operator key, and both databases: members live in one, the ledger in the other. */
export function isTermLimitsConfigured(): boolean {
  return Boolean(issuerAddress() && operatorKey() && getPostgresPool() && getPayPool());
}

export interface ChainTermState {
  currentCents: number;
  suspended: boolean;
  defaulted: boolean;
  inArrears: boolean;
}

export interface TermLimitChange {
  wallet: string;
  fromCents: number;
  toCents: number;
  reason: string;
  txHash: string;
}

export interface TermLimitDeps {
  enabled(): boolean;
  configured(): boolean;
  memberWallets(): Promise<string[]>;
  verified(wallet: string): Promise<boolean>;
  readChain(wallet: string): Promise<ChainTermState>;
  cleanInstallments(wallet: string): Promise<number>;
  monthlyDepositCents(wallet: string): Promise<number>;
  markLate(wallet: string): Promise<void>;
  /** Sends `setTermLimit`, waits for it to land, and returns its hash. */
  setLimit(wallet: string, cents: number): Promise<string>;
  recordChange(change: TermLimitChange): Promise<void>;
}

export interface ReviewResult {
  wallet: string;
  action: 'raised' | 'unchanged' | 'unverified' | 'suspended' | 'defaulted' | 'late' | 'failed';
  fromCents?: number;
  toCents?: number;
  txHash?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------------------------
// The real dependencies.
// ---------------------------------------------------------------------------------------------

let tablesReady = false;

async function ensureTables(): Promise<void> {
  const pool = getPayPool();
  if (!pool || tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS term_limit_changes (
      id BIGSERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      from_cents BIGINT NOT NULL,
      to_cents BIGINT NOT NULL,
      reason TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS term_limit_changes_wallet_idx ON term_limit_changes (wallet, at);
    CREATE TABLE IF NOT EXISTS term_late_marks (
      wallet TEXT PRIMARY KEY,
      seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  tablesReady = true;
}

/** Every member wallet -- from the main database, which holds `members`; the Pay one does not. */
export async function memberWallets(): Promise<string[]> {
  const pool = getPostgresPool();
  if (!pool) return [];
  const { rows } = await pool.query<{ primary_wallet: string }>(
    `SELECT DISTINCT primary_wallet FROM members
      WHERE primary_wallet IS NOT NULL AND primary_wallet <> ''
      ORDER BY primary_wallet`,
  );
  return [...new Set(rows.map((r) => r.primary_wallet.toLowerCase()))];
}

/**
 * Whether the member's identity check passed.
 *
 * The stored status is written once, when the member is provisioned, and nothing refreshes it: a
 * member who was PENDING_DOCUMENT and then cleared review still reads PENDING_* here forever. So a
 * pending row is checked with Lithic itself. Read-only -- the row is the provisioning flow's to keep.
 */
export async function verified(wallet: string): Promise<boolean> {
  const record = await lithicStore.get(wallet);
  if (!record) return false;
  if (record.status === 'ACCEPTED') return true;
  if (!record.status.startsWith('PENDING')) return false;
  const lithic = getLithic();
  if (!lithic) return false;
  try {
    const holder = await lithic.accountHolders.retrieve(record.accountHolderToken);
    return holder.status === 'ACCEPTED';
  } catch {
    return false;
  }
}

function issuer(runner: ethers.ContractRunner): ethers.Contract {
  return new ethers.Contract(issuerAddress()!, ISSUER_ABI, runner);
}

async function readChain(wallet: string): Promise<ChainTermState> {
  const term = issuer(chainProvider(chainId()));
  const [limit, suspended, defaultedAt, arrears] = await Promise.all([
    term.termLimitOf(wallet) as Promise<bigint>,
    term.termSuspended(wallet) as Promise<boolean>,
    term.defaultedAt(wallet) as Promise<bigint>,
    term.totalArrearsOf(wallet) as Promise<bigint>,
  ]);
  return {
    currentCents: Number(limit / UNITS_PER_CENT),
    suspended: Boolean(suspended),
    defaulted: BigInt(defaultedAt) !== 0n,
    inArrears: BigInt(arrears) > 0n,
  };
}

/**
 * Installments paid since the member was last seen behind.
 *
 * Each payment row records how far through its plan's schedule it took them, so distinct
 * (plan, installment reached) pairs count installments covered. A single payment that clears a
 * whole plan counts once rather than once per installment: growth is earned over cycles, not by
 * paying a plan off on the day it opens.
 */
async function cleanInstallments(wallet: string): Promise<number> {
  const pool = getPayPool();
  if (!pool) return 0;
  try {
    await ensureTables();
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT DISTINCT p.plan_id, p.installment_index
           FROM term_plan_payments p
          WHERE p.wallet = $1
            AND p.created_at > COALESCE((SELECT seen_at FROM term_late_marks WHERE wallet = $1), '-infinity')
       ) covered`,
      [wallet],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    // No payments table yet is no payments yet.
    return 0;
  }
}

async function markLate(wallet: string): Promise<void> {
  const pool = getPayPool();
  if (!pool) return;
  await ensureTables();
  await pool.query(
    `INSERT INTO term_late_marks (wallet, seen_at) VALUES ($1, now())
     ON CONFLICT (wallet) DO UPDATE SET seen_at = now()`,
    [wallet],
  );
}

let writer: ethers.Contract | null = null;

async function setLimit(wallet: string, cents: number): Promise<string> {
  if (!writer) {
    const signer = new ethers.Wallet(operatorKey(), chainProvider(chainId()));
    writer = issuer(writesAs(signer));
  }
  const tx = await writer.setTermLimit(wallet, BigInt(cents) * UNITS_PER_CENT);
  await tx.wait(1);
  return tx.hash as string;
}

async function recordChange(change: TermLimitChange): Promise<void> {
  const pool = getPayPool();
  if (!pool) return;
  await ensureTables();
  await pool.query(
    `INSERT INTO term_limit_changes (wallet, from_cents, to_cents, reason, tx_hash) VALUES ($1, $2, $3, $4, $5)`,
    [change.wallet, change.fromCents, change.toCents, change.reason, change.txHash],
  );
}

export const realTermLimitDeps: TermLimitDeps = {
  enabled: autoTermLimitsOn,
  configured: isTermLimitsConfigured,
  memberWallets,
  verified,
  readChain,
  cleanInstallments,
  monthlyDepositCents: estimateMonthlyDeposit,
  markLate,
  setLimit,
  recordChange,
};

// ---------------------------------------------------------------------------------------------
// The rule, applied.
// ---------------------------------------------------------------------------------------------

/*
 * One member at a time, server-wide, and in the same queue as everything else the operator key
 * sends (operatorQueue.ts). The reviewer and a member finishing joining can arrive together, and two
 * transactions from the operator key at once would race for the same nonce. It also means the limit
 * is read again after any write ahead of it, so the same raise is never sent twice.
 */
const oneAtATime = asOperator;

async function evaluate(wallet: string, deps: TermLimitDeps): Promise<ReviewResult> {
  if (!(await deps.verified(wallet))) return { wallet, action: 'unverified' };
  const chain = await deps.readChain(wallet);
  const fromCents = chain.currentCents;
  // A late mark resets growth: only installments paid after the last one count.
  if (chain.inArrears) await deps.markLate(wallet);
  const skip = termLimitSkip({ verified: true, ...chain, cleanInstallments: 0, monthlyDepositCents: 0 });
  if (skip) return { wallet, action: skip, fromCents };

  const [clean, deposit] = await Promise.all([deps.cleanInstallments(wallet), deps.monthlyDepositCents(wallet)]);
  const decision = termLimitTarget({ verified: true, ...chain, cleanInstallments: clean, monthlyDepositCents: deposit });
  if (!decision) return { wallet, action: 'unchanged', fromCents };

  const txHash = await deps.setLimit(wallet, decision.targetCents);
  const change = { wallet, fromCents, toCents: decision.targetCents, reason: decision.reason, txHash };
  // The limit is on chain whatever happens to the note of it; a lost note is a log line, not a failure.
  await deps.recordChange(change).catch((error) => console.error(`[term-limit] ${wallet} change not recorded: ${(error as Error)?.message}`));
  console.log(`[term-limit] ${wallet} ${fromCents / 100} -> ${decision.targetCents / 100} (${decision.reason}, ${txHash})`);
  return { ...change, action: 'raised' };
}

function failure(wallet: string, error: unknown): ReviewResult {
  const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  console.error(`[term-limit] ${wallet} failed: ${reason}`);
  return { wallet, action: 'failed', reason };
}

/**
 * The starter line, for a member who has just finished joining.
 *
 * The same rule as the hourly review, for one wallet -- normally it lands on $500. Returns the limit
 * now on chain, or null when the member is not verified, this is not configured or switched off, or
 * the write failed. Never throws: it runs fire-and-forget at the end of a request.
 */
export async function grantStarterLimit(
  wallet: string,
  deps: TermLimitDeps = realTermLimitDeps,
): Promise<{ termLimitCents: number | null; reason?: string }> {
  const w = String(wallet || '').trim().toLowerCase();
  try {
    if (!w) return { termLimitCents: null, reason: 'no wallet' };
    if (!deps.configured()) return { termLimitCents: null, reason: 'not configured' };
    if (!deps.enabled()) return { termLimitCents: null, reason: 'switched off' };
    const result = await oneAtATime(() => evaluate(w, deps));
    if (result.action === 'unverified') return { termLimitCents: null, reason: 'not verified' };
    return { termLimitCents: result.toCents ?? result.fromCents ?? null, reason: result.action };
  } catch (error) {
    return { termLimitCents: null, reason: failure(w, error).reason };
  }
}

/** Every member, once: raise whoever has earned it, note whoever is behind. */
export async function reviewTermLimits(deps: TermLimitDeps = realTermLimitDeps): Promise<ReviewResult[]> {
  if (!deps.configured() || !deps.enabled()) return [];
  const results: ReviewResult[] = [];
  for (const wallet of await deps.memberWallets()) {
    try {
      results.push(await oneAtATime(() => evaluate(wallet.toLowerCase(), deps)));
    } catch (error) {
      results.push(failure(wallet, error));
    }
  }
  return results;
}
