# Base Sepolia rollout: the fork rehearsal

This rehearses [DEPLOY-RUNBOOK.md](./DEPLOY-RUNBOOK.md) §2 (Base Sepolia, steps A to I) end to end on a local fork of Base Sepolia, with the inputs in [`deploy/config/base-sepolia.rollout.env`](../../deploy/config/base-sepolia.rollout.env) and [`deploy/config/earn-roles.json`](../../deploy/config/earn-roles.json). It is the fork rehearsal that runbook step A3 asks for.

**Nothing was sent to a real network, and no key was used.** Every transaction went to an in-process Hardhat node forked from `https://sepolia.base.org`; the fork only read from that RPC. The deployer wallet, the Safe and every role holder were impersonated on the fork (`hardhat_impersonateAccount`, `hardhat_setBalance`). The scripts wrote their records to a scratch copy, `deployments/base-sepolia-fork/`, which is git-ignored: `deployments/base-sepolia/` is unchanged.

**Result: the whole sequence completed on the fork.** After the fixes below, one clean run from a fresh fork went from A6 to the final checks with no manual help. The gate (`scripts/check_retired_credit.ts`, I6) exits 0 with one WARN, the decision-50 test-money balance. The §4.1 checks (107) all pass, and payout funding is GREEN. Two things must happen before the real run: the owner raises the Safe's threshold to 2 (problem 7), and the owner inputs listed under "What still needs the owner" are filled in.

## The fork

| | |
|---|---|
| Forked from | Base Sepolia (chain 84532), `https://sepolia.base.org` |
| Fork block | **59,461,627** (Nov 16, 2026, shortly before 07:35 UTC). The first run, at block 59,452,173 (06:58 UTC), found the problems below |
| Node | `npx hardhat node --no-deploy` with `FORK_RPC_URL`, `FORK_BLOCK` and `FORK_CHAIN_ID=84532` (`hardhat.config.ts`), so the fork answers as chain 84532 |
| Scripts | each run as the operator runs it: `npx hardhat run <script> --network base-sepolia-fork`, the deployer wallet `0x895d…7AAA` as signer |
| Records | `deployments/base-sepolia-fork/`, copied from `deployments/base-sepolia/` at the start |
| Rehearsal blocks | 59,461,629 to 59,461,955 (326 transactions) |
| Build | the production build (`npx hardhat compile`, revert strings stripped), so EIP-170's size limit applied as on the real chain |

**What the chain showed before anything ran** (read on the fork):

- The deployer wallet holds `DEFAULT_ADMIN_ROLE` on ESADepositVault, ClaimEscrow, ClearUSDUpgradeable, LendingPool, BondVault, the AccessManager, NetworkRegistry and MembershipRegistry; it is CLRUSD's `defaultAdmin` and CCIP admin, holds CLRUSD's `UPGRADER_ROLE`, and owns the bond factories, the collections and the CLRUSD token pool. It holds **0.0146 ETH**, has nonce 1,070, and is an EIP-7702 delegated account (its code starts `0xef0100`).
- The Safe `0x52e6…cf50` is v1.3.0 with owners `…7AAA`, `…86cF` and `…eFE5`, and a **threshold of 1** (problem 7).
- The old PayoutPool owes nothing (`borrowedFromVault` 0, `borrowedFromYield` 0), and the BondVault's `lentToPayoutPool` is 0. So no loan is left open (decision 50 does not come into play for loans). The backstop can be cleared, and E9 runs.
- No pre-2f bond is outstanding. `BurnerBondLegacy` issued bonds 1 to 3, all redeemed; the current pre-2f `BurnerBond` issued none.
- The pool has 335 USDC of shares, so `INITIAL_CLOSING` must be non-zero and in the past. `1794787200` (Nov 16, 2026 00:00 UTC) is.
- CLRUSD's supply is 694.59; its admin delay is 2 days.
- The TokenRegistry whitelists nothing (problem 3).

## Steps, in order

"Who" is who signs on the real run. Gas is what each step used on the fork (`scripts/rehearsal_gas.ts`). Read-only steps used none.

