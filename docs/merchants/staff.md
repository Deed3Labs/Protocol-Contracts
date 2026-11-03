# Staff and shifts

Roles, PINs, shifts and breaks, hours, and how tips are shared. **Staff** is open to owners and
managers.

## Roles

A shop has three roles. The line between them is what a mistake would cost, not seniority.

- **Counter** takes payments and starts refunds. Counter staff never see payouts, bank details,
  fees or the month's totals.
- **Manager** runs the shop: sees the money, keeps the roster, approves refunds, voids and drawer
  differences, and can withdraw what the shop is owed to the bank already on file.
- **Owner** is the only one who can change where the money goes (the bank), the shop's settings,
  which devices are enrolled, and the refund limit.

Owners aren't added from the app. Clear changes who owns a shop; contact Clear.

### Who can do what

| | Counter | Manager | Owner |
|---|---|---|---|
| Take a payment, start a refund | Yes | Yes | Yes |
| Approve a card or cash refund, void a sale | — | Yes | Yes |
| Approve a Clear refund | — | Up to the refund limit | Any amount |
| Close the day | If Settings › Closing allows | Yes | Yes |
| Sign off a drawer difference | — | Yes | Yes |
| See Payouts, Staff and Overview | — | Yes | Yes |
| Withdraw to the bank on file | — | Yes | Yes |
| Add counter staff | — | Yes | Yes |
| Add managers, change a role | — | Asks the owner | Yes |
| Edit inventory, import a spreadsheet | — | Yes | Yes |
| Payment links, Settings › Developers, Settings › Shop app | — | Yes | Yes |
| Link or remove a bank, connect Stripe, verify the business | — | — | Yes |
| Change the shop's settings, enroll or remove devices, set the refund limit | — | — | Yes |

The details of each are on the page that covers it:
[refunds and voids](./refunds-voids-disputes.md), [closing](./closing-the-day.md),
[payouts](./payouts.md), [settings](./settings-and-inventory.md).

The server holds every one of these rules. The app also hides what a role can't use: on a counter
shift, Payouts, Staff and Overview are padlocked in the nav, and tapping one opens the owner's
sign-in.

## Adding someone

1. Open **Staff** and choose **Add someone**.
2. Type their name and pick their role. An owner can add Counter or Manager; a manager adds
   Counter.

They have no PIN yet. On the shift screen their tile reads **First shift**. The first time they
tap it, they choose four digits and type them again, and their shift starts.

## PINs

- **A PIN is four digits and unique within the shop.** Approvals (a void, a refund, a discount
  over the limit) are a PIN with no name, matched against everyone, so a PIN somebody else already
  has is refused ("Pick different four digits"). The app never says whose it is.
- **Three wrong tries** on a tablet and it waits 30 seconds.
- **Ten wrong PINs in 15 minutes, anywhere in the shop, lock every PIN at the shop**: shifts and
  approvals alike. It reopens by itself as the wrong tries age out, and the screen says when.
  Nobody can clear it early. A correct PIN doesn't reset the count.
- **Resetting a PIN clears it.** Open the person in Staff and choose **Reset their PIN**; you type
  your own PIN to confirm. They choose a new one on their next shift. A shift they are on carries
  on.

Who can reset or remove whom: a manager, counter staff; an owner, counter staff and managers. Never
an owner, and never yourself.

## Changing a role

Open the person in Staff and change their role between Counter and Manager. It always needs the
**owner's PIN**: an owner types their own, and a manager asks the owner to type theirs. It takes
effect on that person's next request.

## Removing someone

Open the person and choose **Remove**. Their PIN stops working and any shift they are on ends at
once. Every charge they raised keeps their name.

## The refund limit

The refund limit decides who can approve a Clear refund, and how (see
[Refunds, voids and disputes](./refunds-voids-disputes.md)). The owner sets it in **Staff**. It
starts at $500.00, can't be set above the shop's approval cap, and can be set to **Off** ($0.00),
which sends every Clear refund to the owner. A manager sees the limit but can't change it.

## Shifts

- **A shift starts with a PIN.** On **Who's on the counter?**, a person taps their name and types
  their PIN. Their shift starts unless one is already running.
- **Handing the tablet over doesn't end anyone's shift.** The next person signs in on top; everyone
  who started a shift stays on until they end it. Home's crew strip shows who is on.
- **End shift** (on Home, or from your profile) signs you out and ends your shift and any break.
  Its sheet shows the charges you raised, the cash you took and your tips today. An owner can end anyone's
  shift from their sheet in Staff; a manager can end counter staff's.
- **A shift nobody ended** is closed on the next read after its day, at eight hours in, and marked
  as a guess.
- **The tablet locks** after its idle time (Settings › Counter). The shift keeps running; the
  tablet asks for a PIN again.

## Breaks

Settings › Counter sets how long a break is and after how many hours on shift one is due (30
minutes after 5 hours to start with). Home's shift clock counts worked time and says **break
due** once someone has worked that long without one.

**Start break** and **End break** are on Home, under your shift clock. One break at a time. The tablet's idle lock still
applies during a break.

## Hours

Each person's hours are a plan by week: their usual hours, and a week that differs.

- **Every week** starts next Monday (this week stays as it is), unless the person has no usual
  hours yet, in which case they start now.
- **This week only** replaces this week.

An owner sets anyone's hours; a manager sets counter staff's and their own. Home's clock shows each
shift's booked end ("Until 4:00pm"), and someone not booked today sees **Not booked today**.

## Tip sharing

**Settings › Tips › Who gets them** chooses how tips are shared:

- **Whoever raised the charge** gets its tip.
- **Split by hours on shift** pools a business day's tips and shares them by each person's minutes
  on shift that day, from their PIN to End shift (or now, for someone still on), less breaks.
  Card and cash tips are pooled and shared separately. Shares are in whole cents and always add up
  to the pool. A day nobody clocked in for is shared by who raised each charge.

Either way, tips are settled at **Close the day**: cash tips are paid out of the drawer, and card
tips (and Clear tips) are owed to each person and paid with payroll. With splitting by hours on,
"your tips" can change at close, because that is when the pool is shared. Each person sees their
own tips today when they end their shift.

Shares by hours depend on everyone starting their shift with their PIN and ending it with End
shift.
