// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../core/interfaces/IHousingAllowanceRecord.sol";

interface IPointsIssuerMatch {
    function closeMatchPeriod(address member) external;
}

/// @title HousingAllowanceRecord
/// @notice A member's Housing Allowance: their equity toward a Clear home, on chain so the Deed
/// contracts can read it at Redemption.
/// @dev One record per member and home (the home's T-Deed token ID), in two parts shown as one total:
///  - the Credit Portion: Credits the member redeemed, credited by the Points Issuer, Clear-funded,
///    never paid in cash, capped per member for life;
///  - the Member Portion: the member's own money -- USDC or redeemed CLRUSD they send, and fiat
///    payments Clear records -- refunded if they leave.
///
/// **It holds no money (FIXED).** A member's USDC is pulled straight from their account to the home's
/// registered receiving account in the same call that records it. Nothing in this contract can be
/// transferred, and nothing in it earns anything.
contract HousingAllowanceRecord is IHousingAllowanceRecord, AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== CONSTANTS ========== */

    /// @notice Clear Properties' operations key: opens records, records fiat payments, moves, exits.
    bytes32 public constant HOUSING_WRITER_ROLE = keccak256("HOUSING_WRITER_ROLE");
    /// @notice How long a Credit Portion is kept for another home after an exit.
    uint64 public constant HOLD = 730 days;

    /* ========== TYPES ========== */

    enum Status {
        NONE,
        SIGNED,
        REDEEMED,
        MOVED,
        ENDED,
        LAPSED
    }

    struct Record {
        uint128 creditPortion;
        uint128 memberPortion;
        uint128 structurePrice;
        uint128 refundDue;
        uint64 signedAt;
        uint64 endedAt;
        Status status;
    }

    /* ========== STATE ========== */

    IERC20Upgradeable public usdc;
    address public pointsIssuer;
    address public deedContract;
    /// @notice The most Credit Portion a member may ever be credited, across every home (USD, 6 dp).
    uint256 public creditCap;

    mapping(address => mapping(uint256 => Record)) private _records;
    /// @notice The member whose record is live on a home, if any.
    mapping(uint256 => address) public occupantOf;
    /// @notice Every Credit Portion a member has ever been credited, lapsed amounts included.
    mapping(address => uint256) public lifetimeCreditPortion;
    /// @notice Where USDC paid toward a home goes. Set by the admin (the timelock).
    mapping(uint256 => address) public payeeOf;
    mapping(bytes32 => bool) public refUsed;

    uint256[40] private __gap;

    /* ========== ERRORS AND EVENTS ========== */

    error HousingNotSigned(address member, uint256 homeId);
    error HousingAlreadyOpen(address member, uint256 homeId);
    error HousingHomeOccupied(uint256 homeId, address occupant);
    error HousingOverCap(address member, uint256 wanted, uint256 left);
    error HousingNotPoints(address caller);
    error HousingNotDeed(address caller);
    error HousingRefUsed(bytes32 ref);
    error HousingNoPayee(uint256 homeId);
    error HousingZero();
    error HousingPriceRaise(uint256 current, uint256 wanted);
    error HousingNotRedeemable(uint256 homeId);
    error HousingDeductionsTooLarge(uint256 deductions, uint256 memberPortion);
    error HousingNotEnded(address member, uint256 homeId);
    error HousingHoldNotOver(uint64 until);
    error HousingNoEth();

    event RecordOpened(address indexed member, uint256 indexed homeId, uint256 structurePrice, uint256 carriedCredit, bytes32 ref);
    event CreditPortionAdded(address indexed member, uint256 indexed homeId, uint256 usd);
    event CreditPortionReversed(address indexed member, uint256 indexed homeId, uint256 usd);
    event MemberPaid(address indexed member, uint256 indexed homeId, uint256 usd, address indexed payee, bytes32 ref);
    event PaymentRecorded(address indexed member, uint256 indexed homeId, uint256 usd, bytes32 ref);
    event Moved(address indexed member, uint256 indexed fromHome, uint256 indexed toHome, uint256 deductions, uint256 credit, uint256 refundDue, bytes32 ref);
    event Ended(address indexed member, uint256 indexed homeId, uint256 deductions, uint256 refundDue, bytes32 ref);
    event Lapsed(address indexed member, uint256 indexed homeId, uint256 creditPortion);
    event Redeemed(address indexed member, uint256 indexed homeId, uint256 refundDue);
    event PriceLowered(address indexed member, uint256 indexed homeId, uint256 price, bytes32 reasonHash);
    event PayeeSet(uint256 indexed homeId, address payee);
    event PointsIssuerSet(address issuer);
    event DeedContractSet(address deed);
    event CreditCapSet(uint256 cap);

    /* ========== INITIALIZER ========== */

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address _usdc, address _pointsIssuer) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        usdc = IERC20Upgradeable(_usdc);
        pointsIssuer = _pointsIssuer;
        creditCap = 54_000e6;
    }

    receive() external payable {
        revert HousingNoEth();
    }

    /* ========== VIEWS ========== */

    function recordOf(address member, uint256 homeId) external view returns (Record memory) {
        return _records[member][homeId];
    }

    function totalOf(address member, uint256 homeId) public view returns (uint256) {
        Record storage r = _records[member][homeId];
        return uint256(r.creditPortion) + r.memberPortion;
    }

    /// @notice Whether the live record on a home has reached its price: what the Deed contracts read.
    function isRedeemable(uint256 homeId) public view returns (bool) {
        address m = occupantOf[homeId];
        if (m == address(0)) return false;
        Record storage r = _records[m][homeId];
        return r.status == Status.SIGNED && totalOf(m, homeId) >= r.structurePrice;
    }

    /* ========== OPENING ========== */

    /// @notice Opens a SIGNED record when a member signs an ELPA, and closes their Match Period.
    /// @param carryFromHome a home the member left within the hold, whose Credit Portion carries over
    /// (0 for none).
    function open(address member, uint256 homeId, uint256 structurePrice, uint256 carryFromHome, bytes32 ref)
        external
        onlyRole(HOUSING_WRITER_ROLE)
    {
        if (structurePrice == 0 || member == address(0)) revert HousingZero();
        _useRef(ref);
        Record storage r = _records[member][homeId];
        if (r.status != Status.NONE) revert HousingAlreadyOpen(member, homeId);
        address occ = occupantOf[homeId];
        if (occ != address(0)) revert HousingHomeOccupied(homeId, occ);

        uint256 carried;
        if (carryFromHome != 0) {
            Record storage old = _records[member][carryFromHome];
            if (old.status != Status.ENDED) revert HousingNotEnded(member, carryFromHome);
            if (block.timestamp > uint256(old.endedAt) + HOLD) revert HousingHoldNotOver(old.endedAt + HOLD);
            carried = old.creditPortion;
            old.creditPortion = 0;
        }

        r.structurePrice = uint128(structurePrice);
        r.creditPortion = uint128(carried);
        r.signedAt = uint64(block.timestamp);
        r.status = Status.SIGNED;
        occupantOf[homeId] = member;
        if (pointsIssuer != address(0)) IPointsIssuerMatch(pointsIssuer).closeMatchPeriod(member);
        emit RecordOpened(member, homeId, structurePrice, carried, ref);
    }

    /* ========== THE CREDIT PORTION ========== */

    /// @inheritdoc IHousingAllowanceRecord
    function creditFromCredits(address member, uint256 homeId, uint256 usd) external override {
        if (_msgSender() != pointsIssuer) revert HousingNotPoints(_msgSender());
        Record storage r = _signed(member, homeId);
        uint256 used = lifetimeCreditPortion[member];
        uint256 left = creditCap > used ? creditCap - used : 0;
        if (usd > left) revert HousingOverCap(member, usd, left);
        lifetimeCreditPortion[member] = used + usd;
        r.creditPortion += uint128(usd);
        emit CreditPortionAdded(member, homeId, usd);
    }

    /// @inheritdoc IHousingAllowanceRecord
    function reverseFromCredits(address member, uint256 homeId, uint256 usd) external override {
        if (_msgSender() != pointsIssuer) revert HousingNotPoints(_msgSender());
        Record storage r = _records[member][homeId];
        uint256 take = usd < r.creditPortion ? usd : r.creditPortion;
        r.creditPortion -= uint128(take);
        lifetimeCreditPortion[member] -= take;
        emit CreditPortionReversed(member, homeId, take);
    }

    /* ========== THE MEMBER PORTION ========== */

    /// @notice A member pays toward their home in USDC. The USDC goes straight from them to the home's
    /// payee in this call; this contract never holds it.
    function contribute(uint256 homeId, uint256 amount) external {
        if (amount == 0) revert HousingZero();
        address member = _msgSender();
        Record storage r = _signed(member, homeId);
        address payee = payeeOf[homeId];
        if (payee == address(0)) revert HousingNoPayee(homeId);
        // Pulled from the caller only: the member's own account, straight to the payee.
        usdc.safeTransferFrom(_msgSender(), payee, amount);
        r.memberPortion += uint128(amount);
        emit MemberPaid(member, homeId, amount, payee, keccak256(abi.encode(member, homeId, block.number, amount)));
    }

    /// @notice Records a fiat equity contribution or extra contribution on the day it settles.
    function recordPayment(address member, uint256 homeId, uint256 usd, bytes32 ref)
        external
        onlyRole(HOUSING_WRITER_ROLE)
    {
        if (usd == 0) revert HousingZero();
        _useRef(ref);
        Record storage r = _signed(member, homeId);
        r.memberPortion += uint128(usd);
        emit PaymentRecorded(member, homeId, usd, ref);
    }

    /* ========== MOVES, EXITS, LAPSE ========== */

    /// @notice Moves a member's whole Housing Allowance to a new home's record, less itemized
    /// deductions plus any improvement credit. If it already covers the new price, the excess is
    /// marked for refund, the Credit Portion counting toward the price first.
    function move(
        address member,
        uint256 fromHome,
        uint256 toHome,
        uint256 newPrice,
        uint256 deductions,
        uint256 credit,
        bytes32 ref
    ) external onlyRole(HOUSING_WRITER_ROLE) {
        if (newPrice == 0) revert HousingZero();
        _useRef(ref);
        Record storage from = _signed(member, fromHome);
        Record storage to = _records[member][toHome];
        if (to.status != Status.NONE) revert HousingAlreadyOpen(member, toHome);
        address occ = occupantOf[toHome];
        if (occ != address(0)) revert HousingHomeOccupied(toHome, occ);
        if (deductions > from.memberPortion) revert HousingDeductionsTooLarge(deductions, from.memberPortion);

        uint256 creditP = from.creditPortion;
        uint256 memberP = uint256(from.memberPortion) - deductions + credit;
        from.creditPortion = 0;
        from.memberPortion = 0;
        from.status = Status.MOVED;
        from.endedAt = uint64(block.timestamp);
        delete occupantOf[fromHome];

        uint256 refund;
        uint256 total = creditP + memberP;
        if (total > newPrice) {
            refund = total - newPrice;
            // The Credit Portion counts toward the price first, so the excess is the member's money.
            if (refund > memberP) refund = memberP;
            memberP -= refund;
        }
        to.structurePrice = uint128(newPrice);
        to.creditPortion = uint128(creditP);
        to.memberPortion = uint128(memberP);
        to.refundDue = uint128(refund);
        to.signedAt = uint64(block.timestamp);
        to.status = Status.SIGNED;
        occupantOf[toHome] = member;
        emit Moved(member, fromHome, toHome, deductions, credit, refund, ref);
    }

    /// @notice Ends a record before Redemption: the Member Portion less itemized deductions is due as
    /// the refund; the Credit Portion is kept for the hold, then lapses.
    function end(address member, uint256 homeId, uint256 deductions, bytes32 ref)
        external
        onlyRole(HOUSING_WRITER_ROLE)
    {
        _useRef(ref);
        Record storage r = _signed(member, homeId);
        if (deductions > r.memberPortion) revert HousingDeductionsTooLarge(deductions, r.memberPortion);
        uint256 refund = uint256(r.memberPortion) - deductions;
        r.refundDue += uint128(refund);
        r.memberPortion = 0;
        r.status = Status.ENDED;
        r.endedAt = uint64(block.timestamp);
        delete occupantOf[homeId];
        emit Ended(member, homeId, deductions, refund, ref);
    }

    /// @notice Anyone may lapse a Credit Portion once its hold is over.
    function lapse(address member, uint256 homeId) external {
        Record storage r = _records[member][homeId];
        if (r.status != Status.ENDED) revert HousingNotEnded(member, homeId);
        uint64 until = r.endedAt + HOLD;
        if (block.timestamp <= until) revert HousingHoldNotOver(until);
        uint256 cp = r.creditPortion;
        r.creditPortion = 0;
        r.status = Status.LAPSED;
        emit Lapsed(member, homeId, cp);
    }

    /// @notice The Deed contract marks a home redeemed when it transfers the Clear Deed. Anything above
    /// the price is the member's money and is marked for refund.
    function markRedeemed(uint256 homeId) external returns (address member) {
        if (_msgSender() != deedContract) revert HousingNotDeed(_msgSender());
        if (!isRedeemable(homeId)) revert HousingNotRedeemable(homeId);
        member = occupantOf[homeId];
        Record storage r = _records[member][homeId];
        uint256 total = totalOf(member, homeId);
        uint256 excess = total - r.structurePrice;
        if (excess > r.memberPortion) excess = r.memberPortion;
        r.memberPortion -= uint128(excess);
        r.refundDue += uint128(excess);
        r.status = Status.REDEEMED;
        delete occupantOf[homeId];
        emit Redeemed(member, homeId, excess);
    }

    /// @notice Lowers a home's price, never raises it, with the reason recorded.
    function lowerPrice(address member, uint256 homeId, uint256 price, bytes32 reasonHash)
        external
        onlyRole(HOUSING_WRITER_ROLE)
    {
        Record storage r = _signed(member, homeId);
        if (price == 0) revert HousingZero();
        if (price >= r.structurePrice) revert HousingPriceRaise(r.structurePrice, price);
        r.structurePrice = uint128(price);
        emit PriceLowered(member, homeId, price, reasonHash);
    }

    /* ========== ADMIN (the timelock) ========== */

    function setPayee(uint256 homeId, address payee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        payeeOf[homeId] = payee;
        emit PayeeSet(homeId, payee);
    }

    function setPointsIssuer(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pointsIssuer = issuer;
        emit PointsIssuerSet(issuer);
    }

    function setDeedContract(address deed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        deedContract = deed;
        emit DeedContractSet(deed);
    }

    function setCreditCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        creditCap = cap;
        emit CreditCapSet(cap);
    }

    /* ========== INTERNAL ========== */

    function _signed(address member, uint256 homeId) private view returns (Record storage r) {
        r = _records[member][homeId];
        if (r.status != Status.SIGNED) revert HousingNotSigned(member, homeId);
    }

    function _useRef(bytes32 ref) private {
        if (refUsed[ref]) revert HousingRefUsed(ref);
        refUsed[ref] = true;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
