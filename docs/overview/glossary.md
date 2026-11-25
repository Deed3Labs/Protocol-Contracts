# Glossary

The words Clear uses, in plain terms. Contract names are in `code`; the contracts themselves are
described under [Protocol](../protocol/README.md).

| Term | Meaning |
|---|---|
| **Accelerated** | An optional paid membership plan. Not available yet |
| **AccessManager** | The contract that says who is an admin, an operator or a member for the credit contracts. See [On-chain authority](../governance/on-chain-authority.md) |
| **Assurance, Clear Assurance** | The co-op's protections for members, such as help toward rent through a hardship. Each one unlocks at a number of equity credits. Not insurance: a grant is decided case by case |
| **AssurancePool** | The contract that holds the co-op's reserve, in two compartments: the Credit Backstop and Member Assurance |
| **Base, Base Sepolia** | Base is the public network the contracts run on. Base Sepolia is its test network, where nothing is real money |
| **Carry** | The cost of credit. It builds up on what you have drawn |
| **Clear card** | Clear's own wooden membership card, for paying at Clear shops without your phone. Planned; not available yet. See [Your cards](../members/cards.md) |
| **Clear Deed** | The finish line: the title to your house, free of debt. Equity credits unlock an ELPA, and the ELPA's equity balance redeems the house at its cost plus 15%. Not a mortgage. On the chain, a T-Deed |
| **Clear Financial Co.** | The program entity in the co-op's structure: accounts, cards and payments, where member money sits. Its Safe controls the savings vault and CLRUSD. See [The co-op's structure](../governance/structure.md) |
| **Clear Lending** | The company in the co-op's structure that funds the credit book. See [The co-op's structure](../governance/structure.md) |
| **Clear Pay** | Paying rent and bills through the app. Paying on time earns equity credits |
| **Clear Protocol** | The contracts under the app: savings, the credit ledger, shop payouts, the reserve and the Deed track |
| **Clear Visa card** | Today's card: a Visa card that spends your cash first, then your credit line, cheapest tier first. Test network only. See [The Clear Visa card](../members/clear-visa-card.md) |
| **CLRUSD** | Clear USD. Your savings. One CLRUSD for each USDC deposited, redeemable for USDC at any time. Pays no interest |
| **Command Center** | The co-op's internal app, where staff, members and invited investors each sign in with their own access. See [The Command Center](../governance/command-center.md) |
| **Credit Backstop** | The part of the reserve that covers credit Clear Lending has written off as lost. It has a floor: a share of the credit it covers |
| **Credit ledger, `ClearCredit`** | The on-chain record of what each member owes and what each shop is owed |
| **Credit line** | Credit you can draw on with the Clear Visa card or at partner shops. Its size depends on what backs it. Offered state by state |
| **Credit swipe fee** | 30¢ on a card purchase that draws on your credit line, from any tier. None when your cash covers the purchase. Not charged yet. See [Credit](../members/credit.md#your-credit-line) |
| **Cure notice** | A notice, recorded on the chain by two people, that a credit line has missed two cycles in a row. Without one, the line cannot default |
| **Deed track** | The part of the protocol for real-world assets: T-Deeds, validators, subdivision and fractions |
| **Default** | When a member has fallen far enough behind that the debt is treated as unpaid. Only what was past due can then be collected from what backs it |
| **Deployer key** | The wallet that put the contracts on the chain. It holds every role until they are handed over |
| **Earn** | Where qualifying members hold bonds or put money in the lending pool. Both can back your credit line. See [Earn](../members/earn.md) |
| **ELPA, Equity-Lease Participation Agreement** | The agreement a member can apply for at 15,000 equity credits. The member lives in a Clear home, and what they pay builds an equity balance in it. When the balance reaches the home's price (its cost plus 15%, fixed at signing), the house is theirs as a Clear Deed. Not credit, and not a mortgage. Not available yet. See [Your Clear Deed](../members/clear-deed-and-membership.md#your-clear-deed) |
| **Equity credits** | A count of progress toward a home, earned by saving and by paying on time. At 15,000 you can apply for an ELPA, which leads to your Clear Deed. Never withdrawable or redeemable for cash. Kept by Clear's server, not on the chain |
| **ESA, Equity Savings Account** | Your savings account. USDC in, CLRUSD out, one for one |
| **`ESADepositVault`** | The contract that holds the USDC behind CLRUSD |
| **Float** | Dollars held with the card provider to pay card swipes at shops outside the network. Clear Lending funds the part on credit |
| **LendingPool** | The lending pool on Earn. Members and other contributors put money in, and it lends only to Clear Lending, which funds members' credit with it. A loss reaches it last, after Clear Lending's own layers, and nothing guarantees it |
| **Lost debt** | Debt written off after a default. Clear Lending bears it, and can draw on the Credit Backstop for it |
| **Member Assurance** | The part of the reserve that pays members' Assurance grants |
| **Membership** | Your savings account, as in a credit union: what you save is your share in the co-op, with one vote per member. The bylaws set the formal rules |
| **Membership plan** | Standard, which every member is on and which is free, or Accelerated, which is not available yet |
| **Ops Safe** | The co-op's multi-signature wallet. Admin powers over the contracts are handed to it or to timelocks, so no single key controls them |
| **Operator** | A wallet allowed to do one day-to-day job on the contracts, such as opening credit lines |
| **Partner shop** | A shop registered with the co-op, where a purchase goes straight onto the credit ledger |
| **Pay with Clear** | Payment links and checkout that shops use to take Clear online |
| **Payout window** | How long the co-op has to pay a shop after the shop asks to be paid. Thirty days unless the shop's terms say otherwise |
| **PayoutPool** | The contract that pays shops in dollars |
| **Relayer** | A Clear wallet that submits a transaction you signed and pays its network fee |
| **Reserve** | The co-op's money held against losses and for members' protections, in the AssurancePool: the Credit Backstop and Member Assurance |
| **Shop discount** | The share of a purchase paid over time that the shop has agreed to give up, 2.5% unless its terms say otherwise. It goes to Clear Lending as its fee for funding the plan, capped at $50.00 a plan ($75.00 over $2,500.00). The member never pays it |
| **Split plan** | Paying a purchase back in 1, 2, 4, 6 or 12 instalments, against its own limit |
| **Standard** | The membership plan every member is on. Free. Its equity-credit multiplier grows with your on-time record |
| **T-Deed** | The on-chain token for a property, issued by `DeedNFT` |
| **Term limit** | The most a member can have outstanding on split plans |
| **Timelock** | A contract that holds admin power over a group of contracts. A multi-signature wallet proposes a change, and it can take effect only after a wait of 7 days |
| **USDC** | A digital dollar. What you deposit to save |
| **Vesting** | The 30 days a new equity credit waits before it counts as yours |
