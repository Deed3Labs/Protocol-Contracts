# Setting up a shop

Signing up, getting verified, linking a bank, connecting Stripe for cards, and putting the app on
the tablets your staff use. The owner does everything on this page.

## The two ways in

The merchant app is one app in two forms:

| | Where | What it adds |
|---|---|---|
| The web app | `merchant.useclear.org` in any browser | Everything except the Bluetooth card readers |
| Clear for Merchants | Installed on an iPad, iPhone or Android tablet or phone | The Stripe Reader M2 over Bluetooth, Tap to Pay, and Wi-Fi printers |

Both run the same screens. Use the installed app on any device that will take cards on an M2 or
with Tap to Pay; a browser takes cards on Stripe smart readers only.

## Three kinds of sign-in

The app keeps three things apart, and it helps to know which is which:

- **The device.** A tablet or phone is *enrolled* as your shop's. That is what lets it show the
  counter at all. Only the owner enrolls a device, and the owner can remove it from anywhere.
- **A shift.** Staff pick their name and type a four-digit PIN. Every charge is recorded against
  whoever is on shift. A PIN is attribution, not a password to the money.
- **The owner's sign-in.** You sign in with Privy, by a code emailed to you or a passkey (an
  existing wallet also works). There is no password: Clear never holds one. You need it to set up
  the shop, enroll a device, and reach owner-only screens from a shared tablet. You do not need it
  to take a payment.

## Signing up

Open the merchant app on the device you will use and choose to set up a shop. Signup is seven
steps. **Save and finish later** keeps what you have typed on that device only; nothing is sent to
Clear until step 4.

1. **Start.** Your name, the shop's name and how to reach you.
2. **Your shop.** The address, what you sell and how many people work the counter. The address
   sets the shop's tax rate and its card reader location.
3. **Your team.** The people who will work the counter, up to 20, each as Counter or Manager. You
   can skip this and add people later in Staff. Nobody is sent anything: each person picks their own
   PIN on their first shift (see [Staff and shifts](./staff.md)).
4. **Your terms.** If Clear gave you a terms code, type it and choose **Apply**. Clear answers with
   what the code changes, or that its places are taken, or that it isn't a code Clear knows. You
   accept the Clear Partner terms here. What the terms are, and who sets them, is in
   [Governance](../governance/README.md).
5. **Verify it is you.** Choose a four-digit PIN for yourself, then sign in with an emailed code
   or a passkey. **This step creates the shop and its wallet**, and the account you signed in with
   becomes the owner. If a code's last place went while you were signing up, the shop is on
   standard terms and this step says so.
6. **Where payouts go.** Verify the business, then link a bank (both below). You can carry on
   without either and finish them in Settings later.
7. **The counter.** A short checklist for training your staff.

## Verifying the business

Before Clear can send the shop's money to a bank, Bridge, Clear's banking partner, verifies the
business. It is Bridge's own hosted form: the business's details, its owners, and a document or
two. The documents stay with Bridge.

1. Go to **Settings › Advanced › Business verification** (or the signup step above).
2. Choose **Verify the business**. Bridge's pages open; when you finish, Bridge sends you back.
3. Use **an email address that belongs to the business**, not your personal one. Bridge keeps one
   verification per email address, and an address it already holds as a person is refused.

