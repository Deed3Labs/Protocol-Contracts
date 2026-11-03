// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title BondDiscountCurve
/// @notice The pricing policy for zero-coupon bonds: how much discount a given term earns.
/// @dev Lives outside the bond collection for the same reason BondTraits does. A collection is a
/// clone of one implementation, and every byte of curve maths is a byte the implementation has to
/// carry under the 24,576-byte limit -- while the curve itself is a shared policy, not per-bond
/// state. One deployment serves every collection; each collection's configuration is keyed by its
/// own address, so collections cannot read or write each other's curve.
///
/// Discount is a function of term alone. It says nothing about a particular bond, which is why it
/// can be shared. What a bond is worth *today* -- present value, which accretes -- stays in the
/// collection, because that does depend on the individual bond.
contract BondDiscountCurve {
    /// @notice Discount curve shapes.
    enum CurveType {
        LINEAR,      // 0: proportional to term
        BONDING,     // 1: S-curve, slow then fast then slow
        LOGARITHMIC, // 2: diminishing returns, discourages long terms
        CUSTOM       // 3: reserved
    }

    struct Curve {
        CurveType curveType;
        uint256 parameter;
        bool configured;
    }

    /// @notice Curve configuration, keyed by the collection that set it.
    mapping(address => Curve) private curves;

    event CurveSet(address indexed collection, uint8 curveType, uint256 parameter);

    /// @notice Read a collection's curve, defaulting to linear.
    /// @dev A collection that has never configured itself gets LINEAR at 1.0, which is the
    /// behaviour it had when the curve lived inside the bond contract.
    function curveOf(address collection) public view returns (CurveType, uint256) {
        Curve storage c = curves[collection];
        if (!c.configured) return (CurveType.LINEAR, 10000);
        return (c.curveType, c.parameter);
    }

    /// @notice Configure the calling collection's curve.
    /// @dev Keyed by msg.sender, so a collection can only ever configure itself. Access control
    /// belongs to the collection: it decides who may call this on its behalf.
    function setCurve(uint8 curveType, uint256 parameter) external {
        require(curveType <= 3, "Invalid curve type");

        if (curveType == 1) {
            require(parameter >= 10000 && parameter <= 50000, "Steepness must be between 1.0 and 5.0");
        } else if (curveType == 2) {
            require(parameter >= 15000 && parameter <= 100000, "Base must be between 1.5 and 10.0");
        } else if (curveType == 0) {
            require(parameter == 10000, "Linear curve parameter must be 1.0");
        }

        curves[msg.sender] = Curve(CurveType(curveType), parameter, true);
        emit CurveSet(msg.sender, curveType, parameter);
    }

    /// @notice Discount in basis points for a term, under the collection's curve.
    /// @dev The maturity and discount bounds are passed in rather than read, because they belong
    /// to the collection's factory and this contract serves many factories.
    function discountFor(
        address collection,
        uint256 timeToMaturity,
        uint256 minMaturity,
        uint256 maxMaturity,
        uint256 minDiscount,
        uint256 maxDiscount
    ) external view returns (uint256) {
        if (timeToMaturity < minMaturity) return 0;
        if (timeToMaturity > maxMaturity) timeToMaturity = maxMaturity;

        (CurveType curveType, uint256 parameter) = curveOf(collection);
        // Stored on a 10,000 scale (10,000 = 1.0), which is what `setCurve` validates against;
        // the maths below works in 1e18. Without this, a steepness of 2.0 reached `_power` as an
        // exponent of 2e-14 -- every BONDING curve priced at the minimum -- and a LOGARITHMIC base
        // underflowed `parameter - 1e18` and reverted.
        parameter = parameter * 1e14;

        uint256 normalizedTime = (timeToMaturity * 1e18) / maxMaturity;
        uint256 discountRange = maxDiscount - minDiscount;

        if (curveType == CurveType.LINEAR) {
            return minDiscount + (normalizedTime * discountRange) / 1e18;
        } else if (curveType == CurveType.BONDING) {
            // discount = min + range * (1 - (1 - t)^steepness), steepness any value from 1.0 to 5.0
            uint256 curveValue = 1e18 - _pow(1e18 - normalizedTime, parameter);
            return minDiscount + (curveValue * discountRange) / 1e18;
        } else if (curveType == CurveType.LOGARITHMIC) {
            // discount = min + range * log_b(1 + t*(b - 1)), which runs from 0 at t = 0 to 1 at t = 1
            uint256 logResult = (_log2(1e18 + (normalizedTime * (parameter - 1e18)) / 1e18) * 1e18) / _log2(parameter);
            return minDiscount + (logResult * discountRange) / 1e18;
        }
        revert("Custom curve not implemented yet");
    }

    /* ========== MATHS ========== */
    //
    // Fixed point, 1e18 = 1.0. These used to be an integer-exponent power and a logarithm that was
    // linear between 1 and its base -- the whole range the curve asks about -- so a LOGARITHMIC
    // curve priced exactly like a LINEAR one and a steepness of 2.5 behaved as 2. Accuracy here is
    // far beyond what a discount in basis points can show.

    uint256 private constant ONE = 1e18;
    /// @dev ln(2), 1e18-scaled.
    uint256 private constant LN2 = 693147180559945309;

    /// @dev log2 of x, 1e18-scaled, for x >= 1.0. An integer part from the highest set bit, then
    /// one fractional bit per squaring.
    function _log2(uint256 x) internal pure returns (uint256 result) {
        require(x >= ONE, "log2 below 1");
        uint256 n = 0;
        uint256 whole = x / ONE;
        while (whole >= 2) {
            whole >>= 1;
            n++;
        }
        result = n * ONE;
        uint256 y = x >> n;
        if (y == ONE) return result;
        for (uint256 delta = ONE / 2; delta > 0; delta >>= 1) {
            y = (y * y) / ONE;
            if (y >= 2 * ONE) {
                result += delta;
                y >>= 1;
            }
        }
    }

    /// @dev base^exponent for a base in [0, 1.0] and an exponent of at least 1.0, as
    /// 2^(-exponent * log2(1 / base)).
    function _pow(uint256 base, uint256 exponent) internal pure returns (uint256) {
        if (base == 0) return 0;
        if (base >= ONE) return ONE;
        uint256 negLog = _log2((ONE * ONE) / base);
        uint256 y = (negLog * exponent) / ONE;
        // 2^-190 is far below one unit of the result.
        if (y >= 190 * ONE) return 0;
        return (ONE * ONE) / _exp2(y);
    }

    /// @dev 2^y, 1e18-scaled, for y >= 0: the whole part as a shift, the fraction as e^(f ln 2) by
    /// its series, which has converged well before twenty terms for an argument under 0.7.
    function _exp2(uint256 y) internal pure returns (uint256) {
        uint256 whole = y / ONE;
        uint256 z = ((y % ONE) * LN2) / ONE;
        uint256 term = ONE;
        uint256 sum = ONE;
        for (uint256 k = 1; k < 20; k++) {
            term = (term * z) / (ONE * k);
            if (term == 0) break;
            sum += term;
        }
        return sum << whole;
    }
}
