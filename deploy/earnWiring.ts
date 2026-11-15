// Uses the Hardhat runtime of whatever is calling (a test or a deploy script). Never run against a
// network as part of this change.
import type { Proposal } from "./creditWiring";

/*
 * Phase 2f stage 3: two pieces of Earn wiring that `deploy/26_deploy_EarnControls.ts` runs.
 *
 * 1. The refused payers (Earn §1; IV-02 §2.4: "The Vault rejects payment from any Clear contract
 *    holding ESA capital, collateral, credit or Earn funds"). `EarnControls.refused` is checked for
 *    the payer and the receiver of every Yield Pool subscription (`checkSubscription`) and every bond
 *    purchase (`checkPurchase`), so no Clear contract can pay for, or be issued, an Earn Product.
 *    The list is every Clear contract the requirements and the earlier reports name (see
 *    `REFUSED_RECORDS`), plus every bond collection the factories have made.
 *
 * 2. The Collateral Agent's pledge module (decision 19; `IAgentPledgeModule`). The Liquidator
 *    answers `enforcementPermitted`, `defaultedAmountOf` and `applyDistribution` (in its
 *    LiquidatorEnforcement module), so the Agent's `pledgeModule` is the Liquidator's proxy.
 *    `CollateralAgent.setPledgeModule` is a co-signed change (IV-10 Exhibit A, Part 2 item 6): two
 *    treasury signers propose and confirm it, the Agent Key co-signs it, 7 days pass, and the Agent's
 *    admin (the Earn timelock) makes the call. No key here can do any of that, so the script prints
 *    the steps. The Liquidator needs nothing set about the Agent: it accepts `applyDistribution`
 *    only from the Agent the bond collection names (`BurnerBond.agent()`), which deploy 23 sets.
 */

/** The deployment records of Clear contracts refused as Earn payers or receivers, and why. */
export const REFUSED_RECORDS: { name: string; why: string }[] = [
  // ESA capital (IV-02 §2.4; MB-02)
  { name: "ESADepositVault", why: "ESA capital" },
  { name: "ESADepositVaultLegacy", why: "ESA capital" },
  { name: "ClearUSD", why: "CLRUSD (ESA capital)" },
  { name: "ClearUSDUpgradeable", why: "CLRUSD (ESA capital)" },
  { name: "CLRUSDTokenPool", why: "CLRUSD bridge pool (ESA capital)" },
  { name: "SavingsIntentFactory", why: "savings deposits in flight (ESA capital)" },
  { name: "ClaimEscrow", why: "ESA claims" },
  // Collateral and its enforcement (MB-05; IV-10)
  { name: "CollateralRegistry", why: "collateral" },
  { name: "Liquidator", why: "collateral enforcement (the pledge module)" },
  { name: "PoolShareEnforcer", why: "collateral enforcement" },
  { name: "CollateralAgent", why: "collateral (IV-10)" },
  { name: "HolderDirections", why: "Earn (Required-Holder Directions)" },
  // Credit
  { name: "ClearCredit", why: "credit (the ledger)" },
  { name: "RevolvingIssuer", why: "credit" },
  { name: "TermIssuer", why: "credit" },
  { name: "OffersIssuer", why: "credit" },
  { name: "PayoutPool", why: "credit (merchant payouts)" },
  // The credit stack retired on Base Sepolia (decision 47; deploy/retire_credit_stack.ts): still on
  // chain, and the old ledger, issuers, PayoutPool and Liquidator may still hold credit or collateral.
  { name: "ClearCreditPreAudit", why: "credit (the retired ledger)" },
  { name: "RevolvingIssuerPreAudit", why: "credit (retired)" },
  { name: "TermIssuerPreAudit", why: "credit (retired)" },
  { name: "OffersIssuerPreAudit", why: "credit (retired)" },
  { name: "PayoutPoolPreAudit", why: "credit (the retired merchant payouts)" },
  { name: "CollateralRegistryPreAudit", why: "collateral (retired)" },
  { name: "LiquidatorPreAudit", why: "collateral enforcement (retired)" },
  // Earn funds
  { name: "LendingPool", why: "Earn funds (the Yield Pool)" },
  { name: "BondVault", why: "Earn funds" },
  { name: "BurnerBond", why: "Earn funds (a bond collection)" },
  { name: "BurnerBondLegacy", why: "Earn funds (a pre-2f bond collection)" },
  { name: "BurnerBondDeposit", why: "Earn funds (the pre-2f deposit path)" },
  { name: "BurnerBondDepositLegacy", why: "Earn funds (the pre-2f deposit path)" },
  { name: "BurnerBondPre2f", why: "Earn funds (a pre-2f bond collection, kept by deploy 22)" },
  { name: "BurnerBondDepositPre2f", why: "Earn funds (the pre-2f deposit path)" },
  // The Assurance compartments
  { name: "AssurancePool", why: "the Assurance compartments" },
  { name: "AssurancePoolV2", why: "the Assurance compartments" },
];

