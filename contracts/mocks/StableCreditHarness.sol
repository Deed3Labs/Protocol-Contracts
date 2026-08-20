// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../core/StableCredit.sol";
import "../peripherals/CreditIssuer.sol";

/// @notice Test-only concrete StableCredit.
/// @dev StableCredit and CreditIssuer expose `__X_init` guarded by `onlyInitializing`, so they are
/// meant to be extended rather than deployed. These harnesses supply the external initializer a
/// real child would, and nothing else, so the tests exercise the production logic unmodified.
contract StableCreditHarness is StableCredit {
    function initialize(string memory name_, string memory symbol_, address access_)
        external
        initializer
    {
        __StableCredit_init(name_, symbol_, access_);
    }
}

/// @notice Test-only concrete CreditIssuer.
contract CreditIssuerHarness is CreditIssuer {
    function initialize(address _stableCredit) external initializer {
        __CreditIssuer_init(_stableCredit);
    }
}
