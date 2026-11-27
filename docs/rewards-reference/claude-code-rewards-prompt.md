# Claude Code prompt: Clear rewards (`apps/rewards`), its API, and the shop's side

You are working in the Clear monorepo (`github.com/Deed3Labs/Protocol-Contracts`, branch `dev`). Clear is adding **rewards**: a customer app that holds one shop's points, rewards and offers, with Scan to pay and the customer's Clear balance. It comes in two forms from one codebase:

- **A shop's own app** at `useclear.org/s/:slug` (for example `useclear.org/s/micasa`). It only ever shows that shop, in that shop's brand.
- **The hub** at `rewards.useclear.org`. It shows every shop a person has joined, in Clear's look, with a switcher.

Underneath, it is the member app cut down to rewards. It uses the same identity (Privy), the same balance, the same orders and the same API, so anything done in it shows up in the Clear app and at the shop's counter.

Your job is the new app `apps/rewards`, the API work in `apps/api`, the shared types in `packages/merchant-contracts`, the shop's settings and checkout changes in `apps/merchant`, and two small changes in `apps/member`.

Work on a branch from `dev`. There are **hard stops** below. At each one, stop, summarise what you did and found, and wait for review.

---

## Where the spec is

- **`docs/rewards-reference/clear-rewards-app.html`** is the spec. Ask the user to place it there if it isn't. Its sections:

  | # | Section | What it covers |
  |---|---|---|
  | — | Decisions | Read these first. They are the rules. |
  | 1 | How it fits | Clear app, rewards, merchant app; one API |
  | 2 | One app, two shops | The same Home themed for Mi Casa Tacos and Mike's Tire. Same customer, same balance, different points |
  | 3 | Scan to pay, with a reward | Scanner, the pay sheet with a reward line, Paid |
  | 4 | Rewards | The Rewards tab, and a reward claimed as a counter code |
  | 5 | Before Clear | Join with a phone number, Home for a customer with rewards only, the Set up Clear sheet |
  | 6 | You, and Your shops | The You tab; the Clear app's Your shops list |
  | 7 | `rewards.useclear.org` | Hub home, a shop inside the hub, the switcher, Add a shop, the Join sheet, Paid-then-join, Sign-up, You |
  | 8 | The shop's side | The Shop app settings pane, the add-on sheets, the punch-card variant |
  | 9 | At the counter | New charge's Customer line; Scan their code; the member sheet (joined and not joined); the cart with the member and reward; Checkout; Clear sent straight to her phone; her notification and approve sheet |
  | 10 | Getting it onto phones | Web apps, own domain, store app, monorepo |
  | 11 | Behind the screens | API areas and routes |
  | — | Open | Unresolved questions |

- **The merchant reference files** in `docs/merchant-reference/` still govern every merchant screen they draw. Section 8 adds a pane to Settings. Section 9 adds a Customer line to New charge's cart and changes the Clear row's sub-line at Checkout; the waiting screen is the existing "Waiting on Dana" screen, unchanged in shape. Keep everything else as drawn. The Settings rail gains **Shop app** between Discounts and Devices.
- **`docs/merchant-reference/DECISIONS.md`** records how earlier phases interpreted the references. Read it first. Add a `docs/rewards-reference/DECISIONS.md` and write a section per phase there.

**Rules for using the spec (same as the earlier prompts):**

- **Copy is exact.** Don't rewrite labels, on-screen notes or button text.
- **Figures come from the file and must stay consistent.** The worked example in section 3 is the check:
  - $16.00 of food, less a $3.50 reward, is $12.50.
  - Tax at 8.375% is $1.05, so the total is $13.55.
  - She earns 12 points, and 128 − 75 + 12 = 65.
  - Her balance goes from $212.40 to $198.85.
- **The notes between frames are rationale, not UI.** Every phone frame is a state the app must be able to show. Every sheet is a real component.
- **The rewards app follows the shared layout:**
  - each section is a header, a body and a footer, with full-width rules between them, including under every section header;
  - square corners, with pills only for controls;
  - IBM Plex Mono for labels only.
