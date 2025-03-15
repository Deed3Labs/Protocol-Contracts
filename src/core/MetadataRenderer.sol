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
        // Use a helper function to build the JSON to reduce stack variables
        string memory json = _buildTokenJSON(tokenContract, tokenId);
        
        // Return base64 encoded JSON
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64Upgradeable.encode(bytes(json))
        ));
    }

    /**
     * @dev Helper function to build token JSON metadata
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return JSON string with token metadata
     */
    function _buildTokenJSON(address tokenContract, uint256 tokenId) internal view returns (string memory) {
        IDeedNFT deedNFT = IDeedNFT(tokenContract);
        
        // Check if token exists by trying to get its owner
        address owner;
        try deedNFT.ownerOf(tokenId) returns (address _owner) {
            owner = _owner;
        } catch {
            revert("Token does not exist");
        }
        
        // Get and decode trait values
        (
            uint8 assetType,
            bool isValidated,
            string memory definition,
            string memory configuration,
            address validator
        ) = _getDecodedTraits(deedNFT, tokenId);
        
        // Get property details
        PropertyDetails memory details = tokenPropertyDetails[tokenId];
        
        // Build the basic JSON parts
        string memory mainImage = _getMainImage(tokenId, assetType, isValidated);
        string memory assetTypeName = _getAssetTypeName(assetType);
        string memory propertyName = _buildPropertyName(details, tokenId);
        
        // Start building the JSON
        string memory jsonStart = _buildJsonStart(propertyName, definition, mainImage, tokenId);
        
        // Build the remaining JSON parts
        string memory jsonOptionalFields = _buildOptionalFields(details);
        string memory jsonGallery = _buildGalleryJson(tokenId);
        string memory jsonFeatures = _buildFeaturesSection(tokenId);
        string memory jsonAttributes = _buildAttributesJson(assetTypeName, isValidated, configuration, details, owner, validator);
        string memory jsonProperties = _buildPropertiesJson(configuration, details, tokenId);
        
        // Combine all parts
        return string(abi.encodePacked(
            jsonStart,
            jsonOptionalFields,
            jsonGallery,
            jsonFeatures,
            jsonAttributes,
            jsonProperties,
            "}}"
        ));
    }

    /**
     * @dev Gets and decodes trait values from the DeedNFT contract
     */
    function _getDecodedTraits(IDeedNFT deedNFT, uint256 tokenId) internal view returns (
        uint8 assetType,
        bool isValidated,
        string memory definition,
        string memory configuration,
        address validator
    ) {
        bytes memory assetTypeBytes = deedNFT.getTraitValue(tokenId, keccak256("assetType"));
        bytes memory isValidatedBytes = deedNFT.getTraitValue(tokenId, keccak256("isValidated"));
        bytes memory definitionBytes = deedNFT.getTraitValue(tokenId, keccak256("definition"));
        bytes memory configurationBytes = deedNFT.getTraitValue(tokenId, keccak256("configuration"));
        bytes memory validatorBytes = deedNFT.getTraitValue(tokenId, keccak256("validator"));
        
        assetType = uint8(abi.decode(assetTypeBytes, (uint256)));
        isValidated = abi.decode(isValidatedBytes, (bool));
        definition = abi.decode(definitionBytes, (string));
        configuration = abi.decode(configurationBytes, (string));
        validator = abi.decode(validatorBytes, (address));
        
        return (assetType, isValidated, definition, configuration, validator);
    }

    /**
     * @dev Gets the main image for the token
     */
    function _getMainImage(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        if (tokenGalleryImages[tokenId].length > 0) {
            return tokenGalleryImages[tokenId][0];
        } else {
            return isValidated ? assetTypeImageURIs[assetType] : invalidatedImageURI;
        }
    }

    /**
     * @dev Gets the asset type name
     */
    function _getAssetTypeName(uint8 assetType) internal pure returns (string memory) {
        if (assetType == 0) return "Land";
        else if (assetType == 1) return "Vehicle";
        else if (assetType == 2) return "Estate";
        else return "Commercial Equipment";
    }

    /**
     * @dev Builds the property name
     */
    function _buildPropertyName(PropertyDetails memory details, uint256 tokenId) internal view returns (string memory) {
        if (bytes(details.streetNumber).length > 0 && bytes(details.streetName).length > 0) {
            return string(abi.encodePacked(
                details.streetNumber, ' ', 
                details.streetName, ', ', 
                details.city, ', ', 
                details.state, 
                ' #', tokenId.toString()
            ));
        } else {
            return string(abi.encodePacked("Deed #", tokenId.toString()));
        }
    }

    /**
     * @dev Builds the start of the JSON
     */
    function _buildJsonStart(string memory propertyName, string memory definition, string memory mainImage, uint256 tokenId) internal view returns (string memory) {
        return string(abi.encodePacked(
            '{',
            '"name":"', propertyName, '",',
            '"description":"', definition, '",',
            '"image":"', mainImage, '",',
            '"external_url":"', baseURI, tokenId.toString(), '",'
        ));
    }

    /**
     * @dev Builds optional fields section
     */
    function _buildOptionalFields(PropertyDetails memory details) internal pure returns (string memory) {
        string memory result = "";
        
        if (bytes(details.background_color).length > 0) {
            result = string(abi.encodePacked(
                result,
                '"background_color":"', details.background_color, '",'
            ));
        }
        
        if (bytes(details.animation_url).length > 0) {
            result = string(abi.encodePacked(
                result,
                '"animation_url":"', details.animation_url, '",'
            ));
        }
        
        return result;
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
     * @dev Builds features section
     */
    function _buildFeaturesSection(uint256 tokenId) internal view returns (string memory) {
        return string(abi.encodePacked('"features":', _buildFeaturesJson(tokenId), ','));
    }

    /**
     * @dev Builds attributes JSON
     */
    function _buildAttributesJson(
        string memory assetTypeName, 
        bool isValidated, 
        string memory configuration, 
        PropertyDetails memory details, 
        address beneficiary,
        address validator
    ) internal view returns (string memory) {
        string memory attributes = string(abi.encodePacked(
            '[{"trait_type":"Asset Type","value":"', assetTypeName, '"},',
            '{"trait_type":"Validation Status","value":"', isValidated ? "Validated" : "Unvalidated", '"},',
            '{"trait_type":"Operating Agreement","value":"', configuration, '"},'
        ));
        
        // Add property details as attributes
        attributes = string(abi.encodePacked(
            attributes,
            '{"trait_type":"Country","value":"', details.country, '"},',
            '{"trait_type":"State","value":"', details.state, '"},',
            '{"trait_type":"County","value":"', details.county, '"},',
            '{"trait_type":"City","value":"', details.city, '"},'
        ));
        
        attributes = string(abi.encodePacked(
            attributes,
            '{"trait_type":"Street Number","value":"', details.streetNumber, '"},',
            '{"trait_type":"Street Name","value":"', details.streetName, '"},',
            '{"trait_type":"Parcel Number","value":"', details.parcelNumber, '"},',
            '{"trait_type":"Holding Entity","value":"', details.holdingEntity, '"},'
        ));
        
        attributes = string(abi.encodePacked(
            attributes,
            '{"trait_type":"Latitude","value":"', details.latitude, '"},',
            '{"trait_type":"Longitude","value":"', details.longitude, '"},',
            '{"trait_type":"Acres","value":"', details.acres, '"},',
            '{"trait_type":"Parcel Use","value":"', details.parcelUse, '"},'
        ));
        
        attributes = string(abi.encodePacked(
            attributes,
            '{"trait_type":"Zoning","value":"', details.zoning, '"},',
            '{"trait_type":"Zoning Code","value":"', details.zoningCode, '"},',
            '{"trait_type":"Confidence Score","value":"', details.confidenceScore, '"},',
            '{"trait_type":"Beneficiary","value":"', beneficiary.toHexString(), '"}'
        ));
        
        // Add validator if present
        if (validator != address(0)) {
            attributes = string(abi.encodePacked(
                attributes,
                ',{"trait_type":"Validator","value":"', validator.toHexString(), '"}'
            ));
        }
        
        // Close the attributes array
        attributes = string(abi.encodePacked(attributes, ']'));
        
        return string(abi.encodePacked('"attributes":', attributes, ','));
    }

    /**
     * @dev Builds properties JSON section
     */
    function _buildPropertiesJson(
        string memory configuration, 
        PropertyDetails memory details, 
        uint256 tokenId
    ) internal view returns (string memory) {
        // Start properties object
        string memory propertiesJson = string(abi.encodePacked(
            '"properties":{',
            '"configuration":"', configuration, '",'
        ));
        
        // Add legal information if present
        if (bytes(details.deed_type).length > 0) {
            propertiesJson = string(abi.encodePacked(
                propertiesJson,
                '"legal":{',
                '"deed_type":"', details.deed_type, '",',
                '"recording_date":"', details.recording_date, '",',
                '"recording_number":"', details.recording_number, '",',
                '"legal_description":"', details.legal_description, '"',
                '},'
            ));
        }
        
        // Add utilities
        propertiesJson = string(abi.encodePacked(
            propertiesJson,
            '"utilities":{',
            '"water":', details.has_water ? "true" : "false", ',',
            '"electricity":', details.has_electricity ? "true" : "false", ',',
            '"natural_gas":', details.has_natural_gas ? "true" : "false", ',',
            '"sewer":', details.has_sewer ? "true" : "false", ',',
            '"internet":', details.has_internet ? "true" : "false",
            '},'
        ));
        
        // Add documents
        propertiesJson = string(abi.encodePacked(
            propertiesJson,
            _buildDocumentsJson(tokenId)
        ));
        
        // Add map overlay if present
        if (bytes(details.map_overlay).length > 0) {
            propertiesJson = string(abi.encodePacked(
                propertiesJson,
                '"map_overlay":"', details.map_overlay, '",'
            ));
        }
        
        // Add custom metadata if present
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            propertiesJson = string(abi.encodePacked(
                propertiesJson,
                '"custom":', tokenCustomMetadata[tokenId]
            ));
        }
        
        return propertiesJson;
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