/** The bond factories whose every collection is refused. */
export const BOND_FACTORY_RECORDS = ["BurnerBondFactory", "BurnerBondFactoryPre2f", "BurnerBondFactoryLegacy"];

export interface RefusedEntry {
  name: string;
  address: string;
  why: string;
}

/**
 * The Clear contracts to refuse on `network`: each recorded `REFUSED_RECORDS` address, and every
 * collection of each recorded bond factory. `lookup` returns a record's address (the deploy scripts
 * pass `getDeployment`), so a test can supply its own.
 */
export async function clearContractsToRefuse(lookup: (name: string) => string | undefined): Promise<RefusedEntry[]> {
  const { ethers } = require("hardhat");
  const out: RefusedEntry[] = [];
  const seen = new Set<string>();
  const add = (name: string, address: string | undefined, why: string) => {
    if (!address || address === ethers.ZeroAddress || seen.has(address.toLowerCase())) return;
    seen.add(address.toLowerCase());
    out.push({ name, address, why });
  };
  for (const r of REFUSED_RECORDS) add(r.name, lookup(r.name), r.why);
  for (const f of BOND_FACTORY_RECORDS) {
    const address = lookup(f);
    if (!address) continue;
    const factory = await ethers.getContractAt("BurnerBondFactory", address);
    const n = Number(await factory.getCollectionCount());
    for (let i = 0; i < n; i++) {
      const info = await factory.getCollectionAtIndex(i);
      add(`${f} collection ${info.tokenSymbol || i}`, info.collectionAddress, "Earn funds (a bond collection)");
      add(`${f} deposit contract ${info.tokenSymbol || i}`, info.depositContract, "Earn funds (the pre-2f deposit path)");
    }
  }
  return out;
}

/**
 * Refuses each entry on EarnControls that is not refused yet. While `sender` holds the controls'
 * admin role (before `earn_timelock_handover.ts`) it calls `setRefused`; afterwards it returns the
 * calls for the Earn timelock to propose. Never un-refuses anything.
 */
export async function refuseClearContracts(controls: any, entries: RefusedEntry[], sender: any, log = console.log) {
  const admin = await controls.hasRole("0x" + "00".repeat(32), sender.address);
  const proposals: { target: string; data: string; name: string }[] = [];
  for (const e of entries) {
    if (await controls.refused(e.address)) continue;
    if (admin) {
      await (await controls.connect(sender).setRefused(e.address, true)).wait();
      log(`  EarnControls refused: ${e.name} ${e.address} (${e.why})`);
    } else {
      const data = controls.interface.encodeFunctionData("setRefused", [e.address, true]);
      proposals.push({ target: await controls.getAddress(), data, name: e.name });
      log(`  ! Earn timelock: setRefused(${e.address}, true) for ${e.name} (${e.why}); calldata ${data}`);
    }
  }
  return proposals;
}

/**
 * The co-signed change that names `module` as the Agent's pledge module: the call the Agent's admin
 * makes, its hash (what the treasury signers propose) and the steps, in order.
 */
