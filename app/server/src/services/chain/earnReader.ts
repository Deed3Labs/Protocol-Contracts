import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { savingsIntentService } from '../savingsIntentService.js';
import { chainProvider } from './provider.js';
import { coalesce } from './readCache.js';

/*
 * The Earn page's two products, read from the contracts that hold them.
 *
 * Same three rules as the other readers: never on the authorization path, a failed read is not a
 * zero, no contract means the product simply is not there.
 *
 * One thing worth saying plainly. Bond terms are computed by asking the collection what it would
 * charge for a bond maturing on a given date, rather than by reproducing the discount curve here.
 * The curve is configurable per collection and its shape is a product decision -- linear, S-curve
 * or logarithmic -- so a copy of it in TypeScript would be a second answer that drifts the first
 * time somebody retunes it. Quoting a price the contract would not honour is worse than showing
 * no price.
 */

const POOL_ABI = [
  'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
  'function totalAssets() external view returns (uint256)',
  'function utilizationBps() external view returns (uint256)',
  'function supplyRatePerCycle() external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function convertToAssets(uint256 shares) external view returns (uint256)',
];

const BOND_ABI = [
  'event BondRedeemed(uint256 indexed bondId, address indexed redeemer, uint256 faceValue)',
  'function getBondIdsByCreator(address creator) external view returns (uint256[])',
  'function getBondInfo(uint256 bondId) external view returns (tuple(uint256 faceValue, uint256 maturityDate, uint256 discountPercentage, uint256 purchasePrice, bool isRedeemed, address creator, uint64 issuedAt))',
  'function presentValueOf(uint256 bondId) external view returns (uint256)',
  'function calculatePurchasePrice(uint256 faceValue, uint256 maturityDate) external view returns (uint256)',
  'function balanceOf(address account, uint256 id) external view returns (uint256)',
];

/** Cycles a year, for turning a per-cycle rate into the annual one a member is shown. */
const CYCLES_PER_YEAR = 365 / 30;
const BPS = 10_000;

export interface ChainPool {
  /** Annualised supply rate as a percentage, e.g. 6.8. */
  apyPercent: number;
  /** Lent out, and the pool's whole size, in cents. */
  lentCents: number;
  capacityCents: number;
  /** This member's position at present value, in cents. */
  positionCents: number;
  /**
   * What the position has made: what it is worth now, less what was put in.
   *
   * Cost basis is summed from the pool's own Deposit and Withdraw events rather than stored. The
   * pool knows what shares are worth, not what they cost -- but it emitted both at the time, so
   * the answer is on-chain, just not in a getter.
   */
  earnedCents: number;
}

export interface ChainHeldBond {
  bondId: string;
  faceCents: number;
  paidCents: number;
  /** What it is worth today -- what the credit line lends against, not the face. */
  worthTodayCents: number;
  maturityUnix: number;
  /** When it was issued. The term is this to maturity; months left is now to maturity. */
  issuedAtUnix: number;
  redeemed: boolean;
}

export interface ChainBondTerm {
  months: number;
  /** What the collection would actually charge today, in cents. */
  priceCents: number;
  faceCents: number;
  /** Effective annual rate implied by that price, as a percentage. */
  ratePercent: number;
}

export interface ChainEarn {
  pool: ChainPool | null;
  bonds: ChainHeldBond[] | null;
  terms: ChainBondTerm[] | null;
  /**
   * Everything the member's Earn products have made, in cents.
   *
   * Three parts, and the third is the one usually left out. Bonds still held have accrued the
   * difference between what was paid and what they are worth today. Bonds already redeemed made
   * the difference between what was paid and face, and that is *earned* whether or not the member
   * still holds anything -- dropping it would reset a member's lifetime earnings to zero the day
   * their last bond matured. And the pool's position above its cost basis.
   */
  earnedToDateCents: number;
  complete: boolean;
}

const toCents = (amount: bigint) => Number(amount / 10n ** 4n);

function resolveChainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

const getProvider = chainProvider;

