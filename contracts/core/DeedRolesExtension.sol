// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./DeedTrustCommon.sol";

/**
 * @title DeedRolesExtension
 * @notice DeedNFT's third delegatecall extension: the protector and standby trustee roles, and the owner-trustee
 *         office. A deed's Beneficiary may serve as
 *         trustee of its own trust once the protector appoints it and it accepts. The office follows the
 *         beneficial interest -- the trust extension vacates it on transfer and names the new holder, who may
 *         accept here -- and the protector removes an owner-trustee only for a permitted reason, installing an
 *         eligible successor.
 * @dev Runs only by delegatecall from DeedNFT's fallback, against DeedNFT's storage. Its own storage is never
 *      used. Kept apart from the trust extension, which is at the bytecode limit; setProtector and
 *      setStandbyTrustee moved here unchanged to make room.
 */
contract DeedRolesExtension is DeedTrustCommon {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function deedExtensionKind() external pure returns (bytes32) {
        return ROLES_EXTENSION_KIND;
    }

    /// @dev Never reached: no function here moves a token, and DeedNFT runs its own transfer hook.
    function _transferHook(address, address, uint256) internal pure override {
        revert();
    }

    /**
     * @notice The protector names its successor; while the record is zero the holder is protector and may name
     *         one. Zero hands the role back to whoever holds the token. A protector is never the trustee or the
     *         standby, so no one person both proposes and countersigns a correction.
     */
    function setProtector(uint256 tokenId, address newProtector) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        address previous = _protector(r, ownerOf(tokenId));
        if (msg.sender != previous) revert IDeedTrust.NotProtector();
        if (newProtector != address(0) && (newProtector == r.trustee || newProtector == r.standbyTrustee)) {
            revert IDeedTrust.RoleConflict();
        }
        r.protector = newProtector;
        r.nonce++; // consents the old protector gave lapse
        _setTraitRaw(tokenId, KEY_PROTECTOR, abi.encode(newProtector));
        emit IDeedTrust.ProtectorChanged(tokenId, previous, newProtector);
    }

    /// @notice Addendum 2: the protector names a standby trustee, who must be eligible and accept now. Zero clears it.
    function setStandbyTrustee(uint256 tokenId, address standby, bytes calldata acceptance) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        address holder = ownerOf(tokenId);
        if (msg.sender != _protector(r, holder)) revert IDeedTrust.NotProtector();
        if (standby != address(0)) {
            _requireEligible(standby);
            if (standby == holder || standby == r.trustee || standby == r.protector) revert IDeedTrust.RoleConflict();
            _consume(standby, keccak256(abi.encode(STANDBY_ACCEPTANCE_TYPEHASH, tokenId, standby, uint256(r.nonce))), acceptance);
            r.nonce++;
        }
        address previous = r.standbyTrustee;
        r.standbyTrustee = standby;
        _setTraitRaw(tokenId, KEY_STANDBY, abi.encode(standby));
        emit IDeedTrust.StandbyTrusteeChanged(tokenId, previous, standby);
    }

    /**
     * @notice The protector appoints the holder trustee of its own trust; the holder then accepts. A deed with
     *         no protector of record cannot have one, since the holder would be protector and trustee at once.
     */
    function appointOwnerTrustee(uint256 tokenId) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        address holder = ownerOf(tokenId);
        if (r.protector == address(0) || msg.sender != r.protector) revert IDeedTrust.NotProtector();
        if (holder == r.protector) revert IDeedTrust.RoleConflict();
        _ownerTrusteeAllowed[tokenId] = true;
        _ownerTrusteePending[tokenId] = holder;
        emit IDeedTrust.OwnerTrusteeAppointed(tokenId, holder);
    }

    /// @notice The holder named for the office accepts it and becomes the deed's trustee. No eligibility check:
    ///         an owner-trustee need not be a Qualified Trustee.
    function acceptOwnerTrustee(uint256 tokenId) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        address holder = ownerOf(tokenId);
        if (!_ownerTrusteeAllowed[tokenId] || msg.sender != holder || _ownerTrusteePending[tokenId] != holder) {
            revert IDeedTrust.NotOwnerTrusteeCandidate();
        }
        if (holder == r.protector) revert IDeedTrust.RoleConflict();
        delete _ownerTrusteePending[tokenId];
        r.nonce++;
        address previous = r.trustee;
        _installTrustee(tokenId, r, holder);
        emit IDeedTrust.TrusteeChanged(tokenId, previous, holder);
    }

    /**
     * @notice The protector removes an owner-trustee only at the holder's request (1), on a licensing
     *         determination (2), or for cause after notice (3), and installs an eligible successor who accepts.
     */
    function removeOwnerTrustee(
        uint256 tokenId,
        uint8 reason,
        bytes32 evidenceHash,
        address successor,
        bytes calldata acceptance
    ) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        address holder = ownerOf(tokenId);
        if (r.protector == address(0) || msg.sender != r.protector) revert IDeedTrust.NotProtector();
        if (reason == 0 || reason > 3) revert IDeedTrust.InvalidRemovalReason();
        _requireEligible(successor);
        if (successor == holder || successor == r.protector) revert IDeedTrust.RoleConflict();
        _consume(successor, _trusteeAcceptanceHash(tokenId, successor, r.nonce), acceptance);
        r.nonce++;
        _ownerTrusteeAllowed[tokenId] = false;
        delete _ownerTrusteePending[tokenId];
        address previous = r.trustee;
        _installTrustee(tokenId, r, successor);
        emit IDeedTrust.OwnerTrusteeRemoved(tokenId, previous, successor, reason, evidenceHash);
        emit IDeedTrust.TrusteeChanged(tokenId, previous, successor);
    }

    /// @notice Whether a deed may have an owner-trustee, and who may accept the office now.
    function ownerTrusteeOf(uint256 tokenId) external view returns (bool allowed, address pending) {
        return (_ownerTrusteeAllowed[tokenId], _ownerTrusteePending[tokenId]);
    }
}
