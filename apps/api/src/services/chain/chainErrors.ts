import { ethers } from 'ethers';

/*
 * The contracts' custom errors, decoded in one place (audit Phase 1).
 *
 * Phase 1 turned many revert strings into custom errors and added new ones: the credit roles split
 * (`CreditIssuerMissingRole`), the draw-recipient rule (`StableCreditRecipientNotEligible`), card
 * authorizations and caps, signed plans, redeem eligibility, signed claims and borrow destinations.
 * A custom error reaches us as four selector bytes and ABI-encoded arguments; without its fragment
 * ethers reports "unknown custom error" and every caller ends up storing calldata. So the fragments
 * live here, every service that writes to the chain decodes through `decodeChainError`, and the
 * sentences a person reads are chosen by name.
 *
 * Fragments only, copied from the contracts' error declarations. Nothing here imports Solidity.
 */
export const CHAIN_ERROR_FRAGMENTS = [
  // CreditIssuer (shared by RevolvingIssuer, TermIssuer, OffersIssuer)
  'error CreditIssuerMissingRole(bytes32 role, address caller)',
  'error CreditIssuerDailyCapExceeded(bytes32 cap, uint256 requested, uint256 remaining)',
  'error CreditIssuerPeriodMayOnlyExtend(address member)',
  'error CreditIssuerNoPeriod(address member)',
  // StableCredit (the ledger)
  'error StableCreditRecipientNotEligible(address from, address to)',
  'error StableCreditMerchantMayOnlyRedeem(address merchant, address to)',
  'error StableCreditTransactionInvalid(address from, address to, uint256 amount)',
  'error StableCreditCeilingExceeded(address member, uint256 owed, uint256 ceiling)',
  'error StableCreditBurnDisabled()',
  // RevolvingIssuer: draws and the card
  'error RevolvingIssuerDrawUnplaced(address member, uint256 unplaced)',
  'error RevolvingIssuerNotCardSettler(address caller)',
  'error RevolvingIssuerNoCardSettlementAccount()',
  'error RevolvingIssuerCardAmountZero()',
  'error RevolvingIssuerCardAlreadySettled(bytes32 ref)',
  'error RevolvingIssuerCardNotSettled(bytes32 ref)',
  'error RevolvingIssuerCardHeadroom(address member, uint256 amount, uint256 headroom)',
  'error RevolvingIssuerCardReversalExceedsSettlement(bytes32 ref, uint256 amount, uint256 settled)',
  'error RevolvingIssuerCardAlreadyRepaid(bytes32 ref)',
  'error RevolvingIssuerCardRepaymentExceedsDrawn(address member, uint256 amount, uint256 principal)',
  'error RevolvingIssuerCardFloatCannotCover(uint256 amount, uint256 held)',
  'error RevolvingIssuerCardNotAuthorized(bytes32 ref, address member)',
  'error RevolvingIssuerCardExceedsAuthorization(bytes32 ref, uint256 amount, uint256 authorized)',
  'error RevolvingIssuerCardTxCap(uint256 amount, uint256 cap)',
  'error RevolvingIssuerCardAlreadyAuthorized(bytes32 ref)',
  'error RevolvingIssuerMemberNotInGoodStanding(address member)',
  'error RevolvingIssuerAutoRepayNotEnabled(address member)',
  'error RevolvingIssuerAutoRepayAlreadyUsed(bytes32 ref)',
  // TermIssuer
  'error TermIssuerExceedsTermLimit(address member, uint256 requested, uint256 limit)',
  'error TermIssuerSplitNotOffered(uint32 installments)',
  'error TermIssuerInvalidSchedule()',
  'error TermIssuerPlanClosed(uint256 planId)',
  'error TermIssuerUnknownPlan(uint256 planId)',
  'error TermIssuerMerchantNotActive(address merchant)',
  'error TermIssuerBadSignature(address member)',
  'error TermIssuerSignatureExpired(uint256 deadline)',
  'error TermIssuerSuspended(address member)',
  'error TermIssuerBehindSchedule(address member)',
  'error RateTooHigh(uint256 ratePerCycle)',
  // PayoutPool
  'error PayoutPoolNotEligible(address holder)',
  'error PayoutPoolMerchantInactive(address merchant)',
  'error PayoutPoolNothingToRedeem(address merchant)',
  // LendingPool
  'error LendingPoolDestinationNotAllowed(address borrower, address to)',
  'error LendingPoolDailyCapExceeded(address borrower, uint256 remaining, uint256 requested)',
  'error LendingPoolInsufficientCash(uint256 available, uint256 requested)',
  // ESADepositVault
  'error ESADepositVaultReceiverNotAuthorized()',
  'error ESADepositVaultBadSignature()',
  'error ESADepositVaultTokenNotAccepted()',
  'error ESADepositVaultInsufficientLiquidity()',
  // ClaimEscrow
  'error ClaimEscrowSignatureRequired()',
  'error ClaimEscrowBadClaimSignature()',
  'error ClaimEscrowExpired(uint64 expiry)',
  'error ClaimEscrowTermsNotAuthorized()',
  'error ClaimEscrowInvalidClaimSigner()',
] as const;

