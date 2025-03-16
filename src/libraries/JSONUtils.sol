// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./StringUtils.sol";

/**
 * @title JSONUtils
 * @dev Library for JSON generation
 */
library JSONUtils {
    using StringUtils for string;
    
    /**
     * @dev Creates a JSON trait
     */
    function createTrait(string memory traitType, string memory value) internal pure returns (string memory) {
        return string(abi.encodePacked('{"trait_type":"', traitType, '","value":"', value, '"}'));
    }
    
    /**
     * @dev Adds a trait to attributes array if value is not empty
     */
    function addTraitIfNotEmpty(string memory attributes, string memory traitType, string memory value) internal pure returns (string memory) {
        if (bytes(value).length == 0) {
            return attributes;
        }
        
        string memory separator = bytes(attributes).length > 0 ? "," : "";
        return string(abi.encodePacked(attributes, separator, createTrait(traitType, value)));
    }
    
    /**
     * @dev Creates a JSON object with key-value pair
     */
    function createJSONObject(string memory key, string memory value) internal pure returns (string memory) {
        return string(abi.encodePacked('"', key, '":"', value, '"'));
    }
    
    /**
     * @dev Adds a string array to JSON
     */
    function addStringArray(string memory json, string memory arrayName, string[] memory items) internal pure returns (string memory) {
        if (items.length == 0) {
            return json;
        }
        
        string memory arrayJson = string(abi.encodePacked('"', arrayName, '":['));
        
        for (uint i = 0; i < items.length; i++) {
            if (i > 0) {
                arrayJson = string(abi.encodePacked(arrayJson, ','));
            }
            arrayJson = string(abi.encodePacked(arrayJson, '"', items[i], '"'));
        }
        
        arrayJson = string(abi.encodePacked(arrayJson, ']'));
        
        return string(abi.encodePacked(json, ',', arrayJson));
    }
    
    /**
     * @dev Adds a string-to-string mapping to JSON as an object
     */
    function addStringMap(string memory json, string memory mapName, string[] memory keys, mapping(string => string) storage values) internal view returns (string memory) {
        if (keys.length == 0) {
            return json;
        }
        
        string memory mapJson = string(abi.encodePacked('"', mapName, '":{'));
        
        for (uint i = 0; i < keys.length; i++) {
            if (i > 0) {
                mapJson = string(abi.encodePacked(mapJson, ','));
            }
            string memory key = keys[i];
            string memory value = values[key];
            mapJson = string(abi.encodePacked(mapJson, '"', key, '":"', value, '"'));
        }
        
        mapJson = string(abi.encodePacked(mapJson, '}'));
        
        return string(abi.encodePacked(json, ',', mapJson));
    }
} 