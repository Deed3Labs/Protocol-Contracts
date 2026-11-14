# Addendum 4: pauses, de-listing, Legacy Contact, Income Assurance, bond roll confirmation

Verbatim from the owner (counsel-note sweeps and founder decisions, Nov 14, 2026). The conflict list and the owner's answers are recorded in `addendum-4-decisions.md` once decided.

---

ADDENDUM 4 — Pauses, de-listing, Legacy Contact, Income Assurance, bond roll confirmation (counsel-note sweeps and founder decisions, Nov 14, 2026). REQUIREMENTS; list conflicts rather than choosing. Tests continue from 48.

10c (two new bullets)
- Renewal cap: no renewal can carry a pause past 30 days from when it was first set (pauseMaxTotal, hard-coded maximum 30 days; no role can raise it). After 30 days a pause continues only by a two-person renewal recording a non-zero legalBasisHash (court order, other legal process, or a written law-enforcement or regulatory request) with its own reason code. A renewal past 30 days without one reverts, and the pause lifts on expiry.
- A pause never causes a default. Per member, accumulate pausedSeconds: time any account or network pause affecting that member was in force after a due point that starts a grace or cure period. That period's end is extended by pausedSeconds (12.5, 12.14). The liquidation trigger reverts while a pause is in force, and a payment the pause prevented is never recorded as a miss.

10d (new bullet) — De-listing
- Removing an address from the membership registry stops only that address RECEIVING CLRUSD. It never stops the holder sending CLRUSD to a listed member or redeeming under Conversion/Exit, and never affects a pledge lock or liquidation.
- Removal takes two-person approval and records one reason code: MEMBERSHIP_ENDED, HOLDER_REQUEST or FRAUD. FRAUD is decided off-chain after written notice and at least 10 days to respond; the code records the decision hash. Every removal emits an event. No other registry function can affect a holder's balance or outgoing transfers.

10f (new bullet) — Legacy Contact Module (optional)
- An ERC-7579 recovery module the member alone installs, configures and uninstalls, each by the member's own signature. It is never a condition of anything.
- No admin, owner, upgrade or Clear role. No Clear entity address may be set as a contact.
- The member names one or more contacts and a waiting period of at least 30 days (default 90; under 30 reverts).
- A contact may open a recovery request; the app notifies the member at once on every channel; the member can cancel any time during the wait with one signature, and a cancelled request has no effect.
- After the wait, with no cancellation, the contact may call ONE function: rotate the smart account's owner key to a key the contact names.
- The module can never transfer, approve, mint, redeem, pledge or burn any asset, install or uninstall any module, or change the Pledge Module, pledge lock, Liquidation Hold or any 10c pause. All of those keep applying after rotation.
- Offered only once audited and published in MB-03 Schedule 2.

12.5 (new bullet)
- A fraud or security pause extends the grace period by pausedSeconds and never causes a miss or default; the trigger reverts while a pause is in force.

12.13 (incomePause now reads)
- incomePause (Income Assurance): set for at most incomePauseMaxCycles (initial 3) consecutive cycles by a two-person attestation recording a hardship forbearance Clear Lending granted at the member's request on a documented hardship of ANY kind (loss of income, illness or injury, family emergency, disaster, unexpected expense). Record a hardshipRef hash; no hardship category is ever required or checked on-chain. Each separate documented hardship may start a new incomePause, never more than incomePauseMaxCycles consecutive cycles for one hardship. Rest unchanged.

12.14 (append)
- A fraud or security pause in force after the notice timestamp extends the 30-day cure period by pausedSeconds; the trigger reverts while a pause is in force; a pause never causes this default.

12.15 (edit)
- "A de-listing may stop receipt only, never sending or redemption (10d)."

Tests
49. Pause renewal cap: a pause set at t0, renewed every 72 hours by a second signer. The renewal that would carry it past t0 + 30 days reverts without a legalBasisHash, and succeeds with one under two-person approval and emits its event. With no valid renewal the pause lifts on expiry. Setting pauseMaxTotal above 30 days reverts.
50. Revolving grace: with a cure-notice timestamp and grace ending on day 22, a 5-day pause during grace moves the end to day 27. The trigger reverts on day 26 and while any pause is in force, and succeeds for a random caller after day 27 with no pause. No miss is recorded for a payment the pause prevented.
51. Secured term-plan cure: a 4-day pause during the 30-day cure makes the trigger revert until 34 days after the timestamp.
52. De-listing: a transfer to a de-listed address reverts; the de-listed holder's transfer to a listed member succeeds, and its redemption succeeds when Conversion/Exit conditions hold. A same-signer removal reverts; a removal without a valid reason code reverts; every removal emits its event.
53. Legacy Contact set-up: only the member's signature installs, configures or uninstalls the module; every other caller, including every Clear role, reverts. A wait under 30 days reverts; the default is 90. Setting a known Clear address as contact reverts.
54. Legacy Contact recovery: a request then a member cancellation within the wait leaves the owner key unchanged. An uncancelled request lets the contact rotate the owner key only after the full wait; one second earlier reverts. Every other module call by the contact (transfer, approve, redeem, pledge, module install or uninstall, Pledge Module change) reverts. After rotation the pledge lock and any 10c pause still apply.
55. Income Assurance: a two-person incomePause attestation with any hardshipRef succeeds; a single-signer one reverts; a fourth consecutive cycle for the same hardshipRef reverts. While it is above zero, no miss, securedDrawPause or default arises, and carry accrues on principal only.

EARN — bond rolls by confirmation (supersedes auto-roll; Earn spec new §4A and test 26; build with Phase 2f)
- There is no auto-roll flag, no default-on, no standing "roll all" instruction, and no way for any role, operator or session key to confirm for the Holder. Per bond, store a Roll Notice hash, rollDeadline and rollConfirmed (default false).
- postRollNotice(id, noticeHash, rollDeadline): Clear Lending's notice role, once per bond, no later than 20 days before maturity (FIXED). rollDeadline is computed off-chain as end of day Pacific on the fifth Business Day before maturity; the contract rejects anything later than end of day Pacific 7 calendar days before maturity, or not in the future.
- confirmRoll(id, noticeHash, sig): the Holder's EIP-712 signature from the registered Smart Account only, after the notice and before rollDeadline, with a matching hash. One signature covers one bond; several can be batched in one transaction. withdrawRollConfirmation(id): Holder only, before rollDeadline. At and after rollDeadline the flag is frozen.
- settle pays out and burns any bond without an effective confirmation. A confirmed bond rolls; its replacement starts unconfirmed. A confirmed bond whose holder-ineligible flag is set, or whose term is withdrawn, after the deadline is paid, not rolled.
- Reserve: 100% of the Maturity Amount for every bond maturing within 90 days except confirmed bonds that can roll. Withdrawing a confirmation, or a confirmed bond losing roll eligibility, restores 100% in the same transaction.
- Test 26: postRollNotice 19 days before maturity reverts; a rollDeadline past 7 calendar days before maturity reverts; confirmRoll before the notice, with a wrong hash, by any key but the Holder's (including every Clear role, operator and session key), or at or after the deadline reverts. An unconfirmed bond is paid at maturity; a confirmed one rolls and its replacement is paid at its own maturity unless separately confirmed; a confirmed bond made ineligible after the deadline is paid. No function confirms more than one token ID from a single signature.
