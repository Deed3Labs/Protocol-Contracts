// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/Base64Upgradeable.sol";

// Interface for DeedNFT
interface IDeedNFT {
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }
    function getTraitValue(uint256 tokenId, bytes32 traitKey) external view returns (bytes memory);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title DeedMetadataRenderer
 * @dev Implements ERC-7572 for dynamic metadata rendering for DeedNFT
 * @notice Implements IERC7572.tokenURI(address,uint256) without importing the interface
 */
contract DeedMetadataRenderer is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using StringsUpgradeable for uint256;
    using StringsUpgradeable for address;
    using Base64Upgradeable for bytes;

    // Image URIs for different states and asset types
    string public invalidatedImageURI;
    mapping(uint8 => string) public assetTypeImageURIs;
    
    // Gallery image URIs for each token
    mapping(uint256 => string[]) public tokenGalleryImages;
    
    // Custom metadata for each token
    mapping(uint256 => string) public tokenCustomMetadata;
    
    // Base URI for external metadata
    string public baseURI;
    
    // Add this struct to store property details
    struct PropertyDetails {
        string country;
        string state;
        string county;
        string city;
        string streetName;
        string streetNumber;
        string parcelNumber;
        string holdingEntity;
        string latitude;
        string longitude;
        string acres;
        string parcelUse;
        string zoning;
        string zoningCode;
        string confidenceScore;
        string background_color;
        string animation_url;
        string deed_type;
        string recording_date;
        string recording_number;
        string legal_description;
        bool has_water;
        bool has_electricity;
        bool has_natural_gas;
        bool has_sewer;
        bool has_internet;
        string map_overlay;
        // Any other fields you want
    }

    // Add this mapping to store property details for each token
    mapping(uint256 => PropertyDetails) public tokenPropertyDetails;

    // Add a new mapping for features and documents
    mapping(uint256 => string[]) public tokenFeatures;
    mapping(uint256 => mapping(string => string)) public tokenDocuments;

    // Add this to your state variables
    mapping(uint256 => string[]) public tokenDocumentTypes;

    // Events
    event InvalidatedImageUpdated(string newURI);
    event AssetTypeImageUpdated(uint8 assetType, string newURI);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    event BaseURIUpdated(string newURI);
    event PropertyDetailsUpdated(uint256 indexed tokenId);
    event TokenFeaturesUpdated(uint256 indexed tokenId);
    event TokenDocumentUpdated(uint256 indexed tokenId, string docType);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with default settings
     */
    function initialize() public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        
        // Set default invalidated image
        invalidatedImageURI = "ipfs://QmDefaultInvalidatedImageCID";
        
        // Set default asset type images
        assetTypeImageURIs[0] = "ipfs://QmDefaultLandImageCID";
        assetTypeImageURIs[1] = "ipfs://QmDefaultVehicleImageCID";
        assetTypeImageURIs[2] = "ipfs://QmDefaultEstateImageCID";
        assetTypeImageURIs[3] = "ipfs://QmDefaultCommercialEquipmentImageCID";
    }

    /**
     * @dev Authorizes the contract upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Sets the invalidated image URI
     */
    function setInvalidatedImageURI(string memory uri) external onlyOwner {
        invalidatedImageURI = uri;
        emit InvalidatedImageUpdated(uri);
    }

    /**
     * @dev Sets an asset type image URI
     */
    function setAssetTypeImageURI(uint8 assetType, string memory uri) external onlyOwner {
        assetTypeImageURIs[assetType] = uri;
        emit AssetTypeImageUpdated(assetType, uri);
    }
    
    /**
     * @dev Sets the base URI for external metadata
     */
    function setBaseURI(string memory uri) external onlyOwner {
        baseURI = uri;
        emit BaseURIUpdated(uri);
    }
    
    /**
     * @dev Sets gallery images for a token
     */
    function setTokenGallery(uint256 tokenId, string[] memory imageURIs) external onlyOwner {
        delete tokenGalleryImages[tokenId];
        for (uint i = 0; i < imageURIs.length; i++) {
            tokenGalleryImages[tokenId].push(imageURIs[i]);
        }
        emit TokenGalleryUpdated(tokenId);
    }
    
    /**
     * @dev Adds a gallery image for a token
     */
    function addTokenGalleryImage(uint256 tokenId, string memory imageURI) external onlyOwner {
        tokenGalleryImages[tokenId].push(imageURI);
        emit TokenGalleryUpdated(tokenId);
    }
    
    /**
     * @dev Sets custom metadata for a token
     */
    function setTokenCustomMetadata(uint256 tokenId, string memory metadata) external onlyOwner {
        tokenCustomMetadata[tokenId] = metadata;
        emit TokenCustomMetadataUpdated(tokenId);
    }
    
    /**
     * @dev Gets gallery images for a token
     */
    function getTokenGallery(uint256 tokenId) external view returns (string[] memory) {
        return tokenGalleryImages[tokenId];
    }

    /**
     * @dev Sets property details for a token
     */
    function setPropertyDetails(
        uint256 tokenId, 
        PropertyDetails calldata details
    ) external onlyOwner {
        tokenPropertyDetails[tokenId] = details;
        emit PropertyDetailsUpdated(tokenId);
    }

    /**
     * @dev Sets features for a token
     */
    function setTokenFeatures(uint256 tokenId, string[] memory features) external onlyOwner {
        delete tokenFeatures[tokenId];
        for (uint i = 0; i < features.length; i++) {
            tokenFeatures[tokenId].push(features[i]);
        }
        emit TokenFeaturesUpdated(tokenId);
    }

    /**
     * @dev Sets a document for a token
     */
    function setTokenDocument(uint256 tokenId, string memory docType, string memory uri) external onlyOwner {
        // Check if this document type already exists for this token
        bool exists = false;
        for (uint i = 0; i < tokenDocumentTypes[tokenId].length; i++) {
            if (keccak256(bytes(tokenDocumentTypes[tokenId][i])) == keccak256(bytes(docType))) {
                exists = true;
                break;
            }
        }
        
        // If it doesn't exist, add it to the array
        if (!exists) {
            tokenDocumentTypes[tokenId].push(docType);
        }
        
        // Set the document URI
        tokenDocuments[tokenId][docType] = uri;
        emit TokenDocumentUpdated(tokenId, docType);
    }

    /**
     * @dev Implements ERC-7572 tokenURI function
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return Token URI with metadata
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view returns (string memory) {
        IDeedNFT deedNFT = IDeedNFT(tokenContract);
        
        // Check if token exists by trying to get its owner
        address owner;
        try deedNFT.ownerOf(tokenId) returns (address _owner) {
            owner = _owner;
        } catch {
            revert("Token does not exist");
        }
        
        // Get trait values
        bytes memory assetTypeBytes = deedNFT.getTraitValue(tokenId, keccak256("assetType"));
        bytes memory isValidatedBytes = deedNFT.getTraitValue(tokenId, keccak256("isValidated"));
        bytes memory definitionBytes = deedNFT.getTraitValue(tokenId, keccak256("definition"));
        bytes memory configurationBytes = deedNFT.getTraitValue(tokenId, keccak256("configuration"));
        bytes memory validatorBytes = deedNFT.getTraitValue(tokenId, keccak256("validator"));
        
        // Decode trait values
        uint8 assetType = uint8(abi.decode(assetTypeBytes, (uint256)));
        bool isValidated = abi.decode(isValidatedBytes, (bool));
        string memory definition = abi.decode(definitionBytes, (string));
        string memory configuration = abi.decode(configurationBytes, (string));
        address validator = abi.decode(validatorBytes, (address));
        
        // Determine main image - prioritize token-specific gallery images
        string memory mainImage;
        
        // First check if token has custom gallery images
        if (tokenGalleryImages[tokenId].length > 0) {
            mainImage = tokenGalleryImages[tokenId][0];
        } 
        // If not, use default images based on validation status
        else {
            mainImage = isValidated 
                ? assetTypeImageURIs[assetType] 
                : invalidatedImageURI;
        }
        
        // Build gallery JSON array
        string memory galleryJson = "[";
        for (uint i = 0; i < tokenGalleryImages[tokenId].length; i++) {
            if (i > 0) galleryJson = string(abi.encodePacked(galleryJson, ","));
            galleryJson = string(abi.encodePacked(galleryJson, '"', tokenGalleryImages[tokenId][i], '"'));
        }
        galleryJson = string(abi.encodePacked(galleryJson, "]"));
        
        // Get asset type name
        string memory assetTypeName;
        if (assetType == 0) assetTypeName = "Land";
        else if (assetType == 1) assetTypeName = "Vehicle";
        else if (assetType == 2) assetTypeName = "Estate";
        else if (assetType == 3) assetTypeName = "Commercial Equipment";
        
        // Get property details
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        
        // Get owner as beneficiary
        address beneficiary = deedNFT.ownerOf(tokenId);
        
        // Build attributes array with all property details
        string memory attributes = string(abi.encodePacked(
            '[{"trait_type":"Asset Type","value":"', assetTypeName, '"},',
            '{"trait_type":"Validation Status","value":"', isValidated ? "Validated" : "Unvalidated", '"},',
            '{"trait_type":"Operating Agreement","value":"', configuration, '"},',
            
            // Add property details as attributes
            '{"trait_type":"Country","value":"', details.country, '"},',
            '{"trait_type":"State","value":"', details.state, '"},',
            '{"trait_type":"County","value":"', details.county, '"},',
            '{"trait_type":"City","value":"', details.city, '"},',
            '{"trait_type":"Street Number","value":"', details.streetNumber, '"},',
            '{"trait_type":"Street Name","value":"', details.streetName, '"},',
            '{"trait_type":"Parcel Number","value":"', details.parcelNumber, '"},',
            '{"trait_type":"Holding Entity","value":"', details.holdingEntity, '"},',
            '{"trait_type":"Latitude","value":"', details.latitude, '"},',
            '{"trait_type":"Longitude","value":"', details.longitude, '"},',
            '{"trait_type":"Acres","value":"', details.acres, '"},',
            '{"trait_type":"Parcel Use","value":"', details.parcelUse, '"},',
            '{"trait_type":"Zoning","value":"', details.zoning, '"},',
            '{"trait_type":"Zoning Code","value":"', details.zoningCode, '"},',
            '{"trait_type":"Confidence Score","value":"', details.confidenceScore, '"},',
            '{"trait_type":"Beneficiary","value":"', beneficiary.toHexString(), '"}',
            
            validator != address(0) ? string(abi.encodePacked(',{"trait_type":"Validator","value":"', validator.toHexString(), '"}')) : "",
            ']'
        ));
        
        // Build the JSON metadata
        string memory propertyName;
        if (bytes(details.streetNumber).length > 0 && bytes(details.streetName).length > 0) {
            propertyName = string(abi.encodePacked(
                details.streetNumber, ' ', 
                details.streetName, ', ', 
                details.city, ', ', 
                details.state, 
                ' #', tokenId.toString()
            ));
        } else {
            // Fallback to default naming
            propertyName = string(abi.encodePacked("Deed #", tokenId.toString()));
        }

        // Start building the JSON
        string memory jsonStart = string(abi.encodePacked(
            '{',
            '"name":"', propertyName, '",',
            '"description":"', definition, '",',
            '"image":"', mainImage, '",',
            '"external_url":"', baseURI, tokenId.toString(), '",'
        ));
        
        // Add optional fields
        string memory jsonOptionalFields = "";
        
        // Add background_color if present
        if (bytes(details.background_color).length > 0) {
            jsonOptionalFields = string(abi.encodePacked(
                jsonOptionalFields,
                '"background_color":"', details.background_color, '",'
            ));
        }
        
        // Add animation_url if present
        if (bytes(details.animation_url).length > 0) {
            jsonOptionalFields = string(abi.encodePacked(
                jsonOptionalFields,
                '"animation_url":"', details.animation_url, '",'
            ));
        }
        
        // Add gallery
        string memory jsonGallery = string(abi.encodePacked(
            '"gallery":', galleryJson, ','
        ));
        
        // Add features
        string memory jsonFeatures = string(abi.encodePacked(
            '"features":', _buildFeaturesJson(tokenId), ','
        ));
        
        // Add attributes
        string memory jsonAttributes = string(abi.encodePacked(
            '"attributes":', attributes, ','
        ));
        
        // Start properties object
        string memory jsonPropertiesStart = string(abi.encodePacked(
            '"properties":{',
            '"configuration":"', configuration, '",'
        ));
        
        // Add legal information if present
        string memory jsonLegal = "";
        if (bytes(details.deed_type).length > 0) {
            jsonLegal = string(abi.encodePacked(
                '"legal":{',
                '"deed_type":"', details.deed_type, '",',
                '"recording_date":"', details.recording_date, '",',
                '"recording_number":"', details.recording_number, '",',
                '"legal_description":"', details.legal_description, '"',
                '},'
            ));
        }
        
        // Add utilities
        string memory jsonUtilities = string(abi.encodePacked(
            '"utilities":{',
            '"water":', details.has_water ? "true" : "false", ',',
            '"electricity":', details.has_electricity ? "true" : "false", ',',
            '"natural_gas":', details.has_natural_gas ? "true" : "false", ',',
            '"sewer":', details.has_sewer ? "true" : "false", ',',
            '"internet":', details.has_internet ? "true" : "false",
            '},'
        ));
        
        // Add documents
        string memory jsonDocuments = _buildDocumentsJson(tokenId);
        
        // Add map overlay if present
        string memory jsonMapOverlay = "";
        if (bytes(details.map_overlay).length > 0) {
            jsonMapOverlay = string(abi.encodePacked(
                '"map_overlay":"', details.map_overlay, '",'
            ));
        }
        
        // Add custom metadata if present
        string memory jsonCustom = "";
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            jsonCustom = string(abi.encodePacked(
                '"custom":', tokenCustomMetadata[tokenId]
            ));
        }
        
        // Close properties object and main JSON
        string memory jsonEnd = "}}";
        
        // Combine all parts
        string memory json = string(abi.encodePacked(
            jsonStart,
            jsonOptionalFields,
            jsonGallery,
            jsonFeatures,
            jsonAttributes,
            jsonPropertiesStart,
            jsonLegal,
            jsonUtilities,
            jsonDocuments,
            jsonMapOverlay,
            jsonCustom,
            jsonEnd
        ));
        
        // Return base64 encoded JSON
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64Upgradeable.encode(bytes(json))
        ));
    }

    function _buildFeaturesJson(uint256 tokenId) internal view returns (string memory) {
        string memory featuresJson = "[";
        for (uint i = 0; i < tokenFeatures[tokenId].length; i++) {
            if (i > 0) featuresJson = string(abi.encodePacked(featuresJson, ","));
            featuresJson = string(abi.encodePacked(featuresJson, '"', tokenFeatures[tokenId][i], '"'));
        }
        featuresJson = string(abi.encodePacked(featuresJson, "]"));
        return featuresJson;
    }

    function _buildDocumentsJson(uint256 tokenId) internal view returns (string memory) {
        string memory documentsJson = '"documents":{';
        
        for (uint i = 0; i < tokenDocumentTypes[tokenId].length; i++) {
            string memory docType = tokenDocumentTypes[tokenId][i];
            
            // Add comma if not the first item
            if (i > 0) {
                documentsJson = string(abi.encodePacked(documentsJson, ','));
            }
            
            documentsJson = string(abi.encodePacked(
                documentsJson, 
                '"', docType, '":"', tokenDocuments[tokenId][docType], '"'
            ));
        }
        
        documentsJson = string(abi.encodePacked(documentsJson, '},'));
        return documentsJson;
    }
} 