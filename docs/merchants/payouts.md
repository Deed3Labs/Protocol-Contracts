# Payouts

What the shop is owed, where its money sits, how to move it to a bank, what it costs, and the
records you get. **Payouts** and **Overview** are open to owners and managers.

## Where your money comes from

Each way of paying reaches you differently:

| Paid by | Where the money goes | Shown on Payouts as |
|---|---|---|
| Clear | Clear owes it to the shop, and pays it out under your terms | **Clear** |
| Card | Stripe pays it into your bank from your own Stripe account | **Card**, one row per deposit |
| Cash | It's in the drawer; Close the day sets aside what goes to the bank | **Cash and tips** |

## Owed and held

For Clear payments, Payouts shows two balances:

- **Owed** is what the co-op owes the shop for approved Clear charges, after Clear's fee. Part of it
  may already be **released**: money the payout pool can pay now. The rest releases on your payout
  day.
- **The cash account** is money the shop already holds. It is the shop's own wallet, in your
  business's name, held as USDC (a digital dollar). From there you can withdraw it to your bank, spend it at other
  Clear Partners, or receive into it.

The figure at the top, **Ready to withdraw**, is what can move today: the cash account plus what's
released. **Where it sits** breaks the total into the cash account, released, and what releases on
the payout day.

How the payable and the payout pool work on chain is in [Settlement](../protocol/settlement.md).

## When you're paid

Your terms set when what you're owed is paid (see [Governance](../governance/README.md)):

- If they set a **payout day**, Payouts counts down to it and says "Paid on the" day, and released
  money can be moved sooner.
- If there is no payout day, the shop is on **net-30**, and Payouts says so wherever the day would
  go. On net-30, nothing counts down until you withdraw: withdrawing is what starts the 30 days.

When you withdraw what you're owed, the released part is paid into your cash account at once. The
rest **queues**, and the sheet tells you so before and after, with the date it's due. It's paid
into your cash account when it comes due, and stays counted as owed until then; you don't have to
ask again.

Card deposits follow your Stripe account's own payout schedule.

## Withdrawing

Owners and managers can withdraw. Only an owner can add or remove the bank it goes to (see
[Setting up](./setting-up.md#linking-a-bank)).

1. On **Payouts**, choose **Withdraw**.
2. **Where is it coming from?** What you're owed, or the cash account.
3. **Where does it end up?** Pick a destination. ACH (Automated Clearing House) is the ordinary
   US bank-to-bank transfer.

| Destination | Arrives | Fee |
|---|---|---|
| Cash account | Instantly | None |
| Your bank, standard ACH | 1–3 business days | None |
| Your bank, same-day ACH | Today | 1%, shown in dollars before you send |

4. Confirm. Owed money always passes through the cash account on its way to a bank; the screen
   shows the route as one line.

Only money in the cash account can go on to the bank. If part of a withdrawal queues, the bank gets
the part paid now, and the queued part lands in the cash account when it's paid. The screen never
says money moved when it didn't: a refused transfer, or a cash account that couldn't fund it, says
so and that nothing left.

**Withdrawing to a debit card:** Not available yet.

### Allowing Clear to settle payouts

Withdrawing what you're owed needs Clear to be able to act on the shop's wallet. If it can't yet,
Payouts shows the owner a one-time **Allow Clear to settle payouts** (it may ask you to set up a
passkey first). Until then a withdrawal is recorded, and the screen says it goes once Clear can
sign.

## Receiving into the cash account

**Cash account › Receive** shows account and routing numbers that pay into the shop's cash account,
for an ACH payment or a wire. The owner opens them once, after Bridge has verified the business.
**Email them** sends the numbers only to the email the business was verified under.

## Fees

**On a Clear charge**, Clear's fee is a percentage of the charge: the rate in your terms for a
charge paid now, or the rate for one paid over time. What the shop receives is the charge less that
fee, and the screens show the fee as the charge happens. The rates are part of your terms; see
**Settings › Partnership**, and [Governance](../governance/README.md) for who sets them.

**On a card sale**, two fees come out:

- **Stripe's processing fee**, charged by Stripe on your own Stripe account.
- **Clear's card fee**: nothing on a card sale under $10.00; otherwise 30¢ a sale on the free
  pay-as-you-go plan, or your plan's fee on a paid plan. It is worked out on the final amount, tip
  included, and Stripe takes it when the payment is captured.

Each card deposit on Payouts shows the sales, Stripe's fee and Clear's fee apart, and what reached
the bank. Disputes and other adjustments Stripe made show there too.

**On a withdrawal**, only same-day ACH costs anything (1%).

## Checked against Stripe

Every night Clear checks its books against Stripe. The result is on **Payouts › Checked against
Stripe**: "Everything matches", or each thing that doesn't, in plain words with its figures and
since when. For example, a payout that isn't in the books, or Clear's fee on a card sale that
differs from what was expected.

When you've looked into one, choose **Explain** and write what happened. It closes with your name on
it, and stays closed while its figures hold; if they move, it opens again.

## Statements and exports

- **Overview** is the month: sales and their trend, how they were paid, top items, discounts, tips
  and tax, fees, what's owed, and the end-of-day reports. **Export** downloads the month's sales as
  a spreadsheet (CSV), one row a sale. In the installed app it opens the share sheet instead.
- **Statements** (from Overview, or **Settings › Payouts**) lists this month and the two before.
  Each shows sales by method, discounts, tips, tax, refunds, the card deposits with Stripe's and
  Clear's fees, tips by person and the days closed. **PDF** opens the print dialog, where you can
  save it as a PDF. **CSV** is the month's sales.
- **Send to my accountant** emails a month's statement to an address you type.
- **Email each statement** (Settings › Payouts) sends last month's statement on the 2nd, in the
  shop's time zone, to the address you set.
- **Settings › Advanced › Your data** (owner) downloads every charge since you joined, and every
  payout with Stripe's and Clear's fees where they're known, as CSV.
- Each payout on Payouts opens its own statement, with the number of charges in it.

## When something goes wrong

| What you see | What it means, and what to do |
|---|---|
| Payouts sends you to Home | Payouts is for owners and managers |
| **Allow Clear to settle payouts** shows on Payouts | Clear can't act on the shop's wallet yet. The owner allows it once |
| A withdrawal reads "Queued" with a date | The pool couldn't pay all of it today; the rest is paid into the cash account on that date |
| A withdrawal to the bank was refused | Nothing left the cash account. The reason is on the sheet; try again, or withdraw to the cash account |
| Withdraws to reads "Not set" | No bank is linked yet. The owner links one (see [Setting up](./setting-up.md#linking-a-bank)) |
| A card deposit "didn't reach the bank" | Stripe is sending it again |
| A flag under Checked against Stripe | Look into it, and **Explain** what happened. A card that couldn't be captured after Stripe was disconnected is captured in your Stripe Dashboard before its hold lapses |
