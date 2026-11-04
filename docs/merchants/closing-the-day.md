# Closing the day and the drawer

The cash drawer has one session a day: opened in the morning with the starting cash, counted at
night, then closed. **Close the day** locks the day's figures, captures the day's card payments and
settles tips.

## Opening the drawer

The first person on opens it from Home: **Open the drawer**, then **Start with** the amount.
It offers the amount the last close left in the drawer ("Same as last close"), or **Something else**
to type what is there. Everyone after joins the drawer that is already open.

The shop's starting cash is set in **Settings › Closing** ($150.00 to start with). Cash sales and
cash refunds need the drawer open.

## Opening it without a sale

If a Clear cash drawer is paired, **No sale** is in your profile menu. It asks for a reason (change
for a note, gave wrong change, counting, or something else) and, by default, a PIN:

- If the shop lets only owners and managers open it without a sale (the default), a manager or
  owner types theirs.
- If the shop allows everyone on shift, your own.

The approval lasts two minutes and opens the drawer once. Every No sale shows at Close the day. Set
both rules in **Settings › Devices › the drawer**. A No sale needs a connection; the drawer opening
for a sale doesn't.

## Counting the drawer

Counting is part of closing; there is no count when the drawer opens. On Home, the drawer panel
offers **Count to close**.

1. **The first count.** Count the drawer by note and coin, or type a total. You don't see what the
   drawer should hold.
2. **The second count**, by someone else, also blind. Neither sees the other's figure or the
   expected total until both are in. (An owner can switch to one count in **Settings › Closing ›
   Two counts at close**.)
3. **If the two counts disagree,** one of the two counts again; their new count replaces their
   old one, which is kept.
4. **If they agree but differ from what the drawer should hold**, the drawer is short or over and
   needs a **sign-off**: a manager or owner who didn't make the first count types their PIN and a
   note saying what happened. This is always required.

What the drawer should hold is worked out from the books: the starting cash, cash taken, change
given, cash refunds and tips paid out.

## Who can close

**Settings › Closing › Who can close** is the owner's choice:

- **Owners and managers** (the default). Counter staff see who to ask.
- **Anyone on shift**, once the counts agree. A short or over drawer still needs a manager's or
  owner's sign-off.

## Closing with one person on

**Settings › Closing › When only one person is on** offers two choices: **One count, signed off by
the owner next morning** (the default), or **Wait for a second person**. The choice is saved with the
shop's settings.

**The app doesn't act on this setting yet.** Whichever you pick, Close the day follows the rules
above — two counts at close, the sign-off, and who can close — and nothing is put on the owner's Home
the next morning, though the setting's note says it would be. So with one person on:

- **With Two counts at close on**, the close waits until someone else makes the second count. The
  same person can't count twice.
- **With it off**, one count is enough. But if that count is short or over, it still needs a
  sign-off from a manager or owner who didn't make the count, so a lone closer can't close a drawer
  that doesn't match.
- **Who can close** still applies: with Owners and managers, counter staff on their own can count
  but not close.

If you often close alone, an owner can turn off **Two counts at close**.

## Close the day

Once the counts are in, Home's drawer panel offers **Close the day**. The page shows the day: what
was taken (Clear, card and cash, tips included), sales tax collected, discounts and refunds, anything
still waiting, the drawer's opens, the tips to pay out, and what to leave for tomorrow.

Closing is refused while:

- an order is part-paid (finish it or void it);
- the drawer hasn't been counted, or the counts disagree;
- a difference hasn't been signed off.

When you close:

1. **The day's card payments are captured** at their final amounts, tips included. A card that
   couldn't be captured is named, with what to do; it doesn't stop the close, and Clear tries
   again.
2. **The difference is booked**, if there was one.
3. **Cash tips are paid out of the drawer.** Card tips are owed to each person and paid with
   payroll. With tips split by hours, the pool is shared now (see
   [Staff and shifts](./staff.md#tip-sharing)).
4. **Tomorrow's starting cash stays in the drawer**, and the rest is set aside to go to the bank.
5. **The day report is written.** Nothing changes it afterwards. Closing again just shows it.

## Taking the cash to the bank

After a close, **Payouts › Cash and tips** shows what stayed in the drawer, what goes to the bank,
and the tips owed. When the cash has been deposited, a manager or owner chooses **Mark deposited**.

## The end-of-day summary

If **Settings › Notifications** has an address, an email goes there when the day is closed (not at
a set time, because the figures are only final then). It has what was taken and how, tips, tax,
discounts and refunds; the drawer (counted, expected, any difference and who signed it off, what
went to the bank and what was left); tips by person; and any card that couldn't be captured.
Closing the same day again doesn't send it twice.

## When something goes wrong

| What you see | What to do |
|---|---|
| "N order(s) are part-paid: finish or void them first" | Open each in Charges and take the rest of the payment, or void it |
| "Count the drawer first (two counts, blind)" | Both counts are needed |
| "The counts disagree: one of you counts again first" | Whoever made one of the counts counts again |
| "The drawer is short (or over): a manager or owner signs it off first" | A manager or owner who didn't count first signs it off with a note |
| "An owner or manager closes the day" | Settings › Closing allows only owners and managers |
| A card that couldn't be captured | If Stripe was disconnected while a card was held, Clear can't capture it. Capture it in your Stripe Dashboard before the hold lapses, then explain the flag on Payouts (see [Payouts](./payouts.md#checked-against-stripe)) |
| "Drawer didn't open" at a cash sale | Use the key, then choose **I used the key** so the open is recorded |
