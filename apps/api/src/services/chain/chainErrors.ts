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
 * Phase 2 (compliance) adds the term-pricing errors (`TermIssuerProductNotEnabled`,
 * `TermIssuerTermsMismatch`, `TermIssuerTermTooShort`, `TermIssuerResplitNeedsSignature`), the
 * revolving state gate (`RevolvingIssuerStateNotEnabled`), CLRUSD's lapsing pauses (`ClearUSDPaused`)
 * and the vault's pilot cap (`ESADepositVaultPilotCapReached`). `describeCreditRefusal` gives each a
 * sentence a member can read.
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
  // TermIssuer, Phase 2 (compliance): on-chain pricing, the state gate, the large-loan term and re-split
  'error TermIssuerProductNotEnabled(address member, bytes32 stateCode, bytes32 productId)',
  'error TermIssuerTermsMismatch(uint256 signedRate, uint256 rate, uint256 signedPayout, uint256 payout)',
  'error TermIssuerTermTooShort(uint256 term, uint256 minimum)',
  'error TermIssuerResplitNeedsSignature(uint256 planId)',
  'error TermIssuerSplitLimitReached(uint256 planId)',
  'error TermIssuerSplitTooSoon(uint256 planId, uint256 availableAt)',
  'error TermIssuerNotPlanHolder(address caller)',
  // RevolvingIssuer, Phase 2: no line without an attested state where the product is enabled
  'error RevolvingIssuerStateNotEnabled(address member, bytes32 stateCode)',
  // RevolvingIssuer, Phase 2b (section 12): the unsecured and Boost caps, auto-clear, the member's
  // signed switches, and a module wired to the wrong slot
  'error RevolvingIssuerUnsecuredCap(uint256 capacity, uint256 cap)',
  'error RevolvingIssuerBoostCap(uint256 capacity, uint256 cap)',
  'error RevolvingIssuerAutoClearOff()',
  'error RevolvingIssuerNothingToClear(address member)',
  'error RevolvingIssuerBadScope(uint8 scope)',
  'error RevolvingIssuerSignatureExpired(uint256 deadline)',
  'error RevolvingIssuerBadSignature(address member)',
  'error RevolvingIssuerExtensionMismatch()',
  // RateSchedule
  'error RateScheduleUnknownProduct(bytes32 stateCode, bytes32 productId)',
  // ClearUSD (CLRUSD), Phase 2: FRAUD_ROLE pauses one account, SECURITY_ROLE everyone; each lapses
  'error ClearUSDPaused(address holder, uint32 reason, uint64 until)',
  'error ClearUSDEncumbered(address holder, uint256 free, uint256 amount)',
  // Liquidator, Phase 2b (12.5, 12.6, 12.8). `HoldReason` is an enum, so uint8 in the selector.
  'error LiquidatorReentered()',
  'error LiquidatorInvalidAddress()',
  'error LiquidatorNotInDefault(address member, address issuer)',
  'error LiquidatorNothingToSeize(address member)',
  'error LiquidatorNotRealizable(address collateral, uint256 seized)',
  'error LiquidatorUntrustedIssuer(address issuer)',
  'error LiquidatorNotSavingsTier(uint256 tierId, bytes32 kind)',
  'error LiquidatorOnHold(address member, uint8 reason, uint64 until)',
  'error LiquidatorHoldExists(address member)',
  'error LiquidatorNoHold(address member)',
  'error LiquidatorSameSigner(address signer)',
  'error LiquidatorBadParameter()',
  'error LiquidatorNoExcess(address member)',
  'error LiquidatorNoShortfall(address member)',
  'error LiquidatorShortfallNoticed(address member)',
  'error LiquidatorShortfallNotDue(address member, uint256 dueAt)',
  'error LiquidatorBelowPresentValue(uint256 bondId, uint256 received, uint256 presentValue)',
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
  // Phase 2: the rolling 365-day CA pilot cap on mints (redeems are never blocked)
  'error ESADepositVaultPilotCapReached(uint256 volume, uint256 amount, uint256 cap)',
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

