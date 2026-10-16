# Rewards · Hard Stop 1: what exists, answers, conflicts, plan

Branch `feat/rewards` from `dev` at 3d452a4c. No code changes. This file and the two spec files are the only additions.

## 1. What exists, against the spec

### Paying from the phone (`POST /api/p/:code/pay`)
- `routes/phonePages.ts:72` → `publicPay` (`services/merchant/terminal/publicPages.ts:29`). **Anonymous**: no sign-in, only rate limits by address. `:code` is a Point's four-character code, and the Point has to be in its `bill` state for that order.
- **Clear:** `createClearTender` (the same code the counter uses) → `{chargeCode, url: <member app>/c/<code>}`. The member opens it and approves in the Clear app; reading the charge claims it (`charges.ts:151`).
- **Card:** `createCheckoutTender` → Stripe Checkout on the shop's own account → the `checkout.session.completed` webhook.
- **Gap:** the API never learns who paid by card, so there is nothing to credit points to. The rewards app has to call this route signed in. The route then attaches the customer to the order before it creates the tender.

### Orders and discounts
- `OrderDiscount.kind` is `'code' | 'manual'` and `DiscountRequest` has the same two kinds (`orders.ts:66,79`).
- **One discount per order** is enforced twice: a unique index `order_discounts_one_live` (0002:163) and `orderService.ts:566` (`one_discount` → 409). A reward slots straight in as a third kind.
- `commerce.discount_codes` (0002:70) has no `show_in_app` and no `audience` yet. Discounts can only be added while the order is `open` with no live tenders (`lockEditable`).
- `Order.customer` exists but is **free text**. The merchant app always sends `null`.
- **Tax** is per line, on each line after its share of the discount, rounded half up (`taxAtRate`). Tip sits on the tender, outside `total_cents`.

### How an order becomes paid
- **Every path goes through `settleOrder`** (`orders/settle.ts:62`): cash, Clear at the counter, Clear from the phone, card at the counter, and phone card via Stripe Checkout.
- The first transition to paid already writes an idempotent outbox fact (`order.paid:<id>:<attempts>`, settle.ts:113). **That is where earning hooks in**, under its own topic `loyalty.order_paid`, because `processOutbox` runs one handler per topic and the tax handler retries.
- Card counts as paid at authorisation. `order.unpaid` (a void) is emitted too.
- **Refunds:**
  - Card and cash refunds go through `payments.refunds`, per tender, can be partial and can name lines. They emit `refund.succeeded`.
  - **Clear refunds are a separate flow** (`merchant.refunds` → `refundSettlement.ts`), and the order stays `paid` afterwards. Taking points back has to listen to both.
- **Standalone Clear charges** (`POST /api/charges`, raised without an order) never become orders and never earn. That is fine: the spec's paths all use orders.

### Identity
- **`requireAuth`** (`middleware/auth.ts`) verifies the Privy JWT and sets `req.auth = {walletAddress, profileUuid (Privy DID), email, emails[], phone, smartWallet, addresses[], …}`. Because the API creates a smart wallet server-side for every embedded-wallet user, a phone-only person has a wallet address too.
- **Member records:**
  - A member row exists from the first `PUT /api/members/me/bootstrap`, with `status='ONBOARDING'`, before any onboarding is done.
  - The "Complete account onboarding before using this feature" 403 (`memberCapabilities.ts:42`) actually means **no member row at all**.
  - `requireMemberCapability` is used on exactly one mount: `/api/plaid`.
  - **No capability today means "can pay from a balance" or "can pay over time".** Pay now is gated by the wallet's USDC; over time by the on-chain credit limit.
- **`resolveCanonicalAuthSubject`** (memberStore.ts:1172 → 2514) matches, in this order:
  1. the DID;
  2. the Reown profile;
  3. any linked wallet;
  4. **email**: one hash of `input.email` only, so OAuth emails in `emails[]` aren't tried; the email hash has a unique index;
  5. **phone**: a hash with whitespace stripped, not normalised to E.164; no unique index.

### The member's identity code
- It is `<origin>/send?to=<smart wallet address>` (`member/SendRoute.tsx:86`), with no amount and no signature.
- **No API route resolves it.** The tablet parses the wallet itself (`merchant/charge/memberCode.ts`) and can only use it to send an **already-raised** Clear tender: `POST /api/merchant/tenders/:id/send` → `attachMember` + `notifyMember`, which sends the app notification, Web Push, and an SMS (Twilio) or email (Resend).
- So yes: today it needs a charge, and it never reaches an order before checkout.

