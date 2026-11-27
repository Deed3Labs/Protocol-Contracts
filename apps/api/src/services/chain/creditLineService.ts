import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { chainErrorReason, decodeChainError, describeOnboardingRefusal, type DecodedChainError } from './chainErrors.js';
import { decodeStateCode } from './stateCode.js';
import { keeperChainId, liveRunner, type CallRunner } from './keeperKit.js';
import { asOperator } from './operatorQueue.js';

/*
 * Opening a member's credit line.
 *
 * A member exists, therefore a cycle is running. That is the product's claim, and until now
 * nothing made it true: `openLine` was called only from tests, so no member had a period, no
 * member had a cycle, and the app fell back to showing one it had invented.
 *
 * Two things this deliberately does not do.
 *
 * It does not grant capacity. Every tier opens at zero: savings and asset are filled by
 * `LimitCalculator` from what the member has actually pledged, and income and Boost come from an
 * attestation nobody has made yet. A line with a real cycle and no borrowing power is the correct
 * starting state -- granting something at signup would be lending against nothing.
 *
 * It does not fail onboarding. A member whose line could not be opened is still a member; they
 * simply have no cycle until the credit onboarding job (jobs/creditOnboarding.ts) catches them.
 * Refusing to finish someone's signup over a chain write is the wrong trade, so callers are expected
 * to swallow the error and move on.
 *
 * The call is simulated from the credit operator first and sent only if the simulation succeeds,
 * through the operator's queue (`asOperator`): term limits and offers sign with the same key, and
 * two sends at once would race for one nonce.
 */

const ISSUER_ABI = [
  // Phase 2e (12.1): cycles are computed on the calendar. A line opens on its Cycle End Day (1 to
  // 28; 0 lets the contract pick the default day), not on a period and grace the caller chooses.
  'function openLine(address member, uint256[] capacities, uint8 cycleEndDay) external',
  'function tierCount() external view returns (uint256)',
  'function cycleLength() external view returns (uint64)',
  'function creditPeriods(address member) external view returns (uint256 issuedAt, uint256 expiration, uint256 graceLength, bool paused)',
];
const ISSUER = new ethers.Interface(ISSUER_ABI);

const chainId = () => keeperChainId();

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

export interface OpenLineResult {
  opened: boolean;
  /**
   * Why not: 'already has a line', 'state_not_confirmed' (no attested state), 'state_not_enabled'
   * (the revolving product is off in the attested state), 'dry_run' (the simulation succeeds;
   * nothing was sent), or a failure's text.
   */
  reason?: string;
  txHash?: string;
  /** Dry run only: the simulation succeeds, so a live run would open it. */
  wouldOpen?: boolean;
  /** A refusal or failure, in a sentence an operator can read. Never the member's state. */
  detail?: string;
}

/** What opening a line reads and sends through; the live wiring is `openLineDeps`. */
export interface OpenLineDeps {
  issuer: string;
  reader: {
    creditPeriods(member: string): Promise<readonly unknown[]>;
    tierCount(): Promise<bigint>;
  };
  /** Simulates and sends as the credit operator. */
  runner: CallRunner;
}

/** Whether this member already has a credit period. */
export async function hasCreditLine(wallet: string): Promise<boolean> {
  const issuer = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!issuer) return false;
  try {
    const provider = chainProvider(chainId());
    const contract = new ethers.Contract(issuer, ISSUER_ABI, provider);
    const [issuedAt] = await contract.creditPeriods(wallet);
    return Number(issuedAt) > 0;
  } catch {
    // Unknown is not "no". Reporting false on a failed read would have the caller open a second
    // line over the top of one that already exists.
    return true;
  }
}

/** The state gate's refusal as one of the two reasons callers act on, or null for anything else. */
function stateGateReason(decoded: DecodedChainError | null): 'state_not_confirmed' | 'state_not_enabled' | null {
  if (decoded?.name !== 'RevolvingIssuerStateNotEnabled') return null;
  return decodeStateCode(decoded.args.stateCode) === null ? 'state_not_confirmed' : 'state_not_enabled';
}

/** The live wiring: the RevolvingIssuer and the credit operator. A reason when either is missing. */
export function openLineDeps(): OpenLineDeps | { reason: string } {
  const issuer = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!issuer) return { reason: 'no issuer deployed on this chain' };
  const key = operatorKey();
  if (!key) return { reason: 'no CREDIT_OPERATOR_PRIVATE_KEY' };
  const reads = new ethers.Contract(issuer, ISSUER_ABI, chainProvider(chainId()));
  return {
    issuer,
    reader: {
      creditPeriods: (m) => reads.creditPeriods(m),
      tierCount: () => reads.tierCount(),
    },
    runner: liveRunner(chainId(), key, { describe: describeOnboardingRefusal, lock: asOperator }),
  };
}

/**
 * Opens a line for a member who does not have one, through `deps`.
 *
 * Idempotent by check rather than by contract: `openLine` reverts for a member already in an
 * active period, so re-running would otherwise fail loudly on everyone already done.
 *
 * The Cycle End Day is passed as zero, which the issuer reads as its default day (Phase 2e, 12.1).
 * The member can move it later with their own signature (`setCycleEndDayWithSignature`); no role
 * can.
 */
export async function openLineWith(deps: OpenLineDeps, wallet: string, options: { dryRun?: boolean } = {}): Promise<OpenLineResult> {
  try {
    const [issuedAt] = await deps.reader.creditPeriods(wallet);
    if (Number(issuedAt) > 0) return { opened: false, reason: 'already has a line' };

    // One zero per tier. Capacity is not granted here -- see the note at the top.
    const tiers = Number(await deps.reader.tierCount());
    if (tiers === 0) return { opened: false, reason: 'issuer has no tiers configured' };
    const call = { to: deps.issuer, data: ISSUER.encodeFunctionData('openLine', [wallet, new Array(tiers).fill(0n), 0]) };

    const sim = await deps.runner.simulate(call);
    if (sim.kind === 'refused') {
      // Phase 2's state gate: no line until the member's state is attested (STATE_ATTESTER_ROLE)
      // and the revolving product is enabled there. Not a failure to retry blindly.
      return { opened: false, reason: stateGateReason(sim.error) ?? sim.sentence, detail: sim.sentence };
    }
    if (sim.kind === 'failed') return { opened: false, reason: `simulation ${sim.reason}`, detail: sim.reason };
    if (options.dryRun) return { opened: false, reason: 'dry_run', wouldOpen: true };

    const sent = await deps.runner.send(call);
    if (sent.status === 0) return { opened: false, reason: 'openLine reverted on chain', txHash: sent.hash };
    return { opened: true, txHash: sent.hash };
  } catch (error) {
    // The state gate can still answer at send time (a race with another writer); anything else,
    // including an RPC that cannot be reached, is a failure the caller reports.
    const gate = stateGateReason(decodeChainError(error));
    if (gate) return { opened: false, reason: gate };
    const message = chainErrorReason(error).slice(0, 300);
    console.error('[credit] openLine failed for', wallet, message);
    return { opened: false, reason: message, detail: message };
  }
}

/** Opens a line for a member who does not have one: simulated, then sent as the credit operator. */
export async function openCreditLine(wallet: string, options: { dryRun?: boolean } = {}): Promise<OpenLineResult> {
  const deps = openLineDeps();
  if ('reason' in deps) return { opened: false, reason: deps.reason };
  return openLineWith(deps, wallet, options);
}
