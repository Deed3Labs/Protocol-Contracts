// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./interfaces/stable-credit/IStableCredit.sol";
import "./interfaces/stable-credit/INetworkRegistry.sol";
import "./interfaces/stable-credit/IPayoutSink.sol";
import "./interfaces/stable-credit/IMerchantStatus.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./MutualCredit.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/// @title StableCredit contract
/// @notice Extends the ERC20 standard to include mutual credit functionality where users
/// can mint tokens into existence by utilizing their lines of credit. Credit defaults result
/// in the transfer of the outstanding credit balance to the lost debt balance.
/// @dev Restricted functions are only callable by network operators.

contract StableCredit is MutualCredit, UUPSUpgradeable, IStableCredit {
    /// @notice thrown when the credit issuer rejects a transaction.
    /// @dev Custom error rather than a require string: production builds strip revert strings,
    /// and a caller needs to be able to tell a rejected transfer apart from a successful one.
    error StableCreditTransactionInvalid(address from, address to, uint256 amount);
    /// @notice thrown when a caller is not an issuer registered against this ledger.
    error StableCreditNotAnIssuer(address caller);
    /// @notice thrown when an issuer acts on a member it has no credit line with.
    error StableCreditNoCreditLine(address issuer, address member);
    /// @notice thrown when carry would be minted to nobody.
    event RepaymentRouted(address indexed destination, uint256 amount);
    event PayoutPoolUpdated(address indexed payoutPool);
    event ClaimSettled(address indexed holder, uint256 amount);
    event RefundRepaid(address indexed member, uint256 returned, uint256 carryWithheld);
    event RefundCarryWithheld(address indexed member, uint256 amount);

    error StableCreditInvalidCarryRecipient();
    /// @notice thrown when a purchase's three legs do not sum to zero.
    error StableCreditPurchaseDoesNotNet(uint256 purchase, uint256 payout, uint256 discount);
    error StableCreditReversalExceedsObligation(address member, uint256 reversing, uint256 owed);
    error StableCreditTreasuryCannotCoverDiscount(uint256 discount, uint256 held);
    /// @notice thrown when an origination would put a member past their ceiling.
    error StableCreditCeilingExceeded(address member, uint256 owed, uint256 ceiling);
    /// @dev Only the payout pool can say a claim was paid with a member's own money.
    error StableCreditUnauthorizedSettler(address caller);
    /// @dev Carry withheld cannot be more than the member is being paid back.
    error StableCreditRefundExceedsPayment(uint256 withheld, uint256 paid);
    /// @dev A refund pays cash, and the pool is where the cash is.
    error StableCreditNoPayoutPool();
    /// @notice thrown when credit is sent somewhere Phase 1 does not allow it to go.
    /// @dev Credit is spent at an active merchant or paid to a named system address. Anything
    /// else is a member-to-member transfer, which is how a credit line used to become cash at the
    /// payout pool (audit C-1, M-1).
    error StableCreditRecipientNotEligible(address from, address to);
    /// @notice thrown when a merchant sends credit anywhere but the payout pool.
    /// @dev A merchant's balance is a payable. Handing it to another wallet is how a deactivated
    /// merchant used to get paid anyway (audit H-1).
    error StableCreditMerchantMayOnlyRedeem(address merchant, address to);
    /// @dev Zero is not a valid "off" value for these.
    error StableCreditInvalidAddress();
    /// @notice thrown by `burn` and `burnFrom`, which the ledger does not offer.
    error StableCreditBurnDisabled();

    event MerchantRegistryUpdated(address indexed merchantRegistry);
    /// @notice a refund or reversal left `holder` owing; tracked until it is collected.
    event RefundReceivableRecorded(address indexed holder, uint256 amount);
    /// @notice part of `holder`'s refund debt was collected.
    event RefundReceivableCollected(address indexed holder, uint256 amount);
    event SystemRecipientUpdated(address indexed recipient, bool allowed);

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

    /// @notice Claims in circulation with no promise behind them.
    /// @dev Counted, not derived. It used to be read off this contract's own credit balance, but
    /// that balance does two unrelated jobs: it absorbs written-off debt, and it is the
    /// counterparty for every repayment funded with reserve tokens. Those are opposites. A
    /// write-off leaves supply orphaned; a repayment leaves the same supply backed by USDC that
    /// just arrived in the reserve. Reading one number for both reported a member who paid their
    /// balance in full as having created lost debt.
    ///
    /// It mattered beyond the reporting: redemption capacity equals lost debt outstanding, so an
    /// overstated figure let positive holders draw on the AssurancePool for supply that was never
    /// orphaned -- ordinary repayment activity quietly opening a drain.
    uint256 private lostDebtOutstanding;

    /// @notice Where repayment value goes first, when there is somewhere for it to go.
    /// @dev Optional. Unset, everything lands in loss absorption, which is the inherited
    /// behaviour and was the only option before there was a payout pool at all.
    IPayoutSink public payoutPool;

    /// @notice Who the network's merchants are, and which of them are switched on.
    /// @dev Read on every member transfer. Appended after every variable the deployed
    /// implementation already has.
    IMerchantStatus public merchantRegistry;

    /// @notice System addresses a member may pay credit to besides a merchant.
    /// @dev Named by the admin, never by an operator key. A hot key that could name a recipient
    /// could name itself and turn any line into cash, which is the attack this list exists to stop.
    mapping(address => bool) public isSystemRecipient;

    /// @notice What a merchant (or the co-op) owes back because a sale they were paid for was
    /// refunded or reversed after they had drawn their payout down.
    /// @dev Tracked separately from debt any issuer holds, because no issuer holds this: it accrues
    /// nothing and no schedule describes it. It is collected first out of whatever reaches the
    /// holder next -- a sale minted to them (`originatePurchase`), a transfer, a repayment -- and
    /// never offered to an issuer as a repayment of something else (audit X-3, X-4).
    mapping(address => uint256) public refundReceivableOf;
    /// @notice The sum of `refundReceivableOf`.
    uint256 public refundReceivables;

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
        __UUPSUpgradeable_init();
        // assign "lost debt account" credit line
        setCreditLimit(address(this), type(uint128).max - 1);
        access = IAccessManager(access_);
    }

    /* ========== VIEWS ========== */

    /// @notice Shared account that manages the rectification of lost debt.
    /// @return amount of lost debt shared by network participants.
    function lostDebt() public view override returns (uint256) {
        return lostDebtOutstanding;
    }

    /// @inheritdoc IStableCredit
    function isEligibleRecipient(address recipient) public view override returns (bool) {
        if (recipient == address(0)) return false;
        if (isSystemRecipient[recipient]) return true;
        return isActiveMerchant(recipient);
    }

    /// @inheritdoc IStableCredit
    function isActiveMerchant(address merchant) public view override returns (bool) {
        if (merchant == address(0) || address(merchantRegistry) == address(0)) return false;
        return merchantRegistry.isRegistered(merchant) && merchantRegistry.isActive(merchant);
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
        // Redemption is how lost debt is deleted, so the figure falls by what was redeemed.
        lostDebtOutstanding -= amount;
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
        // Safe transfer: a reserve token that returns false must not read as paid (audit L-5).
        SafeERC20Upgradeable.safeTransferFrom(
            assurancePool.reserveToken(), payer, address(this), reserveTokenAmount
        );
        _routeRepayment(reserveTokenAmount);
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
            _accrueToRecipient(member, merchant, payout);
        }
        if (discount > 0) {
            if (coop == address(0)) revert StableCreditInvalidCarryRecipient();
            _accrueToRecipient(member, coop, discount);
        }
        emit PurchaseOriginated(member, merchant, purchase, payout, discount);
    }

    /// @dev Mints a sale's share to whoever earned it, after collecting any refund they still owe.
    /// Minting it in full while they owed on a refund let a merchant redeem every new sale while
    /// the refund debt stood untouched (audit X-4).
    function _accrueToRecipient(address member, address recipient, uint256 amount) private {
        uint256 netted =
            _accrueCreditNetted(member, recipient, amount, refundReceivableOf[recipient]);
        if (netted > 0) _collectReceivable(recipient, netted);
    }

    /// @dev Records a refund debt.
    function _recordReceivable(address holder, uint256 amount) private {
        if (amount == 0) return;
        refundReceivableOf[holder] += amount;
        refundReceivables += amount;
        emit RefundReceivableRecorded(holder, amount);
    }

    /// @dev Marks up to `amount` of a holder's refund debt as collected, and says how much was.
    function _collectReceivable(address holder, uint256 amount) private returns (uint256 taken) {
        uint256 owed = refundReceivableOf[holder];
        taken = amount < owed ? amount : owed;
        if (taken == 0) return 0;
        refundReceivableOf[holder] = owed - taken;
        refundReceivables -= taken;
        emit RefundReceivableCollected(holder, taken);
    }

    /// @notice unwinds a purchase: the exact inverse of `originatePurchase`, and capital-free.
    /// @dev A refund is not a payment. Origination minted three entries that summed to zero
    /// without capital, so undoing it must not need any either -- routing a refund through
    /// `repayCreditBalanceFor` would make the co-op buy the member's obligation back with reserve
    /// tokens it never received, and would leave the discount minted.
    ///
    /// The netting is asserted the same way it is on the way in, for the same reason: a reversal
    /// that does not net either burns claims nobody gave up or forgives obligations nobody held.
    ///
    /// **What makes this work whether or not the merchant has been paid.** Their claim is the
    /// payables ledger. If they still hold it, it is burned and the whole thing nets to zero with
    /// nothing moving. If they have already drawn it down, there is less to burn than to reverse,
    /// and the shortfall becomes an obligation of theirs with the matching claim minted to the
    /// co-op -- which is the same entry with the sign flipped, and reads as what it is: the co-op
    /// is now owed that much by the merchant, to come off what they are paid next.
    ///
    /// The member's leg is not limit-checked. Their obligation only shrinks here, and a member
    /// already over their ceiling must still be able to have a purchase given back to them.
    /// @param member address whose obligation is being unwound.
    /// @param purchase the amount to take off what the member owes.
    /// @param merchant address whose claim is being taken back.
    /// @param payout the merchant's share of the original mint.
    /// @param coop address holding the discount, and the counterparty for any shortfall.
    /// @param discount the co-op's share of the original mint.
    function reversePurchase(
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
        uint256 owed = creditBalanceOf(member);
        if (purchase > owed) revert StableCreditReversalExceedsObligation(member, purchase, owed);

        if (discount > 0) {
            if (coop == address(0)) revert StableCreditInvalidCarryRecipient();
            // The treasury's own leg. If it cannot cover it, that is an internal matter and worth
            // stopping on rather than papering over with an entry against itself.
            uint256 treasuryHeld = balanceOf(coop);
            if (treasuryHeld < discount) {
                revert StableCreditTreasuryCannotCoverDiscount(discount, treasuryHeld);
            }
            _reverseCredit(member, coop, discount);
        }

        if (payout > 0) {
            if (merchant == address(0)) revert StableCreditInvalidCarryRecipient();
            uint256 held = balanceOf(merchant);
            uint256 burnable = held < payout ? held : payout;
            // Whatever is still on the shelf comes straight back off it.
            _reverseCredit(member, merchant, burnable);

            uint256 shortfall = payout - burnable;
            if (shortfall > 0) {
                // Drawn down already, so there is no claim left to take back -- and none is
                // minted or burned to stand in for one. The obligation simply changes hands: the
                // member is released, the merchant carries it, and it comes off what they are
                // paid next. Same entry as the burn above, with the sign flipped.
                _transferObligation(member, merchant, shortfall);
                // Tracked, so it is collected out of the merchant's next sale rather than left
                // for an issuer that never heard of it (audit X-4b).
                _recordReceivable(merchant, shortfall);
                emit RefundOwedByMerchant(merchant, shortfall);
            }
        }
        emit PurchaseReversed(member, merchant, purchase, payout, discount);
    }

    /// @notice gives a member back money they paid, for a purchase that has been given back.
    /// @dev The other half of a refund, and the half that was missing. `reversePurchase` cancels
    /// what a member still OWES; this returns what they have already PAID. A refund that only did
    /// the first left a member who had paid half a plan out of pocket by that half on a purchase
    /// they no longer had -- level on the ledger and short in cash, with the value sitting where
    /// they paid it.
    ///
    /// The legs net, as they do on the way in: what the member gets back is what the merchant and
    /// the co-op give up. Each gives up its share of the sale it was paid for.
    ///
    /// The merchant's side is burned where they still hold it and becomes their obligation where
    /// they do not, which is the same rule `reversePurchase` uses and for the same reason: a
    /// merchant who has drawn their payout down has nothing left to take back, so it comes off what
    /// they are paid next.
    ///
    /// `carryWithheld` is carry the member incurred while they held the money, kept out of the cash
    /// and settled against what they owe. They paid for the time they had it, which is right, and
    /// nothing is left stranded on the ledger for somebody to chase.
    /// @param member address being paid back.
    /// @param paid what they paid, and the sum of the two shares below.
    /// @param merchant address giving back their share.
    /// @param merchantShare the merchant's share of it.
    /// @param coop address giving back the fee it took.
    /// @param coopShare the co-op's share of it.
    /// @param carryWithheld carry to settle out of the cash rather than return.
    function repayRefund(
        address member,
        uint256 paid,
        address merchant,
        uint256 merchantShare,
        address coop,
        uint256 coopShare,
        uint256 carryWithheld
    ) external override onlyCreditIssuer {
        if (paid != merchantShare + coopShare) {
            revert StableCreditPurchaseDoesNotNet(paid, merchantShare, coopShare);
        }
        if (carryWithheld > paid) revert StableCreditRefundExceedsPayment(carryWithheld, paid);
        if (address(payoutPool) == address(0)) revert StableCreditNoPayoutPool();

        _takeBack(coop, coopShare);
        _takeBack(merchant, merchantShare);

        /*
         * The carry comes out of the cash, and the cash kept back settles it. What is withheld
         * stays in the payout pool as the member's money; the member's obligation falls by the
         * same amount, so they are square rather than paying the carry once out of the refund and
         * again on the ledger (audit X-5).
         *
         * Directed at the carry, not offered to the issuers: a refund's carry is left on no plan
         * once the plan closes, and letting a revolving tier absorb it would clear the wrong debt.
         * Bounded by what they actually owe.
         */
        uint256 returning = paid - carryWithheld;
        if (carryWithheld > 0) {
            uint256 owes = creditBalanceOf(member);
            uint256 settle = carryWithheld < owes ? carryWithheld : owes;
            if (settle > 0) super._transfer(address(this), member, settle);
            emit RefundCarryWithheld(member, carryWithheld);
        }
        payoutPool.payRefund(member, returning);
        emit RefundRepaid(member, returning, carryWithheld);
    }

    /// @dev Takes a share back off whoever was paid it: burned where they still hold the claim,
    /// and owed by them where they have already drawn it down.
    ///
    /// Not a transfer of the member's obligation, which is what a reversal does. A member being
    /// paid back in cash has already settled theirs -- there is nothing of theirs to move, and the
    /// ledger rightly refuses to move it. What is true instead is that the merchant now owes the
    /// money: they were paid for a sale that has been given back, and the cash going to the member
    /// came out of the pool. So the obligation is THEIRS, newly made, and the matching claim goes
    /// to the pool that is out of pocket for it.
    ///
    /// Which is also how it comes back. Credits reaching a party with an obligation burn against it
    /// (`_afterTransfer`), so the merchant's next sale settles this before it pays them anything --
    /// the drawn line, netted automatically rather than chased.
    ///
    /// Never the member's obligation (audit X-1). The member being refunded has paid this purchase;
    /// whatever else they owe belongs to other purchases, and moving it here forgave it while also
    /// paying them in cash. And no claim is minted to the pool for the shortfall (audit X-3): the
    /// refund cash comes out of members' money that was standing behind claims others still hold,
    /// so the holder's new obligation stands behind those claims instead, and a second claim would
    /// count it twice.
    function _takeBack(address holder, uint256 amount) private {
        if (amount == 0) return;
        if (holder == address(0)) revert StableCreditInvalidCarryRecipient();
        uint256 held = balanceOf(holder);
        uint256 burnable = held < amount ? held : amount;
        if (burnable > 0) _burn(holder, burnable);
        uint256 shortfall = amount - burnable;
        if (shortfall == 0) return;

        _createObligation(holder, shortfall);
        _recordReceivable(holder, shortfall);
        emit RefundOwedByMerchant(holder, shortfall);
    }

    /// @notice burns a claim that has been paid in cash.
    /// @dev Called by the payout pool when a member's own repayment is what pays a claim. Their
    /// obligation went when they paid, and the cash that settled it is leaving now — so the claim
    /// is burned rather than moved, and supply comes back into step with what members owe.
    ///
    /// Deliberately not a burn anybody may call: a claim paid with CAPITAL is not settled at all.
    /// The member still owes it, so the funder keeps the position and the pool transfers it there
    /// instead. Only the pool knows which cash paid, so only the pool may say a claim is settled.
    /// @param holder address whose claim is being extinguished.
    /// @param amount amount paid.
    function settleClaim(address holder, uint256 amount) external override {
        if (_msgSender() != address(payoutPool)) revert StableCreditUnauthorizedSettler(_msgSender());
        _burn(holder, amount);
        emit ClaimSettled(holder, amount);
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
        if (writeOff > 0) {
            _writeOffTransfer(member, writeOff);
            // The only thing that creates lost debt: an obligation gone with its credits still
            // out there.
            lostDebtOutstanding += writeOff;
        }
        // The issuer's ceiling goes with the debt it was carrying.
        issuerCreditLimit[_msgSender()][member] = 0;
        _syncCreditLimit(member);
        emit CreditLineWrittenOff(member, writeOff);
    }

    /// @notice a claim cannot be burned by whoever holds it.
    /// @dev Every claim is matched by an obligation; burning one leaves supply out of step with what
    /// is owed, which the payout pool and the RTD both read (audit L-2). Claims leave the ledger by
    /// settlement, reversal or write-off, each of which moves the other side as well.
    function burn(uint256) public pure override {
        revert StableCreditBurnDisabled();
    }

    /// @notice see `burn`.
    function burnFrom(address, uint256) public pure override {
        revert StableCreditBurnDisabled();
    }

    /// @notice enables network admin to set the access manager address
    /// @param _access address of access manager contract
    function setAccessManager(address _access) external onlyAdmin {
        if (_access == address(0)) revert StableCreditInvalidAddress();
        access = IAccessManager(_access);
        emit AccessManagerUpdated(_access);
    }

    /// @notice enables network admin to set the assurance pool address
    /// @param _assurancePool address of assurance pool contract
    function setAssurancePool(address _assurancePool) public onlyAdmin {
        if (_assurancePool == address(0)) revert StableCreditInvalidAddress();
        assurancePool = IAssurancePool(_assurancePool);
        emit AssurancePoolUpdated(_assurancePool);
    }

    /// @notice names the registry the ledger reads to tell a merchant from a member.
    /// @param _merchantRegistry address of the merchant registry.
    function setMerchantRegistry(address _merchantRegistry) external onlyAdmin {
        if (_merchantRegistry == address(0)) revert StableCreditInvalidAddress();
        merchantRegistry = IMerchantStatus(_merchantRegistry);
        emit MerchantRegistryUpdated(_merchantRegistry);
    }

    /// @notice names, or un-names, a system address members may pay credit to.
    /// @dev For the co-op's own accounts (the treasury, the card settlement float). Never the
    /// payout pool: credit sent there outside `redeem` would be counted as carry.
    /// @param recipient the system address.
    /// @param allowed whether members may pay it.
    function setSystemRecipient(address recipient, bool allowed) external onlyAdmin {
        if (recipient == address(0) || recipient == address(payoutPool)) {
            revert StableCreditInvalidAddress();
        }
        isSystemRecipient[recipient] = allowed;
        emit SystemRecipientUpdated(recipient, allowed);
    }

    /// @notice enables network admin to set the network registry address
    /// @param _networkRegistry address of the network registry
    function setNetworkRegistry(address _networkRegistry) external onlyAdmin {
        if (_networkRegistry == address(0)) revert StableCreditInvalidAddress();
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
        _checkTransferPolicy(_from, _to);
        if (!_validateAcrossIssuers(_from, _to, _amount)) {
            revert StableCreditTransactionInvalid(_from, _to, _amount);
        }
        uint256 burned = _repaymentOf(_to, _amount);
        super._transfer(_from, _to, _amount);
        _settleRepayment(_to, burned - _collectReceivable(_to, burned));
    }

    /// @notice where a member-initiated transfer may send credit.
    /// @dev Phase 1 has no member-to-member payments. Credit is spent at an active merchant, paid
    /// to a named system address, or handed to the payout pool by `redeem`; a merchant's balance
    /// goes only to the payout pool. The system's own contracts are exempt: the payout pool
    /// handing a position to whoever funded it, or an issuer paying out of its own line.
    ///
    /// Applies once a merchant registry is set. Until then the ledger cannot tell a merchant from a
    /// member, so it does not try -- but drawing on credit is still refused, because the issuers
    /// ask `isEligibleRecipient`, which fails closed. That is the dangerous half: a positive
    /// balance moved to a wallet that cannot redeem it has not become cash.
    function _checkTransferPolicy(address _from, address _to) private view {
        if (address(merchantRegistry) == address(0)) return;
        if (_from == address(payoutPool) && _from != address(0)) return;
        if (
            address(networkRegistry) != address(0)
                && networkRegistry.isIssuerOf(_from, address(this))
        ) return;
        bool toPool = _to == address(payoutPool) && _to != address(0);
        if (merchantRegistry.isRegistered(_from)) {
            if (!toPool) revert StableCreditMerchantMayOnlyRedeem(_from, _to);
            return;
        }
        if (!toPool && !isEligibleRecipient(_to)) {
            revert StableCreditRecipientNotEligible(_from, _to);
        }
    }

    /// @notice what a plain transfer may still mint for a member.
    /// @dev A term allocation is drawn through a plan, which always records a schedule, so a plain
    /// transfer may mint only against what is left of the rest of the ceiling. The debt held
    /// against the locked part is taken off the balance first, so a member with a term plan
    /// outstanding keeps the revolving headroom they actually have (audit C-1).
    function _drawableCreditOf(address member) internal view override returns (uint256) {
        uint256 left = creditLimitLeftOf(member);
        if (member == address(this) || address(networkRegistry) == address(0)) return left;

        uint256 locked;
        uint256 lockedDrawn;
        address[] memory issuers = networkRegistry.issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            (uint256 allocation, uint256 drawn) = ICreditIssuer(issuers[i]).lockedAllocationOf(member);
            locked += allocation;
            lockedDrawn += drawn;
        }
        if (locked == 0) return left;

        uint256 limit = creditLimitOf(member);
        uint256 transferableLimit = limit > locked ? limit - locked : 0;
        uint256 owed = creditBalanceOf(member);
        uint256 transferableOwed = owed > lockedDrawn ? owed - lockedDrawn : 0;
        uint256 transferableLeft =
            transferableLimit > transferableOwed ? transferableLimit - transferableOwed : 0;
        return transferableLeft < left ? transferableLeft : left;
    }

    /// @notice moves credit without asking any issuer's permission.
    /// @dev For the ledger's own bookkeeping: opening a line, recognising a write-off, settling a
    /// repayment. None of those are a member spending, and all three would otherwise be blocked
    /// by exactly the delinquency that provoked them.
    function _systemTransfer(address _from, address _to, uint256 _amount) internal {
        uint256 burned = _repaymentOf(_to, _amount);
        // Told before the move, not after. An issuer measuring how long a balance was carried
        // integrates it at the balance standing when it is told, and telling it afterwards would
        // credit the whole stretch at the balance the move just produced -- so a member who
        // carried a thousand for a month and then cleared it would read as having carried
        // nothing. Told rather than asked: this is not a movement an issuer may refuse. An issuer describing what a member's
        // balance is made of still has to see the movement, or its composition drifts from the
        // balance it describes -- but it does not get to refuse it.
        _notifyIssuersOf(_from, _from, _to, _amount);
        // The recipient's issuers are told as well as asked to absorb. Absorbing is about
        // positions; being told is about everything else an issuer measures, and value arriving
        // from outside the ledger is exactly the income half of a member's ITD.
        _notifyIssuersOf(_to, _from, _to, _amount);
        super._transfer(_from, _to, _amount);
        // A refund debt is collected before anything an issuer holds, and never offered to one.
        _settleRepayment(_to, burned - _collectReceivable(_to, burned));
    }

    /// @notice moves a written-off amount onto the ledger's line, attributed to the issuer that
    /// wrote it off and to no other.
    /// @dev Like `_systemTransfer` -- every issuer is told, so what each measures stays in step --
    /// but the reduction is offered only to the defaulting issuer. A write-off is not a payment:
    /// running it through the rate-band waterfall let a term default clear a dearer revolving tier
    /// and leave the term debt untracked, and a revolving default clear a term plan's arrears
    /// (audit X-6).
    function _writeOffTransfer(address member, uint256 amount) private {
        uint256 burned = _repaymentOf(member, amount);
        _notifyIssuersOf(address(this), address(this), member, amount);
        _notifyIssuersOf(member, address(this), member, amount);
        super._transfer(address(this), member, amount);
        uint256 remaining = burned - _collectReceivable(member, burned);
        if (remaining > 0) ICreditIssuer(_msgSender()).absorbRepayment(member, remaining, 0);
    }

    /// @notice sends repayment value where it is owed before where it might be needed.
    /// @dev A member clearing their balance is how the merchant holding the other side of that
    /// purchase gets paid. Everything used to go straight into the AssurancePool's buffer
    /// reserve, which a payout may only borrow from as a last resort -- so the working capital
    /// for net-30 accumulated exactly where it could not be spent, and the co-op had to find the
    /// money somewhere else while its own repayments piled up next door.
    ///
    /// The payout pool is offered only what it is actually short. It is a timing buffer, not a
    /// place to accumulate, so anything above the claims outstanding carries on to loss
    /// absorption where it does some good: the AssurancePool's primary reserve up to its target
    /// RTD first, the rest its buffer. All of it used to go to the buffer, which the RTD does not
    /// count, so the primary reserve never filled from repayments.
    function _routeRepayment(uint256 amount) private {
        IERC20Upgradeable reserve = assurancePool.reserveToken();
        uint256 toPayout;

        if (address(payoutPool) != address(0)) {
            uint256 owedToMerchants = _payoutPoolNeeds();
            toPayout = owedToMerchants < amount ? owedToMerchants : amount;
            if (toPayout > 0) {
                reserve.approve(address(payoutPool), toPayout);
                payoutPool.receiveRepayment(toPayout);
                emit RepaymentRouted(address(payoutPool), toPayout);
            }
        }

        uint256 remainder = amount - toPayout;
        if (remainder > 0) {
            reserve.approve(address(assurancePool), remainder);
            assurancePool.depositRepayment(remainder);
            emit RepaymentRouted(address(assurancePool), remainder);
        }
    }

    /// @notice cash the payout pool is short of what it owes.
    /// @dev Measured against PAYABLES, not against the queue. A merchant's positive balance is
    /// already what the co-op owes them -- the payables ledger, kept on chain rather than beside
    /// it -- and a claim is only that payable asking to be paid. Reserving against the queue alone
    /// meant that unless a merchant happened to redeem BEFORE a member repaid, the repayment went
    /// past the pool into loss absorption, where it cannot fund a payout. Merchants then redeemed
    /// against an empty pool and waited for a manual top-up while the buffer held their money.
    ///
    /// Every outstanding claim is `totalSupply()`, because the positive side of this ledger is the
    /// token itself — and a claim paid in cash is burned rather than moved (`settleClaim`), so the
    /// total is what is still owed rather than everything ever minted.
    ///
    /// Payables before provisions is the intended order. A payable is a present liability; the
    /// buffer is a provision against future losses, and it still takes everything above them.
    ///
    /// Measured against MEMBERS' money in the pool, not against the cash it holds (audit X-2).
    /// Funder capital is not a repayment: counting it sent members' repayments past a pre-funded
    /// pool, so a claim the funder then paid for was one nobody still owed. Refunds the pool owes
    /// members are a payable too, and members' money is the only thing that may pay them.
    function _payoutPoolNeeds() private view returns (uint256) {
        uint256 payables = totalSupply() + payoutPool.refundsOwed();
        uint256 funded = payoutPool.memberFunded();
        return payables > funded ? payables - funded : 0;
    }

    /// @notice sets the pool repayment value is offered to first.
    /// @param _payoutPool address of the payout pool, or address(0) to send everything to the
    /// reserve.
    function setPayoutPool(address _payoutPool) external onlyAdmin {
        payoutPool = IPayoutSink(_payoutPool);
        emit PayoutPoolUpdated(_payoutPool);
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

    /// @dev The ledger holds one signed balance per member and nothing recreates those. A bug
    /// here cannot be fixed by deploying a replacement -- every account would have to be moved to
    /// it, one at a time, which is the migration this whole design tries to avoid elsewhere.
    ///
    /// Gated on the same admin that already governs the ledger. It is worth being plain that this
    /// is not a new trust surface: an admin can already appoint operators, and an operator can
    /// already move a member's credit limit. Upgrade authority is the power they hold anyway,
    /// written down.
    function _authorizeUpgrade(address) internal override onlyAdmin {}

    modifier onlyAdmin() {
        require(access.isAdmin(_msgSender()), "StableCredit: Unauthorized caller");
        _;
    }

    /// @dev The payout pool passes as well, and is not made a member to do it. It holds a position
    /// between a merchant redeeming and the claim being paid -- it has to, because until the cash
    /// goes out nobody knows whether the claim is settled or bought -- and it is a system contract
    /// rather than somebody with a credit line. Granting it membership instead would work, and
    /// would also mean an upgrade that forgot to do so left nobody able to redeem at all.
    modifier senderIsMember(address sender) {
        require(
            access.isMember(sender) || access.isOperator(sender) || sender == address(payoutPool),
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