- **Shops theme the app; Clear's parts don't change.** A shop sets its colour, paper, fonts and logo through CSS variables. The Clear balance block, amounts, and Clear onboarding always use Clear's tokens from `packages/tokens`.

---

## The rules both sides must keep

1. **One codebase, a config per shop.** No per-shop code and no forks. The address decides the scope:
   - `/s/:slug`, or a shop's own domain, means one shop;
   - `rewards.useclear.org` means the member's shops.
2. **The rewards app never shows another shop's activity.** It shows the whole Clear balance, because that's the customer's, but purchases only at the current shop (or, in the hub, the shop being viewed). **Enforce this in the API with a session scoped to (member, shop).** A screen that simply doesn't ask is not enough.
3. **Points are the shop's and are never money.** They can't be bought, cashed out, sent, or moved between shops. They're counted on what was paid, before tax and tip. Refunds take them back.
4. **A reward is the order's one discount.** `OrderDiscount.kind` gains `'reward'`. The one-discount-per-order rule stands, so a reward and a code never stack.
5. **Points are an append-only ledger.** A member's points at a shop are the sum of their entries, never a stored number. Each entry records the version of the earning rules that produced it.
6. **A member is scanned once, at the cart.** Their identity code (the one on the Clear app's Send page, and behind Show my code in rewards) attaches them to the order. It carries no amount and can never move money. After that, nothing is scanned again: choosing Clear at checkout sends the request straight to them (app, text and email, as the existing Scan their code path does); card and cash are taken as usual and the points are credited automatically. The shop sees the member's name, points at this shop, ready rewards and whether they can pay with Clear, and never their balance or other shops' activity. Adding someone by phone number asks them to confirm on their phone before anything shows.
7. **A Clear member signs in; they never sign up twice.**
   - Offer the same sign-in methods as the Clear app (phone, email, Google, Apple, from `AppKitProvider.tsx`).
   - When a phone number is verified and isn't on any account, ask **Already have Clear?** before creating anything.
     - **Yes:** they sign in their usual way, and the number is linked to that account.
     - **No:** continue with a first name.
   - Ask only after the code is confirmed, so the question never tells a stranger whether a number has an account.
8. **Rewards-only is a full state, not an error.** Someone who signed in with a phone number but hasn't set up Clear can earn, redeem, see offers and pay by card. Paying from a balance, paying over time, and adding money show **Set up Clear**. Decide which applies with the existing capability check (`requireMemberCapability` and the "Complete account onboarding" message), never with app-side guesses.

---

## Who owns what

- **Contracts** (`packages/merchant-contracts`, a new `rewards.ts`):
  - schemas, types and client methods for the public, member and merchant rewards routes;
  - write them in Phase 2 and get them approved at Hard Stop 2; after that, don't change them without stopping to propose it.
- **API** (`apps/api`):
  - Express;
  - migrations in `apps/api/migrations`, where the latest is `0028_tables_v2.sql`, so the next is `0029_…`;
  - check the latest number again before writing yours.
- **Rewards app** (`apps/rewards`, new):
  - Vite and React, set up like `apps/member` (same Privy app and login, same `@clear/domain` and `@clear/tokens` imports);
  - its own Vercel project.
- **Merchant app** (`apps/merchant`): section 8.
- **Member app** (`apps/member`):
  - the apex rewrite for `/s/*`;
  - the Your shops list;
  - showing a member's earlier shop purchases once they finish onboarding.

---

## Phase 1: Explore (no code changes)

1. Read what exists and report it against the spec. Specifically:
   - **`apps/api/src/routes/phonePages.ts` and `services/merchant/terminal/publicPages.ts`:** `POST /api/p/:code/pay` with `method: 'clear' | 'card'`. Rewards payment reuses this path.
   - **Orders:**
     - `packages/merchant-contracts/src/orders.ts` (`OrderDiscount`, `DiscountRequest`);
     - the discount codes from `0002_commerce.sql`;
     - how an order becomes paid, and where a hook for earning points belongs.
   - **Identity:**
     - `apps/api/src/middleware/auth.ts` (Privy);
     - `memberCapabilities.ts` and `memberStore` (how a phone-only Privy user resolves to a member record, and what capabilities a member has before onboarding);
     - whether a member record exists before onboarding at all. If it doesn't, propose how a rewards-only person gets one without affecting the Clear app's onboarding state.
   - **`apps/member`:**
     - `AppKitProvider.tsx` (Privy, `loginMethods` includes `sms`);
     - `main.tsx` and `vercel.json` (how `/p/` and `/r/` are served from the apex);
     - the onboarding flow and whether its components can be reused in `apps/rewards`;
     - the scanner and the pay sheet;
     - Activity.
   - **`apps/merchant`:**
     - Settings (rail and panes, especially Discounts);
     - New charge and Checkout (`charge/`): where a customer could be attached to an order, and how today's **Scan their code** works (scanning a member's identity code and sending the request to their phone). Section 9 reuses that sending path with the customer already known.
   - **The member's identity code:** what it encodes, which route resolves it, and whether resolving it today requires a charge.
   - **Builds:**
     - `scripts/vercel-ignore.sh`, `turbo.json`, the root workspaces;
     - how a new app is added so it only builds when its own folder or its packages change.
