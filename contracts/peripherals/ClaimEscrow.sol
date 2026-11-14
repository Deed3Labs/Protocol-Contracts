// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";

/// @dev EIP-3009 (Circle USDC) gasless authorized pull — sender signs off-chain, relayer submits.
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

/**
 * @title ClaimEscrow
 * @notice Holds USDC transfers for claim-by-link flows until settlement or expiry refund.
 * @dev UUPS-upgradeable. `createTransfer` is the sender-signed path (sender pays gas);
 *      `createTransferWithAuthorization` is the gasless path (sender signs an EIP-3009 authorization,
 *      a SETTLER_ROLE relayer submits + pays gas).
 *
 *      **Who decides the recipient (audit H-4).** `claimToWallet` used to let the SETTLER_ROLE key,
 *      which lives on the API server, send any open escrow to any wallet. A claim to a wallet now
 *      needs an EIP-712 `Claim(transferId, recipientWallet)` signature from the transfer's claim
 *      authority: the claim key the sender committed to at creation (normally an ephemeral key
 *      carried in the claim link, so the server never needs it), or, for a transfer created
 *      without one, the sender.
 *
 *      **Card and bank payouts (Phase 2d, L-D; kept by the owner's decision 5).** A claim paid out
 *      to a card or bank goes to `PAYOUT_TREASURY`, a fixed co-op address, which pays the claimant
 *      off chain. The settler used to choose that route on its own, so it could sweep any open
 *      escrow to the treasury. It now needs a `PayoutClaim(transferId, payoutTreasury,
 *      payoutRefHash)` signature from the claim key or the sender; `payoutRefHash` commits to the
 *      off-chain payout the signer chose, and is logged.
 *
 *      **No race with the refund.** Claims are allowed up to and including `expiry`, refunds only
 *      after it, so the two windows never overlap.
 *
 *      Storage: append-only (live on Base). `claimSignerOf` takes one slot from `__gap`. The
 *      EIP-712 domain is computed from constants rather than by inheriting EIP712Upgradeable,
 *      which would have inserted storage ahead of this contract's own variables.
 */
