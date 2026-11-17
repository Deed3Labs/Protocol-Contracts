# Automatic PayoutPool top-ups

Decision 51 (owner-approved Nov 17, 2026) makes routine PayoutPool top-ups automatic, within a limit. Clear Lending's money moves from CL Operating into the PayoutPool only when the pool is short or about to be, and never more than a spending limit that CL Operating's owners set on chain. Before this, a person moved the money every time (decision 49), and the read-only keeper only emailed ops.

The job is `apps/api/src/jobs/payoutTopUp.ts`. Its rules are in `apps/api/src/services/payoutFunding/topUp.ts`. It is off unless `PAYOUT_TOPUP_ENABLED=1`. The read-only payout funding keeper (`payoutFundingKeeper.ts`, `DEPLOY-RUNBOOK.md` §4.3) keeps running beside it and does not change.

## The money path

- **CL Operating** (`0xfAFf1081F77bF528bA21eea590f251a755bCdf65` on Base Sepolia) is Clear Lending's Safe, where Yield Pool Deployments land. It is a Safe v1.5.0 with one owner, the Clear Lending Safe (2 of 2).
- **Safe's AllowanceModule** (v0.1.1, `0xAA46724893dedD72658219405185Fb0Fc91e091C`, the canonical deployment from `safe-modules-deployments`) is enabled on CL Operating. It lets one named delegate spend up to a set amount of one token per period, and nothing else. On Base Sepolia there is also a contract reporting "Allowance Module 1.0.0" at `0x691f…E331`. It is not in Safe's released deployments, so it is not used.
- **The top-up wallet** is a Coinbase CDP server wallet, `payout-topup-base-sepolia` (`0xC0C4EC7875D1838C0AE610accC16AAdCDb475068`). It is the module's delegate on CL Operating and holds the PayoutPool's `FUNDER_ROLE`, and nothing else.

A top-up is three transactions from the top-up wallet, each for the same exact amount:

1. `AllowanceModule.executeAllowanceTransfer(CL Operating, USDC, wallet, amount, 0x0, 0, wallet, "")` moves USDC from CL Operating to the wallet. The wallet sends this itself. With an empty signature the module treats `msg.sender` as the signer and checks it is a delegate of that Safe. No signed message, nonce or relayer is involved, and the module refuses anything over what is left of the limit this period.
2. `USDC.approve(PayoutPool, amount)`.
3. `PayoutPool.fund(amount)`. The pool pulls the USDC and records it as the wallet's capital.

The wallet never calls `withdrawCapital`. The code refuses that call, and every call other than these three, before anything is signed. The wallet pulls only what it is about to fund, so between top-ups it holds no USDC. It needs a little ETH for gas: it held 0.005 on Nov 17, 2026.

## When it moves

It checks every 15 minutes, reading views only. It moves rarely:

| The PayoutPool… | What it does |
|---|---|
| can pay everything due within **14 days** (`dueWithin(14 days).short == 0`) | Nothing, even if the 30-day picture is short. |
| cannot pay everything due within 14 days, or has an unfunded claim already overdue | Refills to everything due within **30 days**, plus a **$100** margin: `dueWithin(30 days).short + margin`. The next move is then weeks away. |
| needs more than the spending limit has left this period | Moves what the limit allows. It prepares the rest as a Transaction Builder batch for CL Operating, alerts ops, and shows the batch on the Command Center. |
| has a short at 14 days, but CL Operating lacks the money | Moves nothing. It alerts: "Clear Lending needs to move money into CL Operating: a Yield Pool Deployment, BondVault excess, or the treasury." |
| is fine within 14 days, but the 30-day refill would need more than the limit has left | Moves nothing. It alerts once per period, so people can act early. |

Notes on the rules:

- **The 14-day low-water mark** sits well before addendum 12.10's deadline: each charge funded 2 business days before the merchant's payout deadline. The job will not accept a low horizon under 7 days.
- **Truncated lists.** `dueWithin` lists at most `maxClaims` claims, and its total covers only those. A list that comes back full is read again with a limit four times larger, up to 3,200. If it is still full, the need is taken as everything queued (`queuedTotal`). That may over-fund, within the limit. It never under-funds without saying so.
- **Debug logging.** Each check's projections are logged when `PAYOUT_TOPUP_DEBUG=1`, and saved for the Command Center every time.

