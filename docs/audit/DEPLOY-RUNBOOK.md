# Deployment and upgrade runbook

This is the order in which the audit's contract changes reach Base Sepolia and then Base mainnet: what is upgraded in place, what is deployed new or replaced, why, which script does it, and what has to be wired, signed and waited for. It covers every phase merged into `audit/phase-2f-integration` (Phases 1, 2, 2b to 2g, 3, 4, 4b, 4c and 2f).

Nothing in this file has been run. No contract has been deployed, no key used, and no network touched. None of the audit's contract changes is on any chain yet: Base Sepolia runs the pre-audit contracts (`deployments/base-sepolia/`, `.openzeppelin/base-sepolia.json`), and Base mainnet runs `ClearUSD`, `ESADepositVault`, `ClaimEscrow` and `Create2Deployer` only (`deployments/base/`, `.openzeppelin/base.json`).

Where something is not in the repository (an address, a Safe, who holds a key, a figure), this file says **owner to confirm**.

**Report names are shortened in the tables:**

| Short | File |
|---|---|
| P1, P2, P2b, P2c, P2d, P2e, P2g, P3 | [`PHASE-1-REPORT.md`](./PHASE-1-REPORT.md), [`PHASE-2-REPORT.md`](./PHASE-2-REPORT.md), [`PHASE-2B-REPORT.md`](./PHASE-2B-REPORT.md) (with [`PHASE-2B-PAYOUT-RESERVE.md`](./PHASE-2B-PAYOUT-RESERVE.md) and [`PHASE-2B-LIQUIDATOR.md`](./PHASE-2B-LIQUIDATOR.md)), [`PHASE-2C-REPORT.md`](./PHASE-2C-REPORT.md), [`PHASE-2D-REPORT.md`](./PHASE-2D-REPORT.md), [`PHASE-2E-REPORT.md`](./PHASE-2E-REPORT.md), [`PHASE-2G-REPORT.md`](./PHASE-2G-REPORT.md), [`PHASE-3-REPORT.md`](./PHASE-3-REPORT.md) |
| P4, P4b, P4c | [`REREVIEW.md`](./REREVIEW.md), [`PHASE-4B-REPORT.md`](./PHASE-4B-REPORT.md), [`PHASE-4C-REPORT.md`](./PHASE-4C-REPORT.md) |
| 2f-YP, 2f-EC, 2f-PC, 2f-ENF, 2f-B, 2f-INT | [`PHASE-2F-YIELD-POOL.md`](./PHASE-2F-YIELD-POOL.md), [`PHASE-2F-EARN-CONTROLS.md`](./PHASE-2F-EARN-CONTROLS.md), [`PHASE-2F-POOL-CONFORMANCE.md`](./PHASE-2F-POOL-CONFORMANCE.md), [`PHASE-2F-ENFORCEMENT.md`](./PHASE-2F-ENFORCEMENT.md), [`PHASE-2F-BONDS.md`](./PHASE-2F-BONDS.md), [`PHASE-2F-INTEGRATION.md`](./PHASE-2F-INTEGRATION.md) |
| UPG, DEC, FIX | [`UPGRADEABILITY.md`](./UPGRADEABILITY.md), [`specs/phase-2f-plan-decisions.md`](./specs/phase-2f-plan-decisions.md), [`FIX-PLAN.md`](./FIX-PLAN.md) |

**What "storage confirmed" means here.** OpenZeppelin's `getStorageUpgradeReport` found the current layout compatible with the implementation(s) recorded for that contract in the network's `.openzeppelin/*.json`. The manifests do not say which recorded implementation each proxy runs today, so every check is against all of them. The scripts are [`scripts/storage_report.ts`](../../scripts/storage_report.ts) (any contract, by name; `STORAGE_MANIFEST=base` or `base-sepolia`), [`scripts/storage_report_lending_pool.ts`](../../scripts/storage_report_lending_pool.ts) and [`scripts/storage_report_bond_vault.ts`](../../scripts/storage_report_bond_vault.ts). All three are read-only and need no key or network.

**Rechecked for this runbook** on 2026-11-15 at `fbf55292`, with a local compile and no network: every result in the tables below was reproduced. For five contracts no earlier report had run the check against the Sepolia manifest (AccessManager, StableCredit for ClearCredit, LimitCalculator, OffersIssuer and DeedNFT); those results are marked "(this runbook)". ClearUSDUpgradeable was also rechecked directly, because `storage_report.ts` cannot match a layout that lives entirely in an ERC-7201 namespace.

## 1. Summary

### 1.1 Base Sepolia

