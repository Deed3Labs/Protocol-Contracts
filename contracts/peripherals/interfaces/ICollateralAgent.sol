// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title ICollateralAgent
/// @notice What stage 2's BondVault and bond collections call on the `CollateralAgent` (IV-10
/// Exhibit A; decisions 18 and 19).
interface ICollateralAgent {
    /// @notice Whether an Enforcement Notice is in effect (an Enforcement Period). While it is, no
    /// asset leaves the BondVault except through the Agent's distributions, the Collateral Deposit
    /// Account and capped costs; no purchase or roll (even a confirmed one) executes; `settle`,
    /// `payPledged`, `completeSettlement`, buyback and `redeemAll` revert.
    function enforcementInForce() external view returns (bool);

    /// @notice Consumes a change the Agent co-signed (Exhibit A, Part 2 item 6). The caller is the
    /// changed contract and `callHash` is `keccak256(msg.data)` of the governed call it is running.
    /// @dev Reverts unless Clear Lending proposed and confirmed it by two different treasury
    /// signers, the Agent approved it, and 7 days have passed since the confirmation.
    function consumeChange(bytes32 callHash) external;

    /// @notice Distributions posted but not yet claimed, which the BondVault must keep on hand
    /// (on top of its Redemption Reserve) until they are claimed.
    function unclaimedDistributions() external view returns (uint256);

    /// @notice What a claim on `bondId` would pay now, across every Enforcement Period.
    function claimable(uint256 bondId) external view returns (uint256);

    /// @notice How `amount` paid on `bondId` held by `holder` is routed (decision 19): to the
    /// Holder's MB-05 Defaulted Amount first, only while MB-05 §6.1 permits enforcement against
    /// the bond, and the rest to the Holder's Smart Account (or registered payment Successor).
    function routeDistribution(uint256 bondId, address holder, uint256 amount)
        external
        view
        returns (uint256 toDebt, uint256 toHolder);
}

/// @dev The BondVault side (stage 2). Every function here may be called only by the
/// `CollateralAgent` contract, which checks the Enforcement Period, the destination and the caps.
interface IAgentVault {
    /// @notice USDC held: the Collateral.
    function collateralAssets() external view returns (uint256);

    /// @notice what may leave as deployable excess now (assets less the Redemption Reserve, less
    /// unclaimed distributions).
    function deployableExcess() external view returns (uint256);

    /// @notice pays `amount` of USDC to `to`: a Holder's account (or the pledge module for its
    /// Defaulted Amount), the Collateral Deposit Account, or the cost address.
    function agentTransfer(address to, uint256 amount) external;

    /// @notice pays deployable excess to Clear Lending's registered multisig (Part 5(a)). The vault
    /// re-checks that assets after it stay at or above the Redemption Reserve.
    function agentWithdrawExcess(address to, uint256 amount) external;
}

/// @dev The bonds' side (stage 2): the BondVault's outstanding list and each bond's Register data.
interface IAgentBondBook {
    function outstandingCount() external view returns (uint256);

    function outstandingAt(uint256 index) external view returns (uint256 bondId);

    /// @notice the amount due on a bond at `timestamp`: its Accreted Value then, or its Maturity
    /// Amount if matured by then.
    function amountDueAt(uint256 bondId, uint256 timestamp) external view returns (uint256);

    function holderOf(uint256 bondId) external view returns (address);

    /// @notice burns a bond paid in full through distributions (IV-10 §7.6). Only the
    /// `CollateralAgent` contract may call it.
    function burnPaid(uint256 bondId) external;
}

/// @dev The pledge module's side (stage 2: the Liquidator or its successor).
interface IAgentPledgeModule {
    /// @notice whether MB-05 §6.1 now permits enforcement against this pledged bond.
    function enforcementPermitted(address holder, uint256 bondId) external view returns (bool);

    /// @notice the Holder's MB-05 Defaulted Amount, as recorded on chain (decision 22).
    function defaultedAmountOf(address holder) external view returns (uint256);

    /// @notice applies `amount` of a distribution on `bondId`, already transferred to the module,
    /// to the Holder's Defaulted Amount.
    function applyDistribution(address holder, uint256 bondId, uint256 amount) external;
}

/// @dev Where a Holder is paid: a registered payment Successor (EarnControls), or the Holder.
interface IAgentPayee {
    function payeeOf(address holder) external view returns (address);
}
