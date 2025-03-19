// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./MetadataRendererBase.sol";
import "../libraries/JSONUtils.sol";
import "../libraries/StringUtils.sol";
import "./interfaces/IDeedNFT.sol";
import "./interfaces/IERC7572.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/**
 * @title VehicleMetadataRenderer
 * @dev Renders metadata for Vehicle NFTs - optimized for contract size
 */
contract VehicleMetadataRenderer is MetadataRendererBase {
    using StringsUpgradeable for uint256;
    using JSONUtils for string;
    using StringUtils for string;
    
    // Vehicle details for Vehicle assets - simplified for size reduction
    struct VehicleDetails {
        // Base details
        BaseDetails base;
        
        // Core vehicle details (most important fields)
        string vin;
        string year;
        string make;
        string model;
        string trim;
        string color;
        string mileage;
        string condition;
        
        // Additional details (compressed into fewer fields)
        string engineInfo; // Combined engine details
        string registrationInfo; // Combined registration details
        string valueInfo; // Combined value details
        string insuranceInfo; // Combined insurance details
        string historyInfo; // Combined history details
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
     * @dev Implements tokenURI for IERC7572
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        require(isCompatibleDeedContract(tokenContract), "Invalid contract");
        
        (uint8 assetType, bool isValidated) = _getTokenInfo(tokenContract, tokenId);
        
        // Generate metadata components
        string memory name = _generateName(tokenId);
        string memory description = _generateDescription(tokenId);
        string memory attributes = _generateAttributes(tokenId, isValidated);
        string memory properties = _generateProperties(tokenId);
        string memory gallery = _generateGallery(tokenId);
        string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
        
        // Get base details
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Generate JSON
        return _generateJSON(
            /* tokenId */,
            name,
            description,
            imageURI,
            details.base.background_color,
            details.base.animation_url,
            gallery,
            attributes,
            properties
        );
    }
    
    /**
     * @dev Updates asset details for a token
     */
    function updateAssetDetails(
        uint256 tokenId,
        uint8 assetType,
        string memory details
    ) external override onlyOwnerOrValidator(tokenId) {
        require(assetType == uint8(IDeedNFT.AssetType.Vehicle), "Invalid asset type");
        
        // Parse gallery if present
        string memory galleryJson = JSONUtils.parseJsonField(details, "gallery");
        if (bytes(galleryJson).length > 0) {
            _setTokenGallery(tokenId, JSONUtils.parseJsonArrayToStringArray(galleryJson));
        }
        
        // Update vehicle details
        _updateVehicleDetails(tokenId, details);
        emit VehicleDetailsUpdated(tokenId);
    }
    
    /**
     * @dev Gets token info from the token contract
     */
    function _getTokenInfo(address tokenContract, uint256 tokenId) internal view returns (uint8 assetType, bool isValidated) {
        try IDeedNFT(tokenContract).getAssetType(tokenId) returns (uint8 _assetType) {
            assetType = _assetType;
            require(assetType == uint8(IDeedNFT.AssetType.Vehicle), "Invalid asset type");
        } catch {
            revert("Failed to get asset type");
        }
        
        try IDeedNFT(tokenContract).isValidated(tokenId) returns (bool _isValidated) {
            isValidated = _isValidated;
        } catch {
            isValidated = false;
        }
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
        // Check for custom description
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            string memory customDesc = JSONUtils.parseJsonField(tokenCustomMetadata[tokenId], "description");
            if (bytes(customDesc).length > 0) {
                return customDesc;
            }
        }
        
        // Generate default description
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Add basic vehicle info
        string memory description = string(abi.encodePacked(
            "This NFT represents a ", 
            details.year, " ", 
            details.make, " ", 
            details.model
        ));
        
        // Add VIN if available
        if (bytes(details.vin).length > 0) {
            description = string(abi.encodePacked(
                description, " with VIN ", details.vin
            ));
        }
        
        return description;
    }
    
    /**
     * @dev Generates attributes for a token
     */
    function _generateAttributes(uint256 tokenId, bool isValidated) internal view returns (string memory) {
        string memory attributes = "";
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Add core attributes only
        attributes = _addAttribute(attributes, "Asset Type", "Vehicle");
        if (bytes(details.year).length > 0) attributes = _addAttribute(attributes, "Year", details.year);
        if (bytes(details.make).length > 0) attributes = _addAttribute(attributes, "Make", details.make);
        if (bytes(details.model).length > 0) attributes = _addAttribute(attributes, "Model", details.model);
        if (bytes(details.color).length > 0) attributes = _addAttribute(attributes, "Color", details.color);
        if (bytes(details.condition).length > 0) attributes = _addAttribute(attributes, "Condition", details.condition);
        if (bytes(details.mileage).length > 0) attributes = _addAttribute(attributes, "Mileage", details.mileage);
        attributes = _addAttribute(attributes, "Validated", isValidated ? "Yes" : "No");
        
        // Add features as attributes (limited to first 3 for size)
        string[] memory features = tokenFeatures[tokenId];
        uint256 featureLimit = features.length > 3 ? 3 : features.length;
        for (uint i = 0; i < featureLimit; i++) {
            attributes = _addAttribute(attributes, "Feature", features[i]);
        }
        
        return attributes;
    }
    
    /**
     * @dev Helper function to add an attribute
     */
    function _addAttribute(string memory attributes, string memory traitType, string memory value) internal pure returns (string memory) {
        string memory attribute = string(abi.encodePacked(
            '{"trait_type":"', traitType, '","value":"', value, '"}'
        ));
        
        if (bytes(attributes).length > 0) {
            return string(abi.encodePacked(attributes, ",", attribute));
        } else {
            return attribute;
        }
    }
    
    /**
     * @dev Generates properties for a token
     */
    function _generateProperties(uint256 tokenId) internal view returns (string memory) {
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        string memory props = "{";
        
        // Add identification object (core fields only)
        props = string(abi.encodePacked(props, '"identification":{'));
        if (bytes(details.vin).length > 0) props = _addJsonField(props, "vin", details.vin);
        if (bytes(details.year).length > 0) props = _addJsonField(props, "year", details.year);
        if (bytes(details.make).length > 0) props = _addJsonField(props, "make", details.make);
        if (bytes(details.model).length > 0) props = _addJsonField(props, "model", details.model);
        if (bytes(details.trim).length > 0) props = _addJsonField(props, "trim", details.trim);
        if (bytes(details.color).length > 0) props = _addJsonField(props, "color", details.color);
        props = string(abi.encodePacked(props, "}"));
        
        // Add engine info (as JSON string)
        if (bytes(details.engineInfo).length > 0) {
            props = string(abi.encodePacked(props, ',"engine":', details.engineInfo));
        } else {
            props = string(abi.encodePacked(props, ',"engine":{}'));
        }
        
        // Add condition info
        props = string(abi.encodePacked(props, ',"condition":{'));
        if (bytes(details.condition).length > 0) props = _addJsonField(props, "condition", details.condition);
        if (bytes(details.mileage).length > 0) props = _addJsonField(props, "mileage", details.mileage);
        if (bytes(details.historyInfo).length > 0) props = _addJsonField(props, "history", details.historyInfo);
        props = string(abi.encodePacked(props, "}"));
        
        // Add registration info (as JSON string)
        if (bytes(details.registrationInfo).length > 0) {
            props = string(abi.encodePacked(props, ',"registration":', details.registrationInfo));
        } else {
            props = string(abi.encodePacked(props, ',"registration":{}'));
        }
        
        // Add value info (as JSON string)
        if (bytes(details.valueInfo).length > 0) {
            props = string(abi.encodePacked(props, ',"value":', details.valueInfo));
        } else {
            props = string(abi.encodePacked(props, ',"value":{}'));
        }
        
        // Add insurance info (as JSON string)
        if (bytes(details.insuranceInfo).length > 0) {
            props = string(abi.encodePacked(props, ',"insurance":', details.insuranceInfo));
        } else {
            props = string(abi.encodePacked(props, ',"insurance":{}'));
        }
        
        // Add documents object
        string[] memory docTypes = tokenDocumentTypes[tokenId];
        if (docTypes.length > 0) {
            props = string(abi.encodePacked(props, ',"documents":{'));
            for (uint i = 0; i < docTypes.length; i++) {
                string memory docType = docTypes[i];
                string memory docURI = tokenDocuments[tokenId][docType];
                if (bytes(docURI).length > 0) {
                    if (i > 0) props = string(abi.encodePacked(props, ','));
                    props = string(abi.encodePacked(props, '"', docType, '":"', docURI, '"'));
                }
            }
            props = string(abi.encodePacked(props, "}"));
        }
        
        // Add custom metadata if available
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            props = string(abi.encodePacked(props, ',"custom":', tokenCustomMetadata[tokenId]));
        }
        
        props = string(abi.encodePacked(props, "}"));
        
        return props;
    }
    
    /**
     * @dev Internal function to update vehicle details
     */
    function _updateVehicleDetails(uint256 tokenId, string memory detailsJson) internal {
        VehicleDetails storage details = tokenVehicleDetails[tokenId];
        
        // Base details
        details.base.background_color = JSONUtils.parseJsonField(detailsJson, "background_color");
        details.base.animation_url = JSONUtils.parseJsonField(detailsJson, "animation_url");
        
        // Core vehicle details
        details.vin = JSONUtils.parseJsonField(detailsJson, "vin");
        details.year = JSONUtils.parseJsonField(detailsJson, "year");
        details.make = JSONUtils.parseJsonField(detailsJson, "make");
        details.model = JSONUtils.parseJsonField(detailsJson, "model");
        details.trim = JSONUtils.parseJsonField(detailsJson, "trim");
        details.color = JSONUtils.parseJsonField(detailsJson, "color");
        details.mileage = JSONUtils.parseJsonField(detailsJson, "mileage");
        details.condition = JSONUtils.parseJsonField(detailsJson, "condition");
        
        // Store combined engine details as JSON
        string memory engineType = JSONUtils.parseJsonField(detailsJson, "engineType");
        string memory engineSize = JSONUtils.parseJsonField(detailsJson, "engineSize");
        string memory fuelType = JSONUtils.parseJsonField(detailsJson, "fuelType");
        string memory transmission = JSONUtils.parseJsonField(detailsJson, "transmission");
        string memory drivetrain = JSONUtils.parseJsonField(detailsJson, "drivetrain");
        
        if (bytes(engineType).length > 0 || bytes(engineSize).length > 0 || 
            bytes(fuelType).length > 0 || bytes(transmission).length > 0 || 
            bytes(drivetrain).length > 0) {
            details.engineInfo = string(abi.encodePacked(
                "{",
                bytes(engineType).length > 0 ? string(abi.encodePacked('"engineType":"', engineType, '"')) : "",
                bytes(engineSize).length > 0 ? string(abi.encodePacked(bytes(engineType).length > 0 ? "," : "", '"engineSize":"', engineSize, '"')) : "",
                bytes(fuelType).length > 0 ? string(abi.encodePacked((bytes(engineType).length > 0 || bytes(engineSize).length > 0) ? "," : "", '"fuelType":"', fuelType, '"')) : "",
                bytes(transmission).length > 0 ? string(abi.encodePacked((bytes(engineType).length > 0 || bytes(engineSize).length > 0 || bytes(fuelType).length > 0) ? "," : "", '"transmission":"', transmission, '"')) : "",
                bytes(drivetrain).length > 0 ? string(abi.encodePacked((bytes(engineType).length > 0 || bytes(engineSize).length > 0 || bytes(fuelType).length > 0 || bytes(transmission).length > 0) ? "," : "", '"drivetrain":"', drivetrain, '"')) : "",
                "}"
            ));
        }
        
        // Store combined registration details
        string memory licensePlate = JSONUtils.parseJsonField(detailsJson, "licensePlate");
        string memory registrationState = JSONUtils.parseJsonField(detailsJson, "registrationState");
        string memory registrationExpiration = JSONUtils.parseJsonField(detailsJson, "registrationExpiration");
        
        if (bytes(licensePlate).length > 0 || bytes(registrationState).length > 0 || 
            bytes(registrationExpiration).length > 0) {
            details.registrationInfo = string(abi.encodePacked(
                "{",
                bytes(licensePlate).length > 0 ? string(abi.encodePacked('"licensePlate":"', licensePlate, '"')) : "",
                bytes(registrationState).length > 0 ? string(abi.encodePacked(bytes(licensePlate).length > 0 ? "," : "", '"registrationState":"', registrationState, '"')) : "",
                bytes(registrationExpiration).length > 0 ? string(abi.encodePacked((bytes(licensePlate).length > 0 || bytes(registrationState).length > 0) ? "," : "", '"registrationExpiration":"', registrationExpiration, '"')) : "",
                "}"
            ));
        }
        
        // Store combined value details
        string memory purchaseDate = JSONUtils.parseJsonField(detailsJson, "purchaseDate");
        string memory purchasePrice = JSONUtils.parseJsonField(detailsJson, "purchasePrice");
        string memory currentValueSource = JSONUtils.parseJsonField(detailsJson, "currentValueSource");
        string memory currentValueUSD = JSONUtils.parseJsonField(detailsJson, "currentValueUSD");
        
        if (bytes(purchaseDate).length > 0 || bytes(purchasePrice).length > 0 || 
            bytes(currentValueSource).length > 0 || bytes(currentValueUSD).length > 0) {
            details.valueInfo = string(abi.encodePacked(
                "{",
                bytes(purchaseDate).length > 0 ? string(abi.encodePacked('"purchaseDate":"', purchaseDate, '"')) : "",
                bytes(purchasePrice).length > 0 ? string(abi.encodePacked(bytes(purchaseDate).length > 0 ? "," : "", '"purchasePrice":"', purchasePrice, '"')) : "",
                bytes(currentValueSource).length > 0 ? string(abi.encodePacked((bytes(purchaseDate).length > 0 || bytes(purchasePrice).length > 0) ? "," : "", '"currentValueSource":"', currentValueSource, '"')) : "",
                bytes(currentValueUSD).length > 0 ? string(abi.encodePacked((bytes(purchaseDate).length > 0 || bytes(purchasePrice).length > 0 || bytes(currentValueSource).length > 0) ? "," : "", '"currentValueUSD":"', currentValueUSD, '"')) : "",
                "}"
            ));
        }
        
        // Store combined insurance details
        string memory insuranceProvider = JSONUtils.parseJsonField(detailsJson, "insuranceProvider");
        string memory insurancePolicyNumber = JSONUtils.parseJsonField(detailsJson, "insurancePolicyNumber");
        string memory insuranceExpiration = JSONUtils.parseJsonField(detailsJson, "insuranceExpiration");
        
        if (bytes(insuranceProvider).length > 0 || bytes(insurancePolicyNumber).length > 0 || 
            bytes(insuranceExpiration).length > 0) {
            details.insuranceInfo = string(abi.encodePacked(
                "{",
                bytes(insuranceProvider).length > 0 ? string(abi.encodePacked('"insuranceProvider":"', insuranceProvider, '"')) : "",
                bytes(insurancePolicyNumber).length > 0 ? string(abi.encodePacked(bytes(insuranceProvider).length > 0 ? "," : "", '"insurancePolicyNumber":"', insurancePolicyNumber, '"')) : "",
                bytes(insuranceExpiration).length > 0 ? string(abi.encodePacked((bytes(insuranceProvider).length > 0 || bytes(insurancePolicyNumber).length > 0) ? "," : "", '"insuranceExpiration":"', insuranceExpiration, '"')) : "",
                "}"
            ));
        }
        
        // Store combined history details
        string memory lastServiceDate = JSONUtils.parseJsonField(detailsJson, "lastServiceDate");
        string memory accidentHistory = JSONUtils.parseJsonField(detailsJson, "accidentHistory");
        string memory ownershipHistory = JSONUtils.parseJsonField(detailsJson, "ownershipHistory");
        string memory titleStatus = JSONUtils.parseJsonField(detailsJson, "titleStatus");
        
        if (bytes(lastServiceDate).length > 0 || bytes(accidentHistory).length > 0 || 
            bytes(ownershipHistory).length > 0 || bytes(titleStatus).length > 0) {
            details.historyInfo = string(abi.encodePacked(
                "{",
                bytes(lastServiceDate).length > 0 ? string(abi.encodePacked('"lastServiceDate":"', lastServiceDate, '"')) : "",
                bytes(accidentHistory).length > 0 ? string(abi.encodePacked(bytes(lastServiceDate).length > 0 ? "," : "", '"accidentHistory":"', accidentHistory, '"')) : "",
                bytes(ownershipHistory).length > 0 ? string(abi.encodePacked((bytes(lastServiceDate).length > 0 || bytes(accidentHistory).length > 0) ? "," : "", '"ownershipHistory":"', ownershipHistory, '"')) : "",
                bytes(titleStatus).length > 0 ? string(abi.encodePacked((bytes(lastServiceDate).length > 0 || bytes(accidentHistory).length > 0 || bytes(ownershipHistory).length > 0) ? "," : "", '"titleStatus":"', titleStatus, '"')) : "",
                "}"
            ));
        }
        
        // Update features if present
        string memory featuresJson = JSONUtils.parseJsonField(detailsJson, "features");
        if (bytes(featuresJson).length > 0) {
            tokenFeatures[tokenId] = JSONUtils.parseJsonArrayToStringArray(featuresJson);
        }
        
        // Update custom metadata if present
        string memory customMetadata = JSONUtils.parseJsonField(detailsJson, "custom");
        if (bytes(customMetadata).length > 0) {
            tokenCustomMetadata[tokenId] = customMetadata;
        }
        
        // Update documents if present
        string memory documentsJson = JSONUtils.parseJsonField(detailsJson, "documents");
        if (bytes(documentsJson).length > 0) {
            _updateDocuments(tokenId, documentsJson);
        }
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
     * @dev Updates document URIs for a token - simplified version
     */
    function _updateDocuments(uint256 tokenId, string memory documentsJson) internal {
        // Simplify document parsing to reduce contract size
        string[] memory commonDocTypes = new string[](3);
        commonDocTypes[0] = "title";
        commonDocTypes[1] = "registration";
        commonDocTypes[2] = "insurance";
        
        uint256 docCount = 0;
        string[] memory foundDocTypes = new string[](3);
        
        for (uint i = 0; i < commonDocTypes.length; i++) {
            string memory docURI = JSONUtils.parseJsonField(documentsJson, commonDocTypes[i]);
            if (bytes(docURI).length > 0) {
                foundDocTypes[docCount] = commonDocTypes[i];
                tokenDocuments[tokenId][commonDocTypes[i]] = docURI;
                docCount++;
            }
        }
        
        if (docCount > 0) {
            string[] memory finalDocTypes = new string[](docCount);
            for (uint i = 0; i < docCount; i++) {
                finalDocTypes[i] = foundDocTypes[i];
            }
            tokenDocumentTypes[tokenId] = finalDocTypes;
        }
    }
    
    /**
     * @dev Implementation of supportsInterface
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable) returns (bool) {
        return interfaceId == type(IERC7572).interfaceId || 
               super.supportsInterface(interfaceId);
    }

    function _generateGallery(uint256 tokenId) internal view override returns (string memory) {
        string[] memory images = tokenGalleryImages[tokenId];
        
        if (images.length == 0) {
            return "[]";
        }
        
        string memory array = "[";
        
        for (uint i = 0; i < images.length; i++) {
            if (i > 0) {
                array = string(abi.encodePacked(array, ","));
            }
            
            array = string(abi.encodePacked(array, '"', images[i], '"'));
        }
        
        array = string(abi.encodePacked(array, "]"));
        
        return array;
    }

    function _generateJSON(
        uint256 /* tokenId */,
        string memory name,
        string memory description,
        string memory imageURI,
        string memory backgroundColor,
        string memory animationUrl,
        string memory gallery,
        string memory attributes,
        string memory properties
    ) internal pure override returns (string memory) {
        string memory json = "{";
        
        // Add required fields
        json = string(abi.encodePacked(json, '"name":"', name, '"'));
        json = string(abi.encodePacked(json, ',"description":"', description, '"'));
        json = string(abi.encodePacked(json, ',"image":"', imageURI, '"'));
        
        // Add optional fields if they exist
        if (bytes(backgroundColor).length > 0) {
            json = string(abi.encodePacked(json, ',"background_color":"', backgroundColor, '"'));
        }
        
        if (bytes(animationUrl).length > 0) {
            json = string(abi.encodePacked(json, ',"animation_url":"', animationUrl, '"'));
        }
        
        // Add gallery
        json = string(abi.encodePacked(json, ',"gallery":', gallery));
        
        // Add attributes
        if (bytes(attributes).length > 0) {
            json = string(abi.encodePacked(json, ',"attributes":[', attributes, ']'));
        } else {
            json = string(abi.encodePacked(json, ',"attributes":[]'));
        }
        
        // Add properties
        json = string(abi.encodePacked(json, ',"properties":', properties));
        
        // Close JSON
        json = string(abi.encodePacked(json, "}"));
        
        // Encode to base64
        string memory output = string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64Upgradeable.encode(bytes(json))
            )
        );
        
        return output;
    }
} 