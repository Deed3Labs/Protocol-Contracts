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

/** ERC-1155 bonds, priced by the collection rather than by a copy of its discount curve. */
const BOND_ABI = [
  'function getBondIdsByCreator(address creator) external view returns (uint256[])',
  'function getBondInfo(uint256 bondId) external view returns (tuple(uint256 faceValue, uint256 maturityDate, uint256 discountPercentage, uint256 purchasePrice, bool isRedeemed, address creator, uint64 issuedAt))',
  'function presentValueOf(uint256 bondId) external view returns (uint256)',
  'function balanceOf(address account, uint256 id) external view returns (uint256)',
] as const;

/** The bond collection quotes in its settlement stablecoin — 6 decimals, same as CLRUSD and USDC. */
const BOND_DECIMALS = 6;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface ChainCollateral {
  /** CLRUSD held in the ESA, in cents. Null when the read failed. */
  savingsCents: number | null;
  /** Yield-pool position at present value, in cents. Null when the read failed. */
  poolPositionCents: number | null;
  /**
   * Bonds at present value, in cents.
   *
   * This said "always 0 today — there is no bond contract deployed to read". There was: BurnerBond,
   * which earnReader reads for the Earn page. So a member's bonds appeared on one page and backed
   * no credit on another, off the same chain state. Read properly now, and 0 means no bonds rather
   * than no reader.
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
    /*
     * A revert is an answer. Unreachable is not.
     *
     * Rule 2 says a failed read is not a balance of zero, and that is right about an RPC that timed
     * out or was rate-limited — we genuinely do not know, and reporting zero would cut a member's
     * limit over a network blip. But a call that reverts *deterministically* is not an unknown: the
     * chain answered, and the answer is that this address cannot tell us a share balance. Under
     * rule 3 that is a pool backing nothing, which is zero.
     *
     * The distinction is not academic. `0xd8a171…` on Base Sepolia reverts on both `balanceOf` and
     * `decimals` — it is not an ERC-4626 at all. Returning null for it made `complete` false, which
     * sent refreshSnapshot down its carry-forward branch, which discarded a working credit capacity
     * read of $431.44 and wrote zeros instead. Every card authorization then declined, for a member
     * whose limit the contracts could state exactly.
     */
    if (isDeterministicRevert(error)) {
      console.warn(
        `[collateral] pool at ${address} is not a readable ERC-4626 — treating the position as zero`,
      );
      return 0;
    }
    console.error(`[collateral] pool read unreachable at ${address}:`, error);
    return null;
  }
}

/**
 * Did the chain answer "no", or did we fail to ask?
 *
 * ethers reports both as CALL_EXCEPTION, so the discriminator is whether a revert actually came
 * back. "missing revert data" is what a node sends when a call reverted without a reason string —
 * the chain answered. A timeout, a rate limit or a transport failure carries a different code
 * entirely and must stay unknown, because those are exactly the blips rule 2 exists to survive.
 */
function isDeterministicRevert(error: unknown): boolean {
  if ((error as { code?: string })?.code !== 'CALL_EXCEPTION') return false;
  const shortMessage = String((error as { shortMessage?: string })?.shortMessage ?? '');
  return (
    shortMessage.includes('missing revert data') ||
    shortMessage.includes('execution reverted') ||
    (error as { data?: unknown })?.data != null
  );
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
  /*
   * The same contracts the Earn page reads, because they are the same holdings.
   *
   * This asked CLRUSDTokenPool for a share balance. That is a Chainlink CCIP token pool — it moves
   * CLRUSD between chains and has no shares at all — so every call reverted, and the member's whole
   * credit line read as unknown. The ERC-4626 that actually holds their position is LendingPool,
   * which earnReader has been reading correctly the whole time. One address for one pool.
   */
  const pool = getContractAddress(chainId, 'LendingPool');
  const bonds = getContractAddress(chainId, 'BurnerBond');

  let provider: ethers.JsonRpcProvider;
  try {
    provider = getProvider(chainId);
  } catch (error) {
    // No RPC configured is a deployment gap, not a member with no money.
    console.error('[collateral] no RPC for chain', chainId, error);
    return { savingsCents: null, poolPositionCents: null, bondsWorthCents: 0, complete: false };
  }

  const [savingsCents, poolPositionCents, bondsCents] = await Promise.all([
    isUnset(clrusd) ? Promise.resolve(0) : readTokenCents(provider, clrusd as string, wallet),
    isUnset(pool) ? Promise.resolve(0) : readPoolCents(provider, pool as string, wallet),
    isUnset(bonds) ? Promise.resolve(0) : readBondCents(provider, bonds as string, wallet),
  ]);

  return {
    savingsCents,
    poolPositionCents,
    bondsWorthCents: bondsCents ?? 0,
    complete: savingsCents !== null && poolPositionCents !== null && bondsCents !== null,
  };
}

/**
 * Bonds the member holds, at present value.
 *
 * This returned a hardcoded zero, on the stated grounds that no bond contract was deployed to read.
 * One is: BurnerBond, which earnReader has been reading for the Earn page all along. So a member's
 * bonds showed on one page and backed no credit on another, from the same chain state.
 *
 * Present value, not face: a bond matures into its face value and is worth less until it does.
 * Lending against face would lend against money that does not exist yet.
 *
 * Created is not held — a bond can be transferred or seized — so each id's balance is checked, and a
 * redeemed bond backs nothing because it has already been paid out.
 */
async function readBondCents(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
): Promise<number | null> {
  try {
    const collection = new ethers.Contract(address, BOND_ABI, provider);
    const ids = (await collection.getBondIdsByCreator(wallet)) as bigint[];

    let total = 0;
    for (const id of ids) {
      const balance = (await collection.balanceOf(wallet, id)) as bigint;
      if (balance === 0n) continue;
      const info = (await collection.getBondInfo(id)) as { isRedeemed: boolean };
      if (info.isRedeemed) continue;
      // Bond values are quoted in the collection's settlement token, which is the 6-decimal
      // stablecoin the pool and CLRUSD both use.
      total += toCents((await collection.presentValueOf(id)) as bigint, BOND_DECIMALS);
    }
    return total;
  } catch (error) {
    if (isDeterministicRevert(error)) {
      console.warn(`[collateral] bond collection at ${address} cannot be read — treating as zero`);
      return 0;
    }
    console.error(`[collateral] bond read unreachable at ${address}:`, error);
    return null;
  }
}
