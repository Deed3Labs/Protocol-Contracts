// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./interfaces/IERC7572.sol";
import "./interfaces/IMetadataRenderer.sol";
import "./interfaces/IDeedNFT.sol";

/**
 * @title MetadataRendererProxy
 * @dev Proxy contract that delegates calls to specialized metadata renderers based on asset type
 */
contract MetadataRendererProxy is Initializable, OwnableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable, IERC7572 {
    // ============ Role Definitions ============
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    
    // ============ State Variables ============
    // Mapping of asset type to renderer implementation
    mapping(uint8 => address) public renderers;
    
    // DeedNFT contract
    IDeedNFT public deedNFT;
    
    // ============ Events ============
    event RendererSet(uint8 indexed assetType, address indexed renderer);
    event DeedNFTSet(address indexed deedNFT);
    
    // ============ Initializer ============
    function initialize() public initializer {
        __Ownable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    // ============ Admin Functions ============
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
    
    /**
     * @dev Sets the renderer for a specific asset type
     * @param assetType Type of asset
     * @param renderer Address of the renderer contract
     */
    function setRenderer(uint8 assetType, address renderer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(renderer != address(0), "MetadataRendererProxy: Invalid renderer address");
        
        // Verify the renderer implements the IMetadataRenderer interface
        try IMetadataRenderer(renderer).supportsInterface(type(IERC7572).interfaceId) returns (bool supported) {
            require(supported, "MetadataRendererProxy: Renderer does not implement IERC7572");
        } catch {
            revert("MetadataRendererProxy: Renderer does not implement IMetadataRenderer interface");
        }
        
        renderers[assetType] = renderer;
        emit RendererSet(assetType, renderer);
    }
    
    /**
     * @dev Sets the DeedNFT contract address
     * @param _deedNFT Address of the DeedNFT contract
     */
    function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_deedNFT != address(0), "MetadataRendererProxy: Invalid DeedNFT address");
        deedNFT = IDeedNFT(_deedNFT);
        
        // Also set the DeedNFT address in all renderers
        for (uint8 i = 0; i < 4; i++) { // Assuming 4 asset types (0-3)
            if (renderers[i] != address(0)) {
                try IMetadataRenderer(renderers[i]).setDeedNFT(_deedNFT) {} catch {}
            }
        }
        
        emit DeedNFTSet(_deedNFT);
    }
    
    // ============ View Functions ============
    /**
     * @dev Gets the renderer for a specific asset type
     * @param assetType Type of asset
     * @return Address of the renderer contract
     */
    function getRenderer(uint8 assetType) public view returns (address) {
        return renderers[assetType];
    }
    
    /**
     * @dev Gets the asset type for a token
     * @param tokenId ID of the token
     * @return Type of asset
     */
    function getAssetType(uint256 tokenId) public view returns (uint8) {
        require(address(deedNFT) != address(0), "MetadataRendererProxy: DeedNFT not set");
        
        try deedNFT.getAssetType(tokenId) returns (uint8 assetType) {
            return assetType;
        } catch {
            revert("MetadataRendererProxy: Failed to get asset type");
        }
    }
    
    // ============ Proxy Functions ============
    /**
     * @dev Generates token URI for a specific token
     * @param tokenId ID of the token
     * @return URI for the token metadata
     */
    function tokenURI(uint256 tokenId) public view returns (string memory) {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        return IMetadataRenderer(renderer).tokenURI(address(deedNFT), tokenId);
    }
    
    /**
     * @dev Implements IERC7572.tokenURI
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return URI for the token metadata
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view override returns (string memory) {
        require(tokenContract == address(deedNFT), "MetadataRendererProxy: Unsupported token contract");
        
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        return IMetadataRenderer(renderer).tokenURI(tokenContract, tokenId);
    }
    
    /**
     * @dev Updates asset details for a token
     * @param tokenId ID of the token
     * @param details JSON string containing the details to update
     */
    function updateAssetDetails(uint256 tokenId, string memory details) external {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        IMetadataRenderer(renderer).updateAssetDetails(tokenId, assetType, details);
    }
    
    /**
     * @dev Sets the token gallery
     * @param tokenId ID of the token
     * @param imageUrls Array of image URLs
     */
    function setTokenGallery(uint256 tokenId, string[] memory imageUrls) external {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        IMetadataRenderer(renderer).setTokenGallery(tokenId, imageUrls);
    }
    
    /**
     * @dev Gets token gallery images
     * @param tokenId ID of the token
     * @return Array of image URLs
     */
    function getTokenGallery(uint256 tokenId) external view returns (string[] memory) {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        return IMetadataRenderer(renderer).getTokenGallery(tokenId);
    }
    
    /**
     * @dev Sets features for a token
     * @param tokenId ID of the token
     * @param features Array of feature strings
     */
    function setTokenFeatures(uint256 tokenId, string[] memory features) external {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        IMetadataRenderer(renderer).setTokenFeatures(tokenId, features);
    }
    
    /**
     * @dev Gets features for a token
     * @param tokenId ID of the token
     * @return Array of feature strings
     */
    function getTokenFeatures(uint256 tokenId) external view returns (string[] memory) {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        return IMetadataRenderer(renderer).getTokenFeatures(tokenId);
    }
    
    /**
     * @dev Sets a document for a token
     * @param tokenId ID of the token
     * @param docType Type of document
     * @param documentURI URI of the document
     */
    function setTokenDocument(uint256 tokenId, string memory docType, string memory documentURI) external {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        IMetadataRenderer(renderer).setTokenDocument(tokenId, docType, documentURI);
    }
    
    /**
     * @dev Gets a document for a token
     * @param tokenId ID of the token
     * @param docType Type of document
     * @return URI of the document
     */
    function getTokenDocument(uint256 tokenId, string memory docType) external view returns (string memory) {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        return IMetadataRenderer(renderer).getTokenDocument(tokenId, docType);
    }
    
    /**
     * @dev Gets all document types for a token
     * @param tokenId ID of the token
     * @return Array of document type strings
     */
    function getTokenDocumentTypes(uint256 tokenId) external view returns (string[] memory) {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        return IMetadataRenderer(renderer).getTokenDocumentTypes(tokenId);
    }
    
    /**
     * @dev Sets multiple documents for a token
     * @param tokenId ID of the token
     * @param docTypes Array of document types
     * @param documentURIs Array of document URIs
     */
    function setTokenDocuments(uint256 tokenId, string[] memory docTypes, string[] memory documentURIs) external {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        IMetadataRenderer(renderer).setTokenDocuments(tokenId, docTypes, documentURIs);
    }
    
    /**
     * @dev Removes a document from a token
     * @param tokenId ID of the token
     * @param docType Type of document to remove
     */
    function removeTokenDocument(uint256 tokenId, string memory docType) external {
        uint8 assetType = getAssetType(tokenId);
        address renderer = getRenderer(assetType);
        require(renderer != address(0), "MetadataRendererProxy: No renderer for asset type");
        
        IMetadataRenderer(renderer).removeTokenDocument(tokenId, docType);
    }
    
    /**
     * @dev Implementation of supportsInterface
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable, IERC165Upgradeable) returns (bool) {
        return interfaceId == type(IERC7572).interfaceId || 
               super.supportsInterface(interfaceId);
    }
}