# Trust agreement v5 brief — Addendum 2: trustee licensing (2026-11-13)

Adds to Addendum 1 (and so to items 8 and 9 of the brief). Where this conflicts with the brief or Addendum 1, this addendum wins.

- New reserved traits: `standbyTrustee` (must have pre-accepted) and `trusteeSuspended`.
- `setStandbyTrustee(tokenId, addr)`: protector only; requires the standby's acceptance.
- `applyLicensingDetermination(tokenId, docHash, uri)`: callable by the protector, the current trustee or the standby. It posts the determination through `postNotice`, then promotes the standby to trustee if one is set; otherwise it marks the trustee suspended.
- Trustee eligibility, at mint and in `setTrustee`, must also accept licensed trust companies and nonprofit trustees that are not validators: either a "trustee-only" role in ValidatorRegistry or a separate allowlist. Neither the trustee nor the standby ever gets power over the token.
- Remove any trustee-fee field from program parameters (Addendum 1's `feeSchedule` must not include one). The contracts must never route funds to the trustee address.