## The limit

The spending limit lives on chain, on CL Operating, and only CL Operating's owners can change it. On Base Sepolia it is **$5,000 per week**: `PAYOUT_TOPUP_CAP_USDC=5000` and `PAYOUT_TOPUP_RESET_MINUTES=10080`. Weeks count from Monday Nov 16, 2026, 00:00 UTC (`PAYOUT_TOPUP_RESET_BASE_MINUTES=29913120`).

At testnet volumes that is several 30-day refills. It is also the most a bug, or someone holding the wallet's key, could move out of CL Operating in a week. For mainnet, set it from the largest weekly refill expected, with some headroom. The module's period is at most 65,535 minutes (about 45 days).

What else a stolen wallet key could reach, beyond the limit:

- the wallet's own idle capital in the PayoutPool (`idleCapitalOf`), through `withdrawCapital`. The code never calls it; a thief could.
- the positions the wallet's capital bought (`_placePosition`), redeemable through `redeem`, and the carry paid on them.

Each of these is bounded by what the wallet has funded and not yet recovered. If the key is in doubt:

1. Revoke the wallet's `FUNDER_ROLE`. This is the PayoutPool admin's call: the deployer before I2, a credit timelock proposal after.
2. Have CL Operating remove the delegate: `AllowanceModule.removeDelegate(wallet, true)`.

## What people sign, once

`scripts/signing_plan.ts` lists these steps (re-run it after each). Their inputs are in `deploy/config/base-sepolia.rollout.env`: `PAYOUT_TOPUP_WALLET`, `PAYOUT_TOPUP_CAP_USDC`, `PAYOUT_TOPUP_RESET_MINUTES`, `PAYOUT_TOPUP_RESET_BASE_MINUTES` and `PAYOUT_TOPUP_ALLOWANCE_MODULE`. While any is empty, its steps wait and nothing else does.

| Step | Who | What |
|---|---|---|
| `PT-funder` | the deployer, day 0, **before I2** | `PayoutPool.grantRole(FUNDER_ROLE, wallet)` on the fresh PayoutPool. It waits for deploy 22. After the credit handover (I2) the PayoutPool's admin is the credit timelock, and the grant becomes a 7-day proposal from the Ops Safe. |
| `PT-safe-module` | CL Operating | `enableModule(AllowanceModule)` |
| `PT-safe-delegate` | CL Operating | `AllowanceModule.addDelegate(wallet)` |
| `PT-safe-allowance` | CL Operating | `AllowanceModule.setAllowance(wallet, USDC, cap, period, base)` |

The three CL Operating calls are one batch: `deployments/base-sepolia/safe-batches/signing-PT-cl-operating-setup.json`. CL Operating is nested, so sign it like this:

1. In the Safe app, open CL Operating.
2. Load the batch in Transaction Builder.
3. Confirm it from the Clear Lending Safe. Both of its owners sign.
4. Execute it.

To check the setup read-only, run `npx hardhat run scripts/check_rollout_inputs.ts --network base-sepolia`. Each of the following passes, or shows a WARN while its step is still to do:

- the module is Safe's;
- the module is enabled on CL Operating;
- the wallet is a plain account and no other job's wallet;
- the wallet is CL Operating's delegate, with the rollout's allowance;
- on the fresh PayoutPool, the wallet holds `FUNDER_ROLE` and no other role.

To change the limit later, CL Operating's owners call `setAllowance` again (the plan writes it), or remove the delegate to stop the job entirely.

## What the alerts mean

Alerts go to `OPS_ALERT_EMAIL`, and each is sent once (keyed in `ops_alerts`).

| Subject | Meaning | What to do |
|---|---|---|
| Payout top-up needs CL Operating's owners: $X | The refill needed more than the limit allows this period. | The body holds a Transaction Builder batch for CL Operating, also on the Command Center (Money, Pools, Payout pool, "Safe batch"): `USDC.transfer(top-up wallet, X)`. Sign it like the setup batch. On its next check the wallet funds exactly that, with approve and fund. |
| Clear Lending needs to move money into CL Operating | The pool is short at 14 days, but CL Operating cannot cover the move. | Move money into CL Operating: a Yield Pool Deployment, BondVault excess through the Collateral Agent, or the treasury. The next check moves it. |
| …the next 30 days need more than the spending limit has left | An early warning. Nothing is short yet. | Optional. Fund by hand early, or raise the limit. |
| …automatic top-ups are not set up | The pool is short, but the module, delegate, allowance or `FUNDER_ROLE` is missing, or the wallet holds another PayoutPool role. | Finish the `PT-` steps. Revoke any extra role. |
| Automatic payout top-up stopped: … | A dry run or a transaction reverted, or a call failed the code's guard. | See "When it stops". |
| Automatic payout top-up cannot read the chain | Three checks in a row failed to read. | Check the RPC. The keeper still alerts. |

