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
import "../core/interfaces/stable-credit/IExposureSource.sol";

/// @title AssurancePool
/// @notice Stores and manages reserve tokens according to pool
/// configurations set by operator access granted addresses.
contract AssurancePool is IAssurancePool, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== EVENTS ========== */

    /// @notice emitted when an instrument's withdrawal permission changes.
    event WithdrawalCallerUpdated(address indexed caller, bool allowed);

    /// @notice emitted when the pool-exposure source changes.
    event ExposureSourceUpdated(address indexed exposureSource);

    /// @notice emitted the first time the pool takes in a given token.
    event HeldTokenRegistered(address indexed token);

    /* ========== ERRORS ========== */

    /// @notice thrown when an address that is not an approved instrument attempts a withdrawal.
    error AssurancePoolUnauthorizedWithdrawal(address caller);
    /// @notice thrown when a withdrawal would move value out of the loss-absorbing reserves.
    error AssurancePoolLossAbsorptionTouched();
    /// @notice thrown when a zero address is supplied where a contract is required.
    error AssurancePoolInvalidAddress();
    /// @notice thrown when accepting another token would make the accounting loops unbounded.
    error AssurancePoolTooManyTokens();

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

    /// @notice Ceiling on distinct tokens the pool will hold.
    /// @dev Held value and the RTD calculation both iterate this set and price each entry through
    /// the oracle, and `rebalanceRTD` does so in a transaction rather than a view. The bound keeps
    /// that cost knowable instead of growing with whatever the whitelist accumulates.
    uint256 public constant MAX_HELD_TOKENS = 16;

    /// @notice Instruments permitted to draw on the excess reserve. Nobody withdraws from the
    /// AssurancePool directly: every claim routes through an instrument that has its own rules
    /// about what may be claimed and when (BurnerBond at maturity, StableCredit for lost debt,
    /// LendingPool for loss absorption).
    /// @dev Deliberately narrower than operator access. An operator can configure the pool; that
    /// is not the same authority as being able to take reserve out of it.
    /// @dev address => permitted to withdraw
    mapping(address => bool) public withdrawalCallers;

    /// @notice Reports what this pool would pay if every member defaulted.
    /// @dev Optional. While unset the pool treats every credit as unsecured at full value, which
    /// preserves the inherited behaviour and over-reserves. Phase 1's CollateralRegistry fills
    /// this in. This is a denominator input, not a reserve source: the numerator of RTD is this
    /// contract's own primary balance and nothing else.
    IExposureSource public exposureSource;

    /// @notice Every token the pool has ever taken in.
    /// @dev The pool accepts more tokens than the reserve token and the three configured
    /// stablecoins: anything the oracle whitelists is accepted. Accounting and payout used to
    /// enumerate only those four, so a whitelisted token that arrived was invisible to
    /// `heldReserveValue()` and to RTD, and the payout path could never hand it back -- it entered
    /// the pool and stayed there. Recording what actually arrives keeps both complete, and keeps
    /// them complete across a change of reserve token or stablecoin addresses, which would
    /// otherwise strand whatever was held under the old configuration.
    address[] private heldTokenList;
    /// @dev token => already recorded
    mapping(address => bool) private heldTokenKnown;

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

    /// @notice returns what this pool would pay if every member defaulted.
    /// @dev The RTD denominator. Savings-backed debt is excluded, asset-backed debt contributes
    /// only the shortfall left after its collateral is haircut, and unsecured debt contributes in
    /// full. With no exposure source configured this returns total supply, which is the inherited
    /// behaviour: every credit treated as unsecured at full value.
    /// @return amount of pool exposure outstanding, denominated in stable credit.
    function poolExposure() public view returns (uint256) {
        uint256 totalDebt = stableCredit.totalSupply();
        if (address(exposureSource) == address(0)) return totalDebt;
        uint256 exposure = exposureSource.poolExposure();
        // A source that over-reports must not be able to inflate the reserve requirement past
        // the credit that actually exists.
        return exposure > totalDebt ? totalDebt : exposure;
    }

    /// @notice returns the ratio of primary reserve to pool exposure, where 1 ether == 100%.
    /// @dev The numerator is this contract's own primary balance and nothing else. No other
    /// reserve enters it: the LendingPool residual absorbs loss ahead of this pool rather than
    /// alongside it, BondVault holds bondholder money behind a redemption reserve, PayoutPool
    /// holds merchants' money, and member savings are encumbered to that member's own debt.
    /// Blending any of them in would read as healthy on funds that cannot absorb a default.
    /// @dev Zero when there is no exposure: the ratio is undefined with an empty denominator.
    /// Read `hasValidRTD()` rather than this value to decide whether the pool is adequately
    /// reserved, since no exposure means adequately reserved at any balance.
    /// @return ratio of primary reserve to pool exposure, where 1 ether == 100%.
    function RTD() public view returns (uint256) {
        // if primary balance is empty return 0% RTD ratio
        if (primaryBalance() == 0) return 0;
        // if there is no exposure the ratio is undefined
        uint256 exposure = poolExposure();
        if (exposure == 0) return 0;
        // return primary balance amount divided by pool exposure amount
        return (primaryBalance() * 1 ether) / convertStableCreditToReserveToken(exposure);
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
        // no exposure means nothing to reserve against, at any balance
        if (poolExposure() == 0) return true;
        // if current RTD is greater than target RTD, return false
        return RTD() >= targetRTD();
    }

    /// @notice returns the amount of reserve tokens needed for the primary reserve to reach the
    /// target RTD.
    /// @dev the returned amount is denominated in the reserve token
    /// @return amount of reserve tokens needed for the primary reserve to reach the target RTD.
    function neededReserves() public view returns (uint256) {
        uint256 exposure = poolExposure();
        // Asserted rather than derived. With only savings-backed credit live the correct reserve
        // requirement is exactly zero, and that must not depend on a division happening to round
        // there.
        if (exposure == 0) return 0;
        if (hasValidRTD()) return 0;
        // (target RTD - current RTD) * pool exposure amount
        return ((targetRTD() - RTD()) * convertStableCreditToReserveToken(exposure)) / 1 ether;
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

    /// @notice the tokens accounting enumerates: the reserve token, plus everything that has
    /// actually arrived.
    /// @dev Distinct from `withdrawalPriority()`, which additionally lists the configured
    /// stablecoins as valid payout targets whether or not the pool has ever received them.
    /// @return held token addresses.
    function heldTokens() external view returns (address[] memory) {
        return _getHeldTokens();
    }

    /// @notice the order the payout path spends tokens in.
    /// @return token addresses, most liquid first.
    function withdrawalPriority() external view returns (address[] memory) {
        return _getWithdrawalPriority();
    }

    /// @notice returns the reserve-token-denominated value of every token the pool actually holds.
    /// @dev The three reserve tiers are accounted in a single reserve-token-denominated slot each,
    /// but any accepted token can fund them, so the tokens themselves are commingled. Comparing
    /// this against the accounted total is the solvency check.
    ///
    /// Deliberately a view and not a revert condition. Held value is priced through the oracle, so
    /// it moves with ordinary valuation drift, and it counts only the tokens the payout path knows
    /// about; enforcing it on-chain would halt withdrawals on price movement rather than on any
    /// actual shortfall. Drift belongs to continuous monitoring, which alerts rather than
    /// corrects.
    /// @return value total reserve token equivalent of all held balances.
    function heldReserveValue() public view returns (uint256 value) {
        (value,) = _heldReserveValue();
    }

    /// @notice how many held tokens the pool currently cannot price.
    /// @dev Non-zero means `heldReserveValue()` is understating what the pool holds. That is a
    /// signal to act on rather than an error to swallow: the value has not gone anywhere, it has
    /// stopped being reportable.
    /// @return count number of held tokens with no available price.
    function unpricedTokenCount() external view returns (uint256 count) {
        (, count) = _heldReserveValue();
    }

    /// @notice the held tokens the pool currently cannot price.
    /// @return tokens addresses with no available price.
    function unpricedTokens() external view returns (address[] memory tokens) {
        address[] memory held = _getHeldTokens();
        address[] memory found = new address[](held.length);
        uint256 index = 0;
        for (uint256 i = 0; i < held.length; i++) {
            uint256 balance = IERC20Upgradeable(held[i]).balanceOf(address(this));
            if (balance == 0) continue;
            (, bool priced) = _tryConvertToReserveValueOf(held[i], balance);
            if (!priced) found[index++] = held[i];
        }
        tokens = new address[](index);
        for (uint256 i = 0; i < index; i++) {
            tokens[i] = found[i];
        }
    }

    /// @dev Shared walk behind `heldReserveValue` and `unpricedTokenCount`.
    function _heldReserveValue() internal view returns (uint256 value, uint256 unpriced) {
        address[] memory tokens = _getHeldTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 balance = IERC20Upgradeable(tokens[i]).balanceOf(address(this));
            if (balance == 0) continue;
            (uint256 converted, bool priced) = _tryConvertToReserveValueOf(tokens[i], balance);
            if (priced) value += converted;
            else unpriced++;
        }
    }

    /// @dev Indirection so the walk above can live beside the other views while the conversion
    /// helper stays with the rest of the conversion code.
    function _tryConvertToReserveValueOf(address token, uint256 amount)
        private
        view
        returns (uint256, bool)
    {
        return _tryConvertToReserveToken(token, amount);
    }

    /// @notice reverts unless the loss-absorbing reserves came through a withdrawal untouched.
    /// @dev The withdrawable tier is the excess reserve and only the excess reserve. Primary and
    /// buffer exist to make losses survivable, and no withdrawal may reach them by any route,
    /// including the multi-token payout path that pays out of raw balances rather than out of a
    /// per-tier ledger. Asserted here rather than left to tests, because a payout path that draws
    /// on loss absorption is not a failed withdrawal, it is a solvency bug that has already
    /// happened by the time anyone reads a balance.
    /// @param primaryBefore primary balance recorded before the payout.
    /// @param bufferBefore buffer balance recorded before the payout.
    function _assertLossAbsorptionUntouched(uint256 primaryBefore, uint256 bufferBefore)
        internal
        view
    {
        if (primaryBalance() != primaryBefore || bufferBalance() != bufferBefore) {
            revert AssurancePoolLossAbsorptionTouched();
        }
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /// @notice enables caller to deposit reserve tokens into the primary reserve.
    /// @param amount amount of reserve token to deposit.
    function depositIntoPrimaryReserve(uint256 amount) public {
        require(amount > 0, "AssurancePool: Cannot deposit 0");
        _registerHeldToken(address(reserveToken));
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
        _registerHeldToken(address(reserveToken));
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
        _registerHeldToken(token);
        
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
    function withdraw(uint256 amount) public nonReentrant onlyWithdrawalCaller {
        require(amount > 0, "AssurancePool: Cannot withdraw 0");
        require(amount <= excessBalance(), "AssurancePool: Insufficient excess reserve");
        uint256 primaryBefore = primaryBalance();
        uint256 bufferBefore = bufferBalance();
        // reduce excess balance
        excessReserve[address(reserveToken)] -= amount;
        // transfer reserve token to caller
        reserveToken.safeTransfer(_msgSender(), amount);
        _assertLossAbsorptionUntouched(primaryBefore, bufferBefore);
        emit ExcessReserveWithdrawn(amount);
    }
    
    /// @notice enables caller to withdraw any accepted token from the excess reserve.
    /// @param token address of the token to withdraw.
    /// @param amount amount of reserve token equivalent to withdraw.
    function withdrawToken(address token, uint256 amount) public nonReentrant onlyWithdrawalCaller {
        require(amount > 0, "AssurancePool: Cannot withdraw 0");
        require(_isTokenAccepted(token), "Token not accepted for withdrawals");
        require(amount <= excessBalance(), "AssurancePool: Insufficient excess reserve");
        uint256 primaryBefore = primaryBalance();
        uint256 bufferBefore = bufferBalance();
        
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

        _assertLossAbsorptionUntouched(primaryBefore, bufferBefore);
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
    /// @dev The outgoing reserve token stays in the held set. The pool may still be holding it,
    /// and dropping it here would make that balance invisible to accounting and unreachable by
    /// the payout path at the same moment.
    function setReserveToken(address _reserveToken) external onlyAdmin {
        _registerHeldToken(_reserveToken);
        reserveToken = IERC20Upgradeable(_reserveToken);
        emit ReserveTokenUpdated(_reserveToken);
    }

    /// @notice grants or revokes an instrument's right to draw on the excess reserve.
    /// @dev Admin-managed and empty by default, so a fresh deployment has no withdrawal path at all
    /// until an instrument is explicitly wired in.
    /// @param caller address of the instrument.
    /// @param allowed true to permit withdrawals, false to revoke.
    function setWithdrawalCaller(address caller, bool allowed) external onlyAdmin {
        if (caller == address(0)) revert AssurancePoolInvalidAddress();
        withdrawalCallers[caller] = allowed;
        emit WithdrawalCallerUpdated(caller, allowed);
    }

    /// @notice sets the contract reporting pool exposure for the RTD denominator.
    /// @dev Pass address(0) to fall back to treating all credit as unsecured at full value.
    /// @param _exposureSource address of the exposure source, or address(0) to unset.
    function setExposureSource(address _exposureSource) external onlyAdmin {
        exposureSource = IExposureSource(_exposureSource);
        emit ExposureSourceUpdated(_exposureSource);
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
        uint256 exposure = poolExposure();
        if (exposure == 0) return;

        uint256 debtInReserve = convertStableCreditToReserveToken(exposure);
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
        // The reserve token first, then everything the pool has actually taken in. The configured
        // stablecoins are included by virtue of having arrived, rather than by being named here,
        // so changing those addresses cannot hide value the pool is still holding.
        address[] memory tokens = new address[](heldTokenList.length + 1);
        uint256 index = 0;

        index = _appendUniqueToken(tokens, index, address(reserveToken));
        for (uint256 i = 0; i < heldTokenList.length; i++) {
            index = _appendUniqueToken(tokens, index, heldTokenList[i]);
        }

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
        uint256 exposure = poolExposure();
        if (exposure == 0) return 0;
        
        // Calculate total reserve value using current prices
        uint256 totalReserveValue = 0;
        address[] memory heldTokens = _getHeldTokens();
        
        for (uint256 i = 0; i < heldTokens.length; i++) {
            address token = heldTokens[i];
            if (token == address(0)) continue;
            uint256 tokenBalance = IERC20Upgradeable(token).balanceOf(address(this));

            if (tokenBalance > 0) {
                // Skip what cannot be priced rather than reverting. Understating the reserve
                // reads as needing more of it, which is the safe direction to be wrong in.
                (uint256 reserveTokenEquivalent, bool priced) =
                    _tryConvertToReserveToken(token, tokenBalance);
                if (priced) totalReserveValue += reserveTokenEquivalent;
            }
        }
        
        // Calculate RTD using current prices
        return (totalReserveValue * 1 ether) / convertStableCreditToReserveToken(exposure);
    }

    /* ========== MODIFIERS ========== */

    modifier onlyStableCredit() {
        require(
            _msgSender() == address(stableCredit),
            "AssurancePool: Caller is not the stable credit or owner"
        );
        _;
    }

    modifier onlyWithdrawalCaller() {
        if (!withdrawalCallers[_msgSender()]) {
            revert AssurancePoolUnauthorizedWithdrawal(_msgSender());
        }
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
    
    /// @notice Convert a token to its reserve token equivalent, reporting failure instead of
    /// reverting.
    /// @dev Accounting enumerates every token the pool holds, which means it depends on pricing
    /// tokens the payout path may never touch. A token that is de-whitelisted while still sitting
    /// in the pool, or whose pool cannot serve a TWAP window, has no price -- and a reserve that
    /// cannot report its own balance because one holding went dark is worse than one that reports
    /// what it can and says what it could not. Skipping understates held value, which reads as
    /// needing more reserve rather than less.
    ///
    /// Only accounting is tolerant. The payout path still uses the reverting conversion, because
    /// handing over an amount nobody can price is how a pool is drained by arithmetic.
    /// @param token Token address to convert from
    /// @param amount Amount of token to convert
    /// @return value Reserve token equivalent, zero if unavailable
    /// @return priced Whether a price was available
    function _tryConvertToReserveToken(address token, uint256 amount)
        internal
        view
        returns (uint256 value, bool priced)
    {
        if (token == address(reserveToken)) return (amount, true);
        try assuranceOracle.quote(token, address(reserveToken), amount) returns (uint256 quoted) {
            return (quoted, true);
        } catch {
            return (0, false);
        }
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
        _registerHeldToken(token);
        
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
        _registerHeldToken(token);
        
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
        _registerHeldToken(token);
        
        // Transfer token from caller
        IERC20Upgradeable(token).safeTransferFrom(_msgSender(), address(this), amount);
        
        // Convert to reserve token equivalent
        uint256 reserveTokenAmount = _convertToReserveToken(token, amount);
        
        // Add to buffer reserve
        bufferReserve[address(reserveToken)] += reserveTokenAmount;
        emit BufferReserveDeposited(reserveTokenAmount);
    }
    
    /// @notice records a token the pool now holds, so accounting and payout can both see it.
    /// @param token token that has just arrived.
    function _registerHeldToken(address token) internal {
        if (token == address(0) || heldTokenKnown[token]) return;
        if (heldTokenList.length >= MAX_HELD_TOKENS) revert AssurancePoolTooManyTokens();
        heldTokenKnown[token] = true;
        heldTokenList.push(token);
        emit HeldTokenRegistered(token);
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
        // Priority order: reserve token first, then stablecoins, then everything else held.
        // The tail matters: a token the pool accepted but cannot enumerate here is a token that
        // can never be paid out again, and acceptance is wider than the three configured
        // stablecoins.
        address[] memory priorityTokens = new address[](heldTokenList.length + 4);
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

        // 3. Everything else the pool holds, least liquid last.
        for (uint256 i = 0; i < heldTokenList.length; i++) {
            index = _appendUniqueToken(priorityTokens, index, heldTokenList[i]);
        }

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
