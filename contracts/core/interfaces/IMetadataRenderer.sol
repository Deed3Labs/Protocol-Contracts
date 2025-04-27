// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./IERC7572.sol";

/**
 * @title IMetadataRenderer
 * @dev Interface for metadata renderer contracts
 */
interface IMetadataRenderer is IERC7572 {
    // ============ Errors ============

    /// @dev Thrown when token does not exist
    error TokenDoesNotExist();

    /// @dev Thrown when caller is not authorized
    error Unauthorized();

    /// @dev Thrown when parameter is invalid
    error InvalidParameter();

    /// @dev Thrown when document type is invalid
    error InvalidDocumentType();

    /// @dev Thrown when document already exists
    error DocumentAlreadyExists();

    /// @dev Thrown when document does not exist
    error DocumentDoesNotExist();

    // ============ Events ============

    /**
     * @dev Emitted when token metadata is updated
     * @param tokenId ID of the token
     */
    event TokenMetadataUpdated(uint256 indexed tokenId);

    /**
     * @dev Emitted when token custom metadata is updated
     * @param tokenId ID of the token
     */
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);

    /**
     * @dev Emitted when token document is updated
     * @param tokenId ID of the token
     * @param documentType Type of the document
     */
    event TokenDocumentUpdated(uint256 indexed tokenId, string documentType);

    // ============ Functions ============

    /**
     * @dev Gets the metadata URI for a token
     * @param tokenId ID of the token
     * @return Metadata URI as a string
     */
    function tokenURI(uint256 tokenId) external view returns (string memory);

    /**
     * @dev Gets the contract URI
     * @return Contract URI as a string
     */
    function contractURI() external view returns (string memory);

    /**
     * @dev Manages a document for a token (add or remove)
     * @param tokenId ID of the token
     * @param documentType Type of the document
     * @param documentURI URI of the document
     * @param isRemove Whether to remove the document
     */
    function manageTokenDocument(
        uint256 tokenId,
        string calldata documentType,
        string calldata documentURI,
        bool isRemove
    ) external;

    /**
     * @dev Gets a document for a token
     * @param tokenId ID of the token
     * @param documentType Type of the document
     * @return Document URI as a string
     */
    function getTokenDocument(uint256 tokenId, string calldata documentType) external view returns (string memory);

    /**
     * @dev Gets all document types for a token
     * @param tokenId ID of the token
     * @return Array of document types
     */
    function getTokenDocumentTypes(uint256 tokenId) external view returns (string[] memory);

    /**
     * @dev Sets features for a token
     * @param tokenId ID of the token
     * @param features Array of features
     */
    function setTokenFeatures(uint256 tokenId, string[] calldata features) external;

    /**
     * @dev Gets features for a token
     * @param tokenId ID of the token
     * @return Array of features
     */
    function getTokenFeatures(uint256 tokenId) external view returns (string[] memory);

    /**
     * @dev Checks if the renderer is compatible with a contract
     * @param contractAddress Address of the contract to check
     * @return Whether the renderer is compatible
     */
    function isCompatibleWith(address contractAddress) external view returns (bool);

    /**
     * @dev Updates asset details for a token
     * @param tokenId ID of the token
     * @param assetType Type of the asset
     * @param details JSON string containing the details to update
     */
    function updateAssetDetails(uint256 tokenId, uint8 assetType, string memory details) external;
    
    /**
     * @dev Sets the token gallery
     * @param tokenId ID of the token
     * @param imageUrls Array of image URLs
     */
    function setTokenGallery(uint256 tokenId, string[] memory imageUrls) external;
    
    /**
     * @dev Gets token gallery images
     * @param tokenId ID of the token
     * @return Array of image URLs
     */
    function getTokenGallery(uint256 tokenId) external view returns (string[] memory);
    
    /**
     * @dev Sets the DeedNFT contract address
     * @param deedNFT Address of the DeedNFT contract
     */
    function setDeedNFT(address deedNFT) external;

    /**
     * @dev Checks if a contract is compatible
     * @param contractAddress Address to check
     * @return Whether the contract is compatible
     */
    function isCompatibleDeedContract(address contractAddress) external view returns (bool);

    /**
     * @dev Gets all compatible DeedNFT contracts
     * @return Array of compatible DeedNFT contract addresses
     */
    function getCompatibleDeedContracts() external view returns (address[] memory);

    /**
     * @dev Manages compatible DeedNFT contracts
     * @param contractAddress Address of the contract
     * @param isAdd Whether to add or remove the contract
     */
    function manageCompatibleDeedContract(address contractAddress, bool isAdd) external;

    /**
     * @dev Syncs trait updates from DeedNFT
     * @param tokenId ID of the token
     * @param traitKey Key of the trait that was updated
     * @param traitValue New value of the trait (empty bytes for removal)
     */
    function syncTraitUpdate(
        uint256 tokenId,
        bytes32 traitKey,
        bytes memory traitValue
    ) external;
} 