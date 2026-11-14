# Phase 2g: pause cap and clocks, CLRUSD de-listing, Legacy Contact module

Branch `audit/phase-2g-delisting-legacy`, cut from the Phase 2e head (5a71ca67). This is one half of Phase 2g. The credit-side half (`audit/phase-2g-pauses-workouts`) merges it and opens the PR. Spec: `specs/addendum-4.md` as the owner decided it in `specs/addendum-4-decisions.md` (items 1 to 15 bind this half). Both files are on `audit/phase-2f-earn-pool`.

Nothing was deployed, no key was used, and no live network was touched. The Legacy Contact module has no deploy script (decision 13).

## Summary

| Item | Status |
|---|---|
| 10c renewal cap (decision 2): CLRUSD account pause, CLRUSD security pause, vault pause | Done. Test 49. |
| Owner decision 33: a new pause within 30 days of the last one's end continues it | Done. Seven tests in `Addendum4Delisting` (section 2). |
| Pause clocks (decisions 3 and 4) | Done. The signatures are fixed in `PHASE-2G-PROGRESS.md`, and decision 33 did not change them. |
| 10d de-listing (decisions 7 to 9) | Done. Test 52, plus regressions. |
| 10f Legacy Contact module (decisions 10 to 13) | Done, not deployed. Tests 53 and 54 run on a mock Kernel, and the module is also tested on the real Kernel v3.3 bytecode. |
| Decision 12: the autopay session key | No ZeroDev session key exists. Autopay runs on the vault's signed `DepositMandate`. An app test now pins this (section 1.5). |

No new conflict needs the owner's decision. Section 4 lists the judgement calls. The one gap the first decisions left open (a fresh pause after the cap, 4.1 item 5) is closed by owner decision 33 (section 1.2).

## 1. What changed

### 1.1 10c: the 30-day renewal cap

| | CLRUSD (`ClearUSDUpgradeable`) | Vault (`ESADepositVault`) |
|---|---|---|
| Cap | `PAUSE_MAX_TOTAL = 30 days` (constant). `pauseMaxTotal()` gives the cap in force. `setPauseMaxTotal(x)` is default admin only (the vault timelock). It can only shorten the cap: a value above 30 days reverts `ClearUSDPauseMaxTotalTooLong`, and zero means 30 days. | The same: `PAUSE_MAX_TOTAL`, `pauseMaxTotal()`, `setPauseMaxTotal` (`ESADepositVaultPauseMaxTotalTooLong`). |
| Plain renewal | `renewAccountPause` and `renewSecurityPause` revert `ClearUSDPauseCapReached(capEnd)` if the new end (now + window) would fall after first set + `pauseMaxTotal`. | `renewPause` reverts `ESADepositVaultPauseCapReached(capEnd)` in the same case. |
| Renewal with a legal basis | `renewAccountPauseWithLegalBasis(account, reason, legalBasis, legalBasisHash)` and `renewSecurityPauseWithLegalBasis(reason, legalBasis, legalBasisHash)`. Two-person like every pause action. `legalBasis` is 1 (court order), 2 (other legal process) or 3 (written law-enforcement or regulatory request), and the hash must be non-zero; otherwise `ClearUSDInvalidLegalBasis`. Emits `PauseLegalBasisRecorded(account or 0, legalBasis, hash, until, proposer, approver)`. | `renewPauseWithLegalBasis(legalBasis, legalBasisHash)`, with the same rules; emits `PauseLegalBasisRecorded`. |
| With no valid renewal | The pause lapses at its last end, which is never after day 30. | The same. |
| A new pause within 30 days of the last one's end (owner decision 33) | `pauseAccount` and `pauseForSecurity` continue the chain, and revert `ClearUSDPauseCapReached` if the new window would end past the chain's cap. Past it, `pauseAccountWithLegalBasis(account, reason, legalBasis, legalBasisHash)` or `pauseForSecurityWithLegalBasis(reason, legalBasis, legalBasisHash)` sets it, on the same rules as the legal-basis renewal. | `pause` continues the chain the same way (`ESADepositVaultPauseCapReached`); past it, `pauseWithLegalBasis(legalBasis, legalBasisHash)`. |

- **The cap counts from when the chain began** (owner decision 33, section 1.2). A chain is one pause and every pause of the same kind set less than 30 days after the previous one ended. For a pause that starts a chain, this is when it was set.
  - On CLRUSD this is recorded per account (`accountSpan[account].capStart`) and for each security pause (`securitySpans[i].capStart`).
  - On the vault it is `s_pauseCapStart`.
