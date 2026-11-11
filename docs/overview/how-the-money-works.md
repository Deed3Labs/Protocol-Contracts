# How the money works

Where each dollar sits, in plain terms. The full account, with the reasons for each choice, is
[the contract build plan](../protocol/clear-contracts-build-plan.md); the pages under
[Protocol](../protocol/README.md) describe the contracts as they are.

## Two kinds of balance, kept apart on purpose

**Your savings are money. Your credit is a record of what you owe.** Clear keeps them in two
different places and never mixes them.

| | What it is | Where it lives |
|---|---|---|
| **Savings** | CLRUSD, one for every dollar of USDC you deposited | Your own account, backed by the USDC held in `ESADepositVault` |
| **Credit** | A running balance: below zero when you owe, above zero when you are owed | `ClearCredit`, the credit ledger |

If they were merged, part of every CLRUSD would be backed by dollars and part by somebody's promise
to pay, and nobody could tell which part was which. Kept apart, every CLRUSD is backed by a dollar.

## Savings

**Every CLRUSD is backed one for one by USDC in the vault.** You deposit USDC and the vault creates
the same amount of CLRUSD for you. You hand CLRUSD back and the vault destroys it and returns the
USDC. Redeeming is the only way USDC leaves the vault: there is no admin withdrawal and no sweep.

Savings pay no interest. Nothing in CLRUSD or the vault pays anything to the people who hold it.

**You can save without paying the network's fee yourself.** You sign; a Clear wallet called a
relayer submits the transaction and pays the fee.

**One limit on taking savings out.** If you have pledged savings behind credit and then drawn on
that credit, the CLRUSD contract can hold back the part covering what you drew until you pay it back.
The lock applies only once the co-op switches it on ([Parameters](../governance/parameters.md)); the
rest of your savings stays free either way.

The co-op can also pause the vault in an emergency, which stops deposits and redemptions until it is
unpaused. Who can do that is in [Governance](../governance/on-chain-authority.md).

## Equity credits

Equity credits are a count Clear's server keeps for you, not money and not a token. New credits wait
30 days before they count as yours ("vesting"). They can only go toward your Clear Deed; there is no
way to withdraw them or turn them into cash. The rules for earning them are in
[Parameters and who sets them](../governance/parameters.md).

## Buying at a partner shop

**A purchase at a partner shop is three entries on the ledger that add up to zero.** Nobody lends
anything at the moment you buy. Say a shop has agreed to a 3% discount and you spend $100:

| | On the ledger |
|---|---|
| You | **−100** — you owe $100 |
| The shop | **+97** — the co-op owes the shop $97 |
| The co-op | **+3** — the discount |

No dollars move at that moment. The shop's positive balance is the record of what the co-op owes it,
kept on the chain where the shop can see it.

## Paying the shop

**Cash is needed only when the shop turns its balance into dollars.** The shop asks to be paid; its
request joins a queue, oldest first, and is due by the end of its payout window (thirty days unless
the shop's terms say otherwise). The `PayoutPool` pays it.

When members have not yet repaid enough to cover a payment that is due, the PayoutPool borrows the
difference from the `LendingPool`, where financial contributors have put money for exactly this. As
a last resort it can borrow from the reserve's excess and buffer, never its primary part. Lenders are
repaid as members repay.

A shop that also owes the co-op is paid down first: money reaching it by transfer clears its own debt
before anything is left to cash out.

## The Clear Visa card

**A Clear Visa card swipe at a shop outside the Clear network needs real dollars, because that shop is not on
the ledger.** The co-op pays it from a float held with its card provider. The swipe shows straight
away in your app as a hold; it is written to the ledger only once the payment clears, usually one to
three days later, because the amount can still change until then (a tip, a fuel pump, a cancelled
sale).

The purchase step by step: [How a Visa card purchase works](../protocol/visa-card-purchases.md).

## Repaying

Unless you pay a particular split plan, a repayment clears your most expensive balance first. On
the chain, repayments go first to the PayoutPool, up to what it needs to pay shops, and anything beyond that goes to the
reserve.

## Carry: what credit costs

**Credit has a cost, called carry.** It builds up on what you have drawn, separately for each part of
your line and each split plan. It goes to the co-op, or to the LendingPool for the share of credit
its contributors paid for. Savings do not earn carry and do not pay it.

## The reserve

**The reserve is the money that makes it survivable when a member cannot repay.** It lives in the
`AssurancePool`, in three parts:

| Part | What it is for |
|---|---|
| **Primary** | The cover itself. The reserve is measured on this part alone |
| **Buffer** | The first cushion against a loss |
| **Excess** | Anything above the target |

The measure is the **reserve-to-debt ratio (RTD)**: the primary reserve divided by what it stands
behind. The co-op sets a target for it ([Parameters](../governance/parameters.md)). Repayments fill
the primary reserve up to the target first.

Debt backed by a member's own savings does not count against the reserve, because the savings already
cover it.

## When someone cannot repay

1. **Falling behind** stops new split plans until the member is caught up.
2. **Default.** Once a split-plan payment has stayed unpaid for two further instalment periods,
   anyone can declare the member in default. Their plans close and their split-plan limit goes to
   zero. A credit line defaults when its period and grace period end with a balance still owed.
3. **Collateral.** Savings the member pledged can be taken, but only up to what they drew against
   them. Savings that were never drawn against cannot be touched.
4. **Loss.** What is left is written off as lost debt, which the reserve makes good: the buffer
   first, then the primary reserve.

## What cannot happen

- Nobody can take USDC out of the savings vault except by redeeming CLRUSD.
- Equity credits cannot be cashed out, by you or by anyone else.
- Savings do not earn interest, and Clear does not promise any return on them.
