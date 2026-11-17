import { getDeployment, requireMainnetConfirmation, saveDeployment } from "../deploy/helpers";
import { POOL_SHARE_LEGEND, poolAbi, poolAt, poolProxyOptions } from "../deploy/poolModules";
import { poolTierStep } from "../deploy/earnWiring";
import { Proposal, printProposals } from "../deploy/creditWiring";

/*
 * Phase 2f, decision 16: LendingPool becomes the Yield Pool by an in-place UUPS upgrade (Base
 * Sepolia; on mainnet the pool is deployed fresh by deploy 22). It replaces
 * `scripts/upgrade_lending_pool_burn_lock.ts`, which could not deploy today's implementation.
 *
 * 1. OpenZeppelin's `validateUpgrade` against the network's manifest (`.openzeppelin/<network>.json`)
 *    first: the layout must be append-only. Nothing is sent before it passes.
 * 2. The modules and the implementation: `YieldPoolLedger`, then `YieldPoolValuation(ledger)`, then
 *    LendingPool with the valuation module as its constructor argument (`deploy/poolModules.ts`).
 * 3. One transaction: `upgradeToAndCall(impl, initializeYieldPool(EarnControls,
 *    CLEAR_LENDING_ACCOUNT, INITIAL_CLOSING))`. A pool with shares must name its Initial Closing
 *    (the first issue of Pool Shares), no later than now; an empty pool names 0. It runs once: a pool
 *    that is already the Yield Pool is not upgraded again here (a later module change is a plain
 *    upgrade with `poolProxyOptions()`).
 * 4. `setLegend` with IV-02 §8.4's legend (decision 27), written once.
 * 5. The Pool Tier principal: no Deployment is possible until two VALUATION_ROLE signers each post
 *    it (`postPoolTierPrincipal(value, evidenceHash)`). They are people, not this key, so the
 *    script prints their call (POOL_TIER_PRINCIPAL, POOL_TIER_EVIDENCE) and the pool's state.
 *
 * Steps 3 and 4 need the pool's DEFAULT_ADMIN_ROLE. Without it (after a handover) the script deploys
 * the implementation and prints both calls for the admin to propose. The deployment record is
 * rewritten with the joined ABI (`poolAbi()`).
 *
 * Run it after deploy 26 (EarnControls must exist) and before deploy 22. Dry by default:
 *
 *   CLEAR_LENDING_ACCOUNT=0x… INITIAL_CLOSING=<unix seconds> npx hardhat run scripts/upgrade_yield_pool.ts --network base-sepolia
 *   … YIELD_POOL_UPGRADE=1 npx hardhat run scripts/upgrade_yield_pool.ts --network base-sepolia      # send
 */

export interface YieldPoolUpgradeOptions {
  proxy: string;
  /** EarnControls' proxy. */
  controls: string;
  /** Clear Lending's lending account: the only place a Deployment goes. */
  deploymentAccount: string;
  /** The Initial Closing, unix seconds; 0 for a pool with no shares. */
  initialClosing: bigint;
  /** Validate and report only. */
  dryRun?: boolean;
  /** Rewrite deployments/<network>/LendingPool.json with the joined ABI. */
  network?: string;
  poolTierPrincipal?: bigint;
  poolTierEvidence?: string;
  log?: (m: string) => void;
}

