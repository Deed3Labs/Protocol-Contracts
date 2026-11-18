# Clear Protocol — contract design

The model behind the on-chain layer, and the reasons for it: StableCredit as a ledger of
obligations, the ESA (Equity Savings Account) vault behind CLRUSD, the lending pool, BurnerBonds,
the AssurancePool, and where the contracts meet the app and the card issuer. For exact behaviour —
every function, role and revert — the reference pages are [Savings](./savings.md),
[Credit](./credit.md), [Settlement](./settlement.md), [The reserve](./reserve.md) and
[Bonds](./bonds.md).

The contracts build on the open-source StableCredit protocol. Where this page says "inherited", it
means behaviour that came with that base and that the design changes.

---

## 1. The model

### StableCredit is a ledger of obligations, not a pot of money

Every member has one signed position. Owing means they owe the network; holding credits means the
network owes them. Spending creates credit at the moment of the transaction; repayment burns it.
Nothing is drawn down from a pool.

**The credit tiers are not separate accounts. They are one balance with a tiered ceiling.** A
member owing $5,400.00 has one position. The tiers describe how that ceiling is made up and what
each slice costs. That is why tier logic lives in the issuers, not in StableCredit: the ledger
answers "what is owed and what is the ceiling", and an issuer answers "what is the ceiling made of".

### Two tokens, never merged

| | What it is | Backing | Redemption |
|---|---|---|---|
| **CLRUSD** | Money. Transferable, circulates like cash. | Fully reserved one-for-one against USDC in `ESADepositVault` | Always available, one-for-one, unrationed |
| **StableCredit** | The credit ledger. A position per member. | Owing side: the member's obligation and any collateral. Holding side: a counterparty's promise | Through the PayoutPool for a payable; a peer claim has no exit (below) |

**Merging them would break full reserve.** CLRUSD would end up backed partly by USDC and partly by
somebody's promise, and nobody could tell which. CLRUSD is a separate token from the credit ledger,
so the savings side stays fully reserved.

### Partner purchases: a three-party mint that nets to zero

A purchase at a partner merchant moves no CLRUSD and nobody lends anything at origination:

| Party | StableCredit |
|---|---|
| Member | **−** purchase amount |
| Merchant | **+** payout amount |
| Fee recipient (`TermIssuer.feeRecipient`, meant to be Clear Lending) | **+** the fee (purchase − payout) |

`StableCredit.originatePurchase` asserts that the three legs net. Origination needs no capital.

**The merchant's positive balance is the payables ledger.** It is what the co-op owes that merchant,
on-chain, with no parallel off-chain record. It is also how a merchant sees what they are owed and
redeems it.

**On partner purchases, liquidity is needed only at redemption**, when a merchant turns a positive
balance into USDC. That is the payout on the merchant's terms (30 days by default), and it is the
working capital the co-op has to find. Card spend outside the network is different; see §7.

