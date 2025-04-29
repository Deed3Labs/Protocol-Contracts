// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IMetadataRenderer
 * @dev Interface for metadata renderer contracts
 */
interface IMetadataRenderer {
    // ============ Errors ============

    /// @dev Thrown when caller lacks necessary permissions
    error Unauthorized();

    /// @dev Thrown when a parameter is invalid (includes token ID, JSON, contract, address validation)
    error Invalid();

    /// @dev Thrown when a required input parameter is empty
    error Empty();

    /// @dev Thrown when attempting to add an item that already exists
    error Exists();

    // ============ Events ============

    /**
     * @dev Emitted when token metadata is updated
     * @param tokenId ID of the token
     */
    event TokenMetadataUpdated(uint256 indexed tokenId);

    /**
     * @dev Emitted when token gallery is updated
     * @param tokenId ID of the token
     */
    event TokenGalleryUpdated(uint256 indexed tokenId);

    /**
     * @dev Emitted when token custom metadata is updated
     * @param tokenId ID of the token
     */
    event TokenCustomMetadataUpdated(uint256 indexed tokenId);

    /**
     * @dev Emitted when a compatible deed contract is added
     * @param contractAddress Address of the added contract
     */
    event CompatibleDeedContractAdded(address indexed contractAddress);

    /**
     * @dev Emitted when a compatible deed contract is removed
     * @param contractAddress Address of the removed contract
     */
    event CompatibleDeedContractRemoved(address indexed contractAddress);

    /**
     * @dev Emitted when metadata is initialized for a token
     * @param tokenId ID of the token
     * @param ipfsHash IPFS hash of the metadata
     */
    event MetadataInitialized(uint256 indexed tokenId, string ipfsHash);

    /**
     * @dev Emitted when a trait is synced from DeedNFT
     * @param tokenId ID of the token
     * @param traitKey Key of the trait
     * @param value New value of the trait
     */
    event MetadataSynced(uint256 indexed tokenId, bytes32 indexed traitKey, bytes value);

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
     * @param docType Type of the document
     * @param documentURI URI of the document
     * @param isRemove Whether to remove the document
     */
    function manageTokenDocument(
        uint256 tokenId,
        string calldata docType,
        string calldata documentURI,
        bool isRemove
    ) external;

    /**
     * @dev Gets a document for a token
     * @param tokenId ID of the token
     * @param docType Type of the document
     * @return Document URI as a string
     */
    function getTokenDocument(uint256 tokenId, string calldata docType) external view returns (string memory);

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
     * @dev Sets condition information for an asset
     * @param tokenId ID of the token
     * @param generalCondition General condition rating
     * @param lastInspectionDate Date of last inspection
     * @param knownIssues Array of known issues
     * @param improvements Array of improvements
     * @param additionalNotes Additional notes about condition
     */
    function setAssetCondition(
        uint256 tokenId,
        string memory generalCondition,
        string memory lastInspectionDate,
        string[] memory knownIssues,
        string[] memory improvements,
        string memory additionalNotes
    ) external;

    /**
     * @dev Gets condition information for an asset
     * @param tokenId ID of the token
     * @return generalCondition General condition rating
     * @return lastInspectionDate Last inspection date
     * @return knownIssues Array of known issues
     * @return improvements Array of improvements
     * @return additionalNotes Additional notes
     */
    function getAssetCondition(uint256 tokenId) external view returns (
        string memory generalCondition,
        string memory lastInspectionDate,
        string[] memory knownIssues,
        string[] memory improvements,
        string memory additionalNotes
    );

    /**
     * @dev Sets legal information for a token
     * @param tokenId ID of the token
     * @param jurisdiction Legal jurisdiction
     * @param registrationNumber Registration number
     * @param registrationDate Registration date
     * @param documents Array of legal documents
     * @param restrictions Array of legal restrictions
     * @param additionalInfo Additional legal information
     */
    function setTokenLegalInfo(
        uint256 tokenId,
        string memory jurisdiction,
        string memory registrationNumber,
        string memory registrationDate,
        string[] memory documents,
        string[] memory restrictions,
        string memory additionalInfo
    ) external;

    /**
     * @dev Gets legal information for a token
     * @param tokenId ID of the token
     * @return jurisdiction Legal jurisdiction
     * @return registrationNumber Registration number
     * @return registrationDate Registration date
     * @return documents Array of legal documents
     * @return restrictions Array of legal restrictions
     * @return additionalInfo Additional legal information
     */
    function getTokenLegalInfo(uint256 tokenId) external view returns (
        string memory jurisdiction,
        string memory registrationNumber,
        string memory registrationDate,
        string[] memory documents,
        string[] memory restrictions,
        string memory additionalInfo
    );

    /**
     * @dev Sets custom metadata for a token
     * @param tokenId ID of the token
     * @param metadata Custom metadata JSON string
     */
    function setTokenCustomMetadata(uint256 tokenId, string memory metadata) external;

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