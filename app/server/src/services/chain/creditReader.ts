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
  active: boolean;
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
): Promise<ChainTier[] | null> {
  try {
    const issuer = new ethers.Contract(address, ISSUER_ABI, provider);
    const count = Number(await issuer.tierCount());
    const tiers: ChainTier[] = [];
    for (let id = 0; id < count; id++) {
      const [kind, ratePerCycle, active] = await issuer.tierAt(id);
      const [limit, used] = await Promise.all([
        issuer.capacityOf(wallet, id),
        issuer.drawnOf(wallet, id),
      ]);
      tiers.push({
        kind: ethers.decodeBytes32String(kind),
        limitCents: toCents(limit),
        usedCents: toCents(used),
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

/** A member's credit line, as the contracts hold it. */
export async function readChainCredit(
  wallet: string,
  chainId = resolveChainId(),
): Promise<ChainCredit> {
  const issuer = getContractAddress(chainId, 'RevolvingIssuer');
  const term = getContractAddress(chainId, 'TermIssuer');

  let provider: ethers.JsonRpcProvider;
  try {
    provider = getProvider(chainId);
  } catch (error) {
    console.error('[credit] no RPC for chain', chainId, error);
    return { tiers: null, plans: null, complete: false };
  }

  // An unset issuer is no credit line, not a failed read: a member cannot have drawn against a
  // contract that does not exist.
  const [tiers, plans] = await Promise.all([
    issuer ? readTiers(provider, issuer, wallet) : Promise.resolve([]),
    term ? readPlans(provider, term, wallet) : Promise.resolve([]),
  ]);

  return { tiers, plans, complete: tiers !== null && plans !== null };
}
