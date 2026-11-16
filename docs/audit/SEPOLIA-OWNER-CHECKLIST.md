# Base Sepolia rollout: the owner's checklist

Everything the owner does or provides for the Base Sepolia rollout, in one place. Network: **Base Sepolia** (chain 84532) for every item. Addresses in full; no keys anywhere.

## 1. Create four new addresses for the Assurance Pool, and send them to the cloud session

| # | Role | Kind | How |
|---|---|---|---|
| 1 | **CL Fees** (pays Clear Lending's credit enhancement fee, recoveries and interchange share into the pool) | CDP wallet | Run the first command below |
| 2 | **Co-op Assurance Disbursement** (receives each approved member-assistance grant, then pays it out) | CDP wallet | Run the second command below |
| 3 | **CL Operating** (Clear Lending's draw address: asks the pool for backstop draws) | Safe, nested | Safe app, see below |
| 4 | **CL Loss Reserve** (receives the backstop money the pool releases) | Safe, nested | Safe app, see below |

**The two CDP wallets.** Run these in the local session, from `apps/api`. They use the CDP keys already in its `.env`, create the wallet by name (or find it if it already exists), and print its address.

```bash
SEND_DEFAULT_CHAIN_ID=84532 SEND_CDP_EVM_ACCOUNT_NAME=cl-fees-base-sepolia npm run send:cdp:account
```

```bash
SEND_DEFAULT_CHAIN_ID=84532 SEND_CDP_EVM_ACCOUNT_NAME=assurance-disbursement-base-sepolia npm run send:cdp:account
```

**The two Safes.** In the Safe app (app.safe.global), network **Base Sepolia**:

1. Open the existing Safe `0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50`.
2. Create a **nested Safe** with:
   - **Name:** `CL Operating (testnet)`, and for the second one `CL Loss Reserve (testnet)`;
   - **Owner:** `0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50`, and only that one;
   - **Threshold:** 1. The parent Safe needs 2 of 4 signatures, so every action still takes two people.

   If the Safe app's nested-Safe option is not offered, create a normal Safe with the same single owner and threshold.
3. Whoever creates each Safe pays a little test ETH.

**Rule the pool enforces:** none of these four may be one of the pool's signers, Account 3 `0x608d8A767C4Bf5063f5FA5DfE29F31DA3BF77c23` or Account 4 `0xA0e10CCAd487937195A0b756fc1055cd810Bd8a7`. The four must also be different from each other.

## 2. Already settled (nothing to create)

| Role | Address |
|---|---|
| Deployer (runs the deploy, then holds nothing) | `0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA` (AAA) |
| The Safe (every Safe role on testnet, and the co-op treasury payer) | `0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50` |
| Co-signer, Agent Key, Pool Tier, joins the Safe | `0x558D4318071EBC15e7ED13d8e880Dc1D17A7698a` (…698a) |
| Account 3 (treasury signer 1, Assurance Pool signer, pairs) | `0x608d8A767C4Bf5063f5FA5DfE29F31DA3BF77c23` |
| Account 4 (treasury signer 2, Pool Tier, Assurance Pool signer, pairs) | `0xA0e10CCAd487937195A0b756fc1055cd810Bd8a7` |
| Credit operator (API, key on Railway) | `0x8801A480Cd6a2Ab40964d3895d5BED8fCfa51edd` |
| Card settler (API, key on Railway) | `0x1b535bbe4bc5f1a4152dfbd1d1215d9435ead4f3` |
| Savings and send relayer (API, CDP `savings-relayer-base-sepolia`) | `0x6Cbdf4469856C70C07C95a6c276c218F64e0Fcb3` |
| Covered-loans reporter for the pool | the CollateralRegistry contract (filled in by the plan) |

The Privy wallets `0x7ec1D6b69398af413edC94692FB167A3864A86cF` and `0xD2645348dE8ff9c34dC00064B63fF9Cb8211eFE5` stay Safe owners and hold no role.

## 3. Test ETH

| Wallet | Address | Amount |
|---|---|---|
| Credit operator | `0x8801A480Cd6a2Ab40964d3895d5BED8fCfa51edd` | **about 0.01: still to do** (holds 0.0004) |
| CL Fees (new CDP wallet) | from step 1 | about 0.005 |
| Assurance Disbursement (new CDP wallet) | from step 1 | about 0.005 |
| AAA, …698a, Account 3, Account 4, relayer, card settler | as above | done |
| The Safes (old and new) | n/a | none needed: whoever submits pays |

## 4. The Safe change on day 0

This is not done now. The local session stops for it just before the handovers, and the signing page gives the Safe app batch:

`addOwnerWithThreshold(0x558D4318071EBC15e7ED13d8e880Dc1D17A7698a, 2)` on `0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50`, which makes the Safe 2 of 4.

## 5. The order

1. Create the four addresses (step 1) and send them to the cloud session.
2. Top up the credit operator and the two new CDP wallets (step 3).
3. The cloud session adds the Assurance setup to the signing plan, rehearses it on a fork, updates the handoff, and says when it's ready.
4. Start the local session with this prompt:

   > Pull branch claude/new-session-e5u3cp of Protocol-Contracts and follow docs/audit/SEPOLIA-RUN-HANDOFF.md exactly to run the Base Sepolia rollout. I approved the run. Stop at every SIGN step and wait for me, stop at the I1 review step, and stop on anything unexpected. Never print or log any private key.
5. Day 0: sign the cards on the signing page, the Safe app batches, and the I1 review (paste its dry-run output to the cloud session).
6. Day 7: the Safe executes the timelock batches, then the final checks run.
7. After the deploy, on the API in Railway, set:
   - `OPS_ALERT_EMAIL=ops@useclear.org`;
   - `PAYOUT_KEEPER_ENABLED=1`.
