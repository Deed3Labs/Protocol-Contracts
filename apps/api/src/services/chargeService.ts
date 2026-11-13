import { ethers } from 'ethers';
import { getContractAddress } from '../config/contracts.js';
import { savingsIntentService } from './savingsIntentService.js';
import { chargeStore, type ChargeRow } from './chargeStore.js';
import { notificationStore } from './notificationStore.js';
import { sendNotificationService } from './sendNotificationService.js';
import { memberStore } from './memberStore.js';
import { alertOps } from './opsAlert.js';
import {
  buildPlanTerms,
  dollars,
  isOfferedPlanSplit,
  PAY_OVER_TIME_MIN_CENTS,
  PLAN_PRODUCTS,
  PLAN_SIGNATURE_TTL_SECONDS,
  planTermsArg,
  planTermsTypedData,
  samePlanTerms,
  type PlanQuote,
  type PlanTerms,
  type PlanTermsTypedData,
} from '@clear/domain';
import { decodeChainError, describeCreditRefusal } from './chain/chainErrors.js';
import { quoteTermPlan } from './chain/planPricing.js';
import { memberAppUrl } from './memberAppUrl.js';
import { onlineOverTime } from './merchant/pay/overTime.js';

/*
 * Raising a charge, and a member answering it.
 *
 * The split is chosen on the member's phone and nowhere else -- a service writer must not be
 * picking somebody's repayment terms -- so a merchant's request carries an amount and a member and
 * nothing about how it will be repaid. `installments` only ever arrives on the approve call, from
 * the member's own session.
 *
 * ## How a merchant proves who it is
 *
 * There is no merchant account system, and inventing one would mean inventing the credential
 * store, the rotation and the recovery that go with it. There is already an on-chain
 * `MerchantRegistry` keyed by address, with an active flag and a per-charge approval cap, so a
 * merchant authenticates the way every other actor in this system does: it signs. The server
 * recovers the address from an EIP-712 signature and asks the registry whether that address is a
 * merchant in good standing.
 *
 * That gives the cap and the discount for free, and both are enforced here rather than trusted:
 * the amount is checked against `approvalCapOf`, and the payout is computed from `discountBpsOf`
 * rather than from anything the merchant sent.
 */

const MERCHANT_ABI = [
  'function isActive(address merchant) view returns (bool)',
  'function isRegistered(address merchant) view returns (bool)',
  'function approvalCapOf(address merchant) view returns (uint256)',
  'function discountBpsOf(address merchant) view returns (uint256)',
];

/*
 * `openPlan` takes the terms the member signed (audit H-4). The struct, its EIP-712 typed data and
 * the disclosure hash are defined once, in @clear/domain's planTerms, and built here from the charge.
 *
 * Phase 2: the struct carries `productId` after `merchant`, and `PlanOpened` carries everything the
 * disclosure needs to be reproduced (merchant, principal, split, rate, schedule hash, total carry,
 * disclosure hash). Only `planId` is read from it here, but the signature has to be the contract's
 * or the log never parses and a mined plan reads as "no PlanOpened".
 */
export const TERM_ISSUER_ABI = [
  'function openPlan((address member, address merchant, bytes32 productId, uint256 purchase, uint256 payout, uint256 ratePerCycle, uint64 cycleLength, uint32 installments, uint64 installmentLength, bytes32 disclosureHash, uint256 deadline) terms, bytes signature) returns (uint256)',
  'function planNonces(address member) view returns (uint256)',
  'function isOfferedSplit(uint32 installments) pure returns (bool)',
  'function termLimitOf(address) view returns (uint256)',
  'function totalPrincipalOf(address member) view returns (uint256)',
  'event PlanOpened(uint256 indexed planId, address indexed member, address indexed merchant, uint256 principal, uint32 split, uint256 rateBps, bytes32 scheduleHash, uint256 totalCarry, bytes32 disclosureHash)',
  'event PlanTermsSigned(uint256 indexed planId, address indexed member, bytes32 disclosureHash, uint256 nonce)',
];

const ISSUER_ABI = ['function cycleLength() view returns (uint64)'];

/** A charge is answerable for a day. The reference says so on the screen, so it is not a knob. */
export const CHARGE_TTL_SECONDS = 24 * 60 * 60;

/** A purchase at a partner shop is the RateSchedule's PARTNER product. */
const CHARGE_PRODUCT = PLAN_PRODUCTS.PARTNER;

export function chainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(chainId()));
}

/**
 * The typed data a merchant signs to raise a charge.
 *
 * `nonce` and `issuedAt` are in the payload because without them a captured signature is a
 * reusable licence to charge the same member the same amount forever. The server checks the age
 * and the registry checks the cap; together that bounds what a leaked signature can do to one
 * charge inside a short window, against one member, under a cap the co-op set.
 */
export function chargeTypedData(input: {
  merchant: string;
  member: string;
  amountCents: number;
  nonce: string;
  issuedAt: number;
}) {
  return {
    domain: {
      name: 'Clear Charge',
      version: '1',
      chainId: chainId(),
      verifyingContract: getContractAddress(chainId(), 'MerchantRegistry') || ethers.ZeroAddress,
    },
    types: {
      Charge: [
        { name: 'merchant', type: 'address' },
        { name: 'member', type: 'address' },
        { name: 'amountCents', type: 'uint256' },
        { name: 'nonce', type: 'string' },
        { name: 'issuedAt', type: 'uint256' },
      ],
    },
    message: {
      merchant: input.merchant,
      member: input.member,
      amountCents: input.amountCents,
      nonce: input.nonce,
      issuedAt: input.issuedAt,
    },
  };
}

