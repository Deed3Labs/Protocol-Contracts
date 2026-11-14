import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { ensureAutoRepayTables } from '../deposits/depositReceiptService.js';
import { recordUsdcRepayment } from './usdcRepaymentService.js';
import { decodeChainError } from './chainErrors.js';
import { notificationStore } from '../notificationStore.js';
import { alertOps } from '../opsAlert.js';
import {
  advanceRun,
  lithicMoves,
  pgRunStore,
  pgUnbook,
  PENDING_STATES,
  SUBMIT_STALE_MS,
  type AutoClearDeps,
  type AutoClearStep,
  type ChainSide,
} from '../deposits/autoClearRuns.js';
import { termChainSide } from './termCollection.js';

/*
 * Auto-clear (Phase 2b, section 12.2 as replaced) — "there is no pay button".
 *
 * Only on Spendable deposits (owner's option 1, `depositApplication`): a fiat deposit at the partner
 * bank is earmarked; a USDC (Bridge) deposit never is, because that USDC is the member's own and the
 * settler would be paying their debt for them.
 *
 * A member who switched it on (`RevolvingIssuer.setAutoClear(on, scope)`, or their `AutoClear`
 * signature at onboarding) has what they owe cleared from a deposit as it lands, dearest tier first,
 * within the scope they chose: UNSECURED_ONLY (income-backed and Boost, the default) or ALL. When a
 * deposit arrives, what they owe is earmarked as one clearing (`auto_clear_runs`, keyed by a ref
 * derived from the deposit receipt) and auto-save runs only on the rest. This sweep clears it ON
 * CHAIN with `repayForMember(ref, member, amount)`, and moves exactly what the chain applied out of
 * the member's Spendable account to Clear's settlement account (a Lithic book transfer, against a
 * hold placed first). The ordering, the compensating steps and the states are in `autoClearRuns.ts`.
 *
 * **The settler delivers the cash.** `repayForMember` pulls the reserve token from the card settler
 * (`msg.sender`), never from the member: the member's USDC and CLRUSD are never swept, and the member
 * approves nothing. So the settler keeps an allowance to the RevolvingIssuer (approved here, exactly
 * what is needed, when it runs short) and holds the USDC it pays. The contract applies
 * min(amount, owed within scope) and emits `AutoCleared(ref, member, applied, remainder)`; the
 * member is told "$X cleared · $Y now spendable" once the dollars have moved, and the remainder is
 * never held or moved.
 *
 * It reverts `RevolvingIssuerNothingToClear` when nothing in scope is owed (a card purchase still
 * pending is a hold, not debt: the earmark waits for it), and `RevolvingIssuerAutoClearOff` while the
 * governed network-wide switch is off (the sweep then stops for everyone and says so once).
 *
 * The books are written from the transaction's own events, as for a Repay tap.
 */

