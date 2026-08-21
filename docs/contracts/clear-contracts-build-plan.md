# Clear Protocol — Contract Build Plan

Build plan for the on-chain layer: StableCredit, the ESA, the Yield Pool, BurnerBonds, and the connection points to the app and Lithic.

Repo: `Deed3Labs/Protocol-Contracts`, forked from `StableCredit`. The `KyngKai909/Lending` fork is **dropped** — see below.

---

## 1. Mental model — read before touching anything

### StableCredit is a ledger of obligations, not a pot of money

Every member has one signed balance. Negative means they owe the network; positive means the network owes them. Spending mints credit at the moment of transaction; repayment burns it. Nothing is being drawn down from a pool.

**The waterfall is not four accounts. It is one balance with a tiered ceiling.** A member at −$5,400 has one position. The tiers describe how that ceiling was composed and what each slice costs. Tier logic therefore does **not** belong inside StableCredit — StableCredit answers "what is the balance and what is the ceiling," and a separate layer answers "what is the ceiling made of."

### Two tokens, never merged

| | What it is | Backing | Redemption |
|---|---|---|---|
| **CLRUSD** | Money. Transferable, circulates like a bank deposit. | Fully reserved 1:1 against deposited USDC | Always available, 1:1, unrationed |
| **StableCredit** | The credit ledger. Signed balance per member. | Negative side: member obligation + collateral. Positive side: a counterparty's promise. | Rationed by lost debt (see §1.4) |

**Merging them breaks full reserve.** CLRUSD would end up backed partly by USDC and partly by somebody's promise, and nobody could tell which. This is the same circularity already rejected when CLRUSD was dropped as reserve currency.

> **CONFIRMED:** CLRUSD is a **separate token** from StableCredit in this fork — not the ReSource pattern where the credit ERC20 is itself the medium of exchange. No token-separation work is needed. The savings side is genuinely fully reserved, and the two-door redemption model below holds as written.

### The two phases — and what must not be foreclosed

**Phase 1 (now, consumer at a partner merchant).** A purchase is a **three-party mint that nets to zero**. No CLRUSD moves at origination and nobody lends anything:

| Party | StableCredit |
|---|---|
| Member | **−** purchase amount |
| Merchant | **+** payout amount |
| Co-op | **+** the discount (purchase − payout) |

That is mutual credit doing what mutual credit does. **The earlier framing in this document — that the co-op lends its own CLRUSD at draw time and StableCredit is a debt register that never circulates — was wrong**, and it invented a float requirement that does not exist. Origination is capital-free.

**The merchant's positive balance IS the payables ledger.** It is what the co-op owes that merchant, on-chain, without a parallel off-chain record. It is also what lets a merchant see what they are owed and redeem it.

**Liquidity is needed only at redemption**, when a merchant converts a positive balance to USDC. That is the net-30 payout, and it is exactly the working capital already modelled in the business plan. The on-chain design and the business plan now describe the same thing.

**Merchants who carry credit are paid by drawdown first.** A merchant with a negative balance of their own has it reduced before any surplus becomes redeemable. Only the surplus can be withdrawn. This is the B2B circulation of Phase 2 arriving early, as a consequence rather than a feature — and it is the cheapest possible payout, because it costs no reserve at all.

**Phase 2 (B2B, later).** A member accepts a counterparty's claim and transfers it onward, so StableCredit circulates between members rather than only against the co-op. Phase 1 already creates positive balances, so Phase 2 is no longer a different mechanism — it is the same ledger with transfer switched on and a wider set of counterparties.

**Therefore, in Phase 1 code:**
- StableCredit must be **transferable**, not soulbound. Merchants hold real positive balances from day one.
- The settlement path must **not assume the co-op is the positive-side counterparty** — in the common case the merchant is.
- Redemption must handle a positive holder who is not the co-op. This is now the *primary* path, not a future one.
- Never hard-code `balance <= 0`.
- Redemption must **net against the holder's own negative balance first**, and only pay out the remainder.

### Two kinds of positive balance — do not conflate them

This is the distinction the inherited code does not make, and getting it wrong leads to paying merchants out of a loss fund.

| | **Payable** (yours) | **Peer claim** (inherited) |
|---|---|---|
| Arises from | A sale the co-op sits behind | Members trading with each other |
| Who owes it | The co-op, on a schedule | Nobody in particular |
| Exit | `PayoutPool`, at par | AssurancePool — **capped by lost debt** |
| Exists in Phase 1? | **Yes, all of them** | **No** |

