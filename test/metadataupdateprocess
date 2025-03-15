┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│    Owner    │         │   DeedNFT   │         │  Validator  │
│  or Validator│        │  (Contract) │         │  (Contract) │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │  updateMetadata(      │                       │
       │    deedId,            │                       │
       │    tokenURI,          │                       │
       │    operatingAgreement,│                       │
       │    definition,        │                       │
       │    configuration)     │                       │
       │───────────────────────>                       │
       │                       │                       │
       │                       │  isOperatingAgreementRegistered()
       │                       │───────────────────────>
       │                       │                       │
       │                       │<───────────────────────
       │                       │                       │
       │                       │ Update token URI      │
       │                       │ and traits            │
       │                       │───────────┐           │
       │                       │           │           │
       │                       │<──────────┘           │
       │                       │                       │
       │                       │ Check if caller       │
       │                       │ is validator          │
       │                       │───────────┐           │
       │                       │           │           │
       │                       │<──────────┘           │
       │                       │                       │
       │                       │ If owner (not validator):
       │                       │ Reset validation status│
       │                       │───────────┐           │
       │                       │           │           │
       │                       │<──────────┘           │
       │                       │                       │
       │                       │ Emit DeedNFTMetadataUpdated
       │                       │───────────┐           │
       │                       │           │           │
       │                       │<──────────┘           │
       │                       │                       │
       │  Return success       │                       │
       │<──────────────────────│                       │
       │                       │                       │
