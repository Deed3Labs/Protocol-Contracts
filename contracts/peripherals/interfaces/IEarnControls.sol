// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./IPoolEarnControls.sol";

/// @title IEarnControls
/// @notice The shared Earn controls (decision 1) as the bond collections, the BondVault and the
/// Collateral Agent read them. The Yield Pool reads only `IPoolEarnControls`.
/// @dev Stage 2 wires the bond side: `checkPurchase` in the purchase path, `rollAllowed`,
/// `holderIneligible` and the Ladder in the roll path, `transferAllowed` in the token hook, and
/// `payeeOf` wherever a Holder is paid.
interface IEarnControls is IPoolEarnControls {
    /// @notice Checks a BurnerBond purchase and books its Purchase Price against the offering cap.
    /// @dev Reverts while purchases are paused (`purchasesPaused`), for a refused or ineligible
    /// payer, a holder who is not the payer's own Holder, a Purchase Price under $250 (FIXED), a
    /// term not offered, or a purchase that would exceed the Funding Limit or the offering cap.
    /// Only a registered bond collection (`BOND_ROLE`) may call it. Rolls do not call it.
    /// @return exemptionCode the offering exemption tag from the payer's eligibility attestation.
    function checkPurchase(
        address payer,
        address holder,
        uint256 purchasePrice,
        uint256 maturityAmount,
        uint32 termDays,
        bytes calldata attestation
    ) external returns (bytes32 exemptionCode);

    /// @notice Whether new BurnerBond purchases are paused: the Equity Cushion pause, a Reserve
    /// Shortfall (the two-person flag or the BondVault's own), or an Enforcement Notice in
    /// effect (§1).
    function purchasesPaused() external view returns (bool);

    /// @notice Whether a roll may execute now: false only while an Enforcement Notice is in effect
    /// (IV-10 §7.2, decision 19). Reserve Shortfalls and the Equity Cushion pause never stop a roll.
    function rollAllowed() external view returns (bool);

    /// @notice The holder-ineligible flag (§2): a bond of a flagged Holder does not roll.
    function holderIneligible(address holder) external view returns (bool);

    /// @notice Whether `termDays` is on the Ladder and offered.
    function isTermOffered(uint32 termDays) external view returns (bool);

    /// @notice The Ladder yield for `termDays`, in basis points, annual compounding.
    function ladderYieldBps(uint32 termDays) external view returns (uint32);

    /// @notice The term a bond of `termDays` rolls into (IV-01 §5.2): the same term if offered,
    /// else the nearest shorter offered term; 0 if none.
    function rollTermFor(uint32 termDays) external view returns (uint32);

    /// @notice The yield of a roll into `rollTerm` noticed at `noticeYieldBps`: the Roll Notice
    /// yield or the Ladder yield for that term, whichever is higher.
    function rollYieldFor(uint32 rollTerm, uint32 noticeYieldBps) external view returns (uint32);

    /// @notice The Ladder term as it stood at time `at` (decision 31). A Ladder change never alters
    /// a quote or roll notice already given: the bond captures the term and yield when it quotes or
    /// posts the notice (decision 11), and can check a purchase against the rate at quote time here.
    function rungAt(uint32 termDays, uint64 at) external view returns (uint32 yieldBps, bool offered);

    /// @notice Where a payment to `holder` goes: a Successor registered for payment under
    /// IV-01 §6.3 (two-person, evidence hash, 7-day delay), otherwise `holder` itself.
    function payeeOf(address holder) external view returns (address);

    /// @notice The exemption code of `account`'s eligibility attestation while one is in force, else
    /// zero. A confirmed roll executes only while it is set (decision 44).
    function eligibleCode(address account) external view returns (bytes32);

    /// @notice Whether two accounts are Smart Accounts registered to the same Holder.
    function sameHolder(address a, address b) external view returns (bool);

    /// @notice Takes a bond's Purchase Price off its Holder's Earn Products at purchase price
    /// (IV-02 §2.5(b)) when the bond leaves: settlement, `payPledged`, buyback, `redeemAll` or a
    /// distribution that pays it in full. A roll does not call it. Only `BOND_ROLE`.
    function recordBondExit(address holder, uint256 purchasePrice) external;
}

/// @dev The Yield Pool's low-Utilization clock (IV-02 §2.6). The pool adds it in its next pass:
/// the time Utilization last fell below 50% and has stayed below since, or 0 while it is at or
/// above 50%.
interface IPoolUtilizationClock {
    function lowUtilizationSince() external view returns (uint64);
}

/// @dev A source of outstanding BurnerBond Maturity Amounts for the Funding Limit: the BondVault
/// (`totalFaceOutstanding`, Maturity Amounts still owed), one per collection's vault.
interface IEarnBondBook {
    function totalFaceOutstanding() external view returns (uint256);
}

/// @dev The BondVault's Reserve Shortfall state (§2). Stage 2 adds it to the BondVault.
interface IEarnReserveStatus {
    function inReserveShortfall() external view returns (bool);
}

/// @dev The Collateral Agent's Enforcement Notice state (IV-10 Exhibit A, Part 2 items 1-2).
interface IEarnEnforcementStatus {
    function enforcementInForce() external view returns (bool);
}

/// @dev Told in the same transaction when a change moves the BondVault's 90-day 100% reserve: a
/// Holder flagged ineligible, or a term withdrawn from the Ladder (§2, R2). Stage 2's BondVault.
interface IEarnControlsHook {
    function holderEligibilityChanged(address holder, bool ineligible) external;
    function termOfferChanged(uint32 termDays, bool offered) external;
}

/// @dev What the controls read from the Yield Pool (LendingPool) for the Funding Limit and the
/// holder cap.
interface IEarnPoolView {
    function totalSupply() external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function shareValue() external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function queuedSharesOf(address account) external view returns (uint256);
}

/// @dev The MembershipRegistry reads behind "the same Holder" and the member's wallets.
interface IEarnMembership {
    function walletToMemberId(address wallet) external view returns (uint256);
    function getLinkedWallets(uint256 memberId) external view returns (address[] memory);
}