- **Unchanged:** the 72-hour window, the two-person rule, the M-A rule (the last signer cannot renew), and the M-A rule that the last signer cannot re-pause within 30 days.

### 1.2 Owner decision 33: the pause continuation

**The rule.** A new pause set less than 30 days (`CONTINUATION_PERIOD`) after the last pause of the same kind ended continues that pause. Its cap (`pauseMaxTotal`, at most `PAUSE_MAX_TOTAL`, 30 days) counts from when the first pause of the chain was set, not from now. Going past the cap still needs a two-person action that records a legal basis. This closes the gap in 4.1 item 5: a pause lapses at day 30, and two signers who did not sign it set a fresh one with a new 30 days.

- **The same kind** is the same account for CLRUSD's account pause, the security pause for CLRUSD's security pause, and the vault-wide pause for `ESADepositVault`. Another account's pause is a different kind, so pausing account B never shortens account A's chain, or the reverse.
- **When the last one ended** is its recorded end: the last window's end if it lapsed, or the time of the two-person unpause if it was ended early. An early end does not restart the chain.
- **At or after 30 days** from that end, a new pause starts a new chain and gets a full 30 days.
- **A plain pause past the cap reverts** (`ClearUSDPauseCapReached(capEnd)`, `ESADepositVaultPauseCapReached(capEnd)`), the same as a plain renewal: it reverts if its whole 72-hour window would end after the chain's cap. It does not clamp the window (4.1, item 1).
- **The legal-basis path.** A renewal needs a pause in force, so once a chain's last pause has lapsed there is nothing left to renew. Each kind therefore gains one legal-basis pause, on the same terms as its legal-basis renewal: two distinct holders of the role make the identical call, the code is 1, 2 or 3, the document hash is non-zero, and it emits `PauseLegalBasisRecorded` (with `account` zero for CLRUSD's security pause).
  - CLRUSD: `pauseAccountWithLegalBasis(account, reason, legalBasis, legalBasisHash)` (FRAUD_ROLE) and `pauseForSecurityWithLegalBasis(reason, legalBasis, legalBasisHash)` (SECURITY_ROLE).
  - Vault: `pauseWithLegalBasis(legalBasis, legalBasisHash)` (PAUSER_ROLE).
  - It continues the chain too, so its renewals past the cap still need the two-person `renew…WithLegalBasis`, one 72-hour window each.
  - It is no new power. Before decision 33 the plain pause could do all of this without a legal basis. The M-A rules still apply to it: no new pause while one is in force, and the last signer waits 30 days.
- **Pauses from before Phase 2g** have no recorded chain (`capStart` zero), so a new pause after one starts its own chain. A renewal of one still needs a legal basis (fails closed), as before.
- **Storage.**
  - CLRUSD: `PauseSpan` and `SecuritySpan` each gain a `uint64 capStart`. Both still fit one slot. Both are Phase 2g structs inside the ERC-7201 namespace, which no deployed implementation has yet.
  - Vault (live on mainnet): the Phase 2g fields share the slot of `s_pilotOff`/`s_caMintsPaused`/`s_caPauseReason`, so `__gap` stays at 31. To fit the new `s_pauseCapStart` there, the two timestamps are `uint40` (`s_pauseStartedAt`, `s_pauseCapStart`) and `s_pauseMaxTotal` is `uint32` (it is never above 30 days): 6 + 5 + 5 + 8 + 4 = 28 bytes. None of these fields is in any deployed implementation, so narrowing them changes no live layout.
- **The pause-clock views are unchanged:** `pauseClock(address)`, `isPauseInForce(address)`, and the vault's `pauseClock()` and `isPauseInForce()`.

### 1.2a Pause clocks (decisions 3 and 4)

The credit side calls these views. They are fixed at the top of `PHASE-2G-PROGRESS.md`.

- `ClearUSDUpgradeable.pauseClock(address account) returns (uint256)`
  - It counts the seconds, up to now, in which the security pause or that account's pause was in force. Time when both were in force counts once.
  - It never decreases.
  - `pauseClock(address(0))` gives the security pause alone, since `pauseAccount(address(0))` now reverts (`ClearUSDZeroAccount`).
