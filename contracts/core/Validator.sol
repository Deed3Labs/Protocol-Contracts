// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// OpenZeppelin Upgradeable Contracts
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {StringsUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";

// Libraries
import "../libraries/StringUtils.sol";
import "../libraries/JSONUtils.sol";

// Interfaces
import "./interfaces/IValidator.sol";
import "./interfaces/IDeedNFT.sol";
import "./interfaces/IFundManager.sol";

/**
 * @title Validator
 * @dev Base contract for implementing deed validation logic.
 *      Provides core functionality for asset validation and metadata management.
 *      
 * Security:
 * - Role-based access control for validation operations
 * - Protected metadata management
 * - Configurable asset type support
 * 
 * Integration:
 * - Works with DeedNFT for asset validation
 * - Implements IValidator interface
 * - Supports UUPSUpgradeable for upgradability
 * - Aligns validation criteria with MetadataRenderer property structure
 */
contract Validator is
    Initializable,
    ERC165Upgradeable,
    AccessControlUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IValidator
{
    using StringsUpgradeable for uint256;
    using StringUtils for string;

    // ============ Role Definitions ============

    /// @notice Role for validation operations
    /// @dev Has authority to perform deed validations
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    /// @notice Role for metadata management
    /// @dev Has authority to update operating agreements and URIs
    bytes32 public constant METADATA_ROLE = keccak256("METADATA_ROLE");

    /// @notice Role for updating validation criteria
    bytes32 public constant CRITERIA_MANAGER_ROLE = keccak256("CRITERIA_MANAGER_ROLE");

    /// @notice Role for fee management operations
    /// @dev Has authority to update service fees and whitelist tokens
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    /// @notice Role for administrative operations
    /// @dev Has authority to perform administrative tasks
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ============ State Variables ============

    /// @notice Base URI for token metadata
    string public baseUri;

    /// @notice Default operating agreement URI
    string public defaultOperatingAgreementUri;

    /// @notice Reference to the DeedNFT contract
    /// @dev Used for deed information retrieval and validation
    IDeedNFT public deedNFT;

    /// @notice Mapping of supported asset types
    /// @dev Key: asset type ID, Value: support status
    mapping(uint256 => bool) public supportedAssetTypes;

    /// @notice Mapping of operating agreement URIs to their names
    /// @dev Key: agreement URI, Value: human-readable name
    mapping(string => string) public operatingAgreements;

    /// @notice Mapping of asset types to their validation criteria
    /// @dev Key: asset type ID, Value: struct containing required traits and additional criteria
    struct ValidationCriteria {
        string[] requiredTraits;
        string additionalCriteria;
        bool requireOperatingAgreement;
        bool requireDefinition;
    }
    mapping(uint256 => ValidationCriteria) public validationCriteria;

    /// @notice Mapping to track compatible DeedNFT contracts
    mapping(address => bool) public compatibleDeedNFTs;
    
    /// @notice Main DeedNFT address
    address public primaryDeedNFT;

    /// @notice Mapping to track whitelisted tokens
    /// @dev Key: token address, Value: whitelist status
    mapping(address => bool) public isWhitelisted;

    /// @notice Service fee per token
    /// @dev Key: token address, Value: fee amount in token's smallest unit
    mapping(address => uint256) public serviceFee;

    /// @notice Mapping to store accumulated service fees per token
    mapping(address => uint256) public serviceFeesBalance;

    /// @notice Address of the FundManager contract
    address public fundManager;

    // ============ Upgrade Gap ============

    /// @dev Storage gap for future upgrades
    uint256[48] private __gap;

    // ============ Royalty Variables ============

    /// @notice Default royalty fee percentage in basis points (100 = 1%)
    uint96 public royaltyFeePercentage;

    /// @notice Address that receives royalties
    address public royaltyReceiver;

    // ============ Registered Agreements ============

    /// @notice Mapping to store registered operating agreements
    mapping(string => string) public registeredAgreements;
    
    /// @notice Array to store registered operating agreement URIs
    string[] public registeredAgreementURIs;

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with default settings
     * @param _baseUri Base URI for token metadata
     * @param _defaultOperatingAgreementUri Default operating agreement URI
     */
    function initialize(
        string memory _baseUri,
        string memory _defaultOperatingAgreementUri
    ) public initializer {
        __AccessControl_init();
        __Ownable_init();
        __UUPSUpgradeable_init();
        __ERC165_init();
        
        baseUri = _baseUri;
        defaultOperatingAgreementUri = _defaultOperatingAgreementUri;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(METADATA_ROLE, msg.sender);
        _grantRole(CRITERIA_MANAGER_ROLE, msg.sender);
        _grantRole(FEE_MANAGER_ROLE, msg.sender);
        
        // Set default royalty values
        royaltyFeePercentage = 500; // Default 5%
        royaltyReceiver = msg.sender;
    }

    /**
     * @dev Authorizes the contract upgrade. Only the owner can upgrade.
     */
    function _authorizeUpgrade(address)
        internal
        view
        override
        onlyOwner
    {
        require(msg.sender == owner(), "Ownable: caller is not the owner");
    }

    // ============ Public Functions ============

    /**
     * @dev Sets the base URI for token metadata.
     * @param _newBaseUri The new base URI.
     */
    function setBaseUri(string memory _newBaseUri) public onlyOwner {
        require(bytes(_newBaseUri).length > 0, "Validator: Base URI cannot be empty");
        baseUri = _newBaseUri;
    }

    /**
     * @dev Returns the base URI.
     * @return The base URI string.
     */
    function getBaseUri() public view returns (string memory) {
        return baseUri;
    }

    /**
     * @dev Sets the default operating agreement URI.
     * @param _uri The new default operating agreement URI.
     */
    function setDefaultOperatingAgreement(string memory _uri) public onlyOwner {
        require(bytes(_uri).length > 0, "Validator: URI cannot be empty");
        defaultOperatingAgreementUri = _uri;
    }

    /**
     * @dev Returns the default operating agreement URI.
     * @return The default operating agreement as a string, constructed from baseUri and tokenId.
     */
    function defaultOperatingAgreement() external view override returns (string memory) {
        // Return the default operating agreement URI directly
        return defaultOperatingAgreementUri;
    }

    /**
     * @dev Adds or updates the name for a given operating agreement URI.
     * @param _uri The URI of the operating agreement.
     * @param _name The name to associate with the URI.
     */
    function setOperatingAgreementName(string memory _uri, string memory _name)
        public
        onlyRole(METADATA_ROLE)
    {
        require(hasRole(METADATA_ROLE, msg.sender), "AccessControl: caller must have metadata role");
        require(bytes(_uri).length > 0, "Validator: URI cannot be empty");
        require(bytes(_name).length > 0, "Validator: Name cannot be empty");
        operatingAgreements[_uri] = _name;
    }

    /**
     * @dev Removes the name associated with an operating agreement URI.
     * @param _uri The URI to remove.
     */
    function removeOperatingAgreementName(string memory _uri)
        public
        onlyRole(METADATA_ROLE)
    {
        require(hasRole(METADATA_ROLE, msg.sender), "Validator: Caller must have METADATA_ROLE");
        require(bytes(_uri).length > 0, "Validator: URI cannot be empty");
        delete operatingAgreements[_uri];
    }

    /**
     * @dev Sets the DeedNFT contract address.
     * @param _deedNFT The new DeedNFT contract address.
     */
    function setDeedNFT(address _deedNFT) public onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        deedNFT = IDeedNFT(_deedNFT);
        primaryDeedNFT = _deedNFT;
        compatibleDeedNFTs[_deedNFT] = true;
        emit DeedNFTUpdated(_deedNFT);
        emit PrimaryDeedNFTUpdated(_deedNFT);
        emit CompatibleDeedNFTUpdated(_deedNFT, true);
    }

    /**
     * @dev Adds a compatible DeedNFT contract.
     * @param _deedNFT The DeedNFT contract address to add.
     */
    function addCompatibleDeedNFT(address _deedNFT) public onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        compatibleDeedNFTs[_deedNFT] = true;
        emit CompatibleDeedNFTUpdated(_deedNFT, true);
    }

    /**
     * @dev Removes a compatible DeedNFT contract.
     * @param _deedNFT The DeedNFT contract address to remove.
     */
    function removeCompatibleDeedNFT(address _deedNFT) public onlyOwner {
        require(_deedNFT != primaryDeedNFT, "Validator: Cannot remove primary DeedNFT");
        compatibleDeedNFTs[_deedNFT] = false;
        emit CompatibleDeedNFTUpdated(_deedNFT, false);
    }

    /**
     * @dev Sets the primary DeedNFT contract.
     * @param _deedNFT The new primary DeedNFT contract address.
     */
    function setPrimaryDeedNFT(address _deedNFT) public onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        require(compatibleDeedNFTs[_deedNFT], "Validator: DeedNFT not compatible");
        primaryDeedNFT = _deedNFT;
        deedNFT = IDeedNFT(_deedNFT);
        emit PrimaryDeedNFTUpdated(_deedNFT);
        emit DeedNFTUpdated(_deedNFT);
    }

    /**
     * @dev Sets the support status for an asset type.
     * @param _assetTypeId The ID of the asset type.
     * @param _isSupported Whether the asset type is supported.
     */
    function setAssetTypeSupport(uint256 _assetTypeId, bool _isSupported)
        public
        onlyRole(CRITERIA_MANAGER_ROLE)
    {
        require(hasRole(CRITERIA_MANAGER_ROLE, msg.sender), "AccessControl: caller must have criteria manager role");
        supportedAssetTypes[_assetTypeId] = _isSupported;
    }

    /**
     * @dev Sets the validation criteria for an asset type
     * @param assetTypeId ID of the asset type
     * @param requiredTraits_ Array of required trait names
     * @param additionalCriteria_ JSON string containing additional validation criteria
     * @param requireOperatingAgreement_ Whether an operating agreement is required
     * @param requireDefinition_ Whether a definition is required
     */
    function setValidationCriteria(
        uint256 assetTypeId, 
        string[] memory requiredTraits_,
        string memory additionalCriteria_,
        bool requireOperatingAgreement_,
        bool requireDefinition_
    ) 
        public 
        onlyRole(CRITERIA_MANAGER_ROLE) 
    {
        require(hasRole(CRITERIA_MANAGER_ROLE, msg.sender), "AccessControl: caller must have criteria manager role");
        validationCriteria[assetTypeId] = ValidationCriteria(
            requiredTraits_,
            additionalCriteria_,
            requireOperatingAgreement_,
            requireDefinition_
        );
        emit ValidationCriteriaUpdated(
            assetTypeId, 
            requiredTraits_, 
            additionalCriteria_,
            requireOperatingAgreement_,
            requireDefinition_
        );
    }

    /**
     * @dev Validates a deed NFT
     * @param _tokenId ID of the token to validate
     * @return Whether the validation was successful
     * @notice Caller must have VALIDATOR_ROLE and the deed must be from a compatible DeedNFT
     */
    function validateDeed(uint256 _tokenId) external override returns (bool) {
        // Check if caller has VALIDATOR_ROLE
        require(hasRole(VALIDATOR_ROLE, msg.sender), "Validator: Caller must have VALIDATOR_ROLE");
        
        // Get the DeedNFT contract address from the primary DeedNFT
        address deedNFTAddress = primaryDeedNFT;
        require(deedNFTAddress != address(0), "Validator: Primary DeedNFT not set");
        
        // Check if the DeedNFT is compatible
        require(compatibleDeedNFTs[deedNFTAddress], "Validator: Incompatible DeedNFT");
        
        // Get the asset type from traits
        bytes memory assetTypeBytes = IDeedNFT(deedNFTAddress).getTraitValue(_tokenId, keccak256("assetType"));
        if (assetTypeBytes.length == 0) {
            emit ValidationError(_tokenId, "Failed to retrieve asset type");
            return false;
        }
        uint256 assetTypeId = uint256(abi.decode(assetTypeBytes, (IDeedNFT.AssetType)));
        
        // Check if the asset type is supported
        if (!supportedAssetTypes[assetTypeId]) {
            emit ValidationError(_tokenId, "Asset type not supported");
            return false;
        }
        
        // Get validation criteria for the asset type
        ValidationCriteria memory criteria = validationCriteria[assetTypeId];
        
        // Check operating agreement if required
        if (criteria.requireOperatingAgreement) {
            bytes memory agreementBytes = IDeedNFT(deedNFTAddress).getTraitValue(_tokenId, keccak256("operatingAgreement"));
            if (agreementBytes.length == 0) {
                emit ValidationError(_tokenId, "Operating agreement is required but not set");
                return false;
            }
            string memory agreement = abi.decode(agreementBytes, (string));
            if (bytes(agreement).length == 0 || !_validateOperatingAgreement(agreement)) {
                emit ValidationError(_tokenId, "Invalid operating agreement");
                return false;
            }
        }
        
        // Check definition if required
        if (criteria.requireDefinition) {
            bytes memory definitionBytes = IDeedNFT(deedNFTAddress).getTraitValue(_tokenId, keccak256("definition"));
            if (definitionBytes.length == 0) {
                emit ValidationError(_tokenId, "Definition is required but not set");
                return false;
            }
            string memory definition = abi.decode(definitionBytes, (string));
            if (bytes(definition).length == 0) {
                emit ValidationError(_tokenId, "Definition cannot be empty");
                return false;
            }
        }
        
        // If no traits required, consider valid
        if (criteria.requiredTraits.length == 0) {
            IDeedNFT(deedNFTAddress).updateValidationStatus(_tokenId, true, address(this));
            emit DeedValidated(_tokenId, true);
            return true;
        }
        
        // Validate the definition against the criteria
        bool isValid = _validateDefinition(_tokenId);
        
        // Update validation status in DeedNFT
        IDeedNFT(deedNFTAddress).updateValidationStatus(_tokenId, isValid, address(this));
        
        // Emit validation result
        emit DeedValidated(_tokenId, isValid);
        
        return isValid;
    }
    
    /**
     * @dev Validates a definition against criteria
     * @param _tokenId ID of the token
     * @return Whether the definition is valid
     */
    function _validateDefinition(uint256 _tokenId) internal view returns (bool) {
        // Get the asset type from traits
        bytes memory assetTypeBytes = IDeedNFT(msg.sender).getTraitValue(_tokenId, keccak256("assetType"));
        if (assetTypeBytes.length == 0) return false;
        uint256 assetTypeId = uint256(abi.decode(assetTypeBytes, (IDeedNFT.AssetType)));
        
        // Get validation criteria for this asset type
        ValidationCriteria memory criteria = validationCriteria[assetTypeId];
        if (criteria.requiredTraits.length == 0) return true; // If no traits required, consider valid
        
        // Check each required trait directly from traits
        for (uint i = 0; i < criteria.requiredTraits.length; i++) {
            bytes memory traitValue = IDeedNFT(msg.sender).getTraitValue(_tokenId, keccak256(bytes(criteria.requiredTraits[i])));
            if (traitValue.length == 0) {
                return false;
            }
            
            // Check if the trait value is non-empty
            if (traitValue.length > 0) {
                string memory decodedValue = abi.decode(traitValue, (string));
                if (bytes(decodedValue).length == 0) {
                    return false;
                }
            }
        }

        // If additional criteria exist, apply them
        if (bytes(criteria.additionalCriteria).length > 0) {
            // TODO: Implement additional criteria validation logic
            // This could include:
            // - Value ranges (e.g., year must be between 1900 and current year)
            // - Format requirements (e.g., VIN must be 17 characters)
            // - Value relationships (e.g., model must be valid for the given make)
            // - Custom validation logic
        }
        
        return true;
    }

    /**
     * @dev Internal function to validate an operating agreement
     * @param agreement The operating agreement to validate
     * @return Whether the agreement is valid
     */
    function _validateOperatingAgreement(string memory agreement) internal view returns (bool) {
        // Check if the operating agreement is registered
        if (bytes(operatingAgreements[agreement]).length > 0) {
            return true;
        }
        
        // Check if the agreement contains the baseUri (for default agreements)
        if (bytes(baseUri).length > 0 && StringUtils.contains(agreement, baseUri)) {
            return true;
        }
        
        // Check if the agreement is a registered agreement with tokenId appended
        // Check each registered agreement to see if it's a prefix of the provided agreement
        for (uint256 i = 0; i < registeredAgreementURIs.length; i++) {
            string memory registeredAgreement = registeredAgreementURIs[i];
            if (StringUtils.contains(agreement, registeredAgreement)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * @dev Sets up validation criteria for an asset type
     * @param assetTypeId ID of the asset type
     */
    function setupValidationCriteria(uint256 assetTypeId) public onlyRole(CRITERIA_MANAGER_ROLE) {
        // Set default validation criteria based on asset type
        if (assetTypeId == uint256(IDeedNFT.AssetType.Land) || assetTypeId == uint256(IDeedNFT.AssetType.Estate)) {
            string[] memory requiredTraits_ = new string[](5);
            requiredTraits_[0] = "country";
            requiredTraits_[1] = "state";
            requiredTraits_[2] = "county";
            requiredTraits_[3] = "parcelNumber";
            requiredTraits_[4] = "legalDescription";
            setValidationCriteria(
                assetTypeId, 
                requiredTraits_, 
                "",  // additionalCriteria
                true, // requireOperatingAgreement
                true  // requireDefinition
            );
        } 
        else if (assetTypeId == uint256(IDeedNFT.AssetType.Vehicle)) {
            string[] memory requiredTraits_ = new string[](4);
            requiredTraits_[0] = "make";
            requiredTraits_[1] = "model";
            requiredTraits_[2] = "year";
            requiredTraits_[3] = "vin";
            setValidationCriteria(
                assetTypeId, 
                requiredTraits_, 
                "",  // additionalCriteria
                true, // requireOperatingAgreement
                true  // requireDefinition
            );
        }
        else if (assetTypeId == uint256(IDeedNFT.AssetType.CommercialEquipment)) {
            string[] memory requiredTraits_ = new string[](4);
            requiredTraits_[0] = "manufacturer";
            requiredTraits_[1] = "model";
            requiredTraits_[2] = "serialNumber";
            requiredTraits_[3] = "year";
            setValidationCriteria(
                assetTypeId, 
                requiredTraits_, 
                "",  // additionalCriteria
                true, // requireOperatingAgreement
                true  // requireDefinition
            );
        }
        
        // Enable this asset type
        supportedAssetTypes[assetTypeId] = true;
    }

    /**
     * @dev Returns the name of an operating agreement
     * @param uri_ URI of the operating agreement
     * @return Name of the operating agreement
     */
    function operatingAgreementName(string memory uri_) external view override returns (string memory) {
        return operatingAgreements[uri_];
    }

    /**
     * @dev Checks if an asset type is supported
     * @param assetTypeId ID of the asset type
     * @return Whether the asset type is supported
     */
    function supportsAssetType(uint256 assetTypeId) external view override returns (bool) {
        return supportedAssetTypes[assetTypeId];
    }

    /**
     * @dev Adds a token to the whitelist
     * @param token Address of the token to whitelist
     */
    function addWhitelistedToken(address token) external onlyRole(FEE_MANAGER_ROLE) {
        require(token != address(0), "Validator: Invalid token address");
        require(!isWhitelisted[token], "Validator: Token already whitelisted");
        isWhitelisted[token] = true;
    }

    /**
     * @dev Removes a token from the whitelist
     * @param token Address of the token to remove
     */
    function removeWhitelistedToken(address token) external onlyRole(FEE_MANAGER_ROLE) {
        require(isWhitelisted[token], "Validator: Token not whitelisted");
        isWhitelisted[token] = false;
    }

    /**
     * @dev Sets the service fee for a specific token
     * @param token Address of the token
     * @param _serviceFee Service fee amount in the token's smallest unit
     */
    function setServiceFee(address token, uint256 _serviceFee) external onlyRole(FEE_MANAGER_ROLE) {
        require(isWhitelisted[token], "Validator: Token not whitelisted");
        serviceFee[token] = _serviceFee;
    }

    /**
     * @dev Sets the FundManager contract address
     * @param _fundManager New FundManager contract address
     */
    function setFundManager(address _fundManager) public onlyOwner {
        require(_fundManager != address(0), "Validator: Invalid FundManager address");
        fundManager = _fundManager;
    }

    /**
     * @dev Allows validator admins to withdraw accumulated service fees from the FundManager
     * @param token Address of the token to withdraw
     * @notice Fees are withdrawn to the royalty receiver address set in this contract
     */
    function withdrawServiceFees(address token) external onlyRole(FEE_MANAGER_ROLE) {
        require(fundManager != address(0), "Validator: FundManager not set");
        require(royaltyReceiver != address(0), "Validator: Royalty receiver not set");
        
        // Check if there are fees to withdraw
        uint256 amount = IFundManager(fundManager).getValidatorFeeBalance(address(this), token);
        require(amount > 0, "Validator: No service fees to withdraw");
        
        // Call the FundManager to withdraw fees to the royalty receiver
        IFundManager(fundManager).withdrawValidatorFees(address(this), token);
    }

    /**
     * @dev Checks if a token is whitelisted
     * @param token Address of the token
     * @return Boolean indicating if the token is whitelisted
     */
    function isTokenWhitelisted(address token) external view returns (bool) {
        return isWhitelisted[token];
    }

    /**
     * @dev Retrieves the service fee for a specific token
     * @param token Address of the token
     * @return fee Service fee amount for the token
     */
    function getServiceFee(address token) external view returns (uint256) {
        return serviceFee[token];
    }

    /**
     * @dev Gets the validation criteria for an asset type
     * @param assetTypeId ID of the asset type
     * @return requiredTraits_ Array of required trait names
     * @return additionalCriteria_ JSON string containing additional validation criteria
     * @return requireOperatingAgreement_ Whether an operating agreement is required
     * @return requireDefinition_ Whether a definition is required
     */
    function getValidationCriteria(uint256 assetTypeId) 
        external 
        view 
        override 
        returns (
            string[] memory requiredTraits_,
            string memory additionalCriteria_,
            bool requireOperatingAgreement_,
            bool requireDefinition_
        ) 
    {
        ValidationCriteria memory criteria = validationCriteria[assetTypeId];
        return (
            criteria.requiredTraits,
            criteria.additionalCriteria,
            criteria.requireOperatingAgreement,
            criteria.requireDefinition
        );
    }

    /**
     * @dev Checks if a DeedNFT contract is compatible
     * @param _deedNFT Address of the DeedNFT contract
     * @return Boolean indicating if the DeedNFT is compatible
     */
    function isCompatibleDeedNFT(address _deedNFT) external view override returns (bool) {
        return compatibleDeedNFTs[_deedNFT];
    }

    /**
     * @dev Registers an operating agreement
     * @param uri URI of the operating agreement
     * @param name Name of the operating agreement
     */
    function registerOperatingAgreement(string memory uri, string memory name) external override onlyRole(METADATA_ROLE) {
        require(bytes(uri).length > 0, "Validator: URI cannot be empty");
        require(bytes(name).length > 0, "Validator: Name cannot be empty");
        operatingAgreements[uri] = name;
        registeredAgreementURIs.push(uri);
        emit OperatingAgreementRegistered(uri, name);
    }

    /**
     * @dev Validates a deed NFT's operating agreement
     * @param operatingAgreement URI of the operating agreement
     * @return Whether the operating agreement is valid
     */
    function validateOperatingAgreement(
        string memory operatingAgreement
    ) external view override returns (bool) {
        // Check if the operating agreement is registered
        if (bytes(operatingAgreements[operatingAgreement]).length == 0 && 
            !StringUtils.contains(operatingAgreement, defaultOperatingAgreementUri)) {
            return false;
        }
        
        // Additional validation logic can be added here
        // For example, checking if the operating agreement is appropriate for the asset type
        
        return true;
    }

    /**
     * @dev Gets the royalty fee percentage for a token
     * @return The royalty fee percentage in basis points (100 = 1%)
     */
    function getRoyaltyFeePercentage(uint256) external view override returns (uint96) {
        return royaltyFeePercentage;
    }

    /**
     * @dev Sets the royalty fee percentage
     * @param percentage The royalty fee percentage in basis points (100 = 1%)
     */
    function setRoyaltyFeePercentage(uint96 percentage) external onlyRole(FEE_MANAGER_ROLE) {
        require(percentage <= 500, "Validator: Royalty percentage exceeds 5%");
        royaltyFeePercentage = percentage;
    }

    /**
     * @dev Gets the royalty receiver address
     * @return The address that receives royalties
     */
    function getRoyaltyReceiver() external view override returns (address) {
        return royaltyReceiver;
    }

    /**
     * @dev Sets the royalty receiver address
     * @param receiver The address that will receive royalties
     */
    function setRoyaltyReceiver(address receiver) external onlyRole(FEE_MANAGER_ROLE) {
        require(receiver != address(0), "Validator: Invalid royalty receiver address");
        royaltyReceiver = receiver;
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     * Declares support for IValidator interface
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC165Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return
            interfaceId == type(IValidator).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function grantRole(bytes32 role, address account) 
        public 
        override(AccessControlUpgradeable, IAccessControlUpgradeable) 
    {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "AccessControl: caller must have admin role");
        _grantRole(role, account);
    }
}