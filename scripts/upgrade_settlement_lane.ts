import { getDeployment, requireMainnetConfirmation, saveDeployment } from "../deploy/helpers";
import { deployPoolValuation } from "../deploy/poolModules";

/*
 * Decision 54: the Yield Pool gains the Settlement Funding lane (IV-02 §4.3A): `setSettlementFunder`,
 * `setSettlementHeadroom`, `stopSettlementFunder` and `deploySettlement`, in `YieldPoolValuation`
 * (now "YieldPoolValuation.v3"), forwarded from `LendingPool`. A plain UUPS upgrade of the pool
 * proxy, with no call: the lane starts empty (no funder, no headroom) and two DEPLOYER_ROLE signers
 * set it afterwards (signing plan steps SL-funder, SL-headroom).
 *
 * The pool's admin is the Earn timelock, so the upgrade is a NEW Earn timelock proposal the Clear
 * Lending Safe schedules after the E8 batch has executed (signing plan steps SL-upgrade-schedule and
 * SLx-upgrade-execute). This script only prepares it:
 *
 * 1. OpenZeppelin's `validateUpgrade` against the network's manifest (`.openzeppelin/<network>.json`):
 *    the layout must be append-only. Nothing is deployed before it passes.
 * 2. With SETTLEMENT_LANE_PREPARE=1: a fresh `YieldPoolLedger`, `YieldPoolValuation(ledger)` and the
 *    `LendingPool(valuation)` implementation (`upgrades.prepareUpgrade`, which records it in the
 *    manifest), and the record `deployments/<network>/LendingPoolSettlementLane.json`, whose address
 *    is the new implementation. The signing plan reads it.
 *
 * It never upgrades the proxy and never schedules anything.
 *
 *   npx hardhat run scripts/upgrade_settlement_lane.ts --network base-sepolia                     # validate only
 *   SETTLEMENT_LANE_PREPARE=1 npx hardhat run scripts/upgrade_settlement_lane.ts --network base-sepolia
 */

export const SETTLEMENT_LANE_RECORD = "LendingPoolSettlementLane";

export interface SettlementLaneUpgradeOptions {
  proxy: string;
  /** Deploy the modules and the implementation, and write the record (else validate only). */
  prepare?: boolean;
  /** Where to write the record (default: no record). */
  network?: string;
  log?: (m: string) => void;
}

export async function prepareSettlementLaneUpgrade(o: SettlementLaneUpgradeOptions) {
  const { ethers, upgrades } = require("hardhat");
  const log = o.log ?? console.log;
  const [signer] = await ethers.getSigners();
  const LendingPool = await ethers.getContractFactory("LendingPool", signer);

  // The module address does not affect the layout check: a placeholder stands in for it.
  await upgrades.validateUpgrade(o.proxy, LendingPool, { kind: "uups", constructorArgs: [ethers.ZeroAddress] });
  log(`LendingPool ${o.proxy}: the new implementation validates as an upgrade of what the manifest records`);
  if (!o.prepare) {
    log("Validated only: nothing deployed. SETTLEMENT_LANE_PREPARE=1 deploys the implementation for the Earn timelock proposal.");
    return { implementation: undefined as string | undefined };
  }

  const valuation = await deployPoolValuation(signer);
  const module = await ethers.getContractAt("YieldPoolValuation", valuation, signer);
  const ledger: string = await module.ledger();
  const implementation = (await upgrades.prepareUpgrade(o.proxy, LendingPool, { kind: "uups", constructorArgs: [valuation] })) as string;
  log(`+ YieldPoolLedger     ${ledger}`);
  log(`+ YieldPoolValuation  ${valuation}`);
  log(`+ LendingPool impl    ${implementation}`);
  if (o.network) {
    saveDeployment(o.network, SETTLEMENT_LANE_RECORD, implementation, JSON.parse(LendingPool.interface.formatJson()));
    log(`  recorded as deployments/${o.network}/${SETTLEMENT_LANE_RECORD}.json`);
  }
  log("\nNothing is upgraded. The Clear Lending Safe schedules upgradeTo(impl) on the Earn timelock after E8x has run:");
  log("  npx hardhat run scripts/signing_plan.ts --network base-sepolia   (steps SL-upgrade-schedule, SLx-upgrade-execute)");
  return { implementation };
}

async function main() {
  const { ethers } = require("hardhat");
  const network = (await ethers.provider.getNetwork()).name;
  requireMainnetConfirmation(network, "scripts/upgrade_settlement_lane.ts");
  const pool = getDeployment(network, "LendingPool");
  if (!pool) throw new Error(`No LendingPool recorded for ${network}.`);
  await prepareSettlementLaneUpgrade({ proxy: pool.address, prepare: process.env.SETTLEMENT_LANE_PREPARE === "1", network });
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
