# Merchant app on Privy Organizations

What changes from the consumer app's individual wallets, and where each call lands in merchant onboarding.

---

## The short version

The consumer app creates **one object**: a user, who owns a wallet. The merchant app creates **four**: a user, a key quorum, an organization, and a wallet owned by that quorum. Everything else follows from that.

Two things the docs settle that were open:

**Signers can be authorization keys, not only people.** Privy's owners-and-signers model accepts a user, an authorization key, or a key quorum. So Clear's backend holds a P-256 authorization key registered as a signer on each merchant's org wallet, scoped by policy. **Staff never need Privy identities and the counter device never holds a key.**

**Staff could be Privy users cheaply if that changes.** Privy accepts `custom_auth` linked accounts against any OIDC/JWT system. Staff provisioned from Clear's own records would never see Privy. Worth knowing, but not needed under the signer model above.

---

## Object model, side by side

| | Consumer app | Merchant app |
|---|---|---|
| Identity | Privy user (email, passkey) | Privy user for the **owner** |
| Ownership | The user owns their wallet | A **key quorum** owns the wallet |
| Entity | Individual, or none | **Organization** |
| Wallet creation | On first login | After the agreement is signed |
| Server access | Delegated signer, user-consented | **Authorization key** as signer, owner-consented |
| Limits | None, or app-side | **Policy** — amount thresholds at the wallet layer |
| Approvals | Single signature | **Intents** — async, multi-party |
| Verification | KYC on the individual | **KYB on the organization** |

---

## The nine concrete changes

**1. Three objects exist before the wallet does.** User, then key quorum, then organization, then wallet. The consumer flow is user then wallet. This is the change that reorders onboarding.

**2. The wallet's owner is a quorum, not a person.** Signing semantics differ: actions are authorised against the quorum rather than a single user key. For a one-owner shop the quorum has one member, but the shape is already multi-party — which is what makes adding a co-owner later a configuration change rather than a migration.

**3. A wallet's entity cannot be changed once set.** This is a hard constraint in the docs. The organization must exist before the wallet is created, or the wallet must be created with no entity and assigned afterwards — and assigning an entity **does not** change the owner, which has to be updated separately. Cleanest path: create the org first, always.

**4. Policies become load-bearing rather than optional.** The $1,500 approval cap moves from a disabled button to an amount threshold enforced at the wallet layer. This is the single biggest security improvement in the switch: **the ceiling holds even if the counter app is compromised or bypassed.**

**5. Server access is an authorization key, not a delegated user wallet.** The consumer pattern asks the user to consent to a delegated signer on their own wallet. The merchant pattern registers Clear's backend key as a signer on the org wallet, with a policy attached. Different consent model, different revocation story.

**6. Intents are an Enterprise feature.** The docs say so explicitly and point at sales. The refund step-up — Jen requests, Mike approves from his phone — is exactly what intents are for, and it is gated. **Confirm tier and pricing before building the refund flow against it.** A fallback is possible: hold the request in Clear's own records and have the owner's approval trigger a single signed action, which is less elegant and works.

**7. KYB replaces KYC.** Business verification against the organization, not the person. Verification is scoped to the entity, which means an owner who also uses Clear personally needs **both** — KYC on Mike as an individual, KYB on Mike's Tire as an organization. They are separate and neither satisfies the other.

**8. Succession has to be designed.** A consumer wallet is tied to a person and dies with their account. An org wallet outlives the owner's involvement — a sold business, a departed partner, a death. The quorum can be updated by an existing owner, so the mechanism exists, but nothing forces you to plan for it and the partner agreement should.

**9. 150 wallets per organization.** Irrelevant at one wallet per shop. Relevant if wallets are ever provisioned per location or per terminal.

---

## Where the calls land in onboarding

The six-step merchant onboarding, annotated. Steps unchanged in the UI; the infrastructure hangs off specific ones.

**1 · Start** — email captured

→ Create or retrieve the Privy user for the owner. Nothing else. The shop does not exist yet and neither should any wallet.

**2 · Your shop** — name, category, address, typical ticket

→ No Privy calls. Held in Clear's records. Typical ticket informs the policy threshold set at step 6.

**3 · Your terms** — the agreement is signed

→ **This is where the organization is created**, in three calls:

1. Create the key quorum containing the owner's user ID
2. Create the organization with `display_name` and `default_key_quorum_id`
3. Create the wallet with `entity: {id, type: 'organization'}`, omitting `owner` so the quorum inherits it

Provisioning after signature rather than before is deliberate: no infrastructure exists for a business that has not agreed to anything, and nothing needs unwinding if they walk.

**4 · Verify** — business details

→ Run KYB against the organization. Fiat flows stay blocked until it clears, which is correct: the wallet can exist and hold nothing.

**5 · Where payouts go** — bank connection

→ Register the payout destination against the org wallet. This is the step KYB gates. It is skippable in the UI — a merchant can sign, train the counter and take charges today, adding banking before the first payout — and that remains true here, because charges are on-chain and only the payout crosses fiat.

**6 · The counter** — staff, cards, test charge

→ Two things happen:

- **Register Clear's authorization key as a signer** on the org wallet, and attach a policy carrying the approval cap and permitted actions. The owner authorises this once.
- **Create staff records in Clear's own system** — name, PIN, permissions. No Privy objects. The PIN attributes; the signer acts.

---

## What this means for the three levels of authority

The model designed in the merchant reference maps cleanly, with one correction.

| Level | What it is | Privy object |
|---|---|---|
| **Device** | Authenticated | *Not* a key — a session with Clear's backend |
| **Shift PIN** | Attribution | None. Clear's records only |
| **Owner sign-in** | Authorisation | Privy user in the key quorum |

**The correction: the device does not hold a key.** I had the enrolled device as the scoped signer. Better is Clear's backend holding one authorization key per merchant org, with the device holding only a session against Clear. That way:

- A stolen tablet holds no signing material at all
- Revoking a device is a Clear-side session revocation, instant and free
- The policy cap applies to every device at once, which is what an owner means by "my approval cap"
- One key per merchant rather than one per tablet, which is far less to rotate

The enrolment screen's claim — *enforced by policy, not by this app* — stays true and is now more precisely true.

---

## Decisions

**Do not build against intents in v1.** Enterprise pricing at five merchants is the wrong economics, and the fallback is invisible: the refund request lives in Clear's records, the owner approves in the app, Clear's backend signs. No screen changes. What intents actually buy is a property Clear does not have yet anyway — signatures collected such that Clear's own server cannot act alone. That becomes worth paying for when the co-op wants to claim it cannot move merchant funds unilaterally. Migrating later is cheap, because the intent sits behind Clear's own approval record.

**The approval cap lives in `MerchantRegistry`, not in a Privy policy.** It is business logic — it varies per merchant, moves with volume, forms part of the agreement — so it belongs in the protocol and should hold whichever signer or path a transaction arrives through. Use the Privy policy as a coarse dollar ceiling, a backstop against a compromised backend key, and let the contract enforce the precise rule. This also removes the need to answer whether policies support per-contract, per-method caps before starting.

**The device session expires after 30 days, renewed on use.** A tablet used daily never expires; one that leaves the shop dies within a month; an owner away a fortnight does not return to a dead counter.

**Succession is described in the partner agreement and the mechanism stays manual.** The co-op updates the key quorum on written instruction from an authorised representative, with identity verification, within a stated number of days. Automating succession is how a backdoor into every merchant wallet gets built.

**Shared email is fine.** Forcing two addresses produces `mike+shop@`, which defeats it, and verification is scoped to the entity regardless. The real fix is the account switcher — Clear shows "Kai Moore" and "Mike's Tire" as two contexts and is explicit about which you are acting as.

**The owner step-up code stays**, corrected. It is the manager override every till already has: it approves one displayed action, expires with it, is a different number from the owner's shift PIN, and is never a sign-in. Capped at refunds under $500 — above that, approval comes from the owner's own device. **The audit record says which path was used**, because *approved by owner code at the counter* is weaker evidence than *approved from Mike's phone*, and a disputed refund six months later turns entirely on that difference.

---

## What does not change

The consumer app's individual wallets stay exactly as they are. Members are users who own their own wallets, verification is KYC on the individual, and nothing about the organization model touches them.

A merchant owner who is also a member holds both, and that is correct rather than duplicative — Mike acting for himself and Mike's Tire acting are genuinely different parties, and the ledger should say so.
