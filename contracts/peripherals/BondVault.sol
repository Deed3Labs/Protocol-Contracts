// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/// @dev The CollateralRegistry's answer to "is this bond spoken for".
interface IBondEncumbranceSource {
    function isItemEncumbered(address holder, bytes32 kind, uint256 itemId) external view returns (bool);
}

/// @title BondVault
/// @notice Where bond proceeds live, and what keeps them senior.
/// @dev Bondholders lent money and are creditors. Proceeds used to go into the AssurancePool's
/// excess reserve and redemptions came back out of the same pool, which put bondholder principal
/// to work absorbing other people's defaults and left redemption competing with the losses it was
/// funding. A bond could fail to pay because the credit book had a bad quarter -- the one thing a
/// zero-coupon bond is not supposed to do.
///
/// The fix is not a rule about where to send money. It is that the money is somewhere else.
///
/// **The redemption reserve is derived, not decided.** It is whatever is coming due inside the
/// window, floored at a share of everything outstanding, so it rises on its own as maturities
/// approach and nobody has to notice. An operator cannot lower it below what is owed soon,
/// because the figure is not theirs to set.
///
/// **The Safe takes only the deployable excess.** Money does have to reach human control -- a
/// contract cannot wire dollars to a card processor or originate a lease -- but sending proceeds
/// straight to a multisig turns the redemption reserve into a policy somebody has to remember.
/// Here it is a subtraction that happens before the withdrawal is allowed.
contract BondVault is AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice The bond contract. Records purchases and settles maturities.
    bytes32 public constant BOND_ROLE = keccak256("BOND_ROLE");
    /// @notice The multisig. May take what the vault does not owe soon.
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    uint256 internal constant BPS = 10_000;

    /// @dev Maturity buckets (audit X-10): one per UTC day from `BUCKET_EPOCH`, summed with a
    /// Fenwick tree so "face due within a window" costs log2(BUCKETS) reads instead of one per
    /// outstanding bond. `faceDueWithin` used to walk every bond on every RTD read, and about
    /// 2,100 minimum-face bonds pushed the member repayment path past the block gas limit.
    uint256 internal constant BUCKET_EPOCH = 1_577_836_800; // 2020-01-01T00:00:00Z
    /// @dev 2^15 days: maturities up to early 2109.
    uint256 internal constant BUCKETS = 32_768;

    /// @notice What the vault owes on one bond.
    struct Obligation {
        uint256 principal;
        uint256 faceValue;
        uint64 maturity;
        bool settled;
    }

    IERC20Upgradeable public reserveToken;

    /// @dev bond id => obligation
    mapping(uint256 => Obligation) public obligations;
    uint256[] private outstanding;
    /// @dev bond id => index in `outstanding`, plus one
    mapping(uint256 => uint256) private outstandingIndex;

    /// @notice Principal taken in across every bond, settled or not.
    uint256 public totalPrincipal;
    /// @notice Face value still owed.
    uint256 public totalFaceOutstanding;
    /// @notice Face value already paid.
    uint256 public totalFaceSettled;

    /// @notice How far ahead the reserve looks.
    uint64 public reserveWindow;
    /// @notice Floor on the reserve, as a share of face outstanding.
    uint256 public minReserveBps;
    /// @dev Bounds on that floor, so it stays a parameter rather than a decision.
    uint256 public constant MIN_RESERVE_FLOOR_BPS = 2_000;
    uint256 public constant MAX_RESERVE_FLOOR_BPS = 10_000;

    /* ========== ADDED AFTER DEPLOYMENT: five slots from the gap ========== */

    /// @notice The co-op's treasury, the Safe. Pays a bond the vault cannot, up to the allowance it
    /// has given this vault.
    address public treasury;
    /// @dev Retired (section 13): the vault holds no AssurancePool address and never calls one.
    /// The slot stays so nothing below it moves.
    /// @custom:oz-renamed-from assurancePool
    address private retiredAssurancePool;
    /// @notice The payout pool, which may borrow the deployable excess for a claim that has come due.
    address public payoutPool;
    /// @notice Reserve tokens out with the payout pool, repaid with carry.
    uint256 public lentToPayoutPool;
    /// @dev Retired with the pool's loans (section 13, decision 4). A loan the old Base Sepolia
    /// pool made is not repaid to the new one: the old pool is retired with its books.
    /// @custom:oz-renamed-from owedToReserve
    uint256 private retiredOwedToReserve;

    /* ========== ADDED AFTER DEPLOYMENT: two more slots from the gap ========== */

    /// @notice What reports a bond pledged and backing drawn credit -- the CollateralRegistry.
    /// @dev A collection exempts burns from its own pledge check, so a holder could redeem a matured
    /// bond still holding up their credit line and take its collateral out from under it. Every
    /// redemption pays through `settle`, and this is where it is refused. Unset, nothing is checked.
    IBondEncumbranceSource public encumbranceSource;
    /// @notice The collateral kind bonds are pledged as.
    bytes32 public collateralKind;

    /* ========== ADDED BY THE AUDIT FIXES: two slots from the gap ========== */

    /// @dev Fenwick tree over maturity day (1-indexed): face value outstanding per bucket.
    mapping(uint256 => uint256) private dueTree;
    /// @dev bond id => its bucket, plus nothing: buckets are already 1-indexed, so 0 means "not
    /// bucketed" (a bond recorded before the X-10 fix, until `bucketOutstanding` picks it up).
    mapping(uint256 => uint256) private bucketOf;

    /* ========== ADDED IN PHASE 2E: three slots from the gap ========== */

    /// @notice bond id => what a settled pledged bond still owes its Holder, because the vault and
    /// the treasury together could not pay all of it at settlement (the settlement-shortfall rule).
    mapping(uint256 => uint256) public settlementOwed;
    /// @notice bond id => the Holder that amount is owed to. Fixed at settlement; nobody re-points it.
    mapping(uint256 => address) public settlementPayee;
    /// @notice Everything recorded in `settlementOwed`. Due now, so it sits on top of the reserve.
    uint256 public totalSettlementOwed;

    uint256[30] private __gap;

    error BondVaultInvalidAddress();
    error BondVaultUnknownBond(uint256 bondId);
    error BondVaultBondExists(uint256 bondId);
    error BondVaultAlreadySettled(uint256 bondId);
    error BondVaultReserveFloorOutOfBounds(uint256 bps);
    error BondVaultWouldBreachReserve(uint256 deployable, uint256 requested);
    error BondVaultInsufficientFunds(uint256 held, uint256 required);
    /// @dev Pledged and backing drawn credit: roll it, or pay the credit down first.
    error BondVaultBondPledged(uint256 bondId);
    /// @dev The maturity falls outside the bucketed range.
    error BondVaultMaturityOutOfRange(uint64 maturity);
    /// @dev Only the tracked borrower may repay (audit M-8).
    error BondVaultNotTrackedBorrower(address caller);
    /// @dev The payout pool cannot be re-pointed while it owes the vault.
    error BondVaultLoanOutstanding(uint256 outstanding);
    /// @dev A pledged split asked for more to the debt than the bond pays.
    error BondVaultBadSplit(uint256 toDebt, uint256 faceValue);
    /// @dev No settlement shortfall is recorded for this bond.
    error BondVaultNothingOwed(uint256 bondId);

    event PurchaseRecorded(uint256 indexed bondId, uint256 principal, uint256 faceValue, uint64 maturity);
    event Settled(uint256 indexed bondId, address indexed to, uint256 faceValue);
    event Rolled(
        uint256 indexed oldBondId,
        uint256 indexed newBondId,
        uint256 rolledPrincipal,
        uint256 newFaceValue,
        uint64 newMaturity
    );
    event SettledEarly(
        uint256 indexed bondId, address indexed to, uint256 presentValue, uint256 faceValue
    );
    event DeployableWithdrawn(address indexed to, uint256 amount);
    event ReserveTermsUpdated(uint64 window, uint256 minReserveBps);
    event BackstopsUpdated(address indexed treasury, address indexed payoutPool);
    event EncumbranceSourceUpdated(address indexed source, bytes32 kind);
    event DrewFromTreasury(uint256 amount);
    event LentToPayoutPool(uint256 amount, uint256 outstanding);
    event RepaidFromPayoutPool(uint256 amount, uint256 outstanding);
    /// @notice A payout-pool repayment carried carry on top of principal (audit X-17).
    event InterestReceived(uint256 principal, uint256 interest);
    /// @notice A pledged bond settled under its Maturity Instruction: `toDebt` to the pledge
    /// module for the Holder's own debt, `paidToHolder` to the Holder now.
    event SettledPledged(uint256 indexed bondId, address indexed holder, uint256 toDebt, uint256 paidToHolder);
    /// @notice The vault and the treasury could not pay all of `toHolder`; `owed` is recorded
    /// against the bond and paid by `completeSettlement` when funds arrive.
    event SettlementShortfall(uint256 indexed bondId, address indexed holder, uint256 toHolder, uint256 paid, uint256 owed);
    /// @notice Some or all of a recorded settlement shortfall was paid.
    event SettlementCompleted(uint256 indexed bondId, address indexed holder, uint256 paid, uint256 stillOwed);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address _reserveToken, uint64 _reserveWindow)
        external
        initializer
    {
        if (admin == address(0) || _reserveToken == address(0)) {
            revert BondVaultInvalidAddress();
        }
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        reserveToken = IERC20Upgradeable(_reserveToken);
        reserveWindow = _reserveWindow;
        // Roughly seventy deployable to thirty held, before the window pushes it higher.
        minReserveBps = 3_000;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    function held() public view returns (uint256) {
        return reserveToken.balanceOf(address(this));
    }

    function outstandingCount() external view returns (uint256) {
        return outstanding.length;
    }

    function outstandingBonds() external view returns (uint256[] memory) {
        return outstanding;
    }

    /// @notice face value falling due inside a window, overdue face included.
    /// @dev Read from the maturity buckets (audit X-10), so the cost no longer grows with the
    /// number of bonds. Day granularity: a bond maturing later on the horizon's own day counts as
    /// due, which can only overstate the reserve, never understate it.
    function faceDueWithin(uint64 window) public view returns (uint256 due) {
        uint256 i = _bucketFor(block.timestamp + window);
        if (i > BUCKETS) i = BUCKETS;
        while (i > 0) {
            due += dueTree[i];
            i -= i & (~i + 1);
        }
    }

    /// @notice buckets bonds recorded before the X-10 fix. Permissionless and idempotent.
    /// @param start index into the outstanding list to start at
    /// @param count how many to look at
    function bucketOutstanding(uint256 start, uint256 count) external returns (uint256 bucketed) {
        uint256 end = start + count;
        if (end > outstanding.length) end = outstanding.length;
        for (uint256 j = start; j < end; j++) {
            uint256 bondId = outstanding[j];
            if (bucketOf[bondId] != 0) continue;
            Obligation storage obligation = obligations[bondId];
            _addDue(bondId, obligation.maturity, obligation.faceValue);
            bucketed++;
        }
    }

    function _bucketFor(uint256 timestamp) private pure returns (uint256) {
        // Anything before the epoch (only possible in tests) sits in the first bucket.
        return timestamp <= BUCKET_EPOCH ? 1 : (timestamp - BUCKET_EPOCH) / 1 days + 1;
    }

    function _addDue(uint256 bondId, uint64 maturity, uint256 face) private {
        uint256 i = _bucketFor(maturity);
        if (i > BUCKETS) revert BondVaultMaturityOutOfRange(maturity);
        bucketOf[bondId] = i;
        while (i <= BUCKETS) {
            dueTree[i] += face;
            i += i & (~i + 1);
        }
    }

    function _removeDue(uint256 bondId, uint256 face) private {
        uint256 i = bucketOf[bondId];
        if (i == 0) return; // never bucketed: nothing to take out
        delete bucketOf[bondId];
        while (i <= BUCKETS) {
            dueTree[i] -= face;
            i += i & (~i + 1);
        }
    }

    /// @notice what the vault must keep back.
    /// @dev The larger of what is coming due inside the window and a floor across everything
    /// outstanding. It rises on its own as maturities approach, which is the point: a reserve
    /// that has to be raised by hand is one that gets raised late.
    /// A recorded settlement shortfall is owed now, so it sits on top of either.
    function requiredReserve() public view returns (uint256) {
        uint256 nearTerm = faceDueWithin(reserveWindow);
        uint256 floor = (totalFaceOutstanding * minReserveBps) / BPS;
        return (nearTerm > floor ? nearTerm : floor) + totalSettlementOwed;
    }

    /// @notice what the Safe may take.
    function deployableExcess() public view returns (uint256) {
        uint256 balance = held();
        uint256 reserve = requiredReserve();
        return balance > reserve ? balance - reserve : 0;
    }

    /// @notice what the treasury can put up for a bond right now: its allowance to this vault,
    /// capped at what it holds.
    function treasuryAvailable() public view returns (uint256) {
        if (treasury == address(0)) return 0;
        uint256 allowed = reserveToken.allowance(treasury, address(this));
        uint256 balance = reserveToken.balanceOf(treasury);
        return allowed < balance ? allowed : balance;
    }

    /// @notice face value due inside the window that neither the vault nor the treasury can pay.
    /// @dev What a bond the vault cannot pay is waiting on. The co-op's AssurancePool never covers
    /// it (section 13): bonds rely on the vault's own reserves and the treasury.
    function uncoveredNearTerm() external view returns (uint256) {
        uint256 due = faceDueWithin(reserveWindow);
        uint256 have = held() + treasuryAvailable();
        return due > have ? due - have : 0;
    }

    /// @notice whether the vault can pay everything due inside the window.
    /// @dev Solvency in aggregate is not the same as solvency on timing, which is why this asks
    /// about the window rather than the total.
    function coversNearTermMaturities() external view returns (bool) {
        return held() >= faceDueWithin(reserveWindow);
    }

    /* ========== BOND LIFECYCLE ========== */

    /// @notice records a purchase and the obligation it creates.
    /// @dev The proceeds arrive here rather than in the AssurancePool, which is the whole change.
    /// The face value is booked at the same moment, so the vault knows what it owes from the
    /// instant it holds the money rather than discovering it at maturity.
    function recordPurchase(uint256 bondId, uint256 principal, uint256 faceValue, uint64 maturity)
        external
        onlyRole(BOND_ROLE)
    {
        if (obligations[bondId].faceValue != 0) revert BondVaultBondExists(bondId);

        obligations[bondId] =
            Obligation({principal: principal, faceValue: faceValue, maturity: maturity, settled: false});
        outstanding.push(bondId);
        outstandingIndex[bondId] = outstanding.length;
        _addDue(bondId, maturity, faceValue);

        totalPrincipal += principal;
        totalFaceOutstanding += faceValue;
        emit PurchaseRecorded(bondId, principal, faceValue, maturity);
    }

    /// @notice pays a matured bond.
    /// @dev Paid out of the vault's own holdings first, then the treasury up to its allowance.
    /// Never the AssurancePool (addendum 12.11): a bondholder is not exposed to how the credit book
    /// performs, and the AssurancePool is not exposed to bond redemptions.
    function settle(uint256 bondId, address to) external onlyRole(BOND_ROLE) returns (uint256) {
        Obligation storage obligation = obligations[bondId];
        if (obligation.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (obligation.settled) revert BondVaultAlreadySettled(bondId);
        if (
            address(encumbranceSource) != address(0)
                && encumbranceSource.isItemEncumbered(to, collateralKind, bondId)
        ) revert BondVaultBondPledged(bondId);

        uint256 faceValue = obligation.faceValue;
        _cover(faceValue);

        obligation.settled = true;
        totalFaceOutstanding -= faceValue;
        totalFaceSettled += faceValue;
        _removeOutstanding(bondId);
        _removeDue(bondId, faceValue);

        reserveToken.safeTransfer(to, faceValue);
        emit Settled(bondId, to, faceValue);
        return faceValue;
    }

    /// @notice pays a matured pledged bond under its Maturity Instruction (MB-05 §5.6).
    /// @dev `toDebt` first, in full, to the pledge module that applies it to the Holder's own
    /// Asset-Backed Drawn; it is a repayment of their debt and has to reach the ledger as one. Then
    /// `toHolder`, the rest, to the Holder. Only `toHolder` is subject to the settlement-shortfall
    /// rule: if the vault and the treasury together hold less, the Holder gets what there is and
    /// the remainder is recorded against the bond and paid by `completeSettlement`. Nothing is
    /// locked or held for the Holder; what is owed to them is owed to them. If even `toDebt`
    /// cannot be covered, nothing moves.
    /// @param bondId the bond
    /// @param debtTo the pledge module
    /// @param toDebt the part applied to the Holder's debt
    /// @param holder the Holder, who is paid the rest
    function settlePledged(uint256 bondId, address debtTo, uint256 toDebt, address holder)
        external
        onlyRole(BOND_ROLE)
    {
        Obligation storage obligation = obligations[bondId];
        uint256 faceValue = obligation.faceValue;
        if (faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (obligation.settled) revert BondVaultAlreadySettled(bondId);
        if (toDebt > faceValue) revert BondVaultBadSplit(toDebt, faceValue);

        uint256 have = _coverUpTo(faceValue);
        if (have < toDebt) revert BondVaultInsufficientFunds(have, toDebt);
        uint256 toHolder = faceValue - toDebt;
        uint256 paid = have - toDebt < toHolder ? have - toDebt : toHolder;

        obligation.settled = true;
        totalFaceOutstanding -= faceValue;
        totalFaceSettled += faceValue;
        _removeOutstanding(bondId);
        _removeDue(bondId, faceValue);

        if (paid < toHolder) {
            uint256 owed = toHolder - paid;
            settlementOwed[bondId] = owed;
            settlementPayee[bondId] = holder;
            totalSettlementOwed += owed;
            emit SettlementShortfall(bondId, holder, toHolder, paid, owed);
        }
        if (toDebt > 0) reserveToken.safeTransfer(debtTo, toDebt);
        if (paid > 0) reserveToken.safeTransfer(holder, paid);
        emit SettledPledged(bondId, holder, toDebt, paid);
    }

    /// @notice pays what a settlement shortfall still owes, as far as the vault and the treasury
    /// can. Anyone may call it; the money goes only to the Holder recorded at settlement.
    function completeSettlement(uint256 bondId) external returns (uint256 paid) {
        uint256 owed = settlementOwed[bondId];
        if (owed < 1) revert BondVaultNothingOwed(bondId);
        paid = _coverUpTo(owed); // never more than owed
        if (paid < 1) revert BondVaultInsufficientFunds(0, owed);
        settlementOwed[bondId] = owed - paid;
        totalSettlementOwed -= paid;
        address holder = settlementPayee[bondId];
        reserveToken.safeTransfer(holder, paid);
        emit SettlementCompleted(bondId, holder, paid, owed - paid);
    }

    /// @notice pays a bond before its maturity, at what it is worth today.
    /// @dev The obligation goes at face value -- the vault stops owing the whole of it -- while
    /// only the present value is paid out. What is left is the interest the term did not run for,
    /// and it stays here rather than being handed to somebody who did not wait for it.
    ///
    /// Since Phase 2e the only caller is a collection's `payPledged`, paying a pledged bond under
    /// its pledge payment term (IV-01 §4.9) to the pledge module, which applies it to the Holder's
    /// secured debt. The vault pays the whole Accreted Value or reverts: never less.
    /// @param bondId the bond
    /// @param to who is paid
    /// @param presentValue what the bond is worth today
    function settleEarly(uint256 bondId, address to, uint256 presentValue)
        external
        onlyRole(BOND_ROLE)
    {
        Obligation storage obligation = obligations[bondId];
        if (obligation.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (obligation.settled) revert BondVaultAlreadySettled(bondId);

        _cover(presentValue);

        uint256 faceValue = obligation.faceValue;
        obligation.settled = true;
        totalFaceOutstanding -= faceValue;
        totalFaceSettled += faceValue;
        _removeOutstanding(bondId);
        _removeDue(bondId, faceValue);

        reserveToken.safeTransfer(to, presentValue);
        emit SettledEarly(bondId, to, presentValue, faceValue);
    }

    /// @notice rolls a matured obligation into a new one without paying it out.
    /// @dev A pledged bond that simply matures leaves the member's limit contracting hard on the
    /// day it does, and if they have already spent the proceeds there is nothing to replace it
    /// with. Rolling keeps the position instead.
    ///
    /// No cash moves. The vault already holds what the matured bond was worth, and that is what
    /// buys the replacement -- which is why the new face value is larger: the same money, bought
    /// at a discount again.
    function roll(uint256 oldBondId, uint256 newBondId, uint256 newFaceValue, uint64 newMaturity)
        external
        onlyRole(BOND_ROLE)
    {
        Obligation storage matured = obligations[oldBondId];
        if (matured.faceValue == 0) revert BondVaultUnknownBond(oldBondId);
        if (matured.settled) revert BondVaultAlreadySettled(oldBondId);
        if (obligations[newBondId].faceValue != 0) revert BondVaultBondExists(newBondId);

        uint256 rolled = matured.faceValue;
        matured.settled = true;
        totalFaceOutstanding -= rolled;
        _removeOutstanding(oldBondId);
        _removeDue(oldBondId, rolled);

        obligations[newBondId] = Obligation({
            principal: rolled,
            faceValue: newFaceValue,
            maturity: newMaturity,
            settled: false
        });
        outstanding.push(newBondId);
        outstandingIndex[newBondId] = outstanding.length;
        _addDue(newBondId, newMaturity, newFaceValue);
        totalFaceOutstanding += newFaceValue;

        emit Rolled(oldBondId, newBondId, rolled, newFaceValue, newMaturity);
    }

    /* ========== TREASURY ========== */

    /// @notice takes what the vault does not owe soon.
    /// @dev The only way money leaves except by paying a bondholder. The reserve is subtracted
    /// before the request is considered, so there is no ordering in which the Safe empties the
    /// vault and the redemption reserve is restored afterwards.
    function withdrawDeployable(uint256 amount, address to) external onlyRole(TREASURY_ROLE) {
        if (to == address(0)) revert BondVaultInvalidAddress();
        uint256 deployable = deployableExcess();
        if (amount > deployable) revert BondVaultWouldBreachReserve(deployable, amount);

        reserveToken.safeTransfer(to, amount);
        emit DeployableWithdrawn(to, amount);
    }

    /* ========== BACKSTOPS ========== */

    /// @dev Makes sure the vault holds `amount` before it pays a bondholder: its own holdings, then
    /// the treasury up to its allowance. Reverts when both together cannot, and then nothing has
    /// moved. The AssurancePool is not asked (addendum 12.11): no redemption path draws on it.
    function _cover(uint256 amount) private {
        uint256 balance = _coverUpTo(amount);
        if (balance < amount) revert BondVaultInsufficientFunds(balance, amount);
    }

    /// @dev Draws on the treasury, up to its allowance, for whatever of `amount` the vault does not
    /// hold, and returns what the vault holds afterwards, capped at `amount`.
    function _coverUpTo(uint256 amount) private returns (uint256) {
        uint256 balance = held();
        if (balance >= amount) return amount;
        uint256 short = amount - balance;

        uint256 fromTreasury = treasuryAvailable();
        if (fromTreasury > short) fromTreasury = short;
        if (fromTreasury > 0) {
            reserveToken.safeTransferFrom(treasury, address(this), fromTreasury);
            emit DrewFromTreasury(fromTreasury);
        }
        balance = held();
        return balance < amount ? balance : amount;
    }

    /// @notice lends the deployable excess for a payout claim that has come due.
    /// @dev After the yield pool and before the treasury. Only the excess, never the redemption
    /// reserve, so a bondholder is no worse off for it; and it comes back with carry.
    /// @param amount what the payout pool is short.
    /// @return lent what the vault could put up, which may be nothing.
    function lendToPayoutPool(uint256 amount) external returns (uint256 lent) {
        if (payoutPool == address(0) || _msgSender() != payoutPool) revert BondVaultInvalidAddress();
        uint256 deployable = deployableExcess();
        lent = amount < deployable ? amount : deployable;
        if (lent == 0) return 0;
        lentToPayoutPool += lent;
        reserveToken.safeTransfer(payoutPool, lent);
        emit LentToPayoutPool(lent, lentToPayoutPool);
    }

    /// @notice takes back what the payout pool borrowed, and any carry on it.
    /// @dev Only the payout pool (audit M-8): anyone else's payment reduced `lentToPayoutPool`
    /// while the payout pool's own `borrowedFromVault` stayed put, and the books disagreed. Only
    /// principal reduces what is owed; the carry stays here as vault cash (audit X-17).
    function repayFromPayoutPool(uint256 amount) external {
        if (payoutPool == address(0) || _msgSender() != payoutPool) revert BondVaultNotTrackedBorrower(_msgSender());
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 principal = lentToPayoutPool < amount ? lentToPayoutPool : amount;
        lentToPayoutPool -= principal;
        if (amount > principal) emit InterestReceived(principal, amount - principal);
        emit RepaidFromPayoutPool(amount, lentToPayoutPool);
    }

    /* ========== RESTRICTED ========== */

    /// @notice names the treasury and the payout pool.
    /// @dev Zero is a valid "none" for each. The payout pool is not re-pointed while it owes the
    /// vault, because only the tracked payout pool may repay (audit M-8). There is no reserve to
    /// name: the co-op's AssurancePool never backs a bond (section 13).
    function setBackstops(address _treasury, address _payoutPool) external onlyRole(OPERATOR_ROLE) {
        if (_payoutPool != payoutPool && lentToPayoutPool != 0) revert BondVaultLoanOutstanding(lentToPayoutPool);
        treasury = _treasury;
        payoutPool = _payoutPool;
        emit BackstopsUpdated(_treasury, _payoutPool);
    }

    /// @notice names what reports a bond pledged against drawn credit, and the kind to ask about.
    function setEncumbranceSource(address source, bytes32 kind) external onlyRole(OPERATOR_ROLE) {
        encumbranceSource = IBondEncumbranceSource(source);
        collateralKind = kind;
        emit EncumbranceSourceUpdated(source, kind);
    }

    /// @notice sets how far ahead the reserve looks and the floor beneath it.
    /// @dev Bounded rather than free. The floor is a risk parameter, and one an operator could
    /// set to zero would not be a floor.
    function setReserveTerms(uint64 window, uint256 floorBps) external onlyRole(OPERATOR_ROLE) {
        if (floorBps < MIN_RESERVE_FLOOR_BPS || floorBps > MAX_RESERVE_FLOOR_BPS) {
            revert BondVaultReserveFloorOutOfBounds(floorBps);
        }
        reserveWindow = window;
        minReserveBps = floorBps;
        emit ReserveTermsUpdated(window, floorBps);
    }

    function _removeOutstanding(uint256 bondId) private {
        uint256 indexPlusOne = outstandingIndex[bondId];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        uint256 last = outstanding[outstanding.length - 1];
        outstanding[index] = last;
        outstandingIndex[last] = index + 1;
        outstanding.pop();
        delete outstandingIndex[bondId];
    }
}
