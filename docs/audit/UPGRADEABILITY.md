# Upgradeability

This lists which contracts can be upgraded, who holds that power, and which timelock it sits behind once the handover scripts have run. Compliance spec 10e requires every upgrade that could block a member to sit behind a delay of at least 7 days, so a member can withdraw first. DECISIONS #10 sets up two timelocks; section 13 (decision 5) adds a third, for the co-op's Assurance contracts; Phase 2d (addendum 10g, decision 1) adds a fourth, Clear Financial Co.'s, for ESADepositVault and CLRUSD.

| Timelock | Code | Minimum delay | Proposer and executor | Admin | Handover script |
|---|---|---|---|---|---|
| Deed timelock | OZ `TimelockController` (`contracts/governance/Timelock.sol`) | 7 days | Foundation multisig | none | `deploy/deed_admin_handover.ts` |
| Credit timelock | same | 7 days | Ops Safe | none | `deploy/credit_timelock_handover.ts` |
| Assurance timelock | same | 7 days | co-op board Safe | none | `deploy/assurance_timelock_handover.ts` |
| Vault timelock | same | 7 days | Clear Financial Co. Safe (at least 2 signers; the script checks the threshold) | none | `deploy/vault_timelock_handover.ts` |

With no admin, a timelock's own delay can change only through a delayed proposal. `deployCreditTimelock` refuses a delay under 7 days.

No handover has been run on any network. Until it runs, each power below is held by the deployer EOA, or by whoever the deploy scripts gave it to. The Assurance timelock is different: the AssurancePool is initialized with it as governance, so the deployer never holds a pool power and there is nothing to hand over.

## Credit and savings (credit timelock)

| Contract | Proxy | Upgrade authority | Moved to the timelock by the handover | Live on |
|---|---|---|---|---|
| ClaimEscrow | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base mainnet (storage-safe) |
| ClearCredit (ledger) | UUPS | AccessManager admin (`onlyAdmin`) | AccessManager DEFAULT_ADMIN_ROLE | Base Sepolia |
| AccessManager | Transparent | ProxyAdmin owner | ProxyAdmin ownership and DEFAULT_ADMIN_ROLE | Base Sepolia |
| MembershipRegistry | Transparent | ProxyAdmin owner | ProxyAdmin ownership and DEFAULT_ADMIN_ROLE | Base Sepolia |
| RevolvingIssuer | UUPS | `owner()` | ownership | Base Sepolia |
| TermIssuer | UUPS | `owner()` | ownership | Base Sepolia |
| OffersIssuer | UUPS | `owner()` | ownership | Base Sepolia |
| RateSchedule (new) | UUPS | `owner()` | ownership; every rate change also waits 7 days | not deployed |
| NetworkRegistry | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base Sepolia |
| CollateralRegistry | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base Sepolia |
| LimitCalculator | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base Sepolia |
| Liquidator | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base Sepolia |
| MerchantRegistry | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base Sepolia |

| PayoutPool, LendingPool, BondVault | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base Sepolia |

`assertNoCreditAdmin` fails the handover if the deployer still holds any of these powers afterwards. `test/deploy/Compliance.deploy.spec.ts` runs the handover on a fresh chain. It then shows that a rate change needs a proposal and cannot execute before 7 days. `test/audit/compliance/Dfal.spec.ts` (acceptance 17) shows the same for a CLRUSD upgrade, and that a member can transfer and redeem while it is pending.


**Operational roles do not move.** These stay with their own keys: CREDIT_LINES_ROLE and CREDIT_LIMITS_ROLE, AccessManager `OPERATOR` and `STATE_ATTESTER_ROLE`. Grant them before the handover. Afterwards, granting a new one is itself a 7-day proposal. None of them can upgrade a contract or change a rate. The vault's and CLRUSD's operational roles are in the next section.

**Pricing sources are set once (Phase 4, M-B).** `RevolvingIssuer.setPricing` and `TermIssuer.setRateSchedule` refuse to point at a different RateSchedule (or a different ceiling product) once one is named, because open positions hold that schedule's accumulator snapshots. A schedule change is an upgrade of RateSchedule in place, behind the same 7-day delay.

**Phase 4b settings.** `NetworkRegistry.registerIssuer` and `deregisterIssuer` are `DEFAULT_ADMIN_ROLE`, so adding an issuer after the handover is a 7-day proposal (re-review M-E). `RevolvingIssuer.setClrusdToken` is the owner's and set once (L-B): every Savings draw calls that token's `syncEncumbrance`, so changing it is an upgrade. `DeedNFT.setValidatorReassignDelay` is the Deed timelock's, bounded to 1 to 30 days (M-F).

