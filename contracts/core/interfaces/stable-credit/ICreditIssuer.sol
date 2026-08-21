// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

interface ICreditIssuer {
    struct CreditPeriod {
        uint256 issuedAt;
        uint256 expiration;
        uint256 graceLength;
        bool paused;
    }

    /// @notice called by the StableCredit contract when members transfer credits.
    /// @param sender address of stable credit transaction.
    /// @param recipient recipient address of stable credit transaction.
    /// @param amount of credits in transaction.
    /// @return transaction validation result.
    function validateCreditTransaction(address sender, address recipient, uint256 amount)
        external
        returns (bool);

    /// @notice Offers an issuer a share of a repayment, and asks how much it took.
    /// @dev The ledger holds one signed number per member, and with more than one issuer that
    /// number is jointly owned. A payment cannot simply be announced to each of them: they would
    /// each record the whole of it. So the ledger hands out a budget and each issuer answers with
    /// what it actually absorbed, bounded by its own positions and by what is left.
    ///
    /// `minRate` is what makes the waterfall run across issuers rather than within each. The
    /// ledger works down the rate bands, and an issuer takes only what it holds at or above the
    /// band being cleared.
    /// @param member address whose obligation was reduced.
    /// @param available amount still unattributed.
    /// @param minRate lowest per-cycle rate, in basis points, eligible in this pass.
    /// @return absorbed amount this issuer took, never more than `available`.
    function absorbRepayment(address member, uint256 available, uint256 minRate)
        external
        returns (uint256 absorbed);

    /// @notice whether a member has defaulted with this issuer.
    /// @dev Read by the liquidation path, so a default is checked against the issuer holding the
    /// position rather than taken on the caller's word.
    /// @param member address of the member.
    /// @return whether the member is in default.
    function inDefault(address member) external view returns (bool);

    /// @notice whether a member's credit line ended in default.
    /// @dev Outlives the credit period, which expiry deletes.
    function hasDefaulted(address member) external view returns (bool);

    /// @notice The dearest open position this issuer holds for a member.
    /// @dev How the ledger finds the top of the waterfall without knowing what any issuer holds.
    /// @param member address of the member.
    /// @return rate per-cycle rate of the dearest position, in basis points.
    /// @return hasPosition false when this issuer holds nothing for the member, which a rate of
    /// zero cannot express -- savings-backed credit is a real position at zero bps.
    function nextRepaymentRate(address member)
        external
        view
        returns (uint256 rate, bool hasPosition);

    /// @notice Tells an issuer about a credit movement it was not asked to approve.
    /// @dev Opening a line, recognising a write-off and settling a repayment all move credit
    /// without asking permission, because none of them is a member spending. An issuer that
    /// tracks what its member's balance is made of still has to see them, or its composition
    /// drifts from the balance it is meant to describe.
    /// @param sender address credit moved from.
    /// @param recipient address credit moved to.
    /// @param amount amount moved.
    function syncCreditPositions(address sender, address recipient, uint256 amount) external;

    /// @notice called by network authorized to issue credit.
    /// @dev intended to be overwritten in parent implementation to include custom underwriting logic.
    /// @param member address of member.
    function underwriteMember(address member) external;

    /// @notice returns whether a given member is in compliance with credit terms.
    /// @dev intended to be overwritten in parent implementation to include custom compliance logic.
    /// @param member address of member.
    /// @return whether member is in compliance with credit terms.
    function inCompliance(address member) external view returns (bool);

    /* ========== EVENTS ========== */

    event CreditTermsPaused(address member);
    event CreditTermsUnpaused(address member);
    event CreditLineDefaulted(address member);
    event CreditPeriodExpired(address member);
    event CreditPeriodCreated(address member, uint256 periodExpiration, uint256 graceLength);
    event GraceLengthUpdated(address member, uint256 graceLength);
}