contract ClaimEscrow is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("ClaimEscrow");
    bytes32 private constant VERSION_HASH = keccak256("1");
    /// @dev The claim authority's consent to one recipient wallet for one transfer.
    bytes32 private constant CLAIM_TYPEHASH = keccak256("Claim(bytes32 transferId,address recipientWallet)");
    /// @dev The claim key's or the sender's consent to a card or bank payout through the treasury
    ///      (Phase 2d, L-D). `payoutRefHash` names the off-chain payout (a hash; no account data).
    bytes32 private constant PAYOUT_CLAIM_TYPEHASH =
        keccak256("PayoutClaim(bytes32 transferId,address payoutTreasury,bytes32 payoutRefHash)");
    /// @dev What a gasless sender commits to through the EIP-3009 nonce: the full transfer terms,
    ///      including the claim key, so the relayer cannot swap in a key of its own.
    bytes32 private constant TRANSFER_TERMS_TYPEHASH = keccak256(
        "TransferTerms(bytes32 transferId,uint256 principalUsdc,uint256 sponsorFeeUsdc,uint64 expiry,bytes32 recipientHintHash,address claimSigner)"
    );

    /// @notice The terms of a transfer created with a claim key.
    struct TransferTerms {
        bytes32 transferId;
        uint256 principalUsdc;
        uint256 sponsorFeeUsdc;
        uint64 expiry;
        bytes32 recipientHintHash;
        address claimSigner;
    }

    /// @notice The EIP-3009 parameters of a USDC `receiveWithAuthorization`.
    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    error ClaimEscrowSignatureRequired();
    error ClaimEscrowBadClaimSignature();
    error ClaimEscrowExpired(uint64 expiry);
    error ClaimEscrowTermsNotAuthorized();
    error ClaimEscrowInvalidClaimSigner();

    IERC20Upgradeable public USDC;
    address public PAYOUT_TREASURY;

    struct TransferRecord {
        address sender;
        uint256 principalUsdc;
        uint256 sponsorFeeUsdc;
        uint256 totalLockedUsdc;
        uint64 expiry;
        bytes32 recipientHintHash;
        bool claimed;
        bool refunded;
    }

    mapping(bytes32 => TransferRecord) public transfers;

    event TransferCreated(
        bytes32 indexed transferId,
        address indexed sender,
        uint256 principalUsdc,
        uint256 sponsorFeeUsdc,
        uint256 totalLockedUsdc,
        uint64 expiry,
        bytes32 recipientHintHash
    );
    event TransferClaimedWallet(bytes32 indexed transferId, address indexed recipientWallet, uint256 principalUsdc, uint256 sponsorFeeUsdc);
    event TransferClaimedTreasury(bytes32 indexed transferId, address indexed payoutTreasury, uint256 totalLockedUsdc);
    event TransferRefunded(bytes32 indexed transferId, address indexed sender, uint256 totalLockedUsdc);
    event ClaimSignerSet(bytes32 indexed transferId, address indexed claimSigner);
    /// @notice who consented to a treasury payout, and the off-chain payout they named.
    event PayoutClaimAuthorized(bytes32 indexed transferId, address indexed signer, bytes32 payoutRefHash);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address usdc, address payoutTreasury, address admin) external initializer {
        require(usdc != address(0), "ClaimEscrow: invalid USDC");
        require(payoutTreasury != address(0), "ClaimEscrow: invalid treasury");
        require(admin != address(0), "ClaimEscrow: invalid admin");

        __AccessControl_init();
        __UUPSUpgradeable_init();

        USDC = IERC20Upgradeable(usdc);
        PAYOUT_TREASURY = payoutTreasury;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ── Create (sender-signed; sender pays gas) ─────────────────────────────────
    function createTransfer(
        bytes32 transferId,
        uint256 principalUsdc,
        uint256 sponsorFeeUsdc,
        uint64 expiry,
        bytes32 recipientHintHash
    ) external {
        uint256 total = _record(msg.sender, transferId, principalUsdc, sponsorFeeUsdc, expiry, recipientHintHash);
        USDC.safeTransferFrom(msg.sender, address(this), total);
        emit TransferCreated(transferId, msg.sender, principalUsdc, sponsorFeeUsdc, total, expiry, recipientHintHash);
    }

    // ── Create (gasless; sender signed an EIP-3009 authorization, relayer submits) ──
    function createTransferWithAuthorization(
        address sender,
        bytes32 transferId,
        uint256 principalUsdc,
        uint256 sponsorFeeUsdc,
        uint64 expiry,
        bytes32 recipientHintHash,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authNonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRole(SETTLER_ROLE) {
        require(sender != address(0), "ClaimEscrow: invalid sender");
        uint256 total = _record(sender, transferId, principalUsdc, sponsorFeeUsdc, expiry, recipientHintHash);
        // Pulls exactly `total` from `sender` → this escrow; sig verified against `sender`, and only
        // this contract (the `to`) can submit it → can't be front-run or over-pulled.
        IERC3009(address(USDC)).receiveWithAuthorization(sender, address(this), total, validAfter, validBefore, authNonce, v, r, s);
        emit TransferCreated(transferId, sender, principalUsdc, sponsorFeeUsdc, total, expiry, recipientHintHash);
    }

    // ── Create with a claim key (audit H-4) ─────────────────────────────────────
    /// @notice Sender-paid transfer whose recipient will be chosen by whoever holds `claimSigner`'s
    ///         key (the claim link), not by the settler.
    function createTransferWithClaimKey(TransferTerms calldata terms) external {
        if (terms.claimSigner == address(0)) revert ClaimEscrowInvalidClaimSigner();
        uint256 total = _record(
            msg.sender, terms.transferId, terms.principalUsdc, terms.sponsorFeeUsdc, terms.expiry, terms.recipientHintHash
        );
        claimSignerOf[terms.transferId] = terms.claimSigner;
        USDC.safeTransferFrom(msg.sender, address(this), total);
        emit TransferCreated(
            terms.transferId, msg.sender, terms.principalUsdc, terms.sponsorFeeUsdc, total, terms.expiry, terms.recipientHintHash
        );
        emit ClaimSignerSet(terms.transferId, terms.claimSigner);
    }

    /// @notice Gasless transfer with a claim key. The EIP-3009 nonce must equal
    ///         `transferTermsHash(terms)`, so the sender's own USDC signature commits to every term,
    ///         the claim key included, and the relayer can change none of them.
    function createTransferWithAuthorizationAndClaimKey(
        address sender,
        TransferTerms calldata terms,
        Authorization calldata auth
    ) external onlyRole(SETTLER_ROLE) {
        require(sender != address(0), "ClaimEscrow: invalid sender");
        if (terms.claimSigner == address(0)) revert ClaimEscrowInvalidClaimSigner();
        if (auth.nonce != transferTermsHash(terms)) revert ClaimEscrowTermsNotAuthorized();
        uint256 total = _record(
            sender, terms.transferId, terms.principalUsdc, terms.sponsorFeeUsdc, terms.expiry, terms.recipientHintHash
        );
        claimSignerOf[terms.transferId] = terms.claimSigner;
        IERC3009(address(USDC)).receiveWithAuthorization(
            sender, address(this), total, auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s
        );
        emit TransferCreated(
            terms.transferId, sender, terms.principalUsdc, terms.sponsorFeeUsdc, total, terms.expiry, terms.recipientHintHash
        );
        emit ClaimSignerSet(terms.transferId, terms.claimSigner);
    }

    /// @notice The value a gasless sender uses as the EIP-3009 nonce to commit to `terms`.
    function transferTermsHash(TransferTerms calldata terms) public view returns (bytes32) {
        return _hashTypedData(
            keccak256(
                abi.encode(
                    TRANSFER_TERMS_TYPEHASH,
                    terms.transferId,
                    terms.principalUsdc,
                    terms.sponsorFeeUsdc,
                    terms.expiry,
                    terms.recipientHintHash,
                    terms.claimSigner
                )
            )
        );
    }

    function _record(
        address sender,
        bytes32 transferId,
        uint256 principalUsdc,
        uint256 sponsorFeeUsdc,
        uint64 expiry,
        bytes32 recipientHintHash
    ) internal returns (uint256 total) {
        require(transferId != bytes32(0), "ClaimEscrow: invalid transferId");
        require(transfers[transferId].sender == address(0), "ClaimEscrow: transfer exists");
        require(principalUsdc > 0, "ClaimEscrow: principal required");
        require(expiry > block.timestamp, "ClaimEscrow: invalid expiry");

        total = principalUsdc + sponsorFeeUsdc;
        transfers[transferId] = TransferRecord({
            sender: sender,
            principalUsdc: principalUsdc,
            sponsorFeeUsdc: sponsorFeeUsdc,
            totalLockedUsdc: total,
            expiry: expiry,
            recipientHintHash: recipientHintHash,
            claimed: false,
            refunded: false
        });
    }

    // ── Claims / refund ─────────────────────────────────────────────────────────
    /// @notice Retired (audit H-4): the settler alone can no longer choose the recipient wallet.
    /// @dev Kept so existing callers fail loudly instead of hitting an unknown selector. Use
    ///      `claimToWalletWithSignature`.
    function claimToWallet(bytes32, address) external view onlyRole(SETTLER_ROLE) {
        revert ClaimEscrowSignatureRequired();
    }

    /// @notice Releases a transfer to the wallet its claim authority signed for.
    /// @dev Permissionless: the signature, not the caller, decides where the money goes, so the
    ///      relayer may submit it and so may the recipient. Checked with `SignatureChecker`, so the
    ///      claim authority may be a smart-contract wallet.
    /// @param signature the claim authority's EIP-712 signature over `claimDigest(transferId, recipientWallet)`.
    function claimToWalletWithSignature(bytes32 transferId, address recipientWallet, bytes calldata signature) external {
        require(recipientWallet != address(0), "ClaimEscrow: invalid recipient");
        TransferRecord storage record = _claimable(transferId);
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(
            claimAuthorityOf(transferId), claimDigest(transferId, recipientWallet), signature
        )) revert ClaimEscrowBadClaimSignature();

        record.claimed = true;
        if (record.principalUsdc > 0) USDC.safeTransfer(recipientWallet, record.principalUsdc);
        if (record.sponsorFeeUsdc > 0) USDC.safeTransfer(PAYOUT_TREASURY, record.sponsorFeeUsdc);

        emit TransferClaimedWallet(transferId, recipientWallet, record.principalUsdc, record.sponsorFeeUsdc);
    }

    /// @notice Retired (Phase 2d, L-D): the settler alone can no longer route a claim to the treasury.
    /// @dev Kept so existing callers fail loudly instead of hitting an unknown selector. Use
    ///      `claimToPayoutTreasuryWithSignature`.
    function claimToPayoutTreasury(bytes32) external view onlyRole(SETTLER_ROLE) {
        revert ClaimEscrowSignatureRequired();
    }

    /// @notice Pays a transfer to `PAYOUT_TREASURY` for a card or bank payout the claimant chose.
    /// @dev Needs the claim key's signature or the sender's (L-D), over
    ///      `payoutClaimDigest(transferId, payoutRefHash)`. Either may sign: the claim key is the
    ///      recipient's, the sender may route their own unclaimed money. Checked with
    ///      `SignatureChecker`, so either may be a smart-contract wallet. Settler-submitted, since
    ///      the settler is who pays the claimant out of the treasury.
    /// @param payoutRefHash hash of the off-chain payout reference the signer chose.
    /// @param signature the claim key's or the sender's EIP-712 signature.
    function claimToPayoutTreasuryWithSignature(bytes32 transferId, bytes32 payoutRefHash, bytes calldata signature)
        external
        onlyRole(SETTLER_ROLE)
    {
        TransferRecord storage record = _claimable(transferId);
        bytes32 digest = payoutClaimDigest(transferId, payoutRefHash);
        address key = claimSignerOf[transferId];
        address signer;
        if (key != address(0) && SignatureCheckerUpgradeable.isValidSignatureNow(key, digest, signature)) {
            signer = key;
        } else if (SignatureCheckerUpgradeable.isValidSignatureNow(record.sender, digest, signature)) {
            signer = record.sender;
        } else {
            revert ClaimEscrowBadClaimSignature();
        }
        emit PayoutClaimAuthorized(transferId, signer, payoutRefHash);

        record.claimed = true;
        USDC.safeTransfer(PAYOUT_TREASURY, record.totalLockedUsdc);
        emit TransferClaimedTreasury(transferId, PAYOUT_TREASURY, record.totalLockedUsdc);
    }

    function refundExpired(bytes32 transferId) external {
        TransferRecord storage record = transfers[transferId];
        require(record.sender != address(0), "ClaimEscrow: transfer missing");
        require(!record.claimed, "ClaimEscrow: already claimed");
        require(!record.refunded, "ClaimEscrow: already refunded");
        require(block.timestamp > record.expiry, "ClaimEscrow: not expired");

        record.refunded = true;
        USDC.safeTransfer(record.sender, record.totalLockedUsdc);
        emit TransferRefunded(transferId, record.sender, record.totalLockedUsdc);
    }

    /// @notice Who may choose a transfer's recipient wallet: its committed claim key, or the sender
    ///         for a transfer created without one.
    function claimAuthorityOf(bytes32 transferId) public view returns (address) {
        address key = claimSignerOf[transferId];
        return key != address(0) ? key : transfers[transferId].sender;
    }

    /// @notice EIP-712 digest the claim authority signs to send a transfer to `recipientWallet`.
    function claimDigest(bytes32 transferId, address recipientWallet) public view returns (bytes32) {
        return _hashTypedData(keccak256(abi.encode(CLAIM_TYPEHASH, transferId, recipientWallet)));
    }

    /// @notice EIP-712 digest the claim key or the sender signs to pay a transfer out through the
    ///         treasury to the off-chain payout `payoutRefHash` names.
    function payoutClaimDigest(bytes32 transferId, bytes32 payoutRefHash) public view returns (bytes32) {
        return _hashTypedData(keccak256(abi.encode(PAYOUT_CLAIM_TYPEHASH, transferId, PAYOUT_TREASURY, payoutRefHash)));
    }

    /// @notice The EIP-712 domain separator, built from constants (see the contract notes).
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _hashTypedData(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @dev Open, and still inside its claim window. `expiry` itself is the last claimable second;
    ///      `refundExpired` starts the second after, so a claim and a refund can never both be valid.
    function _claimable(bytes32 transferId) private view returns (TransferRecord storage record) {
        record = transfers[transferId];
        require(record.sender != address(0), "ClaimEscrow: transfer missing");
        require(!record.claimed, "ClaimEscrow: already claimed");
        require(!record.refunded, "ClaimEscrow: already refunded");
        if (block.timestamp > record.expiry) revert ClaimEscrowExpired(record.expiry);
    }

    /// @notice The claim key a transfer was created with (audit H-4); zero means the sender signs.
    /// @dev Appended after `transfers`; takes one slot from `__gap`.
    mapping(bytes32 => address) public claimSignerOf;

    /// @dev Reserved storage for future upgrades. Reduced by 1 (claimSignerOf added).
    uint256[44] private __gap;

}
