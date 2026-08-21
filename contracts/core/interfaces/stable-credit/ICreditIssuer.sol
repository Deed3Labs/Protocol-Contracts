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
    /// @param member address whose obligation was reduced.
    /// @param available amount still unattributed.
    /// @return absorbed amount this issuer took, never more than `available`.
    function absorbRepayment(address member, uint256 available) external returns (uint256 absorbed);

    /// @notice Where this issuer sits in the order repayments are offered around.
    /// @dev Lower goes first. An undirected payment says only "reduce what this member owes", and
    /// the revolving line is the demand obligation, so it is offered first; term plans amortize on
    /// a schedule and are normally serviced by name.
    function repaymentPriority() external view returns (uint256);

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