// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title RateSchedule
/// @notice What each credit product may charge, by state: the price Clear lists and the legal cap
/// it must stay under, as governed parameters.
/// @dev Compliance spec item 1. Every rate, band and threshold here is set by the owner, which in
/// production is the credit TimelockController (7-day delay, Ops Safe as proposer; DECISIONS #10),
/// so a rate change is public a week before it binds anyone.
///
/// **Accrual model.** Charges are simple interest on unpaid principal, accrued per second at
/// `monthlyBps × 12 / 365 days` (DECISIONS #1): thirty days of accrual is 360/365 of the monthly
/// rate, so it never exceeds a monthly cap. Rates change only going forward, so every rate has a
/// cumulative accumulator -- the integral of its per-second rate since the product was created --
/// checkpointed whenever the rate changes. A position snapshots the accumulators it uses; its carry
/// for any stretch is its principal times the accumulator delta, whatever the rates did meanwhile.
///
/// **Cap.** For principal P, the legal charge over a stretch is the graduated schedule (each slice
/// of P at its band's rate), or the flat alternative on the whole of P when that is enabled and
/// higher, or the annual large-loan rate on the whole of P once P reaches the large-loan threshold.
/// Band upper bounds are fixed when a product is created: a snapshot of band accumulators only
/// means something if the bands it was taken against are the bands it is compared with. A new
/// band structure is a new product id.
contract RateSchedule is OwnableUpgradeable, UUPSUpgradeable {
    uint256 internal constant RAY = 1e27;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;

    /// @notice A slice of principal and the most that may be charged on it per month.
    struct Band {
        /// @dev Exclusive upper bound of the slice, in ledger units. The last band's is unbounded.
        uint128 upperBound;
        uint32 monthlyBps;
    }

    /// @notice A product's governed parameters, as passed to `setProduct`.
    struct ProductParams {
        bool enabled;
        /// @dev The price Clear wants to charge, per month.
        uint32 listMonthlyBps;
        /// @dev Optional flat alternative on the whole principal, per month. Zero means none.
        uint32 flatMonthlyBps;
        /// @dev Principal at or above which the large-loan regime applies. Zero means never.
        uint128 largeLoanThreshold;
        /// @dev Large-loan cap, per year.
        uint32 annualCapBps;
        /// @dev Shortest term allowed in the large-loan regime.
        uint64 minTermSeconds;
        /// @dev Term products: a single-cycle plan is free.
        bool freeInFull;
        /// @dev Term products: a plan whose principal is under this is free. Zero means off.
        uint128 freeBelowAmount;
        /// @dev Term products: plans with this many installments or fewer are free. Zero means off.
        uint32 freeSplitMax;
    }

    /// @notice Every accumulator a position may need, read at one moment.
    struct Snapshot {
        uint256 list;
        uint256 flatAlt;
        uint256 annual;
        uint256[] bands;
    }

    struct Product {
        bool exists;
        ProductParams params;
        uint64 accruedAt;
        uint256 listAcc;
        uint256 flatAcc;
        uint256 annualAcc;
    }

    /// @dev keccak256(stateCode, productId) => product.
    mapping(bytes32 => Product) private products;
    mapping(bytes32 => Band[]) private bandsOf;
    mapping(bytes32 => uint256[]) private bandAcc;

    uint256[47] private __gap;

    error RateScheduleUnknownProduct(bytes32 stateCode, bytes32 productId);
    error RateScheduleBadBands();
    error RateScheduleBandsFixed();

    event ProductSet(bytes32 indexed stateCode, bytes32 indexed productId, ProductParams params);
    event BandsSet(bytes32 indexed stateCode, bytes32 indexed productId, Band[] bands);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param owner_ the governor: the credit TimelockController in production.
    function initialize(address owner_) external initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        _transferOwnership(owner_);
    }

    /// @dev Upgrades are the owner's -- the timelock -- like every rate change (spec 10e).
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /* ========== GOVERNANCE ========== */

    /// @notice creates a product for a state, with its bands, or updates its rates and rules.
    /// @dev Bands are set once, at creation; later calls must pass the same bounds and may change
    /// only their rates. Every accumulator is brought to now at the old rates before the new ones
    /// take over, so no change ever reaches back over time already accrued.
    function setProduct(
        bytes32 stateCode,
        bytes32 productId,
        ProductParams calldata params,
        Band[] calldata bands
    ) external onlyOwner {
        bytes32 key = keyOf(stateCode, productId);
        Product storage product = products[key];
        Band[] storage stored = bandsOf[key];
        if (bands.length == 0 || bands[bands.length - 1].upperBound != type(uint128).max) {
            revert RateScheduleBadBands();
        }
        if (!product.exists) {
            for (uint256 i = 0; i < bands.length; i++) {
                if (i > 0 && bands[i].upperBound <= bands[i - 1].upperBound) revert RateScheduleBadBands();
                stored.push(bands[i]);
                bandAcc[key].push(0);
            }
            product.exists = true;
            product.accruedAt = uint64(block.timestamp);
            emit BandsSet(stateCode, productId, bands);
        } else {
            if (bands.length != stored.length) revert RateScheduleBandsFixed();
            _checkpoint(key);
            for (uint256 i = 0; i < bands.length; i++) {
                if (bands[i].upperBound != stored[i].upperBound) revert RateScheduleBandsFixed();
                stored[i].monthlyBps = bands[i].monthlyBps;
            }
        }
        product.params = params;
        emit ProductSet(stateCode, productId, params);
    }

    /* ========== VIEWS ========== */

    function keyOf(bytes32 stateCode, bytes32 productId) public pure returns (bytes32) {
        return keccak256(abi.encode(stateCode, productId));
    }

    /// @notice whether a product has been configured for a state at all, enabled or not.
    /// @dev A disabled product still prices the positions already open under it.
    function hasProduct(bytes32 stateCode, bytes32 productId) public view returns (bool) {
        return products[keyOf(stateCode, productId)].exists;
    }

    /// @notice whether a product may be offered in a state.
    function isEnabled(bytes32 stateCode, bytes32 productId) public view returns (bool) {
        Product storage product = products[keyOf(stateCode, productId)];
        return product.exists && product.params.enabled;
    }

    function paramsOf(bytes32 stateCode, bytes32 productId) external view returns (ProductParams memory) {
        return _product(stateCode, productId).params;
    }

    function bandsFor(bytes32 stateCode, bytes32 productId) external view returns (Band[] memory) {
        _product(stateCode, productId);
        return bandsOf[keyOf(stateCode, productId)];
    }

    /// @notice every accumulator for a product, as of now.
    function snapshot(bytes32 stateCode, bytes32 productId) public view returns (Snapshot memory snap) {
        bytes32 key = keyOf(stateCode, productId);
        Product storage product = _product(stateCode, productId);
        uint256 elapsed = block.timestamp - product.accruedAt;
        ProductParams storage p = product.params;
        snap.list = product.listAcc + _monthlyPerSecond(p.listMonthlyBps) * elapsed;
        snap.flatAlt = product.flatAcc + _monthlyPerSecond(p.flatMonthlyBps) * elapsed;
        snap.annual = product.annualAcc + _annualPerSecond(p.annualCapBps) * elapsed;
        Band[] storage bands = bandsOf[key];
        uint256[] storage acc = bandAcc[key];
        snap.bands = new uint256[](bands.length);
        for (uint256 i = 0; i < bands.length; i++) {
            snap.bands[i] = acc[i] + _monthlyPerSecond(bands[i].monthlyBps) * elapsed;
        }
    }

    /// @notice the most that may be charged on `principal` between snapshot `from` and now.
    function capSince(bytes32 stateCode, bytes32 productId, uint256 principal, Snapshot memory from)
        public
        view
        returns (uint256)
    {
        if (principal == 0) return 0;
        Snapshot memory now_ = snapshot(stateCode, productId);
        return _cap(stateCode, productId, principal, from, now_);
    }

    /// @notice the list carry and the legal cap on `principal` since `from`.
    /// @dev The two numbers an issuer needs at every touch, read in one call.
    function chargesSince(bytes32 stateCode, bytes32 productId, uint256 principal, Snapshot memory from)
        external
        view
        returns (uint256 listCarry, uint256 capCarry, Snapshot memory now_)
    {
        now_ = snapshot(stateCode, productId);
        if (principal == 0) return (0, 0, now_);
        listCarry = (principal * (now_.list - from.list)) / RAY;
        capCarry = _cap(stateCode, productId, principal, from, now_);
    }

    /// @notice the monthly rate the cap allows on `principal`, in bps: what a full month of the
    /// graduated (or large-loan) schedule would charge, divided by the principal.
    function capMonthlyBps(bytes32 stateCode, bytes32 productId, uint256 principal)
        public
        view
        returns (uint256)
    {
        if (principal == 0) return 0;
        Product storage product = _product(stateCode, productId);
        ProductParams storage p = product.params;
        if (p.largeLoanThreshold != 0 && principal >= p.largeLoanThreshold) {
            return p.annualCapBps / 12;
        }
        Band[] storage bands = bandsOf[keyOf(stateCode, productId)];
        uint256 charge;
        uint256 lower;
        for (uint256 i = 0; i < bands.length && lower < principal; i++) {
            uint256 upper = bands[i].upperBound;
            uint256 part = (principal < upper ? principal : upper) - lower;
            charge += part * bands[i].monthlyBps;
            lower = upper;
        }
        uint256 graduated = charge / principal;
        return p.flatMonthlyBps > graduated ? p.flatMonthlyBps : graduated;
    }

    /// @notice min(list rate, legal cap for this principal), per month, in bps.
    function effectiveMonthlyBps(bytes32 stateCode, bytes32 productId, uint256 principal)
        external
        view
        returns (uint256)
    {
        uint256 list = _product(stateCode, productId).params.listMonthlyBps;
        uint256 cap = capMonthlyBps(stateCode, productId, principal);
        return list < cap ? list : cap;
    }

    /* ========== INTERNAL ========== */

    function _product(bytes32 stateCode, bytes32 productId) internal view returns (Product storage product) {
        product = products[keyOf(stateCode, productId)];
        if (!product.exists) revert RateScheduleUnknownProduct(stateCode, productId);
    }

    function _cap(
        bytes32 stateCode,
        bytes32 productId,
        uint256 principal,
        Snapshot memory from,
        Snapshot memory now_
    ) internal view returns (uint256) {
        ProductParams storage p = products[keyOf(stateCode, productId)].params;
        if (p.largeLoanThreshold != 0 && principal >= p.largeLoanThreshold) {
            return (principal * (now_.annual - from.annual)) / RAY;
        }
        Band[] storage bands = bandsOf[keyOf(stateCode, productId)];
        uint256 total;
        uint256 lower;
        for (uint256 i = 0; i < bands.length && lower < principal; i++) {
            uint256 upper = bands[i].upperBound;
            uint256 part = (principal < upper ? principal : upper) - lower;
            total += part * (now_.bands[i] - from.bands[i]);
            lower = upper;
        }
        total /= RAY;
        if (p.flatMonthlyBps != 0) {
            uint256 flat = (principal * (now_.flatAlt - from.flatAlt)) / RAY;
            if (flat > total) total = flat;
        }
        return total;
    }

    function _checkpoint(bytes32 key) internal {
        Product storage product = products[key];
        uint256 elapsed = block.timestamp - product.accruedAt;
        if (elapsed == 0) return;
        ProductParams storage p = product.params;
        product.listAcc += _monthlyPerSecond(p.listMonthlyBps) * elapsed;
        product.flatAcc += _monthlyPerSecond(p.flatMonthlyBps) * elapsed;
        product.annualAcc += _annualPerSecond(p.annualCapBps) * elapsed;
        Band[] storage bands = bandsOf[key];
        uint256[] storage acc = bandAcc[key];
        for (uint256 i = 0; i < bands.length; i++) {
            acc[i] += _monthlyPerSecond(bands[i].monthlyBps) * elapsed;
        }
        product.accruedAt = uint64(block.timestamp);
    }

    /// @dev A monthly rate as RAY per second: `bps × 12 / 365 days` (DECISIONS #1).
    function _monthlyPerSecond(uint256 monthlyBps) internal pure returns (uint256) {
        return (monthlyBps * RAY * 12) / (BPS * YEAR);
    }

    /// @dev An annual rate as RAY per second.
    function _annualPerSecond(uint256 annualBps) internal pure returns (uint256) {
        return (annualBps * RAY) / (BPS * YEAR);
    }
}