- `ClearUSDUpgradeable.isPauseInForce(address account) returns (bool)`
- `ESADepositVault.pauseClock() returns (uint256)` and `ESADepositVault.isPauseInForce() returns (bool)`, for the vault-wide pause.

How CLRUSD counts it:
- Security pauses never overlap, so they are kept as a list of spans. Each span records its start and the clock before it, so the clock at any past time is a binary search.
- Each account keeps its current span (its start, and the security clock at that start), plus the seconds in earlier spans when it alone was paused.
- An account's clock is the security clock plus the account-only seconds. The account-only seconds in a span are the span's length minus the security time inside it.
- A span is closed into the account's total when the next pause on that account is set. The early end (`_end`) only ever moves an end back to now.

The vault keeps one span (`s_pauseStartedAt`, `s_pausedUntil`) and the earlier total (`s_pauseClockBefore`).

### 1.3 10d: CLRUSD's own listing

| Function | Who | What it does |
|---|---|---|
| `mayReceive(wallet)` | view | Exempt addresses first: MINTER, BURNER or LIQUIDATOR_ROLE. Then a listed wallet may receive and a de-listed one may not. A wallet never recorded gets the registry's live answer, or a registered redeem escrow's exemption. With no source set, everyone may receive. |
| `syncListing(wallet)` | anyone | Records LISTED if the governed registry reports the wallet as a member. It never touches a wallet that is already recorded. |
| (in `_update`) | automatic | The first receipt or mint to a member wallet records it as LISTED (`WalletListed`). |
| `recordFraudNotice(wallet, noticeHash)` | one `LISTING_ROLE` key | Starts the 10-day FRAUD notice. Recording it again restarts the period. |
| `delist(wallet, reasonCode, decisionHash)` | two `LISTING_ROLE` keys | `reasonCode` is 1 MEMBERSHIP_ENDED, 2 HOLDER_REQUEST or 3 FRAUD; anything else reverts `ClearUSDInvalidReasonCode`. The decision hash must be non-zero. FRAUD also needs a notice recorded at least 10 days before the second call (`ClearUSDFraudNoticeRequired`). Emits `WalletDelisted(wallet, reasonCode, decisionHash, proposer, approver)`. |
| `relist(wallet, decisionHash)` | two `LISTING_ROLE` keys | Only for a de-listed wallet that the registry reports as a member now. Emits `WalletRelisted`. |
| `listingOf(wallet)` | view | Returns `(status, reasonCode, fraudNoticeAt)`. |

- **What no longer affects receipt.** For a recorded wallet, expiry, tier and status changes, `revokeMember` and `unlinkWallet` have no effect.
- **What a de-listing never stops.** The wallet can still send to listed wallets and redeem (a burn is exempt). Its pledge lock still holds, and `seize` still works.
- **Mints stay exempt**, as Phase 2d decision 6 set.
- **Swapping the registry** stays a timelock action at both levels:
  - CLRUSD's `setMembershipSource` is the vault timelock's;
  - AccessManager's `setMembershipRegistry` is the credit timelock's.
- **StableCredit** is unchanged (decision 9).
- **The savings-intent factory's depositor check** (Phase 2d) is unchanged in code. It calls `mayReceive`, so it now reads the listing: a de-listed depositor is refused, and a listed depositor whose registry membership lapsed is accepted. Tested.
- **12.15 wording.** `specs/dfal-vault-send.md` now reads: "A de-listing may stop receipt only, never sending or redemption (10d)." The old text is kept in a note, and `specs/compliance-changes.md` records the amendment.
- **Who holds the role.** `LISTING_ROLE` is new. The vault timelock grants it, like FRAUD_ROLE (`deploy/vault_timelock_handover.ts`: `LISTING_SIGNERS`, and it is in `CLRUSD_ROLES`).

### 1.4 10f: `LegacyContactModule` (new, not deployed)

`contracts/peripherals/LegacyContactModule.sol` is an ERC-7579 executor (type 2) with one deployment shared by every account. It holds no admin, owner, upgrade or role.

- **Constructor:** `(address ecdsaValidator, address[] clearAddresses)`.
  - `ecdsaValidator` is an immutable. For Kernel v3.1 to v3.3 it is ZeroDev's `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57`.
  - The Clear list is written only here (decision 11). No address on it can be a contact, or the key a recovery hands the account to.
