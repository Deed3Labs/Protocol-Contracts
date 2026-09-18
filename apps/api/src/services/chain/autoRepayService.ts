import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { ensureAutoRepayTables } from '../deposits/depositReceiptService.js';
import { recordUsdcRepayment } from './usdcRepaymentService.js';

/*
 * Automatic repayment from USDC deposits — "there is no pay button", for the USDC rail.
 *
 * A member who switched it on has, on chain, a mandate (`RevolvingIssuer.autoRepayEnabled`) and an
 * approval for the ledger to take their USDC. When a USDC deposit lands, what they owe is earmarked
 * (`auto_repay_due`) and auto-save runs only on the rest. This sweep repays the earmark ON CHAIN
 * with `repayForMember`: the member's own USDC, against their own debt, dearest tier first. The books
 * are then written from that transaction's events, exactly as for a Repay tap.
 *
 * The earmark can only be repaid as fast as debt reaches the chain. A card purchase still pending is
 * a hold, not debt yet, so what cannot be repaid now stays earmarked and is repaid when it settles.
 *
 * Every amount is bounded by the chain at the moment of repaying: the mandate still on, what is owed
 * on the tiers, the USDC the member holds, and what they approved. The member turning it off clears
 * the earmark, and the money is simply theirs again.
 */

const ISSUER_ABI = [
  'function autoRepayEnabled(address) view returns (bool)',
  'function totalPrincipalOf(address) view returns (uint256)',
  'function repayForMember(bytes32 ref, address member, uint256 amount)',
  'function autoRepaymentOf(bytes32 ref) view returns (uint256)',
  'function stableCredit() view returns (address)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'];
const CENTS = 10n ** 4n;

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

/** Record the member's choice after checking the chain agrees — the chain is the authority. */
export async function setAutoRepayChoice(walletInput: string, enabled: boolean): Promise<{ ok: boolean; reason?: string }> {
  const wallet = walletInput.trim().toLowerCase();
  const pool = getPayPool();
  const issuer = issuerAt(chainProvider(chainId()));
  if (!pool || !issuer) return { ok: false, reason: 'Not available on this network.' };
  const onChain = (await issuer.autoRepayEnabled(wallet)) as boolean;
  if (onChain !== enabled) return { ok: false, reason: 'Your wallet has not confirmed that yet. Try again in a moment.' };
  await ensureAutoRepayTables(pool);
  await pool.query(
    `INSERT INTO member_auto_repay (wallet, enabled) VALUES ($1, $2)
     ON CONFLICT (wallet) DO UPDATE SET enabled = EXCLUDED.enabled, verified_at = now()`,
    [wallet, enabled],
  );
  if (!enabled) await pool.query(`UPDATE auto_repay_due SET due_cents = 0, updated_at = now() WHERE wallet = $1`, [wallet]);
  return { ok: true };
}

export async function autoRepayStatus(walletInput: string): Promise<{ enabled: boolean; dueCents: number }> {
  const wallet = walletInput.trim().toLowerCase();
  const pool = getPayPool();
  if (!pool) return { enabled: false, dueCents: 0 };
  await ensureAutoRepayTables(pool);
  const e = await pool.query<{ enabled: boolean }>(`SELECT enabled FROM member_auto_repay WHERE wallet = $1`, [wallet]);
  const d = await pool.query<{ due_cents: string }>(`SELECT due_cents FROM auto_repay_due WHERE wallet = $1`, [wallet]);
  return { enabled: e.rows[0]?.enabled === true, dueCents: Number(d.rows[0]?.due_cents ?? 0) };
}

export interface AutoRepayResult {
  wallet: string;
  action: 'repaid' | 'waiting' | 'off' | 'failed';
  cents?: number;
  txHash?: string;
  reason?: string;
}

/** Repay what is earmarked, as far as the chain allows right now. */
export async function sweepAutoRepay(limit = 25): Promise<AutoRepayResult[]> {
  const pool = getPayPool();
  if (!pool || !settlerKey()) return [];
  await ensureAutoRepayTables(pool);
  const { rows } = await pool.query<{ wallet: string; due_cents: string }>(
    `SELECT wallet, due_cents FROM auto_repay_due WHERE due_cents > 0 ORDER BY updated_at LIMIT $1`,
    [limit],
  );
  if (!rows.length) return [];

  const signer = new ethers.Wallet(settlerKey(), chainProvider(chainId()));
  const issuer = issuerAt(signer);
  if (!issuer) return [];
  const stableCredit = String(await issuer.stableCredit());
  // The token repayments are made in, as the chain defines it -- never an address typed in here.
  const ledger = new ethers.Contract(stableCredit, ['function assurancePool() view returns (address)'], signer);
  const assurance = new ethers.Contract(String(await ledger.assurancePool()), ['function reserveToken() view returns (address)'], signer);
  const usdc = new ethers.Contract(String(await assurance.reserveToken()), ERC20_ABI, signer);
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
      const [owed, held, allowed] = (await Promise.all([
        issuer.totalPrincipalOf(wallet),
        usdc.balanceOf(wallet),
        usdc.allowance(wallet, stableCredit),
      ])) as [bigint, bigint, bigint];
      let amount = due;
      for (const cap of [owed, held, allowed]) if (cap < amount) amount = cap;
      amount = (amount / CENTS) * CENTS; // whole cents
      if (amount <= 0n) {
        const reason = owed === 0n ? 'nothing settled on chain yet' : held === 0n ? 'no USDC in the wallet' : 'approval spent';
        await pool.query(`UPDATE auto_repay_due SET updated_at = now() WHERE wallet = $1`, [wallet]);
        results.push({ wallet, action: 'waiting', reason });
        continue;
      }

      // A fresh ref per repayment; the earmark only shrinks once the chain has it.
      const seq = Date.now();
      const ref = ethers.id(`auto-repay:${wallet}:${seq}`);
      const tx = await issuer.repayForMember(ref, wallet, amount);
      await tx.wait(1);
      const cents = Number(amount / CENTS);
      await pool.query(
        `UPDATE auto_repay_due SET due_cents = GREATEST(0, due_cents - $2), updated_at = now() WHERE wallet = $1`,
        [wallet, cents],
      );
      // The books, and the pool's side, from the transaction itself -- as for a Repay tap.
      await recordUsdcRepayment(wallet, tx.hash);
      console.log(`[auto-repay] ${wallet} repaid ${cents}c from their USDC (${tx.hash})`);
      results.push({ wallet, action: 'repaid', cents, txHash: tx.hash });
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      console.error(`[auto-repay] ${wallet} failed: ${reason}`);
      results.push({ wallet, action: 'failed', reason });
    }
  }
  return results;
}