const ISSUER_ABI = [
  'function autoRepayEnabled(address) view returns (bool)',
  'function autoClearScopeOf(address) view returns (uint8)',
  'function savingsDrawAllowance(address) view returns (uint256)',
  'function creditTerms() view returns (uint128 unsecuredLineCap, uint64 cureWindow, uint8 boostCleanCycles, uint8 boostDepositCycles, bool autoClearOffGlobal)',
  'function tierCount() view returns (uint256)',
  'function tierProduct(uint256) view returns (bytes32)',
  'function drawnOf(address member, uint256 tierId) view returns (uint256)',
  'function totalDrawnOf(address) view returns (uint256)',
  'function repayForMember(bytes32 ref, address member, uint256 amount)',
  'function autoRepaymentOf(bytes32 ref) view returns (uint256)',
  'function stableCredit() view returns (address)',
  'event AutoCleared(bytes32 indexed ref, address indexed member, uint256 applied, uint256 remainder)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const CENTS = 10n ** 4n;
const ZERO_BYTES32 = ethers.ZeroHash;

/** `RevolvingIssuerBase` scopes: 0 = income-backed and Boost only (the default), 1 = every tier. */
export const SCOPE_UNSECURED_ONLY = 0;
export const SCOPE_ALL = 1;

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

function settlerKey(): string {
  return (process.env.CARD_SETTLER_PRIVATE_KEY || '').trim();
}

function issuerAt(runner: ethers.ContractRunner): ethers.Contract | null {
  const address = getContractAddress(chainId(), 'RevolvingIssuer');
  return address ? new ethers.Contract(address, ISSUER_ABI, runner) : null;
}

/**
 * What auto-clear would clear for this member right now: drawn (carry to this second included) on
 * the tiers in their scope. Income-backed and Boost are the tiers priced from RateSchedule
 * (`tierProduct != 0`), which is the contract's own test (`_isUnsecured`).
 */
export async function owedInScope(issuer: ethers.Contract, wallet: string, scope: number): Promise<bigint> {
  if (scope === SCOPE_ALL) return (await issuer.totalDrawnOf(wallet)) as bigint;
  const count = Number(await issuer.tierCount());
  const ids = Array.from({ length: count }, (_, i) => i);
  const products = (await Promise.all(ids.map((i) => issuer.tierProduct(i)))) as string[];
  const unsecured = ids.filter((i) => products[i] !== ZERO_BYTES32);
  const drawn = (await Promise.all(unsecured.map((i) => issuer.drawnOf(wallet, i)))) as bigint[];
  return drawn.reduce((a, b) => a + b, 0n);
}

/** Record the member's choice after checking the chain agrees — the chain is the authority. */
export async function setAutoRepayChoice(
  walletInput: string,
  enabled: boolean,
  scope?: number,
): Promise<{ ok: boolean; reason?: string }> {
  const wallet = walletInput.trim().toLowerCase();
  const pool = getPayPool();
  const issuer = issuerAt(chainProvider(chainId()));
  if (!pool || !issuer) return { ok: false, reason: 'Not available on this network.' };
  const [onChain, onChainScope] = (await Promise.all([
    issuer.autoRepayEnabled(wallet),
    issuer.autoClearScopeOf(wallet).catch(() => 0),
  ])) as [boolean, bigint | number];
  if (onChain !== enabled || (scope !== undefined && Number(onChainScope) !== scope)) {
    return { ok: false, reason: 'Your wallet has not confirmed that yet. Try again in a moment.' };
  }
  await ensureAutoRepayTables(pool);
  await pool.query(
    `INSERT INTO member_auto_repay (wallet, enabled) VALUES ($1, $2)
     ON CONFLICT (wallet) DO UPDATE SET enabled = EXCLUDED.enabled, verified_at = now()`,
    [wallet, enabled],
  );
  if (!enabled) {
    await pool.query(`UPDATE auto_repay_due SET due_cents = 0, updated_at = now() WHERE wallet = $1`, [wallet]);
    // Nothing held yet: released here. A clearing already holding money is released by the sweep,
    // which voids the hold; one the chain has applied still completes its transfer.
    await pool.query(
      `UPDATE auto_clear_runs SET state = 'released', last_error = 'auto-clear is off', updated_at = now()
        WHERE wallet = $1 AND state = 'earmarked'`,
      [wallet],
    );
  }
  return { ok: true };
}

export interface AutoRepayStatus {
  enabled: boolean;
  dueCents: number;
  /** 0 = income-backed and Boost only (the default), 1 = every tier. Null when unread. */
  scope: number | null;
  /** Off across the network by the governed switch: nothing is cleared automatically for anyone. */
  pausedForEveryone: boolean;
  /** What the member owes within that scope now, for "Clear $X now?". Null when unread. */
  owedInScopeCents: number | null;
  /** How much card spending may still draw against Savings (12.7). Null when unread; -1 = unlimited. */
  savingsDrawAllowanceCents: number | null;
}

export async function autoRepayStatus(walletInput: string): Promise<AutoRepayStatus> {
  const wallet = walletInput.trim().toLowerCase();
  const pool = getPayPool();
  let enabled = false;
  let dueCents = 0;
  if (pool) {
    await ensureAutoRepayTables(pool);
    const e = await pool.query<{ enabled: boolean }>(`SELECT enabled FROM member_auto_repay WHERE wallet = $1`, [wallet]);
    // Set aside and not yet cleared on chain, across this member's open clearings.
    const d = await pool.query<{ due_cents: string }>(
      `SELECT COALESCE(SUM(earmark_cents), 0) AS due_cents FROM auto_clear_runs WHERE wallet = $1 AND state = ANY($2::text[])`,
      [wallet, PENDING_STATES],
    );
    enabled = e.rows[0]?.enabled === true;
    dueCents = Number(d.rows[0]?.due_cents ?? 0);
  }
  const status: AutoRepayStatus = {
    enabled,
    dueCents,
    scope: null,
    pausedForEveryone: false,
    owedInScopeCents: null,
    savingsDrawAllowanceCents: null,
  };
  const issuer = issuerAt(chainProvider(chainId()));
  if (!issuer) return status;
  try {
    const [onChain, scope, terms, allowance] = (await Promise.all([
      issuer.autoRepayEnabled(wallet),
      issuer.autoClearScopeOf(wallet),
      issuer.creditTerms(),
      issuer.savingsDrawAllowance(wallet),
    ])) as [boolean, bigint, { autoClearOffGlobal: boolean }, bigint];
    // The chain decides. A record that lags it is shown as the chain has it.
    status.enabled = onChain;
    status.scope = Number(scope);
    status.pausedForEveryone = Boolean(terms.autoClearOffGlobal);
    status.savingsDrawAllowanceCents = allowance === ethers.MaxUint256 ? -1 : Number(allowance / CENTS);
    const owed = await owedInScope(issuer, wallet, Number(scope));
    status.owedInScopeCents = Number((owed + CENTS - 1n) / CENTS);
  } catch (error) {
    console.error('[auto-clear] status read failed for', wallet, error instanceof Error ? error.message : error);
  }
  return status;
}

export type AutoRepayResult = AutoClearStep;

/** The line's chain side (`repayForMember`), as the card settler. */
function settlerChain(issuer: ethers.Contract, usdc: ethers.Contract, settler: string, provider: ethers.Provider): ChainSide {
  return {
    enabled: async (wallet) => (await issuer.autoRepayEnabled(wallet)) as boolean,
    pausedForEveryone: async () => Boolean(((await issuer.creditTerms()) as { autoClearOffGlobal: boolean }).autoClearOffGlobal),
    owedCents: async (run) => {
      const scope = Number(await issuer.autoClearScopeOf(run.wallet));
      return Number((await owedInScope(issuer, run.wallet, scope)) / CENTS);
    },
    // A card purchase still pending at Lithic is not debt on chain yet: the hold waits for it.
    waitsForDebt: () => true,
    appliedOf: async (run) => {
      // The ref is the on-chain key: what it applied is on record, and nothing else can apply it.
      const applied = Number(((await issuer.autoRepaymentOf(run.ref)) as bigint) / CENTS);
      if (applied > 0) return applied;
      if (run.txHash && run.submittedAt !== null && Date.now() - run.submittedAt < SUBMIT_STALE_MS) {
        const receipt = await provider.getTransactionReceipt(run.txHash).catch(() => null);
        if (!receipt && (await provider.getTransaction(run.txHash).catch(() => null))) return 'pending';
      }
      return 0; // safe to resend: the contract refuses the ref a second time
    },
    settlerCannotPay: async (_run, cents) => {
      const amount = BigInt(cents) * CENTS;
      const issuerAddress = await issuer.getAddress();
      const [held, allowed] = (await Promise.all([usdc.balanceOf(settler), usdc.allowance(settler, issuerAddress)])) as [bigint, bigint];
      if (held < amount) return `The card settler ${settler} holds ${held} units and needs ${amount}; top it up`;
      if (allowed < amount) {
        // Exactly what this clearing needs: the issuer can pull no more than the settler meant.
        const approval = await usdc.approve(issuerAddress, amount);
        await approval.wait(1);
      }
      return null;
    },
    submit: async (run, cents) => {
      const tx = await issuer.repayForMember(run.ref, run.wallet, BigInt(cents) * CENTS);
      const applied = (async () => {
        const receipt = await tx.wait(1);
        for (const log of receipt?.logs ?? []) {
          try {
            const parsed = issuer.interface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed?.name === 'AutoCleared') return Number((parsed.args.applied as bigint) / CENTS);
          } catch {
            /* not ours */
          }
        }
        return 0;
      })();
      return { hash: tx.hash as string, applied };
    },
    findClearingTx: async (run) => {
      const latest = await provider.getBlockNumber();
      const logs = await issuer.queryFilter(issuer.filters.AutoCleared(run.ref), Math.max(0, latest - 9_000), latest).catch(() => []);
      return logs[0]?.transactionHash ?? null;
    },
    book: async (run) => {
      // The books, and the pool's side, from the transaction itself -- as for a Repay tap.
      const hash = run.txHash ?? '';
      const recorded = await recordUsdcRepayment(run.wallet, hash, 'auto');
      if (!recorded.ok) throw new Error(`could not book ${hash}: ${recorded.reason ?? 'unknown'}`);
    },
    errorName: (error) => decodeChainError(error)?.name ?? null,
  };
}

