// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./JSONUtils.sol";
import "./AssetDetailsLibrary.sol";

library MetadataUpdateLibrary {
    using JSONUtils for string;
    
    function updatePropertyDetails(
        mapping(uint256 => AssetDetailsLibrary.PropertyDetails) storage tokenPropertyDetails,
        uint256 tokenId, 
        string memory detailsJson
    ) external {
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
        
        details.has_water = stringToBool(hasWater);
        details.has_electricity = stringToBool(hasElectricity);
        details.has_natural_gas = stringToBool(hasNaturalGas);
        details.has_sewer = stringToBool(hasSewer);
        details.has_internet = stringToBool(hasInternet);
        
        // Map overlay
        details.map_overlay = JSONUtils.parseJsonField(detailsJson, "map_overlay");
    }
    
    function updateVehicleDetails(
        mapping(uint256 => AssetDetailsLibrary.VehicleDetails) storage tokenVehicleDetails,
        uint256 tokenId, 
        string memory detailsJson
    ) external {
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
    
    function updateEquipmentDetails(
        mapping(uint256 => AssetDetailsLibrary.EquipmentDetails) storage tokenEquipmentDetails,
        uint256 tokenId, 
        string memory detailsJson
    ) external {
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
        details.category = JSONUtils.parseJsonField(detailsJson, "category");
        details.equipmentType = JSONUtils.parseJsonField(detailsJson, "equipment_type");
        
        // Physical details
        details.dimensions = JSONUtils.parseJsonField(detailsJson, "dimensions");
        details.weight = JSONUtils.parseJsonField(detailsJson, "weight");
        details.powerSource = JSONUtils.parseJsonField(detailsJson, "power_source");
        details.operatingHours = JSONUtils.parseJsonField(detailsJson, "operating_hours");
        
        // Ownership details
        details.purchaseDate = JSONUtils.parseJsonField(detailsJson, "purchase_date");
        details.purchasePrice = JSONUtils.parseJsonField(detailsJson, "purchase_price");
        details.warrantyExpiration = JSONUtils.parseJsonField(detailsJson, "warranty_expiration");
        details.holdingEntity = JSONUtils.parseJsonField(detailsJson, "holding_entity");
        details.location = JSONUtils.parseJsonField(detailsJson, "location");
        
        // Value details
        details.appraisalSource = JSONUtils.parseJsonField(detailsJson, "appraisal_source");
        details.appraisedValueUSD = JSONUtils.parseJsonField(detailsJson, "appraised_value_usd");
        details.estimatedValueSource = JSONUtils.parseJsonField(detailsJson, "estimated_value_source");
        details.estimatedMarketValueUSD = JSONUtils.parseJsonField(detailsJson, "estimated_market_value_usd");
        details.depreciationSchedule = JSONUtils.parseJsonField(detailsJson, "depreciation_schedule");
        
        // Condition and maintenance
        details.condition = JSONUtils.parseJsonField(detailsJson, "condition");
        details.lastServiceDate = JSONUtils.parseJsonField(detailsJson, "last_service_date");
        details.maintenanceSchedule = JSONUtils.parseJsonField(detailsJson, "maintenance_schedule");
    }
    
    function stringToBool(string memory value) public pure returns (bool) {
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