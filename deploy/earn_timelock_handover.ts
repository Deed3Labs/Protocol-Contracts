/**
 * The Earn timelock handover (Phase 2f, decision 2, which overrides DECISIONS #10 for Earn).
 *
 * A fifth TimelockController, beside the Deed, credit, Assurance and vault timelocks: minimum delay
 * 7 days, a Clear Lending Safe (two of N) proposing and executing, no admin, so the delay itself
 * changes only through a delayed proposal. It governs the Earn contracts, kept apart from the
 * credit timelock (`credit_timelock_handover.ts`, which no longer lists LendingPool).
 *
 * What moves to the timelock:
 * - LendingPool (the Yield Pool): DEFAULT_ADMIN_ROLE, which authorizes its upgrades
 *   (`_authorizeUpgrade`) and every governed setting, including those of its valuation module.
 * - YieldPoolValuation and YieldPoolLedger: nothing. They are stateless delegatecall modules pinned
 *   in LendingPool's constructor (the ledger through the valuation module); they have no admin, no
 *   roles and no upgrade of their own (a new module needs a new LendingPool implementation, which
 *   is a LendingPool upgrade).
 * - EarnControls: DEFAULT_ADMIN_ROLE (upgrades and every governed setting). Its roles are granted
 *   only with a Lending Board resolution hash (`grantRoleByResolution`), so the handover needs one
 *   (`resolutionHash`). Its module EarnControlsAdmin, like the pool's, has nothing of its own.
 * - BondVault (Phase 2f stage 2, decision 2, moved from the credit handover): DEFAULT_ADMIN_ROLE. Once
 *   the Collateral Agent is named on it, every role grant needs the Agent's co-signature, so the
 *   timelock's grant is made before `setEarnSources` names the Agent (deploy/23 does it in that
 *   order); afterwards it can only be a co-signed change, and this script stops and says so.
 * - The bond collections (BurnerBond clones, Ownable): ownership, which sets their sources, the
 *   liquidator, the first id and display traits. Their governed changes also need the Agent's
 *   co-signature once it is named on them.
 * - HolderDirections: nothing. It has no admin, no roles and no upgrade (decision 30).
 * - CollateralAgent: DEFAULT_ADMIN_ROLE. It is initialized with the timelock as admin, because
 *   every role grant there needs the Agent's co-signature (IV-10 Exhibit A, Part 2 item 6) and the
 *   deployer could never hand it over alone. The handover only checks it.
 *
 * Every other role the deployer holds on these contracts is renounced; operational keys
 * (DEPLOYER_ROLE, VALUATION_ROLE, SUSPENSION_ROLE, CCO_ROLE, TREASURER_ROLE, ENFORCER_ROLE on the
 * pool; ATTESTER_ROLE, PAUSE_ROLE, SUCCESSOR_ROLE, ELIGIBILITY_ROLE, BOND_ROLE, LADDER_ROLE on the controls)
 * are granted to their holders before this runs. Afterwards only the Clear Lending Safe, through
 * the 7-day delay, can grant or revoke any of them.
 *
 * Member exits stay open during a pending change: redemptions, queue fills, holdback releases and
 * bond settlements are not gated by the timelock.
 *
 * This module only builds transactions from the signer it is given. It never reads a key, and it
 * has never been run against a network.
 *
 *   CLEAR_LENDING_SAFE=0x... EARN_RESOLUTION=0x... EARN_HANDOVER=1 \
 *     npx hardhat run deploy/earn_timelock_handover.ts --network base-sepolia
 */
import { assertTwoPersonSafe } from "./vault_timelock_handover";

export const EARN_TIMELOCK_DELAY = 7 * 24 * 60 * 60;
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface EarnContracts {
  /** LendingPool, the Yield Pool. */
  lendingPool?: any;
  /** EarnControls, with the joined ABI (`earnControlsAt`). */
  earnControls?: any;
  collateralAgent?: any;
  /** The BondVault (Phase 2f stage 2). */
  bondVault?: any;
  /** The bond collections (BurnerBond clones). */
  bondCollections?: any[];
}

const POOL_ROLES = [
  "OPERATOR_ROLE", "BORROWER_ROLE", "LOSS_REPORTER_ROLE", "LIQUIDATOR_ROLE", "VALUATION_ROLE", "DEPLOYER_ROLE",
  "SUSPENSION_ROLE", "CCO_ROLE", "TREASURER_ROLE", "ENFORCER_ROLE",
];
const CONTROLS_ROLES = ["ATTESTER_ROLE", "PAUSE_ROLE", "SUCCESSOR_ROLE", "ELIGIBILITY_ROLE", "BOND_ROLE", "LADDER_ROLE"];
const AGENT_ROLES = ["TREASURY_ROLE"];
const VAULT_ROLES = ["OPERATOR_ROLE", "BOND_ROLE", "TREASURY_ROLE"];

