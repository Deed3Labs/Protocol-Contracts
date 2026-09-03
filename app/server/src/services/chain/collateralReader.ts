import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { savingsIntentService } from '../savingsIntentService.js';
import { chainProvider } from './provider.js';

/*
 * Reading a member's on-chain collateral — the layer the snapshot has been missing.
 *
 * Until now `refreshSnapshot` took CLRUSD, bond value and pool position as parameters that
 * defaulted to zero, which meant every member's savings-backed and asset-backed limits read as zero
 * unless a caller happened to know better. That was honest scaffolding while there was no chain
 * layer. This is the chain layer.
 *
 * Three rules govern everything here:
 *
 * 1. NEVER ON THE AUTHORIZATION PATH. These are network calls with no bounded latency, and the auth
 *    stream answers in under three seconds. Snapshots are written here and only read there.
 *
 * 2. A READ THAT FAILS IS NOT A BALANCE OF ZERO. An RPC timeout means we don't know. Reporting zero
 *    would silently cut a member's limit to nothing over a network blip, so failures are reported
 *    as `null` and the caller keeps the previous snapshot rather than writing a wrong one.
 *
 * 3. NO CONTRACT MEANS NO CREDIT, and that one is deliberate. An unset address reads as zero, not
 *    as an error, because credit backed by a contract that doesn't exist is credit backed by
 *    nothing.
 */

const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
] as const;

/** The yield pool's accounting, in ERC-4626 terms — shares in, assets out. */
const POOL_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function convertToAssets(uint256 shares) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface ChainCollateral {
  /** CLRUSD held in the ESA, in cents. Null when the read failed. */
  savingsCents: number | null;
  /** Yield-pool position at present value, in cents. Null when the read failed. */
  poolPositionCents: number | null;
  /**
   * Bonds at present value, in cents.
   *
   * Always 0 today: bonds exist in the product model and on the Earn page, but there is no bond
   * contract deployed to read. Reporting 0 rather than null is the correct answer to "what is
   * on-chain right now", and it means no member gets asset-backed credit against a bond the chain
   * has never heard of. When the contract lands, this is the one place that changes.
   */
  bondsWorthCents: number;
  /** True when every read that could be attempted succeeded. */
  complete: boolean;
}

function resolveChainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8453;
}

function isUnset(address: string | null): boolean {
  return !address || address.toLowerCase() === ZERO_ADDRESS;
}

/**
 * Convert a token amount to cents at its own decimals.
 *
 * Done in bigint the whole way — CLRUSD is 1:1 with the dollar but has 6 or 18 decimals depending
 * on deployment, and floating point on a balance is how a member's collateral quietly drifts.
 */
function toCents(amount: bigint, decimals: number): number {
  if (decimals <= 2) return Number(amount) * 10 ** (2 - decimals);
  const divisor = 10n ** BigInt(decimals - 2);
  return Number(amount / divisor);
}

const getProvider = chainProvider;

async function readTokenCents(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
): Promise<number | null> {
  try {
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    const [balance, decimals] = await Promise.all([
      token.balanceOf(wallet) as Promise<bigint>,
      token.decimals() as Promise<bigint>,
    ]);
    return toCents(balance, Number(decimals));
  } catch (error) {
    console.error(`[collateral] token read failed at ${address}:`, error);
    return null;
  }
}

/**
 * Pool position at present value.
 *
 * Shares are converted through `convertToAssets` rather than counted, because a yield-bearing share
 * is not worth its face — that conversion IS the position's value, and lending 70% of a share count
 * would lend against the wrong number.
 */
async function readPoolCents(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
): Promise<number | null> {
  try {
    const pool = new ethers.Contract(address, POOL_ABI, provider);
    const shares = (await pool.balanceOf(wallet)) as bigint;
    if (shares === 0n) return 0;

    const [assets, decimals] = await Promise.all([
      pool.convertToAssets(shares) as Promise<bigint>,
      pool.decimals() as Promise<bigint>,
    ]);
    return toCents(assets, Number(decimals));
  } catch (error) {
    console.error(`[collateral] pool read failed at ${address}:`, error);
    return null;
  }
}

/**
 * Everything on-chain that backs this member's credit.
 *
 * Reads run in parallel — they're independent, and the caller is a background job whose latency
 * budget is a snapshot refresh rather than an authorization.
 */
export async function readChainCollateral(
  wallet: string,
  chainId = resolveChainId(),
): Promise<ChainCollateral> {
  const clrusd = getContractAddress(chainId, 'CLRUSD');
  const pool = getContractAddress(chainId, 'CLRUSDTokenPool');

  let provider: ethers.JsonRpcProvider;
  try {
    provider = getProvider(chainId);
  } catch (error) {
    // No RPC configured is a deployment gap, not a member with no money.
    console.error('[collateral] no RPC for chain', chainId, error);
    return { savingsCents: null, poolPositionCents: null, bondsWorthCents: 0, complete: false };
  }

  const [savingsCents, poolPositionCents] = await Promise.all([
    isUnset(clrusd) ? Promise.resolve(0) : readTokenCents(provider, clrusd as string, wallet),
    isUnset(pool) ? Promise.resolve(0) : readPoolCents(provider, pool as string, wallet),
  ]);

  return {
    savingsCents,
    poolPositionCents,
    bondsWorthCents: 0,
    complete: savingsCents !== null && poolPositionCents !== null,
  };
}