export async function pledgeModuleChange(agent: any, module: string) {
  const { ethers } = require("hardhat");
  const target = await agent.getAddress();
  const data: string = agent.interface.encodeFunctionData("setPledgeModule", [module]);
  const callHash: string = ethers.keccak256(data);
  const descriptionHash: string = ethers.id(`CollateralAgent.setPledgeModule(${module}): the Liquidator answers IAgentPledgeModule (decision 19)`);
  return {
    target,
    data,
    callHash,
    descriptionHash,
    steps: [
      `treasury signer 1: CollateralAgent.proposeChange(${target}, ${callHash}, ${descriptionHash})`,
      "treasury signer 2 (a different one): CollateralAgent.confirmChange(<changeId from ChangeProposed or openChangeFor>)",
      "Agent Key: CollateralAgent.approveChange(<changeId>)",
      `after 7 days from the confirmation, the Earn timelock (its admin) calls ${target} with ${data}`,
    ],
  };
}

/*
 * 3. The Yield Pool and EarnControls, wired to each other (DEPLOY-RUNBOOK §5.2 item 4). EarnControls
 *    reads the pool as `yieldPool` (the Funding Limit counts pool shares at Share Value); the pool
 *    checks every subscription against `earnControls`. An upgraded pool is named on itself by
 *    `initializeYieldPool`; a fresh pool (mainnet) by `setEarnControls`. Both are DEFAULT_ADMIN_ROLE
 *    settings: the deployer's before `earn_timelock_handover.ts`, afterwards Earn timelock proposals.
 *
 * 4. The Earn operational roles, from `deploy/config/earn-roles.json` (DEPLOY-RUNBOOK §2.1 and
 *    §5.2 item 4; PHASE-2F-YIELD-POOL.md §9; PHASE-2F-EARN-CONTROLS.md §4; PHASE-2F-BONDS.md §6;
 *    PHASE-2F-INTEGRATION.md §6 and §7). No holder is invented here: an unset list stops the script
 *    with "owner to fill". No new role and no admin power: these are roles the contracts already
 *    define, granted by their existing admin.
 */

/** Each Earn role's minimum number of distinct holders (DEPLOY-RUNBOOK §2.1). */
export const EARN_ROLE_MINIMUMS: Record<"LendingPool" | "EarnControls", Record<string, number>> = {
  LendingPool: { DEPLOYER_ROLE: 2, VALUATION_ROLE: 2, SUSPENSION_ROLE: 1, CCO_ROLE: 1, TREASURER_ROLE: 1 },
  EarnControls: {
    ATTESTER_ROLE: 1,
    PAUSE_ROLE: 2,
    SUCCESSOR_ROLE: 2,
    ELIGIBILITY_ROLE: 2,
    LADDER_ROLE: 2,
    FUNDING_ROLE: 2,
    WIND_DOWN_ROLE: 2,
    ROLL_NOTICE_ROLE: 1,
    EXCLUDED_HOLDER_ROLE: 0,
  },
};

export interface EarnRoleConfig {
  LendingPool: Record<string, string[] | null | undefined>;
  EarnControls: Record<string, string[] | null | undefined>;
  /** Old LendingPool BORROWER_ROLE holders to revoke (decision 17). */
  revokeBorrowers?: string[];
}

export const EARN_ROLES_FILE = "deploy/config/earn-roles.json";

/** The role holders configured for `network`, or an "owner to fill" error. */
export function loadEarnRoles(network: string, file = EARN_ROLES_FILE): EarnRoleConfig {
  const fs = require("fs");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  const cfg = all.networks?.[network];
  if (!cfg) throw new Error(`Owner to fill: ${file} has no entry for ${network} (networks.${network}).`);
  return cfg;
}