| Step | What ran | Who | Result | Gas |
|---|---|---|---|---:|
| A6 | `CHECK_BASELINE=1 scripts/check_retired_credit.ts` | read-only | 11 FAIL, 1 WARN, as expected: the list D to I must disconnect (below) | 0 |
| B1 | `scripts/unwind_legacy_bonds.ts` (report) | read-only | "No pre-2f bond is outstanding. The BondVault can be upgraded." | 0 |
| B3 | the loans, read | read-only | all three 0 | 0 |
| C1a | `scripts/upgrade_vault.ts` | read-only | validates against `.openzeppelin/base-sepolia.json` | 0 |
| C1b | `PREPARE_VAULT_IMPL=1 scripts/upgrade_vault.ts` | deployer | implementation deployed (problem 1 fixed) | 3,782,405 |
| C1c | `scripts/migrate_vault_clrusd.ts` | writes a batch | "`…7AAA` holds the admin directly": `vault-1-upgrade.json` with `upgradeToAndCall(impl, setAcceptedToken(USDC, true))` and `grantRole(RELAYER_ROLE, RELAYER)` | 0 |
| C1d | the batch, sent in order | deployer (`VAULT_ADMIN`) | `acceptedToken()` is USDC | 125,035 |
| C2a | `deploy/upgrade/checkUpgrade.ts`, ClearUSDUpgradeable | read-only | validates (problem 2 fixed) | 0 |
| C2b | `deploy/upgrade/upgradeContract.ts`, ClearUSDUpgradeable | deployer (`UPGRADER_ROLE`) | upgraded | 4,858,160 |
| C3a, C3b | the same for ClaimEscrow | deployer (admin) | upgraded | 2,011,437 |
| C4 | `deploy/19_deploy_SavingsIntentFactory.ts` | deployer | new factory; the old record kept as `SavingsIntentFactoryPre2d` (problem 6 fixed) | 2,153,827 |
| D1 | `deploy/retire_credit_stack.ts`, then `RETIRE_CREDIT_STACK=1` | records only | the 11 credit records moved to `*PreAudit` | 0 |
| D2 | deploy 16, deploy 18 | deployer | fresh AccessManager, linked to the MembershipRegistry | 2,032,912 |
| D3 | deploy 20, deploy 21 | deployer | the credit core and its wiring; deploy 21 reuses the recorded CLRUSD | 57,884,846 |
| D4 | `CREDIT_SETTINGS_ROLE` ×2, `CREDIT_ATTESTER_ROLE` ×2, the credit operator (not scripted) | deployer (AccessManager admin) | granted | 284,720 |
| E1 | deploy 26, first run | deployer | Earn timelock, EarnControls, CollateralAgent; 26 Clear contracts refused | 16,052,769 |
| E2 | `scripts/upgrade_yield_pool.ts`, dry, then `YIELD_POOL_UPGRADE=1` | deployer (pool admin) | the Yield Pool; legend written | 15,081,223 |
| E3 | `scripts/upgrade_bond_vault_pledge_guard.ts`, dry, then real | deployer (vault admin) | upgraded; encumbrance source the new CollateralRegistry | 4,934,448 |
| E4 | `REPLACE_BOND_FACTORY=1` deploy 22 | deployer | fresh MerchantRegistry, PayoutPool, Liquidator, new factory; `*Pre2f` kept; the old PayoutPool's legs off; CLRUSD roles and encumbrance source moved | 41,377,985 |
| E6 | deploy 23 (`FIRST_BOND_ID=1000`) | deployer | USDC whitelisted (problem 3 fixed); the collection from id 1000, BondValuer, the retired collections' `BOND_ROLE` revoked, the Agent named, HolderDirections | 4,489,728 |
| E7 | deploy 27 | deployer | Earn roles from `earn-roles.json`; the card settler's and the old PayoutPool's `BORROWER_ROLE` revoked; the E9 backstop change printed | 1,441,643 |
| E8 | five co-signed changes: `CollateralAgent.setVault`, `setBondBook`, `setHolderDirections`, `setPledgeModule`, and E9's `BondVault.setBackstops(treasury, 0)`; the Safe schedules all five on the Earn timelock; two Liquidator `HOLD_ROLE` keys | treasury signers 1 and 2, the Agent Key, the Clear Lending Safe; deployer for `HOLD_ROLE` | proposed, confirmed, approved, scheduled | 1,603,264 |
| F2 | deploy 25 | deployer | the compliance wiring; carry pointed at the fresh PayoutPool, then the fee recipient proposed (problem 4 fixed) | 8,828,470 |
| F2b | `approveFeeRecipient(Safe, "INITIAL")` | the second `CREDIT_SETTINGS_ROLE` holder | `feeRecipient()` is the Safe | 84,428 |
| G1 | `postPoolTierPrincipal(100000000000, POOL_TIER_EVIDENCE)` | `…eFE5` and `…698a` (`VALUATION_ROLE`) | posted | 147,398 |
| H1 | `ASSURANCE_DEPLOY=1` deploy 08 | deployer | AssurancePool under the Assurance timelock; nine money paths listed | 6,326,982 |
| G3 | deploy 26, second run | deployer | the rest refused, AssurancePoolV2 included | 407,974 |
| I5 | `scripts/check_retired_credit.ts` | read-only | 1 FAIL (the backstop, until E9 executes on day 7), 1 WARN | 0 |
| I2 | `CREDIT_HANDOVER=1 deploy/credit_timelock_handover.ts` | deployer | credit timelock; 12 contracts and 2 ProxyAdmins moved | 2,468,337 |
| I3a | `VAULT_HANDOVER=1 deploy/vault_timelock_handover.ts`, the Safe as it is | deployer | **refused: "The Clear Financial Safe must need two signers; … needs 1"** (problem 7) | 0 |
| I3b | the Safe's `changeThreshold(2)` (simulated owner action) | the Safe (one owner, today) | 2 of 3 | 34,765 |
| I3c | the vault handover again; the Safe schedules the two acceptances on the vault timelock | deployer; the Clear Financial Safe | keys granted, admin to the vault timelock, CLRUSD admin transfer begun | 2,537,089 |
| I4 | `EARN_HANDOVER=1 deploy/earn_timelock_handover.ts` | deployer | pool, controls, BondVault, collections and all three factories to the Earn timelock | 701,820 |
| W7 | `evm_increaseTime` 7 days and 1 hour | | | 0 |
| E8x | the Safe executes the Earn timelock batch | the Clear Lending Safe | the Agent's four settings, and the backstop cleared | 248,435 |
| I3x | the Safe executes the vault timelock batch | the Clear Financial Safe | CLRUSD `defaultAdmin` and the token pool's owner are the vault timelock | 98,104 |
| I6 | `scripts/check_retired_credit.ts` (the gate) | read-only | **0 FAIL, 1 WARN: exit 0** | 0 |
| V41 | `scripts/check_sepolia_wiring.ts` (§4.1) | read-only | **107 PASS, 0 FAIL** | 0 |
| V43 | `scripts/check_payout_funding.ts` | read-only | **GREEN** | 0 |

