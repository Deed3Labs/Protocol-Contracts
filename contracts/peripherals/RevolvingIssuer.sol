// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";
import "./RevolvingIssuerExtension.sol";
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
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
        extension = address(new RevolvingIssuerExtension());
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
            if (tierProduct[i] != bytes32(0)) total += principalOnlyOf(member, i);
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



    /// @notice opens or closes a tier to new draws.
    /// @dev Closing does not call in what is drawn. Existing positions keep accruing and can be
    /// repaid; they simply cannot grow.
    function setTierActive(uint256 tierId, bool active) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        _requireTier(tierId);
        tiers[tierId].active = active;
    }

    /// @notice moves the co-op treasury, and with it the fallback for every tier that has not
    /// named someone else.
    /// @dev Cannot be cleared. There is no state in which carry has nowhere to go.
    function setCarryTreasury(address treasury) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (treasury == address(0)) revert RevolvingIssuerNoCarryRecipient();
        carryTreasury = treasury;
        emit CarryTreasuryUpdated(treasury);
    }

    /// @notice sets who is owed carry accrued in one tier.
    /// @dev Pass address(0) to return the tier to the treasury. That is how a funding source is
    /// retired: carry keeps accruing and keeps landing somewhere, and where it landed in the
    /// meantime can be settled by hand.
    function setTierCarryRecipient(uint256 tierId, address recipient) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        _requireTier(tierId);
        tierCarryRecipient[tierId] = recipient;
        emit CarryRecipientUpdated(tierId, recipient);
    }

    /// @notice brings a member's accrued carry onto the ledger.
    /// @dev Runs on every interaction, and is callable directly so a position that nobody has
    /// touched can still be brought current.
    /// @param member address of the member.
    function materialiseCarry(address member) public {
        _materialiseCarry(member);
    }

    /// @notice sets a member's ceiling contribution in a tier.
    /// @dev The operator sets this today. In the finished shape LimitCalculator does, by valuing
    /// what the member has pledged and applying the haircut for that collateral type.
    /// @param member address of the member.
    /// @param tierId index of the tier.
    /// @param capacity new ceiling contribution.
    function setTierCapacity(address member, uint256 tierId, uint256 capacity)
        public
        onlyCreditRole(CREDIT_LIMITS_ROLE)
    {
        _requireTier(tierId);
        uint256 drawn = drawnOf(member, tierId);
        if (capacity < drawn) {
            revert RevolvingIssuerCapacityBelowDrawn(tierId, capacity, drawn);
        }
        uint256 previous = tierCapacity[member][tierId];
        if (capacity > previous) {
            _consumeDailyCap(capacityIncreaseCap, "CAPACITY", capacity - previous);
        }
        tierCapacity[member][tierId] = capacity;
        _checkCreditCaps(member);
        emit TierCapacityUpdated(member, tierId, capacity);
        _syncLedgerLimit(member);
    }

    /// @notice opens a member's line with a starting ceiling in each tier.
    /// @param member address of the member.
    /// @param capacities ceiling contribution per tier, in tier order.
    /// @param periodLength length of the credit period.
    /// @param graceLength length of the grace period.
    function openLine(
        address member,
        uint256[] calldata capacities,
        uint256 periodLength,
        uint256 graceLength
    ) external onlyCreditRole(CREDIT_LINES_ROLE) notNull(member) notInActivePeriod(member) {
        // State gate (spec item 9): no line for a member with no attested state, or in a state
        // where the revolving product is not enabled.
        if (address(rateSchedule) != address(0)) {
            bytes32 state = _stateOf(member);
            if (state == bytes32(0) || !rateSchedule.isEnabled(state, ceilingProduct)) {
                revert RevolvingIssuerStateNotEnabled(member, state);
            }
        }
        uint256 total;
        uint256 increase;
        for (uint256 i = 0; i < capacities.length && i < tiers.length; i++) {
            uint256 previous = tierCapacity[member][i];
            if (capacities[i] > previous) increase += capacities[i] - previous;
            tierCapacity[member][i] = capacities[i];
            total += capacities[i];
            emit TierCapacityUpdated(member, i, capacities[i]);
        }
        _checkCreditCaps(member);
        // Opening a line is new credit like any other limit raised (audit H-4).
        _consumeDailyCap(capacityIncreaseCap, "CAPACITY", increase);
        stableCredit.createCreditLine(member, total, 0);
        // Zero means "this network's cycle", which is what every caller should want and what
        // nothing previously supplied -- the period was whatever the caller happened to pass, so
        // two members could be on different clocks with nothing saying so.
        //
        // Not forced to equal it. The rebalance period and the carry cycle are different
        // questions: one is how long a member has to return to zero, the other is how often carry
        // compounds. The plan makes them coincide at thirty days, and that is now the default
        // rather than a coincidence -- but a longer period is a policy choice, not a bug, and
        // refusing it would mean a member carrying a balance across cycles could never be modelled
        // at all.
        uint256 period = periodLength == 0 ? cycleLength() : periodLength;
        _updateCreditPeriod(member, block.timestamp + period, graceLength);
    }

    /* ========== CARD SETTLEMENT ========== */

    /// @notice what a settled card purchase put on a member's line.
    /// @param ref the card issuer's transaction reference, hashed.
    function cardSettlementOf(bytes32 ref) external view returns (address member, uint256 amount) {
        CardSettlement memory settlement = cardSettlements[ref];
        return (settlement.member, settlement.amount);
    }

    /// @notice allows or revokes a key that records card purchases as settled.
    function setCardSettler(address settler, bool allowed) external onlyCreditRole(CREDIT_SETTINGS_ROLE) notNull(settler) {
        isCardSettler[settler] = allowed;
        emit CardSettlerUpdated(settler, allowed);
    }

    /// @notice sets the account a settled card purchase's claim is minted to.
    function setCardSettlementAccount(address account) external onlyCreditRole(CREDIT_SETTINGS_ROLE) notNull(account) {
        cardSettlementAccount = account;
        emit CardSettlementAccountUpdated(account);
    }



    /// @notice what an authorization recorded for a ref still allows.
    function cardAuthorizationOf(bytes32 ref) external view returns (address member, uint256 amount) {
        CardAuthorization memory authorization = cardAuthorizations[ref];
        return (authorization.member, authorization.amount);
    }

    /// @notice caps on card settlement: per purchase and per day, across every member.
    function setCardCaps(uint256 txCap, uint256 dailyCap)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        cardTxCap = txCap;
        cardSpendCap.cap = dailyCap;
        emit CardCapsUpdated(txCap, dailyCap);
    }

    /// @notice names the RateSchedule unsecured tiers are priced from, and the product whose
    /// graduated schedule is the member-level ceiling.
    function setPricing(address rateSchedule_, bytes32 ceilingProduct_)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        rateSchedule = RateSchedule(rateSchedule_);
        ceilingProduct = ceilingProduct_;
        emit PricingUpdated(rateSchedule_, ceilingProduct_);
    }

    /// @notice prices an unsecured tier as a RateSchedule product. Set once: positions snapshot the
    /// product's accumulator, and switching product under them would compare unrelated numbers.
    function setTierProduct(uint256 tierId, bytes32 productId)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        _requireTier(tierId);
        if (tierProduct[tierId] != bytes32(0)) revert RevolvingIssuerTierProductSet(tierId);
        tierProduct[tierId] = productId;
        emit TierProductSet(tierId, productId);
    }

    /// @notice caps how much new revolving capacity may be granted in a day, across every member.
    function setDailyCapacityCap(uint256 cap) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        capacityIncreaseCap.cap = cap;
        emit DailyCapUpdated("CAPACITY", cap);
    }


    /// @notice what a fiat repayment ref cleared, zero if it has not been recorded.
    function cardRepaymentOf(bytes32 ref) external view returns (uint256) {
        return cardRepayments[ref];
    }


    /// @notice the member turns automatic repayment from their USDC deposits on or off.
    /// @dev Only for the caller. Turning it on is the whole mandate; the member also approves the
    /// ledger to take their USDC, and revoking either stops it.
    function setAutoRepay(bool enabled) external {
        autoRepayEnabled[_msgSender()] = enabled;
        emit AutoRepaySet(_msgSender(), enabled);
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
            extension.delegatecall(abi.encodeWithSignature("judgeCycle(address)", member));
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

    /// @notice in default: two consecutive missed rebalances, still not rebalanced, and the cure
    /// window after the chain-dated notice has passed (section 12.5). Computed; no role sets it.
    function inDefault(address member) public view override returns (bool) {
        CycleRecord memory c = cycleOf[member];
        if (c.missedInRow < 2 || c.cureNoticeAt == 0) return false;
        return super.inDefault(member) && block.timestamp >= c.cureNoticeAt + creditTerms.cureWindow;
    }

    /// @notice a rolled-over revolving period runs one network cycle.
    function _rolloverLength(address member) internal view override returns (uint256) {
        uint256 cycle = cycleLength();
        return cycle == 0 ? super._rolloverLength(member) : cycle;
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
        for (uint256 i = tiers.length; i > 0 && remaining > 0; i--) {
            uint256 tierId = i - 1;
            if (tiers[tierId].index.ratePerCycle < minRate) continue;
            uint256 principal = tierPrincipal[member][tierId];
            if (principal == 0) continue;

            uint256 pay = principal < remaining ? principal : remaining;
            _repayTier(member, tierId, pay);
            remaining -= pay;
            absorbed += pay;
        }
    }

    /// @inheritdoc ICreditIssuer
    function nextRepaymentRate(address member)
        external
        view
        override
        returns (uint256 rate, bool hasPosition)
    {
        for (uint256 i = tiers.length; i > 0; i--) {
            uint256 tierId = i - 1;
            if (tierPrincipal[member][tierId] == 0) continue;
            // Tiers ascend by rate, so the first one found walking back is the dearest.
            return (tiers[tierId].index.ratePerCycle, true);
        }
        return (0, false);
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
    /// @dev The ceiling goes; the positions do not. A defaulted member with collateral still owes
    /// the part it covers, and that debt is what liquidation settles against the pledge. Clearing
    /// it here would hand them their collateral back.
    function _onDefault(address member) internal override {
        for (uint256 i = 0; i < tiers.length; i++) {
            tierCapacity[member][i] = 0;
        }
        super._onDefault(member);
    }

    /// @notice sets the contract reporting what a member's collateral does not cover.
    function setExposureSource(address _exposureSource) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        exposureSource = IExposureSource(_exposureSource);
    }


    /// @notice writes this issuer's contribution to the member's ledger ceiling.
    function _syncLedgerLimit(address member) private {
        stableCredit.updateCreditLimit(member, totalCapacityOf(member));
    }

    /* ========== FORWARDED TO THE EXTENSION ========== */

    /// @notice Where the forwarded functions below actually run.
    /// @dev Created by this implementation's constructor and fixed with it: upgrading RevolvingIssuer
    /// deploys a fresh pair, and nobody can point a live contract at other code. Not storage, so
    /// the layout is untouched.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable extension;

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

    /// @notice see RevolvingIssuerExtension.repayForMember.
    function repayForMember(bytes32, address, uint256) external {
        _forward();
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

    /// @notice see RevolvingIssuerExtension: section 12 settings and the member's own switches.
    function setCreditTerms(CreditTerms calldata, uint128, uint128) external {
        _forward();
    }

    function setDepositSource(address) external {
        _forward();
    }

    function setAutoClear(bool, uint8) external {
        _forward();
    }

    function setAutoClearWithSignature(address, bool, uint8, uint256, bytes calldata) external {
        _forward();
    }

    function setSavingsDrawAllowance(uint256) external {
        _forward();
    }

    function setSavingsDrawAllowanceWithSignature(address, uint256, uint256, bytes calldata) external {
        _forward();
    }

    /// @dev Runs the extension's implementation of this call against this contract's storage, and
    /// returns or reverts exactly as it did.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _forward() private {
        address target = extension;
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