/** What is wrong with a role configuration; empty when it can be granted as it stands. */
export function earnRoleProblems(cfg: EarnRoleConfig, where = EARN_ROLES_FILE): string[] {
  const { ethers } = require("hardhat");
  const problems: string[] = [];
  const holders = (contract: "LendingPool" | "EarnControls", role: string): string[] => {
    const list = cfg[contract]?.[role];
    const min = EARN_ROLE_MINIMUMS[contract][role];
    if (list === null || list === undefined) {
      problems.push(`owner to fill: ${where} ${contract}.${role} (at least ${min} address${min === 1 ? "" : "es"}; [] only if none)`);
      return [];
    }
    const bad = list.filter((a) => !ethers.isAddress(a) || ethers.getAddress(a) === ethers.ZeroAddress);
    if (bad.length > 0) problems.push(`${where} ${contract}.${role}: not an address: ${bad.join(", ")}`);
    const distinct = [...new Set(list.filter((a) => ethers.isAddress(a)).map((a) => ethers.getAddress(a) as string))];
    if (distinct.length < min) problems.push(`${where} ${contract}.${role}: needs at least ${min} different addresses, has ${distinct.length}`);
    return distinct;
  };
  const pool: Record<string, string[]> = {};
  for (const role of Object.keys(EARN_ROLE_MINIMUMS.LendingPool)) pool[role] = holders("LendingPool", role);
  for (const role of Object.keys(EARN_ROLE_MINIMUMS.EarnControls)) holders("EarnControls", role);
  // Valuation is deliberately apart from Deployment (PHASE-2F-YIELD-POOL.md §9).
  const both = pool.VALUATION_ROLE.filter((a) => pool.DEPLOYER_ROLE.includes(a));
  if (both.length > 0) problems.push(`${where} LendingPool: ${both.join(", ")} would hold both VALUATION_ROLE and DEPLOYER_ROLE`);
  // A Suspension or legal hold takes two different people, one of them the CCO or the treasurer.
  const officers = new Set([...pool.SUSPENSION_ROLE, ...pool.CCO_ROLE, ...pool.TREASURER_ROLE]);
  if (pool.SUSPENSION_ROLE.length && pool.CCO_ROLE.length && pool.TREASURER_ROLE.length && officers.size < 2) {
    problems.push(`${where} LendingPool: SUSPENSION_ROLE, CCO_ROLE and TREASURER_ROLE need two different people between them`);
  }
  for (const a of cfg.revokeBorrowers ?? []) if (!ethers.isAddress(a)) problems.push(`${where} revokeBorrowers: not an address: ${a}`);
  return problems;
}

/**
 * Grants every configured Earn role to its holders: on the pool with `grantRole`, on EarnControls
 * with `grantRoleByResolution(role, holder, resolution)`. Refuses, granting nothing, while the
 * configuration has a problem. Returns the grants the sender cannot make itself (after the Earn
 * handover) as Earn timelock proposals.
 */
export async function grantEarnRoles(
  c: { pool?: any; controls?: any },
  cfg: EarnRoleConfig,
  resolution: string,
  sender: any,
  log: (m: string) => void = console.log,
  where = EARN_ROLES_FILE
) {
  const { ethers } = require("hardhat");
  const { VIA } = require("./creditWiring");
  const problems = earnRoleProblems(cfg, where);
  if (problems.length > 0) throw new Error(`Earn role holders are not configured; nothing was granted:\n  ${problems.join("\n  ")}`);
  if (c.controls && (!/^0x[0-9a-fA-F]{64}$/.test(resolution ?? "") || BigInt(resolution) === 0n)) {
    throw new Error("Set EARN_RESOLUTION to the Lending Board resolution hash: EarnControls grants a role only with one.");
  }
  const me = await sender.getAddress();
  const proposals: { via: string; target: string; data: string; what: string }[] = [];
  const run = async (contract: any, label: string, fn: string, roles: Record<string, string[] | null | undefined>, extra: unknown[]) => {
    const ct = contract.connect(sender);
    for (const [role, list] of Object.entries(roles)) {
      const hash = ethers.id(role);
      const canGrant: boolean = await ct.hasRole(await ct.getRoleAdmin(hash), me);
      for (const who of [...new Set((list ?? []).map((a) => ethers.getAddress(a) as string))]) {
        if (await ct.hasRole(hash, who)) continue;
        const args = [hash, who, ...extra];
        if (canGrant) {
          await (await ct[fn](...args)).wait();
          log(`  ${label} ${role} -> ${who}`);
        } else {
          proposals.push({ via: VIA.earn, target: await ct.getAddress(), data: ct.interface.encodeFunctionData(fn, args), what: `${label} ${role} -> ${who}` });
        }
      }
    }
  };
  if (c.pool) await run(c.pool, "LendingPool", "grantRole", cfg.LendingPool, []);
  if (c.controls) await run(c.controls, "EarnControls", "grantRoleByResolution", cfg.EarnControls, [resolution]);
  return proposals;
}

