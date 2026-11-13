// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {BurnMintERC20UUPS} from
    "@chainlink/contracts/src/v0.8/shared/token/ERC20/upgradeable/BurnMintERC20UUPS.sol";
import "../core/interfaces/stable-credit/IEncumbranceSource.sol";

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
contract ClearUSDUpgradeable is BurnMintERC20UUPS {
    /// @custom:storage-location erc7201:clear.storage.ClearUSD
    struct ClearUSDStorage {
        IEncumbranceSource encumbranceSource;
        /// @dev The lock last read successfully per holder (audit M-3). Appended to the namespaced
        /// struct, which is layout-safe: nothing else lives after it in this namespace.
        mapping(address => uint256) lastKnownLock;
    }

    // keccak256(abi.encode(uint256(keccak256("clear.storage.ClearUSD")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CLEAR_USD_STORAGE =
        0xce096656e701951180d0c979da50968533c9b97034e1cc9d16705e2ff2168100;

    /// @notice May take encumbered collateral, and only encumbered collateral.
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    error ClearUSDEncumbered(address holder, uint256 free, uint256 amount);
    error ClearUSDSeizureExceedsEncumbrance(address holder, uint256 encumbered, uint256 amount);
    error ClearUSDEncumbranceUnreadable(address holder);

    event EncumbranceSourceUpdated(address indexed source);
    /// @notice The encumbrance source reverted while a holder's CLRUSD moved (audit M-3). Monitoring
    /// should alert on this: it means the lock is running on its last known reading.
    event EncumbranceSourceReverted(address indexed holder, uint256 lastKnownLock);

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

    /// @dev One hook covers every way out. Transfers, redemptions and bridging all pass through
    /// `_update`, and a lock that only caught transfers would be a lock in name. Minting is
    /// exempt because it has no `from` to encumber.
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from != address(0)) {
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
        }

        super._update(from, to, value);
    }
}
