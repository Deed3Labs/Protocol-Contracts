import { ethers } from 'ethers';
import { decodeStateCode } from './stateCode.js';

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
 * and the vault's CA mint pause (`ESADepositVaultCaMintsPaused`, Phase 2d). `describeCreditRefusal` gives each a
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
  // Phase 2e (12.1, 12.2): computed cycles, hybridMode and excluded payers
  'error RevolvingIssuerCyclesComputed()',
  'error RevolvingIssuerBadCycleDay(uint256 day)',
  'error RevolvingIssuerHybridMode(address member)',
  'error RevolvingIssuerExcludedPayer(address member, bytes32 payer)',
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
  // NetworkRegistry: the state attestation (STATE_ATTESTER_ROLE)
  'error NetworkRegistryInvalidAddress()',
  'error NetworkRegistryInvalidStateCode()',
  // ClearUSD (CLRUSD), Phase 2: FRAUD_ROLE pauses one account, SECURITY_ROLE everyone; each lapses
  'error ClearUSDPaused(address holder, uint32 reason, uint64 until)',
  'error ClearUSDEncumbered(address holder, uint256 free, uint256 amount)',
  // Liquidator (LiquidatorBase.sol), as Phase 2f left it. `HoldReason` is an enum, so uint8 in the selector.
  'error LiquidatorReentered()',
  'error LiquidatorPauseClockSet()',
  'error LiquidatorPauseInForce(address member)',
  'error LiquidatorInvalidAddress()',
  'error LiquidatorNotInDefault(address member, address issuer)',
  'error LiquidatorNothingToSeize(address member)',
  'error LiquidatorUntrustedIssuer(address issuer)',
  'error LiquidatorNotSavingsTier(uint256 tierId, bytes32 kind)',
  'error LiquidatorOnHold(address member, uint8 reason, uint64 until)',
  'error LiquidatorHoldExists(address member)',
  'error LiquidatorNoHold(address member)',
  'error LiquidatorSameSigner(address signer)',
  'error LiquidatorBadParameter()',
  'error LiquidatorNoShortfall(address member)',
  'error LiquidatorShortfallNoticed(address member)',
  'error LiquidatorNotEarnBonds(address caller)',
  'error LiquidatorNotPoolShareEnforcer(address caller)',
  'error LiquidatorNotCollateralAgent(address caller)',
  // The keepers' permissionless upkeep calls (decision 53): each contract's own "not now"
  'error RevolvingIssuerNotInDefault(address member)',
  'error PoolShareEnforcerBlocked(address holder)',
  'error PoolShareEnforcerNothingNeeded(address holder)',
  'error PoolShareEnforcerNothingToSettle(address holder)',
  'error PoolShareEnforcerNotExcess(uint256 requestId)',
  'error BurnerBondNotPledgePayable(uint256 bondId)',
  'error BondVaultEnforcementInForce()',
  'error LendingPoolSuspended()',
  'error LendingPoolChargePending()',
  // PayoutPool
  'error PayoutPoolNotEligible(address holder)',
  'error PayoutPoolMerchantInactive(address merchant)',
  'error PayoutPoolNothingToRedeem(address merchant)',
  // LendingPool (the Yield Pool): nothing borrows from it since Phase 2f (decision 17)
  'error LendingPoolDirectBorrowOff()',
  'error LendingPoolInsufficientCash(uint256 available, uint256 requested)',
  // The Yield Pool's Deployments, and the Settlement Funding lane (decision 54): what
  // deploySettlement can refuse, beyond the Suspension and the pending charge above
  'error LendingPoolSettlementCap(uint256 usedInPeriod, uint256 capPerPeriod, uint256 amount)',
  'error LendingPoolNotAuthorized(address account)',
  'error LendingPoolInvalidAmount()',
  'error LendingPoolInvalidAddress()',
  'error LendingPoolQueueOpen()',
  'error LendingPoolFinalMaturity()',
  'error LendingPoolUtilizationCap(uint256 utilization)',
  'error LendingPoolTierCap(uint256 deployedBalance, uint256 poolTierPrincipal)',
  // SettlementForwarder (decision 54): CL Operating's AllowanceModule delegate
  'error SettlementForwarderNotDesk(address caller)',
  'error SettlementForwarderNotSafe(address caller)',
  'error SettlementForwarderNoOffRamp()',
  'error SettlementForwarderInvalidAmount()',
  'error SettlementForwarderInvalidAddress()',
  // ESADepositVault
  'error ESADepositVaultReceiverNotAuthorized()',
  'error ESADepositVaultBadSignature()',
  'error ESADepositVaultTokenNotAccepted()',
  'error ESADepositVaultInsufficientLiquidity()',
  // Phase 2d replaced the CA pilot cap with a two-person CA mint pause and an off switch, and Phase 4
  // (L-E) refuses a mint to a receiver with no attested state. Redeems are never blocked.
  'error ESADepositVaultCaMintsPaused(uint32 reason)',
  'error ESADepositVaultStateNotAttested(address receiver)',
  'error ESADepositVaultPilotOff()',
  // ClaimEscrow
  'error ClaimEscrowSignatureRequired()',
  'error ClaimEscrowBadClaimSignature()',
  'error ClaimEscrowExpired(uint64 expiry)',
  'error ClaimEscrowTermsNotAuthorized()',
  'error ClaimEscrowInvalidClaimSigner()',
  // CollateralRegistry (Phase 4b, L-I): pledges take the member's signature
  'error CollateralRegistryUnknownType(bytes32 kind)',
  'error CollateralRegistrySignatureExpired(uint256 deadline)',
  'error CollateralRegistryBadSignature(address member)',
  'error CollateralRegistryEncumbered(address member, bytes32 kind, uint256 free, uint256 amount)',
  // PointsIssuer (Clear Credits): what a mint can be refused for
  'error PointsIssuerRefUsed(bytes32 ref)',
  'error PointsIssuerSourceNotAllowed(bytes32 source)',
  'error PointsIssuerNoMatchPeriod(address member)',
  'error PointsIssuerOutsideMatchPeriod(address member)',
  'error PointsIssuerMonthlyCap(address member, uint256 wanted, uint256 left)',
  'error PointsIssuerLifetimeCap(address member, uint256 wanted, uint256 left)',
  'error PointsIssuerMatchPeriodSet(address member)',
  'error PointsIssuerBadSignature()',
  'error PointsIssuerExpired()',
  'error PointsIssuerInsufficient(address member, uint256 wanted, uint256 held)',
  'error PointsIssuerNoHousingRecord()',
  // HousingAllowanceRecord: what a redemption into it, or a payment toward a home, can be refused for
  'error HousingNotSigned(address member, uint256 homeId)',
  'error HousingOverCap(address member, uint256 wanted, uint256 left)',
  'error HousingNoPayee(uint256 homeId)',
  'error HousingAlreadyOpen(address member, uint256 homeId)',
  'error HousingHomeOccupied(uint256 homeId, address occupant)',
  'error HousingRefUsed(bytes32 ref)',
  'error HousingPriceRaise(uint256 current, uint256 wanted)',
  'error HousingDeductionsTooLarge(uint256 deductions, uint256 memberPortion)',
  'error HousingNotEnded(address member, uint256 homeId)',
  'error HousingHoldNotOver(uint64 until)',
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

