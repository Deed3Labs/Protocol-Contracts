# Taking payments

The merchant app is the shop's point of sale. One checkout takes Clear, card, cash, or any mix
of them, and the same order can be paid by a link or from a customer's phone. Anyone on shift can
take a payment.

## A sale, start to finish

1. **New charge.** Build a cart from your catalogue (Inventory), or type an amount. **Quick sale**
   adds something that isn't in the catalogue. Items with options (a size, an add-on) ask for them.
2. **Add the customer** (optional). Scan the code in their Clear or shop app, or add them by phone
   number; they confirm on their phone. You see their name and their points at your shop, never a
   balance. It earns them points and lets you send a Clear charge straight to their phone (see
   [Rewards and online sales](./rewards-and-online.md)).
3. **Checkout.** The server prices the order: tax, any discount and the total. Apply a discount
   code here, typed or scanned.
4. **Tip.** If the shop asks for tips (Settings › Tips), the customer picks one of your presets or
   Custom.
5. **How they pay:** Clear, Card, Cash, or Split between methods.
6. **Receipt:** Text, Email, Print, or none.

Card, cash and split can each be turned off in **Settings › Payments › Ways to pay**; Checkout
then leaves them out. Clear is always on.

### Discounts at the counter

Each role can give up to a set percentage off without asking: counter 10%, manager 25% and owner
without limit, to start with (Settings › Discounts). Above your limit, an owner or manager whose
own limit covers it types their PIN at the counter.

## Clear

The customer pays with Clear on their phone: now, or over time on a charge of $50.00 or more. They
approve a figure they can see. Nothing is charged until they do.

There are three ways to get the charge to them:

- **Show the code.** Checkout shows a code on the tablet; turn the screen to the customer and they
  scan it. Someone new to Clear can scan it too: it sets them up with the charge waiting.
- **Scan their code.** If they already have their Clear code open, the tablet's camera reads it and
  the charge lands in their app. Their code says who they are and carries no amount.
- **Text it.** Type their phone number and Clear texts them the link. Use this for a dead battery,
  a cracked screen, or someone in the waiting room. You can serve the next customer meanwhile.

The waiting screen says where the charge went and follows the customer's answer. **Send again**
repeats it. If they decline, you aren't told why; the customer can see why in their app. A charge
nobody answers expires, and resending raises a new one. A charge still waiting can be cancelled
from Charges.

What the shop receives for a Clear charge, and when, is on [Payouts](./payouts.md).

## Card

Cards need Stripe connected (see [Setting up](./setting-up.md#connecting-stripe-for-cards)) and a
reader:

| Reader | Where it works | Pairing |
|---|---|---|
| Stripe smart reader | The web app and the installed app | **Settings › Payments › Add a reader**: on the reader, open Settings and choose Generate pairing code, then type the code and a name |
| Stripe Reader M2 | The installed app only, over Bluetooth | Turn it on near the device; the card screen finds it over Bluetooth |
| Tap to Pay | The installed app only, on the device itself | Offered on the card screen |

At Checkout, choose **Card**. The tablet connects to a reader it can use (if there's more than one,
it lists them), then waits for the customer to tap, insert or swipe. **Use another reader** switches.
A smart reader is driven by Clear's server, so the tablet and the reader don't need to be on the
same network.

A card payment is **authorised** at the sale and **captured at Close the day**. Until then you can:

- **adjust its tip** (Charges › the sale › Adjust the tip). Clear asks the card for the higher
  amount; if it's refused, the app says so and the original hold stands;
- **void** it (see [Refunds, voids and disputes](./refunds-voids-disputes.md)).

Stripe releases a hold that isn't captured within two days, so close every day you take cards.

## Cash

Cash needs today's drawer open. Until it is, the Cash tile at Checkout reads **Open the drawer on
Home to take cash**. Open it on Home with the starting cash (see
[Closing the day](./closing-the-day.md)).

Type what the customer hands over; the screen shows the change. If a Clear cash drawer is paired,
it opens as the change screen comes up. If it hasn't opened after two seconds, the screen says
**Drawer didn't open**; **I used the key** records a key open against the sale.

## Split payments

**Split between methods** takes the total in parts: part cash, part card, part Clear, in any mix.
Each part is taken in turn and the screen shows what is still owed. A card that goes through on one
part brings you back to the split for the rest.

An order that is part-paid stops the day from closing; finish it or void it.

## Payment links

Owners and managers can send a link instead of taking payment at the counter. From New charge,
choose **Send a link**:

- an amount (at least $0.50), or an item from Inventory and how many (up to 99);
- a note to the customer;
- when it expires: never, in 7 days or in 30 days;
- whether members may pay over time.

**Create link** makes the address, with Copy and a QR code. The customer pays on Clear's page with
Clear, or by card when Stripe is connected. Over time is offered when the link allows it and the
total is $50.00 or more.

## Paying from a phone at the table

With [Clear Terminal](./clear-terminal.md), a Point at a table or the counter shows a code. A
customer who scans it opens the Point's page on their phone (`useclear.org/p/` and its four
letters): the menu, or the bill once you send it. They pay the bill there with Clear, or by card
through Stripe Checkout. Card payments made there are captured at once, unlike the counter's. When
it's paid, they can have the receipt emailed.

## Receipts

After a sale, choose how the customer gets the receipt:

- **Text** or **Email** asks for a number or address the first time, then shows where it went.
  Texts go by Twilio and email by Resend, when Clear has them set up.
- **Print** uses a paired printer if there is one, or the device's own print dialog (AirPrint on an
  iPad, Android's print service, or the browser's). The receipt is laid out for 80mm paper. Reprint
  from the sale in Charges; a refund taken later shows on a reprint.

## When the connection drops

A line above New charge says when the tablet is offline.

- **Cash still works.** Checkout prices the cart on the tablet with the tax rates it last read, and
  the sale and its drawer events are queued on the tablet and sent, in order, when the connection is
  back. A tablet that has never read the shop's tax rates says so.
- **Card, Clear and split wait** for the connection.
- Card payments can't be stored offline yet. Settings › Payments says it is coming to the M2 in an
  app update.

## Charges

**Charges** lists every sale, however it was paid: Clear charges, and card, cash and split sales,
each dollar once. A counter shift sees today and yesterday; owners and managers see the month.
Open a row to see what was sold, who raised it, and to refund, void or adjust a tip.

## When something goes wrong

| What you see | What it means, and what to do |
|---|---|
| The Card tile reads "Connect Stripe in Settings to take cards" | Stripe isn't connected, or can't take charges yet. **Settings › Payments** says which: Not connected, Almost there, Paused by Stripe or Disconnected, with a button to fix it. Cash and Clear still work |
| "No reader this device can use. Add a smart reader in Settings › Payments." | A browser finds smart readers only. Pair one, or use the installed app for an M2 or Tap to Pay |
| "The reader isn't ready" on the card screen | The reader didn't start collecting. Try **Use another reader**, or check the reader is on and charged |
| "Declined" | The card was declined. Try again, or take another method; a split keeps what's already paid |
| "The reader stopped waiting for the card" | The payment was cancelled on the reader; start the card again |
| The Cash tile reads "Open the drawer on Home to take cash" | Open today's drawer with the starting cash |
| The tablet is offline | Cash works and is sent when the connection is back. Card, Clear and split wait |
| A Clear charge sits on Waiting | The customer hasn't answered. **Send again**, or cancel it and take another method |