2. List every screen in the spec as **new**, **changed** or **already built**, with the file you'd touch.
3. Answer these with a recommendation each:
   - **Set up Clear:** run member onboarding inside `apps/rewards` by importing shared components, or hand off to the Clear app with a return address? The spec wants Clear's screens inside the rewards app that return where the customer started. Say what that costs.
   - **Sign-in across sites:** can one Privy session cover `useclear.org/s/*` and `rewards.useclear.org`, and what does a shop's own domain need?
   - **No duplicate accounts:** Privy creates a user when an SMS login succeeds, so "Already have Clear? Yes" can collide with that fresh, empty user when you link the phone to the existing one.
     - Options: verify the number with your own one-time code before Privy, delete the empty user and then link, or Privy's own linking flow if it handles this.
     - Also check that `memberStore.resolveCanonicalAuthSubject` matches by phone and email the way this needs.
     - Recommend one.
   - **App icons:** how to serve a per-shop web app manifest and icon, so each `/s/:slug` installs as its own icon.
4. Flag anything in the spec that conflicts with DECISIONS.md or the merchant references.

**HARD STOP 1.** Report the inventory, the answers and the conflicts, and your plan for Phases 2–7. Wait for review.

---

## Phase 2: Contracts

Add `packages/merchant-contracts/src/rewards.ts`, plus client methods:

- **`ShopApp`** (the config):
  - `slug`, `enabled`;
  - `brand { logoUrl, colour, onColour, paper, headingFont, textFont }`, where a font is a preset or an uploaded font id;
  - `pointsName` (`points | stars | custom`, plus a custom label);
  - `offerCodeIds`.
- **`EarnRules`** (versioned, with `version` and `effectiveAt`):
  - `unit: 'dollars' | 'visits'`;
  - `pointsPer`, `perAmountCents` (dollars), or `visitMinCents` (visits, one per day);
  - `keepTheChange`;
  - `clearMultiplier: 1 | 1.5 | 2`;
  - `boosts[]`, each with a multiplier and a scope of days, a time window or categories (only the biggest boost applies);
  - `joinBonus`;
  - `birthdayRewardId | null`;
  - `referralBonus | null`;
  - `expiry: 'never' | '12m' | '6m'`, counted from the last visit.
- **`Reward`:**
  - name;
  - `gives`: an item list (inventory item ids), an amount off, or a percentage off;
  - `cost` in points;
  - `limit: none | daily | weekly`;
  - `clearMembersOnly`.
- **`LoyaltyEntry`:**
  - `kind: earn | redeem | refund | bonus_join | bonus_birthday | bonus_referral | adjust | expire`;
  - `points` (signed);
  - `orderId?`, `rewardId?`, `rulesVersion`, `reason?`, `by?`, `at`.
- **`Membership`:**
  - `shopId`, `memberId`, `joinedAt`, `consentAt`;
  - `texts: 'codes' | 'codes_and_offers'`;
  - `birthMonth?` (the month only).