export async function upgradeToYieldPool(o: YieldPoolUpgradeOptions) {
  const { ethers, upgrades } = require("hardhat");
  const log = o.log ?? console.log;
  const [signer] = await ethers.getSigners();
  const LendingPool = await ethers.getContractFactory("LendingPool", signer);
  const proposals: Proposal[] = [];
  const via = "the pool's DEFAULT_ADMIN_ROLE holder (the Earn timelock after earn_timelock_handover.ts)";

  // 1. The layout, against the manifest, before anything else. The plugin encodes the constructor
  // to validate; the module address is not deployed yet and does not affect the check, so a
  // placeholder stands in for it.
  await upgrades.validateUpgrade(o.proxy, LendingPool, { kind: "uups", constructorArgs: [ethers.ZeroAddress] });
  log(`LendingPool ${o.proxy}: the new implementation validates as an upgrade of what the manifest records`);

  const probe = await poolAt(o.proxy, signer);
  const already = await probe.earnControls().then(() => true, () => false);
  const legacy = new ethers.Contract(o.proxy, [
    "function totalSupply() view returns (uint256)",
    "function hasRole(bytes32,address) view returns (bool)",
  ], signer);
  const admin: boolean = await legacy.hasRole(ethers.ZeroHash, signer.address);
  let implementation: string | undefined;
  let upgraded = false;

  if (already) {
    log("= LendingPool is already the Yield Pool: initializeYieldPool has run, and is not run again");
  } else {
    if (!ethers.isAddress(o.controls) || (await ethers.provider.getCode(o.controls)) === "0x") {
      throw new Error(`EarnControls ${o.controls} is not a contract: run deploy 26 first.`);
    }
    if (!ethers.isAddress(o.deploymentAccount) || o.deploymentAccount === ethers.ZeroAddress) {
      throw new Error("Set CLEAR_LENDING_ACCOUNT to Clear Lending's lending account (owner to confirm).");
    }
    const shares: bigint = await legacy.totalSupply();
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    if (shares > 0n && (o.initialClosing === 0n || o.initialClosing > now)) {
      throw new Error("The pool has shares: set INITIAL_CLOSING to the first issue of Pool Shares, as unix seconds no later than now (owner to confirm).");
    }
    if (shares === 0n && o.initialClosing !== 0n) throw new Error("The pool has no shares: INITIAL_CLOSING must be 0.");
    const init = LendingPool.interface.encodeFunctionData("initializeYieldPool", [o.controls, o.deploymentAccount, o.initialClosing]);
    log(`  initializeYieldPool(${o.controls}, ${o.deploymentAccount}, ${o.initialClosing})`);
    if (o.dryRun) {
      log("\nDry run: validated, nothing deployed or sent. YIELD_POOL_UPGRADE=1 to carry it out.");
      return { implementation, upgraded, proposals };
    }
    const opts = await poolProxyOptions(signer);
    if (admin) {
      await (await upgrades.upgradeProxy(o.proxy, LendingPool, { ...opts, call: { fn: "initializeYieldPool", args: [o.controls, o.deploymentAccount, o.initialClosing] } })).waitForDeployment();
      implementation = await upgrades.erc1967.getImplementationAddress(o.proxy);
      upgraded = true;
      log(`+ LendingPool upgraded to the Yield Pool: implementation ${implementation}`);
    } else {
      implementation = (await upgrades.prepareUpgrade(o.proxy, LendingPool, opts)) as string;
      log(`+ implementation deployed: ${implementation} (the signer is not the pool's admin; nothing upgraded)`);
      proposals.push({ via, target: o.proxy, data: LendingPool.interface.encodeFunctionData("upgradeToAndCall", [implementation, init]), what: "upgradeToAndCall(impl, initializeYieldPool(…))" });
    }
  }

  if (o.dryRun) return { implementation, upgraded, proposals };
  const pool = await poolAt(o.proxy, signer);
  if (upgraded || already) {
    if ((await pool.legend()) === "") {
      if (admin) {
        await (await pool.setLegend(POOL_SHARE_LEGEND)).wait();
        log("  legend set (IV-02 §8.4)");
      } else {
        proposals.push({ via, target: o.proxy, data: pool.interface.encodeFunctionData("setLegend", [POOL_SHARE_LEGEND]), what: "setLegend(IV-02 §8.4's legend)" });
      }
    }
    log((await poolTierStep(pool, o.poolTierPrincipal, o.poolTierEvidence)).line);
    if (o.network) saveDeployment(o.network, "LendingPool", o.proxy, await poolAbi());
  } else {
    proposals.push({ via, target: o.proxy, data: pool.interface.encodeFunctionData("setLegend", [POOL_SHARE_LEGEND]), what: "after the upgrade: setLegend(IV-02 §8.4's legend)" });
    log("! After the upgrade, two VALUATION_ROLE signers post the Pool Tier principal (postPoolTierPrincipal) before the first Deployment.");
  }
  if (proposals.length > 0) {
    log("\nPropose:");
    printProposals(proposals, log);
  }
  return { implementation, upgraded, proposals };
}

async function main() {
  const { ethers } = require("hardhat");
  const network = (await ethers.provider.getNetwork()).name;
  requireMainnetConfirmation(network, "scripts/upgrade_yield_pool.ts (on mainnet the pool is deployed fresh)");
  const pool = getDeployment(network, "LendingPool");
  if (!pool) throw new Error(`No LendingPool recorded for ${network}: on a fresh chain deploy 22 deploys the Yield Pool itself.`);
  const controls = process.env.EARN_CONTROLS?.trim() || getDeployment(network, "EarnControls")?.address;
  if (!controls) throw new Error(`No EarnControls recorded for ${network}: run deploy 26 first.`);
  await upgradeToYieldPool({
    proxy: pool.address,
    controls,
    deploymentAccount: process.env.CLEAR_LENDING_ACCOUNT?.trim() ?? "",
    initialClosing: BigInt(process.env.INITIAL_CLOSING?.trim() || "0"),
    dryRun: process.env.YIELD_POOL_UPGRADE !== "1",
    network,
    poolTierPrincipal: process.env.POOL_TIER_PRINCIPAL ? BigInt(process.env.POOL_TIER_PRINCIPAL) : undefined,
    poolTierEvidence: process.env.POOL_TIER_EVIDENCE,
  });
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
