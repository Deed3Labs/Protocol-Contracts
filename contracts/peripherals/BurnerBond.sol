// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./BurnerBondBase.sol";
import "./IExtensionKind.sol";

/// @title BurnerBond
/// @notice A BurnerBond collection (ERC-1155, quantity one per id): the issuer's Register of the
/// bonds (Earn §1; IV-01). Phase 2f's collection: Accreted Value compounds at each bond's Issue Yield
/// (R4), bonds are sold by quote at the Ladder's rate, roll only on the Holder's confirmation of a
/// posted Roll Notice (§4A), transfer only within Earn §1's allowlist, and leave only by settlement,
/// `payPledged`, buyback, `redeemAll` or the Collateral Agent's distributions.
/// @dev Storage is BurnerBondBase's. The rest of the collection runs in two delegatecall modules this
/// implementation pins (through the fallback): BurnerBondPledges (settlement and rolls, `payPledged`,
/// buyback, `redeemUnderWindDown`), which in turn reaches BurnerBondIssue (purchase by quote, roll
/// notices and confirmations, the wind-down flag, `burnPaid`). The joined ABI is in
/// `deploy/bondModules.ts` (`bondAt`).
///
/// **No discount curve, no auto-roll, no Holder-only roll, no Holder redemption** (C7, decision 8):
/// `calculateDiscount`, `mintBond`, `redeemBond`, `rollBond`, `setAutoRollOptOut` and `setRollTerm`
/// are gone. No operator approvals (Earn §1): `setApprovalForAll` reverts.
contract BurnerBond is BurnerBondBase {
    using SafeERC20 for IERC20;

    /// @notice Where settlement, `payPledged`, buyback and the rest run (BurnerBondPledges). Fixed for
    /// the life of this implementation, and so for every collection cloned from it.
    address public immutable pledges;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address pledges_) {
        _disableInitializers();
        if (IExtensionKind(pledges_).extensionKind() != keccak256("BurnerBondPledges.v2")) {
            revert BurnerBondModuleMismatch();
        }
        pledges = pledges_;
    }

    /// @notice sets a collection up (the factory, on cloning).
    /// @param legendHash_ the IV-01 §4.12 legend's hash; `legendURI_` where its text is
    function initialize(
        address factory_,
        address token,
        string memory uri_,
        string memory name_,
        string memory symbol_,
        string memory description_,
        address traitStore_,
        bytes32 legendHash_,
        string memory legendURI_
    ) external initializer {
        __ERC1155_init(uri_);
        __Ownable_init();
        __ReentrancyGuard_init();
        __EIP712_init("BurnerBond", "2");
        if (token == address(0)) revert BurnerBondInvalidAddress();
        factory = factory_;
        underlyingToken = IERC20(token);
        cent = 10 ** (uint256(IERC20Metadata(token).decimals()) - 2);
        collectionName = name_;
        collectionSymbol = symbol_;
        collectionDescription = description_;
        traitStore = IBondTraitStore(traitStore_);
        legendHash = legendHash_;
        legendURI = legendURI_;
        _nextId = 1;
    }

    /* ========== VIEWS ========== */

    function getBondInfo(uint256 bondId) external view returns (BondInfo memory) {
        if (_bonds[bondId].faceValue == 0) revert BurnerBondUnknown(bondId);
        return _bonds[bondId];
    }

    function rollNotice(uint256 bondId) external view returns (RollNotice memory) {
        return _notices[bondId];
    }

    function isBondMature(uint256 bondId) external view returns (bool) {
        return _bonds[bondId].faceValue != 0 && block.timestamp >= _bonds[bondId].maturityDate;
    }

    function getBondIdsByCreator(address holder) external view returns (uint256[] memory) {
        return _bondIdsByCreator[holder];
    }

    /// @notice a bond's Accreted Value in this block (Earn §1): its Present Value under MB-05, what
    /// it counts for as collateral, what `payPledged` and `redeemAll` pay, and a buyback's ceiling.
    function accretedValue(uint256 bondId) external view returns (uint256) {
        return _presentValue(bondId);
    }

    /// @notice the same figure, under the name the pledge module's valuer reads.
    function presentValueOf(uint256 bondId) external view returns (uint256) {
        return _presentValue(bondId);
    }

    function getBondStatistics() external view returns (uint256, uint256, uint256) {
        return (totalBondsMinted, totalUSDCDeposited, totalUSDCRedeemed);
    }

    function name() external view returns (string memory) {
        return collectionName;
    }

    function symbol() external view returns (string memory) {
        return collectionSymbol;
    }

    function description() external view returns (string memory) {
        return collectionDescription;
    }

    function getUnderlyingToken() external view returns (address) {
        return address(underlyingToken);
    }

    /// @notice Collection metadata (ERC-7572), with the IV-01 §4.12 legend.
    function contractURI() external view returns (string memory) {
        return string(
            abi.encodePacked(
                'data:application/json;utf8,{"name":"', collectionName, '","symbol":"', collectionSymbol,
                '","description":"', collectionDescription, '","legend":"', legendURI, '"}'
            )
        );
    }

    /* ========== DISPLAY TRAITS (ERC-7496) ========== */

    function getBondTraitValue(uint256 bondId, bytes32 traitKey) external view returns (bytes memory) {
        return traitStore.traitOf(address(this), bondId, traitKey);
    }

    function getBondTraitValues(uint256 bondId, bytes32[] calldata traitKeys) external view returns (bytes[] memory) {
        return traitStore.traitsOf(address(this), bondId, traitKeys);
    }

    function getBondTraitKeys(uint256 bondId) external view returns (bytes32[] memory) {
        return traitStore.keysOf(address(this), bondId);
    }

    function getBondTraitName(bytes32 traitKey) external view returns (string memory) {
        return traitStore.nameOf(address(this), traitKey);
    }

    /// @notice a display trait. Display only: nothing here decides whether a bond pays or rolls.
    function setBondTrait(uint256 bondId, bytes32 traitKey, bytes memory traitValue) external onlyOwner {
        traitStore.setTrait(bondId, traitKey, traitValue);
        emit BondTraitUpdated(bondId, traitKey, traitValue);
    }

    /// @notice no third-party operators (Earn §1).
    function setApprovalForAll(address, bool) public pure override {
        revert BurnerBondNoOperators();
    }

    /* ========== ADMIN (the Earn timelock; co-signed by the Agent once it is named) ========== */

    /// @notice where this collection's bond ids start, set before it has sold anything.
    /// @dev The BondVault and the CollateralRegistry key a bond by its id alone, so two collections
    /// sharing them must never issue the same one.
    function setFirstBondId(uint256 firstId) external onlyOwner {
        if (totalBondsMinted != 0) revert BurnerBondAlreadyIssued();
        if (firstId < 1) revert BurnerBondInvalidAddress();
        _nextId = firstId;
    }

    /// @notice names the vault, the pledge registry and kind, the Earn controls and the Collateral
    /// Agent. A change (IV-10 §4.5): co-signed by the Agent once it is named.
    function setSources(address vault_, address encumbrance_, bytes32 kind_, address controls_, address agent_)
        external
        onlyOwner
    {
        _change();
        if (vault_ == address(0) || controls_ == address(0)) revert BurnerBondInvalidAddress();
        if (IBondVaultSettlement(vault_).reserveToken() != address(underlyingToken)) revert BurnerBondInvalidAddress();
        bondVault = IBondVaultSettlement(vault_);
        encumbranceSource = IBondEncumbrance(encumbrance_);
        collateralKind = kind_;
        controls = IEarnControls(controls_);
        agent = ICollateralAgent(agent_);
        emit SourcesUpdated(vault_, encumbrance_, kind_, controls_, agent_);
    }

    /// @notice names the pledge module's enforcement side (the Liquidator), after a delay (audit
    /// M-6). At once only to remove it, or for the first one before any bond exists.
    function setLiquidator(address liquidator_) external onlyOwner {
        if (liquidator_ == address(0) || (liquidator == address(0) && totalBondsMinted == 0)) {
            liquidator = liquidator_;
            pendingLiquidator = address(0);
            pendingLiquidatorReadyAt = 0;
            emit LiquidatorUpdated(liquidator_);
            return;
        }
        pendingLiquidator = liquidator_;
        pendingLiquidatorReadyAt = block.timestamp + LIQUIDATOR_DELAY;
        emit LiquidatorProposed(liquidator_, pendingLiquidatorReadyAt);
    }

    /// @notice applies a proposed liquidator once its delay has passed.
    function executeLiquidatorChange() external onlyOwner {
        uint256 readyAt = pendingLiquidatorReadyAt;
        if (readyAt == 0 || block.timestamp < readyAt) revert BurnerBondLiquidatorNotReady(readyAt);
        liquidator = pendingLiquidator;
        pendingLiquidator = address(0);
        pendingLiquidatorReadyAt = 0;
        emit LiquidatorUpdated(liquidator);
    }

    /// @notice recovers a token sent here by mistake; never the reserve token.
    function emergencyRecover(address token, uint256 amount) external onlyOwner {
        if (token == address(underlyingToken)) revert BurnerBondInvalidAddress();
        IERC20(token).safeTransfer(owner(), amount);
    }

    function setURI(string memory newuri) external onlyOwner {
        _setURI(newuri);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == 0xaf332f3e || super.supportsInterface(interfaceId);
    }

    /* ========== THE MODULES ========== */

    /// @dev Everything else runs in BurnerBondPledges (and through it BurnerBondIssue) against this
    /// storage, and returns or reverts exactly as it did.
    fallback() external {
        address target = pledges;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
