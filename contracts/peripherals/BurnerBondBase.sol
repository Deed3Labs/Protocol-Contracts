// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "../core/interfaces/burner-bond/IBurnerBond.sol";
import "../core/interfaces/burner-bond/IBurnerBondDeposit.sol";
import "../core/interfaces/burner-bond/IBurnerBondFactory.sol";

/// @dev The pledge module's record of bonds (the CollateralRegistry).
interface IBondEncumbrance {
    function isItemEncumbered(address holder, bytes32 kind, uint256 itemId)
        external view returns (bool);
    function isItemPledged(address holder, bytes32 kind, uint256 itemId) external view returns (bool);
    function rollItem(address member, bytes32 kind, uint256 oldItemId, uint256 newItemId) external;
    function releaseRetiredItem(address member, bytes32 kind, uint256 itemId) external;
}

/// @dev The pledge module's enforcement side (the Liquidator): whether MB-05 permits enforcement
/// against a bond, and where a payment on a pledged bond is applied (IV-01 §4.9, MB-05 §5.6).
interface IBondPledgeEnforcer {
    function pledgePaymentDue(address member, uint256 bondId)
        external view returns (bool due, address issuer, bool onDefault);
    function applyPledgePayment(address member, address issuer, bool onDefault, uint256 amount)
        external returns (uint256 applied);
    function maturityToDebt(address member, uint256 bondId, uint256 maturityAmount)
        external view returns (uint256 toDebt);
    function applyMaturityInstruction(address member, uint256 toDebt) external;
}

interface IBondTraitStore {
    function setTrait(uint256 bondId, bytes32 key, bytes calldata value) external;
    function setTraits(uint256 bondId, bytes32[] calldata keys, bytes[] calldata values) external;
    function setCustomName(bytes32 key, string calldata name) external;
    function removeTrait(uint256 bondId, bytes32 key) external;
    function traitOf(address collection, uint256 bondId, bytes32 key)
        external view returns (bytes memory);
    function traitsOf(address collection, uint256 bondId, bytes32[] calldata keys)
        external view returns (bytes[] memory);
    function keysOf(address collection, uint256 bondId) external view returns (bytes32[] memory);
    function nameOf(address collection, bytes32 key) external view returns (string memory);
}

interface IBondDiscountCurve {
    function curveOf(address collection) external view returns (uint8, uint256);
    function setCurve(uint8 curveType, uint256 parameter) external;
    function discountFor(
        address collection,
        uint256 timeToMaturity,
        uint256 minMaturity,
        uint256 maxMaturity,
        uint256 minDiscount,
        uint256 maxDiscount
    ) external view returns (uint256);
}

interface IBondVaultSettlement {
    function settle(uint256 bondId, address to) external returns (uint256);
    function settleEarly(uint256 bondId, address to, uint256 presentValue) external;
    function settlePledged(uint256 bondId, address debtTo, uint256 toDebt, address holder)
        external returns (uint256 debtPaid);
    function roll(uint256 oldBondId, uint256 newBondId, uint256 newFaceValue, uint64 newMaturity)
        external;
}

