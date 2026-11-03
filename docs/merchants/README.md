# Merchants

Running a shop on Clear: the merchant app at `merchant.useclear.org` and the Clear for Merchants app
for iOS and Android, for owners, managers and counter staff.

The merchant app is the shop's point of sale. One counter takes Clear, cards (Stripe smart readers,
the Stripe Reader M2 and Tap to Pay), cash and split payments, sends payment links, and takes
payments from a customer's phone at the table. Around it: inventory, tables, closing the day,
payouts, staff and settings.

The terms a shop signs, and who sets them, are in [Governance](../governance/README.md). The
developer side (payment links, checkout and the `/v1` API) is in
[Developers](../developers/README.md).

## Guides

| | |
|---|---|
| [Setting up a shop](./setting-up.md) | Signing up, the owner's sign-in, verifying the business, linking a bank, connecting Stripe, enrolling and removing tablets, the installed app |
| [Staff and shifts](./staff.md) | Counter, manager and owner, and who can do what; PINs; shifts, breaks and hours; tip sharing |
| [Taking payments](./taking-payments.md) | A sale start to finish; Clear, card, cash and split; payment links; paying from a phone; receipts; offline |
| [Refunds, voids and disputes](./refunds-voids-disputes.md) | Who approves what, voiding today's sales, card, cash and Clear refunds, card and Clear disputes |
| [Closing the day](./closing-the-day.md) | Opening the drawer, No sale, blind counts, sign-offs, Close the day, the end-of-day summary |
| [Payouts](./payouts.md) | Owed and held, when you're paid and net-30, withdrawing, fees, reconciliation, statements and exports |
| [Settings and inventory](./settings-and-inventory.md) | Every Settings section; tax, tips, discounts, receipts; the catalogue and importing a spreadsheet |
| [Clear Terminal](./clear-terminal.md) | Points, the Pay case and an M2 at the table, the cash drawer, printers, tables and the wait list |
| [Rewards and online sales](./rewards-and-online.md) | Your shop app: points, rewards, offers, your own domain, the store app; Pay with Clear on your website |

## Troubleshooting

Each guide ends with what its errors mean:
[setting up](./setting-up.md#when-something-goes-wrong) ·
[taking payments and readers](./taking-payments.md#when-something-goes-wrong) ·
[refunds and voids](./refunds-voids-disputes.md#when-something-goes-wrong) ·
[closing](./closing-the-day.md#when-something-goes-wrong) ·
[payouts](./payouts.md#when-something-goes-wrong) ·
[Clear Terminal](./clear-terminal.md#when-something-goes-wrong).

A PIN lock ("Too many wrong PINs") is explained in [Staff and shifts](./staff.md#pins).

## Not written yet

- How to install Clear for Merchants on a tablet or phone (where it's distributed)
- Card payments while offline (store-and-forward on the M2), which the app doesn't offer yet
- Closing with one person on (the setting is saved, but how the close follows it isn't documented)
- Leaving Clear
- Prices of the shop app add-ons and Clear hardware