/**
 * Clear what Spendable deposits set aside: on chain with the settler's cash, and the same amount out
 * of the member's Spendable account to Clear's settlement account. One clearing per deposit for the
 * line, and one per term plan (or carry) the deposit paid, each advanced through the state machine
 * in `autoClearRuns.ts`.
 */
export async function sweepAutoRepay(limit = 25): Promise<AutoRepayResult[]> {
  const pool = getPayPool();
  if (!pool || !settlerKey()) return [];
  await ensureAutoRepayTables(pool);
  /*
   * Earmarks from before clearings were per deposit carry no ref and no hold, so nothing could
   * move the dollars that would pay them. They are released: the money is the member's, and the
   * debt stays on the line until their next Spendable deposit or their own Clear.
   */
  const released = await pool.query(`UPDATE auto_repay_due SET due_cents = 0, updated_at = now() WHERE due_cents > 0`);
  if (released.rowCount) console.log(`[auto-clear] released ${released.rowCount} earmark(s) from before per-deposit clearing`);

  const runs = await pgRunStore.listOpen(limit);
  if (!runs.length) return [];

  const signer = new ethers.Wallet(settlerKey(), chainProvider(chainId()));
  const issuer = issuerAt(writesAs(signer));
  if (!issuer || !signer.provider) return [];
  // The token repayments are made in, as the chain defines it -- never an address typed in here.
  // Phase 2c: it is the ledger's own (`StableCredit.reserveToken`); the ledger names no pool.
  const ledger = new ethers.Contract(String(await issuer.stableCredit()), ['function reserveToken() view returns (address)'], signer.provider);
  const usdc = new ethers.Contract(String(await ledger.reserveToken()), ERC20_ABI, writesAs(signer));

  const line = settlerChain(issuer, usdc, signer.address, signer.provider);
  // Term plans: the same switch and pause, `payPlan` (or carry) for the rest. Null without a TermIssuer.
  const term = await termChainSide(signer, line);
  const deps: AutoClearDeps = {
    store: pgRunStore,
    moves: lithicMoves,
    chainFor: (run) => {
      if (run.kind !== 'term') return line;
      if (!term) throw new Error('no TermIssuer on this chain');
      return term;
    },
    unbook: pgUnbook,
    alert: alertOps,
    notify: async (n) => {
      await notificationStore.emit({ wallet: n.wallet, kind: 'credit', title: n.title, body: n.body, data: n.data, dedupeKey: n.dedupeKey });
    },
    now: () => Date.now(),
  };

  const results: AutoRepayResult[] = [];
  for (const run of runs) {
    const step = await advanceRun(run, deps);
    if (step.action === 'off') {
      await pool.query(`UPDATE member_auto_repay SET enabled = false, verified_at = now() WHERE wallet = $1`, [run.wallet]);
    }
    if (step.action === 'repaid') console.log(`[auto-clear] ${run.wallet} cleared ${step.cents}c and moved it from Spendable (${step.txHash})`);
    if (step.action === 'failed') console.error(`[auto-clear] ${run.wallet} ${run.ref}: ${step.reason}`);
    results.push(step);
  }
  return results;
}
