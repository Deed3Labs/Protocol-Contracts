import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { AUTO_CLEAR_SOURCE, ensureAutoRepayTables } from '../deposits/depositReceiptService.js';
import { recordUsdcRepayment } from './usdcRepaymentService.js';
import { decodeChainError } from './chainErrors.js';
import { notificationStore } from '../notificationStore.js';
import { alertOps } from '../opsAlert.js';

/*
 * Auto-clear (Phase 2b, section 12.2 as replaced) — "there is no pay button".
 *
 * Only on Spendable deposits (owner's option 1, `depositApplication`): a fiat deposit at the partner
 * bank is earmarked; a USDC (Bridge) deposit never is, because that USDC is the member's own and the
 * settler would be paying their debt for them. The sweep pays only `source = 'spendable'` earmarks.
 *
 * A member who switched it on (`RevolvingIssuer.setAutoClear(on, scope)`, or their `AutoClear`
 * signature at onboarding) has what they owe cleared from a deposit as it lands, dearest tier first,
 * within the scope they chose: UNSECURED_ONLY (income-backed and Boost, the default) or ALL. When a
 * deposit arrives, what they owe is earmarked (`auto_repay_due`) and auto-save runs only on the
 * rest. This sweep clears the earmark ON CHAIN with `repayForMember(ref, member, amount)`.
 *
 * **The settler delivers the cash.** `repayForMember` pulls the reserve token from the card settler
 * (`msg.sender`), never from the member: the member's USDC and CLRUSD are never swept, and the member
 * approves nothing. So the settler keeps an allowance to the RevolvingIssuer (approved here, exactly
 * what is needed, when it runs short) and holds the USDC it pays. The contract applies
 * min(amount, owed within scope) and emits `AutoCleared(ref, member, applied, remainder)`; the
 * member is told "$X cleared · $Y now spendable", and the remainder leaves the earmark.
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
  if (!enabled) await pool.query(`UPDATE auto_repay_due SET due_cents = 0, updated_at = now() WHERE wallet = $1`, [wallet]);
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
    const d = await pool.query<{ due_cents: string }>(`SELECT due_cents FROM auto_repay_due WHERE wallet = $1`, [wallet]);
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

export interface AutoRepayResult {
  wallet: string;
  action: 'repaid' | 'waiting' | 'off' | 'paused' | 'failed';
  cents?: number;
  /** What was left of the earmark once everything in scope was cleared: the member's again. */
  releasedCents?: number;
  txHash?: string;
  reason?: string;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/** Clear what is earmarked, as far as the chain allows right now, with the settler's cash. */