export const CHAIN_ERRORS = new ethers.Interface(CHAIN_ERROR_FRAGMENTS as unknown as string[]);

export interface DecodedChainError {
  name: string;
  args: ethers.Result;
}

/** Revert data, wherever ethers or viem left it on the error. */
export function revertDataOf(error: unknown): string | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length) {
    const e = queue.shift();
    if (!e || typeof e !== 'object' || seen.has(e)) continue;
    seen.add(e);
    const o = e as Record<string, unknown>;
    for (const key of ['data', 'raw']) {
      const v = o[key];
      if (typeof v === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(v)) return v;
    }
    for (const key of ['data', 'info', 'error', 'cause', 'revert']) {
      if (o[key] && typeof o[key] === 'object') queue.push(o[key]);
    }
  }
  return null;
}

/** The custom error a call reverted with, if it is one we know. */
export function decodeChainError(error: unknown): DecodedChainError | null {
  const data = revertDataOf(error);
  if (!data) return null;
  try {
    const parsed = CHAIN_ERRORS.parseError(data);
    return parsed ? { name: parsed.name, args: parsed.args } : null;
  } catch {
    return null;
  }
}

/** A short, storable reason: the error's name and arguments, or the message without calldata. */
export function chainErrorReason(error: unknown): string {
  const decoded = decodeChainError(error);
  if (decoded) {
    const args = Array.from(decoded.args, (a) => (typeof a === 'bigint' ? a.toString() : String(a)));
    return `${decoded.name}(${args.join(', ')})`.slice(0, 400);
  }
  const e = error as { revert?: { name?: string }; reason?: string; shortMessage?: string; message?: string };
  return String(e?.revert?.name || e?.reason || e?.shortMessage || e?.message || error).slice(0, 400);
}

const units = (v: unknown) => Number(v) / 1_000_000;
const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Card authorization and settlement refusals, in words an operator (or a member's support thread)
 * can act on. Null when the error is not one of the card rules.
 */
export function describeCardRefusal(decoded: DecodedChainError | null): string | null {
  switch (decoded?.name) {
    case 'RevolvingIssuerMemberNotInGoodStanding':
      return 'The member’s line is frozen or in default, so the card cannot draw on it.';
    case 'RevolvingIssuerCardTxCap':
      return `Over the per-purchase card cap: ${usd(units(decoded.args.amount))} asked, the cap is ${usd(units(decoded.args.cap))}.`;
    case 'CreditIssuerDailyCapExceeded':
      return `Over today’s cap for card spend: ${usd(units(decoded.args.requested))} asked, ${usd(units(decoded.args.remaining))} left today.`;
    case 'RevolvingIssuerCardHeadroom':
      return `The line cannot hold it: ${usd(units(decoded.args.amount))} asked, ${usd(units(decoded.args.headroom))} of room.`;
    case 'RevolvingIssuerCardExceedsAuthorization':
      return `Settled for more than was authorized: ${usd(units(decoded.args.amount))} against ${usd(units(decoded.args.authorized))}.`;
    case 'RevolvingIssuerCardNotAuthorized':
      return 'No authorization is recorded on chain for this purchase and member.';
    case 'RevolvingIssuerNotCardSettler':
      return 'The settler key is not a card settler on the RevolvingIssuer.';
    case 'RevolvingIssuerDrawUnplaced':
      return 'The member’s tiers could not place the draw.';
    default:
      return null;
  }
}

/** What a merchant is told when redeeming fails. Null when it is not one of the redeem rules. */
export function describeRedeemRefusal(decoded: DecodedChainError | null): string | null {
  switch (decoded?.name) {
    case 'PayoutPoolNotEligible':
      return 'This wallet is not a registered shop, so it cannot be paid out. Nothing has left your balance.';
    case 'PayoutPoolMerchantInactive':
      return 'Your shop is not active right now, so payouts are paused. Nothing has left your balance.';
    case 'PayoutPoolNothingToRedeem':
      return 'There is nothing to withdraw from what you are owed.';
    default:
      return null;
  }
}
