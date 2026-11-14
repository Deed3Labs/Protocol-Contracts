# Phase 2d report: DFAL control, ESA vault roles, pilot switch, members-only CLRUSD

Branch `audit/phase-2d-dfal-vault`, based on `dev` with every phase merged, Phase 4 (#891) included. Spec: `specs/dfal-vault-send.md` (the addendum verbatim, and the owner's decisions of 2026-11-14 on its conflicts). Also built: rows L-D and L-E of `REREVIEW-DECISIONS.md`.

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
| 10f | Checked, nothing to change in the contracts (section 4.1). | none | `Section2d` 34 |

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

## 3. Interpretations (not conflicts)

1. **Two-person pauses.** 10c lets one signer pause and a second renew. Decision 2 makes every pause power two-person, so setting, renewing and ending a pause each take two distinct holders. The 10c and M-A rules (72-hour window; the last signer cannot renew, or start a new pause for 30 days) apply to the second signer. Acceptance 15 still holds as written. One effect: a fraud pause needs two people available, which makes it slower to start.
2. **Ending a pause, and clearing the CA mint pause, are two-person too.** The addendum says so for `pauseCaMints` ("set and cleared only by two-person action"), and the same shape is used for the other pauses for consistency.
3. **The membership source is a governed setting.** FIX-PLAN section 7 says not to add admin powers, but decision 6 needs CLRUSD to know where to read membership. `setMembershipSource` is admin-only, so after the handover it is a 7-day Safe proposal. Unset means unrestricted, as for the encumbrance source, so a token that has not been wired still works.
4. **L-E with "no stateCode counts as CA".** Once a state source is named and the pilot is on, every mint needs the receiver's attestation. So "no stateCode counts as CA" only applies on chain while no source is named, and then every mint counts as CA (the CA mint pause stops all mints). Off chain, a member whose attestation is missing still counts as CA. A depositor counts when its own state is attested CA. A depositor with no state (a SavingsIntentEscrow, or a wallet paying in for a member) is counted by its receiver: requiring an attestation of the depositor would refuse those contracts outright.
5. **No registered reserve address.** The reserve is the vault's own balance, so none is added. The only outflow is the redemption.
6. **The token pool** is not built in this repo (its address is recorded by `deploy/15`). The handover begins its two-step ownership transfer when a record exists, and the Safe accepts through the timelock. Inbound CCIP mints to a non-member are exempt, as mints.

## 4. Conflicts found (not resolved: for the owner)

1. **TermIssuer's autopay takes Ready-to-allocate USDC.** `TermIssuerExtension.collectForMember` lets a card settler (a Clear key) pull USDC from the member's own wallet, through the member's allowance to the ledger. It is limited to members who switched automatic repayment on, to what is due, and to once per ref. The addendum's 10f clarification says automatic clearing never uses Ready-to-allocate USDC. Decision 4 allows Autopay from "a member-signed, capped, revocable mandate". The mandate here is the member's own `setAutoRepay` call or signed `AutoClear`, and it is revocable, but its cap is "what is due", not an amount the member set. Options: (a) accept it under decision 4; (b) cap it by an amount the member signs; (c) pull from the settler's funds, as `RevolvingIssuerCycles.repayForMember` already does. TermIssuer is Phase 4b's file, so nothing is changed here. It is the one entry in acceptance 34's reviewed list that needs a ruling.
2. **Savings redeem intents and members-only CLRUSD.** A redeem intent has the member send CLRUSD to a predicted `SavingsIntentEscrow` address, which is not a member. Once `membershipSource` is set, that transfer reverts. Decision 6 exempts the vault, the Liquidator, the pool and burns, not intent escrows. Options: (a) the API registers the predicted address as a member before the member funds it; (b) retire redeem intents for the signed gasless redeem; (c) a governed list of exempt receivers. Deposit intents are not affected.
3. **"A 1:1 redemption to the redeeming holder."** The vault pays whatever receiver the redeemer names in their own call or signature, and two contracts rely on that: the SavingsIntentEscrow, and the Liquidator, which redeems to itself and settles the debt. This was kept. A member redeeming to another address is the same as redeeming and then sending USDC, which 12.15 allows. If 10g means the receiver must be the redeemer, the change is small, but it breaks redeem intents.

## 5. Acceptance 36 (off chain)

Decision 7 moves it off chain: a mint for a member with no stateCode raises the CA measure, and crossing $35,000 and $45,000 raises an alert. The events needed are all emitted: the vault's `Deposited(caller, receiver, …)` and `Redeemed(caller, receiver, …)`, CLRUSD's `Transfer`, NetworkRegistry's `StateCodeAttested`, and the vault's `CaMintsPauseSet` and `PilotSwitched`. The job counts by depositor and receiver (L-E). For a SavingsIntentEscrow deposit, the depositor is in the escrow's `Finalized` event. No on-chain test covers it.

## 6. Tests, sizes, storage, Slither

- **Tests.** New: `test/audit/compliance/Section2d.spec.ts` (12 tests: acceptance 34 ×2, 35 ×2, 37 ×3 including L-E, 38 ×4, L-D) and `test/deploy/Vault.deploy.spec.ts` (5). Acceptance 34 scans every non-mock contract for ERC-20 pulls from an address other than the caller, and holds each against a reviewed list with its reason. A new pull path, or a stale entry, fails the test. Acceptance 35 lists the vault's state-changing functions exactly. It calls each of the others from every key with seeded random arguments (3 rounds) and checks the reserve is unchanged after each call. Then it runs a redemption and a 10b liquidation, and checks each paid out exactly what it burned.

  Existing tests changed:

  | File | Change and reason |
  |---|---|
  | `audit/compliance/Dfal.spec.ts` | 12: no revert at a cap (decision 7). 15: the pause takes two signers, and a third renews. 16: the vault pause takes two; de-listing stops receipt only. |
  | `audit/rereview/BlindReview.spec.ts` | M-A: rewritten for two-person pauses with three keys. Each M-A property is still asserted, with the second signer as the pause's signer. |
  | `peripherals/ESADepositVault.spec.ts` | The pause takes two pausers. |
  | `peripherals/ClaimEscrow.spec.ts`, `audit/deep/PeripheralRegressions.spec.ts` | The treasury claim is signed (L-D). |

  Full suite: FILL_TESTS
- **Sizes** (production build, `npx hardhat compile --force`): FILL_SIZES No contract is over 24,576 bytes runtime or 49,152 bytes of creation code.
- **Storage.** OpenZeppelin's `getStorageUpgradeReport` finds no errors for ESADepositVault against both of its implementations in `.openzeppelin/base.json` (0xe626…3644, 0x83CB…26e9), or for ClaimEscrow against 0x96F0…2c4e. FILL_STORAGE The vault appends two slots after `s_lastDepositAt`, and its `__gap` goes from 33 to 31. CLRUSD appends two members to the end of its ERC-7201 struct. ClaimEscrow adds no storage.
- **Slither** (Medium and High, per contract, the FIX-PLAN section 6 way, against the same run on `dev`):

  | Contract | `dev` | this branch | New |
  |---|---|---|---|
  | ESADepositVault | 1 | 1 | none (the audited `arbitrary-send-erc20` on the signed mandate pull) |
  | ClearUSDUpgradeable | 0 | 0 | none |
  | ClaimEscrow | 0 | 0 | none (a first draft drew `uninitialized-local`, a false positive; restructured) |
- **Generated files and checks.** FILL_CHECKS

## 7. App and API follow-up (not in this PR)

1. **OFAC screening before every Send** (12.15). Before submitting any CLRUSD or USDC Send, check the recipient against the digital currency addresses on OFAC's SDN list, refreshed at least daily; block a match and log the result. It lives in the app; no contract screens.
2. **Smart-account module audit** (10f). Confirm that no Privy or AppKit setup gives Clear a delegated or server-side signer, session key or module that can move, freeze or block USDC in a member's smart account. Remove any destination-limit module the member cannot uninstall with their own signature. There is no module contract in this repo to check.
3. **Relayer and role changes.**
   - `apps/api/src/services/sendRelayerService.ts` calls `claimToPayoutTreasury(bytes32)`, which now reverts. The claim page must have the link's claim key (or the sender) sign `PayoutClaim(transferId, payoutTreasury, payoutRefHash)`, and the relayer submits `claimToPayoutTreasuryWithSignature`.
   - Pause tooling: every vault and CLRUSD pause, and the CA mint pause, needs two keys making the same call.
   - The relayer and pause keys are Clear Financial's. `scripts/command/ops-roles.map.json` still maps the vault's legacy `OPERATOR_ROLE` to the savings relayer; it should be `RELAYER_ROLE`, on a Clear Financial key.
   - Attest members' states before naming the vault's state source on a network, or their deposits revert (L-E).
   - Redeem intents: see conflict 2.
4. **Members-only Send UX.**
   - Check `mayReceive(recipient)` before a CLRUSD Send, and explain the refusal.
   - Say that a de-listed member can still send to members and redeem.
   - USDC Sends go to any address.
5. **The off-chain pilot measure** (acceptance 36): counting by depositor and receiver, and alerts at $35,000 and $45,000.

## 8. Notes

- The credit handover's old CLRUSD step would have reverted: it called `grantRole(DEFAULT_ADMIN_ROLE, …)`, which AccessControlDefaultAdminRules refuses. Its test never passed CLRUSD. The vault handover uses begin/accept instead.
- Whoever operates the member registry (the AccessManager's operators, and MembershipRegistry's registrars) now decides who may receive CLRUSD. That is decision 6's design, and it reaches receipt only.
