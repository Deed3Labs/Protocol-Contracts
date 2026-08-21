// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IExposureSource
/// @notice Reports what the AssurancePool would actually pay if every member defaulted.
/// @dev This is the denominator of RTD, and it is neither total credit outstanding nor unsecured
/// credit. Total credit over-reserves, because a savings-backed position is covered by collateral
/// already inside the network and seizable at par. Unsecured-only under-reserves, because
/// asset-backed collateral has to be sold at an uncertain price and the pool covers the gap. See
/// ExposureMath for the per-position rule.
///
/// Nothing here is a reserve source. The numerator of RTD is the AssurancePool's own primary
/// balance and nothing else -- no registry, no other contract address. This interface supplies
/// the exposure being reserved against, which the pool cannot compute itself: it holds one signed
/// balance per member and knows nothing about what backs it.
///
/// Phase 1's CollateralRegistry implements this by valuing what each member has pledged and
/// applying the governed per-collateral-type haircuts. Until then the AssurancePool falls back to
/// treating every credit as unsecured at full value, which over-reserves -- the conservative
/// direction to be wrong in.
interface IExposureSource {
    /// @notice what the pool would pay across every position outstanding.
    /// @dev Denominated in stable credit, directly comparable to `IStableCredit.totalSupply()`,
    /// and must never exceed it: the pool cannot pay more than the credit that exists.
    /// @return amount of pool exposure outstanding.
    function poolExposure() external view returns (uint256);
}
