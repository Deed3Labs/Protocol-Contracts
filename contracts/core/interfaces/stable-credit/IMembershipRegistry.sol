// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

interface IMembershipRegistry {
    enum MembershipStatus {
        NONE,
        PENDING,
        ACTIVE,
        SUSPENDED,
        REVOKED,
        EXPIRED
    }

    enum MembershipTier {
        NONE,
        BASIC,
        YEARLY,
        LIFETIME
    }

    struct MemberRecord {
        uint256 memberId;
        address primaryWallet;
        MembershipStatus status;
        MembershipTier tier;
        uint64 joinedAt;
        uint64 expiresAt;
        bytes32 metadataHash;
        uint64 updatedAt;
    }

    function isActiveMember(address wallet) external view returns (bool);
}
