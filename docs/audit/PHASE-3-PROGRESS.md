# Phase 3 progress: Deed trust agreement v5 (+ Addendum 2)

Branch `audit/phase-3-deed-v5`, cut from `audit/phase-1` (PR #883). A resumed session reads this file
plus `git log` and carries on.

Inputs: `specs/deed-trust-v5-brief.md`, `-addendum-1.md`, `-addendum-2.md` (wins on conflict),
`DECISIONS.md` (#8, #9, #10, Addendum 1 items 1-6), `PHASE-1-REPORT.md`.

## Design (fixed before coding)

- DeedNFT is split like TermIssuer: `DeedNFTBase` (all storage, OZ inheritance, shared internals),
  `DeedNFT` (ERC-721 surface, views, stubs) and `DeedNFTExtension` (v5 functions plus the moved
  mint/edit functions), created in DeedNFT's constructor, pinned immutable, reached by delegatecall.
- v5 state is one `TrustRecord` per token appended to storage, mirrored into reserved ERC-7496 traits.
- Every Land/Estate deed is a trust deed (`mintTrustDeed`); `mintAsset` keeps Vehicle and
  CommercialEquipment only.
- Trustee-only route: a licensed-trustee list inside ValidatorRegistry, granted by its owner (the
  existing validator admin).
- New contracts: `FunctionalContractRegistry`, `CoopTransferAgent`. Timelock: OZ `TimelockController`.

## Steps

- [x] 1. Design + progress doc
- [x] 2. DeedNFT base + two extensions (mint, trust) passed as constructor args (EIP-3860 init-code cap); production sizes under EIP-170
- [x] 3. Trust core: Deed ID, reserveId, mintTrustDeed, reserved traits, burn record, status
- [x] 4. Trustee, protector, standby, consent (EIP-712/1271 or prior approval), licensing determination; ValidatorRegistry licensed trustees
- [x] 5. Agreement versions (Validator adoption per asset type), holder election, definition corrections
- [x] 6. Transfer policy, lastFrom, FC registry, Verified via MembershipRegistry, trustee rule; IDeedCustody in Subdivide/Fractionalize
- [x] 7. CoopTransferAgent
- [x] 8. Notices and markVoid
- [x] 9. Timelock + FC registry + agent in deploy scripts and handover
- [x] 10. Tests (`test/audit/deed/TrustV5*.spec.ts`) and existing tests updated
- [x] 11. Sizes, Slither, storage layout, full suite
- [x] 12. DEED-V5-INTERFACE.md, PHASE-3-REPORT.md, draft PR

Done: full suite 888 passing; sizes, Slither and storage layout are in PHASE-3-REPORT.md. Draft PR into dev, stacked on #883.