- **`RewardClaim`:**
  - a short counter code and a QR payload;
  - `expiresAt` (15 minutes);
  - becomes the order's reward discount when scanned; points are deducted when the order is paid.
- **Order customer:** `Order.customer: { memberId, addedBy, addedVia: 'code' | 'phone', at } | null`, plus the view the counter gets: `CounterCustomer { firstName, lastInitial, isClearMember, canPayWithClear, membership: { points, readyRewards[] (each with the cart line it matches), nextReward } | null, lastVisit }`. **No balance field, ever.**
- **`DiscountRequest`** gains `{ kind: 'reward', rewardId }` and `{ kind: 'claim', code }`. **`OrderDiscount.kind`** gains `'reward'`, with `rewardId`.
- **Discount codes** gain `showInApp` and `audience: everyone | members | clear_members`.
- **`ShopDomain`:** `domain`, `shopId`, `status: pending | verified | failed`, `verifiedAt`.
- **`StoreBuild`:** platform, bundle id, version, `configVersion`, review status. This is data only in this work.
- **Views:**
  - `RewardsMe` (for one shop): membership, points, ready and next rewards, offers, earn summary text, and the balance and capabilities if allowed;
  - `MyShops` (for the hub): per shop, points or stamps, and the count of ready rewards.

**HARD STOP 2.** Show the contracts. Wait for approval.

---

## Phase 3: API

**Migration `0029_rewards.sql`.** Tables:

| Table | Holds |
|---|---|
| `shop_apps` | Each shop's app config |
| `shop_app_fonts` | Uploaded asset, checks result, licence declaration, and when and by whom it was declared |
| `shop_domains` | A shop's own domains |
| `earn_rules` | Versioned earning rules |
| `rewards` | The rewards list |
| `loyalty_memberships` | Who has joined which shop |
| `loyalty_entries` | The points ledger, append-only |
| `reward_claims` | Counter codes |
| `store_builds` | Store app records |

It also adds `show_in_app` and `audience` to discount codes, and `reward_id` to the order discount.

**Earning.**
- Hook into the moment an order becomes paid, for both the Clear tender and the card tender, and from the counter as well as the phone.
- Write the `earn` entry from the active rules:
  - counted on the amount paid before tax and tip;
  - the biggest boost only;
  - the Clear multiplier when the tender is Clear;
  - keep-the-change as a remainder per member;
  - one per day for visits.
- A reward on the order writes the `redeem` entry in the same transaction.
- A refund writes a `refund` entry reversing what was earned on the refunded part.
- **Idempotent:** a paid event that arrives twice earns once.

**Jobs:**
- **expiry**, from the last visit; the setting applies only to points earned after it was changed;
- **birthday rewards**, on the first of the month;
- **referral bonus** when a friend first pays.

**Session scope.** The rewards app gets a token scoped to (member, shop). Middleware sits beside `requireMemberCapability` and rejects:
- other shops' orders and ledgers;
- the member's Clear activity outside this shop.

The hub holds one scoped token per shop the member has joined, plus one hub token that can only list shops.

**Routes** (names from section 11; adjust to house style and record the changes in DECISIONS):

| Route | Notes |
|---|---|
| `GET /api/s/:slug` | Public, cached config, theme and manifest data |
| `GET /api/s/:slug/manifest.webmanifest` | Per-shop icon and name |
| `POST /api/s/:slug/join` | Also after a payment, crediting that payment's points |
| `DELETE /api/s/:slug/membership` | Deletes the points and the consent |
| `GET /api/s/:slug/me` | |
| `POST /api/s/:slug/rewards/:id/claim` | |
| `GET /api/rewards/me/shops` | |
| `GET /api/partners?near=` | For Add a shop |
| `POST /api/p/:code/pay` | Accepts a `rewardId` |
| `GET/PATCH /api/merchant/shop-app` | Including earning rules (a PATCH creates a new version), rewards and fonts |
| `POST /api/merchant/shop-app/fonts` | Upload. Check for A–Z, a–z, 0–9, accents and `$`, a size under 1 MB, then convert to WOFF2 and store. Record the licence declaration. |
| `POST /api/merchant/shop-app/domain` | Phase 7 |
| `POST /api/merchant/orders/:id/customer` | `{ code }` from a scan, or `{ phone }`, which texts the member a confirm link and returns `pending` until they confirm. Returns `CounterCustomer` |
| `DELETE /api/merchant/orders/:id/customer` | Remove, before payment |
| `POST /api/merchant/orders/:id/customer/invite` | "Ask him to join": a prompt on the member's phone; joining before payment credits this order |
| `GET /api/merchant/shop-app/give-back` | Returns the low and high give-back percentages for the current rules and rewards, with and without the Clear multiplier, as drawn |