async function send(txp: Promise<any>) {
  await (await txp).wait();
}

async function hashes(ct: any, names: string[]) {
  const out: [string, string][] = [];
  for (const n of names) out.push([n, await ct[n]()]);
  return out;
}

/** Deploys the Earn TimelockController with `safe` proposing and executing, and no admin. */
export async function deployEarnTimelock(safe: string, delay = EARN_TIMELOCK_DELAY) {
  const { ethers } = require("hardhat");
  if (delay < EARN_TIMELOCK_DELAY) throw new Error("The Earn timelock delay must be at least 7 days.");
  const F = await ethers.getContractFactory("TimelockController");
  const timelock = await F.deploy(delay, [safe], [safe], ethers.ZeroAddress);
  await timelock.waitForDeployment();
  return timelock;
}

/**
 * Moves DEFAULT_ADMIN_ROLE on the Earn contracts to `timelock` and renounces every role the deployer
 * holds on them. `resolutionHash` is the Lending Board resolution recorded with EarnControls' grant.
 */
export async function handOverEarn(
  c: EarnContracts,
  deployerSigner: any,
  timelock: string,
  resolutionHash: string,
  log: (m: string) => void = () => {}
) {
  const me = await deployerSigner.getAddress();

  if (c.lendingPool) {
    const p = c.lendingPool;
    if (!(await p.hasRole(ZERO, timelock))) await send(p.grantRole(ZERO, timelock));
    for (const [, h] of await hashes(p, POOL_ROLES)) if (await p.hasRole(h, me)) await send(p.renounceRole(h, me));
    // DEFAULT_ADMIN_ROLE last: renouncing it first would leave nothing able to finish.
    if (await p.hasRole(ZERO, me)) await send(p.renounceRole(ZERO, me));
    log("lendingPool: admin -> Earn timelock; the deployer holds no pool role");
  }

  if (c.earnControls) {
    const e = c.earnControls;
    if (!(await e.hasRole(ZERO, timelock))) {
      if (!resolutionHash || resolutionHash === ZERO) throw new Error("EarnControls grants need the Lending Board resolution hash.");
      await send(e.grantRoleByResolution(ZERO, timelock, resolutionHash));
    }
    for (const [, h] of await hashes(e, CONTROLS_ROLES)) if (await e.hasRole(h, me)) await send(e.renounceRole(h, me));
    if (await e.hasRole(ZERO, me)) await send(e.renounceRole(ZERO, me));
    log("earnControls: admin -> Earn timelock; the deployer holds no controls role");
  }

  if (c.collateralAgent) {
    const a = c.collateralAgent;
    if (!(await a.hasRole(ZERO, timelock))) {
      throw new Error(
        "CollateralAgent's admin is not the Earn timelock. It is set at initialization; a later grant is a change " +
          "that needs two treasury signers, the Agent's co-signature and 7 days."
      );
    }
    // Renouncing narrows; it needs no co-signature.
    for (const [, h] of await hashes(a, AGENT_ROLES)) if (await a.hasRole(h, me)) await send(a.renounceRole(h, me));
    if (await a.hasRole(ZERO, me)) await send(a.renounceRole(ZERO, me));
    log("collateralAgent: admin is the Earn timelock; the deployer holds no role");
  }

  if (c.bondVault) {
    const v = c.bondVault;
    if (!(await v.hasRole(ZERO, timelock))) {
      if ((await v.agent()) !== "0x0000000000000000000000000000000000000000") {
        throw new Error(
          "BondVault's admin is not the Earn timelock and the Collateral Agent is already named on it: the grant is " +
            "now a change that needs two treasury signers, the Agent's co-signature and 7 days."
        );
      }
      await send(v.grantRole(ZERO, timelock));
    }
    // Renouncing narrows; it needs no co-signature.
    for (const [, h] of await hashes(v, VAULT_ROLES)) if (await v.hasRole(h, me)) await send(v.renounceRole(h, me));
    if (await v.hasRole(ZERO, me)) await send(v.renounceRole(ZERO, me));
    log("bondVault: admin -> Earn timelock; the deployer holds no vault role");
  }

  for (const b of c.bondCollections ?? []) {
    if ((await b.owner()) === me) await send(b.transferOwnership(timelock));
    log(`bond collection ${await b.getAddress()}: owner -> Earn timelock`);
  }

  await assertNoEarnAdmin(c, me, timelock);
}

