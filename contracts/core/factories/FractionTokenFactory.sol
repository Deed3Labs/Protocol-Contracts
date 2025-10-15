// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ClonesUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "../FractionToken.sol";

/**
 * @title FractionTokenFactory
 * @dev Factory contract for creating FractionToken instances using the Clone pattern
 *      This resolves the circular dependency between Fractionalize and FractionToken
 *      
 * Security:
 * - Role-based access control for factory operations
 * - Clone pattern for gas-efficient token deployment
 * - Upgradeable factory for future improvements
 * 
 * Integration:
 * - Used by Fractionalize contract to create ERC-20 tokens
 * - Implements Clone pattern for gas efficiency
 * - Supports UUPSUpgradeable for upgradability
 */
contract FractionTokenFactory is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using ClonesUpgradeable for address;

    // ============ State Variables ============

    /// @notice Implementation contract for FractionToken
    address public fractionTokenImplementation;
    
    /// @notice Reference to the Fractionalize contract
    address public fractionalizeContract;
    
    /// @notice Track all created tokens
    address[] public createdTokens;
    mapping(address => bool) public isCreatedToken;
    
    /// @notice Track tokens by fraction ID
    mapping(uint256 => address) public fractionIdToToken;

    // ============ Events ============

    /**
     * @dev Emitted when a new FractionToken is created
     * @param tokenAddress Address of the created token
     * @param fractionId ID of the fraction
     * @param name Name of the token
     * @param symbol Symbol of the token
     */
    event FractionTokenCreated(
        address indexed tokenAddress,
        uint256 indexed fractionId,
        string name,
        string symbol
    );

    /**
     * @dev Emitted when the implementation is updated
     * @param oldImplementation Previous implementation address
     * @param newImplementation New implementation address
     */
    event ImplementationUpdated(address indexed oldImplementation, address indexed newImplementation);

    // ============ Constructor & Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the factory with required parameters
     * @param _fractionalizeContract Address of the Fractionalize contract
     */
    function initialize(address _fractionalizeContract) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        require(_fractionalizeContract != address(0), "Invalid fractionalize contract");
        fractionalizeContract = _fractionalizeContract;

        // Deploy the implementation contract
        FractionToken implementation = new FractionToken();
        fractionTokenImplementation = address(implementation);
    }

    // ============ Factory Functions ============

    /**
     * @notice Creates a new FractionToken using the clone pattern
     * @dev Only callable by the Fractionalize contract
     * @param fractionId ID of the fraction this token represents
     * @param name Name of the token
     * @param symbol Symbol of the token
     * @param maxSharesPerWallet Maximum shares per wallet
     * @param burnable Whether burning is enabled
     * @return tokenAddress Address of the created token
     */
    function createFractionToken(
        uint256 fractionId,
        string memory name,
        string memory symbol,
        uint256 maxSharesPerWallet,
        bool burnable
    ) external returns (address tokenAddress) {
        require(msg.sender == fractionalizeContract, "Only fractionalize contract");
        require(fractionIdToToken[fractionId] == address(0), "Token already exists for fraction");
        require(bytes(name).length > 0, "Name required");
        require(bytes(symbol).length > 0, "Symbol required");

        // Create clone of the implementation
        address clone = fractionTokenImplementation.clone();
        
        // Initialize the clone
        FractionToken token = FractionToken(clone);
        token.initialize(
            name,
            symbol,
            fractionalizeContract,
            fractionId,
            maxSharesPerWallet,
            burnable
        );

        // Track the created token
        createdTokens.push(clone);
        isCreatedToken[clone] = true;
        fractionIdToToken[fractionId] = clone;

        emit FractionTokenCreated(clone, fractionId, name, symbol);
        return clone;
    }

    // ============ View Functions ============

    /**
     * @notice Returns the number of created tokens
     * @return Number of created tokens
     */
    function getCreatedTokenCount() external view returns (uint256) {
        return createdTokens.length;
    }

    /**
     * @notice Returns all created tokens
     * @return Array of created token addresses
     */
    function getAllCreatedTokens() external view returns (address[] memory) {
        return createdTokens;
    }

    /**
     * @notice Returns the token address for a given fraction ID
     * @param fractionId ID of the fraction
     * @return tokenAddress Address of the token, or address(0) if not found
     */
    function getTokenByFractionId(uint256 fractionId) external view returns (address tokenAddress) {
        return fractionIdToToken[fractionId];
    }

    /**
     * @notice Checks if an address is a created token
     * @param tokenAddress Address to check
     * @return Whether the address is a created token
     */
    function isToken(address tokenAddress) external view returns (bool) {
        return isCreatedToken[tokenAddress];
    }

    // ============ Admin Functions ============

    /**
     * @notice Updates the implementation contract
     * @dev Only callable by the owner
     * @param newImplementation Address of the new implementation
     */
    function updateImplementation(address newImplementation) external onlyOwner {
        require(newImplementation != address(0), "Invalid implementation");
        require(newImplementation != fractionTokenImplementation, "Same implementation");
        
        address oldImplementation = fractionTokenImplementation;
        fractionTokenImplementation = newImplementation;
        
        emit ImplementationUpdated(oldImplementation, newImplementation);
    }

    /**
     * @notice Updates the Fractionalize contract reference
     * @dev Only callable by the owner
     * @param newFractionalizeContract Address of the new Fractionalize contract
     */
    function updateFractionalizeContract(address newFractionalizeContract) external onlyOwner {
        require(newFractionalizeContract != address(0), "Invalid fractionalize contract");
        fractionalizeContract = newFractionalizeContract;
    }

    // ============ Upgrade Functions ============

    /**
     * @dev Authorizes the contract upgrade
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {
        // Authorization logic handled by onlyOwner modifier
    }
}
