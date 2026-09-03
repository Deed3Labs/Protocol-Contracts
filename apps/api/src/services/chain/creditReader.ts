import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { savingsIntentService } from '../savingsIntentService.js';
import { chainProvider } from './provider.js';
import { coalesce } from './readCache.js';

// 0.25%. Below this the difference is accrual between two reads, not a capacity that failed to push.
const DRIFT_BPS = 25n;

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
  // What may actually leave. Not the pledge minus anything the caller works out — the registry
  // computes it from what is *drawn*, and the token enforces the same figure on transfer.
  // What must stay put. The registry computes it from what is *drawn*, and CLRUSD consults the
  // same function in `_update` to decide whether a transfer may proceed.
  'function encumberedOf(address holder) external view returns (uint256)',
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
  /** What the issuer has written down. Differs from `limitCents` only when a push has not landed. */
  writtenLimitCents: number;
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
  /** Unix seconds. The shelf shows the month a plan was opened beside its name. */
  openedAt: number;
  /** Carry in basis points per cycle — the rate the plan was written at, not today's. */
  rateBps: number;
  closed: boolean;
}

export interface ChainCredit {
  /** Null when the read failed — which is not the same as a member with no credit line. */
  tiers: ChainTier[] | null;
  plans: ChainTermPlan[] | null;
  /**
   * Savings that must stay put because credit is drawn against them, in cents. Null when unread.
   *
   * The figure CLRUSD enforces on transfer, so what is withdrawable is `balance − this`. Not
   * `balance − pledged`: encumbrance follows what is drawn, so a fully pledged line nobody has
   * touched encumbers nothing.
   */
  savingsEncumberedCents: number | null;
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

const getProvider = chainProvider;

async function readTiers(
  provider: ethers.JsonRpcProvider,
  address: string,
  wallet: string,
  registryAddress: string | null,
  calculatorAddress: string | null,
): Promise<ChainTier[] | null> {
  try {
    const issuer = new ethers.Contract(address, ISSUER_ABI, provider);
    const registry = registryAddress
      ? new ethers.Contract(registryAddress, REGISTRY_ABI, provider)
      : null;
    /*
     * The calculator computes what the collateral supports right now; the issuer holds what was
     * last *written* to it. They are supposed to agree, and they can silently stop.
     *
     * A member had a savings limit of $350 against $325 of savings: the pledge tracked their
     * withdrawal correctly, and the `pushCapacities` that should have followed it did not land. The
     * issuer is what gates a draw, so the line was under-collateralised — not mislabelled — and
     * nothing anywhere noticed. It surfaced because someone read the screen and thought the number
     * looked wrong.
     */
    const calculator = calculatorAddress
      ? new ethers.Contract(calculatorAddress, LIMITS_ABI, provider)
      : null;
    const count = Number(await issuer.tierCount());
    const tiers: ChainTier[] = [];
    for (let id = 0; id < count; id++) {
      const [kind, ratePerCycle, active] = await issuer.tierAt(id);
      // Carry is read rather than derived from `used - principal`. The issuer computes it against
      // the tier's index, and subtracting two rounded figures produces a third with both errors in
      // it -- on a number the member is charged.
      const [written, used, principal, carry] = await Promise.all([
        issuer.capacityOf(wallet, id),
        issuer.drawnOf(wallet, id),
        issuer.principalOf(wallet, id),
        issuer.carryOf(wallet, id),
      ]);

      /*
       * The lower of the two, on purpose.
       *
       * Taking the smaller means a stale issuer can only ever under-state a limit, never offer
       * credit nothing backs. The other direction is the one that costs something real: a member
       * drawing against collateral that is no longer there.
       *
       * It does mean a member can briefly see less than they are entitled to — between collateral
       * arriving and the push landing. That is the right way round: a limit that grows a few
       * seconds late is a wait, and a limit that shrinks late is an unsecured loan.
       */
      let live: bigint | null = null;
      if (calculator) {
        try {
          live = await calculator.capacityOf(wallet, kind);
        } catch {
          // A kind the calculator does not know is not a drift; the issuer's figure stands.
        }
      }
      const limit = live !== null && live < written ? live : written;
      /*
       * Only drift big enough to mean something.
       *
       * An exact-inequality warning fired on every single read: a bond accrues continuously, so the
       * written capacity is always a few units behind the live one and never equal to it. That is
       * the system working, and logging it turned the one line that would show a *real* divergence
       * -- a pledge that landed with no capacity push behind it -- into six identical lines a minute
       * that nobody would read.
       *
       * A relative floor rather than an absolute one, because these are unit counts across tiers of
       * very different sizes: 100 units is rounding on a bond and the whole balance on a new member.
       */
      if (live !== null && live !== written) {
        const gap = live > written ? live - written : written - live;
        const larger = live > written ? live : written;
        const material = larger > 0n && (gap * 10_000n) / larger >= DRIFT_BPS;
        if (material) {
          console.warn(
            `[credit] capacity drift for ${wallet} ${ethers.decodeBytes32String(kind)}:`,
            `issuer=${written.toString()} calculator=${live.toString()} — showing the lower.`,
          );
        }
      }

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
        // What the issuer holds, so a caller can tell a stale limit from a small one.
        writtenLimitCents: toCents(written),
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
      const [, principal, outstanding, repaid, openedAt, installments, , ratePerCycle, closed] = plan;
      const [installmentAmount, scheduleTotal] = schedule;
      plans.push({
        planId: Number(id),
        principalCents: toCents(principal),
        outstandingCents: toCents(outstanding),
        repaidCents: toCents(repaid),
        installments: Number(installments),
        installmentCents: toCents(installmentAmount),
        scheduleTotalCents: toCents(scheduleTotal),
        openedAt: Number(openedAt),
        rateBps: Number(ratePerCycle),
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
    /*
     * The asset tiers are BOND and POOL_SHARE, and there are two of them.
     *
     * This read asked for ASSET_INTERNAL, which is a registered collateral type and *not* an
     * issuer tier — so nothing is ever pledged under it and the answer was always zero. The card's
     * asset limit would have stayed at zero however many bonds a member held, and silently: zero
     * is a number, so the caller's fallback to computing from holdings never fires either.
     *
     * Same keying mistake as the one already fixed on the issuer side; the reader kept the old key.
     */
    const [savings, bond, poolShare] = await Promise.all([
      limits.capacityOf(wallet, ethers.encodeBytes32String('SAVINGS')),
      limits.capacityOf(wallet, ethers.encodeBytes32String('BOND')),
      limits.capacityOf(wallet, ethers.encodeBytes32String('POOL_SHARE')),
    ]);
    return {
      savingsCents: toCents(savings),
      assetCents: toCents(bond) + toCents(poolShare),
      available: true,
    };
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
/**
 * Savings that cannot move because credit is drawn against them.
 *
 * Null on a failed read, never zero — reporting nothing encumbered when we could not ask would
 * offer a member an amount the token then refuses. Zero is only returned when the registry
 * actually answered zero.
 */
async function readEncumbered(
  provider: ethers.JsonRpcProvider,
  registryAddress: string,
  wallet: string,
): Promise<number | null> {
  try {
    const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
    return toCents(await registry.encumberedOf(wallet));
  } catch (error) {
    console.error('[credit] encumbrance read failed', wallet, error);
    return null;
  }
}

/*
 * Coalesced, because one move sets off up to twenty identical calls to this from five listeners on
 * a retry backoff, and each one of these fans out to roughly thirty contract calls. The cache is
 * dropped the moment the server writes collateral, so the read triggered *by* a pledge landing
 * never sees a figure from before it.
 */
export function readChainCredit(wallet: string, chainId = resolveChainId()): Promise<ChainCredit> {
  return coalesce(`credit:${wallet.toLowerCase()}:${chainId}`, () => readChainCreditUncached(wallet, chainId));
}

async function readChainCreditUncached(
  wallet: string,
  chainId = resolveChainId(),
): Promise<ChainCredit> {
  const issuer = getContractAddress(chainId, 'RevolvingIssuer');
  const term = getContractAddress(chainId, 'TermIssuer');
  const registry = getContractAddress(chainId, 'CollateralRegistry');
  const limitCalculator = getContractAddress(chainId, 'LimitCalculator');

  let provider: ethers.JsonRpcProvider;
  try {
    provider = getProvider(chainId);
  } catch (error) {
    console.error('[credit] no RPC for chain', chainId, error);
    return { tiers: null, plans: null, cycle: null, savingsEncumberedCents: null, complete: false };
  }

  // An unset issuer is no credit line, not a failed read: a member cannot have drawn against a
  // contract that does not exist.
  const [tiers, plans, cycle, savingsEncumberedCents] = await Promise.all([
    issuer ? readTiers(provider, issuer, wallet, registry, limitCalculator) : Promise.resolve([]),
    term ? readPlans(provider, term, wallet) : Promise.resolve([]),
    issuer ? readCycle(provider, issuer, wallet) : Promise.resolve(null),
    registry ? readEncumbered(provider, registry, wallet) : Promise.resolve(0),
  ]);

  return {
    tiers,
    plans,
    cycle,
    savingsEncumberedCents,
    complete: tiers !== null && plans !== null,
  };
}
