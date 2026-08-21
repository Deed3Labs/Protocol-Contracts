// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./CreditIssuer.sol";
import "../libraries/CarryIndex.sol";
import "../libraries/ExposureMath.sol";

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
contract RevolvingIssuer is CreditIssuer {
    using CarryIndex for CarryIndex.Index;

    /* ========== STATE VARIABLES ========== */

    struct TierConfig {
        bytes32 kind;
        CarryIndex.Index index;
        bool active;
    }

    /// @dev Ordered cheapest first. Position in this array is the draw order.
    TierConfig[] private tiers;

    /// @dev member => tier => ceiling contribution
    mapping(address => mapping(uint256 => uint256)) private tierCapacity;
    /// @dev member => tier => index-relative amount owed
    mapping(address => mapping(uint256 => uint256)) private tierNormalized;
    /// @dev member => tier => principal drawn, carry excluded
    mapping(address => mapping(uint256 => uint256)) private tierPrincipal;

    uint256[44] private __gap;

    /* ========== ERRORS ========== */

    error RevolvingIssuerRatesMustAscend(uint256 previous, uint256 proposed);
    error RevolvingIssuerUnknownTier(uint256 tierId);
    error RevolvingIssuerCapacityBelowDrawn(uint256 tierId, uint256 capacity, uint256 drawn);

    /* ========== EVENTS ========== */

    event TierAdded(uint256 indexed tierId, bytes32 kind, uint256 ratePerCycle);
    event TierRateUpdated(uint256 indexed tierId, uint256 ratePerCycle);
    event TierCapacityUpdated(address indexed member, uint256 indexed tierId, uint256 capacity);
    event TierDrawn(address indexed member, uint256 indexed tierId, uint256 amount);
    event TierRepaid(address indexed member, uint256 indexed tierId, uint256 amount);

    /* ========== INITIALIZER ========== */

    function initialize(address _stableCredit) external initializer {
        __CreditIssuer_init(_stableCredit);
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

    /// @notice the ceiling contribution a member has in a tier.
    function capacityOf(address member, uint256 tierId) public view returns (uint256) {
        return tierCapacity[member][tierId];
    }

    /// @notice what a member owes in a tier, carry included.
    /// @dev Derived on read from the tier's index and the member's checkpoint. No accrued figure
    /// is stored against the member anywhere.
    function drawnOf(address member, uint256 tierId) public view returns (uint256) {
        _requireTier(tierId);
        return CarryIndex.denormalize(
            tierNormalized[member][tierId], tiers[tierId].index.currentIndex(block.timestamp)
        );
    }

    /// @notice the principal a member has drawn in a tier, carry excluded.
    /// @dev This is the figure that reconciles with the ledger's credit balance.
    function principalOf(address member, uint256 tierId) external view returns (uint256) {
        return tierPrincipal[member][tierId];
    }

    /// @notice the carry accrued on a member's position in a tier.
    function carryOf(address member, uint256 tierId) external view returns (uint256) {
        _requireTier(tierId);
        return CarryIndex.accruedCarry(
            tierNormalized[member][tierId],
            tiers[tierId].index.currentIndex(block.timestamp),
            tierPrincipal[member][tierId]
        );
    }

    /// @notice how much more a member may draw in a tier.
    /// @dev Carry consumes headroom as it accrues, because the ceiling bounds what is owed rather
    /// than what was spent.
    function headroomOf(address member, uint256 tierId) public view returns (uint256) {
        uint256 capacity = tierCapacity[member][tierId];
        uint256 drawn = drawnOf(member, tierId);
        return capacity > drawn ? capacity - drawn : 0;
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
        for (uint256 i = 0; i < tiers.length; i++) {
            total += drawnOf(member, i);
        }
    }

    /// @notice a member's total principal across every tier, carry excluded.
    /// @dev This is the figure that reconciles with the ledger. StableCredit's credit balance
    /// moves only when credit moves, so it carries principal; the carry above it is derived here
    /// and is not yet materialised onto the ledger. `totalDrawnOf` minus this is what the member
    /// owes beyond what they spent.
    function totalPrincipalOf(address member) public view returns (uint256 total) {
        for (uint256 i = 0; i < tiers.length; i++) {
            total += tierPrincipal[member][i];
        }
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /// @notice adds a tier at the end of the draw order.
    /// @dev Rates must ascend. Yield-bearing collateral has to cost more than it yields, and a
    /// tier that is cheaper than the one before it would be drawn last while costing least --
    /// the waterfall would have to be enforced separately instead of falling out of the order.
    /// @param kind tier kind, from ExposureMath.
    /// @param ratePerCycle carry rate per cycle in basis points.
    /// @param cycleLength seconds in a cycle.
    function addTier(bytes32 kind, uint256 ratePerCycle, uint64 cycleLength)
        external
        onlyOperator
        returns (uint256 tierId)
    {
        if (tiers.length > 0) {
            uint256 previous = tiers[tiers.length - 1].index.ratePerCycle;
            if (ratePerCycle < previous) {
                revert RevolvingIssuerRatesMustAscend(previous, ratePerCycle);
            }
        }
        tierId = tiers.length;
        tiers.push();
        TierConfig storage tier = tiers[tierId];
        tier.kind = kind;
        tier.active = true;
        tier.index.init(ratePerCycle, cycleLength, uint64(block.timestamp));
        emit TierAdded(tierId, kind, ratePerCycle);
    }

    /// @notice changes a tier's rate from now on.
    /// @dev Checkpoints the index, so the new rate never reaches carry already accrued at the old
    /// one. The ascending order still has to hold afterwards, in both directions.
    function setTierRate(uint256 tierId, uint256 ratePerCycle) external onlyOperator {
        _requireTier(tierId);
        if (tierId > 0) {
            uint256 previous = tiers[tierId - 1].index.ratePerCycle;
            if (ratePerCycle < previous) {
                revert RevolvingIssuerRatesMustAscend(previous, ratePerCycle);
            }
        }
        if (tierId + 1 < tiers.length) {
            uint256 next = tiers[tierId + 1].index.ratePerCycle;
            if (ratePerCycle > next) revert RevolvingIssuerRatesMustAscend(ratePerCycle, next);
        }
        tiers[tierId].index.setRate(ratePerCycle, block.timestamp);
        emit TierRateUpdated(tierId, ratePerCycle);
    }

    /// @notice opens or closes a tier to new draws.
    /// @dev Closing does not call in what is drawn. Existing positions keep accruing and can be
    /// repaid; they simply cannot grow.
    function setTierActive(uint256 tierId, bool active) external onlyOperator {
        _requireTier(tierId);
        tiers[tierId].active = active;
    }

    /// @notice sets a member's ceiling contribution in a tier.
    /// @dev The operator sets this today. In the finished shape LimitCalculator does, by valuing
    /// what the member has pledged and applying the haircut for that collateral type.
    /// @param member address of the member.
    /// @param tierId index of the tier.
    /// @param capacity new ceiling contribution.
    function setTierCapacity(address member, uint256 tierId, uint256 capacity)
        public
        onlyOperator
    {
        _requireTier(tierId);
        uint256 drawn = drawnOf(member, tierId);
        if (capacity < drawn) {
            revert RevolvingIssuerCapacityBelowDrawn(tierId, capacity, drawn);
        }
        tierCapacity[member][tierId] = capacity;
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
    ) external onlyOperator notNull(member) notInActivePeriod(member) {
        uint256 total;
        for (uint256 i = 0; i < capacities.length && i < tiers.length; i++) {
            tierCapacity[member][i] = capacities[i];
            total += capacities[i];
            emit TierCapacityUpdated(member, i, capacities[i]);
        }
        stableCredit.createCreditLine(member, total, 0);
        _updateCreditPeriod(member, block.timestamp + periodLength, graceLength);
    }

    /* ========== INTERNAL ========== */

    /// @notice records what a credit movement did to this member's tiers.
    /// @dev Runs on the mint path rather than a separate reporting call, because the shortfall
    /// about to be minted is exactly what has to be placed in a tier, and the recipient's
    /// repayment is exactly what has to be taken out of one.
    function _syncCreditPositions(address sender, address recipient, uint256 amount)
        internal
        override
    {
        if (amount == 0) return;

        // The sender covers what their balance cannot, and that shortfall is what gets minted.
        uint256 balance = stableCredit.balanceOf(sender);
        if (balance < amount && totalCapacityOf(sender) > 0) {
            _draw(sender, amount - balance);
        }

        // Credit arriving at a member carrying debt burns against it.
        if (recipient != address(0)) {
            uint256 owed = stableCredit.creditBalanceOf(recipient);
            if (owed > 0) _repay(recipient, owed < amount ? owed : amount);
        }
    }

    /// @notice fills tiers in order, cheapest first.
    function _draw(address member, uint256 amount) private {
        uint256 remaining = amount;
        for (uint256 i = 0; i < tiers.length && remaining > 0; i++) {
            if (!tiers[i].active) continue;
            uint256 headroom = headroomOf(member, i);
            if (headroom == 0) continue;

            uint256 take = headroom < remaining ? headroom : remaining;
            uint256 index = tiers[i].index.currentIndex(block.timestamp);
            tierNormalized[member][i] += CarryIndex.normalizeUp(take, index);
            tierPrincipal[member][i] += take;
            remaining -= take;
            emit TierDrawn(member, i, take);
        }
        // Anything left over means the ledger allowed a draw this issuer has no room for. The
        // ledger's ceiling is the sum of these capacities, so that cannot happen without the two
        // having already disagreed.
    }

    /// @notice clears tiers in reverse order, most expensive first.
    /// @dev Allocated against principal rather than against what is owed, because a repayment
    /// arriving through the ledger can only be repaying principal: the ledger's credit balance
    /// moves when credit moves, and accrued carry has never moved anywhere. Settling carry ahead
    /// of principal is the intended rule and becomes possible once carry is materialised onto the
    /// ledger -- until then it would leave the tiers claiming a member owes principal the ledger
    /// says they have already cleared.
    ///
    /// The carry share of a position is deliberately left in place. A member who repays every
    /// penny of principal still owes what the position accrued, and `carryOf` keeps reading it.
    function _repay(address member, uint256 amount) private {
        uint256 remaining = amount;
        for (uint256 i = tiers.length; i > 0 && remaining > 0; i--) {
            uint256 tierId = i - 1;
            uint256 principal = tierPrincipal[member][tierId];
            if (principal == 0) continue;

            uint256 pay = principal < remaining ? principal : remaining;
            uint256 index = tiers[tierId].index.currentIndex(block.timestamp);
            uint256 stored = tierNormalized[member][tierId];

            // Rounded up, mirroring the draw. Rounding down leaves a few wei of position behind
            // after a payment that settled it, and that residue goes on accruing.
            uint256 reduction = CarryIndex.normalizeUp(pay, index);
            tierNormalized[member][tierId] = reduction >= stored ? 0 : stored - reduction;
            tierPrincipal[member][tierId] = principal - pay;

            remaining -= pay;
            emit TierRepaid(member, tierId, pay);
        }
    }

    /// @notice this issuer's share of a member's debt.
    /// @dev Only what sits in these tiers. A member who also holds term plans has debt this
    /// issuer does not own and must not write off.
    function _writeOffAmount(address member) internal view override returns (uint256) {
        return totalDrawnOf(member);
    }

    /// @notice clears the member's tier positions and ceiling on default.
    function _onDefault(address member) internal override {
        for (uint256 i = 0; i < tiers.length; i++) {
            tierNormalized[member][i] = 0;
            tierPrincipal[member][i] = 0;
            tierCapacity[member][i] = 0;
        }
        super._onDefault(member);
    }

    /// @notice writes this issuer's contribution to the member's ledger ceiling.
    function _syncLedgerLimit(address member) private {
        stableCredit.updateCreditLimit(member, totalCapacityOf(member));
    }

    function _requireTier(uint256 tierId) private view {
        if (tierId >= tiers.length) revert RevolvingIssuerUnknownTier(tierId);
    }
}
