# Clear Terminal

The counter hardware and table service: Clear Points, the cash drawer, printers, card readers at
the table, and Tables. Everything here is set up in **Settings › Devices** (owners). Hardware you
reserved on useclear.org shows there under **On order** until it ships.

**Add a device** offers four kinds:

| Kind | What it is |
|---|---|
| Clear Point | A screen for a table, the counter or the door |
| Card reader | A Stripe Reader M2, or Tap to Pay on this device |
| Cash drawer | A Clear Drawer, or a drawer cabled to your printer |
| Printer | Any 4-inch label printer or receipt printer |

Pairing a Point, the drawer or a Bluetooth printer uses Bluetooth: in the installed app, or in
Chrome in a browser. Signing in another tablet is in Settings › Security, not here.

## Points

A Point is a small screen with a code that customers scan with their phone. What it shows depends
on where it is:

| Placement | When nothing is happening | What else it shows |
|---|---|---|
| Table | Its table number and the menu code | That table's bill when you send it, then Paid |
| Counter | Pay here | Whatever you send it: the total and the code for a sale |
| Door | The wait list | Table ready, when a table is |

### Adding a Point

1. **Settings › Devices › Add a device › Clear Point.**
2. **Scan** the code on the back of the Point with the tablet's camera, or type the four letters
   under it.
3. **Wi-Fi.** Pick the network the Point should join and type its password. It's sent to the Point
   over Bluetooth and never shown on it. A network that asks for a username, or has a sign-in page,
   can't be used by a Point; the list and Connect say so.
4. **Where it goes:** Counter, Table (with its number) or Door. The sheet shows what it will display.

### A Point's settings

Each Point has its own pane in Settings › Devices:

- **What it shows when idle:** Number, Menu, Showcase (items you pick) or Pay here.
- **By time of day:** the Menu while you're open and Pay here from 9pm to 5am, in the shop's time zone.
- **Show a test screen** to check it. It goes back by itself after a minute.
- **Firmware:** whether it's up to date.
- **Unpair** frees it; it can be added again.

### Showing a sale on a Point

At the counter, a sale's total and code show on the counter Point by default, or on a table's
Point when the order is a table's, or on this tablet only. The choice is kept on the tablet for the
next sale. Card and cash still work from the tablet either way.

**Order ready.** For a shop with a counter Point, Home has an Order ready cell. Calling an order
puts it on the counter Point and, if the customer left a phone number, texts them.

## The Pay case: a card reader at the table

A Pay case holds a Stripe Reader M2 under a Point, with two buttons.

- **Call** pages whoever is on shift. The ring light stays on until someone answers it on Home or
  Tables. Pressing it again cancels it.
- **Bill** either sends the bill to the Point, or just tells staff (**Send the bill to the Point**
  or **Just tell staff**).

Link the M2 to its Point on the Point's pane (**Reader inside**). One reader links to one Point.

The Point never talks to the reader; the tablet does. When a table's bill goes to a Point with a
linked reader, the tablet connects to that M2, takes the payment, then gives it back and returns to
the counter's reader. It lets go after the payment succeeds, fails or is cancelled, when the bill is
taken back, or after five idle minutes. The tablet can hold one reader at a time, so a second table
waits in a queue, and a payment in progress is never interrupted. The card screen shows which
table's reader it is using.

This needs the installed app, because only the installed app can drive an M2.

## Card readers

