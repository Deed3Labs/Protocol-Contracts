// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./EarnControlsBase.sol";

/// @title EarnControlsAdmin
/// @notice `EarnControls`' delegatecall module: the governed settings, the Ladder, the Successor
/// path, households and the holder-ineligible flag (Phase 2f, decision 1; IV-02 §§2.5, 8.3).
/// @dev Pinned at `EarnControls`' construction, like the pool's and issuers' modules. Never called
/// directly in production: it runs against the `EarnControls` proxy's storage, with the original
/// caller, through its fallback. It declares no storage (see `EarnControlsBase`).
contract EarnControlsAdmin is EarnControlsBase {
    uint32 public constant MAX_TERM_DAYS = 10_950;
    uint32 public constant MAX_YIELD_BPS = 5_000;
    uint256 public constant MAX_LADDER_TERMS = 32;
    uint256 public constant MAX_BOND_BOOKS = 8;
    uint256 public constant MAX_HOUSEHOLD = 12;

    /// @notice what EarnControls' constructor checks before pinning this module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("EarnControlsAdmin.v1");
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /* ========== ROLES ========== */

    /// @notice Grants `role` with the Lending Board resolution that approved it (§10).
    function grantRoleByResolution(bytes32 role, address account, bytes32 resolutionHash)
        external
        onlyRole(getRoleAdmin(role))
    {
        if (resolutionHash == bytes32(0) || account == address(0)) revert EarnControlsInvalidValue();
        _grantRole(role, account);
        emit RoleGrantedByResolution(role, account, resolutionHash);
    }

    /* ========== LADDER (IV-01 §5.2) ========== */

    function isTermOffered(uint32 termDays) external view returns (bool) {
        return _rungs[termDays].offered;
    }

    function ladderYieldBps(uint32 termDays) external view returns (uint32) {
        return _rungs[termDays].yieldBps;
    }

    /// @notice every term ever listed on the Ladder, offered or not.
    function ladderTerms() external view returns (uint32[] memory) {
        return _terms;
    }

    /// @notice the term a bond of `termDays` rolls into: the same term if offered, else the
    /// nearest shorter offered term; 0 if none.
    function rollTermFor(uint32 termDays) external view returns (uint32 best) {
        if (_rungs[termDays].offered) return termDays;
        uint32[] memory terms = _terms;
        for (uint256 i; i < terms.length; ++i) {
            uint32 t = terms[i];
            if (t < termDays && t > best && _rungs[t].offered) best = t;
        }
    }

    /// @notice the Roll Notice yield or the Ladder yield for `rollTerm`, whichever is higher.
    function rollYieldFor(uint32 rollTerm, uint32 noticeYieldBps) external view returns (uint32) {
        uint32 ladder = _rungs[rollTerm].offered ? _rungs[rollTerm].yieldBps : 0;
        return ladder > noticeYieldBps ? ladder : noticeYieldBps;
    }

    /// @notice lists, prices or withdraws a Ladder term. Withdrawing a term is what makes a
    /// confirmed bond of that term unable to roll; the reserve hook is told in the same call.
    function setRung(uint32 termDays, uint32 yieldBps, bool offered) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (termDays == 0 || termDays > MAX_TERM_DAYS || yieldBps > MAX_YIELD_BPS) revert EarnControlsInvalidValue();
        Rung storage r = _rungs[termDays];
        if (!r.listed) {
            if (_terms.length >= MAX_LADDER_TERMS) revert EarnControlsInvalidValue();
            _terms.push(termDays);
            r.listed = true;
        }
        bool changed = r.offered != offered;
        r.yieldBps = yieldBps;
        r.offered = offered;
        emit RungSet(termDays, yieldBps, offered);
        address hook = reserveHook;
        if (changed && hook != address(0)) IEarnControlsHook(hook).termOfferChanged(termDays, offered);
    }

    /* ========== SUCCESSOR PATH (IV-01 §6.3; IV-02 §8.3) ========== */

    /// @notice where a payment to `holder` goes: a Successor registered for payment, after its
    /// 7 days, otherwise `holder` itself.
    function payeeOf(address holder) external view returns (address) {
        PaymentSuccessor storage p = _payees[holder];
        return p.payee != address(0) && block.timestamp >= p.effectiveAt ? p.payee : holder;
    }

    function paymentSuccessorOf(address holder) external view returns (PaymentSuccessor memory) {
        return _payees[holder];
    }

    function successorTransfer(address from, address to) external view returns (SuccessorApproval memory) {
        return _successorTransfers[from][to];
    }

    /// @notice opens the transfer by operation of law from a Holder's account to the Successor's
    /// verified Smart Account for 30 days. The transfer is still signed from `from`: no Clear key
    /// moves a position (IV-02 §8.5).
    function approveSuccessorTransfer(address from, address to, bytes32 evidenceHash) external {
        if (from == address(0) || to == address(0) || from == to || evidenceHash == bytes32(0)) {
            revert EarnControlsInvalidValue();
        }
        (bool done,) = _pair(
            keccak256(abi.encode(this.approveSuccessorTransfer.selector, from, to, evidenceHash)), SUCCESSOR_ROLE
        );
        if (!done) return;
        _successorTransfers[from][to] = SuccessorApproval(uint64(block.timestamp), evidenceHash);
        emit SuccessorTransferApproved(from, to, evidenceHash, uint64(block.timestamp) + SUCCESSOR_WINDOW);
    }

    /// @notice records a Successor as entitled to a bond's payments where the Holder's account
    /// cannot be accessed (IV-01 §6.3). It applies after 7 days; the Holder's account may cancel it.
    function registerPaymentSuccessor(address holder, address payee, bytes32 evidenceHash) external {
        if (holder == address(0) || payee == address(0) || holder == payee || evidenceHash == bytes32(0)) {
            revert EarnControlsInvalidValue();
        }
        (bool done,) = _pair(
            keccak256(abi.encode(this.registerPaymentSuccessor.selector, holder, payee, evidenceHash)), SUCCESSOR_ROLE
        );
        if (!done) return;
        uint64 at = uint64(block.timestamp) + PAYEE_DELAY;
        _payees[holder] = PaymentSuccessor(payee, at, evidenceHash);
        emit PaymentSuccessorRegistered(holder, payee, evidenceHash, at);
    }

    /// @notice the Holder's own account cancels a Successor registered for its payments: an account
    /// that can sign is one that can be accessed.
    function cancelPaymentSuccessor() external {
        address payee = _payees[msg.sender].payee;
        if (payee == address(0)) revert EarnControlsNothingToCancel(msg.sender);
        delete _payees[msg.sender];
        emit PaymentSuccessorCancelled(msg.sender, payee);
    }

    /* ========== HOUSEHOLDS AND THE INELIGIBLE FLAG ========== */

    /// @notice the accounts recorded in a household (one per member).
    function householdMembers(bytes32 household) external view returns (address[] memory) {
        return _households[household];
    }

    /// @notice records the household of the member behind `account` (IV-02 §2.5(c): the member
    /// with their Immediate Family in their household), two `ATTESTER_ROLE` holders. A zero
    /// household takes the member out of theirs, so they count alone.
    function setHousehold(address account, bytes32 household) external {
        if (account == address(0)) revert EarnControlsInvalidValue();
        (bool done,) = _pair(keccak256(abi.encode(this.setHousehold.selector, account, household)), ATTESTER_ROLE);
        if (!done) return;
        uint256 key = memberKeyOf(account);
        bytes32 old = householdOf[key];
        if (old != bytes32(0)) {
            address[] storage list = _households[old];
            for (uint256 i; i < list.length; ++i) {
                if (memberKeyOf(list[i]) == key) {
                    list[i] = list[list.length - 1];
                    list.pop();
                    break;
                }
            }
        }
        householdOf[key] = household;
        if (household != bytes32(0)) {
            if (_households[household].length >= MAX_HOUSEHOLD) revert EarnControlsInvalidValue();
            _households[household].push(account);
        }
        emit HouseholdSet(key, account, household);
    }

    /// @notice sets or clears the holder-ineligible flag (§2): a flagged Holder's bonds do not roll.
    function setHolderIneligible(address holder, bool ineligible, bytes32 evidenceHash) external {
        if (holder == address(0) || evidenceHash == bytes32(0)) revert EarnControlsInvalidValue();
        (bool done,) = _pair(
            keccak256(abi.encode(this.setHolderIneligible.selector, holder, ineligible, evidenceHash)), ELIGIBILITY_ROLE
        );
        if (!done) return;
        holderIneligible[holder] = ineligible;
        emit HolderIneligibleSet(holder, ineligible, evidenceHash);
        address hook = reserveHook;
        if (hook != address(0)) IEarnControlsHook(hook).holderEligibilityChanged(holder, ineligible);
    }

    /* ========== GOVERNED SETTINGS (DEFAULT_ADMIN_ROLE: the Earn timelock) ========== */

    function setFundingLimit(uint256 limit, bytes32 resolutionHash, uint16 fiscalYear)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (resolutionHash == bytes32(0)) revert EarnControlsInvalidValue();
        fundingLimit = limit;
        fundingLimitResolution = resolutionHash;
        fundingLimitFiscalYear = fiscalYear;
        emit SettingsSet("fundingLimit", limit, resolutionHash);
    }

    /// @notice the bond and pool offering maxima and the pool capacity, with the resolution.
    function setOfferingLimits(uint256 bondCap, uint256 poolCap, uint256 capacity, bytes32 resolutionHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        offeringCap = bondCap;
        poolOfferingCap = poolCap;
        poolCapacity = capacity;
        emit SettingsSet("offeringCap", bondCap, resolutionHash);
        emit SettingsSet("poolOfferingCap", poolCap, resolutionHash);
        emit SettingsSet("poolCapacity", capacity, resolutionHash);
    }

    function setHolderCapBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps == 0 || bps > BPS) revert EarnControlsInvalidValue();
        holderCapBps = bps;
        emit SettingsSet("holderCapBps", bps, bytes32(0));
    }

    /// @notice schedules a new holder-cap floor (decision 23), applying 7 days from now on top of
    /// the Earn timelock's own delay. A later schedule replaces one not yet applied.
    function scheduleHolderCapFloor(uint256 floor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint64 at = _holderCapFloorAt;
        uint256 current = at != 0 && block.timestamp >= at ? _pendingHolderCapFloor : _holderCapFloor;
        _holderCapFloor = current;
        _pendingHolderCapFloor = floor;
        at = uint64(block.timestamp) + HOLDER_CAP_FLOOR_DELAY;
        _holderCapFloorAt = at;
        emit HolderCapFloorScheduled(current, floor, at);
    }

    function setRefused(address account, bool isRefused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert EarnControlsInvalidAddress();
        refused[account] = isRefused;
        emit RefusedSet(account, isRefused);
    }

    function setSources(
        address membership_,
        address yieldPool_,
        address reserveStatus_,
        address collateralAgent_,
        address reserveHook_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        membership = IEarnMembership(membership_);
        yieldPool = yieldPool_;
        reserveStatus = reserveStatus_;
        collateralAgent = collateralAgent_;
        reserveHook = reserveHook_;
        emit SourcesSet(membership_, yieldPool_, reserveStatus_, collateralAgent_, reserveHook_);
    }

    function setBondBooks(address[] calldata books) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (books.length > MAX_BOND_BOOKS) revert EarnControlsInvalidValue();
        for (uint256 i; i < books.length; ++i) if (books[i] == address(0)) revert EarnControlsInvalidAddress();
        _bondBooks = books;
        emit BondBooksSet(books);
    }
}
