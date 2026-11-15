// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "./interfaces/IEarnControls.sol";

/// @title EarnControlsBase
/// @notice Storage, events, errors and shared internals of `EarnControls` and its delegatecall
/// module `EarnControlsAdmin`. Storage is declared here only, so both run against one layout.
/// @dev Powers, all granted by the Earn timelock (`DEFAULT_ADMIN_ROLE`, decision 2) with a Lending
/// Board resolution hash (§10):
/// - `DEFAULT_ADMIN_ROLE`: the governed settings (Funding Limit, offering maxima, pool capacity,
///   holder cap and its floor, the refused Clear contracts, the sources) and upgrades. It may
///   also set a Ladder term directly (`setRung`), through the 7-day timelock.
/// - `ATTESTER_ROLE`: signs eligibility attestations off chain; two holders record a household.
/// - `PAUSE_ROLE`: sets and clears, two people each, the Reserve Shortfall pause (L-01 §8.9(e)),
///   the Equity Cushion pause (L-01 §8.6A) and the L-01 §2.9(c) flag (IV-02 §2.6).
/// - `SUCCESSOR_ROLE`: approves a Successor transfer or registers a Successor for payment, two
///   people with an evidence hash (IV-01 §6.3; IV-02 §8.3).
/// - `ELIGIBILITY_ROLE`: sets and clears the holder-ineligible flag, two people (§2).
/// - `BOND_ROLE`: a bond collection: `checkPurchase` and `recordBondExit`.
/// - `LADDER_ROLE`: schedules a Ladder change, two people; it takes effect 48 hours later and is
///   published by its event (decision 31). Every other setting stays on the 7-day Earn timelock.
/// - `FUNDING_ROLE`: posts Lending Co.'s other indebtedness for borrowed money, two people with an
///   evidence hash (decision 39). It only adds to the Funding Limit check and moves no money.
abstract contract EarnControlsBase is AccessControlUpgradeable, UUPSUpgradeable, EIP712Upgradeable {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant SUCCESSOR_ROLE = keccak256("SUCCESSOR_ROLE");
    bytes32 public constant ELIGIBILITY_ROLE = keccak256("ELIGIBILITY_ROLE");
    bytes32 public constant BOND_ROLE = keccak256("BOND_ROLE");
    bytes32 public constant LADDER_ROLE = keccak256("LADDER_ROLE");
    bytes32 public constant FUNDING_ROLE = keccak256("FUNDING_ROLE");

    /// @notice The pause flags (IV-02 §2.6), each set and cleared by two `PAUSE_ROLE` holders.
    uint8 public constant RESERVE_SHORTFALL = 1;
    uint8 public constant EQUITY_CUSHION = 2;
    /// @notice "L-01 §2.9(c) applies": subscriptions then pause after 30 days below 50% Utilization.
    uint8 public constant LOW_UTILIZATION_RULE = 4;

    uint256 internal constant BPS = 10_000;
    uint64 public constant HOLDER_CAP_FLOOR_DELAY = 7 days;
    uint64 public constant SUCCESSOR_WINDOW = 30 days;
    uint64 public constant PAYEE_DELAY = 7 days;
    /// @notice How long a scheduled Ladder change waits before it may take effect (decision 31).
    uint64 public constant LADDER_DELAY = 48 hours;
    /// @notice FIXED: an eligibility attestation lasts at most 12 months (decision 42; IV-03 §2.1(d)).
    uint64 public constant MAX_ATTESTATION_LIFE = 365 days;

    struct Eligibility {
        bytes32 exemptionCode;
        address attester;
        uint64 issuedAt;
        uint64 validUntil;
        uint256 netWorth;
    }

    /// @dev A member's Earn Products at purchase price. Pool Shares are carried at average cost:
    /// when the member's shares fall (a redemption), the cost falls in the same proportion.
    struct Cost {
        uint128 poolCost;
        uint128 poolShares;
        uint256 bondCost;
    }

    /// @dev A Ladder term. `priorYieldBps`/`priorOffered` were in force until `changedAt`, so a
    /// quote or roll notice given before a change can still be checked against the rate it was
    /// given at (`rungAt`, decision 31).
    struct Rung {
        uint32 yieldBps;
        bool offered;
        bool listed;
        uint32 priorYieldBps;
        bool priorOffered;
        uint64 changedAt;
    }

    /// @dev A Ladder change scheduled by two `LADDER_ROLE` signers, applicable from `effectiveAt`.
    struct PendingRung {
        uint32 yieldBps;
        bool offered;
        uint64 effectiveAt;
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

    uint256 public fundingLimit;
    bytes32 public fundingLimitResolution;
    uint16 public fundingLimitFiscalYear;

    /// @notice The one offering maximum across both products (IV-03 §1.3; decision 38) and the
    /// cumulative price paid against it: bond Purchase Prices and pool subscriptions together. Rolls
    /// are not counted.
    uint256 public offeringCap;
    uint256 public offeringTaken;
    /// @notice Lending Co.'s other indebtedness for borrowed money (not an Earn Product), as last
    /// posted by two `FUNDING_ROLE` holders with its evidence (decision 39). Added to `fundingUsed`.
    uint256 public otherIndebtedness;
    bytes32 public otherIndebtednessEvidence;
    /// @notice The pool capacity the Lending Board sets (IV-02 §2.5(d)).
    uint256 public poolCapacity;

    /// @notice The holder cap as a share of outstanding Pool Shares (IV-02 §2.5(c); 1,000 = 10%).
    uint256 public holderCapBps;
    uint256 internal _holderCapFloor;
    uint256 internal _pendingHolderCapFloor;
    uint64 internal _holderCapFloorAt;

    /// @notice the pause flags in force: a bitmask of `RESERVE_SHORTFALL`, `EQUITY_CUSHION` and
    /// `LOW_UTILIZATION_RULE`.
    uint8 public pauseFlags;

    /// @notice the Clear contracts refused as payers or receivers (§1; IV-02 §2.4).
    mapping(address => bool) public refused;
    mapping(address => Eligibility) internal _eligibility;
    mapping(uint256 => Cost) internal _costs;
    /// @notice member key => household (IV-02 §2.5(c)).
    mapping(uint256 => bytes32) public householdOf;
    mapping(bytes32 => address[]) internal _households;
    /// @notice the holder-ineligible flag (§2): a flagged Holder's bonds do not roll.
    mapping(address => bool) public holderIneligible;
    mapping(uint32 => Rung) internal _rungs;
    uint32[] internal _terms;
    mapping(address => mapping(address => SuccessorApproval)) internal _successorTransfers;
    mapping(address => PaymentSuccessor) internal _payees;
    mapping(bytes32 => address) internal _proposerOf;
    /// @notice Ladder changes waiting for their 48 hours (decision 31).
    mapping(uint32 => PendingRung) internal _pendingRungs;
    /// @notice The longest Ladder term in months (decision 41): 36, raised to at most 60 by the Earn
    /// timelock (`setMaxTermMonths`). 0 reads as 36.
    uint8 internal _maxTermMonths;

    uint256[38] private __gap;

    event SettingsSet(bytes32 indexed what, uint256 value, bytes32 resolutionHash);
    event OtherIndebtednessPosted(uint256 amount, bytes32 evidenceHash, address proposer, address approver);
    event OfferingTaken(address indexed holder, bool indexed pool, uint256 amount, uint256 taken);
    event HolderCapFloorScheduled(uint256 current, uint256 next, uint64 effectiveAt);
    event RefusedSet(address indexed account, bool refused);
    event SourcesSet(address membership, address yieldPool, address reserveStatus, address collateralAgent, address reserveHook);
    event BondBooksSet(address[] books);
    event EligibilityAttested(address indexed account, address indexed attester, bytes32 exemptionCode, uint256 netWorth, uint64 issuedAt, uint64 validUntil);
    event PauseFlagSet(uint8 indexed flag, bool on, bytes32 reasonHash, address proposer, address approver);
    event HouseholdSet(uint256 indexed memberKey, address indexed account, bytes32 indexed household);
    event EarnCostRecorded(uint256 indexed memberKey, uint256 poolCost, uint256 bondCost);
    event HolderIneligibleSet(address indexed holder, bool ineligible, bytes32 evidenceHash);
    event RungSet(uint32 indexed termDays, uint32 yieldBps, bool offered);
    /// @notice A Ladder change is scheduled and published; it may take effect from `effectiveAt`.
    event RungScheduled(uint32 indexed termDays, uint32 yieldBps, bool offered, uint64 effectiveAt, address proposer, address approver);
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
    /// @dev `what`: "funding" (the Funding Limit), "offering" (an offering maximum), "capacity"
    /// (pool capacity) or "netWorth" (10% of attested net worth).
    error EarnControlsLimit(bytes32 what, uint256 used, uint256 adding, uint256 limit);
    error EarnControlsHolderCap(address receiver, uint256 held, uint256 limit);
    error EarnControlsNothingToCancel(address holder);
    error EarnControlsModuleMismatch();
    error EarnControlsNotYet(uint64 effectiveAt);
    /// @dev An offered longer term would yield less than an offered shorter one (decision 41).
    error EarnControlsLadderOrder(uint32 shorterTerm, uint32 longerTerm);

    /// @notice Refused: grant with `grantRoleByResolution`, which records the resolution hash.
    function grantRole(bytes32, address) public pure override {
        revert EarnControlsUseResolution();
    }

    /// @notice whether two accounts are Smart Accounts registered to the same Holder.
    function sameHolder(address a, address b) public view returns (bool) {
        if (a == b) return true;
        IEarnMembership m = membership;
        if (address(m) == address(0)) return false;
        uint256 id = m.walletToMemberId(a);
        return id != 0 && id == m.walletToMemberId(b);
    }

    /// @notice the member's own wallets (MembershipRegistry); an unregistered account is its own.
    function memberWalletsOf(address account) public view returns (address[] memory wallets) {
        IEarnMembership m = membership;
        uint256 id = address(m) == address(0) ? 0 : m.walletToMemberId(account);
        if (id == 0) {
            wallets = new address[](1);
            wallets[0] = account;
            return wallets;
        }
        return m.getLinkedWallets(id);
    }

    /// @notice the key of the member behind `account`: its member id, or the account itself (above
    /// 2^160, so the two never collide) when it is not registered.
    function memberKeyOf(address account) public view returns (uint256) {
        IEarnMembership m = membership;
        uint256 id = address(m) == address(0) ? 0 : m.walletToMemberId(account);
        return id != 0 ? id : (uint256(1) << 160) | uint256(uint160(account));
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