## When it stops

Any revert stops the job: a dry run (`eth_call` and `estimateGas`) or a mined transaction. The job marks the top-up `failed`, alerts, and moves nothing more until a person clears it. The read-only keeper keeps alerting meanwhile.

1. Read the alert and the top-up's transactions (Command Center, or `ops.payout_topups`).
2. Check the wallet's USDC. If a pull went through but the fund did not, the USDC is in the wallet. After you clear the stop, the next check funds exactly that, without pulling again.
3. Once the cause is understood, clear it: `cd apps/api && bun src/scripts/clearPayoutTopUpHalt.ts <top-up id> "<your name>"`.

## Restarts and double funding

Every top-up is recorded (migration 0078, `ops.payout_topups`) before its first transaction. The record holds:

- its trigger;
- both projections;
- the amount and the remainder;
- the allowance's nonce;
- each transaction hash.

At most one top-up per pool is in flight; a unique index enforces it. A check that finds one in flight finishes it rather than starting another. After a restart, the job reads the chain to see how far it got:

- the receipts it recorded;
- the allowance nonce: if it is past the recorded one, the pull happened;
- the wallet's balance and approval: if both are spent, the fund happened.

Each send carries a CDP idempotency key made from the top-up and the step, so a send repeated after a crash is the same transaction. One trigger is never funded twice.

## Not automated yet

The positions the wallet's capital buys, and the carry paid on them, accrue to the top-up wallet: `fund` records the capital as the wallet's own. Nothing yet redeems them, or moves the proceeds back to CL Operating. Until something does, they stay with the wallet, recorded on chain. It is an open item for a later change.

## Railway variables (the API)

| Variable | Default | |
|---|---|---|
| `PAYOUT_TOPUP_ENABLED` | off | `1` turns the job on. |
| `PAYOUT_TOPUP_WALLET` | (required) | The top-up wallet's address. The job refuses to send from any other. |
| `PAYOUT_TOPUP_CDP_ACCOUNT_NAME` | `payout-topup-base-sepolia` on 84532 | The CDP account name. It is looked up, never created. It uses the relayers' CDP credentials (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, or the `SAVINGS_`/`SEND_` ones). |
| `PAYOUT_TOPUP_SAFE` | CL Operating on 84532 | The Safe the allowance is on. |
| `PAYOUT_TOPUP_ALLOWANCE_MODULE` | `0xAA46…091C` | Must answer `NAME() == "Allowance Module"`, or the job does not start. |
| `PAYOUT_TOPUP_CHECK_MINUTES` | 15 | |
| `PAYOUT_TOPUP_LOW_DAYS` | 14 | At least 7. |
| `PAYOUT_TOPUP_TARGET_DAYS` | 30 | At least the low horizon. |
| `PAYOUT_TOPUP_MARGIN_USDC` | 100 | In dollars. |
| `PAYOUT_TOPUP_MAX_CLAIMS` | 200 | Raised x4 up to 3,200 when a read comes back full. |
| `PAYOUT_TOPUP_CAP_USDC` | unset | Optional, in dollars. The bot also holds itself to this per period, even if the chain allows more. |
| `PAYOUT_TOPUP_DEBUG` | unset | `1` logs each check's projections. |
| `OPS_ALERT_EMAIL`, `DATABASE_URL` | | As for the keeper. |

The PayoutPool is `PAYOUT_POOL_<chainId>`, or the default in `apps/api/src/config/contracts.ts`. USDC is the PayoutPool's `reserveToken()`. Point `PAYOUT_POOL_84532` at the fresh PayoutPool after deploy 22 (`DEPLOY-RUNBOOK.md` §4.2) before turning the job on.