/** The two-letter state in a bytes32 state code, or null for none. */
function stateName(code: unknown): string | null {
  if (typeof code !== 'string' || /^0x0*$/.test(code)) return null;
  try {
    return ethers.decodeBytes32String(code) || null;
  } catch {
    return null;
  }
}

/** Unix seconds as a date and time a member can read, in UTC so the server and the log agree. */
function until(seconds: unknown): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return 'shortly';
  return `until ${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export const STATE_NOT_CONFIRMED =
  'Your state of residence isn’t confirmed yet, so Clear can’t offer you credit. Nothing was charged. You can still pay now, and credit opens once your state is confirmed.';

/**
 * Why `quoteTermPlan` (or `_quote`) refused, in a sentence. The state cases come first because they
 * are the ones a member hits before anything is wrong with them: nobody has attested their state yet.
 */
export function stateRefusalSentence(
  refusal: { kind: 'state_not_confirmed' } | { kind: 'product_not_enabled'; stateCode?: string } | { kind: 'term_too_short'; minimumSeconds?: bigint } | { kind: 'unavailable' },
): string {
  switch (refusal.kind) {
    case 'state_not_confirmed':
      return STATE_NOT_CONFIRMED;
    case 'product_not_enabled': {
      const state = stateName(refusal.stateCode);
      return `Paying over time isn’t offered${state ? ` in ${state}` : ' where you live'} yet. Nothing was charged. You can still pay now.`;
    }
    case 'term_too_short': {
      const days = refusal.minimumSeconds ? Math.ceil(Number(refusal.minimumSeconds) / 86_400) : 365;
      return `A purchase this size has to be spread over at least ${days} days. Choose a longer split. Nothing was charged.`;
    }
    default:
      return 'We could not price this plan just now. Nothing was charged. Try again in a moment.';
  }
}

/**
 * Phase 2 credit and savings refusals, in words a member can act on. Null when the error is not
 * one of them. A missing state attestation says so, rather than reading as a refusal of the member.
 */
export function describeCreditRefusal(decoded: DecodedChainError | null): string | null {
  switch (decoded?.name) {
    case 'TermIssuerProductNotEnabled':
      return stateName(decoded.args.stateCode) === null
        ? STATE_NOT_CONFIRMED
        : stateRefusalSentence({ kind: 'product_not_enabled', stateCode: String(decoded.args.stateCode) });
    case 'RevolvingIssuerStateNotEnabled':
      return stateName(decoded.args.stateCode) === null
        ? 'Your state of residence isn’t confirmed yet, so your Clear credit line can’t open. It opens once your state is confirmed.'
        : `Clear credit isn’t offered in ${stateName(decoded.args.stateCode)} yet, so your credit line can’t open.`;
    case 'RateScheduleUnknownProduct':
      return 'This kind of credit isn’t offered where you live yet. Nothing was charged.';
    case 'TermIssuerTermsMismatch':
      return 'The plan’s rate or the shop’s payout changed after you signed. Nothing was charged. Approve again to see and sign the current terms.';
    case 'TermIssuerTermTooShort':
      return stateRefusalSentence({ kind: 'term_too_short', minimumSeconds: BigInt(decoded.args.minimum) });
    case 'TermIssuerResplitNeedsSignature':
      return 'This new split costs more, so it needs your signature on the new terms. Nothing has changed yet.';
    case 'TermIssuerSplitLimitReached':
      return 'This plan has been re-split as many times as it can be.';
    case 'TermIssuerSplitTooSoon':
      return `This plan was re-split recently. You can change it again ${until(decoded.args.availableAt)}.`;
    case 'TermIssuerNotPlanHolder':
      return 'That plan isn’t yours to change.';
    // The same error for one account (FRAUD_ROLE) and for everyone (SECURITY_ROLE); either lapses
    // after 72 hours unless a second signer renews it, and `until` is when.
    case 'ClearUSDPaused':
      return `Clear savings are paused for a security review ${until(decoded.args.until)}. Nothing moved. Contact support if this is unexpected.`;
    case 'ClearUSDEncumbered':
      return 'Part of your savings backs credit you have drawn, so it can’t move until that is repaid. Nothing moved.';
    case 'ESADepositVaultPilotCapReached':
      return 'Clear has reached this year’s limit for new savings in your state during the pilot. Nothing was taken. Withdrawals are not affected.';
    // Phase 2b (section 12)
    case 'RevolvingIssuerUnsecuredCap':
      return `Income-backed credit and Boost together can’t go above ${usd(units(decoded.args.cap))}. Nothing changed.`;
    case 'RevolvingIssuerBoostCap':
      return `Boost is capped at ${usd(units(decoded.args.cap))} for now. It rises after six clean cycles with savings deposits in five of them. Nothing changed.`;
    case 'RevolvingIssuerAutoClearOff':
      return 'Automatic clearing is paused across Clear right now. Nothing was taken. You can still clear what you owe yourself.';
    case 'RevolvingIssuerNothingToClear':
      return 'There is nothing to clear on your credit line right now. Nothing was taken.';
    case 'RevolvingIssuerBadScope':
      return 'That isn’t a choice automatic clearing offers. Nothing changed.';
    case 'RevolvingIssuerSignatureExpired':
      return 'The approval you signed timed out. Nothing changed. Try again to sign it afresh.';
    case 'RevolvingIssuerBadSignature':
      return 'Your signature did not match this change. Nothing changed. Try again to sign it afresh.';
    case 'RevolvingIssuerExtensionMismatch':
      return 'Clear’s credit line is being upgraded. Nothing changed. Try again later.';
    default:
      return null;
  }
}

const HOLD_REASON_WORDS = ['none', 'bankruptcy', 'death', 'a billing dispute', 'a late default notice'];

/**
 * The Liquidator's refusals (Phase 2b), in words an operator can act on. Null when the error is not
 * the Liquidator's.
 */
export function describeLiquidatorRefusal(decoded: DecodedChainError | null): string | null {
  switch (decoded?.name) {
    case 'LiquidatorOnHold':
      return `A Liquidation Hold (${HOLD_REASON_WORDS[Number(decoded.args.reason)] ?? 'a hold'}) pauses enforcement ${until(decoded.args.until)}. Nothing was taken.`;
    case 'LiquidatorSameSigner':
      return 'This step needs a different HOLD_ROLE signer from the one who took the last step. Send it from the second person’s wallet.';
    case 'LiquidatorHoldExists':
      return 'This member already has an active hold. Renew or clear it instead.';
    case 'LiquidatorNoHold':
      return 'There is no hold in that state to act on: it was never proposed, is already confirmed, or has lapsed.';
    case 'LiquidatorBadParameter':
      return 'The hold’s reason, length or evidence is not allowed: the length must be within the reason’s maximum, and a lapsed hold needs new evidence.';
    case 'LiquidatorNoExcess':
      return 'Nothing is drawn above the halved limit any more. Nothing was taken.';
    case 'LiquidatorNoShortfall':
      return 'The member’s Earn pledge backs what is drawn against it. No shortfall to notice.';
    case 'LiquidatorShortfallNoticed':
      return 'A shortfall notice is already open for this member.';
    case 'LiquidatorShortfallNotDue':
      return `The shortfall can be settled once its wait has passed, ${until(decoded.args.dueAt)}.`;
    case 'LiquidatorUntrustedIssuer':
      return 'The Liquidator does not trust this issuer (setTrustedSavingsIssuer).';
    case 'LiquidatorNothingToSeize':
      return 'The member has no pledged pool shares or bonds to settle it from. Savings are never used for this.';
    case 'LiquidatorBelowPresentValue':
      return 'A bond would have redeemed below its present value, so it was not taken.';
    case 'LiquidatorReentered':
      return 'The Liquidator refused a re-entrant call. Nothing was taken.';
    default:
      return null;
  }
}