Card readers are covered in [Taking payments](./taking-payments.md#card). In short:

- **Smart readers** are added in **Settings › Payments › Add a reader**, with the pairing code
  the reader shows (on the reader: Settings, then Generate pairing code).
- **The M2 and Tap to Pay** are found from the card screen in the installed app. Choosing Card
  reader in Add a device takes you to Settings › Payments.

## The cash drawer

**A Clear Drawer** pairs over Bluetooth:

1. **Settings › Devices › Add a device › Cash drawer.**
2. Pick the drawer from the list the tablet finds.
3. **Test open.** This pairs it: the tablet gives the drawer its key and opens it.

Only an enrolled tablet with the drawer's key can open it, and every open is logged. If a drawer is
already paired to another shop, the tablet says to hold its button for 10 seconds to reset it.

**A drawer cabled to a receipt printer** is opened by the printer instead: turn on **Cabled to the
printer instead** on the drawer's pane.

The drawer's pane also sets:

- **Opens on a cash sale**, and when a cash refund is given: always.
- **No sale needs a PIN**, plus a reason (on to start with). Every No sale shows at Close the day.
- **Who can open it without a sale**: owners and managers (to start with), or everyone on shift.

See [Closing the day](./closing-the-day.md#opening-it-without-a-sale) for No sale at the counter.

## Printers

**Settings › Devices › Add a device › Printer**: pick the printer the tablet finds, then **Print a
test label**. Receipt printers and 4-inch label printers work, over Bluetooth, or on your Wi-Fi in
the installed app. Without a printer, receipts use the device's own print dialog.

## Tables

Turn on **Settings › Counter › Table service** to add **Tables** to the nav.

### Setting up tables

The first time, Tables offers **Set up tables** to owners and managers: it makes the number of
tables you choose, then opens **Edit tables**, where you set each table's area, seats and Point.
Saving Edit tables needs a manager or owner.

### The floor

Tables shows a tile for each table, grouped by area, each saying its next step. Calls and bill
requests from Pay cases show along the top, and on Home. On a phone, the floor is a list grouped by
state, with the wait list a tab away.

Tap a table for its sheet. The main button is always the next step:

| The table is | You can |
|---|---|
| Free | Seat a walk-in (how many, and a name if you like), or a party from the wait list |
| Seated, held, ordered or calling | **Add items**, **Send the bill**, **Move**; **Unseat** while nothing is on its tab |
| Bill sent | **Take back** (un-sends it), **Take payment** |
| Paid | **Clear** |

- **Add items** opens New charge on the table's tab: what's on it, what you're adding, and **Add
  to the tab**.
- **Take payment** opens Checkout for that bill, with Clear, card, cash or split. Leaving it never
  voids the table's tab.
- **Move** takes the tab, the party and the bill to a free table. Tables that seat the party are
  listed first. The bill on the old Point follows them.
- **Unseat** frees a table seated or held by mistake. A party from the wait list goes back to their
  old place in it.
- **Clear** frees a paid table. Settings › Counter can clear paid tables by themselves, 10 minutes
  after paying to start with, or leave it to you.

### The wait list

**Add a party**: a name, how many, and a phone number to text. A
party's sheet has **Seat at** (with their name shown on the table's Point if you choose), **Text
them**, **Text: almost ready**, **No show** and **Remove**. The next party that fits is marked
Next.

When you seat a party from the list, their table is held for them for up to 15 minutes, with their
name on its Point. The hold ends when the first item goes on the tab, when you mark them seated, or
when the time runs out.

Guests can also join from the door Point's page on their phone.

**Wait estimates** come from how long tables took this week, or a set number of minutes (Settings ›
Counter). **Tell them** on a party overrides it for that party.

**Texts** go to a party only when they gave a number, agreed to texts, and **Text the wait list** is
on in Settings › Counter. There are three: joined, almost ready, and table ready. With texting off,
Text them says so.

## When something goes wrong

| What you see | What to do |
|---|---|
| "Asks for a username, so a Point can't use it" | Pick another network; enterprise Wi-Fi isn't supported |
| "Has a sign-in page, so a Point can't use it" | Pick a network without a sign-in page |
| "That drawer is paired to another shop" | Hold the drawer's button for 10 seconds to reset it, then try again |
| "Drawer didn't open" at a cash sale | Use the key, then **I used the key** |
| A tile reads "No Point" | No Point is linked to that table; link one in Edit tables |
| The card screen says it's waiting for a table's reader | Another table is paying on it, or it's connecting; it comes back after that payment |
