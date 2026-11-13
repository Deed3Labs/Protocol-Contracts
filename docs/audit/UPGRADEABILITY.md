# Upgradeability

This lists which contracts can be upgraded, who holds that power, and which timelock it sits behind once the handover scripts have run. Compliance spec 10e requires every upgrade that could block a member to sit behind a delay of at least 7 days, so a member can withdraw first. DECISIONS #10 sets up two timelocks.

| Timelock | Code | Minimum delay | Proposer and executor | Admin | Handover script |
|---|---|---|---|---|---|
| Deed timelock | OZ `TimelockController` (`contracts/governance/Timelock.sol`) | 7 days | Foundation multisig | none | `deploy/deed_admin_handover.ts` |
| Credit timelock | same | 7 days | Ops Safe | none | `deploy/credit_timelock_handover.ts` |

With no admin, a timelock's own delay can change only through a delayed proposal. `deployCreditTimelock` refuses a delay under 7 days.

Neither handover has been run on any network. Until it runs, each power below is held by the deployer EOA, or by whoever the deploy scripts gave it to.

## Credit and savings (credit timelock)

| Contract | Proxy | Upgrade authority | Moved to the timelock by the handover | Live on |
|---|---|---|---|---|
| ESADepositVault | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base mainnet (storage-safe, see below) |
| ClaimEscrow | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base mainnet (storage-safe) |
| ClearUSDUpgradeable (CLRUSD) | UUPS | `UPGRADER_ROLE` | UPGRADER_ROLE and DEFAULT_ADMIN_ROLE | Base Sepolia |
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
| AssurancePool, AssuranceOracle | UUPS | `owner()` | ownership | Base Sepolia |
| PayoutPool, LendingPool, BondVault | UUPS | `DEFAULT_ADMIN_ROLE` | DEFAULT_ADMIN_ROLE | Base Sepolia |

`assertNoCreditAdmin` fails the handover if the deployer still holds any of these powers afterwards. `test/deploy/Compliance.deploy.spec.ts` runs the handover on a fresh chain. It then shows that a rate change needs a proposal and cannot execute before 7 days. `test/audit/compliance/Dfal.spec.ts` (acceptance 17) shows the same for a CLRUSD upgrade, and that a member can transfer and redeem while it is pending.


**Operational roles do not move.** These stay with their own keys: CREDIT_LINES_ROLE and CREDIT_LIMITS_ROLE, AccessManager `OPERATOR`, CLRUSD `MINTER_ROLE`/`BURNER_ROLE`, `FRAUD_ROLE`, `SECURITY_ROLE`, `STATE_ATTESTER_ROLE` and the vault's `RELAYER_ROLE`. Grant them before the handover. Afterwards, granting a new one is itself a 7-day proposal. None of them can upgrade a contract or change a rate. The two pause roles can stop transfers for at most 72 hours, and only a different signer can renew that (spec 10c).

**Delegatecall extensions.** RevolvingIssuer (one extension) and TermIssuer (TermIssuerExtension and TermIssuerOrigination) call into extension contracts. The main contract's constructor creates each extension, and its address is an immutable. So an extension changes only when the main contract is upgraded, under the same authority and the same timelock. Nothing can point an extension at a new address on its own.

## Deed track (Deed timelock)

DeedNFT, Validator, ValidatorRegistry, MetadataRenderer, FundManager, Subdivide, Fractionalize and FractionTokenFactory are all UUPS. The authority is `DEFAULT_ADMIN_ROLE` or `owner()`, according to the contract. `deed_admin_handover.ts` (audit D-13) moves all of it to the Deed timelock, and `assertNoDeployerPowers` checks the result. Phase 3 (trust agreement v5) changes these contracts; its report covers their layouts.

## Not upgradeable

- **Legacy `ClearUSD`** (live on Base). It cannot be upgraded at all, so no admin can swap its logic.
- **Also not upgradeable:** `TimelockController`, `TokenRegistry` (Ownable), `BurnerBond`/`BurnerBondDeposit`, `SavingsIntentFactory`/`SavingsIntentEscrow`, `Create2Deployer`.

## Storage safety of the live contracts

ESADepositVault and ClaimEscrow are live on Base mainnet, so their storage changes are append-only:

- **ESADepositVault:** Phase 2 adds `s_stateSource`, `s_pilotCap`, `s_pilotAlert`, `s_caVolumeByDay`, `s_caWindowTotal`, `s_caWindowFrom`, `s_pilotCapOn`, `s_pausedUntil`, `s_pauseSigner` and `s_pauseWindow`. `__gap` shrinks from 42 to 34, so the layout still ends at slot 400.
- **ClaimEscrow:** unchanged by Phase 2. Its layout still ends at slot 299.

OpenZeppelin's storage upgrade report (`@openzeppelin/upgrades-core` `getStorageUpgradeReport`) finds no errors against each implementation recorded in `.openzeppelin/base.json`: the vault at 0xe626…3644 and 0x83CB…26e9, and ClaimEscrow at 0x96F0…2c4e. A slot-by-slot comparison agrees: no existing variable moved.

The credit contracts exist only on Base Sepolia, where FIX-PLAN allows layout breaks; mainnet gets a fresh deployment of them. PHASE-2-REPORT.md lists the breaks.

**PayoutPool (Phase 2B, addendum 12.10).** Base Sepolia only, but still append-only: the old `nextUnpaid` slot is renamed `legacyNext` in place (`@custom:oz-renamed-from`), four variables for the deadline-ordered queues follow `borrowedFromVault`, and `__gap` shrinks from 25 to 21. Claims queued before an upgrade are paid from a legacy queue in their original order, so no migration call is needed. The authority is unchanged (`DEFAULT_ADMIN_ROLE`, moved to the credit timelock). See `PHASE-2B-PAYOUT-RESERVE.md`.