**In Phase 1 nobody extends credit to anybody except the co-op.** A merchant sells on credit, but the co-op stands behind it — the merchant is not taking risk on that customer, they are holding a receivable from the co-op. Consumers appear only on the negative side. **So every positive balance in the system is owed by a known party on a known schedule**, which is exactly why a payables pool covers all of it.

The inherited exit — redeem against lost debt — means a holder can only cash out to the extent someone else defaulted. That is the right mechanism for a peer claim and the wrong one for a payable.

### Carry accrues into the balance, per position

Carry is not a fee charged at intervals — it accrues continuously into the negative balance, so a position worsens with time held. Two consequences for the contracts:

**It cannot be computed by iterating accounts.** That does not scale. Use **lazy accrual**: an index that advances with time, with each position storing the index value at its last touch. Accrued carry is derived on read.

**Term plans accrue per position, revolving tiers accrue per tier.** These are genuinely different and need two mechanisms:

| | Basis | Why |
|---|---|---|
| **Revolving tiers** | One index per tier | All drawn balance in a tier shares a rate and a clock. |
| **Term plans** | One index per plan | Each plan has its own rate, its own opening date and its own split schedule. Two plans at different rates cannot share an index. |

**The member's negative balance is therefore derived**, not stored: the sum of tier positions plus the sum of term positions, each with its own accrued carry. The UI already presents it this way — one balance composed of parts — so the contract shape matches what a member sees.

### Lost debt

A member draws $1,000 and spends it — those credits are now in someone else's hands. The member defaults and the obligation is written off, but **the credits still exist**. That orphaned supply is lost debt: claims in circulation with no matching promise. It is inflationary.

Redemption is how lost debt is deleted: a positive holder burns credits, receives reserve currency from the AssurancePool, and lost debt drops by that amount. **Redemption capacity equals lost debt outstanding.** It is a cleanup mechanism, not an exit door — free redemption would drain a fractional pool.

**In this system there is far less lost debt than in base ReSource**, because a default fires ESA liquidation first, which covers the position and returns the CLRUSD. No orphan, no lost debt. Lost debt arises only on the *unsecured shortfall* — income tier and Boost — where collateral does not reach. This is the entire justification for RTD counting only unsecured exposure.

---

## 2. Contract inventory

### Exists — fix in place
| Contract | Status |
|---|---|
| `StableCredit` | Core ledger. Verify token separation (§1.2). |
| `CreditIssuer` | Ceiling + period rules. Needs ITD redefinition. |
| `AssurancePool` | **Has a critical bug.** See Phase 0. |
| `AssuranceOracle` | Currently a Uniswap price reader. Its real job is the predicted default rate. |
| `BurnerBond` + `BurnerBondFactory` | Zero-coupon ERC-1155. Proceeds routing must change. |
| `ESADepositVault` | Member savings. |

### Build new
| Contract | Purpose |
|---|---|
| `NetworkRegistry` | member → **issuers** (plural); issuer → (stableCredit, assurancePool, oracle). The parent registry every issuer is registered against. |
| `MerchantRegistry` | Per-merchant terms: base payout schedule, approval cap, discount rate, status. The redemption path reads it. Makes "merchant accounts" a config change rather than a rewrite. |
| `PayoutPool` | Funds merchant redemptions. Separate from AssurancePool. Reports its own shortfall. |
| `RevolvingIssuer` | The tiered line: savings, asset, income, Clear Boost™. Cheapest-first waterfall, cycle equilibrium, one index per tier. |
| `TermIssuer` | Term plans: partner credit, Clear Cash™, ground lease, ELPA. Per-position rate and clock, split schedules, its own income-based limit. No cycle equilibrium. |
| `CollateralRegistry` | What each member has pledged and where it lives. |
| `LimitCalculator` | Values collateral, applies haircuts, emits the tiered ceiling. |
| `LendingPool` | ERC-4626, utilization-priced. Funds unsecured tiers. |
| `BondVault` | Per-bond accounting + code-enforced redemption reserve. |

### On the number of issuers — revised

An earlier note in this plan said **one** CreditIssuer, on the grounds that tiers are not a reason to split and that a second issuer implies a second reserve. **The first half still holds; the second was wrong, and the design has since produced a genuine second rule set.**

**Tiers are not a reason to split.** One member, one balance, one ceiling composed of parts. That has not changed.

