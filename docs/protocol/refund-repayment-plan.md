# Refunds and repayments

How a member's repayment reaches the merchants it pays, and how a refund cancels what a member still
owes and gives back what they already paid. The contracts are `StableCredit`, `PayoutPool` and
`TermIssuer`; the API calls them from `apps/api/src/services/refundSettlement.ts`. The function-level
reference is in [Settlement and the float](./settlement.md) and [Credit](./credit.md).

---

## 1. Origination moves no money

A partner purchase is a three-party mint that nets to zero: the member is debited, the merchant is
credited the payout, and the fee recipient (`TermIssuer.feeRecipient`, meant to be Clear Lending's
account) is credited the fee (`originatePurchase`). No reserve token
moves. Money enters only when the member repays, and leaves only when a merchant redeems or a member
is refunded.

| On a $100.00 purchase with a 2.5% fee | Member | Merchant | Fee recipient |
|---|---|---|---|
| Ledger after the purchase | −$100.00 | +$97.50 | +$2.50 |

---

## 2. Repayments

### Where a repayment goes

`StableCredit._routeRepayment` sends a repayment's reserve tokens to the PayoutPool first, up to
what the pool is short of every outstanding payable, and the rest to Clear Lending's operating
address (`lenderOperating`, set with `setLenderOperating`):

```
needs    = totalSupply() + payoutPool.refundsOwed() − payoutPool.memberFunded()   // _payoutPoolNeeds
toPayout = min(amount, needs)
rest     → lenderOperating                  // reverts StableCreditNoLenderOperating if unset
```

**Payables come first.** A merchant's positive balance is a present liability. Measuring the
PayoutPool's need against every positive balance and every refund owed, less the members' money it
already holds (audit X-2), rather than against claims already queued, keeps a repayment in the pool
even when no merchant has redeemed yet. Funder capital in the pool does not count toward that need.

With no payout pool set, all of it goes to `lenderOperating`. The AssurancePool takes nothing from a
repayment.

### Inside the PayoutPool

`PayoutPool.receiveRepayment` accepts calls from the ledger only. Anybody else putting cash in uses
`fund`, which buys positions rather than settling them (see below). It then:

1. **Repays lenders' principal**: the lending pool, then the bond vault, each up to what the pool
   borrowed from it. Both legs only unwind loans made before Phase 2f: neither lends to the pool now.
2. **Pays lenders' interest** from what is left, up to `carryEarned`, split by each lender's share of
   what was borrowed before step 1.
3. **Settles the pool's own positions**: the principal repaid in step 1 is burned from the positions
   the pool bought with borrowed money.
4. **Adds the rest to `memberFunded`**: members' own cash, which settles claims when they are paid.

The lenders come first because what they lent paid a claim that this member's debt stood behind. If
the pool kept the repayment to settle claims, it would go on borrowing against money it already held.

### The position follows the cash

When a claim is paid, `_placePosition` looks at whose cash paid it:

| Cash that paid the claim | What happens to the merchant's credits | Why |
|---|---|---|
| A member's repayment (`memberFunded`) | **Burned** (`StableCredit.settleClaim`) | The member's obligation went when they paid. Burning brings supply back into step with what members owe |
| A funder's capital (`fund`, `capitalOf`) | **Transferred to that funder**, oldest capital first | The member still owes it, so whoever advanced the cash holds the position and earns its carry |
| Borrowed cash (loans from before Phase 2f) | **Kept by the pool** | The lenders are repaid in cash; the pool holds the position until the member repays |
| Anything else | **Transferred to `coopTreasury`** | Cash the pool cannot attribute; the co-op holds the position rather than it disappearing |

Only the pool knows which cash paid a claim, so `settleClaim` accepts calls from the pool alone.
The pool holds the merchant's credits from redemption until payment (`inFlight`) for the same
reason: until the claim is paid, nobody knows whose money will pay it.

### Who funds a payout, and in what order

1. **Members' repayments.** Normally in the pool by the time a merchant's turn comes. These claims
   settle; nothing is bought.
2. **Capital put in with `fund`** (`FUNDER_ROLE`). Smoothing money, so the pool can pay between
   repayments. Each funder holds the positions their money paid for and can take back capital it
   never spent with `withdrawCapital`.
