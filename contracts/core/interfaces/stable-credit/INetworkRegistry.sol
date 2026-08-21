// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title INetworkRegistry
/// @notice Resolves which issuers a member holds positions with, and what each issuer is wired to.
/// @dev The extension point for issuers. A member has a *set* of them from day one -- the
/// revolving line and term plans are separate rule sets, and a PartnerIssuer or an issuer run by
/// another institution registers here rather than being special-cased. No caller may assume a
/// member has exactly one.
///
/// A second issuer is not a second reserve. Every issuer registered against one network writes to
/// the same StableCredit and draws on the same AssurancePool; the reserve-splitting objection
/// applies to a second network, not to a second issuer inside one.
interface INetworkRegistry {
    /// @notice What an issuer is wired to.
    struct Network {
        address stableCredit;
        address assurancePool;
        address assuranceOracle;
    }

    /// @notice the network an issuer belongs to.
    function networkOf(address issuer) external view returns (Network memory);

    /// @notice whether an issuer is registered.
    function isIssuer(address issuer) external view returns (bool);

    /// @notice whether an issuer is registered against a given stable credit.
    /// @dev The check StableCredit uses to decide whether to accept a caller as an issuer.
    function isIssuerOf(address issuer, address stableCredit) external view returns (bool);

    /// @notice every issuer a member holds a position with.
    function issuersOf(address member) external view returns (address[] memory);

    /// @notice whether a member is enrolled with a given issuer.
    function isEnrolled(address member, address issuer) external view returns (bool);

    /// @notice records that a member holds a position with an issuer.
    /// @dev Callable by the issuer, by the ledger that issuer writes to, or by an operator.
    /// Enrolment is recorded by whoever observes the relationship starting, which is usually the
    /// ledger opening the credit line rather than a separate operator transaction.
    function enrolMember(address member, address issuer) external;

    /// @notice removes a member from an issuer.
    function withdrawMember(address member, address issuer) external;

    /* ========== EVENTS ========== */

    event IssuerRegistered(
        address indexed issuer,
        address indexed stableCredit,
        address assurancePool,
        address assuranceOracle
    );
    event IssuerDeregistered(address indexed issuer);
    event MemberEnrolled(address indexed member, address indexed issuer);
    event MemberWithdrawn(address indexed member, address indexed issuer);
}
