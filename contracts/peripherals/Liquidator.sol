// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../core/interfaces/stable-credit/IStableCredit.sol";
import "../core/interfaces/stable-credit/ICreditIssuer.sol";
import "../core/interfaces/IESADepositVault.sol";

interface IClearUSDSeizable {
    function seize(address holder, address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ICollateralSeizureSink {
    function recordSeizure(address member, bytes32 kind, uint256 amount) external;
}

interface ITierSettler {
    function settleFromCollateral(address member, uint256 tierId, uint256 amount) external;
    function principalOf(address member, uint256 tierId) external view returns (uint256);
}

/// @title Liquidator
/// @notice Turns a defaulted member's pledged savings into a repayment of their own debt.
/// @dev This is why there is far less lost debt here than in the ledger this forked from. A
/// default normally orphans supply: the credits were spent and are in someone else's hands, the
/// obligation is written off, and the claims remain with nothing behind them. Seizing the
/// collateral first covers the position instead, so nothing is orphaned and no lost debt is
/// created -- which is the entire justification for RTD counting only what collateral does not
/// reach.
///
/// The path is deliberately mundane. Take the CLRUSD that was standing behind the credit, redeem
/// it at the vault for the USDC that always backed it, and repay the member's balance with that
/// USDC. Every step is a thing the system already does; nothing is invented for the default case,
/// which is the case least likely to be exercised before it matters.
///
/// Repayment goes through the ledger's public path, so the issuers are told and each absorbs its
/// share through the same cost-ordered waterfall an ordinary payment would follow. A liquidation
/// is not a special kind of money.
contract Liquidator is AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IStableCredit public stableCredit;
    IClearUSDSeizable public clrusd;
    IESADepositVault public vault;
    IERC20Upgradeable public reserveToken;
    ICollateralSeizureSink public collateralRegistry;

    uint256[43] private __gap;

    error LiquidatorInvalidAddress();
    error LiquidatorNotInDefault(address member, address issuer);
    error LiquidatorNothingToSeize(address member);

    event Liquidated(
        address indexed member,
        address indexed issuer,
        uint256 seized,
        uint256 redeemed,
        uint256 repaid
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address _stableCredit,
        address _clrusd,
        address _vault,
        address _reserveToken,
        address _collateralRegistry
    ) external initializer {
        if (
            admin == address(0) || _stableCredit == address(0) || _clrusd == address(0)
                || _vault == address(0) || _reserveToken == address(0)
                || _collateralRegistry == address(0)
        ) revert LiquidatorInvalidAddress();
        collateralRegistry = ICollateralSeizureSink(_collateralRegistry);
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        stableCredit = IStableCredit(_stableCredit);
        clrusd = IClearUSDSeizable(_clrusd);
        vault = IESADepositVault(_vault);
        reserveToken = IERC20Upgradeable(_reserveToken);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @notice covers a defaulted member's debt out of the collateral they pledged.
    /// @dev The default is checked against the issuer that holds the position rather than taken
    /// on the caller's word. The token bounds the seizure to what is actually encumbered, so the
    /// worst a mistaken call can do is repay somebody's debt with their own collateral early.
    /// @param member address of the defaulted member.
    /// @param issuer address of the issuer the member defaulted with.
    /// @return repaid amount of the member's balance settled.
    function liquidate(address member, address issuer, uint256 tierId, bytes32 kind)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256 repaid)
    {
        ICreditIssuer creditIssuer = ICreditIssuer(issuer);
        // `inDefault` reads the credit period, and expiring one deletes it, so a member
        // liquidated after the write-off would read as never having defaulted at all.
        if (!creditIssuer.inDefault(member) && !creditIssuer.hasDefaulted(member)) {
            revert LiquidatorNotInDefault(member, issuer);
        }

        // Never take more than the tier the collateral was pledged against still owes. Collateral
        // beyond that is still the member's; a default is not a forfeiture of everything they
        // saved.
        uint256 owed = ITierSettler(issuer).principalOf(member, tierId);
        uint256 available = clrusd.balanceOf(member);
        uint256 seizing = owed < available ? owed : available;
        if (seizing == 0) revert LiquidatorNothingToSeize(member);

        clrusd.seize(member, address(this), seizing);
        // The registry has to stop counting a pledge that is no longer there, or it will report
        // the position as covered by collateral somebody else now holds.
        collateralRegistry.recordSeizure(member, kind, seizing);

        // The CLRUSD was always backed one-for-one by USDC in the vault. Redeeming turns the
        // collateral back into the thing a repayment is actually made in.
        clrusd.approve(address(vault), seizing);
        uint256 redeemed = vault.redeem(address(reserveToken), seizing, address(this));

        // Settled against the tier the collateral backed rather than through the waterfall, which
        // would put it toward whichever tier costs most and leave this one drawn against a pledge
        // that no longer exists.
        reserveToken.forceApprove(issuer, redeemed);
        ITierSettler(issuer).settleFromCollateral(member, tierId, redeemed);
        repaid = redeemed;

        emit Liquidated(member, issuer, seizing, redeemed, repaid);
    }
}