/**
 * Where the credit timelock already holds LendingPool's admin (it was in the credit handover until
 * Phase 2f): the batch the Ops Safe schedules on the credit timelock to pass it to the Earn
 * timelock. The credit timelock renounces its own role last, inside the same batch.
 */
export async function creditToEarnCalls(lendingPool: any, earnTimelock: string, creditTimelock: string) {
  const target = await lendingPool.getAddress();
  return {
    targets: [target, target],
    values: [0n, 0n],
    payloads: [
      lendingPool.interface.encodeFunctionData("grantRole", [ZERO, earnTimelock]),
      lendingPool.interface.encodeFunctionData("renounceRole", [ZERO, creditTimelock]),
    ],
  };
}

/** Throws if `account` holds any role on an Earn contract, or the timelock is not what it must be. */
export async function assertNoEarnAdmin(c: EarnContracts, account: string, timelock?: string) {
  const left: string[] = [];
  const check = async (name: string, ct: any, roles: string[]) => {
    if (!ct) return;
    if (await ct.hasRole(ZERO, account)) left.push(`${name}.DEFAULT_ADMIN_ROLE`);
    for (const [n, h] of await hashes(ct, roles)) if (await ct.hasRole(h, account)) left.push(`${name}.${n}`);
    if (timelock && !(await ct.hasRole(ZERO, timelock))) left.push(`${name}: the Earn timelock is not admin`);
  };
  await check("lendingPool", c.lendingPool, POOL_ROLES);
  await check("earnControls", c.earnControls, CONTROLS_ROLES);
  await check("collateralAgent", c.collateralAgent, AGENT_ROLES);
  await check("bondVault", c.bondVault, VAULT_ROLES);
  for (const b of c.bondCollections ?? []) {
    const owner = await b.owner();
    if (owner === account || (timelock && owner !== timelock)) left.push(`bond collection ${await b.getAddress()}: owner is not the Earn timelock`);
  }
  if (timelock) {
    const { ethers } = require("hardhat");
    const tl = await ethers.getContractAt("TimelockController", timelock);
    if ((await tl.getMinDelay()) < BigInt(EARN_TIMELOCK_DELAY)) left.push("Earn timelock delay under 7 days");
    if (await tl.hasRole(await tl.TIMELOCK_ADMIN_ROLE(), account)) left.push("Earn timelock admin");
  }
  if (left.length > 0) throw new Error(`Earn handover incomplete: ${left.join(", ")}`);
}

async function main() {
  const { ethers } = require("hardhat");
  const { getDeployment, saveDeployment } = require("./helpers");
  const { earnControlsAt } = require("./earnModules");
  if (process.env.EARN_HANDOVER !== "1") {
    throw new Error("Set EARN_HANDOVER=1 to confirm: this moves every Earn admin power to a 7-day timelock.");
  }
  const safe = process.env.CLEAR_LENDING_SAFE;
  if (!safe || !ethers.isAddress(safe)) throw new Error("CLEAR_LENDING_SAFE must be the Clear Lending Co. Safe address.");
  const resolution = process.env.EARN_RESOLUTION ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(resolution)) throw new Error("EARN_RESOLUTION must be the Lending Board resolution hash.");
  const { threshold, owners } = await assertTwoPersonSafe(safe);
  console.log(`Clear Lending Safe ${safe}: ${threshold} of ${owners.length}`);
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;

  let timelockAddress = getDeployment(network, "EarnTimelock")?.address;
  if (!timelockAddress) {
    const t = await deployEarnTimelock(safe);
    timelockAddress = await t.getAddress();
    saveDeployment(network, "EarnTimelock", timelockAddress, JSON.parse(t.interface.formatJson()));
    console.log(`+ EarnTimelock deployed to ${timelockAddress}`);
  }
  const record = (name: string) => getDeployment(network, name)?.address;
  const c: EarnContracts = {
    lendingPool: record("LendingPool") ? await ethers.getContractAt("LendingPool", record("LendingPool")) : undefined,
    earnControls: record("EarnControls") ? await earnControlsAt(record("EarnControls"), deployer) : undefined,
    collateralAgent: record("CollateralAgent") ? await ethers.getContractAt("CollateralAgent", record("CollateralAgent")) : undefined,
    bondVault: record("BondVault") ? await ethers.getContractAt("BondVault", record("BondVault")) : undefined,
    bondCollections: record("BurnerBond") ? [await ethers.getContractAt("BurnerBond", record("BurnerBond"))] : [],
  };
  await handOverEarn(c, deployer, timelockAddress!, resolution, console.log);
  console.log("\nEarn handover done. The deployer holds no Earn role.");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
