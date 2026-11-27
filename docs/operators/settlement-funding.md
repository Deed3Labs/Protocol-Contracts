# Automatic Settlement Funding

Decision 54 (founder, Nov 17, 2026) makes card settlement funding automatic, within limits two people set once. The Credit Settlement Account (CSA) at the bank partner is funded before each settlement cut-off, to cover the credit portions of card spend due in that settlement plus a Settlement Buffer (L-01 §8.4A; I-02 §4.9(a); I-07 §4.10). The Yield Pool pays for members' credit swipes just before the bank needs the money, netted against repayments, through a settlement lane with a per-period cap enforced on chain (IV-02 §4.3A).

The job is `apps/api/src/jobs/fundingDesk.ts`. Its rules are in `apps/api/src/services/settlementFunding/desk.ts`. It is off unless `SETTLEMENT_FUNDING_ENABLED=1`, and `SETTLEMENT_FUNDING_DRY_RUN=1` makes it decide, record and log without sending anything. It replaces the per-purchase `borrow` that decision 17 retired (#887): nothing in the API borrows from the pool.

The ESA vault never funds anything. The ESA reserve is held in trust, 1:1, and is used only to redeem CLRUSD. Nothing in the desk reads, names or moves it.

## The money path

- **The CSA and the Collection Account** are accounts at the bank partner, held through Lithic as financial accounts. The desk reads their available balances (`SETTLEMENT_CSA_FINANCIAL_ACCOUNT_TOKEN`; `SETTLEMENT_COLLECTION_FINANCIAL_ACCOUNT_TOKEN`, which defaults to `LITHIC_AUTO_CLEAR_SETTLEMENT_ACCOUNT_TOKEN`, where automatic clearing books members' repayments). A balance that cannot be read is never taken as zero: the desk moves nothing and alerts.
- **CL Operating** (`0xfAFf1081F77bF528bA21eea590f251a755bCdf65` on Base Sepolia) is Clear Lending's Safe, the Yield Pool's registered deployment account. Settlement lane Deployments land there.
- **The SettlementForwarder** is CL Operating's AllowanceModule delegate. It has one function, `forward(amount)`. Only the desk wallet may call it, and it sends USDC from CL Operating to one off-ramp address, which only CL Operating's owners can change, within the allowance.
- **The off-ramp** is a deposit address bound to the CSA: a Bridge liquidation address whose destination is the CSA as an external account. Every deposit is paid out to the CSA by the address's rail. If a payout fails, Bridge returns the USDC to the address's `return_address`, CL Operating.
- **The desk wallet** is a Coinbase CDP server wallet, `settlement-desk-base-sepolia` (`0x8b8b8643bA33E96E3716F26c631556164C2139eB`, `SETTLEMENT_DESK_WALLET`). It is the lane's registered funder and the forwarder's only caller, and nothing else.

At each run the desk covers what the CSA needs, in this order:

1. **A book transfer** from the Collection Account to the CSA (same bank), a Lithic book transfer whose token is the move's idempotency key. Collections already in hand net against new draws.
2. **Settlement Funding through the lane**: two transactions from the desk wallet, for the same exact amount:
   1. `LendingPool.deploySettlement(amount, ref)` sends USDC from the Yield Pool to CL Operating. `ref` is `keccak256(cut-off, credit-portion total)`.
   2. `SettlementForwarder.forward(amount)` moves exactly that from CL Operating to the off-ramp.
3. **Otherwise an alert** naming the Savings-Backed Margin and the manual options.

The desk never moves more than the lane's cap per period, or the forwarder's allowance. What they cannot cover is prepared as Transaction Builder batches for people, as payout top-ups do (see "What the alerts mean").

The code refuses every call other than `deploySettlement`, `forward`, and, for a Return, USDC `approve` to the pool and `returnFunds`, each to its own contract with the exact amount. It refuses the two-person `deploy` and any token transfer by name.

## When it moves

It checks every 15 minutes, and once more at the forced time: cut-off − (off-ramp latency + margin). Runs before the funding window (`SETTLEMENT_FUNDING_WINDOW_MINUTES` before the forced time) only record what they see. The desk funds settlements; it never chases individual swipes. Below `SETTLEMENT_MIN_MOVE_USDC` nothing moves.

```
need = due at the next cut-off + buffer − CSA balance − in flight
```

- **Due** is the credit portion of card transactions Lithic has reported settled and that the bank debits at the next cut-off. It comes from `lithic_auth_decisions` (`credit_cents` of APPROVED rows with status SETTLED, timed by `settled_at`). `SETTLEMENT_LAG_BUSINESS_DAYS` says how many business days after clearing the bank debits it.
- **Friday's run covers through Monday.** When non-business days (a weekend, a holiday) follow the next cut-off, the run also covers the first business day's cut-off after them. What will settle by then is not known yet, so the credit portions authorized and not settled are added (`SETTLEMENT_ROLLOVER_PENDING_SHARE`, default all of it).
- **The buffer** is the larger of `SETTLEMENT_BUFFER_USDC` and the CSA minimum the bank requires (`SETTLEMENT_CSA_MINIMUM_USDC`) plus the card credit that settles, at the last week's rate, between the forced run and the cut-off.
- **In flight** is book transfers not landed and off-ramp payouts not yet arrived (and, for `SETTLEMENT_OFFRAMP_SETTLE_MINUTES` after the provider reports a payout processed, that payout too).
- **Measured latency.** Each Deployment records when its forward was mined and when the off-ramp reported it paid. The longest of the last ten replaces `SETTLEMENT_OFFRAMP_LATENCY_MINUTES` once it is longer, which moves the forced run earlier and raises the buffer.

The lane enforces on chain every condition of a two-person `deploy` (no open queue request, no Suspension, no pending loss charge, Utilization at most 90% afterwards), and it lets the Deployed Balance exceed the posted Pool Tier principal by up to the Settlement Headroom, to cover credit authorized and not yet settled. The desk checks the same before it tries, a pending loss charge included (`pendingLossCharge()`), so a shortfall reads as a sentence, not a revert.

## Returns

Cash in the CSA above the next cut-off plus the buffer, idle for `SETTLEMENT_RETURN_IDLE_HOURS` (24), goes back within 2 business days, in this order:

1. **Restore the Margin**: what the Savings-Backed Margin advanced and has not been restored, by book transfer from the CSA (`SETTLEMENT_MARGIN_FINANCIAL_ACCOUNT_TOKEN`).
2. **A Return to the pool**: a same-day ACH from the CSA to the on-ramp (`SETTLEMENT_ONRAMP_EXTERNAL_BANK_ACCOUNT_TOKEN`, the desk's Bridge virtual account), which delivers USDC to the desk wallet; the desk then approves exactly that and calls `returnFunds`.
3. **The BondVault**: by people, where its documents allow.

This direction is off unless `SETTLEMENT_RETURNS_ENABLED=1`. While it is off, idle surplus raises one alert a day and a person sends it back.

## The limits

The lane's cap per period, its period and the Settlement Headroom live on the Yield Pool, set by two `DEPLOYER_ROLE` signers. The forwarder's allowance lives on CL Operating, set by its owners. `stopSettlementFunder()` stops the lane at once: one call from any `DEPLOYER_ROLE` or `CCO_ROLE` holder. On Base Sepolia use something small, e.g. $5,000 a week and $1,000 of headroom. The desk also holds itself to `SETTLEMENT_FUNDING_CAP_USDC` per period when it is set.

What a stolen desk key could do: deploy up to the lane's cap per period into CL Operating (Clear Lending's own Safe), and push up to the forwarder's allowance from CL Operating to the off-ramp, which pays only the CSA. If the key is in doubt:

1. `stopSettlementFunder()` on the Yield Pool (any `DEPLOYER_ROLE` or `CCO_ROLE` holder).
2. Have CL Operating remove the forwarder as delegate: `AllowanceModule.removeDelegate(forwarder, true)`.

## What people sign, once

First, by the deployer (no signatures): `SETTLEMENT_LANE_PREPARE=1 npx hardhat run scripts/upgrade_settlement_lane.ts --network base-sepolia` validates the upgrade against the OpenZeppelin manifest and deploys the new LendingPool implementation (record `LendingPoolSettlementLane`); `npx hardhat run deploy/28_deploy_SettlementForwarder.ts --network base-sepolia` deploys the SettlementForwarder. Neither touches the pool or CL Operating.

Then `scripts/signing_plan.ts` lists these steps (stage `SL`):

| Step | Who | What |
|---|---|---|
| `SL-upgrade-schedule`, then `SLx-upgrade-execute` (day 7) | the Clear Lending Safe, through the Earn timelock | The LendingPool upgrade that adds the lane: a new Earn timelock proposal, scheduled only once `E8x-earn-execute` has run. The lane starts empty. |
| `SL-funder-1`, `SL-funder-2` | two different `DEPLOYER_ROLE` signers, the same call each | `setSettlementFunder(desk wallet, capPerPeriod, periodSeconds)`. The second call applies it. It also restarts a stopped lane. |
| `SL-headroom-1`, `SL-headroom-2` | two different `DEPLOYER_ROLE` signers | `setSettlementHeadroom(amount)` |
| `SL-cl-operating-delegate`, `SL-cl-operating-allowance`, `SL-cl-operating-offramp`, `SL-cl-operating-desk` | CL Operating's owner (the Clear Lending Safe), one batch: `safe-batches/signing-SL-cl-operating.json` | `AllowanceModule.addDelegate(forwarder)`; `setAllowance(forwarder, USDC, cap, period in minutes, 0)`, the same cap and period as the lane's; `forwarder.setOffRamp(SETTLEMENT_OFFRAMP_ADDRESS)`; `forwarder.setDesk(desk wallet)`. The AllowanceModule must already be on CL Operating (`TU-safe-module`, from the payout top-ups). |

Nothing is scheduled until the owner says so.

Their inputs are in `deploy/config/base-sepolia.rollout.env`: `SETTLEMENT_FUNDER` (the desk wallet), `SETTLEMENT_CAP_USDC` and `SETTLEMENT_PERIOD_DAYS` (the lane's cap, $5,000 every 7 days on Base Sepolia, and the forwarder's allowance, the same), `SETTLEMENT_HEADROOM_USDC` ($1,000) and `SETTLEMENT_OFFRAMP_ADDRESS` (the off-ramp's deposit address bound to the CSA). Addresses and dollars only. While the funder is empty, `SL-funder-1/2` and `SL-cl-operating-desk` wait; while the off-ramp is empty, `SL-cl-operating-offramp` waits; nothing else waits on them. The step-by-step for the owner is `docs/audit/SEPOLIA-OWNER-CHECKLIST.md` section 4c; the runbook is `docs/audit/DEPLOY-RUNBOOK.md` section 4.4.

CL Operating is nested, so its batch is signed like the top-ups' setup batch:

1. In the Safe app, open CL Operating.
2. Load the batch in Transaction Builder.
3. Confirm it from the Clear Lending Safe. Both of its owners sign.
4. Execute it.

To check the setup read-only, run `npx hardhat run scripts/check_rollout_inputs.ts --network base-sepolia`. Its `checkSettlementForwarderSetup` checks that the desk wallet is a plain account no other job uses, that the SettlementForwarder (deploy 28) serves CL Operating, Safe's AllowanceModule and USDC, that its off-ramp and desk are the rollout's, and that it is CL Operating's delegate with an allowance no larger than the lane's cap. A step not done yet is a WARN, a wrong one a FAIL. The desk makes the same checks on every run and says which is missing ("lane not set up").

To change the limits later, two `DEPLOYER_ROLE` signers call `setSettlementFunder` or `setSettlementHeadroom` again, and CL Operating's owners call `setAllowance` for the forwarder. Setting the lane again never adds to the period running. Restarting a stopped funder also takes both deployers, both after the stop: a proposal made before it never applies.

**The second deployment signer.** `deploy/config/earn-roles.json` lists two `DEPLOYER_ROLE` signers for the pool, `0x895d…7AAA` and `0x608d…7c23`, but on Base Sepolia only `0x608d…7c23` holds the role (read Nov 18, 2026). `SL-funder-1/2` and `SL-headroom-1/2` need two different holders, so `0x895d…7AAA` (the owner's choice, Nov 18, 2026, testnet) has to hold the role first: the Clear Lending Safe signs `SL-deployer-1-schedule` (Earn timelock: `LendingPool.grantRole(DEPLOYER_ROLE, 0x895d…7AAA)`, ready now, no dependency on E8x), then `SLx-deployer-1-execute` 7 days later. `0x895d…7AAA` is also listed for `CCO_ROLE` and holds neither, so today only `0x608d…7c23` can stop the lane.

## Owner checklist

These are configuration, never code. Fill them in, then turn the desk on in dry run:

- [ ] The bank partner's and Lithic's settlement cut-off times and zone (`SETTLEMENT_CUTOFF_TIME`, `SETTLEMENT_CUTOFF_TZ`), business days and holidays (`SETTLEMENT_BUSINESS_DAYS`, `SETTLEMENT_HOLIDAYS`), and the clearing-to-settlement lag (`SETTLEMENT_LAG_BUSINESS_DAYS`).
- [ ] Which Lithic financial accounts are the CSA, the Collection Account and the Margin (tokens above), and whether a Collection Account to CSA book transfer is same-day (`SETTLEMENT_BOOK_TRANSFER_SAME_DAY`). The book transfer's subtype from Lithic (`SETTLEMENT_BOOK_TRANSFER_SUBTYPE`).
- [ ] The CSA minimum or reserve the bank requires (`SETTLEMENT_CSA_MINIMUM_USDC`): the buffer's floor.
- [ ] The off-ramp provider, rail and real latency. With Bridge: register the CSA as Clear Lending's external account, create the liquidation address (below), set `SETTLEMENT_OFFRAMP=bridge`, `SETTLEMENT_BRIDGE_CUSTOMER_ID`, `SETTLEMENT_BRIDGE_LIQUIDATION_ADDRESS_ID`, `SETTLEMENT_OFFRAMP_ADDRESS`, `SETTLEMENT_OFFRAMP_RAIL`, `SETTLEMENT_OFFRAMP_LATENCY_MINUTES`.
- [ ] The lane's cap and period, and the Settlement Headroom (the `SL-` steps).
- [x] The desk wallet: create the CDP account `settlement-desk-base-sepolia` (done 2026-11-18: `0x8b8b8643bA33E96E3716F26c631556164C2139eB`), give it a little ETH for gas, set `SETTLEMENT_DESK_WALLET`.

The Bridge liquidation address, created once by a person (the desk never creates or changes it): `POST /v0/customers/{Clear Lending's customer id}/liquidation_addresses` with an `Idempotency-Key` and the body from `liquidationAddressRequest` in `services/settlementFunding/offRampBridge.ts`:

```json
{ "chain": "base", "currency": "usdc", "external_account_id": "<the CSA's Bridge external account>",
  "destination_payment_rail": "wire", "destination_currency": "usd",
  "return_address": "<CL Operating>" }
```

Bridge's documentation (checked Nov 2026 through search; `apidocs.bridge.xyz` itself was not reachable from the build environment, so confirm with Bridge): a wire is sent as soon as the drain is processed, the same business day; ACH is queued and sent once a day; `ach_same_day` is a Bridge transfer rail, but the liquidation address pages found do not say it is accepted there; Bridge's changelog announces 24/7 FedNow payouts, without saying whether a liquidation address can use them; RTP is not mentioned. Until Bridge confirms a faster rail for liquidation addresses, use `wire`. Bridge's sandbox cannot pay a real bank, so Base Sepolia uses the mock off-ramp.

## The Pool Tier principal

`GET /api/command/pool-tier-principal` (Money at See) is the worksheet for the two `VALUATION_ROLE` signers: the outstanding principal of the pool-funded tiers (savings-backed, now a Pool Tier under IV-02 §4.1, income-backed and Clear Boost: `POOL_FUNDED_TIER_KINDS`), the open term plans (Partner Credit and Clear Cash), and Margin Advances not yet restored, beside the posted value and the lane's ceiling (posted principal plus Settlement Headroom). Asset-backed credit stays out (§4.2). Nothing posts it automatically.

## What the alerts mean

Alerts go to `OPS_ALERT_EMAIL`, each sent once (keyed in `ops_alerts`).

| Subject | Meaning | What to do |
|---|---|---|
| Settlement funding needs two deployers and CL Operating's owners: $X | The cut-off needs more than the lane's cap or the forwarder's allowance has left this period (or the lane is not set up), and a two-person Deployment can still cover $X. That one has no Settlement Headroom: $X stops at the posted Pool Tier principal. | The body holds two Transaction Builder batches, also on the move's record: the two-person `deploy(X, ref)` that each `DEPLOYER_ROLE` signer sends, then CL Operating's `USDC.transfer(off-ramp, X)` once it has landed. |
| Settlement funding is $X short for the cut-off at …: the Margin or a person | Neither the Collection Account nor the pool can cover it (a queue request, a Suspension, a pending loss charge, no posted principal, Utilization, or the ceiling: the principal plus the headroom for the lane, the principal alone for two people). | The Savings-Backed Margin covers it at the bank. Record it: `cd apps/api && bun src/scripts/recordSettlementMarginAdvance.ts <dollars> "<your name>" "<note>"`. Or BondVault excess, or the treasury. Never the ESA vault. |
| Settlement funding will land after the cut-off at … | The off-ramp's latency, or a book transfer that is not same-day, puts the money past the cut-off. | The Margin covers the settlement until it lands. Record the advance as above; the surplus restores the Margin first. |
| …the settlement lane is not set up | The pool has no `settlementLane()` yet (before `SLx-upgrade-execute`), the desk wallet is not the lane's funder, the lane is stopped or has no cap, or the forwarder has no allowance, no off-ramp or desk, or pays another address. The body names each. | Finish the `SL` steps. A stopped lane restarts only with `SL-funder-1/2` (two deployers). |
| Settlement funding cannot read the Credit Settlement Account | The CSA's token is not set, or Lithic did not answer. | Set `SETTLEMENT_CSA_FINANCIAL_ACCOUNT_TOKEN`, or check Lithic. Fund the cut-off by hand meanwhile. |
| Settlement funding: … sent to the off-ramp has not arrived | A payout is well past the off-ramp's latency. | Check the drain at Bridge. It still counts as in flight. |
| …idle in the CSA (automatic Returns are off) | Surplus has been idle past the return window. | Send it back by hand within 2 business days: the Margin, then the pool (`returnFunds`), then the BondVault. |
| Settlement funding stopped: … | A dry run or a transaction reverted, a call failed the guard, or a bank or off-ramp payment failed. | See "When it stops". |
| Settlement funding cannot read the chain | Three checks in a row failed to read. | Check the RPC. Fund by hand meanwhile. |

## When it stops

Any revert stops the desk: a dry run (`eth_call` and `estimateGas`) or a mined transaction, a refused guard, a failed book transfer or ACH, or an off-ramp payout that failed. The desk marks the move `failed`, alerts, and moves nothing more until a person clears it.

1. Read the alert and the move (Command Center, or `ops.settlement_funding_moves`).
2. Find the money. If `deploySettlement` landed and `forward` did not, the USDC is in CL Operating: send it to the off-ramp with CL Operating's batch, or leave it there for Clear Lending. The desk does not re-forward a failed move, and it does not know about money sent by hand, so the next run may fund that cut-off again; the surplus then comes back as a Return. If a payout failed, Bridge returns the USDC to CL Operating.
3. Once the cause is understood: `cd apps/api && bun src/scripts/clearSettlementFundingHalt.ts <move id> "<your name>"`.

## Restarts and double funding

Every move is recorded (migration 0081, `ops.settlement_funding_moves`) before its first transaction or bank call, with the cut-off, the ref, the need, the amount, what was left for people, the forwarder's allowance nonce, the block before `deploySettlement`, and each hash and bank token. At most one move per pool is acting at a time (a unique index); moves waiting on the bank or the off-ramp do not block. A run that finds one acting finishes it rather than starting another. After a restart the desk reads how far it got:

- the receipts it recorded;
- the `SettlementDeployed` event for the move's ref, after the recorded block: if it is there, `deploySettlement` happened;
- the forwarder's allowance nonce: past the recorded one, `forward` happened;
- for a Return, the wallet's balance and approval.

Each send carries a CDP idempotency key made from the move and the step, and each book transfer and ACH carries one as its Lithic token, so a send repeated after a crash is the same transaction. One settlement is never funded twice.

## Daily reconciliation

On the first run of each day the desk writes yesterday (`ops.settlement_funding_days`, in the cut-off's zone): the credit authorized and settled, the money funded from the Collection Account and the pool, returned to the Margin and the pool, Margin advanced, and the CSA's balance at the close (the first reading after the day ended). `GET /api/command/settlement-funding` serves the last week of them with the latest check.

## The Command Center

- **Money, Pools, Yield pool, "Card settlement funding"**, in the automatic top-ups card's style, from what the desk recorded (never the chain on page load):
  - the next cut-off and what is due at it (through Monday on a Friday), the CSA's balance and the buffer, what is on its way, and what is still needed by the forced run;
  - today's netting as far as it is recorded: the Collection Account's balance and what was booked from it to the CSA today, beside the card credit due. Collections and new draws are not matched one against the other; members' repayments in the Collection Account net against the draws by book transfer, and the pool funds only the rest;
  - Settlement Funding sent and returned today and over the reconciled days;
  - the funder's period limit used, and the Settlement Headroom used;
  - each recent move with its transactions.

  It shows what needs a person on top: **stopped** (the move, why, and the clear-halt command), **lane not set up** (what is missing, before the `SL` steps), **over the limit** (the two remainder batches, to download), or **short** (the shortfall, why the pool cannot give more, and the manual options in order). With no check recorded yet, the card says what it needs.
- **Beside it, "Pool Tier principal"**: the posted value and the worksheet's figure, marked "suggested — the valuation signers post it", with each tier, the term plans, the Margin Advances, the Deployed Balance and the lane's ceiling. Read when the pane opens; read-only.
- **Build, Security, "Automatic jobs"**: settlement funding is one row among the API's jobs (payout top-ups, the Assurance fee payer, the payout funding keeper): the desk wallet, the lane's limit per period and how much is used, its last check, and how it is stopped (`SETTLEMENT_FUNDING_ENABLED`, or `stopSettlementFunder()` on the Yield Pool). It reads "Not on yet" until the switch is set, then whether it ran, in dry run, stopped (a failed move, or stopped on chain) or waiting for the lane.
- **Build, Signing**: the `SA`, `SR` and `SL` stages appear by name (State attester, Credit by state, Settlement lane) in the signing plan.

## Not automated yet

- **Posting the Pool Tier principal.** The worksheet suggests it; the two `VALUATION_ROLE` signers post it.
- **The BondVault's share of a Return, and BondVault excess as a source.** By people, through the Collateral Agent, where its documents allow.
- **Margin advances.** The bank's Margin covers a shortfall without the desk knowing; a person records each with `recordSettlementMarginAdvance.ts` so the principal and the Returns include it.
- **Money moved by hand.** The desk does not see a Deployment or forward sent by people; the next run may fund the same cut-off again, and the surplus then comes back as a Return.
- **A faster rail.** The off-ramp uses `wire` until Bridge confirms a faster rail for liquidation addresses (see above); on Base Sepolia the off-ramp is the mock.

## Railway variables (the API)

Turn it on in dry run first, and watch a few cut-offs' checks before turning the dry run off.

| Variable | Default | |
|---|---|---|
| `SETTLEMENT_FUNDING_ENABLED` | off | `1` turns the desk on. |
| `SETTLEMENT_FUNDING_DRY_RUN` | off | `1`: decide, record, log; send nothing. |
| `SETTLEMENT_RETURNS_ENABLED` | off | `1` turns the Returns on. |
| `SETTLEMENT_DESK_WALLET` | (required) | The desk wallet's address. The desk refuses to send from any other. |
| `SETTLEMENT_DESK_CDP_ACCOUNT_NAME` | `settlement-desk-base-sepolia` on 84532 | Looked up, never created. CDP credentials are the relayers'. |
| `SETTLEMENT_FORWARDER` | (required) | The SettlementForwarder. |
| `SETTLEMENT_OFFRAMP_ADDRESS` | (required) | The off-ramp deposit address; must equal the forwarder's. |
| `SETTLEMENT_SAFE`, `SETTLEMENT_ALLOWANCE_MODULE` | CL Operating on 84532; `0xAA46…091C` | |
| `SETTLEMENT_OFFRAMP` | `mock` on 84532, else `bridge` | |
| `SETTLEMENT_BRIDGE_CUSTOMER_ID`, `SETTLEMENT_BRIDGE_LIQUIDATION_ADDRESS_ID` | | For `bridge`. |
| `SETTLEMENT_OFFRAMP_RAIL` | `wire` | |
| `SETTLEMENT_OFFRAMP_LATENCY_MINUTES` | 240 | The measured latency replaces it when longer. |
| `SETTLEMENT_OFFRAMP_SETTLE_MINUTES` | 60 | |
| `SETTLEMENT_BANK` | `lithic` | `mock` with `SETTLEMENT_MOCK_CSA_USDC`, `SETTLEMENT_MOCK_COLLECTION_USDC`. |
| `SETTLEMENT_CSA_FINANCIAL_ACCOUNT_TOKEN` | (required to fund) | |
| `SETTLEMENT_COLLECTION_FINANCIAL_ACCOUNT_TOKEN` | `LITHIC_AUTO_CLEAR_SETTLEMENT_ACCOUNT_TOKEN` | |
| `SETTLEMENT_MARGIN_FINANCIAL_ACCOUNT_TOKEN`, `SETTLEMENT_ONRAMP_EXTERNAL_BANK_ACCOUNT_TOKEN` | unset | For automatic Returns. |
| `SETTLEMENT_BOOK_TRANSFER_CATEGORY`, `_TYPE`, `_SUBTYPE`, `_SAME_DAY` | `PROGRAM_FUNDING`, `TRANSFER`, none, off | From Lithic. |
| `SETTLEMENT_CUTOFF_TIME`, `SETTLEMENT_CUTOFF_TZ` | `14:00`, `America/New_York` | Placeholders until the owner fills them in. |
| `SETTLEMENT_BUSINESS_DAYS`, `SETTLEMENT_HOLIDAYS`, `SETTLEMENT_LAG_BUSINESS_DAYS` | `1,2,3,4,5`, none, 0 | |
| `SETTLEMENT_BUFFER_USDC`, `SETTLEMENT_CSA_MINIMUM_USDC`, `SETTLEMENT_COLLECTION_RESERVE_USDC` | 1000, 0, 0 | Dollars. |
| `SETTLEMENT_MIN_MOVE_USDC`, `SETTLEMENT_FUNDING_CAP_USDC` | 10, unset | Dollars. |
| `SETTLEMENT_FUNDING_CHECK_MINUTES`, `SETTLEMENT_FORCED_MARGIN_MINUTES`, `SETTLEMENT_FUNDING_WINDOW_MINUTES` | 15, 60, 180 | |
| `SETTLEMENT_RETURN_IDLE_HOURS`, `SETTLEMENT_RETURN_BUSINESS_DAYS` | 24, 2 | At most 2 business days. |
| `SETTLEMENT_ROLLOVER_PENDING_SHARE`, `SETTLEMENT_VELOCITY_DAYS` | 1, 7 | |
| `SETTLEMENT_FUNDING_DEBUG` | unset | `1` logs each check's figures. |
| `POOL_FUNDED_TIER_KINDS` | `SAVINGS,INCOME,BOOST` | For the Pool Tier principal helper. |
| `OPS_ALERT_EMAIL`, `DATABASE_URL`, `PAY_DATABASE_URL`, `LITHIC_API_KEY` | | As for the other jobs. |

The Yield Pool is `LENDING_POOL_<chainId>`, or the default in `apps/api/src/config/contracts.ts`. USDC is the pool's `asset()`. Every fragment the desk uses is in `apps/api/src/services/settlementFunding/abi.ts`: the lane's one view, `settlementLane()` (funder, cap per period, period, the period's start and use with its rollover applied, stopped, the stop count, the Settlement Headroom), `deploySettlement`, `pendingLossCharge()` and the pool's other views, and the forwarder's `forward`, `safe`, `allowanceModule`, `token`, `offRamp` and `desk`. `abi.test.ts` checks them against the compiled contracts and the deployed pool's record. A pool from before the `SL` upgrade reverts on `settlementLane()`, and the desk reads that as "lane not set up" and sends nothing.
