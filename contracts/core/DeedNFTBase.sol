// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC721URIStorageUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC2981Upgradeable.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./interfaces/IValidator.sol";
import "./interfaces/IFundManager.sol";
import "./interfaces/IMetadataRenderer.sol";
import "./interfaces/IDeedTrust.sol";

/// @dev Narrow registry view for per-deed validator authority (audit D-2, D-7).
interface IValidatorSignerRegistry {
    function isValidatorSigner(address validator, address account) external view returns (bool);
}

/**
 * @title DeedNFTBase
 * @notice Storage, inheritance and shared internals of DeedNFT.
 * @dev DeedNFT ran out of room under EIP-170 (24,546 of 24,576 bytes after Phase 1), and trust agreement v5
 *      needs a lot more code. Following the TermIssuer split, DeedNFT and DeedNFTExtension both inherit this
 *      contract, so they see the same storage at the same slots. DeedNFT creates the extension in its
 *      constructor, pins it as an immutable and runs it by delegatecall against the proxy's storage.
 *
 *      Storage is DeedNFT's Phase 1 layout, unchanged and in the same order, with the trust state appended
 *      after `_tokenTraitKeys`. Nothing here may be reordered.
 */
abstract contract DeedNFTBase is
    Initializable,
    ERC721Upgradeable,
    ERC721URIStorageUpgradeable,
    ERC721EnumerableUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IERC2981Upgradeable
{
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.Bytes32Set;

    // ============ Role Definitions ============
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ============ Asset Types ============
    enum AssetType {
        Land,
        Vehicle,
        Estate,
        CommercialEquipment
    }

    // ============ State Variables (Phase 1 layout) ============
    uint256 public nexttokenId;
    address internal defaultValidator;
    address internal validatorRegistry;
    string internal _contractURI;
    address public metadataRenderer;

    mapping(address => bool) internal _approvedMarketplaces;
    bool internal _enforceRoyalties;
    /// @dev Unused since audit D-18; kept for storage layout.
    address internal _transferValidator;

    /// @dev ERC-7496 trait storage: token ID => trait key => value.
    mapping(uint256 => mapping(bytes32 => bytes)) internal _tokenTraits;
    /// @dev ERC-7496 trait names.
    mapping(bytes32 => string) internal _traitNames;
    /// @dev Unused since audit D-12; kept for storage layout.
    bytes32[] internal _allTraitKeys;

    uint256[45] private __gap;

    /// @dev Count of live tokens.
    uint256 internal _activeTokenCount;

    IFundManager public fundManager;

    /// @dev Every token ID ever minted, kept after burn (audit D-8).
    mapping(uint256 => bool) internal _everMinted;

    /// @dev Per-token trait key sets (audit D-12).
    mapping(uint256 => EnumerableSetUpgradeable.Bytes32Set) internal _tokenTraitKeys;

    // ============ Trust agreement v5 state (appended) ============

    /// @dev Per-deed trust record; the reserved trust traits mirror it. agreementHash != 0 marks a trust deed.
    mapping(uint256 => IDeedTrust.TrustRecord) internal _trust;
    /// @dev Deed IDs reserved before the deed into trust is recorded (brief item 2).
    mapping(uint256 => IDeedTrust.Reservation) internal _reservations;
    /// @dev Consent given by a prior call instead of a signature: signer => EIP-712 digest => approved.
    mapping(address => mapping(bytes32 => bool)) internal _trustApprovals;
    /// @dev Set once (setTrustRegistries); changing either afterwards takes an upgrade.
    address internal _fcRegistry;
    address internal _membershipRegistry;

    // ============ Phase 4b (re-review M-F), appended ============

    /// @dev A trust deed's validator reassignment, waiting out the delay. Until `effectiveAt` the old
    ///      validator is still the deed's validator, and may still void it.
    struct PendingValidator {
        address validator;
        uint64 effectiveAt;
    }
    mapping(uint256 => PendingValidator) internal _pendingValidator;
    /// @dev The governed delay before a trust deed's validator reassignment takes effect; zero means
    ///      the default of 7 days. Set by the admin (the Deed timelock), within bounds.
    uint64 internal _validatorReassignDelay;

    // ============ Shared constants ============

    /// @dev Salted and trust IDs live in [2^127, 2^128): above any reachable sequential ID, and below 2^128
    ///      so Subdivide's `(deedId << 128) | unitId` packing stays collision-free (audit D-8).
    uint256 internal constant SALTED_ID_FLAG = 1 << 127;

    bytes32 internal constant KEY_ASSET_TYPE = keccak256("assetType");
    bytes32 internal constant KEY_IS_VALIDATED = keccak256("isValidated");
    bytes32 internal constant KEY_OPERATING_AGREEMENT = keccak256("operatingAgreement");
    bytes32 internal constant KEY_DEFINITION = keccak256("definition");
    bytes32 internal constant KEY_CONFIGURATION = keccak256("configuration");
    bytes32 internal constant KEY_VALIDATOR = keccak256("validator");
    bytes32 internal constant KEY_BENEFICIARY = keccak256("beneficiary");

    // ============ Events ============
    event DeedNFTMinted(uint256 indexed tokenId, AssetType assetType, address indexed minter, address validator);
    event DeedNFTBurned(uint256 indexed tokenId);
    event MetadataRendererUpdated(address indexed renderer);
    event ContractURIUpdated(string newURI);
    event TraitUpdated(bytes32 indexed traitKey, uint256 indexed tokenId, bytes traitValue);
    event DeedValidated(uint256 indexed tokenId, bool isValid);
    event MarketplaceApproved(address indexed marketplace, bool approved);
    event RoyaltyEnforcementChanged(bool enforced);
    /// @notice Phase 4c: a trust deed changed hands (or was burned) with a validator reassignment pending, so the
    ///         request lapsed; the new holder decides.
    event ValidatorReassignmentCancelled(uint256 indexed tokenId, address indexed validator);

    // ============ Errors ============
    /// @dev Caller is neither the deed's holder nor a signer of the deed's own validator.
    error NotDeedEditor();
    /// @dev Caller is not the validator recorded on this deed.
    error NotDeedValidator();
    /// @dev The holder tried to change a trait the validator vouched for.
    error ValidatedTraitLocked();
    /// @dev A holder changes the operating agreement only through updateMetadata (audit D-1, D-14).
    error AgreementViaUpdateMetadata();
    /// @dev The chosen validator is not active, does not implement IValidator, or does not support the asset type.
    error ValidatorNotUsable();
    /// @dev The transfer hook is internal plumbing; it cannot be called from outside.
    error HookOnly();

    // ============ Shared internals ============

    function _exists(uint256 tokenId) internal view override returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /// @dev Live or ever minted. Burned deeds stay readable (brief item 1).
    function _known(uint256 tokenId) internal view returns (bool) {
        return _everMinted[tokenId] || _exists(tokenId);
    }

    /// @dev The validator recorded on the deed, falling back to the default validator (audit D-15).
    function _validatorOf(uint256 tokenId) internal view returns (address validator) {
        bytes memory raw = _tokenTraits[tokenId][KEY_VALIDATOR];
        if (raw.length > 0) validator = abi.decode(raw, (address));
        if (validator == address(0)) validator = defaultValidator;
    }

    /// @dev `account` is the deed's recorded (active) validator contract or one of its signers.
    function _isDeedValidator(uint256 tokenId, address account) internal view returns (bool) {
        return IValidatorSignerRegistry(validatorRegistry).isValidatorSigner(_validatorOf(tokenId), account);
    }

    /// @dev Caller is the deed's own validator (or a signer of it), or the holder (audit D-2).
    function _requireEditor(uint256 tokenId) internal view returns (bool byValidator) {
        byValidator = _isDeedValidator(tokenId, msg.sender);
        if (!byValidator && ownerOf(tokenId) != msg.sender) revert NotDeedEditor();
    }

    /// @dev Writes a trait and tells the renderer (display traits).
    function _setTraitValue(uint256 tokenId, bytes32 traitKey, bytes memory traitValue) internal {
        _setTraitRaw(tokenId, traitKey, traitValue);
        // Sync with MetadataRenderer if set; a failed sync is not critical.
        if (metadataRenderer != address(0)) {
            try IMetadataRenderer(metadataRenderer).syncTraitUpdate(tokenId, traitKey, traitValue) {} catch {}
        }
    }

    /// @dev Writes a trait without the renderer sync. Used for the reserved trust traits, which are not
    ///      strings and which the renderer does not store.
    function _setTraitRaw(uint256 tokenId, bytes32 traitKey, bytes memory traitValue) internal {
        require(_exists(tokenId), "Token does not exist");
        _tokenTraitKeys[tokenId].add(traitKey);
        _tokenTraits[tokenId][traitKey] = traitValue;
        emit TraitUpdated(traitKey, tokenId, traitValue);
    }

    /// @dev Salted legacy IDs (audit D-8).
    function _saltedId(address owner, AssetType assetType, string memory definition, uint256 salt) internal pure returns (uint256) {
        uint256 h = uint256(keccak256(abi.encodePacked(owner, uint8(assetType), definition, salt)));
        return (h & (SALTED_ID_FLAG - 1)) | SALTED_ID_FLAG;
    }

    // ============ Transfer hook ============

    /**
     * @dev Runs on every mint, transfer and burn. The policy, custody, trustee and retirement rules live in
     *      DeedNFTExtension (`_transferHook`); DeedNFT reaches it by delegatecall, the extension calls it
     *      directly for its own mints.
     */
    function _beforeTokenTransfer(address from, address to, uint256 tokenId, uint256 batchSize)
        internal
        virtual
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
    {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        if (batchSize == 0) return;
        _transferHook(from, to, tokenId);
    }

    function _transferHook(address from, address to, uint256 tokenId) internal virtual;

    // ============ Required overrides ============

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function _burn(uint256 tokenId) internal virtual override(ERC721Upgradeable, ERC721URIStorageUpgradeable) {
        super._burn(tokenId);
    }

    function _setTokenURI(uint256 tokenId, string memory _tokenURI) internal virtual override {
        require(_exists(tokenId), "Token does not exist");
        super._setTokenURI(tokenId, _tokenURI);
    }

    /// @dev See {IERC721Metadata-tokenURI}. The renderer first, the stored URI as fallback.
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        if (metadataRenderer != address(0)) {
            try IMetadataRenderer(metadataRenderer).tokenURI(tokenId) returns (string memory renderedURI) {
                if (bytes(renderedURI).length > 0) return renderedURI;
            } catch {}
        }
        return ERC721URIStorageUpgradeable.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable, ERC721EnumerableUpgradeable, AccessControlUpgradeable, IERC165Upgradeable)
        returns (bool)
    {
        // ICreatorToken is not advertised or implemented (audit D-18).
        return
            interfaceId == type(IERC2981Upgradeable).interfaceId ||
            interfaceId == 0xaf332f3e || // ERC-7496 (Dynamic Traits)
            super.supportsInterface(interfaceId);
    }

    /// @dev The total number of live tokens.
    function totalSupply() public view override(ERC721EnumerableUpgradeable) returns (uint256) {
        return _activeTokenCount;
    }

    /**
     * @dev Royalties go to the deed's validator contract. A validator contract can never be a trustee
     *      (ValidatorRegistry.isEligibleTrustee), so no royalty reaches a trustee address (Addendum 2).
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        require(_exists(tokenId), "Token does not exist");
        receiver = _validatorOf(tokenId);
        require(receiver != address(0), "Invalid validator address");
        royaltyAmount = (salePrice * IValidator(receiver).getRoyaltyFeePercentage(tokenId)) / 10000;
    }
}
