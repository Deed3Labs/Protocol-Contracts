// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../core/interfaces/stable-credit/IMembershipRegistry.sol";

/// @title MembershipRegistry
/// @notice Canonical onchain membership registry for non-PII member entitlements.
/// @dev Off-chain systems remain the source of truth for identity, verification, and personal data.
contract MembershipRegistry is
    AccessControlUpgradeable,
    PausableUpgradeable,
    IMembershipRegistry
{
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public nextMemberId;

    mapping(uint256 => MemberRecord) private memberRecords;
    mapping(address => uint256) public walletToMemberId;
    mapping(uint256 => mapping(address => bool)) public linkedWallets;
    mapping(uint256 => address[]) private memberWalletList;

    event MemberRegistered(
        uint256 indexed memberId,
        address indexed primaryWallet,
        MembershipTier tier,
        uint64 expiresAt,
        bytes32 metadataHash
    );
    event MemberStatusUpdated(uint256 indexed memberId, MembershipStatus status);
    event MembershipRenewed(uint256 indexed memberId, uint64 expiresAt);
    event WalletLinked(uint256 indexed memberId, address indexed wallet);
    event WalletUnlinked(uint256 indexed memberId, address indexed wallet);
    event MemberMetadataHashUpdated(uint256 indexed memberId, bytes32 metadataHash);

    function initialize(address admin) external initializer {
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        nextMemberId = 1;
    }

    function registerMember(
        address primaryWallet,
        MembershipTier tier,
        uint64 expiresAt,
        bytes32 metadataHash
    ) external whenNotPaused onlyRole(REGISTRAR_ROLE) returns (uint256 memberId) {
        require(primaryWallet != address(0), "MembershipRegistry: invalid wallet");
        require(walletToMemberId[primaryWallet] == 0, "MembershipRegistry: wallet already registered");
        require(tier != MembershipTier.NONE, "MembershipRegistry: invalid tier");
        require(_validExpiry(tier, expiresAt), "MembershipRegistry: invalid expiry");

        memberId = nextMemberId;
        nextMemberId += 1;

        uint64 nowTs = uint64(block.timestamp);
        memberRecords[memberId] = MemberRecord({
            memberId: memberId,
            primaryWallet: primaryWallet,
            status: MembershipStatus.ACTIVE,
            tier: tier,
            joinedAt: nowTs,
            expiresAt: expiresAt,
            metadataHash: metadataHash,
            updatedAt: nowTs
        });

        walletToMemberId[primaryWallet] = memberId;
        linkedWallets[memberId][primaryWallet] = true;
        memberWalletList[memberId].push(primaryWallet);

        emit MemberRegistered(memberId, primaryWallet, tier, expiresAt, metadataHash);
        emit WalletLinked(memberId, primaryWallet);
    }

    function setMemberStatus(uint256 memberId, MembershipStatus status)
        external
        whenNotPaused
        onlyRole(REGISTRAR_ROLE)
    {
        MemberRecord storage record = _memberRecord(memberId);
        record.status = status;
        record.updatedAt = uint64(block.timestamp);
        emit MemberStatusUpdated(memberId, status);
    }

    function renewMembership(uint256 memberId, uint64 newExpiresAt)
        external
        whenNotPaused
        onlyRole(REGISTRAR_ROLE)
    {
        MemberRecord storage record = _memberRecord(memberId);
        require(record.tier != MembershipTier.LIFETIME, "MembershipRegistry: lifetime tier has no expiry");
        require(newExpiresAt > block.timestamp, "MembershipRegistry: invalid renewal expiry");

        record.expiresAt = newExpiresAt;
        record.status = MembershipStatus.ACTIVE;
        record.updatedAt = uint64(block.timestamp);

        emit MembershipRenewed(memberId, newExpiresAt);
        emit MemberStatusUpdated(memberId, MembershipStatus.ACTIVE);
    }

    function updateMemberMetadataHash(uint256 memberId, bytes32 metadataHash)
        external
        whenNotPaused
        onlyRole(REGISTRAR_ROLE)
    {
        MemberRecord storage record = _memberRecord(memberId);
        record.metadataHash = metadataHash;
        record.updatedAt = uint64(block.timestamp);
        emit MemberMetadataHashUpdated(memberId, metadataHash);
    }

    function linkWallet(uint256 memberId, address wallet)
        external
        whenNotPaused
        onlyRole(REGISTRAR_ROLE)
    {
        require(wallet != address(0), "MembershipRegistry: invalid wallet");
        require(walletToMemberId[wallet] == 0, "MembershipRegistry: wallet already linked");

        MemberRecord storage record = _memberRecord(memberId);
        require(record.memberId != 0, "MembershipRegistry: member not found");

        walletToMemberId[wallet] = memberId;
        linkedWallets[memberId][wallet] = true;
        memberWalletList[memberId].push(wallet);
        record.updatedAt = uint64(block.timestamp);

        emit WalletLinked(memberId, wallet);
    }

    function unlinkWallet(uint256 memberId, address wallet)
        external
        whenNotPaused
        onlyRole(REGISTRAR_ROLE)
    {
        MemberRecord storage record = _memberRecord(memberId);
        require(wallet != address(0), "MembershipRegistry: invalid wallet");
        require(wallet != record.primaryWallet, "MembershipRegistry: cannot unlink primary wallet");
        require(linkedWallets[memberId][wallet], "MembershipRegistry: wallet not linked");

        linkedWallets[memberId][wallet] = false;
        walletToMemberId[wallet] = 0;
        record.updatedAt = uint64(block.timestamp);
        _removeWalletFromList(memberId, wallet);

        emit WalletUnlinked(memberId, wallet);
    }

    function getMember(uint256 memberId) external view returns (MemberRecord memory) {
        return memberRecords[memberId];
    }

    function getMemberByWallet(address wallet) external view returns (MemberRecord memory) {
        return memberRecords[walletToMemberId[wallet]];
    }

    function getLinkedWallets(uint256 memberId) external view returns (address[] memory) {
        return memberWalletList[memberId];
    }

    function isActiveMember(address wallet) public view override returns (bool) {
        uint256 memberId = walletToMemberId[wallet];
        if (memberId == 0) {
            return false;
        }

        MemberRecord memory record = memberRecords[memberId];
        if (record.status != MembershipStatus.ACTIVE) {
            return false;
        }

        if (record.expiresAt == 0) {
            return true;
        }

        return record.expiresAt >= block.timestamp;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _validExpiry(MembershipTier tier, uint64 expiresAt) private view returns (bool) {
        if (tier == MembershipTier.LIFETIME) {
            return expiresAt == 0;
        }

        return expiresAt > block.timestamp;
    }

    function _memberRecord(uint256 memberId) private view returns (MemberRecord storage record) {
        record = memberRecords[memberId];
        require(record.memberId != 0, "MembershipRegistry: member not found");
    }

    function _removeWalletFromList(uint256 memberId, address wallet) private {
        address[] storage wallets = memberWalletList[memberId];
        uint256 length = wallets.length;
        for (uint256 i = 0; i < length; i++) {
            if (wallets[i] == wallet) {
                wallets[i] = wallets[length - 1];
                wallets.pop();
                return;
            }
        }
    }
}