/** Why redeeming credits into a home's Housing Allowance was refused, in words a member can act on. */
export function describeHousingRefusal(decoded: DecodedChainError | null): string | null {
  switch (decoded?.name) {
    case 'HousingNotSigned':
      return 'Credits go into a home’s Housing Allowance once your ELPA for that home is signed. Nothing was redeemed.';
    case 'HousingOverCap':
      return 'This would take your Housing Allowance from credits past $54,000 in all. Nothing was redeemed.';
    case 'PointsIssuerInsufficient':
      return 'You don’t have that many credits. Nothing was redeemed.';
    case 'PointsIssuerExpired':
      return 'The signature took too long to arrive. Nothing was redeemed. Try again.';
    case 'PointsIssuerBadSignature':
      return 'The signature didn’t match this wallet. Nothing was redeemed.';
    case 'HousingNoPayee':
      return 'Payments toward this home aren’t set up yet. Nothing was paid.';
    default:
      return null;
  }
}

/** The two-letter state in a bytes32 state code, or null for none (one encoding: ./stateCode.ts). */
const stateName = decodeStateCode;

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
    case 'ESADepositVaultCaMintsPaused':
      return 'New Clear savings are paused in your state for now. Nothing was taken. Withdrawals are not affected.';
    case 'ESADepositVaultStateNotAttested':
      return 'Clear needs to confirm your state before it can add to your savings. Nothing was taken.';
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
export function describePledgeRefusal(decoded: DecodedChainError | null): string | null {
  switch (decoded?.name) {
    case 'CollateralRegistrySignatureExpired':
      return 'Your signature timed out before it reached the network. Nothing was pledged. Try again to sign it afresh.';
    case 'CollateralRegistryBadSignature':
      return 'That signature is not your wallet’s for this pledge, or another pledge used it first. Nothing was pledged. Try again.';
    case 'CollateralRegistryUnknownType':
      return 'This kind of collateral cannot back a line on this network yet. Nothing was pledged.';
    default:
      return null;
  }
}

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
    case 'LiquidatorNoShortfall':
      return 'The member’s Earn pledge backs what is drawn against it. No shortfall to notice.';
    case 'LiquidatorShortfallNoticed':
      return 'A shortfall notice is already open for this member.';
    case 'LiquidatorUntrustedIssuer':
      return 'The Liquidator does not trust this issuer (setTrustedSavingsIssuer).';
    case 'LiquidatorNothingToSeize':
      return 'The member has no pledged pool shares or bonds to settle it from. Savings are never used for this.';
    case 'LiquidatorPauseInForce':
      return 'A pause is in force for this member, so enforcement waits until it ends. Nothing was taken.';
    case 'LiquidatorReentered':
      return 'The Liquidator refused a re-entrant call. Nothing was taken.';
    default:
      return null;
  }
}

