# Merchant app on Privy Organizations

How a shop maps onto Privy's organization model, how its wallet is created during onboarding, and
how Clear acts on that wallet. The code is in
[`apps/api/src/services/merchant`](../../apps/api/src/services/merchant/) (`onboardingService.ts`,
`privyOrg.ts`, `privySigner.ts`, `clearSignerGrant.ts`, `payoutRedemption.ts`) and the merchant
app's [`OnboardingPage.tsx`](../../apps/merchant/src/pages/OnboardingPage.tsx).

---

## The short version

The member app creates **one object** at Privy: a user, who owns a wallet. The merchant app creates
**a user, a key quorum, an organization and a wallet the quorum owns**, plus a second key quorum
holding Clear's signing key and a policy that bounds it.

- **The shop is the organization.** Its wallet belongs to the organization, not to any person, so
  a sale, a second owner or a departed partner does not strand the money.
- **The owner is the only Privy user.** The owner's key quorum owns the wallet.
- **Staff are not Privy users.** They are records in Clear's own database; a PIN attributes a
  charge and authorises nothing.
- **The counter device holds no key.** It holds a session with Clear. Clear's backend holds one
  P-256 authorization key, registered as a signer on each shop's wallet under a policy.

---

## Object model, side by side

| | Member app | Merchant app |
|---|---|---|
| Identity | Privy user (email, passkey) | Privy user for the **owner** |
| Ownership | The user owns their wallet | The owner's **key quorum** owns the wallet |
| Entity | None | **Organization** (the shop) |
| Wallet creation | On first sign-in | When the owner's sign-in creates the shop, during onboarding |
| Server access | None: the member signs, and the API relays what they signed | **Clear's authorization key** in a key quorum of one, named on the wallet at creation |
| Limits | In the app and the contracts | A **policy** on Clear's signer, plus the per-shop cap in `MerchantRegistry` |
| Verification | KYC on the individual | **KYB on the business**, hosted by Bridge |

---

## Creating the shop

The merchant app's onboarding has seven steps: Start, Your shop, Your team, Your terms, Verify,
Where payouts go, and The counter. Nothing is written to Clear or Privy until **Verify**, where the
owner signs in with Privy. That sign-in calls `POST /api/merchant/onboarding` with the owner's Privy
token, the shop's name, the owner's name and a four-digit counter PIN. An owner who stops earlier
leaves nothing behind.

`onboardMerchant` then does this, in an order that cannot change:

1. **Clear's signer.** If `PRIVY_AUTHORIZATION_PUBLIC_KEY` is set, create a key quorum holding
   Clear's public key, and a policy for it ([The policy](#the-policy)).
2. **The owner's key quorum**, containing the owner's Privy user id.
3. **The organization**, with the shop's `display_name` and the owner's quorum as its
   `default_key_quorum_id`.
4. **The wallet**, with `entity: {id, type: 'organization'}` and no `owner`, so the organization's
   default quorum owns it. Clear's quorum is added in `additional_signers` with its policy.

The order is Privy's: a quorum must exist before an organization can name it, the organization
before a wallet can be created against it, and **a wallet's entity cannot be changed once set**.

**The wallet's address is the shop's identity.** `MerchantRegistry`, the payout destination and
Clear's own records all name the shop by it. Only after Privy returns all three objects does Clear
write the shop's profile, the owner's staff record (with the PIN), and the team.

**Onboarding is idempotent.** An owner who already has a shop is handed that shop back rather than
a second organization. If Privy is unavailable, onboarding reports that the wallet could not be
created; it never leaves a shop that believes it is set up.

After Verify, the same sign-in makes the owner's session, so **Where payouts go** can run Bridge's
hosted business verification (KYB) and link a bank with Plaid. That step can be skipped and done
later from Settings: charges are on chain, and only the payout crosses to a bank.

---

## Clear's signer

### Named at creation

A wallet owned by the owner's key quorum is non-custodial: adding a signer to it afterwards takes
the owner's own authorization, which Clear's server does not have. Naming Clear's quorum when the
wallet is created avoids that. The owner still owns the wallet; Clear acts only within the policy.

### Granting it later

A shop whose wallet was created without Clear's signer (for example, while
`PRIVY_AUTHORIZATION_PUBLIC_KEY` was unset) can grant it from the Payouts screen:

| Step | Route | What happens |
|---|---|---|
| Prepare | `POST /api/merchant/signer/prepare` | The server creates Clear's quorum and policy, and composes the exact request that would add them. Re-running reuses the same ids |
| Sign | The owner's browser | The owner signs that one request with their own authorization key, unlocked by a passkey. `addSigners` cannot be used: it refuses a wallet that belongs to an organization rather than to the person |
| Confirm | `POST /api/merchant/signer/confirm` | The server sends the signed request, then asks Privy whether Clear's key is really on the wallet |

`GET /api/merchant/signer` reports whether the key is attached and whether a payout could be sent
today. It asks Privy, by the wallet's address, rather than trusting Clear's own records.

### The policy

Clear's signer acts under one policy: `eth_sendTransaction` is allowed when the transaction's
native `value` is at most `MERCHANT_POLICY_CEILING_USD` (default `5000`) × 10¹⁸ wei. It bounds a
transaction's native value only: a call that moves tokens carries no native value, so the policy
does not limit the amount of USDC or credits it moves.

**The per-charge cap lives in `MerchantRegistry`** (`approvalCapOf`), because it varies per shop
and is part of the shop's terms. The API checks each charge against it when the charge is raised
([`chargeService.ts`](../../apps/api/src/services/chargeService.ts)); the registry stores the cap,
and no contract checks it on chain.

### What it is used for

Payouts. `PayoutPool.redeem` is sent from the shop's wallet by Clear's signer, preceded by a
`ClearCredit.approve` when the allowance is short. **Privy sponsors the gas** (`sponsor: true` on
the wallet's RPC), so the wallet holds no ETH; sponsorship is switched on in Privy's dashboard for
the chain in use. The two calls are separate transactions because the policy covers
`eth_sendTransaction` only. Without `PRIVY_AUTHORIZATION_PRIVATE_KEY` or sponsorship, a withdrawal
is recorded as a request and says so.

---

## The three levels of authority

| Level | What it is | At Privy |
|---|---|---|
| **Device** | An enrolled tablet: a session with Clear | Nothing. The device holds no signing material |
| **Shift PIN** | Attribution: who raised a charge | Nothing. Clear's records only |
| **Owner sign-in** | Authorisation | The owner's Privy user, in the wallet's key quorum |

- **Devices** are enrolled by a signed-in owner and stay enrolled until an owner removes them;
  removal takes effect on the next request. Only a hash of the device token is stored.
- **Shift sessions** last 12 hours.
- **A stolen tablet carries no key**, and Clear's policy applies to every device at once.

### The owner's code at the counter

A refund is requested at the counter and approved by an owner. The owner can approve from their own
device, or at the counter with the owner's code for refunds under the shop's code limit
(**$500.00 by default**; zero turns it off). Only a signed-in owner can change the limit; the code
cannot. The refund record stores which path approved it (`owner_code` or `owner_device`), because
the two are not equal evidence.

---

## What does not change for members

Member wallets stay as they are: members are users who own their own wallets, and verification is
KYC on the individual. A shop owner who is also a member holds both, with KYC on themselves and KYB
on the business. Neither satisfies the other, and the ledger keeps them as separate parties.

## Known limitations

- **Privy intents are not used.** Refund approval is held in Clear's own records.
- **Co-owners and succession are not available yet.** Each shop's key quorum holds the one owner
  who created it, and nothing in the apps or the API changes its members.