### Member app
- **Privy:** `AppKitProvider.tsx:73` `loginMethods: ['email','sms','google','apple','twitter','github','discord','farcaster']`, with smart wallets switched on in the dashboard.
  - Login is headless (`LoginRoute.tsx`, using `useLoginWithSms` and friends).
  - **`APPLE_SIGN_IN_READY = false`**, so the Clear app doesn't show Apple yet.
  - There are no cookie or domain settings anywhere.
  - Tokens go to the API as `Authorization: Bearer` (`utils/apiClient.ts:80`). The API is at `*.up.railway.app`, not under useclear.org.
- **`vercel.json`:** `/p/*` and `/r/*` are **internal** rewrites to `phone.html` inside member's own deployment. There are no external rewrites.
- **The network is chosen by hostname** (`lib/clearNetwork.ts:7`): only `app.useclear.org` is mainnet. Copied as it is, rewards would run on Base Sepolia even in production.
- **Onboarding:**
  - `OnboardingFlow.tsx` and `CounterOnboarding.tsx` are presentational and can be moved.
  - The containers are tied to member's router, `useMemberProfile`, `useAppKitAuth` and the `@/` alias.
  - The only exit is `navigate('/')`, so there is no return address.
  - Identity checks are deferred: Bridge KYC opens a hosted page in a new tab and polls, and Lithic's form is a modal.
  - The decision is `memberStatus === 'ONBOARDING'`. **No member UI reads `/api/members/me/capabilities`.**
- **`/s/:shop` already exists** in member (app.useclear.org/s/<slug>) as **counter sign-up**. Its slug is derived from the shop's name; no shop has a stored slug (no `slug` column anywhere).
- **Scanner:** `ScanPage.tsx` (BarcodeDetector, falling back to jsQR) recognises `/c/<code>` and `/p/<code>` only.
- **Pay sheet:** `ChargeApproval.tsx` (presentational) plus `ChargeApprovalRoute.tsx`, with `usePayNow` (USDC from the smart wallet) and over time (`approveCharge`, which needs credit).
- **Activity:** shows shop charges by `merchantName` only, with no shop id, so it can't be filtered to one shop without an API change. Phone-page card payments appear nowhere.
- **Tokens:** member does **not** use `@clear/tokens`. **`packages/tokens` is the old purple palette.** Clear's real tokens are `apps/member/src/styles/clear-tokens.css`, which matches the spec's `:root` (Bricolage, Instrument Sans, IBM Plex Mono).
- **PWA:** a static `public/manifest.json`, a hand-written `sw.js`, and Web Push from member's own origin.

### Merchant app
- **Settings:** `SECTIONS` (`settings/panes.tsx:51`) runs Shop … Discounts, Devices, …, Help. **Owners only.** Counter staff and managers see **You alone** ("absent, not locked", DECISIONS 169).
  - The live Discounts pane lists codes, which can't be edited, and New code is a real form.
  - Read-only is done by leaving out the handlers. There is no shared read-only primitive.
- **New charge:** `CartCell` (`charge/start.tsx:554`). A Customer line fits as the first row of `c-cmain`, above the "Customer approves" hero. Discounts are applied only at Checkout (`c-ck-adj`).
- **Checkout:** the Clear tile's sub-line is "Pay now or over time, approved on their phone" (`checkout.tsx:42`). "Waiting on {first name}" is `WaitingView` (`clear.tsx:462`).
- **Scan their code:** raise the Clear tender → the `theirs` screen (`CodeScanner`) → `memberWalletFrom` → `sendClearCharge`.
- **Seeds:**
  - Mike's Tire (`seed.ts`).
  - Mi Casa (`seedMiCasa.ts`, `&shop=micasa`), at **8.32%** food tax, with the menu in `terminal/reference.ts` (Al pastor $4.50, Horchata, Jamaica, Mexican Coke $3.50). It has no Churros, Tamarindo or Catering yet, and no discount codes.

### Builds
- **`scripts/vercel-ignore.sh` has no list of apps.** It takes the app folder as an argument and works out its `packages/*` from `@clear/*` dependencies. A new app needs nothing in it, as long as every package it uses is a declared dependency. It **can't see** imports that reach into another app's folder.
- **`turbo.json`** is generic. The **root workspaces** are an explicit list, so `apps/rewards` has to be added.
- **CI** (`.github/workflows/ci.yml`): the `changes` regex is `apps/(member|merchant|api)`, so a PR touching only `apps/rewards` would skip typecheck and tests. Add `rewards`.

