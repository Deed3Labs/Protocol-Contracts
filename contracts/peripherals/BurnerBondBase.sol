// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/Accretion.sol";
import "./interfaces/IEarnControls.sol";
import "./interfaces/ICollateralAgent.sol";

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
    function traitOf(address collection, uint256 bondId, bytes32 key)
        external view returns (bytes memory);
    function traitsOf(address collection, uint256 bondId, bytes32[] calldata keys)
        external view returns (bytes[] memory);
    function keysOf(address collection, uint256 bondId) external view returns (bytes32[] memory);
    function nameOf(address collection, bytes32 key) external view returns (string memory);
}

/// @dev The BondVault as a collection uses it (Phase 2f).
interface IBondVaultSettlement {
    function reserveToken() external view returns (address);
    function inReserveShortfall() external view returns (bool);
    function recordPurchase(
        uint256 bondId,
        uint256 principal,
        uint256 faceValue,
        uint64 maturity,
        uint32 yieldBps,
        uint32 termDays
    ) external;
    function settle(uint256 bondId, address holder) external returns (uint256);
    function settleEarly(uint256 bondId, address to, uint256 presentValue) external;
    function settlePledged(uint256 bondId, address debtTo, uint256 toDebt, address holder)
        external returns (uint256 debtPaid);
    function settleAt(uint256 bondId, address debtTo, uint256 toDebt, address holder, uint256 amount)
        external returns (uint256 debtPaid);
    function roll(
        uint256 oldBondId,
        uint256 newBondId,
        uint256 newFaceValue,
        uint64 newMaturity,
        uint32 yieldBps,
        uint32 termDays,
        address holder,
        uint256 remainder
    ) external;
    function retireUnpaid(uint256 bondId) external;
    function setRollConfirmation(uint256 bondId, address holder, bool confirmed) external;
}

