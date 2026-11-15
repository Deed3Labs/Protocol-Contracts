// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "./LiquidatorBase.sol";
import "./interfaces/ICollateralAgent.sol";

/// @dev A bond's record in the Phase 2f collection (`BurnerBondBase.BondInfo`), field for field, so
/// the returned tuple decodes. Only `maturityDate` is read here (decision 20's order). The pre-2f
/// `IBurnerBond.BondInfo` has a different shape: decoding the new record with it reads a
/// timestamp as a `bool` and reverts without a reason.
struct EarnBondInfo {
    uint256 faceValue;
    uint256 purchasePrice;
    uint256 costBasis;
    uint256 paid;
    uint64 issuedAt;
    uint64 maturityDate;
    uint32 termDays;
    uint32 yieldBps;
    bool isRedeemed;
    bytes32 exemptionCode;
}

interface IEarnBondInfo {
    function getBondInfo(uint256 bondId) external view returns (EarnBondInfo memory);
}

/// @dev The Collateral Agent a bond collection names (co-signed): the only caller of `applyDistribution`.
interface IEarnBondsAgent {
    function agent() external view returns (address);
}

/// @dev Where the Collateral Agent pays a Holder (EarnControls' payment Successor, else the Holder).
interface IAgentPayeeSource {
    function payeeSource() external view returns (address);
}