- **The member, through the account:**
  - `onInstall(abi.encode(address[] contacts, uint64 wait))`: one to 10 contacts, with no zero, duplicate, self or Clear address. A wait of 0 means 90 days; under 30 days reverts.
  - `setContacts`, `setWait` and `cancelRecovery`.
  - `onUninstall`, which clears everything.
  - Every setter acts on `msg.sender`'s own record. Kernel lets only the EntryPoint, the account itself or the root key install or uninstall.
- **A contact:**
  - `requestRecovery(account, newOwner)`. One request is open at a time. It records the key it names and the wait in force, and emits `RecoveryRequested(account, contact, newOwner, executableAt)` so the app can notify the member.
  - `recover(account)`: only the contact who opened the request, still a contact, at or after `executableAt`, and only if the account's root validator is `0x01 ‖ ECDSA_VALIDATOR`.
- **The one call.** `recover` builds `ECDSA_VALIDATOR.onInstall(abi.encodePacked(newOwner))` itself, sends it through `executeFromExecutor` in single mode with zero value, and checks afterwards that the validator's owner is `newOwner`. No function takes calldata from a caller.
- **Kernel's API, checked against the source** (cited in the contract's header):
  - Kernel v3.3 (tag v3.3, cd697c7e) and v3.1 (03f7f5cf) have `executeFromExecutor(bytes32, bytes) returns (bytes[])`, `isModuleInstalled` and `rootValidator() returns (bytes21)`.
  - The v3.1 to v3.3 ECDSAValidator has no owner setter. Its `onInstall` writes `ecdsaValidatorStorage[msg.sender].owner` without checking for an earlier owner, so a call from the account rewrites only that account's owner. That is the one call the module can make.
  - The account's own module records (validators, executors, hooks, root validator) are not touched; the real-Kernel test checks this.
- **The member app** (`apps/member`) neither builds nor shows it (decision 13).

### 1.5 Decision 12: the autopay session key

- **What the code does.** There is no ZeroDev session key anywhere in the member app or the API.
  - `apps/member/src/lib/autopay.ts` has the member sign the vault's `DepositMandate`, and either a USDC `permit` or a sponsored `approve` to the vault.
  - The API's relayer can then only submit `executeMandateDeposit`. The vault checks that call against the member's signature, amount per run, run count, cadence and expiry.
  - So no Clear key can install or remove a module, configure the Legacy Contact module, or call `confirmRoll`. There is no call policy to narrow.
- **What was changed:**
  - `apps/member/src/lib/autopayScope.test.ts` (new, bun) fails if any member-app source imports `@zerodev/permissions` or uses a session-key or permission-validator API. It also fails if any source encodes `installModule`, `uninstallModule`, `confirmRoll` or `LegacyContact`. And it pins autopay's two EIP-712 types (`DepositMandate`, `Permit`) to the vault. If a session key is ever added, the person adding it must change this test and give the key a call policy limited to the savings-deposit call.
  - The stale comments in `apps/api/src/services/autopayStore.ts` and `apps/api/src/routes/autopay.ts`, which described a ZeroDev session, now describe the mandate.
  - The app commit carries no `[skip preview]`.
- **Not changed:** `@zerodev/permissions` is still listed in `apps/member/package.json` but nothing imports it. Removing it changes the lockfile, which is left for an app PR.
- **Out of scope here.** "`confirmRoll` accepts only the root key's signature" is the bond side (Phase 2f).

### 1.6 Other files

- Mocks (test only):
  - `contracts/mocks/MockKernelAccount.sol`, with the Kernel v3.3 executor path, the install format and `onlyEntryPointOrSelfOrRoot`;
  - `contracts/mocks/MockKernelECDSAValidator.sol`, with the v3.1 to v3.3 owner bookkeeping.
- `test/fixtures/kernel-v3.3.json` holds the ABI and bytecode of the real Kernel v3.3, KernelFactory and ECDSAValidator. They were compiled from ZeroDev's tag, with its pinned solady and ExcessivelySafeCall commits. The fixture records the build command. It is test-only and never deployed.
- Docs:
  - `docs/protocol/savings.md`: the members-only and de-listing section, the 10c pauses and the vault roles;
  - `docs/audit/UPGRADEABILITY.md`: the two-person table;
  - `specs/dfal-vault-send.md` and `specs/compliance-changes.md`: the 12.15 edit.

## 2. Tests

New:

