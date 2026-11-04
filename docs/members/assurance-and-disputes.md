# Assurance and disputes

**Clear Assurance** is a set of protections the co-op pays for when something goes wrong in your
life. **Disputes** are for when a payment goes wrong. Both are below.

## Your protections

**Protections unlock with your equity credits, not with your membership plan.** Every member is on
the same ladder, and each step turns on when your credits reach it.

| Protection | Turns on at | What it covers |
|---|---|---|
| Cycle assurance | Day one | Two cycles a year can close short. Your line holds and your savings stay put |
| Home repair | 1,500 credits | Qualifying home repairs, covered by the co-op |
| Income | 4,000 credits | If your income drops, your credit limit holds for a cycle |
| Deposit | 8,000 credits | Your security deposit, paid to your landlord by the co-op |
| Rent | 15,000 credits | Up to two months of rent paid if you lose your job |

**Nothing on this list is paid back**, and there is no premium. The Savings page shows the ladder,
which protections are on, and how many credits you need for the next one. How credits are earned is
in [Savings and equity credits](./savings-and-equity-credits.md#equity-credits).

## The assurance reserve

The protections are paid from the assurance reserve, the co-op's shared safety fund. **It isn't
funded from member deposits**: the app describes it as retained surplus from lending and card
activity. **Your savings are never used to cover someone else's claim.**

To reach it, tap any protection under **Protections** on Savings, then **What the assurance reserve
covers**. The page shows the reserve's balance, how many members it covers, and how much of a worst
case it holds against the policy floor the co-op commits to. It also links to the reserve's reports.

### The reserve's figures and reports

**The figures on the reserve page aren't read from the reserve yet.** In this version they are fixed
example figures — the balance, the members covered, the claims paid this year, and the share of a
worst case it holds — and every member sees the same ones. Don't rely on them as the reserve's real
position.

**Reserve reports**, a row on the reserve page, describes the reports the co-op means
to publish:

- a statement every quarter, within six weeks of the quarter's close
- each one listing the reserve's balance, every claim paid, every claim declined, and the cover
  ratio at the close
- prepared by Clear and reviewed, and **not an independent audit** — the page says so

**The app doesn't publish reports yet.** The statements listed on that page are examples and don't
open, the reviewer isn't named, and **Get them by email** isn't connected.

What anyone can check today is on chain. The `AssurancePool` contract, the co-op's reserve against
members' credit, can be read by anyone: its balances, and its reserve ratio against its target. How
to read it is in [Investors → What anyone can read](../investors/on-chain-data.md#the-assurancepool), and what it holds and
pays for is in [Protocol → The reserve](../protocol/reserve.md). The target, and who sets it, is in
[Governance → Parameters](../governance/parameters.md#the-reserve).

## Making a claim

Start from **How to make a claim**, at the foot of the reserve page.

1. **Choose the protection.** You can only claim on one that is active. A protection you haven't
   unlocked can't be claimed on, even for something that happened after you joined.
2. **Say what happened**, in your own words — up to 2,000 characters.
3. **Send the claim.**

A person on the team reads every claim and answers in writing: yes, no, or what's missing, with the
reason. **A claim that's paid is paid from the reserve into your cash account.** A claim costs you
nothing and doesn't touch your credits, whichever way it goes.

If you have no active protections yet, there is nothing to claim on. Cycle assurance is active from
day one.

## Disputes

**Raise a dispute when a payment went wrong** — a shop charged you the wrong amount, charged you
twice, or you didn't get what you paid for. Start from **Settings → Help → Dispute resolution →
Raise a dispute**, or from **Something wrong** on the transaction itself, which picks the payment for
you.

### Three kinds, and who decides

| What you're disputing | Who decides |
|---|---|
| **A card payment** | The card network's rules, not Clear. Clear files it with the network for you |
| **A payment to a Clear partner** | Clear mediates |
| **Another member** — a send, a split or an escrow between you | An independent third party, not Clear |

Clear stays out of disputes between two members, because a co-op judging between its own members is
a conflict. The outcome binds both of you, and Clear.

For a card payment, you also pick a reason: charged twice, wrong amount, didn't get it, or
something else. Filing asks for Face ID when payment protection is on.

### While it's open

- **The amount is held**, not spent.
- **You're not charged carry on it**, and it isn't counted late in your cycle.
- **Your equity credits are untouched.**

For a payment to a partner, the plan behind it is unwound and the shop isn't paid while the dispute
is open. For a member send that hasn't been claimed yet, it can't be claimed while it's disputed. A
send that has already been claimed can't be held — the dispute page says so.

**Settings → Help → Dispute resolution** lists your disputes and where each one stands.

### When it's decided

- **In your favour** — you don't owe it.
- **Against you** — the amount goes back into your cycle as new, with its carry and schedule
  starting from the decision. The time it spent in dispute costs you nothing.

### Withdrawing a dispute

You can withdraw a dispute at any point before a decision. Tap **Withdraw**, then **Confirm
withdraw**. The amount goes back into your cycle from that day, and **you can't raise the same
payment again.**

## Related

- [Credit](./credit.md)
- [The Clear card and paying at shops](./card-and-shops.md)
- Who runs the reserve and sets its policy: [Governance](../governance/README.md)
