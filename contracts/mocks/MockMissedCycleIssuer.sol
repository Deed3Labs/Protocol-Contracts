// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockMissedCycleIssuer
/// @notice Test-only stand-in for a revolving issuer after a missed cycle (spec 12.5, 12.8).
/// @dev Lets the Liquidator's section 12 paths be tested without the RevolvingIssuer change that
/// computes `unsecuredExcessOf` and `missedInRowOf` (Phase 2b, parent branch). Tiers, principal,
/// the excess and default are set directly. `settleFromCollateral` takes the reserve token and
/// lowers principal the way the real issuer does, and lowers the excess with any unsecured
/// settlement, as halving-then-repaying does on the real one. Never deploy this.
contract MockMissedCycleIssuer {
    IERC20 public immutable reserve;
    bytes32[] private kinds;

    mapping(address => mapping(uint256 => uint256)) public principalOf;
    mapping(address => uint256) public unsecuredExcessOf;
    mapping(address => uint8) public missedInRowOf;
    mapping(address => bool) public inDefault;
    /// @dev Phase 2f (decision 22): what the real issuer's `cycleStateOf` records about a default:
    /// the second Rebalance Amount still unpaid (lowered by a payment, not by a settlement out of
    /// collateral), what the judged cycle still lacks (lowered by both), and the cure's due point.
    mapping(address => uint256) public cureAmountOf;
    mapping(address => uint256) public securedPastDueOf;
    mapping(address => uint256) public pastDueSMOf;
    mapping(address => uint64) public cureDueAtOf;
    /// @dev The cure-notice timestamp, as the real issuer's `cycleOf` reports it.
    mapping(address => uint64) public cureNoticeAtOf;

    constructor(address reserve_, bytes32[] memory kinds_) {
        reserve = IERC20(reserve_);
        kinds = kinds_;
    }

    function tierCount() external view returns (uint256) {
        return kinds.length;
    }

    function tierAt(uint256 tierId) external view returns (bytes32 kind, uint256 ratePerCycle, bool active) {
        return (kinds[tierId], 0, true);
    }

    function hasDefaulted(address) external pure returns (bool) {
        return false;
    }

    /// @dev What the Liquidator reads since Phase 4b (M-C).
    function hasDefaultedOnCurrentLine(address) external pure returns (bool) {
        return false;
    }

    function setPrincipal(address member, uint256 tierId, uint256 amount) external {
        principalOf[member][tierId] = amount;
    }

    function setMissedCycle(address member, uint8 missedInRow, uint256 excess) external {
        missedInRowOf[member] = missedInRow;
        unsecuredExcessOf[member] = excess;
    }

    function setInDefault(address member, bool value) external {
        inDefault[member] = value;
    }

    /// @dev Records a default's figures as the real issuer would at the judged close (decision 22):
    /// a past-due Secured Minimum and an unpaid second Rebalance Amount, both unpaid, so what the
    /// judged cycle lacks is their sum.
    function setDefaulted(address member, uint256 pastDueSM, uint256 cureAmount, uint64 cureDueAt) external {
        pastDueSMOf[member] = pastDueSM;
        cureAmountOf[member] = cureAmount;
        securedPastDueOf[member] = pastDueSM + cureAmount;
        cureDueAtOf[member] = cureDueAt;
    }

    /// @dev A member's own payment: like the real issuer, it lowers what the cycle lacks and the
    /// cure amount (a settlement out of collateral lowers only the first).
    function notePayment(address member, uint256 pay) external {
        uint256 pastDue = securedPastDueOf[member];
        securedPastDueOf[member] = pastDue > pay ? pastDue - pay : 0;
        uint256 cure = cureAmountOf[member];
        cureAmountOf[member] = cure > pay ? cure - pay : 0;
    }

    function setCureNotice(address member, uint64 at) external {
        cureNoticeAtOf[member] = at;
    }

    /// @dev The prefix of the real CycleState the pledge module reads: words 10-13 are
    /// securedPastDue, pastDueSM, cureAmount and cureDueAt.
    function cycleStateOf(address member) external view returns (uint256[14] memory s) {
        s[10] = securedPastDueOf[member];
        s[11] = pastDueSMOf[member];
        s[12] = cureAmountOf[member];
        s[13] = cureDueAtOf[member];
    }

    /// @dev CycleRecord: missedInRow, cleanStreak, depositBits, cureNoticeAt, unsecuredCeiling.
    function cycleOf(address member) external view returns (uint8, uint8, uint8, uint64, uint128) {
        return (missedInRowOf[member], 0, 0, cureNoticeAtOf[member], 0);
    }

    /// @dev The shape the CollateralRegistry reads: one entry per tier with principal.
    function debtByKind(address member) external view returns (bytes32[] memory out, uint256[] memory amounts) {
        out = new bytes32[](kinds.length);
        amounts = new uint256[](kinds.length);
        for (uint256 i = 0; i < kinds.length; i++) {
            out[i] = kinds[i];
            amounts[i] = principalOf[member][i];
        }
    }

    function settleFromCollateral(address member, uint256 tierId, uint256 amount) external {
        uint256 principal = principalOf[member][tierId];
        uint256 pay = principal < amount ? principal : amount;
        if (pay == 0) return;
        require(reserve.transferFrom(msg.sender, address(this), pay), "pull");
        principalOf[member][tierId] = principal - pay;
        // As the real issuer: a settlement out of collateral lowers what the judged cycle lacks,
        // never the cure amount (it does not cure the default it enforces).
        uint256 pastDue = securedPastDueOf[member];
        securedPastDueOf[member] = pastDue > pay ? pastDue - pay : 0;
        if (kinds[tierId] == "INCOME" || kinds[tierId] == "BOOST") {
            uint256 excess = unsecuredExcessOf[member];
            unsecuredExcessOf[member] = excess > pay ? excess - pay : 0;
        }
    }
}