/**
 * The keepers' refusals (decision 53): each is the contract's own rule saying the upkeep call is not
 * due now, so a keeper treats it as "not due", never as a failure. Null for anything else, which a
 * keeper does treat as a failure. Words for an operator reading the log or an alert.
 */
export function describeKeeperRefusal(decoded: DecodedChainError | null): string | null {
  switch (decoded?.name) {
    case 'RevolvingIssuerNotInDefault':
      return 'Not in default: no cure-notice timestamp, the grace has not ended, the amount was paid, or a pause or Income Assurance is in force.';
    case 'PoolShareEnforcerBlocked':
      return 'A Liquidation Hold or a 10c pause is in force for this holder, so pool-share enforcement waits.';
    case 'PoolShareEnforcerNothingNeeded':
      return 'No pledged pool shares need queuing now: nothing is defaulted, no shortfall is past its wait, or enough is already queued.';
    case 'PoolShareEnforcerNothingToSettle':
      return 'The queue has paid nothing new for this holder’s enforcement request since the last settlement.';
    case 'PoolShareEnforcerNotExcess':
      return 'That queued enforcement request is not more than is needed now, so nothing is given back.';
    case 'BurnerBondNotPledgePayable':
      return 'The Liquidator does not ask for this bond to be paid now: it is not the next pledged bond, nothing is due, or a hold or pause is in force.';
    case 'BondVaultEnforcementInForce':
      return 'The Collateral Agent’s Enforcement Notice is in force: pledged bonds are paid only through the Agent’s rounds.';
    case 'LendingPoolSuspended':
      return 'The Yield Pool is suspended, so the queue is not filled.';
    case 'LendingPoolChargePending':
      return 'A Pool Loss Charge is pending, so the queue is not filled until it is applied.';
    case 'LiquidatorOnHold':
    case 'LiquidatorPauseInForce':
    case 'LiquidatorNoShortfall':
    case 'LiquidatorShortfallNoticed':
      return describeLiquidatorRefusal(decoded);
    default:
      return null;
  }
}

/**
 * The settlement funding desk's refusals (decision 54): the Yield Pool's settlement lane
 * (`deploySettlement`, `returnFunds`) and the SettlementForwarder's `forward`, in words an operator
 * can act on. Null for anything else.
 */