- **`test/audit/compliance/Addendum4Delisting.spec.ts`** (24 tests):
  - **Test 49**, run on each of CLRUSD's account pause, CLRUSD's security pause and the vault pause.
    - A pause is renewed every 72 hours less a minute by a rotating second signer. Nine renewals go through. The tenth reverts on the cap.
    - With a legal basis, the renewal is two-person and emits its event. Bad codes, a zero hash and the same signer revert. Past day 30, a plain renewal still reverts.
    - Without a legal basis, the pause lifts at its last end.
  - **Owner decision 33**, run on each of CLRUSD's account pause, CLRUSD's security pause and the vault pause (6 tests), plus one CLRUSD test:
    - A pause is renewed to the cap and lapses at day 30. Two holders who signed nothing in the chain set a fresh pause at once: it reverts `…PauseCapReached` with the first pause's start + 30 days. The legal-basis pause then goes through (two-person; the same signer twice reverts; it emits `PauseLegalBasisRecorded`). A plain renewal of it reverts on the same cap, and the legal-basis renewal carries it one more window, after which it lapses.
    - A fresh pause one second before 30 days after the last end reverts on the old cap. At exactly 30 days it starts a new chain: nine renewals go through and the tenth reverts on the new start + 30 days.
    - An early end (`unpauseAccount`) does not restart the chain: a new pause 10 days later reverts on the first start's cap. Another account's pause is a different kind and runs past it.
  - **`pauseMaxTotal`.** Above 30 days reverts on both contracts. Only the admin may set it. A shorter cap binds.
  - **Pause clocks.**
    - CLRUSD:
      - overlapping security and account pauses count once;
      - the clock moves second by second during a pause;
      - an early end counts only to the end;
      - an account span closed after a later security pause reads the history;
      - `pauseClock(0)` is the security pause alone, and the clock never decreases.
    - The vault: lapsed pauses, early ends and a third pause.
  - **Test 52.**
    - A transfer to a de-listed wallet reverts.
    - The de-listed holder still sends to a listed member and redeems.
    - A same-signer removal reverts, as do a missing or invalid reason code, a zero decision hash and other roles (including the admin).
    - Every reason code emits `WalletDelisted`.
    - FRAUD with no notice reverts, and so does an approval one second before 10 days.
  - **Listing regressions.**
    - `revokeMember`, status, tier and expiry changes and `unlinkWallet` no longer stop a listed wallet's receipt.
    - An unrecorded wallet follows the registry and is recorded at first receipt.
    - Re-listing is two-person, only for a current member, and never happens through `syncListing` or the registry.
    - De-listing leaves the pledge lock and `seize` alone.
    - The factory's depositor check reads the listing.
  - **Test 53.**
    - Install, configure and uninstall work only through the member's account. Every Clear key, the contact and a stranger revert.
    - Under 30 days reverts, and the default is 90 days.
    - Every Clear address is refused as a contact.
  - **No Clear role can reach the module.**
    - Its state-changing functions are exactly these seven: `cancelRecovery`, `onInstall`, `onUninstall`, `recover`, `requestRecovery`, `setContacts` and `setWait`. It has no fallback.
    - Every Clear key's call on it reverts, or acts only on that key's own empty record.
    - A recovery can never name a Clear address as the new owner.
  - **Test 54.**
    - A request cancelled by the member's one call leaves the owner unchanged.
    - An uncancelled one reverts one second before the full wait. At the wait it rotates the owner, and nothing else in the account changes.
    - These calls by the contact revert, on the module and on the account: transfer, approve, burn, redeem, mint, pledge, Pledge Module change, install and uninstall, execute, executeFromExecutor, pause and unpause, and the hold.
    - After the rotation, the old key is out, the pledge lock still binds and a 10c pause still blocks.
  - Recovery fails closed when the root validator is not the module's ECDSA validator.
- **`test/audit/compliance/LegacyContactKernel.spec.ts`** (2 tests) runs on the real Kernel v3.3 account (via KernelFactory) and ECDSAValidator bytecode:
  - only the owner installs and configures the module, through Kernel's root hook;
  - a cancelled request changes nothing;
  - one second early reverts;
  - at the full wait the root ECDSA owner rotates, and the root validator and module records are unchanged;
  - the old key is out and the new key in;
  - only the new owner uninstalls.

  Decision 10's fork test on a live Kernel account is still due before the external audit (section 5).
- **`apps/member/src/lib/autopayScope.test.ts`** (3 tests, bun): decision 12.

