import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { savingsIntentService } from '../savingsIntentService.js';
import { chainProvider } from './provider.js';

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
 * simply have no cycle until the backfill catches them. Refusing to finish someone's signup over
 * a chain write is the wrong trade, so callers are expected to swallow the error and move on.
 */

const ISSUER_ABI = [
  'function openLine(address member, uint256[] capacities, uint256 periodLength, uint256 graceLength) external',
  'function tierCount() external view returns (uint256)',
  'function cycleLength() external view returns (uint64)',
  'function creditPeriods(address member) external view returns (uint256 issuedAt, uint256 expiration, uint256 graceLength, bool paused)',
];

function chainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

export interface OpenLineResult {
  opened: boolean;
  reason?: string;
  txHash?: string;
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

/**
 * Opens a line for a member who does not have one.
 *
 * Idempotent by check rather than by contract: `openLine` reverts for a member already in an
 * active period, so re-running the backfill would otherwise fail loudly on everyone it had
 * already done.
 *
 * The period is passed as zero, which the issuer reads as the network's own cycle. That is the
 * point of the default -- a caller naming its own number is how members ended up on different
 * clocks.
 */
export async function openCreditLine(wallet: string): Promise<OpenLineResult> {
  const issuerAddress = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!issuerAddress) return { opened: false, reason: 'no issuer deployed on this chain' };

  const key = operatorKey();
  if (!key) return { opened: false, reason: 'no CREDIT_OPERATOR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY' };

  try {
    const provider = chainProvider(chainId());
    const signer = new ethers.Wallet(key, provider);
    const issuer = new ethers.Contract(issuerAddress, ISSUER_ABI, signer);

    const [issuedAt] = await issuer.creditPeriods(wallet);
    if (Number(issuedAt) > 0) return { opened: false, reason: 'already has a line' };

    // One zero per tier. Capacity is not granted here -- see the note at the top.
    const tiers = Number(await issuer.tierCount());
    if (tiers === 0) return { opened: false, reason: 'issuer has no tiers configured' };
    const capacities = new Array(tiers).fill(0n);

    // Grace matches the cycle: a member gets one cycle to clear and one more before the limit
    // contracts, which is the shape the plan describes.
    const cycle = await issuer.cycleLength();

    const tx = await issuer.openLine(wallet, capacities, 0, cycle);
    const receipt = await tx.wait();
    return { opened: true, txHash: receipt?.hash ?? tx.hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[credit] openLine failed for', wallet, message);
    return { opened: false, reason: message };
  }
}
