// src/core/MetadataRenderer.sol
// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/Base64Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";

// Libraries
import "../libraries/StringUtils.sol";
import "../libraries/JSONUtils.sol";
import "../libraries/MetadataGenerationLibrary.sol";
import "../libraries/AssetDetailsLibrary.sol";

// Interfaces
import "./interfaces/IERC7572.sol";
import "./interfaces/IDeedNFT.sol";

/**
 * @title MetadataRenderer
 * @dev Renders metadata for NFTs with property details
 */
contract MetadataRenderer is Initializable, OwnableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable, IERC7572 {
    using StringsUpgradeable for uint256;
    using Base64Upgradeable for bytes;
    using StringUtils for string;
    using JSONUtils for string;

    // ============ Role Definitions ============
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    // ============ State Variables ============
    // Mapping to track compatible deed contracts
    mapping(address => bool) public compatibleDeedContracts;
    address[] public deedContractsList;

    // Mapping to track token metadata
    mapping(uint256 => AssetDetailsLibrary.PropertyDetails) private tokenPropertyDetails;
    mapping(uint256 => AssetDetailsLibrary.VehicleDetails) private tokenVehicleDetails;
    mapping(uint256 => AssetDetailsLibrary.EquipmentDetails) private tokenEquipmentDetails;
    
    // Mapping to track token features
    mapping(uint256 => string[]) private tokenFeatures;
    
    // Mapping to track token custom metadata
    mapping(uint256 => string) private tokenCustomMetadata;
    
    // Mapping to track token documents
    mapping(uint256 => string[]) private tokenDocumentTypes;
    mapping(uint256 => mapping(string => string)) private tokenDocuments;
    
    // Mapping to track token gallery images
    mapping(uint256 => string[]) private tokenGalleryImages;
    
    // Mapping to track token validation status
    mapping(uint256 => bool) private tokenValidated;
    
    // Default values
    string public invalidatedImageURI;
    string public defaultImageURI;
    string public defaultAnimationURI;
    string public defaultBackgroundColor;
    
    // ============ Events ============
    event PropertyDetailsUpdated(uint256 indexed tokenId);
    event VehicleDetailsUpdated(uint256 indexed tokenId);
    event EquipmentDetailsUpdated(uint256 indexed tokenId);
    event TokenFeaturesUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    event TokenDocumentAdded(uint256 indexed tokenId, string documentType);
    event TokenDocumentRemoved(uint256 indexed tokenId, string documentType);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenValidationStatusUpdated(uint256 indexed tokenId, bool isValidated);
    event DeedContractAdded(address indexed deedContract);
    event DeedContractRemoved(address indexed deedContract);
    event DefaultValuesUpdated();
    
    // ============ Initializer ============
    /**
     * @dev Initializes the contract
     */
    function initialize() public initializer {
        __Ownable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        
        defaultBackgroundColor = "FFFFFF";
    }
    
    // ============ External Functions ============
    /**
     * @dev Implements IERC7572 interface
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return Token URI
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        require(compatibleDeedContracts[tokenContract], "MetadataRenderer: Incompatible contract");
        return _generateTokenURI(tokenId);
    }
    
    /**
     * @dev Adds a compatible deed contract
     * @param deedContract Address of the deed contract
     */
    function addDeedContract(address deedContract) external onlyOwner {
        require(deedContract != address(0), "MetadataRenderer: Invalid address");
        require(!compatibleDeedContracts[deedContract], "MetadataRenderer: Already added");
        
        compatibleDeedContracts[deedContract] = true;
        deedContractsList.push(deedContract);
        
        emit DeedContractAdded(deedContract);
    }
    
    /**
     * @dev Removes a compatible deed contract
     * @param deedContract Address of the deed contract
     */
    function removeDeedContract(address deedContract) external onlyOwner {
        require(compatibleDeedContracts[deedContract], "MetadataRenderer: Not found");
        
        compatibleDeedContracts[deedContract] = false;
        
        // Remove from list
        for (uint i = 0; i < deedContractsList.length; i++) {
            if (deedContractsList[i] == deedContract) {
                deedContractsList[i] = deedContractsList[deedContractsList.length - 1];
                deedContractsList.pop();
                break;
            }
        }
        
        emit DeedContractRemoved(deedContract);
    }
    
    /**
     * @dev Updates property details for a token
     * @param tokenId ID of the token
     * @param detailsJson JSON string with property details
     */
    function updatePropertyDetails(uint256 tokenId, string memory detailsJson) external onlyRole(VALIDATOR_ROLE) {
        _updatePropertyDetails(tokenId, detailsJson);
        emit PropertyDetailsUpdated(tokenId);
    }
    
    /**
     * @dev Updates vehicle details for a token
     * @param tokenId ID of the token
     * @param detailsJson JSON string with vehicle details
     */
    function updateVehicleDetails(uint256 tokenId, string memory detailsJson) external onlyRole(VALIDATOR_ROLE) {
        _updateVehicleDetails(tokenId, detailsJson);
        emit VehicleDetailsUpdated(tokenId);
    }
    
    /**
     * @dev Updates equipment details for a token
     * @param tokenId ID of the token
     * @param detailsJson JSON string with equipment details
     */
    function updateEquipmentDetails(uint256 tokenId, string memory detailsJson) external onlyRole(VALIDATOR_ROLE) {
        _updateEquipmentDetails(tokenId, detailsJson);
        emit EquipmentDetailsUpdated(tokenId);
    }
    
    /**
     * @dev Updates features for a token
     * @param tokenId ID of the token
     * @param features Array of features
     */
    function updateTokenFeatures(uint256 tokenId, string[] memory features) external onlyRole(VALIDATOR_ROLE) {
        delete tokenFeatures[tokenId];
        
        for (uint i = 0; i < features.length; i++) {
            tokenFeatures[tokenId].push(features[i]);
        }
        
        emit TokenFeaturesUpdated(tokenId);
    }
    
    /**
     * @dev Updates custom metadata for a token
     * @param tokenId ID of the token
     * @param customMetadata JSON string with custom metadata
     */
    function updateTokenCustomMetadata(uint256 tokenId, string memory customMetadata) external onlyRole(VALIDATOR_ROLE) {
        tokenCustomMetadata[tokenId] = customMetadata;
        emit TokenCustomMetadataUpdated(tokenId);
    }
    
    /**
     * @dev Adds a document to a token
     * @param tokenId ID of the token
     * @param documentType Type of the document
     * @param documentURI URI of the document
     */
    function addTokenDocument(uint256 tokenId, string memory documentType, string memory documentURI) external onlyRole(VALIDATOR_ROLE) {
        // Check if document type already exists
        bool exists = false;
        for (uint i = 0; i < tokenDocumentTypes[tokenId].length; i++) {
            if (keccak256(bytes(tokenDocumentTypes[tokenId][i])) == keccak256(bytes(documentType))) {
                exists = true;
                break;
            }
        }
        
        if (!exists) {
            tokenDocumentTypes[tokenId].push(documentType);
        }
        
        tokenDocuments[tokenId][documentType] = documentURI;
        
        emit TokenDocumentAdded(tokenId, documentType);
    }
    
    /**
     * @dev Removes a document from a token
     * @param tokenId ID of the token
     * @param documentType Type of the document
     */
    function removeTokenDocument(uint256 tokenId, string memory documentType) external onlyRole(VALIDATOR_ROLE) {
        // Remove document type from array
        for (uint i = 0; i < tokenDocumentTypes[tokenId].length; i++) {
            if (keccak256(bytes(tokenDocumentTypes[tokenId][i])) == keccak256(bytes(documentType))) {
                tokenDocumentTypes[tokenId][i] = tokenDocumentTypes[tokenId][tokenDocumentTypes[tokenId].length - 1];
                tokenDocumentTypes[tokenId].pop();
                break;
            }
        }
        
        delete tokenDocuments[tokenId][documentType];
        
        emit TokenDocumentRemoved(tokenId, documentType);
    }
    
    /**
     * @dev Updates gallery images for a token
     * @param tokenId ID of the token
     * @param images Array of image URIs
     */
    function updateTokenGallery(uint256 tokenId, string[] memory images) external onlyRole(VALIDATOR_ROLE) {
        delete tokenGalleryImages[tokenId];
        
        for (uint i = 0; i < images.length; i++) {
            tokenGalleryImages[tokenId].push(images[i]);
        }
        
        emit TokenGalleryUpdated(tokenId);
    }
    
    /**
     * @dev Updates validation status for a token
     * @param tokenId ID of the token
     * @param isValidated Whether the token is validated
     */
    function updateTokenValidationStatus(uint256 tokenId, bool isValidated) external onlyRole(VALIDATOR_ROLE) {
        tokenValidated[tokenId] = isValidated;
        emit TokenValidationStatusUpdated(tokenId, isValidated);
    }
    
    /**
     * @dev Updates default values
     * @param _invalidatedImageURI URI for invalidated tokens
     * @param _defaultImageURI Default image URI
     * @param _defaultAnimationURI Default animation URI
     * @param _defaultBackgroundColor Default background color
     */
    function updateDefaultValues(
        string memory _invalidatedImageURI,
        string memory _defaultImageURI,
        string memory _defaultAnimationURI,
        string memory _defaultBackgroundColor
    ) external onlyOwner {
        invalidatedImageURI = _invalidatedImageURI;
        defaultImageURI = _defaultImageURI;
        defaultAnimationURI = _defaultAnimationURI;
        defaultBackgroundColor = _defaultBackgroundColor;
        
        emit DefaultValuesUpdated();
    }
    
    /**
     * @dev Implements supportsInterface for ERC165
     * @param interfaceId Interface ID
     * @return Whether the interface is supported
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable) returns (bool) {
        return interfaceId == type(IERC7572).interfaceId || 
               super.supportsInterface(interfaceId);
    }
    
    // ============ Internal Functions ============
    /**
     * @dev Generates token URI
     * @param tokenId ID of the token
     * @return Token URI
     */
    function _generateTokenURI(uint256 tokenId) internal view returns (string memory) {
        // Get token details from DeedNFT contract
        IDeedNFT deedNFT;
        address deedContract;
        
        // Find the contract that owns this token
        for (uint i = 0; i < deedContractsList.length; i++) {
            try IERC721Upgradeable(deedContractsList[i]).ownerOf(tokenId) returns (address) {
                deedContract = deedContractsList[i];
                deedNFT = IDeedNFT(deedContract);
                break;
            } catch {
                // Token doesn't exist in this contract, try next
            }
        }
        
        require(deedContract != address(0), "MetadataRenderer: Token not found");
        
        // Get asset type
        uint8 assetType;
        try deedNFT.getAssetType(tokenId) returns (IDeedNFT.AssetType _assetType) {
            assetType = uint8(_assetType);
        } catch {
            revert("MetadataRenderer: Failed to get asset type");
        }
        
        // Generate token name
        string memory name = _generateName(tokenId, assetType);
        
        // Generate token description
        string memory description = _generateDescription(tokenId, assetType);
        
        // Get image URI
        string memory imageURI = _getImageURI(tokenId);
        
        // Get animation URL
        string memory animationUrl = _getAnimationURI(tokenId, assetType);
        
        // Get background color
        string memory backgroundColor = _getBackgroundColor(tokenId, assetType);
        
        // Generate gallery
        string memory gallery = "";
        if (tokenGalleryImages[tokenId].length > 0) {
            gallery = MetadataGenerationLibrary.generateGallery(tokenGalleryImages[tokenId]);
        }
        
        // Generate attributes
        string memory attributes = AssetDetailsLibrary.generateAttributes(
            tokenId,
            assetType,
            tokenValidated[tokenId],
            tokenPropertyDetails,
            tokenVehicleDetails,
            tokenEquipmentDetails,
            tokenFeatures
        );
        
        // Generate properties
        string memory properties = AssetDetailsLibrary.generateProperties(
            tokenId,
            assetType,
            "", // definition
            "", // configuration
            tokenPropertyDetails,
            tokenVehicleDetails,
            tokenEquipmentDetails,
            tokenFeatures,
            tokenCustomMetadata,
            tokenDocumentTypes,
            tokenDocuments
        );
        
        // Generate JSON
        return MetadataGenerationLibrary.generateJSON(
            tokenId,
            name,
            description,
            imageURI,
            backgroundColor,
            animationUrl,
            gallery,
            attributes,
            properties
        );
    }
    
    /**
     * @dev Generates token name
     * @param tokenId ID of the token
     * @param assetType Type of the asset
     * @return Token name
     */
    function _generateName(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        string memory name = "";
        
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            AssetDetailsLibrary.PropertyDetails storage details = tokenPropertyDetails[tokenId];
            
            if (bytes(details.streetNumber).length > 0 && bytes(details.streetName).length > 0) {
                name = string(abi.encodePacked(details.streetNumber, " ", details.streetName));
                
                if (bytes(details.city).length > 0 && bytes(details.state).length > 0) {
                    name = string(abi.encodePacked(name, ", ", details.city, ", ", details.state));
                }
            } else {
                name = string(abi.encodePacked("Land Deed #", tokenId.toString()));
            }
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            AssetDetailsLibrary.VehicleDetails storage details = tokenVehicleDetails[tokenId];
            
            if (bytes(details.year).length > 0 && bytes(details.make).length > 0 && bytes(details.model).length > 0) {
                name = string(abi.encodePacked(details.year, " ", details.make, " ", details.model));
            } else {
                name = string(abi.encodePacked("Vehicle Deed #", tokenId.toString()));
            }
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            AssetDetailsLibrary.EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
            
            if (bytes(details.year).length > 0 && bytes(details.manufacturer).length > 0 && bytes(details.model).length > 0) {
                name = string(abi.encodePacked(details.year, " ", details.manufacturer, " ", details.model));
            } else {
                name = string(abi.encodePacked("Equipment Deed #", tokenId.toString()));
            }
        } else {
            name = string(abi.encodePacked("Deed #", tokenId.toString()));
        }
        
        return name;
    }
    
    /**
     * @dev Generates token description
     * @param tokenId ID of the token
     * @param assetType Type of the asset
     * @return Token description
     */
    function _generateDescription(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        string memory description = "";
        
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            AssetDetailsLibrary.PropertyDetails storage details = tokenPropertyDetails[tokenId];
            
            if (bytes(details.legal_description).length > 0) {
                description = details.legal_description;
            } else {
                description = "Land deed representing real property ownership.";
            }
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            description = "Vehicle deed representing ownership of a motor vehicle.";
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            description = "Equipment deed representing ownership of commercial equipment.";
        } else {
            description = "Digital deed representing ownership of an asset.";
        }
        
        return description;
    }
    
    /**
     * @dev Gets image URI for a token
     * @param tokenId ID of the token
     * @return Image URI
     */
    function _getImageURI(uint256 tokenId) internal view returns (string memory) {
        // If token is not validated and invalidated image is set, return that
        if (!tokenValidated[tokenId] && bytes(invalidatedImageURI).length > 0) {
            return invalidatedImageURI;
        }
        
        // Check asset-specific image
        string memory imageURI = "";
        
        if (tokenGalleryImages[tokenId].length > 0) {
            imageURI = tokenGalleryImages[tokenId][0];
        }
        
        // If no image found, use default
        if (bytes(imageURI).length == 0) {
            imageURI = defaultImageURI;
        }
        
        return imageURI;
    }
    
    /**
     * @dev Gets animation URI for a token
     * @param tokenId ID of the token
     * @param assetType Type of the asset
     * @return Animation URI
     */
    function _getAnimationURI(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        string memory animationURI = "";
        
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            animationURI = tokenPropertyDetails[tokenId].base.animation_url;
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            animationURI = tokenVehicleDetails[tokenId].base.animation_url;
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            animationURI = tokenEquipmentDetails[tokenId].base.animation_url;
        }
        
        if (bytes(animationURI).length == 0) {
            animationURI = defaultAnimationURI;
        }
        
        return animationURI;
    }
    
    /**
     * @dev Gets background color for a token
     * @param tokenId ID of the token
     * @param assetType Type of the asset
     * @return Background color
     */
    function _getBackgroundColor(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        string memory backgroundColor = "";
        
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            backgroundColor = tokenPropertyDetails[tokenId].base.background_color;
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            backgroundColor = tokenVehicleDetails[tokenId].base.background_color;
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            backgroundColor = tokenEquipmentDetails[tokenId].base.background_color;
        }
        
        if (bytes(backgroundColor).length == 0) {
            backgroundColor = defaultBackgroundColor;
        }
        
        return backgroundColor;
    }
    
    /**
     * @dev Updates property details for a token
     * @param tokenId ID of the token
     * @param detailsJson JSON string with property details
     */
    function _updatePropertyDetails(uint256 tokenId, string memory detailsJson) internal {
        AssetDetailsLibrary.PropertyDetails storage details = tokenPropertyDetails[tokenId];
        
        // Parse JSON fields
        details.base.confidenceScore = JSONUtils.parseJsonField(detailsJson, "confidence_score");
        details.base.background_color = JSONUtils.parseJsonField(detailsJson, "background_color");
        details.base.animation_url = JSONUtils.parseJsonField(detailsJson, "animation_url");
        
        // Location details
        details.country = JSONUtils.parseJsonField(detailsJson, "country");
        details.state = JSONUtils.parseJsonField(detailsJson, "state");
        details.county = JSONUtils.parseJsonField(detailsJson, "county");
        details.city = JSONUtils.parseJsonField(detailsJson, "city");
        details.streetNumber = JSONUtils.parseJsonField(detailsJson, "street_number");
        details.streetName = JSONUtils.parseJsonField(detailsJson, "street_name");
        details.parcelNumber = JSONUtils.parseJsonField(detailsJson, "parcel_number");
        
        // Legal details
        details.deed_type = JSONUtils.parseJsonField(detailsJson, "deed_type");
        details.recording_date = JSONUtils.parseJsonField(detailsJson, "recording_date");
        details.recording_number = JSONUtils.parseJsonField(detailsJson, "recording_number");
        details.legal_description = JSONUtils.parseJsonField(detailsJson, "legal_description");
        details.holdingEntity = JSONUtils.parseJsonField(detailsJson, "holding_entity");
        
        // Geographic details
        details.latitude = JSONUtils.parseJsonField(detailsJson, "latitude");
        details.longitude = JSONUtils.parseJsonField(detailsJson, "longitude");
        details.acres = JSONUtils.parseJsonField(detailsJson, "acres");
        
        // Zoning details
        details.parcelUse = JSONUtils.parseJsonField(detailsJson, "parcel_use");
        details.zoning = JSONUtils.parseJsonField(detailsJson, "zoning");
        details.zoningCode = JSONUtils.parseJsonField(detailsJson, "zoning_code");
        
        // Value details
        details.taxValueSource = JSONUtils.parseJsonField(detailsJson, "tax_value_source");
        details.taxAssessedValueUSD = JSONUtils.parseJsonField(detailsJson, "tax_assessed_value_usd");
        details.estimatedValueSource = JSONUtils.parseJsonField(detailsJson, "estimated_value_source");
        details.estimatedMarketValueUSD = JSONUtils.parseJsonField(detailsJson, "estimated_market_value_usd");
        details.localAppraisalSource = JSONUtils.parseJsonField(detailsJson, "local_appraisal_source");
        details.localAppraisedValueUSD = JSONUtils.parseJsonField(detailsJson, "local_appraised_value_usd");
        
        // Build details
        details.buildYear = JSONUtils.parseJsonField(detailsJson, "build_year");
        
        // Utilities
        string memory hasWater = JSONUtils.parseJsonField(detailsJson, "has_water");
        string memory hasElectricity = JSONUtils.parseJsonField(detailsJson, "has_electricity");
        string memory hasNaturalGas = JSONUtils.parseJsonField(detailsJson, "has_natural_gas");
        string memory hasSewer = JSONUtils.parseJsonField(detailsJson, "has_sewer");
        string memory hasInternet = JSONUtils.parseJsonField(detailsJson, "has_internet");
        
        details.has_water = _stringToBool(hasWater);
        details.has_electricity = _stringToBool(hasElectricity);
        details.has_natural_gas = _stringToBool(hasNaturalGas);
        details.has_sewer = _stringToBool(hasSewer);
        details.has_internet = _stringToBool(hasInternet);
        
        // Map overlay
        details.map_overlay = JSONUtils.parseJsonField(detailsJson, "map_overlay");
    }
    
    /**
     * @dev Updates vehicle details for a token
     * @param tokenId ID of the token
     * @param detailsJson JSON string with vehicle details
     */
    function _updateVehicleDetails(uint256 tokenId, string memory detailsJson) internal {
        AssetDetailsLibrary.VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Parse JSON fields
        details.base.confidenceScore = JSONUtils.parseJsonField(detailsJson, "confidence_score");
        details.base.background_color = JSONUtils.parseJsonField(detailsJson, "background_color");
        details.base.animation_url = JSONUtils.parseJsonField(detailsJson, "animation_url");
        
        // Vehicle identification
        details.make = JSONUtils.parseJsonField(detailsJson, "make");
        details.model = JSONUtils.parseJsonField(detailsJson, "model");
        details.year = JSONUtils.parseJsonField(detailsJson, "year");
        details.vin = JSONUtils.parseJsonField(detailsJson, "vin");
        details.licensePlate = JSONUtils.parseJsonField(detailsJson, "license_plate");
        details.registrationState = JSONUtils.parseJsonField(detailsJson, "registration_state");
        
        // Physical details
        details.color = JSONUtils.parseJsonField(detailsJson, "color");
        details.bodyType = JSONUtils.parseJsonField(detailsJson, "body_type");
        details.fuelType = JSONUtils.parseJsonField(detailsJson, "fuel_type");
        details.transmissionType = JSONUtils.parseJsonField(detailsJson, "transmission_type");
        details.mileage = JSONUtils.parseJsonField(detailsJson, "mileage");
        details.engineSize = JSONUtils.parseJsonField(detailsJson, "engine_size");
        
        // Ownership details
        details.titleNumber = JSONUtils.parseJsonField(detailsJson, "title_number");
        details.titleState = JSONUtils.parseJsonField(detailsJson, "title_state");
        details.titleStatus = JSONUtils.parseJsonField(detailsJson, "title_status");
        details.registrationExpiration = JSONUtils.parseJsonField(detailsJson, "registration_expiration");
        details.holdingEntity = JSONUtils.parseJsonField(detailsJson, "holding_entity");
        
        // Value details
        details.appraisalSource = JSONUtils.parseJsonField(detailsJson, "appraisal_source");
        details.appraisedValueUSD = JSONUtils.parseJsonField(detailsJson, "appraised_value_usd");
        details.estimatedValueSource = JSONUtils.parseJsonField(detailsJson, "estimated_value_source");
        details.estimatedMarketValueUSD = JSONUtils.parseJsonField(detailsJson, "estimated_market_value_usd");
        
        // Condition
        details.condition = JSONUtils.parseJsonField(detailsJson, "condition");
        details.lastServiceDate = JSONUtils.parseJsonField(detailsJson, "last_service_date");
    }
    
    /**
     * @dev Updates equipment details for a token
     * @param tokenId ID of the token
     * @param detailsJson JSON string with equipment details
     */
    function _updateEquipmentDetails(uint256 tokenId, string memory detailsJson) internal {
        AssetDetailsLibrary.EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
        
        // Parse JSON fields
        details.base.confidenceScore = JSONUtils.parseJsonField(detailsJson, "confidence_score");
        details.base.background_color = JSONUtils.parseJsonField(detailsJson, "background_color");
        details.base.animation_url = JSONUtils.parseJsonField(detailsJson, "animation_url");
        
        // Equipment identification
        details.manufacturer = JSONUtils.parseJsonField(detailsJson, "manufacturer");
        details.model = JSONUtils.parseJsonField(detailsJson, "model");
        details.serialNumber = JSONUtils.parseJsonField(detailsJson, "serial_number");
        details.year = JSONUtils.parseJsonField(detailsJson, "year");
        
        // Physical details
        details.dimensions = JSONUtils.parseJsonField(detailsJson, "dimensions");
        details.weight = JSONUtils.parseJsonField(detailsJson, "weight");
        details.powerSource = JSONUtils.parseJsonField(detailsJson, "power_source");
        
        // Ownership details
        details.purchaseDate = JSONUtils.parseJsonField(detailsJson, "purchase_date");
        details.purchasePrice = JSONUtils.parseJsonField(detailsJson, "purchase_price");
        details.warrantyExpiration = JSONUtils.parseJsonField(detailsJson, "warranty_expiration");
        details.holdingEntity = JSONUtils.parseJsonField(detailsJson, "holding_entity");
        
        // Value details
        details.appraisalSource = JSONUtils.parseJsonField(detailsJson, "appraisal_source");
        details.appraisedValueUSD = JSONUtils.parseJsonField(detailsJson, "appraised_value_usd");
        details.estimatedValueSource = JSONUtils.parseJsonField(detailsJson, "estimated_value_source");
        details.estimatedMarketValueUSD = JSONUtils.parseJsonField(detailsJson, "estimated_market_value_usd");
        
        // Condition and maintenance
        details.condition = JSONUtils.parseJsonField(detailsJson, "condition");
        details.lastServiceDate = JSONUtils.parseJsonField(detailsJson, "last_service_date");
        details.maintenanceSchedule = JSONUtils.parseJsonField(detailsJson, "maintenance_schedule");
    }
    
    /**
     * @dev Helper function to convert string to boolean
     * @param value String value ("true" or "false")
     * @return Boolean value
     */
    function _stringToBool(string memory value) internal pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        if (valueBytes.length == 0) {
            return false;
        }
        
        // Check if the string is "true" (case insensitive)
        if (valueBytes.length == 4 && 
            (valueBytes[0] == 't' || valueBytes[0] == 'T') &&
            (valueBytes[1] == 'r' || valueBytes[1] == 'R') &&
            (valueBytes[2] == 'u' || valueBytes[2] == 'U') &&
            (valueBytes[3] == 'e' || valueBytes[3] == 'E')) {
            return true;
        }
        
        // Check if the string is "1"
        if (valueBytes.length == 1 && valueBytes[0] == '1') {
            return true;
        }
        
        return false;
    }
}