**Term plans are a different rule set, which is the stated criterion.** They accrue per position rather than per tier, carry their own rate and clock, run a split schedule, sit under a separate income-based limit, and are exempt from cycle equilibrium. Forcing both behaviours into one contract means one set of storage doing two jobs badly.

**A second issuer does not mean a second reserve.** Both issuers write to **one StableCredit** and draw on **one AssurancePool**. The reserve-splitting objection applies to a second *network*, not to a second issuer inside one network. Nothing is fragmented.

**The registry is the extension point.** Future issuers register there rather than being special-cased: a `PartnerIssuer` for merchant-issued lines, or issuers run by other institutions later. Those parties are **partner members and their customers are consumer members** — inside the network, not external to it — so the co-op underwrites within one reserve, and per-issuer risk segregation becomes a reserve *requirement* per issuer rather than a separate pool.

**Leave room, do not build it yet.** `NetworkRegistry` should map member → a *set* of issuers from day one, and no code should assume a member has exactly one. Beyond that, per-issuer loss attribution and reserve requirements are a later design — the shape is not knowable until a non-co-op issuer actually exists.

### Dropped — `KyngKai909/Lending` (MagnifyCash V1 fork)

**Do not use it, do not adapt it, do not import from it.**

**It cannot do term plans.** It is a bullet loan against an escrowed NFT. Term plans amortize on a split schedule against a signed ledger balance with no collateral. Keeping the file names and replacing the contents is not a fork, it is a rewrite with someone else's licence attached.

**It contradicts the origination model.** MagnifyCash moves real assets: a lender funds a desk, a borrower escrows an NFT, ERC-20 transfers at origination. Phase 1 origination is a three-party mint that nets to zero and moves nothing. Bolting a fund-and-escrow model onto a mutual credit ledger would reintroduce a capital requirement at origination — the exact false premise removed from this document.

**It also carries real defects**: permissionless `initializeNewLendingDesk`, `liquidateDefaultedLoan` sending collateral to whoever holds the desk key, no amortization, no delinquency states, and two OpenZeppelin generations of drift.

**`TermIssuer` does this natively.** A term plan is a signed balance, a rate index, an opening date, a split schedule and a share of a member-level limit — StableCredit plus an issuer. No escrow, no desk, no pool at origination. `TermIssuer` is not a substitute for Magnify; it is what makes Magnify unnecessary.

**Keep one idea, not one line of code.** Per-desk lending — a party defining its own terms and bearing its own losses — is the shape a future `PartnerIssuer` takes. That is a sentence, not a dependency.

**The one case that could revive the pattern:** if asset-backed collateral ever means *NFT* collateral — tokenized deeds via Clear Properties Co. — there is a genuine escrow-and-liquidate problem. That belongs to the Clear Deed track and wants a contract designed against the DeedNFT, not a fork of a generic NFT lending protocol.

### Do not build yet — `StandingBid`

**Trigger: the first time a member holds a positive balance the co-op did not create.** That is Phase 2 transfer between members, and it is the moment the AssurancePool becomes the only exit again.

**It has no job in Phase 1.** Every positive balance is a payable — merchant, or the co-op's own discount — and both are already covered. Nothing in Phase 1 produces a positive balance that is not already owed by someone.

**The pricing question dissolves once the two roles are separated.** Paying a payable is always par. Making a market is a different question, answerable when there is a market. Asking one instrument to do both is why "par or discount" had no answer.

**Two properties to design for when it is built, both absent from a payables pool:**

- **It is an open-ended obligation.** A payable is finite and known. A standing bid promises to buy whatever arrives, at a price, from capital that must stay available. It needs its own funding rule, and it must never draw on the AssurancePool.
- **The bid price becomes the credit's price.** Once a floor exists, that number *is* what a credit is worth. Moving it is a monetary decision, not an operational one — it should be governed, not set by whoever holds the key.

### Do not build yet
Factory for networks — a factory encodes assumptions about what varies, and that is not yet known. Check whether the fork already ships one before writing anything. Build it when deploying the second network.

---

## 3. Build phases

Each phase ships, is tested, and is reviewed before the next begins.

### Phase 0 — Fix what is broken

**0.1 `AssurancePool.withdrawToken` / `withdraw` are `public` with no access control**, and `excessReserve` is mapped by token, not by depositor. Any address can drain the excess reserve.