/**
 * The terms the registry holds for a merchant.
 *
 * The same read `raiseCharge` performs, exposed for the surfaces that need to *show* terms rather
 * than enforce them — Settings, and the payout figures. Enforcement still happens inside
 * `raiseCharge`; this is deliberately a read.
 *
 * Returns null rather than throwing when the chain cannot be reached. A Settings page that fails
 * to load because an RPC blipped is worse than one that renders without the rate, and the caller
 * can say "unavailable" honestly. `raiseCharge` makes the opposite trade for the opposite reason:
 * there, an unreadable registry means refusing the charge.
 */
export async function readMerchantTerms(
  merchant: string,
): Promise<{ active: boolean; capCents: number; discountRate: number } | null> {
  const registryAddress = getContractAddress(chainId(), 'MerchantRegistry');
  if (!registryAddress) return null;

  try {
    const registry = new ethers.Contract(registryAddress, MERCHANT_ABI, provider());
    const [active, capRaw, discountBps] = await Promise.all([
      registry.isActive(merchant) as Promise<boolean>,
      registry.approvalCapOf(merchant) as Promise<bigint>,
      registry.discountBpsOf(merchant) as Promise<bigint>,
    ]);
    return {
      active,
      // The cap is in token units (6dp); everything above the chain works in cents.
      capCents: Number(capRaw / 10_000n),
      discountRate: Number(discountBps) / 10_000,
    };
  } catch (error) {
    console.error(
      '[charge] merchant terms read failed',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/** A signature older than this is refused however valid it is. */
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export interface RaiseResult {
  ok: boolean;
  charge?: ChargeRow;
  reason?: string;
}

export async function raiseCharge(input: {
  merchant: string;
  merchantName: string;
  member: string;
  amountCents: number;
  nonce: string;
  issuedAt: number;
  signature: string;
}): Promise<RaiseResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: 'amount must be a positive whole number of cents' };
  }

  const age = Math.floor(Date.now() / 1000) - input.issuedAt;
  if (!Number.isFinite(age) || age > SIGNATURE_MAX_AGE_SECONDS || age < -60) {
    return { ok: false, reason: 'signature is stale' };
  }

  const typed = chargeTypedData(input);
  let recovered: string;
  try {
    recovered = ethers.verifyTypedData(typed.domain, typed.types, typed.message, input.signature);
  } catch {
    return { ok: false, reason: 'signature could not be verified' };
  }
  // The signer *is* the merchant. Taking the address from the body and the signature separately
  // would let anyone raise a charge in somebody else's name by signing it with their own key.
  if (recovered.toLowerCase() !== input.merchant.trim().toLowerCase()) {
    return { ok: false, reason: 'signature does not match the merchant' };
  }

  const registryAddress = getContractAddress(chainId(), 'MerchantRegistry');
  if (!registryAddress) return { ok: false, reason: 'no merchant registry on this chain' };

  let payoutCents: number;
  try {
    const registry = new ethers.Contract(registryAddress, MERCHANT_ABI, provider());
    const [active, capRaw, discountBps] = await Promise.all([
      registry.isActive(recovered) as Promise<boolean>,
      registry.approvalCapOf(recovered) as Promise<bigint>,
      registry.discountBpsOf(recovered) as Promise<bigint>,
    ]);
    if (!active) return { ok: false, reason: 'merchant is not active' };

    // The cap is in token units (6dp); the charge is in cents. Compare in cents.
    const capCents = Number(capRaw / 10_000n);
    if (capCents > 0 && input.amountCents > capCents) {
      await chargeStore.recordCapHit(recovered, input.amountCents, capCents);
      return { ok: false, reason: 'amount is over this merchant’s approval cap' };
    }

    // Computed from the registry, never from the request. A merchant that could name its own
    // payout could name the whole purchase and leave the co-op nothing.
    payoutCents = input.amountCents - Math.floor((input.amountCents * Number(discountBps)) / 10_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[charge] registry read failed', message);
    // A failed read is not a pass. Raising a charge on an unreadable registry would mean charging
    // on behalf of a merchant nobody could confirm is still one.
    return { ok: false, reason: 'could not confirm the merchant right now' };
  }

  const charge = await chargeStore.create({
    merchantAddress: recovered,
    merchantName: input.merchantName.trim().slice(0, 80) || 'A Clear partner',
    memberWallet: input.member,
    amountCents: input.amountCents,
    payoutCents,
    chainId: chainId(),
    ttlSeconds: CHARGE_TTL_SECONDS,
  });
  if (!charge) return { ok: false, reason: 'could not record the charge' };

  await notifyMember(charge);
  return { ok: true, charge };
}


/**
 * A counter raises a charge — reference sections 02 and 03.
 *
 * **No signature, and no member.** Both were in the original design and section 20 removed the
 * first: the counter device holds no signing material at all, so there is nothing for it to sign
 * with. What proves this is a real shop is the enrolled device token, checked before this is
 * called — which is strictly stronger than a key on a tablet, because an owner can revoke it from
 * anywhere and it takes effect on the next request.
 *
 * The member is absent because entering the amount goes straight to the code. A new customer
 * installs from it and an existing member approves; either way nobody has said who they are yet,
 * and the wallet attaches when the code is opened.
 *
 * The registry is still the authority on terms. Active, cap and discount are read on chain exactly
 * as before, and the payout is computed from the registry rather than from anything the caller
 * sent — a merchant that could name its own payout could name the whole purchase.
 */
export async function raiseChargeFromDevice(input: {
  merchant: string;
  merchantName: string;
  amountCents: number;
  raisedBy?: string | null;
}): Promise<RaiseResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: 'amount must be a positive whole number of cents' };
  }

  const merchant = input.merchant.trim().toLowerCase();
  const registryAddress = getContractAddress(chainId(), 'MerchantRegistry');
  if (!registryAddress) return { ok: false, reason: 'no merchant registry on this chain' };

  let payoutCents: number;
  try {
    const registry = new ethers.Contract(registryAddress, MERCHANT_ABI, provider());
    const [active, capRaw, discountBps] = await Promise.all([
      registry.isActive(merchant) as Promise<boolean>,
      registry.approvalCapOf(merchant) as Promise<bigint>,
      registry.discountBpsOf(merchant) as Promise<bigint>,
    ]);
    if (!active) return { ok: false, reason: 'merchant is not active' };

    const capCents = Number(capRaw / 10_000n);
    if (capCents > 0 && input.amountCents > capCents) {
      await chargeStore.recordCapHit(merchant, input.amountCents, capCents);
      return { ok: false, reason: 'amount is over this merchant’s approval cap' };
    }
    payoutCents = input.amountCents - Math.floor((input.amountCents * Number(discountBps)) / 10_000);
  } catch (error) {
    console.error(
      '[charge] registry read failed',
      error instanceof Error ? error.message : 'unknown error',
    );
    // A failed read is not a pass, for the same reason as the signed path: raising on an unreadable
    // registry means charging on behalf of a merchant nobody could confirm is still one.
    return { ok: false, reason: 'could not confirm the merchant right now' };
  }

  const charge = await chargeStore.create({
    merchantAddress: merchant,
    merchantName: input.merchantName.trim().slice(0, 80) || 'A Clear partner',
    memberWallet: null,
    amountCents: input.amountCents,
    payoutCents,
    chainId: chainId(),
    ttlSeconds: CHARGE_TTL_SECONDS,
    raisedBy: input.raisedBy ?? null,
  });
  if (!charge) return { ok: false, reason: 'could not record the charge' };

  // No notification: the customer is at the counter and about to scan the screen.
  return { ok: true, charge };
}

