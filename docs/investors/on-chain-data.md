# What anyone can read

**Everything on these pages can be checked on-chain, by anyone, without asking the co-op.** The
figures below are public view functions and events on the deployed contracts. Addresses are in the
root [`README.md`](../../README.md#deployed-addresses); the contracts are deployed on Base Sepolia,
a test network.

## The lending pool

| Read | What it tells you |
|---|---|
| `totalAssets()`, `totalSupply()`, `convertToAssets(shares)` | What the pool counts as its assets, and what a share is worth against them |
| `totalBorrowed()` | Principal lent out and not repaid, as the pool counts it (see [Risks](./risks.md#credit-losses) on why it is not written down) |
| `availableCash()` | Cash that can be lent or withdrawn now |
| `queuedAssets()`, `requestCount()`, `requestAt(id)`, `requestsOwnedBy(owner)`, `isClaimable(id)` | The withdrawal queue, and whether a request can be paid now |
| `maxWithdraw(owner)`, `maxRedeem(owner)` | What a depositor could take out now |
| `encumberedOf(holder)`, `freeSharesOf(holder)` | Shares pledged as collateral, and shares free to move |

Events: `Borrowed`, `Repaid`, `WithdrawalQueued`, `WithdrawalClaimed`, `LossAbsorbed`,
`SharesSeized`.

`utilizationBps()`, `borrowRatePerCycle()` and `supplyRatePerCycle()` are also public. No contract
charges or pays the rates they report ([The lending pool](./lending-pool.md#the-rate-curve-is-not-charged)).

## Bonds and the BondVault

| Read | What it tells you |
|---|---|
| `BondVault.held()` | What the vault holds in its reserve token |
| `BondVault.requiredReserve()` | What it must keep back: the larger of face due inside the window and the floor |
| `BondVault.deployableExcess()` | What the Safe could withdraw, or the vault could lend, now |
| `BondVault.totalFaceOutstanding()`, `totalPrincipal()`, `totalFaceSettled()` | Face still owed, principal taken in, face already paid |
| `BondVault.faceDueWithin(window)`, `coversNearTermMaturities()` | Face falling due in a window, and whether holdings cover the reserve window |
| `BondVault.treasuryAvailable()`, `uncoveredNearTerm()` | What the treasury's allowance could put up, and the near-term gap neither covers |
| `BondVault.owedToReserve()`, `lentToPayoutPool()` | What the vault owes the AssurancePool, and has lent to the PayoutPool |
| `BondVault.obligations(id)`, `outstandingBonds()` | One bond's principal, face, maturity and status; every outstanding id |
| `BurnerBond.presentValueOf(id)`, `isBondMature(id)`, `willAutoRoll(id)` | One bond's accreted value, whether it can be redeemed, whether it can be rolled |

Events: `PurchaseRecorded`, `Settled`, `SettledEarly`, `Rolled`, `DeployableWithdrawn`,
`DrewFromTreasury`, `DrewFromReserve`, `RepaidReserve`, `LentToPayoutPool`, `RepaidFromPayoutPool`.

## The AssurancePool

| Read | What it tells you |
|---|---|
| `primaryBalance()`, `bufferBalance()`, `excessBalance()`, `getReserveBreakdown()` | The three tiers |
| `RTD()`, `targetRTD()`, `hasValidRTD()`, `getRTDStatus()` | The reserve ratio against its target. Read `hasValidRTD()` rather than `RTD()`, which is 0 when there is no exposure |
| `poolExposure()`, `bondExposure()` | What the primary reserve stands behind: members' exposure and the bond gap |
| `neededReserves()` | What the primary reserve is short of target |
| `lentToPayoutPool()`, `bufferOwed()`, `lentToBondVault()`, `bondBufferOwed()` | What it has lent, and how much of that came from the buffer |
| `heldReserveValue()`, `unpricedTokenCount()` | The value of everything it holds, and how many held tokens the oracle could not price |

`RTD()` and `targetRTD()` are 18-decimal fractions, where `1e18` is 100%. How they are computed is in
[The reserve](../protocol/reserve.md#rtd).

## The PayoutPool

| Read | What it tells you |
|---|---|
| `held()`, `queuedTotal()`, `shortfall()`, `canPayNext()` | Cash on hand, merchant claims waiting, and whether the next one can be paid |
| `borrowed()`, `borrowedFromYield()`, `borrowedFromVault()`, `borrowedFromReserve()` | What it owes each lender in principal |
| `carryEarned()`, `distributableCarry()` | Interest set aside for its lenders, and carry not yet distributed |
| `advancedOf(address)` | The positions each party holds, which `distributeCarry()` splits by |

Events: `DrewFromYieldPool`, `DrewFromBondVault`, `DrewFromTreasury`, `DrewFromReserve`,
`RepaidYieldPool`, `RepaidBondVault`, `RepaidReserve`, `InterestPaid`, `ShortfallReported`.

## The Command Center

The [Command Center](../../apps/command/README.md) is the co-op's internal app, and includes a
read-only view for members. When its money section is switched to live sources
(`PROVIDER_MONEY=live`), it reads the lending pool, the AssurancePool and the BondVault from the chain
with calls like those above. It is deployed from the `dev` branch, so what it shows is testnet and
sandbox data. What each person who signs in can see is set by their access level, described in
[Governance](../governance/README.md).
