import { ethers } from 'ethers';
import { getContractAddress } from '../config/contracts.js';
import { savingsIntentService } from '../services/savingsIntentService.js';
import { savingsRelayerService } from '../services/savingsRelayerService.js';

/*
 * Is the account that signs our chain writes able to pay for the next one?
 *
 * Nothing asked this before, which is why an empty operator account presented itself as a member's
 * credit limit being wrong by $25 rather than as an alert. A signer with no gas does not fail
 * loudly: the pledge does not happen, the capacity is not pushed, and every figure downstream is
 * quietly a little stale.
 *
 * ## The threshold is measured, not chosen
 *
 * An earlier version of this idea used a hardcoded 0.002 ETH and reported a perfectly healthy
 * account as empty — the real cost of a sync on this chain is about four thousandths of that. A
 * number picked by hand is wrong on every chain except the one it was picked on, and wrong again
 * the next time gas moves.
 *
 * So: ask the network what a unit of gas costs right now, multiply by what one push actually uses,
 * and report the answer as a count of transactions remaining. "About 40 syncs left" is a sentence
 * someone can act on. "0.0019 ETH" is not.
 */

/** Measured from a real pushCapacities on Base Sepolia. Recomputed below when an estimate works. */
const FALLBACK_GAS_PER_SYNC = 470_000n;

/** Below this many remaining syncs, say so. Two weeks of a quiet member base, roughly. */
const LOW_RUNWAY = 50;

export interface RelayerGasReport {
  address: string | null;
  balanceWei: bigint;
  gasPerSync: bigint;
  weiPerSync: bigint;
  syncsRemaining: number;
  low: boolean;
}

function chainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

export async function checkRelayerGas(): Promise<RelayerGasReport | null> {
  const id = chainId();
  const address = await savingsRelayerService.relayerAddress(id);
  if (!address) return null;

  const provider = new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(id));
  const [balanceWei, fees] = await Promise.all([provider.getBalance(address), provider.getFeeData()]);

  // maxFeePerGas is what a transaction can be charged at worst, which is the number that decides
  // whether the next one can be afforded. Using the base fee would report runway we might not have.
  const perGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;

  let gasPerSync = FALLBACK_GAS_PER_SYNC;
  const calculator = getContractAddress(id, 'LimitCalculator');
  if (calculator) {
    try {
      // Estimated against the relayer itself: gas depends on the state being written, and an
      // estimate for a different sender is a measurement of somebody else's transaction.
      const contract = new ethers.Contract(calculator, ['function pushCapacities(address) returns (uint256)'], provider);
      gasPerSync = await contract.pushCapacities.estimateGas(address, { from: address });
    } catch {
      // A revert here means nothing to push for that address, which tells us nothing about cost.
    }
  }

  const weiPerSync = perGas * gasPerSync;
  const syncsRemaining = weiPerSync > 0n ? Number(balanceWei / weiPerSync) : 0;

  return { address, balanceWei, gasPerSync, weiPerSync, syncsRemaining, low: syncsRemaining < LOW_RUNWAY };
}

/**
 * Check on boot and daily.
 *
 * Daily because gas runs out over weeks, not minutes, and a check that runs every minute is a check
 * nobody reads. On boot because a deploy is when the configuration most recently changed.
 */
export function startRelayerGasMonitor(): void {
  const run = async () => {
    try {
      const report = await checkRelayerGas();
      if (!report) {
        console.warn('[gas] No relayer address resolved — chain writes cannot be signed.');
        return;
      }
      const line =
        `[gas] ${report.address}: ${ethers.formatEther(report.balanceWei)} ETH · ` +
        `~${report.syncsRemaining} syncs left (${ethers.formatEther(report.weiPerSync)} each)`;
      if (report.low) console.warn(`${line} — LOW, top this account up.`);
      else console.log(line);
    } catch (error) {
      console.error('[gas] check failed:', error instanceof Error ? error.message : error);
    }
  };

  void run();
  setInterval(() => void run(), 24 * 60 * 60 * 1000).unref?.();
}
