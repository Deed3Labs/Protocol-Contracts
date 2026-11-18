# Chain keepers

Some contract upkeep happens only when someone calls a function. Clear's contracts leave these calls open to anyone: the contract decides whether the call does anything, and the caller only pays the gas. The API runs keepers that make these calls on time, so members' and holders' positions move without a person (decision 53, item 1).

Every keeper here:

- **calls only permissionless functions.** None needs a role, a Safe signature or a deploy.
- **pays gas from the card settler's key** (`CARD_SETTLER_PRIVATE_KEY`). No keeper has a key of its own. At startup the API logs the address as `[wallets] chain keepers: 0x…`, next to `card settler`, so you know which wallet needs Base Sepolia ETH.
- **simulates every call first** (an `eth_call` from that wallet) and sends it only if the simulation succeeds. When a contract refuses a call under one of its own rules (a hold, a pause, nothing due), the keeper counts it as not due. Any other revert, or an RPC it cannot reach, counts as a failure. Failures are logged and alerted, and the next run tries again.
- **reads the chain to decide what is due.** No local state can cause a second send, so a rerun or a restart repeats nothing. Each run has a cap, takes the most overdue first, and leaves the rest for the next run. Two runs never overlap. Keeper sends from the key go one at a time, and each is mined before the next is sent.
- **has a dry run.** With `<NAME>_DRY_RUN=1` the keeper still simulates. It logs and alerts what it would send, at most once a day for each call, and sends nothing.
- **checks the members on record** (`members.primary_wallet` in the members database). Members pledge from that wallet with their own signature, so their positions are there. No keeper scans logs.

Alerts go to `OPS_ALERT_EMAIL` through `alertOps`, which dedupes them by key.

## The keepers

| Keeper | Switch | Interval | Sends | When |
|---|---|---|---|---|
| Cycle | `CYCLE_KEEPER_ENABLED`: **on unless `0`** | hourly | `RevolvingIssuer.syncCreditPeriod(member)` | The member's cycle end has passed (`creditPeriods.expiration`). For a line frozen at a second miss, only once its next cycle end passes (`cycleStateOf.cycleEnd`), which records that cycle's statement |
| Default | `CREDIT_DEFAULT_KEEPER_ENABLED`: off unless `1` | hourly, in the cycle keeper's run | `RevolvingIssuer.triggerDefault(member)` | `inDefault(member)` is true. The issuer computes this from two missed cycles, the two-person cure-notice timestamp, and the grace ending, with no pause or Income Assurance in force |
| Shortfall notice | `ENFORCEMENT_KEEPER_ENABLED`: **on unless `0`** | hourly | `Liquidator.noticeShortfall(member)` | The Asset-Backed Drawn is above the limit (`shortfallOf` gap) with no notice open. The same call clears a notice once the gap has closed |
| Pool shares | `POOL_ENFORCE_KEEPER_ENABLED`: off unless `1` | hourly | `PoolShareEnforcer.settle(holder)`, `cancelExcess(holder, requestId)`, `enforce(holder)` | `settle`: the queue has paid some of the holder's enforcement request (`enforcementFilledOf` above the enforcer's `settledShares` / `settledPaid`). `cancelExcess`: more is queued than `valueNeeded` now asks for. `enforce`: `sharesNeeded(holder)` is above zero |
| Bonds | `BOND_PLEDGE_KEEPER_ENABLED`: off unless `1` | hourly, in the pool shares keeper's run | `BurnerBond.payPledged(bondId)` | The Liquidator's `nextBondOf(holder)` names a bond, and `pledgePaymentDue(holder, bondId)` says it is due. One bond per holder per run, because each payment is measured again before the next |
| Queue | `QUEUE_FILL_KEEPER_ENABLED`: off unless `1` | every 15 minutes (`QUEUE_FILL_KEEPER_MINUTES`) | `LendingPool.fillQueue(maxCount)` | Shares are queued, Vault Cash is above zero, the pool is not suspended, no Pool Loss Charge is pending, and the simulation would fill at least one request |

The cycle and shortfall notice keepers have run since Phase 2b whenever the API had the card settler key. They stay on by default, so adding the switches did not turn them off. Every new keeper is off until its switch is set.

### Caps per run

| Variable | Default |
|---|---|
| `CYCLE_KEEPER_MAX_PER_RUN` | 50 calls: syncs and defaults together, oldest due first |
| `ENFORCEMENT_KEEPER_MAX_PER_RUN` | 25 notices |
| `POOL_ENFORCE_KEEPER_MAX_PER_RUN` | 25 calls: settle, cancelExcess and enforce together |
| `BOND_PLEDGE_KEEPER_MAX_PER_RUN` | 25 bonds |
| `QUEUE_FILL_KEEPER_MAX_COUNT` | 25 queue requests looked at in one `fillQueue` call |

## Credit: cycles and defaults

The day-0 RevolvingIssuer judges cycles on the calendar (Phase 2e). Each cycle ends at 23:59:59 Pacific on the member's Cycle End Day. The issuer keeps `creditPeriods(member).expiration` at the next cycle end, or at a held close's due point under a 10c pause, with no grace period. One `syncCreditPeriod` judges every cycle end that has passed and rolls the period forward, so the next run skips the member.

What the keeper reads from the receipt:

