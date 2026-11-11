# Clear card design

The Clear card is planned, not built. Nothing in the apps, the API or the contracts implements it.
Today's card is the Clear Visa card: see [How a Visa card purchase works](./visa-card-purchases.md).

## Decisions

1. **A wooden membership card, made by Clear.**
2. **It carries two ways to pay:** the member's Clear Pay QR code, and an Arx HaLo NFC chip set in a
   pocket at one edge, with rings marking where to tap.
3. **A member can pay at Clear shops without their phone**, by tap or by scan.
4. **Payments within a preset amount go through like a card.** The member sets an amount they have
   approved in advance. A tap or scan at an approved Clear shop within that amount completes without
   the phone. Anything else sends the member a notification to approve on their phone: the same flow
   as a shop raising a charge against the member's phone QR code today
   ([Paying at Clear shops](../members/paying-at-shops.md#show-your-clear-code); the shop's side is in
   [Taking payments](../merchants/taking-payments.md)).
5. **Disputes** cover card payments the same way they cover other Clear shop payments
   ([Disputes](../members/assurance-and-disputes.md#disputes)).
6. **Premium editions add a small e-ink screen**, and the card is meant to gain abilities over time.

How a Clear shop payment is settled once approved is in [Settlement](./settlement.md).

## Open decisions

- What does the HaLo chip's key do: identify the member only, or sign payments for their account?
- Where are the preset amount and the list of approved shops kept, and where are they enforced?
- How does a shop read the chip: the merchant app, a Clear Point, or a separate reader? Web NFC works
  only in Chrome on Android.
- What is the flow for a lost, stolen or replaced card, and what does freezing the card do?
- Does the premium edition hold funds, and if it does, what is its security model?
- Building access, and which other abilities come later?
