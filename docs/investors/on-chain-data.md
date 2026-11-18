# What anyone can read

**Every figure in the Investors section can be checked on the chain, by anyone, without asking the
co-op.** The reads below are public functions and events on the deployed contracts. Any block
explorer's "Read contract" tab can call them without a wallet. These contracts run on Base Sepolia,
a test network; each one's address, and every function it has, is on its page in the
[Contract reference](../protocol/contracts/README.md).

The names below are the contracts' own function and event names, as a block explorer shows them.
Amounts are in USDC units (six decimals); figures marked WAD are 18-decimal fractions, where `1e18`
is 1.

## The lending pool

[LendingPool](../protocol/contracts/LendingPool.md). Some of its functions run in modules the pool
calls into, so an explorer that reads only the pool's own code may not list them; the contract page
lists them all.

| Read | What it tells you |
|---|---|
| `shareValue()`, `totalAssets()`, `totalSupply()`, `previewRedeem(shares)` | The Share Value (WAD), Pool Assets, the shares outstanding, and what a number of shares is worth now |
| `vaultCash()`, `deployedBalance()`, `accruedInterest()`, `billedInterest()` | The parts of Pool Assets: cash, the Deployed Balance, interest accrued and not paid, and the month billed with its due date |
| `utilization()`, `fundingRate()`, `rateModel()`, `pendingRate()` | Utilization and the Funding Rate (WAD), the curve's settings, and any change waiting with when it applies |
| `poolTierPrincipal()`, `deploymentAccount()`, `deploymentCount()`, `totalDeployed()` | The posted Pool Tier principal and when it was posted, where Deployments go, and how many and how much |
| `queueLength()`, `queueHead()`, `queueRequest(id)`, `queuedShares()`, `queuedSharesOf(holder)`, `oldestRequestAge()` | The withdrawal queue: each request, the next in line, and how long the oldest has waited |
| `maxRedeem(owner)`, `maxWithdraw(owner)` | What a holder could take out on demand now (zero while the queue is open) |
| `holdbackRate()`, `poolLossAllowance()`, `holdbackOf(holder)`, `totalHoldback()` | The loss allowance, the holdback percentage, and what is held back for each holder |
| `pendingLossCharge()`, `lossChargeCount()`, `unrestoredCharges()` | A loss charge being applied, how many have been posted, and how much a recovery could still restore |
| `isSuspended()`, `suspension()`, `legalHoldsOf(holder)`, `heldSharesOf(holder)` | Whether the pool is suspended and why, and any legal hold on a holder's shares |
| `encumberedOf(holder)`, `freeSharesOf(holder)` | Shares pledged as collateral, and shares free to move |
| `initialClosing()`, `finalMaturity()` | The first subscription and the Final Maturity Date |
| `queuedAssets()`, `requestAt(id)` | Requests queued before the current version, fixed in USDC |

Events: `Subscribed`, `Deposit`, `Withdraw`, `Deployed`, `Returned`, `InterestBilled`,
`InterestCapitalized`, `PoolTierPrincipalPosted`, `QueueRequested`, `QueueFilled`, `QueueCancelled`,
`AllowancePosted`, `HoldbackRecorded`, `HoldbackReleased`, `LossChargePosted`,
`LossChargeCompleted`, `RecoveryPosted`, `Suspended`, `SuspensionLifted`, `LegalHoldPlaced`,
`LegalHoldReleased`, `RateModelProposed`, `RateModelApplied`.

## Settlement Funding

The settlement lane comes with the pool's next version,
[LendingPoolSettlementLane](../protocol/contracts/LendingPoolSettlementLane.md), which takes effect
only after the Earn timelock's 7-day delay. Until then the pool has no `settlementLane()` and the
call fails.

| Read | What it tells you |
|---|---|
| `LendingPool.settlementLane()` | The settlement funder, its cap per period, the period, what has been used this period, whether it is stopped, and the Settlement Headroom |
| `SettlementForwarder.offRamp()`, `desk()`, `safe()` | Where the forwarder sends money, who may call it, and the Safe it moves money from ([SettlementForwarder](../protocol/contracts/SettlementForwarder.md)) |

Events: `SettlementDeployed`, `SettlementFunderSet`, `SettlementFunderStopped`,
`SettlementHeadroomSet` on the pool; `Forwarded` on the forwarder.

## The Earn controls

[EarnControls](../protocol/contracts/EarnControls.md), shared by the lending pool and the bonds.

| Read | What it tells you |
|---|---|
| `fundingLimit()`, `fundingUsed()` | The Funding Limit, and what counts against it now |
| `offeringCap()`, `offeringTaken()`, `poolCapacity()` | The offering cap bonds and subscriptions share, how much of it is taken, and the pool's capacity |
| `holderCapBps()`, `holderCapFloor()` | The household cap on pool shares, and the floor it is measured against |
| `subscriptionsPaused()`, `purchasesPaused()`, `pauseFlags()` | Whether new subscriptions or bond purchases are paused, and which pause is set |
| `ladderTerms()`, `isTermOffered(days)`, `rungAt(days, time)`, `pendingRung(days)` | The bond terms on offer, the rate for a term at a given time, and any Ladder change waiting |
| `eligibleCode(account)` | Whether an account has an eligibility attestation in force |

## Bonds and the bond vault

[BondVault](../protocol/contracts/BondVault.md) and [BurnerBond](../protocol/contracts/BurnerBond.md).

