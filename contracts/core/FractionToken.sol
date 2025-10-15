// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title FractionToken
 * @dev ERC-20 token representing shares of a fractionalized asset
 *      Each fraction gets its own ERC-20 token contract
 *      
 * Security:
 * - Role-based access control for minting/burning
 * - Pausable functionality for emergency stops
 * - Transfer restrictions and wallet limits
 * 
 * Integration:
 * - Deployed by Fractionalize contract for each fraction
 * - Implements ERC-20 standard for share management
 * - Supports UUPSUpgradeable for upgradability
 */
contract FractionToken is 
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // ============ Role Definitions ============

    /// @notice Role for minting and burning tokens
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    /// @notice Role for administrative functions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ============ State Variables ============

    /// @notice Maximum shares per wallet (0 = no limit)
    uint256 public maxSharesPerWallet;
    
    /// @notice Whether burning is enabled
    bool public burnable;
    
    /// @notice Reference to the Fractionalize contract
    address public fractionalizeContract;
    
    /// @notice Fraction ID this token represents
    uint256 public fractionId;

    // ============ Events ============

    /**
     * @dev Emitted when max shares per wallet is updated
     * @param maxShares New maximum shares per wallet
     */
    event MaxSharesPerWalletUpdated(uint256 maxShares);
    
    /**
     * @dev Emitted when burnable status is updated
     * @param burnable New burnable status
     */
    event BurnableStatusUpdated(bool burnable);

    // ============ Constructor & Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the token with required parameters
     * @param _name Token name
     * @param _symbol Token symbol
     * @param _fractionalizeContract Address of the Fractionalize contract
     * @param _fractionId ID of the fraction this token represents
     * @param _maxSharesPerWallet Maximum shares per wallet
     * @param _burnable Whether burning is enabled
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        address _fractionalizeContract,
        uint256 _fractionId,
        uint256 _maxSharesPerWallet,
        bool _burnable
    ) public initializer {
        __ERC20_init(_name, _symbol);
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, _fractionalizeContract);

        fractionalizeContract = _fractionalizeContract;
        fractionId = _fractionId;
        maxSharesPerWallet = _maxSharesPerWallet;
        burnable = _burnable;
    }

    // ============ Minting Functions ============

    /**
     * @notice Mints tokens to a specified address
     * @dev Only callable by the Fractionalize contract
     * @param to Address to receive the tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be greater than zero");
        
        if (maxSharesPerWallet > 0) {
            require(balanceOf(to) + amount <= maxSharesPerWallet, "Exceeds wallet limit");
        }
        
        _mint(to, amount);
    }

    /**
     * @notice Burns tokens from the caller's balance
     * @dev Only callable if burning is enabled
     * @param amount Amount of tokens to burn
     */
    function burn(uint256 amount) external whenNotPaused {
        require(burnable, "Burning not allowed");
        require(amount > 0, "Amount must be greater than zero");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        _burn(msg.sender, amount);
    }

    /**
     * @notice Burns tokens from a specified address
     * @dev Only callable by the Fractionalize contract
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(burnable, "Burning not allowed");
        require(from != address(0), "Cannot burn from zero address");
        require(amount > 0, "Amount must be greater than zero");
        require(balanceOf(from) >= amount, "Insufficient balance");
        
        _burn(from, amount);
    }

    // ============ Transfer Functions ============

    /**
     * @notice Override of ERC20 transfer
     * @dev Adds wallet limit validation
     */
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        if (maxSharesPerWallet > 0 && to != address(0)) {
            require(balanceOf(to) + amount <= maxSharesPerWallet, "Exceeds wallet limit");
        }
        return super.transfer(to, amount);
    }

    /**
     * @notice Override of ERC20 transferFrom
     * @dev Adds wallet limit validation
     */
    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        if (maxSharesPerWallet > 0 && to != address(0)) {
            require(balanceOf(to) + amount <= maxSharesPerWallet, "Exceeds wallet limit");
        }
        return super.transferFrom(from, to, amount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Updates the maximum shares per wallet
     * @param _maxShares New maximum shares per wallet
     */
    function setMaxSharesPerWallet(uint256 _maxShares) external onlyRole(ADMIN_ROLE) {
        maxSharesPerWallet = _maxShares;
        emit MaxSharesPerWalletUpdated(_maxShares);
    }

    /**
     * @notice Updates the burnable status
     * @param _burnable New burnable status
     */
    function setBurnable(bool _burnable) external onlyRole(ADMIN_ROLE) {
        burnable = _burnable;
        emit BurnableStatusUpdated(_burnable);
    }

    /**
     * @notice Pauses all token operations
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses token operations
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ============ Upgradability ============

    /**
     * @dev Required override for UUPS upgradability
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ============ View Functions ============

    /**
     * @notice Returns the voting power for an account
     * @param account Address to check
     * @return Voting power (token balance)
     */
    function getVotingPower(address account) external view returns (uint256) {
        return balanceOf(account);
    }

    /**
     * @notice Checks if an account can receive more tokens
     * @param account Address to check
     * @param amount Amount to check
     * @return Whether the account can receive the amount
     */
    function canReceive(address account, uint256 amount) external view returns (bool) {
        if (maxSharesPerWallet == 0) {
            return true;
        }
        return balanceOf(account) + amount <= maxSharesPerWallet;
    }
}