/// @dev The EarnControls roles a collection reads (granted with a Lending Board resolution).
interface IEarnRoles {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @title BurnerBondBase
/// @notice A BurnerBond collection's storage, events and the internals its two delegatecall modules
/// share (Phase 2f: the new collection).
/// @dev A collection is a clone of one implementation and is not upgradeable, so this layout only
/// has to agree between the three parts of one implementation: BurnerBond, BurnerBondPledges and
/// BurnerBondIssue, each of which inherits this contract and declares no storage of its own. Phase
/// 2f reshaped it (a new collection): every bond carries its Issue Yield, term, series, cost basis
/// and paid amount, and its roll notice.
abstract contract BurnerBondBase is
    Initializable,
    ERC1155Upgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable
{
    /// @notice A bond (Earn §1). Quantity one per id; ids are never reused.
    struct BondInfo {
        /// @dev the Maturity Amount
        uint256 faceValue;
        /// @dev this bond's Purchase Price: its Accreted Value at issue, floored to the cent
        uint256 purchasePrice;
        /// @dev the Purchase Price of the purchase it descends from, kept through rolls: what is
        /// taken off the Holder's Earn Products when it leaves (IV-02 §2.5(b))
        uint256 costBasis;
        /// @dev what was paid on it when it left: settlement, `payPledged`, buyback, `redeemAll` or
        /// the Collateral Agent's distributions
        uint256 paid;
        uint64 issuedAt;
        uint64 maturityDate;
        uint32 termDays;
        /// @dev the Issue Yield, annual compounding (bps)
        uint32 yieldBps;
        bool isRedeemed;
        /// @dev the offering exemption tag from the buyer's eligibility attestation (§6)
        bytes32 exemptionCode;
    }

    /// @notice A Roll Notice (Earn §4A; decision 11: the roll term and yield are recorded on chain).
    struct RollNotice {
        bytes32 noticeHash;
        uint64 deadline;
        uint32 termDays;
        uint32 yieldBps;
        bool confirmed;
        uint32 nonce;
    }

    /// @notice The Wallet Signature a purchase needs (Earn §1): the buyer's, over the quote it was
    /// shown. The term and yield are captured when the quote is given (decisions 11 and 31).
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address payer,address holder,uint256 maturityAmount,uint32 termDays,uint32 yieldBps,uint64 quotedAt,uint256 nonce)"
    );
    /// @notice The Holder's Roll Confirmation (Earn §4A; IV-01 §5.1): one bond, its notice hash and
    /// Roll Deadline; the domain adds the chain id and this contract. `nonce` is the bond's count of
    /// confirmations given or withdrawn, so a withdrawn confirmation cannot be replayed.
    bytes32 public constant CONFIRM_ROLL_TYPEHASH =
        keccak256("ConfirmRoll(uint256 bondId,bytes32 noticeHash,uint64 rollDeadline,uint32 nonce)");
    /// @notice The Holder's acceptance of a buyback price (Earn §4(a)).
    bytes32 public constant BUYBACK_TYPEHASH = keccak256("Buyback(uint256 bondId,uint256 price,uint256 deadline)");

    /// @notice EarnControls role that posts Roll Notices (plan ambiguity 8).
    bytes32 public constant ROLL_NOTICE_ROLE = keccak256("ROLL_NOTICE_ROLE");
    /// @notice EarnControls role whose two holders set the wind-down or illegality flag (Earn §4(c)).
    bytes32 public constant WIND_DOWN_ROLE = keccak256("WIND_DOWN_ROLE");

    /// @notice FIXED: a quote expires 15 minutes after it is given (Earn §1).
    uint64 public constant QUOTE_LIFETIME = 15 minutes;
    /// @notice FIXED: `redeemAll` waits 30 days after the wind-down flag (Earn §4(c)).
    uint64 public constant WIND_DOWN_DELAY = 30 days;
    /// @notice FIXED: a Roll Notice is posted at least 20 days before maturity (plan section 5).
    uint64 public constant NOTICE_LEAD = 20 days;
    /// @notice A liquidator proposed waits a week before it takes effect (audit M-6).
    uint256 internal constant LIQUIDATOR_DELAY = 7 days;

    /* ========== STORAGE ========== */

    uint256 internal _nextId;
    /// @notice The vault bond proceeds are paid into and settled from.
    IBondVaultSettlement public bondVault;
    /// @notice The pledge module's enforcement side: the Liquidator.
    address public liquidator;
    address public pendingLiquidator;
    uint256 public pendingLiquidatorReadyAt;
    /// @notice Reports whether a bond is pledged: the CollateralRegistry.
    IBondEncumbrance public encumbranceSource;
    bytes32 public collateralKind;
    /// @notice The shared Earn controls (decision 1).
    IEarnControls public controls;
    /// @notice The Collateral Agent (IV-10).
    ICollateralAgent public agent;
    /// @notice The reserve token (USDC) and its cent.
    IERC20 public underlyingToken;
    uint256 public cent;
    address public factory;
    string public collectionName;
    string public collectionSymbol;
    string public collectionDescription;
    /// @notice Where display traits live (ERC-7496), shared by every collection of a factory.
    IBondTraitStore public traitStore;
    /// @notice The IV-01 §4.12 legend: its hash, and a URI for its text (Earn §1).
    bytes32 public legendHash;
    string public legendURI;

    mapping(uint256 => BondInfo) internal _bonds;
    /// @notice Who holds each bond now (zero once it is burned).
    mapping(uint256 => address) public holderOf;
    mapping(uint256 => RollNotice) internal _notices;
    mapping(address => uint256[]) internal _bondIdsByCreator;
    mapping(bytes32 => bool) public quoteUsed;
    mapping(bytes32 => address) internal _proposerOf;

    /// @notice When the wind-down or illegality flag was set (0: not set).
    uint64 public windDownSetAt;
    /// @notice When `redeemAll` started (0: not started). Irreversible.
    uint64 public redeemAllFrom;
    bytes32 public windDownReason;

    uint256 public totalBondsMinted;
    uint256 public totalUSDCDeposited;
    uint256 public totalUSDCRedeemed;

    /* ========== EVENTS AND ERRORS ========== */

    event BondMinted(
        uint256 indexed bondId,
        address indexed holder,
        uint256 faceValue,
        uint256 maturityDate,
        uint32 termDays,
        uint32 yieldBps,
        uint256 purchasePrice,
        bytes32 exemptionCode
    );
    event BondRedeemed(uint256 indexed bondId, address indexed holder, uint256 amount);
    event BondRolled(
        uint256 indexed oldBondId,
        uint256 indexed newBondId,
        address indexed holder,
        uint256 newFaceValue,
        uint32 termDays,
        uint32 yieldBps,
        uint256 remainder
    );
    event BondTraitUpdated(uint256 indexed bondId, bytes32 indexed traitKey, bytes traitValue);
    event LiquidatorUpdated(address indexed liquidator);
    event LiquidatorProposed(address indexed liquidator, uint256 readyAt);
    event SourcesUpdated(address bondVault, address encumbranceSource, bytes32 kind, address controls, address agent);
    /// @notice A pledged bond was paid under its pledge payment term (IV-01 §4.9).
    event PledgePaid(
        uint256 indexed bondId, address indexed holder, uint256 amount, uint256 toDebt, uint256 toHolder
    );
    /// @notice A pledged bond that did not roll was settled under its Maturity Instruction (MB-05 §5.6).
    event PledgedMaturitySplit(uint256 indexed bondId, uint256 toDebt, uint256 toHolder);
    event RollNoticePosted(uint256 indexed bondId, bytes32 noticeHash, uint64 deadline, uint32 termDays, uint32 yieldBps);
    event RollConfirmed(uint256 indexed bondId, address indexed holder, bytes32 noticeHash);
    event RollConfirmationWithdrawn(uint256 indexed bondId, address indexed holder);
    event BondBoughtBack(uint256 indexed bondId, address indexed holder, address indexed buyer, uint256 price);
    event WindDownProposed(bool on, bytes32 reasonHash, address proposer);
    event WindDownSet(bool on, bytes32 reasonHash, address proposer, address approver);
    event RedeemAllStarted(uint64 at);
    event RedeemedUnderWindDown(uint256 indexed bondId, address indexed holder, uint256 amount, uint256 toDebt);
    event BondPaidThroughDistributions(uint256 indexed bondId, address indexed holder);

    /// @notice A pledged bond leaves only by `settle`, `payPledged` or `redeemAll` (MB-05 §§5.6, 7.3).
    error BurnerBondPledged(uint256 bondId);
    error BurnerBondNotPledgePayable(uint256 bondId);
    error BurnerBondNotSettleable(uint256 bondId);
    /// @notice Earn §1 transfer allowlist (FIXED).
    error BurnerBondTransferNotAllowed(address from, address to);
    error BurnerBondNoOperators();
    error BurnerBondUnknown(uint256 bondId);
    error BurnerBondBadQuote();
    error BurnerBondBadSignature();
    error BurnerBondNotAuthorized(address caller);
    error BurnerBondBadNotice(uint256 bondId);
    error BurnerBondNoticeClosed(uint256 bondId);
    error BurnerBondBuybackRefused(uint256 bondId);
    error BurnerBondWindDown();
    error BurnerBondNotWindingDown();
    error BurnerBondLiquidatorNotReady(uint256 readyAt);
    error BurnerBondModuleMismatch();
    error BurnerBondInvalidAddress();
    error BurnerBondAlreadyIssued();

    /* ========== SHARED INTERNALS ========== */

    /// @dev A bond's Accreted Value now (Earn §1; Accretion, rounded down): its Maturity Amount
    /// discounted at its Issue Yield over the whole days left, the Maturity Amount once matured,
    /// nothing once it has left.
    function _presentValue(uint256 bondId) internal view returns (uint256) {
        BondInfo storage b = _bonds[bondId];
        if (b.faceValue == 0 || b.isRedeemed) return 0;
        return Accretion.accretedValue(b.faceValue, b.yieldBps, b.maturityDate, block.timestamp);
    }

    function _isPledged(address holder, uint256 bondId) internal view returns (bool) {
        return address(encumbranceSource) != address(0)
            && encumbranceSource.isItemPledged(holder, collateralKind, bondId);
    }

    function _exists(uint256 bondId) internal view returns (BondInfo storage b, address holder) {
        b = _bonds[bondId];
        holder = holderOf[bondId];
        if (b.faceValue == 0 || b.isRedeemed || holder == address(0)) revert BurnerBondUnknown(bondId);
    }

    /// @dev Marks a bond paid and burns it. Every way a bond ends goes through here: settlement,
    /// `payPledged`, buyback, `redeemAll`, the Agent's distributions (Earn §1 allowlist (a)), and a
    /// roll's old bond (`exit` false: a roll keeps the cost basis).
    function _retire(uint256 bondId, address holder, uint256 paid, bool exit) internal {
        BondInfo storage b = _bonds[bondId];
        b.isRedeemed = true;
        b.paid = paid;
        totalUSDCRedeemed += paid;
        _burn(holder, bondId, 1);
        if (exit) controls.recordBondExit(holder, b.costBasis);
    }

    /// @dev Creates a bond for `holder`. One path for a purchase and a roll.
    function _issue(address holder, BondInfo memory info) internal returns (uint256 bondId) {
        bondId = _nextId;
        _nextId = bondId + 1;
        _bonds[bondId] = info;
        _bondIdsByCreator[holder].push(bondId);
        totalBondsMinted++;
        _mint(holder, bondId, 1, "");
        emit BondMinted(
            bondId, holder, info.faceValue, info.maturityDate, info.termDays, info.yieldBps, info.purchasePrice,
            info.exemptionCode
        );
    }

    /// @dev Once the Agent is named, a governed change runs only as the exact call it co-signed.
    function _change() internal {
        ICollateralAgent a = agent;
        if (address(a) != address(0)) a.consumeChange(keccak256(msg.data));
    }

    function _payee(address holder) internal view returns (address) {
        return controls.payeeOf(holder);
    }

    /// @notice Earn §1's transfer allowlist (FIXED), and the record of who holds each bond.
    /// @dev Mints and burns pass (allowlist (a): settlement, buyback, `payPledged`, `redeemAll`, the
    /// Agent's distributions, a roll). A transfer passes only between two Smart Accounts of the same
    /// Holder or on the Successor path, as EarnControls' `transferAllowed` answers (allowlist (b),
    /// (c)); never while pledged (allowlist (d): a pledge leaves the token in place). A transfer
    /// withdraws any roll confirmation: the new holder did not sign it.
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
            if (from != address(0) && to != address(0)) {
                if (_isPledged(from, bondId)) revert BurnerBondPledged(bondId);
                if (_bonds[bondId].isRedeemed || address(controls) == address(0) || !controls.transferAllowed(from, to)) {
                    revert BurnerBondTransferNotAllowed(from, to);
                }
                RollNotice storage n = _notices[bondId];
                if (n.confirmed) {
                    n.confirmed = false;
                    ++n.nonce;
                    bondVault.setRollConfirmation(bondId, from, false);
                    emit RollConfirmationWithdrawn(bondId, from);
                }
            }
            holderOf[bondId] = to;
        }
    }

    /// @dev Two different holders of an EarnControls `role` make the same call; the second applies it.
    function _pair(bytes32 action, bytes32 role) internal returns (bool done, address first) {
        if (!IEarnRoles(address(controls)).hasRole(role, msg.sender)) revert BurnerBondNotAuthorized(msg.sender);
        first = _proposerOf[action];
        if (first == msg.sender) revert BurnerBondNotAuthorized(msg.sender);
        if (first == address(0) || !IEarnRoles(address(controls)).hasRole(role, first)) {
            _proposerOf[action] = msg.sender;
            return (false, address(0));
        }
        delete _proposerOf[action];
        return (true, first);
    }
}
