// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../core/interfaces/stable-credit/IStableCredit.sol";
import "../core/interfaces/stable-credit/IMutualCredit.sol";
import "../core/interfaces/stable-credit/ICreditIssuer.sol";

/// @title CreditIssuer
/// @notice Issue Credit to network members and store/manage credit periods.
/// @dev This contract is intended to be extended by a parent contract that implements
/// custom credit terms and underwriting logic.
contract CreditIssuer is ICreditIssuer, PausableUpgradeable, OwnableUpgradeable {
    /* ========== STATE VARIABLES ========== */

    IStableCredit public stableCredit;
    // member => credit period
    mapping(address => CreditPeriod) public creditPeriods;
    /// @notice When a member defaulted, or zero if they have not.
    /// @dev Expiring a credit period deletes it, which also erases the evidence that it ended in
    /// default -- `inDefault` reads the period and there is no period left to read. Liquidation
    /// happens after that point, so it needs the fact to outlive the terms.
    mapping(address => uint64) public defaultedAt;

    /* ========== INITIALIZER ========== */

    /// @notice initializes the stable credit address to issue credit for.
    /// @dev should be called directly after deployment (see OpenZeppelin upgradeable standards).
    /// @param _stableCredit address of stable credit contract to issue credit for.
    function __CreditIssuer_init(address _stableCredit) public virtual onlyInitializing {
        __Ownable_init();
        __Pausable_init();
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
    function inCompliance(address member) public view virtual override returns (bool) {
        uint256 creditBalance = stableCredit.creditBalanceOf(member);
        return creditBalance == 0;
    }

    /// @notice returns whether a given member is in default.
    /// @dev returns true if period has expired, grace period has expired, and member is not compliant.
    /// @param member address of member.
    /// @return whether member is in default.
    function inDefault(address member) public view override returns (bool) {
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
    {}

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
    ) external virtual onlyOperator notNull(member) notInActivePeriod(member) {
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
        onlyOperator
    {
        _updateCreditPeriod(member, periodExpiration, graceLength);
    }

    /// @notice enables network operators to pause a given member's credit period.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to pause terms for.
    function pausePeriodOf(address member) external onlyOperator {
        creditPeriods[member].paused = true;
        emit CreditTermsPaused(member);
    }

    /// @notice enables network operators to unpause a given member's credit period.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to unpause period for.
    function unpausePeriodOf(address member) external onlyOperator {
        creditPeriods[member].paused = false;
        emit CreditTermsUnpaused(member);
    }

    /// @notice called by network operators to set the credit period length.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to set period expiration for.
    /// @param periodExpiration expiration timestamp of credit period.
    function setPeriodExpirationOf(address member, uint256 periodExpiration) public onlyOperator {
        creditPeriods[member].expiration = periodExpiration;
    }

    /// @notice called by network operators to set the grace period length.
    /// @dev by default the caller must have operator authorization.
    /// Child implementations should employ authorization logic that is appropriate for the given use case.
    /// @param member address of member to set grace period for.
    /// @param graceLength length of grace period.
    function setGraceLengthOf(address member, uint256 graceLength) public onlyOperator {
        creditPeriods[member].graceLength = graceLength;
        emit GraceLengthUpdated(member, graceLength);
    }

    /* ========== PRIVATE FUNCTIONS ========== */

    /// @notice called when a member's credit period has expired
    /// @dev deletes credit terms and emits a default event if caller is in default.
    /// @param member address of member to expire.
    /// @return true if member is not in default, false if member is in default.
    function expireCreditPeriod(address member) internal virtual returns (bool) {
        bool memberInDefault = inDefault(member);
        delete creditPeriods[member];
        // if member in default, write off credit line and revoke membership
        if (memberInDefault) {
            defaultedAt[member] = uint64(block.timestamp);
            // write off this issuer's share of the debt
            stableCredit.writeOffCreditLine(member, _writeOffAmount(member));
            // revoke membership
            _onDefault(member);
            emit CreditLineDefaulted(member);
            return false;
        }
        emit CreditPeriodExpired(member);
        return true;
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
        // valid if sender period is not initialized.
        if (!inInitializedPeriod(sender)) return true;
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
        emit CreditPeriodCreated(member, periodExpiration, graceLength);
    }

    /* ========== MODIFIERS ========== */

    modifier onlyOperator() {
        require(stableCredit.access().isOperator(_msgSender()), "CreditIssuer: Unauthorized caller");
        _;
    }

    modifier canIssueCreditTo(address member) {
        // only allow member or credit issuer to call
        require(
            _msgSender() == member || stableCredit.access().isOperator(_msgSender()),
            "CreditIssuer: Unauthorized caller"
        );
        _;
    }

    modifier onlyStableCredit() {
        require(
            _msgSender() == address(stableCredit), "CreditIssuer: can only be called by network"
        );
        _;
    }

    modifier notInActivePeriod(address member) {
        require(!inActivePeriod(member), "CreditIssuer: member in active credit period");
        _;
    }

    modifier notNull(address member) {
        require(member != address(0), "CreditIssuer: member address can't be null ");
        _;
    }
}