export async function sweepAutoRepay(limit = 25): Promise<AutoRepayResult[]> {
  const pool = getPayPool();
  if (!pool || !settlerKey()) return [];
  await ensureAutoRepayTables(pool);
  /*
   * Only earmarks from Spendable deposits (fiat at the partner bank) are cleared with the settler's
   * cash. One from anywhere else -- a USDC (Bridge) deposit earmarked before this rule -- is the
   * member's own money in their own wallet: it is released, never paid by the settler.
   */
  const released = await pool.query(
    `UPDATE auto_repay_due SET due_cents = 0, updated_at = now()
      WHERE due_cents > 0 AND source IS DISTINCT FROM '${AUTO_CLEAR_SOURCE}'`,
  );
  if (released.rowCount) console.log(`[auto-clear] released ${released.rowCount} earmark(s) not from a Spendable deposit`);
  const { rows } = await pool.query<{ wallet: string; due_cents: string }>(
    `SELECT wallet, due_cents FROM auto_repay_due
      WHERE due_cents > 0 AND source = '${AUTO_CLEAR_SOURCE}'
      ORDER BY updated_at LIMIT $1`,
    [limit],
  );
  if (!rows.length) return [];

  const signer = new ethers.Wallet(settlerKey(), chainProvider(chainId()));
  const issuer = issuerAt(writesAs(signer));
  if (!issuer) return [];

  // The governed network-wide switch: while it is off nothing is cleared for anyone, and the
  // earmarks wait rather than being guessed at.
  const terms = (await issuer.creditTerms()) as { autoClearOffGlobal: boolean };
  if (terms.autoClearOffGlobal) {
    console.warn('[auto-clear] switched off network-wide (creditTerms.autoClearOffGlobal); earmarks wait');
    return rows.map((r) => ({ wallet: r.wallet, action: 'paused' as const }));
  }

  const issuerAddress = await issuer.getAddress();
  const stableCredit = String(await issuer.stableCredit());
  // The token repayments are made in, as the chain defines it -- never an address typed in here.
  // Phase 2c: it is the ledger's own (`StableCredit.reserveToken`); the ledger names no pool.
  const ledger = new ethers.Contract(stableCredit, ['function reserveToken() view returns (address)'], signer.provider);
  const usdc = new ethers.Contract(String(await ledger.reserveToken()), ERC20_ABI, writesAs(signer));
  const settler = signer.address;
  const results: AutoRepayResult[] = [];

  for (const row of rows) {
    const wallet = row.wallet;
    const due = BigInt(row.due_cents) * CENTS;
    try {
      if (!((await issuer.autoRepayEnabled(wallet)) as boolean)) {
        // Turned off on chain: the earmark is released and the money is simply theirs.
        await pool.query(`UPDATE auto_repay_due SET due_cents = 0, updated_at = now() WHERE wallet = $1`, [wallet]);
        await pool.query(`UPDATE member_auto_repay SET enabled = false, verified_at = now() WHERE wallet = $1`, [wallet]);
        results.push({ wallet, action: 'off' });
        continue;
      }
      // Bounded by what is owed in the member's scope. Not by the member's own USDC or approval:
      // the settler pays, and nothing is taken from the member's wallet.
      const scope = Number(await issuer.autoClearScopeOf(wallet));
      const owed = await owedInScope(issuer, wallet, scope);
      let amount = owed < due ? owed : due;
      amount = (amount / CENTS) * CENTS; // whole cents
      if (amount <= 0n) {
        await pool.query(`UPDATE auto_repay_due SET updated_at = now() WHERE wallet = $1`, [wallet]);
        results.push({ wallet, action: 'waiting', reason: 'nothing in scope settled on chain yet' });
        continue;
      }

      const [held, allowed] = (await Promise.all([usdc.balanceOf(settler), usdc.allowance(settler, issuerAddress)])) as [bigint, bigint];
      if (held < amount) {
        await alertOps({
          key: 'auto-clear:settler-balance',
          subject: 'Auto-clear: the card settler is short of USDC',
          body: `The card settler ${settler} holds ${held} units and needs ${amount} to clear ${wallet}'s deposit. Auto-clear delivers the cash from the settler (repayForMember pulls from msg.sender); top it up.`,
        }).catch(() => {});
        results.push({ wallet, action: 'failed', reason: 'settler balance too low' });
        continue;
      }
      if (allowed < amount) {
        // Exactly what this clearing needs: the issuer can pull no more than the settler meant.
        const approval = await usdc.approve(issuerAddress, amount);
        await approval.wait(1);
      }

      // A fresh ref per clearing; the earmark only shrinks once the chain has it.
      const ref = ethers.id(`auto-clear:${wallet}:${Date.now()}`);
      const tx = await issuer.repayForMember(ref, wallet, amount);
      const receipt = await tx.wait(1);
      let applied = amount;
      let remainder = 0n;
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = issuer.interface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === 'AutoCleared') {
            applied = parsed.args.applied as bigint;
            remainder = parsed.args.remainder as bigint;
          }
        } catch {
          /* not ours */
        }
      }
      const cents = Number(applied / CENTS);
      // What the chain did not need is no longer owed in scope: it leaves the earmark with what was
      // applied, and is the member's to spend.
      const releasedCents = Number(remainder / CENTS);
      await pool.query(
        `UPDATE auto_repay_due SET due_cents = GREATEST(0, due_cents - $2), updated_at = now() WHERE wallet = $1`,
        [wallet, cents + releasedCents],
      );
      // The books, and the pool's side, from the transaction itself -- as for a Repay tap.
      await recordUsdcRepayment(wallet, tx.hash, 'auto');
      await notificationStore
        .emit({
          wallet,
          kind: 'credit',
          title: 'Cleared from your deposit',
          body:
            releasedCents > 0
              ? `${money(cents)} cleared · ${money(releasedCents)} now spendable`
              : `${money(cents)} cleared`,
          data: { txHash: tx.hash, appliedCents: cents, spendableCents: releasedCents },
          dedupeKey: `auto-clear:${tx.hash}`,
        })
        .catch(() => {});
      console.log(`[auto-clear] ${wallet} cleared ${cents}c with the settler's cash (${tx.hash})`);
      results.push({ wallet, action: 'repaid', cents, releasedCents, txHash: tx.hash });
    } catch (error) {
      const decoded = decodeChainError(error);
      if (decoded?.name === 'RevolvingIssuerNothingToClear') {
        await pool.query(`UPDATE auto_repay_due SET updated_at = now() WHERE wallet = $1`, [wallet]);
        results.push({ wallet, action: 'waiting', reason: 'nothing in scope owed on chain' });
        continue;
      }
      if (decoded?.name === 'RevolvingIssuerAutoClearOff') {
        results.push({ wallet, action: 'paused', reason: 'switched off network-wide' });
        continue;
      }
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      console.error(`[auto-clear] ${wallet} failed: ${reason}`);
      results.push({ wallet, action: 'failed', reason });
    }
  }
  return results;
}