Not run: A1 and A2 (read-only surveys and storage reports, which need no fork); E5, deploy 24 (offers, "if offers launch": owner decision); H2, `deploy_all.ts` (the Deed track redeploy is recommended, not forced: owner decision); and I1, `scripts/command/ops-roles.ts` (it needs the owner's job wallets, and reads `deployments/base-sepolia` by a fixed path).

### What A6 listed, and where each was cleared

| A6 FAIL | Cleared by |
|---|---|
| old PayoutPool holds the pool's `BORROWER_ROLE` | E7 (deploy 27) |
| `LendingPool.encumbranceSource()` names the old CollateralRegistry | E4 (deploy 22) |
| old Liquidator holds CLRUSD `LIQUIDATOR_ROLE` | E4 |
| CLRUSD `encumbranceSource()` names the old CollateralRegistry | E4 |
| `BurnerBond`, `BurnerBondDeposit` and `BurnerBondLegacy` hold BondVault `BOND_ROLE` | E6 (deploy 23) |
| `BondVault.payoutPool()` names the old PayoutPool | E9: the co-signed `setBackstops`, executed on day 7 |
| `BondVault.encumbranceSource()` names the old CollateralRegistry | E3 |
| the old PayoutPool's `yieldPool` and `bondVault` legs | E4 (`setLenders(0, reserve)` and `setBondVault(0)`) |

The WARN, "PayoutPool holds 10.5 USDC (test money, decision 50)", stays, as decision 50 says.

## Waits, Safe actions and two-signer actions

| What | Who | Wait | On the fork |
|---|---|---|---|
| `scheduleBatch` on the Earn timelock: the four Agent settings and the backstop (E8, E9) | Clear Lending Safe | 7 days (the timelock) | scheduled day 0, executed after `evm_increaseTime` |
| Each Agent change: `proposeChange`, then `confirmChange` by a different signer, then `approveChange` | treasury signer 1, treasury signer 2, the Agent Key | 7 days from `confirmChange` | all five on day 0 |
| `scheduleBatch` on the vault timelock: CLRUSD `acceptDefaultAdminTransfer`, token pool `acceptOwnership` (I3) | Clear Financial Safe | 7 days (the timelock), covering CLRUSD's 2-day admin delay | scheduled day 0, executed day 7 |
| `approveFeeRecipient` after deploy 25's proposal | a second `CREDIT_SETTINGS_ROLE` holder | none | done |
| `postPoolTierPrincipal` | two different `VALUATION_ROLE` holders (`…eFE5`, `…698a`) | none | done |
| `changeThreshold(2)` on the Safe | the Safe, signed today by one owner | none | done before I3 |
| `BurnerBond.setLiquidator` | deploy 25 | none: the collection has no bonds yet, so it applies at once | applied |

Nothing else waits. The Ladder's 48-hour notice applies only to changes after the first listing; deploy 23 sets the first rungs directly.

On a calendar: day 0 is A6 to I4. On day 7 the Clear Lending Safe executes the Earn batch and the Clear Financial Safe the vault batch; then I6 passes. Before day 7, I5 shows one FAIL, the backstop.

## The final read-only checks

`scripts/check_retired_credit.ts` (I6, the gate), the lines other than PASS:

```
Retired credit check on base-sepolia-fork, chain 84532 (a testnet: …): 19 retired contract(s). Sends nothing.

WARN  PayoutPoolPreAudit: holds 10.5 USDC (test money, decision 50)
INFO  AccessManagerPreAudit: not on the refused list: it holds no funds (decision 46(c))
INFO  NetworkRegistryPreAudit: not on the refused list: it holds no funds (decision 46(c))
INFO  LimitCalculatorPreAudit: not on the refused list: it holds no funds (decision 46(c))
INFO  MerchantRegistryPreAudit: not on the refused list: it holds no funds (decision 46(c))
INFO  BurnerBondFactoryPre2f: not on the refused list: it holds no funds (decision 46(c))
INFO  BondValuerPre2f: not on the refused list: it holds no funds (decision 46(c))
INFO  BurnerBondFactoryLegacy: not on the refused list: it holds no funds (decision 46(c))
INFO  BondValuerLegacy: not on the refused list: it holds no funds (decision 46(c))

0 FAIL, 1 WARN. Nothing retired is still connected.
```

`scripts/check_sepolia_wiring.ts` (new: runbook §4.1 as a script, read-only) gave 107 PASS and 0 FAIL. It covers each line of the §4.1 table: the vault, CLRUSD, ClaimEscrow, the AccessManager's operators, both issuers, the Liquidator, the CollateralRegistry, the pool, EarnControls and its refusals, the BondVault, the collection, the CollateralAgent, the PayoutPool, and the four timelocks (7 days, the right Safe proposing and executing, no deployer admin). It also confirms that the deployer holds no `DEFAULT_ADMIN_ROLE` and owns nothing on the contracts the handovers cover.

`scripts/check_payout_funding.ts` (§4.3):

```
PayoutPool 0xc1C2…280E on base-sepolia-fork (84532): GREEN
- Payable: $0.00; due within 2 business days $0.00; due within 30 days $0.00
- Yield Pool Deployment headroom: $301.50 (cash $335.00, 90% cap, Pool Tier $100,000.00)
```

## Gas and ETH

All 326 transactions used **179,998,204 gas**, of which the deployer sent 303 (**177,830,331 gas**). The rest was the Safe (530,013), the treasury signers and Agent Key (1,406,034 between them), the two valuation signers (147,398) and the fee-recipient approver (84,428). The largest steps are deploy 20 (57.9M), deploy 22 (41.4M), deploy 26 (16.1M) and the Yield Pool upgrade (15.1M).

Base Sepolia is an OP Stack chain, so a transaction pays L2 execution plus an L1 data fee. At the fork, L1's base fee was 16 wei. The GasPriceOracle (`0x42…0F`), asked about every transaction, gives an L1 fee of 4.3 × 10⁻¹³ ETH in total, which is negligible. So the cost is the L2 execution:

| L2 gas price | Deployer's cost | Everyone's |
|---|---:|---:|
| 0.0054 gwei (the fork block's base fee plus 0.001 gwei) | 0.00096 ETH | 0.00097 ETH |
| 0.05 gwei | 0.0089 ETH | 0.0090 ETH |
| 0.1 gwei | 0.0178 ETH | 0.0180 ETH |

**The deployer's 0.0146 ETH covers the run up to a gas price of about 0.08 gwei.** Top it up to 0.05 ETH so a price spike cannot stop it half way. Each of the other signers needs a little ETH for its own calls (well under 0.001 ETH each at today's prices). Neither valuation signer holds any ETH today (`…eFE5` and `…698a` both have 0), nor does the Safe.

## Problems found, and the fixes

Each fix is in a deploy, upgrade or check script, with a regression test in [`test/deploy/SepoliaRehearsal.deploy.spec.ts`](../../test/deploy/SepoliaRehearsal.deploy.spec.ts). No contract changed, and none needs to.

1. **`scripts/upgrade_vault.ts` deployed the implementation, then threw.** With no USDC known for the network, it encoded the placeholder `"<USDC>"` into the call it prints, after `prepareUpgrade` had already deployed the implementation. It now prints the call in words (`upgradeCallLine` in `scripts/vaultUpgrade.ts`). On the real `base-sepolia` network USDC is known, so this would have hit only a fork or a new network.
2. **`deploy/upgrade/upgradeContract.ts` could not upgrade ClearUSDUpgradeable.** OpenZeppelin's validation refuses it ("Missing initializer", "Missing initializer calls … `AccessControlDefaultAdminRulesUpgradeable`") unless the script passes the two waivers deploy 21 deployed it with, both about Chainlink's base contract. Step C2 would have failed on the real run. `deploy/upgrade/upgradeOptions.ts` now gives both `checkUpgrade.ts` and `upgradeContract.ts` those waivers for ClearUSDUpgradeable. The same script also had two smaller faults, both fixed:
   - it saved the record's ABI as a JSON string, where every other script saves an array;
   - it would have tried source verification on a fork.
   Separately, `checkUpgrade.ts` reported ClaimEscrow as "does not support UUPS": it asked `supportsInterface` with `proxiableUUID`'s selector. It now reads `proxiableUUID()` on the implementation.
3. **Base Sepolia's TokenRegistry whitelists nothing, and the Phase 2f factory makes a collection only for a whitelisted token.** At step E6, deploy 23's `createCollection(USDC, …)` reverted with no reason (the build strips revert strings). The pre-2f factories gated on the AssuranceOracle instead, so nothing showed it before. USDC is half-configured on the registry (stablecoin, 6 decimals, no `registerToken`), which looks like an interrupted deploy 07. Deploy 23 now whitelists the bond token first, through `ensureBondTokenWhitelisted` in `deploy/bondModules.ts`: `registerToken(token, chainId, token, $1)`, the owner's existing power, and the deployer owns the registry. If someone else owns it, deploy 23 stops and prints the call that owner must make.
4. **Deploy 25 reverted at `proposeFeeRecipient` (`TermIssuerFeeRecipientNotAllowed`).** TermIssuer refuses a fee recipient equal to its carry treasury. With one Safe in every role, `CARRY_TREASURY` (deploy 20) and `FEE_RECIPIENT` were the same Safe. On the pre-audit stack, carry went to the PayoutPool and the fee to the Safe. That is the design: `docs/protocol/settlement.md` and `scripts/configure-carry-recipients.mjs` point carry at the pool. But the runbook's sequence never re-pointed carry at the fresh PayoutPool, and deploy 20 runs before deploy 22 creates it. Deploy 25 now points both issuers' carry at the fresh `PayoutPool` record first (`pointCarryAtPayoutPool` in `deploy/creditWiring.ts`). It skips a retired record, and it returns a proposal when the sender lacks `CREDIT_SETTINGS_ROLE`. Since Phase 2e an unset fee recipient no longer falls back to carry, so carry can move first. Deploy 25 also says so plainly, rather than reverting half way, if the fee recipient still equals the carry treasury.
5. **A fork could not run the Earn and USDC lookups that are keyed by network name.** These are `KNOWN_USDC`, `KNOWN_RESERVE_TOKEN`, deploy 20's and deploy 08's USDC, and `earn-roles.json` ("owner to fill: no entry for base-sepolia-fork"). The new `liveNetworkOf` (in `deploy/helpers.ts`) maps a `*-fork` network to the network it forks, for these lookups only. Records are never shared: a fork reads and writes its own scratch copy.
6. **Deploy 19 overwrote the `SavingsIntentFactory` record, keeping no copy, and deployed a second factory on every run.** Runbook C4 said to keep the old record by hand first. Now, when the recorded factory predates Phase 2d (no `isIntentEscrow`), deploy 19 keeps it as `SavingsIntentFactoryPre2d` (once), and it reuses a Phase 2d factory instead of deploying another. The script also no longer runs on import.
7. **Not a script bug: the Safe needs one signature, and the vault and Earn handovers require two.** `assertTwoPersonSafe` refuses the Safe `0x52e6…cf50` (threshold 1 of 3) at I3, and would at I4. The rollout env says to leave the Safe's settings alone for now. So the owner must raise the threshold to 2 (`changeThreshold(2)`, one owner's signature today) before I3, or decide otherwise. The rehearsal simulated that change and went on.
8. **Rehearsal tooling** (no effect on the real run):
   - `hardhat.config.ts` gains the `base-sepolia-fork` network (a local node, `accounts: "remote"`) and an opt-in `FORK_CHAIN_ID`. On that network only, the scripts sign as `FORK_SIGNER` (default the deployer), impersonated. Nothing changes when neither is used.
   - The node answers no call at the fork block itself ("No known hardfork for execution on historical block … chain 84532"), so the rehearsal mines one block first.
   - `npx hardhat node` must be run with `--no-deploy`: without it, hardhat-deploy runs the `deploy/` folder against the node at start.

