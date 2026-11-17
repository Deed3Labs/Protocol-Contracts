# Signing page

One page for the Base Sepolia rollout's co-signer steps: the calls that people send from their own MetaMask accounts, not the deployer's script runs. It shows each step in plain words and sends the one you choose with one click. It only works on Base Sepolia (and a local test chain), and it holds no key: MetaMask signs.

`index.html` is the whole page: no build step, no outside scripts, fonts or requests. It never encodes a call; the plan already carries each call's exact data.

## How the owner uses it

1. **Make the plan** (the repository root, any terminal; it only reads the chain):

   ```bash
   npx hardhat run scripts/signing_plan.ts --network base-sepolia
   ```

   It writes `deployments/base-sepolia/signing-plan.json`, and a Safe Transaction Builder file `deployments/base-sepolia/safe-batches/signing-<step>.json` for each Safe step that is ready. It prints each step as `READY`, `WAITING` (with the reason) or `DONE`.

2. **Open the page** in the browser that has MetaMask. MetaMask does not work on a page opened as a file, so serve it on your own computer:

   ```bash
   python3 -m http.server 8080 --bind 127.0.0.1
   ```

   from the repository root, then open
   [http://localhost:8080/tools/signing-page/?plan=../../deployments/base-sepolia/signing-plan.json](http://localhost:8080/tools/signing-page/?plan=../../deployments/base-sepolia/signing-plan.json).
   (Or serve only this folder, `cd tools/signing-page && python3 -m http.server 8080 --bind 127.0.0.1`, open http://localhost:8080 and drop the plan file on the page.)

   The heading says "Base Sepolia rollout" with a "Base Sepolia · test money only" tag. The page refuses a plan for any other chain, a plan changed after the script wrote it, and a `?plan=` on another site.

   The page follows Command Center's Build, Signing tab: the **signing run** (one column per stage, done / ready / waiting counts, the block the plan was read at and its fingerprint), the **steps** list, **your wallet**, and a side panel with each step's detail. Click a stage to show only its steps (click it again to show all).

3. **Connect MetaMask.** The page asks MetaMask to switch to Base Sepolia (and to add it if it is missing). The list then shows "Ready for this wallet": the ready steps the connected account signs. Switch accounts in MetaMask and the page follows.

4. **Sign the ready steps.** Click a step: the panel says who signs, which contract, the function, its arguments and the exact call data. "Sign and send" works only when MetaMask is on the account the step names and on the plan's network; otherwise the panel says which account to switch to. MetaMask shows the call for you to confirm, then the panel shows the transaction with a link to sepolia.basescan.org and whether it succeeded. Each signer needs a little Base Sepolia ETH for gas.

5. **Safe steps** (marked "Safe batch", chip "In the Safe app") are not sent from this page. In the step's panel, "Download batch file" saves the step's call as a Transaction Builder batch (the script also writes it next to the plan), and "Open in the Safe app" opens app.safe.global's Transaction Builder for that Safe on Base Sepolia: drop the file in and sign there. The page cannot see the Safe's queue, so the step stays "Ready" until the chain shows it done. Today the Safe needs one signature (the deployer's MetaMask account); after the step that adds the second MetaMask owner (`addOwnerWithThreshold(…698a, 2)`), every Safe transaction needs both.

6. **Re-run the plan script after each stage, then press "Read the chain again".** When the page was opened with `?plan=`, it reads the plan file again (and checks its chain and fingerprint again), then reads the receipt of every step you sent through MetaMask: confirmed steps turn done, failed ones say so. A step that waited only for steps now done opens straight away when its call is already in the plan; one whose call needs a value from an earlier step (a change's confirmation needs the change number from its proposal) says to re-run the plan script. Opened from a file, load the new plan with "Load a plan". The page remembers what this browser sent, per plan.

## The order

The plan lists the steps in the rollout's order (docs/audit/SEPOLIA-REHEARSAL.md, "The real run"):

| Stage | Who | What |
|---|---|---|
| C1d | the deployer (VAULT_ADMIN) | the savings vault's upgrade batch, call by call, once C1c has written it |
| D4 | the deployer | the credit settings and credit attester roles (two each), the credit operator |
| E8, E9 | treasury signer 1, treasury signer 2, the Agent Key | propose, confirm and approve each Collateral Agent change and the BondVault backstop |
| E8 | the deployer | the Liquidator's hold role (two), before the credit handover (I2) |
| E8 | Clear Lending Safe (its own Safe, 2 of 2) | schedule the changes on the Earn timelock (Safe batch) |
| F2 | credit settings signer 2 | approve the fee recipient deploy 25 proposed |
| Pool Tier | both valuation signers | post the Pool Tier principal |
| Safe | the Clear Treasury Safe | add the second MetaMask owner and require 2 signatures, before I2 to I4 |
| I3 | Clear Financial (Clear Treasury) Safe | schedule the vault timelock's acceptances (Safe batch) |
| Assurance | Assurance signer 1 (Account 3), then Assurance signer 2 (Account 4) | `approveAction` on each of the pool's five setup calls |
| Assurance | Clear Treasury (board) Safe | schedule the five calls on the Assurance timelock (Safe batch) |
| Day 7 | the Safes | the Clear Lending Safe runs the Earn batch; the Clear Treasury Safe the vault and Assurance batches (Safe batches) |

Every signer comes from `deploy/config/base-sepolia.rollout.env` and `deploy/config/earn-roles.json`. To change who signs (say, a new MetaMask account in a slot), change it there and re-run the script.

## Checking the page

`page.check.cjs` loads the page in Chromium with a mock MetaMask and checks the filters, the stage track, the send button, the exact request, the Safe batch file and link, "Read the chain again", the refusals and that the page makes no outside request:

```bash
node tools/signing-page/page.check.cjs
PLAN=deployments/base-sepolia/signing-plan.json node tools/signing-page/page.check.cjs   # also click through a real plan
# several plans, separated by ":" (a local one: SIGNING_PLAN_SAMPLE=<file> on test/deploy/SigningPlan.deploy.spec.ts writes it)
```

It needs Playwright's Chromium (`npx playwright install chromium` if it is missing). It is not part of CI.
