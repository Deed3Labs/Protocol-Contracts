// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

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
 *      a SETTLER_ROLE relayer submits + pays gas). Recipient claims remain SETTLER_ROLE-gated.
 */
contract ClaimEscrow is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

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

    // ── Claims / refund (unchanged; SETTLER_ROLE-gated releases) ────────────────
    function claimToWallet(bytes32 transferId, address recipientWallet) external onlyRole(SETTLER_ROLE) {
        require(recipientWallet != address(0), "ClaimEscrow: invalid recipient");
        TransferRecord storage record = transfers[transferId];
        require(record.sender != address(0), "ClaimEscrow: transfer missing");
        require(!record.claimed, "ClaimEscrow: already claimed");
        require(!record.refunded, "ClaimEscrow: already refunded");

        record.claimed = true;
        if (record.principalUsdc > 0) USDC.safeTransfer(recipientWallet, record.principalUsdc);
        if (record.sponsorFeeUsdc > 0) USDC.safeTransfer(PAYOUT_TREASURY, record.sponsorFeeUsdc);

        emit TransferClaimedWallet(transferId, recipientWallet, record.principalUsdc, record.sponsorFeeUsdc);
    }

    function claimToPayoutTreasury(bytes32 transferId) external onlyRole(SETTLER_ROLE) {
        TransferRecord storage record = transfers[transferId];
        require(record.sender != address(0), "ClaimEscrow: transfer missing");
        require(!record.claimed, "ClaimEscrow: already claimed");
        require(!record.refunded, "ClaimEscrow: already refunded");

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

    /// @dev Reserved storage for future upgrades.
    uint256[45] private __gap;
}
