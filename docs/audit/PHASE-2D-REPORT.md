# Phase 2d report: DFAL control, ESA vault roles, pilot switch, members-only CLRUSD

Branch `audit/phase-2d-dfal-vault`, based on `dev` with every phase merged, Phase 4 (#891) included; `dev` with Phase 4b (#892) is merged in too (no rebase). Spec: `specs/dfal-vault-send.md` (the addendum verbatim, and the owner's decisions of 2026-11-14 on its conflicts). Also built: rows L-D and L-E of `REREVIEW-DECISIONS.md`, and the owner's decisions on the three conflicts this report first listed (section 4).

Nothing was deployed, no key was used, and no live network was touched.

## 1. What changed

| Item | What changed | Files | Test |
|---|---|---|---|
| Decision 1: governance | A fourth 7-day `TimelockController`, a Clear Financial Co. Safe proposing and executing, no admin. It takes the vault's `DEFAULT_ADMIN_ROLE`, CLRUSD's `UPGRADER_ROLE`, CCIP admin and `DEFAULT_ADMIN_ROLE` (begin/accept, since CLRUSD uses AccessControlDefaultAdminRules), and the token pool's ownership (two-step). The script refuses a delay under 7 days and a Safe whose threshold is under 2. Both contracts leave `credit_timelock_handover.ts`. `scripts/command/safe-handover.ts` (the Ops Safe handover) leaves them out too. | `deploy/vault_timelock_handover.ts` (new), `deploy/credit_timelock_handover.ts`, `scripts/command/handover.ts`, `safe-handover.ts`, `drill_safe_handover.ts`, `UPGRADEABILITY.md` | `deploy/Vault.deploy.spec.ts` |
| 10g: successor trustee | `successorTrusteeCalls`: one timelock batch that grants the successor Safe the proposer, executor and canceller roles, moves operational roles, and revokes the outgoing Safe. Only `grantRole`/`revokeRole`. | `deploy/vault_timelock_handover.ts` | `Vault.deploy.spec` "successor trustee" (reserve and supply unchanged) |
| Decision 2: two-person control | Admin, upgrades, settings and role grants: the Safe through the timelock. Every pause action (vault `pause`/`renewPause`/`unpause`; CLRUSD account and security pauses, renewals and early ends) and the new CA mint pause: two distinct role holders in contract (`_secondSigner`: the first call records the calldata hash, a different holder's identical call carries it out; a proposer who has lost the role no longer counts). `RELAYER_ROLE` stays a single key. | `ESADepositVault.sol`, `ClearUSDUpgradeable.sol` | `Section2d` 37; `rereview/BlindReview` M-A (rewritten); `Dfal` 15, 16 |
| Decision 3: contract-held roles | Unchanged in code: MINTER/BURNER (vault, pool) and LIQUIDATOR (Liquidator) are administered by CLRUSD's default admin, now the vault timelock. | none | `Vault.deploy.spec` (only the Safe, after 7 days, grants LIQUIDATOR_ROLE) |
| 10g: reserve custody | Proven, not changed: the reserve leaves only in `_executeRedeem`, after a one-for-one burn. No registered reserve address is needed (the reserve is the vault's own balance). No sweep, rescue or admin withdrawal. The vault earns nothing (it lends, stakes and approves nothing). Documented in the contract. | `ESADepositVault.sol` (comments) | `Section2d` 35 |
| 12.15, decision 6: members-only CLRUSD | `_update` checks `mayReceive(to)` against `membershipSource` (the AccessManager, whose `isMember` also reads MembershipRegistry). Receipt only, so a de-listed wallet still sends and redeems; the registry logs the de-listing. Exempt: mints, burns, `seize`, and receivers holding MINTER, BURNER or LIQUIDATOR_ROLE (vault, pool, Liquidator). `setMembershipSource` is admin (the timelock). Unset means unrestricted. No screening in any contract. | `ClearUSDUpgradeable.sol`, `deploy/25_wire_Compliance.ts` | `Section2d` 38; `Dfal` 16 |
| 11, decision 7: pilot | The counter, `caVolume`, `setPilotCap`, `PilotAlert` and the revert at the cap are gone; the six retired fields stay in place. New: `pauseCaMints`/`unpauseCaMints(reason)` (two PILOT_ROLE holders, `CaMintsPauseSet` event; only new CA mints; never redemptions or non-CA mints; never automatic), and `setPilotOff` (governance). `deploy/25` no longer sets a cap. | `ESADepositVault.sol`, `deploy/25_wire_Compliance.ts` | `Section2d` 37; `Dfal` 12 (amended) |
| L-E | A mint needs the receiver's state attestation while the pilot is on and a state source is named. A mint is CA when the receiver's state is CA or missing, or the depositor's is CA (see section 3.4). | `ESADepositVault.sol` | `Section2d` "L-E" |
| L-D | `claimToPayoutTreasury(bytes32)` now reverts `ClaimEscrowSignatureRequired`. `claimToPayoutTreasuryWithSignature(transferId, payoutRefHash, signature)` (SETTLER_ROLE) needs an EIP-712 `PayoutClaim(transferId, payoutTreasury, payoutRefHash)` from the claim key or the sender, and logs `PayoutClaimAuthorized`. Card and bank payouts stay (decision 5). No storage change. | `ClaimEscrow.sol` | `Section2d` "L-D"; `ClaimEscrow.spec`; `PeripheralRegressions` H-4 |
| 10f | Checked. One path took a member's wallet USDC, `TermIssuer.collectForMember`; it is retired (section 4.1). | `TermIssuer.sol`, `TermIssuerExtension.sol`, `TermIssuerBase.sol` | `Section2d` 34; `TermIssuer.spec` |
| Owner's decision: redeem intents | The savings-intent factory records its redeem escrows, and CLRUSD exempts them when it is the registered intent factory (`setIntentFactory`, the timelock only). An escrow redeems to itself and forwards the USDC (section 4.2). | `SavingsIntentFactory.sol`, `SavingsIntentEscrow.sol`, `ClearUSDUpgradeable.sol`, `deploy/25_wire_Compliance.ts` | `Section2d` 38 "redeem escrows" |
| Owner's decision: redemption receivers | A plain `redeem` pays only its caller; another receiver needs the holder's signed `Redeem` (section 4.3). | `ESADepositVault.sol` | `Section2d` 35 "a redemption pays the holder" |

Also: `contracts/mocks/MockSafe.sol`, a stand-in Safe with owners and a threshold, for the handover tests. The protocol guide (`docs/protocol/savings.md`), the operator guide (`docs/operators/deploying-contracts.md`), `UPGRADEABILITY.md`, and notes on items 11 and 16 in `specs/compliance-changes.md` are updated.

## 2. Decisions applied

All seven of the addendum's decisions, and L-D and L-E as recorded:
1. The vault timelock, as above. It overrides DECISIONS #10 for the vault and CLRUSD.
2. Two-person everywhere but the relayer. The table in `UPGRADEABILITY.md` lists, for each power, which of the two shapes applies and why.
3. Contract-held roles keep their narrow powers; only the Safe, through the timelock, grants or revokes them.
4. Deposit mandates: the vault's autopay already needs a member-signed `DepositMandate` that is capped (amount per run, runs, cadence, expiry) and revocable (`cancelOwnMandate`, or removing the allowance). Unchanged.
5. ClaimEscrow keeps its card and bank payout path, now signed (L-D).
6. Members-only, receipt only, logged by the registry, with the listed exemptions.
7. The pilot measure is off chain. On chain: no revert at a cap, the two-person `pauseCaMints`, and an off switch. Acceptance 36 is off chain (section 5).

Then the owner's decisions on the three conflicts the first draft listed (section 4):
- the wallet-USDC pull in `TermIssuer.collectForMember` is retired;
- registered savings-intent escrows are exempt from members-only CLRUSD;
- a redemption pays the holder, or a receiver named only by the holder's signature.

No conflict is open.

## 3. Interpretations (not conflicts)

1. **Two-person pauses.** 10c lets one signer pause and a second renew. Decision 2 makes every pause power two-person, so setting, renewing and ending a pause each take two distinct holders. The 10c and M-A rules (72-hour window; the last signer cannot renew, or start a new pause for 30 days) apply to the second signer. Acceptance 15 still holds as written. One effect: a fraud pause needs two people available, which makes it slower to start.
2. **Ending a pause, and clearing the CA mint pause, are two-person too.** The addendum says so for `pauseCaMints` ("set and cleared only by two-person action"), and the same shape is used for the other pauses for consistency.
3. **The membership source is a governed setting.** FIX-PLAN section 7 says not to add admin powers, but decision 6 needs CLRUSD to know where to read membership. `setMembershipSource` is admin-only, so after the handover it is a 7-day Safe proposal. Unset means unrestricted, as for the encumbrance source, so a token that has not been wired still works.
4. **L-E with "no stateCode counts as CA".** Once a state source is named and the pilot is on, every mint needs the receiver's attestation. So "no stateCode counts as CA" only applies on chain while no source is named, and then every mint counts as CA (the CA mint pause stops all mints). Off chain, a member whose attestation is missing still counts as CA. A depositor counts when its own state is attested CA. A depositor with no state (a SavingsIntentEscrow, or a wallet paying in for a member) is counted by its receiver: requiring an attestation of the depositor would refuse those contracts outright.
5. **No registered reserve address.** The reserve is the vault's own balance, so none is added. The only outflow is the redemption.
6. **The token pool** is not built in this repo (its address is recorded by `deploy/15`). The handover begins its two-step ownership transfer when a record exists, and the Safe accepts through the timelock. Inbound CCIP mints to a non-member are exempt, as mints.

## 4. The three conflicts, as the owner decided them

The first draft of this report listed three conflicts. The owner decided each one, and they are built here.

1. **The wallet-USDC pull in `TermIssuer.collectForMember` is retired.**
   - It let a card settler (a Clear key) take what was due on a member's term plans from the member's own wallet, through their allowance to the ledger. The 10f clarification says recovery never uses Ready to allocate USDC.
   - Term dues are swept from Spendable at the bank instead (apps #887).
   - `collectForMember` now reverts `TermIssuerWalletCollectionRetired`. Its code is removed from `TermIssuerExtension`, and the selector stays so callers get a reason.
   - `mandateCollections` stays where it is, no longer written, so no storage moves.
   - The member still pays a plan with their own `payPlan`, and residual carry with `payResidualCarry`; both pull only from the caller.
   - Acceptance 34's reviewed list loses the entry, and the scan now finds no pull from a member's wallet other than the member-signed vault and escrow authorizations.
2. **Registered savings-intent escrows are exempt from members-only CLRUSD.**
   - Escrows are counted only through a factory that Clear Financial registers on CLRUSD (`setIntentFactory`, default admin only, so a Safe proposal and 7 days), as with the other contract-held roles.
   - A redeem escrow is funded before it exists, so the factory records its address when it is announced (`announceIntent`, `CREATOR_ROLE`, deploys nothing; redeem intents only) or provisioned (`isIntentEscrow`).
   - **Two-person control sits on registering the factory, not on each escrow.** Putting every intent through the 7-day timelock would make intents unusable. A recorded address is derived from the config's hash, so it can only ever become the escrow for that config. Its CLRUSD can only be redeemed to that config's receiver or refunded to its depositor.
   - **The depositor-membership check keeps CLRUSD on members-only rails** (the owner's follow-up). Without it, the API's single `CREATOR_ROLE` key could record a redeem escrow whose depositor is a non-member. A member would fund it, and the refund after expiry would carry CLRUSD to the non-member, because an escrow's outflows are exempt.
     - So `announceIntent` and the redeem branch of `_provisionIntent` record an escrow only if the transfer token's `mayReceive(config.depositor)` is true at that moment. Otherwise they revert `SavingsIntentFactoryDepositorNotMember`.
     - It fails closed: a token that does not answer (the legacy ClearUSD, or a reverting membership source) is refused. A token with no membership source answers yes for everyone; recording is then harmless, because nothing is members-only to escape.
     - The check runs once, when the escrow is first recorded. A depositor who was a member then and is de-listed later still gets the refund, and an escrow whose factory is unregistered can still send, since the rule is about receipt.
     - One edge is not covered: an escrow funded while CLRUSD had no membership source, and first provisioned after a source was set and the depositor de-listed, is refused at provisioning. It needs the membership source turned on with escrows already provisioned.
   - Redeem intents work end to end again: the escrow redeems to itself and forwards the USDC (point 3).
   - The factory is not upgradeable, so this needs a new deployment of it (`deploy/19`), which `deploy/25` then registers or names for a timelock proposal.
3. **A redemption pays the holder, or a receiver named by the holder's signature** (as with MB-05 §7.9).
   - A plain `redeem` must pay its caller (`ESADepositVaultReceiverNotRedeemer`).
   - `redeemWithSignature` and `redeemWithAuthorization` already check the holder's EIP-712 `Redeem`, which names the receiver, the amount, a nonce and a deadline. The relayer cannot change any of them; acceptance 35 now shows that.
   - No role can redeem a holder's CLRUSD at all: `burnFrom` needs the holder's own allowance, and only the holder's call or signature reaches it.
   - The Liquidator already redeems to itself. The savings-intent escrow now redeems to itself and forwards exactly what it received to its config's receiver, which the depositor fixed by funding that address.

A gap found while testing, and not changed here: an escrow can only be initialized before its expiry, so an intent that was never provisioned before it expired cannot be refunded. `docs/protocol/savings.md` already says so. The settler should provision every intent before its expiry.

## 5. Acceptance 36 (off chain)

Decision 7 moves it off chain: a mint for a member with no stateCode raises the CA measure, and crossing $35,000 and $45,000 raises an alert. The events needed are all emitted: the vault's `Deposited(caller, receiver, …)` and `Redeemed(caller, receiver, …)`, CLRUSD's `Transfer`, NetworkRegistry's `StateCodeAttested`, and the vault's `CaMintsPauseSet` and `PilotSwitched`. The job counts by depositor and receiver (L-E). For a SavingsIntentEscrow deposit, the depositor is in the escrow's `Finalized` event. No on-chain test covers it.

## 6. Tests, sizes, storage, Slither

- **Tests.** New: `test/audit/compliance/Section2d.spec.ts` (14 tests: acceptance 34 ×2, 35 ×3, 37 ×3 including L-E, 38 ×5, L-D) and `test/deploy/Vault.deploy.spec.ts` (5). Acceptance 34 scans every non-mock contract for ERC-20 pulls from an address other than the caller, and holds each against a reviewed list with its reason. A new pull path, or a stale entry, fails the test. Acceptance 35 lists the vault's state-changing functions exactly. It calls each of the others from every key with seeded random arguments (3 rounds) and checks the reserve is unchanged after each call. Then it runs a redemption and a 10b liquidation, and checks each paid out exactly what it burned. A third test shows a redemption reaches only the holder, or a receiver the holder signed for; the relayer cannot change the receiver or the amount, and no role can redeem the holder's CLRUSD.

  Existing tests changed:

  | File | Change and reason |
  |---|---|
  | `audit/compliance/Dfal.spec.ts` | 12: no revert at a cap (decision 7). 15: the pause takes two signers, and a third renews. 16: the vault pause takes two; de-listing stops receipt only. |
  | `audit/rereview/BlindReview.spec.ts` | M-A: rewritten for two-person pauses with three keys. Each M-A property is still asserted, with the second signer as the pause's signer. |
  | `peripherals/ESADepositVault.spec.ts` | The pause takes two pausers. |
  | `peripherals/ClaimEscrow.spec.ts`, `audit/deep/PeripheralRegressions.spec.ts` | The treasury claim is signed (L-D). |
  | `peripherals/TermIssuer.spec.ts` | "takes only what is due, from the member…" becomes "collectForMember is retired…": the settler is refused even with a mandate and an allowance, nothing leaves the member's wallet, and the member's own `payPlan` clears what is due. "a mandated collection clears residual carry too" becomes the member clearing it with `payResidualCarry`. |
  | `audit/compliance/Section2d.spec.ts` | After the 4b merge, pledges take the member's signature (4b's L-I), through the shared `pledgeSigned` helper. |

  Full suite on the branch with `dev` (Phase 4b) merged in: `npx hardhat test` keeps revert strings, and the fuzz runs at the default 300 steps. **1030 passing, 0 failing**, in 27 minutes. The first draft's run, before the merge and the owner's decisions, was 1003 passing.
- **Sizes** (production build, `npx hardhat compile --force`). No contract is over 24,576 bytes runtime or 49,152 bytes of creation code.

  | Contract | Runtime | Creation code |
  |---|---|---|
  | TermIssuerExtension | 23,252 | 23,389 |
  | TermIssuer | 22,325 | 23,008 |
  | ClearUSDUpgradeable | 15,989 | 16,229 |
  | ESADepositVault | 14,980 | 15,117 |
  | ClaimEscrow | 8,767 | 8,904 |
  | SavingsIntentFactory | 5,034 | 9,203 |
  | SavingsIntentEscrow | 3,319 | 3,429 |
  | MockSafe (test only) | 1,415 | 1,951 |
- **Storage.**
  - OpenZeppelin's `getStorageUpgradeReport` finds no errors for ESADepositVault against both of its implementations in `.openzeppelin/base.json` (0xe626…3644, 0x83CB…26e9), or for ClaimEscrow against 0x96F0…2c4e.
  - Against `.openzeppelin/base-sepolia.json`: the vault's four implementations, ClaimEscrow's one and TermIssuer's six all pass.
  - The vault appends two slots after `s_lastDepositAt`, and its `__gap` goes from 33 to 31.
  - CLRUSD (no manifest entry): its ERC-7201 namespace keeps slots 0 to 4 as on `dev` and appends `proposerOf` (5), `membershipSource` (6) and `intentFactory` (7).
  - ClaimEscrow and TermIssuer add no storage.
  - SavingsIntentFactory is not upgradeable: a new deployment.
- **Slither** (Medium and High, per contract, the FIX-PLAN section 6 way, against the same run on `dev`):

  | Contract | `dev` | this branch | New |
  |---|---|---|---|
  | ESADepositVault | 1 | 1 | none (the audited `arbitrary-send-erc20` on the signed mandate pull) |
  | ClearUSDUpgradeable | 0 | 0 | none |
  | ClaimEscrow | 0 | 0 | none (a first draft drew `uninitialized-local`, a false positive; restructured) |
  | SavingsIntentFactory / SavingsIntentEscrow | 2 | 2 | none (the existing `incorrect-equality` in `refund` and `reentrancy-no-eth` in `finalize`; the escrow is single-use and factory-only) |
  | TermIssuer | 49 | 43 | none: six fewer, all from removing `collectForMember` |
  | TermIssuerExtension | 34 | 29 | none: five fewer, the same reason |

  `dev` here means `dev` with Phase 4b.
- **Generated files and checks** (after the merge):
  - `npx hardhat compile --force && node scripts/command/code-fingerprints.mjs`: `packages/command-types/src/chain/code.json` regenerated (34 contracts), and `--check` passes.
  - `node scripts/docs/contract-reference.mjs`, then `--check`: current (36 pages, built from the deployment ABIs).
  - `node scripts/check-doc-links.mjs`: 199 files, no broken links.
  - `npx turbo run typecheck test --affected`: 32 of 32 tasks passed (28 from turbo's cache).

## 7. App and API follow-up (not in this PR)

1. **OFAC screening before every Send** (12.15). Before submitting any CLRUSD or USDC Send, check the recipient against the digital currency addresses on OFAC's SDN list, refreshed at least daily; block a match and log the result. It lives in the app; no contract screens.
2. **Smart-account module audit** (10f). Confirm that no Privy or AppKit setup gives Clear a delegated or server-side signer, session key or module that can move, freeze or block USDC in a member's smart account. Remove any destination-limit module the member cannot uninstall with their own signature. There is no module contract in this repo to check.
3. **Relayer and role changes.**
   - `apps/api/src/services/sendRelayerService.ts` calls `claimToPayoutTreasury(bytes32)`, which now reverts. The claim page must have the link's claim key (or the sender) sign `PayoutClaim(transferId, payoutTreasury, payoutRefHash)`, and the relayer submits `claimToPayoutTreasuryWithSignature`.
   - Pause tooling: every vault and CLRUSD pause, and the CA mint pause, needs two keys making the same call.
   - The relayer and pause keys are Clear Financial's. `scripts/command/ops-roles.map.json` still maps the vault's legacy `OPERATOR_ROLE` to the savings relayer; it should be `RELAYER_ROLE`, on a Clear Financial key.
   - Attest members' states before naming the vault's state source on a network, or their deposits revert (L-E).
   - Term collections: `apps/api/src/services/chain/termLifecycle.ts` calls `collectForMember`, which now reverts. Clear term dues from Spendable at the bank (apps #887) and retire that job.
   - Redeem intents: deploy the new `SavingsIntentFactory`, register it on CLRUSD through the vault timelock, and call `announceIntent(salt, config)` before showing a redeem address. The API's factory ABI is also stale: `predictIntentAddress` takes `(salt, config)` since H-4.
   - Redemptions: a plain `redeem` must name the caller as receiver. To pay anyone else, the member signs a `Redeem` and the relayer submits it.
4. **Members-only Send UX.**
   - Check `mayReceive(recipient)` before a CLRUSD Send, and explain the refusal.
   - Say that a de-listed member can still send to members and redeem.
   - USDC Sends go to any address.
5. **The off-chain pilot measure** (acceptance 36): counting by depositor and receiver, and alerts at $35,000 and $45,000.

## 8. Notes

- The credit handover's old CLRUSD step would have reverted: it called `grantRole(DEFAULT_ADMIN_ROLE, …)`, which AccessControlDefaultAdminRules refuses. Its test never passed CLRUSD. The vault handover uses begin/accept instead.
- Whoever operates the member registry (the AccessManager's operators, and MembershipRegistry's registrars) now decides who may receive CLRUSD. That is decision 6's design, and it reaches receipt only.
