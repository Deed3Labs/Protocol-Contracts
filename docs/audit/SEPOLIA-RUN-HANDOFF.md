# Base Sepolia rollout: handoff for the owner's local session

This is the brief for the Claude Code session on the owner's Mac, which runs the real Base Sepolia rollout. The owner approved the run on Nov 16, 2026. Everything here has been rehearsed on a fork of Base Sepolia (`docs/audit/SEPOLIA-REHEARSAL.md`) except step I1, which has a review stop of its own.

You (the local session) send the deployer's transactions with `DEPLOYER_PRIVATE_KEY` from this machine's environment. The owner signs every other step themselves, in MetaMask on the signing page or in the Safe app. You never sign for them.

## Ground rules

1. **Base Sepolia only.** Every command uses `--network base-sepolia` (chain 84532). Never `base`, never mainnet. If anything points at chain 8453, stop.
2. **The key stays private.** Never print, echo, log, commit or paste `DEPLOYER_PRIVATE_KEY` or any other key. Show addresses only.
3. **Stop on the unexpected.** If a step fails, reverts, or prints something other than the expected result, stop. Do not retry a step that sent transactions until you have read the chain to see what it already did; most scripts are safe to re-run because they skip what is done, but check first. Tell the owner exactly what happened.
4. **SIGN steps are the owner's.** At each `SIGN` stop, run the signing plan, tell the owner which cards are ready and which MetaMask account signs each, and wait until they say they are done. Then re-run the plan and confirm those steps show `done` before going on.
5. **Keep a log.** Save each command's full output to `deployments/base-sepolia/run-log/<step>.log` (create the folder). Logs must not contain keys.
6. **Do not change scripts or contracts during the run.** If one looks wrong, stop and report.

## Setup (read-only)

```bash
cd <your Protocol-Contracts checkout>
git fetch origin
git checkout claude/new-session-e5u3cp
git pull --no-rebase origin claude/new-session-e5u3cp
```

```bash
npm ci
```

