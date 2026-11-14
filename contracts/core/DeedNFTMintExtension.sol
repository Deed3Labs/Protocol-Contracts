// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {StringsUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./DeedTrustCommon.sol";

/**
 * @title DeedNFTMintExtension
 * @notice The part of DeedNFT that mints and edits: legacy mintAsset, the trust mint and Deed ID reservation
 *         (trust agreement v5, items 2, 4 and 8), validation, and ERC-7496 trait edits.
 * @dev Never called directly in production. DeedNFT pins it as an immutable and forwards to it by
 *      delegatecall, so this code runs against the DeedNFT proxy's storage with the original caller. Called
 *      directly it acts on its own empty storage, which it never initializes.
 */
contract DeedNFTMintExtension is DeedTrustCommon {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.Bytes32Set;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function deedExtensionKind() external pure returns (bytes32) {
        return MINT_EXTENSION_KIND;
    }

    /// @dev Only mints happen in this extension; the full transfer rules live in DeedTrustExtension.
    function _transferHook(address from, address, uint256) internal override {
        assert(from == address(0));
        _activeTokenCount++;
    }

    /// @notice Phase 4c: the digest a second signer of the deed's validator signs (or approves with
    ///         approveTrustAction) to consent to a freezing markVoid. Served here rather than with markVoid in
    ///         DeedTrustExtension, for room; DeedNFT's fallback routes it.
    function freezeConsentDigest(uint256 tokenId, uint8 reasonCode, bytes32 recordingRefHash, string calldata uri)
        external
        view
        returns (bytes32)
    {
        return _digest(_freezeConsentHash(tokenId, reasonCode, recordingRefHash, uri, _trust[tokenId].nonce));
    }

    // =====================================================================
    // Minting
    // =====================================================================

    /**
     * @notice Mints a Vehicle or CommercialEquipment deed. The trust agreement applies only to Land and
     *         Estate (Addendum 1), and every such deed has a trustee, so those go through mintTrustDeed.
     * @dev When a FundManager is set, the validator's fee read at execution must not exceed the cap the
     *      minter set with FundManager.setMaxFee (audit D-16).
     */
    function mintAsset(
        address owner,
        AssetType assetType,
        string calldata uri,
        string calldata definition,
        string calldata configuration,
        address validatorAddress,
        address token,
        uint256 salt
    ) external whenNotPaused onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (_inScope(uint8(assetType))) revert IDeedTrust.TrustDeedRequired();
        require(owner != address(0), "Invalid owner address");
        require(bytes(definition).length > 0, "Definition cannot be empty");
        address v = _selectValidator(validatorAddress, uint8(assetType));
        string memory agreementBase = IValidator(v).defaultOperatingAgreement();
        require(bytes(agreementBase).length > 0, "No operating agreement available");
        _chargeFee(v, token);

        if (salt > 0) {
            tokenId = _saltedId(owner, assetType, definition, salt);
        } else {
            // Step over any ID a salted mint occupied, so a collision can never brick sequential minting (D-8).
            while (_everMinted[nexttokenId]) nexttokenId++;
            tokenId = nexttokenId++;
        }
        // Never reuse an ID, even after burn (D-8), and never take one reserved for a trust deed.
        if (_everMinted[tokenId] || _exists(tokenId) || _reservations[tokenId].reserver != address(0)) {
            revert IDeedTrust.DeedIdUnavailable(tokenId);
        }
        _everMinted[tokenId] = true;

        _mintDeed(
            owner,
            tokenId,
            assetType,
            uri,
            string(abi.encodePacked(agreementBase, StringsUpgradeable.toString(tokenId))),
            definition,
            configuration,
            v
        );
    }

    /**
     * @notice The Deed ID a trust mint with these inputs will get (DECISIONS, Addendum 1 item 2):
     *         hash(agreementHash, hash of the packed rider hashes, identityHash), where identityHash =
     *         keccak256(abi.encode(assetType, definitionHash, parcelRef, reserver, salt)).
     * @param definitionHash keccak256 of the definition string.
     */
    function computeDeedId(
        uint8 assetType,
        bytes32 definitionHash,
        bytes32 parcelRef,
        address reserver,
        uint256 salt,
        bytes32 agreementHash,
        bytes32[] calldata riderHashes
    ) public pure returns (uint256 deedId, bytes32 identityHash) {
        identityHash = keccak256(abi.encode(assetType, definitionHash, parcelRef, reserver, salt));
        deedId = _trustId(agreementHash, keccak256(abi.encodePacked(riderHashes)), identityHash);
    }

    /// @dev 127 bits of the hash with bit 127 set, in [2^127, 2^128): Subdivide packs `(deedId << 128) | unitId`,
    ///      so a full 256-bit ID would collide units. Reuse is impossible anyway: `_everMinted` and reservations.
    function _trustId(bytes32 agreementHash, bytes32 ridersHash, bytes32 identityHash) internal pure returns (uint256) {
        uint256 h = uint256(keccak256(abi.encode(agreementHash, ridersHash, identityHash)));
        return (h & (SALTED_ID_FLAG - 1)) | SALTED_ID_FLAG;
    }

    /**
     * @notice The grantor reserves the Deed ID before recording the deed into trust that names it (brief
     *         item 2). The reservation binds the caller as reserver, the agreement hash and the identity hash;
     *         only a mint to the same owner with the same inputs can use the ID, and no other mint can.
     */
    function reserveId(
        uint8 assetType,
        bytes32 definitionHash,
        bytes32 parcelRef,
        uint256 salt,
        bytes32 agreementHash,
        bytes32[] calldata riderHashes
    ) external returns (uint256 deedId) {
        if (!_inScope(assetType)) revert IDeedTrust.AssetTypeOutsideAgreement();
        if (agreementHash == bytes32(0)) revert IDeedTrust.AgreementNotAdopted(agreementHash);
        bytes32 identityHash;
        (deedId, identityHash) = computeDeedId(assetType, definitionHash, parcelRef, msg.sender, salt, agreementHash, riderHashes);
        if (_everMinted[deedId] || _reservations[deedId].reserver != address(0)) revert IDeedTrust.DeedIdUnavailable(deedId);
        _reservations[deedId] = IDeedTrust.Reservation(msg.sender, agreementHash, identityHash);
        emit IDeedTrust.DeedIdReserved(deedId, msg.sender, agreementHash, keccak256(abi.encodePacked(riderHashes)), identityHash);
    }

    /**
     * @notice Mints a Land or Estate deed into trust (brief items 2, 4, 8; Addendum 1 and 2).
     * @dev The trustee must be eligible (a signer of an active validator, or a licensed trustee), must not be
     *      the owner or the protector, and must accept: an EIP-712 TrusteeAcceptance signature over
     *      (tokenId, trustee, nonce 0), or, with an empty signature, a prior approveTrustAction of that digest
     *      by the trustee. When a program applies the protector is its sponsor and the trustee defaults to its
     *      title administrator. Coop policy needs a program: the sponsor holds the right of first refusal.
     */
    function mintTrustDeed(IDeedTrust.TrustMintParams calldata p, bytes calldata trusteeAcceptance)
        external
        whenNotPaused
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (!_inScope(p.assetType)) revert IDeedTrust.AssetTypeOutsideAgreement();
        require(p.owner != address(0), "Invalid owner address");
        require(bytes(p.definition).length > 0, "Definition cannot be empty");
        if (p.transferPolicy > POLICY_COOP) revert IDeedTrust.InvalidTransferPolicy();

        address v = _selectValidator(p.validator, p.assetType);
        string memory agreementUri = _adoptedURI(v, p.assetType, p.agreementHash);
        bytes32 ridersHash = _checkRiders(v, p.assetType, p.riderHashes);

        bytes32 identityHash = keccak256(abi.encode(p.assetType, keccak256(bytes(p.definition)), p.parcelRef, p.owner, p.salt));
        tokenId = _trustId(p.agreementHash, ridersHash, identityHash);
        address reserver = _reservations[tokenId].reserver;
        if (_everMinted[tokenId] || (reserver != address(0) && reserver != p.owner)) revert IDeedTrust.DeedIdUnavailable(tokenId);
        _everMinted[tokenId] = true;

        (address trustee, address protector) = _resolveRoles(p);
        _requireEligible(trustee);
        if (trustee == p.owner || trustee == protector) revert IDeedTrust.RoleConflict();
        _consume(trustee, _trusteeAcceptanceHash(tokenId, trustee, 0), trusteeAcceptance);

        _chargeFee(v, p.token);
        _mintDeed(p.owner, tokenId, AssetType(p.assetType), p.uri, agreementUri, p.definition, p.configuration, v);

        bytes32 mintParamsHash = keccak256(abi.encode(p));
        _writeTrust(tokenId, p, trustee, protector, ridersHash, mintParamsHash);
        emit IDeedTrust.TrustDeedMinted(tokenId, p.owner, p.agreementHash, ridersHash, identityHash, mintParamsHash);
    }

    function _resolveRoles(IDeedTrust.TrustMintParams calldata p) internal pure returns (address trustee, address protector) {
        trustee = p.trustee;
        protector = p.protector;
        if (p.program.programId != bytes32(0)) {
            if (p.program.sponsor == address(0)) revert IDeedTrust.ProgramRequired();
            if (protector != address(0) && protector != p.program.sponsor) revert IDeedTrust.ProtectorNotSponsor();
            protector = p.program.sponsor;
            if (trustee == address(0)) trustee = p.program.titleAdministrator;
        } else if (p.transferPolicy == POLICY_COOP) {
            revert IDeedTrust.ProgramRequired();
        }
    }

    function _writeTrust(
        uint256 tokenId,
        IDeedTrust.TrustMintParams calldata p,
        address trustee,
        address protector,
        bytes32 ridersHash,
        bytes32 mintParamsHash
    ) internal {
        IDeedTrust.TrustRecord storage r = _trust[tokenId];
        r.agreementHash = p.agreementHash;
        r.ridersHash = ridersHash;
        r.trustee = trustee;
        r.protector = protector;
        r.transferPolicy = p.transferPolicy;
        r.nonce = 1; // nonce 0 was the mint acceptance
        bool hasProgram = p.program.programId != bytes32(0);
        // Addendum 1: versionConsentRequired defaults to true.
        r.versionConsentRequired = hasProgram ? p.program.versionConsentRequired : true;
        r.rofrPeriodDays = p.program.rofrPeriodDays == 0 ? DEFAULT_ROFR_DAYS : p.program.rofrPeriodDays;
        r.completionWindowDays = p.program.completionWindowDays == 0 ? DEFAULT_COMPLETION_DAYS : p.program.completionWindowDays;

        _setTraitRaw(tokenId, KEY_AGREEMENT_HASH, abi.encode(p.agreementHash));
        _setTraitRaw(tokenId, KEY_RIDER_HASHES, abi.encode(p.riderHashes));
        _setTraitRaw(tokenId, KEY_TRUSTEE, abi.encode(trustee));
        _setTraitRaw(tokenId, KEY_PROTECTOR, abi.encode(protector));
        _setTraitRaw(tokenId, KEY_TRANSFER_POLICY, abi.encode(p.transferPolicy));
        _setTraitRaw(tokenId, KEY_STATUS, abi.encode(STATUS_ACTIVE));
        _setTraitRaw(tokenId, KEY_MINT_PARAMS, abi.encode(mintParamsHash));
        if (hasProgram) {
            r.programId = p.program.programId;
            r.programSponsor = p.program.sponsor;
            r.titleAdministrator = p.program.titleAdministrator;
            r.programParamsHash = p.program.paramsHash;
            _setTraitRaw(tokenId, KEY_PROGRAM_ID, abi.encode(p.program.programId));
            _setTraitRaw(tokenId, KEY_PROGRAM_SPONSOR, abi.encode(p.program.sponsor));
            _setTraitRaw(tokenId, KEY_TITLE_ADMIN, abi.encode(p.program.titleAdministrator));
            _setTraitRaw(
                tokenId,
                KEY_PROGRAM_PARAMS,
                abi.encode(p.program.paramsHash, r.rofrPeriodDays, r.completionWindowDays, r.versionConsentRequired)
            );
        }
    }

    function _selectValidator(address v, uint8 assetType) internal view returns (address) {
        if (v == address(0)) v = defaultValidator;
        require(v != address(0), "No validator available");
        require(IValidatorRegistry(validatorRegistry).isValidatorActive(v), "Validator not active");
        require(IERC165Upgradeable(v).supportsInterface(type(IValidator).interfaceId), "Validator interface not supported");
        require(IValidator(v).supportsAssetType(assetType), "Asset type not supported");
        return v;
    }

    function _chargeFee(address v, address token) internal {
        if (address(fundManager) != address(0)) {
            require(token != address(0), "Payment token required");
            uint256 serviceFee = IValidator(v).getServiceFee(token);
            require(serviceFee > 0, "Service fee not set");
            fundManager.processPayment(msg.sender, v, token, serviceFee);
        } else {
            require(token == address(0), "Payment token not allowed without FundManager");
        }
    }

    /// @dev The `beneficiary` trait is no longer written (brief item 5); see DeedTrustExtension.beneficialOwnerOf.
    function _mintDeed(
        address owner,
        uint256 tokenId,
        AssetType assetType,
        string calldata uri,
        string memory operatingAgreement,
        string calldata definition,
        string calldata configuration,
        address validator
    ) internal {
        _mint(owner, tokenId);
        if (bytes(uri).length > 0) _setTokenURI(tokenId, uri);
        _setTraitValue(tokenId, KEY_ASSET_TYPE, abi.encode(assetType));
        _setTraitValue(tokenId, KEY_IS_VALIDATED, abi.encode(false));
        _setTraitValue(tokenId, KEY_OPERATING_AGREEMENT, abi.encode(operatingAgreement));
        _setTraitValue(tokenId, KEY_DEFINITION, abi.encode(definition));
        _setTraitValue(tokenId, KEY_CONFIGURATION, abi.encode(configuration));
        _setTraitValue(tokenId, KEY_VALIDATOR, abi.encode(validator));
        emit DeedNFTMinted(tokenId, assetType, msg.sender, validator);
    }

    // =====================================================================
    // Trait edits (moved from DeedNFT; behaviour unchanged except where noted)
    // =====================================================================

    /**
     * @dev Sets a trait value with flexible input types (0=bytes, 1=string, 2=uint256, 3=bool), as the deed's
     *      own validator or the holder (audit D-2). Reserved traits are refused for everyone. On a trust deed
     *      the definition, operating agreement and asset type are locked for everyone, the validator included
     *      (brief item 3).
     */
    function setTrait(uint256 tokenId, bytes calldata traitKey, bytes calldata traitValue, uint8 valueType)
        external
        whenNotPaused
    {
        bool byValidator = _requireEditor(tokenId);
        bool isStringKey = traitKey.length != 32;
        // A string name is stored and rendered; MetadataRenderer JSON-escapes it (audit D-6).
        bytes32 key = isStringKey ? keccak256(traitKey) : bytes32(traitKey);

        require(!_isReservedTrait(key), "Reserved trait");
        _checkTrustLock(tokenId, key);
        if (key == KEY_ASSET_TYPE) require(byValidator, "Only a validator sets asset type");
        if (!byValidator) {
            // Audit D-1: once validated, what the validator vouched for is the validator's to change.
            if (_isValidated(tokenId) && _isValidatedTrait(tokenId, key)) revert ValidatedTraitLocked();
            // The holder changes the agreement only through updateMetadata (audit D-1).
            if (key == KEY_OPERATING_AGREEMENT) revert AgreementViaUpdateMetadata();
        }

        bytes memory value;
        if (valueType == 0) value = traitValue;
        else if (valueType == 1) value = abi.encode(string(traitValue));
        else if (valueType == 2) value = abi.encode(uint256(bytes32(traitValue)));
        else if (valueType == 3) value = abi.encode(uint256(bytes32(traitValue)) > 0);
        else revert("Invalid value type");

        _setTraitValue(tokenId, key, value);
        if (isStringKey) _traitNames[key] = string(traitKey);
    }

    /// @dev Removes a trait by human-readable name; same locks as setTrait.
    function removeTrait(uint256 tokenId, string calldata traitName) external whenNotPaused {
        require(_exists(tokenId), "Token does not exist");
        bool byValidator = _requireEditor(tokenId);
        bytes32 traitKey = keccak256(bytes(traitName));
        require(!_isReservedTrait(traitKey) && traitKey != KEY_ASSET_TYPE, "Reserved trait");
        _checkTrustLock(tokenId, traitKey);
        require(_tokenTraits[tokenId][traitKey].length > 0, "Trait does not exist");
        if (!byValidator && _isValidated(tokenId) && _isValidatedTrait(tokenId, traitKey)) revert ValidatedTraitLocked();
        delete _tokenTraits[tokenId][traitKey];
        _tokenTraitKeys[tokenId].remove(traitKey);
        emit TraitUpdated(traitKey, tokenId, "");
        if (metadataRenderer != address(0)) {
            try IMetadataRenderer(metadataRenderer).syncTraitUpdate(tokenId, traitKey, "") {} catch {}
        }
    }

    function _checkTrustLock(uint256 tokenId, bytes32 key) internal view {
        if (
            _trust[tokenId].agreementHash != bytes32(0) &&
            (key == KEY_DEFINITION || key == KEY_OPERATING_AGREEMENT || key == KEY_ASSET_TYPE)
        ) revert IDeedTrust.DefinitionLocked();
    }

    /// @dev Traits no setTrait/removeTrait caller may write: validation, the old beneficiary record, and every
    ///      reserved trust trait (on every deed, so a legacy deed cannot pose as a trust deed).
    function _isReservedTrait(bytes32 key) internal pure returns (bool) {
        return key == KEY_IS_VALIDATED || key == KEY_VALIDATOR || key == KEY_BENEFICIARY ||
            key == KEY_AGREEMENT_HASH || key == KEY_RIDER_HASHES || key == KEY_TRUSTEE || key == KEY_PROTECTOR ||
            key == KEY_STANDBY || key == KEY_SUSPENDED || key == KEY_TRANSFER_POLICY || key == KEY_STATUS ||
            key == KEY_PROGRAM_ID || key == KEY_PROGRAM_SPONSOR || key == KEY_TITLE_ADMIN ||
            key == KEY_PROGRAM_PARAMS || key == KEY_MINT_PARAMS;
    }

    function _isValidated(uint256 tokenId) internal view returns (bool) {
        bytes memory raw = _tokenTraits[tokenId][KEY_IS_VALIDATED];
        return raw.length > 0 && abi.decode(raw, (bool));
    }

    /// @dev Traits the validator vouches for (audit D-1). Fails closed if the criteria cannot be read.
    function _isValidatedTrait(uint256 tokenId, bytes32 key) internal view returns (bool) {
        if (key == KEY_DEFINITION || key == KEY_OPERATING_AGREEMENT || key == KEY_CONFIGURATION) return true;
        return IValidatorTraitPolicy(_validatorOf(tokenId)).isRequiredTrait(
            abi.decode(_tokenTraits[tokenId][KEY_ASSET_TYPE], (uint8)),
            key
        );
    }
}
