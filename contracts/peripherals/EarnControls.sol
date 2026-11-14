// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "./interfaces/IEarnControls.sol";

/// @title EarnControls
/// @notice The one governed contract the Earn products share (Phase 2f, decision 1): the Funding
/// Limit, the offering cap, eligibility by attestation, the 10% holder cap per member, the Ladder,
/// the Successor path and the transfer policy. The Yield Pool reads it through `IPoolEarnControls`;
/// the bond collections, the BondVault and the Collateral Agent through `IEarnControls`.
/// @dev Nothing here holds, moves or freezes a position or any USDC. Every function either answers
/// a question or refuses a new purchase or subscription; none reaches a Member's Smart Account.
///
/// Powers, all granted by the Earn timelock (`DEFAULT_ADMIN_ROLE`, decision 2) with a Lending Board
/// resolution hash (§10):
/// - `DEFAULT_ADMIN_ROLE`: the governed settings (Funding Limit, offering cap, holder cap and its
///   floor, the Ladder, the refused Clear payers, the sources) and upgrades.
/// - `ATTESTER_ROLE`: signs eligibility attestations (IV-02 §2.1) off chain. Holds no transaction.
/// - `EQUITY_CUSHION_ROLE`: sets and clears the Equity Cushion pause, two people (L-01 §8.6A).
/// - `SUCCESSOR_ROLE`: approves a Successor transfer or registers a Successor for payment, two
///   people with an evidence hash (IV-01 §6.3).
/// - `ELIGIBILITY_ROLE`: sets and clears the holder-ineligible flag, two people with an evidence
///   hash (§2).
/// - `BOND_ROLE`: a bond collection, which may call `checkPurchase`.
contract EarnControls is IEarnControls, AccessControlUpgradeable, UUPSUpgradeable, EIP712Upgradeable {
    using MathUpgradeable for uint256;

    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant EQUITY_CUSHION_ROLE = keccak256("EQUITY_CUSHION_ROLE");
    bytes32 public constant SUCCESSOR_ROLE = keccak256("SUCCESSOR_ROLE");
    bytes32 public constant ELIGIBILITY_ROLE = keccak256("ELIGIBILITY_ROLE");
    bytes32 public constant BOND_ROLE = keccak256("BOND_ROLE");

    /// @notice EIP-712 type of an eligibility attestation (IV-02 §2.1) with its exemption tag.
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "EligibilityAttestation(address account,bytes32 exemptionCode,uint64 issuedAt,uint64 validUntil)"
    );

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    /// @notice FIXED: the smallest BurnerBond Purchase Price, in dollars (§1).
    uint256 public constant MIN_PURCHASE_DOLLARS = 250;
    /// @notice How long a scheduled holder-cap floor waits before it applies.
    uint64 public constant HOLDER_CAP_FLOOR_DELAY = 7 days;
    /// @notice How long an approved Successor transfer stays open.
    uint64 public constant SUCCESSOR_WINDOW = 30 days;
    /// @notice How long a Successor registered for payment waits before payments go to it; the
    /// Holder's own account may cancel it meanwhile, or at any time after.
    uint64 public constant PAYEE_DELAY = 7 days;
    /// @notice Bounds on the Ladder: terms up to 30 years, yields below 50%.
    uint32 public constant MAX_TERM_DAYS = 10_950;
    uint32 public constant MAX_YIELD_BPS = 5_000;
    uint256 public constant MAX_LADDER_TERMS = 32;
    uint256 public constant MAX_BOND_BOOKS = 8;

    struct Eligibility {
        bytes32 exemptionCode;
        address attester;
        uint64 issuedAt;
        uint64 validUntil;
    }

    struct Rung {
        uint32 yieldBps;
        bool offered;
        bool listed;
    }

    struct SuccessorApproval {
        uint64 approvedAt;
        bytes32 evidenceHash;
    }

    struct PaymentSuccessor {
        address payee;
        uint64 effectiveAt;
        bytes32 evidenceHash;
    }

    /// @notice 10^decimals of the reserve token (USDC: 10^6).
    uint256 public unit;
    IEarnMembership public membership;
    /// @notice The Yield Pool (LendingPool), the only caller of `checkSubscription`.
    address public yieldPool;
    /// @notice BondVault Reserve Shortfall state; unset until stage 2 adds it to the BondVault.
    address public reserveStatus;
    /// @notice The Collateral Agent whose Enforcement Notice stops purchases and rolls.
    address public collateralAgent;
    /// @notice Told when the holder-ineligible flag or a term's offer changes; unset until stage 2.
    address public reserveHook;
    address[] internal _bondBooks;

    /// @notice The Funding Limit (L-01; H-01 §8.1(g)), in reserve-token units.
    uint256 public fundingLimit;
    bytes32 public fundingLimitResolution;
    uint16 public fundingLimitFiscalYear;

    /// @notice The BurnerBond offering cap and the cumulative Purchase Price taken (decision 12).
    uint256 public offeringCap;
    uint256 public offeringTaken;

    /// @notice The holder cap as a share of outstanding Pool Shares (§6; 1,000 = 10%).
    uint256 public holderCapBps;
    uint256 internal _holderCapFloor;
    uint256 internal _pendingHolderCapFloor;
    uint64 internal _holderCapFloorAt;

    bool public equityCushionPaused;

    mapping(address => bool) public refused;
    mapping(address => Eligibility) internal _eligibility;
    mapping(address => bool) public holderIneligible;
    mapping(uint32 => Rung) internal _rungs;
    uint32[] internal _terms;
    mapping(address => mapping(address => SuccessorApproval)) internal _successorTransfers;
    mapping(address => PaymentSuccessor) internal _payees;
    mapping(bytes32 => address) internal _proposerOf;

    uint256[40] private __gap;

    event FundingLimitSet(uint256 limit, bytes32 indexed resolutionHash, uint16 fiscalYear);
    event OfferingCapSet(uint256 cap);
    event OfferingTaken(address indexed holder, uint256 purchasePrice, uint256 taken);
    event HolderCapSet(uint256 bps);
    event HolderCapFloorScheduled(uint256 current, uint256 next, uint64 effectiveAt);
    event RefusedSet(address indexed account, bool refused);
    event SourcesSet(address membership, address yieldPool, address reserveStatus, address collateralAgent, address reserveHook);
    event BondBooksSet(address[] books);
    event EligibilityAttested(address indexed account, address indexed attester, bytes32 exemptionCode, uint64 issuedAt, uint64 validUntil);
    event EquityCushionPauseSet(bool paused, bytes32 reasonHash, address proposer, address approver);
    event HolderIneligibleSet(address indexed holder, bool ineligible, bytes32 evidenceHash);
    event RungSet(uint32 indexed termDays, uint32 yieldBps, bool offered);
    event SuccessorTransferApproved(address indexed from, address indexed to, bytes32 evidenceHash, uint64 openUntil);
    event PaymentSuccessorRegistered(address indexed holder, address indexed payee, bytes32 evidenceHash, uint64 effectiveAt);
    event PaymentSuccessorCancelled(address indexed holder, address indexed payee);
    event RoleGrantedByResolution(bytes32 indexed role, address indexed account, bytes32 indexed resolutionHash);
    event ActionProposed(bytes32 indexed action, address indexed proposer);
    event ActionApproved(bytes32 indexed action, address indexed proposer, address indexed approver);

    error EarnControlsInvalidAddress();
    error EarnControlsInvalidValue();
    error EarnControlsNotAuthorized(address caller);
    error EarnControlsSameSigner(address signer);
    error EarnControlsUseResolution();
    error EarnControlsPaused();
    error EarnControlsRefused(address account);
    error EarnControlsNotSameHolder(address payer, address receiver);
    error EarnControlsIneligible(address account);
    error EarnControlsBadAttestation();
    error EarnControlsBelowMinimum(uint256 purchasePrice);
    error EarnControlsTermNotOffered(uint32 termDays);
    error EarnControlsFundingLimit(uint256 used, uint256 adding, uint256 limit);
    error EarnControlsOfferingCap(uint256 taken, uint256 adding, uint256 cap);
    error EarnControlsHolderCap(address receiver, uint256 held, uint256 limit);
    error EarnControlsNothingToCancel(address holder);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin the Earn timelock (decision 2)
    /// @param decimals_ the reserve token's decimals (USDC: 6)
    /// @param membership_ the MembershipRegistry
    /// @param fundingLimit_ the Funding Limit, in reserve-token units, with its resolution
    /// @param offeringCap_ the BurnerBond offering cap, in reserve-token units (initial $1,000,000)
    /// @param holderCapFloor_ Pool Assets at or below which the holder cap does not apply
    function initialize(
        address admin,
        uint8 decimals_,
        address membership_,
        uint256 fundingLimit_,
        bytes32 fundingResolution_,
        uint16 fiscalYear_,
        uint256 offeringCap_,
        uint256 holderCapFloor_
    ) external initializer {
        if (admin == address(0)) revert EarnControlsInvalidAddress();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __EIP712_init("EarnControls", "1");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        unit = 10 ** uint256(decimals_);
        membership = IEarnMembership(membership_);
        fundingLimit = fundingLimit_;
        fundingLimitResolution = fundingResolution_;
        fundingLimitFiscalYear = fiscalYear_;
        offeringCap = offeringCap_;
        holderCapBps = 1_000;
        _holderCapFloor = holderCapFloor_;
        emit FundingLimitSet(fundingLimit_, fundingResolution_, fiscalYear_);
        emit OfferingCapSet(offeringCap_);
        emit HolderCapSet(1_000);
        emit HolderCapFloorScheduled(0, holderCapFloor_, uint64(block.timestamp));
    }

    /* ========== ROLES (§10: granted only with a Lending Board resolution) ========== */

    /// @notice Refused: grant with `grantRoleByResolution`, which records the resolution hash.
    function grantRole(bytes32, address) public pure override {
        revert EarnControlsUseResolution();
    }

    /// @notice Grants `role` with the Lending Board resolution that approved it (§10).
    function grantRoleByResolution(bytes32 role, address account, bytes32 resolutionHash)
        external
        onlyRole(getRoleAdmin(role))
    {
        if (resolutionHash == bytes32(0) || account == address(0)) revert EarnControlsInvalidValue();
        _grantRole(role, account);
        emit RoleGrantedByResolution(role, account, resolutionHash);
    }

    /* ========== THE POOL'S QUESTIONS (IPoolEarnControls) ========== */

    /// @inheritdoc IPoolEarnControls
    /// @dev Only the Yield Pool may ask, since an attestation passed here is recorded. The pool
    /// calls this before it takes the USDC, so the holder cap is counted on the figures after the
    /// subscription: the receiver's member's shares plus those minted, against the supply plus
    /// those minted, and only while Pool Assets after it exceed `holderCapFloor()`.
    function checkSubscription(address payer, address receiver, uint256 assets, bytes calldata attestation)
        external
        returns (bytes32 exemptionCode)
    {
        address pool = yieldPool;
        if (msg.sender != pool || pool == address(0)) revert EarnControlsNotAuthorized(msg.sender);
        if (subscriptionsPaused()) revert EarnControlsPaused();
        _checkParties(payer, receiver);
        exemptionCode = _eligible(payer, attestation);
        uint256 used = fundingUsed();
        if (used + assets > fundingLimit) revert EarnControlsFundingLimit(used, assets, fundingLimit);
        IEarnPoolView p = IEarnPoolView(pool);
        uint256 shares = p.previewDeposit(assets);
        if (p.totalAssets() + assets > holderCapFloor()) {
            uint256 held = shares;
            address[] memory wallets = walletsOf(receiver);
            for (uint256 i; i < wallets.length; ++i) {
                held += p.balanceOf(wallets[i]) + p.queuedSharesOf(wallets[i]);
            }
            uint256 limit = ((p.totalSupply() + shares) * holderCapBps) / BPS;
            if (held > limit) revert EarnControlsHolderCap(receiver, held, limit);
        }
    }

    /// @inheritdoc IPoolEarnControls
    function subscriptionsPaused() public view returns (bool) {
        return equityCushionPaused || _reserveShortfall();
    }

    /// @inheritdoc IPoolEarnControls
    function walletsOf(address account) public view returns (address[] memory wallets) {
        IEarnMembership m = membership;
        uint256 id = address(m) == address(0) ? 0 : m.walletToMemberId(account);
        if (id == 0) {
            wallets = new address[](1);
            wallets[0] = account;
            return wallets;
        }
        return m.getLinkedWallets(id);
    }

    /// @inheritdoc IPoolEarnControls
    function transferAllowed(address from, address to) external view returns (bool) {
        if (sameHolder(from, to)) return true;
        SuccessorApproval storage a = _successorTransfers[from][to];
        return a.approvedAt != 0 && block.timestamp <= uint256(a.approvedAt) + SUCCESSOR_WINDOW;
    }

    /* ========== THE BONDS' QUESTIONS (IEarnControls) ========== */

    /// @inheritdoc IEarnControls
    function checkPurchase(
        address payer,
        address holder,
        uint256 purchasePrice,
        uint256 maturityAmount,
        uint32 termDays,
        bytes calldata attestation
    ) external onlyRole(BOND_ROLE) returns (bytes32 exemptionCode) {
        if (purchasesPaused()) revert EarnControlsPaused();
        _checkParties(payer, holder);
        if (purchasePrice < MIN_PURCHASE_DOLLARS * unit) revert EarnControlsBelowMinimum(purchasePrice);
        if (!_rungs[termDays].offered) revert EarnControlsTermNotOffered(termDays);
        exemptionCode = _eligible(payer, attestation);
        uint256 used = fundingUsed();
        if (used + maturityAmount > fundingLimit) revert EarnControlsFundingLimit(used, maturityAmount, fundingLimit);
        uint256 taken = offeringTaken;
        if (taken + purchasePrice > offeringCap) revert EarnControlsOfferingCap(taken, purchasePrice, offeringCap);
        offeringTaken = taken + purchasePrice;
        emit OfferingTaken(holder, purchasePrice, taken + purchasePrice);
    }

    /// @inheritdoc IEarnControls
    function purchasesPaused() public view returns (bool) {
        return equityCushionPaused || _reserveShortfall() || _enforcement();
    }

    /// @inheritdoc IEarnControls
    function rollAllowed() external view returns (bool) {
        return !_enforcement();
    }

    /// @inheritdoc IEarnControls
    function isTermOffered(uint32 termDays) external view returns (bool) {
        return _rungs[termDays].offered;
    }

    /// @inheritdoc IEarnControls
    function ladderYieldBps(uint32 termDays) external view returns (uint32) {
        return _rungs[termDays].yieldBps;
    }

    /// @notice every term ever listed on the Ladder, offered or not.
    function ladderTerms() external view returns (uint32[] memory) {
        return _terms;
    }

    /// @inheritdoc IEarnControls
    function rollTermFor(uint32 termDays) public view returns (uint32 best) {
        if (_rungs[termDays].offered) return termDays;
        uint32[] memory terms = _terms;
        for (uint256 i; i < terms.length; ++i) {
            uint32 t = terms[i];
            if (t < termDays && t > best && _rungs[t].offered) best = t;
        }
    }

    /// @inheritdoc IEarnControls
    function rollYieldFor(uint32 rollTerm, uint32 noticeYieldBps) external view returns (uint32) {
        uint32 ladder = _rungs[rollTerm].offered ? _rungs[rollTerm].yieldBps : 0;
        return ladder > noticeYieldBps ? ladder : noticeYieldBps;
    }

    /// @inheritdoc IEarnControls
    function payeeOf(address holder) external view returns (address) {
        PaymentSuccessor storage p = _payees[holder];
        return p.payee != address(0) && block.timestamp >= p.effectiveAt ? p.payee : holder;
    }

    /// @notice the Successor registered for payment for `holder`, if any, and when it applies.
    function paymentSuccessorOf(address holder) external view returns (address payee, uint64 effectiveAt, bytes32 evidenceHash) {
        PaymentSuccessor storage p = _payees[holder];
        return (p.payee, p.effectiveAt, p.evidenceHash);
    }

    /// @notice an approved Successor transfer from `from` to `to`, open until `approvedAt + 30 days`.
    function successorTransfer(address from, address to) external view returns (uint64 approvedAt, bytes32 evidenceHash) {
        SuccessorApproval storage a = _successorTransfers[from][to];
        return (a.approvedAt, a.evidenceHash);
    }

    /// @inheritdoc IEarnControls
    function sameHolder(address a, address b) public view returns (bool) {
        if (a == b) return true;
        IEarnMembership m = membership;
        if (address(m) == address(0)) return false;
        uint256 id = m.walletToMemberId(a);
        return id != 0 && id == m.walletToMemberId(b);
    }

    /* ========== FUNDING LIMIT, CAPS AND ELIGIBILITY ========== */

    /// @notice what counts against the Funding Limit (decision 12): outstanding BurnerBonds at their
    /// Maturity Amount, plus outstanding Pool Shares at Share Value (rounded up).
    function fundingUsed() public view returns (uint256 used) {
        address[] memory books = _bondBooks;
        for (uint256 i; i < books.length; ++i) used += IEarnBondBook(books[i]).totalFaceOutstanding();
        address pool = yieldPool;
        if (pool != address(0)) {
            IEarnPoolView p = IEarnPoolView(pool);
            used += p.totalSupply().mulDiv(p.shareValue(), WAD, MathUpgradeable.Rounding.Up);
        }
    }

    /// @notice what is left under the Funding Limit.
    function fundingRoom() external view returns (uint256) {
        uint256 used = fundingUsed();
        return used >= fundingLimit ? 0 : fundingLimit - used;
    }

    /// @notice the BondVaults whose outstanding Maturity Amounts count against the Funding Limit.
    function bondBooks() external view returns (address[] memory) {
        return _bondBooks;
    }

    /// @notice Pool Assets at or below which the 10% holder cap does not apply (the bootstrap floor).
    function holderCapFloor() public view returns (uint256) {
        uint64 at = _holderCapFloorAt;
        return at != 0 && block.timestamp >= at ? _pendingHolderCapFloor : _holderCapFloor;
    }

    /// @notice a scheduled floor and when it applies (0 when none is pending).
    function pendingHolderCapFloor() external view returns (uint256 floor, uint64 effectiveAt) {
        uint64 at = _holderCapFloorAt;
        if (at == 0 || block.timestamp >= at) return (0, 0);
        return (_pendingHolderCapFloor, at);
    }

    /// @notice the eligibility on record for `account`.
    function eligibilityOf(address account) external view returns (Eligibility memory) {
        return _eligibility[account];
    }

    /// @notice whether `account` holds an eligibility attestation in force, and its tag.
    function isEligible(address account) external view returns (bool, bytes32) {
        Eligibility storage e = _eligibility[account];
        bool ok = e.exemptionCode != bytes32(0) && block.timestamp <= e.validUntil && hasRole(ATTESTER_ROLE, e.attester);
        return (ok, e.exemptionCode);
    }

    /// @notice records an eligibility attestation ahead of a purchase or subscription. Anyone may
    /// submit one: it counts only if an attester signed it for that account.
    function attestEligibility(address account, bytes calldata attestation) external returns (bytes32) {
        if (attestation.length == 0) revert EarnControlsBadAttestation();
        return _eligible(account, attestation);
    }

    /// @notice the EIP-712 digest an attester signs for `account`.
    function attestationDigest(address account, bytes32 exemptionCode, uint64 issuedAt, uint64 validUntil)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, account, exemptionCode, issuedAt, validUntil)));
    }

    /* ========== TWO-PERSON ACTIONS ========== */

    /// @notice sets or clears the Equity Cushion pause (L-01 §8.6A). It stops new purchases and
    /// subscriptions only: never a roll, a redemption or a withdrawal.
    function setEquityCushionPause(bool paused, bytes32 reasonHash) external {
        (bool done, address first) =
            _pair(keccak256(abi.encode(this.setEquityCushionPause.selector, paused, reasonHash)), EQUITY_CUSHION_ROLE);
        if (!done) return;
        equityCushionPaused = paused;
        emit EquityCushionPauseSet(paused, reasonHash, first, msg.sender);
    }

    /// @notice sets or clears the holder-ineligible flag (§2): a flagged Holder's bonds do not roll.
    function setHolderIneligible(address holder, bool ineligible, bytes32 evidenceHash) external {
        if (holder == address(0) || evidenceHash == bytes32(0)) revert EarnControlsInvalidValue();
        (bool done,) = _pair(
            keccak256(abi.encode(this.setHolderIneligible.selector, holder, ineligible, evidenceHash)), ELIGIBILITY_ROLE
        );
        if (!done) return;
        holderIneligible[holder] = ineligible;
        emit HolderIneligibleSet(holder, ineligible, evidenceHash);
        address hook = reserveHook;
        if (hook != address(0)) IEarnControlsHook(hook).holderEligibilityChanged(holder, ineligible);
    }

    /// @notice opens the Successor path (IV-01 §6.3) from a Holder's account to the Successor's
    /// verified Smart Account for 30 days. The transfer itself is still signed from `from`.
    function approveSuccessorTransfer(address from, address to, bytes32 evidenceHash) external {
        if (from == address(0) || to == address(0) || from == to || evidenceHash == bytes32(0)) {
            revert EarnControlsInvalidValue();
        }
        (bool done,) = _pair(
            keccak256(abi.encode(this.approveSuccessorTransfer.selector, from, to, evidenceHash)), SUCCESSOR_ROLE
        );
        if (!done) return;
        _successorTransfers[from][to] = SuccessorApproval(uint64(block.timestamp), evidenceHash);
        emit SuccessorTransferApproved(from, to, evidenceHash, uint64(block.timestamp) + SUCCESSOR_WINDOW);
    }

    /// @notice records a Successor as entitled to payment where the Holder's account cannot be
    /// accessed (IV-01 §6.3). It applies after 7 days; the Holder's account may cancel it.
    function registerPaymentSuccessor(address holder, address payee, bytes32 evidenceHash) external {
        if (holder == address(0) || payee == address(0) || holder == payee || evidenceHash == bytes32(0)) {
            revert EarnControlsInvalidValue();
        }
        (bool done,) = _pair(
            keccak256(abi.encode(this.registerPaymentSuccessor.selector, holder, payee, evidenceHash)), SUCCESSOR_ROLE
        );
        if (!done) return;
        uint64 at = uint64(block.timestamp) + PAYEE_DELAY;
        _payees[holder] = PaymentSuccessor(payee, at, evidenceHash);
        emit PaymentSuccessorRegistered(holder, payee, evidenceHash, at);
    }

    /// @notice the Holder's own account cancels a Successor registered for its payments: an account
    /// that can sign is one that can be accessed.
    function cancelPaymentSuccessor() external {
        address payee = _payees[msg.sender].payee;
        if (payee == address(0)) revert EarnControlsNothingToCancel(msg.sender);
        delete _payees[msg.sender];
        emit PaymentSuccessorCancelled(msg.sender, payee);
    }

    /* ========== GOVERNED SETTINGS (DEFAULT_ADMIN_ROLE: the Earn timelock) ========== */

    function setFundingLimit(uint256 limit, bytes32 resolutionHash, uint16 fiscalYear)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (resolutionHash == bytes32(0)) revert EarnControlsInvalidValue();
        fundingLimit = limit;
        fundingLimitResolution = resolutionHash;
        fundingLimitFiscalYear = fiscalYear;
        emit FundingLimitSet(limit, resolutionHash, fiscalYear);
    }

    function setOfferingCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        offeringCap = cap;
        emit OfferingCapSet(cap);
    }

    function setHolderCapBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps == 0 || bps > BPS) revert EarnControlsInvalidValue();
        holderCapBps = bps;
        emit HolderCapSet(bps);
    }

    /// @notice schedules a new holder-cap floor, applying 7 days from now (on top of the Earn
    /// timelock's own delay). A later schedule replaces one not yet applied.
    function scheduleHolderCapFloor(uint256 floor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 current = holderCapFloor();
        _holderCapFloor = current;
        _pendingHolderCapFloor = floor;
        uint64 at = uint64(block.timestamp) + HOLDER_CAP_FLOOR_DELAY;
        _holderCapFloorAt = at;
        emit HolderCapFloorScheduled(current, floor, at);
    }

    /// @notice lists, prices or withdraws a Ladder term. Withdrawing a term is what makes a
    /// confirmed bond of that term unable to roll; the reserve hook is told in the same call.
    function setRung(uint32 termDays, uint32 yieldBps, bool offered) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (termDays == 0 || termDays > MAX_TERM_DAYS || yieldBps > MAX_YIELD_BPS) revert EarnControlsInvalidValue();
        Rung storage r = _rungs[termDays];
        if (!r.listed) {
            if (_terms.length >= MAX_LADDER_TERMS) revert EarnControlsInvalidValue();
            _terms.push(termDays);
            r.listed = true;
        }
        bool changed = r.offered != offered;
        r.yieldBps = yieldBps;
        r.offered = offered;
        emit RungSet(termDays, yieldBps, offered);
        address hook = reserveHook;
        if (changed && hook != address(0)) IEarnControlsHook(hook).termOfferChanged(termDays, offered);
    }

    /// @notice the Clear contracts refused as payers or receivers (§1: those holding ESA capital,
    /// CLRUSD, collateral, credit proceeds or Earn funds).
    function setRefused(address account, bool isRefused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert EarnControlsInvalidAddress();
        refused[account] = isRefused;
        emit RefusedSet(account, isRefused);
    }

    function setSources(
        address membership_,
        address yieldPool_,
        address reserveStatus_,
        address collateralAgent_,
        address reserveHook_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        membership = IEarnMembership(membership_);
        yieldPool = yieldPool_;
        reserveStatus = reserveStatus_;
        collateralAgent = collateralAgent_;
        reserveHook = reserveHook_;
        emit SourcesSet(membership_, yieldPool_, reserveStatus_, collateralAgent_, reserveHook_);
    }

    function setBondBooks(address[] calldata books) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (books.length > MAX_BOND_BOOKS) revert EarnControlsInvalidValue();
        for (uint256 i; i < books.length; ++i) if (books[i] == address(0)) revert EarnControlsInvalidAddress();
        _bondBooks = books;
        emit BondBooksSet(books);
    }

    /* ========== INTERNALS ========== */

    function _checkParties(address payer, address receiver) internal view {
        if (refused[payer]) revert EarnControlsRefused(payer);
        if (refused[receiver]) revert EarnControlsRefused(receiver);
        if (receiver == address(0) || !sameHolder(payer, receiver)) revert EarnControlsNotSameHolder(payer, receiver);
    }

    /// @dev Records `attestation` when one is given (a newer one replaces the record), then
    /// requires an attestation in force whose attester still holds the role.
    function _eligible(address account, bytes calldata attestation) internal returns (bytes32) {
        Eligibility storage e = _eligibility[account];
        if (attestation.length != 0) {
            (address attester, bytes32 code, uint64 issuedAt, uint64 validUntil, bytes memory sig) =
                abi.decode(attestation, (address, bytes32, uint64, uint64, bytes));
            if (
                code == bytes32(0) || !hasRole(ATTESTER_ROLE, attester) || issuedAt > block.timestamp
                    || validUntil < block.timestamp || issuedAt < e.issuedAt
                    || !SignatureCheckerUpgradeable.isValidSignatureNow(
                        attester, attestationDigest(account, code, issuedAt, validUntil), sig
                    )
            ) revert EarnControlsBadAttestation();
            _eligibility[account] = Eligibility(code, attester, issuedAt, validUntil);
            emit EligibilityAttested(account, attester, code, issuedAt, validUntil);
        }
        if (e.exemptionCode == bytes32(0) || block.timestamp > e.validUntil || !hasRole(ATTESTER_ROLE, e.attester)) {
            revert EarnControlsIneligible(account);
        }
        return e.exemptionCode;
    }

    function _reserveShortfall() internal view returns (bool) {
        address s = reserveStatus;
        return s != address(0) && IEarnReserveStatus(s).inReserveShortfall();
    }

    function _enforcement() internal view returns (bool) {
        address a = collateralAgent;
        return a != address(0) && IEarnEnforcementStatus(a).enforcementInForce();
    }

    /// @dev The two-person rule: the first authorized signer's call proposes `action`; the same
    /// call from a different authorized signer applies it.
    function _pair(bytes32 action, bytes32 role) internal returns (bool done, address first) {
        if (!hasRole(role, msg.sender)) revert EarnControlsNotAuthorized(msg.sender);
        first = _proposerOf[action];
        if (first == msg.sender) revert EarnControlsSameSigner(msg.sender);
        if (first == address(0) || !hasRole(role, first)) {
            _proposerOf[action] = msg.sender;
            emit ActionProposed(action, msg.sender);
            return (false, address(0));
        }
        delete _proposerOf[action];
        emit ActionApproved(action, first, msg.sender);
        return (true, first);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
