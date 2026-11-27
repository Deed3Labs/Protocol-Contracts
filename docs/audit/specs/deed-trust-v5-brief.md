CONTEXT — Deed Protocol trust agreement v5 (contract requirements)

We're replacing the US trust agreement (Deed3Labs/Protocol-Agreements, legal/Americas/US/trust-agreement.md) with v5.0. v5 follows Fabrica's v4.4 trust structure for interoperability and adds Clear-specific features. The agreement describes on-chain behavior by function, not by function name, but it relies on the contracts behaving as listed below. Please make these changes on the Protocol-Contracts `dev` branch alongside the audit fixes. Files: contracts/core/DeedNFT.sol, contracts/extensions/Subdivide.sol, contracts/core/Validator.sol, plus the custody contracts listed in item 5.

MUST-FIX (the agreement depends on these)

1. Burning must not erase the record.
   - Today `burnAsset` deletes every trait and emits only DeedNFTBurned(tokenId).
   - Required: keep the traits readable after a burn, or emit an event carrying the tokenId plus hashes of `definition`, `operatingAgreement` and `configuration` and the holder's address.
   - Add a permanent `isRetired(tokenId)` record.
   - Why: before signing the deed out of the trust, the trustee must be able to prove which property's token was retired.

2. Deed IDs must never be reused.
   - Today `generateUniqueTokenId` hashes owner, assetType, definition and salt, then cuts the result to 9 digits (% 1e9). The duplicate check only asks whether the ID currently exists, so a burned ID can be minted again.
   - Required: use the full uint256 hash, include agreementHash and riderHashes as inputs, and reject any ID that was ever minted, retired or reserved by someone else.
   - Add `reserveId(...)`: the Grantor reserves an ID, records the deed into trust that names that ID, then mints. A reservation is bound to the reserver and to the agreement hash.
   - Why: the recorded county deed names the Deed ID. If an ID can be reused, the recorded deed could point at the wrong token.

3. Limit who can edit metadata.
   - Today `_checkValidatorOrOwner` checks the global VALIDATOR_ROLE, so any validator can edit any deed through `updateMetadata`, `setTrait` or `removeTrait`. The holder can also rewrite `definition`, which contains the legal description.
   - Required: only the deed's own assigned validator gets validator powers over that deed.
   - `definition.claim` (the legal description) is immutable after mint, except a correction by the assigned validator or the Trust Protector. Corrections emit MetadataCorrected(tokenId, field, oldHash, newHash, reasonURI).

4. The agreement must be pinned by content hash, and the holder chooses the version.
   - Today `operatingAgreement` = validator base URI + tokenId, and the validator can change that base URI.
   - Required: store reserved traits `agreementHash` and `riderHashes`, holding content hashes such as IPFS CIDs.
   - Changing the agreement version is the holder's election only, and only to a version the deed's validator has registered as adopted.
   - If configuration says `versionConsentRequired`, the Trust Protector must also sign.
   - No admin, validator or trustee can change a deed's agreement or rider hashes.

5. Stop treating the token holder as the beneficial owner.
   - Today `_beforeTokenTransfer` overwrites the `beneficiary` trait with the recipient on every transfer.
   - Under v5, a deed held by a lending pool, escrow, bridge, fractionalizer or subdivision contract (a "Functional Contract") still belongs to the depositor or the designated buyer.
   - Required: rename the trait to `holder`, or drop it.
   - Add a small interface, for example `IDeedCustody.beneficialOwnerOf(tokenId) returns (address)`, and implement it in CollateralRegistry, Liquidator, ClaimEscrow, LendingPool, Fractionalize, SavingsIntentEscrow and Subdivide.