| Contract | Action | Why | Storage evidence | Script or call |
|---|---|---|---|---|
| ESADepositVault (`0x8364…413b`, the current vault) | Upgrade in place | Fixes from P1 (H-3, M-5), P2 (10c), P2b (`s_lastDepositAt`), P4 (M-A), P2d (two-person pauses, CA mint pause, L-E, holder-only redemption) and P2g (30-day cap, legal basis, pause clocks) | Compatible with all four Sepolia implementations: P2d §6, P2g part B §3, 2f-ENF §2; `storage_report.ts` | No correct script exists for this proxy (section 5.2, items 1 and 2). The call: `upgradeToAndCall(impl, setAcceptedToken(USDC, true))` from `DEFAULT_ADMIN_ROLE`; the accepted-token slot is new and starts at zero (contract note above `s_acceptedToken`) |
| ESADepositVaultLegacy (`0x7bA8…40cD`) | Unchanged | Still holds the USDC behind the old CLRUSD (`apps/member/src/lib/clearNetwork.ts`). Renounce its `OPERATOR_ROLE` (`scripts/command/ops-roles.map.json`) | n/a | Retire once its old CLRUSD is redeemed (owner to confirm) |
| ClearUSDUpgradeable (`0x2a11…D6D1`) | Upgrade in place | P1 (M-3), P2 (10c, 10d), P2d (members only, intent factory), P2g (pause cap, de-listing) | Compatible with `0xB1beB71b…`: P2g part B §3. `storage_report.ts` cannot match it (its layout is all ERC-7201 namespace); rechecked directly (this runbook) | [`deploy/upgrade/upgradeContract.ts`](../../deploy/upgrade/upgradeContract.ts) (`CONTRACT_NAME=ClearUSDUpgradeable`), by the `UPGRADER_ROLE` holder |
| ClearUSD (legacy, `0x5619…0Ae3`) | Unchanged | Not upgradeable. Already replaced on Sepolia by the pair above | n/a | Retire once drained |
| ClaimEscrow | Upgrade in place | P1 H-4 (claim keys), P2d L-D (signed treasury payout) | Compatible: P2d §6, P2g part B §3; `storage_report.ts` | `deploy/upgrade/upgradeContract.ts` (`CONTRACT_NAME=ClaimEscrow`) |
| SavingsIntentFactory | Redeploy-replace | Not upgradeable (UPG "Not upgradeable"). P1 H-4 (salt commits to the config) and P2d (`isIntentEscrow`) need a new factory | n/a (no proxy) | [`deploy/19_deploy_SavingsIntentFactory.ts`](../../deploy/19_deploy_SavingsIntentFactory.ts); then CLRUSD `setIntentFactory` (deploy 25) |
| CLRUSDTokenPool | Unchanged | Not built in this repo (P2d §3 item 6). Its ownership moves to the vault timelock | n/a | [`deploy/vault_timelock_handover.ts`](../../deploy/vault_timelock_handover.ts) |
| MembershipRegistry | Unchanged | No source change since `7eb5976` | Compatible: P2g part B §3 | n/a |
| AccessManager (transparent) | Upgrade in place | P1 H-4: credit powers split per function; the issuers now call `hasCreditRole` | Compatible with `0xAD10…` (this runbook); P1 §6 slot comparison | `deploy/upgrade/upgradeContract.ts`, by the ProxyAdmin owner |
| ClearCredit (ledger) | Upgrade in place | P1 (C-1, H-1, X-1 to X-20, L-2), P2c (reserve token, Lending Co. operating address), P4c item 9 | Compatible with all five StableCredit implementations (this runbook); P2c §6 slot comparison | Upgrade with the `ClearCredit` factory, never `StableCredit` (`scripts/upgrade_refund_reversal.ts` header). No current audit script: `deploy/upgrade/upgradeContract.ts` (`CONTRACT_NAME=ClearCredit`) |
| NetworkRegistry | Upgrade in place | P2 (state gate), P2c (money paths), P4b M-E | Compatible: P2e §6; `storage_report.ts` | `deploy/upgrade/upgradeContract.ts` |
| MerchantRegistry | Upgrade in place | P1, P2 (discounts, `freeSplitMax`) | Compatible ×2: P2e §6; `storage_report.ts` | `deploy/upgrade/upgradeContract.ts` |
| LimitCalculator | Upgrade in place | P1, P2e (stored advance rates) | Compatible ×2 (this runbook) | [`scripts/upgrade_limit_calculator.ts`](../../scripts/upgrade_limit_calculator.ts) |
| CollateralRegistry | Upgrade in place | P2e, P4b L-I (signed pledges), 2f-ENF (enforcement source, §5.3), 2f-INT (legal holds) | Compatible ×2: 2f-ENF §2, 2f-INT §3; `storage_report.ts` | [`scripts/upgrade_collateral_registry_rolls.ts`](../../scripts/upgrade_collateral_registry_rolls.ts) (validates, then upgrades to the current source, or prints a `prepareUpgrade` when the signer is not admin) |
| RevolvingIssuer | Upgrade in place, with four new modules | P1, P2, P2b, P2e, P2g, P4b, 2f-INT (decision 37) | 5 of 6 compatible. The sixth (`0x0D0A…8784`) flags slot 91 (`cycleLength` → `isCardSettler`), a deletion made before the audit: P2e §6, P2g A3, 2f-INT §3; `storage_report.ts` | [`scripts/upgrade_revolving_issuer.ts`](../../scripts/upgrade_revolving_issuer.ts) (`issuerProxyOptions`, `unsafeSkipStorageCheck` for that slot; run the storage report first) |
| TermIssuer | Upgrade in place, with two new modules | P1, P2, P2e, P2d (`collectForMember` retired), P2g | Compatible ×6: P2d §6, P2e §6, P2g A3; `storage_report.ts` | No current script: the `upgrade_term_*` scripts end by asserting their own pre-audit features (section 5.2, item 7). The call: `upgradeProxy(term, TermIssuer, issuerProxyOptions("TermIssuer"))` |
| OffersIssuer | Upgrade in place | P1, P2c | Compatible ×2 (this runbook) | [`scripts/upgrade_offers_owner.ts`](../../scripts/upgrade_offers_owner.ts) (also gives ownership to the Safe) or `deploy/upgrade/upgradeContract.ts` |
| RevolvingIssuerV1 | Retire | Superseded before the audit (root `README.md`) | n/a | n/a |
| PayoutPool | Upgrade in place | P1, P2b (deadline queues), P2c | Compatible ×6: P2b-payout "Numbers"; `storage_report.ts` | `deploy/upgrade/upgradeContract.ts`. Afterwards switch the vault and pool legs off once repaid (DEC 3, 17) |
| Liquidator | Upgrade in place | P2b, P2e, P2g, P4b, 2f-ENF (split, PoolShareEnforcer), 2f-INT (pledge module) | Compatible ×2: 2f-ENF §2, 2f-INT §3 and part two §5; `storage_report.ts` | The call: `upgradeProxy(liquidator, Liquidator, { kind: "uups" })`; its constructor creates `LiquidatorEnforcement` (2f-INT part two §4). `deploy/upgrade/upgradeContract.ts` fits. Not `upgrade_liquidator_savings.ts` (section 5.2, item 6) |
| LendingPool, which becomes the Yield Pool | Upgrade in place (DEC 16) | 2f-YP, 2f-PC, 2f-ENF, 2f-INT | Compatible with both implementations: 2f-YP §6, 2f-PC §2, 2f-INT §1; `storage_report_lending_pool.ts`; rehearsal `test/earn/YieldPoolUpgrade.spec.ts` | No script. The call: deploy `YieldPoolLedger`, then `YieldPoolValuation(ledger)`, then the implementation (`poolProxyOptions()`), then `upgradeToAndCall(impl, initializeYieldPool(EarnControls, CLEAR_LENDING_ACCOUNT, initialClosing))` (2f-YP §1, 2f-INT §7) |
| BondVault | Upgrade in place | P1 (X-10, M-8), P2c, P2e, 2f-B (reserve schedule, Agent, rolls) | Compatible ×3 plus the pre-stage-2 source: 2f-B §2; `storage_report_bond_vault.ts`; rehearsal `test/earn/BondVaultUpgrade.spec.ts` | [`scripts/upgrade_bond_vault_pledge_guard.ts`](../../scripts/upgrade_bond_vault_pledge_guard.ts) upgrades BondVault to the current source and sets the encumbrance source. Only after the pre-2f bonds are unwound |
| BurnerBondFactory, BurnerBond collection, BondValuer (current, pre-2f) | Redeploy-replace | A collection is a clone with no proxy (UPG "Not upgradeable"). The pre-2f collection cannot record into or settle through the upgraded BondVault (2f-B §3 item 22). The valuer reads one collection | n/a | [`deploy/22_deploy_BondsAndPool.ts`](../../deploy/22_deploy_BondsAndPool.ts) with `REPLACE_BOND_FACTORY=1` (keeps the old records as `*Pre2f`), then [`deploy/23_deploy_BondCollection.ts`](../../deploy/23_deploy_BondCollection.ts) with `FIRST_BOND_ID` |
| BurnerBondDeposit (pre-2f) and the `*Legacy` bond records | Retire | The discount-curve deposit path does not serve the new collection (DEC 8; 2f-B §6) | n/a | Unwind first (step B1) |
| AssurancePool and AssuranceOracle (Phase 1) | Retire, and a new AssurancePool | A new layout; an upgrade of the old proxy would misread every slot (UPG "Assurance"; P2c). The report flags every old implementation incompatible | `storage_report.ts`: incompatible ×4, as expected (P2e §6) | [`deploy/08_deploy_AssurancePool.ts`](../../deploy/08_deploy_AssurancePool.ts) (records `AssurancePoolV2` and `AssuranceTimelock`) |
| RateSchedule, PauseClock, PoolShareEnforcer | New | P2 (rates), P2g (pause clock), 2f-ENF (C5) | n/a | [`deploy/25_wire_Compliance.ts`](../../deploy/25_wire_Compliance.ts) |
| EarnTimelock, EarnControls (+ EarnControlsAdmin), CollateralAgent | New | DEC 1, 2, 18 | n/a | [`deploy/26_deploy_EarnControls.ts`](../../deploy/26_deploy_EarnControls.ts) |
| HolderDirections | New | DEC 30 | n/a | deploy 23 |
| Deed track: ValidatorRegistry, MetadataRenderer, Validator, DeedNFT (+ two extensions), FundManager, Subdivide, FractionTokenFactory, Fractionalize | Redeploy-replace (recommended) | P1 §5 item 6 and P3 §6 recommend a fresh deployment: deeds minted before v5 have no per-token key sets and no trust record. DeedNFT alone is layout-compatible (this runbook); the others are not in the Sepolia manifest, and DeedNFT now takes its two extensions as constructor arguments, which `scripts/upgrade_deednft_reserved_traits.ts` does not pass | DeedNFT compatible with `0xAFab…` (this runbook); the rest: P3 §6 slot comparison only | [`deploy/deploy_all.ts`](../../deploy/deploy_all.ts) (also deploys the Deed timelock, FunctionalContractRegistry and CoopTransferAgent) |
| TokenRegistry, Create2Deployer | Unchanged | No audit change | n/a | n/a |
| Credit, vault and Earn timelocks | New | DECISIONS #10, P2d decision 1, DEC 2 | n/a | `deploy/credit_timelock_handover.ts`, `deploy/vault_timelock_handover.ts`, `deploy/earn_timelock_handover.ts` |
| LegacyContactModule | Not deployed | No deploy script by decision 13 (P2g part B §1.4) | n/a | n/a |

**About the credit core.** The table upgrades the credit contracts in place, as 2f-INT §7 and part two §4 lay out and as DEC 16 requires for LendingPool. Two earlier reports recommend a fresh credit deployment on Sepolia instead: P1 §5 item 8 (state from before the fixes: plans opened without signatures, open plans missing from the new index) and P4 §6 with BLIND-REVIEW I-1 (legacy RevolvingIssuer tiers and TermIssuer plans have zero accrual snapshots, so the first touch can charge decades of carry; P4 §2 notes the M-B change limits this for schedule-priced revolving tiers to one interval charged at nothing). Their answers are "redeploy, or migrate the snapshots first", and no migration script exists. On a testnet the owner may also accept the hazard. A fresh credit core would replace ClearCredit, NetworkRegistry, CollateralRegistry, LimitCalculator, RevolvingIssuer, TermIssuer and OffersIssuer, and PayoutPool and the Liquidator with them, since both are initialized with the ledger (deploy 22). **Owner to decide** before step C1.

### 1.2 Base mainnet

