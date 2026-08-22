# Onboarding — making the reference flow real

Plan for replacing the live onboarding with the one in `docs/reference/clear-app-reference-screens.html`, and building the components that reference calls for and the app does not have.

Source of truth is the reference. Where this document and the reference disagree, the reference wins.

---

## 1. Where things stand

**The rebuilt flow exists and is wired to nothing.** `src/pages/auth/OnboardingFlow.tsx` is presentational — it takes `step` and `onStepChange`, owns no state machine, and makes no auth calls. Its only caller is `PreviewApp`. Its own docblock still says so.

**The live app runs the previous generation:**

| Route | Renders | |
|---|---|---|
| `/login` | `LoginPage` → `LoginView` | old |
| `/onboarding` | `UserOnboarding` → `OnboardingView` | old |
| `/claim/:token` | `ClaimFunds` | old |

**The backend half is already done.** `/me/onboarding/submit` opens a credit line, so anyone completing signup today gets a real 30-day cycle. That works through the *old* view, and will keep working through the new one — it is behind the submit call, not in front of it.

---

## 2. What the reference specifies

### Two entries, one flow

The reference is explicit that these are not variants of each other. From "Onboarding — the branch":

| | At a counter | Directly |
|---|---|---|
| Arrives from | Shop QR → Add to Home Screen | Site, referral, search |
| Pending total | **Shown on every step** | None |
| Invite code | Pre-filled | Optional |
| Bank link | **Required** | Deferred to first plan |
| Ends at | Split choice | Start saving |

The counter path carries the pending total through every step because *"it is the strongest motivation in the product and it is what makes a five-step flow tolerable while someone waits."* The bank link is required there because it is *"the underwriting, the repayment rail and the limit calculation at once, and it is the likeliest drop-off point."*

Identity verification is deferred to the first deposit on **both** paths. A bank link is not a KYC substitute, but it is enough to extend a small term plan.

### Steps

Direct: `enter → verify → join → (identity | waitlist) → start saving`

Counter: `add to home screen → split choice → join → connect bank → approve`

`OnboardingFlow` today has `enter, verify, join, identity, waitlist, claim, claimJoin` — the direct path and the claim variant. **The whole counter path is missing.**

### Day one differs by arrival

*"Both are day one. They are not the same screen, and the difference is not cosmetic."* Counter arrival leads with the plan and puts savings beneath it; direct arrival leads with saving and shows the locked shelf below. Same components, reversed order.

### New in this revision: "A charge arrives — the member side"

Every transaction after the first. The split is chosen **on the member's phone, never on the merchant device** — *"a service writer must not be picking someone's repayment terms."* Limit and clears-from appear on the approval screen using the same split footer as the Term plans component, so it is one pattern rather than two.

This must match the merchant reference exactly: the merchant's "waiting" state is this screen, unopened.

---

## 3. The field gap, resolved

`OnboardingResult` carries fourteen fields into `submitMemberOnboarding`. The reference flow collects five: contact, code, ZIP, invite, email.

I said earlier this was ten product decisions. Having read the reference properly, most are not decisions at all — the new flow removed the questions because the answers stopped varying:

| Field | Source | |
|---|---|---|
| `inviteCode` | collected | pre-filled at a counter, optional direct |
| `email` | collected | |
| `residencyCountry` | from ZIP | the flow already gates on region |
| `referralSource` | **from the entry point** | the branch table is exactly this: QR vs site/referral/search |
| `accountMethod` | `appkit-account` | Privy embedded is the only path now |
| `accessTrack` | `hybrid` | follows from the above |
| `identityMode` | `privacy` | reference defers verification to first deposit |
| `recoveryMethod` | `passkey` | already hardcoded today |
| `membershipPlan` | `YEARLY` | already hardcoded today |
| `settlementCurrency` | `USD` | single region at launch |
| `incomeSource`, `goalsNote`, `localPools` | empty / false | already sent empty today |
| `cardWaitlist` | `false` | no card-waitlist step in the reference |
| `notificationsOptIn` | `true` | the counter path sends text, email and push; consent is the flow |

