// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./DeedTrustCommon.sol";

/**
 * @title DeedTrustExtension
 * @notice The trust agreement v5 surface of DeedNFT (IDeedTrust, apart from minting and Deed ID reservation,
 *         which DeedNFTMintExtension serves) and the transfer rules every mint, transfer and burn runs.
 * @dev Never called directly in production. DeedNFT pins it as an immutable, forwards unknown selectors to it
 *      from its fallback, and runs its transfer hook by delegatecall, so this code runs against the DeedNFT
 *      proxy's storage with the original caller.
 *
 *      What no path here can do (brief item 6; Addendum 1 and 2): move a deed for anyone but its holder or the
 *      holder's approved operator; let the trustee, standby or protector transfer, burn or freeze it; let an
 *      admin, validator or trustee change the agreement or rider hashes; let an admin change the trustee,
 *      protector or definition; route any funds anywhere (nothing here moves value). Nothing here is pausable:
 *      a pause must never block a holder's exit or a change of trustee.
 */
contract DeedTrustExtension is DeedTrustCommon {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function deedExtensionKind() external pure returns (bytes32) {
        return TRUST_EXTENSION_KIND;
    }

    // =====================================================================
    // Transfer rules
    // =====================================================================

    /// @notice DeedNFT's transfer hook entry point. DeedNFT's fallback refuses this selector, so it runs only
    ///         from DeedNFT._transferHook.
    function transferHook(address from, address to, uint256 tokenId) external {
        _onTransfer(from, to, tokenId);
    }

    function _transferHook(address from, address to, uint256 tokenId) internal override {
        _onTransfer(from, to, tokenId);
    }

    /**
     * @dev Mint, burn and transfer rules.
     *      - Burn by the holder is always allowed, under every policy and status (brief item 9(a)), and
     *        retires the deed (item 1).
     *      - The approved-marketplace list applies to third-party operators, as before (Open behaviour).
     *      - On a trust deed: a freezing void blocks transfers; a transfer to the current trustee reverts unless
     *        the trustee is an active Functional Contract, which then suspends the trustee (DECISIONS,
     *        Addendum 1 item 6); otherwise the transfer passes if it returns the token to the address it last
     *        came from (9(b); not a removed Functional Contract), goes into an active Functional Contract
     *        (9(c)), or satisfies the policy.
     *      - The beneficiary trait is no longer written (item 5): see beneficialOwnerOf.
     *      - Phase 4c: DeedNFT itself cancels a pending validator reassignment once these rules pass.
     */
    function _onTransfer(address from, address to, uint256 tokenId) internal {
        if (from == address(0)) {
            _activeTokenCount++;
            return;
        }
        if (to == address(0)) {
            _activeTokenCount--;
            _retire(tokenId, from);
            return;
        }
        address operator = _msgSender();
        if (_enforceRoyalties && operator != from && !_approvedMarketplaces[operator]) revert("!mkt");

        IDeedTrust.TrustRecord storage r = _trust[tokenId];
        if (r.agreementHash == bytes32(0)) return;

        if (r.status == STATUS_VOID && r.voidReason >= VOID_FREEZES_FROM) revert IDeedTrust.DeedFrozen();

        (uint8 kinds, bool active) = _fcKind(to);
        bool intoFc = active && kinds != 0;
        if (to == r.trustee) {
            if (!intoFc) revert IDeedTrust.TransferToTrustee();
            r.trusteeSuspended = true;
            _setTraitRaw(tokenId, KEY_SUSPENDED, abi.encode(true));
            emit IDeedTrust.TrusteeSuspended(tokenId, to);
        }

        // A removed Functional Contract takes no new deposits, not even as the address the deed last came from.
        bool returning = to == r.lastFrom && (kinds == 0 || active);
        if (!(returning || intoFc || _policyAllows(r.transferPolicy, from, to))) {
            revert IDeedTrust.TransferPolicyBlocked(r.transferPolicy);
        }
        r.lastFrom = from;
    }

    function _policyAllows(uint8 policy, address from, address to) internal view returns (bool) {
        if (policy == POLICY_OPEN) return true;
        if (policy == POLICY_VERIFIED) return _isVerifiedMember(to);
        // Coop: only a registered agent completes a transfer, after its right-of-first-refusal window. A
        // removed agent can still release what it holds (DECISIONS #8: removal never traps a deed).
        (uint8 kinds, ) = _fcKind(from);
        return kinds & KIND_COOP_AGENT != 0;
    }

    function _fcKind(address account) internal view returns (uint8 kinds, bool active) {
        if (_fcRegistry == address(0)) return (0, false);
        return IFunctionalContractRegistry(_fcRegistry).kindOf(account);
    }

    /// @dev DECISIONS #9: a membership record that is not revoked or suspended (fraud-flagged); expiry of a paid
    ///      subscription does not matter. Fails closed when no registry is set or it cannot be read.
    function _isVerifiedMember(address account) internal view returns (bool) {
        if (_membershipRegistry == address(0)) return false;
        try IMemberLookup(_membershipRegistry).getMemberByWallet(account) returns (IMembershipRegistry.MemberRecord memory m) {
            return m.memberId != 0 &&
                m.status != IMembershipRegistry.MembershipStatus.NONE &&
                m.status != IMembershipRegistry.MembershipStatus.SUSPENDED &&
                m.status != IMembershipRegistry.MembershipStatus.REVOKED;
        } catch {
            return false;
        }
    }

    /**
     * @dev Brief item 1: a burn leaves the traits readable, marks the deed Retired for good, and emits the hashes
     *      the trustee needs to prove which property's token was retired. The hashes are keccak256 of the stored
     *      ERC-7496 values (abi-encoded strings), which never reverts, so the holder can always burn.
     */
    function _retire(uint256 tokenId, address holder) internal {
        IDeedTrust.TrustRecord storage r = _trust[tokenId];
        r.status = STATUS_RETIRED;
        _setTraitRaw(tokenId, KEY_STATUS, abi.encode(STATUS_RETIRED));
        emit IDeedTrust.DeedRetired(
            tokenId,
            holder,
            keccak256(_tokenTraits[tokenId][KEY_DEFINITION]),
            keccak256(_tokenTraits[tokenId][KEY_OPERATING_AGREEMENT]),
            keccak256(_tokenTraits[tokenId][KEY_CONFIGURATION]),
            r.agreementHash,
            r.ridersHash
        );
    }

    // =====================================================================
    // Trustee, protector, standby (Addendum 1, Addendum 2)
    // =====================================================================

    /**
     * @notice Replaces the trustee. Only the protector (the holder while the protector record is zero). The new
     *         trustee must be eligible, must not be the holder or the protector, and must accept (signature or
     *         prior approveTrustAction). Clears a suspension.
     */
    function setTrustee(uint256 tokenId, address newTrustee, bytes calldata acceptance) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        address holder = ownerOf(tokenId);
        if (msg.sender != _protector(r, holder)) revert IDeedTrust.NotProtector();
        _requireEligible(newTrustee);
        if (newTrustee == holder || newTrustee == r.protector) revert IDeedTrust.RoleConflict();
        _consume(newTrustee, _trusteeAcceptanceHash(tokenId, newTrustee, r.nonce), acceptance);
        r.nonce++;
        address previous = r.trustee;
        _installTrustee(tokenId, r, newTrustee);
        emit IDeedTrust.TrusteeChanged(tokenId, previous, newTrustee);
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
     * @notice Addendum 2: records a licensing determination against the trustee. Callable by the protector, the
     *         trustee or the standby. Posts it as a notice, then promotes the standby to trustee if one is set
     *         and still eligible (and is not the holder or the protector); otherwise marks the trustee suspended.
     *         A suspended trustee has no trustee powers until the protector names a new one.
     * @dev Re-review M-G (changes Addendum 2): the standby's own call posts the determination, but acts on it
     *      only with the protector's consent (the holder's while the protector record is zero), by EIP-712
     *      signature over LicensingConsent or a prior approveTrustAction. Without it the notice is posted and
     *      nothing else changes, so a standby cannot oust the trustee on its own word. `protectorConsent` is
     *      ignored on the protector's and the trustee's calls, which are unchanged.
     */
    function applyLicensingDetermination(
        uint256 tokenId,
        bytes32 docHash,
        string calldata uri,
        bytes calldata protectorConsent
    ) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        address holder = ownerOf(tokenId);
        address protector = _protector(r, holder);
        address standby = r.standbyTrustee;
        if (msg.sender != protector && msg.sender != r.trustee && (standby == address(0) || msg.sender != standby)) {
            revert IDeedTrust.NotTrustParty();
        }
        emit IDeedTrust.NoticePosted(tokenId, msg.sender, docHash, uri, r.trustee, protector);

        if (msg.sender != protector && msg.sender != r.trustee) {
            bytes32 consent = keccak256(abi.encode(LICENSING_CONSENT_TYPEHASH, tokenId, standby, docHash, uint256(r.nonce)));
            if (protectorConsent.length == 0 && !_trustApprovals[protector][_digest(consent)]) return;
            _consume(protector, consent, protectorConsent);
            r.nonce++;
        }

        if (standby != address(0) && standby != holder && standby != r.protector && _isEligible(standby)) {
            address previous = r.trustee;
            _installTrustee(tokenId, r, standby);
            r.nonce++;
            emit IDeedTrust.StandbyPromoted(tokenId, previous, standby);
            emit IDeedTrust.TrusteeChanged(tokenId, previous, standby);
        } else {
            r.trusteeSuspended = true;
            _setTraitRaw(tokenId, KEY_SUSPENDED, abi.encode(true));
            emit IDeedTrust.TrusteeSuspended(tokenId, r.trustee);
        }
    }

    function _installTrustee(uint256 tokenId, IDeedTrust.TrustRecord storage r, address trustee) internal {
        r.trustee = trustee;
        _setTraitRaw(tokenId, KEY_TRUSTEE, abi.encode(trustee));
        if (r.trusteeSuspended) {
            r.trusteeSuspended = false;
            _setTraitRaw(tokenId, KEY_SUSPENDED, abi.encode(false));
        }
        if (r.standbyTrustee == trustee) {
            r.standbyTrustee = address(0);
            _setTraitRaw(tokenId, KEY_STANDBY, abi.encode(address(0)));
            emit IDeedTrust.StandbyTrusteeChanged(tokenId, trustee, address(0));
        }
    }

    // =====================================================================
    // Agreement version and definition corrections (brief items 3 and 4)
    // =====================================================================

    /**
     * @notice The holder's election of a new agreement version and riders. Every hash must be adopted by the
     *         deed's validator for this asset type. When versionConsentRequired is set and a protector is
     *         recorded, the protector must consent too (signature or prior approval). No admin, validator or
     *         trustee path changes these hashes.
     */
    function electAgreementVersion(
        uint256 tokenId,
        bytes32 agreementHash,
        bytes32[] calldata riderHashes,
        bytes calldata protectorConsent
    ) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        if (msg.sender != ownerOf(tokenId)) revert IDeedTrust.NotHolder();
        uint8 assetType = abi.decode(_tokenTraits[tokenId][KEY_ASSET_TYPE], (uint8));
        if (!_inScope(assetType)) revert IDeedTrust.AssetTypeOutsideAgreement();
        address v = _validatorOf(tokenId);
        string memory uri = _adoptedURI(v, assetType, agreementHash);
        bytes32 ridersHash = _checkRiders(v, assetType, riderHashes);
        if (r.versionConsentRequired && r.protector != address(0)) {
            _consume(
                r.protector,
                keccak256(abi.encode(AGREEMENT_CONSENT_TYPEHASH, tokenId, agreementHash, ridersHash, uint256(r.nonce))),
                protectorConsent
            );
            r.nonce++;
        }
        bytes32 previous = r.agreementHash;
        r.agreementHash = agreementHash;
        r.ridersHash = ridersHash;
        _setTraitRaw(tokenId, KEY_AGREEMENT_HASH, abi.encode(agreementHash));
        _setTraitRaw(tokenId, KEY_RIDER_HASHES, abi.encode(riderHashes));
        _setTraitValue(tokenId, KEY_OPERATING_AGREEMENT, abi.encode(uri));
        emit IDeedTrust.AgreementVersionElected(tokenId, previous, agreementHash, ridersHash);
    }

    /**
     * @notice Corrects the legal description (DECISIONS, Addendum 1 item 3): the unsuspended trustee proposes
     *         by calling this, and the protector (the holder while the record is zero) countersigns by signature
     *         or prior approval. A program sponsor, as protector, can never change it alone. Validation resets so
     *         the deed's validator vouches for the corrected text.
     * @dev oldHash and newHash in MetadataCorrected are keccak256 of the stored trait values (abi-encoded
     *      strings), as in DeedRetired. The consent digest signs keccak256 of the raw new text.
     */
    function correctDefinition(
        uint256 tokenId,
        string calldata newDefinition,
        string calldata reasonURI,
        bytes calldata protectorConsent
    ) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        if (msg.sender != r.trustee || r.trusteeSuspended) revert IDeedTrust.NotTrustParty();
        require(bytes(newDefinition).length > 0, "Definition cannot be empty");
        _consume(
            _protector(r, ownerOf(tokenId)),
            keccak256(abi.encode(
                CORRECTION_CONSENT_TYPEHASH, tokenId, keccak256(bytes(newDefinition)), keccak256(bytes(reasonURI)), uint256(r.nonce)
            )),
            protectorConsent
        );
        r.nonce++;
        bytes32 oldHash = keccak256(_tokenTraits[tokenId][KEY_DEFINITION]);
        bytes memory value = abi.encode(newDefinition);
        _setTraitValue(tokenId, KEY_DEFINITION, value);
        _setTraitValue(tokenId, KEY_IS_VALIDATED, abi.encode(false));
        emit IDeedTrust.MetadataCorrected(tokenId, KEY_DEFINITION, oldHash, keccak256(value), reasonURI);
    }

    // =====================================================================
    // Status and notices (brief item 10)
    // =====================================================================

    /// @notice Anyone may post a notice (a lost-key recovery claim, a court order) against any deed ever minted.
    ///         The event names the trustee and the effective protector of the moment, its recipients.
    function postNotice(uint256 tokenId, bytes32 docHash, string calldata uri) external {
        if (!_known(tokenId)) revert IDeedTrust.UnknownDeed();
        IDeedTrust.TrustRecord storage r = _trust[tokenId];
        address holder = _exists(tokenId) ? ownerOf(tokenId) : address(0);
        emit IDeedTrust.NoticePosted(tokenId, msg.sender, docHash, uri, r.trustee, _protector(r, holder));
    }

    /**
     * @notice Marks a trust deed Void after a tax sale, foreclosure or similar. Callable by the deed's validator
     *         (or a signer of it) or the unsuspended trustee. Reason codes below 128 leave the token transferable,
     *         so wind-up proceeds travel with it; codes from 128 freeze it and need the validator acting as
     *         someone other than the trustee, because the trustee can never freeze a deed (Addendum 1). Burning
     *         stays possible either way.
     * @dev Phase 4c: a freeze takes two distinct signers of the deed's validator, as lifting one takes two
     *      parties (restoreFromVoid). `cosigner` proposes it by consenting to FreezeConsent, by EIP-712
     *      signature in `cosignerConsent` or by a prior approveTrustAction (`cosignerConsent` empty), and the
     *      caller, a different signer, confirms it. Neither may be the trustee. The consent is bound to the
     *      reason code, the recording reference, the URI and the trust nonce, which the freeze moves on. Both
     *      arguments are ignored below 128.
     */
    function markVoid(
        uint256 tokenId,
        uint8 reasonCode,
        bytes32 recordingRefHash,
        string calldata uri,
        address cosigner,
        bytes calldata cosignerConsent
    ) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        if (r.status != STATUS_ACTIVE) revert IDeedTrust.NotActive();
        bool byValidator = _isDeedValidator(tokenId, msg.sender);
        if (!byValidator && (msg.sender != r.trustee || r.trusteeSuspended)) revert IDeedTrust.NotTrustParty();
        bool freezes = reasonCode >= VOID_FREEZES_FROM;
        if (freezes) {
            if (!byValidator || msg.sender == r.trustee) revert IDeedTrust.FreezeNeedsValidator();
            if (cosigner == msg.sender || cosigner == r.trustee || !_isDeedValidator(tokenId, cosigner)) {
                revert IDeedTrust.FreezeNeedsSecondSigner(cosigner);
            }
            _consume(cosigner, _freezeConsentHash(tokenId, reasonCode, recordingRefHash, uri, r.nonce), cosignerConsent);
            r.nonce++;
            emit IDeedTrust.DeedFreezeConfirmed(tokenId, cosigner, msg.sender);
        }
        r.status = STATUS_VOID;
        r.voidReason = reasonCode;
        _setTraitRaw(tokenId, KEY_STATUS, abi.encode(STATUS_VOID));
        emit IDeedTrust.DeedVoided(tokenId, reasonCode, recordingRefHash, uri, !freezes);
    }

    /**
     * @notice Re-review M-F: lifts a Void, freezing or not. Two parties: the deed's validator (or a signer of
     *         it, acting as someone other than the trustee, as for a freeze) calls, and the protector (the
     *         holder while the record is zero) consents by EIP-712 signature over RestoreConsent or a prior
     *         approveTrustAction. Answers Phase 3's open question 2: a freeze is no longer permanent, and one
     *         signer can neither impose a freeze for good nor lift one alone.
     */
    function restoreFromVoid(uint256 tokenId, string calldata reasonURI, bytes calldata protectorConsent) external {
        IDeedTrust.TrustRecord storage r = _liveTrust(tokenId);
        if (r.status != STATUS_VOID) revert IDeedTrust.NotVoid();
        if (!_isDeedValidator(tokenId, msg.sender) || msg.sender == r.trustee) revert IDeedTrust.FreezeNeedsValidator();
        _consume(
            _protector(r, ownerOf(tokenId)),
            keccak256(abi.encode(RESTORE_CONSENT_TYPEHASH, tokenId, keccak256(bytes(reasonURI)), uint256(r.nonce))),
            protectorConsent
        );
        r.nonce++;
        r.status = STATUS_ACTIVE;
        r.voidReason = 0;
        _setTraitRaw(tokenId, KEY_STATUS, abi.encode(STATUS_ACTIVE));
        emit IDeedTrust.DeedRestored(tokenId, msg.sender, reasonURI);
    }

    // =====================================================================
    // Consent
    // =====================================================================

    /// @notice The "second call" form of consent: approve an EIP-712 digest (from one of the *Digest views) so a
    ///         later call can use it without a signature. Each approval is used once.
    function approveTrustAction(bytes32 digest) external {
        _trustApprovals[msg.sender][digest] = true;
        emit IDeedTrust.TrustActionApproved(msg.sender, digest);
    }

    function trusteeAcceptanceDigest(uint256 tokenId, address trustee) external view returns (bytes32) {
        return _digest(_trusteeAcceptanceHash(tokenId, trustee, _trust[tokenId].nonce));
    }

    function standbyAcceptanceDigest(uint256 tokenId, address standby) external view returns (bytes32) {
        return _digest(keccak256(abi.encode(STANDBY_ACCEPTANCE_TYPEHASH, tokenId, standby, uint256(_trust[tokenId].nonce))));
    }

    function agreementConsentDigest(uint256 tokenId, bytes32 agreementHash, bytes32[] calldata riderHashes)
        external
        view
        returns (bytes32)
    {
        return _digest(keccak256(abi.encode(
            AGREEMENT_CONSENT_TYPEHASH, tokenId, agreementHash, keccak256(abi.encodePacked(riderHashes)), uint256(_trust[tokenId].nonce)
        )));
    }

    function correctionConsentDigest(uint256 tokenId, string calldata newDefinition, string calldata reasonURI)
        external
        view
        returns (bytes32)
    {
        return _digest(keccak256(abi.encode(
            CORRECTION_CONSENT_TYPEHASH, tokenId, keccak256(bytes(newDefinition)), keccak256(bytes(reasonURI)), uint256(_trust[tokenId].nonce)
        )));
    }

    function restoreConsentDigest(uint256 tokenId, string calldata reasonURI) external view returns (bytes32) {
        return _digest(keccak256(abi.encode(
            RESTORE_CONSENT_TYPEHASH, tokenId, keccak256(bytes(reasonURI)), uint256(_trust[tokenId].nonce)
        )));
    }

    function licensingConsentDigest(uint256 tokenId, address standby, bytes32 docHash) external view returns (bytes32) {
        return _digest(keccak256(abi.encode(
            LICENSING_CONSENT_TYPEHASH, tokenId, standby, docHash, uint256(_trust[tokenId].nonce)
        )));
    }

    // freezeConsentDigest is served by DeedNFTMintExtension, which has the room (Phase 4c).

    // =====================================================================
    // Views
    // =====================================================================

    function trustRecordOf(uint256 tokenId) external view returns (IDeedTrust.TrustRecord memory) {
        return _trust[tokenId];
    }

    function isTrustDeed(uint256 tokenId) external view returns (bool) {
        return _trust[tokenId].agreementHash != bytes32(0);
    }

    /// @notice Permanent: true for every burned deed (brief item 1).
    function isRetired(uint256 tokenId) public view returns (bool) {
        return _trust[tokenId].status == STATUS_RETIRED || (_everMinted[tokenId] && !_exists(tokenId));
    }

    /// @notice 0 Active, 1 Retired, 2 Void.
    function statusOf(uint256 tokenId) external view returns (uint8) {
        if (!_known(tokenId)) revert IDeedTrust.UnknownDeed();
        return isRetired(tokenId) ? STATUS_RETIRED : _trust[tokenId].status;
    }

    /// @notice The effective protector: the recorded one, or the current holder while the record is zero.
    function protectorOf(uint256 tokenId) external view returns (address) {
        return _protector(_trust[tokenId], ownerOf(tokenId));
    }

    /// @notice The address the token last came from; returning it there is always allowed (brief item 9(b)).
    function lastFromOf(uint256 tokenId) external view returns (address) {
        return _trust[tokenId].lastFrom;
    }

    function reservationOf(uint256 deedId) external view returns (IDeedTrust.Reservation memory) {
        return _reservations[deedId];
    }

    /**
     * @notice Brief item 5: the token holder, unless the holder is a registered Functional Contract, in which case
     *         whoever it holds the deed for (its depositor or designated buyer).
     */
    function beneficialOwnerOf(uint256 tokenId) external view returns (address) {
        address holder = ownerOf(tokenId);
        (uint8 kinds, ) = _fcKind(holder);
        if (kinds != 0) {
            try IDeedCustody(holder).beneficialOwnerOf(tokenId) returns (address b) {
                if (b != address(0)) return b;
            } catch {}
        }
        return holder;
    }

    function trustRegistries() external view returns (address, address) {
        return (_fcRegistry, _membershipRegistry);
    }

    // =====================================================================
    // Setup
    // =====================================================================

    /**
     * @notice Sets the Functional Contract registry and the MembershipRegistry. Each can be set once; a zero
     *         argument leaves that one as it is. Changing one afterwards takes an upgrade (behind the timelock),
     *         so this adds no standing power over deeds. Also names the reserved trust traits.
     */
    function setTrustRegistries(address functionalContractRegistry, address membershipRegistry)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (functionalContractRegistry != address(0)) {
            if (_fcRegistry != address(0) && _fcRegistry != functionalContractRegistry) revert IDeedTrust.RegistryAlreadySet();
            _fcRegistry = functionalContractRegistry;
        }
        if (membershipRegistry != address(0)) {
            if (_membershipRegistry != address(0) && _membershipRegistry != membershipRegistry) revert IDeedTrust.RegistryAlreadySet();
            _membershipRegistry = membershipRegistry;
        }
        _traitNames[KEY_AGREEMENT_HASH] = "Agreement Hash";
        _traitNames[KEY_RIDER_HASHES] = "Rider Hashes";
        _traitNames[KEY_TRUSTEE] = "Trustee";
        _traitNames[KEY_PROTECTOR] = "Protector";
        _traitNames[KEY_STANDBY] = "Standby Trustee";
        _traitNames[KEY_SUSPENDED] = "Trustee Suspended";
        _traitNames[KEY_TRANSFER_POLICY] = "Transfer Policy";
        _traitNames[KEY_STATUS] = "Status";
        _traitNames[KEY_PROGRAM_ID] = "Program";
        _traitNames[KEY_PROGRAM_SPONSOR] = "Program Sponsor";
        _traitNames[KEY_TITLE_ADMIN] = "Title Administrator";
        _traitNames[KEY_PROGRAM_PARAMS] = "Program Parameters";
        _traitNames[KEY_MINT_PARAMS] = "Mint Parameters Hash";
        emit IDeedTrust.TrustRegistriesSet(_fcRegistry, _membershipRegistry);
    }

    // =====================================================================
    // Internal helpers
    // =====================================================================

    function _liveTrust(uint256 tokenId) internal view returns (IDeedTrust.TrustRecord storage r) {
        if (!_exists(tokenId)) revert IDeedTrust.UnknownDeed();
        r = _trust[tokenId];
        if (r.agreementHash == bytes32(0)) revert IDeedTrust.NotTrustDeed();
    }

    function _protector(IDeedTrust.TrustRecord storage r, address holder) internal view returns (address) {
        return r.protector != address(0) ? r.protector : holder;
    }
}