Fix: **nobody withdraws from AssurancePool directly.** Every claim routes through an instrument. Role-gate to the legitimate callers only:
- `BurnerBond` — maturity redemption
- `StableCredit` — lost-debt redemption
- `LendingPool` — loss absorption draw

**0.2 RTD must count POOL EXPOSURE, not total credit and not simply "unsecured".** The inherited formula divides reserves by *all* credits in circulation, which over-reserves ~3× against fully-collateralized credit. But "unsecured only" is also wrong — it under-reserves, because asset-backed collateral has to be sold at an uncertain price.

**The question RTD answers is exactly one thing:** *if every member defaulted tomorrow, what would the AssurancePool actually pay?*

| Tier | In the numerator | Why |
|---|---|---|
| Savings-backed | **Excluded** | Collateral is liquid, already in the network, seizable at par. Seizure burns the debt; the pool pays nothing. |
| Asset-backed | **Shortfall only** — `debt − (collateral × haircut)`, floored at zero | Collateral must be sold. Realizable value is uncertain, so the pool covers the gap. |
| Income-backed, Clear Boost™, partner credit, Clear Cash™ | **Full value** | No collateral. The pool covers all of it. |

**Worked example.** Four members owing $7,140 in total, AssurancePool at $900:

| Member | Debt | Tier | Collateral | Pool pays on default |
|---|---|---|---|---|
| Ana | $3,000 | savings-backed | $3,000 | **$0** |
| Ben | $1,200 | income-backed | — | $1,200 |
| Cruz | $2,000 | asset-backed | $2,600 | **$181** at a 70% haircut |
| Dee | $940 | partner credit | — | $940 |
| | **$7,140** | | | **$2,321** |

- Naive (all debt ÷ pool): **793%** — counts Ana's fully-covered position as exposure.
- Unsecured-only: **238%** — misses Cruz's $181 entirely.
- **Correct: $2,321 ÷ $900 = 258%.**

**Why savings-backed debt is excluded rather than offset.** The member's account *does* go negative on the ledger — StableCredit holds one signed number and knows nothing about backing. But putting that debt in the numerator and their savings in the denominator counts the same collateral twice: the savings are consumed by the very debt being counted. Both sides cancel. Excluding both is the same answer with fewer places to be wrong.

**The test still holds:** with only savings-backed credit live, reserves-needed must be **exactly zero**. Any formula that does not produce zero there is wrong.

### Internal collateral is a distinct category

**Asset-backed does not always mean an outside asset.** A bond or a pool share is a **claim on the co-op itself**, and it behaves differently from a tokenized deed:

| | External asset | Internal claim |
|---|---|---|
| Example | Tokenized deed via Clear Properties Co. | BurnerBond, LendingPool share |
| Where the capital sits | Outside the co-op | **Already inside the co-op, funding the book** |
| Seizure on default | Sell it into a market | **Cancel the co-op's own obligation to the member** |
| Haircut driver | Market price uncertainty | Redemption terms — largely known |

**This is not circular in the harmful sense.** The bond is senior, the debt is the member's, RTD still counts the shortfall. But note what actually happens on default: the member is seized of a bond the co-op would otherwise have had to redeem, so **the seizure cancels a liability rather than realizing an asset.** That works cleanly — it is just worth stating rather than discovering.

**Do not treat the two identically when setting haircuts.** An internal claim has known redemption terms; an external asset has a market price. Applying a market-risk haircut to a bond over-reserves; applying a bond-style haircut to a deed under-reserves.

**The round-trip is already closed.** Withdrawable CLRUSD = ESA balance − savings-backed drawn, and the ERC-7579 module enforces the transfer restriction while encumbered. A member at −$3,000 against $3,000 saved cannot move that CLRUSD into a bond or the pool to be counted twice.

**One property to keep in view, not to fix yet.** The LendingPool funding unsecured tiers is member money, so one member's yield is paid by another's carry cost — which is what a credit union is. But a member who is simultaneously a large depositor and a large unsecured borrower has **netted their own risk to near zero while the network still shows two gross positions.** Immaterial at ten merchants, real at scale, and better named now than discovered in year three.

**The haircut is a real parameter, not a detail.** It should be per-collateral-type, governed, and conservative. Start high and lower it with evidence.

**0.3 `AssuranceOracle` needs the right inputs.** Its job is the predicted default rate feeding target RTD, not ERC20 prices. It should read internally-generated credit-risk signals: ESA balances, deposit history, repayment behaviour, cycle-rebalance rates. If the Uniswap `slot0` path is retained for any purpose, replace it with `observe()` TWAP — `slot0` is flash-loan manipulable.