/**
 * The alert, in the reference's own words.
 *
 * "You have not been charged yet" is the whole message — it is what makes the other two sentences
 * safe to read on a lock screen, and it is why the body is not summarised or shortened here.
 */
export async function notifyMember(charge: ChargeRow, opts: { resend?: boolean } = {}): Promise<boolean> {
  // A charge raised by showing a code has no member yet — the customer is standing at the counter
  // and will scan it in a moment. There is nobody to alert and nothing to say to them.
  if (!charge.memberWallet) return false;

  const amount = (charge.amountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  const base = memberAppUrl();

  const approveUrl = `${base}/c/${charge.code}`;

  // In-app and Web Push together, deduped on the code so a retried raise cannot alert twice. The
  // counter's Resend is keyed to the minute: a second tap in the same minute is the same alert, and
  // sends nothing, text included.
  const sent = await notificationStore.emit({
    wallet: charge.memberWallet,
    kind: 'request',
    title: `${charge.merchantName} is charging ${amount}`,
    body: 'Approve or decline. You have not been charged yet.',
    data: { chargeCode: charge.code, url: approveUrl, amountCents: charge.amountCents },
    dedupeKey: opts.resend ? `charge:${charge.code}:resend:${Math.floor(Date.now() / 60_000)}` : `charge:${charge.code}`,
  });
  if (opts.resend && !sent) return false;

  // Then the text, which the reference treats as the primary channel — a member standing at a
  // counter has not necessarily opened the app since they installed it. Null means they opted out
  // of notifications, which is a decision to respect rather than a lookup that failed.
  try {
    const contact = await memberStore.getContactByWallet(charge.memberWallet);
    if (!contact) return true;
    // A text and an email at once, as well as the app (rewards spec, section 9: "Reached her · All
    // three at once"), so whichever they look at first has it.
    const channels = [
      contact.phone ? { recipientType: 'phone' as const, recipientContact: contact.phone } : null,
      contact.email ? { recipientType: 'email' as const, recipientContact: contact.email } : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    await Promise.all(channels.map((c) => sendNotificationService.sendChargeAlert({ ...c, merchantName: charge.merchantName, amount, approveUrl })));
  } catch (error) {
    // Never fatal to raising a charge. The member already has it in-app and on their lock screen,
    // and failing the merchant's request because Twilio was down would be the wrong trade.
    console.error('[charge] contact alert failed', error instanceof Error ? error.message : error);
  }
  return true;
}

export interface ResolveResult {
  ok: boolean;
  charge?: ChargeRow;
  reason?: string;
}

export async function declineCharge(code: string, member: string): Promise<ResolveResult> {
  const existing = await chargeStore.get(code);
  if (!existing) return { ok: false, reason: 'no such charge' };
  if (existing.memberWallet !== member.trim().toLowerCase()) {
    return { ok: false, reason: 'not your charge' };
  }
  const claimed = await chargeStore.claimForResolution(code);
  if (!claimed) return { ok: false, reason: `charge is ${existing.status}` };
  const done = await chargeStore.finish(code, { status: 'declined' });
  return { ok: true, charge: done ?? undefined };
}

/**
 * A chain error, said in a sentence a member can act on.
 *
 * What reaches this function is an ethers message with calldata in it — the whole thing was
 * rendered on the approval screen once, under the amount, in red. A member cannot do anything with
 * a selector, and a revert is not a system failure they should be asked to interpret. The custom
 * errors that mean something to them are named; everything else gets one honest line rather than
 * a guess about a cause we do not know.
 */
export function explainChainError(error: unknown): string {
  const parsed = decodeChainError(error);
  // Phase 2: the state gate, on-chain pricing, the large-loan term, CLRUSD pauses.
  const phase2 = describeCreditRefusal(parsed);
  if (phase2) return phase2;
  switch (parsed?.name) {
    case 'TermIssuerExceedsTermLimit': {
      const limit = Number(parsed.args.limit) / 1_000_000;
      return limit > 0
        ? `This is more than your plan line covers right now — ${usd(limit)} is left of it.`
        : 'Your account is not set up to split purchases yet.';
    }
    case 'TermIssuerSplitNotOffered':
      return 'That way of splitting is not offered on this purchase.';
    case 'RateTooHigh':
    case 'TermIssuerInvalidSchedule':
      return 'Something about this charge does not add up. Ask the shop to send a new one.';
    case 'TermIssuerPlanClosed':
    case 'TermIssuerUnknownPlan':
      return 'This charge is no longer open. Ask the shop to send a new one.';
    // The member's signature (audit H-4). Nothing was opened; signing again fixes both.
    case 'TermIssuerBadSignature':
      return 'Your signature did not match these terms. Nothing was charged — approve again to sign them afresh.';
    case 'TermIssuerSignatureExpired':
      return 'The terms you signed timed out. Nothing was charged — approve again to sign them afresh.';
    case 'TermIssuerMerchantNotActive':
      return 'This shop cannot take payment over time right now. Nothing was charged.';
    case 'TermIssuerSuspended':
    case 'TermIssuerBehindSchedule':
      return 'A plan you already have is behind, so new ones are paused until it is caught up. Nothing was charged.';
    // Not the member's doing: the co-op's own limits and keys.
    case 'CreditIssuerDailyCapExceeded':
      return 'Clear has reached today’s limit for new plans. Nothing was charged — try again tomorrow, or pay now.';
    case 'CreditIssuerMissingRole':
      return 'We could not approve this charge. Nothing was charged — try again in a moment.';
  }

  // Deliberately not the ethers message. It names contracts and encodes calldata, and neither is
  // a member's to read.
  return 'We could not approve this charge. Nothing was charged — try again in a moment.';
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** The cycle every plan is measured on: the revolving issuer's, so a plan comes due when the rest does. */
async function memberCycleSeconds(): Promise<bigint> {
  let cycle = 30n * 24n * 60n * 60n;
  const revolvingAddress = getContractAddress(chainId(), 'RevolvingIssuer');
  if (revolvingAddress) {
    try {
      cycle = await new ethers.Contract(revolvingAddress, ISSUER_ABI, provider()).cycleLength();
    } catch {
      /* fall back to the network default above */
    }
  }
  return cycle;
}

/**
 * The plan terms for a charge, built the one way (@clear/domain planTerms). The member's choice is
 * the split and nothing else; the rate and the payout are the chain's quote for that split
 * (`quoteTermPlan`), because `openPlan` refuses any others. `deadline` is when their signature
 * stops being good.
 */
export function chargePlanTerms(
  charge: Pick<ChargeRow, 'memberWallet' | 'merchantAddress' | 'merchantName' | 'amountCents'>,
  installments: number,
  cycleSeconds: bigint,
  deadline: number,
  quote: Pick<PlanQuote, 'rateBps' | 'payout'>,
  purchaseCents?: number,
): { terms: PlanTerms; disclosure: string[] } {
  // A charge reaches a plan only once a member has answered it, so it always has one here.
  if (!charge.memberWallet) throw new Error('a plan needs a member');
  return buildPlanTerms({
    member: ethers.getAddress(charge.memberWallet),
    merchant: ethers.getAddress(charge.merchantAddress),
    merchantName: charge.merchantName,
    productId: CHARGE_PRODUCT,
    purchaseCents: purchaseCents ?? charge.amountCents,
    payout: quote.payout,
    ratePerCycleBps: quote.rateBps,
    cycleLengthSeconds: Number(cycleSeconds),
    installments,
    installmentLengthSeconds: Number(cycleSeconds),
    deadline,
    keccakUtf8: (text) => ethers.id(text),
  });
}

/**
 * The chain's price for a charge on this split: `_quote` for the member, the shop and the PARTNER
 * product. A refusal comes back as a sentence; a member whose state nobody has attested is told
 * exactly that.
 */
async function quoteCharge(
  charge: Pick<ChargeRow, 'memberWallet' | 'merchantAddress' | 'amountCents'>,
  termIssuerAddress: string,
  installments: number,
  cycleSeconds: bigint,
  purchaseCents?: number,
): Promise<{ ok: true; quote: PlanQuote } | { ok: false; reason: string; code?: string }> {
  if (!charge.memberWallet) return { ok: false, reason: 'a plan needs a member' };
  const priced = await quoteTermPlan({
    provider: provider(),
    termIssuer: termIssuerAddress,
    member: ethers.getAddress(charge.memberWallet),
    merchant: ethers.getAddress(charge.merchantAddress),
    productId: CHARGE_PRODUCT,
    principal: BigInt(purchaseCents ?? charge.amountCents) * 10_000n,
    installments,
    installmentLength: cycleSeconds,
  });
  if (!priced.ok) return { ok: false, reason: priced.reason, code: priced.refusal.kind };
  return { ok: true, quote: priced.quote };
}

/** The chain's price for one split, as the split chooser shows it. */
export interface SplitQuote {
  installments: number;
  /** Monthly bps the member would be charged on this split; 0 when free. */
  rateBps: number;
  free: boolean;
  /** Set when the chain would refuse this split, as a sentence a member can read. */
  refusal: string | null;
}

/**
 * Prices every split the chooser offers, from chain (`quoteCharge`), so what a member sees before
 * picking is what they will be asked to sign -- not a flat estimate. Null when there is no member or
 * no term issuer yet, and the app falls back to showing no rate rather than a guess.
 */
export async function splitQuotesForCharge(
  charge: Pick<ChargeRow, 'memberWallet' | 'merchantAddress' | 'amountCents'>,
  splits: readonly number[],
): Promise<SplitQuote[] | null> {
  if (!charge.memberWallet) return null;
  const termIssuerAddress = getContractAddress(chainId(), 'TermIssuer');
  if (!termIssuerAddress) return null;
  const cycle = await memberCycleSeconds();
  return Promise.all(
    splits.map(async (installments): Promise<SplitQuote> => {
      const priced = await quoteCharge(charge, termIssuerAddress, installments, cycle);
      if (!priced.ok) return { installments, rateBps: 0, free: false, refusal: priced.reason };
      return { installments, rateBps: Number(priced.quote.rateBps), free: priced.quote.free, refusal: null };
    }),
  );
}

/** Whether TermIssuer offers this split, with the 13-cycle option a large loan may take. */
async function splitOffered(issuer: ethers.Contract, installments: number, largeLoan: boolean): Promise<boolean> {
  if (installments === 13) return isOfferedPlanSplit(installments, largeLoan);
  return Boolean(await issuer.isOfferedSplit(installments));
}

/** The server's rules a charge has to pass before it can go on a plan. Writes nothing. */
async function planPrecheck(
  charge: ChargeRow,
  installments: number,
): Promise<{ ok: true; termIssuerAddress: string } | { ok: false; reason: string }> {
  // Online, over time is the link's or the site's to allow, and off in live until counsel signs off
  // (pay DECISIONS, rule 9). Approving opens a plan even in full, so any approval is refused; the
  // member pays now instead.
  if ((await onlineOverTime(charge.code)) === false) {
    return { ok: false, reason: 'This one is paid now, from your Clear cash.' };
  }

  // Under the minimum a charge is paid now, in full. The approval screen offers only that; this is
  // the check that holds when a client doesn't.
  if (installments > 1 && charge.amountCents < PAY_OVER_TIME_MIN_CENTS) {
    return { ok: false, reason: `Paying over time is for charges of ${dollars(PAY_OVER_TIME_MIN_CENTS / 100)} or more. This one is paid now.` };
  }

  const termIssuerAddress = getContractAddress(chainId(), 'TermIssuer');
  if (!termIssuerAddress) return { ok: false, reason: 'no term issuer on this chain' };
  return { ok: true, termIssuerAddress };
}

export type PrepareResult =
  | { ok: true; typedData: PlanTermsTypedData; disclosure: string[]; free: boolean }
  /** `code` is `state_not_confirmed` when nobody has attested the member's state yet. */
  | { ok: false; reason: string; code?: string };

/**
 * Step one of approving over time: the terms the member is about to sign (audit H-4).
 *
 * `TermIssuer.openPlan` opens a plan only on an EIP-712 signature by the member over its terms, at
 * their current `planNonces`. So the server no longer opens a plan on its own say-so: it builds the
 * terms here, the member's phone shows the disclosure rebuilt from those terms, checks them against
 * the screen and signs, and `approveCharge` submits. Nothing is claimed or written by this call.
 */
export async function prepareChargeApproval(code: string, member: string, installments: number): Promise<PrepareResult> {
  const existing = await chargeStore.get(code);
  if (!existing) return { ok: false, reason: 'no such charge' };
  if (existing.memberWallet !== member.trim().toLowerCase()) return { ok: false, reason: 'not your charge' };
  if (existing.status !== 'pending') return { ok: false, reason: `charge is ${existing.status}` };

  const gate = await planPrecheck(existing, installments);
  if (!gate.ok) return gate;

  try {
    const issuer = new ethers.Contract(gate.termIssuerAddress, TERM_ISSUER_ABI, provider());
    const [cycle, nonce]: [bigint, bigint] = await Promise.all([
      memberCycleSeconds(),
      issuer.planNonces(existing.memberWallet),
    ]);
    // Priced on chain (Phase 2): the rate and payout the member signs are the ones `openPlan`
    // computes, or it reverts. The state gate is part of the same read.
    const priced = await quoteCharge(existing, gate.termIssuerAddress, installments, cycle);
    if (!priced.ok) return { ok: false, reason: priced.reason, code: priced.code };
    if (!(await splitOffered(issuer, installments, priced.quote.largeLoan))) {
      return { ok: false, reason: 'That way of splitting is not offered on this purchase.' };
    }
    const deadline = Math.floor(Date.now() / 1000) + PLAN_SIGNATURE_TTL_SECONDS;
    const { terms, disclosure } = chargePlanTerms(existing, installments, cycle, deadline, priced.quote);
    return {
      ok: true,
      typedData: planTermsTypedData({ chainId: chainId(), termIssuer: ethers.getAddress(gate.termIssuerAddress), terms, nonce }),
      disclosure,
      free: priced.quote.free,
    };
  } catch (error) {
    console.error('[charge] preparing plan terms failed for', code, error instanceof Error ? error.message : error);
    return { ok: false, reason: 'We could not get this plan ready. Nothing was charged — try again in a moment.' };
  }
}

/** The member's signature over the terms `prepareChargeApproval` handed out, with those terms. */
export interface SignedPlanTerms {
  terms: PlanTerms;
  signature: string;
}

const SIGNATURE_HEX = /^0x(?:[0-9a-fA-F]{2})+$/;

/**
 * Step two: open the plan on the member's signed terms, then record it.
 *
 * In that order, and the order is the point. The chain is what a member actually owes; this table
 * only describes it. Writing `approved` first and opening the plan second would leave a charge
 * that says it was approved and a member who owes nothing — or, on a retry, two plans.
 */
export async function approveCharge(
  code: string,
  member: string,
  installments: number,
  signed?: SignedPlanTerms | null,
): Promise<ResolveResult> {
  const existing = await chargeStore.get(code);
  if (!existing) return { ok: false, reason: 'no such charge' };
  if (existing.memberWallet !== member.trim().toLowerCase()) {
    return { ok: false, reason: 'not your charge' };
  }

  // A plan needs the member's own signature on its terms (audit H-4). Any length: a smart account
  // signs through EIP-1271, which the contract accepts.
  if (!signed?.terms || typeof signed.signature !== 'string' || !SIGNATURE_HEX.test(signed.signature.trim())) {
    return { ok: false, reason: 'Sign the plan terms to approve this charge.' };
  }
  const now = Math.floor(Date.now() / 1000);
  const deadline = Number(signed.terms.deadline);
  if (!Number.isFinite(deadline) || deadline <= now || deadline > now + PLAN_SIGNATURE_TTL_SECONDS + 60) {
    return { ok: false, reason: 'The terms you signed timed out. Nothing was charged — approve again to sign them afresh.' };
  }

  const gate = await planPrecheck(existing, installments);
  if (!gate.ok) return gate;
  const termIssuerAddress = gate.termIssuerAddress;

  const key = operatorKey();
  if (!key) return { ok: false, reason: 'no credit operator configured' };

  const claimed = await chargeStore.claimForResolution(code);
  if (!claimed) return { ok: false, reason: `charge is ${existing.status}` };

  // Whether a transaction ever left this process. Everything about failure handling below turns
  // on it: before it is set, nothing can have happened on chain and the charge is safe to hand
  // back; after, it may have landed and handing it back could open a second plan for the same
  // purchase. Not the same question as whether the call threw.
  let submitted = false;

  try {
    const signer = new ethers.Wallet(key, provider());
    const issuer = new ethers.Contract(termIssuerAddress, TERM_ISSUER_ABI, signer);

    // Priced again, now: the terms submitted have to be the chain's quote at the moment `openPlan`
    // runs, and a rate or payout that moved since the member signed is refused here rather than
    // reverted into (TermIssuerTermsMismatch).
    const cycle = await memberCycleSeconds();
    const priced = await quoteCharge(claimed, termIssuerAddress, installments, cycle);
    if (!priced.ok) {
      await chargeStore.release(code);
      return { ok: false, reason: priced.reason };
    }

    // Asked rather than assumed: the offered splits are a contract rule, and a UI listing one the
    // chain does not take would fail at the last possible moment.
    if (!(await splitOffered(issuer, installments, priced.quote.largeLoan))) {
      await chargeStore.release(code);
      return { ok: false, reason: 'That way of splitting is not offered on this purchase.' };
    }

    /*
     * The ceiling, asked before the transaction rather than discovered by reverting into one.
     *
     * `openPlan` checks `totalPrincipalOf(member) + purchase` against `termLimitOf(member)`, so
     * the same question can be asked here, where the answer is still a sentence instead of a
     * failed gas estimate. It also keeps the charge answerable: nothing has been submitted, so it
     * goes back rather than sitting in `resolving`.
     */
    const purchaseUnits = BigInt(claimed.amountCents) * 10_000n;
    const [termLimit, principal]: [bigint, bigint] = await Promise.all([
      issuer.termLimitOf(claimed.memberWallet),
      issuer.totalPrincipalOf(claimed.memberWallet),
    ]);
    if (principal + purchaseUnits > termLimit) {
      await chargeStore.release(code);
      const left = Number(termLimit - principal) / 1_000_000;
      return {
        ok: false,
        reason:
          termLimit > 0n
            ? `This is more than your plan line covers right now — ${usd(Math.max(0, left))} is left of it.`
            : 'Your account is not set up to split purchases yet.',
      };
    }

    /*
     * The terms are rebuilt from the charge and the chain's quote, never taken from the request.
     * What the member signed has to be exactly this charge's plan (amount, shop, product, payout,
     * rate, cycle, split and disclosure) under the deadline they signed. A client that changed any
     * of it, or terms the chain would now price differently, is refused before anything is sent;
     * the contract checks the signature itself, at the member's current nonce.
     */
    const expected = chargePlanTerms(claimed, installments, cycle, deadline, priced.quote);
    if (!samePlanTerms(expected.terms, signed.terms)) {
      await chargeStore.release(code);
      const repriced =
        String(expected.terms.ratePerCycle) !== String(signed.terms?.ratePerCycle) ||
        String(expected.terms.payout) !== String(signed.terms?.payout);
      return {
        ok: false,
        reason: repriced
          ? 'The plan’s rate changed after you signed. Nothing was charged. Approve again to see and sign the current terms.'
          : 'The terms you signed are not this charge’s. Nothing was charged — approve again.',
      };
    }

    const tx = await issuer.openPlan(planTermsArg(expected.terms), signed.signature.trim());
    submitted = true;
    // Persisted before the wait, not after. If this process dies in the next few seconds, the hash
    // is the difference between a charge that reconciles itself and one that needs a person.
    await chargeStore.markSubmitted(code, tx.hash);
    const receipt = await tx.wait();

    let planId: number | undefined;
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = issuer.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'PlanOpened') planId = Number(parsed.args.planId);
      } catch {
        /* not our event */
      }
    }

    const done = await chargeStore.finish(code, {
      status: 'approved',
      splitInto: installments,
      planId,
      txHash: receipt?.hash ?? tx.hash,
      // The chain's payout for this split (in units, floored to the cent), not the default discount
      // the charge was raised with.
      payoutCents: Number(BigInt(expected.terms.payout) / 10_000n),
    });
    return { ok: true, charge: done ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[charge] openPlan failed for', code, message);

    if (!submitted) {
      // The transaction never left, so nothing was opened and the charge is answerable again.
      await chargeStore.release(code);
      // The log keeps the ethers message; the member gets a sentence. See explainChainError.
      return { ok: false, reason: explainChainError(error) };
    }

    // It did leave, and we do not know whether it landed -- a dropped connection while waiting
    // for a receipt looks exactly like a revert from here. The charge stays `resolving` on
    // purpose. Somebody has to look, and that is the right cost: releasing it would let the same
    // purchase be approved a second time, and a member owing twice for one repair is worse than
    // a charge that needs a human.
    console.error('[charge] submitted but unconfirmed — left resolving for reconciliation:', code);
    return { ok: false, reason: 'We could not confirm this went through. Give us a moment before trying again.' };
  }
}

/**
 * Charges left mid-flight, resolved against the chain.
 *
 * A charge goes `resolving` the moment it is claimed and stays there until the receipt comes back.
 * If the process dies in that window — or the RPC connection drops, which from here looks exactly
 * like a revert — nobody can say whether the plan was opened. Approving again could open a second
 * plan for one repair; releasing it could do the same. So it waits, and this is what ends the wait.
 *
 * It asks one exact question rather than guessing: the transaction hash was written before the
 * wait began, so there is a specific transaction to look up. Three answers and each is definite:
 *
 * - **mined and succeeded** → the plan exists; record it and mark the charge approved
 * - **mined and reverted** → nothing was opened; hand the charge back so it can be answered again
 * - **gone from the node entirely** → dropped without mining; hand it back
 *
 * A transaction still sitting in the mempool is left alone. That is the case a time-based rule
 * would get wrong: an underpriced transaction can sit for a long while and then land, and a sweep
 * that released the charge because "ten minutes is surely enough" would be the thing that opened
 * the second plan.
 *
 * Safe to run concurrently and safe to run twice. `finish` only closes a row that is still
 * `resolving`, so a second runner arriving behind the first does nothing.
 */
export interface ReconcileSummary {
  checked: number;
  approved: number;
  released: number;
  stillPending: number;
  unknown: number;
}

export async function reconcileCharges(olderThanSeconds = 120): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, approved: 0, released: 0, stillPending: 0, unknown: 0 };

  const stuck = await chargeStore.listStuck(olderThanSeconds);
  if (stuck.length === 0) return summary;

  const termIssuerAddress = getContractAddress(chainId(), 'TermIssuer');
  const rpc = provider();
  const iface = new ethers.Interface(TERM_ISSUER_ABI);

  for (const charge of stuck) {
    summary.checked += 1;

    // Claimed but never submitted — the process died between the two. Nothing can have happened
    // on chain, so this one is simply answerable again.
    if (!charge.txHash) {
      await chargeStore.release(charge.code);
      summary.released += 1;
      continue;
    }

    try {
      const receipt = await rpc.getTransactionReceipt(charge.txHash);

      if (!receipt) {
        // No receipt yet. Still in the mempool is a different thing from dropped, and only the
        // second is safe to act on.
        const tx = await rpc.getTransaction(charge.txHash);
        if (tx) {
          summary.stillPending += 1;
        } else {
          await chargeStore.release(charge.code);
          summary.released += 1;
        }
        continue;
      }

      if (receipt.status === 0) {
        await chargeStore.release(charge.code);
        summary.released += 1;
        continue;
      }

      let planId: number | undefined;
      for (const log of receipt.logs) {
        if (termIssuerAddress && log.address.toLowerCase() !== termIssuerAddress.toLowerCase()) continue;
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === 'PlanOpened') planId = Number(parsed.args.planId);
        } catch {
          /* not our event */
        }
      }

      // A successful receipt with no PlanOpened in it should not happen, and is not something to
      // paper over with a release: the transaction succeeded, so releasing could open a second
      // plan. Left alone and counted, so it shows up rather than being decided wrongly.
      if (planId === undefined) {
        await alertOps({
          key: `charge:${charge.code}:no-plan`,
          subject: `Charge ${charge.code}: mined without PlanOpened`,
          body: `Transaction ${charge.txHash} succeeded but emitted no PlanOpened. The charge is left resolving; check TermIssuer for a plan for ${charge.memberWallet} and record it, or set the charge back to pending if none exists.`,
        });
        summary.unknown += 1;
        continue;
      }

      await chargeStore.finish(charge.code, {
        status: 'approved',
        splitInto: charge.splitInto ?? undefined,
        planId,
        txHash: charge.txHash,
      });
      summary.approved += 1;

      // The member pressed Approve and never saw it land. Tell them it did.
      //
      // Guarded rather than defaulted: a charge reaching settlement always has a member, because
      // approving is what attaches one. If that is ever untrue the right answer is to send nothing
      // — a notification addressed to an empty wallet is delivered to nobody and hides the bug.
      if (charge.memberWallet)
        await notificationStore
          .emit({
            wallet: charge.memberWallet,
            kind: 'credit',
            title: 'Your plan is open',
            body: `${charge.merchantName} · ${(charge.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
            data: { chargeCode: charge.code, planId },
            dedupeKey: `charge-approved:${charge.code}`,
          })
          .catch(() => {});
    } catch (error) {
      // An unreadable chain is not an answer. Left as it is for the next run.
      console.error('[charge] reconcile failed for', charge.code, error instanceof Error ? error.message : error);
      summary.unknown += 1;
    }
  }

  return summary;
}

/**
 * Put a disputed purchase back on a plan, after the member lost the dispute or withdrew it.
 *
 * A NEW plan, opened now, for what was unwound. That is how "the time it spent in dispute is added
 * back" is kept: carry and the schedule start from today, so the weeks it spent in dispute cost the
 * member nothing. Same split as the original; the rate and the shop's payout are today's quote for
 * what is put back (Phase 2: `openPlan` prices on chain and refuses anything else).
 *
 * A plan opens only on terms the member signed (audit H-4), and that includes this one. Without a
 * signature this alerts ops and returns `needsSignature`; the member signs from their disputes list
 * (`prepareReopenAfterDispute`, then `POST /api/disputes/:token/reopen`), and this opens it.
 */
export async function reopenPlanAfterDispute(
  charge: ChargeRow,
  principalCents: number,
  signed?: SignedPlanTerms | null,
): Promise<{ ok: boolean; planId?: number; txHash?: string; reason?: string; needsSignature?: boolean }> {
  if (principalCents <= 0) return { ok: true };
  const termIssuerAddress = getContractAddress(chainId(), 'TermIssuer');
  if (!termIssuerAddress) return { ok: false, reason: 'no term issuer on this chain' };

  /*
   * The server used to reopen it on its own key; it cannot any more, and should not: a new plan is a
   * new obligation. Until the member signs the reopened terms the amount stays off any plan and a
   * person is told, with the figures, rather than it being silently forgiven or silently re-owed.
   */
  if (!signed) {
    await alertOps({
      key: `charge:${charge.code}:reopen-needs-signature`,
      subject: `Charge ${charge.code}: plan not reopened after the dispute (waiting for the member's signature)`,
      body:
        `The dispute went against ${charge.memberWallet}, and ${principalCents}c of ${charge.merchantName}'s charge ` +
        `should go back on a ${charge.splitInto ?? 1}-installment plan. TermIssuer.openPlan needs the member's ` +
        `EIP-712 signature over the terms. The member can sign it from their disputes list in the app ` +
        `(POST /api/disputes/<token>/reopen); until then it is on no plan.`,
    }).catch(() => {});
    return { ok: false, needsSignature: true, reason: 'reopening the plan needs the member’s signature' };
  }

  const key = operatorKey();
  if (!key) return { ok: false, reason: 'no credit operator configured' };

  try {
    const issuer = new ethers.Contract(termIssuerAddress, TERM_ISSUER_ABI, new ethers.Wallet(key, provider()));
    const installments = charge.splitInto ?? 1;
    const cycle = await memberCycleSeconds();
    const priced = await quoteCharge(charge, termIssuerAddress, installments, cycle, principalCents);
    if (!priced.ok) return { ok: false, reason: priced.reason };
    const expected = chargePlanTerms(charge, installments, cycle, Number(signed.terms.deadline), priced.quote, principalCents);
    if (!samePlanTerms(expected.terms, signed.terms)) {
      return { ok: false, reason: 'The terms signed are not this plan’s, or its rate changed since. Nothing was opened. Sign again.' };
    }
    const tx = await issuer.openPlan(planTermsArg(expected.terms), signed.signature.trim());
    const receipt = await tx.wait();
    let planId: number | undefined;
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = issuer.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'PlanOpened') planId = Number(parsed.args.planId);
      } catch {
        /* not our event */
      }
    }
    return { ok: true, planId, txHash: receipt?.hash ?? tx.hash };
  } catch (error) {
    console.error('[dispute] reopening plan failed for', charge.code, error);
    return { ok: false, reason: explainChainError(error) };
  }
}

