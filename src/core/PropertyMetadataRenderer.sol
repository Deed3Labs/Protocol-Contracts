// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./MetadataRendererBase.sol";
import "../libraries/JSONUtils.sol";
import "../libraries/StringUtils.sol";

/**
 * @title PropertyMetadataRenderer
 * @dev Renders metadata for Land and Estate NFTs
 */
contract PropertyMetadataRenderer is MetadataRendererBase {
    using StringsUpgradeable for uint256;
    using JSONUtils for string;
    using StringUtils for string;
    
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
    
    // Storage for property details
    mapping(uint256 => PropertyDetails) public tokenPropertyDetails;
    
    // Events
    event PropertyDetailsUpdated(uint256 indexed tokenId);
    
    /**
     * @dev Initializes the contract
     */
    function initialize(string memory _baseURI) public override initializer {
        super.initialize(_baseURI);
    }
    
    /**
     * @dev Updates asset details for a token
     * @param tokenId ID of the token
     * @param assetType Type of the asset (0=Land, 2=Estate)
     * @param details JSON string containing the details to update
     */
    function updateAssetDetails(
        uint256 tokenId,
        uint8 assetType,
        string memory details
    ) external override onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "PropertyMetadataRenderer: Token does not exist");
        require(bytes(details).length > 0, "PropertyMetadataRenderer: Details cannot be empty");
        require(
            assetType == uint8(IDeedNFT.AssetType.Land) || 
            assetType == uint8(IDeedNFT.AssetType.Estate),
            "PropertyMetadataRenderer: Invalid asset type"
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
        
        // Update property details
        _updatePropertyDetails(tokenId, details);
        emit PropertyDetailsUpdated(tokenId);
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
        string memory deed_type = JSONUtils.parseJsonField(detailsJson, "deed_type");
        if (bytes(deed_type).length > 0) {
            details.deed_type = deed_type;
        }
        
        string memory recording_date = JSONUtils.parseJsonField(detailsJson, "recording_date");
        if (bytes(recording_date).length > 0) {
            details.recording_date = recording_date;
        }
        
        string memory recording_number = JSONUtils.parseJsonField(detailsJson, "recording_number");
        if (bytes(recording_number).length > 0) {
            details.recording_number = recording_number;
        }
        
        string memory legal_description = JSONUtils.parseJsonField(detailsJson, "legal_description");
        if (bytes(legal_description).length > 0) {
            details.legal_description = legal_description;
        }
        
        string memory holdingEntity = JSONUtils.parseJsonField(detailsJson, "holdingEntity");
        if (bytes(holdingEntity).length > 0) {
            details.holdingEntity = holdingEntity;
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
        string memory parcelUse = JSONUtils.parseJsonField(detailsJson, "parcelUse");
        if (bytes(parcelUse).length > 0) {
            details.parcelUse = parcelUse;
        }
        
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
        
        // Update build details if provided
        string memory buildYear = JSONUtils.parseJsonField(detailsJson, "buildYear");
        if (bytes(buildYear).length > 0) {
            details.buildYear = buildYear;
        }
        
        // Update utilities if provided
        string memory has_water = JSONUtils.parseJsonField(detailsJson, "has_water");
        if (bytes(has_water).length > 0) {
            details.has_water = _stringToBool(has_water);
        }
        
        string memory has_electricity = JSONUtils.parseJsonField(detailsJson, "has_electricity");
        if (bytes(has_electricity).length > 0) {
            details.has_electricity = _stringToBool(has_electricity);
        }
        
        string memory has_natural_gas = JSONUtils.parseJsonField(detailsJson, "has_natural_gas");
        if (bytes(has_natural_gas).length > 0) {
            details.has_natural_gas = _stringToBool(has_natural_gas);
        }
        
        string memory has_sewer = JSONUtils.parseJsonField(detailsJson, "has_sewer");
        if (bytes(has_sewer).length > 0) {
            details.has_sewer = _stringToBool(has_sewer);
        }
        
        string memory has_internet = JSONUtils.parseJsonField(detailsJson, "has_internet");
        if (bytes(has_internet).length > 0) {
            details.has_internet = _stringToBool(has_internet);
        }
        
        // Update map overlay if provided
        string memory map_overlay = JSONUtils.parseJsonField(detailsJson, "map_overlay");
        if (bytes(map_overlay).length > 0) {
            details.map_overlay = map_overlay;
        }
    }
    
    /**
     * @dev Generates token URI for a specific token
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return URI for the token metadata
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        require(isCompatibleDeedContract(tokenContract), "PropertyMetadataRenderer: Incompatible contract");
        
        // Get asset type from token
        uint8 assetType;
        try IDeedNFT(tokenContract).getAssetType(tokenId) returns (uint8 _assetType) {
            assetType = _assetType;
            require(
                assetType == uint8(IDeedNFT.AssetType.Land) || 
                assetType == uint8(IDeedNFT.AssetType.Estate),
                "PropertyMetadataRenderer: Invalid asset type"
            );
        } catch {
            revert("PropertyMetadataRenderer: Failed to get asset type");
        }
        
        // Get validation status
        bool isValidated;
        try IDeedNFT(tokenContract).isValidated(tokenId) returns (bool _isValidated) {
            isValidated = _isValidated;
        } catch {
            isValidated = false;
        }
        
        // Generate metadata components
        string memory name = _generateName(tokenId, assetType);
        string memory description = _generateDescription(tokenId);
        string memory attributes = _generateAttributes(tokenId, assetType, isValidated);
        string memory properties = _generateProperties(tokenId);
        string memory gallery = _generateGallery(tokenId);
        string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
        
        // Get base details
        PropertyDetails storage details = tokenPropertyDetails[tokenId];
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
    function _generateName(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        PropertyDetails storage details = tokenPropertyDetails[tokenId];
        
        string memory assetTypeName = assetType == uint8(IDeedNFT.AssetType.Land) ? "Land" : "Estate";
        
        if (bytes(details.streetNumber).length > 0 && bytes(details.streetName).length > 0) {
            return string(abi.encodePacked(
                details.streetNumber, " ", details.streetName, " ", 
                assetTypeName, " #", tokenId.toString()
            ));
        } else if (bytes(details.parcelNumber).length > 0) {
            return string(abi.encodePacked(
                "Parcel ", details.parcelNumber, " ", 
                assetTypeName, " #", tokenId.toString()
            ));
        }
        
        return string(abi.encodePacked(assetTypeName, " #", tokenId.toString()));
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
        
        PropertyDetails storage details = tokenPropertyDetails[tokenId];
        
        // Generate a description based on available details
        if (bytes(details.legal_description).length > 0) {
            return details.legal_description;
        }
        
        string memory location = "";
        
        if (bytes(details.streetNumber).length > 0 && bytes(details.streetName).length > 0) {
            location = string(abi.encodePacked(details.streetNumber, " ", details.streetName));
            
            if (bytes(details.city).length > 0) {
                location = string(abi.encodePacked(location, ", ", details.city));
            }
            
            if (bytes(details.state).length > 0) {
                location = string(abi.encodePacked(location, ", ", details.state));
            }
            
            if (bytes(details.country).length > 0) {
                location = string(abi.encodePacked(location, ", ", details.country));
            }
            
            return string(abi.encodePacked("Property located at ", location));
        }
        
        // Default description
        return string(abi.encodePacked("Property Asset #", tokenId.toString()));
    }
    
    /**
     * @dev Generates attributes for a token
     */
    function _generateAttributes(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        PropertyDetails storage details = tokenPropertyDetails[tokenId];
        
        // Start with empty attributes
        string memory attributes = "";
        
        // Add validation status
        attributes = _addAttribute(attributes, "Validated", isValidated ? "Yes" : "No");
        
        // Add asset type
        attributes = _addAttribute(attributes, "Asset Type", assetType == uint8(IDeedNFT.AssetType.Land) ? "Land" : "Estate");
        
        // Add location attributes if available
        if (bytes(details.country).length > 0) {
            attributes = _addAttribute(attributes, "Country", details.country);
        }
        
        if (bytes(details.state).length > 0) {
            attributes = _addAttribute(attributes, "State", details.state);
        }
        
        if (bytes(details.county).length > 0) {
            attributes = _addAttribute(attributes, "County", details.county);
        }
        
        if (bytes(details.city).length > 0) {
            attributes = _addAttribute(attributes, "City", details.city);
        }
        
        // Add parcel attributes if available
        if (bytes(details.parcelNumber).length > 0) {
            attributes = _addAttribute(attributes, "Parcel Number", details.parcelNumber);
        }
        
        if (bytes(details.acres).length > 0) {
            attributes = _addAttribute(attributes, "Acres", details.acres);
        }
        
        if (bytes(details.zoning).length > 0) {
            attributes = _addAttribute(attributes, "Zoning", details.zoning);
        }
        
        // Add utilities as attributes
        if (details.has_water) {
            attributes = _addAttribute(attributes, "Water", "Yes");
        }
        
        if (details.has_electricity) {
            attributes = _addAttribute(attributes, "Electricity", "Yes");
        }
        
        if (details.has_natural_gas) {
            attributes = _addAttribute(attributes, "Natural Gas", "Yes");
        }
        
        if (details.has_sewer) {
            attributes = _addAttribute(attributes, "Sewer", "Yes");
        }
        
        if (details.has_internet) {
            attributes = _addAttribute(attributes, "Internet", "Yes");
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
        PropertyDetails storage details = tokenPropertyDetails[tokenId];
        
        // Start with opening brace
        string memory properties = "{";
        
        // Add location properties
        properties = _addProperty(properties, "location", _generateLocationObject(details));
        
        // Add legal properties
        properties = _addProperty(properties, "legal", _generateLegalObject(details));
        
        // Add geographic properties
        properties = _addProperty(properties, "geographic", _generateGeographicObject(details));
        
        // Add zoning properties
        properties = _addProperty(properties, "zoning", _generateZoningObject(details));
        
        // Add value properties
        properties = _addProperty(properties, "value", _generateValueObject(details));
        
        // Add utilities properties
        properties = _addProperty(properties, "utilities", _generateUtilitiesObject(details));
        
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
     * @dev Generates location object
     */
    function _generateLocationObject(PropertyDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.country).length > 0) {
            obj = _addJsonField(obj, "country", details.country);
        }
        
        if (bytes(details.state).length > 0) {
            obj = _addJsonField(obj, "state", details.state);
        }
        
        if (bytes(details.county).length > 0) {
            obj = _addJsonField(obj, "county", details.county);
        }
        
        if (bytes(details.city).length > 0) {
            obj = _addJsonField(obj, "city", details.city);
        }
        
        if (bytes(details.streetNumber).length > 0) {
            obj = _addJsonField(obj, "streetNumber", details.streetNumber);
        }
        
        if (bytes(details.streetName).length > 0) {
            obj = _addJsonField(obj, "streetName", details.streetName);
        }
        
        if (bytes(details.parcelNumber).length > 0) {
            obj = _addJsonField(obj, "parcelNumber", details.parcelNumber);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates legal object
     */
    function _generateLegalObject(PropertyDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.deed_type).length > 0) {
            obj = _addJsonField(obj, "deed_type", details.deed_type);
        }
        
        if (bytes(details.recording_date).length > 0) {
            obj = _addJsonField(obj, "recording_date", details.recording_date);
        }
        
        if (bytes(details.recording_number).length > 0) {
            obj = _addJsonField(obj, "recording_number", details.recording_number);
        }
        
        if (bytes(details.legal_description).length > 0) {
            obj = _addJsonField(obj, "legal_description", details.legal_description);
        }
        
        if (bytes(details.holdingEntity).length > 0) {
            obj = _addJsonField(obj, "holdingEntity", details.holdingEntity);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates geographic object
     */
    function _generateGeographicObject(PropertyDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.latitude).length > 0) {
            obj = _addJsonField(obj, "latitude", details.latitude);
        }
        
        if (bytes(details.longitude).length > 0) {
            obj = _addJsonField(obj, "longitude", details.longitude);
        }
        
        if (bytes(details.acres).length > 0) {
            obj = _addJsonField(obj, "acres", details.acres);
        }
        
        if (bytes(details.map_overlay).length > 0) {
            obj = _addJsonField(obj, "map_overlay", details.map_overlay);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates zoning object
     */
    function _generateZoningObject(PropertyDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.parcelUse).length > 0) {
            obj = _addJsonField(obj, "parcelUse", details.parcelUse);
        }
        
        if (bytes(details.zoning).length > 0) {
            obj = _addJsonField(obj, "zoning", details.zoning);
        }
        
        if (bytes(details.zoningCode).length > 0) {
            obj = _addJsonField(obj, "zoningCode", details.zoningCode);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates value object
     */
    function _generateValueObject(PropertyDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.taxValueSource).length > 0) {
            obj = _addJsonField(obj, "taxValueSource", details.taxValueSource);
        }
        
        if (bytes(details.taxAssessedValueUSD).length > 0) {
            obj = _addJsonField(obj, "taxAssessedValueUSD", details.taxAssessedValueUSD);
        }
        
        if (bytes(details.estimatedValueSource).length > 0) {
            obj = _addJsonField(obj, "estimatedValueSource", details.estimatedValueSource);
        }
        
        if (bytes(details.estimatedMarketValueUSD).length > 0) {
            obj = _addJsonField(obj, "estimatedMarketValueUSD", details.estimatedMarketValueUSD);
        }
        
        if (bytes(details.localAppraisalSource).length > 0) {
            obj = _addJsonField(obj, "localAppraisalSource", details.localAppraisalSource);
        }
        
        if (bytes(details.localAppraisedValueUSD).length > 0) {
            obj = _addJsonField(obj, "localAppraisedValueUSD", details.localAppraisedValueUSD);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates utilities object
     */
    function _generateUtilitiesObject(PropertyDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        obj = _addJsonBoolField(obj, "has_water", details.has_water);
        obj = _addJsonBoolField(obj, "has_electricity", details.has_electricity);
        obj = _addJsonBoolField(obj, "has_natural_gas", details.has_natural_gas);
        obj = _addJsonBoolField(obj, "has_sewer", details.has_sewer);
        obj = _addJsonBoolField(obj, "has_internet", details.has_internet);
        
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
     * @dev Helper function to add a JSON boolean field
     */
    function _addJsonBoolField(string memory json, string memory field, bool value) internal pure returns (string memory) {
        if (bytes(json).length > 1) { // > 1 because json starts with "{"
            return string(abi.encodePacked(json, ',"', field, '":', value ? "true" : "false"));
        } else {
            return string(abi.encodePacked(json, '"', field, '":', value ? "true" : "false"));
        }
    }
    
    /**
     * @dev Implementation of supportsInterface
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable) returns (bool) {
        return interfaceId == type(IERC7572).interfaceId || 
               super.supportsInterface(interfaceId);
    }
}