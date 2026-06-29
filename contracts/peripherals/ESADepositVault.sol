// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
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
contract ESADepositVault is Initializable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable, EIP712Upgradeable, IESADepositVault {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using ECDSAUpgradeable for bytes32;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 private constant REDEEM_TYPEHASH =
        keccak256("Redeem(address redeemer,address token,uint256 clrusdAmount,address receiver,uint256 nonce,uint256 deadline)");
    /// @dev Autopay: a depositor signs ONE mandate authorizing recurring deposits of a fixed amount on
    ///      a fixed cadence; an OPERATOR relayer executes each due run gaslessly. USDC is pulled via a
    ///      standing allowance the user grants once with EIP-2612 `permit` (also gasless).
    bytes32 private constant DEPOSIT_MANDATE_TYPEHASH = keccak256(
        "DepositMandate(address depositor,address token,uint256 amountPerRun,uint64 interval,uint32 maxRuns,uint256 startAt,uint256 expiry,uint256 nonce)"
    );

    address public override clrusd;
    uint8 private clrusdDecimals;

    mapping(address => bool) private s_isAcceptedToken;
    /// @notice Per-redeemer nonce for gasless redeem-intent replay protection.
    mapping(address => uint256) public redeemNonces;

    /// @notice Execution state for an autopay deposit mandate, keyed by its EIP-712 digest.
    struct DepositMandateState {
        uint32 runsDone;
        uint64 lastRunAt;
        bool cancelled;
    }
    mapping(bytes32 => DepositMandateState) public depositMandates;

    error ESADepositVaultInvalidAddress();
    error ESADepositVaultInvalidAmount();
    error ESADepositVaultTokenNotAccepted();
    error ESADepositVaultNonExactAmount();
    error ESADepositVaultInsufficientLiquidity();
    error ESADepositVaultMandateInvalid();

    /// @notice Emitted on each executed autopay run.
    event MandateDeposit(bytes32 indexed mandate, address indexed depositor, uint32 runIndex, uint256 amount, uint256 minted);
    event MandateCancelled(bytes32 indexed mandate);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address clrusd_, address admin) external initializer {
        if (clrusd_ == address(0) || admin == address(0)) revert ESADepositVaultInvalidAddress();

        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        __EIP712_init("ESADepositVault", "1");

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

    // ── Redeem (sender-signed; sender pays gas) ────────────────────────────────
    function redeem(address token, uint256 clrusdAmount, address receiver) external override whenNotPaused returns (uint256 returnedAmount) {
        returnedAmount = _executeRedeem(msg.sender, token, clrusdAmount, receiver);
    }

    // ── Redeem (gasless; redeemer signed an EIP-712 intent, OPERATOR_ROLE relayer submits) ──
    // Requires a one-time CLRUSD approve(vault) from the redeemer (standing allowance for burnFrom);
    // each redeem is bounded by the signed intent (amount + receiver + nonce + deadline).
    function redeemWithAuthorization(
        address redeemer,
        address token,
        uint256 clrusdAmount,
        address receiver,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused onlyRole(OPERATOR_ROLE) returns (uint256 returnedAmount) {
        require(block.timestamp <= deadline, "ESADepositVault: intent expired");
        uint256 nonce = redeemNonces[redeemer]++;
        bytes32 structHash = keccak256(abi.encode(REDEEM_TYPEHASH, redeemer, token, clrusdAmount, receiver, nonce, deadline));
        address signer = _hashTypedDataV4(structHash).recover(v, r, s);
        require(signer != address(0) && signer == redeemer, "ESADepositVault: bad signature");
        returnedAmount = _executeRedeem(redeemer, token, clrusdAmount, receiver);
    }

    function _executeRedeem(address redeemer, address token, uint256 clrusdAmount, address receiver) internal returns (uint256 returnedAmount) {
        if (receiver == address(0) || token == address(0)) revert ESADepositVaultInvalidAddress();
        if (!s_isAcceptedToken[token]) revert ESADepositVaultTokenNotAccepted();
        if (clrusdAmount == 0) revert ESADepositVaultInvalidAmount();

        returnedAmount = _convertFromClrUsd(token, clrusdAmount);
        if (returnedAmount == 0) revert ESADepositVaultInvalidAmount();
        if (_convertToClrUsd(token, returnedAmount) != clrusdAmount) revert ESADepositVaultNonExactAmount();
        if (IERC20Upgradeable(token).balanceOf(address(this)) < returnedAmount) revert ESADepositVaultInsufficientLiquidity();

        IClearUSDMintBurn(clrusd).burnFrom(redeemer, clrusdAmount);
        IERC20Upgradeable(token).safeTransfer(receiver, returnedAmount);
        emit Redeemed(redeemer, receiver, token, clrusdAmount, returnedAmount);
    }

    // ── Autopay (recurring deposit mandate; depositor signed once, OPERATOR relayer executes each run) ──
    /// @dev USDC is pulled via the depositor's standing allowance (granted once via EIP-2612 permit).
    function executeMandateDeposit(
        address depositor,
        address token,
        uint256 amountPerRun,
        uint64 interval,
        uint32 maxRuns,
        uint256 startAt,
        uint256 expiry,
        uint256 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused onlyRole(OPERATOR_ROLE) returns (uint256 minted) {
        bytes32 digest = _mandateDigest(depositor, token, amountPerRun, interval, maxRuns, startAt, expiry, nonce);
        address signer = digest.recover(v, r, s);
        if (signer == address(0) || signer != depositor) revert ESADepositVaultMandateInvalid();
        if (block.timestamp > expiry || block.timestamp < startAt) revert ESADepositVaultMandateInvalid();

        DepositMandateState storage st = depositMandates[digest];
        if (st.cancelled || st.runsDone >= maxRuns) revert ESADepositVaultMandateInvalid();
        // Each run must respect the cadence: run i is allowed at/after startAt + interval*i.
        if (block.timestamp < startAt + uint256(interval) * st.runsDone) revert ESADepositVaultMandateInvalid();

        st.runsDone += 1;
        st.lastRunAt = uint64(block.timestamp);

        minted = _validateDeposit(token, amountPerRun, depositor);
        IERC20Upgradeable(token).safeTransferFrom(depositor, address(this), amountPerRun);
        IClearUSDMintBurn(clrusd).mint(depositor, minted);
        emit Deposited(depositor, depositor, token, amountPerRun, minted);
        emit MandateDeposit(digest, depositor, st.runsDone, amountPerRun, minted);
    }

    /// @notice Stop a mandate. OPERATOR-gated (the relayer cancels on the user's authenticated request);
    ///         the user can also fully revoke by removing the USDC allowance.
    function cancelMandate(bytes32 digest) external onlyRole(OPERATOR_ROLE) {
        depositMandates[digest].cancelled = true;
        emit MandateCancelled(digest);
    }

    /// @notice EIP-712 digest for a deposit mandate (so off-chain signers/relayers can key state).
    function hashDepositMandate(
        address depositor,
        address token,
        uint256 amountPerRun,
        uint64 interval,
        uint32 maxRuns,
        uint256 startAt,
        uint256 expiry,
        uint256 nonce
    ) external view returns (bytes32) {
        return _mandateDigest(depositor, token, amountPerRun, interval, maxRuns, startAt, expiry, nonce);
    }

    function _mandateDigest(
        address depositor,
        address token,
        uint256 amountPerRun,
        uint64 interval,
        uint32 maxRuns,
        uint256 startAt,
        uint256 expiry,
        uint256 nonce
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(DEPOSIT_MANDATE_TYPEHASH, depositor, token, amountPerRun, interval, maxRuns, startAt, expiry, nonce))
        );
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

    /// @dev Reserved storage for future upgrades. Reduced by 1 (depositMandates mapping added).
    uint256[43] private __gap;
}
