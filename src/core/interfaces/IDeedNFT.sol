// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IDeedNFT
 * @dev Interface for the DeedNFT contract.
 *      Provides a standardized way for other contracts to interact with DeedNFT.
 *      Consolidates functionality needed by FundManager, Fractionalize, and Subdivide contracts.
 */
interface IDeedNFT {
    // ============ Enums ============
    
    /**
     * @dev Types of assets that can be represented as deeds
     */
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }

    // ============ Events ============
    
    /**
     * @dev Emitted when a new deed is minted
     * @param tokenId ID of the minted deed
     * @param assetType Type of the asset
     * @param minter Address that minted the deed
     * @param validator Address of the validator
     */
    event DeedNFTMinted(uint256 indexed tokenId, AssetType assetType, address indexed minter, address indexed validator);
    
    /**
     * @dev Emitted when a deed is validated
     * @param tokenId ID of the validated deed
     * @param isValid Whether the deed is valid
     * @param validator Address of the validator
     */
    event TokenValidated(uint256 indexed tokenId, bool isValid, address indexed validator);
    
    /**
     * @dev Emitted when a deed is burned
     * @param tokenId ID of the burned deed
     */
    event DeedNFTBurned(uint256 indexed tokenId);
    
    /**
     * @dev Emitted when the contract URI is updated
     * @param newURI New contract URI
     */
    event ContractURIUpdated(string newURI);

    // ============ View Functions ============
    
    /**
     * @dev Returns the owner of a specific token
     * @param tokenId ID of the token to query
     * @return Address of the token owner
     */
    function ownerOf(uint256 tokenId) external view returns (address);
    
    /**
     * @dev Checks if a token exists
     * @param tokenId ID of the token to check
     * @return Boolean indicating if the token exists
     */
    function _exists(uint256 tokenId) external view returns (bool);
    
    /**
     * @dev Checks if a deed can be subdivided
     * @param tokenId ID of the deed to check
     * @return Boolean indicating if the deed can be subdivided
     */
    function canSubdivide(uint256 tokenId) external view returns (bool);
    
    /**
     * @dev Gets comprehensive information about a deed
     * @param tokenId ID of the deed to query
     * @return assetType Type of the asset
     * @return isValidated Whether the deed has been validated
     * @return operatingAgreement Operating agreement URI
     * @return definition Definition of the deed
     * @return configuration Configuration of the deed
     * @return validator Address of the validator
     */
    function getDeedInfo(uint256 tokenId) external view returns (
        AssetType assetType,
        bool isValidated,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration,
        address validator
    );
    
    /**
     * @dev Gets the URI for a specific token
     * @param tokenId ID of the token to query
     * @return URI string for the token metadata
     */
    function tokenURI(uint256 tokenId) external view returns (string memory);
    
    /**
     * @dev Gets the value of a trait for a specific token
     * @param tokenId ID of the token
     * @param traitKey Key of the trait to query
     * @return Trait value as bytes
     */
    function getTraitValue(uint256 tokenId, bytes32 traitKey) external view returns (bytes memory);
    
    /**
     * @dev Returns the validation status of a token
     * @param tokenId ID of the token
     * @return isValidated Whether the token is validated
     * @return validator Address of the validator that validated the token
     */
    function getValidationStatus(uint256 tokenId) external view returns (bool isValidated, address validator);
    
    /**
     * @dev Gets the contract URI
     * @return URI string for the contract metadata
     */
    function contractURI() external view returns (string memory);
    
    // ============ Transfer Functions ============
    
    /**
     * @dev Transfers a token between addresses
     * @param from Address sending the token
     * @param to Address receiving the token
     * @param tokenId ID of the token to transfer
     */
    function transferFrom(address from, address to, uint256 tokenId) external;
    
    /**
     * @dev Safely transfers a token between addresses
     * @param from Address sending the token
     * @param to Address receiving the token
     * @param tokenId ID of the token to transfer
     */
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    
    // ============ Minting Functions ============
    
    /**
     * @dev Mints a new deed asset
     * @param owner Address that will own the new deed
     * @param assetType Type of asset being minted
     * @param ipfsDetailsHash IPFS hash containing detailed metadata
     * @param definition Definition of the deed
     * @param configuration Configuration of the deed
     * @param validatorAddress Address of the validator to use (or address(0) for default)
     * @return The ID of the minted deed
     */
    function mintAsset(
        address owner,
        AssetType assetType,
        string memory ipfsDetailsHash,
        string memory definition,
        string memory configuration,
        address validatorAddress
    ) external returns (uint256);
    
    /**
     * @dev Mints a new deed asset with operating agreement
     * @param owner Address that will own the new deed
     * @param assetType Type of asset being minted
     * @param ipfsDetailsHash IPFS hash containing detailed metadata
     * @param operatingAgreement Operating agreement URI
     * @param definition Definition of the deed
     * @param configuration Configuration of the deed
     * @return The ID of the minted deed
     */
    function mintAsset(
        address owner,
        AssetType assetType,
        string memory ipfsDetailsHash,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration
    ) external returns (uint256);
    
    // ============ Burning Functions ============
    
    /**
     * @dev Burns a deed asset
     * @param tokenId ID of the deed to burn
     */
    function burnAsset(uint256 tokenId) external;
    
    /**
     * @dev Burns multiple deed assets
     * @param tokenIds Array of deed IDs to burn
     */
    function burnBatchAssets(uint256[] memory tokenIds) external;
    
    // ============ Validation Functions ============
    
    /**
     * @dev Updates the validation status of a token
     * @param tokenId ID of the token to validate
     * @param isValid Whether the token is valid
     * @param validatorAddress Address of the validator
     */
    function validateDeed(uint256 tokenId, bool isValid, address validatorAddress) external;
    
    // ============ Access Control Functions ============
    
    /**
     * @dev Checks if an account has a specific role
     * @param role Role identifier
     * @param account Account to check
     * @return Boolean indicating if the account has the role
     */
    function hasRole(bytes32 role, address account) external view returns (bool);
} 