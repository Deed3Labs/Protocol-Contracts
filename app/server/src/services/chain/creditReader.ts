import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { savingsIntentService } from '../savingsIntentService.js';

/*
 * Reading a member's credit line from the contracts that own it.
 *
 * The three rules from `collateralReader` hold here too and are not restated: never on the
 * authorization path, a failed read is not a zero, and no contract means no credit.
 *
 * One rule is specific to this file. **The chain is canonical for what it knows.** `tierLimits.ts`
 * computes savings and asset limits from raw balances at fixed loan-to-values, which was right
 * while nothing on-chain did — but `LimitCalculator` now applies the registry's own haircuts to
 * the registry's own valuations, including bonds that accrete daily. Two implementations of one
 * rule set drift, and the build plan (§4) says which way that resolves: the on-chain version is
 * canonical and the off-chain path mirrors it.
 *
 * So this reads capacities rather than recomputing them. What it cannot read is income and Boost:
 * both are underwritten off-chain and reach the chain as attestations, so they stay where they
 * are. That split is the honest one — the chain is asked about what it actually knows.
 */

const ISSUER_ABI = [
  'function tierCount() external view returns (uint256)',
  'function tierAt(uint256 tierId) external view returns (bytes32 kind, uint256 ratePerCycle, bool active)',
  'function capacityOf(address member, uint256 tierId) external view returns (uint256)',
  'function drawnOf(address member, uint256 tierId) external view returns (uint256)',
  'function principalOf(address member, uint256 tierId) external view returns (uint256)',
  'function carryOf(address member, uint256 tierId) external view returns (uint256)',
  'function creditPeriods(address member) external view returns (uint256 issuedAt, uint256 expiration, uint256 graceLength, bool paused)',
  'function cycleLength() external view returns (uint64)',
];

const REGISTRY_ABI = [
  'function collateralValueOf(address member, bytes32 kind) external view returns (uint256)',
  'function collateralTypes(bytes32 kind) external view returns (uint8 backing, uint256 haircutBps, uint256 unitPrice, address valuer, bool registered)',
];

const LIMITS_ABI = [
  'function capacityOf(address member, bytes32 kind) external view returns (uint256)',
];

const TERM_ABI = [
  'function plansOf(address member) external view returns (uint256[])',
  'function planAt(uint256 planId) external view returns (address member, uint256 principal, uint256 principalOutstanding, uint256 repaid, uint64 openedAt, uint32 installments, uint64 installmentLength, uint256 ratePerCycle, bool closed)',
  'function scheduleOf(uint256 planId) external view returns (uint256 installmentAmount, uint256 scheduleTotal, uint32 installments, uint64 scheduleStart)',
];

/** Credit units are the ledger's, which are the reserve token's: six decimals. */
const CREDIT_DECIMALS = 6;

export interface ChainTier {
  /** Tier kind as the contract names it, e.g. "SAVINGS". */
  kind: string;
  /** Ceiling contribution, in cents. */
  limitCents: number;
  /** Drawn against it, carry included, in cents. */
  usedCents: number;
  /** Carry rate in basis points per cycle, as the tier charges it. */
  rateBps: number;
  /** Principal drawn, before carry, in cents. */
  principalCents: number;
  /** Carry accrued on it so far this cycle, in cents. `used` already includes this. */
  carryCents: number;
  /** What the member has pledged under this kind, before haircut, in cents. */
  collateralValueCents: number;
  /** The haircut applied to that value, in basis points. */
  haircutBps: number;
  active: boolean;
}

export interface ChainCycle {
  /** Unix seconds the current period opened, or 0 when no line has been opened. */
  issuedAt: number;
  /** Unix seconds it expires. */
  expiration: number;
  /** Seconds of grace after expiry before the limit contracts. */
  graceLength: number;
  paused: boolean;
  /**
   * Seconds in the network's cycle, whether or not this member has a period running.
   *
   * Carried so a member who has never opened a line can still be told what cycle they would be
   * on. Without it the only honest answer is zero, and zero on a countdown reads as expired
   * rather than as not yet started -- the opposite of the truth for somebody who just joined.
   */
  networkCycleSeconds: number;
}

