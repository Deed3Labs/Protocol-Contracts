// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./MetadataRendererBase.sol";
import "./EquipmentDetails.sol";
import "./Base64Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/Strings.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "./interfaces/IERC7572.sol";

/**
 * @title EquipmentMetadataRenderer
 * @dev Specialized renderer for Commercial Equipment assets
 */
abstract contract EquipmentMetadataRenderer is MetadataRendererBase, AccessControlUpgradeable, Initializable, IERC7572 {
    using Strings for uint256;

    /**
     * @dev Generates token URI for a specific token
     * @param tokenId ID of the token
     * @return URI for the token metadata
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        // Fetch asset details
        EquipmentDetails storage details = equipmentDetails[tokenId];
        
        // Generate JSON metadata
        string memory json = _generateJSON(
            tokenId,
            details.name,
            details.description,
            details.imageURI,
            details.backgroundColor,
            details.animationUrl,
            _generateGallery(tokenId),
            _generateAttributes(tokenId),
            _generateProperties(tokenId)
        );
        
        return json;
    }
    
    /**
     * @dev Generates properties object
     */
    function _generateProperties(uint256 tokenId) internal view returns (string memory) {
        string memory properties = "{";
        
        // Add identification properties
        properties = _addProperty(properties, "identification", _generateIdentificationObject(equipmentDetails[tokenId]));
        
        // Add technical properties
        properties = _addProperty(properties, "technical", _generateTechnicalObject(equipmentDetails[tokenId]));
        
        // Add condition properties
        properties = _addProperty(properties, "condition", _generateConditionObject(equipmentDetails[tokenId]));
        
        // Add registration properties
        properties = _addProperty(properties, "registration", _generateRegistrationObject(equipmentDetails[tokenId]));
        
        // Add value properties
        properties = _addProperty(properties, "value", _generateValueObject(equipmentDetails[tokenId]));
        
        // Add insurance properties
        properties = _addProperty(properties, "insurance", _generateInsuranceObject(equipmentDetails[tokenId]));
        
        // Add location properties
        properties = _addProperty(properties, "location", _generateLocationObject(equipmentDetails[tokenId]));
        
        // Add documents
        properties = _addProperty(properties, "documents", _generateDocumentsObject(tokenId, tokenDocumentTypes[tokenId]));
        
        // Add features
        properties = _addProperty(properties, "features", _generateFeaturesArray(tokenId));
        
        // Close with ending brace
        properties = string(abi.encodePacked(properties, "}"));
        
        return properties;
    }
    
    /**
     * @dev Generates identification object
     */
    function _generateIdentificationObject(EquipmentDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.serialNumber).length > 0) {
            obj = _addJsonField(obj, "serialNumber", details.serialNumber);
        }
        
        if (bytes(details.manufacturer).length > 0) {
            obj = _addJsonField(obj, "manufacturer", details.manufacturer);
        }
        
        if (bytes(details.model).length > 0) {
            obj = _addJsonField(obj, "model", details.model);
        }
        
        if (bytes(details.year).length > 0) {
            obj = _addJsonField(obj, "year", details.year);
        }
        
        if (bytes(details.category).length > 0) {
            obj = _addJsonField(obj, "category", details.category);
        }
        
        if (bytes(details.subcategory).length > 0) {
            obj = _addJsonField(obj, "subcategory", details.subcategory);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates technical object
     */
    function _generateTechnicalObject(EquipmentDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.powerSource).length > 0) {
            obj = _addJsonField(obj, "powerSource", details.powerSource);
        }
        
        if (bytes(details.capacity).length > 0) {
            obj = _addJsonField(obj, "capacity", details.capacity);
        }
        
        if (bytes(details.dimensions).length > 0) {
            obj = _addJsonField(obj, "dimensions", details.dimensions);
        }
        
        if (bytes(details.weight).length > 0) {
            obj = _addJsonField(obj, "weight", details.weight);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates condition object
     */
    function _generateConditionObject(EquipmentDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.condition).length > 0) {
            obj = _addJsonField(obj, "condition", details.condition);
        }
        
        if (bytes(details.hoursUsed).length > 0) {
            obj = _addJsonField(obj, "hoursUsed", details.hoursUsed);
        }
        
        if (bytes(details.lastServiceDate).length > 0) {
            obj = _addJsonField(obj, "lastServiceDate", details.lastServiceDate);
        }
        
        if (bytes(details.maintenanceHistory).length > 0) {
            obj = _addJsonField(obj, "maintenanceHistory", details.maintenanceHistory);
        }
        
        if (bytes(details.ownershipHistory).length > 0) {
            obj = _addJsonField(obj, "ownershipHistory", details.ownershipHistory);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates registration object
     */
    function _generateRegistrationObject(EquipmentDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.registrationNumber).length > 0) {
            obj = _addJsonField(obj, "registrationNumber", details.registrationNumber);
        }
        
        if (bytes(details.registrationAuthority).length > 0) {
            obj = _addJsonField(obj, "registrationAuthority", details.registrationAuthority);
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
    function _generateValueObject(EquipmentDetails storage details) internal view returns (string memory) {
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
        
        if (bytes(details.depreciationSchedule).length > 0) {
            obj = _addJsonField(obj, "depreciationSchedule", details.depreciationSchedule);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates insurance object
     */
    function _generateInsuranceObject(EquipmentDetails storage details) internal view returns (string memory) {
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
        
        if (bytes(details.coverageDetails).length > 0) {
            obj = _addJsonField(obj, "coverageDetails", details.coverageDetails);
        }
        
        obj = string(abi.encodePacked(obj, "}"));
        
        return obj;
    }
    
    /**
     * @dev Generates location object
     */
    function _generateLocationObject(EquipmentDetails storage details) internal view returns (string memory) {
        string memory obj = "{";
        
        if (bytes(details.currentLocation).length > 0) {
            obj = _addJsonField(obj, "currentLocation", details.currentLocation);
        }
        
        if (bytes(details.facilityName).length > 0) {
            obj = _addJsonField(obj, "facilityName", details.facilityName);
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
     * @dev Generates features array
     */
    function _generateFeaturesArray(uint256 tokenId) internal view returns (string memory) {
        string[] memory features = tokenFeatures[tokenId];
        
        if (features.length == 0) {
            return "[]";
        }
        
        string memory array = "[";
        
        for (uint i = 0; i < features.length; i++) {
            if (i > 0) {
                array = string(abi.encodePacked(array, ","));
            }
            
            array = string(abi.encodePacked(array, '"', features[i], '"'));
        }
        
        array = string(abi.encodePacked(array, "]"));
        
        return array;
    }
    
    /**
     * @dev Generates gallery array
     */
    function _generateGallery(uint256 tokenId) internal view returns (string memory) {
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
     * @dev Helper function to add a property to the properties object
     */
    function _addProperty(string memory properties, string memory name, string memory value) internal pure returns (string memory) {
        if (bytes(properties).length > 1) { // > 1 because properties starts with "{"
            return string(abi.encodePacked(properties, ',"', name, '":', value));
        } else {
            return string(abi.encodePacked(properties, '"', name, '":', value));
        }
    }
    
    /**
     * @dev Generates the complete JSON metadata
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
    
    /**
     * @dev Implementation of supportsInterface
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable, IERC165Upgradeable) returns (bool) {
        return interfaceId == type(IERC7572).interfaceId || 
               super.supportsInterface(interfaceId);
    }
}