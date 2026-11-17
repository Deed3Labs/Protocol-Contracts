// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockSecuredTermPlans
/// @notice Test-only stand-in for a term issuer's plans secured under MB-05 (12.14), with the views
/// the pledge module reads (Phase 2f, decisions 9, 10 and 22): which plans are open, their 12.14
/// record (the cure notice's past-due amount and the recorded default), what each has repaid and
/// owes, and when its schedule ends. `payPlan` takes the reserve token from the caller, as the real
/// issuer does through the ledger. It has no tiers (no `tierCount`), like the real term issuer.
/// Never deploy this.
contract MockSecuredTermPlans {
    IERC20 public immutable reserve;

    struct Plan {
        address member;
        uint64 noticeAt;
        uint64 defaultedAt;
        uint128 noticeDue;
        uint256 repaid;
        uint256 owed;
        uint64 start;
        uint32 installments;
        uint64 length;
    }

    mapping(uint256 => Plan) public plans;
    mapping(address => uint256[]) private _open;

    constructor(address reserve_) {
        reserve = IERC20(reserve_);
    }

    /// @dev A secured plan of `member` owing `owed`, whose schedule runs `installments` x `length`
    /// from `start`. Ids are the caller's; the open list keeps the order they are added in.
    function addPlan(uint256 id, address member, uint256 owed, uint64 start, uint32 installments, uint64 length) external {
        plans[id] = Plan(member, 0, 0, 0, 0, owed, start, installments, length);
        _open[member].push(id);
    }

    /// @dev The 12.14 record: a cure notice for `noticeDue` (the schedule's ask by the notice), then
    /// the recorded default.
    function recordDefault(uint256 id, uint128 noticeDue) external {
        plans[id].noticeAt = uint64(block.timestamp);
        plans[id].noticeDue = noticeDue;
        plans[id].defaultedAt = uint64(block.timestamp);
    }

    function recordNotice(uint256 id, uint128 noticeDue) external {
        plans[id].noticeAt = uint64(block.timestamp);
        plans[id].noticeDue = noticeDue;
    }

    /// @dev The member's own payment.
    function memberPays(uint256 id, uint256 amount) external {
        Plan storage p = plans[id];
        p.repaid += amount;
        p.owed -= amount;
    }

    function openPlansOf(address member) external view returns (uint256[] memory) {
        return _open[member];
    }

    function securedPlans(uint256 id) external view returns (bool, address, uint64, uint64, uint128, uint256) {
        Plan storage p = plans[id];
        return (true, address(0), p.noticeAt, p.defaultedAt, p.noticeDue, 0);
    }

    function planAt(uint256 id)
        external
        view
        returns (address, uint256, uint256, uint256, uint64, uint32, uint64, uint256, bool)
    {
        Plan storage p = plans[id];
        return (p.member, 0, p.owed, p.repaid, p.start, p.installments, p.length, 0, p.owed == 0);
    }

    function scheduleOf(uint256 id) external view returns (uint256, uint256, uint32, uint64) {
        Plan storage p = plans[id];
        return (0, 0, p.installments, p.start);
    }

    function owedOn(uint256 id) external view returns (uint256) {
        return plans[id].owed;
    }

    function payPlan(uint256 id, uint256 amount) external {
        Plan storage p = plans[id];
        uint256 pay = amount < p.owed ? amount : p.owed;
        require(reserve.transferFrom(msg.sender, address(this), pay), "pull");
        p.repaid += pay;
        p.owed -= pay;
    }

    /// @dev What the CollateralRegistry reads from every issuer: a term issuer has no tiers.
    function debtByKind(address) external pure returns (bytes32[] memory kinds, uint256[] memory amounts) {
        return (kinds, amounts);
    }
}
