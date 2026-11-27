# Decisions for the fix pass (agreed with KyngKai, 2026-11-12)

## Compliance spec
1. Carry accrual: per-second at monthly × 12 / 365. Acceptance tests 2 and 5 are updated to match (e.g. $18.54, not $18.80, on $940 at 2% over 30 days).
2. C-2 fix: value savings collateral at the member's real CLRUSD balance (min(pledged, balance)) and check free CLRUSD at draw time. Do NOT lock the pledge itself (it would conflict with DFAL 10a).
3. PayoutPool: the only change allowed is the redeem eligibility check (registered + active merchants, plus named co-op addresses). FIFO order, funding and the AssurancePool rule stay as they are.

4. Clear Cash at $2,500 and up gets a 13-cycle option (13 x 30 = 390 days). No calendar schedule.
5. Keep CLRUSD burnFrom. It is allowance-gated and is not a control power. Document this.
6. Pilot cap: wallets with no stateCode are counted as WY (KyngKai's call). Caveat raised: DFAL turns on the customer's residence, not the company's, so an unattested CA resident would go uncounted. Preferred mitigation: require a stateCode attestation before any member mint, so the default rarely applies. Confirm with counsel.
7. CFL cap aggregation is a governed switch, default ON (revolving and term plans aggregated) until counsel says otherwise.
8. Functional Contract registry: additions go through the Foundation multisig plus timelock. Removals are immediate but only block new deposits; they never trap a deed already held.
9. Verified transfer policy requires a membership record that is not revoked or fraud-flagged, not a paid-up subscription.
10. Timelocks: the same contract code and the same 7-day minimum delay, in two instances. Deed contracts use one with the Foundation multisig as proposer; credit and savings contracts use one with the co-op Ops Safe as proposer.

## Trust agreement v5, Addendum 1
1. Trustee is a signing wallet (EOA or Safe), not the Validator contract. ValidatorRegistry records signer addresses per active validator; "active validator" = a signer of an active validator. Acceptance by EIP-712 signature (EIP-1271 supported) or a second call.
2. Deed ID = hash(agreementHash, riderHashes, identityHash). identityHash covers asset type, legal description, county/APN, reserver and salt. All other mint-time parameters go into one mintParamsHash, stored as a trait and emitted at mint. reserveId binds reserver + agreementHash + identityHash.
3. Legal-description corrections: the trustee proposes, and the protector (or the holder when protector is zero) countersigns. A program sponsor can never change it alone. Every correction emits MetadataCorrected with a reason URI.
4. "Land and Estate only" is enforced in DeedNFT: agreement versions are adopted per asset type, and mint or version election reverts otherwise.
5. NoticePosted(tokenId, sender, docHash, uri, trustee, protector) records both as of the posting.
6. Transfers to the deed's current trustee revert, except into a registered Functional Contract. To change hands to the trustee, replace the trustee first.
