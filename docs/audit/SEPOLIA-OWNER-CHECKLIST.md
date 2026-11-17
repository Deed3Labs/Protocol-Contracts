# Base Sepolia rollout: the owner's checklist

Everything the owner does or provides for the Base Sepolia rollout, in one place. Network: **Base Sepolia** (chain 84532) for every item. Addresses in full; no keys anywhere.

## 1. New addresses

**Done (read on Base Sepolia, Nov 16, 2026; Safe v1.5.0):**

| Role | Address | Shape |
|---|---|---|
| **Clear Lending (testnet)** Safe: proposes and executes on the Earn timelock (EarnControls, the Yield Pool) | `0xAE8FF4Fa84d786Ece2C7Ab87886A2CD6086c419d` | 2 of 2: AAA and …698a |
| **CL Operating (testnet)**: Clear Lending's account (Yield Pool Deployments, `LENDER_OPERATING`), and the Assurance Pool's draw address | `0xfAFf1081F77bF528bA21eea590f251a755bCdf65` | nested: 1 of 1, owner the Clear Lending Safe |
| **CL Loss Reserve (testnet)**: receives the backstop money the pool releases | `0xb42561F3FE68B6719628C0eAC398eA097DD56bAa` | nested: 1 of 1, owner the Clear Lending Safe |

**Still to create: two CDP wallets.** Run these in the local session, from `apps/api`. They use the CDP keys already in its `.env`, create the wallet by name (or find it if it already exists), and print its address.

```bash
SEND_DEFAULT_CHAIN_ID=84532 SEND_CDP_EVM_ACCOUNT_NAME_84532=cl-fees-base-sepolia npm run send:cdp:account
```

```bash
SEND_DEFAULT_CHAIN_ID=84532 SEND_CDP_EVM_ACCOUNT_NAME_84532=assurance-disbursement-base-sepolia npm run send:cdp:account
```

The first goes in `ASSURANCE_CL_FEES_PAYER` (pays Clear Lending's credit enhancement fee and recoveries into the pool (interchange is the co-op treasury's)), the second in `ASSURANCE_DISBURSEMENT` (receives each approved member-assistance grant, then pays it out), both in `deploy/config/base-sepolia.rollout.env`. The signing plan refuses to run while either is empty.

**Done Nov 17, 2026: a third CDP wallet, for automatic PayoutPool top-ups (decision 51).** It was created with the same command:

```bash
SEND_DEFAULT_CHAIN_ID=84532 SEND_CDP_EVM_ACCOUNT_NAME_84532=payout-topup-base-sepolia npm run send:cdp:account
```

It is `0xC0C4EC7875D1838C0AE610accC16AAdCDb475068`, and it is in `PAYOUT_TOPUP_WALLET`. It is a plain account, it is no other job's wallet, and it holds 0.005 test ETH for gas. Its spending limit on CL Operating is $5,000 a week (`PAYOUT_TOPUP_CAP_USDC`, `PAYOUT_TOPUP_RESET_MINUTES`). What it does: `docs/operators/payout-topups.md`.

**Rule the pool enforces:** none of these may be one of the pool's signers, Account 3 `0x608d8A767C4Bf5063f5FA5DfE29F31DA3BF77c23` or Account 4 `0xA0e10CCAd487937195A0b756fc1055cd810Bd8a7`, and a payer may not be the draw address. The plan also wants the five Assurance addresses (with the Clear Treasury Safe) all different.

## 2. Already settled (nothing to create)

| Role | Address |
|---|---|
| Deployer (runs the deploy, then holds nothing) | `0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA` (AAA) |
| **Clear Treasury** Safe: Clear Financial, Ops and board Safe, co-op treasury (pays board allocations into the Assurance Pool), carry treasury, fee recipient | `0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50` |
| Co-signer, Agent Key, Pool Tier, joins the Clear Treasury Safe, owns the Clear Lending Safe with AAA | `0x558D4318071EBC15e7ED13d8e880Dc1D17A7698a` (…698a) |
| Account 3 (treasury signer 1, Assurance Pool signer, pairs) | `0x608d8A767C4Bf5063f5FA5DfE29F31DA3BF77c23` |
| Account 4 (treasury signer 2, Pool Tier, Assurance Pool signer, pairs) | `0xA0e10CCAd487937195A0b756fc1055cd810Bd8a7` |
| Credit operator (API, key on Railway) | `0x8801A480Cd6a2Ab40964d3895d5BED8fCfa51edd` |
| Card settler (API, key on Railway) | `0x1b535bbe4bc5f1a4152dfbd1d1215d9435ead4f3` |
| Savings and send relayer (API, CDP `savings-relayer-base-sepolia`) | `0x6Cbdf4469856C70C07C95a6c276c218F64e0Fcb3` |
| Covered-loans reporter for the pool | the CollateralRegistry contract (filled in by the plan) |