Also seen, and left as is: deploy 26's second run prints the `setPledgeModule` co-signed steps again while that change is already pending.

## What still needs the owner

**Before the run:**

1. **Raise the Safe's threshold to 2** (problem 7), or name a two-of-N Safe for `CLEAR_FINANCIAL_SAFE` and `CLEAR_LENDING_SAFE`.
2. **Top up the deployer** to about 0.05 ETH (it has 0.0146), and give a little ETH to every other signer who sends a transaction: the two valuation signers, the treasury signers, the Agent Key, the second `CREDIT_SETTINGS_ROLE` holder, and whoever executes the Safe's transactions.
3. **Fill these inputs.** The rehearsal used a synthetic stand-in for each, made from a label (`standIns()` in `scripts/rehearse_sepolia_fork.ts`); no record, chain read or document settles them:

   | Variable | What | Read by |
   |---|---|---|
   | `RELAYER` (and `VAULT_RELAYERS`, `SAVINGS_RELAYER_ADDRESS`) | the savings relayer. No candidate address holds the vault's `OPERATOR_ROLE` except the deployer, and the event logs could not be read here: the public RPC caps `eth_getLogs` at 200 blocks, and the proxy refused Blockscout | C1c, C4, I3 |
   | `VAULT_PAUSERS`, `PILOT_SIGNERS`, `FRAUD_SIGNERS`, `SECURITY_SIGNERS`, `LISTING_SIGNERS` | two each | I3 |
   | `CREDIT_LINES_KEY`, `CREDIT_LIMITS_KEY` | the API's line and limit keys | D3 (deploy 20) |
   | two `CREDIT_SETTINGS_ROLE` holders, two `CREDIT_ATTESTER_ROLE` holders, the credit `OPERATOR` key | not scripted; the deployer grants them on the new AccessManager | D4 |
   | two Liquidator `HOLD_ROLE` holders | not scripted | E8 |
   | `STATE_ATTESTER_KEY` | the API's state attestation key | F2 (deploy 25) |
   | `AGENT_KEY`, `TREASURY_SIGNERS` (two), `COLLATERAL_ACCOUNT`, `AGENT_COST_ADDRESS`, `EXCESS_DESTINATION` | the CollateralAgent | E1 (deploy 26) |
   | `ASSURANCE_SIGNERS` (two) | the AssurancePool's signers | H1 (deploy 08) |