| Contract | Action | Why | Storage evidence | Script or call |
|---|---|---|---|---|
| ESADepositVault (`0x0CfE…a1C1`) | Upgrade in place | The live implementation predates every audit fix: its ABI has `OPERATOR_ROLE` and no `setClrusd`, `RELAYER_ROLE` or mandates (`deployments/base/ESADepositVault.json`). Section 3.1 | Compatible with both implementations (`0xe626…3644`, `0x83CB…26e9`): P1 §6, P2 §8, P2b §5, P2d §6, P2e §6, P2g part B §3, P4 §7, 2f-ENF §2, 2f-INT part two §5; `storage_report.ts` with `STORAGE_MANIFEST=base`; [`scripts/migrate_vault_clrusd.ts`](../../scripts/migrate_vault_clrusd.ts) re-runs `validateUpgrade` | `scripts/migrate_vault_clrusd.ts` phase 1 (a Safe batch: `upgradeToAndCall(VAULT_IMPL, setAcceptedToken(USDC, true))`, grant `RELAYER_ROLE`, revoke `OPERATOR_ROLE`). Never `scripts/upgrade_vault.ts` (section 5.2, item 1) |
| ClaimEscrow (`0xb30E…5096`) | Upgrade in place | The live implementation still has the open `claimToWallet` (`deployments/base/ClaimEscrow.json`). Section 3.1 | Compatible with `0x96F0…2c4e`: P1 §6, P2d §6, P2g part B §3, 2f-INT part two §5; `storage_report.ts` with `STORAGE_MANIFEST=base` | `deploy/upgrade/upgradeContract.ts`, or `prepareUpgrade` and an `upgradeTo` from the admin |
| ClearUSD (legacy, `0xa7a2…6583`) | Retire, replaced by ClearUSDUpgradeable (M-7) | Not upgradeable: no lock and no `seize`, so savings-backed credit is unsecured on it (AUDIT-REPORT M-7) | n/a | Section 3.5 |
| ClearUSDUpgradeable | New (the replacement token) | AUDIT-REPORT M-7 | n/a (fresh) | [`deploy/21_deploy_ClearUSDUpgradeable.ts`](../../deploy/21_deploy_ClearUSDUpgradeable.ts) |
| SavingsIntentFactory | New | No Base record exists. If one is live off record, it is not upgradeable: retire it (owner to confirm) | n/a | deploy 19 |
| Create2Deployer | Unchanged | | n/a | n/a |
| The credit stack, Earn, the AssurancePool, PauseClock, PoolShareEnforcer, the timelocks | New | FIX §2 rule 4: the credit contracts exist only on Base Sepolia, and mainnet gets a fresh deployment of them (AUDIT-REPORT M-7 for the CLRUSD dependency) | n/a (fresh) | Section 3.5 |
| The Deed track | New, later | Nothing of it is on Base (P4b §4). Gated (section 3.6) | n/a | `deploy/deploy_all.ts` |

### 1.3 Counts

| | Base Sepolia (the plan in 1.1) | Base mainnet |
|---|---|---|
| Upgrade in place | 16: ESADepositVault, ClearUSDUpgradeable, ClaimEscrow, AccessManager, ClearCredit, NetworkRegistry, MerchantRegistry, LimitCalculator, CollateralRegistry, RevolvingIssuer, TermIssuer, OffersIssuer, PayoutPool, Liquidator, LendingPool, BondVault | 2: ESADepositVault, ClaimEscrow |
| Redeploy-replace | 13: SavingsIntentFactory; AssurancePool; the bond factory, collection and valuer; the eight Deed contracts (recommended, not forced) | 1: ClearUSD → ClearUSDUpgradeable (plus SavingsIntentFactory only if one is live off record) |
| New, with no predecessor | 13: RateSchedule, PauseClock, PoolShareEnforcer, EarnControls, CollateralAgent, HolderDirections, FunctionalContractRegistry, CoopTransferAgent and five timelocks. Plus the modules deployed with their parents | Everything else in sections 1.2 and 3.5 |
| Unchanged | MembershipRegistry, TokenRegistry, CLRUSDTokenPool, Create2Deployer, ESADepositVaultLegacy, legacy ClearUSD | Create2Deployer |

### 1.4 Every redeploy, and why

| Contract | Network | Why it cannot be an upgrade |
|---|---|---|
| SavingsIntentFactory (and its escrows) | Both | Not upgradeable. The H-4 salt and the P2d redeem-escrow record exist only in new code (UPG "Storage safety", SavingsIntentFactory) |
| BurnerBond collection and BurnerBondFactory | Sepolia | A collection is a clone of an implementation the factory holds, with no proxy. And the upgraded BondVault's settlement and purchase signatures changed, so the pre-2f collection and BurnerBondDeposit can neither record into it nor settle through it (2f-B §3 item 22). A new factory clones the new collection |
| BondValuer | Sepolia | It reads one collection's values; deploy 23 deploys a new one when the recorded valuer values another collection (2f-INT part two §4) |
| AssurancePool | Sepolia | A fresh layout (section 13); upgrading the old proxy would misread every slot (UPG; P2c §6). Storage report: incompatible |
| Deed track | Sepolia | Recommended, not forced: pre-v5 deeds lack trust records and per-token key sets (P1 §5 item 6; P3 §6). Only DeedNFT is in the manifest |
| ClearUSD → ClearUSDUpgradeable | Mainnet (done on Sepolia already) | Legacy ClearUSD has no proxy (UPG "Not upgradeable"). The vault can switch tokens only after the old supply reaches zero (`setClrusd`) |
| Credit core (optional) | Sepolia | Storage is compatible, so this is a choice, not a necessity: P1 §5 item 8 and P4 §6 / I-1 recommend it (section 1.1, "About the credit core") |

Storage breaks were allowed on Sepolia (FIX §2 rule 4), but no audit phase used that allowance: every Sepolia proxy that is kept passes the report, apart from RevolvingIssuer's pre-audit slot 91 and the retired AssurancePool.

## 2. Base Sepolia, in order

UPG says no handover has run on any network, so on Sepolia the deployer EOA should hold every admin power today. The steps below assume that, and send from the deployer until section I. Step A1 confirms it.

### 2.1 Signers and keys to line up

Two-person means two different addresses, each making the identical call or one proposing and another approving. "Resolution" means the Lending Board resolution hash that `grantRoleByResolution` requires (2f-EC §1, `EARN_RESOLUTION`). Every address here is owner to confirm.

| Who | Where | How many | Source |
|---|---|---|---|
| Ops Safe | Credit timelock proposer and executor | 1 Safe | UPG; `credit_timelock_handover.ts` (`OPS_SAFE`) |
| Clear Financial Co. Safe | Vault timelock | 1 Safe, threshold at least 2 (the script checks) | P2d decision 1 (`CLEAR_FINANCIAL_SAFE`) |
| Clear Lending Co. Safe | Earn timelock | 1 Safe, threshold at least 2 (the script checks) | DEC 2 (`CLEAR_LENDING_SAFE`) |
| Co-op board Safe and pool signers | Assurance timelock; `approveAction` | Safe, plus at least 2 signers | P2c (`BOARD_SAFE`, `ASSURANCE_SIGNERS`) |
| Foundation Safe | Deed timelock | 1 Safe | P3 (`FOUNDATION_SAFE`) |
| Agent Key; treasury signers | CollateralAgent | 1 key; at least 2 distinct `TREASURY_ROLE` addresses | DEC 18; 2f-EC §1 (`AGENT_KEY`, `TREASURY_SIGNERS`) |
| Relayer | Vault `RELAYER_ROLE`; ClaimEscrow `SETTLER_ROLE`; SavingsIntentFactory roles | 1 hot key (by design) | P2d decision 2 |
| Pausers; CA-mint pausers | Vault `PAUSER_ROLE`; `PILOT_ROLE` | At least 2 each | P2d decision 2 |
| Fraud, security, listing keys | CLRUSD `FRAUD_ROLE`, `SECURITY_ROLE`, `LISTING_ROLE` | At least 2 each | P2d; P2g part B §5 |
| Credit operators | AccessManager `CREDIT_LINES_ROLE`, `CREDIT_LIMITS_ROLE`, `OPERATOR` | as needed | UPG "Operational roles" |
| Credit settings | `CREDIT_SETTINGS_ROLE` | At least 2 (the fee recipient needs two) | P2e §1 12.16; deploy 25 |
| Credit attesters | `CREDIT_ATTESTER_ROLE` | At least 2 (cure notices, Income Assurance, line closing) | P2e; P2g A6 item 7; 2f-INT §6 |
| State attester | NetworkRegistry `STATE_ATTESTER_ROLE` | 1 | P2 (`STATE_ATTESTER_KEY`) |
| Liquidation Hold | Liquidator `HOLD_ROLE` | At least 2 | P2b-liquidator "Not done here" |
| Yield Pool | `DEPLOYER_ROLE` ×2; `VALUATION_ROLE` ×2, deliberately not the Deployment signers; `SUSPENSION_ROLE`, `CCO_ROLE`, `TREASURER_ROLE` (two different people, one of them the CCO or treasurer) | as listed | 2f-YP §9; 2f-PC §3 item 6; 2f-INT §2 |
| EarnControls, by resolution | `ATTESTER_ROLE` (the app's key, plus two for households), `PAUSE_ROLE` ×2, `SUCCESSOR_ROLE` ×2, `ELIGIBILITY_ROLE` ×2, `LADDER_ROLE` ×2, `FUNDING_ROLE` ×2, `WIND_DOWN_ROLE` ×2, `ROLL_NOTICE_ROLE`, `EXCLUDED_HOLDER_ROLE` (Clear's insiders), `BOND_ROLE` (the collection) | as listed | 2f-EC §4; 2f-B §6; 2f-PC §5 |
| Deed operators | `DEED_MINTER`, `DEED_VALIDATOR_SIGNER`; freezing a deed takes two validator signers | | P3; P4c item 4 |

### 2.2 Steps

Each step names its script and the variables it reads. Run a script without its confirmation variable (or with its dry-run flag) first where it has one.

**A. Before anything is sent (read-only)**

