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
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
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
///      is gasless (depositor signs an EIP-3009 USDC authorization, a RELAYER_ROLE relayer submits).
///
///      **Roles (audit H-3).** The relayer key lives on an API server, so it holds `RELAYER_ROLE`,
///      which reaches only the signed paths: a gasless deposit, a gasless redeem and an autopay run
///      (plus cancelling a mandate), each bounded by a signature from the member whose money moves.
///      Settings -- which token the vault accepts, the CLRUSD it mints -- are `DEFAULT_ADMIN_ROLE`
///      (the Safe). `OPERATOR_ROLE` used to cover both, which let whoever held the relayer key
///      accept a worthless token, mint against it and redeem every member's USDC. The constant is
///      kept so existing grants can be read and revoked; nothing in this contract accepts it now.
///
///      **One accepted token (audit M-5).** CLRUSD is fungible and every accepted token used to
///      redeem 1:1 for every other, so accepting a second stablecoin let anyone swap a depegged one
///      for the vault's USDC. The vault now accepts exactly one token at a time.
contract ESADepositVault is Initializable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable, EIP712Upgradeable, IESADepositVault {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice Legacy role. No function accepts it since the H-3 fix; kept so grants made under it
    ///         can still be inspected and revoked after the upgrade.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice The gasless relayer: submits member-signed deposits, redeems and autopay runs, and
    ///         nothing else. A role constant is not storage, so adding it is layout-safe.
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 private constant REDEEM_TYPEHASH =
        keccak256("Redeem(address redeemer,address token,uint256 clrusdAmount,address receiver,uint256 nonce,uint256 deadline)");
    /// @dev Audit M-5: the depositor names who receives the CLRUSD. Bound to the EIP-3009 nonce of
    ///      the USDC authorization it travels with, so it is single-use (USDC burns the nonce) and
    ///      cannot be paired with any other authorization.
    bytes32 private constant DEPOSIT_INTENT_TYPEHASH =
        keccak256("DepositIntent(address depositor,address token,uint256 amount,address receiver,bytes32 authNonce)");
    /// @dev Autopay: a depositor signs ONE mandate authorizing recurring deposits of a fixed amount on
    ///      a fixed cadence; a RELAYER executes each due run gaslessly. USDC is pulled via a
    ///      standing allowance the user grants once with EIP-2612 `permit` (also gasless).
    bytes32 private constant DEPOSIT_MANDATE_TYPEHASH = keccak256(
        "DepositMandate(address depositor,address token,uint256 amountPerRun,uint64 interval,uint32 maxRuns,uint256 startAt,uint256 expiry,uint256 nonce)"
    );

    address public override clrusd;
    uint8 private clrusdDecimals;

    /// @dev Legacy allowlist. Still written for observability, no longer authoritative: an upgraded
    ///      proxy may hold `true` here for tokens accepted before the single-token rule, and those
    ///      must not keep redeeming against the vault's USDC. Only `s_acceptedToken` counts.
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

    /// @notice The EIP-3009 parameters of a USDC `receiveWithAuthorization`, grouped to keep the
    ///         signed-deposit entry points readable.
    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    event ClrusdUpdated(address indexed clrusd);

    error ESADepositVaultInvalidAddress();
    /// @notice thrown when re-pointing the vault while the old token is still held by somebody.
    error ESADepositVaultTokenStillOutstanding(uint256 outstanding);
    error ESADepositVaultInvalidAmount();
    error ESADepositVaultTokenNotAccepted();
    error ESADepositVaultNonExactAmount();
    error ESADepositVaultInsufficientLiquidity();
    error ESADepositVaultMandateInvalid();
    /// @notice thrown when a gasless deposit names a receiver the depositor did not sign for.
    error ESADepositVaultReceiverNotAuthorized();
    /// @notice thrown when a gasless redeem's signature does not come from the redeemer.
    error ESADepositVaultBadSignature();
    /// @notice thrown when accepting a token while a different one is already accepted.
    error ESADepositVaultOneTokenOnly(address accepted);

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
        _grantRole(RELAYER_ROLE, admin);
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
    /// @notice Gasless deposit whose CLRUSD goes to the depositor.
    /// @dev The USDC authorization covers who pays, how much and to which contract, but not who
    ///      receives the CLRUSD, so the relayer used to choose (audit M-5). Here the receiver must be
    ///      the depositor, the one address the depositor's own signature already names. To deposit
    ///      for somebody else, use `depositWithAuthorizationFor` with a signed `DepositIntent`.
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
    ) external whenNotPaused onlyRole(RELAYER_ROLE) returns (uint256 minted) {
        if (depositor == address(0)) revert ESADepositVaultInvalidAddress();
        if (receiver != depositor) revert ESADepositVaultReceiverNotAuthorized();
        minted = _depositWithAuthorization(
            depositor, token, amount, receiver, Authorization(validAfter, validBefore, authNonce, v, r, s)
        );
    }

    /// @notice Gasless deposit to a receiver the depositor named in a signed `DepositIntent`.
    /// @dev The intent is checked with `SignatureChecker`, so a smart-contract wallet can sign it,
    ///      and it names the EIP-3009 nonce of the authorization it travels with: USDC burns that
    ///      nonce on use, so the intent cannot be replayed or paired with another authorization.
    /// @param intentSignature the depositor's signature over `hashDepositIntent(...)`.
    function depositWithAuthorizationFor(
        address depositor,
        address token,
        uint256 amount,
        address receiver,
        Authorization calldata auth,
        bytes calldata intentSignature
    ) external whenNotPaused onlyRole(RELAYER_ROLE) returns (uint256 minted) {
        if (depositor == address(0)) revert ESADepositVaultInvalidAddress();
        bytes32 digest = hashDepositIntent(depositor, token, amount, receiver, auth.nonce);
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(depositor, digest, intentSignature)) {
            revert ESADepositVaultReceiverNotAuthorized();
        }
        minted = _depositWithAuthorization(depositor, token, amount, receiver, auth);
    }

    /// @notice EIP-712 digest of a deposit intent, for wallets and the relayer.
    function hashDepositIntent(address depositor, address token, uint256 amount, address receiver, bytes32 authNonce)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(DEPOSIT_INTENT_TYPEHASH, depositor, token, amount, receiver, authNonce))
        );
    }

    function _depositWithAuthorization(
        address depositor,
        address token,
        uint256 amount,
        address receiver,
        Authorization memory auth
    ) internal returns (uint256 minted) {
        minted = _validateDeposit(token, amount, receiver);
        IERC3009(token).receiveWithAuthorization(
            depositor, address(this), amount, auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s
        );
        IClearUSDMintBurn(clrusd).mint(receiver, minted);
        emit Deposited(depositor, receiver, token, amount, minted);
    }

    function _validateDeposit(address token, uint256 amount, address receiver) internal view returns (uint256 minted) {
        if (receiver == address(0) || token == address(0)) revert ESADepositVaultInvalidAddress();
        if (!_isAccepted(token)) revert ESADepositVaultTokenNotAccepted();
        if (amount == 0) revert ESADepositVaultInvalidAmount();
        minted = _convertToClrUsd(token, amount);
        if (minted == 0) revert ESADepositVaultInvalidAmount();
        if (_convertFromClrUsd(token, minted) != amount) revert ESADepositVaultNonExactAmount();
    }

    // ── Redeem (sender-signed; sender pays gas) ────────────────────────────────
    function redeem(address token, uint256 clrusdAmount, address receiver) external override whenNotPaused returns (uint256 returnedAmount) {
        returnedAmount = _executeRedeem(msg.sender, token, clrusdAmount, receiver);
    }

    // ── Redeem (gasless; redeemer signed an EIP-712 intent, RELAYER_ROLE relayer submits) ──
    // Requires a one-time CLRUSD approve(vault) from the redeemer (standing allowance for burnFrom);
    // each redeem is bounded by the signed intent (amount + receiver + nonce + deadline).
    /// @dev Checked with `SignatureChecker` (audit M-5), so an EIP-1271 wallet that accepts a 65-byte
    ///      signature can use this path too. Wallets that need a longer one use `redeemWithSignature`.
    function redeemWithAuthorization(
        address redeemer,
        address token,
        uint256 clrusdAmount,
        address receiver,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused onlyRole(RELAYER_ROLE) returns (uint256 returnedAmount) {
        returnedAmount =
            _redeemWithSignature(redeemer, token, clrusdAmount, receiver, deadline, abi.encodePacked(r, s, v));
    }

    /// @notice Gasless redeem with a signature of any length (EOA or EIP-1271 wallet).
    function redeemWithSignature(
        address redeemer,
        address token,
        uint256 clrusdAmount,
        address receiver,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused onlyRole(RELAYER_ROLE) returns (uint256 returnedAmount) {
        returnedAmount = _redeemWithSignature(redeemer, token, clrusdAmount, receiver, deadline, signature);
    }

    function _redeemWithSignature(
        address redeemer,
        address token,
        uint256 clrusdAmount,
        address receiver,
        uint256 deadline,
        bytes memory signature
    ) internal returns (uint256 returnedAmount) {
        require(block.timestamp <= deadline, "ESADepositVault: intent expired");
        if (redeemer == address(0)) revert ESADepositVaultBadSignature();
        uint256 nonce = redeemNonces[redeemer]++;
        bytes32 structHash = keccak256(abi.encode(REDEEM_TYPEHASH, redeemer, token, clrusdAmount, receiver, nonce, deadline));
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(redeemer, _hashTypedDataV4(structHash), signature)) {
            revert ESADepositVaultBadSignature();
        }
        returnedAmount = _executeRedeem(redeemer, token, clrusdAmount, receiver);
    }

    function _executeRedeem(address redeemer, address token, uint256 clrusdAmount, address receiver) internal returns (uint256 returnedAmount) {
        if (receiver == address(0) || token == address(0)) revert ESADepositVaultInvalidAddress();
        if (!_isAccepted(token)) revert ESADepositVaultTokenNotAccepted();
        if (clrusdAmount == 0) revert ESADepositVaultInvalidAmount();

        returnedAmount = _convertFromClrUsd(token, clrusdAmount);
        if (returnedAmount == 0) revert ESADepositVaultInvalidAmount();
        if (_convertToClrUsd(token, returnedAmount) != clrusdAmount) revert ESADepositVaultNonExactAmount();
        if (IERC20Upgradeable(token).balanceOf(address(this)) < returnedAmount) revert ESADepositVaultInsufficientLiquidity();

        IClearUSDMintBurn(clrusd).burnFrom(redeemer, clrusdAmount);
        IERC20Upgradeable(token).safeTransfer(receiver, returnedAmount);
        emit Redeemed(redeemer, receiver, token, clrusdAmount, returnedAmount);
    }

    // ── Autopay (recurring deposit mandate; depositor signed once, RELAYER executes each run) ──
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
        bytes calldata signature
    ) external whenNotPaused onlyRole(RELAYER_ROLE) returns (uint256 minted) {
        bytes32 digest = _mandateDigest(depositor, token, amountPerRun, interval, maxRuns, startAt, expiry, nonce);
        // Accepts an ECDSA signature (EOA) OR an EIP-1271 signature (smart-contract wallet, e.g. AppKit
        // email/social), so autopay works for both account types.
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(depositor, digest, signature)) revert ESADepositVaultMandateInvalid();
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

    /// @notice Stop a mandate. RELAYER-gated (the relayer cancels on the user's authenticated
    ///         request). The depositor can also cancel directly with `cancelOwnMandate`, or fully
    ///         revoke by removing the USDC allowance.
    function cancelMandate(bytes32 digest) external onlyRole(RELAYER_ROLE) {
        depositMandates[digest].cancelled = true;
        emit MandateCancelled(digest);
    }

    /// @notice The depositor stops their own mandate (audit H-3).
    /// @dev The digest is recomputed with `msg.sender` as the depositor, so nobody can cancel a
    ///      mandate that is not theirs: a bare digest would let anyone cancel anyone's autopay.
    function cancelOwnMandate(
        address token,
        uint256 amountPerRun,
        uint64 interval,
        uint32 maxRuns,
        uint256 startAt,
        uint256 expiry,
        uint256 nonce
    ) external returns (bytes32 digest) {
        digest = _mandateDigest(msg.sender, token, amountPerRun, interval, maxRuns, startAt, expiry, nonce);
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

    /// @notice re-points the vault at a new CLRUSD.
    /// @dev Needed because the deployed CLRUSD cannot be upgraded, so giving it the redemption
    /// lock means replacing the token rather than changing it (audit M-7; the live Base vault
    /// predates this function, so it arrives with this upgrade).
    ///
    /// Only while none of the old token is outstanding. The vault's whole claim is that every
    /// CLRUSD is backed one-for-one by USDC it holds, and swapping the token underneath live
    /// supply would strand those holders against a vault that no longer recognises what they are
    /// holding. Redeem first, then re-point: the guard makes the order the only one available
    /// rather than the one somebody remembered.
    /// @param clrusd_ address of the replacement token.
    function setClrusd(address clrusd_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (clrusd_ == address(0)) revert ESADepositVaultInvalidAddress();
        uint256 outstanding = IERC20MetadataUpgradeable(clrusd).totalSupply();
        if (outstanding != 0) revert ESADepositVaultTokenStillOutstanding(outstanding);
        clrusd = clrusd_;
        // The decimals are cached beside the address and every conversion reads the cache, so a
        // swap that moved one without the other would silently misprice every deposit and every
        // redemption from that moment on.
        clrusdDecimals = IERC20MetadataUpgradeable(clrusd_).decimals();
        emit ClrusdUpdated(clrusd_);
    }

    /// @notice Sets the one token the vault accepts, or stops accepting it.
    /// @dev Admin only (audit H-3): what counts as backing is a settings change for the Safe, not
    ///      something the relayer key can do. At most one token at a time (audit M-5): CLRUSD
    ///      redeems for any accepted token at par, so a second accepted token is a swap facility
    ///      for whichever of the two is worth less. To change token, stop accepting the current one
    ///      first, deliberately and visibly.
    function setAcceptedToken(address token, bool accepted) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ESADepositVaultInvalidAddress();
        address current = s_acceptedToken;
        if (accepted) {
            if (current != address(0) && current != token) revert ESADepositVaultOneTokenOnly(current);
            s_acceptedToken = token;
        } else if (current == token) {
            s_acceptedToken = address(0);
        }
        s_isAcceptedToken[token] = accepted;
        emit AcceptedTokenUpdated(token, accepted);
    }

    function isAcceptedToken(address token) external view override returns (bool) {
        return _isAccepted(token);
    }

    /// @notice The one token the vault currently accepts, or zero.
    function acceptedToken() external view returns (address) {
        return s_acceptedToken;
    }

    function _isAccepted(address token) internal view returns (bool) {
        return token != address(0) && token == s_acceptedToken;
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

    /// @notice The one accepted token (audit M-5). Appended after `depositMandates`. On an upgraded
    ///         proxy it starts at zero, so the upgrade must be paired with
    ///         `setAcceptedToken(USDC, true)` (scripts/migrate_vault_clrusd.ts does both).
    address private s_acceptedToken;

    /// @dev Reserved storage for future upgrades. Reduced by 1 (depositMandates mapping added),
    ///      then by 1 more (s_acceptedToken added).
    uint256[42] private __gap;
}
