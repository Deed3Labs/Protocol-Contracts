// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {IERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./DeedNFTBase.sol";
import "./DeedNFTMintExtension.sol";
import "./DeedTrustExtension.sol";
import "./interfaces/IValidatorRegistry.sol";

/**
 * @title DeedNFT
 * @dev An ERC-721 token representing deeds with complex metadata and validator integration.
 *      Implements ERC-7496 for dynamic traits and ERC-7572 for metadata rendering.
 *      Implements royalty enforcement inspired by ERC721-C.
 *
 *      Trust agreement v5: Land and Estate deeds are trust deeds (IDeedTrust). Minting and trait edits run in
 *      DeedNFTMintExtension, the rest of the trust surface and the transfer rules in DeedTrustExtension, both
 *      by delegatecall against this contract's storage (see DeedNFTBase). The legacy forwarded functions keep
 *      their ABI here; the IDeedTrust functions reach the extensions through `fallback`, so call them on this
 *      address with the IDeedTrust ABI.
 */
contract DeedNFT is DeedNFTBase {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.Bytes32Set;

    /// @notice Runs minting, Deed ID reservation, validation and trait edits.
    /// @dev Fixed with this implementation: no setter can point a live DeedNFT at other code; changing it is an
    ///      upgrade, behind the Deed timelock. Not storage.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable mintExtension;

    /// @notice Runs the trust surface (trustee, protector, agreement, notices, status) and the transfer rules.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable trustExtension;

    /// @dev Both extensions together are too large to create here (EIP-3860 caps init code at 48 KiB), so they
    ///      are deployed first and passed in; each must identify itself as the right kind.
    error ExtensionMismatch();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address mintExtension_, address trustExtension_) {
        _disableInitializers();
        if (
            IDeedNFTExtensionKind(mintExtension_).deedExtensionKind() != keccak256("DeedNFTMintExtension.v5") ||
            IDeedNFTExtensionKind(trustExtension_).deedExtensionKind() != keccak256("DeedTrustExtension.v5")
        ) revert ExtensionMismatch();
        mintExtension = mintExtension_;
        trustExtension = trustExtension_;
    }

    /**
     * @dev Initializes the contract with default validator and registry addresses.
     * @param _defaultValidator Address of the default validator contract.
     * @param _validatorRegistry Address of the validator registry contract.
     */
    function initialize(address _defaultValidator, address _validatorRegistry) public initializer {
        __ERC721_init("DeedNFT", "DEED");
        __ERC721URIStorage_init();
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // No VALIDATOR_ROLE for the deployer (audit D-2): editing rights over a deed belong to that
        // deed's own validator, never to a global key.
        _grantRole(MINTER_ROLE, msg.sender);

        defaultValidator = _defaultValidator;
        validatorRegistry = _validatorRegistry;
        nexttokenId = 1;

        _traitNames[KEY_ASSET_TYPE] = "Asset Type";
        _traitNames[KEY_IS_VALIDATED] = "Validation Status";
        _traitNames[KEY_OPERATING_AGREEMENT] = "Operating Agreement";
        _traitNames[KEY_DEFINITION] = "Definition";
        _traitNames[KEY_CONFIGURATION] = "Configuration";
        _traitNames[KEY_VALIDATOR] = "Validator";

        setToDefaultSecurityPolicy();
    }

    modifier onlyAdminOrRegistry() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || msg.sender == validatorRegistry, "Not admin or registry");
        _;
    }

    // ============ Admin ============
    // Every admin function sits behind DEFAULT_ADMIN_ROLE, which deploy/deed_admin_handover.ts gives to the
    // Deed TimelockController (Foundation multisig proposer, 7-day minimum delay; brief item 6, DECISIONS #10).
    // None of them can transfer a deed or change its holder, definition, agreement, riders, trustee or
    // protector.

    /// @dev Pauses minting, trait edits and validation. Never burns, transfers or trust-role changes.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setDefaultValidator(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(validator != address(0), "Invalid validator address");
        require(IValidatorRegistry(validatorRegistry).isValidatorRegistered(validator), "Validator not registered");
        defaultValidator = validator;
    }

    function setValidatorRegistry(address registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(registry != address(0), "Invalid registry address");
        validatorRegistry = registry;
    }

    /// @dev The renderer gets no role and no write power over deeds (audit D-2).
    function setMetadataRenderer(address renderer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(renderer != address(0), "Invalid renderer address");
        // Older deployments granted the renderer VALIDATOR_ROLE; take it back if present.
        if (metadataRenderer != address(0)) _revokeRole(VALIDATOR_ROLE, metadataRenderer);
        metadataRenderer = renderer;
        emit MetadataRendererUpdated(renderer);
    }

    function addMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(minter != address(0), "Invalid minter address");
        _grantRole(MINTER_ROLE, minter);
    }

    function removeMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
    }

    function addValidator(address validator) external onlyAdminOrRegistry {
        require(validator != address(0), "Invalid validator address");
        _grantRole(VALIDATOR_ROLE, validator);
    }

    function removeValidator(address validator) external onlyAdminOrRegistry {
        _revokeRole(VALIDATOR_ROLE, validator);
    }

    function setFundManager(address _fundManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_fundManager != address(0), "Invalid FundManager address");
        fundManager = IFundManager(_fundManager);
    }

    // ============ IDs ============

    /**
     * @dev Salted ID for the legacy mint (Vehicle, CommercialEquipment). Audit D-8: 127 bits of the hash
     *      with bit 127 set, in [2^127, 2^128). Uniqueness over all time is enforced at mint.
     */
    function generateUniqueTokenId(address owner, AssetType assetType, string memory definition, uint256 salt)
        public
        pure
        returns (uint256)
    {
        return _saltedId(owner, assetType, definition, salt);
    }

    /// @notice Whether a token ID has ever been minted (including burned deeds). It can never be minted again.
    function wasEverMinted(uint256 tokenId) external view returns (bool) {
        return _everMinted[tokenId];
    }

    // ============ Forwarded to the mint extension (ABI kept here) ============

    /// @notice see DeedNFTMintExtension.mintAsset. Vehicle and CommercialEquipment only; Land and Estate are
    ///         minted with IDeedTrust.mintTrustDeed.
    function mintAsset(address, AssetType, string calldata, string calldata, string calldata, address, address, uint256)
        external
        returns (uint256)
    {
        _forward(mintExtension);
    }

    /// @notice see DeedNFTMintExtension.setTrait.
    function setTrait(uint256, bytes calldata, bytes calldata, uint8) external {
        _forward(mintExtension);
    }

    /// @notice see DeedNFTMintExtension.removeTrait.
    function removeTrait(uint256, string calldata) external {
        _forward(mintExtension);
    }

    /// @notice The IDeedTrust surface: mintTrustDeed, reserveId and computeDeedId run in the mint extension,
    ///         everything else in the trust extension. The transfer hook's entry point is refused.
    fallback() external {
        bytes4 s = msg.sig;
        if (s == DeedTrustExtension.transferHook.selector) revert HookOnly();
        _forward(
            s == IDeedTrust.mintTrustDeed.selector || s == IDeedTrust.reserveId.selector || s == IDeedTrust.computeDeedId.selector
                ? mintExtension
                : trustExtension
        );
    }

    /// @dev Runs `target`'s implementation of this call against this contract's storage, and returns or reverts
    ///      exactly as it did.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _forward(address target) private {
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    /// @dev Runs the extension's transfer rules against this storage, with the original caller as operator.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _transferHook(address from, address to, uint256 tokenId) internal override {
        (bool ok, bytes memory ret) =
            trustExtension.delegatecall(abi.encodeWithSelector(DeedTrustExtension.transferHook.selector, from, to, tokenId));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    // ============ Validation and legacy metadata ============

    /// @dev Only the validator recorded on the deed gives or withdraws its verdict (audit D-7).
    function updateValidationStatus(uint256 tokenId, bool isValid, address validatorAddress)
        external
        whenNotPaused
        onlyRole(VALIDATOR_ROLE)
    {
        require(_exists(tokenId), "Deed does not exist");
        require(validatorAddress == msg.sender, "Validator mismatch");
        require(IValidatorRegistry(validatorRegistry).isValidatorActive(msg.sender), "Validator not active");
        if (_validatorOf(tokenId) != msg.sender) revert NotDeedValidator();
        _setTraitValue(tokenId, KEY_IS_VALIDATED, abi.encode(isValid));
        _setTraitValue(tokenId, KEY_VALIDATOR, abi.encode(msg.sender));
        emit DeedValidated(tokenId, isValid);
    }

    /**
     * @notice The holder moves the deed to another active (registry-vetted) validator. Validation resets; this
     *         is the only way a deed changes validator (audit D-7); no admin path exists.
     */
    function reassignValidator(uint256 tokenId, address newValidator) external whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "Not deed owner");
        if (!IValidatorRegistry(validatorRegistry).isValidatorActive(newValidator)) revert ValidatorNotUsable();
        _setTraitValue(tokenId, KEY_IS_VALIDATED, abi.encode(false));
        _setTraitValue(tokenId, KEY_VALIDATOR, abi.encode(newValidator));
    }

    /**
     * @dev Updates a legacy deed's metadata (owner or the deed's own validator). If called by the owner,
     *      validation resets but the validator record is kept (audit D-15). A trust deed's agreement changes
     *      only by electAgreementVersion and its definition only by correctDefinition (brief items 3 and 4), so
     *      this reverts on trust deeds.
     */
    function updateMetadata(
        uint256 tokenId,
        string calldata uri,
        string calldata operatingAgreement,
        string calldata definition,
        string calldata configuration
    ) external whenNotPaused {
        bool byValidator = _requireEditor(tokenId);
        if (_trust[tokenId].agreementHash != bytes32(0)) revert IDeedTrust.UseTrustPaths();
        require(bytes(operatingAgreement).length > 0, "Operating agreement cannot be empty");
        require(bytes(definition).length > 0, "Definition cannot be empty");
        address validatorAddress = _validatorOf(tokenId);
        require(validatorAddress != address(0), "No validator available");
        require(bytes(IValidator(validatorAddress).operatingAgreementName(operatingAgreement)).length > 0, "Invalid operating agreement");
        if (bytes(uri).length > 0) _setTokenURI(tokenId, uri);
        _setTraitValue(tokenId, KEY_OPERATING_AGREEMENT, abi.encode(operatingAgreement));
        _setTraitValue(tokenId, KEY_DEFINITION, abi.encode(definition));
        _setTraitValue(tokenId, KEY_CONFIGURATION, abi.encode(configuration));
        if (!byValidator) _setTraitValue(tokenId, KEY_IS_VALIDATED, abi.encode(false));
    }

    // ============ Burning ============

    /**
     * @dev Burns a deed owned by the caller. Never pausable (audit D-17, brief item 6): an owner can always
     *      exit. The ID stays in `_everMinted` and can never be minted again, the traits stay readable, the
     *      status becomes Retired and DeedRetired records the hashes the trustee needs (brief item 1).
     */
    function burnAsset(uint256 tokenId) public {
        require(ownerOf(tokenId) == msg.sender, "Not deed owner");
        _burn(tokenId);
        emit DeedNFTBurned(tokenId);
    }

    /// @dev Batch burn; burnAsset checks ownership of each deed.
    function burnBatchAssets(uint256[] memory tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            burnAsset(tokenIds[i]);
        }
    }

    // ============ Views ============

    /// @notice Whether `account` may act as this deed's validator (used by MetadataRenderer).
    function isDeedValidator(uint256 tokenId, address account) external view returns (bool) {
        return _exists(tokenId) && _isDeedValidator(tokenId, account);
    }

    /// @notice ERC-7496. Readable after burn: a retired deed keeps its record (brief item 1).
    function getTraitValue(uint256 tokenId, bytes32 traitKey) external view returns (bytes memory) {
        require(_known(tokenId), "Token does not exist");
        return _tokenTraits[tokenId][traitKey];
    }

    /// @notice ERC-7496. Readable after burn.
    function getTraitValues(uint256 tokenId, bytes32[] calldata traitKeys) external view returns (bytes[] memory values) {
        require(_known(tokenId), "Token does not exist");
        values = new bytes[](traitKeys.length);
        for (uint256 i = 0; i < traitKeys.length; i++) {
            values[i] = _tokenTraits[tokenId][traitKeys[i]];
        }
    }

    /// @notice ERC-7496: this token's keys that hold a value (audit D-12). Readable after burn.
    function getTraitKeys(uint256 tokenId) external view returns (bytes32[] memory traitKeys) {
        require(_known(tokenId), "Token does not exist");
        EnumerableSetUpgradeable.Bytes32Set storage keys = _tokenTraitKeys[tokenId];
        uint256 n = keys.length();
        traitKeys = new bytes32[](n);
        uint256 count;
        for (uint256 i = 0; i < n; i++) {
            bytes32 key = keys.at(i);
            if (_tokenTraits[tokenId][key].length > 0) traitKeys[count++] = key;
        }
        assembly {
            mstore(traitKeys, count)
        }
    }

    function getTraitName(bytes32 traitKey) external view returns (string memory) {
        return _traitNames[traitKey];
    }

    /// @dev Display names only; never a value.
    function setTraitName(bytes32 traitKey, string memory traitName) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _traitNames[traitKey] = traitName;
    }

    /// @notice ERC-7496 schema pointer; the schema itself is generated by MetadataRenderer.
    function getTraitMetadataURI() external pure returns (string memory) {
        return "data:application/json;base64,eyJ0cmFpdHMiOiB7ImR5bmFtaWMiOiB0cnVlfX0=";
    }

    /// @notice ERC-7572 contract-level metadata.
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function setContractURI(string memory newURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _contractURI = newURI;
        emit ContractURIUpdated(newURI);
    }

    function getValidationStatus(uint256 tokenId) external view returns (bool isValidated, address validator) {
        require(_exists(tokenId), "Deed does not exist");
        bytes memory v = _tokenTraits[tokenId][KEY_IS_VALIDATED];
        bytes memory a = _tokenTraits[tokenId][KEY_VALIDATOR];
        isValidated = v.length > 0 ? abi.decode(v, (bool)) : false;
        validator = a.length > 0 ? abi.decode(a, (address)) : address(0);
    }

    // ============ Marketplace list (royalty enforcement) ============

    function setToDefaultSecurityPolicy() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _enforceRoyalties = true;
        emit RoyaltyEnforcementChanged(true);
    }

    function setApprovedMarketplace(address marketplace, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _approvedMarketplaces[marketplace] = approved;
        emit MarketplaceApproved(marketplace, approved);
    }

    function isApprovedMarketplace(address marketplace) public view returns (bool) {
        return _approvedMarketplaces[marketplace];
    }

    function setRoyaltyEnforcement(bool enforced) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _enforceRoyalties = enforced;
        emit RoyaltyEnforcementChanged(enforced);
    }

    function isRoyaltyEnforced() public view returns (bool) {
        return _enforceRoyalties;
    }

    /// @dev Clearing an approval (to == 0) is always allowed (audit D-18).
    function approve(address to, uint256 tokenId) public override(ERC721Upgradeable, IERC721Upgradeable) {
        if (_enforceRoyalties && to != address(0) && !_approvedMarketplaces[to]) revert("!mkt");
        super.approve(to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public override(ERC721Upgradeable, IERC721Upgradeable) {
        if (_enforceRoyalties && approved && !_approvedMarketplaces[operator]) revert("!mkt");
        super.setApprovalForAll(operator, approved);
    }
}
