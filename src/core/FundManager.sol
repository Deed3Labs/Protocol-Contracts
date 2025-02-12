// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

// OpenZeppelin Upgradeable Contracts
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

// Interfaces

interface IValidatorRegistry {
    /**
     * @dev Returns the owner of the given Validator Contract.
     * @param validatorContract Address of the Validator Contract.
     * @return owner Address of the owner.
     */
    function getValidatorOwner(address validatorContract) external view returns (address owner);
}

interface IDeedNFTAccessControl {
    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/**
 * @title IDeedNFT Interface
 * @dev Interface for interacting with the DeedNFT contract.
 *      Required for asset minting and type verification.
 *      Ensures compatibility with the core DeedNFT contract.
 */
interface IDeedNFT {
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }
    function mintAsset(
        address owner,
        AssetType assetType,
        string memory ipfsDetailsHash,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration
    ) external returns (uint256);
}

/**
 * @title FundManager
 * @dev Contract for managing financial operations related to DeedNFTs.
 *      Handles service fees, token whitelisting, and payment processing.
 *      
 * Security:
 * - Role-based access control for admin operations
 * - Reentrancy protection for all financial transactions
 * - Token whitelisting for accepted payments
 * 
 * Integration:
 * - Works with DeedNFT contract for asset creation
 * - Supports multiple ERC20 tokens for payments
 * - Implements UUPSUpgradeable for upgradability
 */