### Live hosts (checked with `curl -I`)
- `useclear.org/*` → 308 to `www.useclear.org`, which is the Next marketing site in `clearpath-website`.
- `www.useclear.org/p/A7K2` and `/s/micasa` both **404 today**.
- `rewards.useclear.org` doesn't resolve.

## 2. Screens: new, changed, already built

| Spec | Screen | Status | Where |
|---|---|---|---|
| 2 | Home (points, Clear balance, offers), themed per shop | new | `apps/rewards/src/screens/Home.tsx` |
| 3 | Pay: camera plus Show my code | new (scanner logic from member's `ScanPage`/`clearCode`) | `rewards/src/screens/Pay.tsx` |
| 3 | Pay sheet with the reward line, Pay now / Over time | new view, built from member's `ChargeApproval` | `rewards/src/screens/Bill.tsx` |
| 3 | Paid (points used, earned, have; receipt) | new | `rewards/src/screens/Paid.tsx` |
| 4 | Rewards tab (Ready, Next, Offers) | new | `rewards/src/screens/Rewards.tsx` |
| 4 | Counter code (K7P · 4QM, 15 minutes) | new | `rewards/src/screens/Claim.tsx` |
| 5 | Join with a phone (shop) | new | `rewards/src/screens/SignIn.tsx` |
| 5 | Home, rewards-only ("Clear account · Not set up") | new state of Home | `Home.tsx` |
| 5 | Set up your Clear account sheet, then onboarding | new sheet; onboarding steps shared with member (see 3a) | `rewards/src/sheets/SetUpClear.tsx`, `packages/member-kit` |
| 6 | You (shop) | new | `rewards/src/screens/You.tsx` |
| 6 | Your shops in the Clear app | new in member | `apps/member/src/pages/app/YourShops*.tsx`, a row on Home or Account |
| 7 | Hub home (balance, then Your shops) | new | `rewards/src/screens/HubHome.tsx` |
| 7 | Inside a shop, with the name as the switcher | new (Home in hub mode) | `rewards/src/shell/TopBar.tsx` |
| 7 | Switch shop sheet | new | `rewards/src/sheets/SwitchShop.tsx` |
| 7 | Add a shop (scanner plus Near you) | new | `rewards/src/screens/HubScan.tsx` |
| 7 | Join sheet | new | `rewards/src/sheets/Join.tsx` |
| 7 | Paid somewhere new, then join | new state of Paid | `Paid.tsx` |
| 7 | Sign-up: phone and code, Already have Clear?, Welcome | new | `SignIn.tsx` |
| 7 | You (hub) | new | `You.tsx` |
| 8 | Visits mode: stamp card Home | new state of Home | `Home.tsx` |
| 8 | Settings › Shop app pane (Your app, Look plus preview, Earning, Boosts and bonuses, Rewards, Offers in the app) | new pane; rail gains Shop app | `merchant/src/settings/{panes,shopApp}.tsx`, `SettingsPage.tsx` |
| 8 | Own domain, Store app, Add a reward, Upload a font sheets | new | `merchant/src/settings/shopAppSheets.tsx` |
| 8 | Discounts: Show in app plus audience per code | changed | `panes.tsx` (Discounts), `views.tsx` (`NewCodeForm`) |
| 9 | New charge: Customer line (Scan their code, Phone) | changed | `charge/start.tsx` `CartCell`, `NewChargePage.tsx` |
| 9 | Scan their code sheet (the tablet camera) | changed (today it's a full screen after Checkout) | `charge/customer.tsx` (new), `CodeScanner` reused |
| 9 | Member sheet (joined, and not joined with Ask to join), phone confirm pending | new | `charge/customer.tsx` |
| 9 | Cart with the member and reward (Remove, Apply/Undo, Earns N points) | changed | `start.tsx` `CartCell` / `Breakdown` |
| 9 | Checkout: member on the left, the Clear sub-line, How is Sofia paying? | changed | `charge/checkout.tsx` |
| 9 | Waiting on Sofia ("Sent to … Clear app, text and email") | already built; copy only | `charge/clear.tsx` `WaitingView` |
| 9 | Her notification, and the approve sheet with the reward applied | the notification exists (copy changes); the approve sheet is the rewards Bill view plus member's `ChargeApproval` gaining a discount line | `chargeService.notifyMember`, `ChargeApproval.tsx` |

## 3. Answers

### a. Set up Clear: inside rewards, by sharing code. Recommended.
- **What:** move what onboarding and paying need into a new workspace package, `packages/member-kit`:
  - the presentational onboarding steps (`OnboardingFlow`, `AuthShell`, `PinBox`, `BankLinkStep`);
  - the submit chain (bootstrap → onboarding → profile → terms → submit), taking a `returnTo`;
  - `ChargeApproval`;
  - Clear's tokens and component CSS, which belong in `packages/tokens` as a `clear.css`, replacing the old palette only after merchant is checked.
- Member imports from the package. Rewards runs the same steps in Clear's paper in a sheet, then returns to the screen it started from.
- **Why not hand off to app.useclear.org:**
  - It is another origin, so the user has to sign in again unless Privy cookies work (see b).
  - Bridge's hosted KYC already opens a new tab.
  - The spec explicitly wants it inside the app.
- **Cost:**
  - about 15 member files move;
  - member's `@/` imports in those files are rewritten;
  - every member suite and the `tsc -b` build have to stay green;
  - Bridge and Lithic KYC stay as they are (they already defer to first deposit), so only the three-step sheet and the first-run steps are new;
  - I'd do the move as its own PR inside Phase 4, before rewards uses it.
- **Also needed:** rewards needs its own Clear-side capability field, because no existing one says "can pay from a balance". I propose adding `canPayWithClear` to the member capabilities: `true` once onboarding is submitted and the member isn't restricted.
  - **"Pay from a balance" and "add money"** use it. The app shows Set up Clear when the API answers "Complete account onboarding".
  - **Over time** still also needs a credit line, as it does today.

### b. Sign-in across sites
- **Same Privy app, same login methods.** Phone first, then email, Google and Apple. Apple only once member's `APPLE_SIGN_IN_READY` is on.
- **Shop links are really on `www.useclear.org`, the hub on `rewards.useclear.org`.** Both are under useclear.org, so Privy's **HttpOnly cookies on a verified base domain** (`useclear.org`, set in Privy's dashboard Domains tab with a DNS record) carry one session across them and app.useclear.org.
- **Our API stays on Bearer tokens**, because it's on railway.app, and cookies won't reach it anyway.
  - **To verify with a spike before Phase 4:** whether `getAccessToken()` still returns a token in cookie mode. Privy's types say tokens "can be left blank if using cookies".
  - If it doesn't, the fallback is a sign-in hand-off: the hub opens `useclear.org/s/x?handoff=<one-time code>`, minted by our API.
- **A shop's own domain** needs:
  - the domain added to Privy's allowed origins;
  - a fresh phone confirmation there, as the spec already says;
  - **a different step-up for Pay now.** Face ID passkeys are bound to `useclear.org` (`routes/stepUp.ts:63`), so they won't work on `rewards.micasatacos.com`. I'd make paying from a balance on an own domain hand off to the hub or Clear for v1.

### c. No duplicate accounts: Privy's no-signup mode. Recommended.
- **The flow:**
  1. `sendCode({ phoneNumber, disableSignup: true })`, then `loginWithCode({ code })`. Privy authenticates with `mode: 'no-signup'` (confirmed in the bundled SDK, v3.39.0).
  2. A number already on a user signs straight into it.
  3. An unknown number fails with `user_does_not_exist`, and **nothing is created**. That error is when we ask Already have Clear?
- **Yes:** they sign in with email, Google or Apple, then `linkPhone`. The number is on no user, so linking can't collide. This costs one more text, to confirm the number on the account.
- **No, I'm new:** `loginWithCode` again in normal mode, then Welcome.
- **Two things to prove with a Privy test number before Phase 3 depends on them:**
  - that Privy checks the code **before** answering `user_does_not_exist`. Otherwise sending a code and a wrong guess would reveal whether a number has an account.
  - whether the same code can be used again for signup. If not, "No" sends one more code.
- **If the first one fails:** verify the number with our own one-time code (Twilio Verify, through the API), and only ask after that. That is the prompt's option 1.
- **Rejected:** "delete the empty user, then link". Privy's transfer refuses a source user that has a wallet, and our API creates a smart wallet for every new user on its first request.
- **`resolveCanonicalAuthSubject` is good enough as it is.** After linking, everything matches on the DID. I'd normalise phones to E.164 before hashing, because the hash only strips spaces today.
- **A rewards-only person gets no member row.** The rewards API keeps its own `rewards.people` (Privy DID, smart wallet, first name, phone hash, linked member subject).
  - So the Clear app's onboarding state is untouched, and `requireMemberCapability` naturally answers "Complete account onboarding".
  - When they later open the Clear app, its bootstrap creates the member row and matches the same DID.

### d. A home-screen icon per shop
- `index.html` links `/s/<slug>/manifest.webmanifest`, which is served by the API (`GET /api/s/:slug/manifest.webmanifest`) through a rewrite in rewards' `vercel.json`, with:
  - `id` and `start_url` and `scope` all `/s/<slug>/`;
  - the shop's name and `short_name`;
  - `theme_color` from the brand;
  - icons resized from the logo by the API (sharp, 192, 512 and maskable).
- **Same-origin matters.** iOS ignores a manifest from another origin, so the path has to be on the page's own host, not railway.app.
- The `apple-touch-icon` and `<title>` are set server-side by a small edge function, or by a static `index.html` per slug. Safari reads them before any JavaScript runs, so setting them from the page's JavaScript is too late.
- **One service worker per scope**, so each shop installs separately. The hub's manifest is at `/`.

## 4. Conflicts with DECISIONS.md, the merchant references and the code

1. **The apex isn't `apps/member`.**
   - The spec (§10) and the prompt (Phase 6) say the apex is member, with `/p/` and `/r/`. In fact `useclear.org` → `www.useclear.org` is the Next site in **`clearpath-website`** (DECISIONS 915 says the apex redirects `/p/*` and `/r/*` to member, but that redirect isn't live; both 404).
   - **So the `/s/*` rewrite belongs in `clearpath-website`'s `next.config.ts`** (an external rewrite to the rewards deployment), as its own PR in that repo, and `/p/*` and `/r/*` with it.
   - The Phase 6 change in `apps/member/vercel.json` drops out.
2. **`/s/:shop` is taken in member** (app.useclear.org/s/<slug>, counter sign-up), using a slug derived from the name. Different host, so no collision, but there should be one slug: `shop_apps.slug` becomes the slug member's links use too.
3. **Tax and the section 3 check.**
   - The API rounds tax per line. At 8.375%, $16.00 of food is **$1.33** (0.75 + 0.29 + 0.29), not the drawn $1.34, so "Off, the bill is $17.34" and New charge's $17.34 become **$17.33**.
   - With the reward spread across the lines, as discounts are today, it's $1.05 and **$13.55 holds**.
   - **Mi Casa's mock is 8.32%** (DECISIONS 1121, 1452). At 8.32% it's $1.04 and $13.54, which breaks the check.
   - **Proposal:**
     - rewards frames price at 8.375% on their own Mi Casa order, or Mi Casa moves to 8.375% and Table 12's $48.20 changes in six frames: your call;
     - the reward is spread across the lines, not taken off the Jamaica line alone, which would give $1.04;
     - $17.34 is corrected to $17.33.
4. **Pronouns.** DECISIONS (Copy, Home) uses neutral pronouns, and the app doesn't know a customer's. The spec has "Ask him to join", "Approves on her/his phone", "75 of her 128 points", "If he joins before he pays", "Sent to her Clear app". **Proposal:** "Ask them to join", "Approves on their phone", "75 of their 128 points", "If they join before they pay". Names stay ("How is Sofia paying?").
5. **Who sees Shop app.** The prompt says owners and managers edit and the counter can view. DECISIONS 169 says Settings is **You alone** for counter staff and managers. **Proposal:** Shop app is the first pane a manager and the counter see, read-only for the counter, editing for managers. Every other pane stays as decided. That adds Shop app to their rails.
6. **The identity code is a public address.** `/send?to=<wallet>` is derivable by anyone who knows the wallet, which is public on-chain. Today that's harmless, because it only sends a request the member must approve. Under §9 it would show a shop the person's name, points and ready rewards.
   - **Proposal:** Show my code (rewards) and the Send page's code (member) both add a short-lived signed part, `&id=<code>`, minted by the API and rotating every 2 minutes.
   - Attaching to an order needs it. A bare address still works for sending a Clear request, as now.
   - It's a small member change; it's in Phase 6.
7. **"Clear's tokens from `packages/tokens`."** That package is the old palette; Clear's are in member's `clear-tokens.css`. Covered in 3a.
8. **"Add `apps/rewards` to the script's known apps."** There's no list. Nothing to do there, but CI's `changes` regex does need `rewards`.
9. **Not drawn but needed:**
   - `GET /api/s/:slug/activity` (You › Activity here);
   - `POST /api/s/:slug/session` (mint the scoped token);
   - phone-confirm pages for a number typed at the counter;
   - what the counter's Clear tile says for a rewards-only customer (`canPayWithClear` false). I'd hide the "Sent to … phone" line and keep today's code flow.
10. **Directory.** `GET /api/partners?near=` has no source in the API. Partners are content files on the website, and shops have addresses but no coordinates. **Proposal:** shops with an enabled app, geocoded once when the address is saved, with distance from the browser's location (asked, never stored).
11. **Web Push per origin.** Her lock-screen notification is from Mi Casa's app. Push subscriptions belong to an origin, and today only member's exist. Each rewards origin registers its own, `notificationStore` keeps the origin, and the link opens `/s/<slug>/c/<code>` on that origin. Without this, the tap opens the Clear app.
12. **Store builds.** This Mac has no Xcode or Android SDK. `apps/rewards/native` can be scaffolded and configured, not built here.

## 5. Plan for Phases 2–7

- **Before Phase 2 (a small spike, no product code):**
  - a Privy test number through `disableSignup`, to check the code-before-existence ordering and whether a code can be reused;
  - whether `getAccessToken()` survives cookie mode.
  - Both answers go in DECISIONS.
- **Phase 2, contracts:** `packages/merchant-contracts/src/rewards.ts`, as the prompt lists, plus:
  - `ShopApp.slug` rules (a–z, 0–9 and dashes, 2–32 characters, reserved words refused);
  - `ShopSession` (the scoped token's claims);
  - `ShopActivity`;
  - `CounterCustomerPending`;
  - `canPayWithClear` on the member capabilities.
  - `DiscountRequest` gains `reward` and `claim`, and `OrderDiscount.kind` gains `reward`.
  - Client methods: `RewardsPublicApi`, `RewardsMemberApi`, and additions to `MerchantApi`. **Hard Stop 2.**
- **Phase 3, API:**
  - **Migration `0029_rewards.sql`:** `rewards.*` tables plus `rewards.people`, discount code columns, `order_discounts.reward_id` with the kind check widened, and `orders.customer_person`.
  - **Earning:** the `loyalty.order_paid` outbox handler, plus reversal on `order.unpaid`, `refund.succeeded` and Clear refund settlement.
  - **Jobs:** expiry, birthdays and referrals.
  - **The scoped-token middleware:** our own JWT `{sub, did, wallet, shop|hub}`; `requireAuth` accepts it only on routes that opt in, and everything else answers 403 `shop_scope`.
  - Every route in the table, the tests the prompt lists, and all three suites. **Hard Stop 3.**
- **Phase 4, `apps/rewards`:**
  1. First, the `packages/member-kit` extraction as its own PR, with member green.
  2. Then the app: scope from the host and path; the theme variables; every frame in sections 2–7; visits mode; sign-in; Set up Clear; manifests; mock seed (extending Mike's Tire and Mi Casa); network chosen by `VITE_` env, not hostname.
  3. Its `vercel.json`, workspace entry and CI regex.
  - **Hard Stop 4:** screenshots at 390px beside the spec.
- **Phase 5, merchant:**
  - the Shop app pane and its four sheets;
  - Discounts' Show in app and audience;
  - New charge's Customer line, sheets, reward line, Checkout and waiting copy;
  - the spec's merchant frames fed to `reference-css.mjs` as an addendum (it doesn't vote), with overrides in `app.css`.
  - **Hard Stop 5.**
- **Phase 6, member:**
  - Your shops;
  - Activity's earlier card purchases at shops after onboarding;
  - the signed identity code;
  - **the `/s/*` (and `/p/*`, `/r/*`) rewrite in `clearpath-website`**, a separate PR there.
- **Phase 7, add-ons:**
  - **Own domain:** the Vercel Domains API (I'll need the project id and a token), plus the verification job and the forward.
  - **Store app:** `store_builds`, the `store-builds.md` runbook, and the Capacitor scaffold, not built or submitted. **Hard Stop 7.**
- **Pushes:** at each hard stop to `feat/rewards`, with stacked PRs per phase if you want them.
