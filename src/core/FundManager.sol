// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// OpenZeppelin Upgradeable Contracts
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";

// Interfaces
import "./interfaces/IValidatorRegistry.sol";
import "./interfaces/IDeedNFT.sol";
import "./interfaces/IValidator.sol";
import "./interfaces/IFundManager.sol";

// Libraries
import "../libraries/StringUtils.sol";

/**
 * @title FundManager
 * @dev Contract for managing financial operations related to DeedNFTs.
 *      Handles commission collection and distribution from validator fees.
 *      
 * Security:
 * - Role-based access control for admin operations
 * - Reentrancy protection for all financial transactions
 * 
 * Integration:
 * - Works with DeedNFT contract for asset creation
 * - Interacts with Validator contracts for fee information
 * - Implements UUPSUpgradeable for upgradability
 */
contract FundManager is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IFundManager
{
    using StringsUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using AddressUpgradeable for address;
    using StringUtils for string;

    // ============ Role Definitions ============

    /// @notice Role for admin operations
    /// @dev Has authority to update commission percentages and fee receivers
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Role for minting operations
    /// @dev Has authority to mint new DeedNFTs
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ============ State Variables ============

    /// @notice Address of the DeedNFT contract
    address public deedNFTContract;

    /// @notice Address of the validator registry contract
    address public validatorRegistry;

    /// @notice Commission percentage in basis points (e.g., 500 = 5%)
    uint256 public commissionPercentage;

    /// @notice Address that receives commission fees
    address public feeReceiver;

    /// @notice Mapping to track validator commission balances per token
    /// @dev Key: validator address => token address => balance
    mapping(address => mapping(address => uint256)) private validatorBalances;

    // ============ Events ============

    /**
     * @dev Emitted when a new deed is minted
     * @param tokenId ID of the minted deed
     * @param owner Address of the deed owner
     * @param validator Address of the validator
     */
    event DeedMinted(uint256 indexed tokenId, address indexed owner, address indexed validator);

    /**
     * @dev Emitted when the commission percentage is updated
     * @param newPercentage New commission percentage in basis points
     */
    event CommissionPercentageUpdated(uint256 newPercentage);

    /**
     * @dev Emitted when the fee receiver is updated
     * @param newReceiver New fee receiver address
     */
    event FeeReceiverUpdated(address indexed newReceiver);

    /**
     * @dev Emitted when validator fees are withdrawn
     * @param validator Address of the validator
     * @param token Address of the token
     * @param amount Amount withdrawn
     */
    event CommissionsWithdrawn(address indexed validator, address indexed token, uint256 amount);

    /**
     * @dev Emitted when the DeedNFT contract is updated
     * @param newContract New DeedNFT contract address
     */
    event DeedNFTContractUpdated(address indexed newContract);

    /**
     * @dev Emitted when the validator registry is updated
     * @param newRegistry New validator registry address
     */
    event ValidatorRegistryUpdated(address indexed newRegistry);

    /**
     * @dev Emitted when a service fee is collected
     * @param validator Address of the validator
     * @param token Address of the token
     * @param totalAmount Total amount collected
     * @param commissionAmount Commission amount taken
     */
    event ServiceFeeCollected(
        address indexed validator,
        address indexed token,
        uint256 totalAmount,
        uint256 commissionAmount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with default values.
     * @param _deedNFTContract Address of the DeedNFT contract.
     * @param _validatorRegistry Address of the validator registry.
     * @param _feeReceiver Address that receives commission fees.
     * @param _commissionPercentage Initial commission percentage in basis points.
     */
    function initialize(
        address _deedNFTContract,
        address _validatorRegistry,
        address _feeReceiver,
        uint256 _commissionPercentage
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        require(_deedNFTContract != address(0), "FundManager: Invalid DeedNFT contract");
        require(_validatorRegistry != address(0), "FundManager: Invalid validator registry");
        require(_feeReceiver != address(0), "FundManager: Invalid fee receiver");
        require(_commissionPercentage <= 10000, "FundManager: Commission percentage too high");

        deedNFTContract = _deedNFTContract;
        validatorRegistry = _validatorRegistry;
        feeReceiver = _feeReceiver;
        commissionPercentage = _commissionPercentage;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /**
     * @dev Authorizes the contract upgrade. Only DEFAULT_ADMIN_ROLE can upgrade.
     * @param newImplementation Address of the new implementation contract.
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}

    // ============ Admin Functions ============

    /**
     * @dev Sets the commission percentage.
     * @param _commissionPercentage New commission percentage in basis points.
     */
    function setCommissionPercentage(uint256 _commissionPercentage)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(_commissionPercentage <= 10000, "FundManager: Commission percentage too high");
        commissionPercentage = _commissionPercentage;
        emit CommissionPercentageUpdated(_commissionPercentage);
    }

    /**
     * @dev Sets the fee receiver address.
     * @param _feeReceiver New fee receiver address.
     */
    function setFeeReceiver(address _feeReceiver)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(_feeReceiver != address(0), "FundManager: Invalid fee receiver");
        feeReceiver = _feeReceiver;
        emit FeeReceiverUpdated(_feeReceiver);
    }

    /**
     * @dev Sets the DeedNFT contract address.
     * @param _deedNFTContract New DeedNFT contract address.
     */
    function setDeedNFTContract(address _deedNFTContract)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(_deedNFTContract != address(0), "FundManager: Invalid DeedNFT contract");
        deedNFTContract = _deedNFTContract;
        emit DeedNFTContractUpdated(_deedNFTContract);
    }

    /**
     * @dev Sets the validator registry address.
     * @param _validatorRegistry New validator registry address.
     */
    function setValidatorRegistry(address _validatorRegistry)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(_validatorRegistry != address(0), "FundManager: Invalid validator registry");
        validatorRegistry = _validatorRegistry;
        emit ValidatorRegistryUpdated(_validatorRegistry);
    }

    /**
     * @dev Grants the MINTER_ROLE to an address.
     * @param minter Address to grant the role to.
     */
    function addMinter(address minter)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(minter != address(0), "FundManager: Invalid minter address");
        _grantRole(MINTER_ROLE, minter);
    }

    /**
     * @dev Revokes the MINTER_ROLE from an address.
     * @param minter Address to revoke the role from.
     */
    function removeMinter(address minter)
        external
        onlyRole(ADMIN_ROLE)
    {
        _revokeRole(MINTER_ROLE, minter);
    }

    // ============ Minting Functions ============

    /**
     * @dev Mints a new DeedNFT after collecting the service fee.
     * @param owner Address that will own the new deed.
     * @param assetType Type of asset being minted.
     * @param ipfsDetailsHash IPFS hash containing detailed metadata.
     * @param definition Definition of the deed.
     * @param configuration Configuration of the deed.
     * @param validatorAddress Address of the validator to use.
     * @param paymentToken Address of the token used for payment.
     * @return The ID of the minted deed.
     */
    function mintDeedNFT(
        address owner,
        IDeedNFT.AssetType assetType,
        string memory ipfsDetailsHash,
        string memory definition,
        string memory configuration,
        address validatorAddress,
        address paymentToken
    ) external nonReentrant onlyRole(MINTER_ROLE) returns (uint256) {
        require(owner != address(0), "FundManager: Invalid owner address");
        require(validatorAddress != address(0), "FundManager: Invalid validator address");
        require(paymentToken != address(0), "FundManager: Invalid payment token");
        
        // Verify validator is registered
        require(
            IValidatorRegistry(validatorRegistry).isValidatorRegistered(validatorAddress),
            "FundManager: Validator not registered"
        );
        
        // Check if token is whitelisted by the validator
        require(
            IValidator(validatorAddress).isTokenWhitelisted(paymentToken),
            "FundManager: Token not whitelisted by validator"
        );
        
        // Get service fee from validator
        uint256 serviceFee = IValidator(validatorAddress).getServiceFee(paymentToken);
        require(serviceFee > 0, "FundManager: Service fee not set");
        
        // Process payment
        _processPayment(msg.sender, validatorAddress, paymentToken, serviceFee);
        
        // Mint the deed
        uint256 tokenId = _processMint(
            owner,
            assetType,
            ipfsDetailsHash,
            definition,
            configuration,
            validatorAddress
        );
        
        return tokenId;
    }

    /**
     * @dev Mints multiple DeedNFTs after collecting service fees.
     * @param deeds Array of DeedMintData structs containing minting information.
     * @return Array of minted token IDs.
     */
    function mintBatchDeedNFT(DeedMintData[] memory deeds) 
        external 
        nonReentrant 
        onlyRole(MINTER_ROLE) 
        returns (uint256[] memory tokenIds) 
    {
        require(deeds.length > 0, "FundManager: Empty deeds array");
        
        tokenIds = new uint256[](deeds.length);
        
        for (uint256 i = 0; i < deeds.length; i++) {
            DeedMintData memory deedData = deeds[i];
            
            require(deedData.owner != address(0), "FundManager: Invalid owner address");
            require(deedData.validatorAddress != address(0), "FundManager: Invalid validator address");
            require(deedData.paymentToken != address(0), "FundManager: Invalid payment token");
            
            // Verify validator is registered
            require(
                IValidatorRegistry(validatorRegistry).isValidatorRegistered(deedData.validatorAddress),
                "FundManager: Validator not registered"
            );
            
            // Check if token is whitelisted by the validator
            require(
                IValidator(deedData.validatorAddress).isTokenWhitelisted(deedData.paymentToken),
                "FundManager: Token not whitelisted by validator"
            );
            
            // Get service fee from validator
            uint256 serviceFee = IValidator(deedData.validatorAddress).getServiceFee(deedData.paymentToken);
            require(serviceFee > 0, "FundManager: Service fee not set");
            
            // Process payment
            _processPayment(msg.sender, deedData.validatorAddress, deedData.paymentToken, serviceFee);
            
            // Mint the deed
            tokenIds[i] = _processMint(
                deedData.owner,
                deedData.assetType,
                deedData.ipfsDetailsHash,
                deedData.definition,
                deedData.configuration,
                deedData.validatorAddress
            );
        }
        
        return tokenIds;
    }

    // ============ Fee Management Functions ============

    /**
     * @dev Allows validators to withdraw their accumulated fees.
     * @param validatorContract Address of the validator contract.
     * @param token Address of the token to withdraw.
     */
    function withdrawValidatorFees(address validatorContract, address token)
        external
        nonReentrant
    {
        // Ensure the caller has FEE_MANAGER_ROLE in the validator contract
        bytes32 FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
        require(
            IValidator(validatorContract).hasRole(FEE_MANAGER_ROLE, msg.sender),
            "FundManager: Caller not authorized"
        );
        
        uint256 amount = validatorBalances[validatorContract][token];
        require(amount > 0, "FundManager: No fees to withdraw");
        
        // Reset balance before transfer to prevent reentrancy
        validatorBalances[validatorContract][token] = 0;
        
        // Transfer tokens to the caller
        IERC20Upgradeable(token).safeTransfer(msg.sender, amount);
        
        emit CommissionsWithdrawn(validatorContract, token, amount);
    }

    /**
     * @dev Gets the commission balance for a validator and token.
     * @param validatorContract Address of the validator contract.
     * @param token Address of the token.
     * @return The commission balance.
     */
    function getCommissionBalance(address validatorContract, address token)
        external
        view
        returns (uint256)
    {
        return validatorBalances[validatorContract][token];
    }

    // ============ Internal Functions ============

    /**
     * @dev Processes the payment for minting a deed.
     * @param payer Address paying the fee.
     * @param validatorAddress Address of the validator.
     * @param token Address of the payment token.
     * @param serviceFee Amount of the service fee.
     */
    function _processPayment(
        address payer,
        address validatorAddress,
        address token,
        uint256 serviceFee
    ) internal {
        // Calculate commission amount
        uint256 commissionAmount = (serviceFee * commissionPercentage) / 10000;
        uint256 validatorAmount = serviceFee - commissionAmount;
        
        // Transfer tokens from payer to this contract
        IERC20Upgradeable(token).safeTransferFrom(payer, address(this), serviceFee);
        
        // Update validator balance
        validatorBalances[validatorAddress][token] += validatorAmount;
        
        // Transfer commission to fee receiver
        if (commissionAmount > 0) {
            IERC20Upgradeable(token).safeTransfer(feeReceiver, commissionAmount);
        }
        
        emit ServiceFeeCollected(validatorAddress, token, serviceFee, commissionAmount);
    }

    /**
     * @dev Processes the minting of a deed.
     * @param owner Address that will own the new deed.
     * @param assetType Type of asset being minted.
     * @param ipfsDetailsHash IPFS hash containing detailed metadata.
     * @param definition Definition of the deed.
     * @param configuration Configuration of the deed.
     * @param validatorAddress Address of the validator to use.
     * @return The ID of the minted deed.
     */
    function _processMint(
        address owner,
        IDeedNFT.AssetType assetType,
        string memory ipfsDetailsHash,
        string memory definition,
        string memory configuration,
        address validatorAddress
    ) internal returns (uint256) {
        // Mint the deed
        uint256 tokenId = IDeedNFT(deedNFTContract).mintAsset(
            owner,
            assetType,
            ipfsDetailsHash,
            definition,
            configuration,
            validatorAddress
        );
        
        emit DeedMinted(tokenId, owner, validatorAddress);
        
        return tokenId;
    }
}

