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

/// @notice Test-only issuer that owns a stated share of a member's debt.
/// @dev The base CreditIssuer writes off a member's whole balance, which is correct only while it
/// is the only issuer that member has. This is what an issuer tracking its own positions does
/// instead, and it exists so the scoping can be tested before RevolvingIssuer and TermIssuer are
/// built on top of it.
contract ScopedCreditIssuerHarness is CreditIssuer {
    mapping(address => uint256) public ownShare;
    bool public keepsMembershipOnDefault;

    function initialize(address _stableCredit) external initializer {
        __CreditIssuer_init(_stableCredit);
    }

    function setOwnShare(address member, uint256 amount) external {
        ownShare[member] = amount;
    }

    function setKeepsMembershipOnDefault(bool keep) external {
        keepsMembershipOnDefault = keep;
    }

    /// @notice adjusts this issuer's own contribution to a member's ceiling.
    /// @dev The base CreditIssuer has no reason to call this; RevolvingIssuer will, every time
    /// LimitCalculator revalues a tier.
    function setLimit(address member, uint256 amount) external {
        stableCredit.updateCreditLimit(member, amount);
    }

    function _writeOffAmount(address member) internal view override returns (uint256) {
        return ownShare[member];
    }

    function _onDefault(address member) internal override {
        // An issuer sharing a member with another narrows this to its own relationship rather
        // than ejecting them from the network.
        if (!keepsMembershipOnDefault) super._onDefault(member);
    }
}