The status reads Not verified, Started, In review, Verified, Not approved (with Bridge's reason) or
Paused. Below it, **Withdraw to a bank** reads After verification, Bridge is setting it up, or
Ready.

## Linking a bank

Once Bridge has verified the business, link the bank account withdrawals go to. You need the
shop's address on file too; the sheet says if anything is missing.

1. Go to **Payouts › Withdraws to** (Where withdrawals go).
2. Choose to add a bank. Plaid opens, and you sign in to your bank there. There are no account
   numbers to type and no test deposits.
3. Pick the account. Clear registers it with Bridge in the shop's name.

Clear keeps the bank's name, the last four digits and whether it is checking or savings, never the
full numbers. Only an owner adds or removes a bank; managers can see the list. **Settings ›
Payouts** shows the bank that payouts go to.

## Connecting Stripe for cards

Cards run through **your own Stripe account**, in your business's name. Clear adds its part of the
fee to each card sale (see [Payouts](./payouts.md#fees)).

1. Go to **Settings › Payments**.
2. Choose **Connect Stripe**. Stripe's own onboarding opens. You can use an existing Stripe
   account.
3. Answer Stripe's questions. When you come back, Settings reads where it stands.

Cards stay locked at Checkout until Stripe says the account can take charges. Until then the card
cell on Settings › Payments says why: **Not connected**, **Almost there** (Stripe still needs
details), **Paused by Stripe**, or **Disconnected**. Its button takes you to the right place in
Stripe. Cash and Clear work meanwhile.

Sales tax on card sales can be worked out by Stripe Tax once it is on in your own Stripe account;
see [Settings and inventory](./settings-and-inventory.md#tax).

## Set up the till

After signup, Home shows owners and managers a **Set up the till** list with six steps, each of
which opens the screen that does it:

- Cards connected (Stripe can take charges)
- A reader paired
- An item in the catalogue
- Someone added besides the owner
- Starting cash set (in Settings › Closing, or by opening the drawer with it)
- Tips or discounts saved

The list goes once all six are done. **Hide for now** hides it on that tablet.

## Enrolling a tablet

A device has to be enrolled before anyone can start a shift on it.

1. Open the merchant app (or the installed app) on the tablet.
2. Sign in as the owner, with an emailed code or a passkey.
3. On **Set up this tablet**, give it a name you will recognise (it starts as "Counter tablet")
   and choose **Enroll this device**.

The screen states what the device can and can't do: it can raise charges up to the shop's
approval cap, and it can't move money, change terms or see bank details. It locks back to the
shift screen after five idle minutes; change that per tablet in **Settings › Counter** (1, 2, 5,
10, 15 or 30 minutes).

Enroll each counter device the same way. Rename the current tablet in **Settings › Devices ›
This tablet**.

## Removing a tablet

Go to **Settings › Security › Devices**, which lists every device signed in as the shop, and sign
the one you want out. It signs out on its next request, from wherever you are, and any shift on it
ends. No charge, payout or record is lost: the device only ever held a session.

The removed device shows **This tablet was removed**. To use it again, enroll it again.

## The installed app

The installed app is the same app wrapped for iOS and Android. Beyond the web app it can:

- pair and take cards on a **Stripe Reader M2** over Bluetooth;
- take **Tap to Pay** on the device itself. Android needs nothing extra. On an iPhone or iPad it
  depends on Apple granting Clear's app the Tap to Pay entitlement;
- print to **Wi-Fi printers** and talk to Bluetooth hardware (see [Clear Terminal](./clear-terminal.md)).

It asks for Bluetooth and location permission (Stripe needs the device's location to take card
payments), and on iOS for local network access, to find printers on your shop's network.

## Signing your shop in to useclear.org

To reserve Clear hardware on useclear.org, the site sends you to the merchant app's **/connect**
page. Sign in as the owner there; it sends you straight back to the site, signed in as the shop.
It doesn't enroll a device or start a shift.

## Shop details and hours

**Settings › Shop** holds what members see in the Clear Partners listing: the name, what you do, a
one-line description, the address, phone and email, and your opening hours, with dates that
differ (closed all day, or other hours). Members see "open now" from the hours. Staff's own hours
sit inside these (see [Staff and shifts](./staff.md#hours)). Only the owner changes them.

## When something goes wrong

| What you see | What it means, and what to do |
|---|---|
| The tablet shows the owner's sign-in instead of the shift screen | It isn't enrolled. The owner signs in and enrolls it |
| "This tablet was removed" | An owner signed it out in Settings › Security. Enroll it again to use it |
| "Owner sign-in is not set up" | This copy of the app has no sign-in configured. The counter still works; contact Clear |
| Business verification reads Not approved | Bridge says why on the same cell. **See what Bridge needs** |
| Business verification reads Paused | Contact Clear |
| Linking a bank says the business isn't verified, or the address is missing | Verify the business first, and add the shop's address in Settings › Shop |
| An email is refused when you start verification | Bridge already holds that address as a person. Use an email that belongs to the business |
| Stripe sends you back before you finish | Settings asks Stripe for a fresh link; carry on from where you left off |