4. **Confirm the values the rehearsal added to `base-sepolia.rollout.env`**, each from the chain or the docs:
   - `CARRY_TREASURY` and `LENDER_OPERATING`: the Safe, as the co-op multisig and Lending Co.'s account. Carry then moves to the PayoutPool in deploy 25.
   - `CARD_SETTLEMENT_ACCOUNT` and `FEE_RECIPIENT`: the Safe, as on the old RevolvingIssuer and TermIssuer.
   - `BOARD_SAFE`: the Safe.
   - `BOND_BASE_URI`: the recorded factory's.
   - `FIRST_BOND_ID=1000`: above bonds 1 to 3. Re-check it with B1's report on the day.
5. **Confirm the record name `SavingsIntentFactoryPre2d`** for the old factory (C4).
6. **Decide:**
   - deploy 24 (offers);
   - the Deed track redeploy (H2);
   - `earn-controls.json`'s Funding Limit and pool capacity, still 0, which refuses every subscription (A5).
7. **After the run:**
   - **I1** (`scripts/command/ops-roles.ts`) with the job wallets. Today the deployer is the vault's `OPERATOR_ROLE` holder, ClaimEscrow's settler, the MembershipRegistry's registrar and the old SavingsIntentFactory's settler. If the API's relayer and operator still use the deployer key, the vault handover's renounce stops them.
   - **The Ops Safe handover** (`scripts/command/safe-handover.ts`), for what the three timelock handovers do not cover: the new SavingsIntentFactory's admin and the TokenRegistry's owner stay with the deployer.
   - **The app address list** in runbook §4.2.