- **A Clean Cycle.** It is logged.
- **A first miss** (`UnsecuredLimitHalved`). The member gets a notification: "Your cycle closed with a balance."
- **A second miss in a row.** The issuer sets a cure amount and the line stays frozen. The member gets a notification: "Your line is paused: two cycles missed". Ops get an alert, because default can only be computed after a cure-notice timestamp. Two different `ATTESTER_ROLE` signers record it with `proposeCureNotice` and then `approveCureNotice`, if Clear decides to send the notice.

`triggerDefault` is sent only when the issuer itself reports `inDefault`. With its switch off, a member in computed default is left alone completely: the keeper does not sync them either, because a sync would record the default too. Each default sent alerts ops with the member, what was drawn on the line just before the write-off, and the transaction.

## Enforcement: pledged pool shares and bonds

The order between pool shares and bonds is the contracts' own. On a default, pledged bonds come first (decision 10): `sharesNeeded` deducts what the bonds will pay, and `pledgePaymentDue` asks for a bond while the queued pool shares will not cover the debt. On a shortfall past its wait, pool shares come first (decision 21): `pledgePaymentDue` asks for a bond only when the shortfall is larger than all the pledged pool shares could close. The keeper never picks an amount or a bond.

For each member, a run goes in this order:

1. `settle` if the queue has paid anything new.
2. `cancelExcess` for each queued enforcement request beyond what is needed. Requests are found by reading the pool's queue from `queueHead`, up to 2,000 entries a run.
3. `enforce` if shares are needed.
4. `payPledged` for the next bond, if the Liquidator asks for it.

Each step is simulated again just before it is sent. The queue keeper's `fillQueue` pays the enforcement request, and the next run's `settle` hands the proceeds to the Liquidator. The Liquidator applies them and pays any surplus to the Holder.

**Never while a Liquidation Hold or a 10c pause is in force.** The keeper reads `Liquidator.holdOf(member)` and the pause clock's `inForce(member)` first. If either is in force it leaves the member wholly alone, including handing back excess shares. The contracts refuse those calls anyway (`PoolShareEnforcerBlocked`, `LiquidatorOnHold`, `LiquidatorPauseInForce`). While the Collateral Agent's Enforcement Notice is in force, `payPledged` reverts (`BondVaultEnforcementInForce`) and bonds are paid only through the Agent's rounds. The keeper counts that as not due.

Every send alerts ops with the member, what moved (shares and their value, the dollars applied, or the bond and its Accreted Value with the split between debt and Holder) and the transaction hash.

Before it starts, the pool shares keeper checks that `POOL_SHARE_ENFORCER_84532`, `LENDING_POOL_84532` and `BURNER_BOND_84532` are the addresses the Liquidator itself uses (`poolShareEnforcer()`, `earnPool()`, `earnBonds()`). If they are not, it logs why and does not start.

The shortfall notice keeper still sends one alert a day once a notice's wait has passed. The alert says whether the pledge keepers are on. If they are not, the settlement has to be done by hand.

## Turning them on

On Railway (API service), dry run first:

```text
CREDIT_DEFAULT_KEEPER_ENABLED=1
CREDIT_DEFAULT_KEEPER_DRY_RUN=1
POOL_ENFORCE_KEEPER_ENABLED=1
POOL_ENFORCE_KEEPER_DRY_RUN=1
BOND_PLEDGE_KEEPER_ENABLED=1
BOND_PLEDGE_KEEPER_DRY_RUN=1
QUEUE_FILL_KEEPER_ENABLED=1
QUEUE_FILL_KEEPER_DRY_RUN=1
```

Read the startup lines (`[cycle-keeper] started (hourly; syncCreditPeriod on, triggerDefault dry run)`, `[pledge-keepers] started (…)`, `[queue-fill] started (…)`), then the dry-run lines and alerts. When they show what you expect, remove the `_DRY_RUN` variable for that keeper. `POOL_SHARE_ENFORCER_84532` defaults to `deployments/base-sepolia/PoolShareEnforcer.json` (`0xEB6f2c654d078Df56D78946767d5A43307eb4fa1`). Set it explicitly only if you set the other `*_84532` addresses explicitly too.

Make sure the card settler wallet holds Base Sepolia ETH for gas.

## Stopping one

Set its `_ENABLED` to `0` (or remove it) and redeploy. A run in progress finishes the call it is on, and nothing else is sent. For the cycle and shortfall notice keepers, `0` is the only way to stop them, because they are on when unset. Setting `_DRY_RUN=1` instead keeps the reports coming without sending anything.

## Code

- `apps/api/src/services/chain/keeperKit.ts`: the switches, simulate then send, the send lock.
- `apps/api/src/services/chain/cycleKeeper.ts` and `jobs/cycleKeeper.ts`: cycles and defaults.
- `apps/api/src/services/chain/enforcement.ts` and `jobs/enforcementKeeper.ts`: shortfall notices, and the Liquidation Hold tooling for Command.
- `apps/api/src/services/chain/pledgeEnforcement.ts` and `jobs/pledgeKeeper.ts`: pool shares and bonds.
- `apps/api/src/services/chain/queueFill.ts` and `jobs/queueFillKeeper.ts`: the Yield Pool's queue.
- The contracts' refusals and the sentences an operator sees for them: `describeKeeperRefusal` in `apps/api/src/services/chain/chainErrors.ts`.
