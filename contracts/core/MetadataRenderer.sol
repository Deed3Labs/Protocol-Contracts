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

/**
 * @title MetadataRenderer
 * @dev Renders metadata for NFTs with dynamic trait parsing
 */
contract MetadataRenderer is Initializable, OwnableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable, IERC7572 {
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
    
    // Dynamic trait storage
    struct TokenMetadata {
        // Base metadata
        string name;
        string description;
        string image;
        string background_color;
        string animation_url;
        
        // Gallery images
        string[] galleryImages;
        
        // Document types
        string[] documentTypes;
        
        // Custom metadata for complex properties
        string customMetadata;
    }

    // Token metadata storage
    mapping(uint256 => TokenMetadata) private tokenMetadata;
    
    // Events
    event TokenMetadataUpdated(uint256 indexed tokenId);
    event TokenGalleryUpdated(uint256 indexed tokenId);
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);
    event CompatibleDeedContractAdded(address indexed contractAddress);
    event CompatibleDeedContractRemoved(address indexed contractAddress);
    event MetadataInitialized(uint256 indexed tokenId, string ipfsHash);
    event TraitsParsed(uint256 indexed tokenId, address indexed deedContract);
    
    IDeedNFT public deedNFT;
    
    // Role definitions
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    
    // Compatible contracts
    mapping(address => bool) public compatibleDeedContracts;
    address[] public deedContractsList;
    
    // Optimized error types
    error Unauthorized();
    error Invalid();      // Combined InvalidTokenId, InvalidJson, InvalidContract, InvalidAddress into one
    error Empty();        // Renamed from EmptyInput to save bytes
    error Exists();       // Renamed from ContractExists to save bytes

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
        invalidatedImageURI = "ipfs://Qm";
        
        // Set default asset type images - Land/Estate share same image
        assetTypeImageURIs[0] = "ipfs://Qm1"; // Land
        assetTypeImageURIs[1] = "ipfs://Qm2"; // Vehicle
        assetTypeImageURIs[2] = assetTypeImageURIs[0]; // Estate uses Land image
        assetTypeImageURIs[3] = "ipfs://Qm3"; // Equipment
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
    function setTokenCustomMetadata(uint256 tokenId, string memory metadata) external onlyOwnerOrValidator(tokenId) {
        tokenMetadata[tokenId].customMetadata = metadata;
        emit TokenCustomMetadataUpdated(tokenId);
    }
    
    /**
     * @dev Sets the gallery images for a token
     * @param tokenId ID of the token to set gallery for
     * @param images Array of IPFS image hashes
     */
    function setTokenGallery(uint256 tokenId, string[] calldata images) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_exists(tokenId)) revert Invalid();
        _setTokenGallery(tokenId, images);
    }

    /**
     * @dev Internal function to set the token gallery
     * @param tokenId ID of the token
     * @param imageUrls Array of image URLs
     */
    function _setTokenGallery(uint256 tokenId, string[] memory imageUrls) internal {
        // Clear existing gallery
        delete tokenMetadata[tokenId].galleryImages;
        
        // Add new images
        for (uint i = 0; i < imageUrls.length; i++) {
            if (bytes(imageUrls[i]).length > 0) {
                tokenMetadata[tokenId].galleryImages.push(imageUrls[i]);
            }
        }
        
        emit TokenGalleryUpdated(tokenId);
    }
    
    /**
     * @dev Gets token gallery images
     */
    function getTokenGallery(uint256 tokenId) external view returns (string[] memory) {
        return tokenMetadata[tokenId].galleryImages;
    }
    
    /**
     * @dev Updates asset details for a token
     * @param tokenId ID of the token
     * @param assetType Type of the asset
     * @param details JSON string containing the details to update
     */
    function updateAssetDetails(
        uint256 tokenId,
        uint8 assetType,
        string memory details
    ) external onlyOwnerOrValidator(tokenId) {
        _validateInputs(tokenId, details);
        
        // Store asset type as a trait
        deedNFT.setTrait(tokenId, keccak256("assetType"), abi.encode(uint256(assetType)));
        
        // Parse and set traits in DeedNFT
        _parseAndSetTraits(tokenId, details);
        
        // Update metadata and gallery
        _updateMetadataFromJson(tokenId, details);
        
        emit TokenMetadataUpdated(tokenId);
    }

    /**
     * @dev Internal function to update metadata from JSON
     */
    function _updateMetadataFromJson(uint256 tokenId, string memory detailsJson) internal {
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        
        // Update base fields if provided
        string memory name = JSONUtils.parseJsonField(detailsJson, "name");
        if (bytes(name).length > 0) {
            metadata.name = name;
        }
        
        string memory description = JSONUtils.parseJsonField(detailsJson, "description");
        if (bytes(description).length > 0) {
            metadata.description = description;
        }
        
        string memory image = JSONUtils.parseJsonField(detailsJson, "image");
        if (bytes(image).length > 0) {
            metadata.image = image;
        }
        
        string memory backgroundColor = JSONUtils.parseJsonField(detailsJson, "background_color");
        if (bytes(backgroundColor).length > 0) {
            metadata.background_color = backgroundColor;
        }
        
        string memory animationUrl = JSONUtils.parseJsonField(detailsJson, "animation_url");
        if (bytes(animationUrl).length > 0) {
            metadata.animation_url = animationUrl;
        }

        // Update gallery if provided
        string memory galleryJson = JSONUtils.parseJsonField(detailsJson, "gallery");
        if (bytes(galleryJson).length > 0) {
            string[] memory imageUrls = JSONUtils.parseJsonArrayToStringArray(galleryJson);
            if (imageUrls.length > 0) {
                delete metadata.galleryImages;
                for (uint i = 0; i < imageUrls.length; i++) {
                    if (bytes(imageUrls[i]).length > 0) {
                        metadata.galleryImages.push(imageUrls[i]);
                    }
                }
                emit TokenGalleryUpdated(tokenId);
            }
        }

        // Update custom metadata for complex properties
        string memory propertiesJson = JSONUtils.parseJsonField(detailsJson, "properties");
        if (bytes(propertiesJson).length > 0) {
            metadata.customMetadata = propertiesJson;
            emit TokenCustomMetadataUpdated(tokenId);
        }
    }

    /**
     * @dev Internal function to parse JSON and set traits in DeedNFT
     */
    function _parseAndSetTraits(uint256 tokenId, string memory json) internal {
        string[] memory keys = JSONUtils.getJsonKeys(json);
        
        for (uint i = 0; i < keys.length; i++) {
            string memory key = keys[i];
            
            // Skip standard metadata fields
            if (_isStandardMetadataField(key)) continue;
            
            string memory value = JSONUtils.parseJsonField(json, key);
            if (bytes(value).length > 0) {
                bytes32 traitKey = keccak256(bytes(key));
                
                // Handle boolean values
                if (keccak256(bytes(value)) == keccak256(bytes("true")) || 
                    keccak256(bytes(value)) == keccak256(bytes("false"))) {
                    deedNFT.setTrait(tokenId, traitKey, abi.encode(_stringToBool(value)));
                } else {
                    deedNFT.setTrait(tokenId, traitKey, abi.encode(value));
                }
            }
        }
    }

    /**
     * @dev Checks if a field is a standard metadata field
     * @param field Field name to check
     * @return Whether the field is a standard metadata field
     */
    function _isStandardMetadataField(string memory field) internal pure returns (bool) {
        bytes32 fieldHash = keccak256(bytes(field));
        
        // Standard metadata fields that should not be treated as traits
        bytes32[] memory standardFields = new bytes32[](7);
        standardFields[0] = keccak256(bytes("name"));
        standardFields[1] = keccak256(bytes("description"));
        standardFields[2] = keccak256(bytes("image"));
        standardFields[3] = keccak256(bytes("background_color"));
        standardFields[4] = keccak256(bytes("animation_url"));
        standardFields[5] = keccak256(bytes("gallery"));
        standardFields[6] = keccak256(bytes("properties"));
        
        for (uint i = 0; i < standardFields.length; i++) {
            if (fieldHash == standardFields[i]) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * @dev Helper function to convert a string to a boolean
     * @param value String value to convert
     * @return Boolean representation of the string
     */
    function _stringToBool(string memory value) internal pure returns (bool) {
        bytes memory b = bytes(value);
        return (b.length > 0 && (b[0] == 't' || b[0] == 'T' || b[0] == '1'));
    }

    /**
     * @dev Gets all trait keys for a token
     * @param tokenId ID of the token
     * @return Array of trait keys
     */
    function _getTraitKeys(uint256 tokenId) internal view returns (string[] memory) {
        // Get all trait keys from DeedNFT
        bytes32[] memory traitKeys = deedNFT.getTraitKeys(tokenId);
        string[] memory keys = new string[](traitKeys.length);
        
        // Convert bytes32 keys to strings using DeedNFT's getTraitName
        for (uint i = 0; i < traitKeys.length; i++) {
            keys[i] = deedNFT.getTraitName(traitKeys[i]);
        }
        
        return keys;
    }

    /**
     * @dev Initializes metadata from IPFS hash if not already initialized
     * @param tokenId ID of the token
     * @param tokenContract Address of the token contract
     */
    function _initializeMetadataIfNeeded(uint256 tokenId, address tokenContract) internal {
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        
        // Only initialize if we don't have a name yet
        if (bytes(metadata.name).length == 0) {
            string memory ipfsDetailsHash = IDeedNFT(tokenContract).tokenURI(tokenId);
            if (bytes(ipfsDetailsHash).length > 0) {
                // In a real implementation, this would fetch the metadata from IPFS
                // For now, we'll just emit an event and let the off-chain process handle it
                emit MetadataInitialized(tokenId, ipfsDetailsHash);
                
                // Parse and set traits from IPFS hash
                _parseAndSetTraits(tokenId, ipfsDetailsHash);
            }
        }
    }

    /**
     * @dev Modifier to check if the caller is the owner or a validator
     */
    modifier onlyOwnerOrValidator(uint256 tokenId) {
        if (!(msg.sender == owner() || 
            (address(deedNFT) != address(0) && deedNFT.hasRole(VALIDATOR_ROLE, msg.sender)) ||
            (address(deedNFT) != address(0) && deedNFT.ownerOf(tokenId) == msg.sender))) {
            revert Unauthorized();
        }
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
     * @dev Generates name for a token based on asset type and traits
     */
    function _generateName(uint256 tokenId, uint8 assetType) internal view returns (string memory) {
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        if (bytes(metadata.name).length > 0) return metadata.name;
        
        bytes memory cityBytes = deedNFT.getTraitValue(tokenId, keccak256("city"));
        bytes memory streetNumBytes = deedNFT.getTraitValue(tokenId, keccak256("streetNumber"));
        bytes memory streetNameBytes = deedNFT.getTraitValue(tokenId, keccak256("streetName"));
        bytes memory parcelNumBytes = deedNFT.getTraitValue(tokenId, keccak256("parcelNumber"));
        
        string memory city = cityBytes.length > 0 ? abi.decode(cityBytes, (string)) : "";
        string memory streetNum = streetNumBytes.length > 0 ? abi.decode(streetNumBytes, (string)) : "";
        string memory streetName = streetNameBytes.length > 0 ? abi.decode(streetNameBytes, (string)) : "";
        string memory parcelNum = parcelNumBytes.length > 0 ? abi.decode(parcelNumBytes, (string)) : "";
        
        if (assetType == uint8(IDeedNFT.AssetType.Land)) {
            if (bytes(streetNum).length > 0 && bytes(streetName).length > 0) {
                return string(abi.encodePacked(streetNum, " ", streetName, " - Land"));
            }
            if (bytes(parcelNum).length > 0) {
                return string(abi.encodePacked("Parcel #", parcelNum, " - Land"));
            }
            if (bytes(city).length > 0) {
                return string(abi.encodePacked(city, " Land #", tokenId.toString()));
            }
        }
        
        if (assetType == uint8(IDeedNFT.AssetType.Vehicle)) {
            bytes memory makeBytes = deedNFT.getTraitValue(tokenId, keccak256("make"));
            bytes memory modelBytes = deedNFT.getTraitValue(tokenId, keccak256("model"));
            bytes memory yearBytes = deedNFT.getTraitValue(tokenId, keccak256("year"));
            
            string memory make = makeBytes.length > 0 ? abi.decode(makeBytes, (string)) : "";
            string memory model = modelBytes.length > 0 ? abi.decode(modelBytes, (string)) : "";
            string memory year = yearBytes.length > 0 ? abi.decode(yearBytes, (string)) : "";
            
            if (bytes(make).length > 0 && bytes(model).length > 0) {
                return string(abi.encodePacked(year, " ", make, " ", model));
            }
        }
        
        return string(abi.encodePacked(_assetTypeToString(assetType), " #", tokenId.toString()));
    }
    
    /**
     * @dev Generates gallery JSON for a token
     */
    function _generateGallery(uint256 tokenId) internal view returns (string memory) {
        string[] memory images = tokenMetadata[tokenId].galleryImages;
        if (images.length == 0) return "";
        string memory g = '"gallery":[';
        for (uint i = 0; i < images.length; i++) {
            g = string(abi.encodePacked(g, i > 0 ? ',"' : '"', images[i], '"'));
        }
        return string(abi.encodePacked(g, ']'));
    }
    
    /**
     * @dev Generates attributes for a token
     */
    function _generateAttributes(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        bytes32[] memory traitKeys = deedNFT.getTraitKeys(tokenId);
        string[] memory parts = new string[](traitKeys.length + 3);
        uint256 count;
        
        parts[count++] = JSONUtils.createTrait("Type", _assetTypeToString(assetType));
        parts[count++] = JSONUtils.createTrait("Status", isValidated ? "Valid" : "Invalid");
        
        if (address(deedNFT) != address(0)) {
            try IDeedNFT(deedNFT).ownerOf(tokenId) returns (address owner) {
                parts[count++] = JSONUtils.createTrait("Owner", address(owner).toHexString());
            } catch {}
        }
        
        for (uint i = 0; i < traitKeys.length; i++) {
            bytes memory value = deedNFT.getTraitValue(tokenId, traitKeys[i]);
            string memory name = deedNFT.getTraitName(traitKeys[i]);
            
            if (value.length == 32) {
                bool decoded;
                assembly { decoded := mload(add(value, 32)) }
                parts[count++] = JSONUtils.createTrait(name, decoded ? "true" : "false");
            } else {
                string memory str = abi.decode(value, (string));
                if (bytes(str).length > 0) {
                    parts[count++] = JSONUtils.createTrait(name, str);
                }
            }
        }
        
        string memory attrs;
        for (uint i = 0; i < count; i++) {
            attrs = string(abi.encodePacked(attrs, i > 0 ? "," : "", parts[i]));
        }
        return attrs;
    }
    
    /**
     * @dev Gets all boolean trait keys for a token
     * @param tokenId ID of the token
     * @return Array of boolean trait keys
     */
    function _getBoolTraitKeys(uint256 tokenId) internal view returns (string[] memory) {
        bytes32[] memory keys = deedNFT.getTraitKeys(tokenId);
        uint256 count;
        
        for (uint i = 0; i < keys.length; i++) {
            bytes memory value = deedNFT.getTraitValue(tokenId, keys[i]);
            if (value.length == 32) {
                bool decoded;
                assembly { decoded := mload(add(value, 32)) }
                if (decoded) count++;
            }
        }
        
        string[] memory boolTraits = new string[](count);
        uint256 j;
        
        for (uint i = 0; i < keys.length; i++) {
            bytes memory value = deedNFT.getTraitValue(tokenId, keys[i]);
            if (value.length == 32) {
                bool decoded;
                assembly { decoded := mload(add(value, 32)) }
                if (decoded) {
                    boolTraits[j++] = deedNFT.getTraitName(keys[i]);
                }
            }
        }
        
        return boolTraits;
    }
    
    /**
     * @dev Generates properties for a token
     */
    function _generateProperties(uint256 tokenId, uint8 assetType, string memory def, string memory cfg) internal view returns (string memory) {
        TokenMetadata storage m = tokenMetadata[tokenId];
        string memory props = string(abi.encodePacked('{"asset_type":"', _assetTypeToString(assetType), '"'));
        
        if (bytes(def).length > 0) props = string(abi.encodePacked(props, ',"definition":', def));
        if (bytes(cfg).length > 0) props = string(abi.encodePacked(props, ',"configuration":', cfg));
        
        string memory custom = m.customMetadata;
        if (bytes(custom).length > 0) {
            if (bytes(custom)[0] == '{' && bytes(custom)[bytes(custom).length - 1] == '}') {
                bytes memory result = new bytes(bytes(custom).length - 2);
                for (uint i = 1; i < bytes(custom).length - 1; i++) {
                    result[i - 1] = bytes(custom)[i];
                }
                custom = string(result);
            }
            props = string(abi.encodePacked(props, ',', custom));
        }
        
        return string(abi.encodePacked(props, '}'));
    }

    /**
     * @dev Generates JSON metadata for a token
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
        return string(
            abi.encodePacked(
                '{"name":"', name,
                '","description":"', description,
                '","image":"', imageURI,
                '","token_id":"', StringsUpgradeable.toString(tokenId), '"',
                ',"attributes":[', attributes,
                '],"properties":', properties,
                bytes(gallery).length > 0 ? string(abi.encodePacked(',"gallery":', gallery)) : "",
                bytes(backgroundColor).length > 0 ? string(abi.encodePacked(',"background_color":"', backgroundColor, '"')) : "",
                bytes(animationUrl).length > 0 ? string(abi.encodePacked(',"animation_url":"', animationUrl, '"')) : "",
                '}'
            )
        );
    }
    
    /**
     * @dev Gets image URI for a token
     */
    function _getImageURI(uint256 tokenId, uint8 assetType, bool isValidated) internal view returns (string memory) {
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        if (!isValidated) return invalidatedImageURI;
        if (bytes(metadata.image).length > 0) return metadata.image;
        if (metadata.galleryImages.length > 0) return metadata.galleryImages[0];
        return assetTypeImageURIs[assetType];
    }
    
    /**
     * @dev Generates token URI for a specific token
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return URI for the token metadata
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        if (!isCompatibleDeedContract(tokenContract)) revert Invalid();
        
        bytes memory assetTypeBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("assetType"));
        if (assetTypeBytes.length == 0) return "";
        
        uint256 assetTypeValue = abi.decode(assetTypeBytes, (uint256));
        uint8 assetType = uint8(assetTypeValue);
        
        (bool isValidated,) = IDeedNFT(tokenContract).getValidationStatus(tokenId);
        
        bytes memory definitionBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("definition"));
        bytes memory configBytes = IDeedNFT(tokenContract).getTraitValue(tokenId, keccak256("configuration"));
        
        string memory definition = definitionBytes.length > 0 ? abi.decode(definitionBytes, (string)) : "";
        string memory config = configBytes.length > 0 ? abi.decode(configBytes, (string)) : "";
        
        string memory name = _generateName(tokenId, assetType);
        string memory attrs = _generateAttributes(tokenId, assetType, isValidated);
        string memory props = _generateProperties(tokenId, assetType, definition, config);
        string memory gallery = _generateGallery(tokenId);
        string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
        
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        
        return _generateJSON(
            tokenId,
            name,
            definition,
            imageURI,
            metadata.background_color,
            metadata.animation_url,
            gallery,
            attrs,
            props
        );
    }
    
    /**
     * @dev Sets features for a token
     */
    function setTokenFeatures(uint256 tokenId, string[] memory features) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        
        // Create features JSON object - optimize string concatenation
        string memory featuresJson = '{"properties":{"features":[';
        for (uint i = 0; i < features.length; i++) {
            featuresJson = string(abi.encodePacked(
                featuresJson,
                i > 0 ? ',"' : '"',
                features[i],
                '"'
            ));
        }
        featuresJson = string(abi.encodePacked(featuresJson, ']}}'));
        
        // Store in custom metadata
        tokenMetadata[tokenId].customMetadata = featuresJson;
        
        emit TokenCustomMetadataUpdated(tokenId);
    }

    /**
     * @dev Gets features for a token
     */
    function getTokenFeatures(uint256 tokenId) external view returns (string[] memory) {
        string memory customMetadata = tokenMetadata[tokenId].customMetadata;
        if (bytes(customMetadata).length == 0) {
            return new string[](0);
        }
        
        // Parse features from properties
        string memory propertiesJson = JSONUtils.parseJsonField(customMetadata, "properties");
        if (bytes(propertiesJson).length == 0) {
            return new string[](0);
        }
        
        string memory featuresJson = JSONUtils.parseJsonField(propertiesJson, "features");
        if (bytes(featuresJson).length == 0) {
            return new string[](0);
        }
        
        return JSONUtils.parseJsonArrayToStringArray(featuresJson);
    }

    /**
     * @dev Sets a document for a token
     */
    function manageTokenDocument(uint256 tokenId, string memory docType, string memory documentURI, bool isRemove) external onlyOwnerOrValidator(tokenId) {
        if (!_exists(tokenId)) revert Invalid();
        if (!isRemove && bytes(docType).length == 0) revert Empty();
        
        bytes32 documentKey = keccak256(bytes(string(abi.encodePacked("document_", docType))));
        
        if (isRemove) {
            // Remove document by setting trait to empty string
            deedNFT.setTrait(tokenId, documentKey, abi.encode(""));
            
            // Remove from document types array
            string[] storage docTypes = tokenMetadata[tokenId].documentTypes;
            for (uint i = 0; i < docTypes.length; i++) {
                if (keccak256(bytes(docTypes[i])) == keccak256(bytes(docType))) {
                    docTypes[i] = docTypes[docTypes.length - 1];
                    docTypes.pop();
                    break;
                }
            }
        } else {
            // Add document
            deedNFT.setTrait(tokenId, documentKey, abi.encode(documentURI));
            
            // Add to document types if not already present
            string[] storage docTypes = tokenMetadata[tokenId].documentTypes;
            bool exists = false;
            for (uint i = 0; i < docTypes.length; i++) {
                if (keccak256(bytes(docTypes[i])) == keccak256(bytes(docType))) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                docTypes.push(docType);
            }
        }
        
        emit TokenMetadataUpdated(tokenId);
    }

    /**
     * @dev Gets a document for a token
     */
    function getTokenDocument(uint256 tokenId, string memory docType) external view returns (string memory) {
        bytes memory value = deedNFT.getTraitValue(tokenId, keccak256(bytes(string(abi.encodePacked("document_", docType)))));
        if (value.length == 0) return "";
        return abi.decode(value, (string));
    }

    /**
     * @dev Gets all document types for a token
     */
    function getTokenDocumentTypes(uint256 tokenId) external view returns (string[] memory) {
        return tokenMetadata[tokenId].documentTypes;
    }

    /**
     * @dev Internal function to add a compatible DeedNFT contract
     */
    function _addCompatibleDeedContract(address contractAddress) internal {
        if (contractAddress == address(0)) revert Invalid();
        if (compatibleDeedContracts[contractAddress]) revert Exists();
        
        // Basic interface check
        try IDeedNFT(contractAddress).supportsInterface(type(IERC721Upgradeable).interfaceId) returns (bool supported) {
            if (!supported) revert Invalid();
        } catch {
            revert Invalid();
        }
        
        compatibleDeedContracts[contractAddress] = true;
        deedContractsList.push(contractAddress);
        emit CompatibleDeedContractAdded(contractAddress);
    }

    /**
     * @dev Sets the DeedNFT contract address
     * @param _deedNFT Address of the DeedNFT contract
     */
    function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_deedNFT == address(0)) revert Invalid();
        deedNFT = IDeedNFT(_deedNFT);
        
        // Also add to compatible contracts if not already added
        if (!compatibleDeedContracts[_deedNFT]) {
            _addCompatibleDeedContract(_deedNFT);
        }
    }

    /**
     * @dev Adds or removes a compatible DeedNFT contract
     * @param contractAddress Address of the compatible DeedNFT contract
     */
    function manageCompatibleDeedContract(address contractAddress, bool isAdd) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (isAdd) {
            _addCompatibleDeedContract(contractAddress);
        } else {
            if (!compatibleDeedContracts[contractAddress]) revert Invalid();
            
            compatibleDeedContracts[contractAddress] = false;
            
            for (uint i = 0; i < deedContractsList.length; i++) {
                if (deedContractsList[i] == contractAddress) {
                    deedContractsList[i] = deedContractsList[deedContractsList.length - 1];
                    deedContractsList.pop();
                    break;
                }
            }
            
            emit CompatibleDeedContractRemoved(contractAddress);
        }
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
     * @return Whether the contract is compatible
     */
    function isCompatibleDeedContract(address) public pure returns (bool) {
        return true; // For now, all contracts are considered compatible
    }

    // Helper function to convert asset type to string
    function _assetTypeToString(uint8 t) internal pure returns (string memory) {
        return t == 0 ? "Land" : t == 1 ? "Vehicle" : t == 2 ? "Estate" : t == 3 ? "Equipment" : "Unknown";
    }

    function _validateInputs(uint256 tokenId, string memory input) internal view {
        if (!_exists(tokenId)) revert Invalid();
        if (bytes(input).length == 0) revert Empty();
    }

    /**
     * @dev Parses IPFS JSON and sets traits in DeedNFT during minting
     */
    function parseAndSetTraitsFromIPFS(
        uint256 tokenId,
        string memory ipfsHash,
        address deedNFTContract
    ) external override {
        if (bytes(ipfsHash).length == 0) revert Empty();
        IDeedNFT targetDeedNFT = IDeedNFT(deedNFTContract);

        // Parse the IPFS JSON
        string memory json = ipfsHash;  // In production, this would fetch from IPFS

        // Parse and set attributes as traits
        string memory attributesJson = JSONUtils.parseJsonField(json, "attributes");
        if (bytes(attributesJson).length > 0) {
            string[] memory attributes = JSONUtils.parseJsonArrayToStringArray(attributesJson);
            for (uint i = 0; i < attributes.length; i++) {
                string memory attr = attributes[i];
                string memory traitType = JSONUtils.parseJsonField(attr, "trait_type");
                string memory value = JSONUtils.parseJsonField(attr, "value");
                
                if (bytes(traitType).length > 0 && bytes(value).length > 0) {
                    bytes32 traitKey = keccak256(bytes(traitType));
                    targetDeedNFT.setTrait(tokenId, traitKey, abi.encode(value));
                }
            }
        }

        // Parse and set properties as traits
        string memory propertiesJson = JSONUtils.parseJsonField(json, "properties");
        if (bytes(propertiesJson).length > 0) {
            string[] memory propertyKeys = JSONUtils.getJsonKeys(propertiesJson);
            for (uint i = 0; i < propertyKeys.length; i++) {
                string memory key = propertyKeys[i];
                string memory value = JSONUtils.parseJsonField(propertiesJson, key);
                
                if (bytes(value).length > 0) {
                    bytes32 traitKey = keccak256(bytes(string(abi.encodePacked("property_", key))));
                    targetDeedNFT.setTrait(tokenId, traitKey, abi.encode(value));
                }
            }
        }

        emit TraitsParsed(tokenId, deedNFTContract);
    }
}