// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "./interfaces/ICollateralAgent.sol";

/// @title CollateralAgent
/// @notice The Agent Role in the BondVault, exactly as IV-10 Exhibit A states it (Phase 2f,
/// decisions 18 and 19). The BondVault holds the USDC; this contract holds the Enforcement Notice,
/// the distribution rounds, the cost cap, the change co-signatures, the Agent Key and the
/// treasury role, and is the only thing the BondVault lets move USDC outside settlement.
/// @dev **The Agent Key** (an address, not a role) has exactly Part 2's seven powers:
/// `enforce`, `releaseEnforcement`, `postDistribution`, `toCollateralAccount`, `withdrawCosts`
/// (with `postCostStatement`, the on-chain record Part 2 item 5 and IV-10 §8.2(b) put before it),
/// `approveChange` and `rotateAgentKey`. Required-Holder cost approvals (Part 3; IV-10 §8.2(a)) and
/// blocks on a key or account replacement (Part 4) are signed by the Holders themselves and counted
/// against the bond register by Accreted Value in `HolderDirections` (decision 30); only that
/// contract records them here, never the Agent Key or the treasury. The Agent Key holds no role here
/// or anywhere else, so it cannot
/// (Part 3) pay anyone but a Holder through a round, the Collateral Deposit Account or the cost
/// address within the cap; set a bond's share; touch a bond, a Smart Account, CLRUSD, the ESA, the
/// Yield Pool, the PayoutPool, the pledge module or any AssurancePool compartment; withdraw
/// excess; upgrade, grant a role or change a parameter alone; stop a maturity payment while no
/// Enforcement Notice is in effect; or withdraw fees, or costs outside an Enforcement Period.
///
/// **Clear Lending's treasury role** (`TREASURY_ROLE`, Part 5) can only withdraw deployable excess
/// to its registered multisig, proposed and executed by two different signers, while no
/// Enforcement Notice is in effect; and propose changes, confirmed by a second signer.
///
/// **Changes** (Part 2 item 6; IV-10 §4.5). Every upgrade, role, parameter or destination change of
/// the BondVault, and of this contract, runs through `DEFAULT_ADMIN_ROLE` (the Earn timelock,
/// 7 days) and also needs: a treasury proposal, a second treasury signer's confirmation, the
/// Agent's `approveChange`, and 7 days from the confirmation. The changed contract calls
/// `consumeChange(keccak256(msg.data))`, so the co-signature covers the exact call.
///
/// **Distributions** (Part 2 item 3; IV-10 §§7.5-7.6). At an Enforcement Notice each outstanding
/// bond's amount due is fixed at the enforcement time (its Accreted Value then, or its Maturity
/// Amount if matured) by a permissionless batched snapshot. Each round raises one index per dollar
/// due, so the Agent sets only the total. Each bond's share is claimed by anyone, paid to the
/// Holder (decision 19 routes a pledged bond's share to its MB-05 Defaulted Amount first, only
/// while MB-05 §6.1 permits enforcement against it), and the bond burns when paid in full.
contract CollateralAgent is ICollateralAgent, AccessControlUpgradeable, UUPSUpgradeable {
    using MathUpgradeable for uint256;

    /// @notice Clear Lending's treasury role: its two-of-N signers (Exhibit A, Parts 1(b) and 5).
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    /// @notice Exhibit A, Part 2 item 6 and IV-10 §4.5: a change waits 7 days.
    uint64 public constant CHANGE_DELAY = 7 days;
    /// @notice Part 2 item 7 and IV-10 §4.6.
    uint64 public constant ROTATION_DELAY = 48 hours;
    /// @notice Part 4: a replacement key or Collateral Deposit Account waits 7 days.
    uint64 public constant REPLACEMENT_DELAY = 7 days;
    /// @notice Part 2 item 5 and IV-10 §8.2(b): costs wait 7 days after their statement.
    uint64 public constant STATEMENT_WAIT = 7 days;
    /// @notice A Required-Holder cost approval applies 7 days after it is recorded.
    uint64 public constant COST_APPROVAL_WAIT = 7 days;
    /// @notice IV-10 §8.2(a): the cost cap is the greater of $50,000 and 2% of the Collateral at
    /// the start of the Enforcement Period, plus what the Required Holders approve.
    uint256 public constant COST_FLOOR_DOLLARS = 50_000;
    uint256 public constant COST_CAP_BPS = 200;

    uint8 public constant REPLACE_AGENT_KEY = 1;
    uint8 public constant REPLACE_COLLATERAL_ACCOUNT = 2;

    uint8 internal constant OPEN = 1;
    uint8 internal constant DONE = 2;
    uint8 internal constant CANCELLED = 3;
    uint8 internal constant APPROVED = 4;
    uint8 internal constant BLOCKED = 5;

    /// @notice One Enforcement Period.
    struct Period {
        uint64 enforcedAt;
        uint64 releasedAt;
        uint8 reasonCode;
        bool snapshotComplete;
        bytes32 noticeHash;
        bytes32 releaseHash;
        uint256 collateralAtStart;
        uint256 costsWithdrawn;
        uint256 extraCostCap;
        uint256 snapshotCursor;
        uint256 totalDue;
        uint256 distributed;
        /// @dev distributed per dollar due, WAD.
        uint256 index;
    }

    struct Round {
        uint32 period;
        uint64 postedAt;
        uint256 amount;
    }

    struct Statement {
        uint32 period;
        uint64 postedAt;
        uint256 amount;
        uint256 withdrawn;
    }

    struct CostApproval {
        uint64 effectiveAt;
        bytes32 directionHash;
        uint256 amount;
    }

    struct Change {
        address target;
        bytes32 callHash;
        bytes32 descriptionHash;
        address proposer;
        address confirmer;
        uint64 proposedAt;
        uint64 confirmedAt;
        bool agentApproved;
        uint8 status;
    }

    struct Replacement {
        uint8 kind;
        uint8 status;
        uint64 approvedAt;
        address newAddress;
        address proposer;
        bytes32 instructionHash;
        bytes32 blockedBy;
    }

    struct ExcessWithdrawal {
        uint256 amount;
        address proposer;
        bool done;
    }

    struct BondDue {
        uint256 due;
        uint256 claimed;
    }

    /// @notice 10^decimals of the reserve token (USDC: 10^6).
    uint256 public unit;
    IAgentVault public vault;
    IAgentBondBook public bondBook;
    IAgentPledgeModule public pledgeModule;
    IAgentPayee public payeeSource;
    /// @notice The Collateral Deposit Account (IV-10 §3.5(c)); changed only under Part 4.
    address public collateralAccount;
    /// @notice The Agent's registered cost address.
    address public costAddress;
    /// @notice Clear Lending's registered multisig for deployable excess (Part 5(a)).
    address public excessDestination;

    address internal _agentKey;
    address internal _pendingKey;
    uint64 internal _pendingKeyAt;

    bool internal _inForce;
    uint32 public periodCount;
    mapping(uint32 => Period) internal _periods;
    mapping(uint32 => mapping(uint256 => BondDue)) internal _dues;
    mapping(uint256 => uint32[]) internal _bondPeriods;
    /// @notice bond id => distributions paid on it, across every Enforcement Period.
    mapping(uint256 => uint256) public paidOn;
    uint256 internal _unclaimed;

    mapping(uint256 => Round) internal _rounds;
    uint256[] internal _roundIds;
    mapping(bytes32 => Statement) internal _statements;
    mapping(uint32 => CostApproval) internal _pendingCostApproval;

    mapping(bytes32 => Change) internal _changes;
    mapping(address => mapping(bytes32 => bytes32)) internal _openChange;
    uint256 internal _changeNonce;

    mapping(uint256 => Replacement) internal _replacements;
    uint256 public replacementCount;
    mapping(uint256 => ExcessWithdrawal) internal _excess;
    uint256 public excessCount;

    /// @notice Where Required-Holder Directions are signed and counted (decision 30); the only caller
    /// of `recordCostApproval` and `recordHolderBlock`.
    address public holderDirections;

    uint256[39] private __gap;

    /// @notice Addresses set at initialization and afterwards only by a co-signed change.
    struct Config {
        address vault;
        address bondBook;
        address pledgeModule;
        address payeeSource;
        address collateralAccount;
        address costAddress;
        address excessDestination;
    }

    // Part 2 items 1-2
    event EnforcementNoticeRecorded(uint32 indexed period, uint8 reasonCode, bytes32 noticeHash, uint256 collateralAtStart);
    event EnforcementReleased(uint32 indexed period, bytes32 directionHash);
    // Part 2 item 3, and every payment per Bond
    event SnapshotTaken(uint32 indexed period, uint256 bonds, uint256 totalDue, bool complete);
    event DistributionPosted(uint32 indexed period, uint256 indexed roundId, uint256 amount, uint256 index);
    event DistributionPaid(uint256 indexed bondId, address indexed holder, address indexed payee, uint256 toDebt, uint256 toHolder);
    event BondPaidInFull(uint256 indexed bondId, uint256 paid);
    // Part 2 items 4-5
    event CollateralAccountTransfer(uint32 indexed period, address indexed account, uint256 amount);
    event CostStatementPosted(uint32 indexed period, bytes32 indexed statementHash, uint256 amount, uint64 withdrawableAt);
    event CostApprovalRecorded(uint32 indexed period, bytes32 indexed directionHash, uint256 amount, uint64 effectiveAt);
    event CostsWithdrawn(uint32 indexed period, bytes32 indexed statementHash, address indexed to, uint256 amount, uint256 cap);
    // Part 2 item 6 and Part 5(b)
    event ChangeProposed(bytes32 indexed changeId, address indexed target, bytes32 callHash, bytes32 descriptionHash, address proposer);
    event ChangeConfirmed(bytes32 indexed changeId, address confirmer, uint64 executableAt);
    event ChangeApproved(bytes32 indexed changeId, address agentKey);
    event ChangeCancelled(bytes32 indexed changeId, address by);
    event ChangeExecuted(bytes32 indexed changeId, address indexed target, bytes32 callHash);
    // Part 2 item 7 and Part 4
    event AgentKeyRotationStarted(address indexed current, address indexed next, uint64 effectiveAt);
    event AgentKeyRotationCancelled(address indexed current, address indexed abandoned);
    event AgentKeyRotated(address indexed previous, address indexed next);
    event ReplacementProposed(uint256 indexed id, uint8 kind, address newAddress, bytes32 instructionHash, address proposer);
    event ReplacementApproved(uint256 indexed id, address approver, uint64 effectiveAt);
    event ReplacementBlocked(uint256 indexed id, bytes32 directionHash, address recordedBy);
    event ReplacementCancelled(uint256 indexed id, address by);
    event ReplacementExecuted(uint256 indexed id, uint8 kind, address previous, address next);
    // Part 5(a)
    event ExcessWithdrawalProposed(uint256 indexed id, uint256 amount, address proposer);
    event ExcessWithdrawn(uint256 indexed id, address indexed to, uint256 amount, address proposer, address executor);
    event ConfigSet(bytes32 indexed what, address value);

    error CollateralAgentNotAgent(address caller);
    error CollateralAgentInvalidValue();
    error CollateralAgentNotInForce();
    error CollateralAgentInForce();
    error CollateralAgentSnapshotIncomplete();
    error CollateralAgentSnapshotDone();
    error CollateralAgentRoundExists(uint256 roundId);
    error CollateralAgentOverDistributed(uint256 distributed, uint256 adding, uint256 totalDue);
    error CollateralAgentInsufficient(uint256 available, uint256 needed);
    error CollateralAgentNothingOwed(uint256 bondId);
    error CollateralAgentStatement(bytes32 statementHash);
    error CollateralAgentCostCap(uint256 withdrawn, uint256 adding, uint256 cap);
    error CollateralAgentChange(bytes32 changeId);
    error CollateralAgentChangeNotReady(address target, bytes32 callHash);
    error CollateralAgentSameSigner(address signer);
    error CollateralAgentReplacement(uint256 id);
    error CollateralAgentExcess(uint256 id);

    modifier onlyAgent() {
        _syncKey();
        if (msg.sender != _agentKey) revert CollateralAgentNotAgent(msg.sender);
        _;
    }

    modifier inEnforcement() {
        if (!_inForce) revert CollateralAgentNotInForce();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin the Earn timelock (decision 2); never the deployer
    /// @param agentKey_ the Agent Key, in the Agent's custody (IV-10 §4.3)
    /// @param treasurySigners Clear Lending's treasury signers: at least two (two-person control)
    function initialize(
        address admin,
        address agentKey_,
        address[] calldata treasurySigners,
        uint8 decimals_,
        Config calldata config
    ) external initializer {
        if (admin == address(0) || agentKey_ == address(0) || treasurySigners.length < 2) {
            revert CollateralAgentInvalidValue();
        }
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        for (uint256 i; i < treasurySigners.length; ++i) {
            if (treasurySigners[i] == address(0) || treasurySigners[i] == agentKey_) revert CollateralAgentInvalidValue();
            _grantRole(TREASURY_ROLE, treasurySigners[i]);
        }
        _agentKey = agentKey_;
        unit = 10 ** uint256(decimals_);
        vault = IAgentVault(config.vault);
        bondBook = IAgentBondBook(config.bondBook);
        pledgeModule = IAgentPledgeModule(config.pledgeModule);
        payeeSource = IAgentPayee(config.payeeSource);
        collateralAccount = config.collateralAccount;
        costAddress = config.costAddress;
        excessDestination = config.excessDestination;
        emit AgentKeyRotated(address(0), agentKey_);
    }

    /* ========== VIEWS ========== */

    /// @inheritdoc ICollateralAgent
    function enforcementInForce() external view returns (bool) {
        return _inForce;
    }

    /// @notice the Agent Key now in effect (a rotation applies 48 hours after it is signed).
    function agentKey() public view returns (address) {
        return _pendingKey != address(0) && block.timestamp >= _pendingKeyAt ? _pendingKey : _agentKey;
    }

    /// @notice a rotation not yet in effect, and when it takes effect.
    function pendingAgentKey() external view returns (address next, uint64 effectiveAt) {
        if (_pendingKey == address(0) || block.timestamp >= _pendingKeyAt) return (address(0), 0);
        return (_pendingKey, _pendingKeyAt);
    }

    function period(uint32 id) external view returns (Period memory) {
        return _periods[id];
    }

    function round(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function roundCount() external view returns (uint256) {
        return _roundIds.length;
    }

    function roundIdAt(uint256 i) external view returns (uint256) {
        return _roundIds[i];
    }

    /// @notice a bond's amount due and what it has claimed in one Enforcement Period.
    function dueOf(uint32 periodId, uint256 bondId) external view returns (uint256 due, uint256 claimed, uint256 entitled) {
        BondDue storage d = _dues[periodId][bondId];
        return (d.due, d.claimed, _entitlement(periodId, d.due));
    }

    /// @inheritdoc ICollateralAgent
    function unclaimedDistributions() external view returns (uint256) {
        return _unclaimed;
    }

    /// @inheritdoc ICollateralAgent
    function claimable(uint256 bondId) public view returns (uint256 owed) {
        uint32[] storage ps = _bondPeriods[bondId];
        for (uint256 i; i < ps.length; ++i) {
            BondDue storage d = _dues[ps[i]][bondId];
            owed += _entitlement(ps[i], d.due) - d.claimed;
        }
    }

    /// @inheritdoc ICollateralAgent
    function routeDistribution(uint256 bondId, address holder, uint256 amount)
        public
        view
        returns (uint256 toDebt, uint256 toHolder)
    {
        IAgentPledgeModule m = pledgeModule;
        if (address(m) != address(0) && m.enforcementPermitted(holder, bondId)) {
            uint256 defaulted = m.defaultedAmountOf(holder);
            toDebt = defaulted < amount ? defaulted : amount;
        }
        toHolder = amount - toDebt;
    }

    /// @notice the running cost cap of the current Enforcement Period (IV-10 §8.2(a)).
    function costCap() public view returns (uint256) {
        Period storage p = _periods[periodCount];
        uint256 floor = COST_FLOOR_DOLLARS * unit;
        uint256 share = (p.collateralAtStart * COST_CAP_BPS) / BPS;
        uint256 cap = (floor > share ? floor : share) + p.extraCostCap;
        CostApproval storage a = _pendingCostApproval[periodCount];
        if (a.amount > 0 && block.timestamp >= a.effectiveAt) cap += a.amount;
        return cap;
    }

    function statement(bytes32 statementHash) external view returns (Statement memory) {
        return _statements[statementHash];
    }

    function change(bytes32 changeId) external view returns (Change memory) {
        return _changes[changeId];
    }

    /// @notice the open change for `target` running `callHash`, if any.
    function openChangeFor(address target, bytes32 callHash) external view returns (bytes32) {
        return _openChange[target][callHash];
    }

    function replacement(uint256 id) external view returns (Replacement memory) {
        return _replacements[id];
    }

    function excessWithdrawal(uint256 id) external view returns (ExcessWithdrawal memory) {
        return _excess[id];
    }

    /* ========== AGENT KEY: PART 2 ========== */

    /// @notice 1. Records an Enforcement Notice. In the same block every BondVault outflow but this
    /// contract's stops, and so do purchases and rolls.
    /// @param reasonCode the Event of Default in the notice (Exhibit B); any non-zero code
    function enforce(uint8 reasonCode, bytes32 noticeHash) external onlyAgent {
        if (_inForce) revert CollateralAgentInForce();
        if (reasonCode == 0 || noticeHash == bytes32(0)) revert CollateralAgentInvalidValue();
        uint32 id = ++periodCount;
        Period storage p = _periods[id];
        p.enforcedAt = uint64(block.timestamp);
        p.reasonCode = reasonCode;
        p.noticeHash = noticeHash;
        p.collateralAtStart = vault.collateralAssets();
        _inForce = true;
        emit EnforcementNoticeRecorded(id, reasonCode, noticeHash, p.collateralAtStart);
    }

    /// @notice 2. Withdraws the Enforcement Notice (IV-10 §7.7). Posted rounds stay claimable.
    function releaseEnforcement(bytes32 directionHash) external onlyAgent inEnforcement {
        if (directionHash == bytes32(0)) revert CollateralAgentInvalidValue();
        Period storage p = _periods[periodCount];
        p.releasedAt = uint64(block.timestamp);
        p.releaseHash = directionHash;
        _inForce = false;
        emit EnforcementReleased(periodCount, directionHash);
    }

    /// @notice 3. Posts a distribution round. The Agent sets only the total: each bond's share is
    /// its amount due over the total due, from on-chain bond data.
    function postDistribution(uint256 amount, uint256 roundId) external onlyAgent inEnforcement {
        uint32 id = periodCount;
        Period storage p = _periods[id];
        if (!p.snapshotComplete) revert CollateralAgentSnapshotIncomplete();
        if (amount == 0 || roundId == 0) revert CollateralAgentInvalidValue();
        if (_rounds[roundId].postedAt != 0) revert CollateralAgentRoundExists(roundId);
        if (p.distributed + amount > p.totalDue) revert CollateralAgentOverDistributed(p.distributed, amount, p.totalDue);
        uint256 held = vault.collateralAssets();
        if (held < _unclaimed + amount) revert CollateralAgentInsufficient(held, _unclaimed + amount);
        p.distributed += amount;
        p.index += amount.mulDiv(WAD, p.totalDue);
        _unclaimed += amount;
        _rounds[roundId] = Round(id, uint64(block.timestamp), amount);
        _roundIds.push(roundId);
        emit DistributionPosted(id, roundId, amount, p.index);
    }

    /// @notice 4. Moves USDC to the registered Collateral Deposit Account.
    function toCollateralAccount(uint256 amount) external onlyAgent inEnforcement {
        address account = collateralAccount;
        if (account == address(0) || amount == 0) revert CollateralAgentInvalidValue();
        _checkFree(amount);
        vault.agentTransfer(account, amount);
        emit CollateralAccountTransfer(periodCount, account, amount);
    }

    /// @notice 5a. Posts the itemized cost statement on chain; costs under it wait 7 days.
    function postCostStatement(bytes32 statementHash, uint256 amount) external onlyAgent inEnforcement {
        if (statementHash == bytes32(0) || amount == 0) revert CollateralAgentInvalidValue();
        if (_statements[statementHash].postedAt != 0) revert CollateralAgentStatement(statementHash);
        _statements[statementHash] = Statement(periodCount, uint64(block.timestamp), amount, 0);
        emit CostStatementPosted(periodCount, statementHash, amount, uint64(block.timestamp) + STATEMENT_WAIT);
    }

    /// @notice 5b. Records a Required-Holder Direction approving costs above the cap, as signed by the
    /// Holders and counted in `HolderDirections` (decision 30); it raises the cap 7 days later. One
    /// at a time.
    function recordCostApproval(bytes32 directionHash, uint256 amount) external inEnforcement {
        _onlyDirections();
        if (directionHash == bytes32(0) || amount == 0) revert CollateralAgentInvalidValue();
        _foldCostApproval();
        CostApproval storage a = _pendingCostApproval[periodCount];
        if (a.amount != 0) revert CollateralAgentInvalidValue();
        uint64 at = uint64(block.timestamp) + COST_APPROVAL_WAIT;
        _pendingCostApproval[periodCount] = CostApproval(at, directionHash, amount);
        emit CostApprovalRecorded(periodCount, directionHash, amount, at);
    }

    /// @notice 5. Withdraws enforcement costs to the registered cost address: during an
    /// Enforcement Period, at least 7 days after the statement, within it, and within the cap.
    function withdrawCosts(uint256 amount, bytes32 statementHash) external onlyAgent inEnforcement {
        _foldCostApproval();
        Statement storage s = _statements[statementHash];
        if (
            s.postedAt == 0 || s.period != periodCount || block.timestamp < uint256(s.postedAt) + STATEMENT_WAIT
                || s.withdrawn + amount > s.amount
        ) revert CollateralAgentStatement(statementHash);
        Period storage p = _periods[periodCount];
        uint256 cap = costCap();
        if (p.costsWithdrawn + amount > cap) revert CollateralAgentCostCap(p.costsWithdrawn, amount, cap);
        address to = costAddress;
        if (to == address(0) || amount == 0) revert CollateralAgentInvalidValue();
        _checkFree(amount);
        s.withdrawn += amount;
        p.costsWithdrawn += amount;
        vault.agentTransfer(to, amount);
        emit CostsWithdrawn(periodCount, statementHash, to, amount, cap);
    }

    /// @notice 6. Co-signs a change Clear Lending proposed.
    function approveChange(bytes32 changeId) external onlyAgent {
        Change storage c = _changes[changeId];
        if (c.status != OPEN) revert CollateralAgentChange(changeId);
        c.agentApproved = true;
        emit ChangeApproved(changeId, msg.sender);
    }

    /// @notice 7. Rotates the Agent Key, effective 48 hours later. Rotating to the current key
    /// cancels a pending rotation.
    function rotateAgentKey(address newKey) external onlyAgent {
        if (newKey == address(0)) revert CollateralAgentInvalidValue();
        if (newKey == msg.sender) {
            address abandoned = _pendingKey;
            _pendingKey = address(0);
            _pendingKeyAt = 0;
            emit AgentKeyRotationCancelled(msg.sender, abandoned);
            return;
        }
        uint64 at = uint64(block.timestamp) + ROTATION_DELAY;
        _pendingKey = newKey;
        _pendingKeyAt = at;
        emit AgentKeyRotationStarted(msg.sender, newKey, at);
    }

    /// @notice applies a rotation that has taken effect (anyone; the Agent's next call also does).
    function syncAgentKey() external {
        _syncKey();
    }

    /* ========== DISTRIBUTIONS (permissionless) ========== */

    /// @notice fixes each outstanding bond's amount due at the enforcement time, in batches.
    /// @dev Due = the bond's Accreted Value at the enforcement time (or its Maturity Amount if
    /// matured), less what earlier Enforcement Periods paid it or still owe it.
    function snapshotBonds(uint256 maxCount) external inEnforcement {
        uint32 id = periodCount;
        Period storage p = _periods[id];
        if (p.snapshotComplete) revert CollateralAgentSnapshotDone();
        IAgentBondBook book = bondBook;
        uint256 n = book.outstandingCount();
        uint256 i = p.snapshotCursor;
        uint256 end = i + maxCount < n ? i + maxCount : n;
        uint256 total = p.totalDue;
        for (; i < end; ++i) {
            uint256 bondId = book.outstandingAt(i);
            if (_bondPeriods[bondId].length != 0 && _bondPeriods[bondId][_bondPeriods[bondId].length - 1] == id) continue;
            uint256 owedBefore = paidOn[bondId] + claimable(bondId);
            uint256 accreted = book.amountDueAt(bondId, p.enforcedAt);
            uint256 due = accreted > owedBefore ? accreted - owedBefore : 0;
            _dues[id][bondId].due = due;
            _bondPeriods[bondId].push(id);
            total += due;
        }
        p.snapshotCursor = end;
        p.totalDue = total;
        if (end == n) p.snapshotComplete = true;
        emit SnapshotTaken(id, end, total, end == n);
    }

    /// @notice pays a bond its share of every posted round, to its Holder (decision 19 routes a
    /// pledged bond's share to the MB-05 Defaulted Amount first while §6.1 permits). Anyone may
    /// call it; it takes only the id. A bond paid in full burns.
    function claimDistribution(uint256 bondId) external {
        if (_inForce && !_periods[periodCount].snapshotComplete) revert CollateralAgentSnapshotIncomplete();
        uint32[] storage ps = _bondPeriods[bondId];
        uint256 owed;
        for (uint256 i; i < ps.length; ++i) {
            BondDue storage d = _dues[ps[i]][bondId];
            uint256 e = _entitlement(ps[i], d.due);
            owed += e - d.claimed;
            d.claimed = e;
        }
        if (owed == 0) revert CollateralAgentNothingOwed(bondId);
        _unclaimed -= owed;
        uint256 paid = paidOn[bondId] + owed;
        paidOn[bondId] = paid;

        IAgentBondBook book = bondBook;
        address holder = book.holderOf(bondId);
        (uint256 toDebt, uint256 toHolder) = routeDistribution(bondId, holder, owed);
        address payee = holder;
        if (address(payeeSource) != address(0)) payee = payeeSource.payeeOf(holder);
        uint32 last = ps[ps.length - 1];
        bool full = _periods[last].distributed == _periods[last].totalDue;
        emit DistributionPaid(bondId, holder, payee, toDebt, toHolder);
        if (toDebt > 0) {
            address module = address(pledgeModule);
            vault.agentTransfer(module, toDebt);
            IAgentPledgeModule(module).applyDistribution(holder, bondId, toDebt);
        }
        if (toHolder > 0) vault.agentTransfer(payee, toHolder);
        if (full) {
            emit BondPaidInFull(bondId, paid);
            book.burnPaid(bondId);
        }
    }

    /* ========== CLEAR LENDING'S TREASURY ROLE: PART 5 ========== */

    /// @notice (a) proposes a withdrawal of deployable excess to the registered multisig.
    function proposeExcessWithdrawal(uint256 amount) external onlyRole(TREASURY_ROLE) returns (uint256 id) {
        if (amount == 0) revert CollateralAgentInvalidValue();
        id = ++excessCount;
        _excess[id] = ExcessWithdrawal(amount, msg.sender, false);
        emit ExcessWithdrawalProposed(id, amount, msg.sender);
    }

    /// @notice (a) executes it: a different signer, no Enforcement Notice, within deployable excess.
    function executeExcessWithdrawal(uint256 id) external onlyRole(TREASURY_ROLE) {
        ExcessWithdrawal storage w = _excess[id];
        if (w.amount == 0 || w.done) revert CollateralAgentExcess(id);
        if (w.proposer == msg.sender) revert CollateralAgentSameSigner(msg.sender);
        if (_inForce) revert CollateralAgentInForce();
        address to = excessDestination;
        if (to == address(0)) revert CollateralAgentInvalidValue();
        uint256 deployable = vault.deployableExcess();
        if (w.amount > deployable) revert CollateralAgentInsufficient(deployable, w.amount);
        _checkFree(w.amount);
        w.done = true;
        vault.agentWithdrawExcess(to, w.amount);
        emit ExcessWithdrawn(id, to, w.amount, w.proposer, msg.sender);
    }

    /// @notice (b) proposes a change: the call `callHash` (keccak256 of its calldata) on `target`.
    function proposeChange(address target, bytes32 callHash, bytes32 descriptionHash)
        external
        onlyRole(TREASURY_ROLE)
        returns (bytes32 changeId)
    {
        if (target == address(0) || callHash == bytes32(0)) revert CollateralAgentInvalidValue();
        if (_openChange[target][callHash] != bytes32(0)) revert CollateralAgentChange(_openChange[target][callHash]);
        changeId = keccak256(abi.encode(target, callHash, ++_changeNonce));
        _changes[changeId] = Change(target, callHash, descriptionHash, msg.sender, address(0), uint64(block.timestamp), 0, false, OPEN);
        _openChange[target][callHash] = changeId;
        emit ChangeProposed(changeId, target, callHash, descriptionHash, msg.sender);
    }

    /// @notice the second treasury signer confirms a proposed change; its 7 days start now.
    function confirmChange(bytes32 changeId) external onlyRole(TREASURY_ROLE) {
        Change storage c = _changes[changeId];
        if (c.status != OPEN || c.confirmer != address(0)) revert CollateralAgentChange(changeId);
        if (c.proposer == msg.sender) revert CollateralAgentSameSigner(msg.sender);
        c.confirmer = msg.sender;
        c.confirmedAt = uint64(block.timestamp);
        emit ChangeConfirmed(changeId, msg.sender, uint64(block.timestamp) + CHANGE_DELAY);
    }

    /// @notice withdraws a change not yet made.
    function cancelChange(bytes32 changeId) external onlyRole(TREASURY_ROLE) {
        Change storage c = _changes[changeId];
        if (c.status != OPEN) revert CollateralAgentChange(changeId);
        c.status = CANCELLED;
        delete _openChange[c.target][c.callHash];
        emit ChangeCancelled(changeId, msg.sender);
    }

    /// @inheritdoc ICollateralAgent
    function consumeChange(bytes32 callHash) external {
        _consume(msg.sender, callHash);
    }

    /* ========== PART 4: REPLACEMENT OF THE AGENT KEY OR COLLATERAL DEPOSIT ACCOUNT ========== */

    /// @notice a treasury signer proposes, on the Agent's written instruction (its hash), a new
    /// Agent Key (lost or compromised key, or a successor Agent) or Collateral Deposit Account.
    function proposeReplacement(uint8 kind, address newAddress, bytes32 instructionHash)
        external
        onlyRole(TREASURY_ROLE)
        returns (uint256 id)
    {
        if (
            (kind != REPLACE_AGENT_KEY && kind != REPLACE_COLLATERAL_ACCOUNT) || newAddress == address(0)
                || instructionHash == bytes32(0)
        ) revert CollateralAgentInvalidValue();
        id = ++replacementCount;
        _replacements[id] = Replacement(kind, OPEN, 0, newAddress, msg.sender, instructionHash, bytes32(0));
        emit ReplacementProposed(id, kind, newAddress, instructionHash, msg.sender);
    }

    /// @notice a second treasury signer approves it; the 7 days of notice to Holders start now.
    function approveReplacement(uint256 id) external onlyRole(TREASURY_ROLE) {
        Replacement storage r = _replacements[id];
        if (r.status != OPEN) revert CollateralAgentReplacement(id);
        if (r.proposer == msg.sender) revert CollateralAgentSameSigner(msg.sender);
        r.status = APPROVED;
        r.approvedAt = uint64(block.timestamp);
        emit ReplacementApproved(id, msg.sender, uint64(block.timestamp) + REPLACEMENT_DELAY);
    }

    /// @notice records the Required Holders' Direction blocking a replacement (Part 4), as signed by
    /// the Holders and counted against the bond register in `HolderDirections` (decision 30).
    function recordHolderBlock(uint256 id, bytes32 directionHash) external {
        Replacement storage r = _replacements[id];
        if (r.status != OPEN && r.status != APPROVED) revert CollateralAgentReplacement(id);
        _onlyDirections();
        if (directionHash == bytes32(0)) revert CollateralAgentInvalidValue();
        r.status = BLOCKED;
        r.blockedBy = directionHash;
        emit ReplacementBlocked(id, directionHash, msg.sender);
    }

    /// @notice withdraws a replacement not yet made.
    function cancelReplacement(uint256 id) external onlyRole(TREASURY_ROLE) {
        Replacement storage r = _replacements[id];
        if (r.status != OPEN && r.status != APPROVED) revert CollateralAgentReplacement(id);
        r.status = CANCELLED;
        emit ReplacementCancelled(id, msg.sender);
    }

    /// @notice makes an approved, unblocked replacement once its 7 days have passed (anyone). An
    /// Enforcement Notice in effect stays in effect.
    function executeReplacement(uint256 id) external {
        Replacement storage r = _replacements[id];
        if (r.status != APPROVED || block.timestamp < uint256(r.approvedAt) + REPLACEMENT_DELAY) {
            revert CollateralAgentReplacement(id);
        }
        r.status = DONE;
        address previous;
        if (r.kind == REPLACE_AGENT_KEY) {
            _syncKey();
            previous = _agentKey;
            _agentKey = r.newAddress;
            _pendingKey = address(0);
            _pendingKeyAt = 0;
            emit AgentKeyRotated(previous, r.newAddress);
        } else {
            previous = collateralAccount;
            collateralAccount = r.newAddress;
        }
        emit ReplacementExecuted(id, r.kind, previous, r.newAddress);
    }

    /* ========== CO-SIGNED SETTINGS (DEFAULT_ADMIN_ROLE: the Earn timelock) ========== */

    function setVault(address v) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _consume(address(this), keccak256(msg.data));
        vault = IAgentVault(v);
        emit ConfigSet("vault", v);
    }

    function setBondBook(address b) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _consume(address(this), keccak256(msg.data));
        bondBook = IAgentBondBook(b);
        emit ConfigSet("bondBook", b);
    }

    function setPledgeModule(address m) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _consume(address(this), keccak256(msg.data));
        pledgeModule = IAgentPledgeModule(m);
        emit ConfigSet("pledgeModule", m);
    }

    function setPayeeSource(address s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _consume(address(this), keccak256(msg.data));
        payeeSource = IAgentPayee(s);
        emit ConfigSet("payeeSource", s);
    }

    /// @notice names the Required-Holder tally (decision 30): a co-signed change like any other.
    function setHolderDirections(address d) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _consume(address(this), keccak256(msg.data));
        holderDirections = d;
        emit ConfigSet("holderDirections", d);
    }

    function setCostAddress(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _consume(address(this), keccak256(msg.data));
        costAddress = a;
        emit ConfigSet("costAddress", a);
    }

    function setExcessDestination(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _consume(address(this), keccak256(msg.data));
        excessDestination = a;
        emit ConfigSet("excessDestination", a);
    }

    /// @notice a role grant is a change: co-signed, and 7 days.
    function grantRole(bytes32 role, address account) public override {
        _consume(address(this), keccak256(msg.data));
        super.grantRole(role, account);
    }

    /// @notice a role revocation is a change: co-signed, and 7 days.
    function revokeRole(bytes32 role, address account) public override {
        _consume(address(this), keccak256(msg.data));
        super.revokeRole(role, account);
    }

    /// @dev An upgrade is a change: co-signed, and 7 days, through the Earn timelock.
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        _consume(address(this), keccak256(msg.data));
    }

    /* ========== INTERNALS ========== */

    function _consume(address target, bytes32 callHash) internal {
        bytes32 id = _openChange[target][callHash];
        Change storage c = _changes[id];
        if (
            id == bytes32(0) || c.confirmer == address(0) || !c.agentApproved
                || block.timestamp < uint256(c.confirmedAt) + CHANGE_DELAY
        ) revert CollateralAgentChangeNotReady(target, callHash);
        c.status = DONE;
        delete _openChange[target][callHash];
        emit ChangeExecuted(id, target, callHash);
    }

    /// @dev What a bond is entitled to in a period: everything due once the period's whole total
    /// has been distributed, otherwise its share by the index, rounded down.
    function _entitlement(uint32 periodId, uint256 due) internal view returns (uint256) {
        Period storage p = _periods[periodId];
        if (p.totalDue != 0 && p.distributed == p.totalDue) return due;
        return due.mulDiv(p.index, WAD);
    }

    /// @dev Distributions already posted stay in the vault until claimed.
    function _checkFree(uint256 amount) internal view {
        uint256 held = vault.collateralAssets();
        if (held < _unclaimed + amount) revert CollateralAgentInsufficient(held, _unclaimed + amount);
    }

    function _onlyDirections() internal view {
        if (msg.sender != holderDirections || msg.sender == address(0)) revert CollateralAgentNotAgent(msg.sender);
    }

    function _foldCostApproval() internal {
        CostApproval storage a = _pendingCostApproval[periodCount];
        if (a.amount > 0 && block.timestamp >= a.effectiveAt) {
            _periods[periodCount].extraCostCap += a.amount;
            delete _pendingCostApproval[periodCount];
        }
    }

    function _syncKey() internal {
        address next = _pendingKey;
        if (next != address(0) && block.timestamp >= _pendingKeyAt) {
            emit AgentKeyRotated(_agentKey, next);
            _agentKey = next;
            _pendingKey = address(0);
            _pendingKeyAt = 0;
        }
    }
}
