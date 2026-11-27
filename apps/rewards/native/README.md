# One shop's store app

The rewards app in [Capacitor](https://capacitorjs.com), built from one shop's config: the shop's
name, bundle id and colours, opening straight to that shop. The runbook, including why the shop's
own developer accounts publish it, is
[`docs/rewards-reference/store-builds.md`](../../../docs/rewards-reference/store-builds.md).

**This builds an app. It never submits one.** Submitting is done by hand, in the shop's App Store
Connect and Play Console.

This folder isn't an npm workspace: its packages are installed only on the machine that makes a
store build (a Mac with Xcode for iOS; Android Studio for Android).

```
cd apps/rewards/native
npm install
SHOP=micasa API=https://api.useclear.org npm run config   # writes shop.json
VITE_PRIVY_APP_ID=… VITE_CLEAR_NETWORK=mainnet npm run build:web   # www/, the shop alone at /
npx cap add ios && npx cap add android   # the first time only
npm run sync
npm run open:ios   # sign with the shop's team, archive, upload to the shop's account
```

## What's native

- **The scanner.** The rewards app uses ML Kit (`@capacitor-mlkit/barcode-scanning`) when it runs here
  (`src/lib/native.ts`), and the web camera everywhere else. Add the camera usage string to
  `ios/App/App/Info.plist` (`NSCameraUsageDescription`: "Scan a Point or a shop's code").
- **Push** (`@capacitor/push-notifications`) is installed but not yet wired. It needs:
  - a device-token endpoint in the API;
  - each shop's APNs key and FCM project.
- **The Wallet card** needs pass signing on the server, per shop. Not built yet.

Apple rejects an app that is only its website (Guideline 4.2), so don't submit until push and the
Wallet card exist.

## Sign-in

The app's web content runs at `capacitor://localhost` (iOS) and `https://localhost` (Android). Add
both to the Privy app's allowed origins before the first build. As on a shop's own domain, a
customer confirms their number once in the store app; the session doesn't cross from the browser.

## After a build

Record it, and every review step after:

```
bun scripts/store-build.ts record <slug> <ios|android> <bundle id> <version> <review> [note]
```

(run from `apps/api`; see the runbook).