async function readPool(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
): Promise<ChainPool | null> {
  try {
    const pool = new ethers.Contract(address, POOL_ABI, provider);
    const [totalAssets, utilization, supplyRate, shares] = await Promise.all([
      pool.totalAssets(),
      pool.utilizationBps(),
      pool.supplyRatePerCycle(),
      pool.balanceOf(wallet),
    ]);
    // Shares are worth what the pool would give for them, which is not their face while the pool
    // has earned anything.
    const position = shares > 0n ? await pool.convertToAssets(shares) : 0n;

    const costBasis = await readPoolCostBasis(pool, wallet);
    const positionCents = toCents(position);
    // Never negative. A position below its cost basis has lost money, and the page has no row for
    // that -- reporting it as negative earnings would put a minus sign where it means something
    // else entirely.
    const earnedCents = costBasis === null ? 0 : Math.max(0, positionCents - costBasis);

    return {
      apyPercent: (Number(supplyRate) / BPS) * CYCLES_PER_YEAR * 100,
      capacityCents: toCents(totalAssets),
      lentCents: Math.round((toCents(totalAssets) * Number(utilization)) / BPS),
      positionCents,
      earnedCents,
    };
  } catch (error) {
    console.error('[earn] pool read failed', address, error);
    return null;
  }
}

/**
 * What the member has put into the pool, net of what they have taken out.
 *
 * From events, because no getter holds it: ERC-4626 tracks shares, and what those shares cost is
 * only recorded in the Deposit and Withdraw the pool emitted at the time. Filtered on `owner`
 * rather than `sender`, so a deposit somebody else submitted on the member's behalf -- a relayer,
 * a sweep -- still counts as theirs.
 *
 * Returns null on failure rather than zero: a cost basis of zero makes the whole position read as
 * profit, which is the most flattering possible wrong answer.
 */
async function readPoolCostBasis(pool: ethers.Contract, wallet: string): Promise<number | null> {
  try {
    const [deposits, withdrawals] = await Promise.all([
      pool.queryFilter(pool.filters.Deposit(null, wallet), 0, 'latest'),
      pool.queryFilter(pool.filters.Withdraw(null, null, wallet), 0, 'latest'),
    ]);
    let basis = 0;
    for (const event of deposits) basis += toCents((event as ethers.EventLog).args.assets);
    for (const event of withdrawals) basis -= toCents((event as ethers.EventLog).args.assets);
    return Math.max(0, basis);
  } catch (error) {
    console.error('[earn] pool cost basis failed', error);
    return null;
  }
}

async function readBonds(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
): Promise<ChainHeldBond[] | null> {
  try {
    const collection = new ethers.Contract(address, BOND_ABI, provider);
    const ids: bigint[] = await collection.getBondIdsByCreator(wallet);
    const held: ChainHeldBond[] = [];

    for (const id of ids) {
      // Created is not the same as held: a bond can be transferred or seized, and one the member
      // no longer holds backs nothing of theirs.
      const balance: bigint = await collection.balanceOf(wallet, id);
      if (balance === 0n) continue;

      const [info, worth] = await Promise.all([
        collection.getBondInfo(id),
        collection.presentValueOf(id),
      ]);
      held.push({
        bondId: id.toString(),
        faceCents: toCents(info.faceValue),
        paidCents: toCents(info.purchasePrice),
        worthTodayCents: toCents(worth),
        maturityUnix: Number(info.maturityDate),
        issuedAtUnix: Number(info.issuedAt),
        redeemed: info.isRedeemed,
      });
    }
    return held;
  } catch (error) {
    console.error('[earn] bond read failed', address, error);
    return null;
  }
}

/**
 * The terms on offer, priced by the collection rather than by a copy of its curve.
 *
 * One face value is quoted across the offered maturities so the prices are comparable; the page
 * scales from there. A term the collection refuses to price -- outside its min or max maturity --
 * is dropped rather than shown at a guess.
 */