6. Admin powers cannot override the owner.
   - Today `burnAsset` is whenNotPaused, and DeedNFT and Subdivide are UUPS contracts upgradeable by a single DEFAULT_ADMIN_ROLE / ADMIN_ROLE.
   - Required:
     - Burning is either never pausable, or a pause auto-expires within 30 days. The agreement lets the owner go to court after 30 days of blocked redemption.
     - Upgrade and pause sit behind the Foundation multisig plus a timelock.
     - No admin path can transfer a deed or change its ownership, metadata claim, agreement or rider hashes, trusteeMode, trustee or protector.
   - Why: "token = ownership" and the lender's exclusive "control" under UCC Article 12 depend on this.
   - If a migration contract is ever needed, it must: mint to the same holder, keep the same Deed ID (or publish an on-chain mapping), preserve all metadata, and burn or disable the old token in the same transaction.

7. Subdivide must lock the parent deed.
   - Today units can be minted while the parent DeedNFT stays transferable and burnable.
   - Required: `createSubdivision` takes custody of the parent, so Subdivide becomes a Functional Contract. While activeUnits > 0, the parent cannot be burned or withdrawn. It is released only through `deactivateSubdivision`.

NEW FEATURES (needed by v5)

8. Trustee mode on-chain.
   - Reserved traits:
     - `trusteeMode` (0 = Self, 1 = Appointed)
     - `trustee` (address of the Appointed Trustee; must be an active validator in ValidatorRegistry)
     - `protector` (address)
   - All three are set at mint and protected from generic setTrait/removeTrait.
   - Functions:
     - `setTrustee(tokenId, newTrustee)`: callable by the protector, or by the holder when no protector is set. Requires the new trustee to accept: a signature, or a second call by newTrustee.
     - `setProtector`: callable by the current protector designating its successor, or by the holder when the protector role is vacant.
     - `setTrusteeMode`: callable by the holder, unless configuration fixes the mode (a rider can lock it).
   - Neither the trustee nor the protector can ever transfer, burn or freeze the token.

9. Transfer policy per deed.
   - Reserved trait `transferPolicy`: 0 = Open, 1 = Verified, 2 = Coop.
   - `_beforeTokenTransfer` currently never calls the stored ERC721-C `_transferValidator`; it only checks approved marketplaces. Wire the policy in:
     - Open: today's behavior.
     - Verified: the recipient must be an active member in MembershipRegistry, or a registered Functional Contract.
     - Coop: transfers only go through a CoopTransferAgent contract that runs a right-of-first-refusal window (configurable, default 30 days) before completing. Direct transfers revert.
   - Always allowed under every policy:
     - (a) burn by the holder
     - (b) returning the token to the exact address it last came from. Track a per-token lastFrom. This is how someone refuses an unwanted transfer.
     - (c) transfers into Functional Contracts the policy allows

10. Status and notices.
   - Reserved trait `status`: Active, Retired or Void.
   - `postNotice(tokenId, bytes32 docHash, string uri)`: callable by anyone, emits NoticePosted(tokenId, sender, docHash, uri). Used for the on-chain notice of a lost-key recovery claim and for court orders.
   - `markVoid(tokenId, bytes32 recordingRefHash, string uri)`: callable only by the deed's assigned validator or Appointed Trustee. It sets status = Void and, by default, leaves the token transferable: after a tax sale or foreclosure, the right to any wind-up proceeds travels with the void token. Make that toggleable per reason code.

11. Cross-listing with Fabrica (only if we partner):
   - Approve Seaport's conduit as a marketplace for Open-policy deeds. Royalty enforcement otherwise reverts with "!mkt".
   - No switch from ERC-721 to ERC-1155 is needed. Trait keys `operatingAgreement`, `definition` and `configuration` already match Fabrica's ERC-7496 usage.

NOTES
- Chain is Base. The agreement treats a transaction as final only once the transaction data is in a finalized Ethereum L1 block. Apps should not treat sequencer-confirmed state as final for deed actions.
- Please return: the final function signatures, event names and trait keys, and any place where the code had to deviate from this spec. I'll align the agreement's drafting notes to match.