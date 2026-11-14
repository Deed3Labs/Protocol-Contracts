// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";
import "../libraries/CarryIndex.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../libraries/ExposureMath.sol";
import "../core/interfaces/stable-credit/ICreditPositionSource.sol";
import "../core/interfaces/stable-credit/IExposureSource.sol";
import "./RateSchedule.sol";

/// @title RevolvingIssuer
/// @notice The tiered revolving line: savings-backed, asset-backed, income and Clear Boost.
/// @dev The member has one balance and one ceiling. The tiers describe how that ceiling was
/// composed and what each slice costs, so this contract answers "what is the ceiling made of"
/// while StableCredit answers "what is the balance and what is the ceiling".
///
/// Tiers are ordered by ascending rate, and drawing fills them in order. Cheapest-first is not
/// enforced anywhere as a rule: it falls out of the ordering, which is why the ordering is an
/// invariant rather than a convention. Repayment runs the other way, clearing the most expensive
/// slice first, so a member who pays something back always stops the most carry they can.
///
/// All balance drawn in a tier shares a rate and a clock, so a tier carries one index. Term plans
/// cannot work this way -- each has its own rate and its own opening date, and two plans at
/// different rates cannot share an index -- which is why they are a separate issuer rather than a
/// fifth tier.
contract RevolvingIssuer is RevolvingIssuerBase, ICreditPositionSource {
    using CarryIndex for CarryIndex.Index;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== INITIALIZER ========== */

    /// @dev The bare implementation can never be initialized; only the proxy can (audit L-1).
    /// @dev Both modules are deployed on their own and passed in: creating them here would put their
    /// creation code inside this one and over EIP-3860's 48 KiB limit. Each is checked for its
    /// kind and fixed for the life of this implementation.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address extension_, address cycles_, address terms_) {
        _disableInitializers();
        if (
            IExtensionKind(extension_).extensionKind() != keccak256("RevolvingIssuerExtension.v3")
                || IExtensionKind(cycles_).extensionKind() != keccak256("RevolvingIssuerCycles.v2")
                || IExtensionKind(terms_).extensionKind() != keccak256("RevolvingIssuerTerms.v1")
        ) revert RevolvingIssuerExtensionMismatch();
        extension = extension_;
        cycles = cycles_;
        terms = terms_;
    }

    /// @param _stableCredit the ledger this issuer writes to.
    /// @param _carryTreasury the co-op treasury, and the fallback for carry with no other home.
    function initialize(address _stableCredit, address _carryTreasury) external initializer {
        if (_carryTreasury == address(0)) revert RevolvingIssuerNoCarryRecipient();
        __CreditIssuer_init(_stableCredit);
        carryTreasury = _carryTreasury;
        emit CarryTreasuryUpdated(_carryTreasury);
    }

    /* ========== VIEWS ========== */

    /// @notice how many tiers are configured.
    function tierCount() external view returns (uint256) {
        return tiers.length;
    }

    /// @notice a tier's configuration.
    /// @param tierId index of the tier.
    /// @return kind tier kind.
    /// @return ratePerCycle carry rate per cycle in basis points.
    /// @return active whether the tier accepts new draws.
    function tierAt(uint256 tierId)
        external
        view
        returns (bytes32 kind, uint256 ratePerCycle, bool active)
    {
        _requireTier(tierId);
        TierConfig storage tier = tiers[tierId];
        return (tier.kind, tier.index.ratePerCycle, tier.active);
    }

    /// @notice a member's unsecured revolving principal, carry excluded: the tiers priced from
    /// RateSchedule, which are the revolving part of their small loan under the CFL (DECISIONS #7).
    function cflPrincipalOf(address member) external view returns (uint256 total) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tierProduct[i] != bytes32(0)) total += _principalOnly(member, i);
        }
    }

    /// @notice seconds in this network's credit cycle.
    /// @dev Derived, not stored. The clock already exists on the tiers -- every rate here is
    /// quoted per cycle and carry accrues against it -- so a second copy in storage would be a
    /// second answer that could disagree, and an issuer upgraded after its tiers were added would
    /// have carried a zero.
    ///
    /// Zero before any tier exists, which is the honest answer: a network with no tiers has no
    /// cycle rather than a cycle of nothing.
    function cycleLength() public view returns (uint64) {
        if (tiers.length == 0) return 0;
        return tiers[0].index.cycleLength;
    }

    /// @notice the ceiling contribution a member has in a tier.
    function capacityOf(address member, uint256 tierId) public view returns (uint256) {
        return tierCapacity[member][tierId];
    }

    /// @notice when the member's current line was opened; zero for a line opened before Phase 4b.
    function lineOpenedAtOf(address member) external view returns (uint64) {
        return lineOpenedAt[member];
    }

    /// @notice whether the member's current line is the one that defaulted (Phase 4b, M-C).
    /// @dev What the Liquidator reads. `hasDefaulted` stays true for ever, for underwriting and the
    /// record; a member who defaulted, settled and was given a new line is current on that line, and
    /// a stranger must not be able to liquidate it. A default on or after the line's opening is this
    /// line's. A line opened before this upgrade has no opening time, so any default counts, as before.
    function hasDefaultedOnCurrentLine(address member) external view returns (bool) {
        return _defaultedOnCurrentLine(member);
    }

    /// @notice whether a member has rebalanced their revolving line: nothing owed in any tier.
    /// @dev Judged on this issuer's own positions, not on the whole ledger balance (Phase 4, H-C).
    /// Since Phase 2e a cycle is judged on its Rebalance Amount (12.1), not on this.
    function inCompliance(address member) public view override returns (bool) {
        return _totalPrincipal(member) == 0;
    }

    /// @notice who is owed carry accrued in a tier: its own recipient, or the treasury.
    function carryRecipientOf(uint256 tierId) external view returns (address) {
        return _carryRecipient(tierId);
    }

    /// @notice how much more a member may draw in a tier.
    /// @dev Carry consumes headroom as it accrues, because the ceiling bounds what is owed rather
    /// than what was spent. Capped, for a collateral-backed tier, at what the collateral backs right
    /// now (audit C-2).
    function headroomOf(address member, uint256 tierId) external view returns (uint256) {
        return _headroom(member, tierId, drawnOf(member, tierId));
    }

    /// @notice what a member owes in a tier, carry included, as of now.
    function drawnOf(address member, uint256 tierId) public view returns (uint256) {
        _requireTier(tierId);
        return tierPrincipal[member][tierId] + _pendingCarry(member)[tierId];
    }

    /// @notice a member's total principal across every tier, materialised carry included: the
    /// figure that reconciles with the ledger.
    function totalPrincipalOf(address member) external view returns (uint256) {
        return _totalPrincipal(member);
    }

    /// @notice the principal alone: what carry accrues on (spec item 2).
    function principalOnlyOf(address member, uint256 tierId) external view returns (uint256) {
        return _principalOnly(member, tierId);
    }

    /// @notice the Boost cap this member has (12.4). Zero means not enforced.
    function boostCapOf(address member) external view returns (uint256) {
        return _boostCap(member);
    }

    /// @notice what a member owes on income-backed and Boost above their halved limit, after a
    /// missed cycle (12.5). Settled from pledged bonds or pool shares, never Savings. Zero otherwise.
    function unsecuredExcessOf(address member) external view returns (uint256) {
        if (cycleOf[member].missedInRow == 0) return 0;
        (uint256 capacity, uint256 drawn) = _unsecuredTotals(member);
        return drawn > capacity ? drawn - capacity : 0;
    }

    /// @notice consecutive missed rebalances, for the Liquidator.
    function missedInRowOf(address member) external view returns (uint8) {
        return cycleOf[member].missedInRow;
    }

    /// @notice the CLRUSD token a Savings draw refreshes the lock of (Phase 4b, L-B); zero if unset.
    function clrusdTokenOf() external view returns (address) {
        return clrusdToken;
    }


    /// @notice what a member owes in a tier that is already on the ledger: principal and
    /// materialised, unpaid carry.
    /// @dev This is the figure that reconciles with the ledger's credit balance.
    function principalOf(address member, uint256 tierId) external view returns (uint256) {
        return tierPrincipal[member][tierId];
    }


    /// @notice the carry owed in a tier, materialised and pending.
    function carryOf(address member, uint256 tierId) external view returns (uint256) {
        _requireTier(tierId);
        return tierCarry[member][tierId] + _pendingCarry(member)[tierId];
    }






    /// @notice a member's total ceiling across every tier.
    function totalCapacityOf(address member) public view returns (uint256 total) {
        for (uint256 i = 0; i < tiers.length; i++) {
            total += tierCapacity[member][i];
        }
    }

    /// @notice a member's total owed across every tier, carry included.
    /// @dev The balance is the sum of the positions, never a separately maintained total.
    function totalDrawnOf(address member) public view returns (uint256 total) {
        uint256[] memory pending = _pendingCarry(member);
        for (uint256 i = 0; i < tiers.length; i++) {
            total += tierPrincipal[member][i] + pending[i];
        }
    }

    /// @inheritdoc ICreditPositionSource
    /// @dev One entry per tier, in tier order, so a caller can pair a kind with its haircut
    /// without knowing anything about how the tiers were configured.
    function debtByKind(address member)
        external
        view
        override
        returns (bytes32[] memory kinds, uint256[] memory amounts)
    {
        uint256 count;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tierPrincipal[member][i] > 0) count++;
        }

        kinds = new bytes32[](count);
        amounts = new uint256[](count);
        uint256 index;
        for (uint256 i = 0; i < tiers.length; i++) {
            uint256 principal = tierPrincipal[member][i];
            if (principal == 0) continue;
            kinds[index] = tiers[i].kind;
            amounts[index] = principal;
            index++;
        }
    }


    /* ========== RESTRICTED FUNCTIONS ========== */






    /// @notice brings a member's accrued carry onto the ledger.
    /// @dev Runs on every interaction, and is callable directly so a position that nobody has
    /// touched can still be brought current.
    /// @param member address of the member.
    function materialiseCarry(address member) public {
        _materialiseCarry(member);
    }


    /// @notice see RevolvingIssuerExtension.openLine. Runs in the extension since Phase 4b, for room.
    function openLine(address, uint256[] calldata, uint8) external {
        _forward();
    }

    /* ---- cycles are computed (12.1, Phase 2e): no role writes or moves a cycle end ---- */

    /// @notice retired for this line: a revolving cycle ends on the member's Cycle End Day.
    function initializeCreditLine(address, uint256, uint256, uint256, uint256) external pure override {
        revert RevolvingIssuerCyclesComputed();
    }

    /// @notice retired for this line (see `initializeCreditLine`).
    function updateCreditPeriod(address, uint256, uint256) public pure override {
        revert RevolvingIssuerCyclesComputed();
    }

    /// @notice retired for this line (see `initializeCreditLine`).
    function setPeriodExpirationOf(address, uint256) public pure override {
        revert RevolvingIssuerCyclesComputed();
    }

    /// @notice retired for this line (see `initializeCreditLine`).
    function setGraceLengthOf(address, uint256) public pure override {
        revert RevolvingIssuerCyclesComputed();
    }

    /// @notice retired for this line (see `initializeCreditLine`).
    function pausePeriodOf(address) external pure override {
        revert RevolvingIssuerCyclesComputed();
    }

    /// @notice retired for this line (see `initializeCreditLine`).
    function unpausePeriodOf(address) external pure override {
        revert RevolvingIssuerCyclesComputed();
    }

    /// @notice records a revolving default once it is computed, and reverts otherwise (12.5, 10b).
    /// @dev Permissionless. Fails closed: with no cure-notice timestamp there is no default.
    function triggerDefault(address member) external {
        if (!inDefault(member)) revert RevolvingIssuerNotInDefault(member);
        expireCreditPeriod(member);
    }

    /* ========== CARD SETTLEMENT ========== */

    /// @notice what a settled card purchase put on a member's line.
    /// @param ref the card issuer's transaction reference, hashed.
    function cardSettlementOf(bytes32 ref) external view returns (address member, uint256 amount) {
        CardSettlement memory settlement = cardSettlements[ref];
        return (settlement.member, settlement.amount);
    }





    /// @notice what an authorization recorded for a ref still allows.
    function cardAuthorizationOf(bytes32 ref) external view returns (address member, uint256 amount) {
        CardAuthorization memory authorization = cardAuthorizations[ref];
        return (authorization.member, authorization.amount);
    }






    /// @notice what a fiat repayment ref cleared, zero if it has not been recorded.
    function cardRepaymentOf(bytes32 ref) external view returns (uint256) {
        return cardRepayments[ref];
    }




    /// @notice what an auto-repay ref repaid, zero if unused.
    function autoRepaymentOf(bytes32 ref) external view returns (uint256) {
        return autoRepayments[ref];
    }

    /* ========== INTERNAL ========== */

    /// @notice refuses a draw on this line that pays anyone but an active merchant or a named
    /// system address, then applies the period rules.
    /// @dev Phase 1 has no member-to-member payments. Without this, a member could send their line
    /// to a wallet of their own and redeem it at the payout pool (audit C-1, M-1).
    function _validateCreditTransaction(address sender, address recipient, uint256 amount)
        internal
        override
        returns (bool)
    {
        if (!_drawRecipientAllowed(sender, recipient, amount)) return false;
        return super._validateCreditTransaction(sender, recipient, amount);
    }

    /// @notice judges a cycle whose grace window has ended (section 12.4, 12.5).
    /// @dev Clean: the streak grows and the cycle rolls. First miss: the unsecured limit halves and
    /// the cycle rolls. Second miss in a row: the chain dates the cure notice and the line stays
    /// frozen. Default only once the cure window after that notice has passed. Runs in the
    /// extension, against this contract's storage.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function expireCreditPeriod(address member) internal override returns (bool) {
        (bool ok, bytes memory data) =
            cycles.delegatecall(abi.encodeWithSignature("judgeCycle(address)", member));
        if (!ok) {
            assembly {
                revert(add(data, 32), mload(data))
            }
        }
        uint8 outcome = abi.decode(data, (uint8));
        // 2: default now. The base path writes off and closes the line with this contract's own
        // `_writeOffAmount` and `_onDefault`, which the extension does not have.
        if (outcome == 2) return super.expireCreditPeriod(member);
        return outcome == 0;
    }

    /// @notice in default (12.5, 10b; Phase 2e): two consecutive missed Rebalance Amounts, a
    /// cure-notice timestamp recorded for the second by two people, that amount still unpaid, and
    /// the grace period over: the later of `cureWindow` (15 days) after the second due point and
    /// 864,000 s after the timestamp. Computed; no role sets it. No timestamp, no default; never
    /// while Income Assurance runs (12.13).
    function inDefault(address member) public view override returns (bool) {
        return _computedDefault(member);
    }

    /// @notice records what a credit movement did to this member's tiers.
    /// @dev Runs on the mint path rather than a separate reporting call, because the shortfall
    /// about to be minted is exactly what has to be placed in a tier, and the recipient's
    /// repayment is exactly what has to be taken out of one.
    function _syncCreditPositions(address sender, address recipient, uint256 amount)
        internal
        override
    {
        // The base issuer measures income against balance carried, and that has to see every
        // movement, not only the ones that land in a tier.
        super._syncCreditPositions(sender, recipient, amount);
        if (amount == 0) return;

        // Bring both parties current before deciding anything. Carry that has accrued since the
        // last touch is part of what is owed, so it belongs on the ledger before a draw measures
        // headroom against it or a repayment is allocated over it.
        _materialiseCarry(sender);
        if (recipient != address(0)) _materialiseCarry(recipient);

        // The sender covers what their balance cannot, and that shortfall is what gets minted.
        uint256 balance = stableCredit.balanceOf(sender);
        if (balance < amount && totalCapacityOf(sender) > 0) {
            // Every unit minted must land in a tier. A shortfall the tiers cannot hold would be
            // debt nothing tracks -- no carry, no schedule, nothing a default can write off -- and
            // a term limit on the same member used to make exactly that possible (audit C-1).
            uint256 unplaced = _draw(sender, amount - balance);
            if (unplaced > 0) revert RevolvingIssuerDrawUnplaced(sender, unplaced);
        }
    }

    /// @notice takes what these tiers can of a repayment, at or above a rate band.
    /// @dev Offered a budget by the ledger rather than told an amount, because the member's
    /// balance may be shared with a term issuer and both would otherwise record the whole
    /// payment. The band is what makes the waterfall run across issuers: a cash advance costing
    /// more than the income tier is cleared before it, even though it lives somewhere else.
    function _absorbRepayment(address member, uint256 available, uint256 minRate)
        internal
        override
        returns (uint256 absorbed)
    {
        if (available == 0) return 0;
        _materialiseCarry(member);

        uint256 remaining = available;
        // Judged by what each tier costs now, after the caps (Phase 4b, L-G), in the same unit
        // `nextRepaymentRate` reports the band in.
        uint256[] memory rates = _effectiveRates(member);
        for (uint256 i = tiers.length; i > 0 && remaining > 0; i--) {
            uint256 tierId = i - 1;
            if (rates[tierId] < minRate) continue;
            uint256 principal = tierPrincipal[member][tierId];
            if (principal == 0) continue;

            uint256 pay = principal < remaining ? principal : remaining;
            _repayTier(member, tierId, pay);
            remaining -= pay;
            absorbed += pay;
        }
    }

    /// @notice the unit repayment rates are compared in: monthly basis points times 1e18.
    uint256 public constant RATE_SCALE = RATE_SCALE_;

    /// @inheritdoc ICreditIssuer
    /// @dev The effective monthly rate after the caps, scaled by RATE_SCALE (Phase 4b, L-G). Tiers
    /// ascend by configured rate, but a binding member ceiling is trimmed from the dearest priced
    /// tier first, which can leave it cheaper than the one below. So every tier is considered.
    function nextRepaymentRate(address member)
        external
        view
        override
        returns (uint256 rate, bool hasPosition)
    {
        uint256[] memory rates = _effectiveRates(member);
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tierPrincipal[member][i] == 0) continue;
            if (!hasPosition || rates[i] > rate) {
                rate = rates[i];
                hasPosition = true;
            }
        }
    }











    /// @notice this issuer's share of a member's debt that no collateral covers.
    /// @dev Only what sits in these tiers, and within that, only the part collateral does not
    /// reach. Writing off a collateralized position would orphan the supply it created -- the
    /// credits are in someone else's hands, the obligation is gone, and the pledge that was meant
    /// to cover it is still sitting in the member's account backing nothing. That is precisely
    /// the lost debt this system is supposed to have far less of.
    ///
    /// The covered part stays owed, and liquidation settles it out of the pledge. Which means the
    /// safe order is not a rule someone follows: writing off first cannot strand the collateral,
    /// because the write-off never claims the collateralized share to begin with.
    function _writeOffAmount(address member) internal view override returns (uint256) {
        uint256 drawn = totalDrawnOf(member);
        if (address(exposureSource) == address(0)) return drawn;
        // This member's uncovered share, not the network total that `poolExposure` reports.
        (bool ok, bytes memory data) = address(exposureSource).staticcall(
            abi.encodeWithSignature("exposureOf(address)", member)
        );
        if (!ok || data.length < 32) return drawn;
        uint256 uncovered = abi.decode(data, (uint256));
        return uncovered > drawn ? drawn : uncovered;
    }

    /// @notice closes the member's line on default, without erasing what they still owe.
    /// @dev The ceiling goes; the collateralized positions do not. A defaulted member with collateral
    /// still owes the part it covers, and that debt is what liquidation settles against the pledge.
    /// Clearing it here would hand them their collateral back.
    ///
    /// The positions the write-off just took off the ledger go (Phase 2e): the unsecured tiers, which
    /// no collateral covers, or every tier when no exposure source says what is covered. Left in place
    /// they would be debt the ledger no longer shows, and a re-onboarded member's first Rebalance
    /// Amount would count it again (12.1).
    function _onDefault(address member) internal override {
        bool all = address(exposureSource) == address(0);
        for (uint256 i = 0; i < tiers.length; i++) {
            tierCapacity[member][i] = 0;
            if (all || _isUnsecured(i)) {
                tierPrincipal[member][i] = 0;
                tierCarry[member][i] = 0;
            }
        }
        super._onDefault(member);
    }




    /* ========== FORWARDED TO THE EXTENSION ========== */

    /// @notice Where the forwarded functions below actually run.
    /// @dev Created by this implementation's constructor and fixed with it: upgrading RevolvingIssuer
    /// deploys a fresh pair, and nobody can point a live contract at other code. Not storage, so
    /// the layout is untouched.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable extension;

    /// @notice Where the section 12 functions run (RevolvingIssuerCycles). Fixed like `extension`.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable cycles;

    /// @notice Where the Addendum 2 functions run (RevolvingIssuerTerms). Fixed like `extension`.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable terms;

    /// @notice see RevolvingIssuerExtension.settleCardSpend.
    function settleCardSpend(bytes32, address, uint256) external {
        _forward();
    }

    /// @notice see RevolvingIssuerExtension.authorizeCardSpend.
    function authorizeCardSpend(bytes32, address, uint256) external {
        _forward();
    }

    /// @notice see RevolvingIssuerExtension.reverseCardSpend.
    function reverseCardSpend(bytes32, uint256) external {
        _forward();
    }

    /// @notice see RevolvingIssuerExtension.repayCardSpend.
    function repayCardSpend(bytes32, address, uint256) external {
        _forward();
    }

    /// @notice see RevolvingIssuerCycles.repayForMember.
    function repayForMember(bytes32, address, uint256, bytes32) external {
        _forwardTo(cycles);
    }

    /// @notice see RevolvingIssuerExtension.settleFromCollateral.
    function settleFromCollateral(address, uint256, uint256) external {
        _forward();
    }

    /// @notice see RevolvingIssuerExtension.addTier.
    function addTier(bytes32, uint256, uint64) external returns (uint256) {
        _forward();
    }

    /// @notice see RevolvingIssuerExtension.setTierRate.
    function setTierRate(uint256, uint256) external {
        _forward();
    }

    /// @notice see RevolvingIssuerExtension.setClrusdToken.
    function setClrusdToken(address) external {
        _forward();
    }

    /// @notice see RevolvingIssuerExtension: section 12 settings and the member's own switches.
    function setCreditTerms(CreditTerms calldata, uint128, uint128) external {
        _forwardTo(cycles);
    }

    function setDepositSource(address) external {
        _forwardTo(cycles);
    }

    function setAutoClear(bool, uint8, bytes32) external {
        _forwardTo(cycles);
    }

    function setAutoClearWithSignature(address, bool, uint8, bytes32, uint256, bytes calldata) external {
        _forwardTo(cycles);
    }

    function setSavingsDrawAllowance(uint256) external {
        _forwardTo(cycles);
    }

    function setSavingsDrawAllowanceWithSignature(address, uint256, uint256, bytes calldata) external {
        _forwardTo(cycles);
    }

    /* ---- settings, forwarded to RevolvingIssuerTerms since Phase 2e (for room) ---- */

    function setTierActive(uint256, bool) external {
        _forwardTo(terms);
    }

    function setCarryTreasury(address) external {
        _forwardTo(terms);
    }

    function setTierCarryRecipient(uint256, address) external {
        _forwardTo(terms);
    }

    function setTierCapacity(address, uint256, uint256) external {
        _forwardTo(terms);
    }

    function setCardSettler(address, bool) external {
        _forwardTo(terms);
    }

    function setCardSettlementAccount(address) external {
        _forwardTo(terms);
    }

    function setCardCaps(uint256, uint256) external {
        _forwardTo(terms);
    }

    function setPricing(address, bytes32) external {
        _forwardTo(terms);
    }

    function setTierProduct(uint256, bytes32) external {
        _forwardTo(terms);
    }

    function setDailyCapacityCap(uint256) external {
        _forwardTo(terms);
    }

    function setAutoRepay(bool) external {
        _forwardTo(terms);
    }

    function setExposureSource(address) external {
        _forwardTo(terms);
    }

    /* ---- forwarded to RevolvingIssuerTerms (Addendum 2) ---- */

    function setCycleEndDayWithSignature(address, uint8, uint256, bytes calldata) external {
        _forwardTo(terms);
    }

    function proposeCureNotice(address) external {
        _forwardTo(terms);
    }

    function approveCureNotice(address) external {
        _forwardTo(terms);
    }

    function proposeIncomePause(address, uint8) external {
        _forwardTo(terms);
    }

    function approveIncomePause(address, uint8) external {
        _forwardTo(terms);
    }

    function endIncomePause() external {
        _forwardTo(terms);
    }

    function setHybridMode(bool) external {
        _forwardTo(terms);
    }

    function setPayerExclusionWithSignature(address, bytes32, bool, uint256, bytes calldata) external {
        _forwardTo(terms);
    }

    function addDefaultExcludedPayer(bytes32) external {
        _forwardTo(terms);
    }

    function setDueTerms(uint16, uint64, uint64, uint8) external {
        _forwardTo(terms);
    }

    function setTermIssuer(address) external {
        _forwardTo(terms);
    }

    function cycleStateOf(address) external view returns (CycleState memory) {
        _forwardView(terms);
    }

    function dueTermsOf() external view returns (DueTerms memory) {
        _forwardView(terms);
    }

    function duesOf(address) external view returns (uint256, uint256, bool) {
        _forwardView(terms);
    }

    function isPayerExcluded(address, bytes32) external view returns (bool) {
        _forwardView(terms);
    }

    function combinedInputsOf(address) external view returns (bytes32, bytes32, uint256, uint256) {
        _forwardView(terms);
    }

    /// @dev Runs the extension's implementation of this call against this contract's storage, and
    /// returns or reverts exactly as it did.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _forward() private {
        _forwardTo(extension);
    }

    /// @dev A view that runs in the terms module: this contract calls itself under STATICCALL, through
    /// `delegateView`, so the module reads this storage and nothing can be written on the way.
    function _forwardView(address target) private view {
        (bool ok, bytes memory data) =
            address(this).staticcall(abi.encodeWithSelector(this.delegateView.selector, target, msg.data));
        assembly {
            if iszero(ok) { revert(add(data, 32), mload(data)) }
            return(add(data, 32), mload(data))
        }
    }

    /// @notice internal: the far side of `_forwardView`. Only this contract may call it, and only
    /// with the terms module as the target, so it can run nothing else.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function delegateView(address target, bytes calldata data) external {
        if (msg.sender != address(this) || target != terms) revert RevolvingIssuerExtensionMismatch();
        (bool ok, bytes memory ret) = target.delegatecall(data);
        assembly {
            if iszero(ok) { revert(add(ret, 32), mload(ret)) }
            return(add(ret, 32), mload(ret))
        }
    }

    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _forwardTo(address target) private {
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
