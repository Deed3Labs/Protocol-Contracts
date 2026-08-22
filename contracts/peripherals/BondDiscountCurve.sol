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

        uint256 normalizedTime = (timeToMaturity * 1e18) / maxMaturity;
        uint256 discountRange = maxDiscount - minDiscount;

        if (curveType == CurveType.LINEAR) {
            return minDiscount + (normalizedTime * discountRange) / 1e18;
        } else if (curveType == CurveType.BONDING) {
            // discount = min + range * (1 - (1 - t)^steepness)
            uint256 curveValue = 1e18 - _power(1e18 - normalizedTime, parameter);
            return minDiscount + (curveValue * discountRange) / 1e18;
        } else if (curveType == CurveType.LOGARITHMIC) {
            // discount = min + range * log_b(1 + t*(b - 1)) / log_b(b)
            uint256 logResult = _logarithm(1e18 + (normalizedTime * (parameter - 1e18)) / 1e18, parameter);
            return minDiscount + (logResult * discountRange) / _logarithm(parameter, parameter);
        }
        revert("Custom curve not implemented yet");
    }

    /* ========== MATHS ========== */

    function _power(uint256 base, uint256 exponent) internal pure returns (uint256) {
        if (exponent == 0) return 1e18;
        if (exponent == 1e18) return base;
        if (base == 0) return 0;

        uint256 intExponent = exponent / 1e18;
        require(intExponent <= 10, "Exponent too large for approximation");

        uint256 result = 1e18;
        uint256 currentBase = base;
        while (intExponent > 0) {
            if (intExponent % 2 == 1) {
                result = (result * currentBase) / 1e18;
            }
            currentBase = (currentBase * currentBase) / 1e18;
            intExponent /= 2;
        }
        return result;
    }

    /// @dev log base `base` of `value`, both 1e18-scaled. Piecewise: a linear approximation of
    /// ln near 1, then bracket-and-interpolate between successive powers of the base. Accurate
    /// enough for a discount curve, which is a policy dial rather than a settlement figure.
    function _logarithm(uint256 value, uint256 base) internal pure returns (uint256) {
        require(value > 0, "Logarithm of zero or negative number");
        require(base > 1e18, "Logarithm base must be greater than 1");

        if (value == 1e18) return 0;
        if (value == base) return 1e18;

        if (value < base) {
            // Between 1 and the base: linear in (value - 1), scaled so that value == base gives 1.
            return ((value - 1e18) * 1e18) / (base - 1e18);
        }

        // Walk up powers of the base until the value is bracketed, then interpolate within.
        uint256 whole = 0;
        uint256 lower = 1e18;
        while (whole < 10) {
            uint256 upper = (lower * base) / 1e18;
            if (value < upper) {
                return whole * 1e18 + ((value - lower) * 1e18) / (upper - lower);
            }
            lower = upper;
            whole++;
        }
        return whole * 1e18;
    }
}
