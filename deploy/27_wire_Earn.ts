import { getDeployment, requireMainnetConfirmation } from "./helpers";
import { poolAt } from "./poolModules";
import { earnControlsAt } from "./earnModules";
import {
  BackstopResult, EARN_ROLES_FILE, grantEarnRoles, loadEarnRoles, payoutBackstopChange, poolTierStep, revokeRetiredPoolRoles,
  wireEarnControlsToPool,
} from "./earnWiring";
import { Proposal, RETIRED_ROLE_CHECKS, VIA, printProposals, revokeRetiredRoles, switchOffPayoutLegs } from "./creditWiring";
import { RETIRED_SUFFIX, retiredContracts } from "./retire_credit_stack";

/**
 * Phase 2f: the Earn wiring no earlier script makes (DEPLOY-RUNBOOK §5.2 item 4; decisions 3, 17).
 *
 * 1. EarnControls and the Yield Pool, each named on the other: `EarnControls.setSources(…,
 *    LendingPool, …)` (its other sources kept) and, on a fresh pool, `LendingPool.setEarnControls`
 *    (an upgraded pool names EarnControls in `initializeYieldPool`). Until both are set, every
 *    subscription fails.
 * 2. The Earn operational roles, from `deploy/config/earn-roles.json`: on the pool DEPLOYER_ROLE,
 *    VALUATION_ROLE, SUSPENSION_ROLE, CCO_ROLE and TREASURER_ROLE; on EarnControls, each with the
 *    Lending Board resolution (EARN_RESOLUTION), ATTESTER_ROLE, PAUSE_ROLE, SUCCESSOR_ROLE,
 *    ELIGIBILITY_ROLE, LADDER_ROLE, FUNDING_ROLE, WIND_DOWN_ROLE, ROLL_NOTICE_ROLE and
 *    EXCLUDED_HOLDER_ROLE. A list the owner has not filled stops the script before anything is
 *    granted. (BOND_ROLE is the collection's: deploy 23.)
 * 3. The retired pool roles: BORROWER_ROLE from the configured borrowers (the card settler) and every
 *    PayoutPool on record, and LIQUIDATOR_ROLE from the Liquidator retired with the old credit
 *    stack (decision 17; C5).
 * 4. The PayoutPools' legs (decision 17, C1; PHASE-2F-YIELD-POOL.md §10): `setYieldPool(0)` and
 *    `setBondVault(0)` on every PayoutPool on record, each once that pool owes the lender nothing.
 * 5. The Pool Tier principal: reported, with the call two VALUATION_ROLE signers make
 *    (POOL_TIER_PRINCIPAL, POOL_TIER_EVIDENCE), since no Deployment is possible before it.
 * 6. Decision 48 (b): every LendingPool and EarnControls role a retired contract (`*PreAudit`,
 *    `*Pre2f`, `*Legacy`) still holds, revoked (Earn timelock proposals after the handover).
 * 7. Decision 48 (a): the BondVault's `payoutPool` backstop, which names the retired PayoutPool.
 *    Once `lentToPayoutPool` is 0, it prints `setBackstops(treasury, 0)` (the treasury kept) as a
 *    change the Collateral Agent co-signs and the Earn timelock makes; it never sends it. While a
 *    loan is open it refuses and says the old PayoutPool must repay through `repayFromPayoutPool`.
 *
 * Run after deploys 22, 23 and 26 (and, on Base Sepolia, `scripts/upgrade_yield_pool.ts`), before
 * `earn_timelock_handover.ts`. Every step checks before it writes. After the handovers the deployer
 * holds none of these powers: the script then prints each call as a timelock proposal instead.
 *
 *   EARN_RESOLUTION=0x… npx hardhat run deploy/27_wire_Earn.ts --network base-sepolia
 */
export interface WireEarnOptions {
  quiet?: boolean;
  /** Overrides the network whose records are read (tests). */
  network?: string;
  rolesFile?: string;
  resolution?: string;
  poolTierPrincipal?: bigint;
  poolTierEvidence?: string;
}

