import { ethers } from 'ethers';
import { quotePlan, type PlanQuote, type PlanQuoteRefusal, type RateProductParams } from '@clear/domain';
import { stateRefusalSentence } from './chainErrors.js';

/*
 * A term plan's rate and payout, read from chain (compliance spec items 5-9).
 *
 * `openPlan` and `resplitWithSignature` revert with `TermIssuerTermsMismatch` unless the rate and
 * payout the member signed are exactly what `TermIssuerBase._quote` computes. So the server never
 * prices a plan from a table of its own: it reads what `_quote` reads, the same way, and the
 * arithmetic is `quotePlan` in @clear/domain.
 *
 *   - the member's state:   TermIssuer.stableCredit().networkRegistry().stateCodeOf(member)
 *   - the product:          RateSchedule.isEnabled / paramsOf (state, product)
 *   - min(list, cap):       RateSchedule.effectiveMonthlyBps(state, product, principal)
 *   - the merchant's terms: TermIssuer.stableCredit().merchantRegistry().splitTermsOf(merchant, installments)
 *
 * The registries are found through the issuer's own StableCredit rather than the address book, so
 * the figures are the ones the issuer will read.
 *
 * Legacy mode: an issuer with no RateSchedule (`rateSchedule() == 0`, or an implementation from
 * before Phase 2) keeps the rate the member signed, so the old flat rate and the registry discount
 * still apply there. Phase 2's deploy sets the schedule; legacy exists only mid-upgrade.
 */

const ISSUER_ABI = [
  'function rateSchedule() view returns (address)',
  'function stableCredit() view returns (address)',
];
const LEDGER_ABI = [
  'function networkRegistry() view returns (address)',
  'function merchantRegistry() view returns (address)',
];
const NETWORK_ABI = ['function stateCodeOf(address member) view returns (bytes32)'];
const MERCHANT_ABI = [
  'function splitTermsOf(address merchant, uint32 installments) view returns (uint256 discountBps, uint256 subsidyBps, uint32 freeSplitMax)',
  'function discountBpsOf(address merchant) view returns (uint256)',
];
export const RATE_SCHEDULE_ABI = [
  'function isEnabled(bytes32 stateCode, bytes32 productId) view returns (bool)',
  'function paramsOf(bytes32 stateCode, bytes32 productId) view returns ((bool enabled, uint32 listMonthlyBps, uint32 flatMonthlyBps, uint128 largeLoanThreshold, uint32 annualCapBps, uint64 minTermSeconds, bool freeInFull, uint128 freeBelowAmount, uint32 freeSplitMax))',
  'function effectiveMonthlyBps(bytes32 stateCode, bytes32 productId, uint256 principal) view returns (uint256)',
];

/** The flat rate an issuer without a RateSchedule is offered at (Phase 1's figure). */
export const LEGACY_RATE_BPS = 200n;

export type PlanPricingResult =
  | { ok: true; quote: PlanQuote; stateCode: string | null; priced: boolean }
  | { ok: false; refusal: PlanQuoteRefusal | { kind: 'unavailable' }; reason: string };

const ZERO_BYTES32 = ethers.ZeroHash;

/** Where the issuer's own pricing inputs live. Read once per quote; cheap, and never stale. */
async function pricingSources(provider: ethers.Provider, termIssuer: string) {
  const issuer = new ethers.Contract(termIssuer, ISSUER_ABI, provider);
  const schedule: string = await issuer.rateSchedule().catch(() => ethers.ZeroAddress);
  const ledger = new ethers.Contract(await issuer.stableCredit(), LEDGER_ABI, provider);
  const [network, merchants]: [string, string] = await Promise.all([ledger.networkRegistry(), ledger.merchantRegistry()]);
  return { schedule, network, merchants };
}

/** `NetworkRegistry.stateCodeOf(member)` through the issuer's ledger; null when unreadable. */
export async function memberStateCode(provider: ethers.Provider, termIssuer: string, member: string): Promise<string | null> {
  try {
    const { network } = await pricingSources(provider, termIssuer);
    if (network === ethers.ZeroAddress) return null;
    return await new ethers.Contract(network, NETWORK_ABI, provider).stateCodeOf(member);
  } catch {
    return null;
  }
}

/**
 * What `_quote(member, merchant, product, principal, installments, installmentLength)` returns, or
 * the refusal it would revert with, as a sentence a member can read.
 */
export async function quoteTermPlan(input: {
  provider: ethers.Provider;
  termIssuer: string;
  member: string;
  merchant: string;
  productId: string;
  principal: bigint;
  installments: number;
  installmentLength: bigint;
}): Promise<PlanPricingResult> {
  try {
    const { schedule, network, merchants } = await pricingSources(input.provider, input.termIssuer);
    const registry = new ethers.Contract(merchants, MERCHANT_ABI, input.provider);

    if (schedule === ethers.ZeroAddress) {
      const discountBps: bigint = await registry.discountBpsOf(input.merchant);
      const payout = input.principal - (input.principal * discountBps) / 10_000n;
      return {
        ok: true,
        priced: false,
        stateCode: null,
        quote: { rateBps: LEGACY_RATE_BPS, payout, free: false, largeLoan: false, subsidyBps: 0n },
      };
    }

    const rates = new ethers.Contract(schedule, RATE_SCHEDULE_ABI, input.provider);
    const [stateCode, split]: [string, [bigint, bigint, bigint]] = await Promise.all([
      network === ethers.ZeroAddress ? ZERO_BYTES32 : new ethers.Contract(network, NETWORK_ABI, input.provider).stateCodeOf(input.member),
      registry.splitTermsOf(input.merchant, input.installments),
    ]);
    let params: RateProductParams | null = null;
    let effective = 0n;
    if (stateCode !== ZERO_BYTES32 && (await rates.isEnabled(stateCode, input.productId))) {
      const [p, e] = await Promise.all([
        rates.paramsOf(stateCode, input.productId),
        rates.effectiveMonthlyBps(stateCode, input.productId, input.principal),
      ]);
      params = {
        enabled: Boolean(p.enabled),
        largeLoanThreshold: BigInt(p.largeLoanThreshold),
        minTermSeconds: BigInt(p.minTermSeconds),
        freeInFull: Boolean(p.freeInFull),
        freeBelowAmount: BigInt(p.freeBelowAmount),
        freeSplitMax: Number(p.freeSplitMax),
      };
      effective = BigInt(e);
    }
    const result = quotePlan({
      stateCode,
      params,
      merchant: { discountBps: BigInt(split[0]), subsidyBps: BigInt(split[1]), freeSplitMax: Number(split[2]) },
      effectiveMonthlyBps: effective,
      principal: input.principal,
      installments: input.installments,
      installmentLengthSeconds: input.installmentLength,
    });
    if (!result.ok) return { ok: false, refusal: result.refusal, reason: stateRefusalSentence(result.refusal) };
    return { ok: true, priced: true, stateCode, quote: result.quote };
  } catch (error) {
    console.error('[plan] pricing read failed', error instanceof Error ? error.message : error);
    return {
      ok: false,
      refusal: { kind: 'unavailable' },
      reason: 'We could not price this plan just now. Nothing was charged. Try again in a moment.',
    };
  }
}