/// @title BurnerBondBase
/// @notice BurnerBond's storage and the few internals its pledge module shares with it.
/// @dev Phase 2e split BurnerBond in two so the pledged-bond terms (`payPledged` and the pledged
/// maturity split in `settle`) fit: BurnerBond itself, and BurnerBondPledges, a delegatecall module
/// its implementation pins in its constructor. Both inherit this contract and declare no storage of
/// their own, so the module runs against the collection's storage with the same layout.
///
/// A collection is a clone of one implementation and is not upgradeable, so this layout only has to
/// agree between the two halves of one implementation. A collection made by an earlier factory keeps
/// the code it was made with.
abstract contract BurnerBondBase is
    Initializable,
    ERC1155Upgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using Counters for Counters.Counter;

    /* ========== STATE VARIABLES ========== */

    // The `slither-disable` notes below are for BurnerBondPledges: it is a delegatecall module that
    // reads the collection's storage, which BurnerBond's `initialize` and setters write, so Slither
    // sees variables the module reads and never writes.

    /// @notice Counter for generating unique bond IDs
    Counters.Counter internal _bondIdCounter;

    /// @notice BurnerBondDeposit contract for financial operations
    IBurnerBondDeposit public burnerBondDeposit;

    /// @notice BurnerBondFactory contract (single source of truth for parameters)
    IBurnerBondFactory public factory;

    /// @notice Where the money to redeem a bond comes from.
    /// @dev The vault, never the AssurancePool. A bondholder is a creditor and must not be
    /// exposed to how the credit book is performing.
    // slither-disable-next-line uninitialized-state
    IBondVaultSettlement public bondVault;

    /// @notice The pledge module's enforcement side: the Liquidator.
    /// @dev It answers whether MB-05 permits enforcement against a pledged bond, computes the
    /// pledged maturity split, and applies both payments to the Holder's own debt. It can take no
    /// bond, set no price and send nothing anywhere the bond's terms do not: `payPledged` and
    /// `settle` decide the amount here, from this contract's own state, and burn the bond here.
    /// Naming one is still a power over every pledged bond, so a change waits `LIQUIDATOR_DELAY`.
    // slither-disable-next-line uninitialized-state
    address public liquidator;

    /// @notice Reports whether a given bond is pledged, and whether it is standing behind drawn
    /// credit: the CollateralRegistry.
    // slither-disable-next-line uninitialized-state
    IBondEncumbrance public encumbranceSource;
    /// @notice The collateral kind these bonds are pledged as.
    // slither-disable-next-line uninitialized-state
    bytes32 public collateralKind;

    /// @notice Bonds their holder has asked to be paid out rather than rolled at maturity.
    // slither-disable-next-line uninitialized-state
    mapping(uint256 => bool) public autoRollOptedOut;

    /// @notice How long a rolled bond runs for.
    uint256 public rollTerm;

    /// @notice Underlying token contract (can be USDC, WETH, etc.)
    IERC20 public underlyingToken;

    /// @notice Collection name (e.g., "WETH BurnerBonds")
    string public collectionName;

    /// @notice Collection symbol (e.g., "WETH-BB")
    string public collectionSymbol;

    /// @notice Collection description
    string public collectionDescription;

    /// @notice Shared pricing policy. See BondDiscountCurve for why it is not held inline.
    IBondDiscountCurve public discountCurveEngine;

    /// @notice Mapping from bond ID to bond information
    mapping(uint256 => IBurnerBond.BondInfo) public bonds;

    /// @notice Mapping from creator to number of bonds created
    mapping(address => uint256) public bondsCreatedBy;

    /// @notice Mapping from creator to array of bond IDs they created
    mapping(address => uint256[]) public bondIdsByCreator;

    /// @notice Mapping from bond ID to creator (for quick lookup)
    mapping(uint256 => address) public bondCreator;

    /// @notice Total bonds minted
    uint256 public totalBondsMinted;

    /// @notice Total USDC deposited through bond purchases
    uint256 public totalUSDCDeposited;

    /// @notice Total USDC redeemed through bond redemptions
    uint256 public totalUSDCRedeemed;

    /// @notice Where a bond's metadata lives.
    /// @dev Not here. All of it is display and none of it decides whether a bond can be issued or
    /// redeemed.
    // slither-disable-next-line uninitialized-state
    IBondTraitStore public traitStore;

    /// @notice A liquidator proposed and not yet in effect (audit M-6).
    address public pendingLiquidator;
    /// @notice When `pendingLiquidator` may take effect.
    uint256 public pendingLiquidatorReadyAt;

    /// @notice Who holds each bond now (quantity one per id; zero once it is burned).
    /// @dev `payPledged` and `settle` take only an id and may be called by anyone, so the bond
    /// itself has to know whose it is.
    mapping(uint256 => address) public holderOf;

    /* ========== EVENTS AND ERRORS ========== */

    event AutoRollOptOutSet(uint256 indexed bondId, bool optedOut);
    event BondRolled(uint256 indexed oldBondId, uint256 indexed newBondId, uint256 rolledValue);
    event LiquidatorUpdated(address indexed liquidator);
    event LiquidatorProposed(address indexed liquidator, uint256 readyAt);
    /// @notice A pledged bond was paid under its pledge payment term (IV-01 §4.9).
    /// @param amount its Accreted Value in that block, all of it paid.
    /// @param toDebt what was applied to the Holder's MB-05 secured debt.
    /// @param toHolder the surplus, paid in USDC to the Holder's Smart Account.
    event PledgePaid(
        uint256 indexed bondId, address indexed holder, uint256 amount, uint256 toDebt, uint256 toHolder
    );
    /// @notice A pledged bond that did not roll was settled under its Maturity Instruction
    /// (MB-05 §5.6): `toDebt` repaid the Holder's own Asset-Backed Drawn, `toHolder` was theirs.
    event PledgedMaturitySplit(uint256 indexed bondId, uint256 toDebt, uint256 toHolder);

    /// @notice A pledged bond leaves only by `settle` or `payPledged` (MB-05 §§5.6, 7.3).
    error BurnerBondPledged(uint256 bondId);
    /// @notice The pledge module does not request payment of this bond now.
    error BurnerBondNotPledgePayable(uint256 bondId);
    /// @notice Not a matured, unredeemed bond that pays out rather than rolls.
    error BurnerBondNotSettleable(uint256 bondId);

    /* ========== SHARED INTERNALS ========== */

    /// @dev What a bond is worth today: straight-line accretion from its price to its face value,
    /// face value at or after maturity, nothing once it is redeemed. See `presentValueOf`.
    function _presentValue(uint256 bondId) internal view returns (uint256) {
        IBurnerBond.BondInfo storage bond = bonds[bondId];
        if (bond.creator == address(0) || bond.isRedeemed) return 0;
        if (block.timestamp >= bond.maturityDate) return bond.faceValue;

        // Read, not reconstructed. Deriving the issue date by subtracting a standard term from
        // the maturity date is right only for bonds that happened to have that term.
        uint256 issuedAt = bond.issuedAt;
        if (block.timestamp <= issuedAt || bond.maturityDate <= issuedAt) {
            return bond.purchasePrice;
        }

        uint256 elapsed = block.timestamp - issuedAt;
        uint256 term = bond.maturityDate - issuedAt;
        uint256 earned = ((bond.faceValue - bond.purchasePrice) * elapsed) / term;
        return bond.purchasePrice + earned;
    }

    /// @dev Whether the pledge module records this bond as pledged by this holder. Not pledged
    /// when no module is named.
    function _isPledged(address holder, uint256 bondId) internal view returns (bool) {
        return address(encumbranceSource) != address(0)
            && encumbranceSource.isItemPledged(holder, collateralKind, bondId);
    }

    /// @dev Marks a bond paid and burns it. Every way a bond ends goes through here or `rollBond`:
    /// settlement (`redeemBond`, `settle`), and `payPledged` (Earn §1 allowlist (a)).
    function _retire(uint256 bondId, address holder, uint256 paid) internal {
        bonds[bondId].isRedeemed = true;
        bytes memory redeemedFlag = abi.encode(true);
        bytes memory redeemedAt = abi.encode(block.timestamp);
        traitStore.setTrait(bondId, keccak256("isRedeemed"), redeemedFlag);
        traitStore.setTrait(bondId, keccak256("redeemedAt"), redeemedAt);
        emit IBurnerBond.BondTraitUpdated(bondId, keccak256("isRedeemed"), redeemedFlag);
        emit IBurnerBond.BondTraitUpdated(bondId, keccak256("redeemedAt"), redeemedAt);
        totalUSDCRedeemed += paid;
        _burn(holder, bondId, 1);
    }

    /// @notice Keeps a pledged bond in place, refuses to move a redeemed one, and records who holds
    /// each bond.
    /// @dev Here rather than in BurnerBond so the pledge module's burns run it too.
    ///
    /// A pledged bond does not move until its pledge is released (MB-05: pledged positions leave
    /// only through `settle` or `payPledged`). Burns are exempt: those are the two exits, and
    /// rolling, which moves the pledge to the replacement. No operator is exempt any more; the
    /// Liquidator's seize-and-redeem path is gone (Phase 2e, founder answer G).
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 bondId = ids[i];

            if (from != address(0) && to != address(0) && _isPledged(from, bondId)) {
                revert BurnerBondPledged(bondId);
            }

            // Prevent transfers of redeemed bonds -- but not their destruction. Redemption marks
            // the bond redeemed and then burns it, and a burn is a transfer to the zero address.
            if (bonds[bondId].isRedeemed && to != address(0)) {
                revert("Cannot transfer redeemed bond");
            }

            holderOf[bondId] = to;

            // Update current holder trait on transfers (not minting or burning)
            if (from != address(0) && to != address(0)) {
                traitStore.setTrait(bondId, keccak256("currentHolder"), abi.encode(to));
                emit IBurnerBond.BondTraitUpdated(bondId, keccak256("currentHolder"), abi.encode(to));
            }
        }
    }
}
