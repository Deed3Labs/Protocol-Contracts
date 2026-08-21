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
    }

    // keccak256(abi.encode(uint256(keccak256("clear.storage.ClearUSD")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CLEAR_USD_STORAGE =
        0xce096656e701951180d0c979da50968533c9b97034e1cc9d16705e2ff2168100;

    /// @notice May take encumbered collateral, and only encumbered collateral.
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    error ClearUSDEncumbered(address holder, uint256 free, uint256 amount);
    error ClearUSDSeizureExceedsEncumbrance(address holder, uint256 encumbered, uint256 amount);

    event EncumbranceSourceUpdated(address indexed source);

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

    /// @dev A source that reverts must not take the token down with it. An unreadable source locks
    /// nothing: the registry going quiet is a problem to fix, not a reason to freeze everyone.
    function _encumberedOf(address holder) internal view returns (uint256) {
        IEncumbranceSource source = _clearUsdStorage().encumbranceSource;
        if (address(source) == address(0)) return 0;
        try source.encumberedOf(holder) returns (uint256 locked) {
            return locked;
        } catch {
            return 0;
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
        uint256 encumbered = _encumberedOf(holder);
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
            uint256 free = freeBalanceOf(from);
            if (value > free) revert ClearUSDEncumbered(from, free, value);
        }
        super._update(from, to, value);
    }
}