The Privy wallets `0x7ec1D6b69398af413edC94692FB167A3864A86cF` and `0xD2645348dE8ff9c34dC00064B63fF9Cb8211eFE5` stay owners of the Clear Treasury Safe and hold no role.

## 3. Test ETH

| Wallet | Address | Amount |
|---|---|---|
| Credit operator | `0x8801A480Cd6a2Ab40964d3895d5BED8fCfa51edd` | **about 0.01: still to do** (holds 0.0004) |
| CL Fees (new CDP wallet) | from step 1 | about 0.005 |
| Assurance Disbursement (new CDP wallet) | from step 1 | about 0.005 |
| Payout top-up (CDP wallet) | `0xC0C4EC7875D1838C0AE610accC16AAdCDb475068` | done (0.005) |
| AAA, …698a, Account 3, Account 4, relayer, card settler | as above | done |
| The Safes (Clear Treasury, Clear Lending, the two nested) | n/a | none needed: whoever submits pays |

## 4. The Clear Treasury Safe change on day 0

This is not done now. The local session stops for it just before the handovers, and the signing page gives the Safe app batch:

`addOwnerWithThreshold(0x558D4318071EBC15e7ED13d8e880Dc1D17A7698a, 2)` on `0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50`, which makes the Safe 2 of 4.

## 4b. Automatic payout top-ups: two one-time signatures

Both are in the signing plan. Do them before the credit handover (I2):

- **`TU-funder`**: the deployer (AAA) grants the fresh PayoutPool's `FUNDER_ROLE` to the top-up wallet. This is a signing-page card, ready once deploy 22 has made the fresh PayoutPool. After I2 it would need a 7-day credit timelock proposal.
- **CL Operating's setup batch** (`TU-safe-module`, `TU-safe-delegate`, `TU-safe-allowance`): one Transaction Builder batch, `signing-TU-cl-operating-setup.json`. It enables Safe's AllowanceModule on CL Operating, names the top-up wallet its delegate, and gives it $5,000 of USDC a week.
  1. In the Safe app, open CL Operating.
  2. Load the batch.
  3. Confirm it from the Clear Lending Safe (AAA and …698a).
  4. Execute it.

  No deploy step waits on this batch.

## 5. The order

1. Create the two CDP wallets (step 1) and put their addresses in the rollout env (or send them to the cloud session).
2. Top up the credit operator and the two new CDP wallets (step 3).
3. The Assurance setup is in the signing plan and rehearsed on a fork (`SEPOLIA-REHEARSAL.md`).
4. Start the local session with this prompt:

   > Pull branch claude/new-session-e5u3cp of Protocol-Contracts and follow docs/audit/SEPOLIA-RUN-HANDOFF.md exactly to run the Base Sepolia rollout. I approved the run. Stop at every SIGN step and wait for me, stop at the I1 review step, and stop on anything unexpected. Never print or log any private key.
5. Day 0: sign the cards on the signing page (Accounts 3 and 4 also approve the Assurance Pool's five calls), the Safe app batches (the Clear Lending Safe: the Earn schedule; the Clear Treasury Safe: its new owner, the vault schedule, the Assurance schedule), and the I1 review (paste its dry-run output to the cloud session).
6. Day 7: the Clear Lending Safe executes the Earn batch, the Clear Treasury Safe the vault and Assurance batches, then the final checks run.
7. After the deploy, on the API in Railway, set:
   - `OPS_ALERT_EMAIL=ops@useclear.org`;
   - `PAYOUT_KEEPER_ENABLED=1`;
   - the Assurance fee payer, once the new pool is deployed: `ASSURANCE_POOL_V2_84532` (its address) the same day, then `ASSURANCE_FEE_PAYER_CDP_ACCOUNT_NAME=cl-fees-base-sepolia` and, once the pool's payers are set, `ASSURANCE_FEE_PAYER_ENABLED=1`. Each month Clear Lending's two signers sign CL Operating's funding transfer that Command proposes; the CL Fees wallet then pays the pool on its own. See [`assurance-fee-payer.md`](../operators/assurance-fee-payer.md).
   - once the two signatures in 4b are done and `PAYOUT_POOL_84532` names the fresh PayoutPool: `PAYOUT_TOPUP_WALLET=0xC0C4EC7875D1838C0AE610accC16AAdCDb475068`, `PAYOUT_TOPUP_CDP_ACCOUNT_NAME=payout-topup-base-sepolia`, then `PAYOUT_TOPUP_ENABLED=1`.