export function describeSettlementRefusal(decoded: DecodedChainError | null): string | null {
  switch (decoded?.name) {
    case 'LendingPoolSettlementCap':
      return `Over the settlement lane's cap this period: ${usd(units(decoded.args.amount))} asked, ${usd(units(decoded.args.usedInPeriod))} of ${usd(units(decoded.args.capPerPeriod))} already used. The rest needs two deployers.`;
    case 'LendingPoolNotAuthorized':
      return `${decoded.args.account} may not do this: the settlement lane's registered funder alone deploys through it, and not while the lane is stopped.`;
    case 'LendingPoolInvalidAmount':
      return 'The amount is zero or the settlement ref is empty, so the pool refused it. Nothing moved.';
    case 'LendingPoolInvalidAddress':
      return 'The Yield Pool has no registered deployment account, so nothing can be deployed.';
    case 'LendingPoolQueueOpen':
      return 'A redemption request is open in the Yield Pool’s queue, so no Deployment can be made until it is filled.';
    case 'LendingPoolSuspended':
      return 'The Yield Pool is suspended, so no Deployment can be made.';
    case 'LendingPoolChargePending':
      return 'A Pool Loss Charge is being applied, so no Deployment can be made until it is done.';
    case 'LendingPoolFinalMaturity':
      return 'The Yield Pool has reached Final Maturity: Deployments have stopped.';
    case 'LendingPoolInsufficientCash':
      return `The Yield Pool’s Vault Cash cannot cover it: ${usd(units(decoded.args.requested))} asked, ${usd(units(decoded.args.available))} there.`;
    case 'LendingPoolUtilizationCap':
      return `It would take the Yield Pool’s Utilization to ${(Number(decoded.args.utilization) / 1e16).toFixed(2)}%, over 90%.`;
    case 'LendingPoolTierCap':
      return `It would take the Deployed Balance to ${usd(units(decoded.args.deployedBalance))}, over the ceiling of ${usd(units(decoded.args.poolTierPrincipal))} (the posted Pool Tier principal, plus the Settlement Headroom for the lane).`;
    case 'SettlementForwarderNotDesk':
      return `${decoded.args.caller} is not the SettlementForwarder's desk: only the desk wallet CL Operating set may call forward.`;
    case 'SettlementForwarderNotSafe':
      return 'Only CL Operating (the Safe) may change the SettlementForwarder.';
    case 'SettlementForwarderNoOffRamp':
      return 'CL Operating has not set the SettlementForwarder’s off-ramp yet, so nothing can be forwarded.';
    case 'SettlementForwarderInvalidAmount':
      return 'The SettlementForwarder refused a zero amount. Nothing moved.';
    case 'SettlementForwarderInvalidAddress':
      return 'The SettlementForwarder refused the zero address.';
    default:
      return null;
  }
}

/** An OpenZeppelin 4.x AccessControl revert ("AccessControl: account 0x… is missing role 0x…"). */
export function isMissingRoleRevert(decoded: DecodedChainError | null): boolean {
  return (
    decoded?.name === 'Error' &&
    /^AccessControl: account 0x[0-9a-f]{40} is missing role 0x[0-9a-f]{64}$/i.test(String(decoded.args[0] ?? ''))
  );
}

/**
 * Credit onboarding's refusals (the state attestation, then `openLine`): the contract's own rule
 * saying "not yet", which the job records and waits on rather than alerting. Null for anything else,
 * which is a failure. Words for an operator, and never the member's state: a log line that carries
 * the wallet must not carry where they live.
 */
export function describeOnboardingRefusal(decoded: DecodedChainError | null): string | null {
  if (isMissingRoleRevert(decoded)) {
    return 'The attester does not hold NetworkRegistry’s STATE_ATTESTER_ROLE, so no state can be attested.';
  }
  switch (decoded?.name) {
    case 'RevolvingIssuerStateNotEnabled':
      return stateName(decoded.args.stateCode) === null
        ? 'No state is attested for this member, so the RevolvingIssuer opens no line.'
        : 'The revolving product is not enabled in the member’s attested state, so the RevolvingIssuer opens no line.';
    default:
      return null;
  }
}
