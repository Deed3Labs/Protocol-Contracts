// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../core/interfaces/stable-credit/IStableCredit.sol";
import "../core/interfaces/stable-credit/IAssurancePool.sol";
import "../core/interfaces/stable-credit/IAssuranceOracle.sol";

/// @title AssurancePool
/// @notice Stores and manages reserve tokens according to pool
/// configurations set by operator access granted addresses.
contract AssurancePool is IAssurancePool, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== STATE VARIABLES ========== */

    IStableCredit public stableCredit;
    IERC20Upgradeable public reserveToken;
    IAssuranceOracle public assuranceOracle;
    
    // Token addresses for withdrawal priority
    address public USDC_ADDRESS;
    address public USDT_ADDRESS;
    address public DAI_ADDRESS;

    /// @notice The primary reserve directly contributes to the current RTD calculation and
    /// exists only to be used to cover reimbursements.
    /// @dev reserve token address => primary reserve balance
    mapping(address => uint256) public primaryReserve;
    /// @notice The buffer reserve does not contribute to the current RTD calculation and
    /// is used to cover reimbursements before the primary reserve is used.
    /// @dev reserve token address => buffer reserve balance
    mapping(address => uint256) public bufferReserve;
    /// @notice the excess reserve does not contribute to the current RTD calculation and
    /// is used to provide an overflow for deposits that would otherwise exceed the target RTD.
    /// Operator access granted addresses can withdraw from the excess reserve.
    /// @dev reserve token address => excess reserve balance
    mapping(address => uint256) public excessReserve;

    /* ========== INITIALIZER ========== */

    /// @notice initializes the reserve token and deposit token to be used for assurance, as well as
    /// assigns the stable credit and swap router contracts.
    /// @dev should be called directly after deployment (see OpenZeppelin upgradeable standards).
    /// @param _stableCredit address of the stable credit contract to assure.
    /// @param _reserveToken address of the reserve token to use for assurance.
    function initialize(address _stableCredit, address _reserveToken) public initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        stableCredit = IStableCredit(_stableCredit);
        reserveToken = IERC20Upgradeable(_reserveToken);
    }

    /* ========== VIEW FUNCTIONS ========== */

    /// @notice returns the total amount of reserve tokens in the primary and peripheral reserves.
    /// @return total amount of reserve tokens in the primary and peripheral reserves.
    function reserveBalance() public view returns (uint256) {
        return primaryBalance() + bufferBalance();
    }

    /// @notice returns the ratio of primary reserve to total debt, where 1 ether == 100%.
    /// @return ratio of primary reserve to total debt, where 1 ether == 100%.
    function RTD() public view returns (uint256) {
        // if primary balance is empty return 0% RTD ratio
        if (primaryBalance() == 0) return 0;
        // if stable credit has no debt, return 0% RTD ratio
        if (stableCredit.totalSupply() == 0) return 0;
        // return primary balance amount divided by total debt amount
        return (primaryBalance() * 1 ether)
            / convertStableCreditToReserveToken(stableCredit.totalSupply());
    }

    /// @notice returns the target RTD for the AssurancePool.
    /// @dev the target RTD is set by the AssuranceOracle contract.
    /// @return target RTD for the AssurancePool, where 1 ether == 100% RTD.
    function targetRTD() public view returns (uint256) {
        return assuranceOracle.targetRTD();
    }

    /// @notice returns true if the primary reserve is greater than or equal to the target RTD.
    /// @dev returns true if the primary reserve is greater than or equal to the target RTD.
    /// @return true if the primary reserve is greater than or equal to the target RTD.
    function hasValidRTD() public view returns (bool) {
        // if current RTD is greater than target RTD, return false
        return RTD() >= targetRTD();
    }

    /// @notice returns the amount of reserve tokens needed for the primary reserve to reach the
    /// target RTD.
    /// @dev the returned amount is denominated in the reserve token
    /// @return amount of reserve tokens needed for the primary reserve to reach the target RTD.
    function neededReserves() public view returns (uint256) {
        if (hasValidRTD()) return 0;
        // (target RTD - current RTD) * total debt amount
        return (
            (targetRTD() - RTD()) * convertStableCreditToReserveToken(stableCredit.totalSupply())
        ) / 1 ether;
    }

    /// @notice converts the stable credit amount to the reserve token denomination.
    /// @param creditAmount stable credit amount to convert to reserve currency denomination.
    /// @return reserve currency conversion.
    function convertStableCreditToReserveToken(uint256 creditAmount)
        public
        view
        returns (uint256)
    {
        if (creditAmount == 0) return creditAmount;
        // create decimal conversion
        uint256 reserveDecimals = IERC20Metadata(address(reserveToken)).decimals();
        uint256 creditDecimals = IERC20Metadata(address(stableCredit)).decimals();
        if (creditDecimals == reserveDecimals) return creditAmount;
        return creditDecimals > reserveDecimals
            ? ((creditAmount / 10 ** (creditDecimals - reserveDecimals)))
            : ((creditAmount * 10 ** (reserveDecimals - creditDecimals)));
    }

    /// @notice converts the reserve token amount to the stable credit denomination.
    /// @param reserveAmount reserve token amount to convert to credit currency denomination.
    /// @return credit currency conversion.
    function convertReserveTokenToStableCredit(uint256 reserveAmount)
        public
        view
        returns (uint256)
    {
        if (reserveAmount == 0) return reserveAmount;
        // create decimal conversion
        uint256 reserveDecimals = IERC20Metadata(address(reserveToken)).decimals();
        uint256 creditDecimals = IERC20Metadata(address(stableCredit)).decimals();
        if (creditDecimals == reserveDecimals) return reserveAmount;
        return creditDecimals > reserveDecimals
            ? ((reserveAmount * 10 ** (creditDecimals - reserveDecimals)))
            : ((reserveAmount / 10 ** (reserveDecimals - creditDecimals)));
    }

    /// @notice returns the amount of current reserve token's primary balance.
    function primaryBalance() public view returns (uint256) {
        return primaryReserve[address(reserveToken)];
    }

    /// @notice returns the amount of current reserve token's buffer balance. The buffer balance
    function bufferBalance() public view returns (uint256) {
        return bufferReserve[address(reserveToken)];
    }

    /// @notice returns the amount of current reserve token's excess balance.
    function excessBalance() public view override returns (uint256) {
        return excessReserve[address(reserveToken)];
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /// @notice enables caller to deposit reserve tokens into the primary reserve.
    /// @param amount amount of reserve token to deposit.
    function depositIntoPrimaryReserve(uint256 amount) public {
        require(amount > 0, "AssurancePool: Cannot deposit 0");
        // add deposit to primary balance
        primaryReserve[address(reserveToken)] += amount;
        // collect reserve token deposit from caller
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        emit PrimaryReserveDeposited(amount);
    }

    /// @notice enables caller to deposit reserve tokens into the buffer reserve.
    /// @param amount amount of reserve token to deposit.
    function depositIntoBufferReserve(uint256 amount) public override nonReentrant {
        require(amount > 0, "AssurancePool: Cannot deposit 0");
        // add deposit to buffer reserve
        bufferReserve[address(reserveToken)] += amount;
        // collect reserve token deposit from caller
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        emit BufferReserveDeposited(amount);
    }

    /// @notice enables caller to deposit reserve tokens into the excess reserve.
    /// @param amount amount of reserve token to deposit.
    function depositIntoExcessReserve(uint256 amount) public {
        _depositTokenIntoExcess(address(reserveToken), amount);
    }
    
    /// @notice enables caller to deposit any accepted token into the excess reserve.
    /// @param token address of the token to deposit.
    /// @param amount amount of token to deposit.
    function depositTokenIntoExcess(address token, uint256 amount) public {
        require(_isTokenAccepted(token), "Token not accepted for deposits");
        _depositTokenIntoExcess(token, amount);
    }
    
    /// @notice enables caller to deposit any accepted token into the primary reserve.
    /// @param token address of the token to deposit.
    /// @param amount amount of token to deposit.
    function depositTokenIntoPrimary(address token, uint256 amount) public {
        require(_isTokenAccepted(token), "Token not accepted for deposits");
        _depositTokenIntoPrimary(token, amount);
    }
    
    /// @notice enables caller to deposit any accepted token into the buffer reserve.
    /// @param token address of the token to deposit.
    /// @param amount amount of token to deposit.
    function depositTokenIntoBuffer(address token, uint256 amount) public {
        require(_isTokenAccepted(token), "Token not accepted for deposits");
        _depositTokenIntoBuffer(token, amount);
    }

    /// @notice enables caller to deposit reserve tokens to be allocated into the necessary reserve.
    /// @param amount amount of deposit token to deposit.
    function deposit(uint256 amount) public virtual override nonReentrant {
        _depositToken(address(reserveToken), amount);
    }
    
    /// @notice enables caller to deposit any whitelisted token to be allocated into the necessary reserve.
    /// @param token address of the token to deposit.
    /// @param amount amount of token to deposit.
    function depositToken(address token, uint256 amount) public nonReentrant {
        require(_isTokenAccepted(token), "Token not accepted for deposits");
        _depositToken(token, amount);
    }
    
    /// @notice Internal function to handle token deposits with conversion
    /// @param token address of the token to deposit.
    /// @param amount amount of token to deposit.
    function _depositToken(address token, uint256 amount) internal {
        require(amount > 0, "Cannot deposit 0");
        
        // Transfer token from caller
        IERC20Upgradeable(token).safeTransferFrom(_msgSender(), address(this), amount);
        
        // Convert to reserve token equivalent using oracle
        uint256 reserveTokenAmount = _convertToReserveToken(token, amount);
        
        // Calculate reserves needed to reach target RTD
        uint256 _neededReserves = neededReserves();
        
        // If neededReserve is greater than amount, deposit full amount into primary reserve
        if (_neededReserves > reserveTokenAmount) {
            primaryReserve[address(reserveToken)] += reserveTokenAmount;
            return;
        }
        
        // Deposit neededReserves into primary reserve
        if (_neededReserves > 0) {
            primaryReserve[address(reserveToken)] += _neededReserves;
            reserveTokenAmount -= _neededReserves;
        }
        
        // Deposit remaining amount into excess reserve
        excessReserve[address(reserveToken)] += reserveTokenAmount;
    }

    /// @notice enables caller to withdraw reserve tokens from the excess reserve.
    /// @param amount amount of reserve tokens to withdraw from the excess reserve.
    function withdraw(uint256 amount) public nonReentrant {
        require(amount > 0, "AssurancePool: Cannot withdraw 0");
        require(amount <= excessBalance(), "AssurancePool: Insufficient excess reserve");
        // reduce excess balance
        excessReserve[address(reserveToken)] -= amount;
        // transfer reserve token to caller
        reserveToken.safeTransfer(_msgSender(), amount);
        emit ExcessReserveWithdrawn(amount);
    }
    
    /// @notice enables caller to withdraw any accepted token from the excess reserve.
    /// @param token address of the token to withdraw.
    /// @param amount amount of reserve token equivalent to withdraw.
    function withdrawToken(address token, uint256 amount) public nonReentrant {
        require(amount > 0, "AssurancePool: Cannot withdraw 0");
        require(_isTokenAccepted(token), "Token not accepted for withdrawals");
        require(amount <= excessBalance(), "AssurancePool: Insufficient excess reserve");
        
        // Calculate how much of the requested token we can provide
        uint256 tokenAmount = _convertFromReserveToken(token, amount);
        
        // Check if we have enough of the requested token
        uint256 tokenBalance = IERC20Upgradeable(token).balanceOf(address(this));
        
        if (tokenBalance >= tokenAmount) {
            // We have enough of the requested token, transfer it directly
            excessReserve[address(reserveToken)] -= amount;
            IERC20Upgradeable(token).safeTransfer(_msgSender(), tokenAmount);
        } else {
            // We don't have enough, provide equivalent value using available tokens
            _withdrawEquivalentValue(token, amount);
        }
        
        emit ExcessReserveWithdrawn(amount);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /// @notice Called by the stable credit implementation toreimburse an account.
    /// If the amount is covered by the buffer reserve, the buffer reserve is depleted first,
    /// followed by the primary reserve.
    /// @dev The stable credit implementation should not expose this function to the public as it could be
    /// exploited to drain the reserves.
    /// @param account address to reimburse from reserves.
    /// @param amount amount reserve tokens to withdraw from the excess reserve.
    function reimburse(address account, uint256 amount)
        external
        override
        onlyStableCredit
        nonReentrant
        returns (uint256)
    {
        // if no reserves, return
        if (reserveBalance() == 0) return 0;
        // if amount is covered by buffer, reimburse only from buffer
        if (amount < bufferBalance()) {
            bufferReserve[address(reserveToken)] -= amount;
            // check if total amount can be covered by reserve
        } else if (amount < reserveBalance()) {
            // use both reserves to cover amount
            primaryReserve[address(reserveToken)] -= amount - bufferBalance();
            bufferReserve[address(reserveToken)] = 0;
        } else {
            // use entire reserve to cover amount
            uint256 reserveAmount = reserveBalance();
            // empty both reserves
            bufferReserve[address(reserveToken)] = 0;
            primaryReserve[address(reserveToken)] = 0;
            // set amount to available reserves
            amount = reserveAmount;
        }
        // transfer the reserve token amount to account
        reserveToken.safeTransfer(account, amount);
        emit AccountReimbursed(account, amount);
        return amount;
    }

    /// @notice this function reallocates needed reserves from the excess reserve to the
    /// primary reserve to attempt to reach the target RTD.
    function reallocateExcessBalance() public onlyOperator {
        uint256 _neededReserves = neededReserves();
        if (_neededReserves > excessBalance()) {
            primaryReserve[address(reserveToken)] += excessBalance();
            excessReserve[address(reserveToken)] = 0;
        } else {
            primaryReserve[address(reserveToken)] += _neededReserves;
            excessReserve[address(reserveToken)] -= _neededReserves;
        }
        emit ExcessReallocated(excessBalance(), primaryBalance());
    }

    /// @notice This function allows the risk manager to set the reserve token.
    /// @dev Updating the reserve token will not affect the stored reserves of the previous reserve token.
    /// @param _reserveToken address of the new reserve token.
    function setReserveToken(address _reserveToken) external onlyAdmin {
        reserveToken = IERC20Upgradeable(_reserveToken);
        emit ReserveTokenUpdated(_reserveToken);
    }

    function setAssuranceOracle(address _assuranceOracle) external onlyAdmin {
        assuranceOracle = IAssuranceOracle(_assuranceOracle);
        emit AssuranceOracleUpdated(_assuranceOracle);
    }
    
    /// @notice Set token addresses for withdrawal priority (admin only)
    /// @param _usdcAddress USDC token address
    /// @param _usdtAddress USDT token address  
    /// @param _daiAddress DAI token address
    function setTokenAddresses(address _usdcAddress, address _usdtAddress, address _daiAddress) external onlyAdmin {
        USDC_ADDRESS = _usdcAddress;
        USDT_ADDRESS = _usdtAddress;
        DAI_ADDRESS = _daiAddress;
    }
    
    /// @notice Recalculate RTD and rebalance reserves based on current token prices
    /// @dev This function should be called periodically to maintain target RTD
    function rebalanceRTD() external onlyOperator {
        // First, update reserve values based on current token prices
        _updateReserveValues();
        
        uint256 currentRTD = RTD();
        uint256 _targetRTD = targetRTD();
        
        if (currentRTD < _targetRTD) {
            // RTD is below target - move reserves from buffer/excess to primary
            _rebalanceToPrimary();
        } else if (currentRTD > _targetRTD) {
            // RTD is above target - move reserves from primary to buffer/excess
            _rebalanceFromPrimary();
        }
        
        emit RTDRebalanced(currentRTD, _targetRTD, RTD());
    }
    
    /// @notice Recalculate RTD and rebalance reserves based on current token prices (public)
    /// @dev This function can be called by anyone to maintain target RTD
    function rebalanceRTDPublic() external {
        // First, update reserve values based on current token prices
        _updateReserveValues();
        
        uint256 currentRTD = RTD();
        uint256 _targetRTD = targetRTD();
        
        if (currentRTD < _targetRTD) {
            // RTD is below target - move reserves from buffer/excess to primary
            _rebalanceToPrimary();
        } else if (currentRTD > _targetRTD) {
            // RTD is above target - move reserves from primary to buffer/excess
            _rebalanceFromPrimary();
        }
        
        emit RTDRebalanced(currentRTD, _targetRTD, RTD());
    }
    
    /// @notice Internal function to rebalance reserves to primary when RTD is below target
    function _rebalanceToPrimary() internal {
        uint256 _neededReserves = neededReserves();
        if (_neededReserves == 0) return;
        
        // First, try to use buffer reserve
        uint256 bufferAvailable = bufferBalance();
        if (bufferAvailable > 0) {
            uint256 fromBuffer = bufferAvailable <= _neededReserves ? bufferAvailable : _neededReserves;
            bufferReserve[address(reserveToken)] -= fromBuffer;
            primaryReserve[address(reserveToken)] += fromBuffer;
            _neededReserves -= fromBuffer;
        }
        
        // Then, use excess reserve if still needed
        if (_neededReserves > 0) {
            uint256 excessAvailable = excessBalance();
            if (excessAvailable > 0) {
                uint256 fromExcess = excessAvailable <= _neededReserves ? excessAvailable : _neededReserves;
                excessReserve[address(reserveToken)] -= fromExcess;
                primaryReserve[address(reserveToken)] += fromExcess;
            }
        }
    }
    
    /// @notice Internal function to rebalance reserves from primary when RTD is above target
    function _rebalanceFromPrimary() internal {
        uint256 totalSupply = stableCredit.totalSupply();
        if (totalSupply == 0) return;

        uint256 debtInReserve = convertStableCreditToReserveToken(totalSupply);
        uint256 currentPrimary = primaryBalance();
        uint256 targetPrimary = (targetRTD() * debtInReserve) / 1 ether;

        if (currentPrimary <= targetPrimary) return;

        // Amount that can be safely moved out of primary without dropping below target.
        uint256 excessAmount = currentPrimary - targetPrimary;

        // Move to buffer first (for emergency reimbursements).
        uint256 bufferNeeded = bufferBalance() == 0 ? excessAmount / 2 : 0;
        if (bufferNeeded > 0) {
            bufferReserve[address(reserveToken)] += bufferNeeded;
            primaryReserve[address(reserveToken)] -= bufferNeeded;
            excessAmount -= bufferNeeded;
        }

        // Move remaining to excess reserve.
        if (excessAmount > 0) {
            excessReserve[address(reserveToken)] += excessAmount;
            primaryReserve[address(reserveToken)] -= excessAmount;
        }
    }
    
    /// @notice Update reserve values based on current token prices
    /// @dev This function recalculates reserve values using live pricing data
    function _updateReserveValues() internal {
        // Get all tokens held in the pool
        address[] memory heldTokens = _getHeldTokens();
        
        // Reset all reserves to zero
        primaryReserve[address(reserveToken)] = 0;
        bufferReserve[address(reserveToken)] = 0;
        excessReserve[address(reserveToken)] = 0;
        
        // Recalculate reserve values based on current prices
        for (uint256 i = 0; i < heldTokens.length; i++) {
            address token = heldTokens[i];
            if (token == address(0)) continue;
            uint256 tokenBalance = IERC20Upgradeable(token).balanceOf(address(this));
            
            if (tokenBalance > 0) {
                // Convert token balance to reserve token equivalent using current prices
                uint256 reserveTokenEquivalent = _convertToReserveToken(token, tokenBalance);
                
                // Allocate to appropriate reserve based on current RTD needs
                _allocateToReserves(reserveTokenEquivalent);
            }
        }
    }
    
    /// @notice Get all tokens currently held in the pool
    /// @return Array of token addresses held in the pool
    function _getHeldTokens() internal view returns (address[] memory) {
        // This is a simplified implementation
        // In practice, you might want to maintain a list of held tokens
        address[] memory tokens = new address[](4); // Reserve token + 3 stablecoins
        uint256 index = 0;
        
        // Add reserve token
        index = _appendUniqueToken(tokens, index, address(reserveToken));
        
        // Add stablecoins
        index = _appendUniqueToken(tokens, index, USDC_ADDRESS);
        index = _appendUniqueToken(tokens, index, USDT_ADDRESS);
        index = _appendUniqueToken(tokens, index, DAI_ADDRESS);
        
        address[] memory trimmed = new address[](index);
        for (uint256 i = 0; i < index; i++) {
            trimmed[i] = tokens[i];
        }
        return trimmed;
    }
    
    /// @notice Allocate reserve token equivalent to appropriate reserves
    /// @param amount Amount of reserve token equivalent to allocate
    function _allocateToReserves(uint256 amount) internal {
        uint256 _neededReserves = neededReserves();
        
        if (_neededReserves > amount) {
            // All goes to primary reserve (RTD not met)
            primaryReserve[address(reserveToken)] += amount;
        } else {
            // Some to primary, rest to excess
            primaryReserve[address(reserveToken)] += _neededReserves;
            excessReserve[address(reserveToken)] += (amount - _neededReserves);
        }
    }
    
    /// @notice Get current RTD status and rebalancing needs
    /// @return currentRTD Current RTD percentage
    /// @return _targetRTD Target RTD percentage
    /// @return needsRebalancing True if RTD needs rebalancing
    /// @return rebalanceDirection "to_primary", "from_primary", or "balanced"
    function getRTDStatus() external view returns (
        uint256 currentRTD,
        uint256 _targetRTD,
        bool needsRebalancing,
        string memory rebalanceDirection
    ) {
        currentRTD = RTD();
        _targetRTD = targetRTD();
        
        if (currentRTD < _targetRTD) {
            needsRebalancing = true;
            rebalanceDirection = "to_primary";
        } else if (currentRTD > _targetRTD) {
            needsRebalancing = true;
            rebalanceDirection = "from_primary";
        } else {
            needsRebalancing = false;
            rebalanceDirection = "balanced";
        }
    }
    
    /// @notice Get detailed reserve breakdown for RTD analysis
    /// @return primaryAmount Primary reserve amount
    /// @return bufferAmount Buffer reserve amount
    /// @return excessAmount Excess reserve amount
    /// @return totalReserves Total reserves
    /// @return currentRTD Current RTD percentage
    /// @return _targetRTD Target RTD percentage
    function getReserveBreakdown() external view returns (
        uint256 primaryAmount,
        uint256 bufferAmount,
        uint256 excessAmount,
        uint256 totalReserves,
        uint256 currentRTD,
        uint256 _targetRTD
    ) {
        primaryAmount = primaryBalance();
        bufferAmount = bufferBalance();
        excessAmount = excessBalance();
        totalReserves = primaryAmount + bufferAmount + excessAmount;
        currentRTD = RTD();
        _targetRTD = targetRTD();
    }
    
    /// @notice Check if price changes require rebalancing
    /// @return needsRebalancing True if price changes require rebalancing
    /// @return priceImpact Percentage impact of price changes on RTD
    function checkPriceImpact() external view returns (bool needsRebalancing, uint256 priceImpact) {
        // Get current RTD with stored values
        uint256 storedRTD = RTD();
        
        // Calculate what RTD would be with current prices
        uint256 currentRTD = _calculateCurrentRTD();
        
        // Calculate price impact
        if (storedRTD > 0) {
            priceImpact = (currentRTD > storedRTD) ? 
                ((currentRTD - storedRTD) * 100) / storedRTD : 
                ((storedRTD - currentRTD) * 100) / storedRTD;
        } else {
            priceImpact = 0;
        }
        
        // Need rebalancing if price impact is significant (>5%)
        // priceImpact is represented as a whole percentage value.
        needsRebalancing = priceImpact > 5;
    }
    
    /// @notice Calculate current RTD using live pricing data
    /// @return Current RTD percentage based on live prices
    function _calculateCurrentRTD() internal view returns (uint256) {
        if (stableCredit.totalSupply() == 0) return 0;
        
        // Calculate total reserve value using current prices
        uint256 totalReserveValue = 0;
        address[] memory heldTokens = _getHeldTokens();
        
        for (uint256 i = 0; i < heldTokens.length; i++) {
            address token = heldTokens[i];
            if (token == address(0)) continue;
            uint256 tokenBalance = IERC20Upgradeable(token).balanceOf(address(this));
            
            if (tokenBalance > 0) {
                uint256 reserveTokenEquivalent = _convertToReserveToken(token, tokenBalance);
                totalReserveValue += reserveTokenEquivalent;
            }
        }
        
        // Calculate RTD using current prices
        return (totalReserveValue * 1 ether) / convertStableCreditToReserveToken(stableCredit.totalSupply());
    }

    /* ========== MODIFIERS ========== */

    modifier onlyStableCredit() {
        require(
            _msgSender() == address(stableCredit),
            "AssurancePool: Caller is not the stable credit or owner"
        );
        _;
    }

    modifier onlyAdmin() {
        require(
            stableCredit.access().isAdmin(_msgSender()),
            "AssurancePool: caller does not have admin access"
        );
        _;
    }

    modifier onlyOperator() {
        require(
            stableCredit.access().isOperator(_msgSender())
                || _msgSender() == address(assuranceOracle),
            "AssurancePool: caller does not have operator access"
        );
        _;
    }

    modifier notNull(address _address) {
        require(_address != address(0), "invalid operator address");
        _;
    }
    
    // ========== INTERNAL HELPER FUNCTIONS ==========
    
    /// @notice Check if a token is accepted for deposits/withdrawals
    /// @param token Token address to check
    /// @return True if token is accepted
    function _isTokenAccepted(address token) internal view returns (bool) {
        // Accept reserve token
        if (token == address(reserveToken)) {
            return true;
        }
        
        // Accept stablecoins (USDC, USDT, DAI)
        if (assuranceOracle.checkIsStablecoin(token)) {
            return true;
        }
        
        // Accept whitelisted tokens
        return assuranceOracle.isTokenWhitelisted(token);
    }
    
    /// @notice Convert any token to reserve token equivalent using oracle
    /// @param token Token address to convert from
    /// @param amount Amount of token to convert
    /// @return Reserve token equivalent amount
    function _convertToReserveToken(address token, uint256 amount) internal view returns (uint256) {
        if (token == address(reserveToken)) {
            return amount;
        }
        
        // Use oracle to get conversion rate
        return assuranceOracle.quote(token, address(reserveToken), amount);
    }
    
    /// @notice Convert reserve token amount to any token equivalent using oracle
    /// @param token Token address to convert to
    /// @param amount Amount of reserve token to convert
    /// @return Token equivalent amount
    function _convertFromReserveToken(address token, uint256 amount) internal view returns (uint256) {
        if (token == address(reserveToken)) {
            return amount;
        }
        
        // Use oracle to get conversion rate (reverse quote)
        return assuranceOracle.quote(address(reserveToken), token, amount);
    }
    
    
    /// @notice Internal function to deposit token into excess reserve
    /// @param token Token address to deposit
    /// @param amount Amount of token to deposit
    function _depositTokenIntoExcess(address token, uint256 amount) internal {
        require(amount > 0, "Cannot deposit 0");
        
        // Transfer token from caller
        IERC20Upgradeable(token).safeTransferFrom(_msgSender(), address(this), amount);
        
        // Convert to reserve token equivalent
        uint256 reserveTokenAmount = _convertToReserveToken(token, amount);
        
        // Add to excess reserve
        excessReserve[address(reserveToken)] += reserveTokenAmount;
        emit ExcessReserveDeposited(reserveTokenAmount);
    }
    
    /// @notice Internal function to deposit token into primary reserve
    /// @param token Token address to deposit
    /// @param amount Amount of token to deposit
    function _depositTokenIntoPrimary(address token, uint256 amount) internal {
        require(amount > 0, "Cannot deposit 0");
        
        // Transfer token from caller
        IERC20Upgradeable(token).safeTransferFrom(_msgSender(), address(this), amount);
        
        // Convert to reserve token equivalent
        uint256 reserveTokenAmount = _convertToReserveToken(token, amount);
        
        // Add to primary reserve
        primaryReserve[address(reserveToken)] += reserveTokenAmount;
        emit PrimaryReserveDeposited(reserveTokenAmount);
    }
    
    /// @notice Internal function to deposit token into buffer reserve
    /// @param token Token address to deposit
    /// @param amount Amount of token to deposit
    function _depositTokenIntoBuffer(address token, uint256 amount) internal {
        require(amount > 0, "Cannot deposit 0");
        
        // Transfer token from caller
        IERC20Upgradeable(token).safeTransferFrom(_msgSender(), address(this), amount);
        
        // Convert to reserve token equivalent
        uint256 reserveTokenAmount = _convertToReserveToken(token, amount);
        
        // Add to buffer reserve
        bufferReserve[address(reserveToken)] += reserveTokenAmount;
        emit BufferReserveDeposited(reserveTokenAmount);
    }
    
    /// @notice Internal function to withdraw equivalent value using available tokens
    /// @param requestedToken Token the user originally requested (prioritized if available)
    /// @param amount Amount of reserve token equivalent to withdraw
    function _withdrawEquivalentValue(address requestedToken, uint256 amount) internal {
        uint256 remainingAmount = amount;
        
        // First, try to give the user their requested token if we have any
        if (requestedToken != address(0)) {
            uint256 requestedTokenBalance = IERC20Upgradeable(requestedToken).balanceOf(address(this));
            if (requestedTokenBalance > 0) {
                uint256 requestedTokenValue = _convertToReserveToken(requestedToken, requestedTokenBalance);
                
                if (requestedTokenValue <= remainingAmount) {
                    // Use all of the requested token
                    IERC20Upgradeable(requestedToken).safeTransfer(_msgSender(), requestedTokenBalance);
                    remainingAmount -= requestedTokenValue;
                } else {
                    // Use partial amount of the requested token
                    uint256 neededTokenAmount = _convertFromReserveToken(requestedToken, remainingAmount);
                    IERC20Upgradeable(requestedToken).safeTransfer(_msgSender(), neededTokenAmount);
                    remainingAmount = 0;
                }
            }
        }
        
        // If we still need more, use priority order for withdrawal (most cost-effective first)
        if (remainingAmount > 0) {
            address[] memory priorityTokens = _getWithdrawalPriority();
            
            for (uint256 i = 0; i < priorityTokens.length && remainingAmount > 0; i++) {
                address token = priorityTokens[i];
                // Skip the requested token if we already tried it
                if (token == requestedToken) continue;
                
                uint256 tokenBalance = IERC20Upgradeable(token).balanceOf(address(this));
                
                if (tokenBalance > 0) {
                    // Calculate how much of this token we can use
                    uint256 tokenValue = _convertToReserveToken(token, tokenBalance);
                    
                    if (tokenValue <= remainingAmount) {
                        // Use all of this token
                        IERC20Upgradeable(token).safeTransfer(_msgSender(), tokenBalance);
                        remainingAmount -= tokenValue;
                    } else {
                        // Use partial amount of this token
                        uint256 neededTokenAmount = _convertFromReserveToken(token, remainingAmount);
                        IERC20Upgradeable(token).safeTransfer(_msgSender(), neededTokenAmount);
                        remainingAmount = 0;
                    }
                }
            }
        }
        
        // Update excess reserve
        excessReserve[address(reserveToken)] -= amount;
        
        // If we still have remaining amount, revert (shouldn't happen with proper validation)
        require(remainingAmount == 0, "Insufficient token balances for withdrawal");
    }
    
    /// @notice Get withdrawal priority order (most cost-effective first)
    /// @return Array of token addresses in priority order
    function _getWithdrawalPriority() internal view returns (address[] memory) {
        // Priority order: Reserve token first, then stablecoins, then whitelisted tokens
        address[] memory priorityTokens = new address[](4);
        uint256 index = 0;
        
        // 1. Reserve token (most liquid, no conversion needed)
        index = _appendUniqueToken(priorityTokens, index, address(reserveToken));
        
        // 2. Stablecoins (highly liquid, stable value)
        if (USDC_ADDRESS != address(0) && assuranceOracle.checkIsStablecoin(USDC_ADDRESS)) {
            index = _appendUniqueToken(priorityTokens, index, USDC_ADDRESS);
        }
        if (USDT_ADDRESS != address(0) && assuranceOracle.checkIsStablecoin(USDT_ADDRESS)) {
            index = _appendUniqueToken(priorityTokens, index, USDT_ADDRESS);
        }
        if (DAI_ADDRESS != address(0) && assuranceOracle.checkIsStablecoin(DAI_ADDRESS)) {
            index = _appendUniqueToken(priorityTokens, index, DAI_ADDRESS);
        }
        
        // 3. Other whitelisted tokens (in order of preference)
        // Note: This is a simplified implementation
        // In practice, you might want to order by liquidity, volatility, etc.
        
        address[] memory trimmed = new address[](index);
        for (uint256 i = 0; i < index; i++) {
            trimmed[i] = priorityTokens[i];
        }
        return trimmed;
    }

    function _appendUniqueToken(
        address[] memory array,
        uint256 currentLength,
        address token
    ) internal pure returns (uint256) {
        if (token == address(0)) {
            return currentLength;
        }
        for (uint256 i = 0; i < currentLength; i++) {
            if (array[i] == token) {
                return currentLength;
            }
        }
        array[currentLength] = token;
        return currentLength + 1;
    }
}
