# Glossary

The words these pages use, in plain terms. Contract names are in `code`; the contracts themselves are
described under [Protocol](../protocol/README.md).

| Term | Meaning |
|---|---|
| **Accelerated** | One of the two membership plans. Earns equity credits on rent and bills at the full multiplier from the start. Paid once |
| **AccessManager** | The contract that says who is an admin, an operator or a member for the credit contracts. See [On-chain authority](../governance/on-chain-authority.md) |
| **Assurance, Clear Assurance** | The co-op's protections for members, such as rent paid for you if you lose your job. Each one unlocks at a number of equity credits |
| **AssurancePool** | The contract that holds the reserve |
| **Base, Base Sepolia** | Base is the public network the contracts run on. Base Sepolia is its test network, where nothing is real money |
| **Carry** | The cost of credit. It builds up on what you have drawn |
| **Clear Deed** | The finish line: a home title, free of debt, earned through equity credits. Not a mortgage. On the chain, a T-Deed |
| **Clear Pay** | Paying rent and bills through the app. Paying on time earns equity credits |
| **Clear Protocol** | The contracts under the app: savings, the credit ledger, shop payouts, the reserve and the Deed track |
| **CLRUSD** | Clear USD. Your savings. One CLRUSD for each USDC deposited, redeemable for USDC at any time. Pays no interest |
| **Command Center** | The co-op's internal app, the members' read-only view of the co-op, and the investors' data room. See [The Command Center](../governance/command-center.md) |
| **Co-op discount** | The share of a partner purchase the shop has agreed to give up. It goes to the co-op |
| **Credit ledger, `ClearCredit`** | The on-chain record of what each member owes and what each shop is owed |
| **Credit line** | Credit you can draw on with the card or at partner shops. Its size depends on what backs it |
| **Deed track** | The part of the protocol for real-world assets: T-Deeds, validators, subdivision and fractions |
| **Default** | When a member has fallen far enough behind that the debt is treated as unpaid |
| **Deployer key** | The wallet that put the contracts on the chain. It holds every role until they are handed over |
| **Equity credits** | A count of progress toward your Clear Deed, earned by saving and by paying on time. Never withdrawable or redeemable for cash. Kept by Clear's server, not on the chain |
| **ESA, Equity Savings Account** | Your savings account. USDC in, CLRUSD out, one for one |
| **`ESADepositVault`** | The contract that holds the USDC behind CLRUSD |
| **Float** | Dollars the co-op keeps with its card provider to pay card swipes at shops outside the network |
| **LendingPool** | Where financial contributors put money that the co-op borrows to pay shops on time |
| **Lost debt** | Debt written off after a default. The reserve makes it good |
| **Membership plan** | Standard or Accelerated. Sets how fast you earn equity credits on rent and bills |
| **Ops Safe** | The co-op's multi-signature wallet. Admin powers over the contracts are handed to it, so no single key controls them |
| **Operator** | A wallet allowed to do one day-to-day job on the contracts, such as opening credit lines |
| **Partner shop** | A shop registered with the co-op, where a purchase goes straight onto the credit ledger |
| **Pay with Clear** | Payment links and checkout that shops use to take Clear online |
| **Payout window** | How long the co-op has to pay a shop after the shop asks to be paid. Thirty days unless the shop's terms say otherwise |
| **PayoutPool** | The contract that pays shops in dollars |
| **Relayer** | A Clear wallet that submits a transaction you signed and pays its network fee |
| **Reserve** | Money held to cover losses when members cannot repay. In three parts: primary, buffer and excess |
| **RTD, reserve-to-debt ratio** | The primary reserve divided by what it stands behind |
| **Split plan** | Paying a purchase back in 1, 2, 4, 6 or 12 instalments, against its own limit |
| **Standard** | One of the two membership plans. Billed yearly. Its equity-credit multiplier grows with your on-time record |
| **T-Deed** | The on-chain token for a property, issued by `DeedNFT` |
| **Term limit** | The most a member can have outstanding on split plans |
| **USDC** | A digital dollar. What you deposit to save |
| **Vesting** | The 30 days a new equity credit waits before it counts as yours |
