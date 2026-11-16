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

   The yellow bar says "Base Sepolia test network". The page refuses a plan for any other chain, and a plan changed after the script wrote it.

3. **Connect MetaMask.** The page asks MetaMask to switch to Base Sepolia (and to add it if it is missing).

4. **Sign the ready steps.** Each card says who signs, which contract, the function and its arguments. "Sign and send" works only when MetaMask is on the account the step names; otherwise the card says which account to switch to. MetaMask shows the call for you to confirm, then the page shows the transaction with a link to sepolia.basescan.org and whether it succeeded. Each signer needs a little Base Sepolia ETH for gas.

5. **Safe steps** (marked "Safe") are not sent from this page. Open the Safe app (app.safe.global) on the Safe, choose Apps, Transaction Builder, and drop in the batch file the script wrote (the card can also download it). Today the Safe needs one signature (the deployer's MetaMask account); after the step that adds the second MetaMask owner (`addOwnerWithThreshold(…698a, 2)`), every Safe transaction needs both.

6. **Re-run the plan script after each stage** and load the new plan. It reads the chain again: steps you sent show as done, and the steps that waited for them (for example a change's confirmation, which needs the change number from its proposal) become ready.

## The order

The plan lists the steps in the rollout's order (docs/audit/SEPOLIA-REHEARSAL.md, "The real run"):

| Stage | Who | What |
|---|---|---|
| C1d | the deployer (VAULT_ADMIN) | the savings vault's upgrade batch, call by call, once C1c has written it |
| D4 | the deployer | the credit settings and credit attester roles (two each), the credit operator |
| E8, E9 | treasury signer 1, treasury signer 2, the Agent Key | propose, confirm and approve each Collateral Agent change and the BondVault backstop |
| E8 | the deployer | the Liquidator's hold role (two), before the credit handover (I2) |
| E8 | Clear Lending Safe | schedule the changes on the Earn timelock (Safe batch) |
| F2 | credit settings signer 2 | approve the fee recipient deploy 25 proposed |
| Pool Tier | both valuation signers | post the Pool Tier principal |
| Safe | the Safe | add the second MetaMask owner and require 2 signatures, before I2 to I4 |
| I3 | Clear Financial Safe | schedule the vault timelock's acceptances (Safe batch) |
| Day 7 | the Safes | run the Earn and vault timelock batches (Safe batches) |

Every signer comes from `deploy/config/base-sepolia.rollout.env` and `deploy/config/earn-roles.json`. To change who signs (say, a new MetaMask account in a slot), change it there and re-run the script.

## Checking the page

`page.check.cjs` loads the page in Chromium with a mock MetaMask and checks the send button, the exact request, the refusals and that the page makes no outside request:

```bash
node tools/signing-page/page.check.cjs
PLAN=deployments/base-sepolia/signing-plan.json node tools/signing-page/page.check.cjs   # also load a real plan
```

It needs Playwright's Chromium (`npx playwright install chromium` if it is missing). It is not part of CI.
