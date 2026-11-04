# Rewards and online sales

Your shop's own app for customers, with points, rewards and offers; and taking Clear payments on
your website.

## Your shop app

**Settings › Shop app** is your own app for your customers: rewards, offers and paying with Clear.
Owners and managers change it; counter staff can see it. Every change saves as you make it, and the
preview beside it is the app as a customer sees it.

### Turning it on

Choose **Turn on**. Your app lives at `useclear.org/s/` and your shop's name, and installs from the
browser. From the same cell:

- **Copy** the link, or let customers scan its QR code ("Scan to join").
- **Print** a counter card: a 4 × 6 card with the code, for the register and tables.
- See how many customers have joined, how many this week, and how many have Clear.

### Look

Your logo (a square image, at least 512px; leave it empty for your initials), your colours (a preset
or your own, checked so text stays readable), and your fonts (a preset, or one you upload and
have the right to use on the web and in an app).

### Earning

- **Earn by** dollars spent, or **visits**, one stamp a visit like a punch card.
  - By dollars: how many points for every so many dollars. **Keep the change** carries leftover
    dollars to the next visit.
  - By visits: the least a visit has to pay to earn a stamp, and how many stamps fill a card.
- Points are counted on what the customer pays before tax and tip. A refund takes back what was
  earned on the refunded part.
- **Extra for paying with Clear**: off, 1.5× or 2×. Clear costs you less to take than a card, so you
  can pass some of that on.
- **Call them**: what the app calls points (stamps, for example).
- **Expire**: never, 12 months or 6 months, counted from the customer's last visit. A change applies
  to points earned after it.

**Preview an order** shows what an amount would earn, paid by card or cash and paid with Clear.

### Boosts and bonuses

- **Boosts** multiply the rate on some days, some hours or some items (1.5×, 2× or 3×). Only the
  biggest boost that applies counts.
- **For joining**: points when someone joins.
- **Birthday**: a reward on their birthday.
- **Bring a friend**: points for a referral.

### Rewards

A reward is an item, an amount off or a percentage off, for a number of points. It can be limited
per customer (once a day or once a week) and kept to Clear members. Rewards never become cash.

### Offers in the app

Discount codes are made in **Settings › Discounts**; here you choose which of them the app shows.
**Show in app** on a code lists it under Offers. Codes still work at Checkout either way.

### At the counter

Add the customer to the sale (see [Taking payments](./taking-payments.md#a-sale-start-to-finish)):
scan the code in their app, or add them by phone number and they confirm on their phone. You see
their name and their points at your shop, never a balance or anything from another shop. Points are
earned when the order is paid. A reward is applied to the order before Checkout.

### Your own domain

Add-on, billed with your plan.

1. **Your own domain › Set up**, and type the domain, for example `rewards.yourshop.com`.
2. Add the DNS record the sheet shows where you bought the domain. If the domain is used elsewhere,
   a second record proves it's yours.
3. Clear checks for it and turns on HTTPS. **Check again** looks again; changes can take up to an
   hour.

Your `useclear.org/s/` link keeps working and forwards to your domain. Customers confirm their phone
number once on your domain, because it can't share Clear's sign-in.

### Your own app in the stores

Add-on, with a setup charge and then monthly. Your app, with your name and icon, in the App Store
and Google Play. It adds push notifications, your rewards card in Apple Wallet and Google Wallet,
and the scanner.

Apple and Google require it to be published from **your own developer accounts**, so it's yours:

1. Open your developer accounts: the Apple Developer Program and the Google Play Console, as a
   business. Apple asks for a D-U-N-S number.
2. Invite Clear as an admin on both.
3. Clear builds and submits it: your icon, name, screenshots and listing.
4. Clear keeps it current for as long as the add-on is on.

**Start** emails Clear (`partners@useclear.org`). The sheet shows where each build stands once
there is one.

### What the add-ons cost

The app labels **Your own domain** "billed with your plan" and **Your own app in the stores** "setup,
then monthly", without a figure. **The code doesn't set a price for either, and the app doesn't
charge for them:** setting up a domain in Settings bills nothing, and the store app starts as an email
to Clear. Ask Clear for the price before you start. Points, rewards and offers in your shop app
aren't add-ons.

## Payment links

To take a payment without the customer at the counter, send a payment link from New charge; see
[Taking payments](./taking-payments.md#payment-links).

## Pay with Clear on your website

Customers can pay your online shop with Clear, and by card when Stripe is connected.
**Settings › Developers** (owners and managers) has what your website needs:

- **Keys**, for test and live. Test payments never move money. A publishable key for your site, a
  secret key for your server, and **Roll** to replace the secret key.
- **Allowed websites**: the sites that use Pay with Clear.
- **Webhooks**: the address on your server Clear tells when something happens. Signed with your
  webhook secret, and retried for 3 days.
- **Testing** (test mode only): a test member that always approves, and Stripe's test card once
  cards are connected.
- **Build with AI**: the docs as plain text, a prompt with your keys filled in for a coding
  assistant, and an MCP server.

A refund your server asks for with the secret key is approved as it's asked: the key is the shop's
own, so nobody at the counter approves it.

Everything a developer needs — the checkout button, the server SDK, webhooks and every endpoint — is
in [Developers](../developers/README.md).
