import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

/*
 * The Base Sepolia rollout, rehearsed on a local fork of Base Sepolia (docs/audit/SEPOLIA-REHEARSAL.md).
 *
 * It runs DEPLOY-RUNBOOK.md §2.2 in order. Every deploy, upgrade and check script runs as the
 * operator runs it (`npx hardhat run <script> --network base-sepolia-fork`, the deployer as signer),
 * and every Safe, two-signer and Agent Key action is sent here from the impersonated holder. Each
 * 7-day and 48-hour wait is fast-forwarded with `evm_increaseTime`.
 *
 * NEVER A REAL NETWORK, NEVER A KEY. It refuses any network but `base-sepolia-fork`, which must be a
 * Hardhat node forked from Base Sepolia (chain 84532, checked through `hardhat_metadata`). The node
 * signs for impersonated accounts; the fork only reads from its RPC.
 *
 *   # 1. the node, left running (pin FORK_BLOCK to a recent block):
 *   FORK_RPC_URL=https://sepolia.base.org FORK_BLOCK=<block> FORK_CHAIN_ID=84532 npx hardhat node --no-deploy
 *   # 2. the rehearsal, from a fresh scratch copy of the records:
 *   REHEARSAL_RESET=1 npx hardhat run scripts/rehearse_sepolia_fork.ts --network base-sepolia-fork
 *
 * (In this sandbox both need NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt.)
 *
 * Records: the scripts write to deployments/base-sepolia-fork/, a scratch copy of
 * deployments/base-sepolia/ (REHEARSAL_RESET=1 makes it; it is git-ignored and never committed).
 * Each step's output and the gas ledger go to deployments/base-sepolia-fork/rehearsal/.
 * REHEARSAL_FROM=<step id> resumes at a step on the same node; REHEARSAL_TO=<step id> stops after one.
 *
 * Inputs: deploy/config/base-sepolia.rollout.env, then the process environment, then the stand-ins
 * below for what only the owner can give (each one listed in SEPOLIA-REHEARSAL.md). A stand-in is a
 * synthetic address made from a label: it holds nothing and is used only on the fork.
 */

export const REHEARSAL_NETWORK = "base-sepolia-fork";
export const LIVE_RECORDS = "base-sepolia";
const SCRATCH = path.join("deployments", REHEARSAL_NETWORK);
const OUT = path.join(SCRATCH, "rehearsal");
const LEDGER = path.join(OUT, "ledger.json");
const ROLLOUT_ENV = path.join("deploy", "config", "base-sepolia.rollout.env");
const DAY = 24 * 60 * 60;

/** `KEY=VALUE` lines of an env file; comments and blanks skipped. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** A synthetic stand-in address for an owner input, from its label. Rehearsal only. */
export function standIn(label: string): string {
  const { ethers } = require("hardhat");
  return ethers.getAddress("0x" + ethers.id(`sepolia-rehearsal stand-in: ${label}`).slice(-40));
}

/** The owner inputs the scripts read that no record, chain read or doc settles: rehearsal stand-ins. */
export function standIns(): Record<string, string> {
  const two = (label: string) => `${standIn(`${label} 1`)},${standIn(`${label} 2`)}`;
  const relayer = standIn("savings relayer");
  return {
    RELAYER: relayer,
    VAULT_RELAYERS: relayer,
    SAVINGS_RELAYER_ADDRESS: relayer,
    VAULT_PAUSERS: two("vault pauser"),
    PILOT_SIGNERS: two("CA-mint pauser"),
    FRAUD_SIGNERS: two("CLRUSD fraud key"),
    SECURITY_SIGNERS: two("CLRUSD security key"),
    LISTING_SIGNERS: two("CLRUSD listing key"),
    CREDIT_LINES_KEY: standIn("credit lines key"),
    CREDIT_LIMITS_KEY: standIn("credit limits key"),
    CREDIT_OPERATOR_ADDRESS: standIn("credit operator"),
    CREDIT_SETTINGS_SIGNERS: two("CREDIT_SETTINGS_ROLE"),
    CREDIT_ATTESTER_SIGNERS: two("CREDIT_ATTESTER_ROLE"),
    HOLD_SIGNERS: two("Liquidator HOLD_ROLE"),
    STATE_ATTESTER_KEY: standIn("state attester"),
    AGENT_KEY: standIn("Agent Key"),
    TREASURY_SIGNERS: two("CollateralAgent treasury signer"),
    COLLATERAL_ACCOUNT: standIn("Collateral Deposit Account"),
    AGENT_COST_ADDRESS: standIn("Agent cost address"),
    EXCESS_DESTINATION: standIn("excess destination"),
    ASSURANCE_SIGNERS: two("Assurance pool signer"),
  };
}