export interface ChainTermPlan {
  planId: number;
  principalCents: number;
  outstandingCents: number;
  repaidCents: number;
  installments: number;
  /** The figure the member is quoted each period, in cents. */
  installmentCents: number;
  /** What the schedule collects across its whole term, carry included. */
  scheduleTotalCents: number;
  closed: boolean;
}

export interface ChainCredit {
  /** Null when the read failed — which is not the same as a member with no credit line. */
  tiers: ChainTier[] | null;
  plans: ChainTermPlan[] | null;
  /** Null when the read failed; zeroed when the member has never opened a line. */
  cycle: ChainCycle | null;
  complete: boolean;
}

function toCents(amount: bigint): number {
  // Credit units are 6dp and cents are 2dp, so the last four digits are sub-cent.
  return Number(amount / 10n ** BigInt(CREDIT_DECIMALS - 2));
}

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

async function readTiers(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
  registryAddress: string | null,
): Promise<ChainTier[] | null> {
  try {
    const issuer = new ethers.Contract(address, ISSUER_ABI, provider);
    const registry = registryAddress
      ? new ethers.Contract(registryAddress, REGISTRY_ABI, provider)
      : null;
    const count = Number(await issuer.tierCount());
    const tiers: ChainTier[] = [];
    for (let id = 0; id < count; id++) {
      const [kind, ratePerCycle, active] = await issuer.tierAt(id);
      // Carry is read rather than derived from `used - principal`. The issuer computes it against
      // the tier's index, and subtracting two rounded figures produces a third with both errors in
      // it -- on a number the member is charged.
      const [limit, used, principal, carry] = await Promise.all([
        issuer.capacityOf(wallet, id),
        issuer.drawnOf(wallet, id),
        issuer.principalOf(wallet, id),
        issuer.carryOf(wallet, id),
      ]);

      // What backs the tier, before the haircut the calculator then applies. Shown so a member can
      // see the two figures that produce their limit rather than only the product of them.
      let collateralValue = 0n;
      let haircutBps = 0;
      if (registry) {
        try {
          const [, bps] = await registry.collateralTypes(kind);
          haircutBps = Number(bps);
          collateralValue = await registry.collateralValueOf(wallet, kind);
        } catch {
          // An unregistered kind backs nothing, which is the correct answer rather than an error.
        }
      }

      tiers.push({
        kind: ethers.decodeBytes32String(kind),
        limitCents: toCents(limit),
        usedCents: toCents(used),
        principalCents: toCents(principal),
        carryCents: toCents(carry),
        collateralValueCents: toCents(collateralValue),
        haircutBps,
        rateBps: Number(ratePerCycle),
        active,
      });
    }
    return tiers;
  } catch (error) {
    console.error('[credit] tier read failed', address, error);
    return null;
  }
}

async function readPlans(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
): Promise<ChainTermPlan[] | null> {
  try {
    const term = new ethers.Contract(address, TERM_ABI, provider);
    const ids: bigint[] = await term.plansOf(wallet);
    const plans: ChainTermPlan[] = [];
    for (const id of ids) {
      const [plan, schedule] = await Promise.all([term.planAt(id), term.scheduleOf(id)]);
      const [, principal, outstanding, repaid, , installments, , , closed] = plan;
      const [installmentAmount, scheduleTotal] = schedule;
      plans.push({
        planId: Number(id),
        principalCents: toCents(principal),
        outstandingCents: toCents(outstanding),
        repaidCents: toCents(repaid),
        installments: Number(installments),
        installmentCents: toCents(installmentAmount),
        scheduleTotalCents: toCents(scheduleTotal),
        closed,
      });
    }
    return plans;
  } catch (error) {
    console.error('[credit] plan read failed', address, error);
    return null;
  }
}