/// @title LiquidatorEnforcement
/// @notice The Liquidator's pledged-Earn rules under MB-05 (Phase 2f, decisions 9, 10 and 20-22):
/// when a pledged bond is payable and what its payment pays, what a pool-share redemption's
/// proceeds pay, the combined Shortfall, and the Maturity Instruction.
/// @dev A delegatecall module, created by the Liquidator's constructor and reached through the
/// Liquidator's forwarding stubs, so it runs against the Liquidator proxy's storage with the
/// original caller. Called directly it has no registry, bonds or issuers, so nothing it does there
/// matters.
///
/// The rules it applies:
///  - **What is secured (decision 9).** A pledge secures all of the member's MB-05 secured debt
///    with every trusted issuer: their revolving line and every term plan they secured by
///    signature. There is no per-plan link.
///  - **How much (decision 22).** Enforcement on a default never exceeds the Defaulted Amount the
///    issuer recorded: on the revolving line what was past due when the grace period ended
///    (`_revolvingDue`), on a secured plan what its cure notice concerns, less what has been paid
///    since, and a plan's whole balance only once the plan has itself ended.
///  - **In what order (MB-05 §7.1, decisions 10 and 20).** On a default, bonds first and then pool
///    shares; on a Shortfall, pool shares first and then bonds. Among bonds, the member's own order
///    if they set one before any notice, otherwise the bond nearest maturity first.
///  - **The Shortfall (decision 21)** is one figure: Asset-Backed Drawn across the member's lines
///    above the total Asset-Backed Limit of their pledged bonds and pool shares. After the wait it
///    is settled in the smallest amount that ends it, and never makes anything else due early.
///  - **Where the money goes (MB-05 §§7.5, 7.6).** To the Defaulted Amounts, or to end the
///    Shortfall, and the surplus to the Holder at once. Never to Savings, which has its own
///    collateral, and never to a cost or fee.
contract LiquidatorEnforcement is LiquidatorBase {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice What the Liquidator checks it was built with.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("LiquidatorEnforcement.v1");
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /* ========== THE DEFAULTED AMOUNT (decision 22) ========== */

    /// @notice the Defaulted Amounts Earn collateral may pay now, across the member's trusted
    /// issuers, and the first issuer with one.
    /// @dev On a revolving line: its past-due Secured Minimum, up to what its asset-backed tiers owe
    /// (§7.1(b)), plus its unpaid Rebalance Amount, up to what its unsecured tiers owe (§7.1(d)).
    /// Never Savings, which has its own collateral (MB-05 §2.5(a)), and never the workout plan
    /// (owner decision 35: its default opens no path here). On a term issuer, each secured plan's
    /// (`_planDue`).
    function earnDefaultedOf(address member) public view returns (uint256 due, address issuer) {
        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        address[] memory issuers = _issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            address iss = issuers[i];
            if (!trustedSavingsIssuer[iss]) continue;
            uint256 d;
            if (_tierCountOf(iss) == 0) {
                uint256[] memory ids = ISecuredTermPlans(iss).openPlansOf(member);
                for (uint256 j = 0; j < ids.length; j++) d += _planDue(iss, ids[j]);
            } else {
                (uint256 sm, uint256 ra, ) = _revolvingDue(member, iss);
                d = _min(sm, _owedOf(member, iss, bondKind) + _owedOf(member, iss, poolKind))
                    + _min(ra, _owedOf(member, iss, BOOST_KIND) + _owedOf(member, iss, INCOME_KIND));
            }
            if (d > 0 && issuer == address(0)) issuer = iss;
            due += d;
        }
    }

    /// @dev Decision 22 for a plan secured under MB-05 (12.14): nothing until its default is
    /// recorded; then what its cure notice concerns (what the schedule asked by the notice) less
    /// everything repaid, which every payment lowers, enforcement's included, and never more than the
    /// plan owes; and the whole balance only once the plan's schedule has ended, when the balance has
    /// itself come due.
    function _planDue(address issuer, uint256 planId) private view returns (uint256) {
        ISecuredTermPlans plans = ISecuredTermPlans(issuer);
        (, , , uint64 defaultedAt, uint128 noticeDue) = plans.securedPlans(planId);
        if (defaultedAt == 0) return 0;
        (, , , uint256 repaid, , uint32 installments, uint64 length, , bool closed) = plans.planAt(planId);
        if (closed) return 0;
        (, , , uint64 start) = plans.scheduleOf(planId);
        uint256 owed = plans.owedOn(planId);
        if (block.timestamp >= uint256(start) + uint256(installments) * length) return owed;
        return _min(noticeDue > repaid ? noticeDue - repaid : 0, owed);
    }

    function _owedOf(address member, address issuer, bytes32 kind) private view returns (uint256) {
        (bool found, uint256 tierId) = _tierOf(issuer, kind);
        return found ? ITierSettler(issuer).principalOf(member, tierId) : 0;
    }

    /// @dev Applies up to `amount` held here to the member's Defaulted Amounts (MB-05 §§7.1(b), (d),
    /// 7.5): first each revolving line's past-due Secured Minimum, on its asset-backed tiers (the
    /// collateral's own kind first); then the secured term plans, oldest first (decision 10); then
    /// each line's unpaid Rebalance Amount, on its unsecured tiers, dearest first. Each part never
    /// past its own Defaulted Amount.
    function _applyDefault(address member, uint256 amount, bytes32 firstKind) private returns (uint256 applied) {
        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        bytes32[] memory asset = new bytes32[](2);
        asset[0] = firstKind;
        asset[1] = firstKind == bondKind ? poolKind : bondKind;
        bytes32[] memory unsecured = new bytes32[](2);
        unsecured[0] = BOOST_KIND;
        unsecured[1] = INCOME_KIND;
        address[] memory issuers = _issuersOf(member);
        for (uint256 pass = 0; pass < 3; pass++) {
            for (uint256 i = 0; i < issuers.length && applied < amount; i++) {
                address iss = issuers[i];
                if (!trustedSavingsIssuer[iss]) continue;
                bool term = _tierCountOf(iss) == 0;
                if (pass == 1) {
                    if (term) applied += _payPlans(member, iss, amount - applied);
                } else if (!term) {
                    applied += _applyRevolving(member, iss, pass == 0 ? asset : unsecured, amount - applied, pass == 0);
                }
            }
        }
    }

    /// @dev Pays up to `budget` held here into the member's defaulted secured plans with `issuer`,
    /// oldest first, each up to its Defaulted Amount. Nothing else of the member's is paid.
    function _payPlans(address member, address issuer, uint256 budget) private returns (uint256 applied) {
        uint256[] memory ids = ISecuredTermPlans(issuer).openPlansOf(member);
        // Oldest first: plan ids rise with time.
        for (uint256 i = 1; i < ids.length; i++) {
            for (uint256 j = i; j > 0 && ids[j - 1] > ids[j]; j--) (ids[j - 1], ids[j]) = (ids[j], ids[j - 1]);
        }
        for (uint256 i = 0; i < ids.length && applied < budget; i++) {
            uint256 pay = _min(_planDue(issuer, ids[i]), budget - applied);
            if (pay == 0) continue;
            reserveToken.forceApprove(address(stableCredit), pay);
            ISecuredTermPlans(issuer).payPlan(ids[i], pay);
            applied += pay;
        }
    }

    /* ========== THE COMBINED SHORTFALL (decision 21) ========== */

    /// @notice the member's Shortfall (Asset-Backed Drawn above the total Asset-Backed Limit, MB-05
    /// §1.3) and, once noticed, when its wait ends: `shortfallWait` (72 hours or more) after the
    /// notice, longer by the paused time since (Phase 2g, decision 6). `dueAt` is zero with no notice.
    function shortfallOf(address member) public view returns (uint256 gap, uint256 dueAt) {
        (uint256 drawn, uint256 limit) = _assetBacked(member);
        gap = drawn > limit ? drawn - limit : 0;
        uint256 noticedAt = shortfallNoticedAt[member][address(0)];
        if (noticedAt != 0) {
            dueAt = noticedAt + shortfallWait() + _pauseClockOf(member) - shortfallClockAt[member][address(0)];
        }
    }

    /// @notice records that the member's Shortfall began, starting its wait; or, once it has
    /// ended, clears the notice. Permissionless: the notice moves nothing.
    /// @return gap the Shortfall now.
    function noticeShortfall(address member) external returns (uint256 gap) {
        (gap, ) = shortfallOf(member);
        if (shortfallNoticedAt[member][address(0)] != 0) {
            if (gap != 0) revert LiquidatorShortfallNoticed(member);
            _clearShortfallIfClosed(member);
            return 0;
        }
        if (gap == 0) revert LiquidatorNoShortfall(member);
        shortfallNoticedAt[member][address(0)] = uint64(block.timestamp);
        shortfallClockAt[member][address(0)] = _pauseClockOf(member);
        emit ShortfallNoticed(member, gap);
    }

    /// @dev Asset-Backed Drawn: what the member owes in the bond and pool-share tiers of their
    /// trusted revolving lines. Asset-Backed Limit: their pledged bonds and pool shares, each at its
    /// advance rate (the higher of the stored and the current one, MB-05 §5.3).
    function _assetBacked(address member) private view returns (uint256 drawn, uint256 limit) {
        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        address[] memory issuers = _issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            address iss = issuers[i];
            if (!trustedSavingsIssuer[iss] || _tierCountOf(iss) == 0) continue;
            drawn += _owedOf(member, iss, poolKind) + _owedOf(member, iss, bondKind);
        }
        if (poolKind != bytes32(0)) limit += collateralRegistry.advancedValueOf(member, poolKind, 0);
        if (bondKind != bytes32(0)) limit += collateralRegistry.advancedValueOf(member, bondKind, 0);
    }

    /// @dev Applies up to `budget` held here to the member's Asset-Backed Drawn, no more than the
    /// Shortfall still open (MB-05 §6.5(c)): the collateral's own kind first.
    function _applyShortfall(address member, uint256 budget, bytes32 firstKind) private returns (uint256 applied) {
        (uint256 gap, ) = shortfallOf(member);
        if (gap < budget) budget = gap;
        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        bytes32 second = firstKind == bondKind ? poolKind : bondKind;
        address[] memory issuers = _issuersOf(member);
        for (uint256 i = 0; i < issuers.length && applied < budget; i++) {
            address iss = issuers[i];
            if (!trustedSavingsIssuer[iss] || _tierCountOf(iss) == 0) continue;
            applied += _settleTier(member, iss, firstKind, budget - applied);
            applied += _settleTier(member, iss, second, budget - applied);
        }
    }

    function _clearShortfallIfClosed(address member) private {
        if (shortfallNoticedAt[member][address(0)] == 0) return;
        (uint256 gap, ) = shortfallOf(member);
        if (gap != 0) return;
        delete shortfallNoticedAt[member][address(0)];
        emit ShortfallCleared(member);
    }

    /// @dev What the member's pledged pool shares would close of the Shortfall if all were redeemed:
    /// each dollar redeemed lowers the drawn by a dollar and the limit by the advance rate. Rounded
    /// up, so a bond is never called for a unit of rounding.
    function _poolClosing(address member) private view returns (uint256) {
        (bytes32 poolKind, ) = _earnKinds();
        if (poolKind == bytes32(0)) return 0;
        uint256 rate = collateralRegistry.advanceBpsOf(member, poolKind);
        if (rate >= BPS) return 0;
        return Math.mulDiv(collateralRegistry.collateralValueOf(member, poolKind), BPS - rate, BPS, Math.Rounding.Up);
    }

    /// @dev What the member's pool shares already queued for enforcement will fetch, at today's value.
    function _queuedPoolValue(address member) private view returns (uint256) {
        ISeizableShares pool = earnPool;
        if (address(pool) == address(0)) return 0;
        uint256 queued = pool.enforcementQueuedOf(member);
        return queued == 0 ? 0 : pool.previewRedeem(queued);
    }

    /* ========== PLEDGED BONDS (Phase 2e; decisions 10, 20-22) ========== */

    /// @notice whether MB-05 permits enforcement against this pledged bond now, and the pledge
    /// module requests it (IV-01 §4.9(a); MB-05 §§6.1, 7.1, 7.3(c)). The collection's `payPledged`
    /// pays only when this says so.
    /// @dev Read from on-chain state only; no role sets any of it:
    ///  - the bond is pledged by `member`, they hold it, and no hold or pause is in force;
    ///  - (a) a default: a Defaulted Amount open with a trusted issuer that the pool shares already
    ///    queued for enforcement will not pay (bonds come before pool shares, MB-05 §7.1(b)); or
    ///  - (b) a Shortfall noticed at least the wait ago and still open, larger than all the member's
    ///    pledged pool shares could close (pool shares come first, §7.1(c));
    ///  - and this is the bond next in order (`nextBondOf`). Bonds are paid one at a time and each
    ///    payment is measured again, so only as many are paid as are needed (§7.3(c)).
    /// @return due whether `payPledged` may pay it now.
    /// @return issuer on a default, the first issuer with a Defaulted Amount; zero on a Shortfall.
    /// @return onDefault true for (a), false for (b).
    function pledgePaymentDue(address member, uint256 bondId)
        public
        view
        returns (bool due, address issuer, bool onDefault)
    {
        IEarnBonds bonds = earnBonds;
        if (address(bonds) == address(0)) return (false, address(0), false);
        bytes32 kind = bonds.collateralKind();
        if (!collateralRegistry.isItemPledged(member, kind, bondId) || bonds.balanceOf(member, bondId) == 0) {
            return (false, address(0), false);
        }
        if (_blocked(member)) return (false, address(0), false);
        (bool found, uint256 next) = _nextBond(member, kind);
        if (!found || next != bondId) return (false, address(0), false);

        uint256 owed;
        (owed, issuer) = earnDefaultedOf(member);
        if (owed > _queuedPoolValue(member)) return (true, issuer, true);
        (uint256 gap, uint256 dueAt) = shortfallOf(member);
        if (dueAt != 0 && block.timestamp >= dueAt && gap > _poolClosing(member)) return (true, address(0), false);
        return (false, address(0), false);
    }

    /// @notice the pledged bond MB-05 §7.1 applies next: the first still pledged and held in the
    /// member's own order (decision 20), else the one nearest maturity.
    /// @dev The registry accepts a member's order only before a Default Notice or Shortfall notice.
    function nextBondOf(address member) external view returns (bool found, uint256 bondId) {
        IEarnBonds bonds = earnBonds;
        if (address(bonds) == address(0)) return (false, 0);
        return _nextBond(member, bonds.collateralKind());
    }

    function _nextBond(address member, bytes32 kind) private view returns (bool found, uint256 pick) {
        uint256[] memory order = collateralRegistry.enforcementOrderOf(member, kind);
        for (uint256 i = 0; i < order.length; i++) {
            if (_bondPayable(member, kind, order[i])) return (true, order[i]);
        }
        uint256[] memory items = collateralRegistry.pledgedItemsOf(member, kind);
        uint256 soonest = type(uint256).max;
        for (uint256 i = 0; i < items.length; i++) {
            if (!_bondPayable(member, kind, items[i])) continue;
            uint256 maturity = IEarnBondInfo(address(earnBonds)).getBondInfo(items[i]).maturityDate;
            if (maturity < soonest) (found, pick, soonest) = (true, items[i], maturity);
        }
    }

    function _bondPayable(address member, bytes32 kind, uint256 bondId) private view returns (bool) {
        return collateralRegistry.isItemPledged(member, kind, bondId) && earnBonds.balanceOf(member, bondId) > 0
            && earnBonds.presentValueOf(bondId) > 0;
    }

    /// @notice applies a pledged bond's payment to its Holder's MB-05 secured debt, and pays the
    /// surplus to the Holder (IV-01 §4.9(c); MB-05 §§7.5, 7.6).
    /// @dev Only the bond collection, from inside its `payPledged`, after `pledgePaymentDue` said
    /// yes and the vault paid the bond's whole Accreted Value here. On a default, to the Defaulted
    /// Amounts (`_applyDefault`); on a Shortfall, to Asset-Backed Drawn until it ends. `issuer` is
    /// what `pledgePaymentDue` returned, for the event: every trusted issuer's Defaulted Amount is
    /// reached (decision 9).
    function applyPledgePayment(address member, address issuer, bool onDefault, uint256 amount)
        external
        noReenter
        returns (uint256 applied)
    {
        if (_msgSender() != address(earnBonds)) revert LiquidatorNotEarnBonds(_msgSender());
        _requireNoHold(member);
        (, bytes32 bondKind) = _earnKinds();
        applied = onDefault ? _applyDefault(member, amount, bondKind) : _applyShortfall(member, amount, bondKind);
        if (amount > applied) reserveToken.safeTransfer(member, amount - applied);
        _clearShortfallIfClosed(member);
        emit PledgePaymentApplied(member, issuer, onDefault, amount, applied, amount - applied);
    }

    /* ========== POOL SHARES (decisions 7 and 10, C5) ========== */

    /// @notice applies the proceeds of an enforcement redemption of the member's pledged pool
    /// shares, which `PoolShareEnforcer` has just handed here (MB-05 §§7.3(b), 7.5, 7.6).
    /// @dev Only `poolShareEnforcer`, with the USDC already sent here. The redeemed shares leave the
    /// pledge first. Then the proceeds pay the Defaulted Amounts open now, then end any noticed
    /// Shortfall, and the rest goes to the Holder at once. A hold or a pause makes it wait.
    /// @param shares the pledged shares the queue burned for these proceeds.
    function applyPoolProceeds(address member, uint256 amount, uint256 shares)
        external
        noReenter
        returns (uint256 applied)
    {
        if (_msgSender() != poolShareEnforcer || poolShareEnforcer == address(0)) {
            revert LiquidatorNotPoolShareEnforcer(_msgSender());
        }
        _requireNoHold(member);
        (bytes32 poolKind, ) = _earnKinds();
        if (shares > 0) collateralRegistry.recordEnforcementRedemption(member, poolKind, shares);
        applied = _applyDefault(member, amount, poolKind);
        if (amount > applied && shortfallNoticedAt[member][address(0)] != 0) {
            applied += _applyShortfall(member, amount - applied, poolKind);
        }
        if (amount > applied) reserveToken.safeTransfer(member, amount - applied);
        _clearShortfallIfClosed(member);
        emit PoolProceedsApplied(member, shares, amount, applied, amount - applied);
    }

    /* ========== DISTRIBUTION ROUNDS: IAgentPledgeModule (decision 19) ========== */

    /// @notice whether MB-05 §6.1 now permits enforcement against this pledged bond, for the
    /// Collateral Agent's routing of its share of a distribution round (IV-10 §7.6; decision 19).
    /// @dev Exactly when `payPledged` could pay it on a default (`pledgePaymentDue` with `onDefault`):
    /// pledged by and held by `holder`, no Liquidation Hold or 10c pause in force, the bond next in
    /// MB-05 §7.1's order (the member's own, else nearest maturity: decision 20), and a Defaulted
    /// Amount open (decision 22; the whole asset-backed and unsecured balance once a closing is
    /// recorded, decision 37) that the pool shares already queued will not pay. A Shortfall alone
    /// (§6.1(b)) routes nothing: what is routed is a Defaulted Amount.
    function enforcementPermitted(address holder, uint256 bondId) public view returns (bool) {
        (bool due, , bool onDefault) = pledgePaymentDue(holder, bondId);
        return due && onDefault;
    }

    /// @notice the Holder's MB-05 Defaulted Amounts that pledged Earn may pay now, as recorded on
    /// chain (decision 22, with decision 37's closing): `earnDefaultedOf`. Never Savings.
    function defaultedAmountOf(address holder) external view returns (uint256 due) {
        (due, ) = earnDefaultedOf(holder);
    }

    /// @notice applies a pledged bond's share of a distribution round, which the Collateral Agent
    /// has just sent here, to its Holder's Defaulted Amounts in MB-05 §7.1's order, and pays the rest
    /// at once to the Holder's payee (the registered payment Successor, else the Holder).
    /// @dev Only the Collateral Agent named on the bond collection (whose naming is itself a
    /// co-signed change); no role is granted to it here. The same application as `payPledged`'s
    /// (`_applyDefault`, each part capped at its own Defaulted Amount), so the line-closing rule
    /// (decision 37), the revolving episode accounting and the plans' order are shared. Applied only
    /// while `enforcementPermitted`; otherwise, under a hold or a pause, all of it goes to the payee.
    /// It never reverts for a hold, so one Holder cannot stall a round.
    function applyDistribution(address holder, uint256 bondId, uint256 amount) external noReenter {
        address agent = _collateralAgent();
        if (agent == address(0) || _msgSender() != agent) revert LiquidatorNotCollateralAgent(_msgSender());
        uint256 applied;
        if (enforcementPermitted(holder, bondId)) {
            (, bytes32 bondKind) = _earnKinds();
            applied = _applyDefault(holder, amount, bondKind);
            _clearShortfallIfClosed(holder);
        }
        if (amount > applied) reserveToken.safeTransfer(_payeeOf(agent, holder), amount - applied);
        emit DistributionApplied(holder, bondId, amount, applied, amount - applied);
    }

    /// @dev The Collateral Agent the bond collection names; zero with no collection or no Agent.
    function _collateralAgent() private view returns (address) {
        address bonds = address(earnBonds);
        return bonds == address(0) ? address(0) : IEarnBondsAgent(bonds).agent();
    }

    /// @dev Where the Agent pays this Holder (its `payeeSource`), so the part of a round the debt
    /// does not take goes where the rest of the round goes.
    function _payeeOf(address agent, address holder) private view returns (address) {
        address source = IAgentPayeeSource(agent).payeeSource();
        if (source == address(0)) return holder;
        address payee = IAgentPayee(source).payeeOf(holder);
        return payee == address(0) ? holder : payee;
    }

    /* ========== THE MATURITY INSTRUCTION (MB-05 §5.6) ========== */

    /// @notice what a matured pledged bond's Maturity Instruction applies to its Holder's debt:
    /// min(Maturity Amount, max(0, Asset-Backed Drawn - the Asset-Backed Limit without this bond)).
    /// @dev Both figures are the combined ones MB-05 §1.3 defines (decision 21): every asset-backed
    /// tier, and every pledged bond and pool share at its advance rate.
    function maturityToDebt(address member, uint256 bondId, uint256 maturityAmount) external view returns (uint256) {
        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        (uint256 drawn, ) = _assetBacked(member);
        uint256 limitWithout = collateralRegistry.advancedValueOf(member, bondKind, bondId);
        if (poolKind != bytes32(0)) limitWithout += collateralRegistry.advancedValueOf(member, poolKind, 0);
        if (drawn <= limitWithout) return 0;
        return _min(maturityAmount, drawn - limitWithout);
    }

    /// @notice applies a matured pledged bond's `toDebt` to its Holder's Asset-Backed Drawn.
    /// @dev Only the bond collection, from inside its `settle`, or its vault from
    /// `completeSettlement`. An application on the Holder's own instruction (MB-05 §7.9), not
    /// enforcement, so a Liquidation Hold does not stop it. Anything left goes to the Holder.
    function applyMaturityInstruction(address member, uint256 toDebt) external noReenter {
        if (_msgSender() != address(earnBonds) && _msgSender() != earnBonds.bondVault()) {
            revert LiquidatorNotEarnBonds(_msgSender());
        }
        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        uint256 applied = 0;
        address[] memory issuers = _issuersOf(member);
        for (uint256 i = 0; i < issuers.length && applied < toDebt; i++) {
            address iss = issuers[i];
            if (!trustedSavingsIssuer[iss] || _tierCountOf(iss) == 0) continue;
            applied += _settleTier(member, iss, bondKind, toDebt - applied);
            applied += _settleTier(member, iss, poolKind, toDebt - applied);
        }
        if (toDebt > applied) reserveToken.safeTransfer(member, toDebt - applied);
        emit MaturityInstructionApplied(member, toDebt, applied);
    }
}