**Delegatecall modules.** RevolvingIssuer (RevolvingIssuerExtension, and RevolvingIssuerCycles for section 12) and TermIssuer (TermIssuerExtension, TermIssuerOrigination) call into module contracts. Each module is deployed on its own and passed to the main contract's constructor, which checks its `extensionKind()` and pins its address as an immutable. Creating them inside the constructor put TermIssuer's creation code over EIP-3860's 48 KiB limit (fixed in Phase 2b). So a module changes only when the main contract is upgraded, under the same authority and the same timelock: an upgrade deploys new modules and a new implementation that names them (`deploy/issuerModules.ts`). Nothing can point a live contract at other code on its own.

## ESADepositVault and CLRUSD (vault timelock, Clear Financial Co.)

Addendum 10g and the owner's decisions 1 to 3 (`specs/dfal-vault-send.md`). Clear Financial Co. holds the USDC reserve as trustee for CLRUSD holders, and every vault and CLRUSD power is its, under two-person control. Clear Collective LLC, Clear Lending Co., ClearLabs and the Manager hold none. Both contracts left the credit timelock in Phase 2d.

| Contract | Proxy | Upgrade authority | Moved to the vault timelock by the handover | Live on |
|---|---|---|---|---|
| ESADepositVault | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base mainnet (storage-safe, see below) |
| ClearUSDUpgradeable (CLRUSD) | UUPS | `UPGRADER_ROLE` | UPGRADER_ROLE, the CCIP admin, and DEFAULT_ADMIN_ROLE (begun by the deployer, accepted by the timelock after the token's admin delay: CLRUSD uses AccessControlDefaultAdminRules, which will not grant the default admin directly) | Base Sepolia |
| CLRUSD CCIP token pool | not a proxy | n/a | ownership (two-step: the timelock accepts). Whoever configures the pool's remote chains holds a minting power | Base Sepolia (legacy ClearUSD) |

How each power is two-person:

| Power | Holder | Two-person by |
|---|---|---|
| Upgrades, every setting (accepted token, CLRUSD address, state source, pause window, encumbrance and membership sources, CCIP admin), the pilot off switch | `DEFAULT_ADMIN_ROLE` / `UPGRADER_ROLE`: the vault timelock | the Clear Financial Safe (threshold at least 2) proposes, and 7 days pass |
| Granting or revoking any role, including the contract-held MINTER_ROLE/BURNER_ROLE (the vault, the token pool) and LIQUIDATOR_ROLE (the Liquidator) | the default admin of each contract: the vault timelock | the same |
| Vault pause, renewal, early end | `PAUSER_ROLE` keys | in contract: two distinct holders make the identical call (`_secondSigner`) |
| CA mint pause, set and clear (spec 11) | `PILOT_ROLE` keys | in contract, the same way |
| CLRUSD account (fraud) and security pauses, renewals, early ends | `FRAUD_ROLE`, `SECURITY_ROLE` keys | in contract, the same way |
| Gasless deposits, redeems, autopay runs, mandate cancels | `RELAYER_ROLE`: one hot key | not two-person, by decision 2: it only submits what a member signed |

The 10c limits still apply to every pause: 72 hours at most, and the second signer of a pause cannot renew it, or sign a new one on the same account for 30 days after it ends (Phase 4, M-A). `handOverVault` grants the operational keys, then renounces every vault and CLRUSD role the deployer holds; `assertNoVaultAdmin` checks the result. `test/deploy/Vault.deploy.spec.ts` runs it with a 2-of-3 stand-in Safe.

**Successor trustee (10g).** `successorTrusteeCalls` builds one timelock batch, proposed by the outgoing Safe, that grants the proposer, executor and canceller roles to the successor's Safe, moves any operational roles to new keys, and then revokes the outgoing Safe's roles. It contains only `grantRole` and `revokeRole`, so the reserve cannot move; the test checks the reserve and the supply are unchanged.

**The Command Safe handover** (`scripts/command/safe-handover.ts`, which moves admin to the Ops Safe) leaves ESADepositVault, CLRUSD and the token pool out (`VAULT_GOVERNED` in `scripts/command/handover.ts`).

## The co-op's Assurance contracts (Assurance timelock)

Compliance section 13. The AssurancePool belongs to Clear Collective LLC, not Clear Lending Co., and is governed apart from credit.

| Contract | Proxy | Upgrade authority | Live on |
|---|---|---|---|
| AssurancePool (section 13) | UUPS | The Assurance timelock, **and** two of the pool's signers approving the exact `upgradeTo` calldata (`approveAction`). `_authorizeUpgrade` also checks the timelock's minimum delay is still at least 7 days. | not deployed |

- **Every governed parameter** (signers, payers, Lending Co.'s draw and loss-reserve addresses, the disbursement address, `floorBps`, exposure sources, the transfer delay, the allocation, compartments, the network registry, governance itself) takes the same two gates: two distinct signers approve the calldata, then the timelock calls it after 7 days.
- **Operational two-person actions** do not wait for the timelock: the monthly floor inputs, draw approval and release, grants, transfers between compartments (14 days, or none into the Credit Backstop) and the security pause (72 hours, renewable by two signers). Each takes two distinct signers in the pool itself.
- **No role for Lending Co. or its managers.** Lending Co.'s Registered Draw Address may call `requestDraw` and nothing else. Its operating address is an allowlisted payer of fees and recoveries. Neither, nor the loss-reserve address, can be a signer.
- **Storage.** A fresh layout (33 slots, then `__gap[67]`, 100 in all). Compartment balances live in one mapping (`compartmentOf`), which an upgrade must keep where it is. The Phase 1 AssurancePool and AssuranceOracle on Base Sepolia are retired, not upgraded: an upgrade of the old proxy to this implementation would misread every slot.

## Deed track (Deed timelock)

DeedNFT, Validator, ValidatorRegistry, MetadataRenderer, FundManager, Subdivide, Fractionalize and FractionTokenFactory are all UUPS. The authority is `DEFAULT_ADMIN_ROLE` or `owner()`, according to the contract. `deed_admin_handover.ts` (audit D-13) moves all of it to the Deed timelock, and `assertNoDeployerPowers` checks the result. Phase 3 (trust agreement v5) changes these contracts; its report covers their layouts.

## Not upgradeable

- **Legacy `ClearUSD`** (live on Base). It cannot be upgraded at all, so no admin can swap its logic.
- **Also not upgradeable:** `TimelockController`, `TokenRegistry` (Ownable), `BurnerBond`/`BurnerBondDeposit`, `SavingsIntentFactory`/`SavingsIntentEscrow`, `Create2Deployer`.

## Storage safety of the live contracts

ESADepositVault and ClaimEscrow are live on Base mainnet, so their storage changes are append-only:

- **ESADepositVault:** Phase 2 adds `s_stateSource`, `s_pilotCap`, `s_pilotAlert`, `s_caVolumeByDay`, `s_caWindowTotal`, `s_caWindowFrom`, `s_pilotCapOn`, `s_pausedUntil`, `s_pauseSigner` and `s_pauseWindow`. `__gap` shrinks from 42 to 34, so the layout still ends at slot 400.
- **ESADepositVault, Phase 2d:** the pilot counter's fields (`s_pilotCap`, `s_pilotAlert`, `s_caVolumeByDay`, `s_caWindowTotal`, `s_caWindowFrom`, `s_pilotCapOn`) are retired in place, never read or written. Appended after `s_lastDepositAt`: `s_proposerOf` (one slot) and `s_pilotOff`, `s_caMintsPaused`, `s_caPauseReason` (one slot together). `__gap` shrinks from 33 to 31, so the layout still ends where it did.
- **ClaimEscrow:** unchanged by Phase 2 and Phase 2d (L-D adds a function and a type hash, no storage). Its layout still ends at slot 299.
- **ClearUSDUpgradeable, Phase 2d:** `proposerOf` and `membershipSource` are appended to the end of its ERC-7201 namespaced struct; nothing else lives after them in that namespace.

OpenZeppelin's storage upgrade report (`@openzeppelin/upgrades-core` `getStorageUpgradeReport`) finds no errors against each implementation recorded in `.openzeppelin/base.json`: the vault at 0xe626…3644 and 0x83CB…26e9, and ClaimEscrow at 0x96F0…2c4e. A slot-by-slot comparison agrees: no existing variable moved. Re-run for Phase 2d with the same result.

The credit contracts exist only on Base Sepolia, where FIX-PLAN allows layout breaks; mainnet gets a fresh deployment of them. PHASE-2-REPORT.md lists the breaks.

**Phase 2c (section 13), Base Sepolia only, append-only:** the slots that held the old pool's address and its loans are renamed in place and never read (`@custom:oz-renamed-from`): ClearCredit slot 253 (`assurancePool` → `retiredAssurancePool`), PayoutPool slots 271 and 273 (`reserve`, `borrowedFromReserve`), BondVault slots 261 and 264 (`assurancePool`, `owedToReserve`). ClearCredit appends `reserveToken` and `lenderOperating` (it has no gap; ClearCredit adds no storage). NetworkRegistry appends `moneyPathKindOf` and its `__gap` shrinks from 44 to 43, so its layout still ends at slot 300. A loan the old pool made to the payout pool or the bond vault is no longer counted or repaid; the old pool is retired with its books.

**PayoutPool (Phase 2B, addendum 12.10).** Base Sepolia only, but still append-only: the old `nextUnpaid` slot is renamed `legacyNext` in place (`@custom:oz-renamed-from`), four variables for the deadline-ordered queues follow `borrowedFromVault`, and `__gap` shrinks from 25 to 21. Claims queued before an upgrade are paid from a legacy queue in their original order, so no migration call is needed. The authority is unchanged (`DEFAULT_ADMIN_ROLE`, moved to the credit timelock). See `PHASE-2B-PAYOUT-RESERVE.md`.