export interface ChainCapacities {
  /** Ceiling the chain grants against savings, in cents. Null when the read failed. */
  savingsCents: number | null;
  /** Ceiling against internal assets -- bonds and pool shares -- in cents. */
  assetCents: number | null;
  /** True when the calculator is deployed and both reads succeeded. */
  available: boolean;
}

/**
 * What the chain says a member may borrow against their collateral.
 *
 * This is the figure `tierLimits` computes off-chain from raw balances at fixed loan-to-values.
 * They agreed while nothing on-chain did the same arithmetic. They do not agree any more:
 * `LimitCalculator` applies the registry's governed haircut to the registry's own valuation, and
 * for bonds that valuation accretes every day toward face. A fixed 95% of a stale balance and 95%
 * of today's present value are different numbers, and the second is the one the contracts will
 * actually enforce on a default.
 *
 * Returns `available: false` rather than zeroes when the calculator is not deployed, so a caller
 * can keep using the off-chain computation instead of reading a zero as "no collateral".
 */
export async function readChainCapacities(
  wallet: string,
  chainId = resolveChainId(),
): Promise<ChainCapacities> {
  const calculator = getContractAddress(chainId, 'LimitCalculator');
  if (!calculator) return { savingsCents: null, assetCents: null, available: false };

  try {
    const provider = getProvider(chainId);
    const limits = new ethers.Contract(calculator, LIMITS_ABI, provider);
    const [savings, asset] = await Promise.all([
      limits.capacityOf(wallet, ethers.encodeBytes32String('SAVINGS')),
      limits.capacityOf(wallet, ethers.encodeBytes32String('ASSET_INTERNAL')),
    ]);
    return { savingsCents: toCents(savings), assetCents: toCents(asset), available: true };
  } catch (error) {
    console.error('[credit] capacity read failed', calculator, error);
    return { savingsCents: null, assetCents: null, available: false };
  }
}

/**
 * The member's credit period: when it opened, when it expires, and how long after that the limit
 * survives before contracting.
 *
 * Zeroes are the honest answer for a member who has never had a line opened -- the mapping returns
 * an empty struct, and that is a real state rather than a failed read.
 */
async function readCycle(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
): Promise<ChainCycle | null> {
  try {
    const issuer = new ethers.Contract(address, ISSUER_ABI, provider);
    const [period, networkCycle] = await Promise.all([
      issuer.creditPeriods(wallet),
      issuer.cycleLength(),
    ]);
    const [issuedAt, expiration, graceLength, paused] = period;
    return {
      issuedAt: Number(issuedAt),
      expiration: Number(expiration),
      graceLength: Number(graceLength),
      paused,
      networkCycleSeconds: Number(networkCycle),
    };
  } catch (error) {
    console.error('[credit] cycle read failed', address, error);
    return null;
  }
}

/** A member's credit line, as the contracts hold it. */
export async function readChainCredit(
  wallet: string,
  chainId = resolveChainId(),
): Promise<ChainCredit> {
  const issuer = getContractAddress(chainId, 'RevolvingIssuer');
  const term = getContractAddress(chainId, 'TermIssuer');
  const registry = getContractAddress(chainId, 'CollateralRegistry');

  let provider: ethers.JsonRpcProvider;
  try {
    provider = getProvider(chainId);
  } catch (error) {
    console.error('[credit] no RPC for chain', chainId, error);
    return { tiers: null, plans: null, cycle: null, complete: false };
  }

  // An unset issuer is no credit line, not a failed read: a member cannot have drawn against a
  // contract that does not exist.
  const [tiers, plans, cycle] = await Promise.all([
    issuer ? readTiers(provider, issuer, wallet, registry) : Promise.resolve([]),
    term ? readPlans(provider, term, wallet) : Promise.resolve([]),
    issuer ? readCycle(provider, issuer, wallet) : Promise.resolve(null),
  ]);

  return {
    tiers,
    plans,
    cycle,
    complete: tiers !== null && plans !== null,
  };
}
