// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {BurnMintERC20UUPS} from
    "@chainlink/contracts/src/v0.8/shared/token/ERC20/upgradeable/BurnMintERC20UUPS.sol";
import "../core/interfaces/stable-credit/IEncumbranceSource.sol";

/// @dev The member registry CLRUSD reads (the AccessManager, which also reads MembershipRegistry).
interface IMembershipSource {
    function isMember(address account) external view returns (bool);
}

/// @dev The savings-intent factory, which records its redeem escrows (SavingsIntentFactory).
interface IIntentEscrows {
    function isIntentEscrow(address account) external view returns (bool);
}

/// @title ClearUSDUpgradeable
/// @notice CLRUSD, upgradeable, and unwilling to let collateral walk out of the door.
/// @dev Replaces the deployed ClearUSD, which is not upgradeable and cannot be taught to enforce
/// the redemption lock. Built on Chainlink's own upgradeable CCIP token rather than a hand-rolled
/// one, so the bridge keeps working and the mint and burn roles keep the shape the token pools
/// already expect.
///
/// **Six decimals, deliberately.** CLRUSD is fully reserved one-for-one against USDC, and USDC has
/// six. Equal decimals make minting and redeeming an identity rather than a conversion, so
/// `CLRUSD supply == USDC held in reserve` -- the one figure that proves the reserve is whole --
/// is exact by construction instead of exact-except-for-rounding. StableCredit carries six for the
/// same reason, so credit and money convert without scaling either. The usual argument for
/// eighteen is precision under continuous accrual, and that does not apply here: savings do not
/// pay yield, and carry accrues on the credit ledger rather than on this token.
///
/// **Upgradeable, deliberately.** The token this replaces could not be given the lock it needed,
/// which is the argument. The cost is that a fully-reserved token whose code can change is only as
/// trustworthy as whoever can change it, so the admin should be a timelocked multisig -- and the
/// base enforces a delay on transferring that admin, which is the part code can help with.
///
/// **Who controls it (Phase 2d, 10g, decisions 1 to 3).** Clear Financial Co., two-person, always:
///  - `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE` are the vault timelock's (7 days, a Clear Financial
///    Safe proposing; `deploy/vault_timelock_handover.ts`). The default admin is the admin of every
///    other role, so only that Safe, through the delay, grants or revokes MINTER_ROLE and
///    BURNER_ROLE (the vault and the CCIP token pool), LIQUIDATOR_ROLE (the Liquidator), FRAUD_ROLE
///    and SECURITY_ROLE, and sets the encumbrance and membership sources and the pause window;
///  - every pause action (set, renew, end) takes two distinct holders of its role, in contract
///    (`_secondSigner`).
///
/// **Members only (spec 12.15, decision 6).** A transfer must be received by a registered member
/// wallet, read from the member registry (`membershipSource`, the AccessManager). Only receipt is
/// checked: a wallet that stops being a member can still send to members and redeem, and the
/// registry logs the de-listing (AccessManager `MemberRemoved`, MembershipRegistry
/// `MemberStatusUpdated`/`WalletUnlinked`). Exempt: mints, burns (so every redemption), the
/// Liquidator's seizure, transfers to an address holding MINTER_ROLE, BURNER_ROLE or
/// LIQUIDATOR_ROLE (the vault, the token pool, the Liquidator), and transfers to or from a redeem
/// escrow of the registered savings-intent factory (`intentFactory`, set only by the default admin,
/// the vault timelock). Nothing here screens a transfer: sanctions screening is the app's, before it
/// submits a Send (12.15).
contract ClearUSDUpgradeable is BurnMintERC20UUPS {
    /// @custom:storage-location erc7201:clear.storage.ClearUSD
    struct ClearUSDStorage {
        IEncumbranceSource encumbranceSource;
        /// @dev The lock last read successfully per holder (audit M-3). Appended to the namespaced
        /// struct, which is layout-safe: nothing else lives after it in this namespace.
        mapping(address => uint256) lastKnownLock;
        /// @dev Compliance spec 10c, appended: per-account fraud pauses and the global security
        /// pause, each expiring on its own unless a second signer renews it.
        mapping(address => Pause) accountPause;
        Pause globalPause;
        /// @dev How long a pause lasts before it lapses. Zero means the default, 72 hours.
        uint64 pauseWindow;
        /// @dev Phase 2d, appended: the first signer of each pending two-person pause action, by
        /// the hash of its calldata.
        mapping(bytes32 => address) proposerOf;
        /// @dev Phase 2d, appended: the member registry receipt is checked against. Unset means
        /// unrestricted, as for a token not yet wired.
        IMembershipSource membershipSource;
        /// @dev Phase 2d, appended: the savings-intent factory whose redeem escrows may receive.
        IIntentEscrows intentFactory;
    }

    // keccak256(abi.encode(uint256(keccak256("clear.storage.ClearUSD")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CLEAR_USD_STORAGE =
        0xce096656e701951180d0c979da50968533c9b97034e1cc9d16705e2ff2168100;

    /// @notice May take encumbered collateral, and only encumbered collateral.
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
    /// @notice May pause one account's outgoing transfers for suspected fraud. Cannot move funds.
    bytes32 public constant FRAUD_ROLE = keccak256("FRAUD_ROLE");
    /// @notice May pause every member transfer during a security incident. Cannot move funds.
    bytes32 public constant SECURITY_ROLE = keccak256("SECURITY_ROLE");
    uint64 public constant DEFAULT_PAUSE_WINDOW = 72 hours;
    /// @notice The longest a pause may run before it lapses (spec 10c). Governance may shorten the
    /// window, never lengthen it past this (Phase 4, M-A).
    uint64 public constant MAX_PAUSE_WINDOW = 72 hours;
    /// @notice How long after a pause ends the signer who set or last renewed it must wait before
    /// pausing the same account (or everyone) again on their own (Phase 4, M-A). Any other signer
    /// may act at once; this only stops one key chaining pauses into an indefinite freeze.
    uint64 public constant REPAUSE_COOLDOWN = 30 days;

    /// @notice A pause in force: until when, why, and who last set or renewed it.
    struct Pause {
        uint64 until;
        uint32 reason;
        address lastSigner;
    }

    error ClearUSDEncumbered(address holder, uint256 free, uint256 amount);
    error ClearUSDSeizureExceedsEncumbrance(address holder, uint256 encumbered, uint256 amount);
    error ClearUSDEncumbranceUnreadable(address holder);
    /// @notice thrown when a paused account (or anyone, during a security pause) sends.
    error ClearUSDPaused(address holder, uint32 reason, uint64 until);
    /// @notice thrown when the signer that set or last renewed a pause tries to renew it.
    /// @dev The two-person rule (spec 10c): nobody keeps a member frozen on their own say-so.
    error ClearUSDSameSigner(address signer);
    error ClearUSDNoPause();
    /// @notice thrown when a pause window above MAX_PAUSE_WINDOW is set.
    error ClearUSDPauseWindowTooLong(uint64 window);
    /// @notice thrown when a transfer's receiver is not a registered member wallet (12.15).
    error ClearUSDReceiverNotMember(address receiver);

    event EncumbranceSourceUpdated(address indexed source);
    /// @notice The encumbrance source reverted while a holder's CLRUSD moved (audit M-3). Monitoring
    /// should alert on this: it means the lock is running on its last known reading.
    event EncumbranceSourceReverted(address indexed holder, uint256 lastKnownLock);
    event AccountPaused(address indexed account, uint32 reason, uint64 until, address indexed signer);
    event AccountPauseRenewed(address indexed account, uint32 reason, uint64 until, address indexed signer);
    event AccountUnpaused(address indexed account, address indexed signer);
    event SecurityPaused(uint32 reason, uint64 until, address indexed signer);
    event SecurityPauseRenewed(uint32 reason, uint64 until, address indexed signer);
    event SecurityUnpaused(address indexed signer);
    event PauseWindowUpdated(uint64 window);
    event MembershipSourceUpdated(address indexed source);
    event IntentFactoryUpdated(address indexed factory);
    /// @notice the first half of a two-person pause action: `action` is the hash of its calldata.
    event ActionProposed(bytes32 indexed action, address indexed proposer, bytes4 selector);
    /// @notice the second half, by a different holder of the role; the action ran.
    event ActionApproved(bytes32 indexed action, address indexed proposer, address indexed approver);

    function _clearUsdStorage() private pure returns (ClearUSDStorage storage $) {
        bytes32 slot = CLEAR_USD_STORAGE;
        assembly {
            $.slot := slot
        }
    }

    /// @notice Reports how much of a holder's balance is backing drawn credit.
    function encumbranceSource() external view returns (IEncumbranceSource) {
        return _clearUsdStorage().encumbranceSource;
    }

    /// @notice sets the contract reporting what is encumbered.
    /// @dev Unset means unrestricted, which is what a freshly deployed token is until the credit
    /// system is wired to it. Clearing it stays possible: a source that broke would otherwise
    /// freeze every holder, and a token nobody can unwedge is worse than one whose lock an admin
    /// has to be seen lifting.
    function setEncumbranceSource(address source) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _clearUsdStorage().encumbranceSource = IEncumbranceSource(source);
        emit EncumbranceSourceUpdated(source);
    }

    /// @notice how much of a holder's balance may leave.
    function freeBalanceOf(address holder) public view returns (uint256) {
        uint256 balance = balanceOf(holder);
        uint256 locked = _encumberedOf(holder);
        return balance > locked ? balance - locked : 0;
    }

    /// @notice the lock last read successfully for a holder (audit M-3).
    function lastKnownLockOf(address holder) external view returns (uint256) {
        return _clearUsdStorage().lastKnownLock[holder];
    }

    /// @notice records a holder's current lock from the source.
    /// @dev Permissionless: it can only write what the source reports, and reverts (writing
    /// nothing) when the source cannot be read. The credit side should call it after a draw, so
    /// the record is current before anything can go wrong with the source.
    function syncEncumbrance(address holder) external returns (uint256 locked) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        if (address($.encumbranceSource) == address(0)) return 0;
        locked = $.encumbranceSource.encumberedOf(holder);
        $.lastKnownLock[holder] = locked;
    }

    /// @dev Fails closed for pledgers, open for everyone else (audit M-3). An unreadable source
    /// used to lock nothing, so a bad registry upgrade -- or a caller sending just enough gas for
    /// the registry call to run out -- released every member's collateral with no sign on chain.
    /// Whether a holder has drawn credit cannot be known without the call that failed, so the
    /// narrowest safe rule is the holder's own history: the lock held is the last one successfully
    /// read for them. One never seen locked (never pledged, or last read at zero) is not frozen.
    ///
    /// The last-known amount, not the whole balance. Freezing everything a pledger holds would be
    /// a lock wider than the drawn credit, which DECISIONS #2 rules out for CLRUSD (DFAL 10a); the
    /// recorded lock is no more than the credit side already held. It can lag a later draw, so the
    /// credit side should call `syncEncumbrance` after drawing on savings (Phase 1 report).
    function _encumberedOf(address holder) internal view returns (uint256) {
        (uint256 locked, bool ok) = _readLock(holder);
        if (ok) return locked;
        return _clearUsdStorage().lastKnownLock[holder];
    }

    /// @dev The source's answer, and whether it gave one. No source is a valid answer of zero.
    function _readLock(address holder) internal view returns (uint256 locked, bool ok) {
        IEncumbranceSource source = _clearUsdStorage().encumbranceSource;
        if (address(source) == address(0)) return (0, true);
        try source.encumberedOf(holder) returns (uint256 value) {
            return (value, true);
        } catch {
            return (0, false);
        }
    }

    /// @notice takes collateral that is backing drawn credit.
    /// @dev The other half of the lock. Refusing to let collateral move is only useful if the
    /// co-op can take it when the member defaults, and a token that could only say no would leave
    /// the collateral stranded rather than covering the position it was pledged against.
    ///
    /// The authority is narrow by construction rather than by promise: it can take only what
    /// `encumberedOf` says is standing behind drawn credit, so it cannot reach a holder's free
    /// balance, cannot touch someone who has drawn nothing, and shrinks as a member repays. It
    /// does not decide whether a default has happened -- the caller does, and the caller should be
    /// a contract that checks.
    ///
    /// This is what the ERC-7579 module would otherwise grant. Doing it here works for a holder
    /// who is not a smart account at all, which a module cannot.
    /// @param holder address the collateral is taken from.
    /// @param to address it is delivered to.
    /// @param amount amount to take.
    function seize(address holder, address to, uint256 amount)
        external
        onlyRole(LIQUIDATOR_ROLE)
    {
        // A seizure needs a real answer: "fully locked" is a reason to refuse a transfer, never a
        // licence to take a holder's whole balance.
        (uint256 encumbered, bool ok) = _readLock(holder);
        if (!ok) revert ClearUSDEncumbranceUnreadable(holder);
        if (amount > encumbered) {
            revert ClearUSDSeizureExceedsEncumbrance(holder, encumbered, amount);
        }
        // Past the lock deliberately: this is the one move it exists to permit.
        super._update(holder, to, amount);
    }

    /// @notice sets the member registry that transfers must be received by (12.15). Governed.
    /// @dev Unset means unrestricted, as `setEncumbranceSource` does for the lock: a token not yet
    /// wired to the registry must still work, and clearing it is visible and takes the timelock.
    function setMembershipSource(address source) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _clearUsdStorage().membershipSource = IMembershipSource(source);
        emit MembershipSourceUpdated(source);
    }

    function membershipSource() external view returns (address) {
        return address(_clearUsdStorage().membershipSource);
    }

    /// @notice registers the savings-intent factory whose redeem escrows may receive CLRUSD. Governed:
    /// like the contract-held roles, only the default admin (the vault timelock) sets or clears it.
    function setIntentFactory(address factory) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _clearUsdStorage().intentFactory = IIntentEscrows(factory);
        emit IntentFactoryUpdated(factory);
    }

    function intentFactory() external view returns (address) {
        return address(_clearUsdStorage().intentFactory);
    }

    /// @notice whether `account` may receive a CLRUSD transfer now.
    function mayReceive(address account) public view returns (bool) {
        IMembershipSource source = _clearUsdStorage().membershipSource;
        if (address(source) == address(0) || account == address(0)) return true;
        if (hasRole(MINTER_ROLE, account) || hasRole(BURNER_ROLE, account) || hasRole(LIQUIDATOR_ROLE, account)) {
            return true;
        }
        return _isIntentEscrow(account) || source.isMember(account);
    }

    /// @dev A redeem escrow of the registered intent factory. An unset or unanswering factory
    /// answers no, which only ever narrows who may receive.
    function _isIntentEscrow(address account) private view returns (bool) {
        IIntentEscrows factory = _clearUsdStorage().intentFactory;
        if (address(factory) == address(0)) return false;
        try factory.isIntentEscrow(account) returns (bool yes) {
            return yes;
        } catch {
            return false;
        }
    }

    /// @dev One hook covers every way out. Transfers, redemptions and bridging all pass through
    /// `_update`, and a lock that only caught transfers would be a lock in name. Minting is
    /// exempt because it has no `from` to encumber.
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from != address(0)) {
            _requireNotPaused(from);
            ClearUSDStorage storage $ = _clearUsdStorage();
            (uint256 locked, bool ok) = _readLock(from);
            if (ok) {
                // Keep the record current, so a later outage fails closed for this holder.
                if (locked != $.lastKnownLock[from]) $.lastKnownLock[from] = locked;
            } else {
                // The last lock read for them, and no more (see `_encumberedOf`).
                locked = $.lastKnownLock[from];
                emit EncumbranceSourceReverted(from, locked);
            }
            uint256 balance = balanceOf(from);
            uint256 free = balance > locked ? balance - locked : 0;
            if (value > free) revert ClearUSDEncumbered(from, free, value);
            // Members only (12.15): receipt, never sending. A burn has no receiver. A registered
            // redeem escrow's own outflows (its refund to the depositor) are exempt: it cannot send
            // anywhere its config does not name.
            if (!mayReceive(to) && !_isIntentEscrow(from)) revert ClearUSDReceiverNotMember(to);
        }

        super._update(from, to, value);
    }

    /* ========== FRAUD AND SECURITY PAUSES (compliance spec 10c) ========== */

    /// @notice whether `account` may send right now, and if not, until when.
    function pausedUntil(address account) external view returns (uint64) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        uint64 a = $.accountPause[account].until;
        uint64 g = $.globalPause.until;
        uint64 latest = a > g ? a : g;
        return latest > block.timestamp ? latest : 0;
    }

    /// @notice pauses one account's outgoing transfers, for suspected fraud only.
    /// @dev Two-person (Phase 2d, decision 2), like every pause action below: one FRAUD_ROLE
    /// holder's call proposes, a second holder's identical call carries it out.
    /// @dev The DFAL carve-out: stopping a transaction solely in response to unauthorized or
    /// fraudulent activity. It moves nothing, blocks only what the account sends, and lapses on
    /// its own after the window unless a different signer renews it. Not a credit or collections
    /// tool: nothing in the credit system reads it.
    /// @param account the account to pause.
    /// @param reason an off-chain case reference.
    function pauseAccount(address account, uint32 reason) external onlyRole(FRAUD_ROLE) {
        if (!_secondSigner(FRAUD_ROLE)) return;
        ClearUSDStorage storage $ = _clearUsdStorage();
        Pause storage p = $.accountPause[account];
        _requireMayPause(p);
        uint64 until = uint64(block.timestamp) + _window();
        $.accountPause[account] = Pause({until: until, reason: reason, lastSigner: _msgSender()});
        emit AccountPaused(account, reason, until, _msgSender());
    }

    /// @notice renews an account's pause for another window. Needs a different signer from the
    /// one that set or last renewed it, and a reason; each renewal is logged.
    function renewAccountPause(address account, uint32 reason) external onlyRole(FRAUD_ROLE) {
        if (!_secondSigner(FRAUD_ROLE)) return;
        Pause storage p = _clearUsdStorage().accountPause[account];
        _renew(p, reason);
        emit AccountPauseRenewed(account, reason, p.until, _msgSender());
    }

    /// @notice ends an account's pause early.
    /// @dev Ends it now rather than deleting it, so who set it is remembered: unpausing and pausing
    /// again is not a way for one signer to restart the clock (Phase 4, M-A).
    function unpauseAccount(address account) external onlyRole(FRAUD_ROLE) {
        if (!_secondSigner(FRAUD_ROLE)) return;
        _end(_clearUsdStorage().accountPause[account]);
        emit AccountUnpaused(account, _msgSender());
    }

    /// @notice pauses every member transfer during a security incident (an exploit: unauthorized
    /// activity). Same limits as an account pause: it moves nothing and lapses after the window
    /// unless a second signer renews it.
    function pauseForSecurity(uint32 reason) external onlyRole(SECURITY_ROLE) {
        if (!_secondSigner(SECURITY_ROLE)) return;
        ClearUSDStorage storage $ = _clearUsdStorage();
        _requireMayPause($.globalPause);
        uint64 until = uint64(block.timestamp) + _window();
        $.globalPause = Pause({until: until, reason: reason, lastSigner: _msgSender()});
        emit SecurityPaused(reason, until, _msgSender());
    }

    function renewSecurityPause(uint32 reason) external onlyRole(SECURITY_ROLE) {
        if (!_secondSigner(SECURITY_ROLE)) return;
        Pause storage p = _clearUsdStorage().globalPause;
        _renew(p, reason);
        emit SecurityPauseRenewed(reason, p.until, _msgSender());
    }

    function unpauseSecurity() external onlyRole(SECURITY_ROLE) {
        if (!_secondSigner(SECURITY_ROLE)) return;
        _end(_clearUsdStorage().globalPause);
        emit SecurityUnpaused(_msgSender());
    }

    /// @notice sets how long a pause lasts before it lapses. Governed: the admin is the timelock.
    /// At most MAX_PAUSE_WINDOW (spec 10c's 72 hours); zero means the default.
    function setPauseWindow(uint64 window) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (window > MAX_PAUSE_WINDOW) revert ClearUSDPauseWindowTooLong(window);
        _clearUsdStorage().pauseWindow = window;
        emit PauseWindowUpdated(window);
    }

    /// @dev Two-person control in contract (Phase 2d, decision 2). The first holder of `role` to
    /// make a call records its exact calldata and gets false, and the call does nothing more. A
    /// different holder making the identical call gets true, and the call proceeds. The same holder
    /// twice reverts; a proposer who has since lost the role no longer counts. The 10c rules (the
    /// last signer cannot renew or restart a pause) then apply to the second signer.
    function _secondSigner(bytes32 role) private returns (bool) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        bytes32 action = keccak256(msg.data);
        address first = $.proposerOf[action];
        if (first == _msgSender()) revert ClearUSDSameSigner(_msgSender());
        if (first == address(0) || !hasRole(role, first)) {
            $.proposerOf[action] = _msgSender();
            emit ActionProposed(action, _msgSender(), msg.sig);
            return false;
        }
        delete $.proposerOf[action];
        emit ActionApproved(action, first, _msgSender());
        return true;
    }

    /// @notice who proposed a pending two-person pause action, by the hash of its calldata.
    function proposerOf(bytes32 action) external view returns (address) {
        return _clearUsdStorage().proposerOf[action];
    }

    function _renew(Pause storage p, uint32 reason) private {
        if (p.until <= block.timestamp) revert ClearUSDNoPause();
        if (p.lastSigner == _msgSender()) revert ClearUSDSameSigner(_msgSender());
        p.until = uint64(block.timestamp) + _window();
        p.reason = reason;
        p.lastSigner = _msgSender();
    }

    /// @dev A new pause is refused while one is active (that is a renewal, by a second signer), and
    /// for the signer of the last one until REPAUSE_COOLDOWN after it ended (Phase 4, M-A).
    function _requireMayPause(Pause storage p) private view {
        if (p.until > block.timestamp) revert ClearUSDSameSigner(_msgSender());
        if (p.lastSigner == _msgSender() && block.timestamp < uint256(p.until) + REPAUSE_COOLDOWN) {
            revert ClearUSDSameSigner(_msgSender());
        }
    }

    /// @dev Ends a pause now, keeping its record.
    function _end(Pause storage p) private {
        if (p.until > block.timestamp) p.until = uint64(block.timestamp);
    }

    function _window() private view returns (uint64) {
        uint64 w = _clearUsdStorage().pauseWindow;
        return w == 0 ? DEFAULT_PAUSE_WINDOW : w;
    }

    function _requireNotPaused(address from) private view {
        ClearUSDStorage storage $ = _clearUsdStorage();
        Pause storage a = $.accountPause[from];
        if (a.until > block.timestamp) revert ClearUSDPaused(from, a.reason, a.until);
        Pause storage g = $.globalPause;
        if (g.until > block.timestamp) revert ClearUSDPaused(from, g.reason, g.until);
    }
}