/**
 * Revokes the pool roles that decision 17 and C5 retired: BORROWER_ROLE (only Clear Lending draws,
 * as a recorded Deployment) and the old seizure grant, LIQUIDATOR_ROLE. Deploy 25 revokes the
 * recorded Liquidator's; this covers the PayoutPool and Liquidator retired with the old credit
 * stack and the configured borrowers (the card settler). A revocation only narrows.
 */
export async function revokeRetiredPoolRoles(
  pool: any,
  holders: { borrowers?: string[]; liquidators?: string[] },
  sender: any,
  log: (m: string) => void = console.log
) {
  const { ethers } = require("hardhat");
  const { VIA } = require("./creditWiring");
  const ct = pool.connect(sender);
  const admin: boolean = await ct.hasRole(ethers.ZeroHash, await sender.getAddress());
  const proposals: { via: string; target: string; data: string; what: string }[] = [];
  const lists: [string, string[]][] = [["BORROWER_ROLE", holders.borrowers ?? []], ["LIQUIDATOR_ROLE", holders.liquidators ?? []]];
  for (const [role, list] of lists) {
    const hash = ethers.id(role);
    for (const who of [...new Set(list.filter(Boolean).map((a) => ethers.getAddress(a) as string))]) {
      if (!(await ct.hasRole(hash, who))) continue;
      if (admin) {
        await (await ct.revokeRole(hash, who)).wait();
        log(`  LendingPool ${role} revoked from ${who}`);
      } else {
        proposals.push({ via: VIA.earn, target: await ct.getAddress(), data: ct.interface.encodeFunctionData("revokeRole", [hash, who]), what: `LendingPool ${role} revoked from ${who}` });
      }
    }
  }
  return proposals;
}

/**
 * EarnControls' `yieldPool` source and the pool's `earnControls`, each set to the other where it is
 * not already. EarnControls' other sources are kept as they are. `pool` has the joined ABI (`poolAt`)
 * and `controls` the joined one (`earnControlsAt`).
 */
export async function wireEarnControlsToPool(controls: any, pool: any, sender: any, log: (m: string) => void = console.log) {
  const { ethers } = require("hardhat");
  const { VIA } = require("./creditWiring");
  const me = await sender.getAddress();
  const proposals: { via: string; target: string; data: string; what: string }[] = [];
  const c = controls.connect(sender);
  const p = pool.connect(sender);
  const poolAddress = ethers.getAddress(await p.getAddress());
  const controlsAddress = ethers.getAddress(await c.getAddress());

  if (ethers.getAddress(await p.earnControls()) !== controlsAddress) {
    if (await p.hasRole(ethers.ZeroHash, me)) {
      await (await p.setEarnControls(controlsAddress)).wait();
      log(`  LendingPool earnControls -> EarnControls ${controlsAddress}`);
    } else {
      proposals.push({ via: VIA.earn, target: poolAddress, data: p.interface.encodeFunctionData("setEarnControls", [controlsAddress]), what: "LendingPool.setEarnControls(EarnControls)" });
    }
  }
  if (ethers.getAddress(await c.yieldPool()) !== poolAddress) {
    const args = [await c.membership(), poolAddress, await c.reserveStatus(), await c.collateralAgent(), await c.reserveHook()];
    if (await c.hasRole(ethers.ZeroHash, me)) {
      await (await c.setSources(...args)).wait();
      log(`  EarnControls yieldPool -> LendingPool ${poolAddress}`);
    } else {
      proposals.push({ via: VIA.earn, target: controlsAddress, data: c.interface.encodeFunctionData("setSources", args), what: "EarnControls.setSources(membership, LendingPool, reserveStatus, collateralAgent, reserveHook)" });
    }
  }
  return proposals;
}

/**
 * IV-02 §4.3 and the decisions file's "Base Sepolia redeploy steps": before the first Deployment,
 * two different VALUATION_ROLE signers each call `postPoolTierPrincipal(value, evidenceHash)`. No
 * key here is a valuation signer, so this only reports, and gives the call they make.
 */
