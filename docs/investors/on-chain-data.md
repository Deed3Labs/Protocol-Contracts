# What anyone can read

**Every figure in the Investors section can be checked on the chain, by anyone, without asking the
co-op.** The reads below are public functions and events on the deployed contracts. Any block
explorer's "Read contract" tab can call them without a wallet. Addresses are listed under
[Deployed addresses](../../README.md#deployed-addresses); these contracts run on Base Sepolia, a
test network.

The names below are the contracts' own function and event names, as a block explorer shows them.

## The lending pool

| Read | What it tells you |
|---|---|
| `totalAssets()`, `totalSupply()`, `convertToAssets(shares)` | What the pool counts as its assets, and what a share is worth against them |
| `totalBorrowed()` | What has been lent and not repaid, as the pool counts it (see [Risks](./risks.md#credit-losses) on why it is not written down) |
| `availableCash()` | Cash that can be lent or withdrawn now |
| `queuedAssets()`, `requestCount()`, `requestAt(id)`, `requestsOwnedBy(owner)`, `isClaimable(id)` | The withdrawal queue, and whether a request can be paid now |
| `maxWithdraw(owner)`, `maxRedeem(owner)` | What a depositor could take out now |
| `encumberedOf(holder)`, `freeSharesOf(holder)` | Shares pledged as collateral, and shares free to move |

Events: `Borrowed`, `Repaid`, `WithdrawalQueued`, `WithdrawalClaimed`, `LossAbsorbed`,
`SharesSeized`.

`utilizationBps()`, `borrowRatePerCycle()` and `supplyRatePerCycle()` are also public. Nothing
charges or pays the rates they report
([The lending pool](./lending-pool.md#the-rate-curve-is-not-charged)).

## Bonds and the bond vault

| Read | What it tells you |
|---|---|
| `BondVault.held()` | What the vault holds in USDC |
| `BondVault.requiredReserve()` | What it must keep back: the larger of face value due inside the window and the floor |
| `BondVault.deployableExcess()` | What the Safe could withdraw, or the vault could lend, now |
| `BondVault.totalFaceOutstanding()`, `totalPrincipal()`, `totalFaceSettled()` | Face value still owed, what buyers paid in, face value already paid |
| `BondVault.faceDueWithin(window)`, `coversNearTermMaturities()` | Face value falling due in a window, and whether holdings cover the reserve window |
| `BondVault.treasuryAvailable()`, `uncoveredNearTerm()` | What the treasury's allowance could put up, and the near-term gap neither covers |
| `BondVault.owedToReserve()`, `lentToPayoutPool()` | What the vault owes the AssurancePool, and has lent to the payout pool |
| `BondVault.obligations(id)`, `outstandingBonds()` | One bond's price paid, face value, maturity and status; every outstanding bond |
| `BurnerBond.presentValueOf(id)`, `isBondMature(id)`, `willAutoRoll(id)` | One bond's value today, whether it can be redeemed, whether it can be rolled |

Events: `PurchaseRecorded`, `Settled`, `SettledEarly`, `Rolled`, `DeployableWithdrawn`,
`DrewFromTreasury`, `DrewFromReserve`, `RepaidReserve`, `LentToPayoutPool`, `RepaidFromPayoutPool`.

## The AssurancePool

| Read | What it tells you |
|---|---|
| `primaryBalance()`, `bufferBalance()`, `excessBalance()`, `getReserveBreakdown()` | The three tiers |
| `RTD()`, `targetRTD()`, `hasValidRTD()`, `getRTDStatus()` | The reserve ratio against its target. Read `hasValidRTD()` rather than `RTD()`, which shows 0 when there is nothing to stand behind |
| `poolExposure()`, `bondExposure()` | What the primary reserve stands behind: members' uncovered credit and the bond gap |
| `neededReserves()` | How far the primary reserve is short of target |
| `lentToPayoutPool()`, `bufferOwed()`, `lentToBondVault()`, `bondBufferOwed()` | What it has lent, and how much of that came from the buffer |
| `heldReserveValue()`, `unpricedTokenCount()` | The value of everything it holds, and how many held tokens the oracle could not price |

`RTD()` and `targetRTD()` are 18-decimal fractions: `1e18` is 100%. How they are worked out is in
[The reserve](../protocol/reserve.md#rtd).

## The payout pool

| Read | What it tells you |
|---|---|
| `held()`, `queuedTotal()`, `shortfall()`, `canPayNext()` | Cash on hand, merchant payouts waiting, and whether the next one can be paid |
| `borrowed()`, `borrowedFromYield()`, `borrowedFromVault()`, `borrowedFromReserve()` | What it owes each lender: in total, to the lending pool, to the bond vault, to the AssurancePool |
| `carryEarned()`, `distributableCarry()` | Carry set aside for its lenders, and carry not yet divided |
| `advancedOf(address)` | What each party has put up, which carry is divided by |

Events: `DrewFromYieldPool`, `DrewFromBondVault`, `DrewFromTreasury`, `DrewFromReserve`,
`RepaidYieldPool`, `RepaidBondVault`, `RepaidReserve`, `InterestPaid`, `ShortfallReported`.

`DrewFromYieldPool` and `RepaidYieldPool` record borrowing from, and repaying, the lending pool.

## The Command Center

The [Command Center](../governance/command-center.md) is the co-op's internal app. Once its Money section
is switched to live data, it reads the lending pool, the AssurancePool and the bond vault from the
test network, with reads like those above. It is not open to everyone: what each person who signs in can see is set
by their access level ([The Command Center → Who sees what](../governance/command-center.md#who-sees-what)).
