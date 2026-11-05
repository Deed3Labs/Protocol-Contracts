# Parameters and who sets them

The numbers the system runs on, where each one lives, who can change it, and how a rule changes.
Figures under **Today** are the values set at deployment or by the server's current rules. A value on
the chain may since have been changed by whoever holds the role; read the contract for the current
one.

"The Ops Safe" below means the co-op's multi-signature wallet, once the hand-over in
[On-chain authority](./on-chain-authority.md) has run on that network. Until then, the same power
sits with the deployer key.

## Savings

| Parameter | Lives in | Set by | Today |
|---|---|---|---|
| Which tokens can be deposited | `ESADepositVault.setAcceptedToken` | The vault's `OPERATOR_ROLE` (the savings relayer) | USDC by default at deploy |
| Which CLRUSD the vault issues | `ESADepositVault.setClrusd` | The vault's admin. Refused while any of the old CLRUSD is still out | — |
| What locks savings behind drawn credit | `ClearUSDUpgradeable.setEncumbranceSource` | CLRUSD's admin. Setting it to none lifts the lock for everyone | Not set at deployment; with none set, nothing is locked |
| Pausing deposits and redemptions | `ESADepositVault.pause` | `PAUSER_ROLE` | — |

Savings pay no interest; there is no rate to set.

## Equity credits

