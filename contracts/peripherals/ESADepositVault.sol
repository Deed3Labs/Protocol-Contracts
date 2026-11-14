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
///
///      **Who controls it (Phase 2d, 10g, decisions 1 and 2).** Every power here is Clear Financial
///      Co.'s, under two-person control, in one of two shapes:
///       - `DEFAULT_ADMIN_ROLE` (upgrades, settings, the pilot off switch, granting every role) is
///         held only by the vault timelock (`deploy/vault_timelock_handover.ts`): 7 days, with a
///         Clear Financial Safe as proposer, so each call is a Safe transaction plus the delay;
///       - the pauses (`PAUSER_ROLE`) and the CA mint pause (`PILOT_ROLE`) take two distinct
///         holders of the role, in contract: the first call records the exact calldata, the second
///         from a different holder carries it out (`_secondSigner`).
///      `RELAYER_ROLE` stays a single hot key (decision 2): it only submits what a member signed.
///
///      **Reserve custody (10g).** The reserve is the accepted token held by this contract; there is
///      no separate reserve address. It leaves in exactly one place, `_executeRedeem`, which burns
///      the redeemer's CLRUSD one-for-one and pays the redeemer, or a receiver the redeemer named in
///      a signed `Redeem` (the relayer submits it and cannot change it). The Liquidator reaches the reserve the same way, as the holder of the CLRUSD it
///      seized under 10b, and settles the debt with what it receives. There is no sweep, rescue or
///      admin withdrawal, and none of the admin setters moves a token. The vault earns nothing on the
///      reserve: it lends, stakes and approves nothing. Rewards on USDC, if Clear Financial ever
///      receives any, are paid off chain to a Clear address, never into this contract.
contract ESADepositVault is Initializable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable, EIP712Upgradeable, IESADepositVault {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice Legacy role. No function accepts it since the H-3 fix; kept so grants made under it
    ///         can still be inspected and revoked after the upgrade.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice The gasless relayer: submits member-signed deposits, redeems and autopay runs, and
    ///         nothing else. A role constant is not storage, so adding it is layout-safe.
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice May set and clear the CA mint pause (spec 11's manual backstop), two holders at a time.
    bytes32 public constant PILOT_ROLE = keccak256("PILOT_ROLE");
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
    error ESADepositVaultNotPaused();
    /// @notice the two-person rule: the same signer cannot be both halves of an action, nor renew
    /// or restart their own pause.
    error ESADepositVaultSameSigner();
    /// @notice thrown when a pause window above 72 hours is set (spec 10c; Phase 4, M-A).
    error ESADepositVaultPauseWindowTooLong(uint64 window);
    /// @notice thrown for a CA mint while the CA mint pause is on (spec 11's manual backstop).
    error ESADepositVaultCaMintsPaused(uint32 reason);
    /// @notice thrown for a mint to a receiver with no attested state (DECISIONS #6; Phase 4, L-E).
    error ESADepositVaultStateNotAttested(address receiver);
    /// @notice thrown when setting the CA mint pause after governance switched the pilot off.
    error ESADepositVaultPilotOff();

    event StateSourceUpdated(address indexed source);
    event PauseExpiresAt(uint64 until, address indexed signer);
    /// @notice the first half of a two-person action: `action` is the hash of its calldata.
    event ActionProposed(bytes32 indexed action, address indexed proposer, bytes4 selector);
    /// @notice the second half, by a different holder of the role; the action ran.
    event ActionApproved(bytes32 indexed action, address indexed proposer, address indexed approver);
    /// @notice the CA mint pause was set (`paused`) or cleared, by two signers, with a reason code.
    event CaMintsPauseSet(bool paused, uint32 reason, address indexed proposer, address indexed approver);
    /// @notice governance switched the whole pilot item off (or back on).
    event PilotSwitched(bool off);
    event PauseWindowUpdated(uint64 window);
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
    /// @notice thrown when a plain `redeem` names a receiver other than the caller (Phase 2d).
    error ESADepositVaultReceiverNotRedeemer(address receiver);
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
        _mintChecked(msg.sender, receiver, minted);
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
        _mintChecked(depositor, receiver, minted);
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
    /// @notice Redeems the caller's own CLRUSD, paying the caller.
    /// @dev Phase 2d (owner's decision on 10g): a redemption pays someone other than the holder
    /// only on the holder's signature naming that receiver (`redeemWithSignature` and
    /// `redeemWithAuthorization`, where the signed `Redeem` carries the receiver), as with MB-05
    /// §7.9. A bare call -- which a session key or module on a smart account could make -- cannot
    /// send the reserve anywhere but back to the holder. `receiver` stays in the signature for the
    /// interface, and must be the caller.
    function redeem(address token, uint256 clrusdAmount, address receiver) external override whenNotPaused returns (uint256 returnedAmount) {
        if (receiver != msg.sender) revert ESADepositVaultReceiverNotRedeemer(receiver);
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

        // The only way reserve leaves the vault (10g): the redeemer's CLRUSD is burned one-for-one
        // first, and nothing in the pilot -- the CA mint pause, the attestation -- can refuse it.
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
        _mintChecked(depositor, depositor, minted);
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

    /// @notice pauses deposits and redemptions during a security incident.
    /// @dev Compliance spec 10c: a pause that blocks redemption is a power to block a member's
    /// CLRUSD transaction, so it is limited the same way the token's pauses are -- it lapses on its
    /// own after the window (72 hours by default) unless a different signer renews it.
    ///
    /// Two-person (Phase 2d, decision 2): one pauser's call proposes, a second pauser's identical
    /// call carries it out. The same applies to `renewPause` and `unpause`.
    function pause() external onlyRole(PAUSER_ROLE) {
        if (_secondSigner(PAUSER_ROLE) == address(0)) return;
        // An active pause is extended only by a second signer's renewal; and the signer of the
        // last pause may not start another on their own until 30 days after it ended, so one key
        // cannot chain pauses -- by re-pausing at the lapse, or unpausing and pausing again --
        // into an indefinite freeze (Phase 4, M-A). Any other pauser may act at once.
        if (paused()) revert ESADepositVaultSameSigner();
        if (msg.sender == s_pauseSigner && block.timestamp < uint256(s_pausedUntil) + 30 days) {
            revert ESADepositVaultSameSigner();
        }
        _pause();
        s_pausedUntil = uint64(block.timestamp) + _pauseWindow();
        s_pauseSigner = msg.sender;
        emit PauseExpiresAt(s_pausedUntil, msg.sender);
    }

    /// @notice renews a pause for another window; needs a different signer from the last one.
    function renewPause() external onlyRole(PAUSER_ROLE) {
        if (_secondSigner(PAUSER_ROLE) == address(0)) return;
        if (!paused()) revert ESADepositVaultNotPaused();
        if (msg.sender == s_pauseSigner) revert ESADepositVaultSameSigner();
        s_pausedUntil = uint64(block.timestamp) + _pauseWindow();
        s_pauseSigner = msg.sender;
        emit PauseExpiresAt(s_pausedUntil, msg.sender);
    }

    /// @dev Ends the pause now and keeps when it ended and who set it, so unpausing is not a way
    /// to restart the clock (Phase 4, M-A).
    function unpause() external onlyRole(PAUSER_ROLE) {
        if (_secondSigner(PAUSER_ROLE) == address(0)) return;
        if (super.paused()) _unpause();
        if (s_pausedUntil > block.timestamp) s_pausedUntil = uint64(block.timestamp);
    }

    /// @notice paused only until the window lapses (spec 10c). A pause set before this rule
    /// existed (no expiry recorded) counts as lapsed.
    function paused() public view virtual override returns (bool) {
        return super.paused() && block.timestamp < s_pausedUntil;
    }

    /// @notice how long a pause lasts before it lapses. Governed (admin is the timelock).
    /// At most 72 hours (spec 10c); zero means the default.
    function setPauseWindow(uint64 window) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (window > 72 hours) revert ESADepositVaultPauseWindowTooLong(window);
        s_pauseWindow = window;
        emit PauseWindowUpdated(window);
    }

    function _pauseWindow() internal view returns (uint64) {
        return s_pauseWindow == 0 ? 72 hours : s_pauseWindow;
    }

    /* ── Pilot (compliance spec item 11, as decided 2026-11-14: decision 7) ──
     *
     * The pilot measure is tracked OFF chain, from this contract's `Deposited` and `Redeemed`
     * events, CLRUSD's `Transfer` events and NetworkRegistry's state attestations. On chain there
     * is no counter and nothing reverts at a cap; there are only:
     *  - the CA mint pause, a manual backstop that two PILOT_ROLE holders set and clear with a
     *    reason code. It is never set automatically, blocks only new CA mints, and never touches
     *    a redemption or a non-CA mint;
     *  - a state attestation before any mint (DECISIONS #6's mitigation; Phase 4, L-E);
     *  - governance's off switch for the whole item, for when a DFAL licence or other cover is in
     *    place.
     *
     * Which mints are CA (Phase 4, L-E, counting by depositor and receiver): the receiver's
     * attested state is CA, or the depositor's is. A member with no stateCode counts as CA
     * (spec 11, superseding DECISIONS #6's "unknown counts as WY"). With an attestation required
     * before every mint, that default applies on chain only while no state source is named, and
     * then every mint counts as CA. A depositor with no stateCode -- a contract such as a
     * SavingsIntentEscrow, or a wallet paying in for a member -- is counted by its receiver. */

    /// @notice the CA mint pause, two-person: the first PILOT_ROLE holder's call proposes and a
    /// second holder's identical call sets it. Never set automatically (spec 11).
    /// @param reason an off-chain reason code, logged.
    function pauseCaMints(uint32 reason) external onlyRole(PILOT_ROLE) {
        if (s_pilotOff) revert ESADepositVaultPilotOff();
        address proposer = _secondSigner(PILOT_ROLE);
        if (proposer == address(0)) return;
        s_caMintsPaused = true;
        s_caPauseReason = reason;
        emit CaMintsPauseSet(true, reason, proposer, msg.sender);
    }

    /// @notice clears the CA mint pause; also two-person, with a reason code.
    function unpauseCaMints(uint32 reason) external onlyRole(PILOT_ROLE) {
        address proposer = _secondSigner(PILOT_ROLE);
        if (proposer == address(0)) return;
        s_caMintsPaused = false;
        s_caPauseReason = reason;
        emit CaMintsPauseSet(false, reason, proposer, msg.sender);
    }

    /// @notice whether new CA mints are paused now, and the reason code last given.
    function caMintsPaused() external view returns (bool paused_, uint32 reason) {
        return (s_caMintsPaused && !s_pilotOff, s_caPauseReason);
    }

    /// @notice governance's switch for the whole pilot item (spec 11). Off, the CA mint pause has no
    /// effect and cannot be set, and no attestation is required before a mint.
    function setPilotOff(bool off) external onlyRole(DEFAULT_ADMIN_ROLE) {
        s_pilotOff = off;
        emit PilotSwitched(off);
    }

    function pilotOff() external view returns (bool) {
        return s_pilotOff;
    }

    /// @notice names where members' attested states are read (the NetworkRegistry).
    function setStateSource(address source) external onlyRole(DEFAULT_ADMIN_ROLE) {
        s_stateSource = source;
        emit StateSourceUpdated(source);
    }

    function stateSource() external view returns (address) {
        return s_stateSource;
    }

    /// @dev Every mint passes here: the pilot's checks, then the Boost deposit record, then the mint.
    function _mintChecked(address depositor, address receiver, uint256 minted) internal {
        if (!s_pilotOff) {
            bytes32 receiverState = _stateOf(receiver);
            if (receiverState == bytes32(0) && s_stateSource != address(0)) {
                revert ESADepositVaultStateNotAttested(receiver);
            }
            if (s_caMintsPaused && (receiverState == bytes32(0) || receiverState == "CA" || _stateOf(depositor) == "CA")) {
                revert ESADepositVaultCaMintsPaused(s_caPauseReason);
            }
        }
        s_lastDepositAt[receiver] = uint64(block.timestamp);
        IClearUSDMintBurn(clrusd).mint(receiver, minted);
    }

    /// @notice when a member last received CLRUSD for a deposit (section 12.4: the Boost cap counts
    /// cycles with an ESA deposit). Zero if never. Holds no amount and no member data beyond that.
    function lastDepositAt(address member) external view returns (uint256) {
        return s_lastDepositAt[member];
    }

    /// @dev A member's attested state, or zero when none is attested, no source is named or the
    /// source cannot answer.
    function _stateOf(address member) internal view returns (bytes32) {
        if (s_stateSource == address(0)) return bytes32(0);
        (bool ok, bytes memory data) = s_stateSource.staticcall(abi.encodeWithSignature("stateCodeOf(address)", member));
        if (!ok || data.length < 32) return bytes32(0);
        return abi.decode(data, (bytes32));
    }

    /// @dev Two-person control in contract (Phase 2d, decision 2). The first holder of `role` to
    /// make a call records its exact calldata and gets zero back, and the call does nothing more.
    /// A different holder making the identical call gets back the proposer, and the call proceeds.
    /// The same holder twice reverts; a proposer who has since lost the role no longer counts.
    function _secondSigner(bytes32 role) internal returns (address proposer) {
        bytes32 action = keccak256(msg.data);
        proposer = s_proposerOf[action];
        if (proposer == msg.sender) revert ESADepositVaultSameSigner();
        if (proposer == address(0) || !hasRole(role, proposer)) {
            s_proposerOf[action] = msg.sender;
            emit ActionProposed(action, msg.sender, msg.sig);
            return address(0);
        }
        delete s_proposerOf[action];
        emit ActionApproved(action, proposer, msg.sender);
    }

    /// @notice who proposed a pending two-person action, by the hash of its calldata.
    function proposerOf(bytes32 action) external view returns (address) {
        return s_proposerOf[action];
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

    /* ── Compliance spec 10c and 11, appended after s_acceptedToken ── */
    address private s_stateSource;
    /// @dev Retired by Phase 2d (decision 7: the pilot measure is off chain). Never read or
    /// written; kept so nothing after them moves. The same holds for the next five.
    uint256 private s_pilotCap;
    uint256 private s_pilotAlert;
    mapping(uint256 => uint256) private s_caVolumeByDay;
    uint256 private s_caWindowTotal;
    uint256 private s_caWindowFrom;
    bool private s_pilotCapOn;
    uint64 private s_pausedUntil;
    address private s_pauseSigner;
    uint64 private s_pauseWindow;
    /// @dev Section 12.4: when each member last received a deposit mint, for the Boost deposit test.
    mapping(address => uint64) private s_lastDepositAt;

    /* ── Phase 2d, appended after s_lastDepositAt ── */
    /// @dev The first signer of each pending two-person action, by the hash of its calldata.
    mapping(bytes32 => address) private s_proposerOf;
    /// @dev Spec 11: governance's off switch for the pilot item, the CA mint pause and the reason
    /// code last given for it. One slot.
    bool private s_pilotOff;
    bool private s_caMintsPaused;
    uint32 private s_caPauseReason;

    /// @dev Reserved storage for future upgrades. Reduced by 1 (depositMandates mapping added),
    ///      then by 1 more (s_acceptedToken added), then by 8 more for the Phase 2 block (the last
    ///      four share one slot), then by 1 for s_lastDepositAt, then by 2 for Phase 2d.
    uint256[31] private __gap;
}
