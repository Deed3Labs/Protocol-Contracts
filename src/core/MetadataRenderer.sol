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

    // Add these temporary storage variables to help with JSON building
    // They'll be used across function calls to reduce stack variables
    struct TempMetadataVars {
        string assetTypeName;
        string mainImage;
        string propertyName;
        string definition;
        string configuration;
        bool isValidated;
        address validator;
        address owner;
    }

    // Temporary storage variable - will be overwritten for each tokenURI call
    TempMetadataVars private tempVars;

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
        // First prepare all the data and store in tempVars
        _prepareTokenData(tokenContract, tokenId);
        
        // Then build the JSON using the prepared data
        string memory json = _buildTokenJSON(tokenId);
        
        // Return base64 encoded JSON
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64Upgradeable.encode(bytes(json))
        ));
    }

    /**
     * @dev Prepares token data and stores in tempVars
     */
    function _prepareTokenData(address tokenContract, uint256 tokenId) internal view {
        IDeedNFT deedNFT = IDeedNFT(tokenContract);
        
        // Check if token exists by trying to get its owner
        try deedNFT.ownerOf(tokenId) returns (address _owner) {
            tempVars.owner = _owner;
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
        tempVars.isValidated = abi.decode(isValidatedBytes, (bool));
        tempVars.definition = abi.decode(definitionBytes, (string));
        tempVars.configuration = abi.decode(configurationBytes, (string));
        tempVars.validator = abi.decode(validatorBytes, (address));
        
        // Get asset type name
        if (assetType == 0) tempVars.assetTypeName = "Land";
        else if (assetType == 1) tempVars.assetTypeName = "Vehicle";
        else if (assetType == 2) tempVars.assetTypeName = "Estate";
        else tempVars.assetTypeName = "Commercial Equipment";
        
        // Get main image
        if (tokenGalleryImages[tokenId].length > 0) {
            tempVars.mainImage = tokenGalleryImages[tokenId][0];
        } else {
            tempVars.mainImage = tempVars.isValidated 
                ? assetTypeImageURIs[assetType] 
                : invalidatedImageURI;
        }
        
        // Build property name
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        if (bytes(details.streetNumber).length > 0 && bytes(details.streetName).length > 0) {
            tempVars.propertyName = string(abi.encodePacked(
                details.streetNumber, ' ', 
                details.streetName, ', ', 
                details.city, ', ', 
                details.state, 
                ' #', tokenId.toString()
            ));
        } else {
            tempVars.propertyName = string(abi.encodePacked("Deed #", tokenId.toString()));
        }
    }

    /**
     * @dev Builds token JSON using data in tempVars
     */
    function _buildTokenJSON(uint256 tokenId) internal view returns (string memory) {
        // Build the JSON in parts to avoid stack too deep
        string memory part1 = _buildJsonPart1(tokenId);
        string memory part2 = _buildJsonPart2(tokenId);
        string memory part3 = _buildJsonPart3(tokenId);
        
        // Combine all parts
        return string(abi.encodePacked(part1, part2, part3));
    }

    /**
     * @dev Builds first part of the JSON (basic info)
     */
    function _buildJsonPart1(uint256 tokenId) internal view returns (string memory) {
        // Start with basic token info
        string memory json = string(abi.encodePacked(
            '{',
            '"name":"', tempVars.propertyName, '",',
            '"description":"', tempVars.definition, '",',
            '"image":"', tempVars.mainImage, '",',
            '"external_url":"', baseURI, tokenId.toString(), '",'
        ));
        
        // Add optional fields
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        if (bytes(details.background_color).length > 0) {
            json = string(abi.encodePacked(
                json,
                '"background_color":"', details.background_color, '",'
            ));
        }
        
        if (bytes(details.animation_url).length > 0) {
            json = string(abi.encodePacked(
                json,
                '"animation_url":"', details.animation_url, '",'
            ));
        }
        
        // Add gallery
        json = string(abi.encodePacked(json, _buildGalleryJson(tokenId)));
        
        return json;
    }

    /**
     * @dev Builds second part of the JSON (features and attributes)
     */
    function _buildJsonPart2(uint256 tokenId) internal view returns (string memory) {
        // Add features
        string memory json = string(abi.encodePacked(
            '"features":', _buildFeaturesJson(tokenId), ','
        ));
        
        // Add attributes
        json = string(abi.encodePacked(
            json,
            _buildAttributesJson(tokenId)
        ));
        
        return json;
    }

    /**
     * @dev Builds third part of the JSON (properties)
     */
    function _buildJsonPart3(uint256 tokenId) internal view returns (string memory) {
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        
        // Start properties object
        string memory json = string(abi.encodePacked(
            '"properties":{',
            '"configuration":"', tempVars.configuration, '",'
        ));
        
        // Add legal information if present
        if (bytes(details.deed_type).length > 0) {
            json = string(abi.encodePacked(
                json,
                '"legal":{',
                '"deed_type":"', details.deed_type, '",',
                '"recording_date":"', details.recording_date, '",',
                '"recording_number":"', details.recording_number, '",',
                '"legal_description":"', details.legal_description, '"',
                '},'
            ));
        }
        
        // Add utilities
        json = string(abi.encodePacked(
            json,
            '"utilities":{',
            '"water":', details.has_water ? "true" : "false", ',',
            '"electricity":', details.has_electricity ? "true" : "false", ',',
            '"natural_gas":', details.has_natural_gas ? "true" : "false", ',',
            '"sewer":', details.has_sewer ? "true" : "false", ',',
            '"internet":', details.has_internet ? "true" : "false",
            '},'
        ));
        
        // Add documents
        json = string(abi.encodePacked(
            json,
            _buildDocumentsJson(tokenId)
        ));
        
        // Add map overlay if present
        if (bytes(details.map_overlay).length > 0) {
            json = string(abi.encodePacked(
                json,
                '"map_overlay":"', details.map_overlay, '",'
            ));
        }
        
        // Add custom metadata if present
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            json = string(abi.encodePacked(
                json,
                '"custom":', tokenCustomMetadata[tokenId]
            ));
        } else {
            // Remove trailing comma if no custom metadata
            json = string(abi.encodePacked(json));
        }
        
        // Close properties object and main JSON
        json = string(abi.encodePacked(json, "}}"));
        
        return json;
    }

    /**
     * @dev Builds gallery JSON section
     */
    function _buildGalleryJson(uint256 tokenId) internal view returns (string memory) {
        string memory galleryJson = "[";
        for (uint i = 0; i < tokenGalleryImages[tokenId].length; i++) {
            if (i > 0) galleryJson = string(abi.encodePacked(galleryJson, ","));
            galleryJson = string(abi.encodePacked(galleryJson, '"', tokenGalleryImages[tokenId][i], '"'));
        }
        galleryJson = string(abi.encodePacked(galleryJson, "]"));
        
        return string(abi.encodePacked('"gallery":', galleryJson, ','));
    }

    /**
     * @dev Builds attributes JSON
     */
    function _buildAttributesJson(uint256 tokenId) internal view returns (string memory) {
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        
        // Build attributes in parts to avoid stack too deep
        string memory attributesPart1 = _buildAttributesPart1(details);
        string memory attributesPart2 = _buildAttributesPart2(details);
        string memory attributesPart3 = _buildAttributesPart3(details);
        
        // Add validator if present
        string memory validatorAttr = "";
        if (tempVars.validator != address(0)) {
            validatorAttr = string(abi.encodePacked(
                ',{"trait_type":"Validator","value":"', tempVars.validator.toHexString(), '"}'
            ));
        }
        
        // Combine all parts
        string memory attributes = string(abi.encodePacked(
            '[', attributesPart1, attributesPart2, attributesPart3, validatorAttr, ']'
        ));
        
        return string(abi.encodePacked('"attributes":', attributes, ','));
    }

    /**
     * @dev Builds first part of attributes
     */
    function _buildAttributesPart1(PropertyDetails memory details) internal view returns (string memory) {
        return string(abi.encodePacked(
            '{"trait_type":"Asset Type","value":"', tempVars.assetTypeName, '"},',
            '{"trait_type":"Validation Status","value":"', tempVars.isValidated ? "Validated" : "Unvalidated", '"},',
            '{"trait_type":"Operating Agreement","value":"', tempVars.configuration, '"},',
            '{"trait_type":"Country","value":"', details.country, '"},',
            '{"trait_type":"State","value":"', details.state, '"},',
            '{"trait_type":"County","value":"', details.county, '"},',
            '{"trait_type":"City","value":"', details.city, '"},'
        ));
    }

    /**
     * @dev Builds second part of attributes
     */
    function _buildAttributesPart2(PropertyDetails memory details) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '{"trait_type":"Street Number","value":"', details.streetNumber, '"},',
            '{"trait_type":"Street Name","value":"', details.streetName, '"},',
            '{"trait_type":"Parcel Number","value":"', details.parcelNumber, '"},',
            '{"trait_type":"Holding Entity","value":"', details.holdingEntity, '"},'
        ));
    }

    /**
     * @dev Builds third part of attributes
     */
    function _buildAttributesPart3(PropertyDetails memory details) internal view returns (string memory) {
        return string(abi.encodePacked(
            '{"trait_type":"Latitude","value":"', details.latitude, '"},',
            '{"trait_type":"Longitude","value":"', details.longitude, '"},',
            '{"trait_type":"Acres","value":"', details.acres, '"},',
            '{"trait_type":"Parcel Use","value":"', details.parcelUse, '"},',
            '{"trait_type":"Zoning","value":"', details.zoning, '"},',
            '{"trait_type":"Zoning Code","value":"', details.zoningCode, '"},',
            '{"trait_type":"Confidence Score","value":"', details.confidenceScore, '"},',
            '{"trait_type":"Beneficiary","value":"', tempVars.owner.toHexString(), '"}'
        ));
    }

    /**
     * @dev Builds features JSON
     */
    function _buildFeaturesJson(uint256 tokenId) internal view returns (string memory) {
        string memory featuresJson = "[";
        for (uint i = 0; i < tokenFeatures[tokenId].length; i++) {
            if (i > 0) featuresJson = string(abi.encodePacked(featuresJson, ","));
            featuresJson = string(abi.encodePacked(featuresJson, '"', tokenFeatures[tokenId][i], '"'));
        }
        featuresJson = string(abi.encodePacked(featuresJson, "]"));
        return featuresJson;
    }

    /**
     * @dev Builds documents JSON
     */
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