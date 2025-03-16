// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

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
     * @dev Checks if a string contains a substring
     */
    function contains(string memory source, string memory target) internal pure returns (bool) {
        bytes memory sourceBytes = bytes(source);
        bytes memory targetBytes = bytes(target);
        
        if (targetBytes.length > sourceBytes.length) {
            return false;
        }
        
        for (uint i = 0; i <= sourceBytes.length - targetBytes.length; i++) {
            bool found = true;
            
            for (uint j = 0; j < targetBytes.length; j++) {
                if (sourceBytes[i + j] != targetBytes[j]) {
                    found = false;
                    break;
                }
            }
            
            if (found) {
                return true;
            }
        }
        
        return false;
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