// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/Base64Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./IERC7572.sol";

/**
 * @dev Interface for DeedNFT contract
 */
interface IDeedNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getTraitValue(uint256 tokenId, bytes32 traitKey) external view returns (bytes memory);
    function getValidationStatus(uint256 tokenId) external view returns (bool isValidated, address validator);
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }
}

/**
 * @title MetadataRenderer
 * @dev Renders metadata for NFTs with property details
 */
contract MetadataRenderer is Initializable, OwnableUpgradeable, UUPSUpgradeable, IERC7572 {
    using StringsUpgradeable for uint256;
    using StringsUpgradeable for address;
    using Base64Upgradeable for bytes;

    // Base URI for external links
    string public baseURI;
    
    // Default images for asset types
    mapping(uint8 => string) public assetTypeImageURIs;
    
    // Image for invalidated assets
    string public invalidatedImageURI;
    
    // Base details shared across all asset types
    struct BaseDetails {
        // Validation
        string confidenceScore;
        
        // Display details
        string background_color;
        string animation_url;
    }

    // Property details for Land and Estate assets
    struct PropertyDetails {
        // Base details
        BaseDetails base;
        
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
        
        // Value details
        string taxValueSource;
        string taxAssessedValueUSD;
        string estimatedValueSource;
        string estimatedMarketValueUSD;
        string localAppraisalSource;
        string localAppraisedValueUSD;
        
        // Build details
        string buildYear;
        
        // Utilities
        bool has_water;
        bool has_electricity;
        bool has_natural_gas;
        bool has_sewer;
        bool has_internet;
        
        // Map overlay
        string map_overlay;
    }

    // Vehicle details
    struct VehicleDetails {
        // Base details
        BaseDetails base;
        
        // Vehicle identification
        string make;
        string model;
        string year;
        string vin;
        string licensePlate;
        string registrationState;
        
        // Physical details
        string color;
        string bodyType;
        string fuelType;
        string transmissionType;
        string mileage;
        string engineSize;
        
        // Ownership details
        string titleNumber;
        string titleState;
        string titleStatus;
        string registrationExpiration;
        string holdingEntity;
        
        // Value details
        string appraisalSource;
        string appraisedValueUSD;
        string estimatedValueSource;
        string estimatedMarketValueUSD;
        
        // Condition
        string condition;
        string lastServiceDate;
    }

    // Commercial Equipment details
    struct EquipmentDetails {
        // Base details
        BaseDetails base;
        
        // Equipment identification
        string manufacturer;
        string model;
        string serialNumber;
        string year;
        string category;
        string equipmentType;
        
        // Physical details
        string dimensions;
        string weight;
        string powerSource;
        string operatingHours;
        
        // Ownership details
        string purchaseDate;
        string warrantyExpiration;
        string holdingEntity;
        string location;
        
        // Value details
        string appraisalSource;
        string appraisedValueUSD;
        string estimatedValueSource;
        string estimatedMarketValueUSD;
        string depreciationSchedule;
        
        // Condition
        string condition;
        string lastServiceDate;
        string maintenanceSchedule;
    }

    // Storage for different asset types
    mapping(uint256 => PropertyDetails) public tokenPropertyDetails;
    mapping(uint256 => VehicleDetails) public tokenVehicleDetails;
    mapping(uint256 => EquipmentDetails) public tokenEquipmentDetails;
    
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
        string memory country,
        string memory state,
        string memory county,
        string memory city,
        string memory streetNumber,
        string memory streetName,
        string memory parcelNumber,
        string memory deed_type,
        string memory recording_date,
        string memory recording_number,
        string memory legal_description,
        string memory holdingEntity,
        string memory latitude,
        string memory longitude,
        string memory acres,
        string memory parcelUse,
        string memory zoning,
        string memory zoningCode,
        string memory taxValueSource,
        string memory taxAssessedValueUSD,
        string memory estimatedValueSource,
        string memory estimatedMarketValueUSD,
        string memory localAppraisalSource,
        string memory localAppraisedValueUSD,
        string memory buildYear,
        bool has_water,
        bool has_electricity,
        bool has_natural_gas,
        bool has_sewer,
        bool has_internet,
        string memory map_overlay
    ) external onlyOwner {
        PropertyDetails storage details = tokenPropertyDetails[tokenId];
        details.country = country;
        details.state = state;
        details.county = county;
        details.city = city;
        details.streetNumber = streetNumber;
        details.streetName = streetName;
        details.parcelNumber = parcelNumber;
        details.deed_type = deed_type;
        details.recording_date = recording_date;
        details.recording_number = recording_number;
        details.legal_description = legal_description;
        details.holdingEntity = holdingEntity;
        details.latitude = latitude;
        details.longitude = longitude;
        details.acres = acres;
        details.parcelUse = parcelUse;
        details.zoning = zoning;
        details.zoningCode = zoningCode;
        details.taxValueSource = taxValueSource;
        details.taxAssessedValueUSD = taxAssessedValueUSD;
        details.estimatedValueSource = estimatedValueSource;
        details.estimatedMarketValueUSD = estimatedMarketValueUSD;
        details.localAppraisalSource = localAppraisalSource;
        details.localAppraisedValueUSD = localAppraisedValueUSD;
        details.buildYear = buildYear;
        details.has_water = has_water;
        details.has_electricity = has_electricity;
        details.has_natural_gas = has_natural_gas;
        details.has_sewer = has_sewer;
        details.has_internet = has_internet;
        details.map_overlay = map_overlay;
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
     * @dev Generates token URI for a specific token
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return URI for the token metadata
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        // Get asset type from token
        bytes memory assetTypeBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("assetType"));
        if (assetTypeBytes.length == 0) {
            return ""; // Invalid token
        }
        
        uint256 assetType = abi.decode(assetTypeBytes, (uint256));
        
        // Generate metadata based on asset type
        if (assetType == uint256(IDeedNFT.AssetType.Land) || assetType == uint256(IDeedNFT.AssetType.Estate)) {
            return _generatePropertyMetadata(tokenContract, tokenId);
        } else if (assetType == uint256(IDeedNFT.AssetType.Vehicle)) {
            return _generateVehicleMetadata(tokenContract, tokenId);
        } else if (assetType == uint256(IDeedNFT.AssetType.CommercialEquipment)) {
            return _generateEquipmentMetadata(tokenContract, tokenId);
        }
        
        return ""; // Unsupported asset type
    }
    
    /**
     * @dev Generates metadata for property assets (Land and Estate)
     */
    function _generatePropertyMetadata(address tokenContract, uint256 tokenId) internal view returns (string memory) {
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
     * @dev Generates metadata for vehicle assets
     */
    function _generateVehicleMetadata(address tokenContract, uint256 tokenId) internal view returns (string memory) {
        // Similar to property metadata but with vehicle-specific fields
        VehicleDetails memory details = tokenVehicleDetails[tokenId];
        
        // Get validation status
        (bool isValidated, address validator) = IDeedNFT(tokenContract).getValidationStatus(tokenId);
        
        // Get definition and configuration
        bytes memory definitionBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("definition"));
        bytes memory configurationBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("configuration"));
        
        string memory definition = definitionBytes.length > 0 ? abi.decode(definitionBytes, (string)) : "";
        string memory configuration = configurationBytes.length > 0 ? abi.decode(configurationBytes, (string)) : "";
        
        // Generate name
        string memory name = string(abi.encodePacked(
            details.year, " ", details.make, " ", details.model, " #", tokenId.toString()
        ));
        
        // Generate attributes
        string memory attributes = _generateVehicleAttributes(tokenId, details, isValidated);
        
        // Generate properties
        string memory properties = _generateVehicleProperties(tokenId, details, configuration);
        
        // Generate final JSON
        string memory json = string(abi.encodePacked(
            '{',
            '"name":"', name, '",',
            '"description":"', definition, '",',
            '"image":"', isValidated ? _getAssetTypeImage(uint8(IDeedNFT.AssetType.Vehicle)) : invalidatedImageURI, '",',
            '"external_url":"', baseURI, 'deed/', tokenId.toString(), '",',
            '"background_color":"', details.base.background_color, '",',
            details.base.animation_url.length > 0 ? string(abi.encodePacked('"animation_url":"', details.base.animation_url, '",')) : "",
            '"attributes":[', attributes, '],',
            '"properties":', properties,
            '}'
        ));
        
        return string(abi.encodePacked("data:application/json;base64,", Base64Upgradeable.encode(bytes(json))));
    }
    
    /**
     * @dev Generates metadata for commercial equipment assets
     */
    function _generateEquipmentMetadata(address tokenContract, uint256 tokenId) internal view returns (string memory) {
        // Similar to vehicle metadata but with equipment-specific fields
        EquipmentDetails memory details = tokenEquipmentDetails[tokenId];
        
        // Get validation status
        (bool isValidated, address validator) = IDeedNFT(tokenContract).getValidationStatus(tokenId);
        
        // Get definition and configuration
        bytes memory definitionBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("definition"));
        bytes memory configurationBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("configuration"));
        
        string memory definition = definitionBytes.length > 0 ? abi.decode(definitionBytes, (string)) : "";
        string memory configuration = configurationBytes.length > 0 ? abi.decode(configurationBytes, (string)) : "";
        
        // Generate name
        string memory name = string(abi.encodePacked(
            details.year, " ", details.manufacturer, " ", details.model, " #", tokenId.toString()
        ));
        
        // Generate attributes
        string memory attributes = _generateEquipmentAttributes(tokenId, details, isValidated);
        
        // Generate properties
        string memory properties = _generateEquipmentProperties(tokenId, details, configuration);
        
        // Generate final JSON
        string memory json = string(abi.encodePacked(
            '{',
            '"name":"', name, '",',
            '"description":"', definition, '",',
            '"image":"', isValidated ? _getAssetTypeImage(uint8(IDeedNFT.AssetType.CommercialEquipment)) : invalidatedImageURI, '",',
            '"external_url":"', baseURI, 'deed/', tokenId.toString(), '",',
            '"background_color":"', details.base.background_color, '",',
            details.base.animation_url.length > 0 ? string(abi.encodePacked('"animation_url":"', details.base.animation_url, '",')) : "",
            '"attributes":[', attributes, '],',
            '"properties":', properties,
            '}'
        ));
        
        return string(abi.encodePacked("data:application/json;base64,", Base64Upgradeable.encode(bytes(json))));
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
        
        // Add value attributes
        if (bytes(details.taxValueSource).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Tax Value Source","value":"', details.taxValueSource, '"}'));
        }
        
        if (bytes(details.taxAssessedValueUSD).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Tax Assessed Value (USD)","value":"', details.taxAssessedValueUSD, '"}'));
        }
        
        if (bytes(details.estimatedValueSource).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Estimated Value Source","value":"', details.estimatedValueSource, '"}'));
        }
        
        if (bytes(details.estimatedMarketValueUSD).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Estimated Market Value (USD)","value":"', details.estimatedMarketValueUSD, '"}'));
        }
        
        if (bytes(details.localAppraisalSource).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Local Appraisal Source","value":"', details.localAppraisalSource, '"}'));
        }
        
        if (bytes(details.localAppraisedValueUSD).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Local Appraised Value (USD)","value":"', details.localAppraisedValueUSD, '"}'));
        }
        
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

    /**
     * @dev Generates attributes for property metadata
     */
    function _generatePropertyAttributes(uint256 tokenId, PropertyDetails memory details, bool isValidated) internal view returns (string memory) {
        string memory attributes = string(abi.encodePacked(
            '{"trait_type":"Validation Status","value":"', isValidated ? 'Validated' : 'Unvalidated', '"}'
        ));
        
        // Add location attributes
        if (bytes(details.country).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Country","value":"', details.country, '"}'));
        }
        
        if (bytes(details.state).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"State","value":"', details.state, '"}'));
        }
        
        // Add other property attributes...
        // (Include all property fields)
        
        // Add value attributes
        if (bytes(details.taxValueSource).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Tax Value Source","value":"', details.taxValueSource, '"}'));
        }
        
        if (bytes(details.taxAssessedValueUSD).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Tax Assessed Value (USD)","value":"', details.taxAssessedValueUSD, '"}'));
        }
        
        if (bytes(details.estimatedValueSource).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Estimated Value Source","value":"', details.estimatedValueSource, '"}'));
        }
        
        if (bytes(details.estimatedMarketValueUSD).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Estimated Market Value (USD)","value":"', details.estimatedMarketValueUSD, '"}'));
        }
        
        if (bytes(details.localAppraisalSource).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Local Appraisal Source","value":"', details.localAppraisalSource, '"}'));
        }
        
        if (bytes(details.localAppraisedValueUSD).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Local Appraised Value (USD)","value":"', details.localAppraisedValueUSD, '"}'));
        }
        
        if (bytes(details.buildYear).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Build Year","value":"', details.buildYear, '"}'));
        }
        
        // Add features as attributes
        string[] memory features = tokenFeatures[tokenId];
        for (uint i = 0; i < features.length; i++) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Feature","value":"', features[i], '"}'));
        }
        
        return attributes;
    }

    /**
     * @dev Generates attributes for vehicle metadata
     */
    function _generateVehicleAttributes(uint256 tokenId, VehicleDetails memory details, bool isValidated) internal view returns (string memory) {
        string memory attributes = string(abi.encodePacked(
            '{"trait_type":"Asset Type","value":"Vehicle"}',
            ',{"trait_type":"Validation Status","value":"', isValidated ? 'Validated' : 'Unvalidated', '"}'
        ));
        
        // Add vehicle identification attributes
        if (bytes(details.make).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Make","value":"', details.make, '"}'));
        }
        
        if (bytes(details.model).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Model","value":"', details.model, '"}'));
        }
        
        if (bytes(details.year).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Year","value":"', details.year, '"}'));
        }
        
        if (bytes(details.vin).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"VIN","value":"', details.vin, '"}'));
        }
        
        // Add other vehicle attributes...
        // (Include all vehicle fields)
        
        // Add features as attributes
        string[] memory features = tokenFeatures[tokenId];
        for (uint i = 0; i < features.length; i++) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Feature","value":"', features[i], '"}'));
        }
        
        return attributes;
    }

    /**
     * @dev Generates attributes for equipment metadata
     */
    function _generateEquipmentAttributes(uint256 tokenId, EquipmentDetails memory details, bool isValidated) internal view returns (string memory) {
        string memory attributes = string(abi.encodePacked(
            '{"trait_type":"Asset Type","value":"Commercial Equipment"}',
            ',{"trait_type":"Validation Status","value":"', isValidated ? 'Validated' : 'Unvalidated', '"}'
        ));
        
        // Add equipment identification attributes
        if (bytes(details.manufacturer).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Manufacturer","value":"', details.manufacturer, '"}'));
        }
        
        if (bytes(details.model).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Model","value":"', details.model, '"}'));
        }
        
        if (bytes(details.year).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Year","value":"', details.year, '"}'));
        }
        
        if (bytes(details.serialNumber).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Serial Number","value":"', details.serialNumber, '"}'));
        }
        
        if (bytes(details.category).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Category","value":"', details.category, '"}'));
        }
        
        if (bytes(details.equipmentType).length > 0) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Equipment Type","value":"', details.equipmentType, '"}'));
        }
        
        // Add other equipment attributes...
        // (Include all equipment fields)
        
        // Add features as attributes
        string[] memory features = tokenFeatures[tokenId];
        for (uint i = 0; i < features.length; i++) {
            attributes = string(abi.encodePacked(attributes, 
                ',{"trait_type":"Feature","value":"', features[i], '"}'));
        }
        
        return attributes;
    }

    /**
     * @dev Generates properties for property metadata
     */
    function _generatePropertyProperties(uint256 tokenId, PropertyDetails memory details, string memory configuration) internal view returns (string memory) {
        // Generate properties JSON object
        string memory properties = string(abi.encodePacked(
            '{',
            '"configuration":"', configuration, '",',
            '"legal":{',
            '"deed_type":"', details.deed_type, '",',
            '"recording_date":"', details.recording_date, '",',
            '"recording_number":"', details.recording_number, '",',
            '"legal_description":"', details.legal_description, '"',
            '},',
            '"value":{',
            '"tax_value_source":"', details.taxValueSource, '",',
            '"tax_assessed_value_usd":"', details.taxAssessedValueUSD, '",',
            '"estimated_value_source":"', details.estimatedValueSource, '",',
            '"estimated_market_value_usd":"', details.estimatedMarketValueUSD, '",',
            '"local_appraisal_source":"', details.localAppraisalSource, '",',
            '"local_appraised_value_usd":"', details.localAppraisedValueUSD, '"',
            '},',
            '"utilities":{',
            '"water":', details.has_water ? 'true' : 'false', ',',
            '"electricity":', details.has_electricity ? 'true' : 'false', ',',
            '"natural_gas":', details.has_natural_gas ? 'true' : 'false', ',',
            '"sewer":', details.has_sewer ? 'true' : 'false', ',',
            '"internet":', details.has_internet ? 'true' : 'false',
            '}'
        ));
        
        // Add features
        string[] memory features = tokenFeatures[tokenId];
        if (features.length > 0) {
            properties = string(abi.encodePacked(properties, ',"features":['));
            
            for (uint i = 0; i < features.length; i++) {
                if (i > 0) {
                    properties = string(abi.encodePacked(properties, ','));
                }
                properties = string(abi.encodePacked(properties, '"', features[i], '"'));
            }
            
            properties = string(abi.encodePacked(properties, ']'));
        }
        
        // Add documents
        string[] memory docTypes = tokenDocumentTypes[tokenId];
        if (docTypes.length > 0) {
            properties = string(abi.encodePacked(properties, ',"documents":{'));
            
            for (uint i = 0; i < docTypes.length; i++) {
                if (i > 0) {
                    properties = string(abi.encodePacked(properties, ','));
                }
                string memory docType = docTypes[i];
                string memory docURI = tokenDocuments[tokenId][docType];
                properties = string(abi.encodePacked(properties, '"', docType, '":"', docURI, '"'));
            }
            
            properties = string(abi.encodePacked(properties, '}'));
        }
        
        // Add map overlay if available
        if (bytes(details.map_overlay).length > 0) {
            properties = string(abi.encodePacked(properties, ',"map_overlay":"', details.map_overlay, '"'));
        }
        
        // Close properties object
        properties = string(abi.encodePacked(properties, '}'));
        
        return properties;
    }

    /**
     * @dev Generates properties for vehicle metadata
     */
    function _generateVehicleProperties(uint256 tokenId, VehicleDetails memory details, string memory configuration) internal view returns (string memory) {
        // Generate properties JSON object
        string memory properties = string(abi.encodePacked(
            '{',
            '"configuration":"', configuration, '",',
            '"vehicle_details":{',
            '"make":"', details.make, '",',
            '"model":"', details.model, '",',
            '"year":"', details.year, '",',
            '"vin":"', details.vin, '",',
            '"license_plate":"', details.licensePlate, '",',
            '"registration_state":"', details.registrationState, '"',
            '},',
            '"physical_details":{',
            '"color":"', details.color, '",',
            '"body_type":"', details.bodyType, '",',
            '"fuel_type":"', details.fuelType, '",',
            '"transmission_type":"', details.transmissionType, '",',
            '"mileage":"', details.mileage, '",',
            '"engine_size":"', details.engineSize, '"',
            '},',
            '"ownership_details":{',
            '"title_number":"', details.titleNumber, '",',
            '"title_state":"', details.titleState, '",',
            '"title_status":"', details.titleStatus, '",',
            '"registration_expiration":"', details.registrationExpiration, '",',
            '"holding_entity":"', details.holdingEntity, '"',
            '},',
            '"value":{',
            '"appraisal_source":"', details.appraisalSource, '",',
            '"appraised_value_usd":"', details.appraisedValueUSD, '",',
            '"estimated_value_source":"', details.estimatedValueSource, '",',
            '"estimated_market_value_usd":"', details.estimatedMarketValueUSD, '"',
            '},',
            '"condition":{',
            '"status":"', details.condition, '",',
            '"last_service_date":"', details.lastServiceDate, '"',
            '}'
        ));
        
        // Add features
        string[] memory features = tokenFeatures[tokenId];
        if (features.length > 0) {
            properties = string(abi.encodePacked(properties, ',"features":['));
            
            for (uint i = 0; i < features.length; i++) {
                if (i > 0) {
                    properties = string(abi.encodePacked(properties, ','));
                }
                properties = string(abi.encodePacked(properties, '"', features[i], '"'));
            }
            
            properties = string(abi.encodePacked(properties, ']'));
        }
        
        // Add documents
        string[] memory docTypes = tokenDocumentTypes[tokenId];
        if (docTypes.length > 0) {
            properties = string(abi.encodePacked(properties, ',"documents":{'));
            
            for (uint i = 0; i < docTypes.length; i++) {
                if (i > 0) {
                    properties = string(abi.encodePacked(properties, ','));
                }
                string memory docType = docTypes[i];
                string memory docURI = tokenDocuments[tokenId][docType];
                properties = string(abi.encodePacked(properties, '"', docType, '":"', docURI, '"'));
            }
            
            properties = string(abi.encodePacked(properties, '}'));
        }
        
        // Close properties object
        properties = string(abi.encodePacked(properties, '}'));
        
        return properties;
    }

    /**
     * @dev Generates properties for equipment metadata
     */
    function _generateEquipmentProperties(uint256 tokenId, EquipmentDetails memory details, string memory configuration) internal view returns (string memory) {
        // Generate properties JSON object
        string memory properties = string(abi.encodePacked(
            '{',
            '"configuration":"', configuration, '",',
            '"equipment_details":{',
            '"manufacturer":"', details.manufacturer, '",',
            '"model":"', details.model, '",',
            '"serial_number":"', details.serialNumber, '",',
            '"year":"', details.year, '",',
            '"category":"', details.category, '",',
            '"type":"', details.equipmentType, '"',
            '},',
            '"physical_details":{',
            '"dimensions":"', details.dimensions, '",',
            '"weight":"', details.weight, '",',
            '"power_source":"', details.powerSource, '",',
            '"operating_hours":"', details.operatingHours, '"',
            '},',
            '"ownership_details":{',
            '"purchase_date":"', details.purchaseDate, '",',
            '"warranty_expiration":"', details.warrantyExpiration, '",',
            '"holding_entity":"', details.holdingEntity, '",',
            '"location":"', details.location, '"',
            '},',
            '"value":{',
            '"appraisal_source":"', details.appraisalSource, '",',
            '"appraised_value_usd":"', details.appraisedValueUSD, '",',
            '"estimated_value_source":"', details.estimatedValueSource, '",',
            '"estimated_market_value_usd":"', details.estimatedMarketValueUSD, '",',
            '"depreciation_schedule":"', details.depreciationSchedule, '"',
            '},',
            '"condition":{',
            '"status":"', details.condition, '",',
            '"last_service_date":"', details.lastServiceDate, '",',
            '"maintenance_schedule":"', details.maintenanceSchedule, '"',
            '}'
        ));
        
        // Add features
        string[] memory features = tokenFeatures[tokenId];
        if (features.length > 0) {
            properties = string(abi.encodePacked(properties, ',"features":['));
            
            for (uint i = 0; i < features.length; i++) {
                if (i > 0) {
                    properties = string(abi.encodePacked(properties, ','));
                }
                properties = string(abi.encodePacked(properties, '"', features[i], '"'));
            }
            
            properties = string(abi.encodePacked(properties, ']'));
        }
        
        // Add documents
        string[] memory docTypes = tokenDocumentTypes[tokenId];
        if (docTypes.length > 0) {
            properties = string(abi.encodePacked(properties, ',"documents":{'));
            
            for (uint i = 0; i < docTypes.length; i++) {
                if (i > 0) {
                    properties = string(abi.encodePacked(properties, ','));
                }
                string memory docType = docTypes[i];
                string memory docURI = tokenDocuments[tokenId][docType];
                properties = string(abi.encodePacked(properties, '"', docType, '":"', docURI, '"'));
            }
            
            properties = string(abi.encodePacked(properties, '}'));
        }
        
        // Close properties object
        properties = string(abi.encodePacked(properties, '}'));
        
        return properties;
    }

    /**
     * @dev Gets the image URI for an asset type
     */
    function _getAssetTypeImage(uint8 assetType) internal view returns (string memory) {
        return assetTypeImageURIs[assetType];
    }
} 