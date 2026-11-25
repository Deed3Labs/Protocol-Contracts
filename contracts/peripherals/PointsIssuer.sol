// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./CreditIssuer.sol";
import "../core/interfaces/IHousingAllowanceRecord.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";

/// @title PointsIssuer
/// @notice Issues Clear Credits: non-transferable points on a Credits Ledger of their own.
/// @dev The Credits Ledger is a second StableCredit instance with no merchants, no payout pool and
/// no reserve token, whose only system recipient is this contract (P0 spike, PR #950). Credits are
/// mutual credit like the $10 offers: this contract holds a line, minting moves its balance down and
/// the member's up, and the line's negative balance is the co-op's outstanding points liability.
///
/// Credits leave a member only back to this line: redeemed into the member's Housing Allowance, spent on a registered use, or reversed for fraud. Each is a burn of the member's
/// credits against this line through `reversePurchase`, so nothing ever moves to a third party.
///
/// Credits Earned (`earnedOf`) counts every credit ever minted. Redeeming and spending never lower it;
/// only a reversal does (FIXED). The 15,000 housing threshold and the Assurance thresholds read it.
contract PointsIssuer is CreditIssuer, EIP712Upgradeable {
    /* ========== CONSTANTS ========== */

    bytes32 public constant CREDITS_MINTER_ROLE = keccak256("CREDITS_MINTER_ROLE");
    bytes32 public constant MEMBERS_ROLE = keccak256("CREDITS_MEMBERS_ROLE");
    bytes32 public constant CREDITS_REVIEW_ROLE = keccak256("CREDITS_REVIEW_ROLE");

    bytes32 public constant SAVING = "SAVING";
    bytes32 public constant RENT = "RENT";
    bytes32 public constant BILL = "BILL";

    /// @notice A lower Redemption Rate needs at least this much notice.
    uint64 public constant RATE_NOTICE = 30 days;
    /// @notice One dollar, in the rate's units (6 decimals of USD per whole credit).
    uint256 public constant ONE_DOLLAR = 1e6;

    bytes32 private constant REDEEM_TYPEHASH =
        keccak256("RedeemCredits(address member,uint256 homeId,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 private constant SPEND_TYPEHASH =
        keccak256("SpendCredits(address member,bytes32 useId,uint256 amount,uint256 nonce,uint256 deadline)");

    /* ========== TYPES ========== */

    struct MatchPeriod {
        uint64 start;
        uint64 end;
        bool closed;
    }

    struct Rate {
        uint64 from;
        uint128 usdPerCredit;
    }

    struct Mint {
        address member;
        uint128 amount;
        bytes32 source;
    }

    struct Reversal {
        address member;
        bytes32 ref;
        uint128 amount;
        uint256 homeId;
        uint128 redeemedUsd;
        bytes32 reasonHash;
        address proposer;
        bool done;
    }

    /* ========== STATE ========== */

    /// @notice The Housing Allowance Record credits are redeemed into.
    IHousingAllowanceRecord public housingRecord;

    /// @notice Sources a mint may name. SAVING, RENT and BILL are registered at initialization.
    mapping(bytes32 => bool) public sourceAllowed;
    /// @notice Uses credits may be spent on. None at launch.
    mapping(bytes32 => bool) public useAllowed;

    /// @notice Every mint, by its reference. A reference mints once (FIXED).
    mapping(bytes32 => Mint) public mintOf;

    mapping(address => uint256) public earnedOf;
    mapping(address => mapping(bytes32 => uint256)) public earnedBySource;
    /// @notice SAVING credits minted in a calendar month, by `yyyymm`.
    mapping(address => mapping(uint32 => uint256)) public savingMonth;
    mapping(address => MatchPeriod) public matchPeriodOf;
    mapping(address => uint256) public redeemedOf;
    mapping(address => uint256) public spentOf;
    mapping(address => uint256) public nonces;

    /// @notice SAVING credits a member may earn in a calendar month, and in all.
    uint256 public monthlySavingCap;
    uint256 public lifetimeSavingCap;
    /// @notice How long a Match Period runs once opened.
    uint64 public matchLength;

    /// @notice The Redemption Rate schedule, oldest first. Index 0 is the launch rate.
    Rate[] public rates;
    /// @notice A member's unredeemed credits, by the rate they were earned under).
    mapping(address => mapping(uint256 => uint256)) public lotOf;
    /// @notice The oldest rate index at which a member may still hold credits.
    mapping(address => uint256) public lotCursor;

    Reversal[] public reversals;

    uint256[30] private __gap;

    /* ========== ERRORS AND EVENTS ========== */

    error PointsIssuerRefUsed(bytes32 ref);
    error PointsIssuerSourceNotAllowed(bytes32 source);
    error PointsIssuerUseNotAllowed(bytes32 useId);
    error PointsIssuerNoMatchPeriod(address member);
    error PointsIssuerOutsideMatchPeriod(address member);
    error PointsIssuerMonthlyCap(address member, uint256 wanted, uint256 left);
    error PointsIssuerLifetimeCap(address member, uint256 wanted, uint256 left);
    error PointsIssuerMatchPeriodSet(address member);
    error PointsIssuerNotHousingRecord(address caller);
    error PointsIssuerBadSignature();
    error PointsIssuerExpired();
    error PointsIssuerInsufficient(address member, uint256 wanted, uint256 held);
    error PointsIssuerZero();
    error PointsIssuerRateTooSoon(uint64 from, uint64 earliest);
    error PointsIssuerRateOrder();
    error PointsIssuerSameReviewer();
    error PointsIssuerReversalDone(uint256 id);
    error PointsIssuerReversalTooLarge(bytes32 ref, uint256 amount, uint256 minted);
    error PointsIssuerNoHousingRecord();

    event CreditsMinted(address indexed member, uint256 amount, bytes32 indexed source, bytes32 indexed ref);
    event CreditsRedeemed(address indexed member, uint256 indexed homeId, uint256 amount, uint256 usd);
    event CreditsSpent(address indexed member, bytes32 indexed useId, uint256 amount);
    event MatchPeriodOpened(address indexed member, uint64 start, uint64 end);
    event MatchPeriodClosed(address indexed member, uint64 at);
    event RateScheduled(uint256 indexed index, uint64 from, uint128 usdPerCredit);
    event ReversalProposed(uint256 indexed id, address indexed member, bytes32 indexed ref, uint256 amount, bytes32 reasonHash);
    event CreditsReversed(uint256 indexed id, address indexed member, bytes32 indexed ref, uint256 amount, uint256 redeemedUsd);
    event SourceSet(bytes32 indexed source, bool allowed);
    event UseSet(bytes32 indexed useId, bool allowed);
    event HousingRecordSet(address indexed record);
    event LimitsSet(uint256 monthlySavingCap, uint256 lifetimeSavingCap, uint64 matchLength);
    event CapUpdated(uint256 cap);

    /* ========== INITIALIZER ========== */

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _creditsLedger) external initializer {
        __CreditIssuer_init(_creditsLedger);
        __EIP712_init("Clear Credits", "1");
        sourceAllowed[SAVING] = true;
        sourceAllowed[RENT] = true;
        sourceAllowed[BILL] = true;
        monthlySavingCap = 1_500 * ONE_DOLLAR;
        lifetimeSavingCap = 54_000 * ONE_DOLLAR;
        matchLength = 1096 days; // 36 months
        rates.push(Rate({from: uint64(block.timestamp), usdPerCredit: uint128(ONE_DOLLAR)}));
        emit RateScheduled(0, uint64(block.timestamp), uint128(ONE_DOLLAR));
    }

    /* ========== VIEWS ========== */

    /// @notice What this line may owe: the most credits outstanding at once.
    function cap() public view returns (uint256) {
        return stableCredit.creditLimitOf(address(this));
    }

    /// @notice Credits outstanding: the co-op's points liability.
    function outstanding() public view returns (uint256) {
        return stableCredit.creditBalanceOf(address(this));
    }

    function balanceOf(address member) external view returns (uint256) {
        return stableCredit.balanceOf(member);
    }

    function rateCount() external view returns (uint256) {
        return rates.length;
    }

    function reversalCount() external view returns (uint256) {
        return reversals.length;
    }

    /// @notice The rate index in force at `t`.
    function rateIndexAt(uint256 t) public view returns (uint256 i) {
        i = rates.length - 1;
        while (i > 0 && rates[i].from > t) i--;
    }

    /// @notice What redeeming `amount` of `member`'s credits now would add, in USD (6 decimals).
    function quote(address member, uint256 amount) public view returns (uint256 usd) {
        uint256 current = rates[rateIndexAt(block.timestamp)].usdPerCredit;
        uint256 left = amount;
        for (uint256 i = lotCursor[member]; i < rates.length && left > 0; i++) {
            uint256 lot = lotOf[member][i];
            if (lot == 0) continue;
            uint256 take = lot < left ? lot : left;
            uint256 r = rates[i].usdPerCredit;
            usd += (take * (r > current ? r : current)) / ONE_DOLLAR;
            left -= take;
        }
    }

    function redeemDigest(address member, uint256 homeId, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(REDEEM_TYPEHASH, member, homeId, amount, nonce, deadline)));
    }

    function spendDigest(address member, bytes32 useId, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(SPEND_TYPEHASH, member, useId, amount, nonce, deadline)));
    }

    /// @notice `yyyymm` for a timestamp, in UTC.
    function monthOf(uint256 t) public pure returns (uint32) {
        // Days to civil date (Howard Hinnant's algorithm).
        int256 z = int256(t / 1 days) + 719468;
        int256 era = (z >= 0 ? z : z - 146096) / 146097;
        int256 doe = z - era * 146097;
        int256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        int256 y = yoe + era * 400;
        int256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        int256 mp = (5 * doy + 2) / 153;
        int256 m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y += 1;
        return uint32(uint256(y * 100 + m));
    }

    /* ========== MATCH PERIOD ========== */

    /// @notice Opens a member's Match Period once, from their membership date.
    function openMatchPeriod(address member, uint64 start) external onlyCreditRole(MEMBERS_ROLE) notNull(member) {
        if (matchPeriodOf[member].start != 0) revert PointsIssuerMatchPeriodSet(member);
        if (start == 0) revert PointsIssuerZero();
        uint64 end = start + matchLength;
        matchPeriodOf[member] = MatchPeriod({start: start, end: end, closed: false});
        emit MatchPeriodOpened(member, start, end);
    }

    /// @notice Ends a member's Match Period early, on signing a Housing Agreement. Never reopened.
    function closeMatchPeriod(address member) external {
        if (_msgSender() != address(housingRecord)) revert PointsIssuerNotHousingRecord(_msgSender());
        MatchPeriod storage p = matchPeriodOf[member];
        if (p.closed) return;
        p.closed = true;
        if (p.start == 0) p.start = uint64(block.timestamp);
        if (p.end > block.timestamp || p.end == 0) p.end = uint64(block.timestamp);
        emit MatchPeriodClosed(member, uint64(block.timestamp));
    }

    /* ========== MINT ========== */

    /// @notice Mints credits a member has earned in full. Each `ref` mints once.
    function mint(address member, uint256 amount, bytes32 source, bytes32 ref)
        external
        onlyCreditRole(CREDITS_MINTER_ROLE)
        notNull(member)
        whenNotPaused
    {
        if (amount == 0) revert PointsIssuerZero();
        if (!sourceAllowed[source]) revert PointsIssuerSourceNotAllowed(source);
        if (mintOf[ref].member != address(0)) revert PointsIssuerRefUsed(ref);

        if (source == SAVING) _checkSaving(member, amount);

        mintOf[ref] = Mint({member: member, amount: uint128(amount), source: source});
        earnedOf[member] += amount;
        earnedBySource[member][source] += amount;
        lotOf[member][rateIndexAt(block.timestamp)] += amount;

        INetworkRegistry registry = stableCredit.networkRegistry();
        if (!registry.isEnrolled(member, address(this))) stableCredit.createCreditLine(member, 0, 0);
        stableCredit.transfer(member, amount);
        emit CreditsMinted(member, amount, source, ref);
    }

    function _checkSaving(address member, uint256 amount) private {
        MatchPeriod memory p = matchPeriodOf[member];
        if (p.start == 0) revert PointsIssuerNoMatchPeriod(member);
        if (block.timestamp < p.start || block.timestamp >= p.end) revert PointsIssuerOutsideMatchPeriod(member);
        uint32 month = monthOf(block.timestamp);
        uint256 used = savingMonth[member][month];
        uint256 mLeft = monthlySavingCap > used ? monthlySavingCap - used : 0;
        if (amount > mLeft) revert PointsIssuerMonthlyCap(member, amount, mLeft);
        uint256 lifetime = earnedBySource[member][SAVING];
        uint256 lLeft = lifetimeSavingCap > lifetime ? lifetimeSavingCap - lifetime : 0;
        if (amount > lLeft) revert PointsIssuerLifetimeCap(member, amount, lLeft);
        savingMonth[member][month] = used + amount;
    }

    /* ========== REDEEM AND SPEND ========== */

    /// @notice Redeems a member's credits into the Credit Portion of their Housing Allowance, on their signature. Anyone may submit it. The record refuses it before an ELPA is
    /// signed, and above the lifetime cap.
    function redeem(address member, uint256 homeId, uint256 amount, uint256 deadline, bytes calldata sig)
        external
        whenNotPaused
        returns (uint256 usd)
    {
        if (address(housingRecord) == address(0)) revert PointsIssuerNoHousingRecord();
        if (amount == 0) revert PointsIssuerZero();
        if (block.timestamp > deadline) revert PointsIssuerExpired();
        bytes32 digest = redeemDigest(member, homeId, amount, nonces[member], deadline);
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(member, digest, sig)) revert PointsIssuerBadSignature();
        nonces[member]++;

        usd = _consumeLots(member, amount);
        _takeBack(member, amount);
        redeemedOf[member] += amount;
        housingRecord.creditFromCredits(member, homeId, usd);
        emit CreditsRedeemed(member, homeId, amount, usd);
    }

    /// @notice Spends a member's credits on a registered use, on their signature.
    function spend(address member, bytes32 useId, uint256 amount, uint256 deadline, bytes calldata sig)
        external
        whenNotPaused
    {
        if (!useAllowed[useId]) revert PointsIssuerUseNotAllowed(useId);
        if (amount == 0) revert PointsIssuerZero();
        if (block.timestamp > deadline) revert PointsIssuerExpired();
        bytes32 digest = spendDigest(member, useId, amount, nonces[member], deadline);
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(member, digest, sig)) revert PointsIssuerBadSignature();
        nonces[member]++;

        _consumeLots(member, amount);
        _takeBack(member, amount);
        spentOf[member] += amount;
        emit CreditsSpent(member, useId, amount);
    }

    /// @dev Takes `amount` from a member's lots, oldest first, and prices it).
    function _consumeLots(address member, uint256 amount) private returns (uint256 usd) {
        uint256 held = stableCredit.balanceOf(member);
        if (held < amount) revert PointsIssuerInsufficient(member, amount, held);
        uint256 current = rates[rateIndexAt(block.timestamp)].usdPerCredit;
        uint256 left = amount;
        uint256 i = lotCursor[member];
        for (; i < rates.length && left > 0; i++) {
            uint256 lot = lotOf[member][i];
            if (lot == 0) continue;
            uint256 take = lot < left ? lot : left;
            lotOf[member][i] = lot - take;
            uint256 r = rates[i].usdPerCredit;
            usd += (take * (r > current ? r : current)) / ONE_DOLLAR;
            left -= take;
            if (lot == take) lotCursor[member] = i + 1;
        }
        if (left > 0) revert PointsIssuerInsufficient(member, amount, amount - left);
    }

    /// @dev Burns a member's credits against this line: the grant run backwards.
    function _takeBack(address member, uint256 amount) private {
        stableCredit.reversePurchase(address(this), amount, member, amount, address(0), 0);
    }

    /* ========== REVERSAL ========== */

    /// @notice Proposes reversing credits minted under `ref`. `redeemedUsd` is the dollar value of
    /// any of them already redeemed, taken back from `homeId`'s Credit Portion.
    function proposeReversal(bytes32 ref, uint256 amount, uint256 homeId, uint256 redeemedUsd, bytes32 reasonHash)
        external
        onlyCreditRole(CREDITS_REVIEW_ROLE)
        returns (uint256 id)
    {
        Mint memory m = mintOf[ref];
        if (amount == 0) revert PointsIssuerZero();
        if (amount > m.amount) revert PointsIssuerReversalTooLarge(ref, amount, m.amount);
        id = reversals.length;
        reversals.push(
            Reversal({
                member: m.member,
                ref: ref,
                amount: uint128(amount),
                homeId: homeId,
                redeemedUsd: uint128(redeemedUsd),
                reasonHash: reasonHash,
                proposer: _msgSender(),
                done: false
            })
        );
        emit ReversalProposed(id, m.member, ref, amount, reasonHash);
    }

    /// @notice A second reviewer carries out a proposed reversal. Only the credits of that ref are
    /// touched; Credits Earned and the source total fall by the same amount (FIXED).
    function approveReversal(uint256 id) external onlyCreditRole(CREDITS_REVIEW_ROLE) {
        Reversal storage r = reversals[id];
        if (r.done) revert PointsIssuerReversalDone(id);
        if (r.proposer == _msgSender()) revert PointsIssuerSameReviewer();
        r.done = true;

        Mint storage m = mintOf[r.ref];
        uint256 amount = r.amount;
        m.amount -= uint128(amount);
        earnedOf[r.member] -= amount;
        earnedBySource[r.member][m.source] -= amount;

        uint256 held = stableCredit.balanceOf(r.member);
        uint256 fromBalance = held < amount ? held : amount;
        if (fromBalance > 0) {
            _consumeLots(r.member, fromBalance);
            _takeBack(r.member, fromBalance);
        }
        if (r.redeemedUsd > 0) {
            if (address(housingRecord) == address(0)) revert PointsIssuerNoHousingRecord();
            housingRecord.reverseFromCredits(r.member, r.homeId, r.redeemedUsd);
        }
        emit CreditsReversed(id, r.member, r.ref, amount, r.redeemedUsd);
    }

    /* ========== HOOKS ========== */

    /// @dev Credits move only between this line and a member (FIXED). The ledger already refuses
    /// every other recipient; this is the issuer saying so too.
    function _validateCreditTransaction(address sender, address recipient, uint256)
        internal
        view
        override
        returns (bool)
    {
        return sender == address(this) || recipient == address(this);
    }

    /// @dev Nothing to track: credits carry no income or debt-seconds.
    function _syncCreditPositions(address, address, uint256) internal override {}

    /* ========== SETTINGS (owner: the timelock) ========== */

    /// @notice Sets the most credits that may be outstanding at once.
    function setCap(uint256 _cap) external onlyOwner {
        INetworkRegistry registry = stableCredit.networkRegistry();
        if (!registry.isEnrolled(address(this), address(this))) stableCredit.createCreditLine(address(this), _cap, 0);
        else stableCredit.updateCreditLimit(address(this), _cap);
        emit CapUpdated(_cap);
    }

    /// @notice Schedules a Redemption Rate. It takes effect no sooner than 30 days from now, and a
    /// lower rate applies only to credits minted after it (FIXED, by the lots).
    function scheduleRate(uint128 usdPerCredit, uint64 from) external onlyOwner {
        uint64 earliest = uint64(block.timestamp) + RATE_NOTICE;
        if (from < earliest) revert PointsIssuerRateTooSoon(from, earliest);
        if (from <= rates[rates.length - 1].from) revert PointsIssuerRateOrder();
        if (usdPerCredit == 0) revert PointsIssuerZero();
        rates.push(Rate({from: from, usdPerCredit: usdPerCredit}));
        emit RateScheduled(rates.length - 1, from, usdPerCredit);
    }

    function setHousingRecord(address record) external onlyOwner {
        housingRecord = IHousingAllowanceRecord(record);
        emit HousingRecordSet(record);
    }

    function setSource(bytes32 source, bool allowed) external onlyOwner {
        sourceAllowed[source] = allowed;
        emit SourceSet(source, allowed);
    }

    function setUse(bytes32 useId, bool allowed) external onlyOwner {
        useAllowed[useId] = allowed;
        emit UseSet(useId, allowed);
    }

    function setLimits(uint256 _monthlySavingCap, uint256 _lifetimeSavingCap, uint64 _matchLength) external onlyOwner {
        monthlySavingCap = _monthlySavingCap;
        lifetimeSavingCap = _lifetimeSavingCap;
        matchLength = _matchLength;
        emit LimitsSet(_monthlySavingCap, _lifetimeSavingCap, _matchLength);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
