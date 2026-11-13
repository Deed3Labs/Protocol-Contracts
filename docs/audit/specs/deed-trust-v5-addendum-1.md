# Trust agreement v5 brief — Addendum 1 (2026-11-12)

Supersedes item 8; adds to items 3 and 9.

- No trusteeMode. Every deed has a trustee. Mint requires a `trustee` that is an active validator in ValidatorRegistry, has accepted (signature, or a second call), and is not the minting owner.
- Reserved trait `protector`. Zero address means "the current holder is protector" (passes automatically with the token).
- `setTrustee(tokenId, newTrustee)`: callable only by the protector (or the holder, when protector is zero). New trustee must be an active validator, must not be the holder, and must accept. Neither trustee nor protector can ever transfer, burn or freeze the token.
- If a transfer makes the current trustee the token holder: emit `TrusteeSuspended(tokenId, trustee)` and flag it. Blocking the transfer is optional.
- Program support:
  - Reserved traits: `programId`, `programSponsor`, `titleAdministrator`, `transferPolicy`.
  - Program parameters (stored as a hash with an IPFS URI, or as individual traits): rofrPeriodDays (default 30), rofrPriceBasis, completionWindowDays (default 90), successorPeriodMonths (default 12), successorPurchaseBasis, acquisitionMode, arbitration, versionConsentRequired (default true), feeSchedule.
  - When a program applies: protector = programSponsor; trustee defaults to titleAdministrator.
- The Deed ID hash commits to agreementHash plus a hash of all mint-time parameters.
- Asset scope: agreement applies only to Land and Estate asset types. The validator should refuse to attach it to Vehicle or CommercialEquipment.
- Trustee and protector addresses are the notice recipients for postNotice-based recovery claims (agreement §10.2.1(d)).