**0.4 OpenZeppelin version.** `BurnerBond` uses v4 paths (`Counters`, `security/ReentrancyGuard`), both moved or deprecated in v5. Pin deliberately.

### Phase 1 — Collateral, limits, and the issuer split

**Split `CreditIssuer` into `RevolvingIssuer` and `TermIssuer`** before building the term product, not after. Retrofitting per-position accrual into a per-tier contract is the kind of migration that goes wrong with live balances.

**Carry indices land here too** — one per tier in `RevolvingIssuer`, one per plan in `TermIssuer`. Write the accrual test first: a position untouched for six cycles must read the same accrued carry as one touched every cycle. That single test catches most of what can go wrong with lazy accrual.


This is the missing layer, and it is what makes savings-backed credit work. **Savings-backed requires no external capital**, so the entire first product ships here without the pools existing.

**`NetworkRegistry`** — thin resolver so LimitCalculator, the app, and the ASA snapshot service all look up through one place. Adding a second network later becomes registration, not refactor.

**`CollateralRegistry`** — records pledged positions per member: ESA CLRUSD, bond token IDs, pool shares. Locks pledged assets against transfer while encumbered.

**`LimitCalculator`** — the core new logic. For a member, returns a tiered ceiling:

```
struct Tier {
    bytes32 kind;        // SAVINGS | ASSET | INCOME | BOOST
    uint256 capacity;    // ceiling contribution
    uint256 drawn;       // currently used
    uint256 ratePerCycle; // bps
}
```

Valuation rules:
- **ESA CLRUSD** — 100% LTV, 0 bps
- **BurnerBonds** — 95% of **present value, not face**. Discount at the bond's **issuance yield** (fixed at purchase, unmanipulable, matches the curve it was priced on). The haircut shrinks automatically as maturity approaches, so the limit grows on its own. ~65 bps/cycle.
- **Pool shares** — 70% LTV, ~75 bps/cycle. The haircut is for **correlation, not volatility**: pool NAV is backed by the same loan book, so it falls exactly when credit lines are impairing.
- **Income** — 50% of estimated monthly deposit, 150 bps/cycle. Off-chain attested (§4).
- **Boost** — opt-in, $500 / $750 accelerated, 300 bps/cycle. Off-chain underwritten.

### Encumbrance and the redemption lock

The member's smart account **holds CLRUSD directly** — self-custody, not co-op custody. Two rules follow.

```
withdrawable CLRUSD = ESA balance − savings-backed drawn
```

This is the vault invariant (`vault cash = total ESA − savings-backed drawn`) expressed from the member's side. When it reaches zero, **CLRUSD redemption locks** until the member does one of:
- adds USDC to savings → more CLRUSD → more headroom
- rebalances with fiat via Lithic (auto-routes to the co-op operating account) → burns the negative
- allocates unallocated USDC → same effect

There is no pay-back date and no pay button. The lock *is* the enforcement.

**Limit timing — two different rules, not one:**
- Changes the member does **not** control (income re-estimate, cycle-behaviour recalculation) are **fixed within the cycle** and announced at the boundary.
- Changes the member **initiates** (moving collateral, adding savings) take effect **immediately**. They caused it; they expect the causation.

**Enforcement lives in an ERC-7579 module on the member's smart account**, installed at onboarding, not in vault bookkeeping — because with self-custody a member could otherwise transfer CLRUSD out while carrying credit and drain their own collateral. The module:
- blocks transfer of encumbered CLRUSD
- grants a bounded, purpose-limited right to pull CLRUSD for **liquidation on default**

**Scope note:** in Phase 1 the co-op lends its *own* CLRUSD at draw time, so nothing needs pulling from the member at swipe — liquidation is the only pull. Settlement-pull is a Colossus-era addition. And burning a member's negative balance requires no authorization at all, since crediting someone's debt is not taking their asset; the fiat-rebalance path needs no member signature.

This is the same primitive Colossus uses for noncustodial settlement retrieval, so the stack stays consistent.

**Onboarding approvals** are bundled into a **single signing transaction** presented through Privy as the final confirm — the way a traditional flow would look. It must be visible and auditable afterward: a Permissions row under Advanced in settings listing exactly what was granted, with revocation blocked while encumbered.

**Invariant:** rates ascend across tiers, so cheapest-first draw order falls out of the ordering rather than being enforced separately.

