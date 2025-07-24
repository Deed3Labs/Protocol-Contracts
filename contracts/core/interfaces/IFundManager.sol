// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../interfaces/IDeedNFT.sol";

/**
 * @title IFundManager
 * @dev Interface for the FundManager contract to allow other contracts to interact with it.
 *      Focuses on payment processing and validator fee distribution.
 */
interface IFundManager {
    // ============ Events ============

    /**
     * @dev Emitted when the commission percentage is updated
     * @param newCommissionPercentage The new commission percentage in basis points
     */
    event CommissionPercentageUpdated(uint256 newCommissionPercentage);

    /**
     * @dev Emitted when the fee receiver address is updated
     * @param newFeeReceiver The new fee receiver address
     */
    event FeeReceiverUpdated(address indexed newFeeReceiver);

    /**
     * @dev Emitted when the ValidatorRegistry address is updated
     * @param newValidatorRegistry The new ValidatorRegistry address
     */
    event ValidatorRegistryUpdated(address indexed newValidatorRegistry);

    /**
     * @dev Emitted when a DeedNFT's compatibility status is updated
     * @param deedNFT The DeedNFT contract address
     * @param isCompatible Whether the DeedNFT is compatible
     */
    event CompatibleDeedNFTUpdated(address indexed deedNFT, bool isCompatible);

    /**
     * @dev Emitted when a service fee is collected
     * @param validator Address of the validator
     * @param token Address of the token
     * @param amount Total amount collected
     * @param commission Commission amount taken
     */
    event ServiceFeeCollected(
        address indexed validator,
        address indexed token,
        uint256 amount,
        uint256 commission
    );
    
    /**
     * @dev Emitted when validator fees are withdrawn
     * @param validator Address of the validator
     * @param token Address of the token
     * @param amount Amount withdrawn
     * @param recipient Address receiving the funds
     */
    event ValidatorFeesWithdrawn(
        address indexed validator,
        address indexed token,
        uint256 amount,
        address indexed recipient
    );

    /**
     * @dev Emitted when royalties are withdrawn with commission
     * @param validator Address of the validator
     * @param token Address of the token
     * @param amount Total amount withdrawn
     * @param commissionAmount Amount taken as commission
     */
    event RoyaltyCommissionWithdrawn(
        address indexed validator,
        address indexed token,
        uint256 amount,
        uint256 commissionAmount
    );

    // ============ Administrative Functions ============

    /**
     * @dev Sets the commission percentage
     * @param _percentage New commission percentage in basis points (e.g., 500 = 5%)
     * @notice Maximum commission percentage is 10% (1000 basis points)
     */
    function setCommissionPercentage(uint256 _percentage) external;

    /**
     * @dev Sets the fee receiver address
     * @param _feeReceiver New fee receiver address
     */
    function setFeeReceiver(address _feeReceiver) external;

    /**
     * @dev Sets the ValidatorRegistry contract address
     * @param _validatorRegistry New ValidatorRegistry contract address
     */
    function setValidatorRegistry(address _validatorRegistry) external;

    // ============ DeedNFT Management Functions ============

    /**
     * @dev Adds a compatible DeedNFT contract
     * @param _deedNFT DeedNFT contract address to add
     */
    function addCompatibleDeedNFT(address _deedNFT) external;

    /**
     * @dev Removes a compatible DeedNFT contract
     * @param _deedNFT DeedNFT contract address to remove
     */
    function removeCompatibleDeedNFT(address _deedNFT) external;

    /**
     * @dev Checks if a DeedNFT contract is compatible
     * @param _deedNFT Address of the DeedNFT contract
     * @return Boolean indicating if the DeedNFT is compatible
     */
    function isCompatibleDeedNFT(address _deedNFT) external view returns (bool);

    /**
     * @dev Gets all compatible DeedNFT contracts
     * @return Array of compatible DeedNFT addresses
     */
    function getCompatibleDeedNFTs() external view returns (address[] memory);

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
    ) external returns (uint256 commissionAmount, uint256 validatorAmount);

    // ============ Fee Management Functions ============

    /**
     * @dev Allows validator admins or fee managers to withdraw accumulated validator fees.
     *      The tokens are sent to the Validator's royalty receiver address.
     * @param validatorContract Address of the validator contract.
     * @param token Address of the token to withdraw.
     * @notice The fees are always sent to the Validator's royalty receiver address,
     *         regardless of who initiates the withdrawal.
     */
    function withdrawValidatorFees(address validatorContract, address token) external;

    /**
     * @dev Retrieves the current validator fee balance for a specific validator and token.
     *      This balance represents the accumulated service fees minus the protocol's commission.
     * @param validatorContract Address of the validator contract.
     * @param token Address of the token.
     * @return balance The current validator fee balance for the validator and token.
     */
    function getValidatorFeeBalance(address validatorContract, address token) external view returns (uint256);

    /**
     * @dev Allows admin or fee manager to withdraw royalties from a validator.
     *      This function calls the validator's withdrawRoyalties function which handles:
     *      - Withdrawing royalties for all whitelisted tokens
     *      - Calculating and taking commission
     *      - Distributing funds to appropriate recipients
     * @param validatorContract Address of the validator contract
     * @param token Address of the token to withdraw
     * @notice Only callable by admin or fee manager roles
     */
    function withdrawRoyaltyCommission(address validatorContract, address token) external;

    // ============ Getter Functions ============

    /**
     * @dev Gets the commission percentage.
     *      This percentage is used to calculate the protocol's share of service fees.
     * @return The commission percentage in basis points (e.g., 500 = 5%).
     */
    function getCommissionPercentage() external view returns (uint256);

    /**
     * @dev Formats a fee amount to a string.
     * @param amount Raw fee amount.
     * @return The formatted fee string.
     */
    function formatFee(uint256 amount) external pure returns (string memory);

    /**
     * @dev Gets the address of the ValidatorRegistry contract.
     * @return The address of the ValidatorRegistry contract.
     */
    function validatorRegistry() external view returns (address);

    /**
     * @dev Gets the address of the fee receiver.
     *      This address receives the protocol's commission from service fees.
     * @return The address of the fee receiver.
     */
    function feeReceiver() external view returns (address);

    /**
     * @dev Updates FEE_MANAGER_ROLE assignments for all active validators.
     */
    function updateValidatorRoles() external;

    /**
     * @dev Gets all whitelisted tokens
     * @return Array of whitelisted token addresses
     */
    function getWhitelistedTokens() external view returns (address[] memory);
} 