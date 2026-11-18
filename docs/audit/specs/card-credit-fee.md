# Card credit fee: 30¢ on a card swipe that draws revolving credit (decision 55)

Owner decision, Nov 18, 2026: Option A, on top and on chain. The member agreements are amended
separately (with the docs-audit items); this spec is the technical side. Nothing charges a fee until
the fee is switched on, both on chain (`maxCardCreditFee`) and in the API (`CARD_CREDIT_FEE_CENTS`).

## The rule

A Clear Visa card purchase that is funded, in whole or in part, by a credit tier (savings-backed,
asset-backed, income-backed or Clear Boost) adds a flat **30¢ card credit fee** on top. A purchase paid
entirely from the member's own cash (the Lithic spendable balance) has no fee.

Defaults chosen for the owner's open questions, each a setting or a one-line change:

| Question | Default | Where it lives |
|---|---|---|
| Does a savings-backed draw count as credit? | Yes: any credit tier. | API: `CARD_CREDIT_FEE_TIERS` (default `savings,asset,income,boost`) |
| Part cash, part credit? | The flat 30¢, once per purchase. | API |
| A minimum purchase? | None. | API: `CARD_CREDIT_FEE_MIN_PURCHASE_CENTS` (default 0) |
| Refunds | Void or refund before settlement: never charged. Full refund after settlement: the fee is given back. Partial refund: the fee is kept. | Contract (`reverseCardSpend`) and API |
| Carry on the fee | Yes: the fee is drawn through the tiers like the purchase, so it is owed and carries like any other balance. | Contract |

The merchant is never charged and never sees the fee: Lithic approves the merchant's amount, and the
fee is Clear Lending's, recorded on the member's line.

## On chain (RevolvingIssuer upgrade)

The ledger already mints a three-party purchase: `StableCredit.originatePurchase(member, purchase,
merchant, payout, coop, discount)`, with `purchase == payout + discount`. Split plans use it for their
fee; card settlement passes `discount = 0` today.

- **New:** `settleCardSpendWithFee(bytes32 ref, address member, uint256 amount, uint256 fee)`, card
  settler only. Everything `settleCardSpend` checks still holds, applied to `amount + fee`: it must be
  within the recorded authorization for `ref` and member, the per-purchase cap and the per-day cap. It
  draws `amount + fee` from the tiers, cheapest first, all or nothing, and mints
  `originatePurchase(member, amount + fee, cardSettlementAccount, amount, cardSettlementAccount, fee)`:
  the purchase claim and the fee both go to the card settlement account (Clear Lending's, CL
  Operating, since the RT steps), so no new recipient and no new admin power. The fee is stored per
  `ref` and emitted (`CardCreditFeeCharged(ref, member, fee)`).
- `settleCardSpend(ref, member, amount)` is unchanged and means a fee of zero.
- **The bound:** `maxCardCreditFee`, set by one `CREDIT_SETTINGS_ROLE` signer
  (`setMaxCardCreditFee`). Zero (the default after the upgrade) refuses any fee, so the upgrade alone
  changes nothing. `fee > maxCardCreditFee` reverts. It bounds what the settler key can charge.
- **Refunds:** `reverseCardSpend(ref, amount)` reverses the purchase part as today. When it brings the
  settled purchase to zero and a fee was charged for `ref`, it also reverses the fee (the same
  three-party reversal), once, and emits `CardCreditFeeReturned(ref, member, fee)`.
- `cardSettlementOf(ref)` keeps returning the purchase amount; a new view `cardCreditFeeOf(ref)`
  returns the fee charged and whether it was returned.
- **Storage:** a new ERC-7201 namespace (`clear.storage.RevolvingIssuer.CardFee`), like Phase 2g's:
  nothing in the existing layout moves.
- **Modules:** the new functions go in whichever module has room (the extension is near the size
  limit), and the module kinds are bumped so the constructor check names the new code.

The upgrade is a new RevolvingIssuer implementation (and module set), proposed by the Clear Treasury
Safe on the CreditTimelock (7 days), the same route as every credit change.

## The API

- **Settings:** `CARD_CREDIT_FEE_CENTS` (default 0: off), `CARD_CREDIT_FEE_TIERS`,
  `CARD_CREDIT_FEE_MIN_PURCHASE_CENTS`. The API charges only when its setting is above zero and the
  chain's `maxCardCreditFee` covers it (read off the hot path and cached; the auth stream never calls
  out).
- **Authorization (`authDecision.ts`):** the waterfall is unchanged for the purchase. If the purchase
  draws from a fee tier, the fee is drawn after it from the credit tiers still with room, cheapest
  first; if the credit left cannot cover the fee, the purchase is declined (`INSUFFICIENT_FUNDS`), all
  or nothing as today. The decision records `feeCents` and the fee's draws.
- **On-chain authorization:** `authorizeCardSpend` records the credit part plus the fee.
- **Settlement:** `settleCardSpendWithFee` with the fee when one was charged at authorization;
  `settleCardSpend` otherwise. A clearing above the authorization keeps the same fee. A purchase
  voided before settlement never charges it.
- **Refunds:** a full refund after settlement gives the fee back (the contract does it on the last
  reversal); the API records it.
- **Records:** the fee is stored beside the authorization and the settlement (one migration), and the
  ledger entries show it as its own line.

## The member app

The transaction shows the purchase and, under it, "Card credit fee 30¢". A full refund shows it given
back. The card's credit figures include it. The statement lists card credit fees as their own line.

## The signing steps (stage CF)

1. **Prepare** (the local session): `CARD_FEE_PREPARE=1 npx hardhat run
   scripts/upgrade_card_credit_fee.ts --network base-sepolia` deploys the new implementation and
   modules and records them (`deployments/base-sepolia/RevolvingIssuerCardFee.json`). It never
   upgrades the proxy.
2. **CF-upgrade-schedule** (Clear Treasury Safe, CreditTimelock): `upgradeTo(new implementation)`.
3. **CFx-upgrade-execute** (Clear Treasury Safe, 7 days later).
4. **CF-fee-cap** (one credit settings signer, after the upgrade): `setMaxCardCreditFee(30¢)`.
5. Then Railway: `CARD_CREDIT_FEE_CENTS=30`, after the amendment is signed.

## Not in scope

The merchant-side 30¢ (Stripe and Square sales) is unrelated and unchanged. No fee on cash, on Send,
on split plans or on repayments.