**Yield-bearing collateral must cost more than it yields.** Bonds pay ~7.5%; borrowing against them costs ~7.8% APR. Otherwise a member borrows at 0% against an asset paying 7.5% and extracts free money.

**`CreditIssuer` changes:**
- Ceiling comes from `LimitCalculator`, not a stored per-member value.
- **ITD redefined** to one formula that works in both phases and for both member classes:

```
ITD = (credits received from members + external deposits received) / average balance carried
```

Today the first term is zero for consumers and the second carries it. When B2B ships, the first term dominates for merchants. No rule change, no migration.

- Equilibrium rule stays "rebalance to 0 **or above**." Do not collapse it to "to 0."

### Phase 2 — LendingPool

ERC-4626, utilization-priced. Standard interface so it is auditable and composable.

- Rate rises with utilization (Aave-style), so the pool self-regulates: capital arriving faster than loan demand drops the yield, which sends it elsewhere. No manual cap needed.
- Funds the **unsecured** tiers only. Savings-backed and asset-backed are self-funding.
- Absorbs first loss on the credit book before AssurancePool is touched.
- Withdrawal queue when utilization is high — surface queue status in the app rather than failing silently.

### Phase 3 — BondVault

**Bond proceeds must not enter AssurancePool.** Bondholders are creditors and must be senior to loss absorption. The current implementation routes proceeds to the excess reserve and redeems from the same pool, so bondholder principal funds default coverage and redemption can revert. That is a seniority inversion.

`BondVault` holds proceeds with per-bond accounting: principal, maturity, face obligation. It maintains a **redemption reserve** covering maturities in the next N months and allocates the rest out.

**On the multisig:** proceeds land in `BondVault`, not the Safe. The Safe withdraws only the **deployable excess** — what the vault does not owe in the near window. Money does have to reach human control eventually (a contract cannot wire dollars to Lithic or originate an ELPA), but sending proceeds straight to a multisig makes the redemption reserve a policy someone must remember rather than a rule the code enforces.

Allocation target: ~70% deployable / ~30% reserve, with the reserve share rising as maturities approach. Parameterised with bounds, not an operator decision.

**Auto-roll on maturity** should be the default (with opt-out) for bonds pledged as collateral — otherwise the limit contracts hard the day a bond matures if the member already spent the proceeds.

### Phase 4 — Wire it together

- Bonds and pool shares register in `CollateralRegistry`.
- `LimitCalculator` picks them up; the asset-backed tier lights up.
- Merchant exit runs through `PayoutPool` at par. `StandingBid` is **not** deployed here — see "Do not build yet".

**Repayment routing must change when `PayoutPool` exists.** Inherited behaviour sends every repayment — and every liquidation proceed — into the AssurancePool's buffer reserve: `repayCreditBalance` ends in `depositIntoBufferReserve`. That contradicts §4b in both directions. Repayment value is what pays the merchant holding the positive side, and the AssurancePool is the one fund forbidden from funding a payout, so the working capital for net-30 accumulates precisely where it cannot be spent.

It is the same shape as the bond seniority inversion: money in the wrong pot, where the rule against moving it back is what bites. **Done** — `StableCredit._routeRepayment` offers `PayoutPool` its reported shortfall first and sends only the remainder to the buffer reserve.

---

## 4. The off-chain boundary

The credit **limit** mixes on-chain collateral with off-chain data, and card authorization has ~200ms — far too little to read chain state.

**The chain is authoritative for what is owed. An off-chain snapshot is authoritative for what can be spent right now.**

- `available_by_tier` snapshot per member, precomputed, decremented **at approval**. That is what prevents double-spend, not the chain.
- The chain lags the swipe by seconds. Acceptable.
- Income-tier collateral and Boost underwriting exist only off-chain; they enter the chain as **attestations from a trusted signer**, not as raw data.
- The snapshot is a cache and must be rebuildable from chain state plus attestations at any time.

**Swipe → settlement:**
1. Lithic ASA asks. Service reads snapshot, decrements, approves. Milliseconds.
2. Lithic settles the merchant from the co-op fiat float.
3. Async: transaction issues StableCredit on-chain, tagged with the funding tier.
4. Reconciliation confirms snapshot, chain and float agree.

Repayment runs backward: deposit lands → negative settles → StableCredit burns → float replenishes.

**Later, Colossus inverts this.** Card-present transactions settle from on-chain collateral via an issuer hook, so the waterfall needs an on-chain implementation. When that ships, **the on-chain version becomes canonical and the off-chain path mirrors it** — not the reverse.