## Running the rehearsal again

```bash
# The node, left running (in this sandbox, prefix both commands with
# NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt):
npx hardhat compile
FORK_RPC_URL=https://sepolia.base.org FORK_BLOCK=<recent block> FORK_CHAIN_ID=84532 npx hardhat node --no-deploy

# The rehearsal, from a fresh scratch copy of the records, then the gas:
REHEARSAL_RESET=1 npx hardhat run scripts/rehearse_sepolia_fork.ts --network base-sepolia-fork
npx hardhat run scripts/rehearsal_gas.ts --network base-sepolia-fork
```

`REHEARSAL_FROM=<step id>` resumes at a step on the same node, and `REHEARSAL_TO=<step id>` stops after one. Each step's output, the ledger, the inputs used and the gas are written to `deployments/base-sepolia-fork/rehearsal/`. An input set in the environment wins over the env file and over the stand-ins, so the owner's real inputs can be rehearsed before the real run.

## The real run, command by command

From the repository root, with `DEPLOYER_PRIVATE_KEY` in the operator's own environment (never in a file here), the Safe at threshold 2, and the owner inputs above exported. Each step is the one rehearsed above; the expected result is in the table of steps.

```bash
set -a; . deploy/config/base-sepolia.rollout.env; set +a
export RELAYER=0x… VAULT_RELAYERS=0x… SAVINGS_RELAYER_ADDRESS=0x…
export VAULT_PAUSERS=0x…,0x… PILOT_SIGNERS=0x…,0x… FRAUD_SIGNERS=0x…,0x… SECURITY_SIGNERS=0x…,0x… LISTING_SIGNERS=0x…,0x…
export CREDIT_LINES_KEY=0x… CREDIT_LIMITS_KEY=0x… STATE_ATTESTER_KEY=0x…
export AGENT_KEY=0x… TREASURY_SIGNERS=0x…,0x… COLLATERAL_ACCOUNT=0x… AGENT_COST_ADDRESS=0x… EXCESS_DESTINATION=0x…
export ASSURANCE_SIGNERS=0x…,0x…
N=base-sepolia
npx hardhat compile

# A6, B1: read-only (A6 is expected to exit 1 with 11 FAIL, 1 WARN; B1: no pre-2f bond outstanding)
CHECK_BASELINE=1 npx hardhat run scripts/check_retired_credit.ts --network $N
npx hardhat run scripts/unwind_legacy_bonds.ts --network $N

# C1: the vault (the batch is written to deployments/base-sepolia/safe-batches/vault-1-upgrade.json;
# the deployer, VAULT_ADMIN, sends its transactions in order)
npx hardhat run scripts/upgrade_vault.ts --network $N
PREPARE_VAULT_IMPL=1 npx hardhat run scripts/upgrade_vault.ts --network $N
VAULT_IMPL=0x… npx hardhat run scripts/migrate_vault_clrusd.ts --network $N

# C2, C3: CLRUSD and ClaimEscrow
CONTRACT_NAME=ClearUSDUpgradeable PROXY_ADDRESS=0x2a116Bead17dd96DC5c560A0d76b02eb2D7aD6D1 npx hardhat run deploy/upgrade/checkUpgrade.ts --network $N
CONTRACT_NAME=ClearUSDUpgradeable PROXY_ADDRESS=0x2a116Bead17dd96DC5c560A0d76b02eb2D7aD6D1 npx hardhat run deploy/upgrade/upgradeContract.ts --network $N
CONTRACT_NAME=ClaimEscrow PROXY_ADDRESS=0x24DAE7b66dC31657265260B5d9092280B57Bc37D npx hardhat run deploy/upgrade/checkUpgrade.ts --network $N
CONTRACT_NAME=ClaimEscrow PROXY_ADDRESS=0x24DAE7b66dC31657265260B5d9092280B57Bc37D npx hardhat run deploy/upgrade/upgradeContract.ts --network $N

# C4: the SavingsIntentFactory (keeps the old record as SavingsIntentFactoryPre2d)
npx hardhat run deploy/19_deploy_SavingsIntentFactory.ts --network $N

# D1 to D3: the fresh credit core
npx hardhat run deploy/retire_credit_stack.ts --network $N
RETIRE_CREDIT_STACK=1 npx hardhat run deploy/retire_credit_stack.ts --network $N
npx hardhat run deploy/16_deploy_AccessManager.ts --network $N
npx hardhat run deploy/18_configure_AccessManagerMembershipRegistry.ts --network $N
npx hardhat run deploy/20_deploy_CreditCore.ts --network $N
npx hardhat run deploy/21_deploy_ClearUSDUpgradeable.ts --network $N
# D4 (the deployer, not scripted): on the new AccessManager, grantRole(keccak256("CREDIT_SETTINGS_ROLE"), …) ×2,
#    grantRole(keccak256("CREDIT_ATTESTER_ROLE"), …) ×2, grantOperator(<credit operator>)

# E1 to E7: Earn, the upgrades, the rest of the credit stack
npx hardhat run deploy/26_deploy_EarnControls.ts --network $N
npx hardhat run scripts/upgrade_yield_pool.ts --network $N
YIELD_POOL_UPGRADE=1 npx hardhat run scripts/upgrade_yield_pool.ts --network $N
VAULT_UPGRADE_DRY_RUN=1 npx hardhat run scripts/upgrade_bond_vault_pledge_guard.ts --network $N
npx hardhat run scripts/upgrade_bond_vault_pledge_guard.ts --network $N
REPLACE_BOND_FACTORY=1 npx hardhat run deploy/22_deploy_BondsAndPool.ts --network $N
npx hardhat run deploy/23_deploy_BondCollection.ts --network $N
npx hardhat run deploy/27_wire_Earn.ts --network $N
# E8, E9: for each of CollateralAgent.setVault(BondVault), setBondBook(BondVault), setHolderDirections(HolderDirections),
#    setPledgeModule(Liquidator) (target: the CollateralAgent), and BondVault.setBackstops(<treasury>, 0x0) (target: the
#    BondVault; deploy 27 prints its calldata): treasury signer 1 proposeChange(target, keccak256(calldata), descriptionHash),
#    treasury signer 2 confirmChange(changeId), the Agent Key approveChange(changeId). Then the Clear Lending Safe sends
#    EarnTimelock.scheduleBatch(the five targets, zeros, the five calldatas, 0x0, salt, 604800).
#    The deployer grants Liquidator HOLD_ROLE to the two hold keys.

# F2: compliance, then the second CREDIT_SETTINGS_ROLE holder sends
#    TermIssuer.approveFeeRecipient(0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50, 0x494e495449414c00…00 ("INITIAL"))
npx hardhat run deploy/25_wire_Compliance.ts --network $N

# G1: …eFE5 and …698a each send LendingPool.postPoolTierPrincipal(100000000000, $POOL_TIER_EVIDENCE)
#    (deploy 27 prints the calldata)

# H1, then G3
ASSURANCE_DEPLOY=1 npx hardhat run deploy/08_deploy_AssurancePool.ts --network $N
npx hardhat run deploy/26_deploy_EarnControls.ts --network $N

# I5 (expected: 1 FAIL, the backstop, until day 7), then the handovers
npx hardhat run scripts/check_retired_credit.ts --network $N
CREDIT_HANDOVER=1 npx hardhat run deploy/credit_timelock_handover.ts --network $N
VAULT_HANDOVER=1 npx hardhat run deploy/vault_timelock_handover.ts --network $N
#    then the Clear Financial Safe sends VaultTimelock.scheduleBatch with the two acceptance calls it printed
EARN_HANDOVER=1 npx hardhat run deploy/earn_timelock_handover.ts --network $N

# Day 7: the Clear Lending Safe sends EarnTimelock.executeBatch(…), the Clear Financial Safe VaultTimelock.executeBatch(…)

# I6, the gate, and the read-only checks (each must exit 0)
npx hardhat run scripts/check_retired_credit.ts --network $N
DEPLOYER=0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA npx hardhat run scripts/check_sepolia_wiring.ts --network $N
npx hardhat run scripts/check_payout_funding.ts --network $N
```