Changed:

| File | Change and reason |
|---|---|
| `audit/compliance/Section2d.spec.ts` | Acceptance 35's list of the vault's state-changing functions gains `pauseWithLegalBasis`, `renewPauseWithLegalBasis` and `setPauseMaxTotal`. The de-listing test now de-lists with the two-person `delist`, after showing that `revokeMember` no longer stops a listed wallet's receipt (decision 7). |
| `audit/compliance/Dfal.spec.ts` | Acceptance 16's list of pause functions gains the legal-basis pauses and renewals, `pauseMaxTotal`/`setPauseMaxTotal`, `pauseClock` and `isPauseInForce`. The listing functions are pinned too. The de-listing step uses `delist`. |

**Specs run.** The owner's process change: no full local run; CI runs the full suite on the 2g PR. Every spec that uses CLRUSD, the vault, MembershipRegistry, the savings-intent factory, the vault handover or AccessManager directly (found by grep), plus the deed specs whose fixture deploys MembershipRegistry: **306 passing, 0 failing** (7 minutes), on these 30 files:
  - `test/audit/`: `AuditPoC2`, `AuditPoC3`;
  - `test/audit/compliance/`: `Addendum4Delisting`, `Assurance`, `Dfal`, `LegacyContactKernel`, `PledgedBonds`, `ReserveUntouched`, `Revolving`, `Section12Liquidator`, `Section2d`;
  - `test/audit/deep/`: `PeripheralRegressions`, `LowFindings`;
  - `test/audit/rereview/`: `BlindReview`, `Decisions`, `DeedInvariants`;
  - `test/audit/deed/`: `DeedDeployAndMisc`, `DeedLifecycle`, `DeedMetadata`, `SubdivideFractionalize`, `TrustV5Core`, `TrustV5Transfers`;
  - `test/deploy/`: `Vault.deploy`, `Compliance.deploy`, `CreditCore.deploy`;
  - `test/peripherals/`: `ClearUSDUpgradeable`, `ESADepositVault`, `Liquidator`, `MembershipRegistry`, `SavingsIntentFactory`.

  That run started before the three small Slither fixes (section 3). After them, the seven specs those fixes touch were rerun: `Addendum4Delisting`, `LegacyContactKernel`, `Section2d`, `Dfal`, `ClearUSDUpgradeable`, `ESADepositVault` and `Vault.deploy`. Result: **65 passing, 0 failing**.

  **After owner decision 33**, every spec that uses CLRUSD's or the vault's pauses or pins their function lists (found by grep), plus the specs that deploy and hand over both contracts: **135 passing, 0 failing** (2 minutes), on these 10 files:
  - `test/audit/compliance/`: `Addendum4Delisting`, `Assurance`, `Dfal`, `LegacyContactKernel`, `Section2d`;
  - `test/audit/rereview/`: `BlindReview`, `Decisions`;
  - `test/peripherals/`: `ClearUSDUpgradeable`, `ESADepositVault`;
  - `test/deploy/`: `Vault.deploy`.

## 3. Checks

- **Sizes** (production build, `npx hardhat compile --force`): no artifact is over 24,576 bytes runtime or 49,152 bytes initcode. The figures are after owner decision 33.

  | Contract | Runtime (bytes) | Initcode (bytes) |
  |---|---|---|
  | ClearUSDUpgradeable | 21,949 | 22,189 |
  | ESADepositVault | 17,147 | 17,284 |
  | LegacyContactModule | 5,358 | 5,748 |
  | SavingsIntentFactory (unchanged) | 5,273 | 9,442 |
- **Storage** (OpenZeppelin `getStorageUpgradeReport`, against the layout of the current build):
  - ESADepositVault: no errors against both `.openzeppelin/base.json` implementations (0xe626…3644, 0x83CB…26e9) and the four Base Sepolia ones (0x4163…B77e, 0x4d77…A22f, 0x6Bb2…B48F, 0x99Ea…c455), rerun after owner decision 33. The four new fields (`uint40`, `uint40`, `uint64`, `uint32`) pack into the slot of `s_pilotOff`/`s_caMintsPaused`/`s_caPauseReason`, which used 6 of its 32 bytes (28 now), so `__gap` stays at 31.
  - ClaimEscrow: unchanged; no errors against base (0x96F0…2c4e) and Base Sepolia.
  - ClearUSDUpgradeable: no errors against the Base Sepolia implementation 0xB1beB71b… (namespace `clear.storage.ClearUSD`). It only appends `pauseMaxTotal`, `accountSpan`, `securitySpans` and `listing` to the ERC-7201 struct. Rerun after owner decision 33.
  - MembershipRegistry: unchanged; no errors against Base Sepolia 0x3520A113….
