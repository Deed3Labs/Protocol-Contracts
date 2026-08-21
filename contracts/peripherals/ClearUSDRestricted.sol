// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./ClearUSD.sol";
import "../core/interfaces/stable-credit/IEncumbranceSource.sol";

/// @title ClearUSDRestricted
/// @notice CLRUSD that will not let collateral walk out of the door.
/// @dev A separate contract rather than a change to ClearUSD, because ClearUSD is deployed and not
/// upgradeable. Adopting this is a token migration, not a patch.
///
/// The credit line's rule is `withdrawable = ESA balance - savings-backed drawn`, and when that
/// reaches zero, redemption locks. Recording the lock in a registry does not create it: the member
/// self-custodies, so a registry entry is a note about an asset somebody else controls. Enforcing
/// it here makes it a property of the asset, which holds against every path out -- a transfer, a
/// redemption, a bridge -- and against holders that are not smart accounts and have no module
/// installed.
///
/// This does not replace the ERC-7579 module, and neither one covers the other. The token can
/// refuse to let collateral move; it cannot hand that collateral to the co-op when a member
/// defaults. The pull is the module's job, granted once by the member and bounded to liquidation,
/// which is a far narrower authority than a role on the token that could move anyone's balance.
contract ClearUSDRestricted is ClearUSD {
    /// @notice Reports how much of a holder's balance is backing drawn credit.
    IEncumbranceSource public encumbranceSource;

    error ClearUSDEncumbered(address holder, uint256 free, uint256 amount);

    event EncumbranceSourceUpdated(address indexed source);

    constructor(address admin, uint256 maxSupply, uint256 preMint)
        ClearUSD(admin, maxSupply, preMint)
    {}

    /// @notice sets the contract reporting what is encumbered.
    /// @dev Unset means unrestricted, which is what a freshly deployed token is until the credit
    /// system is wired to it. Clearing it is deliberately possible: a source that broke would
    /// otherwise freeze every holder, and a token that cannot be unwedged is worse than one whose
    /// lock can be lifted by an admin who has to be seen doing it.
    /// @param source address of the encumbrance source, or address(0) for none.
    function setEncumbranceSource(address source) external onlyRole(DEFAULT_ADMIN_ROLE) {
        encumbranceSource = IEncumbranceSource(source);
        emit EncumbranceSourceUpdated(source);
    }

    /// @notice how much of a holder's balance may leave.
    function freeBalanceOf(address holder) public view returns (uint256) {
        uint256 balance = balanceOf(holder);
        uint256 locked = _encumberedOf(holder);
        return balance > locked ? balance - locked : 0;
    }

    /// @dev A source that reverts must not take the token down with it. An unreadable source
    /// locks nothing, which keeps the token usable; the registry going quiet is a problem to fix,
    /// not a reason to freeze every holder.
    function _encumberedOf(address holder) internal view returns (uint256) {
        if (address(encumbranceSource) == address(0)) return 0;
        try encumbranceSource.encumberedOf(holder) returns (uint256 locked) {
            return locked;
        } catch {
            return 0;
        }
    }

    function _requireFree(address holder, uint256 amount) private view {
        uint256 free = freeBalanceOf(holder);
        if (amount > free) revert ClearUSDEncumbered(holder, free, amount);
    }

    /// @dev Every way out is checked, not only the obvious one. Redeeming to USDC and bridging
    /// away both burn, and a lock that only covered transfers would be a lock in name.
    function _transfer(address from, address to, uint256 amount) internal virtual override {
        _requireFree(from, amount);
        super._transfer(from, to, amount);
    }

    function _burn(address account, uint256 amount) internal virtual override {
        _requireFree(account, amount);
        super._burn(account, amount);
    }
}
