// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title CarryIndex
/// @notice Lazy accrual of carry into a credit position.
/// @dev Carry is not a fee charged at intervals. It accrues continuously into the negative
/// balance, so a position worsens with time held. That cannot be computed by iterating accounts,
/// so an index advances with time and each position stores the index value at its last touch.
/// Accrued carry is derived on read and never stored per account.
///
/// Two properties make this correct, and both are easy to get wrong:
///
/// **The index is a pure function of elapsed time, not an incrementally-mutated number.** It is
/// derived from a base and the time since the rate last changed, so reading it is identical
/// whether or not anyone called into the contract in between. An index that compounds itself on
/// every touch gives a different answer depending on how often it was touched, because the
/// rounding at each step does not compose.
///
/// **Positions are stored normalized, never rebased.** A position holds `principal / index`, so
/// adding to it or reading it never rewrites what is already there. Rebasing a stored principal
/// on every interaction reintroduces exactly the drift the pure-function index removed.
///
/// Together these give the invariant the build plan asks for: a position untouched for six cycles
/// reads the same accrued carry as one touched every cycle.
library CarryIndex {
    /// @notice Fixed-point scale for the index.
    uint256 internal constant RAY = 1e27;
    /// @notice Basis point denominator.
    uint256 internal constant BPS = 10_000;

    /// @notice Ceiling on the per-cycle rate, as a sanity bound rather than a policy.
    /// @dev The plan's tiers run from 0 bps on savings-backed to 300 bps on Boost. Anything near
    /// this ceiling is a misconfiguration, not a product.
    uint256 internal constant MAX_RATE_PER_CYCLE = 5_000;

    /// @notice An accrual clock shared by everything drawn against one rate.
    /// @dev One of these per revolving tier, and one per term plan. They are separate mechanisms
    /// because they are separate clocks: a tier's balance shares a rate and an origin, while each
    /// term plan has its own rate and its own opening date, and two plans at different rates
    /// cannot share an index.
    struct Index {
        /// @dev Index value as of `rateStart`.
        uint256 base;
        /// @dev When the current rate took effect. Growth is measured from here.
        uint64 rateStart;
        /// @dev Seconds in a cycle. Carry compounds per cycle and accrues linearly within one.
        uint64 cycleLength;
        /// @dev Carry rate per cycle, in basis points.
        uint256 ratePerCycle;
    }

    error InvalidCycleLength();
    error RateTooHigh(uint256 ratePerCycle);
    error NotInitialized();

    /// @notice starts an index at par.
    /// @param idx index to initialize.
    /// @param ratePerCycle carry rate per cycle, in basis points.
    /// @param cycleLength seconds in a cycle.
    /// @param startedAt timestamp the index begins accruing from.
    function init(Index storage idx, uint256 ratePerCycle, uint64 cycleLength, uint64 startedAt)
        internal
    {
        if (cycleLength == 0) revert InvalidCycleLength();
        if (ratePerCycle > MAX_RATE_PER_CYCLE) revert RateTooHigh(ratePerCycle);
        idx.base = RAY;
        idx.rateStart = startedAt;
        idx.cycleLength = cycleLength;
        idx.ratePerCycle = ratePerCycle;
    }

    /// @notice the index value at a given time.
    /// @dev Pure in the sense that matters: it reads storage but writes none, and depends only on
    /// the checkpoint and the elapsed time. Calling it more often does not change what it returns.
    /// @param idx index to read.
    /// @param timestamp time to evaluate at.
    /// @return current index value, RAY-scaled.
    function currentIndex(Index storage idx, uint256 timestamp) internal view returns (uint256) {
        if (idx.cycleLength == 0) revert NotInitialized();
        if (idx.ratePerCycle == 0 || timestamp <= idx.rateStart) return idx.base;

        uint256 elapsed = timestamp - idx.rateStart;
        uint256 cycleLength = idx.cycleLength;
        uint256 perCycle = RAY + (idx.ratePerCycle * RAY) / BPS;

        // Compound across whole cycles.
        uint256 value = mulRay(idx.base, rpow(perCycle, elapsed / cycleLength));

        // Accrue linearly through the cycle in progress, so a position worsens with every second
        // held rather than stepping at a boundary.
        uint256 remainder = elapsed % cycleLength;
        if (remainder > 0) {
            uint256 withinCycle = RAY + ((perCycle - RAY) * remainder) / cycleLength;
            value = mulRay(value, withinCycle);
        }
        return value;
    }

    /// @notice changes the rate, checkpointing the index so past accrual is preserved.
    /// @dev Growth is measured from `rateStart`, so the checkpoint has to move with the rate or
    /// the new rate would be applied retroactively to time already accrued at the old one.
    /// @param idx index to update.
    /// @param newRatePerCycle new carry rate per cycle, in basis points.
    /// @param timestamp time the new rate takes effect.
    function setRate(Index storage idx, uint256 newRatePerCycle, uint256 timestamp) internal {
        if (newRatePerCycle > MAX_RATE_PER_CYCLE) revert RateTooHigh(newRatePerCycle);
        idx.base = currentIndex(idx, timestamp);
        idx.rateStart = uint64(timestamp);
        idx.ratePerCycle = newRatePerCycle;
    }

    /// @notice converts an amount into its index-relative form for storage.
    /// @dev Rounds down. Use for reducing a position, where removing slightly less than was paid
    /// leaves the member owing the dust rather than the network.
    /// @param amount amount to convert.
    /// @param index index value at the time.
    /// @return normalized amount.
    function normalize(uint256 amount, uint256 index) internal pure returns (uint256) {
        return (amount * RAY) / index;
    }

    /// @notice converts an amount into its index-relative form, rounding up.
    /// @dev Use for adding to a position. Rounding down here loses a wei per draw to truncation,
    /// so a member reading their balance back sees fractionally less than they just spent, and
    /// the sliver belongs to no position -- it accrues no carry and no repayment ever finds it.
    /// Rounding up means the position is never smaller than the draw that created it.
    /// @param amount amount drawn.
    /// @param index index value at the time of the draw.
    /// @return normalized amount to store.
    function normalizeUp(uint256 amount, uint256 index) internal pure returns (uint256) {
        uint256 scaled = amount * RAY;
        uint256 result = scaled / index;
        if (result * index < scaled) result += 1;
        return result;
    }

    /// @notice converts a stored normalized amount back into what is owed now.
    /// @param normalized stored normalized amount.
    /// @param index index value to evaluate at.
    /// @return amount owed, carry included.
    function denormalize(uint256 normalized, uint256 index) internal pure returns (uint256) {
        return (normalized * index) / RAY;
    }

    /// @notice carry accrued on a position, derived rather than stored.
    /// @param normalized stored normalized amount.
    /// @param index index value to evaluate at.
    /// @param principalDrawn cumulative principal drawn on the position.
    /// @return carry accrued above principal, floored at zero.
    function accruedCarry(uint256 normalized, uint256 index, uint256 principalDrawn)
        internal
        pure
        returns (uint256)
    {
        uint256 owed = denormalize(normalized, index);
        return owed > principalDrawn ? owed - principalDrawn : 0;
    }

    /// @notice multiplies two RAY-scaled numbers.
    function mulRay(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / RAY;
    }

    /// @notice raises a RAY-scaled number to an integer power by binary exponentiation.
    /// @dev The exponent is whole cycles elapsed, so it stays small in practice and is bounded by
    /// the logarithm of it regardless.
    /// @param x RAY-scaled base.
    /// @param n exponent.
    /// @return z RAY-scaled result.
    function rpow(uint256 x, uint256 n) internal pure returns (uint256 z) {
        z = RAY;
        while (n > 0) {
            if (n & 1 == 1) z = mulRay(z, x);
            n >>= 1;
            if (n > 0) x = mulRay(x, x);
        }
    }
}
