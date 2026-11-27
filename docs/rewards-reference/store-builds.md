# Store builds: a shop's own app in the App Store and Google Play

The runbook for the "Your own app in the stores" add-on (rewards spec, sections 8 and 10; prompt,
Phase 7). It covers how one shop's app is built, who submits it, and how Clear keeps the record.

**Nothing in Clear's code submits an app, and nobody submits one from Clear's own accounts.** Clear
builds the app; the shop's own developer accounts publish it, with Clear invited to help.

---

## Why the shop's accounts, not Clear's

- **Apple, App Review Guideline 4.2.6:** apps made from a commercialised template or an app-generation
  service are rejected unless the provider of the app's content submits them. Every shop's app is
  the same template filled with its config, so Clear submitting them all from one account is exactly
  what 4.2.6 rejects.
- **Google Play, the Spam policy** (repetitive content, and apps made by automated tools or wizard
  services): many near-identical apps under one developer account are removed, and the account can
  be closed.
- **Apple, Guideline 4.2 (minimum functionality):** an app that is only a website in a frame is
  rejected. The store build has to do what the web app can't (see "Native value" below).

So each shop is the developer of record. That also means the listing, the reviews and the customer
relationship are the shop's, which is what the add-on sells.

## What the shop does (once)

1. **Opens its developer accounts, as a business, not a person.**
   - Apple Developer Program, as an organisation (a yearly fee). Apple asks for a D-U-N-S number;
     the shop gets one free from Dun & Bradstreet, which takes a few days.
   - Google Play Console, as an organisation (a one-time fee). Google verifies the organisation and
     asks for a D-U-N-S number too.
2. **Invites Clear.**
   - App Store Connect › Users and Access: Clear's support address, role **Admin**. For signing
     certificates and push keys Clear also needs **Certificates, Identifiers & Profiles** access.
   - Play Console › Users and permissions: the same address, **Admin** for the app (or account-wide
     until the app exists).
3. **Gives Clear its listing:** screenshots (Clear can make these from the shop's config), a short and
   a long description, a support URL (the shop's rewards link works), a privacy policy URL, and the
   answers to Apple's and Google's privacy questionnaires. Clear drafts the answers; the shop
   confirms them, because they're the shop's declarations.

## Native value: what the store build adds over the web app

The store build has to carry these, or it fails Apple's 4.2:

| | What | Where it lives |
|---|---|---|
| Push | A reward ready, a counter charge to approve | APNs key in the shop's Apple account; FCM in its Firebase project. Clear holds the keys per shop, in the secrets store, never the repo. |
| Wallet card | The rewards card in Apple Wallet and Google Wallet, with points that update | A Pass Type ID certificate in the shop's Apple account; a Google Wallet issuer account. Passes are signed server-side per shop. |
| Native scanner | Scan a Point's code or a shop's counter card from inside the app | ML Kit through `@capacitor-mlkit/barcode-scanning`, in `apps/rewards/native`. |

What's built today in `apps/rewards/native`: the wrapper and the native scanner hook. **Push and the
Wallet card need server work that doesn't exist yet:**

- a device-token endpoint per shop and person, and sending through each shop's keys;
- pass signing, and pass updates when points change.

Don't submit a build until both exist. Without them, review will reject it under 4.2.

## Building one shop's app

See `apps/rewards/native/README.md` for the commands. In short:

1. `SHOP=<slug> API=<api origin> npm run config` writes `shop.json` from the shop's public config.
   It holds the name, bundle id (`org.useclear.shops.<slug>`), colours, logo and config version.
2. `npm run build:web` builds the rewards app for that one shop, at `/`, as on its own domain.
3. `npx cap add ios` / `npx cap add android` the first time, then `npm run sync`.
4. Open in Xcode / Android Studio. Sign with the shop's team (Apple) and upload key (Google), and
   archive.

A build is made from one config version. When the shop changes its look or rules, the web content
updates on the next build. Nothing is fetched live from another origin, because Apple reviews what
ships.

## Submitting (by hand, in the shop's accounts)

- **Apple:** upload with Xcode Organizer or Transporter into the shop's App Store Connect, under the
  shop's team. In the review notes, say:
  - it's the shop's own rewards app;
  - a demo phone number and code for review (create a review account in the shop's rewards);
  - where the native features are.
- **Google:** upload the AAB to the shop's Play Console, internal testing first, then production.
  Fill the Data safety form from the questionnaire answers.
- Never submit from Clear's own developer accounts, and don't add automated submission
  (fastlane `deliver`/`supply` or the Store APIs) to CI. It's out of scope (prompt, "Not in this
  work"), and it would be the template submission 4.2.6 rejects.

## Keeping the record

Every step goes into `rewards.store_builds`, one record per shop and platform. Settings › Shop app ›
Your own app in the stores shows them to the shop.

```
railway run -s Protocol-Contracts -e dev bun scripts/store-build.ts record micasa ios org.useclear.shops.micasa 1.0.0 not_submitted
railway run -s Protocol-Contracts -e dev bun scripts/store-build.ts record micasa ios org.useclear.shops.micasa 1.0.0 in_review "Submitted Oct 20"
railway run -s Protocol-Contracts -e dev bun scripts/store-build.ts record micasa ios org.useclear.shops.micasa 1.0.0 live
railway run -s Protocol-Contracts -e dev bun scripts/store-build.ts list micasa
```

Review is one of `not_submitted`, `in_review`, `approved`, `rejected`, `live`. A record keeps the
config version it was built from, so "the store app is two configs behind" can be seen.

## Keeping it current

While the add-on is on, Clear rebuilds and the shop's account publishes when:

- the shop changes its look or rules (a new config version);
- Clear ships a change to the rewards app;
- Apple or Google require a new SDK or target version (each sets yearly deadlines).

When the add-on ends, the apps stay the shop's. Clear removes itself from both accounts, and the
shop can unpublish them.
