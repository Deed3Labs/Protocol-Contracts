# Clear Protocol — Contract Build Plan

Build plan for the on-chain layer: StableCredit, the ESA, the Yield Pool, BurnerBonds, and the connection points to the app and Lithic.

Repos: `Deed3Labs/Protocol-Contracts` (forked from `StableCredit`), `KyngKai909/Lending` (MagnifyCash V1 fork, not in scope here).

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

> **VERIFY FIRST:** in base ReSource the StableCredit ERC20 *is* the medium of exchange — one signed token where positive means you hold credits. Confirm whether CLRUSD in this fork is that token or a separate receipt token. If it is the same token, separating them is Phase 0 work and everything else waits.

### The two phases — and what must not be foreclosed

**Phase 1 (now, consumer):** StableCredit is a debt register and is never spent. Only CLRUSD circulates. A member draws credit → the co-op lends its own CLRUSD → the member's StableCredit goes negative. Repayment burns it and returns CLRUSD to the co-op reserve. Capital-intensive: requires a co-op CLRUSD float, the on-chain sibling of the fiat settlement float.

**Phase 2 (B2B, later):** a member accepts a counterparty's claim instead of being paid in CLRUSD. *That* is the only thing that creates a positive StableCredit balance. The holder can then transfer that claim onward, at which point StableCredit itself circulates. Requires zero co-op capital — which is why it is the scalable endgame.

**Therefore, in Phase 1 code:**
- StableCredit must be **transferable**, not soulbound, even though nothing transfers it yet.
- The settlement path must **not assume the co-op is the positive-side counterparty**.
- Redemption logic must handle a positive holder who is not the co-op.
- Never hard-code `balance <= 0`.

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
| `NetworkRegistry` | member → issuer; issuer → (stableCredit, assurancePool, oracle). ~50 lines. |
| `CollateralRegistry` | What each member has pledged and where it lives. |
| `LimitCalculator` | Values collateral, applies haircuts, emits the tiered ceiling. |
| `LendingPool` | ERC-4626, utilization-priced. Funds unsecured tiers. |
| `BondVault` | Per-bond accounting + code-enforced redemption reserve. |
| `StandingBid` | Co-op buys positive StableCredit from members. Funded from LendingPool/operating capital, **never** AssurancePool. |

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

**0.2 RTD must count only unsecured exposure.** The inherited formula divides reserves by *all* credits in circulation, which over-reserves ~3× against fully-collateralized credit. In Phase 1 with only savings-backed credit live, the correct reserves-needed figure is **exactly zero**. Any formula that does not produce zero there is wrong — use it as the test.

**0.3 `AssuranceOracle` needs the right inputs.** Its job is the predicted default rate feeding target RTD, not ERC20 prices. It should read internally-generated credit-risk signals: ESA balances, deposit history, repayment behaviour, cycle-rebalance rates. If the Uniswap `slot0` path is retained for any purpose, replace it with `observe()` TWAP — `slot0` is flash-loan manipulable.

**0.4 OpenZeppelin version.** `BurnerBond` uses v4 paths (`Counters`, `security/ReentrancyGuard`), both moved or deprecated in v5. Pin deliberately.

### Phase 1 — Collateral and limits

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
- `StandingBid` deployed: the co-op buys positive StableCredit at par or a small discount, funded from LendingPool/operating capital. Merchant gets a real exit; the fractional reserve stays untouched.

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

## 5. Invariants

Run continuously. Alert on drift. Never auto-correct.

| Invariant | Check |
|---|---|
| ESA vault solvency | vault CLRUSD = total ESA − savings-backed drawn |
| CLRUSD full reserve | CLRUSD supply = USDC held in reserve |
| Credit issuance | on-chain StableCredit outstanding = Σ tier draws in the off-chain ledger |
| Bond coverage | redemption reserve + scheduled inflows ≥ face due in window |
| RTD | reserves ≥ target × **unsecured** exposure (not total credit) |
| Float adequacy | settlement float ≥ savings-backed drawn but not yet reconciled |
| Seniority | AssurancePool balance contains **no** bond principal |

Also run **maturity-bucket coverage**: a system can be solvent in aggregate and insolvent on timing.

---

## 6. Test requirements

- Phase 0: prove `withdrawToken` reverts for a non-role caller; prove RTD returns zero when all credit is collateralized.
- Phase 1: limit recalculates correctly as a bond accretes toward maturity; pledged collateral cannot be transferred; ascending-rate invariant holds.
- Phase 2: utilization curve; withdrawal queue under high utilization; first-loss ordering.
- Phase 3: redemption reserve cannot be withdrawn by the Safe; bond redeems at maturity even when the pool is stressed.
- Phase 4: a positive-balance holder who is not the co-op can redeem; StandingBid purchase does not touch AssurancePool.
- Adversarial: flash-loan the oracle; drain attempt on every pool; default a member with collateral and verify no lost debt is created.

---

## 7. Open questions — flag, do not decide

1. **Is CLRUSD the StableCredit ERC20 or a separate token?** Determines the whole shape. Answer before Phase 1.
2. Does the member's smart account hold CLRUSD directly, or does the co-op custody it with position tracked in contract state?
3. Does the fork already ship a network factory (`core/factories/` has `BurnerBondFactory`)?
4. StandingBid pricing — par or discount, and who sets it.
