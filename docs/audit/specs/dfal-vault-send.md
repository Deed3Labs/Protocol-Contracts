# Addendum: DFAL control, ESA vault roles, pilot cap and Send (founder decisions, 2026-11-13)

Verbatim from the owner. Treat each as a REQUIREMENT; stop and list conflicts with earlier sections or audit findings rather than choosing silently.

## 10f addition: Ready to allocate USDC
- No Clear key, role, pause, session key or module can move, freeze or block USDC in a member's smart account. Remove any destination-limit module the member cannot uninstall by their own signature alone; the 10c pause does not reach USDC.

## 10g: ESA Vault roles and reserve custody
- Every ESADepositVault and CLRUSD role (mint/redeem operator, reserve custody address, FRAUD_ROLE and any security pause, parameter, admin and upgrade roles) is held by Clear Financial Co. addresses under two-person control. Clear Collective LLC, Clear Lending Co., ClearLabs and the Manager hold no vault role.
- Clear Financial holds the USDC reserve as trustee of the ESA Reserve Trust for CLRUSD holders. The reserve sits only in the vault or a registered reserve address; no function can send reserve USDC anywhere except a 1:1 redemption to the redeeming holder (or, on liquidation, to the debt burn under 10b). No sweep, rescue or admin-withdraw function.
- Any USDC rewards accrue to a separate Clear address, never to the reserve.
- Role handover to a successor trustee must be possible without touching the reserve balance.

## 11: Pilot volume cap (replaces the earlier version)
- One counter per legal entity (Clear Financial Co.), covering every vault mint and redemption for a California member plus any other covered CA activity reported in by two-person attestation. All Clear contracts handling CA USDC share it.
- A member with no stateCode counts as CA (supersedes "unknown counts as WY").
- pilotMeasure = rolling 365-day USD value of CA mints and redemptions (plus attested CA activity) + outstanding CA CLRUSD. Track outstandingCaUsd on every mint, burn, member-to-member transfer and stateCode change, by the holder's state.
- Alerts, never a revert: emit PilotAlert at pilotAlertUsd (initial $35,000) and pilotAlert2Usd (initial $45,000). No mint reverts because of the measure; redemptions are never blocked. pilotCapUsd ($50,000) is for reporting only.
- Manual backstop: a governed pauseCaMints switch, set and cleared only by two-person action with a reason code and event, stops new CA mints while on. Never triggered automatically; never affects redemptions or non-CA mints.
- Governance can switch the whole item off once a DFAL licence or other cover is in place.

## 12.15: CLRUSD transfers and Send
- CLRUSD transfers stay members-only: the token allows transfers only between registered member wallets, enabled at launch through Send. Do NOT make CLRUSD non-transferable. De-listing a wallet may stop receipt only, never sending or redemption.
- USDC Sends are member-signed transfers from the member's own wallet to any address; Clear never signs, holds or moves the funds.
- Before the app submits any CLRUSD or USDC Send, it checks the recipient against the digital currency addresses on OFAC's SDN list (refreshed at least daily), blocks a match and logs the result. This check lives in the app, not the token: no contract function may block a member's transfer on screening grounds.

## Acceptance tests (add)
34. No Clear-held role can transfer, freeze or block USDC in a member's smart account.
35. Reserve USDC can leave the vault only as a 1:1 redemption to the redeeming holder or a 10b liquidation burn; every other path reverts.
36. A mint for a member with no stateCode increases outstandingCaUsd; crossing $35,000 and $45,000 emits PilotAlert; no mint reverts at $50,000 unless pauseCaMints is on.
37. pauseCaMints can be set only by two distinct signers and never blocks redemptions.
38. A CLRUSD transfer to a non-member wallet reverts; member-to-member succeeds.

## 10f clarification
The Ready to allocate USDC rule does not limit recovery. Automatic Clearing (12.2) sweeps Spendable deposits at the bank, and liquidation (10b), force-settlement (12.2, 12.5) and the Earn shortfall rule (12.8) reach only pledged CLRUSD and pledged Earn positions. None of them uses Ready to allocate USDC. A member who wants their USDC to back credit converts it into the ESA or an Earn position, and pledges it there.

## Owner decisions on the conflicts (2026-11-14)

1. **Governance:** a fourth 7-day TimelockController with a Clear Financial Co. Safe as proposer governs ESADepositVault and CLRUSD. Both leave the credit timelock handover (overrides DECISIONS #10 for these two contracts).
2. **Hot relayer keys:** keys that only submit member-signed actions (the vault's `RELAYER_ROLE`, deposit/redeem/mandate relays) stay single keys held by Clear Financial. Every other vault and CLRUSD power (admin, upgrade, pause, parameters, granting minter/burner/liquidator) is two-person.
3. **Roles held by contracts:** the vault (mint/burn), the Liquidator (seize) and the cross-chain token pool keep their narrow functional CLRUSD roles. Only Clear Financial, two-person, may grant or revoke them.
4. **Deposit mandates and Autopay** that the relayer executes from a member-signed, capped, revocable mandate are allowed under 10f (12.12).
5. **Send-by-link (ClaimEscrow):** KEPT AS IS, including the card and bank payout paths (owner overrode the recommendation to drop them).
6. **Members-only CLRUSD:** de-listing a wallet stops receipt only, never sending or redemption, and is logged. The vault, the Liquidator, the token pool and burns are exempt. Membership comes from the existing member registry.
7. **Pilot measure: tracked OFF CHAIN** (owner: very temporary, not needed long term). No on-chain counter, no `outstandingCaUsd`, no on-chain PilotAlert. Off-chain tracking uses existing events: vault mints and redemptions, CLRUSD transfers, state attestations.
   - On chain, only: remove the vault's revert-at-cap; add the two-person `pauseCaMints` manual backstop (reason code, event; never automatic; never affects redemptions or non-CA mints); and a governed off switch.
   - Acceptance 36 moves off chain (alerts at $35,000 and $45,000 from the off-chain measure). Acceptance 37 stays on chain.

## Timing
Phase 2d is built after Phase 4 (independent re-review and fixes) merges, because Phase 4 changes the same pause code in CLRUSD and the vault. App-side items go to the apps PR: OFAC screening before every Send, and checking that member smart accounts have no module the member can't uninstall alone.
