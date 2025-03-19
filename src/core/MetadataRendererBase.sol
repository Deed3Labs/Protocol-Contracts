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
import "./interfaces/IMetadataRenderer.sol";

/**
 * @title MetadataRendererBase
 * @dev Base contract for metadata rendering with common functionality
 */
abstract contract MetadataRendererBase is Initializable, OwnableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable, IMetadataRenderer {
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
        string name;
        string description;
        string imageURI;
        string background_color;
        string animation_url;
    }
    
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
    event TokenFeaturesUpdated(uint256 indexed tokenId);
    event TokenDocumentUpdated(uint256 indexed tokenId, string docType);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    event CompatibleDeedContractAdded(address indexed contractAddress);
    event CompatibleDeedContractRemoved(address indexed contractAddress);
    
    IDeedNFT public deedNFT;
    
    // Roles
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    
    // Compatible contracts
    mapping(address => bool) public compatibleDeedContracts;
    address[] public deedContractsList;
    
    /**
     * @dev Initializes the contract
     */
    function initialize(string memory _baseURI) public virtual initializer {
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
     * @dev Generates gallery array
     */
    function _generateGallery(uint256 tokenId) internal view virtual returns (string memory) {
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
     * @dev Generates the complete JSON metadata
     */
    function _generateJSON(
        uint256 /* tokenId */,  // Comment out the parameter name to silence the warning
        string memory name,
        string memory description,
        string memory imageURI,
        string memory backgroundColor,
        string memory animationUrl,
        string memory gallery,
        string memory attributes,
        string memory properties
    ) internal pure virtual returns (string memory) {
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
    
    /**
     * @dev Abstract function to be implemented by child contracts
     */
    function updateAssetDetails(uint256 tokenId, uint8 assetType, string memory details) external virtual;
} 