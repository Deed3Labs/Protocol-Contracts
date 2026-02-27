// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@chainlink/contracts/src/v0.8/shared/token/ERC20/BurnMintERC20.sol";

/// @title ClearUSD
/// @notice Protocol stable-value settlement token for ESA deposits.
/// @dev Uses Chainlink's BurnMintERC20 for CCIP-compatible mint/burn role controls.
contract ClearUSD is BurnMintERC20 {
    error ClearUSDInvalidAdmin();

    constructor(address admin, uint256 maxSupply, uint256 preMint)
        BurnMintERC20("Clear USD", "CLRUSD", 6, maxSupply, preMint)
    {
        if (admin == address(0)) revert ClearUSDInvalidAdmin();

        address previousAdmin = s_ccipAdmin;
        s_ccipAdmin = admin;
        if (previousAdmin != admin) {
            emit CCIPAdminTransferred(previousAdmin, admin);
        }

        if (admin != msg.sender) {
            grantRole(DEFAULT_ADMIN_ROLE, admin);
            revokeRole(DEFAULT_ADMIN_ROLE, msg.sender);
        }
    }

    /// @notice Convenience helper to grant both mint and burn privileges to an issuer.
    function grantIssuerRoles(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(MINTER_ROLE, issuer);
        grantRole(BURNER_ROLE, issuer);
    }

    /// @notice Convenience helper to revoke both mint and burn privileges from an issuer.
    function revokeIssuerRoles(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(MINTER_ROLE, issuer);
        revokeRole(BURNER_ROLE, issuer);
    }
}