- **Slither** (Medium and High, per contract, the FIX-PLAN section 6 way, against the same run on `origin/dev`):

  | Contract | `dev` | this branch |
  |---|---|---|
  | ClearUSDUpgradeable | 0 | 0 |
  | ESADepositVault | 1 | 1 (the audited `arbitrary-send-erc20` on the signed mandate pull) |
  | LegacyContactModule | new | 0 |

  Rerun after owner decision 33, on this branch and on `origin/dev`: the same counts (0 and 1), and the same finding.

  A first run flagged three findings, all fixed: `uninitialized-local` in the clock search, `incorrect-equality` in the vault's `pauseClock`, and `unused-return` on `executeFromExecutor` (the module now checks it got exactly one result).
- **Generated files:** `packages/command-types/src/chain/code.json` was stale for ClearUSDUpgradeable and ESADepositVault, so it was regenerated; `code-fingerprints.mjs --check` now passes (34 contracts). `contract-reference.mjs --check` reports `docs/protocol/contracts` current (36 contracts). `check-doc-links.mjs`: 205 files, no broken links. After owner decision 33, `code.json` was regenerated again: `--check` passes (34 contracts), `contract-reference.mjs --check` is current (36 contracts), and `check-doc-links.mjs` reports 206 files, no broken links.
- **`npx turbo run typecheck test --affected`** (Node 22, bun, `TURBO_SCM_BASE=origin/dev`): 5 of 5 tasks passed: `@clear/command-types` typecheck, `@clear/command` typecheck and test, and `@clear/member` typecheck and test (853 tests, the 3 new ones included).

## 4. Judgement calls

### 4.1 Pauses

1. **"Would carry it past" reverts rather than clamps.** A plain renewal (and, since owner decision 33, a plain pause that continues a chain) reverts if its full 72-hour window would end after day 30. So the last plain renewal is at day 27 at the latest, and it ends the pause at day 30 at the latest. Clamping the last window would let a renewal at day 29 run to day 30 exactly. Test 49 reads as a revert, so a revert is built.
2. **Legal basis.** The renewal's "own reason code" is the legal-basis code: 1 court order, 2 other legal process, 3 written law-enforcement or regulatory request. The case reason (`reason`) is kept as before.
   - Each renewal past the cap needs its own legal basis, and still lasts one 72-hour window.
   - A legal-basis renewal is allowed before day 30 too: it is only stricter.
3. **`setPauseMaxTotal` is new and only narrows.** It is the admin's (the timelock's), and it can only lower the cap. Test 49 needs a setter that reverts above 30 days.
4. **Pauses from before Phase 2g.** They have no recorded start.
   - A renewal of one needs a legal basis (fails closed).
   - The clocks do not count them.
   - Upgrade while no pause is in force; none is expected.
5. **A fresh pause after the cap: closed by owner decision 33.** When a pause lapsed at day 30, a new pause on the same account (or a new security or vault pause) could be set at once by two holders who did not sign the last one, and it got a new 30 days. Phase 4 M-A's 30-day cooldown binds only the last signer, so with three or more keys a new pair could chain pauses. The owner adopted the recommendation: a new pause within 30 days of the last one's end continues its chain (section 1.2).

### 4.2 De-listing

1. **How a wallet becomes listed.** "Listing follows registration":
   - a wallet is recorded as listed the first time the governed registry reports it as a member and it receives CLRUSD or a mint, or when anyone calls `syncListing`;
   - a wallet never recorded falls back to the registry's live answer, so nothing changes for wallets in use today.

   The gap: a member wallet that was never recorded, and whose membership then lapses, follows the registry. The app should call `syncListing` at registration and on every `linkWallet`, and once for existing members after the upgrade (section 5).
2. **Re-listing is no back door.**
   - Only a two-person `relist` brings a de-listed wallet back, and only while the registry reports it as a member.
   - `syncListing`, receipt and the registry never touch a de-listed wallet.
   - It is logged with a decision hash.
