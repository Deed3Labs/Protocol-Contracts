# Card credit fee: 30¢ on a card swipe that draws revolving credit (decision 55)

Owner decision, Nov 18, 2026: Option A, on top and on chain. The member agreements are amended
separately (drafted in Deed3Labs/clear-agreements PR #40, open; this spec cites their section numbers
only); this spec is the technical side. **The fee is on by default** (owner, Nov 18, 2026): the
RevolvingIssuer upgrade sets `maxCardCreditFee` to 30¢ in the same call, and the API charges it with
`CARD_CREDIT_FEE_CENTS=30`. One credit settings signer can switch it off on chain (`maxCardCreditFee`
to zero).

## The rule

A Clear Visa card purchase with a **Credit Portion** (any part funded by a credit tier: Savings-Backed,
Asset-Backed, Income-Backed or Clear Boost) adds a flat **30¢ card credit fee** on top, **once per card
purchase**, charged **at settlement**.

| Case | Fee |
|---|---|
| Spendable (the member's own cash, the Lithic spendable balance) covers the whole purchase | None |
| Part cash, part credit | The flat 30¢, once |
| Any credit tier, Savings-Backed included | The flat 30¢ (API: `CARD_CREDIT_FEE_TIERS`, default `savings,asset,income,boost`) |
| Several clearings, or several tiers, for one purchase | One fee per purchase |
| Pay with Clear (in-network) | None |
| A hold (authorization) that never settles | None: the fee is charged at settlement |
| A void before settlement | None charged; credited back if it was |
| A **full** merchant refund after settlement | The fee is credited back, with any carry on it (see "Carry on the fee") |
| A partial merchant refund | The fee is kept |
| The member is a Covered Borrower (MLA, MB-04 §5.10) | None |
| Carry plus the fee would pass the CFL maximum (MB-04 §5.4(f)) | A hook: the excess of the fee is credited back by the cycle statement (`returnCardCreditFee`), once counsel defines the measurement. Until then it credits nothing, and it does not block the fee |
| A minimum purchase | None (API: `CARD_CREDIT_FEE_MIN_PURCHASE_CENTS`, default 0) |

The merchant is never charged and never sees the fee: Lithic approves the merchant's amount, and the
fee is Clear Lending's, recorded on the member's line.

**Carry on the fee.** The fee is drawn through the tiers like the purchase, so it is principal and
carries like any other balance. The per-ref fee record (`cardCreditFeeOf`) keeps it distinguishable,
so it can be moved out of principal later if counsel requires. On a full refund the agreement credits
back the fee "with any carry on it": the contract returns the fee itself; it has no function that
credits back carry by a stated amount (see "Open points").

## Open points (counsel and compliance)

None of these blocks the fee (owner, Nov 18, 2026).

- **Whether a per-draw fee is allowed at all** under the CFL (MB-04 #52: §22454 against §22305; L-02
  §2.6E): open with counsel; not a blocker.
- **The CFL cap trim** (MB-04 §5.4(f)): carry plus the fee may not pass the CFL maximum; the excess is
  credited back on the cycle statement through `returnCardCreditFee`. A hook that credits nothing until
  counsel defines the measurement.
- **The statement** (Reg Z §1026.7(b)(6)): each fee listed by its purchase, with the cycle's and the
  year-to-date totals of fees.
- **Disclosure** (MB-07 §4.3(c)): the APR and the fee are disclosed before card access to credit is
  turned on.
- **The §22452 plan of business** (L-02 §2.6C): a note for real members, not a gate on the fee.
- **Covered Borrowers** (MLA, MB-04 §5.10): no fee; the API's eligibility check.

## On chain (RevolvingIssuer upgrade)

The ledger already mints a three-party purchase: `StableCredit.originatePurchase(member, purchase,
merchant, payout, coop, discount)`, with `purchase == payout + discount`. Split plans use it for their
fee; card settlement passes `discount = 0` today.

- **`settleCardSpendWithFee(bytes32 ref, address member, uint256 amount, uint256 fee)`**, card settler
  only. Everything `settleCardSpend` checks still holds, applied to `amount + fee`: it must be within
  the recorded authorization for `ref` and member, the per-purchase cap and the per-day caps, good
  standing, once per ref. `fee` must be above zero (`RevolvingIssuerCardFeeZero`) and at most
  `maxCardCreditFee` (`RevolvingIssuerCardFeeAboveMax`). It draws `amount + fee` from the tiers,
  cheapest first, all or nothing (the Savings allowance applies to both), and mints
  `originatePurchase(member, amount + fee, cardSettlementAccount, amount, cardSettlementAccount, fee)`:
  the purchase claim and the fee both go to the card settlement account (Clear Lending's, CL
  Operating, since the RT steps), so no new recipient and no new admin power. `cardSettlements[ref]`
  is the purchase alone, as before; the fee is stored per `ref`. Emits `CardSpendSettled(ref, member,
  amount)` and `CardCreditFeeCharged(ref, member, fee)`.
- `settleCardSpend(ref, member, amount)` is unchanged and means a fee of zero. One internal settlement
  (`_settleCard`) serves both.
- **The bound:** `maxCardCreditFee()` (ledger units, 6 decimals; 30¢ is 300000), set by one
  `CREDIT_SETTINGS_ROLE` signer (`setMaxCardCreditFee`, `MaxCardCreditFeeUpdated`), never above
  `CARD_CREDIT_FEE_CEILING`, $5.00 (`RevolvingIssuerCardFeeAboveCeiling`). Zero (the storage default)
  refuses any fee, so setting it back to zero is the off switch. It bounds what the settler key can charge; it never holds up a credit-back. The CF upgrade
  sets it to 30¢ in the same call (`upgradeToAndCall(impl, setMaxCardCreditFee(300000))`), so on Base
  Sepolia the fee is on from the upgrade.
- **Crediting back:** `returnCardCreditFee(bytes32 ref, uint256 amount)`, card settler only, `0 <
  amount <= fee − returned` (`RevolvingIssuerCardFeeReturnExceedsLeft`). It releases the tiers dearest
  first and reverses that much of the fee's own leg, `reversePurchase(member, amount,
  cardSettlementAccount, 0, cardSettlementAccount, amount)`, adds it to `returned` and emits
  `CardCreditFeeReturned(ref, member, amount)`.
- **Refunds:** `reverseCardSpend(ref, amount)` reverses the purchase part as today. When it brings the
  settled purchase to zero it also credits back what is left of the fee (`fee − returned`), through the
  same internal path, once. A partial refund keeps the fee.
- `cardSettlementOf(ref)` keeps returning the purchase amount; `cardCreditFeeOf(ref)` returns `(uint256
  fee, uint256 returned)`: the fee charged and the amount credited back so far.
- `repayCardSpend` is unchanged: the fee is part of the member's principal, and the card settlement
  account holds its claim, so the float check covers it.
- **Storage:** a new ERC-7201 namespace, `clear.storage.RevolvingIssuer.CardFee` (slot
  `0x1891ea5b85bfa6342db2b66e11acc058002ca00880066dd1e907d492e4433d00`), like Phase 2g's: nothing in the
  existing layout moves and the gap is untouched.
- **Modules:** `settleCardSpendWithFee`, `setMaxCardCreditFee`, `maxCardCreditFee` and
  `cardCreditFeeOf` in `RevolvingIssuerWorkouts` (`.v2`; the views through RevolvingIssuer's fallback);
  `reverseCardSpend` and `returnCardCreditFee` in `RevolvingIssuerExtension` (`.v5`); `setCreditTerms`
  and `setDepositSource` back to `RevolvingIssuerCycles` (`.v4`) for room. RevolvingIssuer's
  constructor checks the new kinds.

The upgrade is a new RevolvingIssuer implementation (and module set), proposed by the Clear Treasury
Safe on the CreditTimelock (7 days), the same route as every credit change.

## The API

- **Settings:** `CARD_CREDIT_FEE_CENTS` (30: on), `CARD_CREDIT_FEE_TIERS`,
  `CARD_CREDIT_FEE_MIN_PURCHASE_CENTS`. The API charges only when its setting is above zero and the
  chain's `maxCardCreditFee` covers it (read off the hot path and cached; the auth stream never calls
  out), and never for a Covered Borrower.
- **Authorization (`authDecision.ts`):** the waterfall is unchanged for the purchase. If the purchase
  draws from a fee tier, the fee is drawn after it from the credit tiers still with room, cheapest
  first; if the credit left cannot cover the fee, the purchase is declined (`INSUFFICIENT_FUNDS`), all
  or nothing as today. The decision records `feeCents` and the fee's draws.
- **On-chain authorization:** `authorizeCardSpend` records the credit part plus the fee.
- **Settlement:** `settleCardSpendWithFee` with the fee when one was charged at authorization;
  `settleCardSpend` otherwise. A clearing above the authorization keeps the same fee; several clearings
  for one purchase carry one fee. A purchase voided before settlement never charges it.
- **Refunds and credits:** a full refund after settlement gives the fee back (the contract does it on
  the last reversal); the CFL cap trim credits part of it back with `returnCardCreditFee`; the API
  records both.
- **Records:** the fee is stored beside the authorization and the settlement (one migration), and the
  ledger entries show it as its own line.

## The member app and the statement

The transaction shows the purchase and, under it, "Card credit fee 30¢". A full refund shows it given
back. The card's credit figures include it. The statement lists each card credit fee by its purchase,
with the cycle's and the year-to-date totals (Reg Z §1026.7(b)(6)).

## The signing steps (stage CF)

1. **Prepare** (the local session): `CARD_FEE_PREPARE=1 npx hardhat run
   scripts/upgrade_card_credit_fee.ts --network base-sepolia` deploys the new implementation and
   modules and records them (`deployments/base-sepolia/RevolvingIssuerCardFee.json`). It never
   upgrades the proxy.
2. **CF-upgrade-schedule** (Clear Treasury Safe, CreditTimelock): one operation,
   `upgradeToAndCall(new implementation, setMaxCardCreditFee(30¢))` (`CARD_CREDIT_FEE_CAP_USDC=0.30`).
   The call runs as the timelock, which passes `onlyCreditRole(CREDIT_SETTINGS_ROLE)` because it holds
   the AccessManager's admin role; the signing plan refuses to schedule otherwise.
3. **CFx-upgrade-execute** (Clear Treasury Safe, 7 days later): the fee is on.
4. Railway: `CARD_CREDIT_FEE_CENTS=30`.

## Not in scope

The merchant-side 30¢ (Stripe and Square sales) is unrelated and unchanged. No fee on cash, on Send,
on Pay with Clear, on split plans or on repayments.