1. **Survey who holds what.** `scripts/command/safe-handover.ts` and `scripts/command/ops-roles.ts` without `MODE=run` report which roles the deployer, the Safe and the job wallets hold on every Sepolia record, and send nothing (`docs/operators/deploying-contracts.md`, "Handing over the keys"). For anyone else, read the `RoleGranted` and `RoleRevoked` events. Confirm the deployer holds `DEFAULT_ADMIN_ROLE`, `owner()`, `UPGRADER_ROLE` and the ProxyAdmin wherever the steps below need them.
2. **Storage reports.** `npx hardhat compile`, then `STORAGE_CONTRACTS=ESADepositVault,ClaimEscrow,AccessManager,StableCredit,NetworkRegistry,RevolvingIssuer,TermIssuer,OffersIssuer,CollateralRegistry,LimitCalculator,MerchantRegistry,PayoutPool,Liquidator npx hardhat run scripts/storage_report.ts`, `scripts/storage_report_lending_pool.ts` and `scripts/storage_report_bond_vault.ts`. Expect only RevolvingIssuer's slot 91 (section 1.1).
3. **Fork rehearsal.** P4 §6 asks for one before any Sepolia upgrade, read-only, with `FORK_RPC_URL`. It should cover the vault upgrade and the I-1 hazard on the issuers. Nothing has rehearsed it yet.
4. **Decide the credit core** (section 1.1): upgrade in place or replace.
5. **Fill the config.** `deploy/config/earn-controls.json`: `fundingLimitDollars` with `fundingResolution`, and `poolCapacityDollars`. All three are 0 or zero-hash, and a limit of 0 refuses every subscription (2f-EC §3 item 4, §4). deploy 26 reads them at initialization. Also the Ladder (the file holds IV-01 Schedule 2's illustration; the Lending Board sets it), `credit-terms.json` `defaultExcludedPayers` (empty), and the rate and credit figures pending counsel (P2b §3b).

**B. Prerequisites on chain**

1. **Unwind every pre-2f bond, before the BondVault upgrade** (2f-B §3 item 22 and §6; 2f-INT part two §4). [`scripts/unwind_legacy_bonds.ts`](../../scripts/unwind_legacy_bonds.ts) (`HOLDER`, optional `IDS`, `TOP_UP`) closes a holder's bonds at present value, at the holder's request, through the owner's `seizeBond` and `redeemEarly`. It reads only the `BurnerBondLegacy` record. The current collection (`BurnerBond`, which becomes `BurnerBondPre2f`) is pre-2f too and needs the same treatment; the script does not reach it (section 5.2, item 3). Rehearse on a fork first, as the script allows.
2. **Record `FIRST_BOND_ID`:** above every id either older collection issued (deploy 23 refuses to continue without it).
3. **Loans between the pools.** Read `PayoutPool.borrowedFromVault()` and `borrowedFromYield()`. Deploy 22 switches the vault leg off only at zero (DEC 3). The pool's legacy borrowings become the Yield Pool's opening Deployed Balance, owed by Clear Lending (2f-YP §7 item 5).
4. **No pause in force** on the vault or CLRUSD: pauses from before Phase 2g have no recorded chain (P2g part B §4.1 item 4).

**C. Savings rails**

1. **ESADepositVault** (`0x8364…413b`, the record `ESADepositVault`): one transaction, `upgradeToAndCall(impl, setAcceptedToken(USDC, true))`. An upgrade alone stops every deposit and redemption until the accepted token is set (`migrate_vault_clrusd.ts` header). Then grant `RELAYER_ROLE` (`scripts/grant_relayer_roles.ts`, `RELAYER_ADDRESS`), revoke `OPERATOR_ROLE` from the relayer, and grant two `PAUSER_ROLE` and two `PILOT_ROLE` keys: one key alone can no longer pause.
2. **ClearUSDUpgradeable**: upgrade (`deploy/upgrade/upgradeContract.ts`). Grant two keys each of `FRAUD_ROLE`, `SECURITY_ROLE` and `LISTING_ROLE` (the vault handover can do this). Then call `syncListing` once for every member wallet (P2g part B §5 item 2; permissionless).
3. **ClaimEscrow**: upgrade. The send relayer must switch at the same time: `claimToPayoutTreasury` and `claimToWallet` revert afterwards (P2d §7 item 3; P1 §5 item 1). Transfers created before the upgrade need the sender's signature to reach a wallet (P1 §5 item 5).
4. **SavingsIntentFactory**: deploy 19 (`SAVINGS_FACTORY_ADMIN`, `SAVINGS_RELAYER_ADDRESS`). It overwrites the `SavingsIntentFactory` record: keep the old address under another record name first (owner to confirm the name). Deploy 25 registers the new one on CLRUSD (step F1).

**D. Credit core (if upgraded in place)**

1. **AccessManager first.** The upgraded issuers call its new `hasCreditRole` (P1 H-4). Grant `CREDIT_LINES_ROLE`, `CREDIT_LIMITS_ROLE`, `CREDIT_SETTINGS_ROLE` (two), `CREDIT_ATTESTER_ROLE` (two) and the `OPERATOR` keys.
2. **ClearCredit**, with the `ClearCredit` factory.
3. **NetworkRegistry, MerchantRegistry, LimitCalculator, CollateralRegistry.**
4. **RevolvingIssuer** (`scripts/upgrade_revolving_issuer.ts`; it deploys the four modules) and **TermIssuer** (`issuerProxyOptions("TermIssuer")`). No initializer: Phase 2g's and decision 37's state live in an ERC-7201 namespace (2f-INT §7 item 3). Then `TermIssuer.indexOpenPlans(member)` for every member with an open plan (P1 §5 item 8; permissionless).
5. **OffersIssuer, PayoutPool, Liquidator.** The Liquidator's constructor creates its Earn module.
6. **Re-run [`deploy/20_deploy_CreditCore.ts`](../../deploy/20_deploy_CreditCore.ts)** (`CARRY_TREASURY`, `LENDER_OPERATING`, `RESERVE_TOKEN`). It reuses every record and applies the new wiring: the ledger's reserve token and Lending Co.'s operating address (P2c), and `setClrusdToken` on CollateralRegistry and RevolvingIssuer, which RevolvingIssuer takes once (P4b L-B).
7. **The Liquidator's grants on a token it seizes from.** Check `AccessManager.isOperator(Liquidator)` and `ClearUSDUpgradeable.hasRole(LIQUIDATOR_ROLE, Liquidator)`. No numbered deploy script grants either; `scripts/upgrade_liquidator_savings.ts` did, on Sepolia. Grant `LIQUIDATOR_ROLE` before the vault handover (step I3): afterwards only the Clear Financial Safe can, after 7 days (P2d decision 3). Grant two `HOLD_ROLE` keys on the Liquidator.

**E. Earn**

1. **Deploy 26, first run** (`CLEAR_LENDING_SAFE`, `AGENT_KEY`, `TREASURY_SIGNERS`, `COLLATERAL_ACCOUNT`, `AGENT_COST_ADDRESS`, `EXCESS_DESTINATION`). It deploys the Earn timelock (7 days, the Clear Lending Safe, no admin), EarnControls from the config, and the CollateralAgent with the Earn timelock as admin from its first block. It refuses the payers already recorded. It must run before the pool upgrade (which names EarnControls) and before deploy 23 (which names the Agent on the collection).
2. **LendingPool → the Yield Pool**, by `DEFAULT_ADMIN_ROLE` (the deployer today): deploy `YieldPoolLedger`, `YieldPoolValuation(ledger)` and the implementation (`deploy/poolModules.ts` `poolProxyOptions()`), then `upgradeToAndCall(impl, initializeYieldPool(EarnControls, CLEAR_LENDING_ACCOUNT, initialClosing))`. A pool with shares must give a non-zero Initial Closing no later than now (`YieldPoolValuation.initializeYieldPool`; owner to confirm the date). It runs once; a later module change is a plain upgrade (2f-INT §7 item 1). No script does this (section 5.2, item 5).
3. **BondVault** (after B1): `scripts/upgrade_bond_vault_pledge_guard.ts`.
4. **Deploy 22** with `REPLACE_BOND_FACTORY=1` (`COOP_TREASURY`, `CLEAR_LENDING_ACCOUNT`, `RESERVE_TOKEN`, `BOND_BASE_URI`). It keeps the pre-2f factory, collection, deposit contract and valuer as `*Pre2f`, deploys the new factory with its prebuilt implementation and the IV-01 legend, sets the pool's deployment account, switches the PayoutPool's vault leg off once it owes the vault nothing, and writes the IV-02 §8.4 legend with `setLegend` (DEC 27). The legend text in the script matches IV-02 §8.4.
5. **Deploy 23** with `FIRST_BOND_ID` (`BOND_TOKEN`, `BOND_TOKEN_NAME`, `BOND_TOKEN_SYMBOL`, `BOND_BASE_URI`, `BOND_YIELD_BPS`, `EARN_RESOLUTION`, `ROLL_NOTICE_SIGNERS`, `WIND_DOWN_SIGNERS`, `FUNDING_SIGNERS`, `EXCLUDED_HOLDERS`). In this order (2f-B §3 item 23): the collection and its first id; a new BondValuer; BOND at 95% with that valuer; `ITEM_ROLLER_ROLE` for the collection; on the BondVault, `BOND_ROLE` for the collection, the encumbrance source and `DEFAULT_ADMIN_ROLE` for the Earn timelock; **then** `setEarnSources`, which names the Agent, after which every BondVault grant, setting or upgrade is co-signed; the collection's `setSources` (vault, registry, controls, Agent); EarnControls grants by resolution, reserve sources, bond book and the Ladder (`setRung`); HolderDirections.
6. **Wire the Yield Pool into EarnControls.** `EarnControls.setSources(membership, LendingPool, BondVault, CollateralAgent, BondVault)`. No script does this: deploy 23 passes `controls.yieldPool()` through as it finds it, and deploy 26 never sets it, so subscriptions fail until it is set (section 5.2, item 4).
7. **Earn roles not in any script.** On the pool: `DEPLOYER_ROLE` ×2, `VALUATION_ROLE` ×2, `SUSPENSION_ROLE`, `CCO_ROLE`, `TREASURER_ROLE`; revoke `BORROWER_ROLE` (2f-YP §9). On EarnControls, by resolution: `ATTESTER_ROLE`, `PAUSE_ROLE` ×2, `SUCCESSOR_ROLE` ×2, `ELIGIBILITY_ROLE` ×2, `LADDER_ROLE` ×2 (2f-EC §4; 2f-INT §6).
8. **Start the four co-signed CollateralAgent changes now**, because each waits 7 days: `setVault(BondVault)`, `setBondBook(BondVault)`, `setHolderDirections(HolderDirections)` (deploy 23 prints them) and `setPledgeModule(Liquidator)` (deploy 26 prints it; `deploy/earnWiring.ts` `pledgeModuleChange`). For each: treasury signer 1 `proposeChange(target, callHash, descriptionHash)`; a different treasury signer `confirmChange`; the Agent Key `approveChange`; 7 days from the confirmation; then the Earn timelock (the Agent's admin) makes the call. The Clear Lending Safe can schedule the four calls on the Earn timelock at once, so the two 7-day waits overlap (2f-EC §3 item 19). The Liquidator needs nothing more: it takes `applyDistribution` only from the Agent the collection names (2f-INT part two §2).

**F. Compliance wiring**

1. **Before it: attest members' states.** Deploy 25 names NetworkRegistry as the vault's state source, and from then every mint needs the receiver's attestation while the pilot is on (P2d §7 item 3, L-E).
2. **Deploy 25** (`STATE_ATTESTER_KEY`, `FEE_RECIPIENT`). After the C, D and E upgrades, because it calls their new functions. It deploys RateSchedule and its products and names it on both issuers (set once); sets the credit and due terms, excluded payers, the Combined Ceiling both ways (set once), the fee cap, and proposes the fee recipient (a second `CREDIT_SETTINGS_ROLE` holder approves with `approveFeeRecipient`; no plan with a fee opens until then); grants the state attester; trusts both issuers on the Liquidator and makes it TermIssuer's hold source; sets the Liquidator's Earn sources; proposes `BurnerBond.setLiquidator(Liquidator)`; deploys PoolShareEnforcer, grants it the pool's `ENFORCER_ROLE`, makes it the pool's enforcement destination, names it on the Liquidator and, once, on CollateralRegistry, makes the pool the POOL_SHARE valuer and revokes the Liquidator's old pool `LIQUIDATOR_ROLE`; names the vault's state source; adds the WORKOUT tier; deploys PauseClock and names it, once each, on RevolvingIssuer and the Liquidator (only once the vault and CLRUSD answer the clock views); names the AccessManager as CLRUSD's membership source and the new SavingsIntentFactory as its intent factory.
3. **Run deploy 25 before the new collection's first sale.** `setLiquidator` applies at once while the collection has no bonds, and waits 7 days once it has some (P1 M-6; deploy 25 comments).

**G. Before the first Deployment and the first subscription**

1. **Pool Tier ceiling:** two `VALUATION_ROLE` signers call `postPoolTierPrincipal(value, evidenceHash)`. Until it is posted, no Deployment is possible (DEC, "Base Sepolia redeploy steps"; 2f-PC §3 item 6). The legend was written in E4.
2. **Funding Limit and capacities** are set (A5), and Clear Lending's other indebtedness is posted by two `FUNDING_ROLE` holders if any (DEC 39).
3. **Deploy 26, second run**, once every contract is recorded (after F2 and step H1): it refuses the rest, PoolShareEnforcer, HolderDirections, the new collection, the `*Pre2f` records and `AssurancePoolV2` among them. Run it before the Earn handover, or it prints each as an Earn timelock proposal (2f-INT part two §3).
4. **PayoutPool's yield leg:** `setYieldPool(0)` once `borrowedFromYield` is 0 (2f-YP §10; DEC 3, 17). Not scripted.

**H. Assurance and the Deed track**

1. **Deploy 08** (`BOARD_SAFE`, `ASSURANCE_SIGNERS` with at least two, `ASSURANCE_DEPLOY=1`): after the NetworkRegistry upgrade (`listMoneyPath` is new) and after the money-path contracts are recorded (`MONEY_PATHS` in `assurance_timelock_handover.ts`). The pool is governed by the Assurance timelock from its first block; the governed calls it prints (`setPayer` ×2, `setLendingCoAddresses`, `setAssuranceDisbursementAddress`, `setExposureSources`) each take two pool signers, the board Safe and 7 days.
2. **Deploy_all** (`FOUNDATION_SAFE` or `DEED_ADMIN`, `DEED_MINTER`, `DEED_VALIDATOR_SIGNER`, `DEED_AGREEMENT_V5_HASH`, `DEED_AGREEMENT_V5_URI`, `MEMBERSHIP_REGISTRY`, optional `DEED_FEE_TOKEN` and `DEED_SERVICE_FEE`). It deploys the Deed timelock (at least 7 days), the Deed track with v5, the FunctionalContractRegistry and CoopTransferAgent, and hands everything over. It overwrites the Deed records: keep the old ones under other names first (owner to confirm).

**I. Operational roles, then the handovers**

1. **Operational roles** (`scripts/command/ops-roles.ts`). Its map is stale in three places: the vault's relayer row still says `OPERATOR_ROLE`, and it routes LendingPool `BORROWER_ROLE` to the card settler and checks it on the PayoutPool, against DEC 17 (P2d §7 item 3; section 5.2, item 8). Fix the map before `MODE=run`.
2. **Credit handover**: `OPS_SAFE=… CREDIT_HANDOVER=1 npx hardhat run deploy/credit_timelock_handover.ts`. It moves RevolvingIssuer, TermIssuer, OffersIssuer and RateSchedule ownership, and `DEFAULT_ADMIN_ROLE` on NetworkRegistry, CollateralRegistry, LimitCalculator, Liquidator, MerchantRegistry, ClaimEscrow, MembershipRegistry, PayoutPool and the AccessManager (the ledger's admin), plus both ProxyAdmins.
3. **Vault handover**: `CLEAR_FINANCIAL_SAFE=… VAULT_HANDOVER=1 VAULT_RELAYERS=… VAULT_PAUSERS=… PILOT_SIGNERS=… FRAUD_SIGNERS=… SECURITY_SIGNERS=… LISTING_SIGNERS=… npx hardhat run deploy/vault_timelock_handover.ts`. It grants the keys, gives the vault's admin to the vault timelock, moves CLRUSD's `UPGRADER_ROLE` and CCIP admin, begins CLRUSD's default-admin transfer and the token pool's ownership transfer, and prints the acceptance calls for the Safe to schedule. It covers the `ESADepositVault` record only, not `ESADepositVaultLegacy`.
4. **Earn handover**: `CLEAR_LENDING_SAFE=… EARN_RESOLUTION=… EARN_HANDOVER=1 npx hardhat run deploy/earn_timelock_handover.ts`. Last of the Earn steps, after G3. It moves LendingPool's and EarnControls' admin and the `BurnerBond` record's ownership, checks the CollateralAgent's and the BondVault's admin, and renounces every deployer role. The `*Pre2f` and `*Legacy` collections keep their current owner.
5. **Apps** (section 4.2).

### 2.3 Waits

| Wait | Starts | Ends | Source |
|---|---|---|---|
| CollateralAgent co-signed changes (E8): 7 days | Second treasury signer's `confirmChange` | 7 days later; the Earn timelock call can be scheduled at the same time and also waits 7 days | IV-10 Exhibit A Part 2 item 6; 2f-EC §1 "Changes", §3 item 19 |
| `BurnerBond.setLiquidator`: 7 days only if bonds exist | Deploy 25 | Immediate before the first sale; else `executeLiquidatorChange` after 7 days | P1 M-6; deploy 25 |
| Every governed change after a handover (I2 to I4): 7 days | The Safe's proposal | 7 days | UPG |
| CLRUSD default admin: the token's admin delay, then 7 days | Vault handover (I3) | `acceptDefaultAdminTransfer` through the vault timelock, once both have passed. Deploy 21 sets a 2-day delay by default (`CLRUSD_ADMIN_DELAY`); read `defaultAdminDelay()` on the existing token | `vault_timelock_handover.ts`; deploy 21 |
| Token pool ownership: 7 days | I3 | `acceptOwnership` through the vault timelock | `vault_timelock_handover.ts` |
| Assurance governed calls: 7 days | Two signers approve, the board Safe schedules | 7 days | P2c; UPG |
| Ladder changes after the first listing: 48 hours | The second `LADDER_ROLE` signer's `scheduleRung` | `applyRung` | DEC 31 |
| Holder-cap floor change: 7 days on top of the timelock | `scheduleHolderCapFloor` | 7 days | 2f-EC §1 |
| The legend's second change: 7 days on top of the timelock | `setLegend` after the first write | 7 days | 2f-PC §3 item 14 |

On a calendar: day 0 runs A to H with the deployer, starts E8, and ends with I1 to I4. Day 7 the Agent changes and the first timelock proposals can execute; CLRUSD's admin acceptance and the token pool's acceptance land there too. Nothing in the Sepolia path waits longer than 7 days, except the unwinding in B1, which depends on the holders.

## 3. Base mainnet

### 3.1 Do ESADepositVault and ClaimEscrow need a UUPS logic upgrade?

**Yes, both.** FIX §2 rule 4 kept their changes storage-safe precisely because they are live, and the deployed implementations predate every fix: the Base ABI records show the vault with `OPERATOR_ROLE` and no `setClrusd`, and ClaimEscrow with the open `claimToWallet`. PHASE-2F-PLAN's "none of them needs to change" is about Earn only (section 5.2, item 9).

What the vault upgrade delivers:

- **H-3:** the relayer key gets `RELAYER_ROLE`, which reaches only member-signed deposits, redemptions and mandates; settings move to `DEFAULT_ADMIN_ROLE`; a depositor can cancel their own mandate (P1).
- **M-5:** a gasless deposit mints only to the depositor or a receiver in their signed intent; redemption accepts EIP-1271; one accepted token (P1).
- **M-7 prep:** `setClrusd`, guarded by a zero old supply (P1).
- **10c pauses:** a pause lapses after 72 hours unless renewed (P2); the last signer cannot renew or re-pause for 30 days (P4 M-A); every pause, renewal and early end takes two holders (P2d); at most 30 days per chain without a recorded legal basis, and a new pause within 30 days continues the chain (P2g, owner decision 33); `pauseClock()` and `isPauseInForce()` for the credit side (P2g).
- **CA pilot (P2d decision 7):** the cap counter is retired; two `PILOT_ROLE` holders can pause CA mints; `setPilotOff`. L-E: a mint needs the receiver's state attestation once a state source is named and the pilot is on.
- **Redemptions pay the holder**, or a receiver the holder signed for (P2d).
- **`s_lastDepositAt`**, which RevolvingIssuer reads for Boost (P2b).
- Not an audit fix, but it arrives too: the autopay `DepositMandate` paths, which the Sepolia vault already has (`scripts/upgrade_vault.ts` header).

What the ClaimEscrow upgrade delivers: **H-4** (a claim to a wallet needs the claim key the sender committed to, or the sender's signature; `claimToWallet` reverts; claims only before expiry, refunds only after) and **L-D** (`claimToPayoutTreasury` reverts; `claimToPayoutTreasuryWithSignature` needs the claim key's or sender's signature). Commits `059ac894`, `782a41db`, `0dc26336`.

### 3.2 Storage evidence against `.openzeppelin/base.json`

`STORAGE_MANIFEST=base STORAGE_CONTRACTS=ESADepositVault,ClaimEscrow npx hardhat run scripts/storage_report.ts`: the vault is compatible with both recorded implementations (`0xe626…3644`, `0x83CB…26e9`) and ClaimEscrow with `0x96F0…2c4e`. Every phase that touched or might have touched them re-ran it (section 1.2), and it was re-run for this runbook. The vault's layout still ends where it did: its appended fields took gap slots (42 → 34 → 33 → 31), and Phase 2g's packed into an existing slot (UPG "Storage safety"; P2g part B §1.2). ClaimEscrow's `claimSignerOf` took one gap slot.

### 3.3 Steps for the live contracts

1. **Survey, read-only** (AUDIT-REPORT launch checklist, "Today"; L-9): who holds `OPERATOR_ROLE`, `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE` on the vault, `DEFAULT_ADMIN_ROLE` and `SETTLER_ROLE` on ClaimEscrow, and `MINTER_ROLE` on legacy ClearUSD. Nobody has read these from this repository. If a server key holds an admin or settings role, pause the vault and move the role to the Safe first. Note that `safe-handover.ts` reads only the Base Sepolia list (AUDIT-REPORT L-9).
2. **Rehearse on a fork of Base** (`FORK_RPC_URL`), read-only, as P4 §6 asks for Sepolia.
3. **Vault batch.** Deploy the implementation with `upgrades.prepareUpgrade` (it validates the layout), then `VAULT_IMPL=… RELAYER=… USDC=… npx hardhat run scripts/migrate_vault_clrusd.ts --network base`. It sends nothing and writes `vault-1-upgrade.json`: `upgradeToAndCall(VAULT_IMPL, setAcceptedToken(USDC, true))`, `grantRole(RELAYER_ROLE, relayer)`, `revokeRole(OPERATOR_ROLE, relayer)`. Whoever holds `DEFAULT_ADMIN_ROLE` today executes it (owner to confirm; the script says the Ops Safe, but the vault is Clear Financial Co.'s since P2d, section 5.2, item 2). In the same window grant two `PAUSER_ROLE` and two `PILOT_ROLE` keys. Upgrade while no pause is in force.
4. **ClaimEscrow.** Upgrade it by its `DEFAULT_ADMIN_ROLE` holder. Ship the send relayer and claim page that create transfers with claim keys and sign treasury claims at the same moment (P2d §7 item 3). Transfers still open at the upgrade need the sender's signature to reach a wallet (P1 §5 item 5): owner to confirm how many are open.
5. **Hand the vault over:** `deploy/vault_timelock_handover.ts`, as in step I3. On Base today it covers the vault alone: there is no `ClearUSDUpgradeable` or `CLRUSDTokenPool` record. It sends from the deployer, so if a Safe holds the vault's admin, the same grants and renounces go through that Safe (owner to confirm).
6. **ClaimEscrow's admin to the credit timelock:** `credit_timelock_handover.ts` handles whatever is recorded, so on Base today it moves ClaimEscrow alone (UPG lists ClaimEscrow under the credit timelock).

### 3.4 Timelocks and authority after the upgrade

The vault upgrade adds no timelock of its own: `_authorizeUpgrade` is still `onlyRole(DEFAULT_ADMIN_ROLE)`. The timelock comes from the handover in step 5. After it:

- **Vault:** `DEFAULT_ADMIN_ROLE` is held only by the vault timelock (7 days; the Clear Financial Co. Safe proposes and executes; no timelock admin, so its delay changes only through a delayed proposal). Every later upgrade, setting (accepted token, CLRUSD address, state source, pause cap, pilot off switch) and role grant is a Safe proposal plus 7 days. Pauses and the CA mint pause stay in-contract two-person actions. The relayer stays one hot key (UPG "ESADepositVault and CLRUSD").
- **CLRUSD, once it exists:** `UPGRADER_ROLE`, CCIP admin and the default admin go to the same timelock, the admin by begin and accept after the token's admin delay.
- **ClaimEscrow:** the credit timelock (7 days, the Ops Safe).
- Member exits stay open while a change is pending: redemptions and transfers are not gated by any timelock (Dfal.spec acceptance 17; UPG).

### 3.5 ClearUSD → ClearUSDUpgradeable (M-7), and the credit stack

**Why it gates credit.** Legacy ClearUSD has no lock and no `seize`, so on mainnet savings-backed credit is unsecured and the Liquidator cannot run until the vault mints the new token (AUDIT-REPORT M-7). The new token is also a dependency of the credit deploy itself: deploy 20 names it, once, on RevolvingIssuer and CollateralRegistry, and deploy 22 initializes the Liquidator with it.

In order:

1. **The vault upgrade (3.3 step 3).** `setClrusd` arrives with it.
2. **Deploy 21** (`CLRUSD_ADMIN`, `CLRUSD_MAX_SUPPLY`, `CLRUSD_ADMIN_DELAY`): the token, with the old token's max supply by default, mint and burn granted to the recorded vault, and the admin delay armed (2 days by default). And **deploy 19**: a new SavingsIntentFactory.
3. **Fresh credit and Earn deploy** (below). It can run while the old supply drains, but no member opens a savings-backed line yet.
4. **Drain.** Every holder of old CLRUSD redeems; the co-op redeems what it holds. `migrate_vault_clrusd.ts` prints the outstanding supply. Owner to confirm whether any old CLRUSD sits on another chain (no Base token pool is recorded).
5. **Re-point:** `setClrusd(NEW_CLRUSD)` on the vault, once the old supply is zero. `migrate_vault_clrusd.ts` with `NEW_CLRUSD` writes `vault-3-repoint.json`; after the vault handover it is a vault timelock proposal (7 days). It reverts while any old token is outstanding, so schedule it to execute after the drain.
6. **Wire the new token**: membership source (the AccessManager) and intent factory (deploy 25), `LIQUIDATOR_ROLE` for the Liquidator, two keys each of `FRAUD_ROLE`, `SECURITY_ROLE` and `LISTING_ROLE`. Then re-run the vault handover for CLRUSD; the Safe accepts the default admin after the admin delay, through the timelock.
7. **Only then switch on savings-backed credit.** Retire legacy ClearUSD (owner to confirm what to do with its remaining roles).

**Fresh deployments, in order** (`docs/operators/deploying-contracts.md` "The order", and each script's own prerequisites):

1. `07_deploy_TokenRegistry` (the bond factory gates collections on its whitelist); `16`, `17`, `18` (AccessManager, MembershipRegistry, and the link between them).
2. `20_deploy_CreditCore` (`CARRY_TREASURY` and `LENDER_OPERATING` must be the multisig and Lending Co.'s operating address on mainnet; `RESERVE_TOKEN` defaults to Base USDC). It needs deploy 21's record.
3. `22_deploy_BondsAndPool` (`COOP_TREASURY`, `CLEAR_LENDING_ACCOUNT`): MerchantRegistry, PayoutPool, a fresh LendingPool (the Yield Pool, with its modules), BondVault, the new factory, the Liquidator, and the legend.
4. `26_deploy_EarnControls` (as E1), then `23_deploy_BondCollection` (as E5, with no `FIRST_BOND_ID`: no older collection is on record). Then E6 and E7: `EarnControls.setSources(…LendingPool…)` and `LendingPool.setEarnControls(EarnControls)`, which no script makes (on a fresh pool `initializeYieldPool` does not apply: `initialize` has already started the accrual clock), and the Earn role grants.
5. `24_deploy_OffersIssuer` (`OFFERS_TREASURY`, the caps), if offers launch.
6. `25_wire_Compliance` (as F), after attesting members' states. PauseClock is named only because the vault is upgraded and the new CLRUSD exists.
7. The Liquidator's grants (D7), the four co-signed Agent changes (E8), the Pool Tier ceiling and limits (G1, G2), `26` again (G3).
8. `08_deploy_AssurancePool` (H1), once the money-path contracts are recorded.
9. `15_deploy_CLRUSDTokenPool` only if CCIP is wanted on Base (owner to confirm).
10. Operational roles and the credit, Earn and vault handovers (I1 to I4).

### 3.6 Gates before mainnet member credit

- **The external human audit** P4 §7 recommends before mainnet member credit, scoped there.
- **M-7 complete** (3.5 step 7).
- **L-4:** run the suite once against a build with revert strings stripped before each mainnet deploy (AUDIT-REPORT L-4; P1 §5 item 7). **L-3:** rotate or remove the fallback Alchemy and Etherscan keys in `hardhat.config.ts`.
- **Counsel and config items** in section 5.1.
- **The Deed track** waits for its own gate: no real-property deed until D-1 to D-13 and v5 are deployed (AUDIT-REPORT launch checklist), and P4 §7 puts the v5 surface in the external audit's scope.

## 4. After each network

### 4.1 Read-only checks

Each line is a view call; together they confirm the wiring the steps above should leave. Implementation addresses come from the ERC-1967 slot (`deploy/upgrade/checkUpgrade.ts` prints it with the proxy admin).

| Contract | Expect |
|---|---|
| Every upgraded proxy | A new implementation; `extensionKind()` on each module matches the main contract's check |
| ESADepositVault | `acceptedToken()` is USDC; `hasRole(RELAYER_ROLE, relayer)` true and `hasRole(OPERATOR_ROLE, relayer)` false; two `PAUSER_ROLE` and two `PILOT_ROLE` holders; `stateSource()` is NetworkRegistry (once deploy 25 has run); `pauseClock()` answers; `clrusd()` is ClearUSDUpgradeable (mainnet, after 3.5 step 5); after the handover the vault timelock holds `DEFAULT_ADMIN_ROLE` and the deployer holds nothing (`assertNoVaultAdmin`) |
| ClearUSDUpgradeable | `membershipSource()` is the AccessManager; `intentFactory()` is the new SavingsIntentFactory; the vault holds `MINTER_ROLE` and `BURNER_ROLE`; the Liquidator holds `LIQUIDATOR_ROLE`; `pauseClock(address(0))` answers; `defaultAdmin()` is the vault timelock after acceptance |
| ClaimEscrow | `DEFAULT_ADMIN_ROLE` with the credit timelock after the handover; the relayer holds `SETTLER_ROLE` |
| AccessManager, issuers | `isOperator` true for ClearCredit, RevolvingIssuer, TermIssuer, LimitCalculator and the Liquidator; `hasCreditRole` true for each credit key |
| RevolvingIssuer | `rateSchedule()` is RateSchedule and `ceilingProduct()` set; `dueTermsOf().termIssuer` is TermIssuer; `depositSource()` is the vault; a WORKOUT tier exists; `pauseClock()` (workouts ABI) is PauseClock |
| TermIssuer | `rateSchedule()`, `combinedProduct()` non-zero, `holdSource()` is the Liquidator, `feeRecipient()` non-zero |
| Liquidator | `trustedSavingsIssuer` true for both issuers; `earnPool()` is LendingPool and `earnBonds()` the new collection; `poolShareEnforcer()`; `pauseClock()` |
| CollateralRegistry | `enforcementSource()` is PoolShareEnforcer; `collateralTypes(POOL_SHARE).valuer` is LendingPool; `collateralTypes(BOND).valuer` is the new BondValuer; `hasRole(ITEM_ROLLER_ROLE, collection)`; `hasRole(OPERATOR_ROLE, Liquidator)` |
| LendingPool (joined ABI, `poolAt`) | `earnControls()` is EarnControls; `deploymentAccount()` is Clear Lending's account; `enforcementDestination()` and `ENFORCER_ROLE` are PoolShareEnforcer's; the Liquidator has no `LIQUIDATOR_ROLE`; `legend()` is IV-02 §8.4's text; `poolTierPrincipal()` posted; `encumbranceSource()` is CollateralRegistry |
| EarnControls (joined ABI, `earnControlsAt`) | `yieldPool()` is LendingPool; `reserveStatus()` is BondVault; `bondBooks()` includes BondVault; `refused` true for every entry of `REFUSED_RECORDS` that is recorded; the Ladder terms offered; each role held by its keys |
| BondVault | `agent()` is the CollateralAgent; the collection holds `BOND_ROLE`; `encumbranceSource()` is CollateralRegistry; the Earn timelock holds `DEFAULT_ADMIN_ROLE` |
| BurnerBond (joined ABI, `bondAt`) | `bondVault()`, `controls()`, `agent()` set; `liquidator()` is the Liquidator; on Sepolia, the first bond it issues has an id at or above `FIRST_BOND_ID` |
| CollateralAgent | `vault()` and `bondBook()` are BondVault; `pledgeModule()` is the Liquidator; `holderDirections()` is HolderDirections; the Earn timelock holds `DEFAULT_ADMIN_ROLE` |
| PayoutPool | `bondVault()` zero once repaid; `hasRole(REDEEMER_ROLE, coopTreasury)` |
| Timelocks | `getMinDelay()` at least 7 days; the deployer holds no `TIMELOCK_ADMIN_ROLE`; the right Safe holds proposer and executor (`assertNoCreditAdmin`, `assertNoVaultAdmin`, `assertNoEarnAdmin`, `assertNoAssuranceAdmin`) |

### 4.2 Apps and API

**Held app PRs merge after the Base Sepolia upgrade:** #884 (Phase 1), #887 (Phase 2), #890 (Spendable account details) and #895 (ELPA as equity), which is stacked on #890. Merging into `dev` redeploys demo.useclear.org and merchant.useclear.org (`CLAUDE.md`), so merge them in the upgrade window: the current API calls functions that revert afterwards (`claimToPayoutTreasury`, `collectForMember`, the pool's `borrow`, the three-argument `pledge`). Before they merge: #887 and #890 must stop drawing from the pool directly (DEC 17; 2f-INT §6). #884's plan-signing module adds `productId`, the new `PlanOpened` fields and the `Resplit` signature (P2 §7).

**ABI and call changes the reports name:**

- **Joined ABIs.** The pool's ledger functions through `poolAt` / `poolAbi` (`deploy/poolModules.ts`), and the LendingPool record should carry the joined ABI (2f-PC §5). The collection through `bondAt` / `bondAbi` (2f-B §6). EarnControls through `earnControlsAt`. RevolvingIssuer's `RevolvingIssuerWorkouts` functions at the issuer's address (`cflPrincipalOf`, `missedInRowOf`, `cardAuthorizationOf`, the line closing; P2g A6 item 5; 2f-INT §6). DeedNFT's `IDeedTrust` merged into the generated ABI (`deploy/99_generateTsAbis.ts`; P3 §5 item 11).
- **`apps/api/src/services/chain/autoRepayService.ts`** still calls the three-argument `repayForMember`; it takes a fourth, `bytes32 payer`, since P2e (P2g A6 item 5; P2e §4).
- **P2e §4's table:** `openLine(member, capacities, cycleEndDay)`, `setAutoClear…` with `authHash`, `proposeFeeRecipient` / `approveFeeRecipient`, the removed RateSchedule switch.
- **Pledges need the member's signature** (P4b L-I): `apps/api/src/services/chain/savingsCollateralService.ts` pledges with the operator key alone; `pledgeItem` also takes the Maturity Instruction (P2e §7).
- **Sends and savings** (P2d §7): `sendRelayerService.ts` → `claimToPayoutTreasuryWithSignature`; `termLifecycle.ts`'s `collectForMember` job retires; `predictIntentAddress(salt, config)` and `announceIntent`; a plain `redeem` names the caller; `mayReceive` before a CLRUSD Send; OFAC screening before every Send.
- **Yield Pool** (2f-YP §9; 2f-PC §5): `subscribe(assets, receiver, attestation)`; `redeemOrQueue` and the queue views; `shareValue()` replaces `navPerShare`; `fundingRate()` and `utilization()` replace the per-cycle rate getters in `apps/api/src/services/command/onchain.ts` and `earnReader.ts`; `poolFunding.ts`'s `borrow` reverts; `receiver` must be the Holder; `fillQueue` after Returns and subscriptions.
- **Bonds** (2f-B §6): purchase by signed `Quote`; `BondDepositForm.tsx`, `sendCalls.ts` and `earnReader.ts` retire `makeDeposit`, the discount curve, `redeemBond`, `rollBond` and auto-roll; the roll screen signs `ConfirmRoll` with the root key.
- **Liquidator** (2f-ENF §8): `settleExcess`, `liquidateShares`, `settleRealized`, `settleShortfall`, `earnGapOf` removed; `noticeShortfall(member)` takes no issuer; new `shortfallOf`, `earnDefaultedOf`, `nextBondOf`.
- **Assurance** (P2c §8): the old pool's views and `stableCredit.assurancePool()` are gone; read `reserveToken()`, `lenderOperating()` and the new pool's compartments.
- **Addresses:** `apps/api/src/config/contracts.ts` (per-chain environment variables win over its defaults) and `apps/member/src/lib/clearNetwork.ts` need the new SavingsIntentFactory, collection, BondValuer, AssurancePoolV2 and the Deed addresses. Regenerate `packages/command-types/src/chain/code.json` and the contract reference after deploying, since both describe what is deployed.

**New consoles** (two-person unless noted): cure notices, Income and Cycle Assurance, workouts and line closing (`CREDIT_ATTESTER_ROLE`; P2e §7, P2g A6, 2f-INT §6); vault and CLRUSD pauses with the 30-day chain and legal basis, de-listing and the FRAUD notice (P2d §7, P2g part B §5); the pool's `postPoolTierPrincipal`, `postRecovery`, `recordValuationEvent`, Suspension and legal holds (2f-PC §5, 2f-INT §6); Deployments (`DEPLOYER_ROLE`); the Ladder (`scheduleRung`, then `applyRung` after 48 hours); `postRollNotice`, `setWindDown` and `redeemAll`, `postOtherIndebtedness`, the reserve views and `completeSettlement` (2f-B §6); households, eligibility, Successors and pause flags on EarnControls (2f-EC §5); the Collateral Agent's snapshot, distribution and change screens (2f-EC §5); HolderDirections signing and `tally` (2f-B §6); the Assurance claims store paying grants with `releaseAssurance` (P2c §8).

**Keepers:** `syncCreditPeriod` at each member's cycle end, `triggerDefault` when `inDefault`, `declarePlanDefault`, `payPledged`, `noticeShortfall`, `settle` and `completeSettlement` (P2e §7); `PoolShareEnforcer.enforce`, `fillQueue` then `settle`, `cancelExcess` (2f-ENF §8); `snapshotBonds` and `claimDistribution` (2f-EC §5); `syncListing` after registration (P2g part B §5).

**Indexers:** the event lists in P2e §7 (bond half, item 5), P2g A6, 2f-YP §9, 2f-PC §5 (`InterestBilled` … `RungScheduled`), 2f-EC §5, 2f-ENF §8, 2f-B §6 and 2f-INT §6 (`LossChargeCompleted` now books the full charge: subtract `value − absorbed`; `LegalHold*`, `SuccessorRedemptionRequested`, `LineClosed`), and P4c §7 (`ValidatorReassignmentCancelled`, `DeedFreezeConfirmed`).

## 5. Open items

### 5.1 What gates a step

- **Counsel notes, open in DEC:** decision 9 (Secured Obligations and the Article 7 order), 19 (IV-10 §7.6), 37 (whether the line-closing demand needs its own notice under MB-05 §6.3; 45(g) keeps no notice for now), 38 (whether a roll counts toward the offering maximum), 40 (IV-02 §2.5(c) wording), and the "Notes for counsel" list. Also P2g A5 item 2 (the workout plan and MB-05 §2.4), P2d decision 6 / DECISIONS #6 (unattested CA residents), and L-C, L-F and L-G (P4b). These gate mainnet, not Sepolia.
- **Figures:** the rate schedule and credit terms (P2b §3b), the Funding Limit and capacities, the real Ladder, the federal-benefit payer ids, and the Pool Tier ceiling (sections 2.2 A5 and G).
- **Mainnet only:** the external audit (P4 §7), the role survey (AUDIT-REPORT L-9), and the M-7 drain.
- **Owner decisions in this runbook:** the credit core on Sepolia (1.1); the Deed track redeploy (1.1); the record names that keep old addresses when deploy 19 and `deploy_all.ts` overwrite them; the Initial Closing date for `initializeYieldPool`.

### 5.2 Gaps and inconsistencies found while writing this

1. **`scripts/upgrade_vault.ts` and `scripts/migrate_vault_clrusd.ts` point `base-sepolia` at `0x7bA8…40cD`,** which the records name `ESADepositVaultLegacy`. The current Sepolia vault is `0x8364…413b` (`deployments/base-sepolia/ESADepositVault.json`, root README, both apps). And `upgrade_vault.ts` upgrades without `setAcceptedToken`, which the contract's own note says stops deposits and redemptions. Do not use it on either network.
2. **`migrate_vault_clrusd.ts` addresses its batches to the Ops Safe;** since P2d the vault belongs to Clear Financial Co. through the vault timelock.
3. **`scripts/unwind_legacy_bonds.ts` reaches only `BurnerBondLegacy`.** The 2f replacement also retires the current pre-2f collection, which the script cannot reach. `apps/member/src/lib/clearNetwork.ts` says the 3 Nov legacy collection's bonds were all redeemed; whether the current collection has outstanding bonds is owner to confirm.
4. **No script wires EarnControls to the pool:** `EarnControls.setSources(…LendingPool…)` and, for a fresh pool, `LendingPool.setEarnControls`. Only the test helpers do. Nor does any script grant the pool's Earn roles or EarnControls' `ATTESTER`, `PAUSE`, `SUCCESSOR`, `ELIGIBILITY` and `LADDER` roles.
5. **No script performs the Yield Pool upgrade.** `scripts/upgrade_lending_pool_burn_lock.ts` passes no module constructor argument, so it cannot deploy today's implementation, and it makes no `initializeYieldPool` call.
6. **`scripts/upgrade_liquidator_savings.ts` skips the upgrade** whenever `trustedSavingsIssuer` already answers, which it does on Sepolia's Liquidator.
7. **The pre-audit `scripts/upgrade_*` scripts each assert their own feature after upgrading.** `upgrade_term_fee_recipient.ts` checks for `setFeeRecipient`, which P2e removed, and `upgrade_deednft_reserved_traits.ts` deploys DeedNFT without its extensions. No single script performs the audit's upgrade of a contract; section 1.1 names the call for each.
8. **`scripts/command/ops-roles.map.json` is stale:** the vault's relayer row says `OPERATOR_ROLE` (P2d §7 said to change it), and the LendingPool `BORROWER_ROLE` rows contradict DEC 17. `docs/operators/deploying-contracts.md` is stale in the same places (it still has the operator step grant LendingPool's `LIQUIDATOR_ROLE` and lists `grant_pool_borrower.ts`) and describes deploy 20 and 23 before Phase 2c and 2f.
9. **PHASE-2F-PLAN.md says the mainnet contracts "none of them needs to change".** That holds for Earn only; the vault and ClaimEscrow need the upgrade in section 3.
10. **AUDIT-REPORT's scope lists ClearUSDUpgradeable and SavingsIntentFactory under "Live on Base mainnet"**, but neither has a Base deployment record or manifest entry, and the root README and PHASE-2F-PLAN list only ClearUSD, ESADepositVault, ClaimEscrow and Create2Deployer. Owner to confirm.
11. **P1 §5 item 8 and P4 §6 recommend a fresh Sepolia credit deployment; 2f-INT §7 gives in-place upgrade steps.** Section 1.1 sets out the choice.
12. **On a fresh chain no numbered deploy script makes the Liquidator an AccessManager operator or grants it CLRUSD's `LIQUIDATOR_ROLE`**, and `earn_timelock_handover.ts` hands over only the `BurnerBond` record's collection, not the `*Pre2f` or `*Legacy` ones.