**Equity credits are kept by Clear's server, not by any contract.** Their rules are set in the
server's software, so they change only through a software change (see
[How a rule changes](#how-a-rule-changes)).

| Rule | Today |
|---|---|
| Match on savings | 1 credit for each whole dollar deposited, up to 1,500 credits a calendar month |
| Match if the deposit leaves early | Redeem within 30 days and the matching credits still waiting are cancelled |
| Rent paid on time | 200 credits, times your multiplier |
| Other bills paid on time | 10% of the payment in credits, at most 500, times your multiplier |
| On time | Paid no more than 3 days after the due date. A late payment earns nothing |
| Vesting | 30 days from the payment or deposit |
| Multiplier | 1×, plus 0.25× for every 6 months in a row with an on-time payment, up to 1.5× |
| Test networks | Credits earned there are recorded separately from live ones |

The multiplier applies to rent and bills, not to the savings match. Equity credits can never be
withdrawn or redeemed for cash; no rule above can change that.

## Assurance and the Clear Deed

Each protection unlocks at a number of equity credits, whatever the member's plan. The member app
sets these thresholds and draws the path toward the Clear Deed from them.

| Protection | Unlocks at |
|---|---|
| Cycle assurance: two cycles a year can close short | From the start |
| Home repair | 1,500 credits |
| Income: your credit limit holds for a cycle if your income drops | 4,000 credits |
| Deposit: your security deposit paid to your landlord | 8,000 credits |
| Rent: up to two months of rent if you lose your job | 15,000 credits |

The app's progress bar toward the Clear Deed also ends at 15,000 credits. A claim is filed in the
app and read by a person, who moves it on by hand.

## Credit

| Parameter | Lives in | Set by | Today |
|---|---|---|---|
| A member's split-plan limit | `TermIssuer.setTermLimit` | An `AccessManager` operator (the credit operator) | The automatic rule below |
| Instalment choices | `TermIssuer`, fixed in the contract | A contract upgrade | 1, 2, 4, 6 or 12 |
| When a split plan can be declared in default | `TermIssuer`, fixed in the contract | A contract upgrade | Two instalment periods after the first unpaid one |
| How often a member may re-spread a plan | `TermIssuer`, fixed in the contract | A contract upgrade | Three times, and not while behind |
| Revolving tiers and their rates | `RevolvingIssuer.addTier`, `setTierRate` | An `AccessManager` operator | Rates must rise from tier to tier |
| A member's revolving capacity | `RevolvingIssuer.setTierCapacity`, or `LimitCalculator` from pledged collateral | An operator; `LimitCalculator` writes it from collateral for anyone who calls | — |
| Collateral haircuts and prices | `CollateralRegistry.setCollateralTerms` | The registry's `OPERATOR_ROLE` | Bonds registered as collateral at 95% at deployment |

**The automatic split-plan limit.** Clear's server sets term limits by a rule:

- $500.00 to start, once the member's identity check has passed.
- $250.00 more for every three instalments paid without a late mark.
- Growth above $500.00 is capped at half of the member's estimated monthly deposits.
- $5,000.00 is the most the rule will set. Anything higher is an operator's decision.
- It only ever raises a limit. Nothing is set for a member who is suspended, in default or behind.

The rule runs on its own on Base Sepolia, the test network. On any other network it is off until it
is switched on in the server's settings. The figures are proposed and not yet signed off.

## The reserve

| Parameter | Lives in | Set by | Today |
|---|---|---|---|
| Target reserve-to-debt ratio | `AssuranceOracle.setTargetRTD`, or a risk model registered with `setTargetRTDSource` | The oracle's owner | 80%, set at deploy |
| Moving buffer to primary | `AssurancePool.moveBufferToPrimary` | An `AccessManager` operator | — |

The target is how much primary reserve the co-op aims to hold against what the reserve stands
behind. Repayments fill the primary reserve up to the target before anything else. Raising the
target above its current level also moves any excess into the primary reserve. How the reserve
works: [The reserve](../protocol/reserve.md).

## Shops

| Parameter | Lives in | Set by | Today |
|---|---|---|---|
| A shop's discount to the co-op | `MerchantRegistry` terms | `MerchantRegistry` `OPERATOR_ROLE` (the Ops Safe) | 2.5% by default when a shop is registered. Never above 100% |
| A shop's approval cap: the largest Clear charge it can take | `MerchantRegistry` terms | Same | Set per shop. Zero means no cap |
| A shop's payout window | `MerchantRegistry` terms | Same | The default window unless set |
| The default payout window | `MerchantRegistry.setDefaultPayoutWindow` | Same | 30 days, set at deploy |
| Switching a shop off or on | `MerchantRegistry.setActive` | Same | Active when registered |

The contracts enforce the payout window and whether a shop is active. Clear's server checks the
approval cap and applies the discount on every charge. The Command Center prepares cap changes and
switching a shop on or off as Safe transactions ([The Command Center](./command-center.md)).

## New-member offers

| Parameter | Lives in | Set by | Today |
|---|---|---|---|
| Size of each offer | `OffersIssuer.setTerms` | Its owner or an operator | $10.00, set at deploy |
| How long an unspent offer lasts | `OffersIssuer.setTerms` | Its owner or an operator | 90 days, set at deploy |
| Total offers the line can carry | `OffersIssuer.setCap` | Its owner or an operator | $1,000.00, set at deploy |
| Where the money to settle offers comes from | `OffersIssuer.setTreasury` | Its owner | — |

## Membership

Standard, every member's plan, is free. Accelerated, an optional paid plan, is not available yet.
See [Membership and the co-op](./membership.md).

## How a rule changes

**There are four kinds of rule, and each changes a different way.**

1. **A value on the chain**: everything in the tables above marked as living in a contract. It
   changes by a transaction from whoever holds the role. Where that is the Ops Safe, the change needs
   signatures from more than one of the Safe's owners. The Command Center can prepare the
   transaction and collect signatures; it is executed in Safe{Wallet}.
2. **A rule fixed in a contract**: the instalment choices, when a default can be declared. It
   changes only by upgrading the contract, which is itself a transaction by the contract's admin or
   owner ([Who can upgrade a contract](./on-chain-authority.md#who-can-upgrade-a-contract)).
3. **A rule in the server or the app**: equity credits, the automatic term limit, the protections.
   It changes through a reviewed change to the software that passes the automated checks, and
   reaches the live apps when it is released to production.
4. **A Command Center setting**: for example, the amount above which a refund or a purchase needs a
   second person. A change is a proposal that someone else must approve
   ([The Command Center](./command-center.md#settings)).

Rules that belong to the members, such as the bylaws and anything decided by member vote, have no
process in the software yet ([Membership and the co-op](./membership.md)).