**Merchant checkout.**
- Attach a member to an order by scanning their identity code, or by phone with their confirmation. A reward's counter code (a claim) is separate: scanning one applies that reward, and attaches its member if none is attached.
- Return `CounterCustomer`, with ready rewards matched to the order's lines.
- With a member attached, a Clear tender sends the payment request to them directly through the existing request path (app, text, email). No code is shown or scanned.
- With a member attached, card and cash tenders credit their points on payment.

**Tests:**
- earning in both units, at the rates drawn (1 per $1; 1 per $10 with keep-the-change: $15 + $15 earns 3);
- boost precedence;
- the Clear multiplier;
- reward plus code being rejected;
- the section 3 figures;
- refund reversal;
- idempotent paid events;
- claim expiry;
- scope rejection: a scoped token asking for another shop's order;
- `CounterCustomer` never includes a balance; a phone lookup reveals nothing until the member confirms;
- Clear with an attached member sends the request without a code; card with an attached member earns points;
- leaving a shop deletes only that shop's points;
- a Clear member who joined with email signs in to the rewards app and lands in their account;
- "Already have Clear? Yes" links the phone to the existing account without leaving a second user behind;
- a phone number on no account never reveals that before its code is confirmed.

**HARD STOP 3.** Report the routes, the migration and the test results. Wait for review.

---

## Phase 4: `apps/rewards`

- **Scaffold** like `apps/member`:
  - Vite and React, the same Privy provider (SMS login first);
  - `@clear/domain`, `@clear/tokens` and the merchant-contracts client;
  - a `vercel.json` with `ignoreCommand: bash ../../scripts/vercel-ignore.sh apps/rewards`;
  - add `apps/rewards` to that script's known apps.
- **Scope from the address:**
  - `/s/:slug` means shop mode;
  - the `rewards.useclear.org` root means hub mode;
  - an unknown host is looked up in `shop_domains` (Phase 7).
  - Shop mode has no switcher. Hub mode puts the shop's name in the header as the switcher, with no back arrow; Shops in the bottom bar returns to the list.
- **Theming:** the config sets CSS variables (`--b --bi --bf --bp --b2` in the spec). Fonts load from the config. The Clear balance block, amounts and Clear onboarding keep Clear's tokens.
- **Screens**, every frame in sections 2–7:

  | Screen | Bottom bar |
  |---|---|
  | Shop mode: Home, Rewards, Pay, You | Home, Rewards, Pay, You |
  | Hub: Shops (balance on top, then the shop list), Scan (adding a shop and paying), You | Shops, Scan, You |

  - The hub's shop list has no Add button in its header; adding is Scan.
  - The scanner recognises a shop's join code (adds the shop) and a Point or counter payment code (opens the bill).
- **Visits mode** shows the stamp card (section 8, La Bonita Bakery).
- **Sign-in (section 7, and the shop Join screen in section 5):**
  - phone and code first, with the Clear app's other methods under it;
  - **Already have Clear?** only for a verified number on no account;
  - **Welcome** (first name) for someone new.
