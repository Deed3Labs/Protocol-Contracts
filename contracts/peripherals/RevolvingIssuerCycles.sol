// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice RevolvingIssuer's section 12 code: judging cycles, the Clear Credit Agreement's terms,
/// automatic clearing from Spendable, and the member's Savings draw allowance.
/// @dev Runs only by delegatecall from RevolvingIssuer, against its storage, like
/// RevolvingIssuerExtension. Split out to keep both under the EIP-170 size limit.
contract RevolvingIssuerCycles is RevolvingIssuerBase {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice what RevolvingIssuer's constructor checks before pinning this as its cycles module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("RevolvingIssuerCycles.v1");
    }

    /// @notice repays a member's card debt from their own USDC, under the mandate they set.
    /// @dev "There is no pay button": a deposit that lands as USDC in the member's wallet repays
    /// what they owe before anything else touches it, the way a fiat deposit does. The USDC is pulled
    /// from the member into the ledger (`repayCreditBalanceFor`, the member as payer), and the tiers
    /// are cleared dearest first, as any repayment clears them.
    ///
    /// Bounded three ways: only for a member who switched it on, only up to what they owe on these
    /// tiers, and only once per ref. It cannot move a member's money anywhere but against their own
    /// debt.
    /// @param ref idempotency key.
    /// @param member address being repaid for.
    /// @param amount amount to repay, in ledger units.
    function repayForMember(bytes32 ref, address member, uint256 amount) external notNull(member) {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (creditTerms.autoClearOffGlobal) revert RevolvingIssuerAutoClearOff();
        if (!autoRepayEnabled[member]) revert RevolvingIssuerAutoRepayNotEnabled(member);
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        if (autoRepayments[ref] != 0) revert RevolvingIssuerAutoRepayAlreadyUsed(ref);

        _materialiseCarry(member);
        bool all = autoClearScopeOf[member] == SCOPE_ALL;
        uint256 owed;
        if (all) {
            owed = totalPrincipalOf(member);
        } else {
            (, owed) = _unsecuredTotals(member);
        }
        uint256 applied = amount < owed ? amount : owed;
        if (applied == 0) revert RevolvingIssuerNothingToClear(member);
        autoRepayments[ref] = applied;

        // The settler delivers the cash that landed in Spendable. Nothing is taken from the
        // member's wallet: Ready to allocate USDC and CLRUSD are never swept (section 12.2).
        IERC20Upgradeable reserve = stableCredit.assurancePool().reserveToken();
        reserve.safeTransferFrom(_msgSender(), address(this), applied);
        reserve.forceApprove(address(stableCredit), applied);
        stableCredit.repayCreditBalanceFor(address(this), member, uint128(applied));

        // Dearest first: across every tier for ALL, across Boost and income-backed otherwise.
        uint256 left = applied;
        for (uint256 i = tiers.length; i > 0 && left > 0; i--) {
            uint256 tierId = i - 1;
            if (!all && !_isUnsecured(tierId)) continue;
            uint256 principal = tierPrincipal[member][tierId];
            if (principal == 0) continue;
            uint256 pay = principal < left ? principal : left;
            _repayTier(member, tierId, pay);
            left -= pay;
        }
        emit AutoRepaid(ref, member, applied);
        emit AutoCleared(ref, member, applied, amount - applied);
    }

    /* ---- section 12: cycles, terms and the member's own switches ---- */

    /// @dev Judges a cycle whose grace window has ended. Returns 0 to roll the cycle, 1 to keep
    /// the line frozen, 2 for default now. Reached only by delegatecall from RevolvingIssuer.
    function judgeCycle(address member) external returns (uint8) {
        CycleRecord storage c = cycleOf[member];
        CreditPeriod storage period = creditPeriods[member];
        bool clean = inCompliance(member);
        if (!clean && c.cureNoticeAt != 0) {
            return block.timestamp >= c.cureNoticeAt + creditTerms.cureWindow ? 2 : 1;
        }

        bool deposited;
        if (depositSource != address(0)) {
            (bool ok, bytes memory data) =
                depositSource.staticcall(abi.encodeWithSignature("lastDepositAt(address)", member));
            deposited = ok && data.length >= 32 && abi.decode(data, (uint256)) >= period.issuedAt;
        }
        c.depositBits = uint8(((uint256(c.depositBits) << 1) | (deposited ? 1 : 0)) & 0x3f);

        if (clean) {
            if (c.cleanStreak < type(uint8).max) c.cleanStreak++;
            c.missedInRow = 0;
            c.cureNoticeAt = 0;
            c.unsecuredCeiling = 0;
        } else if (c.missedInRow == 0) {
            // First miss: halve the unsecured limit, even below what is drawn. The excess is
            // settled from pledged bonds or pool shares by the Liquidator, never from Savings.
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
            // The ledger refuses a ceiling below what is owed. The tiers already stop new draws
            // (no headroom above the halved capacity), so the ledger keeps at least the balance.
            uint256 owed = stableCredit.creditBalanceOf(member);
            stableCredit.updateCreditLimit(member, total > owed ? total : owed);
            emit UnsecuredLimitHalved(member, limit, unsecuredExcessOf(member));
        } else {
            // Second miss in a row: the chain dates the cure notice; the line stays frozen.
            c.missedInRow = 2;
            c.cleanStreak = 0;
            c.cureNoticeAt = uint64(block.timestamp);
            emit CureNotice(member, c.cureNoticeAt, c.cureNoticeAt + creditTerms.cureWindow);
            emit CycleJudged(member, false, 2, 0, deposited);
            return creditTerms.cureWindow == 0 ? 2 : 1;
        }
        emit CycleJudged(member, clean, c.missedInRow, c.cleanStreak, deposited);

        uint256 length = period.expiration > period.issuedAt ? period.expiration - period.issuedAt : 1 days;
        period.issuedAt = block.timestamp;
        period.expiration = block.timestamp + length;
        emit CreditPeriodExpired(member);
        emit CreditPeriodCreated(member, period.expiration, period.graceLength);
        return 0;
    }

    /// @notice sets the governed terms of the Clear Credit Agreement (section 12).
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

    /// @notice the member turns automatic clearing on or off, and chooses what it covers (12.2).
    function setAutoClear(bool on, uint8 scope) external {
        _setAutoClear(_msgSender(), on, scope);
    }

    /// @notice the same, from the member's EIP-712 signature: how onboarding turns it on.
    function setAutoClearWithSignature(address member, bool on, uint8 scope, uint256 deadline, bytes calldata signature)
        external
    {
        _useSignature(
            member,
            keccak256(abi.encode(AUTO_CLEAR_TYPEHASH, member, on, scope, memberNonces[member], deadline)),
            deadline,
            signature
        );
        _setAutoClear(member, on, scope);
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
        keccak256("AutoClear(address member,bool on,uint8 scope,uint256 nonce,uint256 deadline)");
    bytes32 public constant SAVINGS_DRAW_TYPEHASH =
        keccak256("SavingsDrawAllowance(address member,uint256 amount,uint256 nonce,uint256 deadline)");

    function _setAutoClear(address member, bool on, uint8 scope) private {
        if (scope > SCOPE_ALL) revert RevolvingIssuerBadScope(scope);
        autoRepayEnabled[member] = on;
        autoClearScopeOf[member] = scope;
        emit AutoClearSet(member, on, scope);
    }

    /// @dev Checks the member's signature over `structHash` at their current nonce, then spends it.
    function _useSignature(address member, bytes32 structHash, uint256 deadline, bytes calldata signature) private {
        if (block.timestamp > deadline) revert RevolvingIssuerSignatureExpired(deadline);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Clear RevolvingIssuer"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        if (!SignatureChecker.isValidSignatureNow(member, digest, signature)) {
            revert RevolvingIssuerBadSignature(member);
        }
        memberNonces[member]++;
    }

}
