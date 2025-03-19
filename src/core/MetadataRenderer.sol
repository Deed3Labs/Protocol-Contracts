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
import "../libraries/MetadataGenerationLibrary.sol";
import "../libraries/MetadataUpdateLibrary.sol";
import "../libraries/AssetDetailsLibrary.sol";

// Interfaces
import "./interfaces/IERC7572.sol";
import "./interfaces/IDeedNFT.sol";

/**
 * @title MetadataRenderer
 * @dev Renders metadata for NFTs with property details
 */
contract MetadataRenderer is Initializable, OwnableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable, IERC7572 {
    using StringsUpgradeable for uint256;
    using Base64Upgradeable for bytes;
    using StringUtils for string;
    using JSONUtils for string;

    // ============ Role Definitions ============
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    // ============ State Variables ============
    // Mapping to track compatible deed contracts
    mapping(address => bool) public compatibleDeedContracts;
    address[] public deedContractsList;

    // Mapping to track token metadata
    mapping(uint256 => AssetDetailsLibrary.PropertyDetails) public tokenPropertyDetails;
    mapping(uint256 => AssetDetailsLibrary.VehicleDetails) public tokenVehicleDetails;
    mapping(uint256 => AssetDetailsLibrary.EquipmentDetails) public tokenEquipmentDetails;
    
    // Mapping to track token features
    mapping(uint256 => string[]) public tokenFeatures;
    
    // Mapping to track token custom metadata
    mapping(uint256 => string) public tokenCustomMetadata;
    
    // Mapping to track token documents
    mapping(uint256 => string[]) public tokenDocumentTypes;
    mapping(uint256 => mapping(string => string)) public tokenDocuments;
    
    // Mapping to track token gallery images
    mapping(uint256 => string[]) public tokenGalleryImages;
    
    // Mapping to track token validation status
    mapping(uint256 => bool) public tokenValidated;
    
    // Default values
    string public baseURI;
    string public invalidatedImageURI;
    mapping(uint8 => string) public assetTypeImageURIs;
    
    // DeedNFT contract
    IDeedNFT public deedNFT;
    
    // ============ Events ============
    event PropertyDetailsUpdated(uint256 indexed tokenId);
    event VehicleDetailsUpdated(uint256 indexed tokenId);
    event EquipmentDetailsUpdated(uint256 indexed tokenId);
    event TokenFeaturesUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    event TokenDocumentUpdated(uint256 indexed tokenId, string docType);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenValidated(uint256 indexed tokenId, bool validated);
    event CompatibleDeedContractAdded(address indexed contractAddress);
    event CompatibleDeedContractRemoved(address indexed contractAddress);
    
    // ============ Modifiers ============
    modifier onlyOwnerOrValidator(uint256 tokenId) {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || 
            hasRole(VALIDATOR_ROLE, msg.sender) || 
            deedNFT.ownerOf(tokenId) == msg.sender,
            "MR: Not authorized"
        );
        _;
    }
    
    // ============ Initializer ============
    function initialize() public initializer {
        __Ownable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    // ============ Admin Functions ============
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
    
    function setBaseURI(string memory _baseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseURI = _baseURI;
    }
    
    function setInvalidatedImageURI(string memory _invalidatedImageURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        invalidatedImageURI = _invalidatedImageURI;
    }
    
    function setAssetTypeImageURI(uint8 assetType, string memory imageURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        assetTypeImageURIs[assetType] = imageURI;
    }
    
    // ============ Token Metadata Functions ============
    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_exists(tokenId), "MR: No token");
        
        // Get token details
        (uint8 assetType, bool isValidated) = _getTokenDetails(tokenId);
        
        // Get image URI
        string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
        
        // Get background color and animation URL
        string memory backgroundColor = _getBackgroundColor(tokenId, assetType);
        string memory animationUrl = _getAnimationUrl(tokenId, assetType);
        
        // Generate name and description
        string memory name = MetadataGenerationLibrary.generateName(
            tokenId, 
            assetType,
            tokenPropertyDetails,
            tokenVehicleDetails,
            tokenEquipmentDetails
        );
        
        string memory description = _getDescription(tokenId);
        
        // Generate gallery
        string memory gallery = MetadataGenerationLibrary.generateGallery(tokenGalleryImages[tokenId]);
        
        // Generate attributes
        string memory attributes = AssetDetailsLibrary.generateAttributes(
            tokenId,
            assetType,
            tokenPropertyDetails,
            tokenVehicleDetails,
            tokenEquipmentDetails,
            tokenFeatures
        );
        
        // Generate properties
        string memory properties = AssetDetailsLibrary.generateProperties(
            tokenId,
            assetType,
            _getDefinition(tokenId),
            _getConfiguration(tokenId),
            tokenPropertyDetails,
            tokenVehicleDetails,
            tokenEquipmentDetails,
            tokenFeatures,
            tokenCustomMetadata,
            tokenDocumentTypes,
            tokenDocuments
        );
        
        // Generate JSON
        string memory json = MetadataGenerationLibrary.generateJSON(
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
        
        // Encode to Base64
        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64Upgradeable.encode(bytes(json))
            )
        );
    }
    
    // ============ Helper Functions ============
    function _exists(uint256 tokenId) internal view returns (bool) {
        address tokenContract = _getTokenContract(tokenId);
        if (tokenContract == address(0)) {
            return false;
        }
        
        try IERC721Upgradeable(tokenContract).ownerOf(tokenId) returns (address) {
            return true;
        } catch {
            return false;
        }
    }
    
    function _getTokenContract(uint256 tokenId) internal view returns (address) {
        // If deedNFT is set and token exists there, use it
        if (address(deedNFT) != address(0)) {
            try deedNFT.ownerOf(tokenId) returns (address) {
                return address(deedNFT);
            } catch {
                // Token doesn't exist in deedNFT, continue checking other contracts
            }
        }
        
        // Check other compatible contracts
        for (uint i = 0; i < deedContractsList.length; i++) {
            address contractAddress = deedContractsList[i];
            if (contractAddress != address(deedNFT)) {
                try IERC721Upgradeable(contractAddress).ownerOf(tokenId) returns (address) {
                    return contractAddress;
                } catch {
                    // Token doesn't exist in this contract, continue checking
                }
            }
        }
        
        return address(0); // Token not found in any compatible contract
    }
    
    function _getTokenDetails(uint256 tokenId) internal view returns (uint8 assetType, bool isValidated) {
        address tokenContract = _getTokenContract(tokenId);
        require(tokenContract != address(0), "MR: Token not found");
        
        // Get asset type
        try IDeedNFT(tokenContract).getAssetType(tokenId) returns (uint8 _assetType) {
            assetType = _assetType;
        } catch {
            assetType = 0; // Default to unknown asset type
        }
        
        // Get validation status
        isValidated = tokenValidated[tokenId];
    }
    
    function _getAssetType(uint256 tokenId) internal view returns (uint8) {
        address tokenContract = _getTokenContract(tokenId);
        require(tokenContract != address(0), "MR: Token not found");
        
        try IDeedNFT(tokenContract).getAssetType(tokenId) returns (uint8 assetType) {
            return assetType;
        } catch {
            return 0; // Default to unknown asset type
        }
    }
    
    function _getImageURI(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        // If token is not validated, return invalidated image
        if (!isValidated && bytes(invalidatedImageURI).length > 0) {
            return invalidatedImageURI;
        }
        
        // Check if there's a custom image in the gallery
        if (tokenGalleryImages[tokenId].length > 0) {
            return tokenGalleryImages[tokenId][0]; // Use first gallery image as main image
        }
        
        // Use asset type default image
        if (bytes(assetTypeImageURIs[assetType]).length > 0) {
            return assetTypeImageURIs[assetType];
        }
        
        // Fallback to empty string
        return "";
    }
    
    function _getBackgroundColor(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            return tokenPropertyDetails[tokenId].base.background_color;
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            return tokenVehicleDetails[tokenId].base.background_color;
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            return tokenEquipmentDetails[tokenId].base.background_color;
        }
        
        return "";
    }
    
    function _getAnimationUrl(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            return tokenPropertyDetails[tokenId].base.animation_url;
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            return tokenVehicleDetails[tokenId].base.animation_url;
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            return tokenEquipmentDetails[tokenId].base.animation_url;
        }
        
        return "";
    }
    
    function _getDescription(uint256 tokenId) internal view returns (string memory) {
        // Use custom metadata description if available
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            string memory description = JSONUtils.parseJsonField(tokenCustomMetadata[tokenId], "description");
            if (bytes(description).length > 0) {
                return description;
            }
        }
        
        // Default description
        return string(abi.encodePacked("Asset #", tokenId.toString()));
    }
    
    function _getDefinition(uint256 tokenId) internal view returns (string memory) {
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            return JSONUtils.parseJsonField(tokenCustomMetadata[tokenId], "definition");
        }
        return "";
    }
    
    function _getConfiguration(uint256 tokenId) internal view returns (string memory) {
        if (bytes(tokenCustomMetadata[tokenId]).length > 0) {
            return JSONUtils.parseJsonField(tokenCustomMetadata[tokenId], "configuration");
        }
        return "";
    }
    
    // ============ Update Functions ============
    function updatePropertyDetails(uint256 tokenId, string memory detailsJson) external onlyRole(VALIDATOR_ROLE) {
        require(_exists(tokenId), "MR: No token");
        require(_getAssetType(tokenId) == uint8(IDeedNFT.AssetType.Land) || _getAssetType(tokenId) == uint8(IDeedNFT.AssetType.Estate), "MR: Wrong asset type");
        
        MetadataUpdateLibrary.updatePropertyDetails(tokenPropertyDetails, tokenId, detailsJson);
        
        emit PropertyDetailsUpdated(tokenId);
    }
    
    function updateVehicleDetails(uint256 tokenId, string memory detailsJson) external onlyRole(VALIDATOR_ROLE) {
        require(_exists(tokenId), "MR: No token");
        require(_getAssetType(tokenId) == uint8(IDeedNFT.AssetType.Vehicle), "MR: Wrong asset type");
        
        MetadataUpdateLibrary.updateVehicleDetails(tokenVehicleDetails, tokenId, detailsJson);
        
        emit VehicleDetailsUpdated(tokenId);
    }
    
    function updateEquipmentDetails(uint256 tokenId, string memory detailsJson) external onlyRole(VALIDATOR_ROLE) {
        require(_exists(tokenId), "MR: No token");
        require(_getAssetType(tokenId) == uint8(IDeedNFT.AssetType.CommercialEquipment), "MR: Wrong asset type");
        
        MetadataUpdateLibrary.updateEquipmentDetails(tokenEquipmentDetails, tokenId, detailsJson);
        
        emit EquipmentDetailsUpdated(tokenId);
    }
    
    function setTokenFeatures(uint256 tokenId, string[] memory features) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MR: No token");
        
        delete tokenFeatures[tokenId];
        
        for (uint i = 0; i < features.length; i++) {
            tokenFeatures[tokenId].push(features[i]);
        }
        
        emit TokenFeaturesUpdated(tokenId);
    }
    
    function setTokenCustomMetadata(uint256 tokenId, string memory customMetadata) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MR: No token");
        
        tokenCustomMetadata[tokenId] = customMetadata;
        
        emit TokenCustomMetadataUpdated(tokenId);
    }
    
    function setTokenGalleryImages(uint256 tokenId, string[] memory galleryImages) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MR: No token");
        
        delete tokenGalleryImages[tokenId];
        
        for (uint i = 0; i < galleryImages.length; i++) {
            tokenGalleryImages[tokenId].push(galleryImages[i]);
        }
        
        emit TokenGalleryUpdated(tokenId);
    }
    
    function setTokenValidated(uint256 tokenId, bool validated) external onlyRole(VALIDATOR_ROLE) {
        require(_exists(tokenId), "MR: No token");
        
        tokenValidated[tokenId] = validated;
        
        emit TokenValidated(tokenId, validated);
    }
    
    function getTokenDocument(uint256 tokenId, string memory docType) external view returns (string memory) {
        return tokenDocuments[tokenId][docType];
    }
    
    function getTokenDocumentTypes(uint256 tokenId) external view returns (string[] memory) {
        return tokenDocumentTypes[tokenId];
    }
    
    function setTokenDocuments(uint256 tokenId, string[] memory docTypes, string[] memory documentURIs) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MR: No token");
        require(docTypes.length == documentURIs.length, "MR: Arrays mismatch");
        
        for (uint i = 0; i < docTypes.length; i++) {
            require(bytes(docTypes[i]).length > 0, "MR: Doc type empty");
            
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
    
    function removeTokenDocument(uint256 tokenId, string memory docType) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MR: No token");
        
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
    
    function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_deedNFT != address(0), "MR: Invalid address");
        deedNFT = IDeedNFT(_deedNFT);
        
        // Also add to compatible contracts if not already added
        if (!compatibleDeedContracts[_deedNFT]) {
            addCompatibleDeedContract(_deedNFT);
        }
    }
    
    function addCompatibleDeedContract(address contractAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(contractAddress != address(0), "MR: Invalid address");
        require(!compatibleDeedContracts[contractAddress], "MR: Already added");
        
        // Verify the contract implements the IDeedNFT interface
        try IDeedNFT(contractAddress).supportsInterface(type(IERC721Upgradeable).interfaceId) returns (bool supported) {
            require(supported, "MR: Not IERC721");
        } catch {
            revert("MR: Not IDeedNFT");
        }
        
        compatibleDeedContracts[contractAddress] = true;
        deedContractsList.push(contractAddress);
        
        emit CompatibleDeedContractAdded(contractAddress);
    }
    
    function removeCompatibleDeedContract(address contractAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(compatibleDeedContracts[contractAddress], "MR: Not compatible");
        
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
    
    function getCompatibleDeedContracts() external view returns (address[] memory) {
        return deedContractsList;
    }
    
    function isCompatibleDeedContract(address contractAddress) public view returns (bool) {
        return compatibleDeedContracts[contractAddress];
    }
    
    // Implement IERC7572 interface
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable, IERC165Upgradeable) returns (bool) {
        return interfaceId == type(IERC7572).interfaceId || 
               super.supportsInterface(interfaceId);
    }
}
    
    // Token documents
    mapping(uint256 => string[]) public tokenDocumentTypes;
    mapping(uint256 => mapping(string => string)) public tokenDocuments;
    
    // Token custom metadata (JSON string)
    mapping(uint256 => string) public tokenCustomMetadata;
    
    // Events
    event AssetDetailsUpdated(uint256 indexed tokenId, uint8 assetType);
    event TokenFeaturesUpdated(uint256 indexed tokenId);
    event TokenDocumentUpdated(uint256 indexed tokenId, string docType);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    event CompatibleDeedContractAdded(address indexed contractAddress);
    event CompatibleDeedContractRemoved(address indexed contractAddress);
    
    // Add this with the other state variables
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    
    /**
     * @dev Initializes the contract
     */
    function initialize(string memory _baseURI) public initializer {
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
     * @dev Updates asset details for a token
     * @param tokenId ID of the token
     * @param assetType Type of the asset (0=Land, 1=Vehicle, 2=Estate, 3=CommercialEquipment)
     * @param details JSON string containing the details to update
     * @notice Fields not included in the details parameter will remain unchanged
     * @notice Empty string values ("") will be ignored and not update the existing value
     */
    function updateAssetDetails(
        uint256 tokenId,
        uint8 assetType,
        string memory details
    ) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MetadataRenderer: Token does not exist");
        require(bytes(details).length > 0, "MetadataRenderer: Details cannot be empty");
        
        // Check for gallery updates
        string memory galleryJson = JSONUtils.parseJsonField(details, "gallery");
        if (bytes(galleryJson).length > 0) {
            // Parse the gallery JSON array into string[]
            string[] memory imageUrls = JSONUtils.parseJsonArrayToStringArray(galleryJson);
            if (imageUrls.length > 0) {
                _setTokenGallery(tokenId, imageUrls);
            }
        }
        
        // Parse the JSON details and update the appropriate storage based on asset type
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            _updatePropertyDetails(tokenId, details);
            emit AssetDetailsUpdated(tokenId, assetType);
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            _updateVehicleDetails(tokenId, details);
            emit AssetDetailsUpdated(tokenId, assetType);
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            _updateEquipmentDetails(tokenId, details);
            emit AssetDetailsUpdated(tokenId, assetType);
        } else {
            revert("MetadataRenderer: Unsupported asset type");
        }
    }

    /**
     * @dev Internal function to update property details
     * @param tokenId ID of the token
     * @param detailsJson JSON string containing the details to update
     */
    function _updatePropertyDetails(uint256 tokenId, string memory detailsJson) internal {
        MetadataUpdateLibrary.updatePropertyDetails(tokenPropertyDetails, tokenId, detailsJson);
        emit AssetDetailsUpdated(tokenId, uint8(IDeedNFT.AssetType.Land) || uint8(IDeedNFT.AssetType.Estate));
    }

    /**
     * @dev Internal function to update vehicle details
     * @param tokenId ID of the token
     * @param detailsJson JSON string containing the details to update
     */
    function _updateVehicleDetails(uint256 tokenId, string memory detailsJson) internal {
        MetadataUpdateLibrary.updateVehicleDetails(tokenVehicleDetails, tokenId, detailsJson);
        emit AssetDetailsUpdated(tokenId, uint8(IDeedNFT.AssetType.Vehicle));
    }

    /**
     * @dev Internal function to update equipment details
     * @param tokenId ID of the token
     * @param detailsJson JSON string containing the details to update
     */
    function _updateEquipmentDetails(uint256 tokenId, string memory detailsJson) internal {
        MetadataUpdateLibrary.updateEquipmentDetails(tokenEquipmentDetails, tokenId, detailsJson);
        emit AssetDetailsUpdated(tokenId, uint8(IDeedNFT.AssetType.CommercialEquipment));
    }

    /**
     * @dev Helper function to parse a field from a JSON string
     * @param json JSON string to parse
     * @param field Field name to extract
     * @return The value of the field as a string, or empty string if not found
     * @notice In production, use a proper JSON parser library
     */
    function _parseJsonField(string memory json, string memory field) internal pure returns (string memory) {
        // This is a simplified implementation for demonstration
        // In production, use a proper JSON parser library
        
        string memory fieldPattern = string(abi.encodePacked('"', field, '":'));
        
        bytes memory jsonBytes = bytes(json);
        bytes memory fieldPatternBytes = bytes(fieldPattern);
        
        uint256 i = 0;
        while (i < jsonBytes.length - fieldPatternBytes.length) {
            bool found = true;
            for (uint256 j = 0; j < fieldPatternBytes.length; j++) {
                if (jsonBytes[i + j] != fieldPatternBytes[j]) {
                    found = false;
                    break;
                }
            }
            
            if (found) {
                i += fieldPatternBytes.length;
                
                // Skip whitespace
                while (i < jsonBytes.length && (jsonBytes[i] == ' ' || jsonBytes[i] == '\t' || jsonBytes[i] == '\n' || jsonBytes[i] == '\r')) {
                    i++;
                }
                
                // Check if value is a string
                if (jsonBytes[i] == '"') {
                    i++; // Skip opening quote
                    uint256 start = i;
                    
                    // Find closing quote
                    while (i < jsonBytes.length && jsonBytes[i] != '"') {
                        // Handle escaped quotes
                        if (jsonBytes[i] == '\\' && i + 1 < jsonBytes.length && jsonBytes[i + 1] == '"') {
                            i += 2;
                        } else {
                            i++;
                        }
                    }
                    
                    // Extract value
                    bytes memory valueBytes = new bytes(i - start);
                    for (uint256 j = 0; j < i - start; j++) {
                        valueBytes[j] = jsonBytes[start + j];
                    }
                    
                    return string(valueBytes);
                } 
                // Check if value is a boolean, number, or null
                else {
                    uint256 start = i;
                    
                    // Find end of value (comma, closing brace, or closing bracket)
                    while (i < jsonBytes.length && jsonBytes[i] != ',' && jsonBytes[i] != '}' && jsonBytes[i] != ']') {
                        i++;
                    }
                    
                    // Extract value
                    bytes memory valueBytes = new bytes(i - start);
                    for (uint256 j = 0; j < i - start; j++) {
                        valueBytes[j] = jsonBytes[start + j];
                    }
                    
                    return string(valueBytes);
                }
            }
            
            i++;
        }
        
        return ""; // Field not found
    }

    /**
     * @dev Helper function to convert a string to a boolean
     * @param value String value to convert
     * @return Boolean representation of the string
     */
    function _stringToBool(string memory value) internal pure returns (bool) {
        return MetadataUpdateLibrary.stringToBool(value);
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
     * @dev Generates name for a token
     */
    function _generateName(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            AssetDetailsLibrary.PropertyDetails storage details = tokenPropertyDetails[tokenId];
            return string(abi.encodePacked(
                details.streetNumber, " ", details.streetName, ", ", 
                details.city, ", ", details.state, " #", tokenId.toString()
            ));
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            AssetDetailsLibrary.VehicleDetails storage details = tokenVehicleDetails[tokenId];
            return string(abi.encodePacked(
                details.year, " ", details.make, " ", details.model, " #", tokenId.toString()
            ));
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            AssetDetailsLibrary.EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
            return string(abi.encodePacked(
                details.year, " ", details.manufacturer, " ", details.model, " #", tokenId.toString()
            ));
        }
        
        return tokenId.toString();
    }
    
    /**
     * @dev Generates gallery JSON for a token
     */
    function _generateGallery(uint256 tokenId) internal view returns (string memory) {
        return MetadataGenerationLibrary.generateGallery(tokenGalleryImages[tokenId]);
    }
    
    /**
     * @dev Generates attributes for a token
     */
    function _generateAttributes(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        return AssetDetailsLibrary.generateAttributes(
            tokenId,
            assetType,
            isValidated,
            tokenPropertyDetails,
            tokenVehicleDetails,
            tokenEquipmentDetails,
            tokenFeatures
        );
    }
    
    /**
     * @dev Generates properties for a token
     */
    function _generateProperties(uint256 tokenId, uint8 assetType, string memory definition, string memory configuration) internal view returns (string memory) {
        return AssetDetailsLibrary.generateProperties(
            tokenId,
            assetType,
            definition,
            configuration,
            tokenPropertyDetails,
            tokenVehicleDetails,
            tokenEquipmentDetails,
            tokenFeatures,
            tokenCustomMetadata,
            tokenDocumentTypes,
            tokenDocuments
        );
    }
    
    /**
     * @dev Gets base details for a token
     */
    function _getBaseDetails(uint256 tokenId, uint8 assetType) internal view returns (string memory backgroundColor, string memory animationUrl) {
        if (assetType == uint8(IDeedNFT.AssetType.Land) || assetType == uint8(IDeedNFT.AssetType.Estate)) {
            AssetDetailsLibrary.PropertyDetails storage details = tokenPropertyDetails[tokenId];
            return (details.base.background_color, details.base.animation_url);
        } else if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            AssetDetailsLibrary.VehicleDetails storage details = tokenVehicleDetails[tokenId];
            return (details.base.background_color, details.base.animation_url);
        } else if (assetType == uint8(IDeedNFT.AssetType.CommercialEquipment)) {
            AssetDetailsLibrary.EquipmentDetails storage details = tokenEquipmentDetails[tokenId];
            return (details.base.background_color, details.base.animation_url);
        }
        
        return ("", "");
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
     * @dev Generates JSON metadata for a token
     * @param tokenId ID of the token
     * @param name Name of the token
     * @param description Description of the token
     * @param imageURI URI of the token image
     * @param backgroundColor Background color for the token
     * @param animationUrl Animation URL for the token
     * @param gallery Gallery of images for the token
     * @param attributes Attributes for the token
     * @param properties Properties for the token
     * @return Base64-encoded JSON metadata
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
    ) internal view returns (string memory) {
        string memory json = MetadataGenerationLibrary.generateJSON(
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
        
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64Upgradeable.encode(bytes(json))
        ));
    }
    
    /**
     * @dev Generates token URI for a specific token
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return URI for the token metadata
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        // Get asset type from token
        bytes memory assetTypeBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("assetType"));
        if (assetTypeBytes.length == 0) {
            return ""; // Invalid token
        }
        
        uint256 assetTypeValue = abi.decode(assetTypeBytes, (uint256));
        uint8 assetType = uint8(assetTypeValue);
        
        // Get validation status
        (bool isValidated, /* address validator */) = IDeedNFT(tokenContract).getValidationStatus(tokenId);
        
        // Get definition and configuration
        bytes memory definitionBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("definition"));
        bytes memory configurationBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("configuration"));
        
        string memory definition = definitionBytes.length > 0 ? abi.decode(definitionBytes, (string)) : "";
        string memory configuration = configurationBytes.length > 0 ? abi.decode(configurationBytes, (string)) : "";
        
        // Generate metadata components
        string memory name = _generateName(tokenId, assetType);
        string memory attributes = _generateAttributes(tokenId, assetType, isValidated);
        string memory properties = _generateProperties(tokenId, assetType, definition, configuration);
        string memory gallery = _generateGallery(tokenId);
        string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
        (string memory backgroundColor, string memory animationUrl) = _getBaseDetails(tokenId, assetType);
        
        // Generate JSON
        return _generateJSON(
            tokenId,
            name,
            definition,
            imageURI,
            backgroundColor,
            animationUrl,
            gallery,
            attributes,
            properties
        );
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
        require(_exists(tokenId), "MR: No token");
        require(docTypes.length == documentURIs.length, "MR: Arrays mismatch");
        
        for (uint i = 0; i < docTypes.length; i++) {
            require(bytes(docTypes[i]).length > 0, "MR: Doc type empty");
            
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
    
    function removeTokenDocument(uint256 tokenId, string memory docType) external onlyOwnerOrValidator(tokenId) {
        require(_exists(tokenId), "MR: No token");
        
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
    
    function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_deedNFT != address(0), "MR: Invalid address");
        deedNFT = IDeedNFT(_deedNFT);
        
        // Also add to compatible contracts if not already added
        if (!compatibleDeedContracts[_deedNFT]) {
            addCompatibleDeedContract(_deedNFT);
        }
    }
    
    function addCompatibleDeedContract(address contractAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(contractAddress != address(0), "MR: Invalid address");
        require(!compatibleDeedContracts[contractAddress], "MR: Already added");
        
        // Verify the contract implements the IDeedNFT interface
        try IDeedNFT(contractAddress).supportsInterface(type(IERC721Upgradeable).interfaceId) returns (bool supported) {
            require(supported, "MR: Not IERC721");
        } catch {
            revert("MR: Not IDeedNFT");
        }
        
        compatibleDeedContracts[contractAddress] = true;
        deedContractsList.push(contractAddress);
        
        emit CompatibleDeedContractAdded(contractAddress);
    }
    
    function removeCompatibleDeedContract(address contractAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(compatibleDeedContracts[contractAddress], "MR: Not compatible");
        
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
    
    function getCompatibleDeedContracts() external view returns (address[] memory) {
        return deedContractsList;
    }
    
    function isCompatibleDeedContract(address contractAddress) public view returns (bool) {
        return compatibleDeedContracts[contractAddress];
    }
    
    // Implement IERC7572 interface
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable, IERC165Upgradeable) returns (bool) {
        return interfaceId == type(IERC7572).interfaceId || 
               super.supportsInterface(interfaceId);
    }
}