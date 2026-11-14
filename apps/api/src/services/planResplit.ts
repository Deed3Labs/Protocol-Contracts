import { ethers } from 'ethers';
import {
  isOfferedPlanSplit,
  PLAN_SIGNATURE_TTL_SECONDS,
  resplitCostRises,
  resplitTypedData,
  type ResplitTypedData,
} from '@clear/domain';
import { getContractAddress } from '../config/contracts.js';
import { chainId } from './chargeService.js';
import { chainProvider } from './chain/provider.js';
import { decodeChainError, describeCreditRefusal } from './chain/chainErrors.js';
import { quoteTermPlan } from './chain/planPricing.js';

/*
 * Re-splitting a plan when it costs more (compliance spec item 6).
 *
 * `setSplit` from the member's own wallet still works for a re-split that does not cost more. One
 * that does (a higher rate, or a charged plan spread over more installments than it has left)
 * reverts with `TermIssuerResplitNeedsSignature`, because it creates new finance-charge terms. The
 * member then signs EIP-712 `Resplit(planId, installments, rateBps, nonce, deadline)` at
 * `planNonces(member)` in the plan domain, and the operator submits `resplitWithSignature`.
 *
 * Built alongside the plan approval: `prepareResplit` decides whether a signature is needed and,
 * if so, returns the typed data with the rate the chain will charge; the phone shows the new terms
 * rebuilt from the signed fields and signs; `submitResplit` re-prices, checks and submits.
 *
 * The member's own bounds. When the member calls `setSplit` the contract holds them to: not while
 * behind, at most three re-splits, at most one an installment period. `resplitWithSignature` is
 * called by the operator, so the contract treats it like an operator's hardship re-split and does
 * not apply them. They are checked here, from `arrearsOf` and `splitAllowance`, before submitting.
 * The contract does not count a signed re-split toward the three (see the PR's "Left open").
 */

const PLAN_ABI = [
  'function planAt(uint256 planId) view returns (address member, uint256 principal, uint256 principalOutstanding, uint256 repaid, uint64 openedAt, uint32 installments, uint64 installmentLength, uint256 ratePerCycle, bool closed)',
  'function pricingOf(uint256 planId) view returns ((bytes32 state, bytes32 product, address merchant, uint32 subsidyBps, bool free, bool priced, uint64 accruedAt))',
  'function carryOutstandingOf(uint256 planId) view returns (uint256)',
  'function installmentsDue(uint256 planId) view returns (uint256)',
  'function arrearsOf(uint256 planId) view returns (uint256)',
  'function owedOn(uint256 planId) view returns (uint256)',
  'function splitAllowance(uint256 planId) view returns (uint8 remaining, uint256 availableAt)',
  'function planNonces(address member) view returns (uint256)',
  'function setSplit(uint256 planId, uint32 installments)',
  'function resplitWithSignature(uint256 planId, uint32 installments, uint256 rateBps, uint256 deadline, bytes signature)',
];

export type PrepareResplitResult =
  | { ok: true; needsSignature: false }
  | {
      ok: true;
      needsSignature: true;
      typedData: ResplitTypedData;
      /** What the new schedule spreads, in ledger units: everything owed now. */
      remaining: string;
      installmentLength: string;
    }
  | { ok: false; reason: string };

export type SubmitResplitResult = { ok: true; txHash: string } | { ok: false; reason: string };

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

const SIGNATURE_HEX = /^0x(?:[0-9a-fA-F]{2})+$/;

interface PlanState {
  issuer: ethers.Contract;
  termIssuer: string;
  member: string;
  installmentLength: bigint;
  /** What the new rate would be, from `_quote`; null for an unpriced (legacy) plan. */
  rateBps: bigint | null;
  costRises: boolean;
}

/** Everything `_resplit` reads, read the same way. A reason when the re-split cannot go ahead. */
async function readPlan(wallet: string, planId: number, installments: number): Promise<PlanState | { reason: string }> {
  const termIssuer = getContractAddress(chainId(), 'TermIssuer');
  if (!termIssuer) return { reason: 'Changing a split is not available on this network yet.' };
  const provider = chainProvider(chainId());
  const issuer = new ethers.Contract(termIssuer, PLAN_ABI, provider);
  const plan = await issuer.planAt(planId);
  if (String(plan.member).toLowerCase() !== wallet.trim().toLowerCase()) return { reason: 'That plan isn’t yours to change.' };
  if (plan.closed) return { reason: 'This plan is already paid.' };

  const pricing = await issuer.pricingOf(planId).catch(() => null);
  if (!pricing || !pricing.priced) {
    // An unpriced plan keeps its rate; `setSplit` never asks for a signature on it.
    if (!isOfferedPlanSplit(installments)) return { reason: 'That way of splitting is not offered on this plan.' };
    return { issuer, termIssuer, member: plan.member, installmentLength: plan.installmentLength, rateBps: null, costRises: false };
  }
  const [carry, due]: [bigint, bigint] = await Promise.all([issuer.carryOutstandingOf(planId), issuer.installmentsDue(planId)]);
  // `_resplit` prices the principal alone, after bringing carry current (which moves principal
  // and carry together, so the difference is the same now).
  const principal = BigInt(plan.principalOutstanding) - carry;
  const priced = await quoteTermPlan({
    provider,
    termIssuer,
    member: plan.member,
    merchant: pricing.merchant,
    productId: pricing.product,
    principal,
    installments,
    installmentLength: BigInt(plan.installmentLength),
  });
  if (!priced.ok) return { reason: priced.reason };
  if (!isOfferedPlanSplit(installments, priced.quote.largeLoan)) return { reason: 'That way of splitting is not offered on this plan.' };
  const left = Number(plan.installments) > Number(due) ? Number(plan.installments) - Number(due) : 0;
  return {
    issuer,
    termIssuer,
    member: plan.member,
    installmentLength: BigInt(plan.installmentLength),
    rateBps: priced.quote.rateBps,
    costRises: resplitCostRises({
      oldRateBps: BigInt(plan.ratePerCycle),
      newRateBps: priced.quote.rateBps,
      installments,
      remainingInstallments: left,
    }),
  };
}