export async function wireEarn(options: WireEarnOptions = {}) {
  const { ethers } = require("hardhat");
  const [deployer] = await ethers.getSigners();
  const network = options.network ?? (await ethers.provider.getNetwork()).name;
  const log = options.quiet ? () => {} : console.log;

  const need = (name: string) => {
    const r = getDeployment(network, name);
    if (!r) throw new Error(`No ${name} on ${network}: run deploys 22 and 26 first.`);
    return r.address as string;
  };
  const pool = await poolAt(need("LendingPool"), deployer);
  const controls = await earnControlsAt(need("EarnControls"), deployer);
  if (!(await pool.earnControls().then(() => true, () => false))) {
    throw new Error("LendingPool is not the Yield Pool yet: run scripts/upgrade_yield_pool.ts first.");
  }
  const proposals: Proposal[] = [];

  log("EarnControls and the Yield Pool:");
  proposals.push(...(await wireEarnControlsToPool(controls, pool, deployer, log)));

  log("Earn roles:");
  const rolesFile = options.rolesFile ?? EARN_ROLES_FILE;
  const roles = loadEarnRoles(network, rolesFile);
  proposals.push(...(await grantEarnRoles({ pool, controls }, roles, options.resolution ?? process.env.EARN_RESOLUTION ?? "", deployer, log, rolesFile)));

  log("Retired pool roles:");
  const payoutRecords = ["PayoutPool", `PayoutPool${RETIRED_SUFFIX}`]
    .map((name) => ({ name, record: getDeployment(network, name) }))
    .filter((r) => r.record);
  proposals.push(...(await revokeRetiredPoolRoles(pool, {
    borrowers: [...(roles.revokeBorrowers ?? []), ...payoutRecords.map((r) => r.record!.address)],
    liquidators: [getDeployment(network, `Liquidator${RETIRED_SUFFIX}`)?.address].filter(Boolean) as string[],
  }, deployer, log)));

  log("Retired contracts' Earn roles (decision 48):");
  const { contracts: retired } = await retiredContracts((name) => getDeployment(network, name));
  proposals.push(...(await revokeRetiredRoles(pool, "LendingPool", RETIRED_ROLE_CHECKS.LendingPool, retired, deployer, VIA.earn, log)));
  proposals.push(...(await revokeRetiredRoles(controls, "EarnControls", RETIRED_ROLE_CHECKS.EarnControls, retired, deployer, VIA.earn, log)));

  log("PayoutPool legs:");
  const payoutPools = [];
  // Each with the ABI it was deployed with: the pre-audit PayoutPool has setLenders, not setYieldPool.
  for (const r of payoutRecords) {
    const abi = r.record!.abi?.length ? r.record!.abi : (await ethers.getContractFactory("PayoutPool")).interface.fragments;
    payoutPools.push({ name: r.name, contract: new ethers.Contract(r.record!.address, abi, deployer) });
  }
  proposals.push(...(await switchOffPayoutLegs(payoutPools, deployer, log)).proposals);

  // Decision 48 (a): printed, never sent; refused while the old PayoutPool still owes the vault.
  let backstop: BackstopResult | undefined;
  const vaultRecord = getDeployment(network, "BondVault");
  if (vaultRecord) {
    log("BondVault payout-pool backstop (decision 48):");
    backstop = await payoutBackstopChange(await ethers.getContractAt("BondVault", vaultRecord.address), log);
  }

  const tier = await poolTierStep(pool,
    options.poolTierPrincipal ?? (process.env.POOL_TIER_PRINCIPAL ? BigInt(process.env.POOL_TIER_PRINCIPAL) : undefined),
    options.poolTierEvidence ?? process.env.POOL_TIER_EVIDENCE);
  log(tier.line);

  if (proposals.length > 0) {
    log("\nThe deployer no longer holds these powers. Propose:");
    printProposals(proposals, log);
  }
  if (backstop?.status === "change") {
    log("\nThe BondVault backstop change (never sent by this script):");
    printProposals(backstop.proposals, log);
  } else if (backstop?.status === "refused") {
    log(`\n${backstop.message}`);
  }
  log("\nEarn wiring done.");
  return { proposals, tier, backstop };
}

async function main() {
  const { ethers } = require("hardhat");
  requireMainnetConfirmation((await ethers.provider.getNetwork()).name, "deploy/27_wire_Earn.ts");
  await wireEarn();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
