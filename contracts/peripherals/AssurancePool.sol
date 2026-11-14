// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "../core/interfaces/stable-credit/IAssurancePool.sol";
import "../core/interfaces/stable-credit/IExposureSource.sol";

/// @dev What the pool asks the network registry: whether an address is on a money path (a credit
/// issuer, CLRUSD, the ESA vault, the pledge module, a pool or vault) and so may never pay in.
interface IMoneyPathRegistry {
    function isMoneyPath(address account) external view returns (bool);
}

/// @dev What the pool asks its governance: how long a proposal must wait.
interface ITimelockDelay {
    function getMinDelay() external view returns (uint256);
}

/// @title AssurancePool
/// @notice The co-op's Assurance contract (compliance section 13). Owned by Clear Collective, not
/// Clear Lending Co. It holds segregated compartments: CREDIT_BACKSTOP absorbs Lending Co.'s
/// charged-off principal under the I-11 agreement, and MEMBER_ASSURANCE funds member Assurance
/// grants. Governance may add more.
/// @dev **One contract, a per-compartment ledger, no shared spendable balance.** Every unit held
/// belongs to exactly one compartment, so the sum of compartment balances is what the pool holds
/// (13b). Value moves between compartments only through `executeTransfer`, and leaves only through
/// `releaseDraw` (CREDIT_BACKSTOP to Lending Co.'s loss-reserve address), `releaseAssurance`
/// (MEMBER_ASSURANCE to the co-op's Assurance disbursement address) and `executeTransfer`. There is
/// no sweep, rescue, withdraw, approve or admin transfer, and nothing is lent, staked or pledged.
///
/// **Two people for everything (13a).** Each admin, parameter, upgrade, release and transfer
/// action takes two distinct signers: one proposes, a different one approves, and nothing lets the
/// same address do both. Parameters and upgrades take a third thing as well: the governance
/// timelock (at least 7 days, the co-op board Safe proposing) must make the call, and the exact
/// calldata it sends must already carry two signers' approval (`approveAction`).
///
/// **Who has no role.** Lending Co. holds one narrow power: its Registered Draw Address may call
/// `requestDraw`, and nothing else. It cannot release. Its operating address may pay in fees and
/// recoveries through `deposit`, as the co-op treasury pays in the rest; paying in is not a role.
/// Neither may be a signer, and nobody at Clear Capital Management or Clear Capital Holdings is
/// named anywhere.
///
/// **Walled off from the money paths (13c, 13g).** No redemption, withdrawal, exit settlement,
/// payout, refund, netting, liquidation or force settlement reaches this contract, and none of
/// those contracts holds an address to call it with. `deposit` also refuses any address the
/// network registry lists as a money-path contract.
///
/// Replaces the Phase 1 reserve (primary, buffer and excess tiers rebalanced by an oracle toward a
/// target RTD). It is a new contract with a new layout, deployed fresh: the old pool exists only on
/// Base Sepolia.
contract AssurancePool is IAssurancePool, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== CONSTANTS ========== */

    bytes32 public constant CREDIT_BACKSTOP = "CREDIT_BACKSTOP";
    bytes32 public constant MEMBER_ASSURANCE = "MEMBER_ASSURANCE";
    uint256 public constant BPS = 10_000;
    /// @notice The shortest delay governance may run on (13g).
    uint256 public constant MIN_GOVERNANCE_DELAY = 7 days;
    /// @notice The shortest wait before a transfer out of a compartment may execute (13f).
    uint256 public constant MIN_TRANSFER_DELAY = 14 days;
    /// @notice How long a security pause lasts unless renewed (13g).
    uint256 public constant PAUSE_WINDOW = 72 hours;
    /// @notice A program year. Allocation is set per program year (13c).
    uint256 public constant PROGRAM_YEAR = 365 days;
    /// @dev Gas bounds, not business figures: the deposit split and the floor read loop over these.
    uint256 public constant MAX_COMPARTMENTS = 8;
    uint256 public constant MAX_EXPOSURE_SOURCES = 4;
    uint256 public constant MIN_SIGNERS = 2;

    /* ========== ERRORS ========== */

    error AssurancePoolInvalidAddress();
    error AssurancePoolInvalidAmount();
    error AssurancePoolNotSigner(address caller);
    error AssurancePoolSameSigner(address signer);
    error AssurancePoolNotGovernance(address caller);
    error AssurancePoolNotApproved(bytes32 action);
    error AssurancePoolGovernanceDelayTooShort(uint256 delay);
    error AssurancePoolNotPayer(address payer, SourceTag sourceTag);
    error AssurancePoolMoneyPath(address account);
    error AssurancePoolRoleConflict(address account);
    error AssurancePoolTooFewSigners();
    error AssurancePoolUnknownCompartment(bytes32 compartment);
    error AssurancePoolCompartmentExists(bytes32 compartment);
    error AssurancePoolCompartmentFixed(bytes32 compartment);
    error AssurancePoolCompartmentNotEmpty(bytes32 compartment);
    error AssurancePoolTooManyCompartments();
    error AssurancePoolBadAllocation();
    error AssurancePoolBackstopShareLowered(uint256 current, uint256 proposed);
    error AssurancePoolNotDrawAddress(address caller);
    error AssurancePoolPeriodAlreadyDrawn(uint256 periodId);
    error AssurancePoolBadDrawState(uint256 drawId);
    error AssurancePoolDrawOutOfOrder(uint256 drawId, uint256 next);
    error AssurancePoolAboveCoverage(uint256 amount, uint256 available);
    error AssurancePoolCompartmentShort(bytes32 compartment, uint256 balance, uint256 amount);
    error AssurancePoolGrantAlreadyPaid(bytes32 grantId);
    error AssurancePoolTransferTooEarly(uint256 executableAt);
    error AssurancePoolBelowFloor(uint256 backstopBalance, uint256 required);
    error AssurancePoolBadTransfer(uint256 transferId);
    error AssurancePoolPaused(uint256 until);
    error AssurancePoolNotPaused();

    /* ========== OTHER EVENTS ========== */

    event ActionProposed(bytes32 indexed action, address indexed proposer);
    event ActionApproved(bytes32 indexed action, address indexed proposer, address indexed approver);
    event GovernanceSet(address indexed governance);
    event NetworkRegistrySet(address indexed registry);
    event SignerSet(address indexed signer, bool allowed);
    event PayerSet(address indexed payer, uint256 sourceTagMask);
    event LendingCoAddressesSet(address indexed drawAddress, address indexed lossReserveAddress);
    event AssuranceDisbursementAddressSet(address indexed disbursement);
    event FloorBpsSet(uint256 floorBps);
    event ExposureSourcesSet(address[] sources);
    event TransferDelaySet(uint256 delay);
    event CompartmentAdded(bytes32 indexed compartment);
    event CompartmentRemoved(bytes32 indexed compartment);
    event SecurityPaused(uint256 until, address proposer, address approver);
    event SecurityUnpaused(address proposer, address approver);

    /* ========== STORAGE ========== */
    // Fresh layout (Phase 2c). New storage goes at the end, out of `__gap`; compartment balances
    // live in `compartmentOf`, which no upgrade may move (13g).

    struct Compartment {
        bool exists;
        uint16 allocationBps;
        uint256 balance;
    }

    /// @notice The one asset held: USDC.
    IERC20Upgradeable public asset;
    /// @notice The co-op's Assurance timelock (7 days or more; the board Safe proposes).
    address public governance;
    /// @notice Where the money-path list lives.
    IMoneyPathRegistry public networkRegistry;

    mapping(address => bool) public isSigner;
    uint256 public signerCount;
    /// @notice The first signer of a two-person action still waiting for its second.
    mapping(bytes32 => address) public proposerOf;
    /// @notice Governance calldata two signers have approved and governance has not yet used.
    mapping(bytes32 => bool) public approvedAction;

    bytes32[] private compartmentList;
    mapping(bytes32 => Compartment) private compartmentOf;
    /// @notice Sum of every compartment's balance.
    uint256 public totalAccounted;
    uint256 public programYearStart;
    /// @notice The program year the allocation was last set in.
    uint256 public allocationYear;

    /// @notice payer => bit mask of the source tags it may deposit under.
    mapping(address => uint256) public payerTags;

    uint256 public floorBps;
    uint256 public timingBufferShortfall;
    uint256 public coverageCap;
    uint256 public attestedCoveredBook;
    bytes32 public floorEvidenceHash;
    uint256 public floorInputsAt;
    address[] private exposureSources;

    /// @notice Lending Co.'s Registered Draw Address: `requestDraw` and nothing else.
    address public drawAddress;
    /// @notice Lending Co.'s registered loss-reserve address: the only place a draw is paid.
    address public lossReserveAddress;
    /// @notice The co-op's registered Assurance disbursement address: the only place a grant is paid.
    address public assuranceDisbursementAddress;

    Draw[] private draws;
    /// @notice periodId => drawId + 1 (zero when the period has no draw).
    mapping(uint256 => uint256) public drawOfPeriod;
    /// @notice The earliest draw not yet released or closed. Draws leave in request order.
    uint256 public nextDraw;
    /// @notice Requested and not yet decided.
    uint256 public pendingDrawRequests;
    /// @notice Approved and not yet released.
    uint256 public approvedUnpaidDraws;

    mapping(bytes32 => bool) public grantPaid;

    Transfer[] private transfers;
    uint256 public transferDelay;

    uint256 public pausedUntil;
    uint256 public pauseEpoch;

    uint256[67] private __gap;

    /* ========== INITIALIZER ========== */

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param asset_ USDC.
    /// @param governance_ the Assurance timelock; its minimum delay must be 7 days or more.
    /// @param registry_ the NetworkRegistry holding the money-path list.
    /// @param signers_ the co-op's signers (at least two, all distinct).
    function initialize(address asset_, address governance_, address registry_, address[] calldata signers_)
        external
        initializer
    {
        if (asset_ == address(0) || registry_ == address(0)) revert AssurancePoolInvalidAddress();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        asset = IERC20Upgradeable(asset_);
        networkRegistry = IMoneyPathRegistry(registry_);
        _setGovernance(governance_);
        for (uint256 i = 0; i < signers_.length; i++) _setSigner(signers_[i], true);
        if (signerCount < MIN_SIGNERS) revert AssurancePoolTooFewSigners();

        _addCompartment(CREDIT_BACKSTOP);
        _addCompartment(MEMBER_ASSURANCE);
        compartmentOf[CREDIT_BACKSTOP].allocationBps = 5_000;
        compartmentOf[MEMBER_ASSURANCE].allocationBps = 5_000;
        programYearStart = block.timestamp;
        floorBps = 500;
        transferDelay = MIN_TRANSFER_DELAY;
        emit FloorBpsSet(500);
        emit TransferDelaySet(MIN_TRANSFER_DELAY);
        _emitAllocation();
    }

    /* ========== VIEWS ========== */

    /// @notice What a compartment holds.
    function balanceOf(bytes32 compartment) public view override returns (uint256) {
        return compartmentOf[compartment].balance;
    }

    /// @notice Every compartment, the Credit Backstop first.
    function compartments() external view returns (bytes32[] memory) {
        return compartmentList;
    }

    function allocationOf(bytes32 compartment) external view returns (uint256) {
        return compartmentOf[compartment].allocationBps;
    }

    function exposureSourceList() external view returns (address[] memory) {
        return exposureSources;
    }

    function currentProgramYear() public view returns (uint256) {
        return (block.timestamp - programYearStart) / PROGRAM_YEAR;
    }

    /// @notice The unsecured exposure the backstop covers (13d): what the exposure sources report
    /// (income-backed, Clear Boost and term-plan debt not covered by collateral), or the monthly
    /// attested figure when that is higher.
    /// @dev A source that cannot answer contributes nothing rather than blocking deposits; the
    /// attested figure is the monthly floor under a reading that has gone quiet.
    function coveredBookPrincipal() public view override returns (uint256 covered) {
        for (uint256 i = 0; i < exposureSources.length; i++) {
            (bool ok, bytes memory data) =
                exposureSources[i].staticcall(abi.encodeCall(IExposureSource.poolExposure, ()));
            if (ok && data.length >= 32) covered += abi.decode(data, (uint256));
        }
        if (attestedCoveredBook > covered) covered = attestedCoveredBook;
    }

    /// @notice max(timingBufferShortfall, floorBps x coveredBookPrincipal / 10,000) (13d).
    function backstopFloor() public view override returns (uint256) {
        uint256 byBook = (floorBps * coveredBookPrincipal()) / BPS;
        return byBook > timingBufferShortfall ? byBook : timingBufferShortfall;
    }

    /// @notice CREDIT_BACKSTOP assets less approved draws not yet paid (13d).
    function backstopBalance() public view override returns (uint256) {
        uint256 held = compartmentOf[CREDIT_BACKSTOP].balance;
        return held > approvedUnpaidDraws ? held - approvedUnpaidDraws : 0;
    }

    /// @notice min(backstopBalance(), coverageCap) (13d).
    function availableCoverage() public view override returns (uint256) {
        uint256 b = backstopBalance();
        return b < coverageCap ? b : coverageCap;
    }

    function drawCount() external view returns (uint256) {
        return draws.length;
    }

    function drawAt(uint256 drawId) external view returns (Draw memory) {
        return draws[drawId];
    }

    function transferCount() external view returns (uint256) {
        return transfers.length;
    }

    function transferAt(uint256 transferId) external view returns (Transfer memory) {
        return transfers[transferId];
    }

    function paused() public view returns (bool) {
        return block.timestamp < pausedUntil;
    }

    /* ========== INFLOWS (13c) ========== */

    /// @notice the one entry point. RECOVERY goes wholly to the Credit Backstop. Anything else fills
    /// the Credit Backstop up to its floor first and splits the rest by the year's allocation.
    /// @dev Only from an allowlisted payer for that tag, and never from a money-path contract. A
    /// security pause does not stop money coming in.
    function deposit(SourceTag sourceTag, uint256 amount) external override nonReentrant {
        if (amount == 0) revert AssurancePoolInvalidAmount();
        if (payerTags[msg.sender] & (uint256(1) << uint8(sourceTag)) == 0) {
            revert AssurancePoolNotPayer(msg.sender, sourceTag);
        }
        if (networkRegistry.isMoneyPath(msg.sender)) revert AssurancePoolMoneyPath(msg.sender);

        uint256 before = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = asset.balanceOf(address(this)) - before;

        if (sourceTag == SourceTag.RECOVERY) {
            _credit(sourceTag, CREDIT_BACKSTOP, received);
            return;
        }
        uint256 floor = backstopFloor();
        uint256 held = backstopBalance();
        uint256 fill = floor > held ? floor - held : 0;
        if (fill > received) fill = received;
        uint256 rest = received - fill;

        uint256 toOthers;
        uint256[] memory shares = new uint256[](compartmentList.length);
        for (uint256 i = 1; i < compartmentList.length; i++) {
            shares[i] = (rest * compartmentOf[compartmentList[i]].allocationBps) / BPS;
            toOthers += shares[i];
        }
        // The floor fill first, then the backstop's own share with any rounding dust: dust never
        // leaves it.
        _credit(sourceTag, CREDIT_BACKSTOP, fill);
        _credit(sourceTag, CREDIT_BACKSTOP, rest - toOthers);
        for (uint256 i = 1; i < compartmentList.length; i++) {
            if (shares[i] > 0) _credit(sourceTag, compartmentList[i], shares[i]);
        }
    }

    function _credit(SourceTag sourceTag, bytes32 compartment, uint256 amount) private {
        if (amount == 0) return;
        compartmentOf[compartment].balance += amount;
        totalAccounted += amount;
        emit CompartmentCredited(sourceTag, compartment, amount);
    }

    function _debit(bytes32 compartment, uint256 amount) private {
        uint256 held = compartmentOf[compartment].balance;
        if (held < amount) revert AssurancePoolCompartmentShort(compartment, held, amount);
        compartmentOf[compartment].balance = held - amount;
        totalAccounted -= amount;
    }

    /* ========== FLOOR INPUTS (13d), monthly, two signers ========== */

    /// @notice sets the month's timing-buffer shortfall, coverage cap and attested covered book.
    /// @dev The first signer's call proposes; the same call from a different signer applies it.
    function setFloorInputs(uint256 shortfall, uint256 cap, uint256 attestedBook, bytes32 evidenceHash) external {
        if (evidenceHash == bytes32(0)) revert AssurancePoolInvalidAmount();
        bytes32 action = keccak256(abi.encode("floor", shortfall, cap, attestedBook, evidenceHash));
        address first = proposerOf[action];
        if (!_pair(action)) return;
        timingBufferShortfall = shortfall;
        coverageCap = cap;
        attestedCoveredBook = attestedBook;
        floorEvidenceHash = evidenceHash;
        floorInputsAt = block.timestamp;
        emit FloorInputsSet(shortfall, cap, attestedBook, evidenceHash, first, msg.sender);
    }

    /* ========== DRAWS (13e) ========== */

    /// @notice Lending Co. asks for a period's charged-off principal. One request per period.
    function requestDraw(uint256 periodId, uint256 amount, bytes32 evidenceHash) external returns (uint256 drawId) {
        if (msg.sender != drawAddress) revert AssurancePoolNotDrawAddress(msg.sender);
        if (amount == 0 || amount > type(uint128).max || periodId > type(uint64).max) {
            revert AssurancePoolInvalidAmount();
        }
        if (drawOfPeriod[periodId] != 0) revert AssurancePoolPeriodAlreadyDrawn(periodId);
        drawId = draws.length;
        draws.push(Draw(uint64(periodId), DrawStatus.Requested, address(0), uint128(amount), 0, evidenceHash));
        drawOfPeriod[periodId] = drawId + 1;
        pendingDrawRequests += amount;
        emit DrawRequested(drawId, periodId, amount, evidenceHash);
    }

    /// @notice signer A decides how much of a request is owed. What is not approved (a disputed
    /// remainder) stays in the Credit Backstop; approving zero closes the request.
    function approveDraw(uint256 drawId, uint256 approvedAmount) external onlySigner {
        Draw storage d = _draw(drawId);
        if (d.status != DrawStatus.Requested || approvedAmount > d.requested) revert AssurancePoolBadDrawState(drawId);
        uint256 available = availableCoverage();
        if (approvedAmount > available) revert AssurancePoolAboveCoverage(approvedAmount, available);
        pendingDrawRequests -= d.requested;
        d.approver = msg.sender;
        d.approved = uint128(approvedAmount);
        if (approvedAmount == 0) {
            d.status = DrawStatus.Closed;
        } else {
            d.status = DrawStatus.Approved;
            approvedUnpaidDraws += approvedAmount;
        }
        emit DrawApproved(drawId, approvedAmount, msg.sender);
    }

    /// @notice signer B, never the approver, pays an approved draw to Lending Co.'s loss-reserve
    /// address, from the Credit Backstop only, in request order.
    function releaseDraw(uint256 drawId) external onlySigner whenNotPaused nonReentrant {
        Draw storage d = _draw(drawId);
        if (d.status != DrawStatus.Approved) revert AssurancePoolBadDrawState(drawId);
        if (d.approver == msg.sender) revert AssurancePoolSameSigner(msg.sender);
        uint256 next = nextDraw;
        while (next < draws.length && (draws[next].status == DrawStatus.Released || draws[next].status == DrawStatus.Closed)) {
            next++;
        }
        if (drawId != next) revert AssurancePoolDrawOutOfOrder(drawId, next);
        address to = lossReserveAddress;
        if (to == address(0)) revert AssurancePoolInvalidAddress();

        uint256 amount = d.approved;
        // Coverage as it stands for this draw: the backstop less every OTHER approved draw.
        approvedUnpaidDraws -= amount;
        uint256 available = availableCoverage();
        if (amount > available) revert AssurancePoolAboveCoverage(amount, available);
        _debit(CREDIT_BACKSTOP, amount);
        d.status = DrawStatus.Released;
        nextDraw = next + 1;
        asset.safeTransfer(to, amount);
        emit DrawReleased(drawId, amount, to, msg.sender);
    }

    function _draw(uint256 drawId) private view returns (Draw storage) {
        if (drawId >= draws.length) revert AssurancePoolBadDrawState(drawId);
        return draws[drawId];
    }

    /* ========== ASSURANCE GRANTS (13e) ========== */

    /// @notice pays a member Assurance grant to the co-op's disbursement address, from
    /// MEMBER_ASSURANCE only. Two signers: the first call proposes, the same call from a different
    /// signer pays. Reverts if MEMBER_ASSURANCE is short; never falls back to another compartment.
    /// @dev `grantId` is the co-op's own reference. No member data goes on chain.
    function releaseAssurance(bytes32 grantId, uint256 amount, bytes32 evidenceHash) external nonReentrant {
        if (amount == 0 || grantId == bytes32(0)) revert AssurancePoolInvalidAmount();
        if (grantPaid[grantId]) revert AssurancePoolGrantAlreadyPaid(grantId);
        uint256 held = compartmentOf[MEMBER_ASSURANCE].balance;
        if (held < amount) revert AssurancePoolCompartmentShort(MEMBER_ASSURANCE, held, amount);
        address to = assuranceDisbursementAddress;
        if (to == address(0)) revert AssurancePoolInvalidAddress();
        bytes32 action = keccak256(abi.encode("grant", grantId, amount, evidenceHash));
        address first = proposerOf[action];
        if (!_pair(action)) return;
        if (paused()) revert AssurancePoolPaused(pausedUntil);
        grantPaid[grantId] = true;
        _debit(MEMBER_ASSURANCE, amount);
        asset.safeTransfer(to, amount);
        emit AssuranceReleased(grantId, amount, evidenceHash, to, first);
    }

    /* ========== TRANSFERS BETWEEN COMPARTMENTS (13f) ========== */

    function proposeTransfer(bytes32 from, bytes32 to, uint256 amount, bytes32 resolutionHash)
        external
        onlySigner
        returns (uint256 transferId)
    {
        if (!compartmentOf[from].exists) revert AssurancePoolUnknownCompartment(from);
        if (!compartmentOf[to].exists) revert AssurancePoolUnknownCompartment(to);
        if (from == to || amount == 0) revert AssurancePoolInvalidAmount();
        transferId = transfers.length;
        transfers.push(Transfer(from, to, amount, resolutionHash, msg.sender, uint64(block.timestamp), false));
        emit TransferProposed(transferId, from, to, amount, resolutionHash, msg.sender);
    }

    /// @notice a different signer executes a proposed transfer. Into the Credit Backstop at once;
    /// anywhere else only after the transfer delay (at least 14 days). Out of the Credit Backstop
    /// only if what is left still covers the floor and every pending draw request.
    function executeTransfer(uint256 transferId) external onlySigner whenNotPaused {
        if (transferId >= transfers.length) revert AssurancePoolBadTransfer(transferId);
        Transfer storage t = transfers[transferId];
        if (t.executed || !compartmentOf[t.from].exists || !compartmentOf[t.to].exists) {
            revert AssurancePoolBadTransfer(transferId);
        }
        if (t.proposer == msg.sender) revert AssurancePoolSameSigner(msg.sender);
        if (t.to != CREDIT_BACKSTOP) {
            uint256 at = uint256(t.proposedAt) + transferDelay;
            if (block.timestamp < at) revert AssurancePoolTransferTooEarly(at);
        }
        if (t.from == CREDIT_BACKSTOP) {
            uint256 required = backstopFloor() + pendingDrawRequests + t.amount;
            uint256 held = backstopBalance();
            if (held < required) revert AssurancePoolBelowFloor(held, required);
        }
        t.executed = true;
        _debit(t.from, t.amount);
        compartmentOf[t.to].balance += t.amount;
        totalAccounted += t.amount;
        emit TransferExecuted(transferId, t.from, t.to, t.amount, msg.sender);
    }

    /* ========== SECURITY PAUSE (13g) ========== */

    /// @notice blocks releases and transfers for 72 hours. Two signers. Deposits and draw requests
    /// still go through.
    function pause() external {
        _pauseFor("pause");
    }

    /// @notice another 72 hours, by two signers again, while a pause stands.
    function renewPause() external {
        if (!paused()) revert AssurancePoolNotPaused();
        _pauseFor("renew");
    }

    function unpause() external {
        if (!paused()) revert AssurancePoolNotPaused();
        bytes32 action = keccak256(abi.encode("unpause", pauseEpoch));
        address first = proposerOf[action];
        if (!_pair(action)) return;
        pausedUntil = 0;
        pauseEpoch++;
        emit SecurityUnpaused(first, msg.sender);
    }

    function _pauseFor(string memory kind) private {
        bytes32 action = keccak256(abi.encode(kind, pauseEpoch));
        address first = proposerOf[action];
        if (!_pair(action)) return;
        pausedUntil = block.timestamp + PAUSE_WINDOW;
        pauseEpoch++;
        emit SecurityPaused(pausedUntil, first, msg.sender);
    }

    /* ========== TWO-PERSON CONTROL ========== */

    /// @notice a signer's half of approving a governance call. When a second, different signer
    /// approves the same calldata hash, governance may make that call once.
    /// @param action keccak256 of the exact calldata governance will send.
    function approveAction(bytes32 action) external {
        if (_pair(keccak256(abi.encode("governance", action)))) approvedAction[action] = true;
    }

    /// @dev The first signer to ask records itself and returns false. A different signer asking
    /// for the same action completes it and returns true. The same signer twice reverts. A
    /// proposer who has since been removed no longer counts, so the caller starts afresh.
    function _pair(bytes32 action) private returns (bool) {
        if (!isSigner[msg.sender]) revert AssurancePoolNotSigner(msg.sender);
        address first = proposerOf[action];
        if (first == msg.sender) revert AssurancePoolSameSigner(msg.sender);
        if (first == address(0) || !isSigner[first]) {
            proposerOf[action] = msg.sender;
            emit ActionProposed(action, msg.sender);
            return false;
        }
        delete proposerOf[action];
        emit ActionApproved(action, first, msg.sender);
        return true;
    }

    /// @dev Governance (the timelock) is the caller, and two signers approved this exact calldata.
    function _governed() private {
        if (msg.sender != governance) revert AssurancePoolNotGovernance(msg.sender);
        bytes32 action = keccak256(msg.data);
        if (!approvedAction[action]) revert AssurancePoolNotApproved(action);
        delete approvedAction[action];
    }

    /* ========== GOVERNANCE: timelock + two signers ========== */

    function setSigner(address signer, bool allowed) external {
        _governed();
        _setSigner(signer, allowed);
        if (signerCount < MIN_SIGNERS) revert AssurancePoolTooFewSigners();
    }

    /// @notice which source tags a payer may deposit under (a bit per `SourceTag`); zero removes it.
    function setPayer(address payer, uint256 sourceTagMask) external {
        _governed();
        if (payer == address(0) || sourceTagMask > 0xF) revert AssurancePoolInvalidAddress();
        if (isSigner[payer] || payer == drawAddress) revert AssurancePoolRoleConflict(payer);
        if (sourceTagMask != 0 && networkRegistry.isMoneyPath(payer)) revert AssurancePoolMoneyPath(payer);
        payerTags[payer] = sourceTagMask;
        emit PayerSet(payer, sourceTagMask);
    }

    /// @notice Lending Co.'s Registered Draw Address and its loss-reserve address.
    function setLendingCoAddresses(address draw_, address lossReserve_) external {
        _governed();
        if (draw_ == address(0) || lossReserve_ == address(0)) revert AssurancePoolInvalidAddress();
        if (isSigner[draw_] || isSigner[lossReserve_] || payerTags[draw_] != 0) revert AssurancePoolRoleConflict(draw_);
        drawAddress = draw_;
        lossReserveAddress = lossReserve_;
        emit LendingCoAddressesSet(draw_, lossReserve_);
    }

    function setAssuranceDisbursementAddress(address disbursement) external {
        _governed();
        if (disbursement == address(0)) revert AssurancePoolInvalidAddress();
        assuranceDisbursementAddress = disbursement;
        emit AssuranceDisbursementAddressSet(disbursement);
    }

    function setFloorBps(uint256 floorBps_) external {
        _governed();
        if (floorBps_ > BPS) revert AssurancePoolInvalidAmount();
        floorBps = floorBps_;
        emit FloorBpsSet(floorBps_);
    }

    /// @notice what reports the unsecured covered book (in practice the CollateralRegistry, which
    /// reads every issuer's debt by kind).
    function setExposureSources(address[] calldata sources) external {
        _governed();
        if (sources.length > MAX_EXPOSURE_SOURCES) revert AssurancePoolInvalidAmount();
        for (uint256 i = 0; i < sources.length; i++) {
            if (sources[i] == address(0)) revert AssurancePoolInvalidAddress();
        }
        exposureSources = sources;
        emit ExposureSourcesSet(sources);
    }

    function setTransferDelay(uint256 delay) external {
        _governed();
        if (delay < MIN_TRANSFER_DELAY) revert AssurancePoolInvalidAmount();
        transferDelay = delay;
        emit TransferDelaySet(delay);
    }

    /// @notice the share of each inflow (after the backstop floor) each compartment takes, listed
    /// for every compartment in `compartments()` order and summing to 10,000.
    /// @dev Set per program year: within the year it was last set in, the Credit Backstop's share
    /// may rise but never fall.
    function setAllocation(uint16[] calldata bps) external {
        _governed();
        uint256 n = compartmentList.length;
        if (bps.length != n) revert AssurancePoolBadAllocation();
        uint256 sum;
        for (uint256 i = 0; i < n; i++) sum += bps[i];
        if (sum != BPS) revert AssurancePoolBadAllocation();
        uint256 year = currentProgramYear();
        uint256 current = compartmentOf[CREDIT_BACKSTOP].allocationBps;
        if (year == allocationYear && bps[0] < current) revert AssurancePoolBackstopShareLowered(current, bps[0]);
        for (uint256 i = 0; i < n; i++) compartmentOf[compartmentList[i]].allocationBps = bps[i];
        allocationYear = year;
        _emitAllocation();
    }

    /// @notice a new compartment, at 0% allocation. It never ranks ahead of the backstop floor,
    /// which every non-recovery inflow fills first.
    function addCompartment(bytes32 id) external {
        _governed();
        _addCompartment(id);
    }

    /// @notice removes an empty, unallocated compartment. Never the Credit Backstop or Member
    /// Assurance.
    function removeCompartment(bytes32 id) external {
        _governed();
        Compartment storage c = compartmentOf[id];
        if (id == CREDIT_BACKSTOP || id == MEMBER_ASSURANCE) revert AssurancePoolCompartmentFixed(id);
        if (!c.exists) revert AssurancePoolUnknownCompartment(id);
        if (c.balance != 0 || c.allocationBps != 0) revert AssurancePoolCompartmentNotEmpty(id);
        delete compartmentOf[id];
        uint256 n = compartmentList.length;
        for (uint256 i = 2; i < n; i++) {
            if (compartmentList[i] == id) {
                compartmentList[i] = compartmentList[n - 1];
                compartmentList.pop();
                break;
            }
        }
        emit CompartmentRemoved(id);
    }

    function setNetworkRegistry(address registry) external {
        _governed();
        if (registry == address(0)) revert AssurancePoolInvalidAddress();
        networkRegistry = IMoneyPathRegistry(registry);
        emit NetworkRegistrySet(registry);
    }

    function setGovernance(address governance_) external {
        _governed();
        _setGovernance(governance_);
    }

    /// @dev Upgrades: the timelock, two signers on the exact upgrade call, and a delay still at
    /// least 7 days. Balances live in `compartmentOf`, which an upgrade must leave where it is.
    function _authorizeUpgrade(address) internal override {
        _governed();
        _checkDelay(governance);
    }

    /* ========== INTERNAL ========== */

    function _setGovernance(address governance_) private {
        if (governance_ == address(0)) revert AssurancePoolInvalidAddress();
        if (isSigner[governance_]) revert AssurancePoolRoleConflict(governance_);
        _checkDelay(governance_);
        governance = governance_;
        emit GovernanceSet(governance_);
    }

    function _checkDelay(address timelock) private view {
        uint256 delay = ITimelockDelay(timelock).getMinDelay();
        if (delay < MIN_GOVERNANCE_DELAY) revert AssurancePoolGovernanceDelayTooShort(delay);
    }

    /// @dev A signer is never Lending Co. (its draw, loss-reserve or paying address), never a
    /// money-path contract, and never the governance timelock itself.
    function _setSigner(address signer, bool allowed) private {
        if (signer == address(0)) revert AssurancePoolInvalidAddress();
        if (allowed) {
            if (
                signer == drawAddress || signer == lossReserveAddress || payerTags[signer] != 0
                    || signer == governance || networkRegistry.isMoneyPath(signer)
            ) revert AssurancePoolRoleConflict(signer);
            if (!isSigner[signer]) {
                isSigner[signer] = true;
                signerCount++;
            }
        } else if (isSigner[signer]) {
            isSigner[signer] = false;
            signerCount--;
        }
        emit SignerSet(signer, allowed);
    }

    function _addCompartment(bytes32 id) private {
        if (id == bytes32(0)) revert AssurancePoolInvalidAddress();
        if (compartmentOf[id].exists) revert AssurancePoolCompartmentExists(id);
        if (compartmentList.length >= MAX_COMPARTMENTS) revert AssurancePoolTooManyCompartments();
        compartmentOf[id].exists = true;
        compartmentList.push(id);
        emit CompartmentAdded(id);
    }

    function _emitAllocation() private {
        uint256 n = compartmentList.length;
        uint16[] memory bps = new uint16[](n);
        for (uint256 i = 0; i < n; i++) bps[i] = compartmentOf[compartmentList[i]].allocationBps;
        emit AllocationSet(currentProgramYear(), compartmentList, bps);
    }

    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert AssurancePoolNotSigner(msg.sender);
        _;
    }

    modifier whenNotPaused() {
        if (paused()) revert AssurancePoolPaused(pausedUntil);
        _;
    }
}
