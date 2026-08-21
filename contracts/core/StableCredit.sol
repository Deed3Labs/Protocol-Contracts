// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./interfaces/stable-credit/IStableCredit.sol";
import "./interfaces/stable-credit/INetworkRegistry.sol";
import "./MutualCredit.sol";

/// @title StableCredit contract
/// @notice Extends the ERC20 standard to include mutual credit functionality where users
/// can mint tokens into existence by utilizing their lines of credit. Credit defaults result
/// in the transfer of the outstanding credit balance to the lost debt balance.
/// @dev Restricted functions are only callable by network operators.

contract StableCredit is MutualCredit, IStableCredit {
    /// @notice thrown when the credit issuer rejects a transaction.
    /// @dev Custom error rather than a require string: production builds strip revert strings,
    /// and a caller needs to be able to tell a rejected transfer apart from a successful one.
    error StableCreditTransactionInvalid(address from, address to, uint256 amount);
    /// @notice thrown when a caller is not an issuer registered against this ledger.
    error StableCreditNotAnIssuer(address caller);
    /// @notice thrown when an issuer acts on a member it has no credit line with.
    error StableCreditNoCreditLine(address issuer, address member);
    /// @notice thrown when carry would be minted to nobody.
    error StableCreditInvalidCarryRecipient();
    /// @notice thrown when a purchase's three legs do not sum to zero.
    error StableCreditPurchaseDoesNotNet(uint256 purchase, uint256 payout, uint256 discount);
    /// @notice thrown when an origination would put a member past their ceiling.
    error StableCreditCeilingExceeded(address member, uint256 owed, uint256 ceiling);

    /// @notice Most distinct rate bands a repayment will work down in one transfer.
    /// @dev A member holds a handful of tiers and a handful of plans, so this bounds a loop that
    /// is already short rather than capping anything real.
    uint256 private constant MAX_WATERFALL_BANDS = 16;

    /* ========== STATE VARIABLES ========== */

    IAccessManager public access;
    IAssurancePool public assurancePool;

    /// @notice Resolves which issuers write to this ledger and which a member is enrolled with.
    /// @dev One ledger, several issuers. The revolving line and term plans are separate rule sets
    /// -- per-tier accrual against per-position accrual, cycle equilibrium against none -- but
    /// they are not separate networks: both write here and both draw on one AssurancePool.
    INetworkRegistry public networkRegistry;

    /// @notice Each issuer's share of a member's ceiling.
    /// @dev The member sees one ceiling. It is composed of parts, and each issuer owns only its
    /// own part, so one cannot silently overwrite another's allocation by setting the total.
    /// @dev issuer => member => ceiling contribution
    mapping(address => mapping(address => uint256)) public issuerCreditLimit;

    /* ========== INITIALIZER ========== */

    /// @notice initializes lost debt account with max limit and assigns access contract provided.
    /// @dev should be called directly after deployment (see OpenZeppelin upgradeable standards).
    /// @param name_ name of the credit token.
    /// @param symbol_ symbol of the credit token.
    /// @param access_ address of access manager contract.
    function __StableCredit_init(string memory name_, string memory symbol_, address access_)
        public
        virtual
        onlyInitializing
    {
        __MutualCredit_init(name_, symbol_);
        // assign "lost debt account" credit line
        setCreditLimit(address(this), type(uint128).max - 1);
        access = IAccessManager(access_);
    }

    /* ========== VIEWS ========== */

    /// @notice Shared account that manages the rectification of lost debt.
    /// @return amount of lost debt shared by network participants.
    function lostDebt() public view override returns (uint256) {
        return creditBalanceOf(address(this));
    }

    /* ========== PUBLIC FUNCTIONS ========== */

    /// @notice Reduces lost debt in exchange for assurance reimbursement.
    /// @dev Must have sufficient lost debt to service.
    /// @return reimbursement amount from assurance pool
    function burnLostDebt(address member, uint256 amount)
        public
        virtual
        override
        returns (uint256)
    {
        require(
            member == _msgSender() || access.isOperator(_msgSender()),
            "StableCredit: Unauthorized caller"
        );
        require(balanceOf(member) >= amount, "StableCredit: Insufficient balance");
        require(amount <= lostDebt(), "StableCredit: Insufficient lost debt");
        _transfer(member, address(this), amount);
        uint256 reimbursement =
            assurancePool.reimburse(member, assurancePool.convertStableCreditToReserveToken(amount));
        emit LostDebtBurned(member, amount);
        return reimbursement;
    }

    /// @notice Repays referenced member's credit balance by amount.
    /// @dev Caller must approve this contract to spend reserve tokens in order to repay.
    function repayCreditBalance(address member, uint128 amount) external {
        _repay(_msgSender(), member, amount, true);
    }

    /// @notice settles a member's obligation on an issuer's instruction.
    /// @dev An undirected repayment says only "reduce what this member owes", and every issuer
    /// the member holds is told so each can take its share -- which in practice means the
    /// revolving line, the demand obligation. A term plan amortizes on a schedule, so a payment
    /// against one has to name it, and the issuer that was named records it itself. Telling the
    /// others as well would have them claim the same payment twice.
    /// @param payer address the reserve tokens are pulled from.
    /// @param member address whose obligation is settled.
    /// @param amount amount settled.
    function repayCreditBalanceFor(address payer, address member, uint128 amount)
        external
        override
        onlyCreditIssuer
    {
        _repay(payer, member, amount, false);
    }

    /// @dev `notify` is false when an issuer directed the payment and has already accounted for
    /// it.
    function _repay(address payer, address member, uint128 amount, bool notify) private {
        uint256 creditBalance = creditBalanceOf(member);
        require(amount <= creditBalance, "StableCredit: invalid payment amount");
        uint256 reserveTokenAmount = assurancePool.convertStableCreditToReserveToken(amount);
        assurancePool.reserveToken().transferFrom(payer, address(this), reserveTokenAmount);
        assurancePool.reserveToken().approve(address(assurancePool), reserveTokenAmount);
        assurancePool.depositIntoBufferReserve(reserveTokenAmount);
        // A repayment is a system move. A frozen member paying down what froze them must not be
        // refused by the freeze.
        if (notify) _systemTransfer(address(this), member, amount);
        else super._transfer(address(this), member, amount);
        emit CreditBalanceRepaid(member, amount);
    }

    /// @notice originates a partner purchase as a three-party mint that nets to zero.
    /// @dev No credit moves and nobody lends anything. The member is debited what they spent, the
    /// merchant is credited what they are owed, and the co-op is credited the difference -- and
    /// the three sum to zero, which is what makes origination capital-free.
    ///
    /// The netting is asserted here rather than left to tests. A purchase that does not net is a
    /// supply bug: it either mints claims nobody owes or leaves an obligation nobody holds, and
    /// both are invisible afterwards because the ledger will happily carry either.
    ///
    /// The merchant's positive balance is the payables ledger. It is what the co-op owes that
    /// merchant, on-chain, with no parallel record to reconcile against.
    /// @param member address taking on the obligation.
    /// @param purchase the amount the member is debited.
    /// @param merchant address receiving the payout.
    /// @param payout the amount the merchant is credited.
    /// @param coop address receiving the discount.
    /// @param discount the amount the co-op is credited.
    function originatePurchase(
        address member,
        uint256 purchase,
        address merchant,
        uint256 payout,
        address coop,
        uint256 discount
    ) external override onlyCreditIssuer {
        if (purchase != payout + discount) {
            revert StableCreditPurchaseDoesNotNet(purchase, payout, discount);
        }
        uint256 owed = creditBalanceOf(member) + purchase;
        uint256 ceiling = creditLimitOf(member);
        if (owed > ceiling) revert StableCreditCeilingExceeded(member, owed, ceiling);

        if (payout > 0) {
            if (merchant == address(0)) revert StableCreditInvalidCarryRecipient();
            _accrueCredit(member, merchant, payout);
        }
        if (discount > 0) {
            if (coop == address(0)) revert StableCreditInvalidCarryRecipient();
            _accrueCredit(member, coop, discount);
        }
        emit PurchaseOriginated(member, merchant, purchase, payout, discount);
    }

    /// @notice deepens a member's negative balance by carry their issuer has accrued.
    /// @dev The member did not spend anything, so nothing leaves their balance: the obligation
    /// grows and the matching claim is minted to whoever is owed it. Net zero, like every other
    /// movement on this ledger.
    ///
    /// Materialising carry is what lets it be repaid at all. While it exists only as a figure the
    /// issuer derives, a payment arriving here can only settle principal, because the balance a
    /// payment burns against does not include it.
    /// @param member address whose obligation grows.
    /// @param recipient address owed the carry.
    /// @param amount amount accrued.
    function accrueCarry(address member, address recipient, uint256 amount)
        external
        override
        onlyCreditIssuer
    {
        if (recipient == address(0)) revert StableCreditInvalidCarryRecipient();
        _accrueCredit(member, recipient, amount);
        emit CarryAccrued(member, recipient, amount);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /// @notice called by the underwriting layer to assign credit lines
    /// @dev If the member address is not a current member, then the address is granted membership
    /// @param member address of line holder
    /// @param limit credit limit of new line
    /// @param initialBalance positive balance to initialize member with (will increment lost debt)
    function createCreditLine(address member, uint256 limit, uint256 initialBalance)
        public
        virtual
        override
        onlyCreditIssuer
    {
        // if member is not a current member, then grant membership
        if (!access.isMember(member)) access.grantMember(member);
        // record the member against this issuer before summing, so the new allocation is counted
        networkRegistry.enrolMember(member, _msgSender());
        issuerCreditLimit[_msgSender()][member] = limit;
        _syncCreditLimit(member);
        // if initial balance is greater than zero, transfer to member. Opening a line is a system
        // move, not a member transaction: there is nothing yet to validate against.
        if (initialBalance > 0) _systemTransfer(address(this), member, initialBalance);
        emit CreditLineCreated(member, limit, initialBalance);
    }

    /// @notice update existing credit lines
    /// @param creditLimit must be greater than given member's outstanding debt
    function updateCreditLimit(address member, uint256 creditLimit) external onlyCreditIssuer {
        if (!networkRegistry.isEnrolled(member, _msgSender())) {
            revert StableCreditNoCreditLine(_msgSender(), member);
        }
        issuerCreditLimit[_msgSender()][member] = creditLimit;
        // The total, not this allocation, has to cover what is drawn. A member's debt is one
        // number and any issuer's ceiling may be reduced while another's still carries it.
        require(_totalCreditLimit(member) >= creditBalanceOf(member),
            "StableCredit: invalid credit limit");
        _syncCreditLimit(member);
        emit CreditLimitUpdated(member, creditLimit);
    }

    /// @notice transfer a given member's debt to the lost debt account
    /// @dev The issuer states how much of the balance is its own. A member's debt is one signed
    /// number that several issuers may have contributed to, so defaulting at one must not write
    /// off what another is still carrying. Bounded by what is actually outstanding.
    /// @param member address of member to write off
    /// @param amount the issuer's share of the member's debt
    function writeOffCreditLine(address member, uint256 amount) public virtual onlyCreditIssuer {
        uint256 creditBalance = creditBalanceOf(member);
        uint256 writeOff = amount > creditBalance ? creditBalance : amount;
        // A write-off is the ledger recognising a loss, not a payment anyone is making. It cannot
        // be blocked by the state that caused it.
        if (writeOff > 0) _systemTransfer(address(this), member, writeOff);
        // The issuer's ceiling goes with the debt it was carrying.
        issuerCreditLimit[_msgSender()][member] = 0;
        _syncCreditLimit(member);
        emit CreditLineWrittenOff(member, writeOff);
    }

    /// @notice enables network admin to set the access manager address
    /// @param _access address of access manager contract
    function setAccessManager(address _access) external onlyAdmin {
        access = IAccessManager(_access);
        emit AccessManagerUpdated(_access);
    }

    /// @notice enables network admin to set the assurance pool address
    /// @param _assurancePool address of assurance pool contract
    function setAssurancePool(address _assurancePool) public onlyAdmin {
        assurancePool = IAssurancePool(_assurancePool);
        emit AssurancePoolUpdated(_assurancePool);
    }

    /// @notice enables network admin to set the network registry address
    /// @param _networkRegistry address of the network registry
    function setNetworkRegistry(address _networkRegistry) external onlyAdmin {
        networkRegistry = INetworkRegistry(_networkRegistry);
        emit NetworkRegistryUpdated(_networkRegistry);
    }

    /* ========== PRIVATE FUNCTIONS ========== */

    /// @dev Validates the caller's credit line and synchronizes demurrage balance.
    function _transfer(address _from, address _to, uint256 _amount)
        internal
        virtual
        override
        senderIsMember(_from)
    {
        // Revert rather than return. A silent return leaves ERC20 `transfer` answering true for a
        // transfer that moved nothing, so a frozen or defaulted member's rejected payment reads as
        // settled to every integrator. It also breaks the netting invariant the mint path depends
        // on: a three-party purchase must net to zero, and it cannot if one leg can quietly
        // no-op while the others land.
        if (!_validateAcrossIssuers(_from, _to, _amount)) {
            revert StableCreditTransactionInvalid(_from, _to, _amount);
        }
        uint256 burned = _repaymentOf(_to, _amount);
        super._transfer(_from, _to, _amount);
        _settleRepayment(_to, burned);
    }

    /// @notice moves credit without asking any issuer's permission.
    /// @dev For the ledger's own bookkeeping: opening a line, recognising a write-off, settling a
    /// repayment. None of those are a member spending, and all three would otherwise be blocked
    /// by exactly the delinquency that provoked them.
    function _systemTransfer(address _from, address _to, uint256 _amount) internal {
        uint256 burned = _repaymentOf(_to, _amount);
        super._transfer(_from, _to, _amount);
        // Told afterwards rather than asked beforehand. An issuer describing what a member's
        // balance is made of still has to see the movement, or its composition drifts from the
        // balance it describes -- but it does not get to refuse it.
        _notifyIssuersOf(_from, _from, _to, _amount);
        _settleRepayment(_to, burned);
    }

    /// @notice how much of an incoming amount will burn against the recipient's debt.
    /// @dev Read before the transfer, because afterwards the balance it burned against is gone.
    function _repaymentOf(address _to, uint256 _amount) private view returns (uint256) {
        if (_to == address(0)) return 0;
        uint256 owed = creditBalanceOf(_to);
        return owed < _amount ? owed : _amount;
    }

    /// @notice attributes a repayment across the issuers that share the member's balance.
    /// @dev The ledger holds one signed number and, with more than one issuer, that number is
    /// jointly owned. Announcing a payment to each of them would have each record the whole of
    /// it, so instead each is offered what is left and answers with what it took. The ledger is
    /// the only party that can do this, because it is the only one that knows the total.
    ///
    /// The order is cost, not issuer. A payment clears the dearest position a member holds first,
    /// wherever it sits -- a cash advance outranks the income tier, and Clear Boost outranks the
    /// advance. Ordering by issuer instead would have the revolving line clear its cheap tiers
    /// ahead of a term plan costing twice as much, which is the same money buying less relief.
    /// So the ledger works down the rate bands: it asks what the dearest open rate is, offers
    /// that band to every issuer, and repeats.
    ///
    /// Drawing runs the other way, cheapest first, which is why the two together are a waterfall
    /// rather than a rule anyone has to enforce.
    ///
    /// Anything left unattributed means the issuers collectively hold less than the ledger says
    /// is owed. That is a drift they cannot cause on their own and the ledger does not try to
    /// paper over: the payment still settled, and the discrepancy stays visible.
    function _settleRepayment(address member, uint256 burned) private {
        if (burned == 0 || address(networkRegistry) == address(0)) return;
        address[] memory issuers = networkRegistry.issuersOf(member);
        if (issuers.length == 0) return;

        uint256 remaining = burned;
        for (uint256 round = 0; round < MAX_WATERFALL_BANDS && remaining > 0; round++) {
            (uint256 band, bool any) = _dearestOpenRate(member, issuers);
            if (!any) break;

            uint256 before = remaining;
            for (uint256 i = 0; i < issuers.length && remaining > 0; i++) {
                uint256 absorbed =
                    ICreditIssuer(issuers[i]).absorbRepayment(member, remaining, band);
                if (absorbed > remaining) absorbed = remaining;
                remaining -= absorbed;
            }
            // A band that absorbs nothing will absorb nothing next time either.
            if (remaining == before) break;
        }
    }

    /// @dev The dearest per-cycle rate any of these issuers still holds a position at.
    function _dearestOpenRate(address member, address[] memory issuers)
        private
        view
        returns (uint256 band, bool any)
    {
        for (uint256 i = 0; i < issuers.length; i++) {
            (uint256 rate, bool hasPosition) = ICreditIssuer(issuers[i]).nextRepaymentRate(member);
            if (!hasPosition) continue;
            if (!any || rate > band) {
                band = rate;
                any = true;
            }
        }
    }

    /// @dev Mirrors `_askIssuersOf`, minus the veto.
    function _notifyIssuersOf(address party, address _from, address _to, uint256 _amount) private {
        if (party == address(0) || address(networkRegistry) == address(0)) return;
        address[] memory issuers = networkRegistry.issuersOf(party);
        for (uint256 i = 0; i < issuers.length; i++) {
            if (party == _to && networkRegistry.isEnrolled(_from, issuers[i])) continue;
            ICreditIssuer(issuers[i]).syncCreditPositions(_from, _to, _amount);
        }
    }

    /// @notice asks every issuer either party is enrolled with.
    /// @dev Conjunctive on purpose. A member in default on a term plan should not keep spending on
    /// their revolving line, so any issuer may refuse. Each call also lets that issuer sync its
    /// own period state, which is why this is not a view.
    function _validateAcrossIssuers(address _from, address _to, uint256 _amount)
        private
        returns (bool)
    {
        if (!_askIssuersOf(_from, _from, _to, _amount)) return false;
        return _askIssuersOf(_to, _from, _to, _amount);
    }

    /// @dev Asks the issuers `party` is enrolled with. Skips any issuer the sender already
    /// answered for, so a member enrolled with the same issuer on both sides is asked once.
    function _askIssuersOf(address party, address _from, address _to, uint256 _amount)
        private
        returns (bool)
    {
        if (party == address(0) || address(networkRegistry) == address(0)) return true;
        address[] memory issuers = networkRegistry.issuersOf(party);
        for (uint256 i = 0; i < issuers.length; i++) {
            if (party == _to && networkRegistry.isEnrolled(_from, issuers[i])) continue;
            if (!ICreditIssuer(issuers[i]).validateCreditTransaction(_from, _to, _amount)) {
                return false;
            }
        }
        return true;
    }

    /// @notice the sum of every issuer's contribution to a member's ceiling.
    function _totalCreditLimit(address member) internal view returns (uint256 total) {
        address[] memory issuers = networkRegistry.issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            total += issuerCreditLimit[issuers[i]][member];
        }
    }

    /// @notice writes the member's ceiling as the sum of its parts.
    /// @dev Never a separately maintained total: it is recomputed from the allocations every time
    /// one of them moves, so it cannot drift from what the issuers actually granted.
    function _syncCreditLimit(address member) internal {
        setCreditLimit(member, _totalCreditLimit(member));
    }

    /// @notice the sum of every issuer's contribution to a member's ceiling.
    /// @param member address of the member.
    /// @return the member's total ceiling.
    function totalCreditLimitOf(address member) external view returns (uint256) {
        return _totalCreditLimit(member);
    }

    /* ========== MODIFIERS ========== */

    modifier onlyAdmin() {
        require(access.isAdmin(_msgSender()), "StableCredit: Unauthorized caller");
        _;
    }

    modifier senderIsMember(address sender) {
        require(
            access.isMember(sender) || access.isOperator(sender),
            "StableCredit: Sender is not network member"
        );
        _;
    }

    modifier onlyCreditIssuer() {
        if (
            address(networkRegistry) == address(0)
                || !networkRegistry.isIssuerOf(_msgSender(), address(this))
        ) revert StableCreditNotAnIssuer(_msgSender());
        _;
    }
}
