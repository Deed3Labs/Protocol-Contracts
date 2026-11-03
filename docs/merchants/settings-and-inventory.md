# Settings and inventory

How the shop is set: tax, tips, discounts, receipts, the counter, closing and notifications; and
the catalogue the counter sells from.

## Who sees Settings

Open Settings from your profile menu.

- **An owner** sees every section, and is the only one who can change the shop's settings. Each
  change saves as you make it.
- **A manager** sees Shop app, Developers and You.
- **Counter staff** see Shop app (without changing it) and You.

**You** holds your own PIN and how this tablet is set. Each tablet's appearance (Light, Dusk or
Dark) is chosen from the profile menu.

| Section | What's in it |
|---|---|
| Shop | Your listing in Clear Partners, contact details, opening hours ([Setting up](./setting-up.md#shop-details-and-hours)) |
| Payouts | Where payouts go, the schedule, statements ([Payouts](./payouts.md)) |
| Partnership | Your terms, your agreement, your co-op record |
| Counter | Breaks, this tablet's PIN lock, table service |
| Payments | Ways to pay, Stripe, readers, offline ([Taking payments](./taking-payments.md)) |
| Tax | Where tax comes from, how prices show |
| Tips | Asking, the amounts, who gets them |
| Discounts | Codes, and each role's limit |
| Shop app | Your own app for your customers ([Rewards and online sales](./rewards-and-online.md)) |
| Developers | Pay with Clear on your website ([Rewards and online sales](./rewards-and-online.md#pay-with-clear-on-your-website)) |
| Devices | Points, card readers, the cash drawer, printers, this tablet ([Clear Terminal](./clear-terminal.md)) |
| Closing | The drawer, and who closes ([Closing the day](./closing-the-day.md)) |
| Security | Your sign-in, and every device signed in as the shop |
| Notifications | The end-of-day summary |
| Advanced | Business verification, your data |
| Help | A person, then the guides |

## Tax

**Settings › Tax › Where you collect** shows where the shop's rate comes from:

- **Worked out by Stripe Tax**, once Stripe Tax is on in the shop's own Stripe account. The rate
  follows the address; you never type a percentage.
- **The rate for the shop's address**, until then.
- **No tax added yet**, if neither is available.

It also shows the address, where you're registered, and the rate by kind of item, with how many
items of each kind you have: taxable goods, labour, prepared food and exempt. The kind is chosen on
each item in Inventory.

**How prices show** chooses between prices **before tax, added at checkout**, and **tax included**,
where a $9.00 item costs $9.00.

## Tips

- **Ask before they pay** turns the tip screen on or off. It asks once, whichever way they pay.
- **Offer** amounts ($5, $10 and $20 to start with) or percentages (15, 18 and 20%). Switching
  starts from that kind's usual three. Up to four presets; tap one to change it, or **+ Add**. The
  customer can also choose Custom.
- **Who gets them**: whoever raised the charge, or split by hours on shift (see
  [Staff and shifts](./staff.md#tip-sharing)).

## Discounts

**Codes** are discounts the shop makes. **New code** takes:

- a percentage or an amount off;
- the whole charge, or one category;
- optional start and end dates;
- whether it can be used once per customer.

A code works at Checkout, typed or scanned. Codes can also show as offers in your shop app (see
[Rewards and online sales](./rewards-and-online.md)).

**Limits by role** set the most each role can take off a charge without a PIN: counter 10% and
manager 25% to start with; an owner has no limit. Above a limit, an owner or manager enters their
PIN at the counter.

## Receipts

Receipts are sent after each sale by text, email or print (see
[Taking payments](./taking-payments.md#receipts)). Printing uses a paired printer, or the device's
print dialog when there isn't one; add a printer in **Settings › Devices**.

## Counter

- **Break**: how long a break is, and after how long on shift one is due. Home shows who is due one.
  It isn't a timesheet.
- **This tablet asks for a PIN after**: 1, 2, 5, 10, 15 or 30 minutes idle. Set per tablet.
- **Table service** adds Tables to the nav, with its rules (see
  [Clear Terminal](./clear-terminal.md#tables)). Off for counter service.

## Closing

Starting cash, two counts at close, and who can close. See
[Closing the day](./closing-the-day.md).

## Notifications

**End-of-day summary** emails the day's figures to the address in **Send to** when the day is
closed (see [Closing the day](./closing-the-day.md#the-end-of-day-summary)). It's the only
notification by email for now; Home shows refunds waiting for you, charges still waiting and stock
running low.

## Security

Lists every device signed in as the shop, with when it was enrolled and last used. Sign one out to
remove it (see [Setting up](./setting-up.md#removing-a-tablet)).

## Inventory

**Inventory** is the catalogue the counter sells from, with stock. Everyone sees it; owners and
managers change it.

- **Add item**: goods or a service, a name, a size or detail, the price, what you pay (optional), how
  many are on the shelf, the level to reorder at, its category and its sales tax kind. Services keep
  no stock.
- **Options**: option groups on an item (a size, an add-on), which add to its price.
- **Adjust stock**: received, counted (replaces the count) or damaged. Each item keeps its history.
- **Mark reordered** and **Receive the order** track a reorder until it arrives.
- **Edit item** changes it; past charges keep the prices they were sold at.
- **Archive** an item to take it off sale.

**Running low** on Home, for owners and managers, lists stocked items at or under their reorder
level, or out. Services never appear there.

### Importing a spreadsheet

Owners and managers can bring in a catalogue from a spreadsheet saved as CSV.

1. In Inventory, choose **Import a spreadsheet** and pick the file.
2. The tablet reads it and guesses each column from its header: Item to Name, Size to Size or
   detail, Retail to Price, Cost to You pay, Qty to On the shelf, and Category and Reorder at.
3. Check the mapping. Change any column, or leave it out. Each field takes one column.
4. Import.

How rows are treated:

- **A row that matches an item you already have** (same name and size, ignoring case and spacing)
  adds its quantity to that item's stock as a delivery. Nothing else changes, prices included.
- **Any other row is a new item** and needs a price. A category of Services or Labour makes it a
  service; anything else is goods, in Parts when no category is given.
- **Rows that can't go in are listed with why** ("Wiper blades has no price"), and the rest still go
  in.
- At most 2,000 rows at a time.
