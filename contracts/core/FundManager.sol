// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// OpenZeppelin Upgradeable Contracts
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AddressUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {IERC20MetadataUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import {StringsUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";

// Interfaces
import "./interfaces/IValidatorRegistry.sol";
import "./interfaces/IDeedNFT.sol";
import "./interfaces/IValidator.sol";
import "./interfaces/IFundManager.sol";

/**
 * @title FundManager
 * @dev Contract for managing financial operations related to DeedNFTs.
 *      Handles commission collection and distribution from validator fees.
 *      Works with DeedNFT that implements ERC721C for on-chain royalty enforcement.
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

    // ============ Role Definitions ============
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    // ============ State Variables ============
    // Compatible DeedNFT tracking
    mapping(address => bool) public compatibleDeedNFTs;
    address[] public allCompatibleDeedNFTs;

    address public validatorRegistry;
    uint256 private _commissionPercentage;
    address public feeReceiver;
    
    // Mapping to track validator balances per token
    mapping(address => mapping(address => uint256)) private validatorBalances;
    
    // Track all ever-assigned validators for role revocation
    address[] private allAssignedValidators;
    mapping(address => bool) private isAssignedValidator;

    // Track whitelisted tokens
    address[] private whitelistedTokens;
    mapping(address => bool) private isWhitelistedToken;

    /**
     * @dev Initializes the contract.
     * @param _validatorRegistry Address of the validator registry.
     * @param initialCommissionPercentage Initial commission percentage in basis points.
     * @param _feeReceiver Address that receives commission fees.
     */
    function initialize(
        address _validatorRegistry,
        uint256 initialCommissionPercentage,
        address _feeReceiver
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        
        require(_validatorRegistry != address(0), "FundManager: Invalid ValidatorRegistry address");
        require(_feeReceiver != address(0), "FundManager: Invalid fee receiver address");
        require(initialCommissionPercentage <= 10000, "FundManager: Commission percentage exceeds 100%");
        
        validatorRegistry = _validatorRegistry;
        _commissionPercentage = initialCommissionPercentage;
        feeReceiver = _feeReceiver;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(FEE_MANAGER_ROLE, msg.sender);

        // Grant FEE_MANAGER_ROLE to all active validators
        _updateValidatorRoles();
    }
    
    /**
     * @dev Authorizes an upgrade to a new implementation.
     * @param newImplementation Address of the new implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
    
    // ============ Admin Functions ============
    
    /**
     * @dev Sets the commission percentage.
     * @param newCommissionPercentage New commission percentage in basis points.
     */
    function setCommissionPercentage(uint256 newCommissionPercentage) external onlyRole(ADMIN_ROLE) {
        require(newCommissionPercentage <= 1000, "FundManager: Commission percentage exceeds 10%");
        _commissionPercentage = newCommissionPercentage;
        emit CommissionPercentageUpdated(newCommissionPercentage);
    }
    
    /**
     * @dev Sets the fee receiver address.
     * @param _feeReceiver New fee receiver address.
     */
    function setFeeReceiver(address _feeReceiver) external onlyRole(ADMIN_ROLE) {
        require(_feeReceiver != address(0), "FundManager: Invalid fee receiver address");
        feeReceiver = _feeReceiver;
        emit FeeReceiverUpdated(_feeReceiver);
    }
    
    /**
     * @dev Sets the validator registry address and grants FEE_MANAGER_ROLE to active validators.
     * @param _validatorRegistry New validator registry address.
     */
    function setValidatorRegistry(address _validatorRegistry) external onlyRole(ADMIN_ROLE) {
        require(_validatorRegistry != address(0), "FundManager: Invalid validator registry address");
        validatorRegistry = _validatorRegistry;
        
        // Grant FEE_MANAGER_ROLE to all active validators
        _updateValidatorRoles();
        emit ValidatorRegistryUpdated(_validatorRegistry);
    }
    
    /**
     * @dev Updates FEE_MANAGER_ROLE assignments for all active validators.
     * Can be called by admin to refresh role assignments.
     */
    function updateValidatorRoles() external {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || msg.sender == validatorRegistry,
            "FundManager: Caller must be admin or validator registry"
        );
        _updateValidatorRoles();
    }
    
    /**
     * @dev Internal function to update FEE_MANAGER_ROLE assignments for active validators.
     */
    function _updateValidatorRoles() internal {
        // Revoke FEE_MANAGER_ROLE from all previously assigned validators
        for (uint256 i = 0; i < allAssignedValidators.length; i++) {
            _revokeRole(FEE_MANAGER_ROLE, allAssignedValidators[i]);
        }
        // Clear the list
        delete allAssignedValidators;
        // Grant FEE_MANAGER_ROLE to all active validators
        address[] memory activeValidators = IValidatorRegistry(validatorRegistry).getActiveValidators();
        for (uint256 i = 0; i < activeValidators.length; i++) {
            _grantRole(FEE_MANAGER_ROLE, activeValidators[i]);
            allAssignedValidators.push(activeValidators[i]);
        }
    }
    
    // ============ DeedNFT Management Functions ============
    
    /**
     * @dev Adds a compatible DeedNFT contract
     * @param _deedNFT DeedNFT contract address to add
     */
    function addCompatibleDeedNFT(address _deedNFT) external onlyRole(ADMIN_ROLE) {
        require(_deedNFT != address(0), "FundManager: Invalid DeedNFT address");
        require(!compatibleDeedNFTs[_deedNFT], "FundManager: DeedNFT already compatible");
        
        compatibleDeedNFTs[_deedNFT] = true;
        allCompatibleDeedNFTs.push(_deedNFT);
        emit CompatibleDeedNFTUpdated(_deedNFT, true);
    }

    /**
     * @dev Removes a compatible DeedNFT contract
     * @param _deedNFT DeedNFT contract address to remove
     */
    function removeCompatibleDeedNFT(address _deedNFT) external onlyRole(ADMIN_ROLE) {
        require(_deedNFT != address(0), "FundManager: Invalid DeedNFT address");
        require(compatibleDeedNFTs[_deedNFT], "FundManager: DeedNFT not compatible");
        
        compatibleDeedNFTs[_deedNFT] = false;
        
        // Remove from array
        for (uint256 i = 0; i < allCompatibleDeedNFTs.length; i++) {
            if (allCompatibleDeedNFTs[i] == _deedNFT) {
                allCompatibleDeedNFTs[i] = allCompatibleDeedNFTs[allCompatibleDeedNFTs.length - 1];
                allCompatibleDeedNFTs.pop();
                break;
            }
        }
        emit CompatibleDeedNFTUpdated(_deedNFT, false);
    }
    
    /**
     * @dev Checks if a DeedNFT contract is compatible
     * @param _deedNFT Address of the DeedNFT contract
     * @return Boolean indicating if the DeedNFT is compatible
     */
    function isCompatibleDeedNFT(address _deedNFT) external view returns (bool) {
        return compatibleDeedNFTs[_deedNFT];
    }

    /**
     * @dev Gets all compatible DeedNFT contracts
     * @return Array of compatible DeedNFT addresses
     */
    function getCompatibleDeedNFTs() external view returns (address[] memory) {
        return allCompatibleDeedNFTs;
    }

    // ============ Payment Processing Functions ============
    
    /**
     * @dev Processes a payment for a deed minting
     * @param payer Address of the payer
     * @param validatorAddress Address of the validator
     * @param token Address of the token
     * @param serviceFee Service fee amount
     * @return commissionAmount Amount taken as commission
     * @return validatorAmount Amount sent to validator
     */
    function processPayment(
        address payer,
        address validatorAddress,
        address token,
        uint256 serviceFee
    ) external nonReentrant returns (uint256 commissionAmount, uint256 validatorAmount) {
        require(compatibleDeedNFTs[msg.sender], "FundManager: Only compatible DeedNFT can call this function");
        require(serviceFee > 0, "FundManager: Amount must be greater than 0");
        require(token != address(0), "FundManager: Invalid token address");
        require(validatorAddress != address(0), "FundManager: Invalid validator address");
        
        // Check if token is whitelisted by validator
        require(
            IValidator(validatorAddress).isTokenWhitelisted(token),
            "FundManager: Token not whitelisted by validator"
        );
        
        // Verify service fee matches validator's requirement
        uint256 requiredFee = IValidator(validatorAddress).getServiceFee(token);
        require(serviceFee == requiredFee, "FundManager: Service fee mismatch");
        
        // Calculate commission amount
        commissionAmount = (serviceFee * _commissionPercentage) / 10000;
        validatorAmount = serviceFee - commissionAmount;
        
        // Transfer tokens from payer to this contract
        IERC20Upgradeable(token).safeTransferFrom(payer, address(this), serviceFee);
            
        // Update validator balance
        validatorBalances[validatorAddress][token] += validatorAmount;
        
        // Transfer commission to fee receiver
        if (commissionAmount > 0) {
            IERC20Upgradeable(token).safeTransfer(feeReceiver, commissionAmount);
        }
        
        emit ServiceFeeCollected(validatorAddress, token, serviceFee, commissionAmount);
        
        return (commissionAmount, validatorAmount);
    }
    
    // ============ Fee Management Functions ============
    
    /**
     * @dev Allows validator admins to withdraw their accumulated fees.
     * @param validatorContract Address of the validator contract.
     * @param token Address of the token to withdraw.
     */
    function withdrawValidatorFees(address validatorContract, address token) external nonReentrant {
        // Check if caller is authorized to withdraw fees
        require(
            IValidator(validatorContract).hasRole(keccak256("ADMIN_ROLE"), msg.sender) ||
            IValidator(validatorContract).hasRole(keccak256("FEE_MANAGER_ROLE"), msg.sender) ||
            hasRole(FEE_MANAGER_ROLE, msg.sender),
            "FundManager: Not authorized to withdraw fees"
        );
        
        // Get balance
        uint256 amount = validatorBalances[validatorContract][token];
        require(amount > 0, "FundManager: No fees to withdraw");
        
        // Get the royalty receiver from the validator
        address royaltyReceiver = IValidator(validatorContract).getRoyaltyReceiver();
        require(royaltyReceiver != address(0), "FundManager: Invalid royalty receiver");
        
        // Reset balance before transfer to prevent reentrancy
        validatorBalances[validatorContract][token] = 0;
        
        // Transfer tokens to the validator's royalty receiver
        IERC20Upgradeable(token).safeTransfer(royaltyReceiver, amount);
        
        emit ValidatorFeesWithdrawn(validatorContract, token, amount, royaltyReceiver);
    }
    
    /**
     * @dev Gets the validator fee balance for a validator and token.
     * @param validatorContract Address of the validator.
     * @param token Address of the token.
     * @return The validator fee balance.
     */
    function getValidatorFeeBalance(address validatorContract, address token) external view returns (uint256) {
        return validatorBalances[validatorContract][token];
    }
    
    /**
     * @dev Allows admin or fee manager to withdraw royalties from a validator
     * @param validatorContract Address of the validator contract
     * @param token Address of the token to withdraw
     */
    function withdrawRoyaltyCommission(address validatorContract, address token) external nonReentrant {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || 
            hasRole(FEE_MANAGER_ROLE, msg.sender),
            "FundManager: Not authorized"
        );
        
        // Call validator's withdrawRoyalties function
        IValidator(validatorContract).withdrawRoyalties(token);
    }
    
    // ============ Getter Functions ============
    
    /**
     * @dev Gets the commission percentage.
     * @return The commission percentage in basis points.
     */
    function getCommissionPercentage() external view returns (uint256) {
        return _commissionPercentage;
    }
    
    /**
     * @dev Gets the commission percentage (alias for getCommissionPercentage).
     * @return The commission percentage in basis points.
     */
    function commissionPercentage() external view returns (uint256) {
        return _commissionPercentage;
    }

    /**
     * @dev Formats a fee amount.
     * @param amount Amount to format.
     * @return The formatted fee as a string.
     */
    function formatFee(uint256 amount) external pure returns (string memory) {
        return amount.toString();
    }

    /**
     * @dev Adds a token to the whitelist
     * @param token Address of the token to whitelist
     */
    function addWhitelistedToken(address token) external onlyRole(ADMIN_ROLE) {
        require(token != address(0), "FundManager: Invalid token address");
        require(!isWhitelistedToken[token], "FundManager: Token already whitelisted");
        isWhitelistedToken[token] = true;
        whitelistedTokens.push(token);
    }

    /**
     * @dev Removes a token from the whitelist
     * @param token Address of the token to remove
     */
    function removeWhitelistedToken(address token) external onlyRole(ADMIN_ROLE) {
        require(isWhitelistedToken[token], "FundManager: Token not whitelisted");
        isWhitelistedToken[token] = false;
        
        // Remove from array
        for (uint256 i = 0; i < whitelistedTokens.length; i++) {
            if (whitelistedTokens[i] == token) {
                whitelistedTokens[i] = whitelistedTokens[whitelistedTokens.length - 1];
                whitelistedTokens.pop();
                break;
            }
        }
    }

    /**
     * @dev Gets all whitelisted tokens
     * @return Array of whitelisted token addresses
     */
    function getWhitelistedTokens() external view returns (address[] memory) {
        return whitelistedTokens;
    }
}
