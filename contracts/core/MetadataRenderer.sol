// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// OpenZeppelin Upgradeable Contracts
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {StringsUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import {Base64Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/Base64Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import {ERC721URIStorageUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";

// Libraries
import "../libraries/StringUtils.sol";

// Interfaces
import "./interfaces/IERC7572.sol";
import "./interfaces/IDeedNFT.sol";

/**
 * @title MetadataRenderer
 * @dev Renders metadata for NFTs with dynamic trait parsing and management.
 *      Implements ERC-7572 for external metadata rendering.
 *      Handles storage and rendering of:
 *      - Default images for invalidated assets and asset types
 *      - Dynamic name generation based on traits
 *      - Token documents and document types
 *      - Asset features, legal info, and custom metadata
 *      - Gallery images and animation URLs
 */
contract MetadataRenderer is Initializable, OwnableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable, IERC7572 {
    using StringsUpgradeable for uint256;
    using StringsUpgradeable for address;
    using Base64Upgradeable for bytes;
    using StringUtils for string;

    // ============ Constants & Immutables ============
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    
    // ============ Structs ============
    /**
     * @dev Struct containing all metadata for a token
     * @param name Token name (optional, generated if not set)
     * @param description Token description
     * @param image Primary image URI
     * @param background_color Background color in hex
     * @param animation_url URL to animation if applicable
     * @param galleryImages Array of additional image URIs
     * @param documentTypes Array of document type identifiers
     * @param customMetadata JSON string of additional properties
     */
    struct TokenMetadata {
        string name;
        string description;
        string image;
        string background_color;
        string animation_url;
        string[] galleryImages;
        string[] documentTypes;
        string customMetadata;
    }

    // ============ Storage Variables ============
    // Base URI for external links
    string public baseURI;
    
    // Default images for each asset type
    mapping(uint8 => string) public assetTypeImageURIs;
    
    // Fallback image for invalidated assets
    string public invalidatedImageURI;
    
    // Mapping of token ID to its metadata
    mapping(uint256 => TokenMetadata) private tokenMetadata;
    
    // Reference to the DeedNFT contract
    IDeedNFT public deedNFT;
    
    // Registry of compatible DeedNFT contracts
    mapping(address => bool) public compatibleDeedContracts;
    address[] public deedContractsList;

    // ============ Events ============
    event TokenMetadataUpdated(uint256 indexed tokenId);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    event CompatibleDeedContractAdded(address indexed contractAddress);
    event CompatibleDeedContractRemoved(address indexed contractAddress);
    event MetadataInitialized(uint256 indexed tokenId, string ipfsHash);
    event MetadataSynced(uint256 indexed tokenId, bytes32 indexed traitKey, bytes value);
    
    // ============ Errors ============
    error Unauthorized();      // Caller lacks necessary permissions
    error Invalid();          // Combined InvalidTokenId, InvalidJson, InvalidContract, InvalidAddress
    error Empty();            // Required input is empty
    error Exists();           // Item already exists (e.g., contract already registered)

    // ============ Modifiers ============
    /**
     * @dev Ensures caller is owner, validator, or token owner
     */
    modifier onlyOwnerOrValidator(uint256 tokenId) {
        if (!(msg.sender == owner() || 
            (address(deedNFT) != address(0) && deedNFT.hasRole(VALIDATOR_ROLE, msg.sender)) ||
            (address(deedNFT) != address(0) && deedNFT.ownerOf(tokenId) == msg.sender))) {
            revert Unauthorized();
        }
        _;
    }

    // ============ Initializer ============
    /**
     * @dev Initializes the contract with base URI and default images
     * @param _baseURI Base URI for external links
     */
    function initialize(string memory _baseURI) public initializer {
        __Ownable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        baseURI = _baseURI;
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        
        // Set default invalidated image
        invalidatedImageURI = "ipfs://Qm";
        
        // Set default asset type images - Land/Estate share same image
        assetTypeImageURIs[0] = "ipfs://Qm1"; // Land
        assetTypeImageURIs[1] = "ipfs://Qm2"; // Vehicle
        assetTypeImageURIs[2] = assetTypeImageURIs[0]; // Estate uses Land image
        assetTypeImageURIs[3] = "ipfs://Qm3"; // Equipment
    }

    // ============ Core Metadata Functions ============
    /**
     * @dev Implements ERC-7572 tokenURI function
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return URI containing the token metadata in JSON format
     * @notice This function combines stored metadata with dynamic traits from DeedNFT
     *         to generate a complete metadata JSON compatible with marketplaces
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        if (!isCompatibleDeedContract(tokenContract)) revert Invalid();
        
        // Get asset type from token
        bytes memory assetTypeBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("assetType"));
        if (assetTypeBytes.length == 0) {
            return ""; // Invalid token
        }
        
        uint256 assetTypeValue = abi.decode(assetTypeBytes, (uint256));
        uint8 assetType = uint8(assetTypeValue);
        
        // Get validation status
        (bool isValidated, /* address validator */) = IDeedNFT(tokenContract).getValidationStatus(tokenId);
        
        // Get definition and configuration
        bytes memory definitionBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("definition"));
        bytes memory configurationBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("configuration"));
        
        string memory definition = definitionBytes.length > 0 ? abi.decode(definitionBytes, (string)) : "";
        string memory configuration = configurationBytes.length > 0 ? abi.decode(configurationBytes, (string)) : "";
        
        // Get stored metadata
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        
        // Use stored data or generate dynamically
        string memory name = bytes(metadata.name).length > 0 ? metadata.name : _generateName(tokenId, assetType);
        string memory imageURI = bytes(metadata.image).length > 0 ? metadata.image : _getImageURI(tokenId, assetType, isValidated);
        string memory description = bytes(metadata.description).length > 0 ? metadata.description : definition;
        
        // Generate metadata components
        string memory attributes = _generateAttributes(tokenId, assetType, isValidated);
        string memory properties = bytes(metadata.customMetadata).length > 0 ? 
            _generateProperties(tokenId, assetType, definition, metadata.customMetadata) :
            _generateProperties(tokenId, assetType, definition, configuration);
        
        // Use stored gallery or empty
        string memory gallery = _generateGallery(tokenId);
        
        // Generate final JSON with all metadata
        return _generateJSON(
            tokenId,
            name,
            description,
            imageURI,
            metadata.background_color,
            metadata.animation_url,
            gallery,
            attributes,
            properties
        );
    }
    
    /**
     * @dev Syncs metadata with DeedNFT trait updates
     * @param tokenId ID of the token
     * @param traitKey Key of the updated trait
     * @param traitValue New value of the trait
     */
    function syncTraitUpdate(uint256 tokenId, bytes32 traitKey, bytes memory traitValue) external {
        // Only accept calls from the DeedNFT contract
        require(msg.sender == address(deedNFT), "!auth");
        
        // Emit sync event
        emit MetadataSynced(tokenId, traitKey, traitValue);

        // If trait value is empty, clear any stored metadata for this trait
        if (traitValue.length == 0) {
            // Clear any stored metadata that might exist for this trait
            if (traitKey == keccak256("gallery")) {
                delete tokenMetadata[tokenId].galleryImages;
                emit TokenGalleryUpdated(tokenId);
            } else if (traitKey == keccak256("customMetadata")) {
                delete tokenMetadata[tokenId].customMetadata;
                emit TokenCustomMetadataUpdated(tokenId);
    }
            return;
        }

        // Handle string array for gallery separately since it has a different format
        if (traitKey == keccak256("gallery")) {
            string[] memory gallery = abi.decode(traitValue, (string[]));
            _setTokenGallery(tokenId, gallery);
            return;
        }

        // Handle all other traits as strings
        string memory strValue = abi.decode(traitValue, (string));
        
        if (traitKey == keccak256("name")) {
            tokenMetadata[tokenId].name = strValue;
        } else if (traitKey == keccak256("description")) {
            tokenMetadata[tokenId].description = strValue;
        } else if (traitKey == keccak256("image")) {
            tokenMetadata[tokenId].image = strValue;
        } else if (traitKey == keccak256("background_color")) {
            tokenMetadata[tokenId].background_color = strValue;
        } else if (traitKey == keccak256("animation_url")) {
            tokenMetadata[tokenId].animation_url = strValue;
        } else if (traitKey == keccak256("customMetadata")) {
            tokenMetadata[tokenId].customMetadata = strValue;
            emit TokenCustomMetadataUpdated(tokenId);
            return;
        }
        
        emit TokenMetadataUpdated(tokenId);
    }
    
    /**
     * @dev Sets custom metadata for a token with sync
     */
    function setTokenCustomMetadata(uint256 tokenId, string memory metadata) external onlyOwnerOrValidator(tokenId) {
        tokenMetadata[tokenId].customMetadata = metadata;
        emit TokenCustomMetadataUpdated(tokenId);
        
        // Sync with DeedNFT if needed
        if (address(deedNFT) != address(0)) {
            deedNFT.setTrait(tokenId, abi.encodePacked("customMetadata"), abi.encode(metadata), 1); // 1 = string type
        }
    }

    function contractURI() external view returns (string memory) {
        // If DeedNFT is set, return its contractURI
        if (address(deedNFT) != address(0)) {
            try IDeedNFT(deedNFT).contractURI() returns (string memory uri) {
                return uri;
            } catch {
                // If call fails, return default
            }
        }
        
        // Return default contract URI
        return "ipfs://QmdefaultContractURI";
    }

    // ============ Asset Management Functions ============
    /**
     * @dev Sets features for a token
     * @param tokenId ID of the token
     * @param features Array of feature strings to set
     * @notice Features are stored as a JSON array in the token's custom metadata
     *         and will be included in the properties section of the token URI
     */
    function setTokenFeatures(uint256 tokenId, string[] memory features) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        
        // Create features JSON object - optimize string concatenation
        string memory featuresJson = '{"properties":{"features":[';
        for (uint i = 0; i < features.length; i++) {
            featuresJson = string(abi.encodePacked(
                featuresJson,
                i > 0 ? ',"' : '"',
                features[i],
                '"'
            ));
    }
        featuresJson = string(abi.encodePacked(featuresJson, ']}}'));
        
        // Store in custom metadata
        tokenMetadata[tokenId].customMetadata = featuresJson;
        
        emit TokenCustomMetadataUpdated(tokenId);
    }
    
    /**
     * @dev Gets features for a token
     * @param tokenId ID of the token
     * @return Array of feature strings
     * @notice Parses the features array from the token's custom metadata
     */
    function getTokenFeatures(uint256 tokenId) external view returns (string[] memory) {
        string memory customMetadata = tokenMetadata[tokenId].customMetadata;
        if (bytes(customMetadata).length == 0) {
            return new string[](0);
        }
        
        // Parse features from properties
        string memory propertiesJson = _extractJsonField(customMetadata, "properties");
        if (bytes(propertiesJson).length == 0) {
            return new string[](0);
            }
        
        string memory featuresJson = _extractJsonField(propertiesJson, "features");
        if (bytes(featuresJson).length == 0) {
            return new string[](0);
        }
        
        return _parseJsonArray(featuresJson);
    }
    
    // ============ Condition Information Functions ============
    /**
     * @dev Sets condition information for an asset/property
     * @param tokenId ID of the token
     * @param generalCondition General condition rating (e.g., "Excellent", "Good", "Fair", "Poor")
     * @param lastInspectionDate Date of last inspection (YYYY-MM-DD format)
     * @param knownIssues Array of known issues or needed repairs
     * @param improvements Array of recent improvements or renovations
     * @param additionalNotes Additional notes about the condition
     * @notice Stores condition information in the token's custom metadata as a JSON object
     */
    function setAssetCondition(
        uint256 tokenId,
        string memory generalCondition,
        string memory lastInspectionDate,
        string[] memory knownIssues,
        string[] memory improvements,
        string memory additionalNotes
    ) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        if (bytes(generalCondition).length == 0) revert Empty();
        
        // Create arrays in JSON format
        string memory issuesJson = "[";
        for (uint i = 0; i < knownIssues.length; i++) {
            if (i > 0) issuesJson = string(abi.encodePacked(issuesJson, ","));
            issuesJson = string(abi.encodePacked(issuesJson, '"', knownIssues[i], '"'));
        }
        issuesJson = string(abi.encodePacked(issuesJson, "]"));
        
        string memory improvementsJson = "[";
        for (uint i = 0; i < improvements.length; i++) {
            if (i > 0) improvementsJson = string(abi.encodePacked(improvementsJson, ","));
            improvementsJson = string(abi.encodePacked(improvementsJson, '"', improvements[i], '"'));
        }
        improvementsJson = string(abi.encodePacked(improvementsJson, "]"));
        
        // Create condition info JSON object
        string memory conditionJson = string(abi.encodePacked(
            '{"properties":{"condition":{',
            '"general_condition":"', generalCondition, '",',
            '"last_inspection_date":"', lastInspectionDate, '",',
            '"known_issues":', issuesJson, ',',
            '"improvements":', improvementsJson, ',',
            '"additional_notes":"', additionalNotes,
            '"}}}'
        ));
        
        // Store in custom metadata
        tokenMetadata[tokenId].customMetadata = conditionJson;
        
        emit TokenCustomMetadataUpdated(tokenId);
    }

    /**
     * @dev Gets condition information for an asset
     * @param tokenId ID of the token
     * @return generalCondition General condition rating
     * @return lastInspectionDate Last inspection date
     * @return knownIssues Array of known issues
     * @return improvements Array of improvements
     * @return additionalNotes Additional notes
     * @notice Parses condition information from the token's custom metadata
     */
    function getAssetCondition(uint256 tokenId) external view returns (
        string memory generalCondition,
        string memory lastInspectionDate,
        string[] memory knownIssues,
        string[] memory improvements,
        string memory additionalNotes
    ) {
        string memory customMetadata = tokenMetadata[tokenId].customMetadata;
        if (bytes(customMetadata).length == 0) {
            return ("", "", new string[](0), new string[](0), "");
        }
        
        string memory conditionJson = _extractJsonField(_extractJsonField(customMetadata, "properties"), "condition");
        if (bytes(conditionJson).length == 0) {
            return ("", "", new string[](0), new string[](0), "");
        }
        
        return (
            _extractJsonField(conditionJson, "general_condition"),
            _extractJsonField(conditionJson, "last_inspection_date"),
            _parseJsonArray(_extractJsonField(conditionJson, "known_issues")),
            _parseJsonArray(_extractJsonField(conditionJson, "improvements")),
            _extractJsonField(conditionJson, "additional_notes")
        );
    }

    // ============ Legal Information Functions ============
    /**
     * @dev Sets legal information for a token
     * @param tokenId ID of the token
     * @param jurisdiction Legal jurisdiction (e.g., country, state)
     * @param registrationNumber Official registration/deed number
     * @param registrationDate Date of registration (YYYY-MM-DD format)
     * @param documents Array of legal document references or hashes
     * @param restrictions Array of legal restrictions or encumbrances
     * @param additionalInfo Additional legal information
     * @notice Stores legal information in the token's custom metadata as a JSON object
     *         This information is crucial for legal compliance and verification
     */
    function setTokenLegalInfo(
        uint256 tokenId,
        string memory jurisdiction,
        string memory registrationNumber,
        string memory registrationDate,
        string[] memory documents,
        string[] memory restrictions,
        string memory additionalInfo
    ) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        if (bytes(jurisdiction).length == 0) revert Empty();
        
        // Create arrays in JSON format
        string memory docsJson = "[";
        for (uint i = 0; i < documents.length; i++) {
            if (i > 0) docsJson = string(abi.encodePacked(docsJson, ","));
            docsJson = string(abi.encodePacked(docsJson, '"', documents[i], '"'));
        }
        docsJson = string(abi.encodePacked(docsJson, "]"));
        
        string memory restrictionsJson = "[";
        for (uint i = 0; i < restrictions.length; i++) {
            if (i > 0) restrictionsJson = string(abi.encodePacked(restrictionsJson, ","));
            restrictionsJson = string(abi.encodePacked(restrictionsJson, '"', restrictions[i], '"'));
                    }
        restrictionsJson = string(abi.encodePacked(restrictionsJson, "]"));
        
        // Create legal info JSON object
        string memory legalJson = string(abi.encodePacked(
            '{"properties":{"legal_info":{',
            '"jurisdiction":"', jurisdiction, '",',
            '"registration_number":"', registrationNumber, '",',
            '"registration_date":"', registrationDate, '",',
            '"documents":', docsJson, ',',
            '"restrictions":', restrictionsJson, ',',
            '"additional_info":"', additionalInfo,
            '"}}}'
        ));
        
        // Store in custom metadata
        tokenMetadata[tokenId].customMetadata = legalJson;
        
            emit TokenCustomMetadataUpdated(tokenId);
        }

    /**
     * @dev Gets legal information for a token
     * @param tokenId ID of the token
     * @return jurisdiction Legal jurisdiction
     * @return registrationNumber Official registration number
     * @return registrationDate Registration date
     * @return documents Array of legal documents
     * @return restrictions Array of legal restrictions
     * @return additionalInfo Additional legal information
     * @notice Parses legal information from the token's custom metadata
     *         Returns empty values if no legal information is set
     */
    function getTokenLegalInfo(uint256 tokenId) external view returns (
        string memory jurisdiction,
        string memory registrationNumber,
        string memory registrationDate,
        string[] memory documents,
        string[] memory restrictions,
        string memory additionalInfo
    ) {
        string memory customMetadata = tokenMetadata[tokenId].customMetadata;
        if (bytes(customMetadata).length == 0) {
            return ("", "", "", new string[](0), new string[](0), "");
        }
        
        string memory legalJson = _extractJsonField(_extractJsonField(customMetadata, "properties"), "legal_info");
        if (bytes(legalJson).length == 0) {
            return ("", "", "", new string[](0), new string[](0), "");
        }
        
        return (
            _extractJsonField(legalJson, "jurisdiction"),
            _extractJsonField(legalJson, "registration_number"),
            _extractJsonField(legalJson, "registration_date"),
            _parseJsonArray(_extractJsonField(legalJson, "documents")),
            _parseJsonArray(_extractJsonField(legalJson, "restrictions")),
            _extractJsonField(legalJson, "additional_info")
        );
    }

    // ============ Document Management Functions ============
    function manageTokenDocument(uint256 tokenId, string memory docType, string memory documentURI, bool isRemove) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        if (!isRemove && bytes(docType).length == 0) revert Empty();
        
        bytes32 documentKey = keccak256(bytes(string(abi.encodePacked("document_", docType))));
        
        if (isRemove) {
            // Remove document by setting trait to empty string
            deedNFT.setTrait(tokenId, abi.encodePacked(documentKey), abi.encode(""), 1); // 1 = string type
            
            // Remove from document types array
            string[] storage docTypes = tokenMetadata[tokenId].documentTypes;
            for (uint i = 0; i < docTypes.length; i++) {
                if (keccak256(bytes(docTypes[i])) == keccak256(bytes(docType))) {
                    docTypes[i] = docTypes[docTypes.length - 1];
                    docTypes.pop();
                    break;
                }
            }
                } else {
            // Add document
            deedNFT.setTrait(tokenId, abi.encodePacked(documentKey), abi.encode(documentURI), 1); // 1 = string type
            
            // Add to document types if not already present
            string[] storage docTypes = tokenMetadata[tokenId].documentTypes;
            bool exists = false;
            for (uint i = 0; i < docTypes.length; i++) {
                if (keccak256(bytes(docTypes[i])) == keccak256(bytes(docType))) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                docTypes.push(docType);
            }
        }
        
        emit TokenMetadataUpdated(tokenId);
    }

    function getTokenDocument(uint256 tokenId, string memory docType) external view returns (string memory) {
        bytes memory value = deedNFT.getTraitValue(tokenId, keccak256(bytes(string(abi.encodePacked("document_", docType)))));
        if (value.length == 0) return "";
        return abi.decode(value, (string));
    }

    function getTokenDocumentTypes(uint256 tokenId) external view returns (string[] memory) {
        return tokenMetadata[tokenId].documentTypes;
    }

    // ============ Gallery Management Functions ============
    /**
     * @dev Sets the token gallery with sync
     */
    function setTokenGallery(uint256 tokenId, string[] memory imageUrls) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_exists(tokenId)) revert Invalid();
        _setTokenGallery(tokenId, imageUrls);
        
        // Sync with DeedNFT if needed
        if (address(deedNFT) != address(0)) {
            deedNFT.setTrait(tokenId, abi.encodePacked("gallery"), abi.encode(imageUrls), 0); // 0 = bytes type for arrays
        }
    }

    function getTokenGallery(uint256 tokenId) external view returns (string[] memory) {
        return tokenMetadata[tokenId].galleryImages;
    }

    // ============ Contract Configuration Functions ============
    function setBaseURI(string memory _baseURI) external onlyOwner {
        baseURI = _baseURI;
    }
    
    function setAssetTypeImageURI(uint8 assetType, string memory imageURI) external onlyOwner {
        assetTypeImageURIs[assetType] = imageURI;
    }
    
    function setInvalidatedImageURI(string memory imageURI) external onlyOwner {
        invalidatedImageURI = imageURI;
    }
    
    function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_deedNFT == address(0)) revert Invalid();
        deedNFT = IDeedNFT(_deedNFT);
        
        // Also add to compatible contracts if not already added
        if (!compatibleDeedContracts[_deedNFT]) {
            _addCompatibleDeedContract(_deedNFT);
        }
    }

    // ============ Contract Compatibility Functions ============
    function manageCompatibleDeedContract(address contractAddress, bool isAdd) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (isAdd) {
            _addCompatibleDeedContract(contractAddress);
        } else {
            if (!compatibleDeedContracts[contractAddress]) revert Invalid();
            
            compatibleDeedContracts[contractAddress] = false;
            
            for (uint i = 0; i < deedContractsList.length; i++) {
                if (deedContractsList[i] == contractAddress) {
                    deedContractsList[i] = deedContractsList[deedContractsList.length - 1];
                    deedContractsList.pop();
                    break;
                }
            }
            
            emit CompatibleDeedContractRemoved(contractAddress);
        }
    }

    function getCompatibleDeedContracts() external view returns (address[] memory) {
        return deedContractsList;
    }

    function isCompatibleDeedContract(address) public pure returns (bool) {
        return true; // For now, all contracts are considered compatible
    }

    // ============ Internal Functions ============
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function _exists(uint256 tokenId) internal view returns (bool) {
        return address(deedNFT) != address(0) && deedNFT.ownerOf(tokenId) != address(0);
    }

    function _setTokenGallery(uint256 tokenId, string[] memory imageUrls) internal {
        // Clear existing gallery
        delete tokenMetadata[tokenId].galleryImages;
        
        // Add new images
        for (uint i = 0; i < imageUrls.length; i++) {
            if (bytes(imageUrls[i]).length > 0) {
                tokenMetadata[tokenId].galleryImages.push(imageUrls[i]);
            }
        }
        
        emit TokenGalleryUpdated(tokenId);
    }
    
    function _addCompatibleDeedContract(address contractAddress) internal {
        if (contractAddress == address(0)) revert Invalid();
        if (compatibleDeedContracts[contractAddress]) revert Exists();
        
        // Basic interface check
        try IDeedNFT(contractAddress).supportsInterface(type(IERC721Upgradeable).interfaceId) returns (bool supported) {
            if (!supported) revert Invalid();
        } catch {
            revert Invalid();
        }
        
        compatibleDeedContracts[contractAddress] = true;
        deedContractsList.push(contractAddress);
        emit CompatibleDeedContractAdded(contractAddress);
    }

    // ============ Metadata Generation Functions ============
    function _generateName(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        if (bytes(metadata.name).length > 0) return metadata.name;
        
        bytes memory cityBytes = deedNFT.getTraitValue(tokenId, keccak256("city"));
        bytes memory streetNumBytes = deedNFT.getTraitValue(tokenId, keccak256("streetNumber"));
        bytes memory streetNameBytes = deedNFT.getTraitValue(tokenId, keccak256("streetName"));
        bytes memory parcelNumBytes = deedNFT.getTraitValue(tokenId, keccak256("parcelNumber"));
        
        string memory city = cityBytes.length > 0 ? abi.decode(cityBytes, (string)) : "";
        string memory streetNum = streetNumBytes.length > 0 ? abi.decode(streetNumBytes, (string)) : "";
        string memory streetName = streetNameBytes.length > 0 ? abi.decode(streetNameBytes, (string)) : "";
        string memory parcelNum = parcelNumBytes.length > 0 ? abi.decode(parcelNumBytes, (string)) : "";
        
        if (assetType == uint8(IDeedNFT.AssetType.Land)) {
            if (bytes(streetNum).length > 0 && bytes(streetName).length > 0) {
                return string(abi.encodePacked(streetNum, " ", streetName, " - Land"));
            }
            if (bytes(parcelNum).length > 0) {
                return string(abi.encodePacked("Parcel #", parcelNum, " - Land"));
            }
            if (bytes(city).length > 0) {
                return string(abi.encodePacked(city, " Land #", tokenId.toString()));
            }
        }
        
        if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            bytes memory makeBytes = deedNFT.getTraitValue(tokenId, keccak256("make"));
            bytes memory modelBytes = deedNFT.getTraitValue(tokenId, keccak256("model"));
            bytes memory yearBytes = deedNFT.getTraitValue(tokenId, keccak256("year"));
            
            string memory make = makeBytes.length > 0 ? abi.decode(makeBytes, (string)) : "";
            string memory model = modelBytes.length > 0 ? abi.decode(modelBytes, (string)) : "";
            string memory year = yearBytes.length > 0 ? abi.decode(yearBytes, (string)) : "";
            
            if (bytes(make).length > 0 && bytes(model).length > 0) {
                return string(abi.encodePacked(year, " ", make, " ", model));
            }
        }
        
        return string(abi.encodePacked(_assetTypeToString(assetType), " #", tokenId.toString()));
    }
    
    function _generateGallery(uint256 tokenId) internal view returns (string memory) {
        string[] memory images = tokenMetadata[tokenId].galleryImages;
        if (images.length == 0) return "";
        string memory g = '"gallery":[';
        for (uint i = 0; i < images.length; i++) {
            g = string(abi.encodePacked(g, i > 0 ? ',"' : '"', images[i], '"'));
        }
        return string(abi.encodePacked(g, ']'));
    }
    
    function _generateAttributes(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        bytes32[] memory traitKeys = deedNFT.getTraitKeys(tokenId);
        string[] memory parts = new string[](traitKeys.length + 2);
        uint256 count;
        
        parts[count++] = _createTrait("Type", _assetTypeToString(assetType));
        parts[count++] = _createTrait("Status", isValidated ? "Valid" : "Invalid");
        
        for (uint i = 0; i < traitKeys.length; i++) {
            bytes memory value = deedNFT.getTraitValue(tokenId, traitKeys[i]);
            string memory name = deedNFT.getTraitName(traitKeys[i]);
            
            if (value.length == 32) {
                bool decoded;
                assembly { decoded := mload(add(value, 32)) }
                parts[count++] = _createTrait(name, decoded ? "true" : "false");
            } else {
                string memory str = abi.decode(value, (string));
                if (bytes(str).length > 0) {
                    parts[count++] = _createTrait(name, str);
                }
            }
        }
        
        string memory attrs;
        for (uint i = 0; i < count; i++) {
            attrs = string(abi.encodePacked(attrs, i > 0 ? "," : "", parts[i]));
        }
        return attrs;
    }
    
    function _generateProperties(uint256 tokenId, uint8 assetType, string memory def, string memory cfg) internal view returns (string memory) {
        TokenMetadata storage m = tokenMetadata[tokenId];
        string memory props = string(abi.encodePacked('{"asset_type":"', _assetTypeToString(assetType), '"'));
        
        if (bytes(def).length > 0) props = string(abi.encodePacked(props, '","definition":', def));
        if (bytes(cfg).length > 0) props = string(abi.encodePacked(props, '","configuration":', cfg));
        
        string memory custom = m.customMetadata;
        if (bytes(custom).length > 0) {
            if (bytes(custom)[0] == '{' && bytes(custom)[bytes(custom).length - 1] == '}') {
                bytes memory result = new bytes(bytes(custom).length - 2);
                for (uint i = 1; i < bytes(custom).length - 1; i++) {
                    result[i - 1] = bytes(custom)[i];
                }
                custom = string(result);
            }
            props = string(abi.encodePacked(props, ',', custom));
        }
        
        return string(abi.encodePacked(props, '}'));
    }

    function _generateJSON(uint256 tokenId, string memory name, string memory description,
        string memory imageURI, string memory backgroundColor, string memory animationUrl,
        string memory gallery, string memory attributes, string memory properties) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                '{"name":"', name,
                '","description":"', description,
                '","image":"', imageURI,
                '","token_id":"', StringsUpgradeable.toString(tokenId), '",',
                '"attributes":[', attributes,
                '],"properties":', properties,
                bytes(gallery).length > 0 ? string(abi.encodePacked(',"gallery":', gallery)) : "",
                bytes(backgroundColor).length > 0 ? string(abi.encodePacked(',"background_color":"', backgroundColor, '"')) : "",
                bytes(animationUrl).length > 0 ? string(abi.encodePacked(',"animation_url":"', animationUrl, '"')) : "",
                '}'
            )
        );
    }
    
    function _getImageURI(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        if (!isValidated) return invalidatedImageURI;
        if (bytes(metadata.image).length > 0) return metadata.image;
        if (metadata.galleryImages.length > 0) return metadata.galleryImages[0];
        return assetTypeImageURIs[assetType];
    }
    
    // ============ JSON Parsing Functions ============
    function _extractJsonField(string memory json, string memory field) internal pure returns (string memory) {
        string memory searchStr = string(abi.encodePacked('"', field, '":"'));
        uint256 start = _indexOf(json, searchStr);
        if (start == 0) return "";
        
        start += bytes(searchStr).length;
        uint256 end = _indexOf(json, '"', start);
        if (end == 0) return "";
        
        bytes memory result = new bytes(end - start);
        for (uint i = 0; i < end - start; i++) {
            result[i] = bytes(json)[start + i];
        }
        
        return string(result);
    }

    function _parseJsonArray(string memory json) internal pure returns (string[] memory) {
        if (bytes(json).length < 2) return new string[](0);
            
        // Count items
        uint256 count = 0;
        uint256 pos = 1; // Skip first [
        while (pos < bytes(json).length) {
            if (bytes(json)[pos] == '"') {
                count++;
                // Skip to next item
                while (pos < bytes(json).length && bytes(json)[pos] != ',') {
                    pos++;
                }
            }
            pos++;
        }
        
        string[] memory result = new string[](count);
        if (count == 0) return result;
        
        // Parse items
        pos = 1; // Skip first [
        count = 0;
        while (pos < bytes(json).length && count < result.length) {
            if (bytes(json)[pos] == '"') {
                uint256 start = pos + 1;
                pos++;
                while (pos < bytes(json).length && bytes(json)[pos] != '"') {
                    pos++;
        }
                uint256 end = pos;
                
                bytes memory item = new bytes(end - start);
                for (uint i = 0; i < end - start; i++) {
                    item[i] = bytes(json)[start + i];
        }
                
                result[count++] = string(item);
            }
            pos++;
        }
        
        return result;
    }

    function _indexOf(string memory haystack, string memory needle) internal pure returns (uint256) {
        bytes memory haystackBytes = bytes(haystack);
        bytes memory needleBytes = bytes(needle);
        
        if (needleBytes.length > haystackBytes.length) return 0;
        
        for (uint i = 0; i <= haystackBytes.length - needleBytes.length; i++) {
            bool found = true;
            for (uint j = 0; j < needleBytes.length; j++) {
                if (haystackBytes[i + j] != needleBytes[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        
        return 0;
    }

    function _indexOf(string memory haystack, string memory needle, uint256 start) internal pure returns (uint256) {
        bytes memory haystackBytes = bytes(haystack);
        bytes memory needleBytes = bytes(needle);
        
        if (needleBytes.length > haystackBytes.length || start >= haystackBytes.length) return 0;
        
        for (uint i = start; i <= haystackBytes.length - needleBytes.length; i++) {
            bool found = true;
            for (uint j = 0; j < needleBytes.length; j++) {
                if (haystackBytes[i + j] != needleBytes[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
    }

        return 0;
    }

    // Helper function to convert asset type to string
    function _assetTypeToString(uint8 t) internal pure returns (string memory) {
        return t == 0 ? "Land" : t == 1 ? "Vehicle" : t == 2 ? "Estate" : t == 3 ? "Equipment" : "Unknown";
    }

    function _createTrait(string memory name, string memory value) internal pure returns (string memory) {
        return string(abi.encodePacked('{"trait_type":"', name, '","value":"', value, '"}'));
    }
}