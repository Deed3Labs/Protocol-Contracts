// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ClaimEscrow
 * @notice Holds USDC transfers for claim-by-link flows until settlement or expiry refund.
 */
contract ClaimEscrow is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    IERC20 public immutable USDC;
    address public immutable PAYOUT_TREASURY;

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

    event TransferClaimedWallet(
        bytes32 indexed transferId,
        address indexed recipientWallet,
        uint256 principalUsdc,
        uint256 sponsorFeeUsdc
    );

    event TransferClaimedTreasury(
        bytes32 indexed transferId,
        address indexed payoutTreasury,
        uint256 totalLockedUsdc
    );

    event TransferRefunded(
        bytes32 indexed transferId,
        address indexed sender,
        uint256 totalLockedUsdc
    );

    constructor(address usdc, address payoutTreasury, address admin) {
        require(usdc != address(0), "ClaimEscrow: invalid USDC");
        require(payoutTreasury != address(0), "ClaimEscrow: invalid treasury");
        require(admin != address(0), "ClaimEscrow: invalid admin");

        USDC = IERC20(usdc);
        PAYOUT_TREASURY = payoutTreasury;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);
    }

    function createTransfer(
        bytes32 transferId,
        uint256 principalUsdc,
        uint256 sponsorFeeUsdc,
        uint64 expiry,
        bytes32 recipientHintHash
    ) external {
        require(transferId != bytes32(0), "ClaimEscrow: invalid transferId");
        require(transfers[transferId].sender == address(0), "ClaimEscrow: transfer exists");
        require(principalUsdc > 0, "ClaimEscrow: principal required");
        require(expiry > block.timestamp, "ClaimEscrow: invalid expiry");

        uint256 total = principalUsdc + sponsorFeeUsdc;

        transfers[transferId] = TransferRecord({
            sender: msg.sender,
            principalUsdc: principalUsdc,
            sponsorFeeUsdc: sponsorFeeUsdc,
            totalLockedUsdc: total,
            expiry: expiry,
            recipientHintHash: recipientHintHash,
            claimed: false,
            refunded: false
        });

        USDC.safeTransferFrom(msg.sender, address(this), total);

        emit TransferCreated(
            transferId,
            msg.sender,
            principalUsdc,
            sponsorFeeUsdc,
            total,
            expiry,
            recipientHintHash
        );
    }

    function claimToWallet(bytes32 transferId, address recipientWallet) external onlyRole(SETTLER_ROLE) {
        require(recipientWallet != address(0), "ClaimEscrow: invalid recipient");

        TransferRecord storage record = transfers[transferId];
        require(record.sender != address(0), "ClaimEscrow: transfer missing");
        require(!record.claimed, "ClaimEscrow: already claimed");
        require(!record.refunded, "ClaimEscrow: already refunded");

        record.claimed = true;

        if (record.principalUsdc > 0) {
            USDC.safeTransfer(recipientWallet, record.principalUsdc);
        }
        if (record.sponsorFeeUsdc > 0) {
            USDC.safeTransfer(PAYOUT_TREASURY, record.sponsorFeeUsdc);
        }

        emit TransferClaimedWallet(
            transferId,
            recipientWallet,
            record.principalUsdc,
            record.sponsorFeeUsdc
        );
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
}
