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
///    BURNER_ROLE (the vault and the CCIP token pool), LIQUIDATOR_ROLE (the Liquidator), FRAUD_ROLE,
///    SECURITY_ROLE and LISTING_ROLE, and sets the encumbrance and membership sources, the pause
///    window and `pauseMaxTotal` (shorter only);
///  - every pause action (set, renew, end) and every de-listing and re-listing takes two distinct
///    holders of its role, in contract (`_secondSigner`).
///
/// **Members only (spec 12.15, decision 6), with a CLRUSD listing (10d, Phase 2g decision 7).** A
/// transfer must be received by a listed wallet. A wallet is listed once the member registry
/// (`membershipSource`, the AccessManager, which also reads MembershipRegistry) has reported it as a
/// member and that has been recorded here: by anyone through `syncListing` (the app calls it when a
/// member registers or links a wallet), or on its own the first time the wallet receives CLRUSD or a
/// mint. From then on the registry no longer decides: membership expiry, tier and status changes,
/// `revokeMember` and `unlinkWallet` do not affect receipt. Only a two-person `delist` with a reason
/// code (MEMBERSHIP_ENDED, HOLDER_REQUEST, or FRAUD after a notice recorded at least 10 days before)
/// clears a listing, and only a two-person `relist` of a wallet the registry reports as a member
/// restores it. A wallet never recorded falls back to the registry's live answer. Only receipt is
/// checked: a de-listed wallet still sends to listed wallets and redeems, and de-listing never touches
/// a pledge lock or a liquidation. Exempt: mints, burns (so every redemption), the Liquidator's
/// seizure, transfers to an address holding MINTER_ROLE, BURNER_ROLE or LIQUIDATOR_ROLE (the vault,
/// the token pool, the Liquidator), and transfers to or from a redeem escrow of the registered
/// savings-intent factory (`intentFactory`, set only by the default admin, the vault timelock).
/// Swapping the registry (`setMembershipSource`) stays a timelock action. Nothing here screens a
/// transfer: sanctions screening is the app's, before it submits a Send (12.15).
///
/// **Pauses (10c, Phase 2g decisions 2 to 4).** Each pause lapses after its window (72 hours) unless
/// renewed, and no renewal carries a pause past `pauseMaxTotal` (at most 30 days, hard-coded) from
/// when it was first set, unless it is a two-person renewal that records a legal basis (a code and a
/// non-zero hash). The pause clock (`pauseClock`) counts the seconds a pause affecting an account was
/// in force, for the credit side's grace and cure periods.
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
        /// @dev Phase 2g (10c), appended: how long a pause may run from when it was first set before
        /// only a renewal with a legal basis extends it. Zero means PAUSE_MAX_TOTAL.
        uint64 pauseMaxTotal;
        /// @dev Phase 2g (decisions 3 and 4), appended: each account pause's current span, for the
        /// renewal cap and the pause clock.
        mapping(address => PauseSpan) accountSpan;
        /// @dev Phase 2g, appended: every security pause, oldest first (they never overlap).
        SecuritySpan[] securitySpans;
        /// @dev Phase 2g (10d, decision 7), appended: each wallet's CLRUSD listing.
        mapping(address => Listing) listing;
    }

    /// @notice An account pause's current span: when it was first set, the security pause clock at
    /// that moment, and the seconds earlier spans were in force while no security pause was.
    struct PauseSpan {
        uint64 start;
        uint64 securityAtStart;
        uint64 alone;
    }

    /// @notice A security pause: when it was first set, and the security pause clock at that moment.
    /// It ends where the next one's clock says, or for the last one at `globalPause.until`.
    struct SecuritySpan {
        uint64 start;
        uint64 before;
    }

    /// @notice A wallet's CLRUSD listing (10d): NONE (never recorded), LISTED or DELISTED, the reason
    /// code of the last de-listing, and when a FRAUD notice was recorded (zero if none is open).
    struct Listing {
        uint8 status;
        uint8 reason;
        uint64 fraudNoticeAt;
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
    /// @notice The longest any pause may run from when it was first set without a legal basis (10c).
    /// Hard-coded: governance may shorten `pauseMaxTotal`, and no role can raise it past this.
    uint64 public constant PAUSE_MAX_TOTAL = 30 days;
    /// @notice May de-list and re-list a wallet (10d), two holders at a time, and record a FRAUD
    /// notice. Cannot move funds, and reaches receipt only.
    bytes32 public constant LISTING_ROLE = keccak256("LISTING_ROLE");
    /// @notice How long before a FRAUD de-listing is approved its notice must be recorded (10d).
    uint64 public constant FRAUD_NOTICE_PERIOD = 10 days;

    uint8 private constant NONE = 0;
    uint8 private constant LISTED = 1;
    uint8 private constant DELISTED = 2;
    /// @dev De-listing reason codes (10d): MEMBERSHIP_ENDED 1, HOLDER_REQUEST 2, FRAUD 3.
    uint8 private constant FRAUD = 3;
    /// @dev Legal-basis codes for a renewal past the cap (10c): a court order 1, other legal process
    /// 2, a written law-enforcement or regulatory request 3.
    uint8 private constant MAX_LEGAL_BASIS = 3;

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
    error ClearUSDZeroAccount();
    /// @notice thrown when a pause window above MAX_PAUSE_WINDOW is set.
    error ClearUSDPauseWindowTooLong(uint64 window);
    /// @notice thrown when a transfer's receiver is not a listed wallet (12.15, 10d).
    error ClearUSDReceiverNotMember(address receiver);
    /// @notice thrown when a renewal without a legal basis would carry a pause past `capEnd`, the
    /// time it was first set plus `pauseMaxTotal` (10c).
    error ClearUSDPauseCapReached(uint256 capEnd);
    /// @notice thrown when `pauseMaxTotal` is set above PAUSE_MAX_TOTAL.
    error ClearUSDPauseMaxTotalTooLong(uint64 maxTotal);
    /// @notice thrown for a legal basis with an unknown code or a zero hash.
    error ClearUSDInvalidLegalBasis(uint8 legalBasis);
    /// @notice thrown for a de-listing reason code other than MEMBERSHIP_ENDED, HOLDER_REQUEST or FRAUD.
    error ClearUSDInvalidReasonCode(uint8 reasonCode);
    /// @notice thrown for a zero wallet or a zero decision or notice hash.
    error ClearUSDInvalidListingAction();
    error ClearUSDAlreadyDelisted(address wallet);
    error ClearUSDNotDelisted(address wallet);
    /// @notice thrown for a FRAUD de-listing without a notice recorded at least FRAUD_NOTICE_PERIOD
    /// before: `noticeAt` is when it was recorded, zero if never.
    error ClearUSDFraudNoticeRequired(address wallet, uint64 noticeAt);

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
    event PauseMaxTotalUpdated(uint64 maxTotal);
    /// @notice A renewal carried a pause on its legal basis (10c). `account` is zero for the
    /// security pause.
    event PauseLegalBasisRecorded(
        address indexed account, uint8 legalBasis, bytes32 legalBasisHash, uint64 until, address proposer, address approver
    );
    /// @notice A wallet's listing was recorded from the member registry.
    event WalletListed(address indexed wallet);
    /// @notice A wallet was de-listed (10d): it can no longer receive CLRUSD.
    event WalletDelisted(address indexed wallet, uint8 reasonCode, bytes32 decisionHash, address proposer, address approver);
    event WalletRelisted(address indexed wallet, bytes32 decisionHash, address proposer, address approver);
    event FraudNoticeRecorded(address indexed wallet, bytes32 noticeHash, address indexed signer);
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

    /// @notice whether `account` may receive a CLRUSD transfer now: an exempt address, a listed
    /// wallet, or a wallet never recorded that the member registry reports as a member.
    function mayReceive(address account) public view returns (bool) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        if (account == address(0)) return true;
        if (hasRole(MINTER_ROLE, account) || hasRole(BURNER_ROLE, account) || hasRole(LIQUIDATOR_ROLE, account)) {
            return true;
        }
        uint8 status = $.listing[account].status;
        if (status != NONE) return status == LISTED;
        IMembershipSource source = $.membershipSource;
        if (address(source) == address(0)) return true;
        return _isIntentEscrow(account) || source.isMember(account);
    }

    /* ========== LISTING (10d, Phase 2g decisions 7 and 8) ========== */

    /// @notice a wallet's listing: status (0 never recorded, 1 listed, 2 de-listed), the reason code
    /// of its last de-listing, and when an open FRAUD notice was recorded (zero if none).
    function listingOf(address wallet) external view returns (uint8 status, uint8 reasonCode, uint64 fraudNoticeAt) {
        Listing storage l = _clearUsdStorage().listing[wallet];
        return (l.status, l.reason, l.fraudNoticeAt);
    }

    /// @notice records a wallet as listed while the member registry reports it as a member.
    /// @dev Permissionless: it writes only what the governed registry answers, and never touches a
    /// de-listed wallet (only `relist` does). Once recorded, the registry no longer decides.
    function syncListing(address wallet) external returns (bool listed) {
        _noteListing(wallet);
        return _clearUsdStorage().listing[wallet].status == LISTED;
    }

    /// @dev Records a never-recorded wallet the registry reports as a member. A registry that does
    /// not answer records nothing.
    function _noteListing(address wallet) private {
        ClearUSDStorage storage $ = _clearUsdStorage();
        Listing storage l = $.listing[wallet];
        IMembershipSource source = $.membershipSource;
        if (l.status != NONE || address(source) == address(0) || wallet == address(0)) return;
        try source.isMember(wallet) returns (bool yes) {
            if (!yes) return;
        } catch {
            return;
        }
        l.status = LISTED;
        emit WalletListed(wallet);
    }

    /// @notice records a FRAUD notice for `wallet` (10d: written notice, and at least 10 days to
    /// respond before a FRAUD de-listing is approved). One LISTING_ROLE holder; recording it again
    /// restarts the period. It changes nothing else.
    function recordFraudNotice(address wallet, bytes32 noticeHash) external onlyRole(LISTING_ROLE) {
        Listing storage l = _clearUsdStorage().listing[wallet];
        if (wallet == address(0) || noticeHash == bytes32(0)) revert ClearUSDInvalidListingAction();
        if (l.status == DELISTED) revert ClearUSDAlreadyDelisted(wallet);
        l.fraudNoticeAt = uint64(block.timestamp);
        emit FraudNoticeRecorded(wallet, noticeHash, _msgSender());
    }

    /// @notice de-lists a wallet: it can no longer receive CLRUSD (10d). It still sends to listed
    /// wallets and redeems, and nothing here touches a pledge lock or a liquidation.
    /// @dev Two-person: one LISTING_ROLE holder's call proposes, a different holder's identical call
    /// carries it out. FRAUD needs a notice recorded at least FRAUD_NOTICE_PERIOD before that second
    /// call. The arguments are checked on both calls, so a bad one reverts at once.
    /// @param reasonCode MEMBERSHIP_ENDED 1, HOLDER_REQUEST 2 or FRAUD 3.
    /// @param decisionHash the hash of the off-chain decision record. Not zero.
    function delist(address wallet, uint8 reasonCode, bytes32 decisionHash) external onlyRole(LISTING_ROLE) {
        if (reasonCode == 0 || reasonCode > FRAUD) revert ClearUSDInvalidReasonCode(reasonCode);
        if (wallet == address(0) || decisionHash == bytes32(0)) revert ClearUSDInvalidListingAction();
        Listing storage l = _clearUsdStorage().listing[wallet];
        if (l.status == DELISTED) revert ClearUSDAlreadyDelisted(wallet);
        if (reasonCode == FRAUD && l.fraudNoticeAt == 0) revert ClearUSDFraudNoticeRequired(wallet, 0);
        address proposer = _secondSigner(LISTING_ROLE);
        if (proposer == address(0)) return;
        if (reasonCode == FRAUD && block.timestamp < uint256(l.fraudNoticeAt) + FRAUD_NOTICE_PERIOD) {
            revert ClearUSDFraudNoticeRequired(wallet, l.fraudNoticeAt);
        }
        l.status = DELISTED;
        l.reason = reasonCode;
        l.fraudNoticeAt = 0;
        emit WalletDelisted(wallet, reasonCode, decisionHash, proposer, _msgSender());
    }

    /// @notice lists a de-listed wallet again. Two-person, like `delist`, and only for a wallet the
    /// member registry reports as a member now, so it can never list a wallet the registry would
    /// refuse. It is the only way back: `syncListing` and receipt never touch a de-listed wallet.
    function relist(address wallet, bytes32 decisionHash) external onlyRole(LISTING_ROLE) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        if (decisionHash == bytes32(0)) revert ClearUSDInvalidListingAction();
        Listing storage l = $.listing[wallet];
        if (l.status != DELISTED) revert ClearUSDNotDelisted(wallet);
        IMembershipSource source = $.membershipSource;
        if (address(source) != address(0) && !source.isMember(wallet)) revert ClearUSDReceiverNotMember(wallet);
        address proposer = _secondSigner(LISTING_ROLE);
        if (proposer == address(0)) return;
        l.status = LISTED;
        emit WalletRelisted(wallet, decisionHash, proposer, _msgSender());
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
        // A member wallet's listing is recorded the first time it receives (10d), so a later change
        // in the registry no longer decides its receipt.
        _noteListing(to);

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
    /// tool: nothing in the credit system reads it, except to extend a grace or cure period by the
    /// time it was in force (`pauseClock`).
    /// @param account the account to pause.
    /// @param reason an off-chain case reference.
    function pauseAccount(address account, uint32 reason) external onlyRole(FRAUD_ROLE) {
        if (account == address(0)) revert ClearUSDZeroAccount();
        if (_secondSigner(FRAUD_ROLE) == address(0)) return;
        ClearUSDStorage storage $ = _clearUsdStorage();
        Pause storage p = $.accountPause[account];
        _requireMayPause(p);
        // Close the account's last span into its clock, and open a new one.
        PauseSpan storage sp = $.accountSpan[account];
        sp.alone += _aloneIn(sp, p.until);
        sp.start = uint64(block.timestamp);
        sp.securityAtStart = uint64(_securityClockAt(block.timestamp));
        uint64 until = uint64(block.timestamp) + _window();
        $.accountPause[account] = Pause({until: until, reason: reason, lastSigner: _msgSender()});
        emit AccountPaused(account, reason, until, _msgSender());
    }

    /// @notice renews an account's pause for another window. Needs a different signer from the
    /// one that set or last renewed it, and a reason; each renewal is logged. It reverts if the
    /// pause would then run past `pauseMaxTotal` from when it was first set (10c).
    function renewAccountPause(address account, uint32 reason) external onlyRole(FRAUD_ROLE) {
        if (_secondSigner(FRAUD_ROLE) == address(0)) return;
        ClearUSDStorage storage $ = _clearUsdStorage();
        Pause storage p = $.accountPause[account];
        _renew(p, reason, $.accountSpan[account].start, false);
        emit AccountPauseRenewed(account, reason, p.until, _msgSender());
    }

    /// @notice renews an account's pause past the cap on a legal basis (10c): a court order, other
    /// legal process, or a written law-enforcement or regulatory request. Two-person, like every
    /// renewal, and it records the basis's code and the hash of the document.
    /// @param legalBasis 1 court order, 2 other legal process, 3 written law-enforcement or
    /// regulatory request.
    function renewAccountPauseWithLegalBasis(address account, uint32 reason, uint8 legalBasis, bytes32 legalBasisHash)
        external
        onlyRole(FRAUD_ROLE)
    {
        _requireLegalBasis(legalBasis, legalBasisHash);
        address proposer = _secondSigner(FRAUD_ROLE);
        if (proposer == address(0)) return;
        ClearUSDStorage storage $ = _clearUsdStorage();
        Pause storage p = $.accountPause[account];
        _renew(p, reason, $.accountSpan[account].start, true);
        emit AccountPauseRenewed(account, reason, p.until, _msgSender());
        emit PauseLegalBasisRecorded(account, legalBasis, legalBasisHash, p.until, proposer, _msgSender());
    }

    /// @notice ends an account's pause early.
    /// @dev Ends it now rather than deleting it, so who set it is remembered: unpausing and pausing
    /// again is not a way for one signer to restart the clock (Phase 4, M-A).
    function unpauseAccount(address account) external onlyRole(FRAUD_ROLE) {
        if (_secondSigner(FRAUD_ROLE) == address(0)) return;
        _end(_clearUsdStorage().accountPause[account]);
        emit AccountUnpaused(account, _msgSender());
    }

    /// @notice pauses every member transfer during a security incident (an exploit: unauthorized
    /// activity). Same limits as an account pause: it moves nothing and lapses after the window
    /// unless a second signer renews it.
    function pauseForSecurity(uint32 reason) external onlyRole(SECURITY_ROLE) {
        if (_secondSigner(SECURITY_ROLE) == address(0)) return;
        ClearUSDStorage storage $ = _clearUsdStorage();
        _requireMayPause($.globalPause);
        $.securitySpans.push(
            SecuritySpan({start: uint64(block.timestamp), before: uint64(_securityClockAt(block.timestamp))})
        );
        uint64 until = uint64(block.timestamp) + _window();
        $.globalPause = Pause({until: until, reason: reason, lastSigner: _msgSender()});
        emit SecurityPaused(reason, until, _msgSender());
    }

    function renewSecurityPause(uint32 reason) external onlyRole(SECURITY_ROLE) {
        if (_secondSigner(SECURITY_ROLE) == address(0)) return;
        Pause storage p = _clearUsdStorage().globalPause;
        _renew(p, reason, _securityStart(), false);
        emit SecurityPauseRenewed(reason, p.until, _msgSender());
    }

    /// @notice renews the security pause past the cap on a legal basis, as
    /// `renewAccountPauseWithLegalBasis` does for an account.
    function renewSecurityPauseWithLegalBasis(uint32 reason, uint8 legalBasis, bytes32 legalBasisHash)
        external
        onlyRole(SECURITY_ROLE)
    {
        _requireLegalBasis(legalBasis, legalBasisHash);
        address proposer = _secondSigner(SECURITY_ROLE);
        if (proposer == address(0)) return;
        Pause storage p = _clearUsdStorage().globalPause;
        _renew(p, reason, _securityStart(), true);
        emit SecurityPauseRenewed(reason, p.until, _msgSender());
        emit PauseLegalBasisRecorded(address(0), legalBasis, legalBasisHash, p.until, proposer, _msgSender());
    }

    function unpauseSecurity() external onlyRole(SECURITY_ROLE) {
        if (_secondSigner(SECURITY_ROLE) == address(0)) return;
        _end(_clearUsdStorage().globalPause);
        emit SecurityUnpaused(_msgSender());
    }

    /* ========== PAUSE CLOCK (Phase 2g, decisions 3 and 4) ========== */

    /// @notice the seconds, up to now, in which the security pause or `account`'s own pause was in
    /// force, counting time when both were once. It never decreases, so the paused time inside any
    /// period is the difference of two readings. `pauseClock(address(0))` is the security pause alone.
    /// @dev Only pauses set after Phase 2g are counted.
    function pauseClock(address account) external view returns (uint256) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        PauseSpan storage sp = $.accountSpan[account];
        uint256 until = $.accountPause[account].until;
        if (until > block.timestamp) until = block.timestamp;
        return _securityClockAt(block.timestamp) + sp.alone + _aloneIn(sp, until);
    }

    /// @notice whether the security pause or `account`'s own pause is in force now.
    function isPauseInForce(address account) external view returns (bool) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        return $.accountPause[account].until > block.timestamp || $.globalPause.until > block.timestamp;
    }

    /// @dev The seconds of an account's current span, up to `end`, in which no security pause was in
    /// force. The span runs from `start` without a break to the pause's end.
    function _aloneIn(PauseSpan storage sp, uint256 end) private view returns (uint64) {
        uint256 start = sp.start;
        if (start == 0 || end <= start) return 0;
        return uint64((end - start) - (_securityClockAt(end) - sp.securityAtStart));
    }

    /// @dev The security pause's clock at `t` (no later than now): the seconds before `t` in which a
    /// security pause was in force. Binary search over the spans, which never overlap.
    function _securityClockAt(uint256 t) private view returns (uint256) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        SecuritySpan[] storage spans = $.securitySpans;
        uint256 n = spans.length;
        uint256 lo;
        uint256 hi = n;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (spans[mid].start <= t) lo = mid + 1;
            else hi = mid;
        }
        if (lo == 0) return 0;
        SecuritySpan storage span = spans[lo - 1];
        uint256 end = lo < n ? span.start + (spans[lo].before - span.before) : $.globalPause.until;
        if (t < end) end = t;
        return span.before + (end > span.start ? end - span.start : 0);
    }

    /// @dev When the security pause in force (or the last one) was first set; zero if none was set
    /// after Phase 2g, which fails closed (every renewal then needs a legal basis).
    function _securityStart() private view returns (uint256) {
        SecuritySpan[] storage spans = _clearUsdStorage().securitySpans;
        return spans.length == 0 ? 0 : spans[spans.length - 1].start;
    }

    /// @notice how long a pause may run from when it was first set before only a renewal with a legal
    /// basis extends it (10c). At most PAUSE_MAX_TOTAL.
    function pauseMaxTotal() public view returns (uint64) {
        uint64 m = _clearUsdStorage().pauseMaxTotal;
        return m == 0 ? PAUSE_MAX_TOTAL : m;
    }

    /// @notice shortens `pauseMaxTotal`. Governed: the admin is the timelock. Above PAUSE_MAX_TOTAL
    /// reverts, so no role can raise the cap; zero means PAUSE_MAX_TOTAL.
    function setPauseMaxTotal(uint64 maxTotal) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (maxTotal > PAUSE_MAX_TOTAL) revert ClearUSDPauseMaxTotalTooLong(maxTotal);
        _clearUsdStorage().pauseMaxTotal = maxTotal;
        emit PauseMaxTotalUpdated(maxTotal);
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
    /// different holder making the identical call proceeds. The same holder
    /// twice reverts; a proposer who has since lost the role no longer counts. The 10c rules (the
    /// last signer cannot renew or restart a pause) then apply to the second signer.
    /// It returns the proposer to the second call, and zero to the first.
    function _secondSigner(bytes32 role) private returns (address first) {
        ClearUSDStorage storage $ = _clearUsdStorage();
        bytes32 action = keccak256(msg.data);
        first = $.proposerOf[action];
        if (first == _msgSender()) revert ClearUSDSameSigner(_msgSender());
        if (first == address(0) || !hasRole(role, first)) {
            $.proposerOf[action] = _msgSender();
            emit ActionProposed(action, _msgSender(), msg.sig);
            return address(0);
        }
        delete $.proposerOf[action];
        emit ActionApproved(action, first, _msgSender());
    }

    /// @notice who proposed a pending two-person pause action, by the hash of its calldata.
    function proposerOf(bytes32 action) external view returns (address) {
        return _clearUsdStorage().proposerOf[action];
    }

    /// @dev A renewal: only while the pause is in force, by a signer other than the last, for one
    /// window. Without a legal basis it may not carry the pause past `start` + `pauseMaxTotal`, where
    /// `start` is when the pause was first set (10c); with none, the pause lapses at its end.
    function _renew(Pause storage p, uint32 reason, uint256 start, bool legalBasis) private {
        if (p.until <= block.timestamp) revert ClearUSDNoPause();
        if (p.lastSigner == _msgSender()) revert ClearUSDSameSigner(_msgSender());
        uint64 until = uint64(block.timestamp) + _window();
        uint256 capEnd = start + pauseMaxTotal();
        if (!legalBasis && until > capEnd) revert ClearUSDPauseCapReached(capEnd);
        p.until = until;
        p.reason = reason;
        p.lastSigner = _msgSender();
    }

    function _requireLegalBasis(uint8 legalBasis, bytes32 legalBasisHash) private pure {
        if (legalBasis == 0 || legalBasis > MAX_LEGAL_BASIS || legalBasisHash == bytes32(0)) {
            revert ClearUSDInvalidLegalBasis(legalBasis);
        }
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
