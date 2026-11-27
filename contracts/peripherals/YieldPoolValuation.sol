// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./LendingPoolBase.sol";
import "../libraries/PacificCalendar.sol";

/// @title YieldPoolValuation
/// @notice The Yield Pool's valuation and control functions: the two-person Pool Loss Allowance and
/// Pool Loss Charge postings, the Loss Holdback ledger's batched release and application (§6A),
/// Deployments, Returns and the governed settings. Suspension, the rate model and Pool Interest
/// are in `YieldPoolLedger`, which this module pins.
/// @dev A delegatecall module of `LendingPool`, pinned at construction like the issuer modules.
/// Never called directly in production: this code runs against the pool proxy's storage with the
/// original caller. It declares no storage (see `LendingPoolBase`).
///
/// No function here can pay a holdback anywhere but its Holder's account, raise an existing H,
/// apply more than the formula, or move money out of the vault except a Deployment to the
/// registered lending account (by two people, or by the Settlement Funding lane's one registered
/// funder within its cap, decision 54) and the part of a loss charge above the Deployed Balance and
/// accrued interest, to the same account (§6). There is no sweep or rescue.
contract YieldPoolValuation is LendingPoolBase {
    using MathUpgradeable for uint256;

    /// @notice The ledger module (Pool Interest, Suspension, the rate model), fixed for the life of
    /// this module; `LendingPool` pins the same one.
    address public immutable ledger;

    /// @notice what LendingPool's constructor checks before pinning this module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("YieldPoolValuation.v3");
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address ledger_) {
        _disableInitializers();
        if (IExtensionKind(ledger_).extensionKind() != keccak256("YieldPoolLedger.v1")) {
            revert LendingPoolModuleMismatch();
        }
        ledger = ledger_;
    }

    function _ledgerModule() internal view override returns (address) {
        return ledger;
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

    /// @notice sets the Maximum Holdback Age (IV-02 §5.6(c); initially 540 days). A shortening
    /// applies to every Holdback Amount then open; a lengthening, which needs the Majority Holders'
    /// consent before the timelock executes it, applies only to Holdback Amounts recorded after it:
    /// each stores the age in force when it was recorded.
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

    /// @notice after the Final Maturity Date, queues all of a holder's free shares to that holder,
    /// in queue order (decision 15). Permissionless. Only free shares are taken, so the pool's
    /// transfer hook, which this module's escrow does not run, would have nothing to refuse.
    function requestRunOff(address holder) external returns (uint256 requestId) {
        if (!_maturedAt()) revert LendingPoolNotFinalMaturity();
        uint256 shares = _freeSharesOf(holder);
        requestId = _enqueue(holder, holder, shares, false);
        emit RunOffRequested(holder, requestId, shares);
    }

    /// @notice An MB-05 enforcement redemption: queues `shares` of `holder`'s pledged shares, in
    /// order behind every earlier request, to be filled at Share Value. The proceeds go only to
    /// the recorded `enforcementDestination`; any holdback is recorded to the holder (§6A).
    /// @dev For `PoolShareEnforcer` (decisions 7 and 10). Only pledged shares, read from the source. The
    /// escrow runs here, in the module, without the pool's transfer hook, which would wave an
    /// enforcement escrow through anyway.
    function enforcementRedeem(address holder, uint256 shares) external onlyRole(ENFORCER_ROLE) returns (uint256 requestId) {
        address destination = _enforcementDestination;
        if (destination == address(0)) revert LendingPoolInvalidAddress();
        (uint256 locked, bool ok) = _readLock(holder);
        if (!ok) revert LendingPoolEncumbranceUnreadable(holder);
        uint256 queued = _enforcementQueuedOf[holder];
        uint256 pledged = locked > queued ? locked - queued : 0;
        if (shares > pledged) revert LendingPoolSeizureExceedsEncumbrance(holder, pledged, shares);
        // A legal hold covers pledged shares too: enforcement waits for it (IV-02 §7.5).
        uint256 free = _unheld(balanceOf(holder), 0, holder);
        if (shares > free) revert LendingPoolEncumbered(holder, free, shares);
        _enforcementQueuedOf[holder] = queued + shares;
        requestId = _enqueue(holder, destination, shares, true);
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

    /// @notice a Return: pays accrued Pool Interest first (the billed month's first), then the
    /// Deployed Balance. Anything
    /// above both stays in the vault as cash (the error-correction path, into the vault only).
    /// Anyone may call it.
    function returnFunds(uint256 amount) public {
        if (amount == 0) revert LendingPoolInvalidAmount();
        _accrue();
        uint256 interest = interestAccrued;
        uint256 toInterest = amount < interest ? amount : interest;
        interestAccrued = interest - toInterest;
        // The billed month's interest is paid first, so less of it is capitalized.
        uint256 billed = _billedInterest;
        _billedInterest = toInterest < billed ? billed - toInterest : 0;
        uint256 rest = amount - toInterest;
        uint256 principal = totalBorrowed;
        uint256 toPrincipal = rest < principal ? rest : principal;
        totalBorrowed = principal - toPrincipal;
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(asset()), msg.sender, address(this), amount);
        emit Returned(msg.sender, toInterest, toPrincipal, rest - toPrincipal);
        _syncClock();
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
    /// @dev `DEFAULT_ADMIN_ROLE` (the Earn timelock), not `OPERATOR_ROLE`: the source decides which
    /// shares are locked, so whoever sets it could freeze a Holder's shares, which no Clear Lending
    /// key may do (IV-02 §8.5).
    function setEncumbranceSource(address source, bytes32 kind) external onlyRole(DEFAULT_ADMIN_ROLE) {
        encumbranceSource = IEncumbranceSource(source);
        collateralKind = kind;
        emit EncumbranceSourceUpdated(source);
    }

    /* ========== DEPLOYMENTS (two people, decision 17; the Settlement Funding lane, decision 54) ========== */

    /// @notice a Deployment to Clear Lending's registered lending account. The first
    /// `DEPLOYER_ROLE` signer's call proposes; the same call from a different one sends it.
    /// @dev Only with no open queue request, no Suspension, no pending loss charge and before
    /// Final Maturity, and only if afterwards Utilization is at most 90% (FIXED) and the Deployed
    /// Balance does not exceed the posted Pool Tier principal (IV-02 §4.3; none before it is
    /// first posted). The Settlement Headroom is the lane's alone: it never raises this ceiling.
    /// @param amount USDC to deploy.
    /// @param ref a reference that makes each proposal distinct.
    function deploy(uint256 amount, bytes32 ref) external {
        address to = _deployable(amount);
        (bool done, address first) = _pair(keccak256(abi.encode("deploy", amount, ref)), DEPLOYER_ROLE);
        if (!done) return;
        uint256 id = _sendDeployment(to, amount, _poolTierPrincipal);
        emit Deployed(id, to, amount, first, msg.sender);
    }

    /* ========== SETTLEMENT FUNDING LANE (decision 54; IV-02 §4.3A, L-01 §8.4A) ========== */

    /// @notice registers the Settlement Funding lane's funder (the funding desk's wallet), its cap
    /// per period and the period. Two `DEPLOYER_ROLE` signers: the first proposes, the same call
    /// from a different one applies it. It also restarts a stopped lane, and a proposal made
    /// before a stop never applies after it. The period running keeps what it has used, so
    /// setting the lane again never adds to it.
    function setSettlementFunder(address funder, uint256 capPerPeriod, uint64 periodSeconds) external {
        if (funder == address(0)) revert LendingPoolInvalidAddress();
        if (capPerPeriod == 0 || periodSeconds == 0) revert LendingPoolInvalidAmount();
        SettlementLane storage l = _settlementLane;
        (bool done, address first) = _pair(
            keccak256(abi.encode("settlementFunder", funder, capPerPeriod, periodSeconds, l.epoch)), DEPLOYER_ROLE
        );
        if (!done) return;
        if (block.timestamp >= uint256(l.periodStart) + l.periodSeconds) {
            l.periodStart = uint64(block.timestamp);
            l.used = 0;
        }
        l.funder = funder;
        l.periodSeconds = periodSeconds;
        l.capPerPeriod = capPerPeriod;
        l.stopped = false;
        emit SettlementFunderSet(funder, capPerPeriod, periodSeconds, first, msg.sender);
    }

    /// @notice sets the Settlement Headroom: how far above the posted Pool Tier principal the lane,
    /// and only the lane, may take the Deployed Balance. Two `DEPLOYER_ROLE` signers.
    function setSettlementHeadroom(uint256 amount) external {
        (bool done, address first) = _pair(keccak256(abi.encode("settlementHeadroom", amount)), DEPLOYER_ROLE);
        if (!done) return;
        _settlementHeadroom = amount;
        emit SettlementHeadroomSet(amount, first, msg.sender);
    }

    /// @notice stops the lane at once: one call from any `DEPLOYER_ROLE` or `CCO_ROLE` holder.
    /// Restarting it takes two `DEPLOYER_ROLE` signers (`setSettlementFunder`).
    function stopSettlementFunder() external {
        if (!hasRole(DEPLOYER_ROLE, msg.sender) && !hasRole(CCO_ROLE, msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        SettlementLane storage l = _settlementLane;
        l.stopped = true;
        unchecked {
            ++l.epoch;
        }
        emit SettlementFunderStopped(l.funder, msg.sender);
    }

    /// @notice a Settlement Funding Deployment by the registered funder alone, to the registered
    /// deployment account only. It is a Deployment like `deploy` (recorded, and brought back by
    /// `returnFunds`) under every condition `deploy` has, with two differences: the funder's cap
    /// per period applies, and its ceiling is the posted Pool Tier principal plus the Settlement
    /// Headroom.
    /// @param amount USDC to deploy.
    /// @param ref the hash of the settlement it funds (its cut-off and credit-portion total).
    function deploySettlement(uint256 amount, bytes32 ref) external {
        SettlementLane storage l = _settlementLane;
        if (msg.sender != l.funder || l.stopped) revert LendingPoolNotAuthorized(msg.sender);
        if (ref == bytes32(0)) revert LendingPoolInvalidAmount();
        address to = _deployable(amount);
        uint256 start = l.periodStart;
        uint256 period = l.periodSeconds;
        uint256 used = l.used;
        if (block.timestamp >= start + period) {
            l.periodStart = uint64(start + ((block.timestamp - start) / period) * period);
            used = 0;
        }
        uint256 cap = l.capPerPeriod;
        // A cap lowered during a period may already be passed.
        if (used > cap || amount > cap - used) revert LendingPoolSettlementCap(used, cap, amount);
        used += amount;
        l.used = uint192(used);
        uint256 id = _sendDeployment(to, amount, _poolTierPrincipal + _settlementHeadroom);
        emit Deployed(id, to, amount, msg.sender, msg.sender);
        emit SettlementDeployed(id, amount, ref, used);
    }

    /// @dev Where a Deployment goes, if one may be made now: not with an open queue request, a
    /// Suspension, a pending loss charge, or from Final Maturity.
    function _deployable(uint256 amount) internal view returns (address to) {
        to = _deploymentAccount;
        if (to == address(0)) revert LendingPoolInvalidAddress();
        if (amount == 0) revert LendingPoolInvalidAmount();
        if (_queuedShares > 0) revert LendingPoolQueueOpen();
        if (isSuspended()) revert LendingPoolSuspended();
        if (lossCharge.pending) revert LendingPoolChargePending();
        if (_maturedAt()) revert LendingPoolFinalMaturity();
    }

    /// @dev Makes and records a Deployment, if Vault Cash covers it, Utilization afterwards is at
    /// most 90% and the Deployed Balance afterwards is within `ceiling` (none before the Pool Tier
    /// principal is first posted).
    function _sendDeployment(address to, uint256 amount, uint256 ceiling) internal returns (uint256 id) {
        _accrue();
        uint256 cash = _vaultCash();
        if (amount > cash) revert LendingPoolInsufficientCash(cash, amount);
        uint256 deployed = totalBorrowed;
        // After it: (D + amount) / (D + amount + Vault Cash - amount).
        uint256 u = (deployed + amount).mulDiv(WAD, deployed + cash);
        if (u > MAX_UTILIZATION) revert LendingPoolUtilizationCap(u);
        deployed += amount;
        if (_poolTierPostedAt == 0 || deployed > ceiling) revert LendingPoolTierCap(deployed, ceiling);
        totalBorrowed = deployed;
        _totalDeployed += amount;
        id = _deploymentCount++;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), to, amount);
        _syncClock();
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
    /// (allowance ÷ Pool Assets, kept as a WAD fraction), never the Share Value. A lower percentage
    /// starts a release pass over the open holdbacks (`releaseHoldbacks`). It clears a pending
    /// Valuation Event, and ends a VALUATION_PENDING Suspension (§7.1(d)), whose event it answers.
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
        uint256 rate = value == 0 ? 0 : value.mulDiv(WAD, assets, MathUpgradeable.Rounding.Up);
        if (rate < _holdbackRate && holdbacks.length > _holdbackHead) {
            _releasePending = true;
            releaseCursor = uint64(_holdbackHead);
            releaseEnd = uint64(holdbacks.length);
        }
        _holdbackRate = rate;
        _poolLossAllowance = value;
        _allowancePostedAt = uint64(block.timestamp);
        emit AllowancePosted(value, rate, assets, evidenceHash, first, msg.sender);
        if (_valuationEventPending) {
            _valuationEventPending = false;
            emit ValuationEventCleared();
            Suspension storage s = _suspension;
            if (s.reason == VALUATION_PENDING && s.expiresAt > block.timestamp) {
                s.expiresAt = uint64(block.timestamp);
                evidenceEndedAt[s.evidenceHash] = block.timestamp;
                emit SuspensionLifted(s.eventId, msg.sender);
            }
        }
    }

    /// @notice posts a Pool Loss Charge L. It is applied first to the open holdbacks, ratably by
    /// gross amount (`applyHoldbacks`), and what they absorb moves into Vault Cash. Then the whole
    /// of L reduces the Deployed Balance, then the accrued interest, and only the part of L above
    /// both leaves the vault, to Clear Lending's lending account (IV-02 §5.6(d), Exhibit A, A2 as
    /// corrected; decision 33), under the two signers who posted it. Pool Assets so fall by L less
    /// what the holdbacks absorbed. The charge counts toward the Pool Loss Charges a recovery may
    /// restore (§5.4).
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
        _unrestoredCharges += value;
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
        else _syncClock();
    }

    /// @dev The whole charge, after the holdbacks have absorbed their part into Vault Cash: the
    /// Deployed Balance first, then accrued interest, then, only for what exceeds both, a transfer
    /// from the vault to Clear Lending (decision 33). The transfer never exceeds Vault Cash: a
    /// charge is at most Pool Assets plus Σ H, and on that bound the holdbacks absorb at least
    /// the part of it above Pool Assets.
    function _completeCharge() internal {
        LossCharge storage c = lossCharge;
        uint256 rest = c.amount;
        uint256 deployed = totalBorrowed;
        uint256 toDeployed = rest < deployed ? rest : deployed;
        totalBorrowed = deployed - toDeployed;
        rest -= toDeployed;
        uint256 interest = interestAccrued;
        uint256 toInterest = rest < interest ? rest : interest;
        interest -= toInterest;
        interestAccrued = interest;
        // The unbilled interest goes first; the billed month's never exceeds what is left.
        if (_billedInterest > interest) _billedInterest = interest;
        rest -= toInterest;
        c.pending = false;
        if (rest > 0) {
            address to = _deploymentAccount;
            if (to == address(0)) revert LendingPoolInvalidAddress();
            SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), to, rest);
        }
        emit LossChargeCompleted(c.id, c.absorbed, toDeployed, toInterest, rest);
        _syncClock();
    }

    /// @notice processes up to `maxCount` holdbacks in creation order, paying each release only to
    /// its Holder: first the pass after a lower posting (each H falls to min(H, G × the new
    /// percentage rounded up), so each release is rounded down), then any holdback past its
    /// maximum age, in full. Age releases wait
    /// while a loss charge is pending. Permissionless.
    function releaseHoldbacks(uint256 maxCount) external {
        uint256 seen;
        if (_releasePending) {
            uint256 i = releaseCursor;
            uint256 end = releaseEnd;
            for (; i < end && seen < maxCount; ++seen) {
                Holdback storage h = holdbacks[i];
                uint256 keep = _heldOf(h.gross);
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
}