- **Set up Clear:** as agreed at Hard Stop 1.
- **Per-shop web app manifest and icon**, so each `/s/:slug` installs as its own app.
- **Mock seed:**

  | Shop | Setup | Customers and figures |
  |---|---|---|
  | Mi Casa Tacos | 1 point per $1, Double Tuesdays, rewards at 75 / 150 / 300 / 600, offers TACOTUE and TRAY10 | Sofia (128 points, Clear member, balance $212.40); Marco (42 points, rewards only) |
  | Mike's Tire | Rewards at 500 / 750 | Sofia (340 points) |
  | La Bonita Bakery | Visits mode, 10 to a card, $5 minimum | Sofia (6 stamps) |
  | Peña Coffee, Tia Bea's Tamales | In the directory, not joined | — |

  Keep the existing Mike's Tire and Mi Casa seeds; extend them, don't replace them.

**HARD STOP 4.** Send screenshots of every frame next to the spec, at 390px wide. Wait for review.

---

## Phase 5: Merchant app

- **Settings › Shop app**, as drawn in section 8:
  - Your app: link, member counts, counter card PDF, and the two add-on rows;
  - Look: logo, colour presets with a contrast check, heading and text font chips, uploaded fonts, live preview;
  - Earning, with the live give-back line;
  - Boosts and bonuses;
  - Rewards: the table and the **Add a reward** sheet;
  - Offers in the app: from Discounts, with switches.
  - Owners and managers edit; the counter role can view.
- **Upload a font** sheet, with its checks and the licence switch. **Own domain** and **Store app** sheets as drawn; they become functional in Phase 7.
- **New charge and Checkout (section 9):**
  - the Customer line at the top of the cart, with **Scan their code** and **Phone**;
  - the scan sheet (the tablet camera), the member sheet (joined, and not joined with **Ask him to join**), and the phone path's confirm-pending state;
  - the cart with the member attached: the customer line (with Remove), the reward line (**Apply**, then applied with **Undo**), "Earns N points" in the small totals;
  - Checkout: the member on the left; the Clear row reads "Sent to Sofia's phone now. Nothing to scan"; picking it goes straight to the existing waiting screen, addressed to her app, text and email.
- **Discounts:** a "Show in app" switch and an audience on each code.

**HARD STOP 5.** Screenshots against the spec, including every section 9 frame. Wait for review.

---

## Phase 6: Member app

- **Apex rewrite:** `useclear.org/s/*` forwards to the rewards deployment (an external rewrite in `apps/member/vercel.json`, beside `/p/` and `/r/`). Confirm that the apex serves it and that sign-in carries over.
- **Your shops:** a short list (logo, points, ready rewards). Each row opens that shop in `rewards.useclear.org`, signed in. Don't draw any rewards screens in the member app.
- **History after onboarding:** a rewards-only person's card purchases at shops show in Activity once they finish onboarding, marked as card.

---

## Phase 7: Add-ons

- **Own domain:**
  - add the domain to the rewards Vercel project through the Vercel Domains API (project id and token in env; ask the user for them);
  - show the CNAME the shop must add (`cname.vercel-dns.com` for a subdomain);
  - a verification job sets the status;
  - once verified, `useclear.org/s/:slug` forwards to the domain.
  - On a custom domain, customers confirm their phone once, because the session can't cross domains.
- **Store app (records and runbook only):**
  - `store_builds` records;
  - a `docs/rewards-reference/store-builds.md` runbook. Each shop publishes from its own Apple and Google developer accounts, because both stores reject template-built apps submitted by the service on a client's behalf (Apple 4.2.6; Google Play's spam policy). The shop invites Clear as an admin. The store build must carry native value (push, the Wallet card, the native scanner), or Apple rejects it under 4.2.
  - A Capacitor wrapper in `apps/rewards/native` that builds from one shop's config.
  - **Don't automate submission, and don't submit anything.**

**HARD STOP 7.** Report. Wait for review.

---

## Not in this work

- Cross-shop perks (Clear-funded rewards across shops).
- Importing points from Square or Toast.
- Ordering from the phone.
- Automated store submission.
- A public template repo.

## Things for the user, not code

- Create the `rewards` Vercel project and point `rewards.useclear.org` at it.
- Have counsel confirm that points as specified stay outside gift-card and stored-value rules in the first states, and approve the consent line on the Join sheet.
- Decide pricing for the two add-ons.
