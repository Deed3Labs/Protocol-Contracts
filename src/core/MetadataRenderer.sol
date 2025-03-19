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

// Interfaces
import "./interfaces/IERC7572.sol";
import "./interfaces/IDeedNFT.sol";

/**
 * @title MetadataRenderer
 * @dev Renders metadata for NFTs with property details
 */
contract MetadataRenderer is Initializable, OwnableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable, IERC7572 {
    using StringsUpgradeable for uint256;
    using StringsUpgradeable for address;
    using Base64Upgradeable for bytes;
    using StringUtils for string;
    using JSONUtils for string;

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
    event VehicleDetailsUpdated(uint256 indexed tokenId);
    event EquipmentDetailsUpdated(uint256 indexed tokenId);
    event TokenFeaturesUpdated(uint256 indexed tokenId);
    event TokenDocumentUpdated(uint256 indexed tokenId, string docType);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    event CompatibleDeedContractAdded(address indexed contractAddress);
    event CompatibleDeedContractRemoved(address indexed contractAddress);
    
    IDeedNFT public deedNFT;
    
    // Add this with the other state variables
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    
    // Add these state variables
    mapping(address => bool) public compatibleDeedContracts;
    address[] public deedContractsList;
    
    /**
     * @dev Initializes the contract
     */
    function initialize(string memory _baseURI) public initializer {
        __Ownable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        baseURI = _baseURI;
        
        // Set up roles
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        
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
     * @dev Sets the token gallery
     * @param tokenId ID of the token
     * @param imageUrls Array of image URLs
     */
    function setTokenGallery(uint256 tokenId, string[] memory imageUrls) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MetadataRenderer: Token does not exist");
        _setTokenGallery(tokenId, imageUrls);
    }

    /**
     * @dev Internal function to set the token gallery
     * @param tokenId ID of the token
     * @param imageUrls Array of image URLs
     */
    function _setTokenGallery(uint256 tokenId, string[] memory imageUrls) internal {
        // Clear existing gallery
        delete tokenGalleryImages[tokenId];
        
        // Add new images
        for (uint i = 0; i < imageUrls.length; i++) {
            if (bytes(imageUrls[i]).length > 0) {
                tokenGalleryImages[tokenId].push(imageUrls[i]);
            }
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
     * @dev Updates asset details for a token
     * @param tokenId ID of the token
     * @param assetType Type of the asset (0=Land, 1=Vehicle, 2=Estate, 3=CommercialEquipment)
     * @param details JSON string containing the details to update
     * @notice Fields not included in the details parameter will remain unchanged
     * @notice Empty string values ("") will be ignored and not update the existing value
     */
    function updateAssetDetails(
        uint256 tokenId,
        uint8 assetType,
        string memory details
    ) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MetadataRenderer: Token does not exist");
        require(bytes(details).length > 0, "MetadataRenderer: Details cannot be empty");
        
        // Check for gallery updates
        string memory galleryJson = JSONUtils.parseJsonField(details, "gallery");
        if (bytes(galleryJson).length > 0) {
            // Parse the gallery JSON array into string[]
            string[] memory imageUrls = JSONUtils.parseJsonArrayToStringArray(galleryJson);
            if (imageUrls.length > 0) {
                _setTokenGallery(tokenId, imageUrls);
            }
        }
        
        // Parse the JSON details and update the appropriate storage based on asset type
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            _updatePropertyDetails(tokenId, details);
            emit PropertyDetailsUpdated(tokenId);
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            _updateVehicleDetails(tokenId, details);
            emit VehicleDetailsUpdated(tokenId);
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            _updateEquipmentDetails(tokenId, details);
            emit EquipmentDetailsUpdated(tokenId);
        } else {
            revert("MetadataRenderer: Unsupported asset type");
        }
    }

    /**
     * @dev Internal function to update property details
     * @param tokenId ID of the token
     * @param detailsJson JSON string containing the details to update
     */
    function _updatePropertyDetails(uint256 tokenId, string memory detailsJson) internal {
        PropertyDetails storage details = tokenPropertyDetails[tokenId];
        
        // Update base fields if provided
        string memory confidenceScore = JSONUtils.parseJsonField(detailsJson, "confidenceScore");
        if (bytes(confidenceScore).length > 0) {
            details.base.confidenceScore = confidenceScore;
        }
        
        string memory backgroundColor = JSONUtils.parseJsonField(detailsJson, "background_color");
        if (bytes(backgroundColor).length > 0) {
            details.base.background_color = backgroundColor;
        }
        
        string memory animationUrl = JSONUtils.parseJsonField(detailsJson, "animation_url");
        if (bytes(animationUrl).length > 0) {
            details.base.animation_url = animationUrl;
        }
        
        // Update location fields if provided
        string memory country = JSONUtils.parseJsonField(detailsJson, "country");
        if (bytes(country).length > 0) {
            details.country = country;
        }
        
        string memory state = JSONUtils.parseJsonField(detailsJson, "state");
        if (bytes(state).length > 0) {
            details.state = state;
        }
        
        string memory county = JSONUtils.parseJsonField(detailsJson, "county");
        if (bytes(county).length > 0) {
            details.county = county;
        }
        
        string memory city = JSONUtils.parseJsonField(detailsJson, "city");
        if (bytes(city).length > 0) {
            details.city = city;
        }
        
        string memory streetNumber = JSONUtils.parseJsonField(detailsJson, "streetNumber");
        if (bytes(streetNumber).length > 0) {
            details.streetNumber = streetNumber;
        }
        
        string memory streetName = JSONUtils.parseJsonField(detailsJson, "streetName");
        if (bytes(streetName).length > 0) {
            details.streetName = streetName;
        }
        
        string memory parcelNumber = JSONUtils.parseJsonField(detailsJson, "parcelNumber");
        if (bytes(parcelNumber).length > 0) {
            details.parcelNumber = parcelNumber;
        }
        
        // Update legal fields if provided
        string memory deedType = JSONUtils.parseJsonField(detailsJson, "deed_type");
        if (bytes(deedType).length > 0) {
            details.deed_type = deedType;
        }
        
        string memory recordingDate = JSONUtils.parseJsonField(detailsJson, "recording_date");
        if (bytes(recordingDate).length > 0) {
            details.recording_date = recordingDate;
        }
        
        string memory recordingNumber = JSONUtils.parseJsonField(detailsJson, "recording_number");
        if (bytes(recordingNumber).length > 0) {
            details.recording_number = recordingNumber;
        }
        
        string memory legalDescription = JSONUtils.parseJsonField(detailsJson, "legal_description");
        if (bytes(legalDescription).length > 0) {
            details.legal_description = legalDescription;
        }
        
        // Update geographic fields if provided
        string memory latitude = JSONUtils.parseJsonField(detailsJson, "latitude");
        if (bytes(latitude).length > 0) {
            details.latitude = latitude;
        }
        
        string memory longitude = JSONUtils.parseJsonField(detailsJson, "longitude");
        if (bytes(longitude).length > 0) {
            details.longitude = longitude;
        }
        
        string memory acres = JSONUtils.parseJsonField(detailsJson, "acres");
        if (bytes(acres).length > 0) {
            details.acres = acres;
        }
        
        // Update zoning fields if provided
        string memory zoning = JSONUtils.parseJsonField(detailsJson, "zoning");
        if (bytes(zoning).length > 0) {
            details.zoning = zoning;
        }
        
        string memory zoningCode = JSONUtils.parseJsonField(detailsJson, "zoningCode");
        if (bytes(zoningCode).length > 0) {
            details.zoningCode = zoningCode;
        }
        
        // Update value fields if provided
        string memory taxValueSource = JSONUtils.parseJsonField(detailsJson, "taxValueSource");
        if (bytes(taxValueSource).length > 0) {
            details.taxValueSource = taxValueSource;
        }
        
        string memory taxAssessedValueUSD = JSONUtils.parseJsonField(detailsJson, "taxAssessedValueUSD");
        if (bytes(taxAssessedValueUSD).length > 0) {
            details.taxAssessedValueUSD = taxAssessedValueUSD;
        }
        
        string memory estimatedValueSource = JSONUtils.parseJsonField(detailsJson, "estimatedValueSource");
        if (bytes(estimatedValueSource).length > 0) {
            details.estimatedValueSource = estimatedValueSource;
        }
        
        string memory estimatedMarketValueUSD = JSONUtils.parseJsonField(detailsJson, "estimatedMarketValueUSD");
        if (bytes(estimatedMarketValueUSD).length > 0) {
            details.estimatedMarketValueUSD = estimatedMarketValueUSD;
        }
        
        string memory localAppraisalSource = JSONUtils.parseJsonField(detailsJson, "localAppraisalSource");
        if (bytes(localAppraisalSource).length > 0) {
            details.localAppraisalSource = localAppraisalSource;
        }
        
        string memory localAppraisedValueUSD = JSONUtils.parseJsonField(detailsJson, "localAppraisedValueUSD");
        if (bytes(localAppraisedValueUSD).length > 0) {
            details.localAppraisedValueUSD = localAppraisedValueUSD;
        }
        
        // Update build fields if provided
        string memory buildYear = JSONUtils.parseJsonField(detailsJson, "buildYear");
        if (bytes(buildYear).length > 0) {
            details.buildYear = buildYear;
        }
        
        // Update utility fields if provided
        string memory hasWater = JSONUtils.parseJsonField(detailsJson, "has_water");
        if (bytes(hasWater).length > 0) {
            details.has_water = _stringToBool(hasWater);
        }
        
        string memory hasElectricity = JSONUtils.parseJsonField(detailsJson, "has_electricity");
        if (bytes(hasElectricity).length > 0) {
            details.has_electricity = _stringToBool(hasElectricity);
        }
        
        string memory hasNaturalGas = JSONUtils.parseJsonField(detailsJson, "has_natural_gas");
        if (bytes(hasNaturalGas).length > 0) {
            details.has_natural_gas = _stringToBool(hasNaturalGas);
        }
        
        string memory hasSewer = JSONUtils.parseJsonField(detailsJson, "has_sewer");
        if (bytes(hasSewer).length > 0) {
            details.has_sewer = _stringToBool(hasSewer);
        }
        
        string memory hasInternet = JSONUtils.parseJsonField(detailsJson, "has_internet");
        if (bytes(hasInternet).length > 0) {
            details.has_internet = _stringToBool(hasInternet);
        }
        
        string memory mapOverlay = JSONUtils.parseJsonField(detailsJson, "map_overlay");
        if (bytes(mapOverlay).length > 0) {
            details.map_overlay = mapOverlay;
        }
    }

    /**
     * @dev Internal function to update vehicle details
     * @param tokenId ID of the token
     * @param detailsJson JSON string containing the details to update
     */
    function _updateVehicleDetails(uint256 tokenId, string memory detailsJson) internal {
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Update base fields if provided
        string memory confidenceScore = JSONUtils.parseJsonField(detailsJson, "confidenceScore");
        if (bytes(confidenceScore).length > 0) {
            details.base.confidenceScore = confidenceScore;
        }
        
        string memory backgroundColor = JSONUtils.parseJsonField(detailsJson, "background_color");
        if (bytes(backgroundColor).length > 0) {
            details.base.background_color = backgroundColor;
        }
        
        string memory animationUrl = JSONUtils.parseJsonField(detailsJson, "animation_url");
        if (bytes(animationUrl).length > 0) {
            details.base.animation_url = animationUrl;
        }
        
        // Update vehicle identification fields if provided
        string memory make = JSONUtils.parseJsonField(detailsJson, "make");
        if (bytes(make).length > 0) {
            details.make = make;
        }
        
        string memory model = JSONUtils.parseJsonField(detailsJson, "model");
        if (bytes(model).length > 0) {
            details.model = model;
        }
        
        string memory year = JSONUtils.parseJsonField(detailsJson, "year");
        if (bytes(year).length > 0) {
            details.year = year;
        }
        
        string memory vin = JSONUtils.parseJsonField(detailsJson, "vin");
        if (bytes(vin).length > 0) {
            details.vin = vin;
        }
        
        string memory licensePlate = JSONUtils.parseJsonField(detailsJson, "licensePlate");
        if (bytes(licensePlate).length > 0) {
            details.licensePlate = licensePlate;
        }
        
        string memory registrationState = JSONUtils.parseJsonField(detailsJson, "registrationState");
        if (bytes(registrationState).length > 0) {
            details.registrationState = registrationState;
        }
        
        // Update physical details fields if provided
        string memory color = JSONUtils.parseJsonField(detailsJson, "color");
        if (bytes(color).length > 0) {
            details.color = color;
        }
        
        string memory bodyType = JSONUtils.parseJsonField(detailsJson, "bodyType");
        if (bytes(bodyType).length > 0) {
            details.bodyType = bodyType;
        }
        
        string memory fuelType = JSONUtils.parseJsonField(detailsJson, "fuelType");
        if (bytes(fuelType).length > 0) {
            details.fuelType = fuelType;
        }
        
        string memory transmissionType = JSONUtils.parseJsonField(detailsJson, "transmissionType");
        if (bytes(transmissionType).length > 0) {
            details.transmissionType = transmissionType;
        }
        
        string memory mileage = JSONUtils.parseJsonField(detailsJson, "mileage");
        if (bytes(mileage).length > 0) {
            details.mileage = mileage;
        }
        
        string memory engineSize = JSONUtils.parseJsonField(detailsJson, "engineSize");
        if (bytes(engineSize).length > 0) {
            details.engineSize = engineSize;
        }
        
        // Update ownership details fields if provided
        string memory titleNumber = JSONUtils.parseJsonField(detailsJson, "titleNumber");
        if (bytes(titleNumber).length > 0) {
            details.titleNumber = titleNumber;
        }
        
        string memory titleState = JSONUtils.parseJsonField(detailsJson, "titleState");
        if (bytes(titleState).length > 0) {
            details.titleState = titleState;
        }
        
        string memory titleStatus = JSONUtils.parseJsonField(detailsJson, "titleStatus");
        if (bytes(titleStatus).length > 0) {
            details.titleStatus = titleStatus;
        }
        
        string memory registrationExpiration = JSONUtils.parseJsonField(detailsJson, "registrationExpiration");
        if (bytes(registrationExpiration).length > 0) {
            details.registrationExpiration = registrationExpiration;
        }
        
        string memory holdingEntity = JSONUtils.parseJsonField(detailsJson, "holdingEntity");
        if (bytes(holdingEntity).length > 0) {
            details.holdingEntity = holdingEntity;
        }
        
        // Update value details fields if provided
        string memory appraisalSource = JSONUtils.parseJsonField(detailsJson, "appraisalSource");
        if (bytes(appraisalSource).length > 0) {
            details.appraisalSource = appraisalSource;
        }
        
        string memory appraisedValueUSD = JSONUtils.parseJsonField(detailsJson, "appraisedValueUSD");
        if (bytes(appraisedValueUSD).length > 0) {
            details.appraisedValueUSD = appraisedValueUSD;
        }
        
        string memory estimatedValueSource = JSONUtils.parseJsonField(detailsJson, "estimatedValueSource");
        if (bytes(estimatedValueSource).length > 0) {
            details.estimatedValueSource = estimatedValueSource;
        }
        
        string memory estimatedMarketValueUSD = JSONUtils.parseJsonField(detailsJson, "estimatedMarketValueUSD");
        if (bytes(estimatedMarketValueUSD).length > 0) {
            details.estimatedMarketValueUSD = estimatedMarketValueUSD;
        }
        
        // Update condition fields if provided
        string memory condition = JSONUtils.parseJsonField(detailsJson, "condition");
        if (bytes(condition).length > 0) {
            details.condition = condition;
        }
        
        string memory lastServiceDate = JSONUtils.parseJsonField(detailsJson, "lastServiceDate");
        if (bytes(lastServiceDate).length > 0) {
            details.lastServiceDate = lastServiceDate;
        }
    }

    /**
     * @dev Internal function to update equipment details
     * @param tokenId ID of the token
     * @param detailsJson JSON string containing the details to update
     */
    function _updateEquipmentDetails(uint256 tokenId, string memory detailsJson) internal {
        EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
        
        // Update base fields if provided
        string memory confidenceScore = JSONUtils.parseJsonField(detailsJson, "confidenceScore");
        if (bytes(confidenceScore).length > 0) {
            details.base.confidenceScore = confidenceScore;
        }
        
        string memory backgroundColor = JSONUtils.parseJsonField(detailsJson, "background_color");
        if (bytes(backgroundColor).length > 0) {
            details.base.background_color = backgroundColor;
        }
        
        string memory animationUrl = JSONUtils.parseJsonField(detailsJson, "animation_url");
        if (bytes(animationUrl).length > 0) {
            details.base.animation_url = animationUrl;
        }
        
        // Update equipment identification fields if provided
        string memory manufacturer = JSONUtils.parseJsonField(detailsJson, "manufacturer");
        if (bytes(manufacturer).length > 0) {
            details.manufacturer = manufacturer;
        }
        
        string memory model = JSONUtils.parseJsonField(detailsJson, "model");
        if (bytes(model).length > 0) {
            details.model = model;
        }
        
        string memory serialNumber = JSONUtils.parseJsonField(detailsJson, "serialNumber");
        if (bytes(serialNumber).length > 0) {
            details.serialNumber = serialNumber;
        }
        
        string memory year = JSONUtils.parseJsonField(detailsJson, "year");
        if (bytes(year).length > 0) {
            details.year = year;
        }
        
        string memory category = JSONUtils.parseJsonField(detailsJson, "category");
        if (bytes(category).length > 0) {
            details.category = category;
        }
        
        string memory equipmentType = JSONUtils.parseJsonField(detailsJson, "equipmentType");
        if (bytes(equipmentType).length > 0) {
            details.equipmentType = equipmentType;
        }
        
        // Update physical details if provided
        string memory dimensions = JSONUtils.parseJsonField(detailsJson, "dimensions");
        if (bytes(dimensions).length > 0) {
            details.dimensions = dimensions;
        }
        
        string memory weight = JSONUtils.parseJsonField(detailsJson, "weight");
        if (bytes(weight).length > 0) {
            details.weight = weight;
        }
        
        string memory powerSource = JSONUtils.parseJsonField(detailsJson, "powerSource");
        if (bytes(powerSource).length > 0) {
            details.powerSource = powerSource;
        }
        
        string memory operatingHours = JSONUtils.parseJsonField(detailsJson, "operatingHours");
        if (bytes(operatingHours).length > 0) {
            details.operatingHours = operatingHours;
        }
        
        // Update ownership details if provided
        string memory purchaseDate = JSONUtils.parseJsonField(detailsJson, "purchaseDate");
        if (bytes(purchaseDate).length > 0) {
            details.purchaseDate = purchaseDate;
        }
        
        string memory warrantyExpiration = JSONUtils.parseJsonField(detailsJson, "warrantyExpiration");
        if (bytes(warrantyExpiration).length > 0) {
            details.warrantyExpiration = warrantyExpiration;
        }
        
        string memory location = JSONUtils.parseJsonField(detailsJson, "location");
        if (bytes(location).length > 0) {
            details.location = location;
        }
        
        // Update value details if provided
        string memory appraisalSource = JSONUtils.parseJsonField(detailsJson, "appraisalSource");
        if (bytes(appraisalSource).length > 0) {
            details.appraisalSource = appraisalSource;
        }
        
        string memory appraisedValueUSD = JSONUtils.parseJsonField(detailsJson, "appraisedValueUSD");
        if (bytes(appraisedValueUSD).length > 0) {
            details.appraisedValueUSD = appraisedValueUSD;
        }
        
        string memory estimatedValueSource = JSONUtils.parseJsonField(detailsJson, "estimatedValueSource");
        if (bytes(estimatedValueSource).length > 0) {
            details.estimatedValueSource = estimatedValueSource;
        }
        
        string memory estimatedMarketValueUSD = JSONUtils.parseJsonField(detailsJson, "estimatedMarketValueUSD");
        if (bytes(estimatedMarketValueUSD).length > 0) {
            details.estimatedMarketValueUSD = estimatedMarketValueUSD;
        }
        
        string memory depreciationSchedule = JSONUtils.parseJsonField(detailsJson, "depreciationSchedule");
        if (bytes(depreciationSchedule).length > 0) {
            details.depreciationSchedule = depreciationSchedule;
        }
        
        // Update condition details if provided
        string memory condition = JSONUtils.parseJsonField(detailsJson, "condition");
        if (bytes(condition).length > 0) {
            details.condition = condition;
        }
        
        string memory lastServiceDate = JSONUtils.parseJsonField(detailsJson, "lastServiceDate");
        if (bytes(lastServiceDate).length > 0) {
            details.lastServiceDate = lastServiceDate;
        }
        
        string memory maintenanceSchedule = JSONUtils.parseJsonField(detailsJson, "maintenanceSchedule");
        if (bytes(maintenanceSchedule).length > 0) {
            details.maintenanceSchedule = maintenanceSchedule;
        }
    }

    /**
     * @dev Helper function to parse a field from a JSON string
     * @param json JSON string to parse
     * @param field Field name to extract
     * @return The value of the field as a string, or empty string if not found
     * @notice In production, use a proper JSON parser library
     */
    function _parseJsonField(string memory json, string memory field) internal pure returns (string memory) {
        // This is a simplified implementation for demonstration
        // In production, use a proper JSON parser library
        
        string memory fieldPattern = string(abi.encodePacked('"', field, '":'));
        
        bytes memory jsonBytes = bytes(json);
        bytes memory fieldPatternBytes = bytes(fieldPattern);
        
        uint256 i = 0;
        while (i < jsonBytes.length - fieldPatternBytes.length) {
            bool found = true;
            for (uint256 j = 0; j < fieldPatternBytes.length; j++) {
                if (jsonBytes[i + j] != fieldPatternBytes[j]) {
                    found = false;
                    break;
                }
            }
            
            if (found) {
                i += fieldPatternBytes.length;
                
                // Skip whitespace
                while (i < jsonBytes.length && (jsonBytes[i] == ' ' || jsonBytes[i] == '\t' || jsonBytes[i] == '\n' || jsonBytes[i] == '\r')) {
                    i++;
                }
                
                // Check if value is a string
                if (jsonBytes[i] == '"') {
                    i++; // Skip opening quote
                    uint256 start = i;
                    
                    // Find closing quote
                    while (i < jsonBytes.length && jsonBytes[i] != '"') {
                        // Handle escaped quotes
                        if (jsonBytes[i] == '\\' && i + 1 < jsonBytes.length && jsonBytes[i + 1] == '"') {
                            i += 2;
                        } else {
                            i++;
                        }
                    }
                    
                    // Extract value
                    bytes memory valueBytes = new bytes(i - start);
                    for (uint256 j = 0; j < i - start; j++) {
                        valueBytes[j] = jsonBytes[start + j];
                    }
                    
                    return string(valueBytes);
                } 
                // Check if value is a boolean, number, or null
                else {
                    uint256 start = i;
                    
                    // Find end of value (comma, closing brace, or closing bracket)
                    while (i < jsonBytes.length && jsonBytes[i] != ',' && jsonBytes[i] != '}' && jsonBytes[i] != ']') {
                        i++;
                    }
                    
                    // Extract value
                    bytes memory valueBytes = new bytes(i - start);
                    for (uint256 j = 0; j < i - start; j++) {
                        valueBytes[j] = jsonBytes[start + j];
                    }
                    
                    return string(valueBytes);
                }
            }
            
            i++;
        }
        
        return ""; // Field not found
    }

    /**
     * @dev Helper function to convert a string to a boolean
     * @param value String value to convert
     * @return Boolean representation of the string
     */
    function _stringToBool(string memory value) internal pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        
        // Check for "true" (case-insensitive)
        if (valueBytes.length == 4 && 
            (valueBytes[0] == 't' || valueBytes[0] == 'T') &&
            (valueBytes[1] == 'r' || valueBytes[1] == 'R') &&
            (valueBytes[2] == 'u' || valueBytes[2] == 'U') &&
            (valueBytes[3] == 'e' || valueBytes[3] == 'E')) {
            return true;
        }
        
        // Check for "1"
        if (valueBytes.length == 1 && valueBytes[0] == '1') {
            return true;
        }
        
        return false;
    }

    /**
     * @dev Modifier to check if the caller is the owner or a validator
     * @param tokenId ID of the token
     */
    modifier onlyOwnerOrValidator(uint256 tokenId) {
        require(
            msg.sender == owner() || 
            (address(deedNFT) != address(0) && deedNFT.hasRole(VALIDATOR_ROLE, msg.sender)) ||
            (address(deedNFT) != address(0) && deedNFT.ownerOf(tokenId) == msg.sender),
            "MetadataRenderer: Caller is not owner or validator"
        );
        _;
    }

    /**
     * @dev Checks if a token exists
     * @param tokenId ID of the token to check
     * @return Whether the token exists
     */
    function _exists(uint256 tokenId) internal view returns (bool) {
        return address(deedNFT) != address(0) && deedNFT.ownerOf(tokenId) != address(0);
    }

    /**
     * @dev Generates name for a token
     */
    function _generateName(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            PropertyDetails storage details = tokenPropertyDetails[tokenId];
            return string(abi.encodePacked(
                details.streetNumber, " ", details.streetName, ", ", 
                details.city, ", ", details.state, " #", tokenId.toString()
            ));
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            VehicleDetails storage details = tokenVehicleDetails[tokenId];
            return string(abi.encodePacked(
                details.year, " ", details.make, " ", details.model, " #", tokenId.toString()
            ));
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
            return string(abi.encodePacked(
                details.year, " ", details.manufacturer, " ", details.model, " #", tokenId.toString()
            ));
        }
        
        return tokenId.toString();
    }
    
    /**
     * @dev Generates gallery JSON for a token
     */
    function _generateGallery(uint256 tokenId) internal view returns (string memory) {
        string[] memory images = tokenGalleryImages[tokenId];
        if (images.length == 0) {
            return "";
        }
        
        string memory gallery = '"gallery":[';
        
        for (uint i = 0; i < images.length; i++) {
            if (i > 0) {
                gallery = string(abi.encodePacked(gallery, ','));
            }
            gallery = string(abi.encodePacked(gallery, '"', images[i], '"'));
        }
        
        gallery = string(abi.encodePacked(gallery, ']'));
        
        return gallery;
    }
    
    /**
     * @dev Generates attributes for a token
     */
    function _generateAttributes(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        string memory attributes = "";
        
        // Add asset type and validation status
        string memory assetTypeName = "";
        if (assetType == uint8(IDeedNFT.AssetType.Land)) {
            assetTypeName = "Land";
        } else if (assetType == uint8(IDeedNFT.AssetType.Estate)) {
            assetTypeName = "Estate";
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            assetTypeName = "Vehicle";
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            assetTypeName = "Commercial Equipment";
        }
        
        attributes = JSONUtils.createTrait("Asset Type", assetTypeName);
        attributes = string(abi.encodePacked(attributes, ',', JSONUtils.createTrait("Validation Status", isValidated ? "Validated" : "Unvalidated")));
        
        // Add asset-specific attributes
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            PropertyDetails storage details = tokenPropertyDetails[tokenId];
            
            // Add location attributes
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Country", details.country);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "State", details.state);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "County", details.county);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "City", details.city);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Parcel Number", details.parcelNumber);
            
            // Add legal details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Deed Type", details.deed_type);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Recording Date", details.recording_date);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Holding Entity", details.holdingEntity);
            
            // Add geographic details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Acres", details.acres);
            
            // Add zoning details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Parcel Use", details.parcelUse);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Zoning", details.zoning);
            
            // Add value details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Tax Value Source", details.taxValueSource);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Tax Assessed Value (USD)", details.taxAssessedValueUSD);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Estimated Value Source", details.estimatedValueSource);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Estimated Market Value (USD)", details.estimatedMarketValueUSD);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Local Appraisal Source", details.localAppraisalSource);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Local Appraised Value (USD)", details.localAppraisedValueUSD);
            
            // Add build details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Build Year", details.buildYear);
            
            // Add utilities
            attributes = string(abi.encodePacked(attributes, 
                ',', JSONUtils.createTrait("Has Water", details.has_water ? "Yes" : "No"),
                ',', JSONUtils.createTrait("Has Electricity", details.has_electricity ? "Yes" : "No"),
                ',', JSONUtils.createTrait("Has Natural Gas", details.has_natural_gas ? "Yes" : "No"),
                ',', JSONUtils.createTrait("Has Sewer", details.has_sewer ? "Yes" : "No"),
                ',', JSONUtils.createTrait("Has Internet", details.has_internet ? "Yes" : "No")
            ));
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            VehicleDetails storage details = tokenVehicleDetails[tokenId];
            
            // Add vehicle identification
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Make", details.make);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Model", details.model);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Year", details.year);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "VIN", details.vin);
            
            // Add physical details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Color", details.color);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Body Type", details.bodyType);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Fuel Type", details.fuelType);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Mileage", details.mileage);
            
            // Add ownership details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Title State", details.titleState);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Title Status", details.titleStatus);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Holding Entity", details.holdingEntity);
            
            // Add value details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Appraisal Source", details.appraisalSource);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Appraised Value (USD)", details.appraisedValueUSD);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Estimated Value Source", details.estimatedValueSource);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Estimated Market Value (USD)", details.estimatedMarketValueUSD);
            
            // Add condition
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Condition", details.condition);
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
            
            // Add equipment identification
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Manufacturer", details.manufacturer);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Model", details.model);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Serial Number", details.serialNumber);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Year", details.year);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Category", details.category);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Equipment Type", details.equipmentType);
            
            // Add physical details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Dimensions", details.dimensions);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Weight", details.weight);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Power Source", details.powerSource);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Operating Hours", details.operatingHours);
            
            // Add ownership details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Purchase Date", details.purchaseDate);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Warranty Expiration", details.warrantyExpiration);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Holding Entity", details.holdingEntity);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Location", details.location);
            
            // Add value details
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Appraisal Source", details.appraisalSource);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Appraised Value (USD)", details.appraisedValueUSD);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Estimated Value Source", details.estimatedValueSource);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Estimated Market Value (USD)", details.estimatedMarketValueUSD);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Depreciation Schedule", details.depreciationSchedule);
            
            // Add condition
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Condition", details.condition);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Last Service Date", details.lastServiceDate);
            attributes = JSONUtils.addTraitIfNotEmpty(attributes, "Maintenance Schedule", details.maintenanceSchedule);
        }
        
        // Add features as attributes
        string[] memory features = tokenFeatures[tokenId];
        for (uint i = 0; i < features.length; i++) {
            attributes = string(abi.encodePacked(attributes, 
                ',', JSONUtils.createTrait("Feature", features[i])));
        }
        
        return attributes;
    }
    
    /**
     * @dev Generates properties for a token
     */
    function _generateProperties(uint256 tokenId, uint8 assetType, string memory definition, string memory configuration) internal view returns (string memory) {
        string memory properties = "{";
        
        // Add asset type
        string memory assetTypeName = "";
        if (assetType == uint8(IDeedNFT.AssetType.Land)) {
            assetTypeName = "Land";
        } else if (assetType == uint8(IDeedNFT.AssetType.Estate)) {
            assetTypeName = "Estate";
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            assetTypeName = "Vehicle";
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            assetTypeName = "Commercial Equipment";
        }
        
        properties = string(abi.encodePacked(properties, '"asset_type":"', assetTypeName, '"'));
        
        // Add asset-specific properties
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            PropertyDetails storage details = tokenPropertyDetails[tokenId];
            
            // Add validation
            properties = string(abi.encodePacked(properties, 
                ',"validation":{"status":"', details.base.confidenceScore, '"}'));
            
            // Add location details
            properties = string(abi.encodePacked(properties, 
                ',"location":{',
                '"country":"', details.country, '",',
                '"state":"', details.state, '",',
                '"county":"', details.county, '",',
                '"city":"', details.city, '",',
                '"street_number":"', details.streetNumber, '",',
                '"street_name":"', details.streetName, '",',
                '"parcel_number":"', details.parcelNumber, '"',
                '}'));
            
            // Add legal details
            properties = string(abi.encodePacked(properties, 
                ',"legal":{',
                '"deed_type":"', details.deed_type, '",',
                '"recording_date":"', details.recording_date, '",',
                '"recording_number":"', details.recording_number, '",',
                '"legal_description":"', details.legal_description, '",',
                '"holding_entity":"', details.holdingEntity, '"',
                '}'));
            
            // Add geographic details
            properties = string(abi.encodePacked(properties, 
                ',"geographic":{',
                '"latitude":"', details.latitude, '",',
                '"longitude":"', details.longitude, '",',
                '"acres":"', details.acres, '"',
                '}'));
            
            // Add zoning details
            properties = string(abi.encodePacked(properties, 
                ',"zoning":{',
                '"parcel_use":"', details.parcelUse, '",',
                '"zoning":"', details.zoning, '",',
                '"zoning_code":"', details.zoningCode, '"',
                '}'));
            
            // Add value details
            properties = string(abi.encodePacked(properties, 
                ',"value":{',
                '"tax_value_source":"', details.taxValueSource, '",',
                '"tax_assessed_value_usd":"', details.taxAssessedValueUSD, '",',
                '"estimated_value_source":"', details.estimatedValueSource, '",',
                '"estimated_market_value_usd":"', details.estimatedMarketValueUSD, '",',
                '"local_appraisal_source":"', details.localAppraisalSource, '",',
                '"local_appraised_value_usd":"', details.localAppraisedValueUSD, '"',
                '}'));
            
            // Add build details
            properties = string(abi.encodePacked(properties, 
                ',"build":{',
                '"year":"', details.buildYear, '"',
                '}'));
            
            // Add utilities
            properties = string(abi.encodePacked(properties, 
                ',"utilities":{',
                '"water":', details.has_water ? 'true' : 'false', ',',
                '"electricity":', details.has_electricity ? 'true' : 'false', ',',
                '"natural_gas":', details.has_natural_gas ? 'true' : 'false', ',',
                '"sewer":', details.has_sewer ? 'true' : 'false', ',',
                '"internet":', details.has_internet ? 'true' : 'false',
                '}'));
            
            // Add map overlay
            if (bytes(details.map_overlay).length > 0) {
                properties = string(abi.encodePacked(properties, 
                    ',"map_overlay":"', details.map_overlay, '"'));
            }
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            VehicleDetails storage details = tokenVehicleDetails[tokenId];
            
            // Add validation
            properties = string(abi.encodePacked(properties, 
                ',"validation":{"status":"', details.base.confidenceScore, '"}'));
            
            // Add identification details
            properties = string(abi.encodePacked(properties, 
                ',"identification":{',
                '"make":"', details.make, '",',
                '"model":"', details.model, '",',
                '"year":"', details.year, '",',
                '"vin":"', details.vin, '",',
                '"license_plate":"', details.licensePlate, '",',
                '"registration_state":"', details.registrationState, '"',
                '}'));
            
            // Add physical details
            properties = string(abi.encodePacked(properties, 
                ',"physical":{',
                '"color":"', details.color, '",',
                '"body_type":"', details.bodyType, '",',
                '"fuel_type":"', details.fuelType, '",',
                '"transmission_type":"', details.transmissionType, '",',
                '"mileage":"', details.mileage, '",',
                '"engine_size":"', details.engineSize, '"',
                '}'));
            
            // Add ownership details
            properties = string(abi.encodePacked(properties, 
                ',"ownership":{',
                '"title_number":"', details.titleNumber, '",',
                '"title_state":"', details.titleState, '",',
                '"title_status":"', details.titleStatus, '",',
                '"registration_expiration":"', details.registrationExpiration, '",',
                '"holding_entity":"', details.holdingEntity, '"',
                '}'));
            
            // Add value details
            properties = string(abi.encodePacked(properties, 
                ',"value":{',
                '"appraisal_source":"', details.appraisalSource, '",',
                '"appraised_value_usd":"', details.appraisedValueUSD, '",',
                '"estimated_value_source":"', details.estimatedValueSource, '",',
                '"estimated_market_value_usd":"', details.estimatedMarketValueUSD, '"',
                '}'));
            
            // Add condition details
            properties = string(abi.encodePacked(properties, 
                ',"condition":{',
                '"status":"', details.condition, '",',
                '"last_service_date":"', details.lastServiceDate, '"',
                '}'));
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
            
            // Add validation
            properties = string(abi.encodePacked(properties, 
                ',"validation":{"status":"', details.base.confidenceScore, '"}'));
            
            // Add identification details
            properties = string(abi.encodePacked(properties, 
                ',"identification":{',
                '"manufacturer":"', details.manufacturer, '",',
                '"model":"', details.model, '",',
                '"serial_number":"', details.serialNumber, '",',
                '"year":"', details.year, '",',
                '"category":"', details.category, '",',
                '"equipment_type":"', details.equipmentType, '"',
                '}'));
            
            // Add physical details
            properties = string(abi.encodePacked(properties, 
                ',"physical":{',
                '"dimensions":"', details.dimensions, '",',
                '"weight":"', details.weight, '",',
                '"power_source":"', details.powerSource, '",',
                '"operating_hours":"', details.operatingHours, '"',
                '}'));
            
            // Add ownership details
            properties = string(abi.encodePacked(properties, 
                ',"ownership":{',
                '"purchase_date":"', details.purchaseDate, '",',
                '"warranty_expiration":"', details.warrantyExpiration, '",',
                '"holding_entity":"', details.holdingEntity, '",',
                '"location":"', details.location, '"',
                '}'));
            
            // Add value details
            properties = string(abi.encodePacked(properties, 
                ',"value":{',
                '"appraisal_source":"', details.appraisalSource, '",',
                '"appraised_value_usd":"', details.appraisedValueUSD, '",',
                '"estimated_value_source":"', details.estimatedValueSource, '",',
                '"estimated_market_value_usd":"', details.estimatedMarketValueUSD, '",',
                '"depreciation_schedule":"', details.depreciationSchedule, '"',
                '}'));
            
            // Add condition details
            properties = string(abi.encodePacked(properties, 
                ',"condition":{',
                '"status":"', details.condition, '",',
                '"last_service_date":"', details.lastServiceDate, '",',
                '"maintenance_schedule":"', details.maintenanceSchedule, '"',
                '}'));
        }
        
        // Add definition if provided
        if (bytes(definition).length > 0) {
            properties = string(abi.encodePacked(properties, ',"definition":', definition));
        }
        
        // Add configuration if provided
        if (bytes(configuration).length > 0) {
            properties = string(abi.encodePacked(properties, ',"configuration":', configuration));
        }
        
        // Add features if available
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
        
        // Add custom metadata if available
        string memory customMetadata = tokenCustomMetadata[tokenId];
        if (bytes(customMetadata).length > 0) {
            properties = string(abi.encodePacked(properties, ',"custom":', customMetadata));
        }
        
        // Add documents if available
        string[] memory docTypes = tokenDocumentTypes[tokenId];
        if (docTypes.length > 0) {
            properties = string(abi.encodePacked(properties, ',"documents":{'));
            
            for (uint i = 0; i < docTypes.length; i++) {
                if (i > 0) {
                    properties = string(abi.encodePacked(properties, ','));
                }
                string memory docType = docTypes[i];
                string memory docURI = tokenDocuments[tokenId][docType];
                properties = string(abi.encodePacked(properties, 
                    '"', docType, '":"', docURI, '"'));
            }
            
            properties = string(abi.encodePacked(properties, '}'));
        }
        
        // Close the properties object
        properties = string(abi.encodePacked(properties, '}'));
        
        return properties;
    }
    
    /**
     * @dev Gets base details for a token
     */
    function _getBaseDetails(uint256 tokenId, uint8 assetType) internal view returns (string memory backgroundColor, string memory animationUrl) {
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            PropertyDetails storage details = tokenPropertyDetails[tokenId];
            return (details.base.background_color, details.base.animation_url);
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            VehicleDetails storage details = tokenVehicleDetails[tokenId];
            return (details.base.background_color, details.base.animation_url);
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
            return (details.base.background_color, details.base.animation_url);
        }
        
        return ("", "");
    }
    
    /**
     * @dev Gets image URI for a token
     */
    function _getImageURI(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        if (!isValidated) {
            return invalidatedImageURI;
        }
        
        if (tokenGalleryImages[tokenId].length > 0) {
            return tokenGalleryImages[tokenId][0];
        }
        
        return assetTypeImageURIs[assetType];
    }
    
    /**
     * @dev Generates JSON metadata for a token
     * @param tokenId ID of the token
     * @param name Name of the token
     * @param description Description of the token
     * @param imageURI URI of the token image
     * @param backgroundColor Background color for the token
     * @param animationUrl Animation URL for the token
     * @param gallery Gallery of images for the token
     * @param attributes Attributes for the token
     * @param properties Properties for the token
     * @return Base64-encoded JSON metadata
     */
    function _generateJSON(
        uint256 tokenId,
        string memory name,
        string memory description,
        string memory imageURI,
        string memory backgroundColor,
        string memory animationUrl,
        string memory gallery,
        string memory attributes,
        string memory properties
    ) internal pure returns (string memory) {
        // Start building the JSON
        string memory json = string(abi.encodePacked(
            '{',
            '"name":"', name, '",',
            '"description":"', description, '",',
            '"image":"', imageURI, '",',
            '"token_id":"', tokenId.toString(), '"'
        ));
        
        // Add optional fields if provided
        if (bytes(backgroundColor).length > 0) {
            json = string(abi.encodePacked(json, ',"background_color":"', backgroundColor, '"'));
        }
        
        if (bytes(animationUrl).length > 0) {
            json = string(abi.encodePacked(json, ',"animation_url":"', animationUrl, '"'));
        }
        
        // Add gallery if available
        if (bytes(gallery).length > 0) {
            json = string(abi.encodePacked(json, ',', gallery));
        }
        
        // Add attributes if available
        if (bytes(attributes).length > 0) {
            json = string(abi.encodePacked(json, ',"attributes":[', attributes, ']'));
        }
        
        // Add properties if available
        if (bytes(properties).length > 0) {
            json = string(abi.encodePacked(json, ',"properties":', properties));
        }
        
        // Close the JSON object
        json = string(abi.encodePacked(json, '}'));
        
        // Return Base64 encoded JSON
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64Upgradeable.encode(bytes(json))
        ));
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
        
        uint256 assetTypeValue = abi.decode(assetTypeBytes, (uint256));
        uint8 assetType = uint8(assetTypeValue);
        
        // Get validation status
        (bool isValidated, /* address validator */) = IDeedNFT(tokenContract).getValidationStatus(tokenId);
        
        // Get definition and configuration
        bytes memory definitionBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("definition"));
        bytes memory configurationBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("configuration"));
        
        string memory definition = definitionBytes.length > 0 ? abi.decode(definitionBytes, (string)) : "";
        string memory configuration = configurationBytes.length > 0 ? abi.decode(configurationBytes, (string)) : "";
        
        // Generate metadata components
        string memory name = _generateName(tokenId, assetType);
        string memory attributes = _generateAttributes(tokenId, assetType, isValidated);
        string memory properties = _generateProperties(tokenId, assetType, definition, configuration);
        string memory gallery = _generateGallery(tokenId);
        string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
        (string memory backgroundColor, string memory animationUrl) = _getBaseDetails(tokenId, assetType);
        
        // Generate JSON
        return _generateJSON(
            tokenId,
            name,
            definition,
            imageURI,
            backgroundColor,
            animationUrl,
            gallery,
            attributes,
            properties
        );
    }

    /**
     * @dev Sets features for a token
     * @param tokenId ID of the token
     * @param features Array of feature strings
     */
    function setTokenFeatures(uint256 tokenId, string[] memory features) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MetadataRenderer: Token does not exist");
        
        delete tokenFeatures[tokenId];
        for (uint i = 0; i < features.length; i++) {
            tokenFeatures[tokenId].push(features[i]);
        }
        
        emit TokenFeaturesUpdated(tokenId);
    }

    /**
     * @dev Gets features for a token
     * @param tokenId ID of the token
     * @return Array of feature strings
     */
    function getTokenFeatures(uint256 tokenId) external view returns (string[] memory) {
        return tokenFeatures[tokenId];
    }

    /**
     * @dev Sets a document for a token
     * @param tokenId ID of the token
     * @param docType Type of document
     * @param documentURI URI of the document
     */
    function setTokenDocument(uint256 tokenId, string memory docType, string memory documentURI) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MetadataRenderer: Token does not exist");
        require(bytes(docType).length > 0, "MetadataRenderer: Document type cannot be empty");
        
        // If this is a new document type, add it to the list
        bool docTypeExists = false;
        for (uint i = 0; i < tokenDocumentTypes[tokenId].length; i++) {
            if (keccak256(bytes(tokenDocumentTypes[tokenId][i])) == keccak256(bytes(docType))) {
                docTypeExists = true;
                break;
            }
        }
        
        if (!docTypeExists) {
            tokenDocumentTypes[tokenId].push(docType);
        }
        
        // Set the document URI
        tokenDocuments[tokenId][docType] = documentURI;
        
        emit TokenDocumentUpdated(tokenId, docType);
    }

    /**
     * @dev Gets a document for a token
     * @param tokenId ID of the token
     * @param docType Type of document
     * @return URI of the document
     */
    function getTokenDocument(uint256 tokenId, string memory docType) external view returns (string memory) {
        return tokenDocuments[tokenId][docType];
    }

    /**
     * @dev Gets all document types for a token
     * @param tokenId ID of the token
     * @return Array of document type strings
     */
    function getTokenDocumentTypes(uint256 tokenId) external view returns (string[] memory) {
        return tokenDocumentTypes[tokenId];
    }

    /**
     * @dev Sets multiple documents for a token
     * @param tokenId ID of the token
     * @param docTypes Array of document types
     * @param documentURIs Array of document URIs
     */
    function setTokenDocuments(uint256 tokenId, string[] memory docTypes, string[] memory documentURIs) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MetadataRenderer: Token does not exist");
        require(docTypes.length == documentURIs.length, "MetadataRenderer: Arrays must have same length");
        
        for (uint i = 0; i < docTypes.length; i++) {
            require(bytes(docTypes[i]).length > 0, "MetadataRenderer: Document type cannot be empty");
            
            // If this is a new document type, add it to the list
            bool docTypeExists = false;
            for (uint j = 0; j < tokenDocumentTypes[tokenId].length; j++) {
                if (keccak256(bytes(tokenDocumentTypes[tokenId][j])) == keccak256(bytes(docTypes[i]))) {
                    docTypeExists = true;
                    break;
                }
            }
            
            if (!docTypeExists) {
                tokenDocumentTypes[tokenId].push(docTypes[i]);
            }
            
            // Set the document URI
            tokenDocuments[tokenId][docTypes[i]] = documentURIs[i];
            
            emit TokenDocumentUpdated(tokenId, docTypes[i]);
        }
    }

    /**
     * @dev Removes a document from a token
     * @param tokenId ID of the token
     * @param docType Type of document to remove
     */
    function removeTokenDocument(uint256 tokenId, string memory docType) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MetadataRenderer: Token does not exist");
        
        // Remove the document type from the list
        for (uint i = 0; i < tokenDocumentTypes[tokenId].length; i++) {
            if (keccak256(bytes(tokenDocumentTypes[tokenId][i])) == keccak256(bytes(docType))) {
                // Replace with the last element and pop
                tokenDocumentTypes[tokenId][i] = tokenDocumentTypes[tokenId][tokenDocumentTypes[tokenId].length - 1];
                tokenDocumentTypes[tokenId].pop();
                break;
            }
        }
        
        // Delete the document URI
        delete tokenDocuments[tokenId][docType];
        
        emit TokenDocumentUpdated(tokenId, docType);
    }

    /**
     * @dev Sets the DeedNFT contract address
     * @param _deedNFT Address of the DeedNFT contract
     */
    function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_deedNFT != address(0), "MetadataRenderer: Invalid DeedNFT address");
        deedNFT = IDeedNFT(_deedNFT);
        
        // Also add to compatible contracts if not already added
        if (!compatibleDeedContracts[_deedNFT]) {
            addCompatibleDeedContract(_deedNFT);
        }
    }

    /**
     * @dev Adds a compatible DeedNFT contract
     * @param contractAddress Address of the compatible DeedNFT contract
     */
    function addCompatibleDeedContract(address contractAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(contractAddress != address(0), "MetadataRenderer: Invalid contract address");
        require(!compatibleDeedContracts[contractAddress], "MetadataRenderer: Contract already added");
        
        // Verify the contract implements the IDeedNFT interface
        // This is a basic check - in production you might want more thorough validation
        try IDeedNFT(contractAddress).supportsInterface(type(IERC721Upgradeable).interfaceId) returns (bool supported) {
            require(supported, "MetadataRenderer: Contract does not implement IERC721");
        } catch {
            revert("MetadataRenderer: Contract does not implement IDeedNFT interface");
        }
        
        compatibleDeedContracts[contractAddress] = true;
        deedContractsList.push(contractAddress);
        
        emit CompatibleDeedContractAdded(contractAddress);
    }

    /**
     * @dev Removes a compatible DeedNFT contract
     * @param contractAddress Address of the compatible DeedNFT contract to remove
     */
    function removeCompatibleDeedContract(address contractAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(compatibleDeedContracts[contractAddress], "MetadataRenderer: Contract not in compatible list");
        
        // Remove from mapping
        compatibleDeedContracts[contractAddress] = false;
        
        // Remove from array
        for (uint i = 0; i < deedContractsList.length; i++) {
            if (deedContractsList[i] == contractAddress) {
                // Replace with the last element and pop
                deedContractsList[i] = deedContractsList[deedContractsList.length - 1];
                deedContractsList.pop();
                break;
            }
        }
        
        emit CompatibleDeedContractRemoved(contractAddress);
    }

    /**
     * @dev Gets all compatible DeedNFT contracts
     * @return Array of compatible DeedNFT contract addresses
     */
    function getCompatibleDeedContracts() external view returns (address[] memory) {
        return deedContractsList;
    }

    /**
     * @dev Checks if a contract is compatible
     * @param contractAddress Address of the contract to check
     * @return Whether the contract is compatible
     */
    function isCompatibleDeedContract(address contractAddress) public view returns (bool) {
        return compatibleDeedContracts[contractAddress];
    }
}