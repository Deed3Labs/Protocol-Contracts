// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title ExposureMath
/// @notice Computes what the AssurancePool would actually pay if a position defaulted.
/// @dev RTD answers exactly one question: if every member defaulted tomorrow, what would the pool
/// pay? Neither total credit outstanding nor unsecured credit answers it. Total credit
/// over-reserves, because a savings-backed position is covered by collateral already inside the
/// network. Unsecured-only under-reserves, because asset-backed collateral has to be sold at an
/// uncertain price and the pool covers whatever the sale does not.
///
/// Three treatments, by what stands behind the debt:
///
/// | Backing    | Exposure          | Why                                                        |
/// |------------|-------------------|------------------------------------------------------------|
/// | Savings    | zero              | Liquid, already in the network, seizable at par. Seizure    |
/// |            |                   | burns the debt and the pool pays nothing.                   |
/// | Asset      | shortfall only    | Collateral must be sold. The pool covers the gap between    |
/// |            |                   | the debt and what the sale is assumed to realize.           |
/// | Unsecured  | full value        | Nothing stands behind it. The pool covers all of it.        |
library ExposureMath {
    /// @notice Basis point denominator.
    uint256 internal constant BPS = 10_000;

    /// @notice Tier kinds, matching the `kind` field of the tiered ceiling.
    bytes32 internal constant SAVINGS = "SAVINGS";
    bytes32 internal constant ASSET = "ASSET";
    bytes32 internal constant INCOME = "INCOME";
    bytes32 internal constant BOOST = "BOOST";

    /// @notice How a position is backed, which is what determines its exposure.
    enum Backing {
        Unsecured,
        Savings,
        Asset
    }

    /// @notice thrown when an advance rate above 100% is supplied.
    error InvalidHaircut(uint256 haircutBps);

    /// @notice maps a tier kind onto its backing treatment.
    /// @dev Anything unrecognised is treated as unsecured. Income, Boost, partner credit and Clear
    /// Cash all belong there, and so does any tier added later before this mapping is updated:
    /// an unknown tier should over-reserve rather than quietly contribute nothing.
    /// @param kind tier kind.
    /// @return backing treatment for that kind.
    function backingOf(bytes32 kind) internal pure returns (Backing) {
        if (kind == SAVINGS) return Backing.Savings;
        if (kind == ASSET) return Backing.Asset;
        return Backing.Unsecured;
    }

    /// @notice exposure contributed by a single position.
    /// @dev Savings-backed debt is excluded rather than offset against the member's savings.
    /// Putting the debt in the numerator and the savings in the denominator counts the same
    /// collateral twice, since the savings are consumed by the very debt being counted. Both
    /// sides cancel, and excluding both is the same answer with fewer places to be wrong.
    /// @param backing how the position is backed.
    /// @param debt outstanding debt on the position.
    /// @param collateralValue value of pledged collateral, before the haircut.
    /// @param haircutBps assumed realizable share of that value, in basis points.
    /// @return exposure amount the pool would pay on default.
    function positionExposure(
        Backing backing,
        uint256 debt,
        uint256 collateralValue,
        uint256 haircutBps
    ) internal pure returns (uint256) {
        if (backing == Backing.Savings) return 0;
        if (backing == Backing.Unsecured) return debt;

        if (haircutBps > BPS) revert InvalidHaircut(haircutBps);
        uint256 realizable = (collateralValue * haircutBps) / BPS;
        // Over-collateralized positions contribute nothing; they do not offset other positions.
        return realizable >= debt ? 0 : debt - realizable;
    }

    /// @notice exposure contributed by a single position, resolved from its tier kind.
    /// @param kind tier kind.
    /// @param debt outstanding debt on the position.
    /// @param collateralValue value of pledged collateral, before the haircut.
    /// @param haircutBps assumed realizable share of that value, in basis points.
    /// @return exposure amount the pool would pay on default.
    function positionExposure(
        bytes32 kind,
        uint256 debt,
        uint256 collateralValue,
        uint256 haircutBps
    ) internal pure returns (uint256) {
        return positionExposure(backingOf(kind), debt, collateralValue, haircutBps);
    }
}