**`username` — resolved: generate at signup, editable in settings.**

More of this exists than it appears. `member_profile_public.username` is already `TEXT UNIQUE` and already writable through `updateMemberProfile`. What is missing is that it is not a *lookup key*: `lookupWallet` takes email and phone only, which is why Send can display a handle and not resolve one.

The identity model the handle joins is already the right one. The smart account is the identity; email and phone are pointers to it, matched by hash, opt-out aware, against either the saved profile contact or the login identity. A handle is a third pointer to the same wallet.

One difference decides its shape. **Email and phone are hashed; a handle must not be.** They are hashed because they are contact details somebody may not want discoverable — hence the opt-out. A handle exists *to* be public and typed at by someone who does not have your number. Stored plain and looked up directly is correct rather than lax. It does mean the directory opt-out stops being one switch: "my handle resolves, my phone does not" is a coherent preference and the current single toggle cannot express it.

Generated rather than asked, because a unique constraint means a *chosen* handle needs a collision-and-retry step the reference has no screen for — and the reference removed the question deliberately. Generated-then-editable gives Send something to show on day one without reintroducing it.

Two things that follow, and both are cheaper before anyone holds a handle:

- **Uniqueness is case-sensitive as written.** `TEXT UNIQUE` makes `@Kai` and `@kai` different handles, which is a phishing surface in a payments app. Needs a normalised column or a lowercase index.
- **Reserved handles.** `@clear`, `@support`, `@admin` and similar should never be claimable.

**Still open: `reasons`** — the old flow asked why somebody was joining and the new one does not. Either drop it from the submit contract or accept it empty. Worth knowing which: dropping it is a schema change, and accepting it empty quietly ends a data series.

---

## 4. Missing components

Against the reference, the app does not have:

- **`AddToHomeScreen`** — the counter path's first step. A2HS prompt with the iOS/Android split.
- **`PendingTotalHeader`** — the running total that rides every counter step.
- **`SplitChooser` in an onboarding context** — exists for term plans; the reference reuses the same footer here deliberately, so this is a re-use rather than a new component.
- **`BankLinkStep`** — Plaid link presented as a required step rather than a settings action.
- **`ChargeApproval`** — the new "A charge arrives" screen: amount, split choice, limit, clears-from, Approve.
- **`CounterDayOne`** — day one with the plan leading. `HOME_DAY_ONE_COUNTER` already exists in the placeholder data; nothing renders it outside the preview.

---

## 5. Phases

**A0 — Handles.** Normalisation, a reserved list, generation, and `@handle → wallet` in the directory. Ahead of the container because the container assigns one, and because every rule here is cheaper to set before anybody holds a handle than after.

**A — The container.** A real `OnboardingRoute` owning the step machine, the auth calls and the submit chain that `UserOnboarding` owns today. Direct path only, reusing the existing steps. Route `/onboarding` to it; archive `UserOnboarding` and `OnboardingView`. *Nothing new is collected; the field table above fills the gap.*

**B — The counter entry.** `AddToHomeScreen`, `PendingTotalHeader`, `BankLinkStep`, and the branch logic. Entry is a QR carrying the shop and the pending total, so the route needs to accept both.

**C — Charge approval.** `ChargeApproval` and the notification that opens it. Must match the merchant reference exactly.

**D — Day one by arrival.** Render `HOME_DAY_ONE_COUNTER` for a counter arrival; reversed order, same components.

**E — Login.** `LoginView` → the reference's entry screen. Deliberately last: it is the smallest change and the one most likely to lock somebody out if rushed.

---

## 6. Open questions

1. `username` — derived, generated, or a new step? (§3)
2. `reasons` — drop from the contract, or accept empty? (§3)
3. Does the QR carry the pending total, or only the shop, with the total fetched after? The reference shows it on every step but does not say where it comes from.
4. Is the bank link at a counter blocking, or skippable-with-consequences? The reference says "required" and also calls it "the likeliest drop-off point" — those pull in different directions and the answer decides whether a member can reach day one without one.
