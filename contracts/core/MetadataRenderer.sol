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

// Interfaces
import "./interfaces/IMetadataRenderer.sol";
import "./interfaces/IDeedNFT.sol";

/**
 * @title MetadataRenderer
 * @dev Renders metadata for NFTs with dynamic trait parsing and management.
 *      Handles storage and rendering of:
 *      - Default images for invalidated assets and asset types
 *      - Dynamic name generation based on traits
 *      - Token documents and document types
 *      - Asset features, legal info, and custom metadata
 *      - Gallery images and animation URLs
 */
contract MetadataRenderer is Initializable, OwnableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable, IMetadataRenderer {
    using StringsUpgradeable for uint256;
    using StringsUpgradeable for address;
    using Base64Upgradeable for bytes;

    // ============ Constants & Immutables ============
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    // Consolidated trait key hashes
    bytes32 constant TRAIT_ASSET_TYPE = keccak256("assetType");
    bytes32 constant TRAIT_IS_VALIDATED = keccak256("isValidated");
    bytes32 constant TRAIT_DEFINITION = keccak256("definition");
    bytes32 constant TRAIT_GALLERY = keccak256("gallery");
    bytes32 constant TRAIT_CUSTOM_METADATA = keccak256("customMetadata");
    bytes32 constant TRAIT_NAME = keccak256("name");
    bytes32 constant TRAIT_DESCRIPTION = keccak256("description");
    bytes32 constant TRAIT_IMAGE = keccak256("image");
    bytes32 constant TRAIT_BACKGROUND_COLOR = keccak256("background_color");
    bytes32 constant TRAIT_ANIMATION_URL = keccak256("animation_url");
    bytes32 constant TRAIT_VALIDATOR = keccak256("validator");
    bytes32 constant TRAIT_BENEFICIARY = keccak256("beneficiary");
    bytes32 constant TRAIT_CONFIGURATION = keccak256("configuration");
    
    // ============ Structs ============
    /**
     * @dev Struct containing token features
     */
    struct TokenFeatures {
        string[] features;
    }

    /**
     * @dev Struct containing asset condition information
     */
    struct AssetCondition {
        string generalCondition;
        string lastInspectionDate;
        string[] knownIssues;
        string[] improvements;
        string additionalNotes;
    }

    /**
     * @dev Struct containing legal information
     */
    struct LegalInfo {
        string jurisdiction;
        string registrationNumber;
        string registrationDate;
        string[] documents;
        string[] restrictions;
        string additionalInfo;
    }

    /**
     * @dev Struct containing all metadata for a token
     * @param name Token name (optional, generated if not set)
     * @param description Token description
     * @param image Primary image URI
     * @param background_color Background color for the token
     * @param animation_url Animation URL for the token
     * @param external_link External URL for the token (e.g., website, marketplace listing)
     * @param galleryImages Array of additional image URIs
     * @param documents Array of document structs containing docType and documentURI
     * @param customMetadata Custom metadata for the token
     */
    struct TokenMetadata {
        string name;
        string description;
        string image;
        string background_color;
        string animation_url;
        string external_link;
        string[] galleryImages;
        Document[] documents;
        string customMetadata;
    }

    /**
     * @dev Struct containing document information
     */
    struct Document {
        string docType;
        string documentURI;
    }

    // ============ Storage Variables ============
    
    // Default images for each asset type and invalidated image
    mapping(uint8 => string) public defaultImageURIs;
    
    // Default background color for each asset type
    mapping(uint8 => string) public defaultBackgroundColors;
    
    // Mapping of token ID to its metadata
    mapping(uint256 => TokenMetadata) private tokenMetadata;
    
    // Mapping of token ID to its features
    mapping(uint256 => TokenFeatures) private tokenFeatures;
    
    // Mapping of token ID to its condition information
    mapping(uint256 => AssetCondition) private assetConditions;
    
    // Mapping of token ID to its legal information
    mapping(uint256 => LegalInfo) private legalInfo;

    // Reference to the DeedNFT contract
    IDeedNFT public deedNFT;
    
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
     * @dev Initializes the contract with default images
     */
    function initialize() public initializer {
        __Ownable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        
        // Set default invalidated image
        defaultImageURIs[255] = "ipfs://Qm";
        
        // Set default asset type images - Land/Estate share same image
        defaultImageURIs[0] = "ipfs://Qm1"; // Land
        defaultImageURIs[1] = "ipfs://Qm2"; // Vehicle
        defaultImageURIs[2] = defaultImageURIs[0]; // Estate uses Land image
        defaultImageURIs[3] = "ipfs://Qm3"; // Equipment
    }

    // ============ Core Metadata Functions ============
    /**
     * @dev Returns the metadata URI for a token
     * @param tokenId ID of the token
     * @return URI containing the token metadata in JSON format
     * @notice This function combines stored metadata with dynamic traits from DeedNFT
     *         to generate a complete metadata JSON compatible with marketplaces
     */
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (!_exists(tokenId)) revert Invalid();
        
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        TokenFeatures storage features = tokenFeatures[tokenId];
        AssetCondition storage condition = assetConditions[tokenId];
        LegalInfo storage legal = legalInfo[tokenId];
        
        // Get asset type and validation status from DeedNFT
        uint8 assetType = 0;
        bool isValidated = true;
        string memory definition = "";
        string memory configuration = "";
        if (address(deedNFT) != address(0)) {
            bytes memory assetTypeBytes = deedNFT.getTraitValue(tokenId, TRAIT_ASSET_TYPE);
            if (assetTypeBytes.length > 0) {
                assetType = abi.decode(assetTypeBytes, (uint8));
            }
            bytes memory isValidatedBytes = deedNFT.getTraitValue(tokenId, TRAIT_IS_VALIDATED);
            if (isValidatedBytes.length > 0) {
                isValidated = abi.decode(isValidatedBytes, (bool));
            }
            bytes memory definitionBytes = deedNFT.getTraitValue(tokenId, TRAIT_DEFINITION);
            if (definitionBytes.length > 0) {
                definition = abi.decode(definitionBytes, (string));
            }
            bytes memory configurationBytes = deedNFT.getTraitValue(tokenId, TRAIT_CONFIGURATION);
            if (configurationBytes.length > 0) {
                configuration = abi.decode(configurationBytes, (string));
            }
        }
        
        // Generate name and image URI
        string memory name = _generateName(tokenId, assetType);
        string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
        
        // Start building the JSON string
        bytes memory json = abi.encodePacked(
            '{"name":"', _escapeJSON(name), '",',
            '"description":"', _escapeJSON(definition), '",',
            '"image":"', _escapeJSON(imageURI), '",',
            '"background_color":"', _escapeJSON(metadata.background_color), '",',
            '"animation_url":"', _escapeJSON(metadata.animation_url), '",',
            '"external_link":"', _escapeJSON(metadata.external_link), '"'
        );
        
        // Add configuration if present
        if (bytes(configuration).length > 0) {
            json = abi.encodePacked(json, ',"configuration":"', _escapeJSON(configuration), '"');
        }
        
        // Add gallery images if any
        if (metadata.galleryImages.length > 0) {
            json = abi.encodePacked(json, ',"gallery_images":[');
            for (uint i = 0; i < metadata.galleryImages.length; i++) {
                if (i > 0) json = abi.encodePacked(json, ",");
                json = abi.encodePacked(json, '"', _escapeJSON(metadata.galleryImages[i]), '"');
            }
            json = abi.encodePacked(json, "]");
        }
        
        // Add documents array if any
        if (metadata.documents.length > 0) {
            json = abi.encodePacked(json, ',"documents":[');
            for (uint i = 0; i < metadata.documents.length; i++) {
                if (i > 0) json = abi.encodePacked(json, ",");
                json = abi.encodePacked(json, '{"docType":"', _escapeJSON(metadata.documents[i].docType), '","documentURI":"', _escapeJSON(metadata.documents[i].documentURI), '"}');
            }
            json = abi.encodePacked(json, "]");
        }
        
        // Add features if any
        if (features.features.length > 0) {
            json = abi.encodePacked(json, ',"features":[');
            for (uint i = 0; i < features.features.length; i++) {
                if (i > 0) json = abi.encodePacked(json, ",");
                json = abi.encodePacked(json, '"', _escapeJSON(features.features[i]), '"');
            }
            json = abi.encodePacked(json, "]");
        }
        
        // Add asset condition if set
        if (bytes(condition.generalCondition).length > 0) {
            json = abi.encodePacked(json, ',"asset_condition":{',
                '"general_condition":"', _escapeJSON(condition.generalCondition), '",',
                '"last_inspection_date":"', _escapeJSON(condition.lastInspectionDate), '",',
                '"known_issues":[');
            
            for (uint i = 0; i < condition.knownIssues.length; i++) {
                if (i > 0) json = abi.encodePacked(json, ",");
                json = abi.encodePacked(json, '"', _escapeJSON(condition.knownIssues[i]), '"');
            }
            
            json = abi.encodePacked(json, '],"improvements":[');
            
            for (uint i = 0; i < condition.improvements.length; i++) {
                if (i > 0) json = abi.encodePacked(json, ",");
                json = abi.encodePacked(json, '"', _escapeJSON(condition.improvements[i]), '"');
            }
            
            json = abi.encodePacked(json, '],"additional_notes":"', _escapeJSON(condition.additionalNotes), '"}');
        }
        
        // Add legal info if set
        if (bytes(legal.jurisdiction).length > 0) {
            json = abi.encodePacked(json, ',"legal_info":{',
                '"jurisdiction":"', _escapeJSON(legal.jurisdiction), '",',
                '"registration_number":"', _escapeJSON(legal.registrationNumber), '",',
                '"registration_date":"', _escapeJSON(legal.registrationDate), '",',
                '"documents":[');
            
            for (uint i = 0; i < legal.documents.length; i++) {
                if (i > 0) json = abi.encodePacked(json, ",");
                json = abi.encodePacked(json, '"', _escapeJSON(legal.documents[i]), '"');
            }
            
            json = abi.encodePacked(json, '],"restrictions":[');
            
            for (uint i = 0; i < legal.restrictions.length; i++) {
                if (i > 0) json = abi.encodePacked(json, ",");
                json = abi.encodePacked(json, '"', _escapeJSON(legal.restrictions[i]), '"');
            }
            
            json = abi.encodePacked(json, '],"additional_info":"', _escapeJSON(legal.additionalInfo), '"}');
        }
        
        // Add dynamic traits from DeedNFT if set
        if (address(deedNFT) != address(0)) {
            // Get all trait keys
            bytes32[] memory traitKeys = deedNFT.getTraitKeys(tokenId);
            // Get trait values
            bytes[] memory traitValues = deedNFT.getTraitValues(tokenId, traitKeys);
            
            // Add attributes array
            json = abi.encodePacked(json, ',"attributes":[');
            
            bool firstAttribute = true;
            for (uint i = 0; i < traitKeys.length; i++) {
                // Skip definition and configuration traits
                if (traitKeys[i] == TRAIT_DEFINITION || traitKeys[i] == TRAIT_CONFIGURATION) {
                    continue;
                }
                if (!firstAttribute) json = abi.encodePacked(json, ',');
                firstAttribute = false;
                
                // Get trait name from DeedNFT
                string memory traitName = deedNFT.getTraitName(traitKeys[i]);
                
                // Handle different trait types
                if (traitKeys[i] == TRAIT_ASSET_TYPE) {
                    uint8 decodedAssetType = abi.decode(traitValues[i], (uint8));
                    json = abi.encodePacked(json, '{"trait_type":"', traitName, '","value":"', _escapeJSON(_assetTypeToString(decodedAssetType)), '"}');
                } else if (traitKeys[i] == TRAIT_IS_VALIDATED) {
                    bool decodedIsValidated = abi.decode(traitValues[i], (bool));
                    json = abi.encodePacked(json, '{"trait_type":"', traitName, '","value":"', decodedIsValidated ? "Valid" : "Invalid", '"}');
                } else if (traitKeys[i] == TRAIT_VALIDATOR || traitKeys[i] == TRAIT_BENEFICIARY) {
                    address addr = abi.decode(traitValues[i], (address));
                    if (addr != address(0)) {
                        json = abi.encodePacked(json, '{"trait_type":"', traitName, '","value":"', addr.toHexString(), '"}');
                    }
                } else {
                    // Handle string traits
                    string memory value = abi.decode(traitValues[i], (string));
                    json = abi.encodePacked(json, '{"trait_type":"', traitName, '","value":"', _escapeJSON(value), '"}');
                }
            }
            
            json = abi.encodePacked(json, "]");
        }
        
        // Close the JSON object
        json = abi.encodePacked(json, "}");
        
        return string(abi.encodePacked("data:application/json;base64,", Base64Upgradeable.encode(json)));
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
            if (traitKey == TRAIT_GALLERY) {
                delete tokenMetadata[tokenId].galleryImages;
                emit TokenGalleryUpdated(tokenId);
            } else if (traitKey == TRAIT_CUSTOM_METADATA) {
                delete tokenMetadata[tokenId].customMetadata;
                emit TokenCustomMetadataUpdated(tokenId);
            }
            return;
        }

        // Handle string array for gallery separately since it has a different format
        if (traitKey == TRAIT_GALLERY) {
            string[] memory gallery = abi.decode(traitValue, (string[]));
            _setTokenGallery(tokenId, gallery);
            return;
        }

        // Handle all other traits as strings
        string memory strValue = abi.decode(traitValue, (string));
        
        if (traitKey == TRAIT_NAME) {
            tokenMetadata[tokenId].name = strValue;
        } else if (traitKey == TRAIT_DESCRIPTION) {
            tokenMetadata[tokenId].description = strValue;
        } else if (traitKey == TRAIT_IMAGE) {
            tokenMetadata[tokenId].image = strValue;
        } else if (traitKey == TRAIT_BACKGROUND_COLOR) {
            tokenMetadata[tokenId].background_color = strValue;
        } else if (traitKey == TRAIT_ANIMATION_URL) {
            tokenMetadata[tokenId].animation_url = strValue;
        } else if (traitKey == TRAIT_CUSTOM_METADATA) {
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
            deedNFT.setTrait(tokenId, abi.encodePacked(TRAIT_CUSTOM_METADATA), abi.encode(metadata), 1); // 1 = string type
        }
    }

    function contractURI() external view returns (string memory) {
        if (address(deedNFT) != address(0)) {
            return deedNFT.contractURI();
            }
        return "ipfs://QmdefaultContractURI";
    }

    // ============ Asset Management Functions ============
    /**
     * @dev Sets features for a token
     * @param tokenId ID of the token
     * @param features Array of feature strings to set
     */
    function setTokenFeatures(uint256 tokenId, string[] memory features) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        
        // Clear existing features
        delete tokenFeatures[tokenId];
        
        // Add new features
        for (uint i = 0; i < features.length; i++) {
            tokenFeatures[tokenId].features.push(features[i]);
        }
        
        emit TokenCustomMetadataUpdated(tokenId);
    }
    
    /**
     * @dev Gets features for a token
     * @param tokenId ID of the token
     * @return Array of feature strings
     */
    function getTokenFeatures(uint256 tokenId) external view returns (string[] memory) {
        return tokenFeatures[tokenId].features;
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
        
        // Clear existing condition info
        delete assetConditions[tokenId];
        
        // Set new condition info
        assetConditions[tokenId].generalCondition = generalCondition;
        assetConditions[tokenId].lastInspectionDate = lastInspectionDate;
        assetConditions[tokenId].additionalNotes = additionalNotes;
        
        // Add known issues
        for (uint i = 0; i < knownIssues.length; i++) {
            assetConditions[tokenId].knownIssues.push(knownIssues[i]);
        }
        
        // Add improvements
        for (uint i = 0; i < improvements.length; i++) {
            assetConditions[tokenId].improvements.push(improvements[i]);
        }
        
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
     */
    function getAssetCondition(uint256 tokenId) external view returns (
        string memory generalCondition,
        string memory lastInspectionDate,
        string[] memory knownIssues,
        string[] memory improvements,
        string memory additionalNotes
    ) {
        AssetCondition storage condition = assetConditions[tokenId];
        return (
            condition.generalCondition,
            condition.lastInspectionDate,
            condition.knownIssues,
            condition.improvements,
            condition.additionalNotes
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
        
        // Clear existing legal info
        delete legalInfo[tokenId];
        
        // Set new legal info
        legalInfo[tokenId].jurisdiction = jurisdiction;
        legalInfo[tokenId].registrationNumber = registrationNumber;
        legalInfo[tokenId].registrationDate = registrationDate;
        legalInfo[tokenId].additionalInfo = additionalInfo;
        
        // Add documents
        for (uint i = 0; i < documents.length; i++) {
            legalInfo[tokenId].documents.push(documents[i]);
        }
        
        // Add restrictions
        for (uint i = 0; i < restrictions.length; i++) {
            legalInfo[tokenId].restrictions.push(restrictions[i]);
        }
        
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
     */
    function getTokenLegalInfo(uint256 tokenId) external view returns (
        string memory jurisdiction,
        string memory registrationNumber,
        string memory registrationDate,
        string[] memory documents,
        string[] memory restrictions,
        string memory additionalInfo
    ) {
        LegalInfo storage info = legalInfo[tokenId];
        return (
            info.jurisdiction,
            info.registrationNumber,
            info.registrationDate,
            info.documents,
            info.restrictions,
            info.additionalInfo
        );
    }

    // ============ Document Management Functions ============
    function manageTokenDocument(uint256 tokenId, string memory docType, string memory documentURI, bool isRemove) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        if (!isRemove && bytes(docType).length == 0) revert Empty();
        
        Document[] storage docs = tokenMetadata[tokenId].documents;
        
        if (isRemove) {
            // Remove document
            for (uint i = 0; i < docs.length; i++) {
                if (keccak256(bytes(docs[i].docType)) == keccak256(bytes(docType))) {
                    docs[i] = docs[docs.length - 1];
                    docs.pop();
                    break;
                }
            }
        } else {
            // Add or update document
            bool exists = false;
            
            // Check if document type exists
            for (uint i = 0; i < docs.length; i++) {
                if (keccak256(bytes(docs[i].docType)) == keccak256(bytes(docType))) {
                    docs[i].documentURI = documentURI;
                    exists = true;
                    break;
                }
            }
            
            // If document type doesn't exist, add it
            if (!exists) {
                docs.push(Document(docType, documentURI));
            }
        }
        
        emit TokenMetadataUpdated(tokenId);
    }

    function getTokenDocument(uint256 tokenId, string memory docType) external view returns (string memory) {
        Document[] storage docs = tokenMetadata[tokenId].documents;
        for (uint i = 0; i < docs.length; i++) {
            if (keccak256(bytes(docs[i].docType)) == keccak256(bytes(docType))) {
                return docs[i].documentURI;
            }
        }
        return "";
    }

    function getTokenDocuments(uint256 tokenId) external view returns (Document[] memory) {
        return tokenMetadata[tokenId].documents;
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
            deedNFT.setTrait(tokenId, abi.encodePacked(TRAIT_GALLERY), abi.encode(imageUrls), 0); // 0 = bytes type for arrays
        }
    }

    function getTokenGallery(uint256 tokenId) external view returns (string[] memory) {
        return tokenMetadata[tokenId].galleryImages;
    }

    // ============ Contract Configuration Functions ============
    function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_deedNFT == address(0)) revert Invalid();
        deedNFT = IDeedNFT(_deedNFT);
    }

    function setAssetTypeImageURI(uint8 assetType, string memory imageURI) external onlyOwner {
        if (assetType >= 255) revert Invalid(); // Reserve 255 for invalidated image
        defaultImageURIs[assetType] = imageURI;
    }
    
    function setAssetTypeBackgroundColor(uint8 assetType, string memory backgroundColor) external onlyOwner {
        if (assetType >= 255) revert Invalid(); // Reserve 255 for invalidated image
        defaultBackgroundColors[assetType] = backgroundColor;
    }
    
    function setInvalidatedImageURI(string memory imageURI) external onlyOwner {
        defaultImageURIs[255] = imageURI; // Use 255 for invalidated image
    }

    // ============ Animation URL and External Link Management ============
    function setTokenAnimationURL(uint256 tokenId, string memory animationURL) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        tokenMetadata[tokenId].animation_url = animationURL;
        emit TokenMetadataUpdated(tokenId);
    }

    function setTokenExternalLink(uint256 tokenId, string memory externalLink) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        tokenMetadata[tokenId].external_link = externalLink;
        emit TokenMetadataUpdated(tokenId);
    }

    function getTokenAnimationURL(uint256 tokenId) external view returns (string memory) {
        return tokenMetadata[tokenId].animation_url;
    }

    function getTokenExternalLink(uint256 tokenId) external view returns (string memory) {
        return tokenMetadata[tokenId].external_link;
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
    
    // ============ Metadata Generation Functions ============
    function _generateName(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        if (assetType == 0 || assetType == 2) { // Land or Estate
            bytes memory streetNum = deedNFT.getTraitValue(tokenId, keccak256("streetNumber"));
            bytes memory streetName = deedNFT.getTraitValue(tokenId, keccak256("streetName"));
            if (streetNum.length > 0 && streetName.length > 0) {
                string memory addr = string(abi.encodePacked(abi.decode(streetNum, (string)), " ", abi.decode(streetName, (string))));
                bytes memory state = deedNFT.getTraitValue(tokenId, keccak256("state"));
                bytes memory zip = deedNFT.getTraitValue(tokenId, keccak256("zipCode"));
                bytes memory country = deedNFT.getTraitValue(tokenId, keccak256("country"));
                string memory loc = "";
                if (state.length > 0) {
                    loc = string(abi.encodePacked(", ", abi.decode(state, (string))));
                    if (zip.length > 0) loc = string(abi.encodePacked(loc, " ", abi.decode(zip, (string))));
                    if (country.length > 0) loc = string(abi.encodePacked(loc, ", ", abi.decode(country, (string))));
                }
                return string(abi.encodePacked(addr, loc, assetType == 0 ? " - Land" : " - Estate"));
            }
            bytes memory parcel = deedNFT.getTraitValue(tokenId, keccak256("parcelNumber"));
            if (parcel.length > 0) {
                string memory p = string(abi.encodePacked("Parcel #", abi.decode(parcel, (string))));
                bytes memory state = deedNFT.getTraitValue(tokenId, keccak256("state"));
                bytes memory zip = deedNFT.getTraitValue(tokenId, keccak256("zipCode"));
                bytes memory country = deedNFT.getTraitValue(tokenId, keccak256("country"));
                string memory loc = "";
                if (state.length > 0) {
                    loc = string(abi.encodePacked(", ", abi.decode(state, (string))));
                    if (zip.length > 0) loc = string(abi.encodePacked(loc, " ", abi.decode(zip, (string))));
                    if (country.length > 0) loc = string(abi.encodePacked(loc, ", ", abi.decode(country, (string))));
                }
                return string(abi.encodePacked(p, loc, assetType == 0 ? " - Land" : " - Estate"));
            }
        } else if (assetType == 1) { // Vehicle
            bytes memory year = deedNFT.getTraitValue(tokenId, keccak256("year"));
            bytes memory make = deedNFT.getTraitValue(tokenId, keccak256("make"));
            bytes memory model = deedNFT.getTraitValue(tokenId, keccak256("model"));
            if (year.length > 0 && make.length > 0 && model.length > 0)
                return string(abi.encodePacked(abi.decode(year, (string)), " ", abi.decode(make, (string)), " ", abi.decode(model, (string))));
            if (make.length > 0 && model.length > 0)
                return string(abi.encodePacked(abi.decode(make, (string)), " ", abi.decode(model, (string))));
            if (make.length > 0)
                return string(abi.encodePacked(abi.decode(make, (string)), " Vehicle"));
        } else if (assetType == 3) { // Equipment
            bytes memory manufacturer = deedNFT.getTraitValue(tokenId, keccak256("manufacturer"));
            bytes memory model = deedNFT.getTraitValue(tokenId, keccak256("model"));
            bytes memory serial = deedNFT.getTraitValue(tokenId, keccak256("serialNumber"));
            if (manufacturer.length > 0 && model.length > 0 && serial.length > 0)
                return string(abi.encodePacked(abi.decode(manufacturer, (string)), " ", abi.decode(model, (string)), " (S/N: ", abi.decode(serial, (string)), ")"));
            bytes memory equipmentType = deedNFT.getTraitValue(tokenId, keccak256("equipmentType"));
            if (equipmentType.length > 0 && manufacturer.length > 0 && model.length > 0)
                return string(abi.encodePacked(abi.decode(equipmentType, (string)), " - ", abi.decode(manufacturer, (string)), " ", abi.decode(model, (string))));
            if (manufacturer.length > 0 && model.length > 0)
                return string(abi.encodePacked(abi.decode(manufacturer, (string)), " ", abi.decode(model, (string))));
            if (manufacturer.length > 0)
                return string(abi.encodePacked(abi.decode(manufacturer, (string)), " Equipment"));
        }
        return string(abi.encodePacked("Asset #", tokenId.toString()));
    }
    
    function _getImageURI(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        if (!isValidated) return defaultImageURIs[255]; // Use 255 for invalidated image
        if (bytes(metadata.image).length > 0) return metadata.image;
        if (metadata.galleryImages.length > 0) return metadata.galleryImages[0];
        return defaultImageURIs[assetType];
    }
    
    // ============ Helper Functions ============
    // Helper function to convert asset type to string
    function _assetTypeToString(uint8 t) internal pure returns (string memory) {
        if (t == 0) return "Land";
        if (t == 1) return "Vehicle"; 
        if (t == 2) return "Land";  // Estate uses same image as Land
        if (t == 3) return "Equipment";
        return "Unknown";
    }

    // Helper function to escape JSON strings
    function _escapeJSON(string memory str) internal pure returns (string memory) {
        bytes memory strBytes = bytes(str);
        bytes memory result = new bytes(strBytes.length * 2); // Maximum possible length
        uint resultLength = 0;
        
        for (uint i = 0; i < strBytes.length; i++) {
            bytes1 char = strBytes[i];
            if (char == '"' || char == '\\') {
                result[resultLength++] = '\\';
                result[resultLength++] = char;
            } else if (char == '\n') {
                result[resultLength++] = '\\';
                result[resultLength++] = 'n';
            } else if (char == '\r') {
                result[resultLength++] = '\\';
                result[resultLength++] = 'r';
            } else if (char == '\t') {
                result[resultLength++] = '\\';
                result[resultLength++] = 't';
            } else if (uint8(char) < 32) {
                // Skip control characters
                continue;
            } else {
                result[resultLength++] = char;
            }
        }
        
        // Create a new string with the correct length
        bytes memory finalResult = new bytes(resultLength);
        for (uint i = 0; i < resultLength; i++) {
            finalResult[i] = result[i];
        }
        
        return string(finalResult);
    }
}