// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

/**
 * @title StringUtils
 * @dev Library for string operations
 */
library StringUtils {
    /**
     * @dev Checks if a string is empty
     */
    function isEmpty(string memory str) internal pure returns (bool) {
        return bytes(str).length == 0;
    }
    
    /**
     * @dev Concatenates two strings
     */
    function concat(string memory a, string memory b) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b));
    }
    
    /**
     * @dev Adds a string attribute to JSON if not empty
     */
    function addStringAttribute(string memory json, string memory name, string memory value) internal pure returns (string memory) {
        if (isEmpty(value)) {
            return json;
        }
        return concat(json, concat(concat(concat(concat(',"', name), '":"'), value), '"'));
    }
    
    /**
     * @dev Adds a boolean attribute to JSON
     */
    function addBoolAttribute(string memory json, string memory name, bool value) internal pure returns (string memory) {
        return concat(json, concat(concat(concat(',"', name), '":'), value ? 'true' : 'false'));
    }
} 