// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./LendingPoolBase.sol";
import "../libraries/PacificCalendar.sol";

/// @title YieldPoolValuation
/// @notice The Yield Pool's valuation and control functions: the two-person Pool Loss Allowance and
/// Pool Loss Charge postings, the Loss Holdback ledger's batched release and application (§6A),
/// Suspension (§8), the Funding Rate model with its notice rules (IV-02 Sch. 2), Deployments, and
/// the governed settings.
/// @dev A delegatecall module of `LendingPool`, pinned at construction like the issuer modules.
/// Never called directly in production: this code runs against the pool proxy's storage with the
/// original caller. It declares no storage (see `LendingPoolBase`).
///
/// No function here can pay a holdback anywhere but its Holder's account, raise an existing H,
/// apply more than the formula, or move money out of the vault except a Deployment to the
/// registered lending account and the part of a loss charge above the Deployed Balance and
/// accrued interest, to the same account (§6). There is no sweep or rescue.
contract YieldPoolValuation is LendingPoolBase {
    using MathUpgradeable for uint256;

    /// @notice what LendingPool's constructor checks before pinning this module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("YieldPoolValuation.v1");
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /* ========== SETUP AND GOVERNED SETTINGS (DEFAULT_ADMIN_ROLE: the Earn timelock) ========== */

    /// @notice turns a pre-2f LendingPool into the Yield Pool, once, as the upgrade's call.
    /// @dev The legacy borrowers' principal (`totalBorrowed`) becomes the opening Deployed Balance,
    /// owed by Clear Lending, and Pool Interest accrues on it from now. Requests queued before 2f
    /// keep their fixed claims outside Pool Assets. A pool that already has shares must name the
    /// Initial Closing (the first issue of Pool Shares).
    function initializeYieldPool(address controls, address deploymentAccount_, uint64 initialClosing_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_lastAccrualAt != 0) revert LendingPoolAlreadyInitialized();
        if (initialClosing_ > block.timestamp || (totalSupply() > 0) != (initialClosing_ != 0)) {
            revert LendingPoolInvalidAmount();
        }
        _rateModel = RateModel(0.02e18, 0.03e18, 0.8e18, 0.05e18);
        _holderCapBps = 1_000;
        _holdbackMaxAge = 540 days;
        _lastAccrualAt = uint64(block.timestamp);
        _earnControls = IPoolEarnControls(controls);
        _deploymentAccount = deploymentAccount_;
        if (initialClosing_ != 0) _initialClosing = initialClosing_;
        // X-18's streamed interest has no meaning under per-second accrual.
        lockedInterest = 0;
        emit YieldPoolInitialized(controls, deploymentAccount_, totalBorrowed);
    }

    function setEarnControls(address controls) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _earnControls = IPoolEarnControls(controls);
        emit EarnControlsUpdated(controls);
    }

    /// @notice registers Clear Lending's lending account, the only place a Deployment goes.
    function setDeploymentAccount(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert LendingPoolInvalidAddress();
        _deploymentAccount = account;
        emit DeploymentAccountUpdated(account);
    }

    /// @notice records where MB-05 enforcement redemptions pay (the pledge module's enforcer).
    function setEnforcementDestination(address destination) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _enforcementDestination = destination;
        emit EnforcementDestinationUpdated(destination);
    }

    function setHolderCapBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > BPS) revert LendingPoolInvalidAmount();
        _holderCapBps = uint16(bps);
        emit HolderCapUpdated(bps);
    }

    /// @notice sets the holdback maximum age. A lowering applies to existing holdbacks; a raise
    /// applies only to holdbacks created after it (§6A).
    function setHoldbackMaxAge(uint256 maxAge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (maxAge == 0 || maxAge > type(uint32).max) revert LendingPoolInvalidAmount();
        uint256 boundary = holdbacks.length;
        if (maxAge < _holdbackMaxAge && boundary > _holdbackHead) {
            // Keep the caps' values rising with their boundaries: a new, lower cap reaches every
            // holdback an earlier, higher one did.
            while (ageCaps.length > 0 && ageCaps[ageCaps.length - 1].maxAge >= maxAge) ageCaps.pop();
            ageCaps.push(AgeCap(uint128(boundary), uint128(maxAge)));
        }
        _holdbackMaxAge = maxAge;
        emit HoldbackMaxAgeUpdated(maxAge);
    }

    /* ========== MOVED FROM THE POOL FOR SIZE ========== */

    /// @notice sets up a new pool. A pool upgraded from before Phase 2f calls
    /// `initializeYieldPool` instead.
    function initialize(address admin, address reserveToken, string memory name_, string memory symbol_)
        external
        initializer
    {
        if (admin == address(0) || reserveToken == address(0)) revert LendingPoolInvalidAddress();
        __ERC20_init(name_, symbol_);
        __ERC4626_init(IERC20Upgradeable(reserveToken));
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _rateModel = RateModel(0.02e18, 0.03e18, 0.8e18, 0.05e18);
        _holderCapBps = 1_000;
        _holdbackMaxAge = 540 days;
        _lastAccrualAt = uint64(block.timestamp);
    }

    /// @notice cancels all or part of an unfilled request, at any time, a Suspension included.
    /// The shares go back to the owner. An enforcement request is cancelled only by the enforcer.
    function cancelRequest(uint256 requestId, uint256 shares) external {
        QueueRequest storage r = queue[requestId];
        if (r.enforcement ? !hasRole(ENFORCER_ROLE, msg.sender) : msg.sender != r.owner) {
            revert LendingPoolNotRequestOwner(requestId);
        }
        uint256 left = r.shares;
        if (shares == 0 || shares > left) revert LendingPoolNothingQueued(requestId);
        left -= shares;
        r.shares = uint128(left);
        _dequeue(r, shares);
        _transfer(address(this), r.owner, shares);
        emit QueueCancelled(requestId, msg.sender, shares, left);
    }

    /// @notice pays a request queued before Phase 2f, whose shares were burned when queued.
    function claimWithdrawal(uint256 requestId) external returns (uint256 assets) {
        WithdrawalRequest storage r = requests[requestId];
        assets = r.assets;
        if (r.claimed || assets == 0 || requestSharesOf[requestId] != 0) revert LendingPoolNothingQueued(requestId);
        if (r.owner != msg.sender) revert LendingPoolNotRequestOwner(requestId);
        r.claimed = true;
        queuedAssets -= assets;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), r.receiver, assets);
        emit WithdrawalClaimed(requestId, r.receiver, assets);
    }

    /// @notice pays the caller what a refused transfer left owed to it.
    function claimUnpaid() external {
        uint256 amount = _unpaidOf[msg.sender];
        if (amount == 0) revert LendingPoolInvalidAmount();
        _unpaidOf[msg.sender] = 0;
        _totalUnpaid -= amount;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), msg.sender, amount);
        emit UnpaidClaimed(msg.sender, amount);
    }

    /// @notice a Return: pays accrued Pool Interest first, then the Deployed Balance. Anything
    /// above both stays in the vault as cash (the error-correction path, into the vault only).
    /// Anyone may call it.
    function returnFunds(uint256 amount) public {
        if (amount == 0) revert LendingPoolInvalidAmount();
        _accrue();
        uint256 interest = interestAccrued;
        uint256 toInterest = amount < interest ? amount : interest;
        interestAccrued = interest - toInterest;
        uint256 rest = amount - toInterest;
        uint256 principal = totalBorrowed;
        uint256 toPrincipal = rest < principal ? rest : principal;
        totalBorrowed = principal - toPrincipal;
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(asset()), msg.sender, address(this), amount);
        emit Returned(msg.sender, toInterest, toPrincipal, rest - toPrincipal);
    }

    /// @notice the PayoutPool's repayment, kept so its unchanged code still works: a Return.
    function repay(uint256 amount) external {
        returnFunds(amount);
        emit Repaid(msg.sender, amount);
    }

    /// @notice records a holder's current lock from the source. Permissionless.
    function syncEncumbrance(address holder) external returns (uint256 locked) {
        if (address(encumbranceSource) == address(0) || collateralKind == bytes32(0)) return 0;
        locked = encumbranceSource.encumberedOfKind(holder, collateralKind);
        lastKnownLock[holder] = locked;
    }

    /// @notice sets the contract reporting what is pledged, and the kind to ask about.
    function setEncumbranceSource(address source, bytes32 kind) external onlyRole(OPERATOR_ROLE) {
        encumbranceSource = IEncumbranceSource(source);
        collateralKind = kind;
        emit EncumbranceSourceUpdated(source);
    }

    /* ========== DEPLOYMENTS (two people; decision 17) ========== */

    /// @notice a Deployment to Clear Lending's registered lending account. The first
    /// `DEPLOYER_ROLE` signer's call proposes; the same call from a different one sends it.
    /// @dev Only with no open queue request, no Suspension, no pending loss charge and before
    /// Final Maturity, and only if utilization afterwards is at most 90% (FIXED).
    /// @param amount USDC to deploy.
    /// @param ref a reference that makes each proposal distinct.
    function deploy(uint256 amount, bytes32 ref) external {
        address to = _deploymentAccount;
        if (to == address(0)) revert LendingPoolInvalidAddress();
        if (amount == 0) revert LendingPoolInvalidAmount();
        if (_queuedShares > 0) revert LendingPoolQueueOpen();
        if (isSuspended()) revert LendingPoolSuspended();
        if (lossCharge.pending) revert LendingPoolChargePending();
        if (_maturedAt()) revert LendingPoolFinalMaturity();
        (bool done, address first) = _pair(keccak256(abi.encode("deploy", amount, ref)), DEPLOYER_ROLE);
        if (!done) return;
        _accrue();
        uint256 cash = _vaultCash();
        if (amount > cash) revert LendingPoolInsufficientCash(cash, amount);
        uint256 out = totalBorrowed + interestAccrued + amount;
        uint256 u = out.mulDiv(WAD, out + cash - amount);
        if (u > MAX_UTILIZATION) revert LendingPoolUtilizationCap(u);
        totalBorrowed += amount;
        _totalDeployed += amount;
        uint256 id = _deploymentCount++;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), to, amount);
        emit Deployed(id, to, amount, first, msg.sender);
    }

    /// @dev Final Maturity, read the same way as the pool does.
    function _maturedAt() internal view returns (bool) {
        uint256 start = _initialClosing;
        if (start == 0) return false;
        (uint256 y, uint256 m, uint256 d) = PacificCalendar.civilFromDays(start / 1 days);
        y += 20;
        if (m == 2 && d == 29 && !(y % 4 == 0 && (y % 100 != 0 || y % 400 == 0))) d = 28;
        return block.timestamp >= PacificCalendar.daysFromCivil(y, m, d) * 1 days + (start % 1 days);
    }

    /* ========== VALUATION POSTINGS (two people; §6) ========== */

    /// @notice posts the Pool Loss Allowance. It changes ONLY the Holdback Percentage
    /// (allowance ÷ Pool Assets, rounded up), never the Share Value. A lower percentage starts a
    /// release pass over the open holdbacks (`releaseHoldbacks`).
    /// @dev Proposed by one `VALUATION_ROLE` signer, applied by the same call from another.
    function postAllowance(uint256 value, bytes32 evidenceHash) external {
        if (evidenceHash == bytes32(0)) revert LendingPoolInvalidAmount();
        if (_releasePending) revert LendingPoolReleasePending();
        if (lossCharge.pending) revert LendingPoolChargePending();
        (bool done, address first) = _pair(keccak256(abi.encode("allowance", value, evidenceHash)), VALUATION_ROLE);
        if (!done) return;
        _accrue();
        uint256 assets = _poolAssets();
        if (value > assets) revert LendingPoolInvalidAmount();
        uint256 bps = value == 0 ? 0 : value.mulDiv(BPS, assets, MathUpgradeable.Rounding.Up);
        if (bps < _holdbackBps && holdbacks.length > _holdbackHead) {
            _releasePending = true;
            releaseCursor = uint64(_holdbackHead);
            releaseEnd = uint64(holdbacks.length);
        }
        _holdbackBps = uint16(bps);
        _poolLossAllowance = value;
        _allowancePostedAt = uint64(block.timestamp);
        emit AllowancePosted(value, bps, assets, evidenceHash, first, msg.sender);
    }

    /// @notice posts a Pool Loss Charge. It is applied first to the open holdbacks, ratably by
    /// gross amount (`applyHoldbacks`); only the remainder reduces the Deployed Balance, then the
    /// accrued interest, and only what exceeds both leaves the vault, to Clear Lending.
    /// @dev Two `VALUATION_ROLE` signers. Reverts while releases from a lower posting are
    /// unprocessed or another charge is being applied. Until the last batch is applied, the
    /// charge is pending and subscriptions, redemptions and fills revert.
    function postLossCharge(uint256 value, bytes32 evidenceHash) external {
        if (evidenceHash == bytes32(0) || value == 0) revert LendingPoolInvalidAmount();
        if (_releasePending) revert LendingPoolReleasePending();
        if (lossCharge.pending) revert LendingPoolChargePending();
        (bool done, address first) = _pair(keccak256(abi.encode("loss", value, evidenceHash)), VALUATION_ROLE);
        if (!done) return;
        _accrue();
        uint256 assets = _poolAssets();
        if (value > assets + _totalHoldback || value > type(uint128).max) revert LendingPoolInvalidAmount();
        uint256 id = ++_lossChargeCount;
        uint256 denominator = assets + openHoldbackGross;
        lossCharge = LossCharge(uint128(value), 0, denominator, uint64(_holdbackHead), uint64(holdbacks.length), uint64(id), true);
        emit LossChargePosted(id, value, denominator, evidenceHash, first, msg.sender);
        if (holdbacks.length == _holdbackHead) _completeCharge();
    }

    /// @notice applies the pending loss charge to up to `maxCount` holdbacks, in creation order.
    /// Each absorbs min(H, G × L ÷ (Pool Assets before the charge + Σ G of open holdbacks)),
    /// rounded up; what it absorbs moves into Vault Cash. Permissionless.
    function applyHoldbacks(uint256 maxCount) external {
        LossCharge storage c = lossCharge;
        if (!c.pending) revert LendingPoolNothingQueued(0);
        _accrue();
        uint256 i = c.cursor;
        uint256 end = c.end;
        uint256 amount = c.amount;
        uint256 absorbed = c.absorbed;
        for (uint256 seen; i < end && seen < maxCount; ++seen) {
            Holdback storage h = holdbacks[i];
            uint256 held = h.held;
            if (held > 0 && absorbed < amount) {
                uint256 take = uint256(h.gross).mulDiv(amount, c.denominator, MathUpgradeable.Rounding.Up);
                if (take > held) take = held;
                if (take > amount - absorbed) take = amount - absorbed;
                _reduceHoldback(i, take);
                absorbed += take;
                emit HoldbackApplied(i, take, c.id);
            }
            ++i;
        }
        c.cursor = uint64(i);
        c.absorbed = uint128(absorbed);
        if (i == end) _completeCharge();
    }

    /// @dev The remainder after the holdbacks: the Deployed Balance first, then accrued interest,
    /// then, only for what exceeds both, a transfer from the vault to Clear Lending.
    function _completeCharge() internal {
        LossCharge storage c = lossCharge;
        uint256 rest = c.amount - c.absorbed;
        uint256 deployed = totalBorrowed;
        uint256 toDeployed = rest < deployed ? rest : deployed;
        totalBorrowed = deployed - toDeployed;
        rest -= toDeployed;
        uint256 interest = interestAccrued;
        uint256 toInterest = rest < interest ? rest : interest;
        interestAccrued = interest - toInterest;
        rest -= toInterest;
        c.pending = false;
        if (rest > 0) {
            address to = _deploymentAccount;
            if (to == address(0)) revert LendingPoolInvalidAddress();
            SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), to, rest);
        }
        emit LossChargeCompleted(c.id, c.absorbed, toDeployed, toInterest, rest);
    }

    /// @notice processes up to `maxCount` holdbacks in creation order, paying each release only to
    /// its Holder: first the pass after a lower posting (each H falls to min(H, G × the new
    /// percentage), rounded up), then any holdback past its maximum age, in full. Age releases wait
    /// while a loss charge is pending. Permissionless.
    function releaseHoldbacks(uint256 maxCount) external {
        uint256 seen;
        if (_releasePending) {
            uint256 i = releaseCursor;
            uint256 end = releaseEnd;
            uint256 bps = _holdbackBps;
            for (; i < end && seen < maxCount; ++seen) {
                Holdback storage h = holdbacks[i];
                uint256 keep = uint256(h.gross).mulDiv(bps, BPS, MathUpgradeable.Rounding.Up);
                if (h.held > keep) _release(i, h.held - keep);
                ++i;
            }
            releaseCursor = uint64(i);
            if (i == end) _releasePending = false;
        }
        if (lossCharge.pending) return;
        uint256 j = _holdbackHead;
        uint256 n = holdbacks.length;
        for (; j < n && seen < maxCount; ++seen) {
            uint256 held = holdbacks[j].held;
            if (held > 0) {
                if (block.timestamp < _releaseAt(j)) break;
                _release(j, held);
            }
            ++j;
        }
        _holdbackHead = j;
    }

    function _release(uint256 id, uint256 amount) internal {
        Holdback storage h = _reduceHoldback(id, amount);
        _send(h.holder, amount);
        emit HoldbackReleased(id, amount);
    }

    /* ========== SUSPENSION (§8) ========== */

    function _isSuspensionSigner(address a) internal view returns (bool) {
        return hasRole(SUSPENSION_ROLE, a) || _isOfficer(a);
    }

    function _isOfficer(address a) internal view returns (bool) {
        return hasRole(CCO_ROLE, a) || hasRole(TREASURER_ROLE, a);
    }

    /// @notice suspends subscriptions, redemptions and queue processing, only for a listed
    /// Suspension Event (FIXED reason codes). Set by one authorized individual and approved by a
    /// different one, at least one of them the CCO or treasurer. Expires 72 hours after approval
    /// (VALUATION_PENDING: 48 hours, not renewable).
    /// @param resolutionHash a Lending Board resolution, needed for a new suspension on the same
    /// evidence within 30 days of the last one.
    function suspend(uint8 reason, bytes32 evidenceHash, bytes32 resolutionHash) external {
        if (reason < LOSS_EVENT || reason > VALUATION_PENDING) revert LendingPoolBadReason(reason);
        if (evidenceHash == bytes32(0)) revert LendingPoolInvalidAmount();
        if (isSuspended()) revert LendingPoolSuspended();
        uint256 lastEnd = evidenceEndedAt[evidenceHash];
        if (lastEnd != 0 && block.timestamp < lastEnd + 30 days && resolutionHash == bytes32(0)) {
            revert LendingPoolResolutionRequired();
        }
        if (!_isSuspensionSigner(msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        bytes32 action = keccak256(abi.encode("suspend", reason, evidenceHash, resolutionHash));
        address first = _proposerOf[action];
        if (first == msg.sender) revert LendingPoolSameSigner(msg.sender);
        if (first == address(0) || !_isSuspensionSigner(first)) {
            _proposerOf[action] = msg.sender;
            emit ActionProposed(action, msg.sender);
            return;
        }
        if (!_isOfficer(first) && !_isOfficer(msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        delete _proposerOf[action];
        emit ActionApproved(action, first, msg.sender);
        _accrue();
        uint256 expires = block.timestamp + (reason == VALUATION_PENDING ? 48 hours : 72 hours);
        uint64 eventId = _suspension.eventId + 1;
        _suspension = Suspension(eventId, reason, uint64(block.timestamp), uint64(expires), first, evidenceHash);
        evidenceEndedAt[evidenceHash] = expires;
        emit Suspended(eventId, reason, evidenceHash, expires, first, msg.sender);
    }

    /// @notice renews the Suspension for 72 hours from now, by an authorized individual other
    /// than the one who set or last renewed it. Beyond 240 hours from the start it needs a Lending
    /// Board resolution hash; it never runs past 30 days from the start, except a LEGAL_ORDER
    /// renewed with an order hash. VALUATION_PENDING cannot be renewed.
    function renewSuspension(bytes32 resolutionHash, bytes32 orderHash) external {
        Suspension storage s = _suspension;
        if (s.expiresAt <= block.timestamp) revert LendingPoolNotSuspended();
        if (s.reason == VALUATION_PENDING) revert LendingPoolNotRenewable();
        if (!_isSuspensionSigner(msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        if (msg.sender == s.lastSigner) revert LendingPoolSameSigner(msg.sender);
        uint256 expires = block.timestamp + 72 hours;
        if (expires > s.startedAt + 240 hours && resolutionHash == bytes32(0)) revert LendingPoolResolutionRequired();
        if (!(s.reason == LEGAL_ORDER && orderHash != bytes32(0))) {
            uint256 ceiling = s.startedAt + 30 days;
            if (expires > ceiling) expires = ceiling;
            if (expires <= s.expiresAt) revert LendingPoolSuspensionCeiling();
        }
        s.expiresAt = uint64(expires);
        s.lastSigner = msg.sender;
        evidenceEndedAt[s.evidenceHash] = expires;
        emit SuspensionRenewed(s.eventId, expires, msg.sender, resolutionHash, orderHash);
    }

    /// @notice ends the Suspension once its event has ended. Any authorized individual.
    function liftSuspension() external {
        Suspension storage s = _suspension;
        if (s.expiresAt <= block.timestamp) revert LendingPoolNotSuspended();
        if (!_isSuspensionSigner(msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        _accrue();
        s.expiresAt = uint64(block.timestamp);
        evidenceEndedAt[s.evidenceHash] = block.timestamp;
        emit SuspensionLifted(s.eventId, msg.sender);
    }

    /* ========== FUNDING RATE MODEL (IV-02 Sch. 2) ========== */

    /// @notice proposes new rate parameters (annual, WAD). Bounds are FIXED: R₀ 0–5%, S₁ 0–6%,
    /// K 60–90%, S₂ 0–10%, R₀+S₁+S₂ ≤ 10%. A change that does not lower R at any utilization takes
    /// effect after 48 hours; one that lowers it at any utilization needs 30 days' notice, and at
    /// most one may take effect per calendar quarter (UTC).
    function proposeRateModel(uint256 r0, uint256 s1, uint256 k, uint256 s2) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (r0 > MAX_R0 || s1 > MAX_S1 || k < MIN_K || k > MAX_K || s2 > MAX_S2 || r0 + s1 + s2 > MAX_RATE_SUM) {
            revert LendingPoolInvalidRateModel();
        }
        RateModel memory next = RateModel(uint64(r0), uint64(s1), uint64(k), uint64(s2));
        RateModel memory cur = _rateModel;
        bool lowers = _lowerAt(next, cur, 0) || _lowerAt(next, cur, cur.k) || _lowerAt(next, cur, next.k)
            || _lowerAt(next, cur, WAD);
        uint256 effectiveAt = block.timestamp + (lowers ? 30 days : 48 hours);
        if (lowers) {
            uint32 quarter = _quarterOf(effectiveAt);
            if (quarter == _lastLoweringQuarter) revert LendingPoolRateQuarter(quarter);
            _lastLoweringQuarter = quarter;
        }
        _pendingRate = PendingRate(next, uint64(effectiveAt), lowers);
        emit RateModelProposed(r0, s1, k, s2, effectiveAt, lowers);
    }

    /// @notice puts the proposed model in force once its notice has run. Permissionless.
    function applyRateModel() external {
        PendingRate memory p = _pendingRate;
        if (p.effectiveAt == 0) revert LendingPoolInvalidRateModel();
        if (block.timestamp < p.effectiveAt) revert LendingPoolRateNotice(p.effectiveAt);
        _accrue();
        _rateModel = p.model;
        delete _pendingRate;
        emit RateModelApplied(p.model.r0, p.model.s1, p.model.k, p.model.s2);
    }

    /// @dev Whether `next` gives a lower rate than `cur` at utilization `u`. Both are piecewise
    /// linear with corners only at 0, their kinks and 1, so checking those points is exhaustive.
    function _lowerAt(RateModel memory next, RateModel memory cur, uint256 u) internal pure returns (bool) {
        return _rate(next, u) < _rate(cur, u);
    }

    function _rate(RateModel memory m, uint256 u) internal pure returns (uint256) {
        if (u <= m.k) return m.k == 0 ? m.r0 : m.r0 + (uint256(m.s1) * u) / m.k;
        return m.r0 + m.s1 + (uint256(m.s2) * (u - m.k)) / (WAD - m.k);
    }

    /// @dev year × 4 + quarter index, plus one so zero means "none yet".
    function _quarterOf(uint256 ts) internal pure returns (uint32) {
        (uint256 y, uint256 m, ) = PacificCalendar.civilFromDays(ts / 1 days);
        return uint32(y * 4 + (m - 1) / 3 + 1);
    }
}
