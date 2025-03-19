// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./MetadataRendererBase.sol";
import "../libraries/JSONUtils.sol";
import "../libraries/StringUtils.sol";

/**
 * @title VehicleMetadataRenderer
 * @dev Renders metadata for Vehicle NFTs
 */
contract VehicleMetadataRenderer is MetadataRendererBase {
    using StringsUpgradeable for uint256;
    using JSONUtils for string;
    using StringUtils for string;
    
    // Vehicle details for Vehicle assets
    struct VehicleDetails {
        // Base details
        BaseDetails base;
        
        // Vehicle identification
        string vin;
        string year;
        string make;
        string model;
        string trim;
        string bodyStyle;
        string color;
        
        // Engine details
        string engineType;
        string engineSize;
        string fuelType;
        string transmission;
        string drivetrain;
        
        // Condition and history
        string condition;
        string mileage;
        string lastServiceDate;
        string accidentHistory;
        string ownershipHistory;
        string titleStatus;
        
        // Registration details
        string licensePlate;
        string registrationState;
        string registrationExpiration;
        
        // Value details
        string purchaseDate;
        string purchasePrice;
        string currentValueSource;
        string currentValueUSD;
        
        // Insurance details
        string insuranceProvider;
        string insurancePolicyNumber;
        string insuranceExpiration;
    }
    
    // Storage for vehicle details
    mapping(uint256 => VehicleDetails) public tokenVehicleDetails;
    
    // Events
    event VehicleDetailsUpdated(uint256 indexed tokenId);
    
    /**
     * @dev Initializes the contract
     */
    function initialize(string memory _baseURI) public override initializer {
        super.initialize(_baseURI);
    }
    
    /**
     * @dev Updates asset details for a token
     * @param tokenId ID of the token
     * @param assetType Type of the asset (must be Vehicle)
     * @param details JSON string containing the details to update
     */
    function updateAssetDetails(
        uint256 tokenId,
        uint8 assetType,
        string memory details
    ) external override onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "VehicleMetadataRenderer: Token does not exist");
        require(bytes(details).length > 0, "VehicleMetadataRenderer: Details cannot be empty");
        require(
            assetType == uint8(IDeedNFT.AssetType.Vehicle),
            "VehicleMetadataRenderer: Invalid asset type"
        );
        
        // Check for gallery updates
        string memory galleryJson = JSONUtils.parseJsonField(details, "gallery");
        if (bytes(galleryJson).length > 0) {
            // Parse the gallery JSON array into string[]
            string[] memory imageUrls = JSONUtils.parseJsonArrayToStringArray(galleryJson);
            if (imageUrls.length > 0) {
                _setTokenGallery(tokenId, imageUrls);
            }
        }
        
        // Update vehicle details
        _updateVehicleDetails(tokenId, details);
        emit VehicleDetailsUpdated(tokenId);
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
        string memory vin = JSONUtils.parseJsonField(detailsJson, "vin");
        if (bytes(vin).length > 0) {
            details.vin = vin;
        }
        
        string memory year = JSONUtils.parseJsonField(detailsJson, "year");
        if (bytes(year).length > 0) {
            details.year = year;
        }
        
        string memory make = JSONUtils.parseJsonField(detailsJson, "make");
        if (bytes(make).length > 0) {
            details.make = make;
        }
        
        string memory model = JSONUtils.parseJsonField(detailsJson, "model");
        if (bytes(model).length > 0) {
            details.model = model;
        }
        
        string memory trim = JSONUtils.parseJsonField(detailsJson, "trim");
        if (bytes(trim).length > 0) {
            details.trim = trim;
        }
        
        string memory bodyStyle = JSONUtils.parseJsonField(detailsJson, "bodyStyle");
        if (bytes(bodyStyle).length > 0) {
            details.bodyStyle = bodyStyle;
        }
        
        string memory color = JSONUtils.parseJsonField(detailsJson, "color");
        if (bytes(color).length > 0) {
            details.color = color;
        }
        
        // Update engine details if provided
        string memory engineType = JSONUtils.parseJsonField(detailsJson, "engineType");
        if (bytes(engineType).length > 0) {
            details.engineType = engineType;
        }
        
        string memory engineSize = JSONUtils.parseJsonField(detailsJson, "engineSize");
        if (bytes(engineSize).length > 0) {
            details.engineSize = engineSize;
        }
        
        string memory fuelType = JSONUtils.parseJsonField(detailsJson, "fuelType");
        if (bytes(fuelType).length > 0) {
            details.fuelType = fuelType;
        }
        
        string memory transmission = JSONUtils.parseJsonField(detailsJson, "transmission");
        if (bytes(transmission).length > 0) {
            details.transmission = transmission;
        }
        
        string memory drivetrain = JSONUtils.parseJsonField(detailsJson, "drivetrain");
        if (bytes(drivetrain).length > 0) {
            details.drivetrain = drivetrain;
        }
        
        // Update condition and history fields if provided
        string memory condition = JSONUtils.parseJsonField(detailsJson, "condition");
        if (bytes(condition).length > 0) {
            details.condition = condition;
        }
        
        string memory mileage = JSONUtils.parseJsonField(detailsJson, "mileage");
        if (bytes(mileage).length > 0) {
            details.mileage = mileage;
        }
        
        string memory lastServiceDate = JSONUtils.parseJsonField(detailsJson, "lastServiceDate");
        if (bytes(lastServiceDate).length > 0) {
            details.lastServiceDate = lastServiceDate;
        }
        
        string memory accidentHistory = JSONUtils.parseJsonField(detailsJson, "accidentHistory");
        if (bytes(accidentHistory).length > 0) {
            details.accidentHistory = accidentHistory;
        }
        
        string memory ownershipHistory = JSONUtils.parseJsonField(detailsJson, "ownershipHistory");
        if (bytes(ownershipHistory).length > 0) {
            details.ownershipHistory = ownershipHistory;
        }
        
        string memory titleStatus = JSONUtils.parseJsonField(detailsJson, "titleStatus");
        if (bytes(titleStatus).length > 0) {
            details.titleStatus = titleStatus;
        }
        
        // Update registration details if provided
        string memory licensePlate = JSONUtils.parseJsonField(detailsJson, "licensePlate");
        if (bytes(licensePlate).length > 0) {
            details.licensePlate = licensePlate;
        }
        
        string memory registrationState = JSONUtils.parseJsonField(detailsJson, "registrationState");
        if (bytes(registrationState).length > 0) {
            details.registrationState = registrationState;
        }
        
        string memory registrationExpiration = JSONUtils.parseJsonField(detailsJson, "registrationExpiration");
        if (bytes(registrationExpiration).length > 0) {
            details.registrationExpiration = registrationExpiration;
        }
        
        // Update value details if provided
        string memory purchaseDate = JSONUtils.parseJsonField(detailsJson, "purchaseDate");
        if (bytes(purchaseDate).length > 0) {
            details.purchaseDate = purchaseDate;
        }
        
        string memory purchasePrice = JSONUtils.parseJsonField(detailsJson, "purchasePrice");
        if (bytes(purchasePrice).length > 0) {
            details.purchasePrice = purchasePrice;
        }
        
        string memory currentValueSource = JSONUtils.parseJsonField(detailsJson, "currentValueSource");
        if (bytes(currentValueSource).length > 0) {
            details.currentValueSource = currentValueSource;
        }
        
        string memory currentValueUSD = JSONUtils.parseJsonField(detailsJson, "currentValueUSD");
        if (bytes(currentValueUSD).length > 0) {
            details.currentValueUSD = currentValueUSD;
        }
        
        // Update insurance details if provided
        string memory insuranceProvider = JSONUtils.parseJsonField(detailsJson, "insuranceProvider");
        if (bytes(insuranceProvider).length > 0) {
            details.insuranceProvider = insuranceProvider;
        }
        
        string memory insurancePolicyNumber = JSONUtils.parseJsonField(detailsJson, "insurancePolicyNumber");
        if (bytes(insurancePolicyNumber).length > 0) {
            details.insurancePolicyNumber = insurancePolicyNumber;
        }
        
        string memory insuranceExpiration = JSONUtils.parseJsonField(detailsJson, "insuranceExpiration");
        if (bytes(insuranceExpiration).length > 0) {
            details.insuranceExpiration = insuranceExpiration;
        }
    }
    
    /**
     * @dev Generates token URI for a specific token
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return URI for the token metadata
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        require(isCompatibleDeedContract(tokenContract), "VehicleMetadataRenderer: Incompatible contract");
        
        // Get asset type from token
        uint8 assetType;
        try IDeedNFT(tokenContract).getAssetType(tokenId) returns (uint8 _assetType) {
            assetType = _assetType;
            require(
                assetType == uint8(IDeedNFT.AssetType.Vehicle),
                "VehicleMetadataRenderer: Invalid asset type"
            );
        } catch {
            revert("VehicleMetadataRenderer: Failed to get asset type");
        }
        
        // Get validation status
        bool isValidated;
        try IDeedNFT(tokenContract).isValidated(tokenId) returns (bool _isValidated) {
            isValidated = _isValidated;
        } catch {
            isValidated = false;
        }
        
        // Generate metadata components
        string memory name = _generateName(tokenId);
        string memory description = _generateDescription(tokenId);
        string memory attributes = _generateAttributes(tokenId, isValidated);
        string memory properties = _generateProperties(tokenId);
        string memory gallery = _generateGallery(tokenId);
        string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
        
        // Get base details
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        string memory backgroundColor = details.base.background_color;
        string memory animationUrl = details.base.animation_url;
        
        // Generate JSON
        return _generateJSON(
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
     * @dev Generates name for a token
     */
    function _generateName(uint256 tokenId) internal view returns (string memory) {
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        if (bytes(details.year).length > 0 && bytes(details.make).length > 0 && bytes(details.model).length > 0) {
            string memory name = string(abi.encodePacked(details.year, " ", details.make, " ", details.model));
            
            if (bytes(details.trim).length > 0) {
                name = string(abi.encodePacked(name, " ", details.trim));
            }
            
            return string(abi.encodePacked(name, " #", tokenId.toString()));
        }
        
        return string(abi.encodePacked("Vehicle #", tokenId.toString()));
    }
    
    /**
     * @dev Generates description for a token
     */
    function _generateDescription(uint256 tokenId) internal view returns (string memory) {
        // Use custom metadata description if available
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            string memory description = JSONUtils.parseJsonField(tokenCustomMetadata[tokenId], "description");
            if (bytes(description).length > 0) {
                return description;
            }
        }
        
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Generate a description based on available details
        string memory description = "";
        
        if (bytes(details.year).length > 0 && bytes(details.make).length > 0 && bytes(details.model).length > 0) {
            description = string(abi.encodePacked(details.year, " ", details.make, " ", details.model));
            
            if (bytes(details.trim).length > 0) {
                description = string(abi.encodePacked(description, " ", details.trim));
            }
            
            if (bytes(details.color).length > 0) {
                description = string(abi.encodePacked(description, " in ", details.color));
            }
            
            if (bytes(details.mileage).length > 0) {
                description = string(abi.encodePacked(description, " with ", details.mileage, " miles"));
            }
            
            if (bytes(details.condition).length > 0) {
                description = string(abi.encodePacked(description, ". Condition: ", details.condition));
            }
            
            if (bytes(details.vin).length > 0) {
                description = string(abi.encodePacked(description, ". VIN: ", details.vin));
            }
            
            return description;
        }
        
        // Default description
        return string(abi.encodePacked("Vehicle Asset #", tokenId.toString()));
    }
    
    /**
     * @dev Generates attributes for a token
     */
    function _generateAttributes(uint256 tokenId, bool isValidated) internal view returns (string memory) {
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Start with empty attributes
        string memory attributes = "";
        
        // Add validation status
        attributes = _addAttribute(attributes, "Validated", isValidated ? "Yes" : "No");
        
        // Add asset type
        attributes = _addAttribute(attributes, "Asset Type", "Vehicle");
        
        // Add vehicle identification attributes if available
        if (bytes(details.year).length > 0) {
            attributes = _addAttribute(attributes, "Year", details.year);
        }
        
        if (bytes(details.make).length > 0) {
            attributes = _addAttribute(attributes, "Make", details.make);
        }
        
        if (bytes(details.model).length > 0) {
            attributes = _addAttribute(attributes, "Model", details.model);
        }
        
        if (bytes(details.trim).length > 0) {
            attributes = _addAttribute(attributes, "Trim", details.trim);
        }
        
        if (bytes(details.bodyStyle).length > 0) {
            attributes = _addAttribute(attributes, "Body Style", details.bodyStyle);
        }
        
        if (bytes(details.color).length > 0) {
            attributes = _addAttribute(attributes, "Color", details.color);
        }
        
        // Add engine attributes if available
        if (bytes(details.engineType).length > 0) {
            attributes = _addAttribute(attributes, "Engine Type", details.engineType);
        }
        
        if (bytes(details.engineSize).length > 0) {
            attributes = _addAttribute(attributes, "Engine Size", details.engineSize);
        }
        
        if (bytes(details.fuelType).length > 0) {
            attributes = _addAttribute(attributes, "Fuel Type", details.fuelType);
        }
        
        if (bytes(details.transmission).length > 0) {
            attributes = _addAttribute(attributes, "Transmission", details.transmission);
        }
        
        if (bytes(details.drivetrain).length > 0) {
            attributes = _addAttribute(attributes, "Drivetrain", details.drivetrain);
        }
        
        // Add condition attributes if available
        if (bytes(details.condition).length > 0) {
            attributes = _addAttribute(attributes, "Condition", details.condition);
        }
        
        if (bytes(details.mileage).length > 0) {
            attributes = _addAttribute(attributes, "Mileage", details.mileage);
        }
        
        if (bytes(details.titleStatus).length > 0) {
            attributes = _addAttribute(attributes, "Title Status", details.titleStatus);
        }
        
        // Add features as attributes
        string[] memory features = tokenFeatures[tokenId];
        for (uint i = 0; i < features.length; i++) {
            attributes = _addAttribute(attributes, string(abi.encodePacked("Feature ", (i + 1).toString())), features[i]);
        }
        
        return attributes;
    }
    
    /**
     * @dev Helper function to add an attribute
     */
    function _addAttribute(string memory attributes, string memory traitType, string memory value) internal pure returns (string memory) {
        string memory attribute = string(abi.encodePacked(
            '{',
            '"trait_type":"', traitType, '",',
            '"value":"', value, '"',
            '}'
        ));
        
        if (bytes(attributes).length > 0) {
            return string(abi.encodePacked(attributes, ',', attribute));
        } else {
            return attribute;
        }
    }
    
    /**
     * @dev Generates properties for a token
     */
    function _generateProperties(uint256 tokenId) internal view returns (string memory) {
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Start with opening brace
        string memory properties = "{";
        
        // Add identification properties
        properties = _addProperty(properties, "identification", _generateIdentificationObject(details));
        
        // Add engine properties
        properties = _addProperty(properties, "engine", _generateEngineObject(details));
        
        // Add condition properties
        properties = _addProperty(properties, "condition", _generateConditionObject(details));
        
        // Add registration properties
        properties = _addProperty(properties, "registration", _generateRegistrationObject(details));
        
        // Add value properties
        properties = _addProperty(properties, "value", _generateValueObject(details));
        
        // Add insurance properties
        properties = _addProperty(properties, "insurance", _generateInsuranceObject(details));
        
        // Add documents if available
        string[] memory docTypes = tokenDocumentTypes[tokenId];
        if (docTypes.length > 0) {
            properties = _addProperty(properties, "documents", _generateDocumentsObject(tokenId, docTypes));
        }
        
        // Close properties object
        properties = string(abi.encodePacked(properties, "}"));
        
        return properties;
    }
    
    /**
     * @dev Helper function to add a property
     */
    function _addProperty(string memory properties, string memory name, string memory value) internal pure returns (string memory) {
        if (bytes(value).length == 0) {
            return properties;
        }
        
        if (bytes(properties).length > 1) { // > 1 because properties starts with "{"
            return string(abi.encodePacked(properties, ',"', name, '":', value));
        } else {
            return string(abi.encodePacked(properties, '"', name, '":', value));
        }
    }
    
    /**
     * @dev Generates identification object
     */
    function _generateIdentificationObject(VehicleDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.vin).length > 0) {
            obj = _addJsonField(obj, "vin", details.vin);
        }
        
        if (bytes(details.year).length > 0) {
            obj = _addJsonField(obj, "year", details.year);
        }
        
        if (bytes(details.make).length > 0) {
            obj = _addJsonField(obj, "make", details.make);
        }
        
        if (bytes(details.model).length > 0) {
            obj = _addJsonField(obj, "model", details.model);
        }
        
        if (bytes(details.trim).length > 0) {
            obj = _addJsonField(obj, "trim", details.trim);
        }
        
        if (bytes(details.bodyStyle).length > 0) {
            obj = _addJsonField(obj, "bodyStyle", details.bodyStyle);
        }
        
        if (bytes(details.color).length > 0) {
            obj = _addJsonField(obj, "color", details.color);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates engine object
     */
    function _generateEngineObject(VehicleDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.engineType).length > 0) {
            obj = _addJsonField(obj, "engineType", details.engineType);
        }
        
        if (bytes(details.engineSize).length > 0) {
            obj = _addJsonField(obj, "engineSize", details.engineSize);
        }
        
        if (bytes(details.fuelType).length > 0) {
            obj = _addJsonField(obj, "fuelType", details.fuelType);
        }
        
        if (bytes(details.transmission).length > 0) {
            obj = _addJsonField(obj, "transmission", details.transmission);
        }
        
        if (bytes(details.drivetrain).length > 0) {
            obj = _addJsonField(obj, "drivetrain", details.drivetrain);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates condition object
     */
    function _generateConditionObject(VehicleDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.condition).length > 0) {
            obj = _addJsonField(obj, "condition", details.condition);
        }
        
        if (bytes(details.mileage).length > 0) {
            obj = _addJsonField(obj, "mileage", details.mileage);
        }
        
        if (bytes(details.lastServiceDate).length > 0) {
            obj = _addJsonField(obj, "lastServiceDate", details.lastServiceDate);
        }
        
        if (bytes(details.accidentHistory).length > 0) {
            obj = _addJsonField(obj, "accidentHistory", details.accidentHistory);
        }
        
        if (bytes(details.ownershipHistory).length > 0) {
            obj = _addJsonField(obj, "ownershipHistory", details.ownershipHistory);
        }
        
        if (bytes(details.titleStatus).length > 0) {
            obj = _addJsonField(obj, "titleStatus", details.titleStatus);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates registration object
     */
    function _generateRegistrationObject(VehicleDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.licensePlate).length > 0) {
            obj = _addJsonField(obj, "licensePlate", details.licensePlate);
        }
        
        if (bytes(details.registrationState).length > 0) {
            obj = _addJsonField(obj, "registrationState", details.registrationState);
        }
        
        if (bytes(details.registrationExpiration).length > 0) {
            obj = _addJsonField(obj, "registrationExpiration", details.registrationExpiration);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates value object
     */
    function _generateValueObject(VehicleDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.purchaseDate).length > 0) {
            obj = _addJsonField(obj, "purchaseDate", details.purchaseDate);
        }
        
        if (bytes(details.purchasePrice).length > 0) {
            obj = _addJsonField(obj, "purchasePrice", details.purchasePrice);
        }
        
        if (bytes(details.currentValueSource).length > 0) {
            obj = _addJsonField(obj, "currentValueSource", details.currentValueSource);
        }
        
        if (bytes(details.currentValueUSD).length > 0) {
            obj = _addJsonField(obj, "currentValueUSD", details.currentValueUSD);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates insurance object
     */
    function _generateInsuranceObject(VehicleDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.insuranceProvider).length > 0) {
            obj = _addJsonField(obj, "insuranceProvider", details.insuranceProvider);
        }
        
        if (bytes(details.insurancePolicyNumber).length > 0) {
            obj = _addJsonField(obj, "insurancePolicyNumber", details.insurancePolicyNumber);
        }
        
        if (bytes(details.insuranceExpiration).length > 0) {
            obj = _addJsonField(obj, "insuranceExpiration", details.insuranceExpiration);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates documents object
     */
    function _generateDocumentsObject(uint256 tokenId, string[] memory docTypes) internal view returns (string memory) {
        string memory obj = "{";
        
        for (uint i = 0; i < docTypes.length; i++) {
            string memory docType = docTypes[i];
            string memory docURI = tokenDocuments[tokenId][docType];
            
            if (bytes(docURI).length > 0) {
                obj = _addJsonField(obj, docType, docURI);
            }
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Helper function to add a JSON field
     */
    function _addJsonField(string memory json, string memory field, string memory value) internal pure returns (string memory) {
        if (bytes(json).length > 1) { // > 1 because json starts with "{"
            return string(abi.encodePacked(json, ',"', field, '":"', value, '"'));
        } else {
            return string(abi.encodePacked(json, '"', field, '":"', value, '"'));
        }
    }
    
    /**
     * @dev Implementation of supportsInterface
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable, IERC165Upgradeable) returns (bool) {
        return interfaceId == type(IERC7572).interfaceId || 
               super.supportsInterface(interfaceId);
    }
} 