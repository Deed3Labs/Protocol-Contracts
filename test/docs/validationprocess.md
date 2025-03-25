┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Validator  │         │   DeedNFT   │         │  Validator  │
│   (Actor)   │         │  (Contract) │         │  (Contract) │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │  validateDeed(deedId) │                       │
       │───────────────────────>                       │
       │                       │                       │
       │                       │  validateDeed(deedId) │
       │                       │───────────────────────>
       │                       │                       │
       │                       │  _validateDeedAgainstCriteria(deedId)
       │                       │                       │───────────┐
       │                       │                       │           │
       │                       │                       │<──────────┘
       │                       │                       │
       │                       │                       │  getTraitValue("assetType")
       │                       │<───────────────────────
       │                       │                       │
       │                       │───────────────────────>
       │                       │                       │
       │                       │                       │  getTraitValue("definition")
       │                       │<───────────────────────
       │                       │                       │
       │                       │───────────────────────>
       │                       │                       │
       │                       │                       │  getTraitValue("operatingAgreement")
       │                       │<───────────────────────
       │                       │                       │
       │                       │───────────────────────>
       │                       │                       │
       │                       │                       │  isOperatingAgreementRegistered()
       │                       │                       │───────────┐
       │                       │                       │           │
       │                       │                       │<──────────┘
       │                       │                       │
       │                       │                       │  _validateAssetType()
       │                       │                       │───────────┐
       │                       │                       │           │
       │                       │                       │<──────────┘
       │                       │                       │
       │                       │                       │  Validation
       │                       │                       │  Result
       │                       │<───────────────────────
       │                       │                       │
       │                       │  validateDeed()       │
       │                       │───────────┐           │
       │                       │           │           │
       │                       │<──────────┘           │
       │                       │                       │
       │                       │  Emit DeedNFTValidatedChanged
       │                       │───────────┐           │
       │                       │           │           │
       │                       │<──────────┘           │
       │                       │                       │
       │  Return success       │                       │
       │<──────────────────────│                       │
       │                       │                       │
