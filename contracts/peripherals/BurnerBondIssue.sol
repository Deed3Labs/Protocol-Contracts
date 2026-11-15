// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "../libraries/PacificCalendar.sol";
import "./BurnerBondBase.sol";

/// @dev What the Collateral Agent has paid on a bond through its distributions.
interface IAgentPaidOn {
    function paidOn(uint256 bondId) external view returns (uint256);
}

/// @title BurnerBondIssue
/// @notice How a BurnerBond comes into being and what its Holder signs: purchase by quote (Earn §1),
/// Roll Notices and Roll Confirmations (Earn §4A; IV-01 §§5.1-5.3), the wind-down or illegality flag
/// and `redeemAll` (Earn §4(c)), and the burn of a bond the Collateral Agent paid in full (IV-10 §7.6).
/// @dev A delegatecall module, reached from BurnerBond through BurnerBondPledges' fallback. It runs
/// against the collection's storage (BurnerBondBase) and is never called directly.
contract BurnerBondIssue is BurnerBondBase {
    using SafeERC20 for IERC20;

    /// @notice A quote as the buyer saw and signed it (Earn §1). Its term and yield are the Ladder's
    /// when it was given (`quotedAt`), never re-read at purchase (decisions 11 and 31).
    struct Quote {
        address payer;
        address holder;
        uint256 maturityAmount;
        uint32 termDays;
        uint32 yieldBps;
        uint64 quotedAt;
        uint256 nonce;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice what BurnerBondPledges' constructor checks before pinning this as its module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("BurnerBondIssue.v1");
    }

    /* ========== PURCHASE BY QUOTE (Earn §1) ========== */

    /// @notice the Purchase Price of `maturityAmount` over `termDays` at `yieldBps`: its Accreted
    /// Value at issue, rounded down to the cent (in the buyer's favour).
    function quotePrice(uint256 maturityAmount, uint32 termDays, uint32 yieldBps) public view returns (uint256) {
        uint256 v = Accretion.purchasePrice(maturityAmount, yieldBps, termDays);
        return v - (v % cent);
    }

    /// @notice the EIP-712 digest the buyer signs for `q`.
    function quoteDigest(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH, q.payer, q.holder, q.maturityAmount, q.termDays, q.yieldBps, q.quotedAt, q.nonce
                )
            )
        );
    }

    /// @notice buys a bond on a quote the payer signed (Earn §1). Mints only together with the
    /// Purchase Price reaching the BondVault from the payer's Smart Account. Refused if the quote is
    /// older than 15 minutes (FIXED), used, or not the Ladder's rate for its term when it was given,
    /// and by EarnControls for a price under $250 (FIXED), a Clear contract as payer, a payer who is
    /// not eligible or not the Holder's own account, a term not offered now, the Funding Limit, the
    /// offering cap, a Reserve Shortfall, the Equity Cushion pause or an Enforcement Notice.
    /// @param attestation an eligibility attestation to record first, or empty to use the one on file
    function purchase(Quote calldata q, bytes calldata sig, bytes calldata attestation)
        external
        nonReentrant
        returns (uint256 bondId)
    {
        if (windDownSetAt != 0 || redeemAllFrom != 0) revert BurnerBondWindDown();
        if (q.quotedAt > block.timestamp || block.timestamp > uint256(q.quotedAt) + QUOTE_LIFETIME || q.maturityAmount == 0) {
            revert BurnerBondBadQuote();
        }
        (uint32 rungYield, bool offered) = controls.rungAt(q.termDays, q.quotedAt);
        if (!offered || rungYield != q.yieldBps) revert BurnerBondBadQuote();
        bytes32 digest = quoteDigest(q);
        if (quoteUsed[digest]) revert BurnerBondBadQuote();
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(q.payer, digest, sig)) revert BurnerBondBadSignature();
        quoteUsed[digest] = true;

        uint256 price = quotePrice(q.maturityAmount, q.termDays, q.yieldBps);
        bytes32 exemption =
            controls.checkPurchase(q.payer, q.holder, price, q.maturityAmount, q.termDays, attestation);
        uint64 maturity = uint64(block.timestamp) + uint64(q.termDays) * 1 days;

        underlyingToken.safeTransferFrom(q.payer, address(bondVault), price);
        bondId = _issue(
            q.holder,
            BondInfo(
                q.maturityAmount, price, price, 0, uint64(block.timestamp), maturity, q.termDays, q.yieldBps, false,
                exemption
            )
        );
        totalUSDCDeposited += price;
        bondVault.recordPurchase(bondId, price, q.maturityAmount, maturity, q.yieldBps, q.termDays);
    }

    /* ========== ROLL NOTICES AND CONFIRMATIONS (Earn §4A) ========== */

    /// @notice the latest `rollDeadline` a bond maturing at `maturity` may be given: the end of the
    /// day (Pacific) seven calendar days before its Maturity Date (FIXED).
    function latestRollDeadline(uint256 maturity) public pure returns (uint256) {
        (uint256 y, uint256 m, uint256 d) = PacificCalendar.localDate(maturity);
        (y, m, d) = PacificCalendar.civilFromDays(PacificCalendar.daysFromCivil(y, m, d) - 7);
        return PacificCalendar.endOfDay(y, m, d);
    }

    /// @notice posts a bond's Roll Notice: its hash and Roll Deadline, and the roll term and yield it
    /// states (decision 11). Clear Lending's notice role (`ROLL_NOTICE_ROLE` in EarnControls), once
    /// per bond, no later than 20 days before maturity (FIXED). The deadline must be in the future and
    /// no later than the end of the day (Pacific) seven calendar days before maturity (FIXED). The
    /// term must be the one the bond would roll into now (IV-01 §5.2(a)), and the yield at least the
    /// Ladder's for it (a notice never offers less than the Ladder).
    function postRollNotice(uint256 bondId, bytes32 noticeHash, uint64 rollDeadline, uint32 termDays, uint32 yieldBps)
        external
    {
        if (!IEarnRoles(address(controls)).hasRole(ROLL_NOTICE_ROLE, msg.sender)) revert BurnerBondNotAuthorized(msg.sender);
        (BondInfo storage b,) = _exists(bondId);
        RollNotice storage n = _notices[bondId];
        if (
            noticeHash == bytes32(0) || n.noticeHash != bytes32(0)
                || block.timestamp + NOTICE_LEAD > b.maturityDate || rollDeadline <= block.timestamp
                || rollDeadline > latestRollDeadline(b.maturityDate) || termDays == 0
                || termDays != controls.rollTermFor(b.termDays) || yieldBps < controls.ladderYieldBps(termDays)
                || yieldBps > Accretion.MAX_YIELD_BPS
        ) revert BurnerBondBadNotice(bondId);
        _notices[bondId] = RollNotice(noticeHash, rollDeadline, termDays, yieldBps, false, n.nonce);
        emit RollNoticePosted(bondId, noticeHash, rollDeadline, termDays, yieldBps);
    }

    /// @notice the EIP-712 digest the Holder signs to confirm a bond's roll, as things stand now.
    function confirmRollDigest(uint256 bondId) public view returns (bytes32) {
        RollNotice storage n = _notices[bondId];
        return _hashTypedDataV4(keccak256(abi.encode(CONFIRM_ROLL_TYPEHASH, bondId, n.noticeHash, n.deadline, n.nonce)));
    }

    /// @notice records a Holder's Roll Confirmation (IV-01 §5.1): the Holder's Wallet Signature from
    /// the Smart Account holding the bond (EIP-1271), after the notice and before its Roll Deadline,
    /// over this bond's notice. Anyone may submit it. One signature covers one bond.
    function confirmRoll(uint256 bondId, bytes32 noticeHash, bytes calldata sig) external {
        _confirm(bondId, noticeHash, sig);
    }

    /// @notice several Holder-signed confirmations in one transaction, one signature per bond.
    function confirmRolls(uint256[] calldata bondIds, bytes32[] calldata noticeHashes, bytes[] calldata sigs) external {
        if (bondIds.length != noticeHashes.length || bondIds.length != sigs.length) revert BurnerBondBadSignature();
        for (uint256 i; i < bondIds.length; ++i) _confirm(bondIds[i], noticeHashes[i], sigs[i]);
    }

    /// @notice the Holder withdraws its Roll Confirmation, before the Roll Deadline. The bond counts
    /// at 100% of the reserve again in this transaction.
    function withdrawRollConfirmation(uint256 bondId) external {
        RollNotice storage n = _notices[bondId];
        if (msg.sender != holderOf[bondId]) revert BurnerBondNotAuthorized(msg.sender);
        if (!n.confirmed || block.timestamp >= n.deadline) revert BurnerBondNoticeClosed(bondId);
        n.confirmed = false;
        ++n.nonce;
        bondVault.setRollConfirmation(bondId, msg.sender, false);
        emit RollConfirmationWithdrawn(bondId, msg.sender);
    }

    function _confirm(uint256 bondId, bytes32 noticeHash, bytes calldata sig) internal {
        (, address holder) = _exists(bondId);
        RollNotice storage n = _notices[bondId];
        if (n.noticeHash == bytes32(0) || n.noticeHash != noticeHash || n.confirmed) revert BurnerBondBadNotice(bondId);
        if (block.timestamp >= n.deadline) revert BurnerBondNoticeClosed(bondId);
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(holder, confirmRollDigest(bondId), sig)) {
            revert BurnerBondBadSignature();
        }
        n.confirmed = true;
        ++n.nonce;
        bondVault.setRollConfirmation(bondId, holder, true);
        emit RollConfirmed(bondId, holder, noticeHash);
    }

    /* ========== WIND-DOWN AND redeemAll (Earn §4(c)) ========== */

    /// @notice sets or clears the wind-down or illegality flag: two different `WIND_DOWN_ROLE`
    /// holders (EarnControls) make the same call. Purchases stop at once; `redeemAll` may start 30
    /// days after it is set. It cannot be cleared once `redeemAll` has started.
    function setWindDown(bool on, bytes32 reasonHash) external {
        if (redeemAllFrom != 0 || (on && (windDownSetAt != 0 || reasonHash == bytes32(0)))) revert BurnerBondWindDown();
        (bool done, address first) = _pair(keccak256(abi.encode(msg.sig, on, reasonHash)), WIND_DOWN_ROLE);
        if (!done) {
            emit WindDownProposed(on, reasonHash, msg.sender);
            return;
        }
        windDownSetAt = on ? uint64(block.timestamp) : 0;
        windDownReason = on ? reasonHash : bytes32(0);
        emit WindDownSet(on, reasonHash, first, msg.sender);
    }

    /// @notice starts `redeemAll`: 30 days after the wind-down flag was set, anyone may. Every bond
    /// is then paid its Accreted Value, one at a time, by `redeemUnderWindDown`; no bond rolls and
    /// none is sold. Not while an Enforcement Notice is in force.
    function redeemAll() external {
        uint64 setAt = windDownSetAt;
        if (setAt == 0 || block.timestamp < uint256(setAt) + WIND_DOWN_DELAY || redeemAllFrom != 0) {
            revert BurnerBondNotWindingDown();
        }
        if (address(agent) != address(0) && agent.enforcementInForce()) revert BurnerBondWindDown();
        redeemAllFrom = uint64(block.timestamp);
        emit RedeemAllStarted(uint64(block.timestamp));
    }

    /* ========== THE COLLATERAL AGENT (IV-10 §7.6) ========== */

    /// @notice burns a bond the Collateral Agent's distributions paid in full and releases any pledge.
    /// Only the BondVault, on the Agent's call.
    function burnPaid(uint256 bondId) external {
        if (msg.sender != address(bondVault)) revert BurnerBondNotAuthorized(msg.sender);
        (, address holder) = _exists(bondId);
        bool pledged = _isPledged(holder, bondId);
        _retire(bondId, holder, IAgentPaidOn(address(agent)).paidOn(bondId), true);
        if (pledged) encumbranceSource.releaseRetiredItem(holder, collateralKind, bondId);
        emit BondPaidThroughDistributions(bondId, holder);
    }

    /// @notice the EIP-712 digest a Holder signs to accept a buyback at `price`.
    function buybackDigest(uint256 bondId, uint256 price, uint256 deadline) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BUYBACK_TYPEHASH, bondId, price, deadline)));
    }

    /// @notice the EIP-712 domain separator of this collection.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @dev Unknown calls revert.
    fallback() external {
        revert BurnerBondNotAuthorized(msg.sender);
    }
}