Node 22. Use a reliable RPC: set `BASE_SEPOLIA_RPC_URL` (for example the project's Alchemy Base Sepolia URL). The public `sepolia.base.org` allows only 25 requests a second and can fail partway through a long script.

Check the key without showing it. This must print `0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA`:

```bash
node -e 'const {Wallet}=require("ethers");console.log(new Wallet(process.env.DEPLOYER_PRIVATE_KEY).address)'
```

Load the rollout settings (addresses only) and compile:

```bash
set -a; . deploy/config/base-sepolia.rollout.env; set +a; N=base-sepolia
```

```bash
npx hardhat compile
```

`STATE_ATTESTER_KEY` is unset on purpose. Every other input the scripts ask for is in the rollout file. If a script says an input is missing, stop and report.

### Preflight: the Clear Lending Safe and the Assurance inputs (read-only)

```bash
npx hardhat run scripts/check_rollout_inputs.ts --network $N
```

It sends nothing. It must exit 0 with no FAIL. It checks that:

- the five new inputs are set: `ASSURANCE_CL_FEES_PAYER`, `ASSURANCE_DISBURSEMENT` (the two CDP wallets), `ASSURANCE_DRAW_ADDRESS`, `ASSURANCE_LOSS_RESERVE`, and `CLEAR_LENDING_SAFE`, with `CLEAR_LENDING_ACCOUNT` and `LENDER_OPERATING` equal to `ASSURANCE_DRAW_ADDRESS` (CL Operating);
- the Clear Lending Safe `0xAE8F…419d` has code and needs 2 signatures, and is not the Clear Treasury Safe;
- CL Operating `0xfAFf…df65` and CL Loss Reserve `0xb425…6bAa` have code, need 1 signature, and their only owner is the Clear Lending Safe;
- the two CDP wallets are plain accounts;
- nothing the Assurance Pool would refuse: none is an Assurance signer, a payer is not the draw address, and the five differ.

If the two CDP wallets are still empty, stop: the owner creates them first (`SEPOLIA-OWNER-CHECKLIST.md` step 1). `scripts/signing_plan.ts` also refuses to run while they are empty.

## Day 0

The expected result of each step is in the table under "Steps, in order" in `docs/audit/SEPOLIA-REHEARSAL.md`.

### A, B: read-only baseline

```bash
CHECK_BASELINE=1 npx hardhat run scripts/check_retired_credit.ts --network $N
```

Expected: exit 1, with 11 FAIL and 1 WARN. That is the "before" picture.

```bash
npx hardhat run scripts/unwind_legacy_bonds.ts --network $N
```

Expected: no pre-2f bond outstanding. If one is outstanding, stop.

### C1: the vault upgrade

```bash
npx hardhat run scripts/upgrade_vault.ts --network $N
```

```bash
PREPARE_VAULT_IMPL=1 npx hardhat run scripts/upgrade_vault.ts --network $N
```

Take the implementation address that step prints, then:

```bash
VAULT_IMPL=<printed address> npx hardhat run scripts/migrate_vault_clrusd.ts --network $N
```

```bash
npx hardhat run scripts/signing_plan.ts --network $N
```

**SIGN (C1d):** AAA sends the vault upgrade calls in order, on the signing page. Wait for the owner, then re-run the plan and confirm C1d is done.

### C2 to C4: ClearUSD, ClaimEscrow, the SavingsIntentFactory

```bash
CONTRACT_NAME=ClearUSDUpgradeable PROXY_ADDRESS=0x2a116Bead17dd96DC5c560A0d76b02eb2D7aD6D1 npx hardhat run deploy/upgrade/checkUpgrade.ts --network $N
```

```bash
CONTRACT_NAME=ClearUSDUpgradeable PROXY_ADDRESS=0x2a116Bead17dd96DC5c560A0d76b02eb2D7aD6D1 npx hardhat run deploy/upgrade/upgradeContract.ts --network $N
```

```bash
CONTRACT_NAME=ClaimEscrow PROXY_ADDRESS=0x24DAE7b66dC31657265260B5d9092280B57Bc37D npx hardhat run deploy/upgrade/checkUpgrade.ts --network $N
```

```bash
CONTRACT_NAME=ClaimEscrow PROXY_ADDRESS=0x24DAE7b66dC31657265260B5d9092280B57Bc37D npx hardhat run deploy/upgrade/upgradeContract.ts --network $N
```

```bash
npx hardhat run deploy/19_deploy_SavingsIntentFactory.ts --network $N
```

### D: the fresh credit stack

```bash
npx hardhat run deploy/retire_credit_stack.ts --network $N
```

```bash
RETIRE_CREDIT_STACK=1 npx hardhat run deploy/retire_credit_stack.ts --network $N
```

```bash
npx hardhat run deploy/16_deploy_AccessManager.ts --network $N
```

```bash
npx hardhat run deploy/18_configure_AccessManagerMembershipRegistry.ts --network $N
```

```bash
npx hardhat run deploy/20_deploy_CreditCore.ts --network $N
```

```bash
npx hardhat run deploy/21_deploy_ClearUSDUpgradeable.ts --network $N
```

### E: Earn, the Yield Pool and BondVault upgrades, bonds

```bash
npx hardhat run deploy/26_deploy_EarnControls.ts --network $N
```

```bash
npx hardhat run scripts/upgrade_yield_pool.ts --network $N
```

```bash
YIELD_POOL_UPGRADE=1 npx hardhat run scripts/upgrade_yield_pool.ts --network $N
```

```bash
VAULT_UPGRADE_DRY_RUN=1 npx hardhat run scripts/upgrade_bond_vault_pledge_guard.ts --network $N
```

```bash
npx hardhat run scripts/upgrade_bond_vault_pledge_guard.ts --network $N
```

```bash
REPLACE_BOND_FACTORY=1 npx hardhat run deploy/22_deploy_BondsAndPool.ts --network $N
```

```bash
npx hardhat run deploy/23_deploy_BondCollection.ts --network $N
```

```bash
npx hardhat run deploy/27_wire_Earn.ts --network $N
```

```bash
npx hardhat run scripts/signing_plan.ts --network $N
```

**SIGN (D4, E8, E9, HOLD_ROLE):**

- **D4 and HOLD_ROLE:** AAA grants the credit roles, the credit operator (`0x8801…1edd`) and the two hold keys.
- **E8 and E9:** for each of the five Collateral Agent changes, Account 3 proposes, Account 4 confirms, and `…698a` (the Agent Key) approves.

The confirm and approve cards only become ready after the proposal, so re-run the plan between rounds. Then the **Clear Lending Safe** (`0xAE8F…419d`, 2 of 2: AAA and `…698a`) signs the Earn timelock schedule batch (`E8-earn-schedule`) in the Safe app; the page can download that batch file. Open that Safe in the Safe app, not the Clear Treasury Safe.

Everything in D4 and HOLD_ROLE must be done before the credit handover (I2): after it, those grants take 7 days.

### F2 and the Pool Tier

```bash
npx hardhat run deploy/25_wire_Compliance.ts --network $N
```

```bash
npx hardhat run scripts/signing_plan.ts --network $N
```

**SIGN (F2, Pool Tier):**

- **F2:** the second credit-settings signer approves the fee recipient.
- **Pool Tier:** Account 4 and `…698a` each post it ($100,000).

### H1, G3: the Assurance Pool and Earn controls

```bash
ASSURANCE_DEPLOY=1 npx hardhat run deploy/08_deploy_AssurancePool.ts --network $N
```

```bash
npx hardhat run deploy/26_deploy_EarnControls.ts --network $N
```

```bash
npx hardhat run scripts/signing_plan.ts --network $N
```

**SIGN (Assurance):** the pool's setup goes through its own governance. Five calls: `setPayer(CL fees wallet, 3)` (credit enhancement fee, recovery), `setPayer(Clear Treasury Safe, 12)` (interchange, board allocation), `setLendingCoAddresses(CL Operating, CL Loss Reserve)`, `setAssuranceDisbursementAddress(disbursement wallet)` and `setExposureSources([CollateralRegistry])`.

- **Approvals (`AS-…-approve-1`, `AS-…-approve-2`):** for each call, Account 3 sends `approveAction` on the signing page, then Account 4 sends the same. The pool takes either order; the plan asks Account 3 first, so re-run it after Account 3's five.
- **Schedule (`AS-assurance-schedule`):** once all ten approvals show done, the **Clear Treasury (board) Safe** `0x52e6…cf50` signs the Assurance timelock batch in the Safe app. Today it needs one signature; after the Safe change below, two.

Floor, transfer delay and allocation stay at the pool's defaults (5% floor, 14 days, 50/50). Nothing else is needed for deposits.

**SIGN (floor inputs, `AS-floor-1`, `AS-floor-2`):** Account 3 then Account 4 each send `setFloorInputs` with the same figures, a $10,000 coverage cap, $0 timing shortfall, $0 attested covered book and the placeholder evidence (`ASSURANCE_*` in the rollout file). No timelock: it applies when Account 4's call lands. Without it the coverage cap is $0 and every backstop draw is refused; deposits and member grants do not need it. It is re-posted each month.

### I1: move the deployer's day-to-day roles to the API's wallets (REVIEW STOP)

This step was not part of the fork rehearsal, so it has a review stop. First the dry run, which is read-only and needs no key:

```bash
DEPLOYER=0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA npx hardhat run scripts/command/ops-roles.ts --network $N
```

**STOP.** Give the owner the full output to paste into the cloud session for review. Expected: each role goes to its job's wallet.

| Job | Wallet | Roles |
|---|---|---|
| Credit operator | `0x8801…1edd` | AccessManager operator, MembershipRegistry registrar |
| Savings and send relayer | `0x6Cbd…Fcb3`, one CDP wallet | the vault's RELAYER_ROLE, SavingsIntentFactory SETTLER_ROLE, CollateralRegistry OPERATOR_ROLE, ClaimEscrow SETTLER_ROLE |
| The Clear Treasury Safe | `0x52e6…cf50` | the config roles |

Anything marked "renounce" is given up by the deployer. Only after the owner says the review passed, run:

```bash
MODE=run CONFIRM=ops-roles DEPLOYER=0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA npx hardhat run scripts/command/ops-roles.ts --network $N
```

### I5, the Clear Treasury Safe, the handovers

```bash
npx hardhat run scripts/check_retired_credit.ts --network $N
```

Expected: one FAIL, the backstop, which clears on day 7. Plus WARNs marked test money.

```bash
npx hardhat run scripts/signing_plan.ts --network $N
```

**SIGN (the Clear Treasury Safe):** in the Safe app, the owner signs the batch `addOwnerWithThreshold(0x558D4318071EBC15e7ED13d8e880Dc1D17A7698a, 2)` on `0x52e6…cf50`. It needs one signature for this one, since it is still 1 of 3. Confirm on chain that it now shows 2 of 4 before going on. The Clear Lending Safe is already 2 of 2 and needs no change.

```bash
CREDIT_HANDOVER=1 npx hardhat run deploy/credit_timelock_handover.ts --network $N
```

```bash
VAULT_HANDOVER=1 npx hardhat run deploy/vault_timelock_handover.ts --network $N
```

```bash
npx hardhat run scripts/signing_plan.ts --network $N
```

**SIGN (I3):** the Clear Treasury Safe schedules the vault timelock batch. It now takes two owners: AAA and `…698a`.

```bash
EARN_HANDOVER=1 npx hardhat run deploy/earn_timelock_handover.ts --network $N
```

It checks the Clear Lending Safe (`CLEAR_LENDING_SAFE`) needs two signatures, and prints `Clear Lending Safe 0xAE8F…419d: 2 of 2`.

### End of day 0

1. Run the gate:

   ```bash
   npx hardhat run scripts/check_retired_credit.ts --network $N
   ```

   Expected on Base Sepolia (decision 52): **exit 0**. The backstop to the retired PayoutPool shows as a WARN that names the Earn timelock operation clearing it and when it may run; the WARNs for test money (decision 50) stay. First re-run `npx hardhat run scripts/signing_plan.ts --network $N`, since the gate reads the Earn batch from the plan file. Any FAIL: stop and report. Report the output to the owner: an exit 0 is the day-0 go-live signal (Railway Phase 2, then the app address update and the held app PRs).
2. Commit what the run wrote, records only and no keys, on `claude/new-session-e5u3cp`, then push:
   - `deployments/base-sepolia/` (not the git-ignored plan files);
   - `.openzeppelin/base-sepolia.json`;
   - `deployments/base-sepolia/run-log/`.

   Start the subject with `[skip preview]`.
3. Tell the owner the day-7 date and time, from the plan's "waits until" lines (the Earn, vault and Assurance timelocks each give one).

## Day 7

```bash
npx hardhat run scripts/signing_plan.ts --network $N
```

**SIGN (Day 7):** in the Safe app, three batches, each needing two owners (AAA and `…698a`):

- `E8x-earn-execute`: the **Clear Lending Safe** executes the Earn timelock batch. This applies the five Collateral Agent changes; their own 7-day wait, built into the Collateral Agent, ends at the same time.
- `I3x-vault-execute`: the **Clear Treasury Safe** executes the vault timelock batch.
- `ASx-assurance-execute`: the **Clear Treasury (board) Safe** executes the Assurance timelock batch. Its 7 days started at its own schedule (after H1), so it may be ready a little later than the other two; the plan's "waits until" line says when.

Re-run the plan; every step must show `done`.

Run the final checks. Each must exit 0:

```bash
npx hardhat run scripts/check_retired_credit.ts --network $N
```

```bash
DEPLOYER=0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA npx hardhat run scripts/check_sepolia_wiring.ts --network $N
```

```bash
npx hardhat run scripts/check_payout_funding.ts --network $N
```

Commit and push the records again, and give the owner the three outputs. The cloud session then updates the apps' contract addresses (runbook §4.2), and the held app PRs follow. After the deploy, set `OPS_ALERT_EMAIL=ops@useclear.org` and `PAYOUT_KEEPER_ENABLED=1` on the API in Railway.
