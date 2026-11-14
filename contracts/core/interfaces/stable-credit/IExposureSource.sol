// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IExposureSource
/// @notice Reports the credit exposure collateral does not cover: what a default would actually
/// cost after savings and pledged assets are realized.
/// @dev Section 13: the co-op's AssurancePool reads this as the covered book behind its Credit
/// Backstop floor (`coveredBookPrincipal`). It is neither total credit outstanding nor every
/// unsecured line. A savings-backed position contributes nothing, because the collateral is
/// already inside the network and seizable at par; income-backed, Clear Boost and term-plan debt
/// contribute in full; asset-backed collateral contributes the shortfall left after its haircut.
/// See ExposureMath for the per-position rule.
///
/// The CollateralRegistry implements this from every issuer's `debtByKind`, valuing what each
/// member has pledged with the governed per-collateral-type haircuts. The read is one-way: the
/// pool asks the registry, and nothing on the credit side holds an address to call the pool.
interface IExposureSource {
    /// @notice what the pool would pay across every position outstanding.
    /// @dev Denominated in stable credit, directly comparable to `IStableCredit.totalSupply()`,
    /// and must never exceed it: the pool cannot pay more than the credit that exists.
    /// @return amount of pool exposure outstanding.
    function poolExposure() external view returns (uint256);
}
