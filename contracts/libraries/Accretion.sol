// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

/// @title Accretion
/// @notice Accreted Value of a BurnerBond (Earn §1; IV-01 "Accreted Value"; MB-05 "Present
/// Value"): the Maturity Amount ÷ (1 + Issue Yield)^(days to maturity ÷ 365), compounded
/// annually, and the Maturity Amount on and after the Maturity Date (Phase 2f, decisions 1 and 8, C7).
/// @dev Pure and library-only. Stage 2 wires it into the new bond collection.
///
/// **Days.** Days to maturity are whole days, counted up: a part day left counts as a day. The
/// value is therefore constant within a day and steps up at each day boundary, never down.
///
/// **Rounding: always down, against the claimant's overstatement.** Every Accreted Value here is a
/// claim on someone: what a Holder is paid (`payPledged`, distributions, `redeemAll`), what a
/// pledged bond counts for as collateral, and the ceiling on a buyback price. Rounding down means
/// no claimant is ever credited more than the exact value, so no Holder is paid at the others'
/// expense and no collateral is overstated. The error is under one base unit of the token (USDC:
/// $0.000001), far inside the spec's tolerance of one cent in the Holder's disfavour. To make that
/// a guarantee rather than an estimate, the growth factor (1 + y)^(n/365) is bounded from above
/// with directed rounding at every step (`growthUp`), and the value divides by it rounding down.
/// Where a Maturity Amount is the claim (a roll's new bond), the factor is bounded from below
/// (`growthDown`) and the amount rounded down to the cent, as IV-01 §5.2 requires.
///
/// **How.** The 365th root of (1 + y) is found by Newton's method in 27-decimal fixed point and
/// then nudged until a power computed with the opposite rounding proves the bound. Whole years
/// are raised exactly by squaring. Stage 2 may cache `dayFactorUp` per bond at mint to save gas.
library Accretion {
    using MathUpgradeable for uint256;

    uint256 internal constant RAY = 1e27;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant DAY = 1 days;
    uint256 internal constant DAYS_PER_YEAR = 365;
    /// @dev Bounds of the domain the error analysis covers: yields below 50%, terms up to 30 years.
    uint256 internal constant MAX_YIELD_BPS = 5_000;
    uint256 internal constant MAX_DAYS = 10_950;

    error AccretionOutOfRange(uint256 yieldBps, uint256 daysLeft);

    /// @notice Accreted Value at `timestamp` of a bond paying `maturityAmount` at `maturityDate`.
    function accretedValue(uint256 maturityAmount, uint256 yieldBps, uint256 maturityDate, uint256 timestamp)
        internal
        pure
        returns (uint256)
    {
        return presentValue(maturityAmount, yieldBps, daysRemaining(maturityDate, timestamp));
    }

    /// @notice whole days from `timestamp` to `maturityDate`, a part day counted as a day.
    function daysRemaining(uint256 maturityDate, uint256 timestamp) internal pure returns (uint256) {
        return maturityDate > timestamp ? (maturityDate - timestamp).ceilDiv(DAY) : 0;
    }

    /// @notice `maturityAmount` discounted over `daysLeft` days at `yieldBps`, rounded down.
    function presentValue(uint256 maturityAmount, uint256 yieldBps, uint256 daysLeft) internal pure returns (uint256) {
        if (daysLeft == 0 || yieldBps == 0) return maturityAmount;
        return maturityAmount.mulDiv(RAY, growthUp(yieldBps, daysLeft));
    }

    /// @notice the Purchase Price of a new bond: its Accreted Value at issue, `termDays` before maturity.
    function purchasePrice(uint256 maturityAmount, uint256 yieldBps, uint256 termDays) internal pure returns (uint256) {
        return presentValue(maturityAmount, yieldBps, termDays);
    }

    /// @notice the largest Maturity Amount, in whole `unit`s (a cent), that `price` buys over
    /// `termDays` at `yieldBps`.
    function maturityAmountFor(uint256 price, uint256 yieldBps, uint256 termDays, uint256 unit)
        internal
        pure
        returns (uint256)
    {
        uint256 grown = yieldBps == 0 || termDays == 0 ? price : price.mulDiv(growthDown(yieldBps, termDays), RAY);
        return grown - (grown % unit);
    }

    /// @notice a roll under IV-01 §5.2: the new Maturity Amount is the old one ÷ the new price per
    /// dollar, rounded down to the cent; the new bond's Purchase Price is its Accreted Value at
    /// issue; the remainder is what the Holder is paid out.
    /// @dev `price <= oldMaturityAmount` always, so a roll never needs USDC beyond the old bond's.
    function rollTerms(uint256 oldMaturityAmount, uint256 yieldBps, uint256 termDays, uint256 unit)
        internal
        pure
        returns (uint256 newMaturityAmount, uint256 price, uint256 remainder)
    {
        newMaturityAmount = maturityAmountFor(oldMaturityAmount, yieldBps, termDays, unit);
        price = purchasePrice(newMaturityAmount, yieldBps, termDays);
        remainder = oldMaturityAmount - price;
    }

    /// @notice an upper bound on (1 + y)^(days ÷ 365), in RAY.
    function growthUp(uint256 yieldBps, uint256 daysLeft) internal pure returns (uint256) {
        _check(yieldBps, daysLeft);
        uint256 base = RAY + yieldBps * (RAY / BPS);
        uint256 rest = daysLeft % DAYS_PER_YEAR;
        uint256 g = _pow(base, daysLeft / DAYS_PER_YEAR, true);
        if (rest == 0) return g;
        return g.mulDiv(_pow(dayFactorUp(yieldBps), rest, true), RAY, MathUpgradeable.Rounding.Up);
    }

    /// @notice a lower bound on (1 + y)^(days ÷ 365), in RAY.
    function growthDown(uint256 yieldBps, uint256 daysLeft) internal pure returns (uint256) {
        _check(yieldBps, daysLeft);
        uint256 base = RAY + yieldBps * (RAY / BPS);
        uint256 rest = daysLeft % DAYS_PER_YEAR;
        uint256 g = _pow(base, daysLeft / DAYS_PER_YEAR, false);
        if (rest == 0) return g;
        return g.mulDiv(_pow(dayFactorDown(yieldBps), rest, false), RAY);
    }

    /// @notice the daily factor (1 + y)^(1/365), bounded from above, in RAY.
    function dayFactorUp(uint256 yieldBps) internal pure returns (uint256 g) {
        uint256 base = RAY + yieldBps * (RAY / BPS);
        g = _root365(base);
        // Proven when even a power rounded down reaches the base.
        while (_pow(g, DAYS_PER_YEAR, false) < base) ++g;
    }

    /// @notice the daily factor (1 + y)^(1/365), bounded from below, in RAY.
    function dayFactorDown(uint256 yieldBps) internal pure returns (uint256 g) {
        uint256 base = RAY + yieldBps * (RAY / BPS);
        g = _root365(base);
        // Proven when even a power rounded up stays within the base.
        while (_pow(g, DAYS_PER_YEAR, true) > base) --g;
    }

    /// @dev Newton's method for the 365th root of `base` (RAY), from the Bernoulli bound
    /// 1 + (base − 1)/365, which lies above the root; the iterates fall towards it. Stops when an
    /// iterate no longer falls.
    function _root365(uint256 base) private pure returns (uint256 g) {
        g = RAY + (base - RAY) / DAYS_PER_YEAR;
        if (g == RAY) return g;
        for (uint256 i; i < 16; ++i) {
            uint256 p = _pow(g, DAYS_PER_YEAR - 1, false);
            uint256 next = ((DAYS_PER_YEAR - 1) * g + base.mulDiv(RAY, p)) / DAYS_PER_YEAR;
            if (next >= g) break;
            g = next;
        }
    }

    /// @dev x^n in RAY by squaring, every product rounded the same way, so the result is a bound
    /// on the exact power from above (`up`) or below.
    function _pow(uint256 x, uint256 n, bool up) private pure returns (uint256 r) {
        MathUpgradeable.Rounding rounding = up ? MathUpgradeable.Rounding.Up : MathUpgradeable.Rounding.Down;
        r = RAY;
        while (n > 0) {
            if (n & 1 == 1) r = r.mulDiv(x, RAY, rounding);
            n >>= 1;
            if (n > 0) x = x.mulDiv(x, RAY, rounding);
        }
    }

    function _check(uint256 yieldBps, uint256 daysLeft) private pure {
        if (yieldBps > MAX_YIELD_BPS || daysLeft > MAX_DAYS) revert AccretionOutOfRange(yieldBps, daysLeft);
    }
}
