# Getting started

Joining Clear, verifying who you are, and keeping the app locked to you. Everything here happens in
the member app at `app.useclear.org`.

## Signing in

**There is no password on a Clear account.** You sign in one of these ways:

- **Your phone number or email.** Enter it and Clear sends you a six-digit code.
- **Google.** The sign-in screen also shows an Apple button; it is not available yet.
- **Face ID**, once you have turned it on (see [App lock and Face ID](#app-lock-and-face-id)). On a
  device that remembers you, the welcome screen offers Face ID first, with a code as the fallback.

If Face ID fails on a device where it was never set up, send yourself a code instead. You can turn
Face ID on once you are in.

## Joining the co-op

After your first sign-in, the app takes you through joining:

1. **Join the co-op.** The screen sets out three terms: what you save is your share, with no buy-in
   and no fee to join; one member, one vote, however much you save; and if you leave, your balance
   leaves with you. The membership agreement and bylaws are linked at the foot of the screen.
2. **Your ZIP code.** Clear opens one region at a time. If your ZIP is not served yet, you go to a
   waitlist instead and can leave an email for updates.
3. **Two more details.** Identity verification is not done here. It is deferred until you need it,
   so you can look around first.

If you arrived through an invite link, the invite is carried into your sign-up for you.

Voting, the bylaws and patronage are covered in [Governance](../governance/README.md).

## Verifying your identity

**Verification is required before Clear can lend to you or issue you a card.** It is not a credit
check, and nothing in it touches your credit score.

You can start it from **Settings → Personal information → Identity**, and the app also asks for it
when you set up your card. The form asks for:

- your date of birth (you must be 18 or over)
- your Social Security number
- your legal name and home address — filled in from your linked bank when there is one, and editable
- your phone number and email

These go encrypted straight to Clear's card issuer, which runs the check. Clear does not keep your
Social Security number or date of birth.

### What you can do while you wait

**Savings and Earn are open before you are verified.** They hold your own money. Credit and the card
open once verification clears.

### The answers you might get

| Status | What it means | What to do |
|---|---|---|
| Verified | You're done | Nothing |
| Under review | The issuer is checking by hand | Wait; the app tells you either way |
| Photo needed | A document photo is required | Add the photo from the same Identity row |
| Needs a correction | Something you typed didn't match your records | You'll be contacted about which detail to correct |
| Couldn't verify | Credit and the card can't be opened on this account | Talk to support from **Settings → Help** |

Once verified, your legal name and date of birth are locked. To correct either, contact support.

## App lock and Face ID

### The lock

**After five minutes idle, or five minutes away from the app, Clear locks.** It opens on the welcome
screen instead of your account, and your balances are not drawn underneath it.

- With Face ID on, a glance opens it again. You stay signed in.
- Without Face ID, send yourself a code. That signs you out and back in.

The server keeps its own lock as well, so a session left idle is refused there too, whatever the
phone's clock says.

### Face ID for signing in

Turn it on in **Settings → Security → Face ID**. This links a passkey on your device to your
account, so you can sign in without a code.

### Face ID for payments

Signing in and moving money are separate switches. **Settings → Security → Payments** shows what
confirms a payment:

- **Face ID**, or
- **an authenticator app**, for a device without Face ID (**Settings → Security → Authenticator
  app → Set up**).

If neither is set up, the row reads "Not protected yet".

With payment protection on, Clear asks for Face ID when money moves — a send, a withdrawal, a bill,
unfreezing your card, or showing its numbers. One check covers the next couple of minutes, so a move
that takes two signatures doesn't ask twice. Clear's server also refuses those requests without a
fresh check, so the protection does not rely on the phone alone.

## Next

- [Adding and moving money](./adding-and-moving-money.md)
- [Savings and equity credits](./savings-and-equity-credits.md)