const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

interface LedgerStep {
  id: string;
  title: string;
  who: string;
  status: "ok" | "failed" | "refused (expected)" | "exit 1 (expected)";
  fromBlock: number;
  toBlock: number;
  note?: string;
}

interface Ctx {
  hre: any;
  ethers: any;
  env: Record<string, string>;
  ledger: LedgerStep[];
  vars: Record<string, string>;
}

function record(name: string): { address: string; abi: any } | null {
  const file = path.join(SCRATCH, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function need(name: string): string {
  const r = record(name);
  if (!r) throw new Error(`No ${name} in ${SCRATCH}`);
  return r.address;
}

/**
 * The node closes idle keep-alive sockets while a child script runs; the next call on the parent's
 * stale socket fails once ("other side closed"). Retry the first call so the step goes on.
 */
async function ping(ctx: Ctx) {
  for (let i = 0; ; i++) {
    try {
      return await ctx.ethers.provider.getBlockNumber();
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/** Runs a repository script against the fork, as the operator would. */
function runScript(ctx: Ctx, id: string, script: string, extra: Record<string, string> = {}, opts: { okExit?: number[] } = {}) {
  const env = { ...process.env, ...ctx.env, ...extra } as Record<string, string>;
  delete env.FORK_SIGNER; // the scripts sign as the deployer
  const r = spawnSync("npx", ["hardhat", "run", "--no-compile", script, "--network", REHEARSAL_NETWORK], {
    env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => !/UNDICI-EHPA|trace-warnings/.test(l)).join("\n");
  fs.writeFileSync(path.join(OUT, `${id}.log`), `$ ${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(" ")} npx hardhat run ${script} --network ${REHEARSAL_NETWORK}\n\n${out}`);
  console.log(out.split("\n").map((l) => `    ${l}`).join("\n"));
  const ok = [0, ...(opts.okExit ?? [])];
  if (!ok.includes(r.status ?? 1)) throw new Error(`${script} exited ${r.status}`);
  return { out, status: r.status ?? 1 };
}

async function actor(ctx: Ctx, address: string) {
  const { ethers, hre } = ctx;
  await hre.network.provider.send("hardhat_impersonateAccount", [address]);
  const balance: bigint = await ethers.provider.getBalance(address);
  if (balance < ethers.parseEther("1")) {
    await hre.network.provider.send("hardhat_setBalance", [address, "0x" + ethers.parseEther("10").toString(16)]);
  }
  return ethers.getSigner(address);
}

/** Sends `data` to `to` from the impersonated `from`. */
async function sendAs(ctx: Ctx, from: string, to: string, data: string, what: string) {
  const signer = await actor(ctx, from);
  const tx = await signer.sendTransaction({ to, data });
  const receipt = await tx.wait();
  console.log(`    ${from} -> ${to}: ${what} (gas ${receipt.gasUsed})`);
  return receipt;
}

async function increaseTime(ctx: Ctx, seconds: number) {
  await ctx.hre.network.provider.send("evm_increaseTime", [seconds]);
  await ctx.hre.network.provider.send("evm_mine", []);
  const b = await ctx.ethers.provider.getBlock("latest");
  console.log(`    +${seconds} s: chain time now ${new Date(b.timestamp * 1000).toISOString()}`);
}

/** Schedules a batch on a TimelockController from its proposer, returning the execute call. */
async function scheduleBatch(ctx: Ctx, timelock: string, proposer: string, calls: { to: string; data: string; what: string }[], label: string) {
  const { ethers } = ctx;
  await ping(ctx);
  const tl = await ethers.getContractAt("TimelockController", timelock);
  const delay = await tl.getMinDelay();
  const targets = calls.map((c) => c.to);
  const values = calls.map(() => 0n);
  const payloads = calls.map((c) => c.data);
  const salt = ethers.id(`rehearsal:${label}`);
  await sendAs(ctx, proposer, timelock, tl.interface.encodeFunctionData("scheduleBatch", [targets, values, payloads, ethers.ZeroHash, salt, delay]),
    `scheduleBatch ${label} (${calls.length} calls: ${calls.map((c) => c.what).join("; ")}; delay ${delay} s)`);
  return { timelock, executor: proposer, data: tl.interface.encodeFunctionData("executeBatch", [targets, values, payloads, ethers.ZeroHash, salt]), label };
}

/** The co-signed change flow (IV-10 Exhibit A, Part 2 item 6): propose, confirm, Agent approve. */
async function coSign(ctx: Ctx, target: string, data: string, what: string) {
  const { ethers } = ctx;
  const agent = await ethers.getContractAt("CollateralAgent", need("CollateralAgent"));
  const [s1, s2] = list(ctx.env.TREASURY_SIGNERS);
  const callHash = ethers.keccak256(data);
  const descriptionHash = ethers.id(what);
  await sendAs(ctx, s1, await agent.getAddress(), agent.interface.encodeFunctionData("proposeChange", [target, callHash, descriptionHash]), `proposeChange: ${what}`);
  const changeId = await agent.openChangeFor(target, callHash);
  await sendAs(ctx, s2, await agent.getAddress(), agent.interface.encodeFunctionData("confirmChange", [changeId]), `confirmChange ${changeId.slice(0, 10)}…`);
  await sendAs(ctx, ctx.env.AGENT_KEY, await agent.getAddress(), agent.interface.encodeFunctionData("approveChange", [changeId]), `approveChange ${changeId.slice(0, 10)}…`);
}

interface Step {
  id: string;
  title: string;
  who: string;
  run: (ctx: Ctx) => Promise<void | { status?: LedgerStep["status"]; note?: string }>;
}

export function steps(): Step[] {
  return [
    // ---------------- A. read-only ----------------
    { id: "A6", title: "Baseline the retired-contract check (CHECK_BASELINE=1)", who: "nobody (read-only)",
      run: async (ctx) => { const r = runScript(ctx, "A6", "scripts/check_retired_credit.ts", { CHECK_BASELINE: "1" }, { okExit: [1] }); return { status: r.status === 1 ? "exit 1 (expected)" : "ok" }; } },
    { id: "B1", title: "Unwind report of every pre-2f bond (MODE=report)", who: "nobody (read-only)",
      run: async (ctx) => { runScript(ctx, "B1", "scripts/unwind_legacy_bonds.ts"); } },
    { id: "B3", title: "Loans between the pools (read)", who: "nobody (read-only)",
      run: async (ctx) => {
        const { ethers } = ctx;
        const pp = new ethers.Contract(need("PayoutPool"), ["function borrowedFromVault() view returns (uint256)", "function borrowedFromYield() view returns (uint256)"], ethers.provider);
        const bv = new ethers.Contract(need("BondVault"), ["function lentToPayoutPool() view returns (uint256)"], ethers.provider);
        const note = `PayoutPool borrowedFromVault ${await pp.borrowedFromVault()}, borrowedFromYield ${await pp.borrowedFromYield()}; BondVault lentToPayoutPool ${await bv.lentToPayoutPool()}`;
        console.log(`    ${note}`);
        return { note };
      } },

    // ---------------- C. savings rails ----------------
    { id: "C1a", title: "ESADepositVault: validate the new implementation (scripts/upgrade_vault.ts)", who: "nobody (read-only)",
      run: async (ctx) => { runScript(ctx, "C1a", "scripts/upgrade_vault.ts"); } },
    { id: "C1b", title: "ESADepositVault: deploy the implementation (PREPARE_VAULT_IMPL=1)", who: "deployer",
      run: async (ctx) => {
        const { out } = runScript(ctx, "C1b", "scripts/upgrade_vault.ts", { PREPARE_VAULT_IMPL: "1" });
        const m = out.match(/Implementation (0x[0-9a-fA-F]{40})/);
        if (!m) throw new Error("No implementation address in the output");
        ctx.vars.VAULT_IMPL = m[1];
        return { note: `VAULT_IMPL ${m[1]}` };
      } },
    { id: "C1c", title: "ESADepositVault: write the upgrade batch (scripts/migrate_vault_clrusd.ts)", who: "nobody (writes a batch file)",
      run: async (ctx) => {
        runScript(ctx, "C1c", "scripts/migrate_vault_clrusd.ts", {
          VAULT_IMPL: ctx.vars.VAULT_IMPL, RELAYER: ctx.env.RELAYER, CLEAR_FINANCIAL_SAFE: ctx.env.CLEAR_FINANCIAL_SAFE,
          VAULT_ADMIN: ctx.env.VAULT_ADMIN,
        });
      } },
    { id: "C1d", title: "ESADepositVault: the vault's admin sends the batch (upgradeToAndCall + RELAYER_ROLE + OPERATOR_ROLE off)", who: "VAULT_ADMIN (the deployer wallet)",
      run: async (ctx) => {
        const batch = JSON.parse(fs.readFileSync(path.join(SCRATCH, "safe-batches", "vault-1-upgrade.json"), "utf8"));
        for (const t of batch.transactions) await sendAs(ctx, ctx.env.VAULT_ADMIN, t.to, t.data, "vault-1-upgrade.json");
        const v = await ctx.ethers.getContractAt("ESADepositVault", need("ESADepositVault"));
        return { note: `acceptedToken ${await v.acceptedToken()}` };
      } },
    { id: "C2a", title: "ClearUSDUpgradeable: check (deploy/upgrade/checkUpgrade.ts)", who: "nobody (read-only)",
      run: async (ctx) => { runScript(ctx, "C2a", "deploy/upgrade/checkUpgrade.ts", { CONTRACT_NAME: "ClearUSDUpgradeable", PROXY_ADDRESS: need("ClearUSDUpgradeable") }); } },
    { id: "C2b", title: "ClearUSDUpgradeable: upgrade (deploy/upgrade/upgradeContract.ts)", who: "deployer (UPGRADER_ROLE)",
      run: async (ctx) => { runScript(ctx, "C2b", "deploy/upgrade/upgradeContract.ts", { CONTRACT_NAME: "ClearUSDUpgradeable", PROXY_ADDRESS: need("ClearUSDUpgradeable") }); } },
    { id: "C3a", title: "ClaimEscrow: check", who: "nobody (read-only)",
      run: async (ctx) => { runScript(ctx, "C3a", "deploy/upgrade/checkUpgrade.ts", { CONTRACT_NAME: "ClaimEscrow", PROXY_ADDRESS: need("ClaimEscrow") }); } },
    { id: "C3b", title: "ClaimEscrow: upgrade", who: "deployer (DEFAULT_ADMIN_ROLE)",
      run: async (ctx) => { runScript(ctx, "C3b", "deploy/upgrade/upgradeContract.ts", { CONTRACT_NAME: "ClaimEscrow", PROXY_ADDRESS: need("ClaimEscrow") }); } },
    { id: "C4", title: "SavingsIntentFactory: deploy 19 (it keeps the pre-2d record as SavingsIntentFactoryPre2d)", who: "deployer",
      run: async (ctx) => { runScript(ctx, "C4", "deploy/19_deploy_SavingsIntentFactory.ts"); } },

    // ---------------- D. the credit core, fresh ----------------
    { id: "D1a", title: "Retire the credit records: report", who: "nobody (records only)",
      run: async (ctx) => { runScript(ctx, "D1a", "deploy/retire_credit_stack.ts"); } },
    { id: "D1b", title: "Retire the credit records (RETIRE_CREDIT_STACK=1)", who: "nobody (records only)",
      run: async (ctx) => { runScript(ctx, "D1b", "deploy/retire_credit_stack.ts", { RETIRE_CREDIT_STACK: "1" }); } },
    { id: "D2a", title: "Deploy 16: a fresh AccessManager", who: "deployer",
      run: async (ctx) => { runScript(ctx, "D2a", "deploy/16_deploy_AccessManager.ts"); } },
    { id: "D2b", title: "Deploy 18: link it to the MembershipRegistry", who: "deployer",
      run: async (ctx) => { runScript(ctx, "D2b", "deploy/18_configure_AccessManagerMembershipRegistry.ts"); } },
    { id: "D3a", title: "Deploy 20: the credit core", who: "deployer",
      run: async (ctx) => { runScript(ctx, "D3a", "deploy/20_deploy_CreditCore.ts"); } },
    { id: "D3b", title: "Deploy 21: ClearUSDUpgradeable (recorded: reused)", who: "deployer",
      run: async (ctx) => { runScript(ctx, "D3b", "deploy/21_deploy_ClearUSDUpgradeable.ts"); } },
    { id: "D4", title: "Credit keys on the new AccessManager (not scripted)", who: "deployer (AccessManager admin)",
      run: async (ctx) => {
        const { ethers } = ctx;
        const access = await ethers.getContractAt("AccessManager", need("AccessManager"));
        const at = await access.getAddress();
        for (const [role, holders] of [["CREDIT_SETTINGS_ROLE", ctx.env.CREDIT_SETTINGS_SIGNERS], ["CREDIT_ATTESTER_ROLE", ctx.env.CREDIT_ATTESTER_SIGNERS ?? ctx.env.CREDIT_ATTESTERS]] as const) {
          for (const h of list(holders)) {
            if (!(await access.hasRole(ethers.id(role), h))) await sendAs(ctx, ctx.env.DEPLOYER, at, access.interface.encodeFunctionData("grantRole", [ethers.id(role), h]), `AccessManager ${role} -> ${h}`);
          }
        }
        const op = ctx.env.CREDIT_OPERATOR_ADDRESS;
        if (!(await access.isOperator(op))) await sendAs(ctx, ctx.env.DEPLOYER, at, access.interface.encodeFunctionData("grantOperator", [op]), `AccessManager OPERATOR -> ${op}`);
      } },

    // ---------------- E. Earn, and the rest of the credit stack ----------------
    { id: "E1", title: "Deploy 26, first run: Earn timelock, EarnControls, CollateralAgent", who: "deployer",
      run: async (ctx) => { runScript(ctx, "E1", "deploy/26_deploy_EarnControls.ts"); } },
    { id: "E2a", title: "LendingPool -> Yield Pool: dry run", who: "nobody (read-only)",
      run: async (ctx) => { runScript(ctx, "E2a", "scripts/upgrade_yield_pool.ts"); } },
    { id: "E2b", title: "LendingPool -> Yield Pool (YIELD_POOL_UPGRADE=1)", who: "deployer (DEFAULT_ADMIN_ROLE)",
      run: async (ctx) => { runScript(ctx, "E2b", "scripts/upgrade_yield_pool.ts", { YIELD_POOL_UPGRADE: "1" }); } },
    { id: "E3a", title: "BondVault: dry run (VAULT_UPGRADE_DRY_RUN=1)", who: "nobody (read-only)",
      run: async (ctx) => { runScript(ctx, "E3a", "scripts/upgrade_bond_vault_pledge_guard.ts", { VAULT_UPGRADE_DRY_RUN: "1" }); } },
    { id: "E3b", title: "BondVault: upgrade, encumbrance source", who: "deployer (DEFAULT_ADMIN_ROLE)",
      run: async (ctx) => { runScript(ctx, "E3b", "scripts/upgrade_bond_vault_pledge_guard.ts"); } },
    { id: "E4", title: "Deploy 22 (REPLACE_BOND_FACTORY=1)", who: "deployer",
      run: async (ctx) => { runScript(ctx, "E4", "deploy/22_deploy_BondsAndPool.ts", { REPLACE_BOND_FACTORY: "1" }); } },
    { id: "E6", title: "Deploy 23: the collection, valuer, BondVault grants, the Agent named", who: "deployer",
      run: async (ctx) => { runScript(ctx, "E6", "deploy/23_deploy_BondCollection.ts"); } },
    { id: "E7", title: "Deploy 27: Earn wiring and roles", who: "deployer",
      run: async (ctx) => {
        const { out } = runScript(ctx, "E7", "deploy/27_wire_Earn.ts");
        ctx.vars.BACKSTOP_CHANGE = /The BondVault backstop change/.test(out) ? "1" : "";
      } },
    { id: "E8", title: "Co-signed CollateralAgent changes (and the E9 backstop), proposed, confirmed, approved; the Safe schedules them on the Earn timelock; two HOLD_ROLE keys", who: "treasury signers 1 and 2, the Agent Key, the Clear Lending Safe; the deployer (HOLD_ROLE)",
      run: async (ctx) => {
        const { ethers } = ctx;
        const agentAddress = need("CollateralAgent");
        const agent = await ethers.getContractAt("CollateralAgent", agentAddress);
        const calls: { to: string; data: string; what: string }[] = [];
        const want: [string, string, string][] = [
          ["vault", "setVault", need("BondVault")],
          ["bondBook", "setBondBook", need("BondVault")],
          ["holderDirections", "setHolderDirections", need("HolderDirections")],
          ["pledgeModule", "setPledgeModule", need("Liquidator")],
        ];
        for (const [view, fn, value] of want) {
          if ((await agent[view]()).toLowerCase() === value.toLowerCase()) continue;
          const data = agent.interface.encodeFunctionData(fn, [value]);
          await coSign(ctx, agentAddress, data, `CollateralAgent.${fn}(${value})`);
          calls.push({ to: agentAddress, data, what: `CollateralAgent.${fn}` });
        }
        const vault = await ethers.getContractAt("BondVault", need("BondVault"));
        const retiredPayout = record("PayoutPoolPreAudit")?.address?.toLowerCase();
        if ((await vault.payoutPool()).toLowerCase() === retiredPayout && (await vault.lentToPayoutPool()) === 0n) {
          const data = vault.interface.encodeFunctionData("setBackstops", [await vault.treasury(), ethers.ZeroAddress]);
          await coSign(ctx, await vault.getAddress(), data, "BondVault.setBackstops(treasury, 0): decision 48 (a)");
          calls.push({ to: await vault.getAddress(), data, what: "BondVault.setBackstops(treasury, 0)" });
        }
        if (calls.length) ctx.vars.EARN_BATCH = JSON.stringify(await scheduleBatch(ctx, need("EarnTimelock"), ctx.env.CLEAR_LENDING_SAFE, calls, "E8 agent changes"));
        const liq = await ethers.getContractAt("Liquidator", need("Liquidator"));
        for (const h of list(ctx.env.HOLD_SIGNERS)) {
          if (!(await liq.hasRole(await liq.HOLD_ROLE(), h))) await sendAs(ctx, ctx.env.DEPLOYER, await liq.getAddress(), liq.interface.encodeFunctionData("grantRole", [await liq.HOLD_ROLE(), h]), `Liquidator HOLD_ROLE -> ${h}`);
        }
      } },

    // ---------------- F. compliance ----------------
    { id: "F2a", title: "Deploy 25: compliance wiring", who: "deployer",
      run: async (ctx) => { runScript(ctx, "F2a", "deploy/25_wire_Compliance.ts"); } },
    { id: "F2b", title: "The second CREDIT_SETTINGS_ROLE holder approves the fee recipient", who: "CREDIT_SETTINGS_ROLE holder 2",
      run: async (ctx) => {
        const { ethers } = ctx;
        const term = await ethers.getContractAt("TermIssuer", need("TermIssuer"));
        if ((await term.feeRecipient()) !== ethers.ZeroAddress) return { note: "already named" };
        const [, second] = list(ctx.env.CREDIT_SETTINGS_SIGNERS);
        await sendAs(ctx, second, await term.getAddress(), term.interface.encodeFunctionData("approveFeeRecipient", [ctx.env.FEE_RECIPIENT, ethers.encodeBytes32String("INITIAL")]), `approveFeeRecipient(${ctx.env.FEE_RECIPIENT}, "INITIAL")`);
        return { note: `feeRecipient ${await term.feeRecipient()}` };
      } },

    // ---------------- G. before the first Deployment ----------------
    { id: "G1", title: "Pool Tier principal, posted by two VALUATION_ROLE signers", who: "VALUATION_ROLE signers (earn-roles.json)",
      run: async (ctx) => {
        const { poolAt } = require("../deploy/poolModules");
        const pool = await poolAt(need("LendingPool"), ctx.ethers.provider);
        const roles = JSON.parse(fs.readFileSync("deploy/config/earn-roles.json", "utf8")).networks[LIVE_RECORDS].LendingPool.VALUATION_ROLE;
        for (const signer of roles) {
          await sendAs(ctx, signer, await pool.getAddress(), pool.interface.encodeFunctionData("postPoolTierPrincipal", [BigInt(ctx.env.POOL_TIER_PRINCIPAL), ctx.env.POOL_TIER_EVIDENCE]), `postPoolTierPrincipal(${ctx.env.POOL_TIER_PRINCIPAL}, POOL_TIER_EVIDENCE)`);
        }
        const [posted, at] = await pool.poolTierPrincipal();
        return { note: `poolTierPrincipal ${posted} at ${at}` };
      } },
    // ---------------- H. Assurance (before G3: deploy 26's second run refuses AssurancePoolV2) ----------------
    { id: "H1", title: "Deploy 08: the AssurancePool under its timelock", who: "deployer",
      run: async (ctx) => { runScript(ctx, "H1", "deploy/08_deploy_AssurancePool.ts", { ASSURANCE_DEPLOY: "1" }); } },
    { id: "G3", title: "Deploy 26, second run (the refusals; after F2 and H1)", who: "deployer",
      run: async (ctx) => { runScript(ctx, "G3", "deploy/26_deploy_EarnControls.ts"); } },

    // ---------------- I. handovers ----------------
    { id: "I5a", title: "Retired-contract check after the fresh deploy (before the handovers)", who: "nobody (read-only)",
      run: async (ctx) => { const r = runScript(ctx, "I5a", "scripts/check_retired_credit.ts", {}, { okExit: [1] }); return { status: r.status === 1 ? "exit 1 (expected)" : "ok" }; } },
    { id: "I2", title: "Credit handover (CREDIT_HANDOVER=1)", who: "deployer",
      run: async (ctx) => { runScript(ctx, "I2", "deploy/credit_timelock_handover.ts", { CREDIT_HANDOVER: "1" }); } },
    { id: "I3a", title: "Vault handover with the Safe as it is", who: "deployer",
      run: async (ctx) => {
        const r = runScript(ctx, "I3a", "deploy/vault_timelock_handover.ts", { VAULT_HANDOVER: "1" }, { okExit: [1] });
        if (r.status === 1 && /must need two signers/.test(r.out)) return { status: "refused (expected)", note: "the Safe needs 1 signer: assertTwoPersonSafe refuses" };
        if (r.status !== 0) throw new Error("vault handover failed");
      } },
    { id: "I3b", title: "Owner action, simulated: the Safe adds SAFE_NEW_OWNER and needs 2 signatures (addOwnerWithThreshold; changeThreshold(2) without one)", who: "the Safe (one owner signs today)",
      run: async (ctx) => {
        const safe = ctx.env.CLEAR_FINANCIAL_SAFE;
        const s = new ctx.ethers.Contract(safe, ["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])",
          "function changeThreshold(uint256)", "function addOwnerWithThreshold(address,uint256)"], ctx.ethers.provider);
        const owner = ctx.env.SAFE_NEW_OWNER;
        const isOwner = !!owner && (await s.getOwners()).some((o: string) => o.toLowerCase() === owner.toLowerCase());
        if ((await s.getThreshold()) >= 2n && (!owner || isOwner)) return { note: "already 2 or more" };
        if (owner && !isOwner) await sendAs(ctx, safe, safe, s.interface.encodeFunctionData("addOwnerWithThreshold", [owner, 2]), `Safe.addOwnerWithThreshold(${owner}, 2)`);
        else await sendAs(ctx, safe, safe, s.interface.encodeFunctionData("changeThreshold", [2]), "Safe.changeThreshold(2)");
        return { note: `threshold ${await s.getThreshold()} of ${(await s.getOwners()).length}` };
      } },
    { id: "I3c", title: "Vault handover (VAULT_HANDOVER=1)", who: "deployer",
      run: async (ctx) => {
        const { out } = runScript(ctx, "I3c", "deploy/vault_timelock_handover.ts", { VAULT_HANDOVER: "1" });
        const calls: { to: string; data: string; what: string }[] = [];
        for (const m of out.matchAll(/^\s+(0x[0-9a-fA-F]{40})\s+(0x[0-9a-fA-F]+)\s+# (.*)$/gm)) calls.push({ to: m[1], data: m[2], what: m[3] });
        if (calls.length) ctx.vars.VAULT_BATCH = JSON.stringify(await scheduleBatch(ctx, need("VaultTimelock"), ctx.env.CLEAR_FINANCIAL_SAFE, calls, "I3 acceptances"));
        return { note: `${calls.length} acceptance call(s) scheduled by the Safe` };
      } },
    { id: "I4", title: "Earn handover (EARN_HANDOVER=1)", who: "deployer",
      run: async (ctx) => { runScript(ctx, "I4", "deploy/earn_timelock_handover.ts", { EARN_HANDOVER: "1" }); } },

    // ---------------- the waits ----------------
    { id: "W7", title: "Wait 7 days (fast-forwarded): the Agent changes, the Earn and vault timelocks, CLRUSD's 2-day admin delay", who: "nobody",
      run: async (ctx) => { await increaseTime(ctx, 7 * DAY + 3600); } },
    { id: "E8x", title: "The Safe executes the Earn timelock batch (Agent changes, backstop)", who: "the Clear Lending Safe",
      run: async (ctx) => {
        if (!ctx.vars.EARN_BATCH) return { note: "nothing scheduled" };
        const b = JSON.parse(ctx.vars.EARN_BATCH);
        await sendAs(ctx, b.executor, b.timelock, b.data, `executeBatch ${b.label}`);
      } },
    { id: "I3x", title: "The Safe executes the vault timelock batch (CLRUSD admin, token pool ownership)", who: "the Clear Financial Safe",
      run: async (ctx) => {
        if (!ctx.vars.VAULT_BATCH) return { note: "nothing scheduled" };
        const b = JSON.parse(ctx.vars.VAULT_BATCH);
        await sendAs(ctx, b.executor, b.timelock, b.data, `executeBatch ${b.label}`);
      } },

    // ---------------- the gate and the read-only checks ----------------
    { id: "I6", title: "Retired-contract check: the gate (must exit 0)", who: "nobody (read-only)",
      run: async (ctx) => { runScript(ctx, "I6", "scripts/check_retired_credit.ts"); } },
    { id: "V41", title: "Section 4.1 read-only checks (scripts/check_sepolia_wiring.ts)", who: "nobody (read-only)",
      run: async (ctx) => { runScript(ctx, "V41", "scripts/check_sepolia_wiring.ts"); } },
    { id: "V43", title: "Payout funding (scripts/check_payout_funding.ts)", who: "nobody (read-only)",
      run: async (ctx) => { const r = runScript(ctx, "V43", "scripts/check_payout_funding.ts", {}, { okExit: [2] }); return { note: `exit ${r.status}` }; } },
  ];
}

async function main() {
  const hre = require("hardhat");
  const { ethers } = hre;
  if (hre.network.name !== REHEARSAL_NETWORK) throw new Error(`Run this against --network ${REHEARSAL_NETWORK} only.`);
  const meta = await hre.network.provider.send("hardhat_metadata", []).catch(() => null);
  if (!meta?.forkedNetwork || Number(meta.forkedNetwork.chainId) !== 84532) {
    throw new Error("The node is not a Hardhat fork of Base Sepolia (hardhat_metadata.forkedNetwork.chainId 84532). Refusing.");
  }
  // The node answers no call at the fork block itself: mine one.
  if (Number(meta.latestBlockNumber) === Number(meta.forkedNetwork.forkBlockNumber)) await hre.network.provider.send("evm_mine", []);

  if (process.env.REHEARSAL_RESET === "1") {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
    fs.cpSync(path.join("deployments", LIVE_RECORDS), SCRATCH, { recursive: true });
    console.log(`Scratch records: ${SCRATCH} copied from deployments/${LIVE_RECORDS}`);
  }
  if (!fs.existsSync(SCRATCH)) throw new Error(`No ${SCRATCH}: run with REHEARSAL_RESET=1 first.`);
  fs.mkdirSync(OUT, { recursive: true });

  const rollout = parseEnvFile(fs.readFileSync(ROLLOUT_ENV, "utf8"));
  const stand = standIns();
  const env: Record<string, string> = {
    DEPLOYER: "0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA",
    ...stand,
    ...rollout,
  };
  for (const k of Object.keys(env)) if (process.env[k]?.trim()) env[k] = process.env[k]!.trim();
  process.env.CLEAR_LENDING_SAFE = env.CLEAR_LENDING_SAFE;
  const usedStandIns = Object.keys(stand).filter((k) => env[k] === stand[k]);
  fs.writeFileSync(path.join(OUT, "inputs.json"), JSON.stringify({ forkBlock: meta.forkedNetwork.forkBlockNumber, env, standIns: usedStandIns }, null, 2));
  console.log(`Fork of Base Sepolia at block ${meta.forkedNetwork.forkBlockNumber}. Stand-ins for owner inputs: ${usedStandIns.join(", ")}\n`);

  const ledger: LedgerStep[] = fs.existsSync(LEDGER) && process.env.REHEARSAL_RESET !== "1" ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : [];
  const varsFile = path.join(OUT, "vars.json");
  const vars: Record<string, string> = fs.existsSync(varsFile) && process.env.REHEARSAL_RESET !== "1" ? JSON.parse(fs.readFileSync(varsFile, "utf8")) : {};
  const ctx: Ctx = { hre, ethers, env, ledger, vars };
  // The deployer pays for gas on the fork; the real cost is in the ledger (scripts/rehearsal_gas.ts).
  await actor(ctx, env.DEPLOYER);

  const all = steps();
  const from = process.env.REHEARSAL_FROM ? all.findIndex((s) => s.id === process.env.REHEARSAL_FROM) : 0;
  if (from < 0) throw new Error(`No step ${process.env.REHEARSAL_FROM}`);
  for (const step of all.slice(from)) {
    console.log(`\n== ${step.id}: ${step.title} [${step.who}]`);
    const fromBlock = Number(await ping(ctx)) + 1;
    let status: LedgerStep["status"] = "ok";
    let note: string | undefined;
    try {
      const r = await step.run(ctx);
      if (r?.status) status = r.status;
      note = r?.note;
    } catch (e: any) {
      status = "failed";
      note = String(e?.message ?? e).split("\n")[0];
    }
    const toBlock = Number(await ping(ctx));
    const entry = { id: step.id, title: step.title, who: step.who, status, fromBlock, toBlock, note };
    const i = ledger.findIndex((s) => s.id === step.id);
    if (i >= 0) ledger[i] = entry; else ledger.push(entry);
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
    fs.writeFileSync(varsFile, JSON.stringify(vars, null, 2));
    console.log(`-- ${step.id}: ${status}${note ? ` (${note})` : ""}`);
    if (status === "failed") throw new Error(`Step ${step.id} failed: ${note}. Fix it, then REHEARSAL_FROM=${step.id}.`);
    if (process.env.REHEARSAL_TO === step.id) break;
  }
  console.log(`\nLedger: ${LEDGER}. Gas: npx hardhat run scripts/rehearsal_gas.ts --network ${REHEARSAL_NETWORK}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