| Read | What it tells you |
|---|---|
| `BondVault.held()` | What the vault holds in USDC |
| `BondVault.requiredReserve()`, `glideReserve()`, `nearTermReserve()` | The Redemption Reserve, and its two measures: the glide schedule and 100% of what is due within 90 days and will not roll |
| `BondVault.minReserveBps()`, `glideSchedule()` | The reserve floor and the glide schedule's bands |
| `BondVault.inReserveShortfall()`, `shortfallSince()` | Whether the vault holds less than the reserve, and since when |
| `BondVault.deployableExcess()` | What could leave the vault now, above the reserve |
| `BondVault.totalFaceOutstanding()`, `totalPrincipal()`, `totalFaceSettled()` | Maturity Amounts still owed, what buyers paid in, Maturity Amounts already paid |
| `BondVault.faceDueWithin(window)`, `rollingDueWithin(window)`, `coversNearTermMaturities()` | What falls due in a window, how much of it is set to roll, and whether holdings cover the next 90 days |
| `BondVault.treasuryAvailable()`, `uncoveredNearTerm()` | What the treasury's allowance could put up, and what is due within 90 days that neither covers |
| `BondVault.totalSettlementOwed()`, `pendingSettlement(id)` | Maturity payments recorded as owed, in total and for one bond |
| `BondVault.obligations(id)`, `outstandingBonds()` | One bond's price paid, Maturity Amount, maturity and status; every outstanding bond |
| `BurnerBond.accretedValue(id)`, `isBondMature(id)`, `holderOf(id)` | One bond's value today, whether it has matured, and who holds it |
| `BurnerBond.rollNotice(id)` | A bond's Roll Notice: its deadline, new term and rate, and whether the holder has confirmed |
| `BurnerBond.windDownSetAt()`, `redeemAllFrom()` | Whether a wind-down has been set or started |

Events: `PurchaseRecorded`, `Settled`, `SettledPledged`, `SettledEarly`, `SettlementShortfall`,
`SettlementCompleted`, `Rolled`, `RollRemainderPaid`, `DrewFromTreasury`, `ExcessWithdrawn`,
`ReserveShortfall`, `ReserveShortfallCured`, `ToppedUp` on the vault; `BondMinted`,
`RollNoticePosted`, `RollConfirmed`, `RollConfirmationWithdrawn`, `BondRolled`, `BondBoughtBack`,
`PledgePaid`, `PledgedMaturitySplit`, `WindDownSet`, `RedeemAllStarted` on the bonds.

## The Collateral Agent

[CollateralAgent](../protocol/contracts/CollateralAgent.md).

| Read | What it tells you |
|---|---|
| `enforcementInForce()` | Whether an Enforcement Notice is in force |
| `excessDestination()` | The one address the vault's excess can go to |
| `roundCount()`, `round(id)`, `claimable(bondId)`, `unclaimedDistributions()` | Distribution rounds under an Enforcement Notice, and what each bond can claim |

## The AssurancePool

[AssurancePoolV2](../protocol/contracts/AssurancePoolV2.md). The earlier AssurancePool is retired; its
own [page](../protocol/contracts/AssurancePool.md) stays for its record.

| Read | What it tells you |
|---|---|
| `balanceOf(CREDIT_BACKSTOP())`, `balanceOf(MEMBER_ASSURANCE())`, `totalAccounted()` | Each compartment's balance, and their total |
| `backstopFloor()`, `coveredBookPrincipal()`, `floorBps()` | The Credit Backstop's floor and the covered credit it is measured against |
| `backstopBalance()`, `availableCoverage()`, `coverageCap()` | What the Credit Backstop could pay now, after approved draws, and the cap on it |
| `drawCount()`, `drawAt(id)`, `pendingDrawRequests()` | Each draw request, its approval and its payment |
| `allocationOf(compartment)`, `paused()` | How new money is split between compartments, and whether releases are paused |

Events: `CompartmentCredited`, `DrawRequested`, `DrawApproved`, `DrawReleased`, `AssuranceReleased`,
`TransferProposed`, `TransferExecuted`, `FloorInputsSet`.

## The payout pool

[PayoutPool](../protocol/contracts/PayoutPool.md). It no longer borrows from the lending pool or the
bond vault.

| Read | What it tells you |
|---|---|
| `held()`, `queuedTotal()`, `shortfall()`, `canPayNext()` | Cash on hand, merchant payouts waiting, and whether the next one can be paid |
| `yieldPool()`, `bondVault()` | The lenders it is set to borrow from, zero for none |
| `borrowedFromYield()`, `borrowedFromVault()` | What it still owes the lending pool and the bond vault from before |
| `treasuryAvailable()` | What the treasury's allowance could put up for a due payout |

## Changes waiting

The [Earn timelock](../protocol/contracts/EarnTimelock.md) holds every upgrade and admin change to
the lending pool, the Earn controls and the bond vault for 7 days; the
[Assurance timelock](../protocol/contracts/AssuranceTimelock.md) does the same for the AssurancePool.
`getMinDelay()` gives the delay, a `CallScheduled` event shows each change and the call it will
make, and `isOperationPending(id)` and `isOperationReady(id)` show where it stands.

## The Command Center

The [Command Center](../governance/command-center.md) is the co-op's internal app. Once its Money section
is switched to live data, it reads the lending pool, the AssurancePool and the bond vault from the
test network, with reads like those above. It is not open to everyone: what each person who signs in can see is set
by their access level ([The Command Center → Who sees what](../governance/command-center.md#who-sees-what)).