**A merchant who also owes is paid by drawdown first, when value reaches them by transfer.**
Credits arriving by transfer burn against the recipient's own debt (`MutualCredit._afterTransfer`),
so only the surplus can be redeemed, and that payout costs no reserve at all. Credits minted to a
merchant by a new partner purchase do not net against ordinary debt, but they do settle a refund the
merchant still owes (`refundReceivableOf`); see [The payable](./settlement.md#the-payable).

### Member-to-member transfer

The ledger is transferable: a member can pass credits to another member, so StableCredit can
circulate between members rather than only against the co-op. Partner purchases already create
positive balances, so this is the same ledger with a wider set of counterparties, not a separate
mechanism. The contracts are built for it:

- StableCredit is **transferable**, not soulbound. Merchants hold real positive balances.
- The settlement path does **not assume the co-op is the counterparty** holding the positive side.
  In the common case the merchant is.
- Redemption handles a positive holder who is not the co-op. `PayoutPool.redeem` pays an active
  registered merchant, or a co-op account the admin has named (`REDEEMER_ROLE`) or a funder
  (`FUNDER_ROLE`); any other holder is refused (`PayoutPoolNotEligible`, audit C-1).

### Two kinds of positive balance

| | **Payable** | **Peer claim** |
|---|---|---|
| Arises from | A sale the co-op stands behind | Members trading with each other |
| Who owes it | The co-op, on a schedule | Nobody in particular |
| Exit | `PayoutPool`, at par | None: lost debt is not redeemable |
| Created by partner purchases? | **Yes, all of them** | **No** |

**On partner purchases, only the co-op extends credit.** A merchant selling on credit is not taking
risk on that customer; they hold a receivable from the co-op. Members appear only on the owing side.
So every positive balance a partner purchase creates is owed by a known party on a known schedule,
which is why a payables pool can cover all of it.

The inherited exit, redemption against lost debt, let a holder cash out only to the extent someone
else had defaulted. That was wrong for a payable, and section 13 retired it for every claim:
`burnLostDebt` reverts (`StableCreditLostDebtNotRedeemable`).

### Carry accrues into the balance, per position

Carry is not a fee charged at intervals. It accrues continuously into what a member owes, so a
position grows with time held. Two consequences:

**It cannot be computed by iterating accounts.** That does not scale. Accrual is lazy: each tier and
each plan accrues simple carry per second on its principal, at its monthly rate × 12 / 365, from the
rate it recorded, trimmed to the legal caps and the Combined Ceiling. Accrued carry is derived on
read, and written to the ledger (`accrueCarry`) only when an issuer materialises it. A position
untouched for six cycles reads the same carry as one touched every cycle. Carry never bears carry.

**Revolving tiers and term plans accrue separately:**

| | Basis | Why |
|---|---|---|
| **Revolving tiers** | One rate per tier | All drawn balance in a tier shares a rate and a clock |
| **Term plans** | One rate per plan | Each plan has its own rate, opening date and split schedule. Two plans at different rates cannot share one |

A member's debt is therefore made of parts — tier positions and plan positions, each with its own
carry — which is also how the app presents it.

### Lost debt

A member draws $1,000.00 and spends it; those credits are now in someone else's hands. If the member
defaults and the obligation is written off, **the credits still exist**. That orphaned supply is lost
debt: claims in circulation with no matching promise.

**Lost debt is recorded, not redeemed.** `writeOffCreditLine` adds the write-off to `lostDebt()`. In
the inherited design a holder could give up credits for reserve tokens from the AssurancePool
(`burnLostDebt`); section 13 retired that, and no member path reaches the Assurance contracts. The
loss is Clear Lending's charge-off, recovered through its own draw on the co-op's Credit Backstop
(§3).

**There is far less lost debt than in the inherited design.** A revolving write-off covers only the
member's pool exposure (`CollateralRegistry.exposureOf`): savings-backed debt is left drawn and
recovered by seizing the pledged CLRUSD, at par. Lost debt arises only where collateral does not
reach — the unsecured tiers, term plans, and the shortfall on asset-backed debt after haircut. That
is why the Credit Backstop's floor counts only that exposure (§3).

---

## 2. Contract map

| Contract | Job |
|---|---|
| `StableCredit` (`ClearCredit`) | The ledger: positions, the three-party mint, repayment routing, lost debt |
| `NetworkRegistry` | Issuer → ledger, member → **issuers** (plural), and the money-path list the AssurancePool refuses deposits from. The old AssurancePool and oracle fields stay zero |
| `RevolvingIssuer` | The tiered revolving line: savings, bonds, pool shares, income, Clear Boost™. Cheapest-first draw, one carry index per tier, card settlement |
| `TermIssuer` | Term plans (merchant splits, Clear Cash™). Per-plan rate, clock and split schedule, under its own term limit |
| `OffersIssuer` | A capped line the co-op draws to give new members a one-time offer |
| `CollateralRegistry` | What each member has pledged, exposure per member, and the CLRUSD lock |
| `LimitCalculator` | Values collateral, applies haircuts, writes capacities onto the revolving tiers |
| `Liquidator` | Seizes pledged CLRUSD or pool shares on default and settles the tier they backed |
| `MerchantRegistry` | Per-merchant terms: payout window, approval cap, discount, active flag |
| `PayoutPool` | Turns merchants' positive balances into USDC. Separate from the AssurancePool, and reports its own shortfall |
| `LendingPool` | The lending pool on Earn, an ERC-4626 vault. Deploys only to Clear Lending, and takes it back |
| `AssurancePool` | The co-op's Assurance contract (v2, Phase 2c): the Credit Backstop for Clear Lending's charged-off principal, and Member Assurance for member grants. Lends nothing |
| `AssuranceOracle` | Retired with the Phase 1 reserve. It priced accepted tokens and served the target reserve ratio |
| `BurnerBond`, `BurnerBondFactory`, `BurnerBondDeposit` | Zero-coupon ERC-1155 bonds |
| `BondVault` | Bond proceeds, per-bond accounting and a redemption reserve the code enforces |
| `ESADepositVault`, `ClearUSDUpgradeable` | Member savings: USDC in, CLRUSD out, and the lock on CLRUSD backing drawn credit |

### Why more than one issuer

**Tiers are not a reason to split.** One member, one balance, one ceiling made of parts.

**A different rule set is.** Term plans accrue per position rather than per tier, carry their own
rate and clock, run a split schedule, sit under a separate term limit, and are exempt from the
revolving period's compliance rule. Forcing both behaviours into one contract would mean one set of
storage doing two jobs badly. `OffersIssuer` is a third rule set: a capped line the co-op owes
itself.

**A second issuer does not mean a second reserve.** Every issuer writes to **one StableCredit** and
feeds **one Credit Backstop floor**. Each issuer contributes its own part of a member's ceiling, and
the ledger's ceiling is the sum (`_syncCreditLimit`).

**The registry is the extension point.** New issuers register in `NetworkRegistry` rather than being
special-cased, and no code assumes a member has exactly one issuer.

### Why term plans are ledger positions, not escrowed loans

A term plan is a signed balance, a rate index, an opening date, a split schedule and a share of a
member-level limit: StableCredit plus an issuer. There is no escrow, no lending desk and no pool at
origination.

A fund-and-escrow lending model — a lender funds a desk, a borrower escrows an asset, tokens move at
origination — would bring back the capital requirement at origination that the three-party mint
removes. Lending against NFT collateral, such as a tokenized deed, is an escrow-and-liquidate
problem; it belongs with the [Deed track](./README.md#the-deed-track) and its `DeedNFT`, not in the
credit issuers.

### Not in the contracts

- **No standing bid for peer claims.** Every positive balance a partner purchase creates is a payable
  and is covered by the PayoutPool. Paying a payable is always at par; making a market in credits is
  a separate instrument, and there is none.
- **No network factory.** Nothing deploys a whole StableCredit / AssurancePool / issuer set.
  `core/factories/` holds `BurnerBondFactory`, `FractionTokenFactory` and `ValidatorFactory`.

---

## 3. The reserve and what it stands behind

### The reserve is compartments, and nothing withdraws from it

In the inherited code, `withdraw` and `withdrawToken` were public with no access control, and any
address could drain the excess reserve. Phase 1 replaced them with named outflows from primary,
buffer and excess tiers, and Phase 2c (compliance section 13) replaced that pool with a new
contract, **AssurancePool v2**, owned by the co-op rather than Clear Lending. Its full behaviour is
in [The reserve](./reserve.md).

| Compartment | What it is for | The only way out |
|---|---|---|
| `CREDIT_BACKSTOP` | Clear Lending's charged-off principal | `releaseDraw`, to Clear Lending's loss-reserve address, after its `requestDraw` and two co-op signers |
| `MEMBER_ASSURANCE` | Member Assurance grants | `releaseAssurance`, to the co-op's disbursement address, two signers |

There is no sweep, rescue, withdraw or approve, and the pool lends, stakes and pledges nothing. No
credit, savings, payout or bond contract holds its address.

### The backstop's floor counts pool exposure

**The floor answers one question: if members defaulted, what would Clear Lending actually lose?** The
inherited reserve ratio divided reserves by all credits in circulation, which over-reserves heavily
against fully collateralised credit. Counting "unsecured only" is also wrong: it under-reserves,
because asset-backed collateral has to be sold at an uncertain price.

| Backing | Counted | Why |
|---|---|---|
| Savings | **Excluded** | Collateral is liquid, already in the network and seizable at par. Seizure clears the debt |
| Asset (bonds, pool shares, external assets) | **Shortfall only**: `debt − collateral × haircut`, floored at zero | Collateral must be realised; only the gap is a loss |
| Unsecured (income, Clear Boost™, term plans) | **Full value** | No collateral |

`CollateralRegistry` is the exposure source. `coveredBookPrincipal()` is that exposure (or the
attested covered book, if higher), and `backstopFloor()` is the larger of the timing-buffer shortfall
and `floorBps` (500, 5%) of the covered book. See [The floor](./reserve.md#the-floor).

**Worked example.** Four members owing $7,140.00 in total:

| Member | Debt | Backing | Collateral | Lost on default |
|---|---|---|---|---|
| A | $3,000.00 | Savings | $3,000.00 | **$0.00** |
| B | $1,200.00 | Income (unsecured) | — | $1,200.00 |
| C | $2,000.00 | Asset, counted at 70% | $2,600.00 | **$180.00** ($2,000.00 − $1,820.00) |
| D | $940.00 | Term plan (unsecured) | — | $940.00 |
| | **$7,140.00** | | | **$2,320.00** |

- Counting all debt would cover $7,140.00, treating A's fully covered position as exposure.
- Counting unsecured only would cover $2,140.00, missing C's $180.00.
- Counting pool exposure covers **$2,320.00**, so at 5% the floor is $116.00 (unless the
  timing-buffer shortfall is larger).

**Why savings-backed debt is excluded rather than offset.** The member does owe on the ledger;
StableCredit holds one number and knows nothing about backing. But putting that debt in the
denominator and the savings in the numerator would count the same collateral twice: the savings are
consumed by the very debt being counted. Excluding both is the same answer with fewer places to be
wrong. With only savings-backed credit outstanding, the covered book is zero and so is the floor.

### Internal collateral is its own category

Asset-backed does not always mean an outside asset. A bond or a lending-pool share is a **claim on
the co-op itself**, and behaves differently from a tokenized deed:

| | External asset | Internal claim |
|---|---|---|
| Example | A tokenized deed | BurnerBond, lending-pool share |
| Where the capital sits | Outside the co-op | **Already inside the co-op, funding the book** |
| Seizure on default | Sell it into a market | **Cancel the co-op's own obligation to the member** |
| Haircut driver | Market price uncertainty | Redemption terms, largely known |

This is not circular in a harmful sense: the bond is senior, the debt is the member's, and the floor still
counts the shortfall. On default the co-op seizes a bond it would otherwise have had to redeem, so
**the seizure cancels a liability rather than realising an asset.**

`CollateralRegistry` registers each kind with its own backing (`AssetExternal` or `AssetInternal`)
and haircut. An internal claim has known redemption terms and an external asset has a market price,
so applying one kind's haircut to the other either over- or under-reserves. Haircuts are set per
kind, conservatively, and lowered only with evidence.

The same CLRUSD cannot be counted twice. A member's CLRUSD backing drawn credit is locked in the
token (§4), so it cannot be moved into a bond or the lending pool to be pledged again.

### Retired: pricing and the target ratio

The Phase 1 `AssuranceOracle` priced accepted tokens from a Uniswap V3 time-weighted average and
served a target reserve ratio. Both retired with the Phase 1 pool; `floorBps` and the monthly floor
inputs (`setFloorInputs`, two signers) replace them. See
[Retired: the Phase 1 reserve](./reserve.md#retired-the-phase-1-reserve).

---

## 4. Collateral, limits and the issuers

### Collateral kinds and tier rates

`deploy/20_deploy_CreditCore.ts` adds one revolving tier per collateral kind, in ascending rate
order, on a 30-day cycle. Rates and haircuts are parameters, set and changed by operators:

| Tier | Backing | Counted at (`haircutBps`) | Rate at deployment | Capacity from |
|---|---|---|---|---|
| `SAVINGS` | Savings | 100% | 0 bps per cycle | Pledged CLRUSD |
| `BOND` | Asset, internal | 95% of present value | 65 bps per cycle | Pledged bonds, valued by `BondValuer` |
| `POOL_SHARE` | Asset, internal | 70% | 75 bps per cycle | Pledged lending-pool shares |
| `INCOME` | Unsecured | — | 150 bps per cycle | An off-chain attestation (`LimitCalculator.attest`) |
| `BOOST` | Unsecured | — | 300 bps per cycle | An off-chain attestation; opt-in |

- **Savings need no external capital**, so savings-backed credit works without any pool existing.
- **Bonds are valued at present value, not face.** `BurnerBond.presentValueOf` accretes straight-line
  from the purchase price to face at maturity, so a pledged bond's capacity rises as it nears
  maturity (written when `pushCapacities` is next called).
- **Pool shares are counted at 70% for correlation, not volatility.** The pool's value is backed by
  the same loan book, so it falls exactly when credit lines are impairing.

**Rates ascend across tiers** (`addTier` reverts otherwise), so cheapest-first draw order falls out
of the ordering rather than being enforced separately. Repayment runs the other way: an undirected
repayment clears the dearest position first, across issuers.

**Collateral that earns a return must cost more to borrow against than it earns.** Otherwise a
member could borrow cheaply against an asset paying more and extract free money.
`LimitCalculator.pushCapacities` reverts with `LimitCalculatorYieldExceedsCarry` when a kind's
`collateralYieldOf` is at or above its tier's rate.

### Encumbrance and the redemption lock

The member's smart account **holds CLRUSD directly**: self-custody, not co-op custody. The co-op
holds the USDC behind it in `ESADepositVault`.

With self-custody, a member could otherwise move CLRUSD out while it backs drawn credit. So the lock
lives in the token: `ClearUSDUpgradeable` asks `CollateralRegistry.encumberedOf(holder)` how much is
backing drawn credit, and refuses any transfer, redemption or bridge that would take the balance
below it. `seize`, by `LIQUIDATOR_ROLE`, can take only that encumbered amount. Putting the lock in the
token rather than in a smart-account module means it works for any holder. See
[The redemption lock](./savings.md#the-redemption-lock).

```
free CLRUSD = balance − CLRUSD needed to cover what is drawn on the savings tier
```

When free CLRUSD reaches zero, the member frees more by:

- adding USDC to savings (more CLRUSD, more headroom), or
- repaying, in USDC on chain or in fiat (`repayCardSpend` clears the debt against the card float).

Clearing a member's debt needs no signature from them: reducing what someone owes is not taking
their asset.

**Limit timing follows who caused the change.** A pledge or new savings takes effect as soon as
capacities are pushed (`pushCapacities` is permissionless). An attested figure, such as an income
re-estimate, takes effect at its `effectiveFrom`.

### Compliance, income-to-debt and defaults

A revolving member is in compliance when they owe nothing at the end of the credit period — their
balance is back to zero or above. Holding a positive balance is fine.

`CreditIssuer.itdOf` exposes an income-to-debt ratio that works for both member classes:

```
ITD = (credits received from members + external deposits received) / average balance carried
```

For a consumer the first term is near zero and deposits carry it; for a merchant trading with other
members, the first term dominates. No contract enforces a minimum ITD.

How defaults, write-offs and liquidation work is in [Default](./credit.md#default).

---

## 5. The lending pool

`LendingPool` is the lending pool on Earn: an ERC-4626 vault over USDC whose share price counts what
is deployed. Its full behaviour is in [LendingPool](./settlement.md#lendingpool), and the reader's
version in [The lending pool](../investors/lending-pool.md).

- **It lends only to Clear Lending.** Direct borrowing is retired (`borrow` reverts
  `LendingPoolDirectBorrowOff`). Money leaves as a Deployment to the registered deployment account,
  proposed by one deployment signer and sent by another, or through the settlement lane
  (`deploySettlement`) by the single registered settlement funder.
- **Both are capped.** Utilization after a Deployment is at most 90%, and the Deployed Balance stays
  within the Pool Tier principal two valuation signers last posted (plus Settlement Headroom for
  the lane). Nothing deploys while a withdrawal request waits, the pool is suspended or a loss
  charge is pending.
- **Holders earn Pool Interest at the Funding Rate**, and withdrawals queue first in, first out
  when cash is deployed (`requestWithdrawal`, then `claimWithdrawal`).
- **Losses are charged to holders** through a recorded loss charge, with holdbacks, and only after
  Clear Lending's own layers: the member's collateral, its margin, its loss reserve, Credit Backstop
  draws and its own capital. No contract moves reserve money into the pool.

---

## 6. Bonds

### Bond proceeds never enter the AssurancePool

Bondholders are creditors and must be senior to loss absorption. In the inherited code, proceeds went
to the AssurancePool's excess reserve and redemptions came out of the same pool, so bondholder
principal funded default cover and a redemption could revert. That was a seniority inversion.

Proceeds now go to `BondVault`, which holds a **Redemption Reserve the code derives**
(`requiredReserve()`): the larger of the glide reserve, which never falls below a floor of 30% of
what is outstanding and only rises, and 100% of every bond due within 90 days, plus anything
recorded as owed. Only the **deployable excess** above that can leave other than to a bondholder.
Below the reserve the vault is in Reserve Shortfall and purchases pause. Details are in
[Bonds](./bonds.md#where-the-money-lives--bondvault).

**Proceeds land in the vault, not the Safe.** Money does have to reach people eventually — a contract
cannot wire dollars to the card issuer — but sending proceeds straight to a multisig would make the
redemption reserve a policy someone must remember rather than a rule the code enforces.

### When the vault is short at maturity

`BondVault` pays from its own holdings, then from the treasury (the Safe) up to the USDC allowance
its owners have given the vault. A settlement never waits and never reverts for want of funds: what
neither covers is recorded as owed (`pendingSettlement`), added to the reserve ahead of any excess,
and paid later by the permissionless `completeSettlement`. Since section 13 the vault names no
AssurancePool, and nothing on the bond side can reach one. Details are in
[Bonds](./bonds.md#redemption).

### Pledged bonds at maturity

A bond still backing drawn credit settles against the debt it backs: the Liquidator applies the
Maturity Amount to that debt first (`maturityToDebt`, then `BondVault.settlePledged`), and the rest
goes to the Holder's payee. A Holder who confirmed a roll gets a new bond instead, and the pledge
moves with it, so the member's limit does not contract the day it matures.

### The offers line

`OffersIssuer` gives each new member a one-time offer of credit (`OFFER_AMOUNT`, $10.00 by default)
from a capped line the contract holds, so nothing is funded in advance and the co-op's liability for
offers sits in one account, apart from the Safe and members' credit. The member spends it like any
credit, and the shop redeems through the PayoutPool.

- `settle()` (permissionless) repays the line with the Safe's USDC, up to the allowance the Safe
  gives the contract. The repayment is routed like any other, so it reaches the PayoutPool first.
- An offer unspent after the expiry window (90 days by default) comes back off the member and off
  the line (`expire`, permissionless).
- `debtByKind` reports nothing, so the Credit Backstop's floor does not count the co-op owing itself.
- The API's hourly offers job (`AUTO_OFFERS`) grants, expires and settles offers.

---

## 7. The off-chain boundary

A member's credit limit mixes on-chain collateral with off-chain data, and a card authorization must
be answered within seconds — too little time to depend on reading chain state.

**The chain is authoritative for what is owed. An off-chain snapshot is authoritative for what can be
spent right now.**

- An `available_by_tier` snapshot per member is precomputed and decremented **at approval**. That,
  not the chain, prevents double-spending.
- The chain lags the swipe by **days, not seconds**. That is acceptable because the hold is shown
  off-chain from the moment of approval.
- Income-tier and Clear Boost™ underwriting exist only off-chain. They reach the chain as
  **attestations from a trusted signer** (`LimitCalculator.attest`), not as raw data.
- The snapshot is a cache, rebuildable from chain state and attestations at any time.

**Swipe to settlement:**

1. The card issuer (Lithic) asks for an authorization. The service reads the snapshot, decrements
   it and approves, in milliseconds.
2. The draw is a **hold**: recorded off-chain, shown to the member at once as drawn, and reported per
   tier on `/api/credit` as `pendingCardDraws`. Nothing is written on-chain, because an
   authorization can still be voided or clear for a different amount.
3. Lithic pays the merchant from the co-op's fiat float at network clearing, **one to three business
   days** later.
4. When the card transaction reaches `SETTLED`, the draw is final and **StableCredit is issued
   on-chain** (`settleCardSpend`), tagged with the funding tier. **Carry accrues from here**, not
   from the swipe.
5. Reconciliation confirms that snapshot, chain and float agree.

**Why issuance waits for clearing.** The amount is not final at authorization: a tip is added after
the swipe, a fuel pump authorizes a round number and clears the real one, and a void means the
purchase never happened. Writing at authorization would need a correction for a meaningful share of
transactions and a reversal for every void, each costing gas and leaving an on-chain record of things
that did not occur. Writing once, at clearing, is one write for one fact.

**Two money movements, often confused:**

- **Float → merchant** happens per transaction, inside Lithic, at clearing. This is what debits the
  float.
- **Treasury → float** is periodic: an off-ramp from the treasury, sized by what the float needs,
  never one per swipe.

**The float is needed only for network spend.** A purchase at a partner merchant is the three-party
mint (§1) and needs no capital. A swipe anywhere else is settled in fiat by Lithic to a merchant who
holds no StableCredit, so real money must be in the issuing account at clearing. One card, two
mechanisms.

**A repayment reaches the chain whichever way it is paid:**

| Member repays with | Off-chain | On-chain | Money movement |
|---|---|---|---|
| **Fiat** (ACH into the co-op's account) | The deposit settles the member's credit accounts first | **`repayCardSpend`**: the float's claim is burned against the member's debt, tiers cleared dearest first. No capital needed | None. The fiat refills the float directly, which is exactly the claim being satisfied |
| **USDC** (on chain) | The ledger is synced from the repayment | `repayCreditBalance` with the member's USDC, routed like any repayment | The periodic treasury → float off-ramp, not one per repayment |

Fiat netting is **reconciled to a target**, like the card holds: what should be on chain is what the
member still owes (ignoring USDC repayments, which did not refill the float), less what has not
reached the chain yet (pending holds, settled-but-unissued purchases). Anything above that is
cleared. That also covers a member who pays before a purchase has settled: it settles, then it is
cleared on the next pass.

**Carry is owed, paid and cleared too.** Materialised carry adds to the member's debt and mints the
matching claim to the tier's carry recipient.

- **Measured from the chain**: carry accrued = drawn − issued + cleared, read through the index, so
  unmaterialised carry counts.
- **Recorded off-chain as it accrues**, reconciled to the lifetime total so a re-run writes nothing
  twice.
- **Paid first**: a deposit settles carry before principal.
- **Cleared by the same netting** when the tier's carry recipient is the card settlement account.
- **Carry held elsewhere is not netted.** Where a tier's carry goes to another recipient, such as the
  lending pool, its holders are owed on-chain money, so that carry must be paid in USDC. The member's
  position is flagged and the carry left on chain; there is no automatic on-ramp for it.

---

## 8. Merchant payouts

### The AssurancePool never funds or lends to a payout

Paying merchants from a loss reserve would mean **a merchant could be paid only when a member had
defaulted**, at a rate set by how badly the book was performing, and it would spend the fund that
makes losses survivable on ordinary operations.

**A merchant's positive balance is a payable** — certain, owed, due on a schedule. **The Credit
Backstop covers a contingency** — a loss that may never happen. So the AssurancePool never funds a
payout, and since section 13 it does not lend across a timing gap either: `PayoutPool` holds no
address for it. A merchant is paid from members' repayments, Clear Lending's payout top-ups and the
treasury allowance. A due claim none of them covers waits for funding (`dueWithin` says how much).

### The pool is a timing buffer, not a subsidy

When a member repays, value reaches the PayoutPool, and **that value is what pays the merchant
holding the positive side.** The co-op funds only the gap between paying merchants on their terms and
collecting from members over their plans. How each repayment is routed, and who holds the position
when someone else's cash pays a claim, is in [Refunds and repayments](./refund-repayment-plan.md).

### Funded beats queued

| Pool state | Behaviour |
|---|---|
| Covers the claim | **Pay now** |
| Short | Queue, due at the merchant's payout window from `MerchantRegistry` |

**The payout window is the latest a merchant waits, not when they are paid.** A well-funded pool pays
at once.

### Earliest deadline first, no priority

Payout order is **earliest deadline first**: each claim is due at the time it was queued plus the
merchant's payout window, and claims due at the same moment go oldest first (addendum 12.10). There
is no priority field to set.

Configurable priority would make every slow payout a question of "someone else went first" rather
than "the pool ran short" — a worse conversation, with a merchant the co-op also needs. Better terms
for a merchant are a promise kept at the co-op's expense; a better place in a shared queue is a
promise kept at another merchant's expense. **Per-merchant terms are the adjustable part:** each
merchant's payout window is set in `MerchantRegistry`, in their agreement, not in the queue.

### Funding sources

| Source | How it arrives |
|---|---|
| Members' repayments | **Automatically**, through `_routeRepayment` |
| Merchant drawdown netting | **Automatically**, on transfer; costs no reserve at all |
| Capital (`fund`) | A `FUNDER_ROLE` holder puts it in, and holds the positions it pays for |
| The treasury, for a due claim | `drawForDueClaim` (permissionless): the treasury allowance. Its lending-pool and bond-vault legs are inert (direct borrowing is retired and the vault lends nothing) |
| Fiat top-ups | A multisig action |

**The rule:** the pool takes value that is already on chain automatically; anything crossing the fiat
boundary is a multisig action. A contract cannot wire dollars and cannot decide to on-ramp. **The pool
reports its own shortfall** (`shortfall()`, `ShortfallReported`), so a top-up is a number someone
reads, not a judgement someone makes.

### The co-op's own positive balance

The co-op takes the discount on every partner purchase as a positive StableCredit position. It can
take that income in cash with `withdrawCoopIncome`, which pays only from members' repayments that no
queued claim or owed refund is waiting on, and burns the credits it pays out. Or it can leave the
position standing, which leaves the cash in the pool for merchant payouts. Either way the choice is
visible on chain.

---

## 9. Reserve sources: one backstop

**The Credit Backstop is the only loss reserve.** Its floor reads the exposure sources governance
names (`setExposureSources`, today the `CollateralRegistry`) and nothing else, so no other pool can
count toward it by accident.

**The other pools are not reserves:**

| Source | Why it is not a loss reserve |
|---|---|
| `LendingPool` | Its holders' capital, deployed to Clear Lending at their risk |
| `BondVault` | Bondholders' money behind a code-enforced redemption reserve. It cannot absorb losses by construction |
| `PayoutPool` | Merchants' money |
| Member Assurance | The co-op's member grants. Never moves into the Credit Backstop except by a two-signer transfer |
| Member savings | Locked against that member's own debt. Never pooled, never available for anyone else's loss |

### Two numbers, not one

**The backstop against its floor is the reserve figure.** It stays narrow on purpose.

**Network position is a reporting view**: total obligations against total assets, **with claim
priority kept rather than summed.** It gates nothing, so it needs no on-chain authority; it is read
off-chain from the contracts.

**They are never blended.** A single combined ratio would look healthy on the strength of bondholder
funds and merchant payables that cannot absorb a default — false confidence that would surface only
during a stress event.

---

## 10. Invariants

**A partner purchase nets to zero.** Member debit + merchant credit + fee recipient credit = 0.
`originatePurchase` and `reversePurchase` assert it on every call, not just in tests.

**Value received by transfer nets against the recipient's own debt first.** Only the surplus is
redeemable. A new sale nets only against a refund the recipient still owes.

**Carry is simple and accrues per second.** Principal and carry are held apart, carry never bears
carry, and accrued carry reaches the ledger only through `accrueCarry` when an issuer materialises
it.

**The Credit Backstop's floor is the larger of the timing-buffer shortfall and 5% of the covered
book.** A transfer out of the backstop executes only if it keeps that floor plus every pending draw.

**`PayoutPool` and `AssurancePool` never meet.** No payout, redemption, refund, liquidation or force
settlement reaches the AssurancePool, and its `deposit` refuses any money-path contract.

**The AssurancePool holds no bond principal.** Bond proceeds go to `BondVault`.

**Payout order is earliest deadline, then claim age.** No priority field exists to be set.

**The ledger and the issuers are reconciled, not merged.** The ledger holds one number per member;
the issuers hold the positions behind it. A repayment the issuers do not fully absorb leaves a
visible gap rather than being corrected silently.

### Off-chain checks

The API's hourly reconciler compares, and alerts on drift without correcting it:

| Check | Compares |
|---|---|
| Vault solvency | Cash held at the card issuer for members against the sum of member cash balances |
| ESA backing | CLRUSD in circulation against USDC held by `ESADepositVault` |
| Sweep completion | Fiat pushed out for completed sweeps against the CLRUSD those sweeps minted |
| Credit issuance | Card credit drawn on chain against what the off-chain ledger says is owed and settled |
| Float adequacy | The settlement float against savings-backed credit drawn but not yet reconciled |

On chain, `BondVault.coversNearTermMaturities()` reports bond coverage by maturity window, and
`AssurancePool.backstopBalance()` against `backstopFloor()` the Credit Backstop. A system can be
solvent in aggregate and short on timing, which is why bond coverage is measured inside a window.

---

## 11. Known limitations

- **Exposure is gross, per position.** Lending-pool depositors are paid out of other members' carry.
  A member who is both a large depositor and a large unsecured borrower has largely netted their own
  risk, but exposure still counts both positions in full.
- **Losses and reserve requirements are not attributed per issuer.** Every issuer's exposure feeds
  one Credit Backstop floor, summed across issuers.
- **Term debt is one exposure bucket.** `TermIssuer.debtByKind` reports all term debt under a single
  `TERM` kind, which exposure counts as unsecured. There is no way to mark a term plan as secured by
  an asset.
- **Secured term loans against a T-Deed (the Equity-Lease Participation Agreement, ELPA): not
  available yet.**
- **Revolving tiers are assumed to hold card debt only.** The off-chain carry measure reads any draw
  on a revolving tier that did not come from a card as carry. A member spending StableCredit directly
  would draw there too.
- **Term plans use a level schedule.** `_fixSchedule` sets a level installment when a plan opens,
  and the schedule total is that installment times the number of installments; there is no
  declining-payment option.
