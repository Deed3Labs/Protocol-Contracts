// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// OpenZeppelin Upgradeable Contracts
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

// Core Contracts
import "../Validator.sol";
import "../interfaces/IValidatorRegistry.sol";
import "../interfaces/IFundManager.sol";

/**
 * @title ValidatorFactory
 * @dev Factory contract for creating and initializing Validator contracts
 *      with standardized parameters and configurations.
 */
contract ValidatorFactory is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    // ============ Constants ============
    uint256 public constant BASIS_POINTS = 10000; // 100%
    uint256 public constant MAX_ROYALTY_PERCENTAGE = 5; // 5%
    uint256 public constant MAX_ROYALTY_BASIS_POINTS = 500; // 5% in basis points

    // ============ State Variables ============
    IValidatorRegistry public validatorRegistry;
    IFundManager public fundManager;
    
    // Track all created validators
    address[] public validators;
    mapping(address => bool) public isValidator;
    
    // Default whitelisted tokens
    address[] public defaultWhitelistedTokens;
    mapping(address => bool) public isDefaultWhitelisted;
    
    // ============ Events ============
    event ValidatorCreated(
        address indexed validator,
        string name,
        uint96 royaltyFeePercentage,
        address[] tokens,
        uint256 serviceFee
    );

    event TokenWhitelisted(address indexed token);
    event TokenRemovedFromWhitelist(address indexed token);

    // ============ Constructor ============
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============
    /**
     * @dev Initializes the ValidatorFactory contract
     * @param _validatorRegistry Address of the ValidatorRegistry contract
     * @param _fundManager Address of the FundManager contract
     * @param _defaultTokens Array of default whitelisted token addresses
     */
    function initialize(
        address _validatorRegistry,
        address _fundManager,
        address[] memory _defaultTokens
    ) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        require(_validatorRegistry != address(0), "Invalid validator registry");
        require(_fundManager != address(0), "Invalid fund manager");

        validatorRegistry = IValidatorRegistry(_validatorRegistry);
        fundManager = IFundManager(_fundManager);

        // Initialize default whitelisted tokens
        for (uint256 i = 0; i < _defaultTokens.length; i++) {
            require(_defaultTokens[i] != address(0), "Invalid token address");
            defaultWhitelistedTokens.push(_defaultTokens[i]);
            isDefaultWhitelisted[_defaultTokens[i]] = true;
        }
    }

    // ============ Factory Functions ============
    /**
     * @dev Creates a new validator with specified parameters
     * @param name Name of the validator
     * @param description Description of the validator
     * @param supportedAssetTypes Array of supported asset types
     * @param royaltyFeePercentage Royalty fee percentage (e.g., 2.5 for 2.5%)
     * @param serviceFee Service fee amount to apply to all whitelisted tokens
     * @param baseUri Base URI for token metadata
     * @param operatingAgreementUri Operating agreement URI
     * @return Address of the created validator
     */
    function createValidator(
        string memory name,
        string memory description,
        uint256[] memory supportedAssetTypes,
        uint256 royaltyFeePercentage,
        uint256 serviceFee,
        string memory baseUri,
        string memory operatingAgreementUri
    ) external returns (address) {
        // Convert royalty fee to basis points
        uint96 royaltyFeeBasisPoints = convertToBasisPoints(royaltyFeePercentage);
        require(royaltyFeeBasisPoints <= MAX_ROYALTY_BASIS_POINTS, "Royalty fee too high"); // Max 5%
        require(bytes(baseUri).length > 0, "Base URI cannot be empty");
        require(bytes(operatingAgreementUri).length > 0, "Operating agreement URI cannot be empty");
        require(supportedAssetTypes.length > 0, "Must support at least one asset type");
        require(defaultWhitelistedTokens.length > 0, "No whitelisted tokens available");
        
        // Deploy new validator
        Validator validator = new Validator();
        
        // Initialize the validator
        validator.initialize(
            baseUri,
            operatingAgreementUri
        );
        
        // Set custom parameters
        validator.setRoyaltyFeePercentage(royaltyFeeBasisPoints);
        
        // Whitelist all default tokens and set their service fees
        for (uint256 i = 0; i < defaultWhitelistedTokens.length; i++) {
            address token = defaultWhitelistedTokens[i];
            validator.addWhitelistedToken(token);
            validator.setServiceFee(token, serviceFee);
        }
        
        // Register validator in registry
        validatorRegistry.registerValidator(
            address(validator),
            name,
            description,
            supportedAssetTypes
        );
        
        // Track the validator
        validators.push(address(validator));
        isValidator[address(validator)] = true;
        
        emit ValidatorCreated(
            address(validator),
            name,
            royaltyFeeBasisPoints,
            defaultWhitelistedTokens,
            serviceFee
        );
        
        return address(validator);
    }

    // ============ Helper Functions ============
    /**
     * @dev Converts a percentage to basis points
     * @param percentage The percentage to convert (e.g., 2.5 for 2.5%)
     * @return The percentage in basis points
     */
    function convertToBasisPoints(uint256 percentage) public pure returns (uint96) {
        // Convert percentage to basis points (e.g., 2.5% -> 250 basis points)
        return uint96(percentage * 100);
    }

    /**
     * @dev Converts basis points to a percentage
     * @param basisPoints The basis points to convert
     * @return The percentage
     */
    function convertFromBasisPoints(uint256 basisPoints) public pure returns (uint256) {
        // Convert basis points to percentage (e.g., 250 basis points -> 2.5%)
        return basisPoints / 100;
    }

    // ============ Admin Functions ============
    /**
     * @dev Adds a token to the default whitelist
     * @param token Address of the token to whitelist
     */
    function addDefaultWhitelistedToken(address token) external onlyOwner {
        require(token != address(0), "Invalid token address");
        require(!isDefaultWhitelisted[token], "Token already whitelisted");
        
        defaultWhitelistedTokens.push(token);
        isDefaultWhitelisted[token] = true;
        
        emit TokenWhitelisted(token);
    }

    /**
     * @dev Removes a token from the default whitelist
     * @param token Address of the token to remove
     */
    function removeDefaultWhitelistedToken(address token) external onlyOwner {
        require(isDefaultWhitelisted[token], "Token not whitelisted");
        
        // Remove from mapping
        isDefaultWhitelisted[token] = false;
        
        // Remove from array
        for (uint256 i = 0; i < defaultWhitelistedTokens.length; i++) {
            if (defaultWhitelistedTokens[i] == token) {
                // Replace with last element and pop
                defaultWhitelistedTokens[i] = defaultWhitelistedTokens[defaultWhitelistedTokens.length - 1];
                defaultWhitelistedTokens.pop();
                break;
            }
        }
        
        emit TokenRemovedFromWhitelist(token);
    }

    /**
     * @dev Updates the ValidatorRegistry address
     * @param _validatorRegistry New ValidatorRegistry address
     */
    function updateValidatorRegistry(address _validatorRegistry) external onlyOwner {
        require(_validatorRegistry != address(0), "Invalid address");
        validatorRegistry = IValidatorRegistry(_validatorRegistry);
    }

    /**
     * @dev Updates the FundManager address
     * @param _fundManager New FundManager address
     */
    function updateFundManager(address _fundManager) external onlyOwner {
        require(_fundManager != address(0), "Invalid address");
        fundManager = IFundManager(_fundManager);
    }

    // ============ View Functions ============
    /**
     * @dev Returns all created validators
     * @return Array of validator addresses
     */
    function getValidators() external view returns (address[] memory) {
        return validators;
    }

    /**
     * @dev Returns the number of created validators
     * @return Number of validators
     */
    function getValidatorCount() external view returns (uint256) {
        return validators.length;
    }

    /**
     * @dev Returns all default whitelisted tokens
     * @return Array of whitelisted token addresses
     */
    function getDefaultWhitelistedTokens() external view returns (address[] memory) {
        return defaultWhitelistedTokens;
    }

    /**
     * @dev Checks if a token is whitelisted by default
     * @param token Address of the token to check
     * @return Whether the token is whitelisted
     */
    function isTokenWhitelisted(address token) external view returns (bool) {
        return isDefaultWhitelisted[token];
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