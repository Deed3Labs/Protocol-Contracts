// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";

/// @notice RevolvingIssuer's section 12 code: judging cycles on the calendar, the Clear Credit
/// Agreement's terms, Automatic Clearing from Spendable, and the member's Savings draw allowance.
/// @dev Runs only by delegatecall from RevolvingIssuer, against its storage, like
/// RevolvingIssuerExtension. Split out to keep both under the EIP-170 size limit.
contract RevolvingIssuerCycles is RevolvingIssuerBase {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice what RevolvingIssuer's constructor checks before pinning this as its cycles module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("RevolvingIssuerCycles.v2");
    }

    /// @notice Automatic Clearing (12.2): records a deposit that landed in the member's Spendable at
    /// the bank as a repayment, at the level the member chose.
    /// @dev The settler delivers the cash; nothing is taken from the member's wallet, so Ready to
    /// allocate USDC and CLRUSD are never swept. Refused while the member is in hybridMode (the only
    /// thing that switches clearing off besides the member), for a deposit from an excluded payer
    /// (federal benefits unless the member removed them), and once per ref.
    ///
    /// UNSECURED (the default) clears Boost and income-backed, then any unpaid Secured Minimum, and
    /// stops. DUE_ONLY clears exactly the unpaid Rebalance Amount and any unpaid Secured Minimum.
    /// EVERYTHING clears every tier. Within each, dearest first by what each tier costs now (4c
    /// item 7). What is not applied stays in Spendable.
    /// @param ref idempotency key.
    /// @param member address being repaid for.
    /// @param amount the deposit available to clear, in ledger units.
    /// @param payer the deposit's originator (hashed ACH company id), checked against exclusions.
    function repayForMember(bytes32 ref, address member, uint256 amount, bytes32 payer) external notNull(member) {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (!autoRepayEnabled[member]) revert RevolvingIssuerAutoRepayNotEnabled(member);
        if (cycleState[member].hybridMode) revert RevolvingIssuerHybridMode(member);
        if (_payerExcluded(member, payer)) revert RevolvingIssuerExcludedPayer(member, payer);
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        if (autoRepayments[ref] != 0) revert RevolvingIssuerAutoRepayAlreadyUsed(ref);

        _touch(member);
        uint8 level = autoClearScopeOf[member];
        uint256 unsecuredMask = _tierMask(true);
        uint256 first;
        uint256 second;
        if (level == SCOPE_ALL) {
            first = _min(amount, _totalPrincipal(member));
        } else {
            (uint256 owedUnsecured, uint256 owedSecured) = _owedBySide(member);
            (uint256 dueU, uint256 dueT) = _dues(member);
            first = _min(amount, owedUnsecured);
            if (level == LEVEL_DUE_ONLY) first = _min(first, dueU);
            // What the first part leaves of the Secured Minimum: every due figure falls with it.
            uint256 leftU = dueU > first ? dueU - first : 0;
            uint256 leftT = dueT > first ? dueT - first : 0;
            second = _min(_min(amount - first, leftT - leftU), owedSecured);
        }
        uint256 applied = first + second;
        if (applied == 0) revert RevolvingIssuerNothingToClear(member);
        autoRepayments[ref] = applied;

        IERC20Upgradeable reserve = stableCredit.reserveToken();
        reserve.safeTransferFrom(_msgSender(), address(this), applied);
        reserve.forceApprove(address(stableCredit), applied);
        stableCredit.repayCreditBalanceFor(address(this), member, uint128(applied));

        if (level == SCOPE_ALL) {
            _repay(member, first, type(uint256).max);
        } else {
            _repay(member, first, unsecuredMask);
            _repay(member, second, ~unsecuredMask);
        }
        emit AutoRepaid(ref, member, applied);
        emit AutoCleared(ref, member, applied, amount - applied);
    }

    /* ---- section 12: cycles, terms and the member's own switches ---- */

    /// @dev Judges every cycle end that has passed (12.1, 12.5; Addendum 2). Returns 0 when the line
    /// is current on the calendar, 1 to keep it frozen (a second consecutive miss is unpaid), 2 for a
    /// computed default. Reached only by delegatecall from RevolvingIssuer.
    ///
    /// At each end: the dues of the cycle that closed at the end before are judged (paid since
    /// close against the Rebalance Amount; a missed Secured Minimum only pauses secured draws), Income
    /// Assurance falls by one, and the cycle closes: the Rebalance Amount and Secured Minimum due at
    /// the next end are fixed. The next end is computed from the member's Cycle End Day.
    function judgeCycle(address member) external returns (uint8) {
        CycleState storage s = cycleState[member];
        CreditPeriod storage period = creditPeriods[member];
        if (s.cycleEnd == 0) {
            // A line opened before Phase 2e: on the calendar from here, never ending before its period.
            uint8 day = PacificCalendar.defaultDay(block.timestamp);
            s.cycleEndDay = day;
            uint256 from = period.expiration > block.timestamp ? period.expiration : block.timestamp;
            s.cycleEnd = uint64(PacificCalendar.endOnOrAfter(from, day));
        }
        while (s.cycleEnd <= block.timestamp) {
            uint64 end = s.cycleEnd;
            if (s.cureAmount == 0) {
                if (s.closedAt != 0) _judgeDues(member, s, end);
                if (s.incomePause != 0) s.incomePause--;
                if (s.cureAmount == 0) _close(member, s, end);
            } else if (s.incomePause != 0) {
                s.incomePause--;
            }
            s.cycleEnd = uint64(PacificCalendar.endOnOrAfter(end + 1, s.cycleEndDay));
        }
        emit CreditPeriodExpired(member);
        if (s.cureAmount != 0) {
            // A second consecutive miss stands unpaid: the line stays frozen at its due point until
            // it is paid. Default only once computed, which needs the two-person notice.
            period.expiration = s.cureDueAt;
            return _computedDefault(member) ? 2 : 1;
        }
        period.issuedAt = s.closedAt != 0 ? s.closedAt : block.timestamp;
        period.expiration = s.cycleEnd;
        period.graceLength = 0;
        emit CreditPeriodCreated(member, s.cycleEnd, 0);
        return 0;
    }

    /// @dev Judges the dues of the cycle that closed at `s.closedAt`, at its due point `end`.
    function _judgeDues(address member, CycleState storage s, uint64 end) private {
        CycleRecord storage c = cycleOf[member];
        uint256 ra = s.rebalanceAmount;
        uint256 owed = ra + s.securedMinimum;
        uint256 paid = s.paidSinceClose;

        bool deposited;
        if (depositSource != address(0)) {
            (bool ok, bytes memory data) =
                depositSource.staticcall(abi.encodeWithSignature("lastDepositAt(address)", member));
            deposited = ok && data.length >= 32 && abi.decode(data, (uint256)) >= s.closedAt;
        }
        c.depositBits = uint8(((uint256(c.depositBits) << 1) | (deposited ? 1 : 0)) & 0x3f);

        bool clean = paid >= ra;
        if (s.incomePause != 0) {
            // Income Assurance (12.13): nothing was due, no miss is recorded and nothing counts
            // toward default. A miss before it is not consecutive with one after it.
            clean = true;
            c.missedInRow = 0;
            c.cureNoticeAt = 0;
        } else if (clean) {
            if (c.cleanStreak < type(uint8).max) c.cleanStreak++;
            c.missedInRow = 0;
            c.cureNoticeAt = 0;
            c.unsecuredCeiling = 0;
        } else if (c.missedInRow == 0) {
            // First miss: halve the unsecured limit, even below what is drawn. The excess is settled
            // from pledged bonds or pool shares by the Liquidator, never from Savings.
            c.missedInRow = 1;
            c.cleanStreak = 0;
            uint256 limit;
            for (uint256 i = 0; i < tiers.length; i++) {
                if (!_isUnsecured(i)) continue;
                uint256 halved = tierCapacity[member][i] / 2;
                tierCapacity[member][i] = halved;
                limit += halved;
                emit TierCapacityUpdated(member, i, halved);
            }
            c.unsecuredCeiling = uint128(limit == 0 ? 1 : limit);
            uint256 total;
            for (uint256 i = 0; i < tiers.length; i++) total += tierCapacity[member][i];
            // The ledger refuses a ceiling below what is owed. The tiers already stop new draws (no
            // headroom above the halved capacity), so the ledger keeps at least the balance.
            uint256 balance = stableCredit.creditBalanceOf(member);
            stableCredit.updateCreditLimit(member, total > balance ? total : balance);
            emit UnsecuredLimitHalved(member, limit, ra > limit ? ra - limit : 0);
        } else {
            // A second miss in a row (or later): this amount, unpaid, is what default turns on, and
            // only after a two-person cure-notice timestamp for it (12.5). The line stays frozen.
            if (c.missedInRow < type(uint8).max) c.missedInRow++;
            c.cleanStreak = 0;
            c.cureNoticeAt = 0;
            s.noticeProposer = address(0);
            s.cureAmount = uint128(ra - paid);
            s.cureDueAt = end;
        }
        // A missed Secured Minimum is never a miss (12.1): it only pauses secured draws until the
        // payments since this close reach the Rebalance Amount plus the Secured Minimum.
        if (s.incomePause == 0 && paid < owed && owed > ra) {
            uint256 lack = owed - paid;
            if (lack > s.securedPastDue) s.securedPastDue = uint128(lack);
            uint256 smLack = owed - ra < lack ? owed - ra : lack;
            s.pastDueSM = uint128(smLack);
            emit SecuredMinimumMissed(member, lack);
        }
        s.closedAt = 0;
        s.rebalanceAmount = 0;
        s.securedMinimum = 0;
        emit CycleJudged(member, clean, c.missedInRow, c.cleanStreak, deposited);
    }

    /// @dev Closes a cycle at `end`: what is due at the next end (12.1).
    function _close(address member, CycleState storage s, uint64 end) private {
        _touch(member);
        uint256 ra;
        uint256 sm;
        if (s.incomePause == 0) {
            uint256 unsecuredPrincipal;
            uint256 securedPrincipal;
            for (uint256 i = 0; i < tiers.length; i++) {
                if (_isUnsecured(i)) {
                    ra += tierPrincipal[member][i];
                    unsecuredPrincipal += _principalOnly(member, i);
                } else {
                    securedPrincipal += _principalOnly(member, i);
                }
            }
            sm = s.assetCarry;
            if (unsecuredPrincipal == 0 && securedPrincipal != 0) {
                DueTerms memory t = dueTerms;
                uint256 bps = t.raisedFrom != 0 && end >= t.raisedFrom ? t.raisedBps : t.securedMinimumBps;
                uint256 part = (securedPrincipal * bps) / BPS_;
                if (part < t.securedMinimumFloor) part = t.securedMinimumFloor;
                sm += part < securedPrincipal ? part : securedPrincipal;
            }
        }
        s.assetCarry = 0;
        s.rebalanceAmount = uint128(ra);
        s.securedMinimum = uint128(sm);
        s.paidSinceClose = 0;
        s.closedAt = end;
        emit CycleClosed(member, end, ra, sm);
    }

    /// @dev What the member owes on the unsecured tiers and on the rest.
    function _owedBySide(address member) private view returns (uint256 unsecured, uint256 secured) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (_isUnsecured(i)) unsecured += tierPrincipal[member][i];
            else secured += tierPrincipal[member][i];
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @notice sets the governed terms of the Clear Credit Agreement (section 12).
    /// @dev `autoClearOffGlobal` is no longer read: only the member's hybridMode switches Automatic
    /// Clearing off (12.2, Addendum 2). The field stays for the layout and the ABI.
    function setCreditTerms(CreditTerms calldata terms, uint128 boostBase, uint128 boostEarned)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        creditTerms = terms;
        boostBaseCap = boostBase;
        boostEarnedCap = boostEarned;
        emit CreditTermsUpdated(terms, boostBase, boostEarned);
    }

    /// @notice names where a member's last ESA deposit is read, for the Boost deposit test.
    function setDepositSource(address source) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        depositSource = source;
        emit DepositSourceUpdated(source);
    }

    /// @notice the member turns Automatic Clearing on or off, and chooses its level (12.2).
    /// @param authHash the hash of the authorization text the member approved (a copy goes to them);
    /// required to turn it on.
    function setAutoClear(bool on, uint8 level, bytes32 authHash) external {
        _setAutoClear(_msgSender(), on, level, authHash);
    }

    /// @notice the same, from the member's EIP-712 signature: how "Approve automatic clearing" on
    /// the separate screen at line opening turns it on. "Turn off" signs nothing and leaves it off.
    function setAutoClearWithSignature(
        address member,
        bool on,
        uint8 level,
        bytes32 authHash,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _useSignature(
            member,
            keccak256(abi.encode(AUTO_CLEAR_TYPEHASH, member, on, level, authHash, memberNonces[member], deadline)),
            deadline,
            signature
        );
        _setAutoClear(member, on, level, authHash);
    }

    /// @notice the member sets how much card spending may draw against their Savings (12.7).
    function setSavingsDrawAllowance(uint256 amount) external {
        savingsDrawAllowance[_msgSender()] = amount;
        emit SavingsDrawAllowanceSet(_msgSender(), amount);
    }

    /// @notice the same, from the member's EIP-712 signature.
    function setSavingsDrawAllowanceWithSignature(address member, uint256 amount, uint256 deadline, bytes calldata signature)
        external
    {
        _useSignature(
            member,
            keccak256(abi.encode(SAVINGS_DRAW_TYPEHASH, member, amount, memberNonces[member], deadline)),
            deadline,
            signature
        );
        savingsDrawAllowance[member] = amount;
        emit SavingsDrawAllowanceSet(member, amount);
    }

    bytes32 public constant AUTO_CLEAR_TYPEHASH =
        keccak256("AutoClear(address member,bool on,uint8 level,bytes32 authHash,uint256 nonce,uint256 deadline)");
    bytes32 public constant SAVINGS_DRAW_TYPEHASH =
        keccak256("SavingsDrawAllowance(address member,uint256 amount,uint256 nonce,uint256 deadline)");

    function _setAutoClear(address member, bool on, uint8 level, bytes32 authHash) private {
        if (level > LEVEL_DUE_ONLY || (on && authHash == bytes32(0))) revert RevolvingIssuerBadScope(level);
        autoRepayEnabled[member] = on;
        autoClearScopeOf[member] = level;
        if (on) {
            cycleState[member].autoClearAuthHash = authHash;
            emit AutoClearAuthorized(member, level, authHash);
        }
        emit AutoClearSet(member, on, level);
    }
}