contract FundManager is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using AddressUpgradeable for address payable;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // ============ Role Definitions ============

    /// @notice Role for fee management operations
    /// @dev Has authority to update service fees and whitelist tokens
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    // ============ State Variables ============

    /// @notice Mapping to track whitelisted tokens
    /// @dev Key: token address, Value: whitelist status
    mapping(address => bool) public isWhitelisted;

    /// @notice Service fees for regular users per token
    /// @dev Key: token address, Value: fee amount in token's smallest unit
    mapping(address => uint256) public serviceFeeRegular;

    /// @notice Service fees for validators per token
    /// @dev Key: token address, Value: fee amount in token's smallest unit
    mapping(address => uint256) public serviceFeeValidator;

    /// @notice Commission percentage for regular users in basis points (e.g., 500 = 5%)
    uint256 public commissionPercentageRegular;

    /// @notice Commission percentage for validators in basis points (e.g., 300 = 3%)
    uint256 public commissionPercentageValidator;

    /// @notice Address to receive service fees
    address public feeReceiver;

    /// @notice Address of the ValidatorRegistry contract
    address public validatorRegistry;

    /// @notice Address of the DeedNFT contract
    address public deedNFT;

    /// @notice Mapping to store accumulated service fees per token
    mapping(address => uint256) public serviceFeesBalance;

    /// @notice Mapping to store accumulated commissions per validator owner and token
    mapping(address => mapping(address => uint256)) public commissionBalances;

    // Struct for batch minting
    struct DeedMintData {
        IDeedNFT.AssetType assetType;
        string ipfsDetailsHash;
        string operatingAgreement;
        string definition;
        string configuration;
        address validatorContract;
        address token;
        string ipfsTokenURI;
    }

    // ============ Events ============

    /**
     * @dev Emitted when a token is whitelisted or removed
     * @param token Address of the affected token
     * @param status New whitelist status
     */
    event TokenWhitelistUpdated(address indexed token, bool status);

    /**
     * @dev Emitted when service fees are updated
     * @param token Address of the affected token
     * @param regularFee New fee for regular users
     * @param validatorFee New fee for validators
     */
    event ServiceFeesUpdated(
        address indexed token,
        uint256 regularFee,
        uint256 validatorFee
    );

    /**
     * @dev Emitted when the commission percentage for regular users is updated.
     * @param newCommissionPercentage The new commission percentage in basis points.
     */
    event CommissionPercentageRegularUpdated(uint256 newCommissionPercentage);

    /**
     * @dev Emitted when the commission percentage for validators is updated.
     * @param newCommissionPercentage The new commission percentage in basis points.
     */
    event CommissionPercentageValidatorUpdated(uint256 newCommissionPercentage);

    /**
     * @dev Emitted when the service fee for a regular user is updated.
     * @param token The address of the token.
     * @param newServiceFee The new service fee amount in the token's smallest unit.
     */
    event ServiceFeeRegularUpdated(address indexed token, uint256 newServiceFee);

    /**
     * @dev Emitted when the service fee for a validator is updated.
     * @param token The address of the token.
     * @param newServiceFee The new service fee amount in the token's smallest unit.
     */
    event ServiceFeeValidatorUpdated(address indexed token, uint256 newServiceFee);

    /**
     * @dev Emitted when the fee receiver address is updated.
     * @param newFeeReceiver The new fee receiver address.
     */
    event FeeReceiverUpdated(address indexed newFeeReceiver);

    /**
     * @dev Emitted when the ValidatorRegistry address is updated.
     * @param newValidatorRegistry The new ValidatorRegistry address.
     */
    event ValidatorRegistryUpdated(address indexed newValidatorRegistry);

    /**
     * @dev Emitted when the DeedNFT contract address is updated.
     * @param newDeedNFT The new DeedNFT contract address.
     */
    event DeedNFTUpdated(address indexed newDeedNFT);

    /**
     * @dev Emitted when funds are deposited and a deed is minted.
     * @param user The address of the user depositing funds.
     * @param token The address of the token deposited.
     * @param amount The total amount deposited.
     * @param serviceFee The service fee deducted.
     * @param commission The commission deducted.
     * @param validatorOwner The address of the validator owner receiving the commission.
     */
    event FundsDeposited(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 serviceFee,
        uint256 commission,
        address indexed validatorOwner
    );

    /**
     * @dev Emitted when service fees are withdrawn.
     * @param receiver The address receiving the service fees.
     * @param token The address of the token withdrawn.
     * @param amount The amount withdrawn.
     */
    event ServiceFeesWithdrawn(address indexed receiver, address indexed token, uint256 amount);

    /**
     * @dev Emitted when commissions are withdrawn.
     * @param receiver The address receiving the commissions.
     * @param token The address of the token withdrawn.
     * @param amount The amount withdrawn.
     */
    event CommissionsWithdrawn(address indexed receiver, address indexed token, uint256 amount);

    // Storage gap for future upgrades
    uint256[45] private __gap;

    /**
     * @dev Initializes the FundManager contract.
     * @param _commissionPercentageRegular Initial commission percentage for regular users in basis points.
     * @param _commissionPercentageValidator Initial commission percentage for validators in basis points.
     * @param _feeReceiver Address to receive service fees.
     * @param _validatorRegistry Address of the ValidatorRegistry contract.
     * @param _deedNFT Address of the DeedNFT contract.
     */
    function initialize(
        uint256 _commissionPercentageRegular,
        uint256 _commissionPercentageValidator,
        address _feeReceiver,
        address _validatorRegistry,
        address _deedNFT
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        // Grant DEFAULT_ADMIN_ROLE to the deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // Initialize commission percentages
        _setCommissionPercentageRegular(_commissionPercentageRegular);
        _setCommissionPercentageValidator(_commissionPercentageValidator);

        // Initialize fee receiver
        _setFeeReceiver(_feeReceiver);

        // Initialize ValidatorRegistry
        _setValidatorRegistry(_validatorRegistry);

        // Initialize DeedNFT
        _setDeedNFT(_deedNFT);
    }

    /**
     * @dev Authorizes contract upgrades. Only accounts with DEFAULT_ADMIN_ROLE can upgrade.
     * @param newImplementation Address of the new implementation contract.
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // Authorization handled by AccessControl
    }

    // Administrative Functions

    /**
     * @dev Sets the commission percentage for regular users.
     * @param _commissionPercentageRegular New commission percentage in basis points (e.g., 500 = 5%).
     */
    function setCommissionPercentageRegular(uint256 _commissionPercentageRegular) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setCommissionPercentageRegular(_commissionPercentageRegular);
    }

    /**
     * @dev Internal function to set the commission percentage for regular users.
     * @param _commissionPercentageRegular New commission percentage in basis points.
     */
    function _setCommissionPercentageRegular(uint256 _commissionPercentageRegular) internal {
        require(_commissionPercentageRegular <= 10000, "FundManager: Commission too high");
        commissionPercentageRegular = _commissionPercentageRegular;
        emit CommissionPercentageRegularUpdated(_commissionPercentageRegular);
    }

    /**
     * @dev Sets the commission percentage for validators.
     * @param _commissionPercentageValidator New commission percentage in basis points (e.g., 300 = 3%).
     */
    function setCommissionPercentageValidator(uint256 _commissionPercentageValidator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setCommissionPercentageValidator(_commissionPercentageValidator);
    }

    /**
     * @dev Internal function to set the commission percentage for validators.
     * @param _commissionPercentageValidator New commission percentage in basis points.
     */
    function _setCommissionPercentageValidator(uint256 _commissionPercentageValidator) internal {
        require(_commissionPercentageValidator <= 10000, "FundManager: Commission too high");
        commissionPercentageValidator = _commissionPercentageValidator;
        emit CommissionPercentageValidatorUpdated(_commissionPercentageValidator);
    }

    /**
     * @dev Adds a token to the whitelist.
     * @param token Address of the token to whitelist.
     */
    function addWhitelistedToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(token != address(0), "FundManager: Invalid token address");
        require(!isWhitelisted[token], "FundManager: Token already whitelisted");
        isWhitelisted[token] = true;
        emit TokenWhitelistUpdated(token, true);
    }

    /**
     * @dev Removes a token from the whitelist.
     * @param token Address of the token to remove.
     */
    function removeWhitelistedToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(isWhitelisted[token], "FundManager: Token not whitelisted");
        isWhitelisted[token] = false;
        emit TokenWhitelistUpdated(token, false);
    }

    /**
     * @dev Sets the service fee for regular users for a specific token.
     * @param token Address of the token.
     * @param _serviceFee Service fee amount in the token's smallest unit (e.g., USDC has 6 decimals).
     */
    function setServiceFeeRegular(address token, uint256 _serviceFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(isWhitelisted[token], "FundManager: Token not whitelisted");
        serviceFeeRegular[token] = _serviceFee;
        emit ServiceFeeRegularUpdated(token, _serviceFee);
    }

    /**
     * @dev Sets the service fee for validators for a specific token.
     * @param token Address of the token.
     * @param _serviceFee Service fee amount in the token's smallest unit (e.g., USDC has 6 decimals).
     */
    function setServiceFeeValidator(address token, uint256 _serviceFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(isWhitelisted[token], "FundManager: Token not whitelisted");
        serviceFeeValidator[token] = _serviceFee;
        emit ServiceFeeValidatorUpdated(token, _serviceFee);
    }

    /**
     * @dev Sets the fee receiver address.
     * @param _feeReceiver New address to receive service fees.
     */
    function setFeeReceiver(address _feeReceiver) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFeeReceiver(_feeReceiver);
    }

    /**
     * @dev Internal function to set the fee receiver address.
     * @param _feeReceiver New address to receive service fees.
     */
    function _setFeeReceiver(address _feeReceiver) internal {
        require(_feeReceiver != address(0), "FundManager: Invalid fee receiver address");
        feeReceiver = _feeReceiver;
        emit FeeReceiverUpdated(_feeReceiver);
    }

    /**
     * @dev Sets the ValidatorRegistry contract address.
     * @param _validatorRegistry New ValidatorRegistry contract address.
     */
    function setValidatorRegistry(address _validatorRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setValidatorRegistry(_validatorRegistry);
    }

    /**
     * @dev Internal function to set the ValidatorRegistry contract address.
     * @param _validatorRegistry New ValidatorRegistry contract address.
     */
    function _setValidatorRegistry(address _validatorRegistry) internal {
        require(_validatorRegistry != address(0), "FundManager: Invalid ValidatorRegistry address");
        validatorRegistry = _validatorRegistry;
        emit ValidatorRegistryUpdated(_validatorRegistry);
    }

    /**
     * @dev Sets the DeedNFT contract address.
     * @param _deedNFT New DeedNFT contract address.
     */
    function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setDeedNFT(_deedNFT);
    }

    /**
     * @dev Internal function to set the DeedNFT contract address.
     * @param _deedNFT New DeedNFT contract address.
     */
    function _setDeedNFT(address _deedNFT) internal {
        require(_deedNFT != address(0), "FundManager: Invalid DeedNFT address");
        deedNFT = _deedNFT;
        emit DeedNFTUpdated(_deedNFT);
    }

    /**
     * @dev Allows users to deposit funds and mint a single DeedNFT in a single transaction.
     *      The service fee is deducted as a flat fee, and a commission is allocated to the ValidatorContract owner.
     * @param assetType Type of the asset.
     * @param ipfsDetailsHash IPFS hash of the deed details.
     * @param operatingAgreement Operating agreement associated with the deed.
     * @param definition Definition of the deed.
     * @param configuration Configuration data for the deed.
     * @param validatorContract Address of the ValidatorContract associated with the mint.
     * @param token Address of the token being used for payment.
     * @param ipfsTokenURI Token URI for the minted NFT.
     * @return deedId The ID of the minted deed.
     */
    function mintDeedNFT(
        IDeedNFT.AssetType assetType,
        string memory ipfsDetailsHash,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration,
        address validatorContract,
        address token,
        string memory ipfsTokenURI
    ) external nonReentrant returns (uint256 deedId) {
        require(isWhitelisted[token], "FundManager: Token not whitelisted");
        require(validatorContract != address(0), "FundManager: Invalid ValidatorContract address");

        // Create a struct to hold the mint data
        DeedMintData memory deedData = DeedMintData({
            assetType: assetType,
            ipfsDetailsHash: ipfsDetailsHash,
            operatingAgreement: operatingAgreement,
            definition: definition,
            configuration: configuration,
            validatorContract: validatorContract,
            token: token,
            ipfsTokenURI: ipfsTokenURI
        });

        // Call internal function to process the mint
        return _processMint(deedData);
    }

    /**
     * @dev Internal function to process the minting of a single deed.
     * @param deedData DeedMintData struct containing data for the deed to mint.
     * @return deedId The ID of the minted deed.
     */
    function _processMint(DeedMintData memory deedData) internal returns (uint256 deedId) {
        bool isValidator = deedNFT != address(0) && IDeedNFTAccessControl(deedNFT).hasRole(
            keccak256("VALIDATOR_ROLE"),
            msg.sender
        );

        uint256 serviceFee = isValidator ? serviceFeeValidator[deedData.token] : serviceFeeRegular[deedData.token];
        require(serviceFee > 0, "FundManager: Service fee not set for token");

        uint256 commissionPercentage = isValidator ? commissionPercentageValidator : commissionPercentageRegular;

        IERC20Upgradeable(deedData.token).safeTransferFrom(msg.sender, address(this), serviceFee);
        serviceFeesBalance[deedData.token] += serviceFee;

        address validatorOwner = IValidatorRegistry(validatorRegistry).getValidatorOwner(deedData.validatorContract);
        require(validatorOwner != address(0), "FundManager: Validator owner not found");

        uint256 commission = (serviceFee * commissionPercentage) / 10000;
        commissionBalances[validatorOwner][deedData.token] += commission;

        deedId = IDeedNFT(deedNFT).mintAsset(
            msg.sender,
            deedData.assetType,
            deedData.ipfsDetailsHash,
            deedData.operatingAgreement,
            deedData.definition,
            deedData.configuration
        );

        emit FundsDeposited(msg.sender, deedData.token, serviceFee, serviceFee, commission, validatorOwner);
    }

    /**
     * @dev Batch mints multiple DeedNFTs.
     * @param deeds Array of DeedMintData structs containing data for each deed to mint.
     * @return deedIds Array of minted deed IDs.
     */
    function mintBatchDeedNFT(DeedMintData[] memory deeds) external nonReentrant returns (uint256[] memory deedIds) {
        uint256 len = deeds.length;
        deedIds = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            deedIds[i] = _mintDeed(deeds[i]);
        }
    }

    /**
     * @dev Internal function to mint a single deed. Reduces stack usage by handling each mint in isolation.
     * @param deed DeedMintData struct containing data for the deed to mint.
     * @return deedId The ID of the minted deed.
     */
    function _mintDeed(DeedMintData memory deed) internal returns (uint256 deedId) {
        require(isWhitelisted[deed.token], "FundManager: Token not whitelisted");
        require(deed.validatorContract != address(0), "FundManager: Invalid ValidatorContract address");

        // Determine if the user has the VALIDATOR_ROLE in DeedNFT
        bool isValidator = false;
        if (deedNFT != address(0)) {
            isValidator = IDeedNFTAccessControl(deedNFT).hasRole(
                keccak256("VALIDATOR_ROLE"),
                msg.sender
            );
        }

        // Get the appropriate service fee
        uint256 serviceFee = isValidator ? serviceFeeValidator[deed.token] : serviceFeeRegular[deed.token];
        require(serviceFee > 0, "FundManager: Service fee not set for token");

        // Get the commission percentage based on user type
        uint256 commissionPercentage = isValidator ? commissionPercentageValidator : commissionPercentageRegular;

        // Transfer service fee from user to FundManager
        IERC20Upgradeable(deed.token).safeTransferFrom(msg.sender, address(this), serviceFee);

        // Accumulate service fees
        serviceFeesBalance[deed.token] += serviceFee;

        // Retrieve the owner of the ValidatorContract from ValidatorRegistry
        address validatorOwner = IValidatorRegistry(validatorRegistry).getValidatorOwner(deed.validatorContract);
        require(validatorOwner != address(0), "FundManager: Validator owner not found");

        // Calculate commission based on service fee
        uint256 commission = (serviceFee * commissionPercentage) / 10000;

        // Accumulate commission for the ValidatorContract owner
        commissionBalances[validatorOwner][deed.token] += commission;

        // Interact with DeedNFT to mint the deed
        deedId = IDeedNFT(deedNFT).mintAsset(
            msg.sender,
            deed.assetType,
            deed.ipfsDetailsHash,
            deed.operatingAgreement,
            deed.definition,
            deed.configuration
        );

        // Emit event
        emit FundsDeposited(msg.sender, deed.token, serviceFee, serviceFee, commission, validatorOwner);

        return deedId;
    }

    /**
     * @dev Allows the admin to withdraw accumulated service fees to the feeReceiver.
     * @param token Address of the token to withdraw.
     */
    function withdrawServiceFees(address token) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 amount = serviceFeesBalance[token];
        require(amount > 0, "FundManager: No service fees to withdraw");

        serviceFeesBalance[token] = 0;
        IERC20Upgradeable(token).safeTransfer(feeReceiver, amount);

        emit ServiceFeesWithdrawn(feeReceiver, token, amount);
    }

    /**
     * @dev Allows ValidatorContract owners to withdraw their accumulated commissions.
     * @param token Address of the token to withdraw.
     */
    function withdrawCommission(address token) external nonReentrant {
        uint256 amount = commissionBalances[msg.sender][token];
        require(amount > 0, "FundManager: No commissions to withdraw");

        commissionBalances[msg.sender][token] = 0;
        IERC20Upgradeable(token).safeTransfer(msg.sender, amount);

        emit CommissionsWithdrawn(msg.sender, token, amount);
    }

    // Getter Functions

    /**
     * @dev Retrieves the current service fees balance for a specific token.
     * @param token Address of the token.
     * @return balance The current service fees balance for the token.
     */
    function getServiceFeesBalance(address token) external view returns (uint256) {
        return serviceFeesBalance[token];
    }

    /**
     * @dev Retrieves the current commission balance for a specific user and token.
     * @param user Address of the user.
     * @param token Address of the token.
     * @return balance The current commission balance for the user and token.
     */
    function getCommissionBalance(address user, address token) external view returns (uint256) {
        return commissionBalances[user][token];
    }

    /**
     * @dev Checks if a token is whitelisted.
     * @param token Address of the token.
     * @return Boolean indicating if the token is whitelisted.
     */
    function isTokenWhitelisted(address token) external view returns (bool) {
        return isWhitelisted[token];
    }

    /**
     * @dev Retrieves the service fee for a specific token and user type.
     * @param token Address of the token.
     * @param isValidator Boolean indicating if the user is a validator.
     * @return fee The service fee amount for the token and user type.
     */
    function getServiceFee(address token, bool isValidator) external view returns (uint256) {
        return isValidator ? serviceFeeValidator[token] : serviceFeeRegular[token];
    }

    /**
     * @dev Retrieves the commission percentage based on user type.
     * @param isValidator Boolean indicating if the user is a validator.
     * @return percentage The commission percentage in basis points.
     */
    function getCommissionPercentage(bool isValidator) external view returns (uint256) {
        return isValidator ? commissionPercentageValidator : commissionPercentageRegular;
    }
}