3. **`drawForDueClaim`, for a claim that is due and unpaid.** Permissionless and all or nothing
   (audit X-20). It refuses a claim whose payout window has not run out (`PayoutPoolClaimNotDue`).
   Its one live source is the treasury (the Safe), up to the USDC allowance it has given the pool.
   This is capital, not a loan: the treasury holds the position it pays for, as when it funds by
   hand. Its lending-pool and bond-vault legs are inert (`borrowableToday` is 0 and `borrow` reverts;
   `lendToPayoutPool` returns 0), and it has no AssurancePool step.

There is no early-payment path. A merchant is paid when it is their turn and the money is there,
and queued when it is not. A funded pool pays a claim before its window runs out; an empty pool means
waiting until the window has run out, when `drawForDueClaim` can act.

### Lenders are repaid, not handed the position

The lending pool's share price counts cash plus what is out on loan. A credit claim sitting in it
would read as a hole in its books until somebody redeemed it. So a lender gets back what it put up, in cash, and the pool holds the position
in between. That holding is excluded from `distributableCarry`, so it is never paid out as anybody
else's carry, and it is burned as the member's repayment reaches the lender.

Lenders are paid for lending out of the same cash. Carry is added to what a member owes, so the
repayment that settles the principal carries the interest with it. The pool's share of the carry is
held as `carryEarned` and handed to the lenders in proportion to what each put up; the division's
remainder goes to the lending pool.

### Carry, by who bore the float

`distributeCarry` (permissionless) splits carry the pool holds by each party's share of every claim
outstanding: a funder carrying three fifths of the float receives three fifths of the carry. What no
funder bore goes to `coopTreasury`. Shares use positions held at the moment of the call.

Carry reaches the pool only when an issuer names the pool as its carry recipient. The fee on each
purchase has a recipient of its own, `TermIssuer.feeRecipient`, changed by two credit-settings
signers (`proposeFeeRecipient`, then `approveFeeRecipient`); a plan with a fee cannot open while it
is unset (`TermIssuerNoFeeRecipient`). Pointing carry at the pool does not send the fee with it.

### The co-op's income

The fee is not the co-op's: it is minted to `feeRecipient`. What the co-op's treasury holds on the
ledger is its share of carry (what no funder bore, from `distributeCarry`) and positions it paid for.
`withdrawCoopIncome` (`OPERATOR_ROLE`) pays the first of those from cash no queued claim or owed
refund is waiting on:

```
withdrawable = min(coopTreasury's credits − advancedOf[coopTreasury], unencumbered(), memberFunded − refunds reserved)
```

Positions the treasury bought are recovered by redeeming them, not as income (audit X-8). It can
never take cash already promised to a waiting merchant. The credits are burned, and the cash goes to `coopIncomeRecipient`, or to
`coopTreasury` while that is unset.

---

## 3. Refunds

### What a refund does

**A refund reverses what is still owed and repays what was already paid, less the carry incurred.**
`TermIssuer.closePlanForRefund(planId, amount, merchant, payout)` (`CREDIT_LINES_ROLE`) does both.
`merchant` must be the plan's recorded merchant (`TermIssuerRefundTermsMismatch`), `payout` is ignored
in favour of the recorded payout, and a plan with no recorded terms reverts
(`TermIssuerRefundTermsUnknown`):

1. If the plan is open, it materialises the plan's carry first. Carry is not refunded: the member
   held the money for that time.
2. It caps the refund at the plan's original principal, and splits it by arithmetic, not proportion:

   ```
   reverse = min(refund, principal still owed)
   cash    = min(refund − reverse, repaid − refundedOf[planId])
   ```

3. `reverse` goes through `StableCredit.reversePurchase`: the merchant's and the fee recipient's
   credits are burned and the member's obligation falls by the same amount. No money moves.
4. `cash` goes through `StableCredit.repayRefund`: the merchant and the fee recipient (the one the
   plan recorded, `_feeFrom(planId)`) each give up their share of it, and the PayoutPool pays the member `cash − carryWithheld`, where `carryWithheld` is the carry
   materialised in step 1, capped at the cash.
5. The plan closes once what is outstanding is no more than that carry.

