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
/// | Asset      | shortfall only    | The pool covers the gap between the debt and what the       |
/// |            |                   | collateral is assumed to realize.                           |
/// | Unsecured  | full value        | Nothing stands behind it. The pool covers all of it.        |
///
/// Asset-backed splits again, and the two halves must not share a haircut. An external asset --
/// a tokenized deed -- is realized by selling it into a market, so its haircut prices market
/// uncertainty. An internal claim -- a BurnerBond, a LendingPool share -- is a claim on the co-op
/// itself, and seizing it cancels an obligation the co-op would otherwise have had to honour
/// rather than realizing an asset. Its redemption terms are largely known, so its haircut is
/// near-par. Applying a market-risk haircut to a bond over-reserves; applying a bond-style
/// haircut to a deed under-reserves.
///
/// The arithmetic is the same for both. The classification is not, which is why an asset pledge
/// that has not declared a class is treated as unsecured: the exposure over-reserves rather than
/// quietly borrowing whichever haircut the caller happened to have to hand.
library ExposureMath {
    /// @notice Basis point denominator.
    uint256 internal constant BPS = 10_000;

    /// @notice Tier kinds, matching the `kind` field of the tiered ceiling.
    /// @dev There is no bare ASSET kind on purpose. Asset-backed collateral has to declare
    /// whether it is an external asset or an internal claim before it can reduce exposure,
    /// because the two are haircut on different grounds. An undeclared pledge falls through to
    /// the unsecured treatment, which over-reserves.
    bytes32 internal constant SAVINGS = "SAVINGS";
    bytes32 internal constant ASSET_EXTERNAL = "ASSET_EXTERNAL";
    bytes32 internal constant ASSET_INTERNAL = "ASSET_INTERNAL";
    bytes32 internal constant INCOME = "INCOME";
    bytes32 internal constant BOOST = "BOOST";

    /// @notice How a position is backed, which is what determines its exposure.
    /// @dev AssetExternal and AssetInternal share the shortfall formula and differ only in what
    /// their haircut is priced off. They are separate members so a haircut table cannot key them
    /// together, and so a caller cannot compute asset exposure without having decided which one
    /// it is holding.
    enum Backing {
        Unsecured,
        Savings,
        AssetExternal,
        AssetInternal
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
        if (kind == ASSET_EXTERNAL) return Backing.AssetExternal;
        if (kind == ASSET_INTERNAL) return Backing.AssetInternal;
        return Backing.Unsecured;
    }

    /// @notice whether a backing is collateralized by something that has to be valued.
    /// @param backing backing treatment.
    /// @return true for the two asset-backed treatments.
    function isAssetBacked(Backing backing) internal pure returns (bool) {
        return backing == Backing.AssetExternal || backing == Backing.AssetInternal;
    }

    /// @notice exposure contributed by a single position.
    /// @dev Savings-backed debt is excluded rather than offset against the member's savings.
    /// Putting the debt in the numerator and the savings in the denominator counts the same
    /// collateral twice, since the savings are consumed by the very debt being counted. Both
    /// sides cancel, and excluding both is the same answer with fewer places to be wrong.
    /// @dev An internal claim seized on default cancels an obligation the co-op would otherwise
    /// have had to honour, rather than realizing an asset. The arithmetic is identical either
    /// way -- the difference is entirely in what haircut the caller supplies, which is why the
    /// two are distinct backings rather than one.
    /// @param backing how the position is backed.
    /// @param debt outstanding debt on the position.
    /// @param collateralValue value of pledged collateral, before the haircut.
    /// @param haircutBps assumed realizable share of that value, in basis points, priced off a
    /// market for an external asset and off redemption terms for an internal claim.
    /// @return exposure amount the pool would pay on default.
    function positionExposure(
        Backing backing,
        uint256 debt,
        uint256 collateralValue,
        uint256 haircutBps
    ) internal pure returns (uint256) {
        if (backing == Backing.Savings) return 0;
        if (!isAssetBacked(backing)) return debt;

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
