import { ethers } from 'ethers';
import { getContractAddress } from '../config/contracts.js';
import { savingsIntentService } from '../services/savingsIntentService.js';
import { savingsRelayerService } from '../services/savingsRelayerService.js';
import { sendRelayerService } from '../services/sendRelayerService.js';

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
 *
 * ## Each relayer, on its own chain
 *
 * There are two, and they do not live on the same network: savings and collateral sign on Base
 * Sepolia, send signs on Base mainnet. Checking both against one chain id reports the mainnet
 * account as empty, because it holds nothing on testnet and never will — which is a false alarm
 * every day, and a false alarm every day is how a real one gets ignored. I made exactly that
 * mistake by hand before writing this, which is why the chain travels with the account here rather
 * than being read once from the environment.
 */

/** Measured from a real pushCapacities on Base Sepolia. Recomputed below when an estimate works. */
const FALLBACK_GAS_PER_SYNC = 470_000n;

/** Below this many remaining syncs, say so. Two weeks of a quiet member base, roughly. */
const LOW_RUNWAY = 50;

export interface RelayerGasReport {
  label: string;
  chainId: number;
  address: string;
  balanceWei: bigint;
  gasPerSync: bigint;
  weiPerSync: bigint;
  syncsRemaining: number;
  low: boolean;
}

function envChainId(...names: string[]): number | null {
  for (const name of names) {
    const parsed = Number((process.env[name] || '').trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/** The signers this server pays gas for, each with the chain it actually operates on. */
async function relayers(): Promise<Array<{ label: string; chainId: number; address: string }>> {
  const out: Array<{ label: string; chainId: number; address: string }> = [];

  const savingsChain = envChainId('SAVINGS_DEFAULT_CHAIN_ID', 'SEND_DEFAULT_CHAIN_ID') ?? 84532;
  const savings = await savingsRelayerService.relayerAddress(savingsChain);
  if (savings) out.push({ label: 'savings+collateral', chainId: savingsChain, address: savings });

  /*
   * Send is a separate account on a separate chain, and it is reported separately.
   *
   * Its address is resolved through its own service rather than assumed equal to savings': they
   * were the same account once and are not now, and a monitor that quietly watches the wrong
   * address is worse than one that watches none.
   */
  const sendChain = envChainId('SEND_DEFAULT_CHAIN_ID') ?? savingsChain;
  const send = await sendRelayerAddress(sendChain);
  if (send && !(send === savings && sendChain === savingsChain)) {
    out.push({ label: 'send', chainId: sendChain, address: send });
  }
  return out;
}

async function sendRelayerAddress(chainId: number): Promise<string | null> {
  /*
   * Chain-suffixed first, exactly as the service itself resolves it.
   *
   * The first version of this read only the global variable — the same suffixed-vs-global mistake
   * this whole monitor exists to catch, made inside the monitor. It reported the mainnet address on
   * a testnet chain even after the suffixed override had been set, so the fix looked like it had
   * not worked.
   */
  const override =
    (process.env[`SEND_CDP_EVM_ACCOUNT_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv] || '').trim() ||
    (process.env.SEND_CDP_EVM_ACCOUNT_ADDRESS || '').trim();
  if (override) {
    try { return ethers.getAddress(override); } catch { return null; }
  }
  try {
    const resolved = (sendRelayerService as unknown as { relayerAddress?: (id: number) => Promise<string | null> })
      .relayerAddress;
    return resolved ? await resolved.call(sendRelayerService, chainId) : null;
  } catch {
    return null;
  }
}

export async function checkRelayerGas(
  relayer: { label: string; chainId: number; address: string },
): Promise<RelayerGasReport | null> {
  const { chainId: id, address } = relayer;
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

  return { label: relayer.label, chainId: id, address, balanceWei, gasPerSync, weiPerSync, syncsRemaining, low: syncsRemaining < LOW_RUNWAY };
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
      const found = await relayers();
      if (found.length === 0) {
        console.warn('[gas] No relayer address resolved — chain writes cannot be signed.');
        return;
      }
      for (const relayer of found) {
        try {
          const report = await checkRelayerGas(relayer);
          if (!report) continue;
          const line =
            `[gas] ${report.label} ${report.address} on chain ${report.chainId}: ` +
            `${ethers.formatEther(report.balanceWei)} ETH · ~${report.syncsRemaining} writes left ` +
            `(${ethers.formatEther(report.weiPerSync)} each)`;
          if (report.low) console.warn(`${line} — LOW, top this account up.`);
          else console.log(line);
        } catch (error) {
          console.error(`[gas] ${relayer.label} check failed:`, error instanceof Error ? error.message : error);
        }
      }
    } catch (error) {
      console.error('[gas] check failed:', error instanceof Error ? error.message : error);
    }
  };

  void run();
  setInterval(() => void run(), 24 * 60 * 60 * 1000).unref?.();
}
