# ADDENDUM — section 13: Assurance Contracts (co-op-wide AssurancePool)

Verbatim from the owner. Treat each item as a REQUIREMENT. Every value is a governed parameter with a timelock unless stated. If anything conflicts with an audit finding or sections 1–12, stop and list the conflict.

The owner's decisions on how to build it (2026-11-13) are at the end of `../PHASE-2B-PROGRESS.md` and are binding. Phase 2c's report is `../PHASE-2C-REPORT.md`.

## Context

The AssurancePool is owned by Clear Collective LLC (the co-op), not Clear Lending Co. It has segregated compartments: CREDIT_BACKSTOP (absorbs Clear Lending Co.'s charged-off principal under the I-11 agreement) and MEMBER_ASSURANCE (funds member Assurance protections). It replaces any earlier design where the AssurancePool was Clear Lending's own reserve or where Assurance had a separate reserve. Unchanged invariants: no redemption, payout or force-settlement path touches it; bond principal never enters it.

## 13a. Roles and two-person control

- Every admin, parameter, upgrade, release and transfer action needs two distinct signers: one proposes, a different one approves. The same address can never do both. Test every function.
- Clear Lending Co., Clear Capital Management LLC and Clear Capital Holdings hold no role. Lending Co.'s Registered Draw Address can call requestDraw and nothing else, and cannot release funds.

## 13b. Compartments

- At least two compartments with their own balances: CREDIT_BACKSTOP and MEMBER_ASSURANCE (separate vaults, or one contract with a per-compartment ledger and no shared spendable balance).
- Invariant: sum of compartment balances == assets held. Nothing moves value between compartments except executeTransfer (13f).
- addCompartment (governance + timelock) creates a compartment at 0% allocation; none can rank ahead of the Credit Backstop floor; CREDIT_BACKSTOP and MEMBER_ASSURANCE cannot be removed.
- Assets: USDC only unless governance adds another liquid asset. No lending, staking, DeFi, external approvals or use as collateral.

## 13c. Inflows and allocation

- One entry point deposit(sourceTag, amount); sourceTag ∈ {CREDIT_ENHANCEMENT_FEE, RECOVERY, INTERCHANGE, BOARD_ALLOCATION}; only from allowlisted payers (Lending Co.'s operating address for fees and recoveries; the co-op treasury for the rest).
- deposit reverts if the caller or source is CLRUSD, ESADepositVault, the pledge module, any credit issuer, LendingPool/yield pool, BondVault or PayoutPool (read from NetworkRegistry). None of those contracts may contain any call path into the Assurance contracts.
- RECOVERY goes 100% to CREDIT_BACKSTOP.
- Every other inflow fills CREDIT_BACKSTOP until backstopBalance() >= backstopFloor(); the remainder splits by annualAllocationBps[] (sum 10,000; initial 5,000 / 5,000).
- Allocation is set per program year; a mid-year change that lowers the Credit Backstop share reverts.

## 13d. Floor and coverage

- backstopFloor() = max(timingBufferShortfall, floorBps × coveredBookPrincipal / 10,000); floorBps initial 500.
- coveredBookPrincipal = unsecured exposure read from the issuers (income-backed, Clear Boost, term plans), or the monthly attested figure if higher.
- timingBufferShortfall and coverageCap (12 months of expected credit loss on the covered book) are set monthly by a two-person action with an evidence hash and an event.
- backstopBalance() = CREDIT_BACKSTOP assets − approved unpaid draws. availableCoverage() = min(backstopBalance(), coverageCap).
- With no unsecured credit live, backstopFloor() = 0, so the Phase 0 test (reserves needed = 0) still holds.

## 13e. Draws and Assurance payments

- requestDraw(periodId, amount, evidenceHash): Registered Draw Address only, one per period, emits DrawRequested.
- approveDraw(drawId, approvedAmount) by signer A, then releaseDraw(drawId) by a different signer B; paid only to Lending Co.'s registered loss-reserve address; released in request order; reverts above availableCoverage() at release. Disputed remainders stay in CREDIT_BACKSTOP. Draws come only from CREDIT_BACKSTOP.
- releaseAssurance(grantId, amount, evidenceHash): two signers, from MEMBER_ASSURANCE only, only to the co-op's registered Assurance disbursement address; reverts if MEMBER_ASSURANCE is short and never falls back to another compartment.

## 13f. Transfers between compartments

- proposeTransfer(from, to, amount, resolutionHash), then executeTransfer by a different signer after at least 14 days.
- From CREDIT_BACKSTOP, execution reverts unless backstopBalance() − amount >= backstopFloor() + pendingDrawRequests at execution.
- Transfers into CREDIT_BACKSTOP need two signers and no delay.

## 13g. Prohibited

- No sweep, rescue, withdraw or admin-transfer function other than releaseDraw, releaseAssurance and executeTransfer.
- No path from any redemption, withdrawal, exit settlement, payout, refund, netting, liquidation or force settlement into or out of any compartment.
- A security pause may only block outflows and transfers; two signers; expires after 72 hours unless a second signer renews it.
- Upgrades through a timelock of at least 7 days; storage must preserve every compartment balance.
- Events: CompartmentCredited(sourceTag, compartment, amount), FloorInputsSet, AllocationSet, DrawRequested, DrawApproved, DrawReleased, AssuranceReleased, TransferProposed, TransferExecuted. No member data on-chain.

## Acceptance tests (add)

31. Floor first: covered book $100,000 (floor $5,000), Credit Backstop $3,000, allocation 50/50. A $4,000 INTERCHANGE deposit credits $2,000 to Credit Backstop, then $1,000 to each compartment. A RECOVERY deposit goes 100% to Credit Backstop. With no unsecured credit live, backstopFloor() = 0 and deposits split 50/50. A mid-year change lowering the Credit Backstop share reverts.
32. Walls and draws: with Member Assurance $500 and Credit Backstop $50,000, releaseAssurance of $600 reverts. executeTransfer from Credit Backstop below floor + pending draws reverts; by the proposer reverts; before 14 days reverts; a compliant one succeeds. A draw above availableCoverage() reverts. releaseDraw by the approver reverts. No function pays a draw from Member Assurance or to any other address. Sum of compartments == assets after every call in a fuzz run.
33. No path in or out: fuzz every function of CLRUSD, ESADepositVault, the pledge module, every issuer (including liquidation and force settlement), LendingPool, BondVault and PayoutPool — every compartment balance is unchanged; deposit from any of them reverts; every Lending Co. and Manager role calling anything but requestDraw reverts.