async function readTerms(
  provider: ethers.JsonRpcProvider,
  address: string,
): Promise<ChainBondTerm[] | null> {
  const OFFERED_MONTHS = [6, 12, 24, 36];
  const QUOTE_FACE = 1_000_000_000n; // 1,000 units at 6dp

  try {
    const collection = new ethers.Contract(address, BOND_ABI, provider);
    const now = Math.floor(Date.now() / 1000);
    const terms: ChainBondTerm[] = [];

    for (const months of OFFERED_MONTHS) {
      const maturity = now + months * 30 * 86_400;
      try {
        const price: bigint = await collection.calculatePurchasePrice(QUOTE_FACE, maturity);
        if (price === 0n || price >= QUOTE_FACE) continue;

        const faceCents = toCents(QUOTE_FACE);
        const priceCents = toCents(price);
        // The annual rate the discount actually implies, rather than the curve's nominal one.
        const growth = faceCents / priceCents;
        terms.push({
          months,
          priceCents,
          faceCents,
          ratePercent: (Math.pow(growth, 12 / months) - 1) * 100,
        });
      } catch {
        // Outside the collection's maturity bounds. Not an error -- just not on offer.
      }
    }
    return terms;
  } catch (error) {
    console.error('[earn] term read failed', address, error);
    return null;
  }
}

/**
 * What already-redeemed bonds made: face less what was paid, summed.
 *
 * Read from redemption events rather than from held bonds, because a redeemed bond is burnt --
 * the member holds nothing, and the gain would vanish with it. A member whose last bond matured
 * last week has still earned what it paid them.
 *
 * The purchase price comes from the bond record, which survives the burn: `_redeem` marks
 * `isRedeemed` and burns the token, but `bonds[bondId]` stays.
 */
async function readRedeemedGains(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
): Promise<number> {
  try {
    const collection = new ethers.Contract(address, BOND_ABI, provider);
    const events = await collection.queryFilter(
      collection.filters.BondRedeemed(null, wallet),
      0,
      'latest',
    );
    let gains = 0;
    for (const event of events) {
      const { bondId, faceValue } = (event as ethers.EventLog).args;
      const info = await collection.getBondInfo(bondId);
      gains += Math.max(0, toCents(faceValue) - toCents(info.purchasePrice));
    }
    return gains;
  } catch (error) {
    console.error('[earn] redeemed gains failed', address, error);
    return 0;
  }
}

/** The Earn page's state, as the contracts hold it. */
/*
 * Coalesced like the credit read, and for the same reason: the pool and bond figures are re-read by
 * the same five listeners on the same retry backoff, so one move asked for them twenty times over.
 * Dropped when the server writes collateral, so a settled read never answers from before the write.
 */
export function readChainEarn(wallet: string, chainId = resolveChainId()): Promise<ChainEarn> {
  return coalesce(`earn:${wallet.toLowerCase()}:${chainId}`, () => readChainEarnUncached(wallet, chainId));
}

async function readChainEarnUncached(
  wallet: string,
  chainId = resolveChainId(),
): Promise<ChainEarn> {
  const poolAddress = getContractAddress(chainId, 'LendingPool');
  const bondAddress = getContractAddress(chainId, 'BurnerBond');

  let provider: ethers.JsonRpcProvider;
  try {
    provider = getProvider(chainId);
  } catch (error) {
    console.error('[earn] no RPC for chain', chainId, error);
    return { pool: null, bonds: null, terms: null, earnedToDateCents: 0, complete: false };
  }

  const [pool, bonds, terms, redeemedGains] = await Promise.all([
    poolAddress ? readPool(provider, poolAddress, wallet) : Promise.resolve(null),
    bondAddress ? readBonds(provider, bondAddress, wallet) : Promise.resolve([]),
    bondAddress ? readTerms(provider, bondAddress) : Promise.resolve([]),
    bondAddress ? readRedeemedGains(provider, bondAddress, wallet) : Promise.resolve(0),
  ]);

  const accrued = (bonds ?? [])
    .filter((bond) => !bond.redeemed)
    .reduce((sum, bond) => sum + Math.max(0, bond.worthTodayCents - bond.paidCents), 0);

  return {
    pool,
    bonds,
    terms,
    earnedToDateCents: accrued + redeemedGains + (pool?.earnedCents ?? 0),
    complete: bonds !== null && terms !== null,
  };
}