Afterwards, commit the records the run wrote to `deployments/base-sepolia/` and `.openzeppelin/base-sepolia.json` with the deployment, as `docs/operators/deploying-contracts.md` says.

## Owner answers (Nov 16, 2026, after the rehearsal)
- **The Safe:** option (a). The owner raises `0x52e6…cf50` to 2 of 3 (`changeThreshold(2)`) just before the credit, vault and Earn handovers (I2 to I4); nothing before them needs it.
- **Accepted:** the rehearsal's additions to `base-sepolia.rollout.env`, the record name `SavingsIntentFactoryPre2d`, deploy 24 (offers) and the Deed redeploy (H2) left out of this run.
- **Funding Limit and pool capacity:** $100,000 each on Base Sepolia only, through the new `networks` overrides in `deploy/config/earn-controls.json` (read by deploy 26); Base mainnet keeps 0 until the Holdings and Lending Boards set them.
- **Signer pairs:** filled in `base-sepolia.rollout.env` from …698a, …86cF and …eFE5. The deployer is in none of them: the vault handover renounces every vault and CLRUSD role it holds.
- **Still open:** the addresses of the API's job wallets (credit operator, savings relayer, send relayer). A read of Base Sepolia shows the deployer still holding every operational role those wallets should get (vault `OPERATOR_ROLE`, ClaimEscrow and SavingsIntentFactory `SETTLER_ROLE`, AccessManager operator, NetworkRegistry `OPERATOR_ROLE`), so `ops-roles.ts` (I1) has not run on Sepolia yet. The public RPC serves only 200 blocks of logs per call, so the role history could not be read.
