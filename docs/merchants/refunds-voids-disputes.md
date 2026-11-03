# Refunds, voids and disputes

How money goes back, and who has to say yes. Anyone on shift can **start** a refund; nothing moves
until someone allowed to approve it does. Refunds, voids and overrides are kept on the shop's audit
trail, with who asked and who approved; the owner can read it.

## Who approves what

| | Who can approve | How |
|---|---|---|
| Card or cash refund | A manager or owner | Their own request goes through as they make it. A counter request waits for a manager's or owner's PIN, from someone other than whoever asked |
| Void (same day) | A manager or owner | Their PIN, always, whoever is on shift |
| Clear refund, under the refund limit | The owner's PIN at the counter, or a manager or owner signed in | |
| Clear refund, at or over the limit | The owner, signed in on their own device | A manager can't approve it |
| A discount over your limit | A manager or owner whose limit covers it | Their PIN at the counter |
| A drawer difference at close | A manager or owner who didn't make the first count | Their PIN and a note |

The refund limit starts at $500.00 and is set by the owner in Staff (see
[Staff and shifts](./staff.md#the-refund-limit)). The shop's approval cap, and who sets it, is in
[Governance](../governance/README.md).

## Voiding a sale

A void undoes a sale as if it never happened. Open the sale in **Charges** and choose **Void**.

- It always needs a **manager's or owner's PIN**.
- Only **today's** sales can be voided. An earlier sale is refunded instead.
- Card holds are released (the card was never captured), cash goes back out of the drawer, and a
  Clear charge still waiting is withdrawn. If the customer approved the Clear charge a moment ago,
  the void stops and tells you to refund it through the Clear refund instead.

A sale with nothing paid on it yet can be dropped without a PIN.

## Refunding card and cash

Open the sale in **Charges** and choose **Start a refund** (or **Refund part** on a sale taken today).

1. Tick what's coming back. For a line of several, say how many ("one of two tires"). Returned items
   go back into stock. Labour can't come back, so a sale that was only labour can't be refunded here.
2. The refund goes back **the way the money came**: to the card first, then cash from the drawer,
   one refund per payment.
3. If you're a manager or owner, it's approved as you make it. On a counter shift, a sheet asks a
   manager or owner to type their PIN; nothing goes back until they do.

A card refund goes back to the card through Stripe. A cash refund comes out of the drawer, so the
drawer has to be open. A card not yet captured is voided, not refunded.

## Refunding a Clear charge

A Clear refund unwinds the customer's plan. Open the charge in **Charges** and choose **Start a
refund**.

- **The customer gets back what they paid, less carry** they've already paid on a plan over time.
  A refund unwinds the purchase, not the time they had the money.
- **The shop gives back what it received for the charge**: the amount less the fee Clear took. It
  comes off your next payout, and the sheet shows the payout after it.
- Partial Clear refunds aren't offered. A Clear refund is for the whole charge.

Who approves depends on the amount and the refund limit (table above). An owner at the counter types
their PIN; anything at or over the limit needs the owner signed in on their own device, where the
refund waits under the charge. **Cancel the request** withdraws it. A declined refund leaves the
charge as it was, and nobody has told the customer anything.

If the refund can't be settled on Clear's side, nothing is refunded and the request goes back to
waiting, so try again.

## Disputes

**A card dispute** is between the customer, their bank and Stripe. Clear records it when Stripe
reports it, and you answer it in your Stripe Dashboard. The money it moves shows in that card
deposit's breakdown on [Payouts](./payouts.md).

**A Clear dispute** is raised by the member in their Clear app. Clear mediates disputes about a
payment to a Clear Partner. While one is open the plan is unwound: the member isn't charged carry
on it and the shop isn't paid for it. If the member loses or withdraws it, the charge stands as
approved; if they win, it's treated as refunded. How Clear decides is in
[Governance](../governance/README.md).

## When something goes wrong

| What you see | What it means |
|---|---|
| "Voiding needs a manager's or owner's PIN" | The PIN typed was a counter PIN, or didn't match |
| "Only today's orders are voided; an earlier one is refunded" | Use Start a refund |
| "A refund is approved by a manager or owner, or with their PIN" | A counter shift can't approve its own refund |
| "Someone other than whoever asked approves it" | The approver's PIN is the requester's own |
| "That one needs approving from the owner's phone, not a code at the counter" | The Clear refund is at or over the refund limit |
| "That one is above the refund limit and needs an owner" | A manager tried to approve over the limit |
| "Open the drawer to give cash back" | Cash refunds come out of an open drawer |
| "Card processing isn't set up here" or a disconnected account | A card taken on a Stripe account that's since been disconnected can only be refunded in that Stripe account |
| "Too many wrong PINs" | The shop's PIN lock; see [Staff and shifts](./staff.md#pins) |
