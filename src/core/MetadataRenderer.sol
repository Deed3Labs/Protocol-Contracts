// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/Base64Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @dev Interface for DeedNFT contract
 */
interface IDeedNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getTraitValue(uint256 tokenId, bytes32 traitKey) external view returns (bytes memory);
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }
}

/**
 * @title MetadataRenderer
 * @dev Renders metadata for NFTs with property details
 */
contract MetadataRenderer is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using StringsUpgradeable for uint256;
    using StringsUpgradeable for address;
    using Base64Upgradeable for bytes;

    // Base URI for external links
    string public baseURI;
    
    // Default images for asset types
    mapping(uint8 => string) public assetTypeImageURIs;
    
    // Image for invalidated assets
    string public invalidatedImageURI;
    
    // Property details for each token
    struct PropertyDetails {
        // Location details
        string country;
        string state;
        string county;
        string city;
        string streetNumber;
        string streetName;
        string parcelNumber;
        
        // Legal details
        string deed_type;
        string recording_date;
        string recording_number;
        string legal_description;
        string holdingEntity;
        
        // Geographic details
        string latitude;
        string longitude;
        string acres;
        
        // Zoning details
        string parcelUse;
        string zoning;
        string zoningCode;
        
        // Utilities
        bool has_water;
        bool has_electricity;
        bool has_natural_gas;
        bool has_sewer;
        bool has_internet;
        
        // Display details
        string background_color;
        string animation_url;
        string map_overlay;
        
        // Validation
        string confidenceScore;
    }
    
    // Token property details
    mapping(uint256 => PropertyDetails) public tokenPropertyDetails;
    
    // Token gallery images
    mapping(uint256 => string[]) public tokenGalleryImages;
    
    // Token features
    mapping(uint256 => string[]) public tokenFeatures;
    
    // Token documents
    mapping(uint256 => string[]) public tokenDocumentTypes;
    mapping(uint256 => mapping(string => string)) public tokenDocuments;
    
    // Token custom metadata (JSON string)
    mapping(uint256 => string) public tokenCustomMetadata;
    
    // Events
    event PropertyDetailsUpdated(uint256 indexed tokenId);
    event TokenFeaturesUpdated(uint256 indexed tokenId);
    event TokenDocumentUpdated(uint256 indexed tokenId, string docType);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    
    /**
     * @dev Initializes the contract
     */
    function initialize(string memory _baseURI) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        baseURI = _baseURI;
        
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
     * @dev Sets the base URI
     */
    function setBaseURI(string memory _baseURI) external onlyOwner {
        baseURI = _baseURI;
    }
    
    /**
     * @dev Sets the default image URI for an asset type
     */
    function setAssetTypeImageURI(uint8 assetType, string memory imageURI) external onlyOwner {
        assetTypeImageURIs[assetType] = imageURI;
    }
    
    /**
     * @dev Sets the invalidated image URI
     */
    function setInvalidatedImageURI(string memory imageURI) external onlyOwner {
        invalidatedImageURI = imageURI;
    }
    
    /**
     * @dev Sets custom metadata for a token
     */
    function setTokenCustomMetadata(uint256 tokenId, string memory metadata) external onlyOwner {
        tokenCustomMetadata[tokenId] = metadata;
        emit TokenCustomMetadataUpdated(tokenId);
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
     * @dev Gets token gallery images
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
        // Get token data
        (
            string memory name,
            string memory description,
            string memory image,
            string memory assetTypeName,
            bool isValidated,
            string memory configuration,
            address owner,
            address validator
        ) = getTokenBasicData(tokenContract, tokenId);
        
        // Build JSON in chunks to avoid stack too deep
        string memory json = buildJsonHeader(name, description, image, tokenId);
        json = appendJsonBody(json, tokenId, assetTypeName, configuration, isValidated, validator, owner);
        
        // Return base64 encoded JSON
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64Upgradeable.encode(bytes(json))
        ));
    }
    
    /**
     * @dev Gets basic token data
     */
    function getTokenBasicData(address tokenContract, uint256 tokenId) internal view returns (
        string memory name,
        string memory description,
        string memory image,
        string memory assetTypeName,
        bool isValidated,
        string memory configuration,
        address owner,
        address validator
    ) {
        IDeedNFT deedNFT = IDeedNFT(tokenContract);
        
        // Check if token exists by trying to get its owner
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
        isValidated = abi.decode(isValidatedBytes, (bool));
        description = abi.decode(definitionBytes, (string));
        configuration = abi.decode(configurationBytes, (string));
        validator = abi.decode(validatorBytes, (address));
        
        // Get asset type name
        if (assetType == 0) assetTypeName = "Land";
        else if (assetType == 1) assetTypeName = "Vehicle";
        else if (assetType == 2) assetTypeName = "Estate";
        else assetTypeName = "Commercial Equipment";
        
        // Get main image
        if (tokenGalleryImages[tokenId].length > 0) {
            image = tokenGalleryImages[tokenId][0];
        } else {
            image = isValidated 
                ? assetTypeImageURIs[assetType] 
                : invalidatedImageURI;
        }
        
        // Build property name
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        if (bytes(details.streetNumber).length > 0 && bytes(details.streetName).length > 0) {
            name = string(abi.encodePacked(
                details.streetNumber, ' ', 
                details.streetName, ', ', 
                details.city, ', ', 
                details.state, 
                ' #', tokenId.toString()
            ));
        } else {
            name = string(abi.encodePacked("Deed #", tokenId.toString()));
        }
    }
    
    /**
     * @dev Builds the JSON header (first part)
     */
    function buildJsonHeader(
        string memory name,
        string memory description,
        string memory image,
        uint256 tokenId
    ) internal view returns (string memory) {
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        
        string memory json = string(abi.encodePacked(
            '{',
            '"name":"', name, '",',
            '"description":"', description, '",',
            '"image":"', image, '",',
            '"external_url":"', baseURI, tokenId.toString(), '"'
        ));
        
        // Add optional fields if present
        if (bytes(details.background_color).length > 0) {
            json = string(abi.encodePacked(json, ',"background_color":"', details.background_color, '"'));
        }
        
        if (bytes(details.animation_url).length > 0) {
            json = string(abi.encodePacked(json, ',"animation_url":"', details.animation_url, '"'));
        }
        
        // Add gallery
        json = string(abi.encodePacked(json, ',"gallery":', buildGalleryJson(tokenId)));
        
        return json;
    }
    
    /**
     * @dev Appends the JSON body (second part)
     */
    function appendJsonBody(
        string memory json,
        uint256 tokenId,
        string memory assetTypeName,
        string memory configuration,
        bool isValidated,
        address validator,
        address owner
    ) internal view returns (string memory) {
        // Add features
        json = string(abi.encodePacked(json, ',"features":', buildFeaturesJson(tokenId)));
        
        // Add attributes
        json = string(abi.encodePacked(json, ',"attributes":', buildAttributesJson(
            tokenId, assetTypeName, configuration, isValidated, validator, owner
        )));
        
        // Add properties
        json = string(abi.encodePacked(json, ',"properties":', buildPropertiesJson(tokenId, configuration)));
        
        // Close JSON
        json = string(abi.encodePacked(json, '}'));
        
        return json;
    }
    
    /**
     * @dev Builds gallery JSON array
     */
    function buildGalleryJson(uint256 tokenId) internal view returns (string memory) {
        string memory galleryJson = "[";
        
        for (uint i = 0; i < tokenGalleryImages[tokenId].length; i++) {
            if (i > 0) galleryJson = string(abi.encodePacked(galleryJson, ","));
            galleryJson = string(abi.encodePacked(galleryJson, '"', tokenGalleryImages[tokenId][i], '"'));
        }
        
        return string(abi.encodePacked(galleryJson, "]"));
    }
    
    /**
     * @dev Builds features JSON array
     */
    function buildFeaturesJson(uint256 tokenId) internal view returns (string memory) {
        string memory featuresJson = "[";
        
        for (uint i = 0; i < tokenFeatures[tokenId].length; i++) {
            if (i > 0) featuresJson = string(abi.encodePacked(featuresJson, ","));
            featuresJson = string(abi.encodePacked(featuresJson, '"', tokenFeatures[tokenId][i], '"'));
        }
        
        return string(abi.encodePacked(featuresJson, "]"));
    }
    
    /**
     * @dev Builds attributes JSON array
     */
    function buildAttributesJson(
        uint256 tokenId,
        string memory assetTypeName,
        string memory configuration,
        bool isValidated,
        address validator,
        address owner
    ) internal view returns (string memory) {
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        
        // Build attributes in chunks to avoid stack too deep
        string memory attributes = buildAttributesChunk1(assetTypeName, configuration, isValidated, details);
        attributes = string(abi.encodePacked(attributes, buildAttributesChunk2(details)));
        
        // Add validator if present
        if (validator != address(0)) {
            attributes = string(abi.encodePacked(
                attributes, ',{"trait_type":"Validator","value":"', validator.toHexString(), '"}'
            ));
        }
        
        // Add beneficiary (owner)
        attributes = string(abi.encodePacked(
            attributes, ',{"trait_type":"Beneficiary","value":"', owner.toHexString(), '"}'
        ));
        
        // Close attributes array
        return string(abi.encodePacked('[', attributes, ']'));
    }
    
    /**
     * @dev Builds first chunk of attributes
     */
    function buildAttributesChunk1(
        string memory assetTypeName,
        string memory configuration,
        bool isValidated,
        PropertyDetails memory details
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '{"trait_type":"Asset Type","value":"', assetTypeName, '"},',
            '{"trait_type":"Validation Status","value":"', isValidated ? "Validated" : "Unvalidated", '"},',
            '{"trait_type":"Operating Agreement","value":"', configuration, '"},',
            '{"trait_type":"Country","value":"', details.country, '"},',
            '{"trait_type":"State","value":"', details.state, '"},',
            '{"trait_type":"County","value":"', details.county, '"},',
            '{"trait_type":"City","value":"', details.city, '"},',
            '{"trait_type":"Street Number","value":"', details.streetNumber, '"},',
            '{"trait_type":"Street Name","value":"', details.streetName, '"}'
        ));
    }
    
    /**
     * @dev Builds second chunk of attributes
     */
    function buildAttributesChunk2(PropertyDetails memory details) internal pure returns (string memory) {
        return string(abi.encodePacked(
            ',{"trait_type":"Parcel Number","value":"', details.parcelNumber, '"},',
            '{"trait_type":"Holding Entity","value":"', details.holdingEntity, '"},',
            '{"trait_type":"Latitude","value":"', details.latitude, '"},',
            '{"trait_type":"Longitude","value":"', details.longitude, '"},',
            '{"trait_type":"Acres","value":"', details.acres, '"},',
            '{"trait_type":"Parcel Use","value":"', details.parcelUse, '"},',
            '{"trait_type":"Zoning","value":"', details.zoning, '"},',
            '{"trait_type":"Zoning Code","value":"', details.zoningCode, '"},',
            '{"trait_type":"Confidence Score","value":"', details.confidenceScore, '"}'
        ));
    }
    
    /**
     * @dev Builds properties JSON object
     */
    function buildPropertiesJson(uint256 tokenId, string memory configuration) internal view returns (string memory) {
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        
        // Start with configuration
        string memory propertiesJson = string(abi.encodePacked(
            '{',
            '"configuration":"', configuration, '"'
        ));
        
        // Add legal information if present
        if (bytes(details.deed_type).length > 0) {
            propertiesJson = string(abi.encodePacked(
                propertiesJson,
                ',"legal":{',
                '"deed_type":"', details.deed_type, '",',
                '"recording_date":"', details.recording_date, '",',
                '"recording_number":"', details.recording_number, '",',
                '"legal_description":"', details.legal_description, '"',
                '}'
            ));
        }
        
        // Add utilities
        propertiesJson = string(abi.encodePacked(
            propertiesJson,
            ',"utilities":{',
            '"water":', details.has_water ? "true" : "false", ',',
            '"electricity":', details.has_electricity ? "true" : "false", ',',
            '"natural_gas":', details.has_natural_gas ? "true" : "false", ',',
            '"sewer":', details.has_sewer ? "true" : "false", ',',
            '"internet":', details.has_internet ? "true" : "false",
            '}'
        ));
        
        // Add documents
        propertiesJson = string(abi.encodePacked(
            propertiesJson,
            ',"documents":', buildDocumentsJson(tokenId)
        ));
        
        // Add map overlay if present
        if (bytes(details.map_overlay).length > 0) {
            propertiesJson = string(abi.encodePacked(
                propertiesJson,
                ',"map_overlay":"', details.map_overlay, '"'
            ));
        }
        
        // Add custom metadata if present
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            propertiesJson = string(abi.encodePacked(
                propertiesJson,
                ',"custom":', tokenCustomMetadata[tokenId]
            ));
        }
        
        // Close properties object
        propertiesJson = string(abi.encodePacked(propertiesJson, '}'));
        
        return propertiesJson;
    }
    
    /**
     * @dev Builds documents JSON object
     */
    function buildDocumentsJson(uint256 tokenId) internal view returns (string memory) {
        string memory documentsJson = "{";
        
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
        
        documentsJson = string(abi.encodePacked(documentsJson, '}'));
        return documentsJson;
    }
} 