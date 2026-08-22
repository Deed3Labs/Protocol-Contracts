// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./StableCredit.sol";

/// @title ClearCredit
/// @notice The co-op's credit ledger: the deployable StableCredit.
/// @dev `StableCredit` exposes `__StableCredit_init` under `onlyInitializing` and no public
/// initializer, which is the OpenZeppelin idiom for a base meant to be inherited. Left alone it
/// cannot be deployed at all -- an implementation with no way to initialize it is an
/// implementation anybody can initialize later.
///
/// This is the child that base assumes. It adds an external initializer and nothing else, so what
/// runs in production is the ledger's own logic, unmodified.
///
/// There is deliberately no matching child for `CreditIssuer`. That base already has two concrete
/// forms -- `RevolvingIssuer` and `TermIssuer` -- and a bare one is never deployed, so giving it a
/// third would be inventing a contract to satisfy a pattern rather than a need.
contract ClearCredit is StableCredit {
    /// @notice initializes the ledger.
    /// @param name_ token name.
    /// @param symbol_ token symbol.
    /// @param access_ the AccessManager governing operators and members.
    function initialize(string memory name_, string memory symbol_, address access_)
        external
        initializer
    {
        __StableCredit_init(name_, symbol_, access_);
    }
}