export async function poolTierStep(pool: any, value?: bigint, evidenceHash?: string) {
  const [posted, postedAt] = await pool.poolTierPrincipal();
  if (postedAt !== 0n) return { posted: true, line: `= Pool Tier principal posted: ${posted} (at ${postedAt})`, data: undefined as string | undefined };
  const ready = value !== undefined && !!evidenceHash && /^0x[0-9a-fA-F]{64}$/.test(evidenceHash) && BigInt(evidenceHash) !== 0n;
  const data: string | undefined = ready ? pool.interface.encodeFunctionData("postPoolTierPrincipal", [value, evidenceHash]) : undefined;
  const line = ready
    ? `! Pool Tier principal not posted. No Deployment is possible until two different VALUATION_ROLE signers each send to ${await pool.getAddress()}: ${data}`
    : "! Pool Tier principal not posted: no Deployment is possible until two different VALUATION_ROLE signers each call " +
      "postPoolTierPrincipal(value, evidenceHash). Set POOL_TIER_PRINCIPAL (in the reserve token's units) and POOL_TIER_EVIDENCE to print the call.";
  return { posted: false, line, data };
}

/*
 * 5. Decision 48: the BondVault's links to retired contracts.
 *
 *    (a) Its `payoutPool` backstop still names the PayoutPool retired with the old credit stack.
 *        Once `lentToPayoutPool` is zero, `setBackstops(treasury, address(0))` keeps the treasury and
 *        clears the payout pool; while a loan is open the vault itself refuses the change
 *        (`BondVaultLoanOutstanding`), and so does this script, saying the old PayoutPool must repay
 *        through `repayFromPayoutPool` first.
 *    (b) No retired contract (`*PreAudit`, `*Pre2f`, `*Legacy`) keeps a BondVault role: the pre-2f
 *        collections and deposit contracts were granted BOND_ROLE by the old deploy 23.
 *
 *    Both are BondVault changes: its admin's (the Earn timelock's) and, once deploy 23 names the
 *    Collateral Agent, co-signed (IV-10 Exhibit A, Part 2 item 6): two treasury signers propose and
 *    confirm, the Agent Key approves, 7 days pass, then the Earn timelock calls. No key here can do
 *    that, so the co-signed changes are printed, never sent.
 */

/** Who proposes a BondVault change: its admin, the Earn timelock (the same text as `VIA.earn` in `./creditWiring`). */
const VIA_EARN = "the Earn timelock (Clear Lending Co. Safe)";

/** A change a governed contract consumes from the Collateral Agent: the call, its hash and the steps, in order. */
export interface CoSignedChange {
  target: string;
  data: string;
  callHash: string;
  descriptionHash: string;
  what: string;
  steps: string[];
}

/** The co-signed change for `data` on `target` (a contract whose `_change()` consumes `keccak256(msg.data)`). */
export function coSignedChange(target: string, data: string, what: string): CoSignedChange {
  const { ethers } = require("hardhat");
  const callHash: string = ethers.keccak256(data);
  const descriptionHash: string = ethers.id(what);
  return {
    target,
    data,
    callHash,
    descriptionHash,
    what,
    steps: [
      `treasury signer 1: CollateralAgent.proposeChange(${target}, ${callHash}, ${descriptionHash})`,
      "treasury signer 2 (a different one): CollateralAgent.confirmChange(<changeId from ChangeProposed or openChangeFor>)",
      "Agent Key: CollateralAgent.approveChange(<changeId>)",
      `after 7 days from the confirmation, the Earn timelock (the BondVault's admin) calls ${target} with ${data}`,
    ],
  };
}

function printCoSigned(changes: CoSignedChange[], log: (m: string) => void) {
  for (const c of changes) {
    log(`  ! co-signed change: ${c.what}`);
    for (const s of c.steps) log(`      ${s}`);
  }
}

export interface BackstopResult {
  /** "none": the vault names no payout pool. "refused": a loan is open. "change": the call is printed. */
  status: "none" | "refused" | "change";
  message: string;
  /** The vault admin's call, for whoever holds the admin (the Earn timelock after deploy 23). */
  proposals: Proposal[];
  /** Set once the Agent is named: the co-signature the call needs. */
  coSigned?: CoSignedChange;
}

