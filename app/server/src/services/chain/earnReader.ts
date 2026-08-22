import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { savingsIntentService } from '../savingsIntentService.js';

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
  'function totalAssets() external view returns (uint256)',
  'function utilizationBps() external view returns (uint256)',
  'function supplyRatePerCycle() external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function convertToAssets(uint256 shares) external view returns (uint256)',
];

const BOND_ABI = [
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
  complete: boolean;
}

const toCents = (amount: bigint) => Number(amount / 10n ** 4n);

function resolveChainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

let cachedProvider: { chainId: number; provider: ethers.JsonRpcProvider } | null = null;
function getProvider(chainId: number): ethers.JsonRpcProvider {
  if (cachedProvider?.chainId === chainId) return cachedProvider.provider;
  const provider = new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(chainId));
  cachedProvider = { chainId, provider };
  return provider;
}

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

    return {
      apyPercent: (Number(supplyRate) / BPS) * CYCLES_PER_YEAR * 100,
      capacityCents: toCents(totalAssets),
      lentCents: Math.round((toCents(totalAssets) * Number(utilization)) / BPS),
      positionCents: toCents(position),
    };
  } catch (error) {
    console.error('[earn] pool read failed', address, error);
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

/** The Earn page's state, as the contracts hold it. */
export async function readChainEarn(
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
    return { pool: null, bonds: null, terms: null, complete: false };
  }

  const [pool, bonds, terms] = await Promise.all([
    poolAddress ? readPool(provider, poolAddress, wallet) : Promise.resolve(null),
    bondAddress ? readBonds(provider, bondAddress, wallet) : Promise.resolve([]),
    bondAddress ? readTerms(provider, bondAddress) : Promise.resolve([]),
  ]);

  return { pool, bonds, terms, complete: bonds !== null && terms !== null };
}