---

## 4b. Merchant payouts

### The AssurancePool must never fund a payout

Redemption there is capped by lost debt outstanding, so paying merchants from it would mean **a merchant can only be paid when a member has defaulted**, at a rate set by how badly the book is performing. It also spends the fund that makes losses survivable on ordinary operations.

**A merchant's positive balance is a payable** — certain, owed, due on a schedule. **The AssurancePool covers a contingency** — a loss that may never happen. Funding the first from the second is the error. Assert it: no code path reaches AssurancePool from the redemption flow.

### The pool is a timing buffer, not a subsidy

When a member clears a term plan, their negative balance burns and value lands with the co-op. **That value is what pays the merchant holding the positive side.** The co-op funds only the gap between paying merchants at day 30 and collecting from members over 30–60 days — the same working capital already modelled in the business plan.

### Funded beats queued

| Pool state | Behaviour |
|---|---|
| Covers the claim | **Pay now** |
| Short | Queue at the merchant's base terms from `MerchantRegistry` |

**Net-30 is the floor, not the promise.** A well-funded pool simply beats it, and directing surplus capital there converts spare cash into merchant satisfaction — the scarcest thing at ten merchants. It is also a real advantage over BNPL, whose settlement speed is fixed regardless of how well the business is doing. Sell it as *net-30 guaranteed, usually faster*: keepable on day one, quietly over-delivered later.

### FIFO. No priority tiers.

Payout order is **claim age, always.**

Priority is tempting and should not be built. The moment order is configurable, every merchant conversation includes *what tier am I on*, and every slow payout has a visible reason that is not "we ran short" but "someone else went first" — a worse conversation, with a merchant you also need.

**It also does not solve what it would be reached for.** Founding partners deserve something, and the thing they deserve is **better terms** — the 2% rate, the fee-free first transactions — not a better place in a shared queue. Terms are a promise kept at the co-op's expense. Queue position is a promise kept at another merchant's expense.

**The real escape hatch is per-merchant base terms**, held in `MerchantRegistry` — net-30 standard, net-14 where the ticket supports a 30-day member term. Configurable, defensible, and set in the agreement rather than in a queue.

**If regional expansion ever needs segmentation, deploy a pool per region.** Each funds and drains its own, and nobody is behind anyone. That is the clean version of priority.

### Funding sources — automated where value is already on-chain

| Source | Mode |
|---|---|
| Savings forfeiture | **Automated** |
| Incoming USDC deposits | **Automated** |
| Move-to-Earn proceeds | **Automated** |
| Merchant drawdown netting | **Automated** — costs no reserve at all |
| Lithic / FBO top-up | **Manual, multisig** |

**The rule:** the pool may pull from on-chain sources automatically; anything crossing the fiat boundary is a multisig action. A contract cannot wire dollars and cannot decide to on-ramp.

**The pool must report its own shortfall** so the manual top-up is a number someone reads, not a judgement someone makes.

### The co-op's own positive balance

The co-op already holds one — it takes the discount on every purchase as a positive StableCredit position. It does not need to be created. **Three exits, all legitimate:**

| | Effect |
|---|---|
| **Burn** | Removes credit supply. Tightens the network when it is loose. |
| **Redeem** | Draws cash from `PayoutPool` when the co-op needs operating liquidity. |
| **Hold** | Leaves the pool deeper for merchant payouts, and sits as loss absorption. |

**Holding is a position, not indecision** — the co-op choosing to keep the network liquid rather than take its margin out. And the choice is visible on-chain, which makes it governable rather than discretionary.

---

## 4c. Reserve sources — one pool, no registry

**RTD reads the AssurancePool and nothing else.** No registry, no claim tags, no configuration.

An earlier draft of this plan proposed a `ReserveRegistry` where every reserve source registered with a tag for what it could absorb. **It was over-engineering and has been dropped.** A registry whose correct configuration has exactly one entry is a lookup table plus a governance surface plus a way to get the tags wrong. Hard-coding is *safer* here, not merely simpler: nothing can accidentally enter RTD because nothing else is wired to it.

**The other sources are not candidates in disguise:**

| Source | Why it never enters RTD |
|---|---|
| `LendingPool` residual | Absorbs loss **before** the AssurancePool. That is an ordering fact in the waterfall, not a reserve to register. |
| `BondVault` | Bondholder money behind a code-enforced redemption reserve. Cannot absorb losses by construction. |
| `PayoutPool` | Merchants' money. |
| Member savings | Encumbered to that member's own debt. Never pooled, never available for anyone else's loss. |

