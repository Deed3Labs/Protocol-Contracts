// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../core/interfaces/stable-credit/IStableCredit.sol";
import "../core/interfaces/stable-credit/IMutualCredit.sol";
import "../core/interfaces/stable-credit/ICreditIssuer.sol";

/// @title CreditIssuer
/// @notice Issue Credit to network members and store/manage credit periods.
/// @dev This contract is intended to be extended by a parent contract that implements
/// custom credit terms and underwriting logic.
contract CreditIssuer is ICreditIssuer, PausableUpgradeable, OwnableUpgradeable, UUPSUpgradeable {
    /// @notice thrown when an operator would bring a member's deadline closer.
    /// @dev Operators may extend or pause a period, never shorten one. A key that could pull an
    /// expiry forward could put a member into default by itself, which is a declared default the
    /// compliance spec rules out (10b) (audit H-2).
    error CreditIssuerPeriodMayOnlyExtend(address member);
    /// @notice thrown when a setter is used on a member who has no period to change.
    error CreditIssuerNoPeriod(address member);
    /// @notice thrown when a caller lacks the credit role a function needs.
    error CreditIssuerMissingRole(bytes32 role, address caller);
    /// @notice thrown when today's cap on new credit would be exceeded.
    /// @dev Bounds what a leaked key can do in a day (audit H-4).
    error CreditIssuerDailyCapExceeded(bytes32 cap, uint256 requested, uint256 remaining);

    event DailyCapUpdated(bytes32 indexed cap, uint256 amount);

    bytes32 internal constant CREDIT_LINES_ROLE = keccak256("CREDIT_LINES_ROLE");
    bytes32 internal constant CREDIT_LIMITS_ROLE = keccak256("CREDIT_LIMITS_ROLE");
    bytes32 internal constant CREDIT_SETTINGS_ROLE = keccak256("CREDIT_SETTINGS_ROLE");

    /// @notice A daily budget for some kind of new credit.
    /// @dev Held by the issuers that use it, not here: this base contract has no storage gap, so
    /// anything added to it would shift every child's layout.
    struct DailyCap {
        /// @dev Most that may be granted in one UTC day. Zero means no cap has been set.
        uint256 cap;
        /// @dev Day number (timestamp / 1 day) `used` was counted for.
        uint64 day;
        uint256 used;
    }

    /* ========== STATE VARIABLES ========== */

    IStableCredit public stableCredit;
    // member => credit period
    mapping(address => CreditPeriod) public creditPeriods;
    /// @notice When a member defaulted, or zero if they have not.
    /// @dev Expiring a credit period deletes it, which also erases the evidence that it ended in
    /// default -- `inDefault` reads the period and there is no period left to read. Liquidation
    /// happens after that point, so it needs the fact to outlive the terms.
    mapping(address => uint64) public defaultedAt;

    /// @notice What a member has taken in, against what they have carried.
    /// @dev The two halves of ITD, kept separate because they are the same quantity arriving by
    /// different routes and which one dominates depends on who the member is. A consumer's income
    /// arrives as external deposits; a merchant's arrives as credits handed to them by other
    /// members. Summing them is what lets one formula describe both without a rule change when
    /// B2B ships.
    struct IncomeRecord {
        /// @dev Credits received from other members.
        uint256 creditsReceived;
        /// @dev Value received from outside the ledger, settling debt with reserve tokens.
        uint256 depositsReceived;
        /// @dev The integral of the member's balance over time, in balance-seconds.
        uint256 debtSeconds;
        /// @dev When `debtSeconds` was last brought forward.
        uint64 lastAccrued;
        /// @dev When the current measurement window opened.
        uint64 windowStart;
    }

    mapping(address => IncomeRecord) public incomeOf;

    /* ========== INITIALIZER ========== */

    /// @notice initializes the stable credit address to issue credit for.
    /// @dev should be called directly after deployment (see OpenZeppelin upgradeable standards).
    /// @param _stableCredit address of stable credit contract to issue credit for.
    function __CreditIssuer_init(address _stableCredit) public virtual onlyInitializing {
        __Pausable_init();
        __Ownable_init();
        __UUPSUpgradeable_init();
        stableCredit = IStableCredit(_stableCredit);
    }

    /* ========== VIEWS ========== */

    /// @notice returns whether a given member's credit period is initialized.
    /// @param member address of member.
    /// @return whether member's credit period is initialized.
    function inInitializedPeriod(address member) public view returns (bool) {
        return creditPeriods[member].expiration > 0;
    }

    /// @notice returns whether a given member is in an active period.
    /// @param member address of member.
    /// @return whether member is in an active credit period.
    function inActivePeriod(address member) public view returns (bool) {
        return inInitializedPeriod(member) && block.timestamp < periodExpirationOf(member);
    }

    /// @notice returns whether a given member is in an active grace period.
    /// @param member address of member.
    /// @return whether member is in an active grace period.
    function inGracePeriod(address member) public view returns (bool) {
        return block.timestamp >= periodExpirationOf(member)
            && block.timestamp < graceExpirationOf(member);
    }

    /// @notice returns whether a given member's credit period has expired.
    /// @param member address of member.
    /// @return whether member's credit period has expired.
    function inExpiredPeriod(address member) public view returns (bool) {
        return inInitializedPeriod(member) && !inActivePeriod(member) && !inGracePeriod(member);
    }

    /// @notice returns whether a given member is in compliance with credit terms.
    /// @dev intended to be overwritten in parent implementation to include custom compliance logic.
    /// @param member address of member.
    /// @return whether member is in compliance with credit terms.
    /// @dev Rebalanced to zero **or above**, not to zero. `creditBalance` is the magnitude of a
    /// negative position, so zero already means at or above the line -- a member sitting on a
    /// positive balance is compliant, not merely square. Reading the rule as "to zero" and
    /// enforcing an exact balance would fail every member the network owes money to, which in
    /// Phase 1 is every merchant.
    function inCompliance(address member) public view virtual override returns (bool) {
        uint256 creditBalance = stableCredit.creditBalanceOf(member);
        return creditBalance == 0;
    }

    /// @notice returns whether a given member is in default.
    /// @dev returns true if period has expired, grace period has expired, and member is not compliant.
    /// @param member address of member.
    /// @return whether member is in default.
    function inDefault(address member) public view virtual override returns (bool) {
        return inInitializedPeriod(member) && inExpiredPeriod(member) && !inCompliance(member);
    }

    /// @notice returns whether a given member's credit line is frozen.
    /// @dev returns true if member is in grace period and not compliant.
    /// @param member address of member.
    /// @return whether member's credit line is frozen.
    function isFrozen(address member) public view returns (bool) {
        return inGracePeriod(member) && !inCompliance(member);
    }

    /// @notice fetches a given member's credit period expiration timestamp.
    /// @param member address of member.
    /// @return expiration timestamp of member's credit period.
    function periodExpirationOf(address member) public view returns (uint256) {
        return creditPeriods[member].expiration;
    }

    /// @notice fetches a given member's credit grace period expiration timestamp.
    /// @param member address of member.
    /// @return expiration timestamp of member's credit grace period.
    function graceExpirationOf(address member) public view returns (uint256) {
        return creditPeriods[member].expiration + creditPeriods[member].graceLength;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /// @notice called by the StableCredit contract when members transfer credits.
    /// @param sender sender address of stable credit transaction.
    /// @param recipient recipient address of stable credit transaction.
    /// @param amount of credits in transaction.
    /// @return transaction validation result.
    function validateCreditTransaction(address sender, address recipient, uint256 amount)
        external
        virtual
        override
        onlyStableCredit
        returns (bool)
    {
        if (!_validateCreditTransaction(sender, recipient, amount)) return false;
        _syncCreditPositions(sender, recipient, amount);
        return true;
    }

    /// @inheritdoc ICreditIssuer
    function syncCreditPositions(address sender, address recipient, uint256 amount)
        external
        override
        onlyStableCredit
    {
        _syncCreditPositions(sender, recipient, amount);
    }

    /// @inheritdoc ICreditIssuer
    function absorbRepayment(address member, uint256 available, uint256 minRate)
        external
        virtual
        override
        onlyStableCredit
        returns (uint256)
    {
        return _absorbRepayment(member, available, minRate);
    }

    /// @inheritdoc ICreditIssuer
    function nextRepaymentRate(address) external view virtual override returns (uint256, bool) {
        return (0, false);
    }

    /// @inheritdoc ICreditIssuer
    /// @dev Nothing is locked by default: a plain transfer may draw on everything this issuer
    /// contributes. An issuer whose allocation may only be used through a scheduled path overrides
    /// this.
    function lockedAllocationOf(address)
        external
        view
        virtual
        override
        returns (uint256 allocation, uint256 drawn)
    {
        return (0, 0);
    }

    /// @notice whether a transfer that draws on this issuer's line pays somebody it may pay.
    /// @dev Only draws are checked, and only the sender's own: spending a positive balance is the
    /// ledger's business, and a member enrolled here only as a recipient is not drawing on this
    /// line. A draw must pay an active merchant or a named system address (audit C-1). The ledger
    /// answers, so the list lives in one place, and it fails closed while no merchant registry is
    /// set.
    function _drawRecipientAllowed(address sender, address recipient, uint256 amount)
        internal
        view
        returns (bool)
    {
        if (recipient == address(0) || amount == 0) return true;
        if (stableCredit.balanceOf(sender) >= amount) return true;
        if (!stableCredit.networkRegistry().isEnrolled(sender, address(this))) return true;
        return stableCredit.isEligibleRecipient(recipient);
    }

    /// @notice takes what this issuer can of a repayment.
    /// @dev Nothing by default: the base issuer tracks a period, not a composition, so there is
    /// no position for a payment to land against.
    function _absorbRepayment(address member, uint256 available, uint256 minRate)
        internal
        virtual
        returns (uint256)
    {}

    /// @notice records what a credit movement did to this issuer's positions.
    /// @dev Nothing by default: the base issuer tracks a period, not a composition. An issuer
    /// that describes what a member's balance is made of overrides this, and must stay consistent
    /// with the ledger's one signed number rather than maintaining a second opinion of it.
    function _syncCreditPositions(address sender, address recipient, uint256 amount)
        internal
        virtual
    {
        _recordIncome(sender, recipient, amount);
    }

    /* ========== INCOME TO DEBT ========== */

    /// @notice the average balance a member has carried over the current window.
    /// @dev Averaged over time rather than sampled, because a member who clears their balance the
    /// day before anyone looks has carried it all the same. The integral is kept as a running sum
    /// so this costs nothing to read and does not need iterating over anything.
    function averageBalanceCarriedOf(address member) public view returns (uint256) {
        IncomeRecord storage record = incomeOf[member];
        if (record.windowStart == 0 || block.timestamp <= record.windowStart) return 0;

        uint256 accrued = record.debtSeconds
            + stableCredit.creditBalanceOf(member) * (block.timestamp - record.lastAccrued);
        return accrued / (block.timestamp - record.windowStart);
    }

    /// @notice a member's income to debt ratio, where 1 ether == 100%.
    /// @dev
    ///     ITD = (credits received from members + external deposits received)
    ///           / average balance carried
    ///
    /// One formula for both phases and both member classes. Today the first term is zero for a
    /// consumer and the second carries it; when B2B ships the first dominates for a merchant.
    /// Neither case needs a rule change or a migration, because neither case is special.
    ///
    /// A member who has carried nothing has no ratio rather than an infinite one -- see
    /// `hasBalanceToMeasure`, which is what tells the two apart.
    /// @param member address of the member.
    /// @return ratio income to debt, where 1 ether == 100%.
    function itdOf(address member) public view returns (uint256) {
        uint256 carried = averageBalanceCarriedOf(member);
        if (carried == 0) return 0;
        IncomeRecord storage record = incomeOf[member];
        return ((record.creditsReceived + record.depositsReceived) * 1 ether) / carried;
    }

    /// @notice whether a member has carried enough of a balance for their ITD to mean anything.
    /// @dev A ratio over an empty denominator is not a good score, it is no score. Read this
    /// before reading `itdOf`, or a member who has never drawn will look like the worst one.
    function hasBalanceToMeasure(address member) public view returns (bool) {
        return averageBalanceCarriedOf(member) > 0;
    }

    /// @notice whether a member's ITD reaches a given threshold.
    /// @dev Exposed rather than enforced. What ITD a line requires is an underwriting policy that
    /// differs by tier and by member class, and burying one threshold in the ledger would make
    /// every future policy a contract change.
    /// @param member address of the member.
    /// @param minimumItd threshold, where 1 ether == 100%.
    function meetsITD(address member, uint256 minimumItd) external view returns (bool) {
        if (!hasBalanceToMeasure(member)) return true;
        return itdOf(member) >= minimumItd;
    }

    /// @notice brings the balance integral forward and records what arrived.
    function _recordIncome(address sender, address recipient, uint256 amount) internal {
        _accrueDebtSeconds(sender);
        _accrueDebtSeconds(recipient);
        if (amount == 0 || recipient == address(0)) return;

        IncomeRecord storage record = incomeOf[recipient];
        if (sender == address(stableCredit)) {
            // Value that entered the ledger from outside it: a repayment funded with reserve
            // tokens, or credit the network itself issued.
            record.depositsReceived += amount;
        } else {
            record.creditsReceived += amount;
        }
    }

    /// @dev Adds the time since the last touch at the balance that was standing through it.
    function _accrueDebtSeconds(address member) private {
        if (member == address(0) || member == address(stableCredit)) return;
        IncomeRecord storage record = incomeOf[member];
        if (record.windowStart == 0) {
            record.windowStart = uint64(block.timestamp);
            record.lastAccrued = uint64(block.timestamp);
            return;
        }
        if (block.timestamp == record.lastAccrued) return;
        record.debtSeconds +=
            stableCredit.creditBalanceOf(member) * (block.timestamp - record.lastAccrued);
        record.lastAccrued = uint64(block.timestamp);
    }

    /// @notice opens a fresh measurement window for a member.
    /// @dev Called when credit terms are set, so a member is measured over the terms they are
    /// actually on rather than over everything they have ever done.
    function _resetIncomeWindow(address member) internal {
        IncomeRecord storage record = incomeOf[member];
        record.creditsReceived = 0;
        record.depositsReceived = 0;
        record.debtSeconds = 0;
        record.lastAccrued = uint64(block.timestamp);
        record.windowStart = uint64(block.timestamp);
    }

    /// @notice syncs the credit period state and returns validation status.
    /// @dev this function is intended to be called after credit expiration to ensure that defaulted debt
    /// is written off as lost debt.
    /// @param member address of member to sync credit line for.
    /// @return transaction validation result.
    function syncCreditPeriod(address member) external returns (bool) {
        return _validateCreditTransaction(member, address(0), 0);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /// @notice called by network authorized to issue credit.
    /// @dev intended to be overwritten in parent implementation to include custom underwriting logic.
    /// @param member address of member.
    function underwriteMember(address member)
        public
        virtual
        override
        notNull(member)
        canIssueCreditTo(member)
    {
        require(!inActivePeriod(member), "CreditIssuer: member already in active credit period");
    }

    /// @notice enables authorized address recipient manually initialize a member's credit line with
    /// provided credit terms.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to initialize credit line for.
    /// @param limit credit limit of credit line.
    /// @param initialBalance initial balance of member.
    /// @param periodLength length of credit period.
    /// @param graceLength length of grace period.
    function initializeCreditLine(
        address member,
        uint256 limit,
        uint256 initialBalance,
        uint256 periodLength,
        uint256 graceLength
    ) external virtual onlyCreditRole(CREDIT_LINES_ROLE) notNull(member) notInActivePeriod(member) {
        stableCredit.createCreditLine(member, limit, initialBalance);
        _updateCreditPeriod(member, block.timestamp + periodLength, graceLength);
    }

    /// @notice responsible for initializing the given member's credit period.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to initialize credit period for.
    /// @param periodExpiration expiration timestamp of credit period.
    /// @param graceLength length of grace period.
    function updateCreditPeriod(address member, uint256 periodExpiration, uint256 graceLength)
        public
        virtual
        onlyCreditRole(CREDIT_LINES_ROLE)
    {
        // Renewing moves a deadline out; it may not move one in (audit H-2).
        if (inInitializedPeriod(member)) {
            CreditPeriod storage period = creditPeriods[member];
            if (periodExpiration < period.expiration || graceLength < period.graceLength) {
                revert CreditIssuerPeriodMayOnlyExtend(member);
            }
        }
        _updateCreditPeriod(member, periodExpiration, graceLength);
    }

    /// @notice enables network operators to pause a given member's credit period.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to pause terms for.
    function pausePeriodOf(address member) external onlyCreditRole(CREDIT_LINES_ROLE) {
        creditPeriods[member].paused = true;
        emit CreditTermsPaused(member);
    }

    /// @notice enables network operators to unpause a given member's credit period.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to unpause period for.
    function unpausePeriodOf(address member) external onlyCreditRole(CREDIT_LINES_ROLE) {
        CreditPeriod storage period = creditPeriods[member];
        period.paused = false;
        // Lifting a pause must not land the member straight in default: a pause that outlasted
        // the period would otherwise make unpausing a declared default by another name (audit
        // H-2, compliance 10b). The deadline restarts at the moment the pause ends, so the member
        // still gets their whole grace.
        if (period.expiration != 0 && period.expiration < block.timestamp) {
            period.expiration = block.timestamp;
        }
        emit CreditTermsUnpaused(member);
    }

    /// @notice called by network operators to set the credit period length.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to set period expiration for.
    /// @param periodExpiration expiration timestamp of credit period.
    function setPeriodExpirationOf(address member, uint256 periodExpiration)
        public
        onlyCreditRole(CREDIT_LINES_ROLE)
    {
        if (!inInitializedPeriod(member)) revert CreditIssuerNoPeriod(member);
        if (periodExpiration < creditPeriods[member].expiration) {
            revert CreditIssuerPeriodMayOnlyExtend(member);
        }
        creditPeriods[member].expiration = periodExpiration;
    }

    /// @notice called by network operators to set the grace period length.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to set grace period for.
    /// @param graceLength length of grace period.
    function setGraceLengthOf(address member, uint256 graceLength)
        public
        onlyCreditRole(CREDIT_LINES_ROLE)
    {
        if (!inInitializedPeriod(member)) revert CreditIssuerNoPeriod(member);
        if (graceLength < creditPeriods[member].graceLength) {
            revert CreditIssuerPeriodMayOnlyExtend(member);
        }
        creditPeriods[member].graceLength = graceLength;
        emit GraceLengthUpdated(member, graceLength);
    }

    /* ========== PRIVATE FUNCTIONS ========== */

    /// @notice called when a member's credit period has expired
    /// @dev A compliant member rolls straight into a new period; a member in default has the
    /// period deleted, the debt written off and the default recorded.
    ///
    /// Rolling rather than deleting is the fix for audit H-2. `syncCreditPeriod` is public, and a
    /// deleted period used to read as "no terms", which waved every later draw through and made
    /// default impossible -- so anyone, the member included, could switch a line's terms off by
    /// calling it at the right moment. A line that still has a limit always has a period now.
    /// @param member address of member to expire.
    /// @return true if member is not in default, false if member is in default.
    function expireCreditPeriod(address member) internal virtual returns (bool) {
        bool memberInDefault = inDefault(member);
        if (!memberInDefault) {
            CreditPeriod storage period = creditPeriods[member];
            uint256 length = _rolloverLength(member);
            // Counted from now, as the renewer counts it: a full period from today rather than one
            // already partly spent.
            period.issuedAt = block.timestamp;
            period.expiration = block.timestamp + length;
            emit CreditPeriodExpired(member);
            emit CreditPeriodCreated(member, period.expiration, period.graceLength);
            return true;
        }
        // in default: delete the period, write off this issuer's share and revoke membership
        delete creditPeriods[member];
        defaultedAt[member] = uint64(block.timestamp);
        stableCredit.writeOffCreditLine(member, _writeOffAmount(member));
        _onDefault(member);
        emit CreditLineDefaulted(member);
        return false;
    }

    /// @notice how long a rolled-over period runs.
    /// @dev The length of the period that just ended, by default, which is whatever the operator
    /// last set. An issuer with a network cycle overrides this.
    function _rolloverLength(address member) internal view virtual returns (uint256) {
        CreditPeriod storage period = creditPeriods[member];
        uint256 length = period.expiration > period.issuedAt ? period.expiration - period.issuedAt : 0;
        // A period always has some length; a zero one would expire again in the same block.
        return length == 0 ? 1 days : length;
    }

    /// @notice whether a member's line with this issuer must have a period to draw on.
    /// @dev Yes whenever this issuer gives them a ceiling a plain transfer can draw. An issuer
    /// whose allocation is drawn only through a scheduled path (a term plan) is governed by that
    /// schedule instead, and overrides this.
    function _requiresPeriod(address member) internal view virtual returns (bool) {
        return stableCredit.issuerCreditLimit(address(this), member) > 0;
    }

    /// @notice whether a member's credit line ended in default.
    /// @dev Survives the period being deleted, unlike `inDefault`.
    function hasDefaulted(address member) public view override returns (bool) {
        return defaultedAt[member] != 0;
    }

    /// @notice how much of a member's debt belongs to this issuer.
    /// @dev The whole balance by default, which is right while an issuer is the only one a member
    /// has and wrong as soon as it is not. An issuer that tracks its own positions must override
    /// this: defaulting on a term plan should not write off a revolving balance somebody is still
    /// servicing. `writeOffCreditLine` bounds whatever is returned by what is outstanding.
    /// @param member address of member.
    /// @return the issuer's share of the member's debt.
    function _writeOffAmount(address member) internal view virtual returns (uint256) {
        return stableCredit.creditBalanceOf(member);
    }

    /// @notice what happens to a member's standing when they default with this issuer.
    /// @dev Revoking membership outright is right for a member whose only line is this one. An
    /// issuer sharing a member with another should narrow this to its own relationship rather
    /// than ejecting them from the network.
    /// @param member address of member.
    function _onDefault(address member) internal virtual {
        stableCredit.access().revokeMember(member);
    }

    /// @notice called with each stable credit transaction to validate the transaction and update
    /// credit term state.
    /// @dev Hook that is called before any transfer of credits and credit line state sync.
    /// @param sender address of member sending credits in given stable credit transaction.
    /// @param recipient address of member receiving credits in given stable credit transaction.
    /// @param amount of stable credits in transaction.
    /// @return whether the given transaction is in compliance with given obligations.
    function _validateCreditTransaction(address sender, address recipient, uint256 amount)
        internal
        virtual
        returns (bool)
    {
        // Block transaction if recipient is frozen (in grace period and not compliant)
        if (recipient != address(0) && isFrozen(recipient)) {
            return false;
        }
        
        // Block transaction if recipient is in default
        if (recipient != address(0) && inDefault(recipient)) {
            return false;
        }
        
        // valid if sender is not using credit.
        if (amount > 0 && amount <= stableCredit.balanceOf(sender)) {
            return true;
        }
        // A limit with no period is not a line without terms, it is a line whose terms were lost.
        // Treating it as valid is what let a deleted period wave every draw through (audit H-2).
        if (!inInitializedPeriod(sender)) return !_requiresPeriod(sender);
        // valid if sender is not in an active period.
        if (inActivePeriod(sender)) return true;
        // valid if sender's period is paused
        if (creditPeriods[sender].paused) return true;
        // if member is in grace period invalidate transaction
        if (isFrozen(sender)) return false;
        // if end of active credit period, handle expiration
        return expireCreditPeriod(sender);
    }

    /// @notice initializes the credit period for a given member.
    /// @dev intended to be overwritten in parent implementation to include custom underwriting logic.
    /// @param member address of member to initialize credit period for.
    /// @param periodExpiration expiration timestamp of credit period.
    /// @param graceLength length of grace period.
    function _updateCreditPeriod(address member, uint256 periodExpiration, uint256 graceLength)
        /// rename?
        internal
        virtual
    {
        require(periodExpiration > block.timestamp, "CreditIssuer: period expiration in past");
        // create new credit period
        creditPeriods[member] = CreditPeriod({
            issuedAt: block.timestamp,
            expiration: periodExpiration,
            graceLength: graceLength,
            paused: false
        });
        // A member is measured over the terms they are on, not over everything they have ever
        // done, so new terms open a new window.
        _resetIncomeWindow(member);
        emit CreditPeriodCreated(member, periodExpiration, graceLength);
    }

    /* ========== MODIFIERS ========== */

    /// @dev Inherited by RevolvingIssuer and TermIssuer, which is the point: an issuer holds
    /// credit lines, tier positions and carry checkpoints, and none of that survives a
    /// redeployment either.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @dev One of the split credit roles (audit H-4). The admin passes all of them.
    modifier onlyCreditRole(bytes32 role) {
        _requireCreditRole(role);
        _;
    }

    /// @dev Out of line: a modifier body is copied into every function that uses it, and these
    /// contracts sit close to the bytecode size limit.
    function _requireCreditRole(bytes32 role) internal view {
        if (!stableCredit.access().hasCreditRole(role, _msgSender())) {
            revert CreditIssuerMissingRole(role, _msgSender());
        }
    }

    /// @dev Spends `amount` of today's budget, starting a new day's count when the day turns.
    /// A cap of zero has not been set and does not limit anything; the deploy script sets one.
    function _consumeDailyCap(DailyCap storage budget, bytes32 name, uint256 amount) internal {
        if (budget.cap == 0 || amount == 0) return;
        uint64 today = uint64(block.timestamp / 1 days);
        if (budget.day != today) {
            budget.day = today;
            budget.used = 0;
        }
        uint256 remaining = budget.cap > budget.used ? budget.cap - budget.used : 0;
        if (amount > remaining) revert CreditIssuerDailyCapExceeded(name, amount, remaining);
        budget.used += amount;
    }

    modifier onlyOperator() {
        _requireOperator();
        _;
    }

    function _requireOperator() internal view {
        require(stableCredit.access().isOperator(_msgSender()), "CreditIssuer: Unauthorized caller");
    }

    modifier canIssueCreditTo(address member) {
        // only allow member or credit issuer to call
        require(
            _msgSender() == member
                || stableCredit.access().hasCreditRole(CREDIT_LINES_ROLE, _msgSender()),
            "CreditIssuer: Unauthorized caller"
        );
        _;
    }

    modifier onlyStableCredit() {
        _requireStableCredit();
        _;
    }

    function _requireStableCredit() internal view {
        require(
            _msgSender() == address(stableCredit), "CreditIssuer: can only be called by network"
        );
    }

    modifier notInActivePeriod(address member) {
        _requireNotInActivePeriod(member);
        _;
    }

    function _requireNotInActivePeriod(address member) internal view {
        require(!inActivePeriod(member), "CreditIssuer: member in active credit period");
    }

    modifier notNull(address member) {
        _requireNotNull(member);
        _;
    }

    function _requireNotNull(address member) internal pure {
        require(member != address(0), "CreditIssuer: member address can't be null ");
    }
}