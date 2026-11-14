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
/// @notice What an issuer reports as a member's principal under the state's small-loan law.
interface ICflPrincipalSource {
    function cflPrincipalOf(address member) external view returns (uint256);
}

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

    /// @dev Retired in Phase 2e: DECISIONS #7's switch. The Combined Ceiling (12.3, Addendum 2) is
    /// permanent, so nothing reads this any more and nothing can set it. Kept for the layout.
    /// @custom:oz-renamed-from cflAggregationOff
    bool private __retiredCflAggregationOff;
    address[] private cflSources;

    uint256[45] private __gap;

    error RateScheduleUnknownProduct(bytes32 stateCode, bytes32 productId);
    error RateScheduleBadBands();
    error RateScheduleBandsFixed();

    event ProductSet(bytes32 indexed stateCode, bytes32 indexed productId, ProductParams params);
    event BandsSet(bytes32 indexed stateCode, bytes32 indexed productId, Band[] bands);
    event CflSourcesSet(address[] sources);

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

    /// @notice the issuers whose principal is aggregated into one loan for the cap.
    function setCflSources(address[] calldata sources) external onlyOwner {
        cflSources = sources;
        emit CflSourcesSet(sources);
    }

    function cflSourcesOf() external view returns (address[] memory) {
        return cflSources;
    }

    /// @notice a member's principal across every aggregated issuer (DECISIONS #7, always on since
    /// Phase 2e): what the large-loan regime and its minimum term are judged on.
    function aggregatePrincipalOf(address member) public view returns (uint256 total) {
        for (uint256 i = 0; i < cflSources.length; i++) {
            total += ICflPrincipalSource(cflSources[i]).cflPrincipalOf(member);
        }
    }

    /// @notice the cap on one of `member`'s positions of `principal` since `from`.
    /// @dev Since Phase 2e the cap on the position alone: the pro-rata share of the cap on the
    /// member's aggregate (DECISIONS #7) is replaced by the Combined Ceiling (12.3), which the
    /// issuers apply with `graduatedSince` and `combinedTrim`. `member` is kept for the ABI.
    function capFor(address, bytes32 stateCode, bytes32 productId, uint256 principal, Snapshot memory from)
        public
        view
        returns (uint256 cap)
    {
        return capSince(stateCode, productId, principal, from);
    }

    /* ---- Phase 2e: the Combined Ceiling (12.3, Addendum 2) ---- */

    /// @notice the graduated schedule alone on `principal` since `from`: each slice at its band's
    /// rate, per second at monthly x 12 / 365. Never the flat alternative and never the large-loan
    /// rate: the Combined Ceiling is "1% a month on every dollar above $1,650" whatever the total.
    function graduatedSince(bytes32 stateCode, bytes32 productId, uint256 principal, Snapshot memory from)
        external
        view
        returns (uint256 total)
    {
        if (principal == 0) return 0;
        Snapshot memory now_ = snapshot(stateCode, productId);
        Band[] storage bands = bandsOf[keyOf(stateCode, productId)];
        uint256 lower;
        for (uint256 i = 0; i < bands.length && lower < principal; i++) {
            uint256 upper = bands[i].upperBound;
            total += ((principal < upper ? principal : upper) - lower) * (now_.bands[i] - from.bands[i]);
            lower = upper;
        }
        total /= RAY;
    }

    /// @notice the graduated schedule's monthly charge on `principal`, as principal x monthly bps x
    /// RATE_SCALE (the unit the issuers' monthly figures are in).
    function graduatedMonthly(bytes32 stateCode, bytes32 productId, uint256 principal) public view returns (uint256 total) {
        Band[] storage bands = bandsOf[keyOf(stateCode, productId)];
        uint256 lower;
        for (uint256 i = 0; i < bands.length && lower < principal; i++) {
            uint256 upper = bands[i].upperBound;
            total += ((principal < upper ? principal : upper) - lower) * bands[i].monthlyBps;
            lower = upper;
        }
        total *= RATE_SCALE;
    }

    /// @notice the Combined Ceiling's trim on a member's term plans (12.3).
    /// @dev Monthly figures (principal x monthly bps x RATE_SCALE): the revolving tiers' carry after
    /// their own caps, then each eligible plan's carry per 30-day cycle at its list rate after its own
    /// cap (decision C), oldest plan first. Their total never exceeds the graduated schedule on their
    /// combined principal: the revolving tiers come first, then the plans in the order given, so any
    /// excess comes off the newest plan first, then earlier plans. (The revolving tiers already keep
    /// within the schedule on their own principal, Boost trimmed first, so they are never trimmed
    /// here.) Returns what each plan may carry a month.
    function combinedTrim(
        bytes32 stateCode,
        bytes32 productId,
        uint256 revolvingPrincipal,
        uint256 revolvingMonthly,
        uint256[] calldata planPrincipals,
        uint256[] calldata planMonthly
    ) external view returns (uint256[] memory allowed) {
        uint256 n = planPrincipals.length;
        allowed = new uint256[](n);
        uint256 total = revolvingPrincipal;
        for (uint256 i = 0; i < n; i++) total += planPrincipals[i];
        uint256 cap = graduatedMonthly(stateCode, productId, total);
        uint256 budget = cap > revolvingMonthly ? cap - revolvingMonthly : 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 take = planMonthly[i] < budget ? planMonthly[i] : budget;
            allowed[i] = take;
            budget -= take;
        }
    }

    /// @notice `chargesSince`, with the cap taken as `capFor` this member.
    function chargesFor(address member, bytes32 stateCode, bytes32 productId, uint256 principal, Snapshot memory from)
        external
        view
        returns (uint256 listCarry, uint256 capCarry)
    {
        if (principal == 0) return (0, 0);
        listCarry = (principal * (snapshot(stateCode, productId).list - from.list)) / RAY;
        capCarry = capFor(member, stateCode, productId, principal, from);
    }

    /// @notice what a term plan of `principal` may be charged since `from`.
    /// @dev Decision C (Addendum 2): the plan's list rate per 30-day cycle on its remaining principal
    /// (the list accumulator, which runs at monthly x 12 / 365 per second, scaled by 365 / 360), then
    /// trimmed so it never exceeds the per-second-fitted cap on that principal, which is NOT scaled:
    /// the per-second index governs every cap. The large-loan cap is annual (Phase 4, M-D): once the
    /// plan, or the member's aggregate under DECISIONS #7, is at or above the threshold, the charge is
    /// never more than `annualCapBps` a year on this principal. The Combined Ceiling (12.3) is applied
    /// on top by the term issuer.
    function termChargeFor(address member, bytes32 stateCode, bytes32 productId, uint256 principal, Snapshot memory from)
        external
        view
        returns (uint256 charge)
    {
        if (principal == 0) return 0;
        Snapshot memory now_ = snapshot(stateCode, productId);
        uint256 listCarry = (principal * (now_.list - from.list)) / RAY;
        uint256 capCarry = _cap(stateCode, productId, principal, from, now_);
        listCarry = (listCarry * 365) / 360;
        charge = listCarry < capCarry ? listCarry : capCarry;
        uint256 threshold = products[keyOf(stateCode, productId)].params.largeLoanThreshold;
        if (threshold != 0 && (principal >= threshold || aggregatePrincipalOf(member) >= threshold)) {
            uint256 annual = (principal * (now_.annual - from.annual)) / RAY;
            if (annual < charge) charge = annual;
        }
    }

    /// @notice the monthly rate the cap allows on `principal`, in bps: what a full month of the
    /// graduated (or large-loan) schedule would charge, divided by the principal.
    function capMonthlyBps(bytes32 stateCode, bytes32 productId, uint256 principal)
        public
        view
        returns (uint256)
    {
        if (principal == 0) return 0;
        _product(stateCode, productId);
        return _capRate(stateCode, productId, principal) / RATE_SCALE;
    }

    /* ---- Phase 4b (L-G): effective rates for the repayment order ---- */

    /// @notice the unit the effective rates below are in: monthly basis points times 1e18.
    uint256 public constant RATE_SCALE = 1e18;

    /// @notice what each of a member's revolving positions costs from now, as a monthly rate
    /// scaled by RATE_SCALE, after the member-level ceiling (Phase 4b, L-G).
    /// @dev The issuer passes its tiers in tier order. A tier with no product, or whose product
    /// does not exist in `stateCode`, costs its own rate (`ownRates`, monthly bps). A priced tier
    /// costs its list rate, unless the list carry on all priced tiers together is over the graduated
    /// schedule on their total (the Combined Ceiling on the revolving tiers, 12.3); then the excess
    /// is taken off the last priced tier first, exactly as `_pendingCarry` trims accrual. So the order
    /// the ledger repays in follows what the member is actually charged.
    function revolvingRatesOf(
        bytes32 stateCode,
        bytes32 ceilingProduct,
        bytes32[] calldata productIds,
        uint256[] calldata principals,
        uint256[] calldata ownRates
    ) external view returns (uint256[] memory rates) {
        uint256 n = principals.length;
        rates = new uint256[](n);
        bool[] memory priced = new bool[](n);
        uint256 unsecured;
        uint256 carry;
        for (uint256 i = 0; i < n; i++) {
            if (productIds[i] == bytes32(0) || !hasProduct(stateCode, productIds[i])) {
                rates[i] = ownRates[i] * RATE_SCALE;
                continue;
            }
            priced[i] = true;
            rates[i] = uint256(products[keyOf(stateCode, productIds[i])].params.listMonthlyBps) * RATE_SCALE;
            unsecured += principals[i];
            carry += principals[i] * rates[i];
        }
        if (carry == 0 || !hasProduct(stateCode, ceilingProduct)) return rates;
        uint256 allowed = graduatedMonthly(stateCode, ceilingProduct, unsecured);
        if (carry <= allowed) return rates;
        uint256 excess = carry - allowed;
        for (uint256 i = n; i > 0 && excess > 0; i--) {
            uint256 k = i - 1;
            if (!priced[k] || principals[k] == 0) continue;
            uint256 tierCarry = principals[k] * rates[k];
            uint256 cut = tierCarry < excess ? tierCarry : excess;
            rates[k] = (tierCarry - cut) / principals[k];
            excess -= cut;
        }
    }

    /// @notice what a term plan of `principal` costs from now, as a monthly rate scaled by
    /// RATE_SCALE (Phase 4b, L-G): what `termChargeFor` charges, less the merchant's subsidy, stated
    /// per twelfth of a year so it compares with a revolving rate: the list rate per 30 days is x 365
    /// / 360 a month, and the per-second-fitted cap is the monthly cap itself (decision C). The
    /// Combined Ceiling's trim (12.3) is applied on top by the term issuer.
    function termRateOf(
        address member,
        bytes32 stateCode,
        bytes32 productId,
        uint256 principal,
        uint256 subsidyBps
    ) external view returns (uint256 rate) {
        if (principal == 0) return 0;
        ProductParams storage p = _product(stateCode, productId).params;
        rate = (uint256(p.listMonthlyBps) * RATE_SCALE * 365) / 360;
        uint256 cap = _capRate(stateCode, productId, principal);
        if (cap < rate) rate = cap;
        uint256 threshold = p.largeLoanThreshold;
        if (threshold != 0 && (principal >= threshold || aggregatePrincipalOf(member) >= threshold)) {
            uint256 annual = (uint256(p.annualCapBps) * RATE_SCALE) / 12;
            if (annual < rate) rate = annual;
        }
        uint256 subsidy = (subsidyBps * RATE_SCALE * 365) / 360;
        rate = rate > subsidy ? rate - subsidy : 0;
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

    /// @dev The cap on `principal` as a monthly rate scaled by RATE_SCALE: the large-loan annual cap
    /// per twelfth of a year, or the graduated schedule (or the flat alternative, if higher).
    function _capRate(bytes32 stateCode, bytes32 productId, uint256 principal) internal view returns (uint256) {
        ProductParams storage p = products[keyOf(stateCode, productId)].params;
        if (p.largeLoanThreshold != 0 && principal >= p.largeLoanThreshold) {
            return (uint256(p.annualCapBps) * RATE_SCALE) / 12;
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
        uint256 graduated = (charge * RATE_SCALE) / principal;
        uint256 flat = uint256(p.flatMonthlyBps) * RATE_SCALE;
        return flat > graduated ? flat : graduated;
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
