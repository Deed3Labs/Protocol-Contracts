// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IDeedTrust
 * @notice The trust agreement v5 surface of DeedNFT (brief items 1-10, Addendum 1, Addendum 2).
 * @dev These functions are served at the DeedNFT proxy address by `DeedNFTExtension`, which DeedNFT
 *      reaches by delegatecall from its fallback. Call them on the DeedNFT address with this ABI.
 *
 *      Roles on a trust deed:
 *      - holder: `ownerOf(tokenId)`.
 *      - protector: the recorded protector, or the current holder while the record is zero
 *        (Addendum 1: the role then passes automatically with the token).
 *      - trustee: always set on a trust deed; an eligible trustee (signer of an active validator, or a
 *        licensed trustee in ValidatorRegistry) that accepted and is not the holder.
 *      - standby trustee: optional, pre-accepted, promoted by `applyLicensingDetermination` (on its own
 *        call, only with the protector's consent: re-review M-G).
 *      None of trustee, standby or protector can transfer, burn or freeze the token.
 */
interface IDeedTrust {
    // ============ Types ============

    /// @dev Values of the `transferPolicy` trait.
    /// Open = 0: any transfer (subject to the marketplace list).
    /// Verified = 1: recipient must hold a membership record that is not revoked or suspended (DECISIONS #9).
    /// Coop = 2: transfers complete only through a registered CoopTransferAgent (right of first refusal).

    /// @dev Values of the `status` trait: Active = 0, Retired = 1 (burned), Void = 2 (markVoid).

    /// @notice A program (Addendum 1). programId == 0 means no program applies.
    /// @dev The full parameter document (rofrPriceBasis, successorPeriodMonths, successorPurchaseBasis,
    ///      acquisitionMode, arbitration, feeSchedule) lives off chain under `paramsHash`. Only the values a
    ///      contract must read are stored as fields. There is deliberately no trustee-fee field, and no
    ///      contract routes funds to a trustee (Addendum 2).
    struct Program {
        bytes32 programId;
        address sponsor;             // becomes the protector
        address titleAdministrator;  // default trustee
        bytes32 paramsHash;          // content hash of the parameter document
        uint16 rofrPeriodDays;       // 0 = 30
        uint16 completionWindowDays; // 0 = 90
        bool versionConsentRequired;
    }

    /// @notice Everything a trust deed is minted with.
    /// @dev The Deed ID commits to agreementHash, the rider hashes and the identity (asset type,
    ///      definition, parcelRef, owner as reserver, salt). Every field is also folded into the
    ///      `mintParamsHash` trait (DECISIONS, Addendum 1 item 2).
    struct TrustMintParams {
        address owner;          // the grantor; also the reserver in the Deed ID
        uint8 assetType;        // Land (0) or Estate (2) only
        string definition;      // legal description; immutable after mint except by correctDefinition
        bytes32 parcelRef;      // hash of the county and APN (or other recording locator)
        uint256 salt;
        bytes32 agreementHash;  // must be adopted by the deed's validator for this asset type
        bytes32[] riderHashes;  // each must be adopted too
        string configuration;
        string uri;             // fallback token URI
        address validator;      // 0 = default validator
        address token;          // fee token when a FundManager is set
        address trustee;        // 0 = program titleAdministrator
        address protector;      // 0 = holder; must be 0 or the sponsor when a program applies
        uint8 transferPolicy;   // 0 Open, 1 Verified, 2 Coop
        Program program;
    }

    /// @notice The per-deed trust state. Mirrored into reserved ERC-7496 traits.
    struct TrustRecord {
        bytes32 agreementHash;
        bytes32 ridersHash;
        address trustee;
        bool trusteeSuspended;
        uint8 transferPolicy;
        uint8 status;
        uint8 voidReason;
        bool versionConsentRequired;
        uint16 rofrPeriodDays;
        uint16 completionWindowDays;
        address protector;
        uint64 nonce;
        address standbyTrustee;
        address lastFrom;
        bytes32 programId;
        address programSponsor;
        address titleAdministrator;
        bytes32 programParamsHash;
    }

    struct Reservation {
        address reserver;
        bytes32 agreementHash;
        bytes32 identityHash;
    }

    // ============ Events ============

    event DeedIdReserved(uint256 indexed deedId, address indexed reserver, bytes32 agreementHash, bytes32 ridersHash, bytes32 identityHash);
    event TrustDeedMinted(uint256 indexed tokenId, address indexed owner, bytes32 agreementHash, bytes32 ridersHash, bytes32 identityHash, bytes32 mintParamsHash);
    /// @notice Emitted on every burn (brief item 1): the record a trustee shows before signing the deed out of trust.
    event DeedRetired(
        uint256 indexed tokenId,
        address indexed holder,
        bytes32 definitionHash,
        bytes32 operatingAgreementHash,
        bytes32 configurationHash,
        bytes32 agreementHash,
        bytes32 ridersHash
    );
    event TrusteeChanged(uint256 indexed tokenId, address indexed previousTrustee, address indexed newTrustee);
    event ProtectorChanged(uint256 indexed tokenId, address indexed previousProtector, address indexed newProtector);
    event StandbyTrusteeChanged(uint256 indexed tokenId, address indexed previousStandby, address indexed newStandby);
    event TrusteeSuspended(uint256 indexed tokenId, address indexed trustee);
    event StandbyPromoted(uint256 indexed tokenId, address indexed previousTrustee, address indexed newTrustee);
    event AgreementVersionElected(uint256 indexed tokenId, bytes32 previousAgreementHash, bytes32 agreementHash, bytes32 ridersHash);
    event MetadataCorrected(uint256 indexed tokenId, bytes32 indexed field, bytes32 oldHash, bytes32 newHash, string reasonURI);
    /// @notice `trustee` and `protector` are as of the posting (DECISIONS, Addendum 1 item 5); `protector`
    ///         is the effective protector (the holder while the record is zero).
    event NoticePosted(uint256 indexed tokenId, address indexed sender, bytes32 docHash, string uri, address trustee, address protector);
    event DeedVoided(uint256 indexed tokenId, uint8 reasonCode, bytes32 recordingRefHash, string uri, bool transferable);
    /// @notice A Void was lifted by the deed's validator with the protector's consent (re-review M-F).
    event DeedRestored(uint256 indexed tokenId, address indexed validator, string reasonURI);
    /// @notice A freezing Void took two distinct signers of the deed's validator (Phase 4c): `proposer`
    ///         consented (FreezeConsent) and `confirmer` made the call.
    event DeedFreezeConfirmed(uint256 indexed tokenId, address indexed proposer, address indexed confirmer);
    event TrustActionApproved(address indexed signer, bytes32 indexed digest);
    event TrustRegistriesSet(address functionalContractRegistry, address membershipRegistry);

    // ============ Errors ============

    error TrustDeedRequired();
    error NotTrustDeed();
    error AssetTypeOutsideAgreement();
    error AgreementNotAdopted(bytes32 hash);
    error DeedIdUnavailable(uint256 deedId);
    error TrusteeNotEligible(address account);
    error RoleConflict();
    error ConsentMissing(address signer);
    error NotProtector();
    error NotHolder();
    error NotTrustParty();
    error InvalidTransferPolicy();
    error ProgramRequired();
    error ProtectorNotSponsor();
    error TransferToTrustee();
    error TransferPolicyBlocked(uint8 policy);
    error DeedFrozen();
    error NotActive();
    error FreezeNeedsValidator();
    error DefinitionLocked();
    error UseTrustPaths();
    error UnknownDeed();
    error RegistryAlreadySet();
    error NotVoid();
    /// @dev Phase 4c: a freezing Void needs a second signer of the deed's validator, other than the caller
    ///      and the trustee.
    error FreezeNeedsSecondSigner(address cosigner);

    // ============ Mint and IDs ============

    function computeDeedId(
        uint8 assetType,
        bytes32 definitionHash,
        bytes32 parcelRef,
        address reserver,
        uint256 salt,
        bytes32 agreementHash,
        bytes32[] calldata riderHashes
    ) external pure returns (uint256 deedId, bytes32 identityHash);

    function reserveId(
        uint8 assetType,
        bytes32 definitionHash,
        bytes32 parcelRef,
        uint256 salt,
        bytes32 agreementHash,
        bytes32[] calldata riderHashes
    ) external returns (uint256 deedId);

    function reservationOf(uint256 deedId) external view returns (Reservation memory);

    function mintTrustDeed(TrustMintParams calldata p, bytes calldata trusteeAcceptance) external returns (uint256 tokenId);

    // ============ Roles ============

    function setTrustee(uint256 tokenId, address newTrustee, bytes calldata acceptance) external;
    function setProtector(uint256 tokenId, address newProtector) external;
    function setStandbyTrustee(uint256 tokenId, address standby, bytes calldata acceptance) external;
    /// @dev Re-review M-G: on the standby's own call, promotion needs `protectorConsent` (LicensingConsent);
    ///      without it only the notice is posted. Ignored on the protector's and the trustee's calls.
    function applyLicensingDetermination(uint256 tokenId, bytes32 docHash, string calldata uri, bytes calldata protectorConsent) external;

    // ============ Agreement and metadata ============

    function electAgreementVersion(uint256 tokenId, bytes32 agreementHash, bytes32[] calldata riderHashes, bytes calldata protectorConsent) external;
    function correctDefinition(uint256 tokenId, string calldata newDefinition, string calldata reasonURI, bytes calldata protectorConsent) external;

    // ============ Status and notices ============

    function postNotice(uint256 tokenId, bytes32 docHash, string calldata uri) external;
    /// @dev Phase 4c: a freezing code (from 128) needs `cosigner`, a second signer of the deed's validator
    ///      (not the caller, not the trustee), to consent by FreezeConsent: by signature in `cosignerConsent`,
    ///      or by a prior approveTrustAction with `cosignerConsent` empty. Both are ignored below 128.
    function markVoid(
        uint256 tokenId,
        uint8 reasonCode,
        bytes32 recordingRefHash,
        string calldata uri,
        address cosigner,
        bytes calldata cosignerConsent
    ) external;
    /// @notice Re-review M-F: the deed's validator lifts a Void with the protector's consent (RestoreConsent).
    function restoreFromVoid(uint256 tokenId, string calldata reasonURI, bytes calldata protectorConsent) external;

    // ============ Consent ============

    function approveTrustAction(bytes32 digest) external;
    function trusteeAcceptanceDigest(uint256 tokenId, address trustee) external view returns (bytes32);
    function standbyAcceptanceDigest(uint256 tokenId, address standby) external view returns (bytes32);
    function agreementConsentDigest(uint256 tokenId, bytes32 agreementHash, bytes32[] calldata riderHashes) external view returns (bytes32);
    function correctionConsentDigest(uint256 tokenId, string calldata newDefinition, string calldata reasonURI) external view returns (bytes32);
    function restoreConsentDigest(uint256 tokenId, string calldata reasonURI) external view returns (bytes32);
    function licensingConsentDigest(uint256 tokenId, address standby, bytes32 docHash) external view returns (bytes32);
    function freezeConsentDigest(uint256 tokenId, uint8 reasonCode, bytes32 recordingRefHash, string calldata uri) external view returns (bytes32);

    // ============ Views ============

    function trustRecordOf(uint256 tokenId) external view returns (TrustRecord memory);
    function isTrustDeed(uint256 tokenId) external view returns (bool);
    function isRetired(uint256 tokenId) external view returns (bool);
    function statusOf(uint256 tokenId) external view returns (uint8);
    function protectorOf(uint256 tokenId) external view returns (address);
    function lastFromOf(uint256 tokenId) external view returns (address);
    function beneficialOwnerOf(uint256 tokenId) external view returns (address);
    function trustRegistries() external view returns (address functionalContractRegistry, address membershipRegistry);

    // ============ Setup ============

    function setTrustRegistries(address functionalContractRegistry, address membershipRegistry) external;
}