`refundedOf[planId]` records cash already given back, so a refund cannot return the same money
twice. A plan the member has paid off is closed but can still be refunded: everything comes back as
cash.

| Refund | Still owed | Paid | Reversed | Cash | The member afterwards |
|---|---|---|---|---|---|
| $100.00 | $54.00 | $46.00 | $54.00 | $46.00 | Owes nothing on the plan, and is paid back what they paid, less carry |
| $40.00 | $54.00 | $46.00 | $40.00 | — | Owes $14.00 on what is now a $60.00 purchase, having paid $46.00 |
| $60.00 | $54.00 | $46.00 | $54.00 | $6.00 | The purchase is now $40.00; they paid $46.00, so $6.00 comes back, less carry |

The middle row moves no money at all. Splitting the cash between the merchant and the fee recipient
is the only proportional step: it follows the sale's own fee ratio, with rounding falling to the fee
recipient rather than taking a cent from a merchant.

### Worked example

A $100.00 purchase with a 2.5% fee. The member has paid $46.00, carried $0.40 of carry, and is
refunded in full.

| | Member | Merchant | Fee recipient | PayoutPool |
|---|---|---|---|---|
| After the purchase and $46.00 paid | −$54.00 owed | +$97.50 | +$2.50 | $46.00 cash |
| Reverse the $54.00 still owed | $0.00 owed | −$52.65 | −$1.35 | — |
| Repay the $46.00 paid, $0.40 carry withheld | **+$45.60 cash** | −$44.85 | −$1.15 | −$45.60 |

The merchant and the fee recipient give back what they were paid. The withheld $0.40 stays in the
pool as members' cash and settles that much of the member's carry on the ledger.

### Where the merchant has already redeemed

The merchant's share is taken back from what they still hold. Where they hold less (they redeemed
and were paid), the rest becomes their obligation:

- **In a reversal**, `_transferObligation` moves the member's obligation to the merchant
  (`RefundOwedByMerchant`). Nothing is minted or burned.
- **In a cash repayment**, `_takeBack` burns what the merchant still holds and creates an obligation
  on the merchant for the rest (audit X-1, X-3). It never moves the member's obligation and mints no
  claim.

Either way the shortfall is recorded as a refund receivable (`refundReceivableOf`, audit X-4). It is
collected first out of credits the merchant next receives, whether by transfer or from a new sale;
see [The payable](./settlement.md#the-payable).

### When the pool is short

A refund is a withdrawal of the member's own money, not a claim, so it does not queue behind
merchants. `PayoutPool.payRefund` (ledger only) pays only from members' money (`memberFunded`,
capped at the cash; audit X-12). What it cannot cover is recorded in `refundOwedTo[member]` and
`refundsOwed`, and `payRefundsOwed()` (permissionless, 100 members a call) pays it as members' money
arrives.

Owed refunds come ahead of claims: every path that pays a claim holds back the part of `refundsOwed`
members' money can cover, and `unencumbered()` holds back all of it. The pool does not borrow for a refund; `drawForDueClaim` serves claims only.

### Refunds without a plan

A charge the member paid in full at checkout ("Pay now") has no term plan. The API refunds it by
transfer from the shop's wallet and the co-op's operator wallet (`apps/api/src/services/paidNowRefund.ts`)
and refuses a refund the shop's cash cannot cover.

A dispute against a partner charge uses the same `closePlan` path: the plan is unwound when the
dispute is opened, and the member signs a new plan for the purchase if they lose
(`apps/api/src/services/disputes/disputeEnforcement.ts`).

### What a refund does not change

- **Carry is never forgiven.** It is withheld from cash where there is cash, and that settles it on
  the member's ledger. Where there is no cash, it stays on the member's ledger balance, to be cleared
  like any other carry.
- **A refund with nothing paid** only reverses: no money moves.
- **CLRUSD is untouched.** Refunds move reserve tokens through the PayoutPool and credits on the
  ledger only.

### Known limitations

- **`PlanRefundPaid.returned` is what left the plan for the member** (`cash − carryWithheld`, audit
  X-14), before any pool shortfall: see `RefundPaid` and `RefundQueued` on the PayoutPool for what
  was paid now and what was queued.
