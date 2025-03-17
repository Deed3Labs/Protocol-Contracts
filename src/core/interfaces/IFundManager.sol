// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../interfaces/IDeedNFT.sol";

/**
 * @title IFundManager
 * @dev Interface for the FundManager contract to allow other contracts to interact with it
 */
interface IFundManager {
    // ============ Structs ============
    
    /**
     * @dev Struct for batch minting data
     */
    struct DeedMintData {
        IDeedNFT.AssetType assetType;
        string ipfsDetailsHash;
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
     * @param fee New fee for users
     */
    event ServiceFeeUpdated(address indexed token, uint256 fee);

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
     * @dev Emitted when the DeedNFT contract address is updated
     * @param newDeedNFT The new DeedNFT contract address
     */
    event DeedNFTUpdated(address indexed newDeedNFT);

    /**
     * @dev Emitted when funds are deposited and a deed is minted
     * @param user The address of the user depositing funds
     * @param token The address of the token deposited
     * @param amount The total amount deposited
     * @param serviceFee The service fee deducted
     * @param commission The commission deducted
     * @param validatorOwner The address of the validator owner receiving the commission
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
     * @dev Emitted when service fees are withdrawn
     * @param receiver The address receiving the service fees
     * @param token The address of the token withdrawn
     * @param amount The amount withdrawn
     */
    event ServiceFeesWithdrawn(address indexed receiver, address indexed token, uint256 amount);

    /**
     * @dev Emitted when commissions are withdrawn
     * @param receiver The address receiving the commissions
     * @param token The address of the token withdrawn
     * @param amount The amount withdrawn
     */
    event CommissionsWithdrawn(address indexed receiver, address indexed token, uint256 amount);

    // ============ Administrative Functions ============

    /**
     * @dev Sets the commission percentage
     * @param _percentage New commission percentage in basis points (e.g., 500 = 5%)
     */
    function setCommissionPercentage(uint256 _percentage) external;

    /**
     * @dev Adds a token to the whitelist
     * @param token Address of the token to whitelist
     */
    function addWhitelistedToken(address token) external;

    /**
     * @dev Removes a token from the whitelist
     * @param token Address of the token to remove
     */
    function removeWhitelistedToken(address token) external;

    /**
     * @dev Sets the service fee for a specific token
     * @param token Address of the token
     * @param _serviceFee Service fee amount in the token's smallest unit
     */
    function setServiceFee(address token, uint256 _serviceFee) external;

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

    /**
     * @dev Sets the DeedNFT contract address
     * @param _deedNFT New DeedNFT contract address
     */
    function setDeedNFT(address _deedNFT) external;

    // ============ Minting Functions ============

    /**
     * @dev Allows users to deposit funds and mint a single DeedNFT in a single transaction
     * @param assetType Type of the asset
     * @param ipfsDetailsHash IPFS hash of the deed details
     * @param operatingAgreement Operating agreement associated with the deed
     * @param definition Definition of the deed
     * @param configuration Configuration data for the deed
     * @param validatorContract Address of the ValidatorContract associated with the mint
     * @param token Address of the token being used for payment
     * @param ipfsTokenURI Token URI for the minted NFT
     * @return tokenId The ID of the minted deed
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
    ) external returns (uint256 tokenId);

    /**
     * @dev Batch mints multiple DeedNFTs
     * @param deeds Array of DeedMintData structs containing data for each deed to mint
     * @return tokenIds Array of minted deed IDs
     */
    function mintBatchDeedNFT(DeedMintData[] memory deeds) external returns (uint256[] memory tokenIds);

    // ============ Fee Management Functions ============

    /**
     * @dev Allows the admin to withdraw accumulated service fees to the feeReceiver
     * @param token Address of the token to withdraw
     */
    function withdrawServiceFees(address token) external;

    /**
     * @dev Allows validator admins to withdraw their accumulated fees
     * @param validatorContract Address of the validator contract
     * @param token Address of the token to withdraw
     */
    function withdrawValidatorFees(address validatorContract, address token) external;

    /**
     * @dev Retrieves the current commission balance for a specific validator and token
     * @param validatorContract Address of the validator contract
     * @param token Address of the token
     * @return balance The current commission balance for the validator and token
     */
    function getCommissionBalance(address validatorContract, address token) external view returns (uint256);

    // ============ Getter Functions ============

    /**
     * @dev Retrieves the current service fees balance for a specific token
     * @param token Address of the token
     * @return balance The current service fees balance for the token
     */
    function getServiceFeesBalance(address token) external view returns (uint256);

    /**
     * @dev Checks if a token is whitelisted
     * @param token Address of the token
     * @return Boolean indicating if the token is whitelisted
     */
    function isTokenWhitelisted(address token) external view returns (bool);

    /**
     * @dev Retrieves the service fee for a specific token and user type
     * @param token Address of the token
     * @param isValidator Boolean indicating if the user is a validator
     * @return fee The service fee amount for the token and user type
     */
    function getServiceFee(address token, bool isValidator) external view returns (uint256);

    /**
     * @dev Retrieves the commission percentage based on user type
     * @param isValidator Boolean indicating if the user is a validator
     * @return percentage The commission percentage in basis points
     */
    function getCommissionPercentage(bool isValidator) external view returns (uint256);

    /**
     * @dev Formats a fee amount to be human-readable
     * @param token Address of the token
     * @param amount Raw fee amount in token's smallest unit
     * @return The formatted fee string
     */
    function formatFee(address token, uint256 amount) external view returns (string memory);

    /**
     * @dev Parses a human-readable fee string to a raw amount
     * @param token Address of the token
     * @param feeStr The fee string to parse
     * @return The raw fee amount in token's smallest unit
     */
    function parseFee(address token, string memory feeStr) external view returns (uint256);

    /**
     * @dev Gets the address of the DeedNFT contract
     * @return The address of the DeedNFT contract
     */
    function deedNFT() external view returns (address);

    /**
     * @dev Gets the address of the ValidatorRegistry contract
     * @return The address of the ValidatorRegistry contract
     */
    function validatorRegistry() external view returns (address);

    /**
     * @dev Gets the address of the fee receiver
     * @return The address of the fee receiver
     */
    function feeReceiver() external view returns (address);

    /**
     * @dev Gets the commission percentage in basis points
     * @return The commission percentage
     */
    function commissionPercentage() external view returns (uint256);
} 