/** The bounds `_resplit` puts on a member's own re-split, which the operator path skips. */
async function memberBounds(issuer: ethers.Contract, planId: number): Promise<string | null> {
  const [arrears, allowance]: [bigint, [bigint, bigint]] = await Promise.all([issuer.arrearsOf(planId), issuer.splitAllowance(planId)]);
  if (arrears > 0n) return 'This plan is behind. Catch up first, then you can change the split.';
  if (Number(allowance[0]) === 0) return 'This plan has been re-split as many times as it can be.';
  const at = Number(allowance[1]);
  if (at > Math.floor(Date.now() / 1000)) {
    return `This plan was re-split recently. You can change it again after ${new Date(at * 1000).toISOString().slice(0, 10)}.`;
  }
  return null;
}

/**
 * Step one: does this re-split need the member's signature, and if so, on what terms?
 *
 * No signature needed means the member's wallet calls `setSplit` as before. Writes nothing.
 */
export async function prepareResplit(wallet: string, planId: number, installments: number): Promise<PrepareResplitResult> {
  try {
    const state = await readPlan(wallet, planId, installments);
    if ('reason' in state) return { ok: false, reason: state.reason };
    if (!state.costRises || state.rateBps === null) return { ok: true, needsSignature: false };
    const bound = await memberBounds(state.issuer, planId);
    if (bound) return { ok: false, reason: bound };
    const [nonce, owed]: [bigint, bigint] = await Promise.all([state.issuer.planNonces(state.member), state.issuer.owedOn(planId)]);
    return {
      ok: true,
      needsSignature: true,
      typedData: resplitTypedData({
        chainId: chainId(),
        termIssuer: ethers.getAddress(state.termIssuer),
        planId,
        installments,
        rateBps: state.rateBps,
        nonce,
        deadline: Math.floor(Date.now() / 1000) + PLAN_SIGNATURE_TTL_SECONDS,
      }),
      remaining: owed.toString(),
      installmentLength: state.installmentLength.toString(),
    };
  } catch (error) {
    console.error('[plan] re-split prepare failed for', planId, error instanceof Error ? error.message : error);
    return { ok: false, reason: describeCreditRefusal(decodeChainError(error)) ?? 'We could not get this change ready. Nothing has changed. Try again in a moment.' };
  }
}

/**
 * Step two: submit the member's signed re-split. The rate is priced again and must be the one they
 * signed; the member's own bounds are checked; then the operator calls `resplitWithSignature`.
 */
export async function submitResplit(
  wallet: string,
  planId: number,
  input: { installments: number; rateBps: string; deadline: number; signature: string },
): Promise<SubmitResplitResult> {
  if (!SIGNATURE_HEX.test(String(input.signature ?? '').trim())) return { ok: false, reason: 'Sign the new terms to change this split.' };
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(input.deadline) || input.deadline <= now || input.deadline > now + PLAN_SIGNATURE_TTL_SECONDS + 60) {
    return { ok: false, reason: 'The terms you signed timed out. Nothing has changed. Try again to sign them afresh.' };
  }
  const key = operatorKey();
  if (!key) return { ok: false, reason: 'We could not change this split just now. Nothing has changed.' };
  try {
    const state = await readPlan(wallet, planId, input.installments);
    if ('reason' in state) return { ok: false, reason: state.reason };
    if (state.rateBps === null || !state.costRises) {
      return { ok: false, reason: 'This change does not need a signature. Change the split from your plan instead.' };
    }
    if (String(state.rateBps) !== String(input.rateBps)) {
      return { ok: false, reason: 'The rate for this split changed after you signed. Nothing has changed. Try again to see and sign the current terms.' };
    }
    const bound = await memberBounds(state.issuer, planId);
    if (bound) return { ok: false, reason: bound };

    const signer = new ethers.Wallet(key, chainProvider(chainId()));
    const issuer = state.issuer.connect(signer) as ethers.Contract;
    const tx = await issuer.resplitWithSignature(planId, input.installments, BigInt(input.rateBps), BigInt(input.deadline), input.signature.trim());
    const receipt = await tx.wait();
    return { ok: true, txHash: receipt?.hash ?? tx.hash };
  } catch (error) {
    console.error('[plan] re-split submit failed for', planId, error instanceof Error ? error.message : error);
    return {
      ok: false,
      reason: describeCreditRefusal(decodeChainError(error)) ?? 'That did not go through. The split is unchanged.',
    };
  }
}
