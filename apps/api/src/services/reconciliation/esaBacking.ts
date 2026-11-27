import { ethers } from 'ethers';
import { savingsGaslessService } from '../savingsGaslessService.js';

/*
 * Is every CLRUSD backed by a dollar of USDC actually sitting in the vault?
 *
 * This is the real ESA backing invariant, and it is a question about two contracts rather than
 * about our records. A member deposits USDC into the ESA vault and CLRUSD is minted representing
 * their savings; redeeming burns the CLRUSD and returns the USDC. So the USDC never leaves the
 * protocol while the CLRUSD exists, and that is precisely what lets savings back credit — the
 * collateral is real and it is here.
 *
 * Which means the invariant that matters is:
 *
 *     USDC held by the ESA vault  ==  CLRUSD in circulation
 *
 * Not a comparison of our own bookkeeping against itself. If those two ever diverge, either CLRUSD
 * exists that nothing backs, or USDC is trapped that nobody can redeem — and savings-backed credit
 * is lending against the first case.
 *
 * The spec worded this as "co-op fiat received from sweeps = CLRUSD minted", which was the treasury
 * model's version of the same question. There is no co-op fiat now: sweeps travel the member's own
 * Bridge account. This asks the question of the contracts, which is where the answer has always
 * actually lived — and unlike the sweep-based version, it covers deposits that never came through a
 * sweep at all.
 */

const ERC20_SUPPLY_ABI = [
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

export interface EsaBacking {
  /** USDC held by the vault, in cents. Null when it could not be read. */
  vaultUsdcCents: number | null;
  /** CLRUSD in circulation, in cents. Null when it could not be read. */
  clrusdSupplyCents: number | null;
}

/** Token units to cents, in bigint the whole way — no float ever touches a balance. */
function toCents(amount: bigint, decimals: number): number {
  if (decimals <= 2) return Number(amount) * 10 ** (2 - decimals);
  return Number(amount / 10n ** BigInt(decimals - 2));
}

/**
 * Read both sides.
 *
 * Each side is read independently and either can come back null: an unconfigured CLRUSD address or
 * an RPC failure must report "could not check" rather than a zero that would look like every token
 * being unbacked. A reconciler that cries wolf on a network blip is a reconciler nobody reads.
 */
export async function readEsaBacking(): Promise<EsaBacking> {
  let config: ReturnType<typeof savingsGaslessService.resolveConfig>;
  try {
    config = savingsGaslessService.resolveConfig();
  } catch (error) {
    // No vault configured for this chain — nothing to check, and saying so beats guessing.
    console.warn('[reconcile] ESA not configured:', (error as Error)?.message);
    return { vaultUsdcCents: null, clrusdSupplyCents: null };
  }

  const vaultUsdcCents = await savingsGaslessService
    .vaultUsdcBalance(config)
    // USDC is six decimals on every chain we run on, but read it as data rather than assume it.
    .then((raw) => toCents(raw, 6))
    .catch((error) => {
      console.error('[reconcile] could not read vault USDC:', error);
      return null;
    });

  if (!config.clrusdAddress || !ethers.isAddress(config.clrusdAddress)) {
    return { vaultUsdcCents, clrusdSupplyCents: null };
  }

  const clrusdSupplyCents = await (async () => {
    try {
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const clrusd = new ethers.Contract(config.clrusdAddress, ERC20_SUPPLY_ABI, provider);
      const [supply, decimals] = await Promise.all([
        clrusd.totalSupply() as Promise<bigint>,
        clrusd.decimals() as Promise<bigint>,
      ]);
      return toCents(supply, Number(decimals));
    } catch (error) {
      console.error('[reconcile] could not read CLRUSD supply:', error);
      return null;
    }
  })();

  return { vaultUsdcCents, clrusdSupplyCents };
}