### Two numbers, not one

**RTD is the gate.** Pool exposure against the AssurancePool. It decides whether credit may be issued, and it stays narrow on purpose.

**Network position is a reporting view** — total obligations against total assets, **with claim priority preserved rather than summed.** It gates nothing, so it needs no on-chain authority: assemble it off-chain from whatever contracts exist at the time.

**Never blend them.** A single combined ratio would look healthy on the strength of bondholder funds and merchant payables that legally cannot absorb a default — false confidence rather than a blind spot removed, and it would only surface during a stress event.

**Revisit the registry only if a second loss-absorbing source ever exists** — a co-insurance pool, a regional reserve. That is a real trigger. Until it fires, the registry is speculative infrastructure.

## 5. Invariants

**A partner purchase nets to zero.** Member debit + merchant credit + co-op credit = 0. Assert it in the mint path, not just in tests — a purchase that does not net is a supply bug.

**Redemption nets against the holder's own debit first.** A holder with a negative balance cannot withdraw while carrying it; only surplus is redeemable.

**Accrued carry is derived, never stored per account.** The stored value is an index and a checkpoint. Any code path that writes an absolute accrued figure to a member record is wrong.

**RTD reads the AssurancePool and nothing else.** No other contract address appears in the RTD calculation.

**`PayoutPool` and `AssurancePool` never touch.** No redemption path reaches the AssurancePool; no payout draws on loss absorption.

**Payout order is claim age.** No priority field exists to be set.

**A member's balance is the sum of their positions.** Never a separately maintained total that could drift from its parts.


Run continuously. Alert on drift. Never auto-correct.

| Invariant | Check |
|---|---|
| ESA vault solvency | vault CLRUSD = total ESA − savings-backed drawn |
| CLRUSD full reserve | CLRUSD supply = USDC held in reserve |
| Credit issuance | on-chain StableCredit outstanding = Σ tier draws in the off-chain ledger |
| Bond coverage | redemption reserve + scheduled inflows ≥ face due in window |
| RTD | reserves ≥ target × **pool exposure** — unsecured at full value + asset-backed shortfall after haircut; savings-backed excluded |
| Float adequacy | settlement float ≥ savings-backed drawn but not yet reconciled |
| Seniority | AssurancePool balance contains **no** bond principal |

Also run **maturity-bucket coverage**: a system can be solvent in aggregate and insolvent on timing.

---

## 6. Test requirements

- Phase 0: prove `withdrawToken` reverts for a non-role caller; prove RTD returns zero when all credit is savings-backed; prove an asset-backed position with collateral below `debt ÷ haircut` contributes exactly its shortfall.
- Phase 1: limit recalculates correctly as a bond accretes toward maturity; pledged collateral cannot be transferred; ascending-rate invariant holds.
- Phase 2: utilization curve; withdrawal queue under high utilization; first-loss ordering.
- Phase 3: redemption reserve cannot be withdrawn by the Safe; bond redeems at maturity even when the pool is stressed.
- Phase 4: a positive-balance holder who is not the co-op can redeem; no redemption path reaches the AssurancePool.
- Adversarial: flash-loan the oracle; drain attempt on every pool; default a member with collateral and verify no lost debt is created.

---

## 7. Open questions — flag, do not decide

1. ~~Does the member's smart account hold CLRUSD directly, or does the co-op custody it with position tracked in contract state?~~ **RESOLVED — self-custody.** The member's smart account holds the CLRUSD; the co-op holds the USDC backing it in the ESA vault. This is what the Phase 1 body already assumed, so the encumbrance model stands as written: enforcement lives in an ERC-7579 module on the member's account, not in vault bookkeeping.
2. ~~Does the fork already ship a network factory (`core/factories/` has `BurnerBondFactory`)?~~ **RESOLVED — no.** `core/factories/` holds `BurnerBondFactory`, `FractionTokenFactory` and `ValidatorFactory`. Nothing deploys a StableCredit / AssurancePool / CreditIssuer set, so "do not build yet" stands unchallenged.
3. Asset-backed haircut values — per collateral type, and the split between external assets (market price) and internal claims (redemption terms).
4. Whether `TermIssuer` term plans use levelled payments or declining payments on-chain, given the UI shows one levelled figure.
