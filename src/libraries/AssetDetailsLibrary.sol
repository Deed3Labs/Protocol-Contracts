// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "../libraries/JSONUtils.sol";
import "../core/interfaces/IDeedNFT.sol";

/**
 * @title AssetDetailsLibrary
 * @dev Library for asset details structures and related functions
 */
library AssetDetailsLibrary {
    using StringsUpgradeable for uint256;
    using JSONUtils for string;

    // Base details shared across all asset types
    struct BaseDetails {
        string confidenceScore;
        string background_color;
        string animation_url;
    }

    // Property details (Land and Estate)
    struct PropertyDetails {
        // Base details
        BaseDetails base;
        
        // Location details
        string country;
        string state;
        string county;
        string city;
        string streetName;
        string streetNumber;
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
        string purchasePrice;
        string warrantyExpiration;
        string holdingEntity;
        string location;
        
        // Value details
        string appraisalSource;
        string appraisedValueUSD;
        string estimatedValueSource;
        string estimatedMarketValueUSD;
        string depreciationSchedule;
        
        // Condition and maintenance
        string condition;
        string lastServiceDate;
        string maintenanceSchedule;
    }

    /**
     * @dev Generates properties for a token
     */
    function generateProperties(
        uint256 tokenId, 
        uint8 assetType, 
        string memory definition, 
        string memory configuration,
        mapping(uint256 => PropertyDetails) storage tokenPropertyDetails,
        mapping(uint256 => VehicleDetails) storage tokenVehicleDetails,
        mapping(uint256 => EquipmentDetails) storage tokenEquipmentDetails,
        mapping(uint256 => string[]) storage tokenFeatures,
        mapping(uint256 => string) storage tokenCustomMetadata,
        mapping(uint256 => string[]) storage tokenDocumentTypes,
        mapping(uint256 => mapping(string => string)) storage tokenDocuments
    ) external view returns (string memory) {
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
     * @dev Generates attributes for a token
     */
    function generateAttributes(
        uint256 tokenId,
        uint8 assetType,
        bool isValidated,
        mapping(uint256 => PropertyDetails) storage tokenPropertyDetails,
        mapping(uint256 => VehicleDetails) storage tokenVehicleDetails,
        mapping(uint256 => EquipmentDetails) storage tokenEquipmentDetails,
        mapping(uint256 => string[]) storage tokenFeatures
    ) external view returns (string memory) {
        string memory attributes = "";
        
        // Add validation status
        attributes = string(abi.encodePacked(
            JSONUtils.createTrait("Validation Status", isValidated ? "Validated" : "Not Validated")
        ));
        
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
        
        attributes = string(abi.encodePacked(attributes, 
            ',', JSONUtils.createTrait("Asset Type", assetTypeName)));
        
        // Add asset-specific attributes
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            PropertyDetails storage details = tokenPropertyDetails[tokenId];
            
            // Add location details
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
}