3. **The FRAUD notice.**
   - One `LISTING_ROLE` key records it. It changes nothing by itself and only starts the 10-day clock. The removal itself is two-person.
   - It is cleared when the wallet is de-listed. Recording it again restarts the clock.
   - It has no expiry: an old notice still counts for a later FRAUD removal. If the owner wants one, a "notice valid for N days" bound is a small change.
4. **Mints to a de-listed wallet are still credited.** Phase 2d decision 6 exempts mints, and a de-listed holder depositing their own USDC is not a transfer to them. A third party's deposit naming a de-listed receiver would also mint. Say if mints should read the listing too.
5. **The intent-escrow exemption is read only for a wallet that is not recorded.** Two `LISTING_ROLE` keys could de-list an escrow address, which would refuse its funding. Nothing does that by itself.
6. **`pauseAccount(address(0))` now reverts.** Pausing the zero address never blocked anything, and refusing it keeps `pauseClock(address(0))` meaning the security pause alone.

### 4.3 Legacy Contact

1. **The owner is rotated through the validator's `onInstall`.**
   - The v3.1 to v3.3 ECDSAValidator has no other owner setter, and its `onInstall` overwrites the calling account's owner.
   - The module calls it from the account. It does not call Kernel's `installModule`, so no module is installed or uninstalled; the real-Kernel test checks that the root validator and the module records are unchanged.
   - It does not work with the v3.0 validator (0x8104e3…), which refuses a second `onInstall`. Recovery then reverts; it fails closed.
2. **EIP-7702 accounts are not covered.** `apps/member/src/lib/aa.ts` delegates external wallets' EOAs to Kernel v3.3 under EIP-7702. Those accounts validate against the EOA's own key, which no module can rotate, and their root validator is not the ECDSA validator, so `recover` reverts. Legacy Contact applies to Privy smart wallets (Kernel with the ECDSA validator as root). The app must offer it only there.
3. **Request rules.**
   - One open request at a time.
   - The key is named when the request opens, so the member's notification can show it.
   - Only the contact who opened it can execute it, and only while still a contact.
   - Any reconfiguration (`setContacts`, `setWait`, reinstall) cancels an open request.
   - The wait is the one in force when the request opened.
   - At most 10 contacts, to bound the loops.
4. **The Clear list** is stored in a mapping that only the constructor writes; Solidity cannot hold an immutable array. It also bars Clear addresses as the recovered owner, not only as contacts.

## 5. App and API follow-ups (not in this branch)

1. **De-listing tooling.** Two-key `delist` and `relist` (both keys make the identical call), `recordFraudNotice`, and the written-notice workflow: notice, at least 10 days to respond, then the decision record whose hash goes on chain. Grant `LISTING_ROLE` to at least two Clear Financial keys through the vault timelock (`LISTING_SIGNERS`).
2. **Listing sync.** Call `syncListing(wallet)` after `registerMember`, `grantMember` and `linkWallet`, and once for every existing member wallet after the CLRUSD upgrade (anyone may call it; it writes only what the registry says).
3. **Send UX.** Check `mayReceive(recipient)` before a CLRUSD Send. Explain that a de-listed wallet can still send to members and redeem. Show the reason code to the holder.
4. **Pause tooling.**
   - Renewals must be timed so the last plain one lands by day 27.
   - A new pause of the same kind less than 30 days after the last one ended continues its chain (owner decision 33). The tooling should show the chain's cap before the first key signs, and collect a legal basis for the `pause…WithLegalBasis` call when the new window would end past it.
   - Past day 30, the tooling must collect the legal-basis code and document hash for each renewal, with two keys.
   - The credit side reads `pauseClock`.
5. **Legacy Contact screens, kept hidden until the module is audited and published in MB-03 Schedule 2 (decision 13).**
   - Install, configure and uninstall through the member's own signature.
   - Notify the member on every channel at once when a `RecoveryRequested` event names their account, and offer a one-tap cancel (`cancelRecovery` from the account).
   - Offer it only to Privy Kernel smart wallets whose root validator is ZeroDev's v3.1+ ECDSA validator, never to 7702-delegated EOAs.
   - The deployment's Clear address list must name every Clear entity address.
6. **Before the external audit:** decision 10's test of the module on a real Kernel account on a fork, with a real Privy owner key and a real user operation through the EntryPoint.
7. **Dependency tidy-up:** remove the unused `@zerodev/permissions` from `apps/member/package.json`.