/**
 * Decision 48 (a): clears the BondVault's `payoutPool` backstop, keeping its treasury. Never sends:
 * it reads the vault and prints the change (co-signed once the Agent is named). While
 * `lentToPayoutPool` is not zero it refuses, and says the old PayoutPool must repay first.
 */
export async function payoutBackstopChange(vault: any, log: (m: string) => void = console.log): Promise<BackstopResult> {
  const { ethers } = require("hardhat");
  const target = ethers.getAddress(await vault.getAddress());
  const payoutPool: string = await vault.payoutPool();
  if (payoutPool === ethers.ZeroAddress) {
    const message = "= BondVault names no payout pool";
    log(message);
    return { status: "none", message, proposals: [] };
  }
  const lent: bigint = await vault.lentToPayoutPool();
  if (lent !== 0n) {
    const message =
      `! Refused: BondVault ${target} has ${lent} still lent to the PayoutPool ${payoutPool}. The old PayoutPool must ` +
      "repay it through BondVault.repayFromPayoutPool first (setBackstops reverts with BondVaultLoanOutstanding while " +
      "a loan is open). Nothing is proposed; run this again once lentToPayoutPool is 0.";
    log(message);
    return { status: "refused", message, proposals: [] };
  }
  const treasury: string = await vault.treasury();
  const data: string = vault.interface.encodeFunctionData("setBackstops", [treasury, ethers.ZeroAddress]);
  const what = `BondVault.setBackstops(${treasury}, 0): keep the treasury, clear the retired payout pool ${payoutPool} (decision 48)`;
  const agentNamed = (await vault.agent()) !== ethers.ZeroAddress;
  const via = agentNamed ? VIA_EARN : "the BondVault's admin (the deployer before the Earn handover, then the Earn timelock)";
  const proposals: Proposal[] = [{ via, target, data, what }];
  const coSigned = agentNamed ? coSignedChange(target, data, what) : undefined;
  const message = agentNamed
    ? `! ${what}: a co-signed change, then the Earn timelock`
    : `! ${what}: the BondVault's admin makes it (the Agent is not named yet, so no co-signature)`;
  log(message);
  if (coSigned) printCoSigned([coSigned], log);
  return { status: "change", message, proposals, coSigned };
}


/**
 * Decision 48 (b): every BondVault role a retired contract still holds. Before the Agent is named,
 * while `sender` holds the vault's admin, it revokes (deploy 23 runs this before `setEarnSources`);
 * afterwards each revocation is a co-signed change, printed and never sent.
 */
export async function revokeRetiredVaultRoles(
  vault: any,
  retired: { name: string; address: string }[],
  sender: any,
  log: (m: string) => void = console.log
) {
  const { ethers } = require("hardhat");
  const { RETIRED_ROLE_CHECKS, roleHash } = require("./creditWiring");
  const me = await sender.getAddress();
  const v = vault.connect(sender);
  const target = ethers.getAddress(await v.getAddress());
  const agentNamed = (await v.agent()) !== ethers.ZeroAddress;
  const proposals: Proposal[] = [];
  const coSigned: CoSignedChange[] = [];
  for (const role of RETIRED_ROLE_CHECKS.BondVault as readonly string[]) {
    const hash = roleHash(role);
    for (const r of retired) {
      const who = ethers.getAddress(r.address);
      if (!(await v.hasRole(hash, who))) continue;
      const what = `BondVault ${role} revoked from the retired ${r.name} ${who}`;
      if (!agentNamed && (await v.hasRole(await v.getRoleAdmin(hash), me))) {
        await (await v.revokeRole(hash, who)).wait();
        log(`  ${what}`);
        continue;
      }
      const data: string = v.interface.encodeFunctionData("revokeRole", [hash, who]);
      proposals.push({ via: VIA_EARN, target, data, what });
      if (agentNamed) coSigned.push(coSignedChange(target, data, what));
    }
  }
  if (coSigned.length > 0) printCoSigned(coSigned, log);
  return { proposals, coSigned };
}
