# The reserve

The co-op's reserve is the **AssurancePool**, rebuilt in Phase 2c around compartments (compliance
section 13, [`specs/assurance-contracts.md`](../audit/specs/assurance-contracts.md)). It belongs to
Clear Collective LLC, the co-op, not to Clear Lending Co. It holds:

| Compartment | What it is for | How money leaves |
|---|---|---|
| `CREDIT_BACKSTOP` | Clear Lending Co.'s charged-off principal, under the I-11 agreement | `releaseDraw`, to Lending Co.'s registered loss-reserve address |
| `MEMBER_ASSURANCE` | Member Assurance grants | `releaseAssurance`, to the co-op's registered Assurance disbursement address |

Governance may add compartments (at 0% allocation). The two above can never be removed.

Bond proceeds are not here — they sit in `BondVault` ([Bonds](./bonds.md)) — and merchant payables
are not here either — they sit in `PayoutPool` ([Settlement](./settlement.md)). **No credit,
savings, payout or bond contract holds the pool's address**, so no redemption, withdrawal, payout,
refund, liquidation or force settlement can reach it.

Deployed addresses are in the root [`README.md`](../../README.md) (**Deployed addresses**). Who
governs it is in [`UPGRADEABILITY.md`](../audit/UPGRADEABILITY.md).

## One ledger per compartment

One contract, one asset (USDC), and a balance per compartment with no shared spendable balance.
Every unit the pool takes in is credited to exactly one compartment, so the sum of the compartment
balances is what the pool holds (`totalAccounted`). Value moves between compartments only by
`executeTransfer`. There is no sweep, rescue, withdraw, approve or admin transfer, and the pool
lends, stakes and pledges nothing.

USDC sent to the pool's address by a plain transfer is not credited anywhere, and no function can
move it.

## Money in

`deposit(sourceTag, amount)` is the only way in:

| Source tag | Paid by | Where it goes |
|---|---|---|
| `CREDIT_ENHANCEMENT_FEE` | Lending Co.'s operating address | Credit Backstop up to its floor, the rest by allocation |
| `RECOVERY` | Lending Co.'s operating address | Credit Backstop, all of it |
| `INTERCHANGE` | the co-op treasury | Credit Backstop up to its floor, the rest by allocation |
| `BOARD_ALLOCATION` | the co-op treasury | Credit Backstop up to its floor, the rest by allocation |

Payers are allowlisted per tag by governance. `deposit` refuses any address the `NetworkRegistry`
lists as a money path (`isMoneyPath`: every registered credit issuer, plus CLRUSD, the ESA vault,
the pledge registry, the Liquidator, the LendingPool, BondVault, PayoutPool and the ledger).

The allocation (`setAllocation`, basis points per compartment, summing to 10,000; 50/50 at launch)
is set per program year. Within the year it was last set in, the Credit Backstop's share may rise
but never fall.

Where a repayment goes is the ledger's business, not the pool's: `ClearCredit` pays the payout pool
what it is owed and sends the rest to **Lending Co.'s operating address** (`lenderOperating`).
Lending Co. pays its credit-enhancement fees into the pool itself.

## The floor

```
backstopFloor()        = max(timingBufferShortfall, floorBps × coveredBookPrincipal / 10,000)
coveredBookPrincipal() = max(Σ exposure sources' poolExposure(), attestedCoveredBook)
backstopBalance()      = CREDIT_BACKSTOP assets − approved draws not yet paid
availableCoverage()    = min(backstopBalance(), coverageCap)
```

`floorBps` starts at 500. The exposure source is the `CollateralRegistry`, which reads every
issuer's debt by kind: income-backed, Clear Boost and term-plan debt count in full, savings-backed
debt not at all, asset-backed debt by the shortfall after its haircut. With no unsecured credit live
the floor is zero.

`timingBufferShortfall`, `coverageCap` and `attestedCoveredBook` are set each month by two signers
(`setFloorInputs`, with an evidence hash; event `FloorInputsSet`).

## Draws and grants

1. Lending Co.'s **Registered Draw Address** calls `requestDraw(periodId, amount, evidenceHash)`:
   one request per period. That is the only thing it can do.
2. A co-op signer calls `approveDraw(drawId, approvedAmount)`. Approving less leaves the disputed
   remainder in the Credit Backstop; approving zero closes the request.
3. A **different** signer calls `releaseDraw(drawId)`. Draws are released in request order, only
   to the loss-reserve address, only from the Credit Backstop, and never above
   `availableCoverage()`.

`releaseAssurance(grantId, amount, evidenceHash)` pays a member Assurance grant from Member
Assurance only, to the disbursement address only, once per `grantId`. Two signers send the same
call. It reverts if Member Assurance is short and never falls back to another compartment.
`grantId` is the co-op's own reference: no member data goes on chain.

## Transfers between compartments

`proposeTransfer(from, to, amount, resolutionHash)` by one signer, then `executeTransfer` by a
different one, after `transferDelay` (at least 14 days). A transfer into the Credit Backstop needs
no delay. A transfer out of it executes only if the backstop keeps its floor plus every pending draw
request.

## Two people, and a timelock

Every action takes two distinct signers; the same address can never propose and approve.

- Floor inputs, grants, the pause and its renewal: the same call from two different signers.
- Draws and transfers: one signer proposes (or approves a draw), another releases or executes.
- Parameters and upgrades: two signers approve the exact calldata (`approveAction`), and then the
  **Assurance timelock** (a `TimelockController`, 7 days at least, the co-op board Safe proposing)
  makes the call. The pool checks the timelock's delay on every upgrade.

A security pause blocks only releases and transfers. Deposits and draw requests carry on. It lasts
72 hours unless two signers renew it.

Clear Lending Co., Clear Capital Management LLC and Clear Capital Holdings hold no role. Neither of
Lending Co.'s registered addresses, nor its operating address, can be a signer.

## Retired: the Phase 1 reserve

Phase 2c retired the design described here before. It remains only on Base Sepolia, as the
`AssurancePool` and `AssuranceOracle` records in `deployments/base-sepolia/`; the new pool is a new
contract with a new layout.

### Three tiers

The old pool held primary, buffer and excess tiers. A member's repayment landed in them, lost debt
was redeemed out of them (`reimburse`), and the excess and buffer were lent to the PayoutPool and
BondVault. All of that is gone: repayments go to Lending Co., lost debt is Lending Co.'s charge-off
(recovered through its own draw), and nothing lends.

### RTD

The old pool measured its primary tier against pool exposure (the reserve-to-debt ratio). The new
pool measures the Credit Backstop against a floor on the covered book instead (above).

### Target RTD

The target RTD came from the AssuranceOracle, or a risk model registered as `ITargetRTDSource`.
Both are retired; `floorBps` and the monthly floor inputs replace them.

### Pricing — AssuranceOracle

The oracle priced other tokens in the reserve token for a multi-token reserve. The new pool holds
USDC only, at face, so nothing is priced. The bond factory reads the `TokenRegistry`'s whitelist
directly ([`token-registry.md`](./token-registry.md)).
