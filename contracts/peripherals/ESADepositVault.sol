// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "../core/interfaces/IESADepositVault.sol";

interface IClearUSDMintBurn {
    function mint(address account, uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}

/// @dev EIP-3009 (Circle USDC) gasless authorized pull.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title ESADepositVault
/// @notice Isolated 1:1 backing vault for CLRUSD issuance/redemption.
/// @dev UUPS-upgradeable. `deposit` is sender-signed (sender pays gas); `depositWithAuthorization`
///      is gasless (depositor signs an EIP-3009 USDC authorization, an OPERATOR_ROLE relayer submits).
///      Gasless redeem is added once the CLRUSD permit/approval path is chosen.
contract ESADepositVault is Initializable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable, IESADepositVault {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    address public override clrusd;
    uint8 private clrusdDecimals;

    mapping(address => bool) private s_isAcceptedToken;

    error ESADepositVaultInvalidAddress();
    error ESADepositVaultInvalidAmount();
    error ESADepositVaultTokenNotAccepted();
    error ESADepositVaultNonExactAmount();
    error ESADepositVaultInsufficientLiquidity();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address clrusd_, address admin) external initializer {
        if (clrusd_ == address(0) || admin == address(0)) revert ESADepositVaultInvalidAddress();

        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        clrusd = clrusd_;
        clrusdDecimals = IERC20MetadataUpgradeable(clrusd_).decimals();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ── Deposit (sender-signed; sender pays gas) ────────────────────────────────
    function deposit(address token, uint256 amount, address receiver) external override whenNotPaused returns (uint256 minted) {
        minted = _validateDeposit(token, amount, receiver);
        IERC20Upgradeable(token).safeTransferFrom(msg.sender, address(this), amount);
        IClearUSDMintBurn(clrusd).mint(receiver, minted);
        emit Deposited(msg.sender, receiver, token, amount, minted);
    }

    // ── Deposit (gasless; depositor signed an EIP-3009 authorization, relayer submits) ──
    function depositWithAuthorization(
        address depositor,
        address token,
        uint256 amount,
        address receiver,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authNonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused onlyRole(OPERATOR_ROLE) returns (uint256 minted) {
        if (depositor == address(0)) revert ESADepositVaultInvalidAddress();
        minted = _validateDeposit(token, amount, receiver);
        IERC3009(token).receiveWithAuthorization(depositor, address(this), amount, validAfter, validBefore, authNonce, v, r, s);
        IClearUSDMintBurn(clrusd).mint(receiver, minted);
        emit Deposited(depositor, receiver, token, amount, minted);
    }

    function _validateDeposit(address token, uint256 amount, address receiver) internal view returns (uint256 minted) {
        if (receiver == address(0) || token == address(0)) revert ESADepositVaultInvalidAddress();
        if (!s_isAcceptedToken[token]) revert ESADepositVaultTokenNotAccepted();
        if (amount == 0) revert ESADepositVaultInvalidAmount();
        minted = _convertToClrUsd(token, amount);
        if (minted == 0) revert ESADepositVaultInvalidAmount();
        if (_convertFromClrUsd(token, minted) != amount) revert ESADepositVaultNonExactAmount();
    }

    // ── Redeem (sender-signed; gasless variant added with the chosen CLRUSD path) ──
    function redeem(address token, uint256 clrusdAmount, address receiver) external override whenNotPaused returns (uint256 returnedAmount) {
        if (receiver == address(0) || token == address(0)) revert ESADepositVaultInvalidAddress();
        if (!s_isAcceptedToken[token]) revert ESADepositVaultTokenNotAccepted();
        if (clrusdAmount == 0) revert ESADepositVaultInvalidAmount();

        returnedAmount = _convertFromClrUsd(token, clrusdAmount);
        if (returnedAmount == 0) revert ESADepositVaultInvalidAmount();
        if (_convertToClrUsd(token, returnedAmount) != clrusdAmount) revert ESADepositVaultNonExactAmount();
        if (IERC20Upgradeable(token).balanceOf(address(this)) < returnedAmount) revert ESADepositVaultInsufficientLiquidity();

        IClearUSDMintBurn(clrusd).burnFrom(msg.sender, clrusdAmount);
        IERC20Upgradeable(token).safeTransfer(receiver, returnedAmount);
        emit Redeemed(msg.sender, receiver, token, clrusdAmount, returnedAmount);
    }

    function previewDeposit(address token, uint256 amount) external view override returns (uint256 minted) {
        return _convertToClrUsd(token, amount);
    }

    function previewRedeem(address token, uint256 clrusdAmount) external view override returns (uint256 returnedAmount) {
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
        uint8 tokenDecimals = IERC20MetadataUpgradeable(token).decimals();
        if (tokenDecimals == clrusdDecimals) return tokenAmount;
        if (tokenDecimals > clrusdDecimals) return tokenAmount / (10 ** (tokenDecimals - clrusdDecimals));
        return tokenAmount * (10 ** (clrusdDecimals - tokenDecimals));
    }

    function _convertFromClrUsd(address token, uint256 clrusdAmount) internal view returns (uint256) {
        uint8 tokenDecimals = IERC20MetadataUpgradeable(token).decimals();
        if (tokenDecimals == clrusdDecimals) return clrusdAmount;
        if (tokenDecimals > clrusdDecimals) return clrusdAmount * (10 ** (tokenDecimals - clrusdDecimals));
        return clrusdAmount / (10 ** (clrusdDecimals - tokenDecimals));
    }

    /// @dev Reserved storage for future upgrades.
    uint256[45] private __gap;
}