/**
 * The terms a member signs to put a disputed purchase back on a plan: `prepareChargeApproval` for
 * the amount that was unwound, on the split they had chosen. Writes nothing.
 */
export async function prepareReopenAfterDispute(charge: ChargeRow, principalCents: number): Promise<PrepareResult> {
  if (principalCents <= 0) return { ok: false, reason: 'There is nothing to put back on a plan.' };
  const termIssuerAddress = getContractAddress(chainId(), 'TermIssuer');
  if (!termIssuerAddress) return { ok: false, reason: 'no term issuer on this chain' };
  if (!charge.memberWallet) return { ok: false, reason: 'a plan needs a member' };
  try {
    const issuer = new ethers.Contract(termIssuerAddress, TERM_ISSUER_ABI, provider());
    const installments = charge.splitInto ?? 1;
    const [cycle, nonce]: [bigint, bigint] = await Promise.all([memberCycleSeconds(), issuer.planNonces(charge.memberWallet)]);
    const priced = await quoteCharge(charge, termIssuerAddress, installments, cycle, principalCents);
    if (!priced.ok) return { ok: false, reason: priced.reason, code: priced.code };
    const deadline = Math.floor(Date.now() / 1000) + PLAN_SIGNATURE_TTL_SECONDS;
    const { terms, disclosure } = chargePlanTerms(charge, installments, cycle, deadline, priced.quote, principalCents);
    return {
      ok: true,
      typedData: planTermsTypedData({ chainId: chainId(), termIssuer: ethers.getAddress(termIssuerAddress), terms, nonce }),
      disclosure,
      free: priced.quote.free,
    };
  } catch (error) {
    console.error('[dispute] preparing reopened plan failed for', charge.code, error instanceof Error ? error.message : error);
    return { ok: false, reason: 'We could not get this plan ready. Nothing was charged — try again in a moment.' };
  }
}
