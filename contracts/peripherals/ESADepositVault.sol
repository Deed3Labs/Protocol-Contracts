// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../core/interfaces/IESADepositVault.sol";

interface IClearUSDMintBurn {
    function mint(address account, uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}

/// @title ESADepositVault
/// @notice Isolated 1:1 backing vault for CLRUSD issuance/redemption.
/// @dev Does not route funds into AssurancePool in v1.
contract ESADepositVault is AccessControl, Pausable, IESADepositVault {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    address public immutable override clrusd;
    uint8 private immutable i_clrusdDecimals;

    mapping(address => bool) private s_isAcceptedToken;

    error ESADepositVaultInvalidAddress();
    error ESADepositVaultInvalidAmount();
    error ESADepositVaultTokenNotAccepted();
    error ESADepositVaultNonExactAmount();
    error ESADepositVaultInsufficientLiquidity();

    constructor(address clrusd_, address admin) {
        if (clrusd_ == address(0) || admin == address(0)) {
            revert ESADepositVaultInvalidAddress();
        }

        clrusd = clrusd_;
        i_clrusdDecimals = IERC20Metadata(clrusd_).decimals();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function deposit(address token, uint256 amount, address receiver)
        external
        override
        whenNotPaused
        returns (uint256 minted)
    {
        if (receiver == address(0) || token == address(0)) revert ESADepositVaultInvalidAddress();
        if (!s_isAcceptedToken[token]) revert ESADepositVaultTokenNotAccepted();
        if (amount == 0) revert ESADepositVaultInvalidAmount();

        minted = _convertToClrUsd(token, amount);
        if (minted == 0) revert ESADepositVaultInvalidAmount();

        // Enforce exact conversions so users do not lose value to decimal rounding.
        if (_convertFromClrUsd(token, minted) != amount) revert ESADepositVaultNonExactAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IClearUSDMintBurn(clrusd).mint(receiver, minted);

        emit Deposited(msg.sender, receiver, token, amount, minted);
    }

    function redeem(address token, uint256 clrusdAmount, address receiver)
        external
        override
        whenNotPaused
        returns (uint256 returnedAmount)
    {
        if (receiver == address(0) || token == address(0)) revert ESADepositVaultInvalidAddress();
        if (!s_isAcceptedToken[token]) revert ESADepositVaultTokenNotAccepted();
        if (clrusdAmount == 0) revert ESADepositVaultInvalidAmount();

        returnedAmount = _convertFromClrUsd(token, clrusdAmount);
        if (returnedAmount == 0) revert ESADepositVaultInvalidAmount();

        if (_convertToClrUsd(token, returnedAmount) != clrusdAmount) {
            revert ESADepositVaultNonExactAmount();
        }

        if (IERC20(token).balanceOf(address(this)) < returnedAmount) {
            revert ESADepositVaultInsufficientLiquidity();
        }

        IClearUSDMintBurn(clrusd).burnFrom(msg.sender, clrusdAmount);
        IERC20(token).safeTransfer(receiver, returnedAmount);

        emit Redeemed(msg.sender, receiver, token, clrusdAmount, returnedAmount);
    }

    function previewDeposit(address token, uint256 amount)
        external
        view
        override
        returns (uint256 minted)
    {
        return _convertToClrUsd(token, amount);
    }

    function previewRedeem(address token, uint256 clrusdAmount)
        external
        view
        override
        returns (uint256 returnedAmount)
    {
        return _convertFromClrUsd(token, clrusdAmount);
    }

    function setAcceptedToken(address token, bool accepted) external override onlyRole(OPERATOR_ROLE) {
        if (token == address(0)) revert ESADepositVaultInvalidAddress();
        s_isAcceptedToken[token] = accepted;
        emit AcceptedTokenUpdated(token, accepted);
    }

    function isAcceptedToken(address token) external view override returns (bool) {
        return s_isAcceptedToken[token];
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _convertToClrUsd(address token, uint256 tokenAmount) internal view returns (uint256) {
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        if (tokenDecimals == i_clrusdDecimals) return tokenAmount;
        if (tokenDecimals > i_clrusdDecimals) {
            return tokenAmount / (10 ** (tokenDecimals - i_clrusdDecimals));
        }
        return tokenAmount * (10 ** (i_clrusdDecimals - tokenDecimals));
    }

    function _convertFromClrUsd(address token, uint256 clrusdAmount) internal view returns (uint256) {
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        if (tokenDecimals == i_clrusdDecimals) return clrusdAmount;
        if (tokenDecimals > i_clrusdDecimals) {
            return clrusdAmount * (10 ** (tokenDecimals - i_clrusdDecimals));
        }
        return clrusdAmount / (10 ** (i_clrusdDecimals - tokenDecimals));
    }
}
