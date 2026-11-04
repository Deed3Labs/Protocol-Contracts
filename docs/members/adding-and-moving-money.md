# Adding and moving money

Where your money sits in Clear, how it gets in, and how it moves between your cash and your
savings.

## Where your money sits

Your **cash account** has two parts, and the app keeps them apart on purpose:

| | What it is | What it can do |
|---|---|---|
| **Spendable** | Card cash | Pay for card purchases |
| **Ready to allocate** | Dollars in your Clear account (USDC) that you haven't placed yet | Go to savings or Earn, pay a shop with Pay now, pay down credit or a plan |

Ready to allocate is yours, but your card cannot spend it. If part of your balance can't be spent on
the card, the app marks it, so you are not declined at a checkout while looking at a number that
says you had the money.

Your **savings** are separate again: CLRUSD, held in the savings vault. See
[Savings and equity credits](./savings-and-equity-credits.md).

## Adding money

The **Add money** sheet offers these ways in:

| Method | How it works |
|---|---|
| Debit or credit card | Opens Coinbase's checkout page |
| Apple Pay | Opens Coinbase's checkout page |
| Bank via Coinbase | Runs in Coinbase's page and needs a Coinbase account |
| Direct deposit or bank push | You send it from your own bank to your Clear account and routing numbers. Free |

The sheet opens from **Add money** on the Move money sheet, when you have nothing in Ready to
allocate, and from a shop charge when you're short.

For a card or Apple Pay, you choose an amount, review it — the review shows the fee and what is
added to your balance — and finish on Coinbase's page. The app tells you when the money has been
added, or when a checkout was cancelled.

**Clear cannot pull money from your bank.** For a bank deposit, you push it: the app gives you
account and routing numbers, and you send the money from your bank.

**Adding money from a linked bank, through Add money on Home.** Not available yet.

### Your account details

On Home, your cash account's **Account details** shows your account and routing numbers. Use them
to receive a paycheck or to move money in from another bank. **Share details** opens your phone's
share sheet, or copies them where there isn't one.

## Moving money between cash and savings

**Move money** — on Savings, or **Save** on Home — moves money either way between Ready to allocate
and savings.

**Into savings.** Your dollars become CLRUSD one-for-one. The move is instant, and before you
confirm, the sheet shows:

- the equity credits it earns
- your savings and credits afterwards
- what it adds to your credit limit — every dollar saved adds a dollar to the savings-backed part of
  your line

**Back to cash.** Your CLRUSD goes back into the vault and the same number of dollars comes out, to
Ready to allocate. Two things can affect it:

- **Savings backing credit you've drawn can't leave.** If you've spent against your savings, that
  amount stays put until the credit is repaid. The sheet only moves what is free; repay from the
  cycle card on Home first to free the rest. See [Repaying](./credit.md#repaying).
- **Recent equity-credit matches are given back.** Credits matched on savings you added in the last
  30 days are cancelled, newest first, up to the amount you move out. Credits that have already
  vested are kept. The sheet shows "Credits given up" before you confirm.

Moving out lowers your credit limit by the same amount.

If you have nothing in Ready to allocate, the sheet says so and offers **Add money**.

## Taking money out to a bank

Not available yet.

## Auto-save

**Auto-save** moves a set amount from Ready to allocate into savings on a schedule, weekly or
monthly. You'll find it on Savings, under your home path.

- The first run is one period after you turn it on.
- One confirmation covers twelve runs. After that, you set it again.
- Each run earns equity credits like any other deposit into savings.
- **Adjust auto-save** shows the next run, the runs left, and what it has saved this year.

If you've turned on automatic repayment, money you owe on credit is set aside from a new deposit
first, and auto-save runs on the rest. See [Credit](./credit.md#automatic-repayment).

## Related

- [Savings and equity credits](./savings-and-equity-credits.md)
- [Sending money](./sending-money.md)
- How deposits and redemptions work in the contracts: [Protocol → Savings](../protocol/savings.md)
