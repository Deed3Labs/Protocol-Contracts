import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { liveNetworkOf } from "../deploy/helpers";
import { stateAttesterGrant } from "./state_attester_grant";
import { RETIRED_SUFFIX } from "../deploy/retire_credit_stack";
import { parseEnvFile } from "./rehearse_sepolia_fork";
import { SETTLEMENT_LANE_RECORD } from "./upgrade_settlement_lane";
import {
  assuranceSetupFromEnv, assuranceSetupProblems, governedCalls, approvalKey, CL_FEES_MASK, BOARD_ALLOCATION_MASK, AssuranceSetup,
} from "../deploy/assurance_timelock_handover";
import {
  ALLOWANCE_MODULE_ABI, SAFE_MODULE_ABI, CANONICAL_ALLOWANCE_MODULE, PAYOUT_POOL_ROLES, parseUsdc, formatUsdc,
} from "../apps/api/src/services/payoutFunding/topUp";

/*
 * The Base Sepolia rollout's co-signer steps, as a signing plan (docs/audit/SEPOLIA-REHEARSAL.md).
 *
 * READ-ONLY. It reads the deployment records, the rollout inputs and the chain, and writes:
 *   deployments/<network>/signing-plan.json            the calls people send from their own wallets,
 *                                                       for tools/signing-page/index.html
 *   deployments/<network>/safe-batches/signing-*.json   the Safe's calls, as Safe Transaction Builder
 *                                                       batches (only those ready to sign now)
 * It never sends a transaction and never reads a key.
 *
 *   npx hardhat run scripts/signing_plan.ts --network base-sepolia
 *   npx hardhat run scripts/signing_plan.ts --network base-sepolia-fork   (the rehearsal's fork)
 *
 * Inputs: deploy/config/base-sepolia.rollout.env (ROLLOUT_ENV=<file> for another), then the process
 * environment (it wins), and the VALUATION_ROLE holders in deploy/config/earn-roles.json. Every
 * signer comes from there: change a slot there, re-run, and the plan follows.
 *
 * Each step is "done" (the chain already shows it), "ready" (its signer can send it now: a dry run
 * from the signer succeeds) or "waiting" (with the reason: an earlier step, an input, a delay).
 * Re-run it after each stage: values known only after an earlier step (a change's number) are read
 * from the chain then.
 */

export const BASE_SEPOLIA = 84532;
export const LOCAL_TEST_CHAIN = 31337;
/** The chain each network must answer as; any other network may only be the local test chain. */
const NETWORK_CHAINS: Record<string, number> = { "base-sepolia": BASE_SEPOLIA, "base-sepolia-fork": BASE_SEPOLIA };
export const DEFAULT_ROLLOUT_ENV = path.join("deploy", "config", "base-sepolia.rollout.env");
export const PLAN_FORMAT = "clear-signing-plan/1";
const ZERO_HASH = "0x" + "00".repeat(32);
const ZERO_ADDRESS = "0x" + "00".repeat(20);
/** EIP-1967 implementation slot. */
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type StepStatus = "ready" | "done" | "waiting";

export interface PlanArg {
  name: string;
  type: string;
  value: string;
  /** What the value is, in words (a role's name, a contract's name, an amount). */
  note?: string;
}

export interface PlanStep {
  id: string;
  stage: string;
  title: string;
  explanation: string;
  /** "wallet": the signer sends it from their own wallet (the signing page). "safe": the Safe app signs it. */
  kind: "wallet" | "safe";
  signer: string;
  signerLabel: string;
  chainId: number;
  to: string;
  toLabel: string;
  value: "0";
  /** null while a value it needs is known only after an earlier step. */
  data: string | null;
  functionSignature: string;
  args: PlanArg[];
  dependsOn: string[];
  status: StepStatus;
  reason?: string;
  /** For a Safe step: the Transaction Builder file, written while the step is ready. */
  safeBatchFile?: string;
}

export interface SigningPlan {
  format: string;
  generatedAt: string;
  network: string;
  chainId: number;
  block: number;
  blockTime: string;
  stepsSha256: string;
  notes: string[];
  steps: PlanStep[];
}

export interface PlanOptions {
  network: string;
  /** Where the records are (default deployments/<network>). */
  recordsDir?: string;
  env: Record<string, string>;
  /** The pool's VALUATION_ROLE signers; default deploy/config/earn-roles.json for the network. */
  valuationSigners?: string[];
  /** The pool's DEPLOYER_ROLE signers (the SL steps); default deploy/config/earn-roles.json for the network. */
  deploymentSigners?: string[];
  earnRolesFile?: string;
  /** The chain to read (default the Hardhat runtime's provider). */
  provider?: any;
}

/** The sha256 of the steps, as the page recomputes it: JSON.stringify of the parsed `steps`. */
export function stepsSha256(steps: PlanStep[]): string {
  return createHash("sha256").update(JSON.stringify(steps)).digest("hex");
}

/** The rollout inputs: the env file, then the process environment (non-empty values win). */
export function loadPlanEnv(file = process.env.ROLLOUT_ENV || DEFAULT_ROLLOUT_ENV): Record<string, string> {
  const env = fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, "utf8")) : {};
  for (const [k, v] of Object.entries(process.env)) if (v?.trim() && /^[A-Z][A-Z0-9_]*$/.test(k)) env[k] = v.trim();
  return env;
}

const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ordinal = (i: number) => String(i + 1);

/**
 * Builds the plan. Reads only: every call is a view or an eth_call dry run.
 * Throws when the network answers as the wrong chain, or a record (or any step's `to`) has no code.
 */
export async function buildSigningPlan(o: PlanOptions): Promise<SigningPlan> {
  const hre = require("hardhat");
  const { ethers, artifacts } = hre;
  const provider = o.provider ?? ethers.provider;
  const network = o.network;
  const recordsDir = o.recordsDir ?? path.join("deployments", network);
  const env = o.env;

  const chainId = Number((await provider.getNetwork()).chainId);
  const wanted = NETWORK_CHAINS[network];
  if (wanted !== undefined && chainId !== wanted) {
    throw new Error(`Refusing: ${network} must be chain ${wanted}, and this node answers as chain ${chainId}.`);
  }
  if (wanted === undefined && chainId !== LOCAL_TEST_CHAIN) {
    throw new Error(`Refusing: the signing plan is for Base Sepolia (${BASE_SEPOLIA}) or a local test chain (${LOCAL_TEST_CHAIN}); ${network} is chain ${chainId}.`);
  }
  const head = await provider.getBlock("latest");
  const now = BigInt(head.timestamp);
  const notes: string[] = [];
  const steps: PlanStep[] = [];

  // ---------------- addresses, records, labels ----------------
  const addr = (v?: string) => (v && ethers.isAddress(v) ? ethers.getAddress(v) : undefined);
  const addrList = (name: string) => list(env[name]).filter((a) => ethers.isAddress(a)).map((a) => ethers.getAddress(a));
  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

  const codeSeen = new Map<string, boolean>();
  const hasCode = async (a: string) => {
    if (!codeSeen.has(a)) codeSeen.set(a, (await provider.getCode(a)) !== "0x");
    return codeSeen.get(a)!;
  };
  const records: Record<string, string> = {};
  const rec = async (name: string): Promise<string | undefined> => {
    const file = path.join(recordsDir, `${name}.json`);
    if (!fs.existsSync(file)) return undefined;
    const a = addr(JSON.parse(fs.readFileSync(file, "utf8")).address);
    if (!a) return undefined;
    if (!(await hasCode(a))) throw new Error(`Refusing: the ${name} record ${a} has no code on ${network} (chain ${chainId}). Wrong network, or stale records?`);
    records[name] = a;
    return a;
  };
  /** A record name only, no code check (a retired contract's record: only its existence is read). */
  const recAddress = (name: string) => {
    const file = path.join(recordsDir, `${name}.json`);
    return fs.existsSync(file) ? addr(JSON.parse(fs.readFileSync(file, "utf8")).address) : undefined;
  };
  /** A credit-stack record is fresh once D1 retired the old one (`<name>PreAudit`) and a new one is recorded. */
  const fresh = async (name: string): Promise<{ address?: string; why?: string }> => {
    const retired = recAddress(`${name}${RETIRED_SUFFIX}`);
    const current = recAddress(name);
    if (!retired) return { why: `the old ${name} is not retired yet (D1), so the ${name} record is still the old one` };
    if (!current) return { why: `no fresh ${name} is recorded yet` };
    if (same(current, retired)) return { why: `the ${name} record is still the retired one` };
    return { address: await rec(name) };
  };

  const contract = async (name: string, address: string) => new ethers.Contract(address, (await artifacts.readArtifact(name)).abi, provider);

  const labels = new Map<string, string[]>();
  const label = (a: string | undefined, l: string) => {
    if (!a) return;
    const k = a.toLowerCase();
    const have = labels.get(k) ?? [];
    if (!have.includes(l)) have.push(l);
    labels.set(k, have);
  };
  const nameOf = (a: string) => labels.get(a.toLowerCase())?.join(", ") ?? short(a);

  const deployer = addr(env.DEPLOYER) ?? addr(env.VAULT_ADMIN);
  const lendingSafe = addr(env.CLEAR_LENDING_SAFE);
  const financialSafe = addr(env.CLEAR_FINANCIAL_SAFE);
  const treasurySigners = addrList("TREASURY_SIGNERS");
  const agentKey = addr(env.AGENT_KEY);
  const settings = addrList("CREDIT_SETTINGS_SIGNERS");
  const attesters = addrList(env.CREDIT_ATTESTER_SIGNERS ? "CREDIT_ATTESTER_SIGNERS" : "CREDIT_ATTESTERS");
  const holds = addrList("HOLD_SIGNERS");
  const operator = addr(env.CREDIT_OPERATOR_ADDRESS);
  const feeRecipient = addr(env.FEE_RECIPIENT);
  const vaultAdmin = addr(env.VAULT_ADMIN) ?? deployer;
  let valuation: string[] = [];
  try {
    if (o.valuationSigners) valuation = o.valuationSigners.map((a) => ethers.getAddress(a));
    else {
      const { loadEarnRoles, EARN_ROLES_FILE } = require("../deploy/earnWiring");
      valuation = ((loadEarnRoles(network, o.earnRolesFile ?? EARN_ROLES_FILE).LendingPool.VALUATION_ROLE ?? []) as string[]).map((a) => ethers.getAddress(a));
    }
  } catch (e: any) {
    notes.push(`No VALUATION_ROLE signers: ${String(e?.message ?? e)}`);
  }
  let deploymentSigners: string[] = [];
  try {
    if (o.deploymentSigners) deploymentSigners = o.deploymentSigners.map((a) => ethers.getAddress(a));
    else {
      const { loadEarnRoles, EARN_ROLES_FILE } = require("../deploy/earnWiring");
      deploymentSigners = ((loadEarnRoles(network, o.earnRolesFile ?? EARN_ROLES_FILE).LendingPool.DEPLOYER_ROLE ?? []) as string[]).map((a) => ethers.getAddress(a));
    }
  } catch (e: any) {
    notes.push(`No DEPLOYER_ROLE signers: ${String(e?.message ?? e)}`);
  }

  label(deployer, "the deployer");
  label(lendingSafe, "Clear Lending Safe");
  label(financialSafe, "Clear Financial Safe");
  label(addr(env.OPS_SAFE), "Ops Safe");
  label(agentKey, "Agent Key");
  treasurySigners.forEach((a, i) => label(a, `treasury signer ${ordinal(i)}`));
  settings.forEach((a, i) => label(a, `credit settings signer ${ordinal(i)}`));
  attesters.forEach((a, i) => label(a, `credit attester ${ordinal(i)}`));
  holds.forEach((a, i) => label(a, `hold signer ${ordinal(i)}`));
  valuation.forEach((a, i) => label(a, `valuation signer ${ordinal(i)}`));
  label(operator, "credit operator");
  label(feeRecipient, "fee recipient");
  label(addr(env.RELAYER), "savings relayer");
  label(addr(env.SAFE_NEW_OWNER), "new Safe owner");
  label(addr(env.BOARD_SAFE), "Clear Treasury (board) Safe");
  label(addr(env.COOP_TREASURY), "co-op treasury");
  label(addr(env.CLEAR_LENDING_ACCOUNT), "CL Operating");
  label(addr(env.ASSURANCE_DRAW_ADDRESS), "Assurance draw address");
  label(addr(env.ASSURANCE_LOSS_RESERVE), "CL Loss Reserve");
  label(addr(env.ASSURANCE_CL_FEES_PAYER), "CL fees payer");
  label(addr(env.ASSURANCE_DISBURSEMENT), "Assurance disbursement");

  // The Assurance Pool's governed setup (owner decision, Nov 16, 2026). Its inputs are checked first,
  // and loudly: an empty one, or one the pool would refuse, stops the plan (nothing falls back).
  const assuranceSigners = addrList("ASSURANCE_SIGNERS");
  if (assuranceSigners.length < 2) throw new Error("Refusing: ASSURANCE_SIGNERS must list the Assurance Pool's two signers (deploy/config/base-sepolia.rollout.env).");
  const exposureDefault = await fresh("CollateralRegistry");
  const assurance: AssuranceSetup = assuranceSetupFromEnv(env, exposureDefault.address ? [exposureDefault.address] : []);
  assuranceSigners.forEach((a, i) => label(a, `Assurance signer ${ordinal(i)}`));

  /** Call data, signature and labelled arguments for `fn` on `c`. */
  const encode = (c: any, fn: string, values: any[], notesFor: (string | undefined)[] = []) => {
    const f = c.interface.getFunction(fn);
    const data: string = c.interface.encodeFunctionData(f, values);
    const show = (v: any): string => (Array.isArray(v) ? JSON.stringify(v.map(show)) : typeof v === "bigint" ? v.toString() : String(v));
    const args: PlanArg[] = f.inputs.map((p: any, i: number) => {
      const value = show(values[i]);
      const note = notesFor[i] ?? (p.type === "address" && ethers.isAddress(value) ? nameOf(value) : undefined);
      return { name: p.name || `arg${i}`, type: p.type, value, ...(note ? { note } : {}) };
    });
    return { data, functionSignature: f.format("sighash"), args };
  };
  const signatureOf = (c: any, fn: string) => c.interface.getFunction(fn).format("sighash");

  const push = (s: Omit<PlanStep, "chainId" | "value" | "signerLabel" | "toLabel"> & { signerLabel?: string; toLabel?: string }) => {
    steps.push({
      id: s.id,
      stage: s.stage,
      title: s.title,
      explanation: s.explanation,
      kind: s.kind,
      signer: s.signer,
      signerLabel: s.signerLabel ?? nameOf(s.signer),
      chainId,
      to: s.to,
      toLabel: s.toLabel ?? nameOf(s.to),
      value: "0",
      data: s.data,
      functionSignature: s.functionSignature,
      args: s.args,
      dependsOn: s.dependsOn,
      status: s.status,
      ...(s.reason ? { reason: s.reason } : {}),
    });
  };
  const waitingFor = (what: string) => ({ status: "waiting" as const, reason: what });

  // ================= C1d: the vault upgrade batch, sent by the vault's admin =================
  const vaultBatchFile = path.join(recordsDir, "safe-batches", "vault-1-upgrade.json");
  const vaultRecord = await rec("ESADepositVault");
  if (vaultRecord) label(vaultRecord, "ESADepositVault (the savings vault)");
  if (!fs.existsSync(vaultBatchFile)) notes.push(`No ${vaultBatchFile}: the C1d steps (the vault's admin sends the upgrade batch) appear once C1c (scripts/migrate_vault_clrusd.ts) writes it.`);
  if (fs.existsSync(vaultBatchFile) && vaultRecord && vaultAdmin) {
    const batch = JSON.parse(fs.readFileSync(vaultBatchFile, "utf8"));
    const vault = await contract("ESADepositVault", vaultRecord);
    if (Number(batch.chainId) !== chainId) {
      notes.push(`${vaultBatchFile} is for chain ${batch.chainId}, not ${chainId}: left out.`);
    } else {
      const txs: { to: string; data: string }[] = batch.transactions ?? [];
      let previous: string | undefined;
      for (const [i, t] of txs.entries()) {
        const id = `C1d-${i + 1}`;
        if (!same(t.to, vaultRecord)) throw new Error(`Refusing: ${vaultBatchFile} call ${i + 1} is to ${t.to}, not the ESADepositVault record ${vaultRecord}.`);
        const parsed = vault.interface.parseTransaction({ data: t.data });
        if (!parsed) throw new Error(`Refusing: ${vaultBatchFile} call ${i + 1} is not an ESADepositVault call.`);
        const roleName = (h: string) => ["RELAYER_ROLE", "OPERATOR_ROLE", "PAUSER_ROLE", "PILOT_ROLE"].find((r) => ethers.id(r) === h) ?? (h === ZERO_HASH ? "DEFAULT_ADMIN_ROLE" : undefined);
        let done = false;
        let title = `Savings vault: ${parsed.name}`;
        let explanation = "A call from the vault upgrade batch that scripts/migrate_vault_clrusd.ts wrote.";
        const argNotes: (string | undefined)[] = [];
        if (parsed.name === "upgradeToAndCall") {
          const impl = ethers.getAddress(parsed.args[0]);
          const slot = await provider.getStorage(vaultRecord, IMPL_SLOT);
          done = same(ethers.getAddress("0x" + slot.slice(-40)), impl);
          title = "Upgrade the savings vault, and set USDC as the one token it accepts";
          explanation = "Moves the savings vault to its audited code. The same call names USDC as the only token it accepts, so deposits and redemptions never stop between the two.";
          argNotes.push("the new implementation", "setAcceptedToken(USDC, true), run in the same call");
        } else if (parsed.name === "grantRole" || parsed.name === "revokeRole") {
          const held: boolean = await vault.hasRole(parsed.args[0], parsed.args[1]);
          done = parsed.name === "grantRole" ? held : !held;
          const r = roleName(parsed.args[0]) ?? "a role";
          const who = labels.has(String(parsed.args[1]).toLowerCase()) ? `the ${nameOf(parsed.args[1])}` : short(String(parsed.args[1]));
          title = parsed.name === "grantRole" ? `Give ${who} the savings vault's ${r}` : `Take the savings vault's ${r} away from ${who}`;
          explanation = r === "RELAYER_ROLE"
            ? "The relayer only submits deposits members signed: it gets the narrower relayer role (audit H-3)."
            : r === "OPERATOR_ROLE" ? "The old operator role let the relayer key do more than relay; it is taken away (audit H-3)." : explanation;
          argNotes.push(r);
        }
        const enc = { data: t.data, functionSignature: parsed.fragment.format("sighash"), args: parsed.fragment.inputs.map((p: any, j: number) => ({ name: p.name, type: p.type, value: String(parsed.args[j]), ...(argNotes[j] ? { note: argNotes[j] } : p.type === "address" ? { note: nameOf(String(parsed.args[j])) } : {}) })) };
        push({
          id, stage: "C1d", title, explanation: `${explanation} Call ${i + 1} of ${txs.length}, in order.`, kind: "wallet", signer: vaultAdmin,
          signerLabel: `the vault's admin (VAULT_ADMIN, ${nameOf(vaultAdmin)})`, to: vaultRecord, ...enc,
          dependsOn: previous ? [previous] : [], ...(done ? { status: "done" as const } : { status: "ready" as const }),
        });
        previous = id;
      }
    }
  }

  // ================= D4: the credit keys on the fresh AccessManager (the deployer) =================
  const access = await fresh("AccessManager");
  const accessContract = access.address ? await contract("AccessManager", access.address) : undefined;
  if (access.address) label(access.address, "AccessManager");
  const accessIface = accessContract ?? (await contract("AccessManager", ZERO_ADDRESS));
  const grantStepIds = new Map<string, string>();
  for (const [roleName, holders, slot, short_, what] of [
    ["CREDIT_SETTINGS_ROLE", settings, "credit settings signer", "settings", "Lets this person change how the credit system is set up (tiers, rates, treasuries, caps). Two people hold it: one proposes a change such as the fee recipient, the other approves it."],
    ["CREDIT_ATTESTER_ROLE", attesters, "credit attester", "attester", "Lets this person record the credit system's two-person attestations: cure notices, Income Assurance and workouts. Two people hold it."],
  ] as [string, string[], string, string, string][]) {
    const role = ethers.id(roleName);
    if (holders.length < 2) notes.push(`Waiting for input: ${slot}s (${roleName === "CREDIT_SETTINGS_ROLE" ? "CREDIT_SETTINGS_SIGNERS" : "CREDIT_ATTESTER_SIGNERS"}) needs two addresses.`);
    for (const [i, h] of holders.entries()) {
      const id = `D4-${short_}-${i + 1}`;
      grantStepIds.set(`${roleName}:${h.toLowerCase()}`, id);
      const enc = encode(accessIface, "grantRole", [role, h], [roleName]);
      let st: { status: StepStatus; reason?: string };
      if (!accessContract || !deployer) st = waitingFor(!deployer ? "Waiting for input: DEPLOYER (the deployer's address)." : `Waits for D1 and D2: ${access.why}.`);
      else if (await accessContract.hasRole(role, h)) st = { status: "done" };
      else if (!(await accessContract.hasRole(await accessContract.getRoleAdmin(role), deployer))) st = waitingFor("The deployer no longer holds the AccessManager's admin (the credit handover, I2, moved it): this grant is now an Ops Safe proposal on the credit timelock.");
      else st = { status: "ready" };
      push({
        id, stage: "D4", title: `Give ${slot} ${i + 1} the ${roleName.replace(/_/g, " ").toLowerCase().replace(" role", "")} role`,
        explanation: `${what} The deployer still holds the new AccessManager's admin, so it grants it.`,
        kind: "wallet", signer: deployer ?? ZERO_ADDRESS, signerLabel: "the deployer", to: access.address ?? ZERO_ADDRESS, toLabel: "AccessManager", ...enc, dependsOn: [], ...st,
      });
    }
  }
  {
    const st = !operator
      ? waitingFor("Waiting for input: CREDIT_OPERATOR_ADDRESS (the API prints it at startup as \"[wallets] credit operator: 0x…\"). Set it in deploy/config/base-sepolia.rollout.env and re-run.")
      : !accessContract || !deployer ? waitingFor(!deployer ? "Waiting for input: DEPLOYER." : `Waits for D1 and D2: ${access.why}.`)
        : (await accessContract.isOperator(operator)) ? { status: "done" as const }
          : !(await accessContract.isAdmin(deployer)) ? waitingFor("The deployer no longer holds the AccessManager's admin (I2 moved it): this grant is now an Ops Safe proposal.")
            : { status: "ready" as const };
    const enc = operator ? encode(accessIface, "grantOperator", [operator]) : { data: null, functionSignature: signatureOf(accessIface, "grantOperator"), args: [{ name: "operator", type: "address", value: "(CREDIT_OPERATOR_ADDRESS, not set yet)" }] };
    push({
      id: "D4-operator", stage: "D4", title: "Make the API's credit operator wallet an operator",
      explanation: "The members app's server uses this wallet to open credit lines and register members. Without it, no new credit line can open on the fresh credit stack.",
      kind: "wallet", signer: deployer ?? ZERO_ADDRESS, signerLabel: "the deployer", to: access.address ?? ZERO_ADDRESS, toLabel: "AccessManager", ...enc, dependsOn: [], ...st,
    });
  }

  // ================= E8, E9: the co-signed Collateral Agent changes =================
  const agentAddress = await rec("CollateralAgent");
  const bondVault = await rec("BondVault");
  const holderDirections = await rec("HolderDirections");
  const liquidator = await fresh("Liquidator");
  const earnTimelock = await rec("EarnTimelock");
  label(agentAddress, "CollateralAgent");
  label(bondVault, "BondVault");
  label(holderDirections, "HolderDirections");
  label(liquidator.address, "Liquidator");
  label(earnTimelock, "Earn timelock");
  const agent = agentAddress ? await contract("CollateralAgent", agentAddress) : undefined;
  const agentIface = agent ?? (await contract("CollateralAgent", ZERO_ADDRESS));
  const vaultC = bondVault ? await contract("BondVault", bondVault) : undefined;

  interface Change {
    key: string;
    what: string;
    target?: string;
    targetLabel: string;
    data?: string;
    description: string;
    applied: boolean;
    blocked?: string;
  }
  const changes: Change[] = [];
  const agentSetting = async (key: string, fn: string, view: string, value: string | undefined, what: string, missing: string) => {
    if (!agent) return changes.push({ key, what, targetLabel: "CollateralAgent", description: "", applied: false, blocked: "No CollateralAgent record yet (deploy 26, E1)." });
    if (!value) return changes.push({ key, what, target: agentAddress, targetLabel: "CollateralAgent", description: "", applied: false, blocked: missing });
    const data = agent.interface.encodeFunctionData(fn, [value]);
    const applied = same(await agent[view](), value);
    const description = fn === "setPledgeModule"
      ? `CollateralAgent.setPledgeModule(${value}): the Liquidator answers IAgentPledgeModule (decision 19)`
      : `CollateralAgent.${fn}(${value})`;
    changes.push({ key, what, target: agentAddress, targetLabel: "CollateralAgent", data, description, applied });
  };
  await agentSetting("vault", "setVault", "vault", bondVault, "point the Collateral Agent at the BondVault, where bond money is held", "No BondVault record yet.");
  await agentSetting("bondbook", "setBondBook", "bondBook", bondVault, "tell the Collateral Agent that the BondVault keeps the bond register", "No BondVault record yet.");
  await agentSetting("holderdirections", "setHolderDirections", "holderDirections", holderDirections, "name HolderDirections as where bond holders' directions are counted", "No HolderDirections record yet (deploy 23, E6).");
  await agentSetting("pledgemodule", "setPledgeModule", "pledgeModule", liquidator.address, "name the Liquidator as the Collateral Agent's pledge module", `No fresh Liquidator yet (deploy 22, E4): ${liquidator.why}.`);
  // E9 (decision 48 a): the BondVault's backstop names the retired PayoutPool.
  if (vaultC) {
    const payout: string = await vaultC.payoutPool();
    const retiredPayouts = ["PayoutPoolPreAudit", "PayoutPoolPre2f", "PayoutPoolLegacy"].map(recAddress).filter(Boolean) as string[];
    const what = "clear the BondVault's backstop link to the retired PayoutPool (the treasury is kept)";
    if (same(payout, ZERO_ADDRESS)) {
      changes.push({ key: "backstop", what, target: bondVault, targetLabel: "BondVault", description: "", applied: true });
    } else if (!retiredPayouts.length) {
      changes.push({ key: "backstop", what, target: bondVault, targetLabel: "BondVault", description: "", applied: false,
        blocked: `Waits for D1, which retires the PayoutPool the BondVault names (${short(payout)}), and deploy 22 (E4).` });
    } else if (retiredPayouts.some((r) => same(r, payout))) {
      const lent: bigint = await vaultC.lentToPayoutPool();
      const treasury: string = await vaultC.treasury();
      const data = vaultC.interface.encodeFunctionData("setBackstops", [treasury, ZERO_ADDRESS]);
      const description = `BondVault.setBackstops(${treasury}, 0): keep the treasury, clear the retired payout pool ${payout} (decision 48)`;
      const agentNamed = !same(await vaultC.agent().catch(() => ZERO_ADDRESS), ZERO_ADDRESS);
      changes.push({
        key: "backstop", what, target: bondVault, targetLabel: "BondVault", data, description, applied: false,
        blocked: lent !== 0n ? `The BondVault still has ${lent} lent to the retired PayoutPool: it must be repaid first (decision 50 leaves it in place on a testnet).`
          : !agentNamed ? "The BondVault names no Collateral Agent yet (deploy 23, E6)." : undefined,
      });
    } else {
      notes.push(`BondVault.payoutPool() is ${payout}, not a retired PayoutPool on record: no backstop change (E9) is planned.`);
    }
  } else {
    changes.push({ key: "backstop", what: "clear the BondVault's backstop link to the retired PayoutPool", targetLabel: "BondVault", description: "", applied: false, blocked: "No BondVault record yet." });
  }

  const coSignIds: string[] = [];
  for (const c of changes) {
    const ids = { propose: `E8-${c.key}-propose`, confirm: `E8-${c.key}-confirm`, approve: `E8-${c.key}-approve` };
    let open: string = ZERO_HASH;
    let ch: any;
    const callHash = c.data ? ethers.keccak256(c.data) : undefined;
    if (agent && c.target && callHash && !c.applied) {
      open = await agent.openChangeFor(c.target, callHash);
      if (open !== ZERO_HASH) ch = await agent.change(open);
    }
    const doneAll = c.applied ? { status: "done" as const, reason: "The change is already made." } : undefined;
    const blocked = c.blocked ? waitingFor(c.blocked) : undefined;
    const proposer = ch ? ethers.getAddress(ch.proposer) : treasurySigners[0];
    const confirmer = ch ? treasurySigners.find((s) => !same(s, ch.proposer)) : treasurySigners[1];
    const noTreasury = treasurySigners.length < 2 ? waitingFor("Waiting for input: TREASURY_SIGNERS needs two addresses.") : undefined;
    // propose
    {
      const enc = c.target && callHash
        ? encode(agentIface, "proposeChange", [c.target, callHash, ethers.id(c.description)], [c.targetLabel, `keccak256 of the ${c.targetLabel} call: ${c.description.split(":")[0]}`, `keccak256 of "${c.description}"`])
        : { data: null, functionSignature: signatureOf(agentIface, "proposeChange"), args: [] };
      push({
        id: ids.propose, stage: c.key === "backstop" ? "E9" : "E8", title: `Propose: ${c.what}`,
        explanation: "Treasury signer 1 proposes the change. Nothing changes yet: a second treasury signer confirms it, the Agent Key approves it, and the Clear Lending Safe runs it through the Earn timelock 7 days later.",
        kind: "wallet", signer: proposer ?? ZERO_ADDRESS, signerLabel: "treasury signer 1", to: agentAddress ?? ZERO_ADDRESS, toLabel: "CollateralAgent", ...enc, dependsOn: [],
        ...(doneAll ?? blocked ?? noTreasury ?? (ch ? { status: "done" as const } : { status: "ready" as const })),
      });
    }
    // confirm
    {
      const enc = ch ? encode(agentIface, "confirmChange", [open], ["the change's number (read from the CollateralAgent)"]) : { data: null, functionSignature: signatureOf(agentIface, "confirmChange"), args: [{ name: "changeId", type: "bytes32", value: "(known once the change is proposed)" }] };
      push({
        id: ids.confirm, stage: c.key === "backstop" ? "E9" : "E8", title: `Confirm: ${c.what}`,
        explanation: "A second treasury signer (not the one who proposed it) confirms the proposal. The Collateral Agent's 7-day wait starts now.",
        kind: "wallet", signer: confirmer ?? ZERO_ADDRESS, signerLabel: "treasury signer 2", to: agentAddress ?? ZERO_ADDRESS, toLabel: "CollateralAgent", ...enc, dependsOn: [ids.propose],
        ...(doneAll ?? blocked ?? noTreasury ?? (ch && !same(ch.confirmer, ZERO_ADDRESS) ? { status: "done" as const } : ch ? { status: "ready" as const } : waitingFor("Its change number is known once the change is proposed: re-run the plan after the proposal."))),
      });
    }
    // approve
    {
      const enc = ch ? encode(agentIface, "approveChange", [open], ["the change's number (read from the CollateralAgent)"]) : { data: null, functionSignature: signatureOf(agentIface, "approveChange"), args: [{ name: "changeId", type: "bytes32", value: "(known once the change is proposed)" }] };
      let keyProblem: { status: StepStatus; reason?: string } | undefined;
      if (!agentKey) keyProblem = waitingFor("Waiting for input: AGENT_KEY.");
      else if (agent && !same(await agent.agentKey(), agentKey)) keyProblem = waitingFor(`The CollateralAgent's Agent Key is ${await agent.agentKey()}, not AGENT_KEY ${agentKey}.`);
      push({
        id: ids.approve, stage: c.key === "backstop" ? "E9" : "E8", title: `Agent Key approves: ${c.what}`,
        explanation: "The Collateral Agent co-signs the change, as the bond terms require (IV-10 Exhibit A, Part 2 item 6).",
        kind: "wallet", signer: agentKey ?? ZERO_ADDRESS, signerLabel: "the Agent Key", to: agentAddress ?? ZERO_ADDRESS, toLabel: "CollateralAgent", ...enc, dependsOn: [ids.propose],
        ...(doneAll ?? blocked ?? keyProblem ?? (ch && ch.agentApproved ? { status: "done" as const } : ch ? { status: "ready" as const } : waitingFor("Its change number is known once the change is proposed: re-run the plan after the proposal."))),
      });
    }
    if (!c.applied) coSignIds.push(ids.confirm, ids.approve);
    (c as any).changeId = open;
    (c as any).record = ch;
  }

  // Liquidator HOLD_ROLE, by the deployer (E8).
  {
    const liq = liquidator.address ? await contract("Liquidator", liquidator.address) : undefined;
    const iface = liq ?? (await contract("Liquidator", ZERO_ADDRESS));
    const HOLD = ethers.id("HOLD_ROLE");
    if (holds.length < 2) notes.push("Waiting for input: HOLD_SIGNERS needs two addresses.");
    for (const [i, h] of holds.entries()) {
      let st: { status: StepStatus; reason?: string };
      if (!liq || !deployer) st = waitingFor(!deployer ? "Waiting for input: DEPLOYER." : `Waits for deploy 22 (E4): ${liquidator.why}.`);
      else if (await liq.hasRole(HOLD, h)) st = { status: "done" };
      else if (!(await liq.hasRole(await liq.getRoleAdmin(HOLD), deployer))) st = waitingFor("The deployer no longer holds the Liquidator's admin (the credit handover, I2, moved it): this grant is now an Ops Safe proposal on the credit timelock.");
      else st = { status: "ready" };
      push({
        id: `E8-hold-${i + 1}`, stage: "E8", title: `Give hold signer ${i + 1} the Liquidator's hold role`,
        explanation: "Lets this person propose, confirm, renew and clear a Liquidation Hold on a member's pledged savings. Every step needs two different holders, so two people get it. Do this before the credit handover (I2).",
        kind: "wallet", signer: deployer ?? ZERO_ADDRESS, signerLabel: "the deployer", to: liquidator.address ?? ZERO_ADDRESS, toLabel: "Liquidator", ...encode(iface, "grantRole", [HOLD, h], ["HOLD_ROLE"]), dependsOn: [], ...st,
      });
    }
  }

  // The Clear Lending Safe schedules the changes on the Earn timelock, and executes them on day 7.
  const timelockIface = await contract("TimelockController", ZERO_ADDRESS);
  const timelockOf = async (a: string) => contract("TimelockController", a);
  {
    const pending = changes.filter((c) => !c.applied);
    const blocked = pending.filter((c) => c.blocked || !c.data || !c.target);
    const tl = earnTimelock ? await timelockOf(earnTimelock) : undefined;
    const salt = ethers.id("signing-plan: E8 Earn timelock batch (Collateral Agent changes)");
    const targets = pending.map((c) => c.target ?? ZERO_ADDRESS);
    const payloads = pending.map((c) => c.data ?? "0x");
    const values = pending.map(() => 0n);
    const delay: bigint = tl ? await tl.getMinDelay() : 604800n;
    const opId: string = tl && !blocked.length && pending.length ? await tl.hashOperationBatch(targets, values, payloads, ZERO_HASH, salt) : ZERO_HASH;
    const listed = pending.map((c) => `${c.targetLabel}: ${c.what}`).join("; ");
    const schedule = { id: "E8-earn-schedule", execute: "E8x-earn-execute" };
    let sSt: { status: StepStatus; reason?: string };
    let xSt: { status: StepStatus; reason?: string };
    if (!pending.length) {
      sSt = { status: "done", reason: "Every change is made." };
      xSt = { status: "done", reason: "Every change is made." };
    } else if (blocked.length) {
      sSt = xSt = waitingFor(`Waits for every change to be ready to propose: ${[...new Set(blocked.map((c) => c.blocked ?? c.key))].join(" ")}`);
    } else if (!tl || !lendingSafe) {
      sSt = xSt = waitingFor(!lendingSafe ? "Waiting for input: CLEAR_LENDING_SAFE." : "No EarnTimelock record yet (deploy 26, E1).");
    } else if (!(await tl.hasRole(await tl.PROPOSER_ROLE(), lendingSafe))) {
      sSt = xSt = waitingFor(`CLEAR_LENDING_SAFE ${lendingSafe} is not a proposer on the Earn timelock ${earnTimelock}.`);
    } else {
      sSt = (await tl.isOperation(opId)) ? { status: "done" } : { status: "ready" };
      if (await tl.isOperationDone(opId)) xSt = { status: "done" };
      else if (!(await tl.isOperation(opId))) xSt = waitingFor("Waits for the schedule step, then 7 days.");
      else {
        const why: string[] = [];
        if (!(await tl.isOperationReady(opId))) why.push(`the Earn timelock's 7 days end at ${new Date(Number(await tl.getTimestamp(opId)) * 1000).toISOString()}`);
        let agentWaitEnds = 0n;
        for (const c of pending) {
          const r = (c as any).record;
          if (!r || same(r.confirmer, ZERO_ADDRESS) || !r.agentApproved) why.push(`the change "${c.what}" is not confirmed and approved yet`);
          else if (now < BigInt(r.confirmedAt) + 7n * 86400n && BigInt(r.confirmedAt) + 7n * 86400n > agentWaitEnds) agentWaitEnds = BigInt(r.confirmedAt) + 7n * 86400n;
          const tc = await contract("BondVault", c.target!); // DEFAULT_ADMIN_ROLE is 0 on every AccessControl contract
          if (!(await tc.hasRole(ZERO_HASH, earnTimelock))) why.push(`the Earn timelock does not hold the ${c.targetLabel}'s admin yet (the Earn handover, I4, gives it)`);
        }
        if (agentWaitEnds) why.push(`the Collateral Agent's 7 days (from the last confirmation) end at ${new Date(Number(agentWaitEnds) * 1000).toISOString()}`);
        xSt = why.length ? waitingFor(`Not yet: ${[...new Set(why)].join("; ")}.`) : { status: "ready" };
      }
    }
    const tlAddress = earnTimelock ?? ZERO_ADDRESS;
    push({
      id: schedule.id, stage: "E8", title: "Clear Lending Safe: schedule the Collateral Agent changes on the Earn timelock",
      explanation: `Queues the co-signed change${pending.length === 1 ? "" : "s"} (${listed || "none left"}). They can run 7 days later. Sign it in the Safe app: Transaction Builder, load the batch file.`,
      kind: "safe", signer: lendingSafe ?? ZERO_ADDRESS, signerLabel: "Clear Lending Safe (its owners sign in the Safe app)", to: tlAddress, toLabel: "Earn timelock",
      ...encode(timelockIface, "scheduleBatch", [targets, values, payloads, ZERO_HASH, salt, delay], [pending.map((c) => c.targetLabel).join(", "), undefined, "the co-signed calls", "none", "a fixed label for this batch", `${Number(delay) / 86400} days`]),
      dependsOn: coSignIds, ...sSt,
    });
    push({
      id: schedule.execute, stage: "Day 7", title: "Clear Lending Safe: run the Collateral Agent changes (day 7)",
      explanation: "After both 7-day waits (the Earn timelock's and the Collateral Agent's), the Safe runs the queued changes. Only the Safe may run them: it is the timelock's only executor.",
      kind: "safe", signer: lendingSafe ?? ZERO_ADDRESS, signerLabel: "Clear Lending Safe (its owners sign in the Safe app)", to: tlAddress, toLabel: "Earn timelock",
      ...encode(timelockIface, "executeBatch", [targets, values, payloads, ZERO_HASH, salt], [pending.map((c) => c.targetLabel).join(", "), undefined, "the co-signed calls", "none", "the same label"]),
      dependsOn: [schedule.id], ...xSt,
    });
  }

  // ================= F2: the second CREDIT_SETTINGS_ROLE holder approves the fee recipient =================
  {
    const term = await fresh("TermIssuer");
    label(term.address, "TermIssuer");
    const t = term.address ? await contract("TermIssuer", term.address) : undefined;
    const iface = t ?? (await contract("TermIssuer", ZERO_ADDRESS));
    let signer = settings[1];
    let reasonCode = ethers.encodeBytes32String("INITIAL");
    let st: { status: StepStatus; reason?: string };
    if (!feeRecipient) st = waitingFor("Waiting for input: FEE_RECIPIENT.");
    else if (settings.length < 2) st = waitingFor("Waiting for input: CREDIT_SETTINGS_SIGNERS needs two addresses.");
    else if (!t) st = waitingFor(`Waits for deploy 20 (D3): ${term.why}.`);
    else if (same(await t.feeRecipient(), feeRecipient)) st = { status: "done" };
    // F2 is the first naming. Once a recipient is set, changing it to a different FEE_RECIPIENT is RT-fee-propose and
    // RT-fee-approve below.
    else if (!same(await t.feeRecipient(), ZERO_ADDRESS)) st = { status: "done", reason: `A fee recipient is set (${nameOf(await t.feeRecipient())}); RT-fee-propose and RT-fee-approve change it to FEE_RECIPIENT.` };
    else {
      const p = await t.feeRecipientProposalOf();
      if (!same(p.recipient, feeRecipient)) st = waitingFor(`Deploy 25 (F2) proposes ${feeRecipient} as the fee recipient first.`);
      else {
        if (same(p.proposer, signer)) signer = settings[0];
        reasonCode = p.reasonCode;
        st = { status: "ready" };
      }
    }
    const reasonText = (() => { try { return ethers.decodeBytes32String(reasonCode); } catch { return reasonCode; } })();
    push({
      id: "F2-fee-approve", stage: "F2", title: "Approve the fee recipient for term plans",
      explanation: `Deploy 25 proposed ${feeRecipient ? nameOf(feeRecipient) : "the fee recipient"} as where TermIssuer sends plan fees. A second credit settings signer approves it; until then no plan with a fee can open.`,
      kind: "wallet", signer: signer ?? ZERO_ADDRESS, signerLabel: `credit settings signer ${settings.findIndex((s) => same(s, signer)) + 1 || 2}`, to: term.address ?? ZERO_ADDRESS, toLabel: "TermIssuer",
      ...encode(iface, "approveFeeRecipient", [feeRecipient ?? ZERO_ADDRESS, reasonCode], [undefined, `"${reasonText}"`]),
      dependsOn: signer && grantStepIds.get(`CREDIT_SETTINGS_ROLE:${signer.toLowerCase()}`) ? [grantStepIds.get(`CREDIT_SETTINGS_ROLE:${signer.toLowerCase()}`)!] : [], ...st,
    });
  }

  // ================= RT: Clear Lending routing (the fee recipient and the card settlement account) =================
  // Deploy 25 carried both over from the old issuers, where they were the Clear Treasury Safe (the co-op's). A split
  // plan's fee is Clear Lending's (TermIssuer, 12.16 and Addendum 2), and a settled card purchase's claim belongs to
  // whoever paid the settlement: Clear Lending, through CL Operating, once Settlement Funding is live (decision 54).
  // FEE_RECIPIENT and CARD_SETTLEMENT_ACCOUNT name the target; these steps move an issuer that holds another account.
  // Neither has a timelock: the fee recipient takes two different CREDIT_SETTINGS_ROLE signers, the card account one.
  {
    const term = await fresh("TermIssuer");
    const t = term.address ? await contract("TermIssuer", term.address) : undefined;
    const tIface = t ?? (await contract("TermIssuer", ZERO_ADDRESS));
    const reasonCode = ethers.encodeBytes32String("CLEAR_LENDING_ROUTING");
    const settingsDep = (s?: string) => (s && grantStepIds.get(`CREDIT_SETTINGS_ROLE:${s.toLowerCase()}`) ? [grantStepIds.get(`CREDIT_SETTINGS_ROLE:${s.toLowerCase()}`)!] : []);
    const signerLabel = (s?: string) => `credit settings signer ${settings.findIndex((x) => same(x, s)) + 1 || "?"}`;
    let proposer = settings[0];
    let approver = settings[1];
    let ps: { status: StepStatus; reason?: string };
    let ap: { status: StepStatus; reason?: string };
    if (!feeRecipient) ps = ap = waitingFor("Waiting for input: FEE_RECIPIENT.");
    else if (settings.length < 2) ps = ap = waitingFor("Waiting for input: CREDIT_SETTINGS_SIGNERS needs two addresses.");
    else if (!t) ps = ap = waitingFor(`Waits for deploy 20 (D3): ${term.why}.`);
    else {
      const current: string = await t.feeRecipient();
      const p = await t.feeRecipientProposalOf();
      if (same(current, feeRecipient)) ps = ap = { status: "done", reason: `TermIssuer's fee recipient is ${nameOf(feeRecipient)}.` };
      else if (same(current, ZERO_ADDRESS)) ps = ap = waitingFor("No fee recipient is set yet: F2 names the first one.");
      else if (same(feeRecipient, await t.carryTreasury())) ps = ap = waitingFor(`FEE_RECIPIENT ${feeRecipient} is TermIssuer's carry treasury, which it refuses as the fee recipient.`);
      else if (same(p.recipient, feeRecipient) && p.reasonCode === reasonCode) {
        proposer = p.proposer;
        approver = settings.find((s) => !same(s, p.proposer)) ?? settings[1];
        ps = { status: "done", reason: `Proposed by ${nameOf(p.proposer)}.` };
        ap = { status: "ready", reason: `Moves plan fees from ${nameOf(current)} to ${nameOf(feeRecipient)}. A refund of an earlier charge still reverses from where its fee went.` };
      } else {
        ps = { status: "ready", reason: `TermIssuer sends plan fees to ${nameOf(current)}; FEE_RECIPIENT is ${nameOf(feeRecipient)}.` };
        ap = waitingFor("Waits for RT-fee-propose, by a different credit settings signer.");
      }
    }
    push({
      id: "RT-fee-propose", stage: "RT", title: "Propose Clear Lending as the fee recipient for term plans",
      explanation: `TermIssuer sends each split plan's fee to its fee recipient, which is Clear Lending's (Addendum 2: the fee no longer goes to the co-op). Deploy 25 carried the old issuer's recipient over, the Clear Treasury Safe. This proposes ${feeRecipient ? nameOf(feeRecipient) : "FEE_RECIPIENT"}; a different credit settings signer approves it. No timelock.`,
      kind: "wallet", signer: proposer ?? ZERO_ADDRESS, signerLabel: signerLabel(proposer), to: term.address ?? ZERO_ADDRESS, toLabel: "TermIssuer",
      ...encode(tIface, "proposeFeeRecipient", [feeRecipient ?? ZERO_ADDRESS, reasonCode], [undefined, '"CLEAR_LENDING_ROUTING"']),
      dependsOn: settingsDep(proposer), ...ps,
    });
    push({
      id: "RT-fee-approve", stage: "RT", title: "Approve Clear Lending as the fee recipient for term plans",
      explanation: `The second credit settings signer approves the proposal: from then on plan fees go to ${feeRecipient ? nameOf(feeRecipient) : "FEE_RECIPIENT"}. It must be a different signer from the one who proposed.`,
      kind: "wallet", signer: approver ?? ZERO_ADDRESS, signerLabel: signerLabel(approver), to: term.address ?? ZERO_ADDRESS, toLabel: "TermIssuer",
      ...encode(tIface, "approveFeeRecipient", [feeRecipient ?? ZERO_ADDRESS, reasonCode], [undefined, '"CLEAR_LENDING_ROUTING"']),
      dependsOn: ["RT-fee-propose", ...settingsDep(approver)], ...ap,
    });

    const cardAccount = addr(env.CARD_SETTLEMENT_ACCOUNT);
    const rev = await fresh("RevolvingIssuer");
    const r = rev.address ? await contract("RevolvingIssuer", rev.address) : undefined;
    const rIface = r ?? (await contract("RevolvingIssuer", ZERO_ADDRESS));
    label(rev.address, "RevolvingIssuer");
    const cardSigner = settings[0];
    let cs: { status: StepStatus; reason?: string };
    if (!cardAccount) cs = waitingFor("Waiting for input: CARD_SETTLEMENT_ACCOUNT.");
    else if (!cardSigner) cs = waitingFor("Waiting for input: CREDIT_SETTINGS_SIGNERS.");
    else if (!r) cs = waitingFor(`Waits for deploy 20 (D3): ${rev.why}.`);
    else {
      const current: string = await r.cardSettlementAccount();
      if (same(current, cardAccount)) cs = { status: "done", reason: `Card claims are minted to ${nameOf(cardAccount)}.` };
      else {
        // repayCardSpend reverses a purchase out of the current account's claims: claims left with the old account
        // could not be repaid once the account changes, so the step waits until it holds none.
        const credit = new ethers.Contract(await r.stableCredit(), ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"], provider);
        const held: bigint = same(current, ZERO_ADDRESS) ? 0n : await credit.balanceOf(current);
        cs = held > 0n
          ? waitingFor(`${nameOf(current)} holds ${ethers.formatUnits(held, await credit.decimals())} of card claims. Card repayments reverse out of the current account, so those claims must be repaid or moved before the account changes. Ask before going on.`)
          : { status: "ready", reason: `Card claims are minted to ${nameOf(current)}, which holds none; CARD_SETTLEMENT_ACCOUNT is ${nameOf(cardAccount)}.` };
      }
    }
    push({
      id: "RT-card-account", stage: "RT", title: "Point card settlement claims at Clear Lending",
      explanation: `Each settled card purchase mints its claim to RevolvingIssuer's card settlement account. Deploy 25 carried the old issuer's account over, the Clear Treasury Safe, but Clear Lending pays card settlements (decision 54: the Credit Settlement Account is funded from CL Operating). This sets it to ${cardAccount ? nameOf(cardAccount) : "CARD_SETTLEMENT_ACCOUNT"}. One credit settings signer; no timelock.`,
      kind: "wallet", signer: cardSigner ?? ZERO_ADDRESS, signerLabel: signerLabel(cardSigner), to: rev.address ?? ZERO_ADDRESS, toLabel: "RevolvingIssuer",
      ...encode(rIface, "setCardSettlementAccount", [cardAccount ?? ZERO_ADDRESS], [cardAccount ? nameOf(cardAccount) : undefined]),
      dependsOn: settingsDep(cardSigner), ...cs,
    });
  }

  // ================= Pool Tier (G1): each VALUATION_ROLE signer posts the principal =================
  {
    const poolAddress = await rec("LendingPool");
    label(poolAddress, "LendingPool (the Yield Pool)");
    const { poolAbi } = require("../deploy/poolModules");
    const pool = new ethers.Contract(poolAddress ?? ZERO_ADDRESS, await poolAbi(), provider);
    const principal = env.POOL_TIER_PRINCIPAL && /^\d+$/.test(env.POOL_TIER_PRINCIPAL) ? BigInt(env.POOL_TIER_PRINCIPAL) : undefined;
    const evidence = env.POOL_TIER_EVIDENCE && /^0x[0-9a-fA-F]{64}$/.test(env.POOL_TIER_EVIDENCE) && BigInt(env.POOL_TIER_EVIDENCE) !== 0n ? env.POOL_TIER_EVIDENCE : undefined;
    let posted: [bigint, bigint] | undefined;
    let notYield: string | undefined;
    if (poolAddress) {
      try {
        const r = await pool.poolTierPrincipal();
        posted = [r[0], r[1]];
      } catch {
        notYield = "The LendingPool is not the Yield Pool yet (scripts/upgrade_yield_pool.ts, E2).";
      }
    }
    let decimals = 6;
    try {
      const asset = await pool.asset();
      decimals = Number(await new ethers.Contract(asset, ["function decimals() view returns (uint8)"], provider).decimals());
    } catch { /* USDC's 6 */ }
    const dollars = principal !== undefined ? `$${Number(ethers.formatUnits(principal, decimals)).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
    const action = principal !== undefined && evidence ? ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint256", "bytes32"], ["poolTier", principal, evidence])) : undefined;
    const first: string | undefined = poolAddress && action && posted ? await pool.proposerOf(action) : undefined;
    if (valuation.length < 2) notes.push("Waiting for input: the pool's VALUATION_ROLE needs two signers in deploy/config/earn-roles.json.");
    const VALUATION = ethers.id("VALUATION_ROLE");
    for (const [i, v] of valuation.entries()) {
      let st: { status: StepStatus; reason?: string };
      if (principal === undefined || !evidence) st = waitingFor("Waiting for input: POOL_TIER_PRINCIPAL and POOL_TIER_EVIDENCE.");
      else if (!poolAddress) st = waitingFor("No LendingPool record.");
      else if (notYield) st = waitingFor(notYield);
      else if (posted && posted[1] !== 0n) st = { status: "done", reason: `Posted: ${posted[0]} (both signers).` };
      else if (same(first, v)) st = { status: "done", reason: "Posted by this signer; waits for the other valuation signer." };
      else if (!(await pool.hasRole(VALUATION, v))) st = waitingFor("This signer does not hold the pool's VALUATION_ROLE yet (deploy 27, E7, grants it).");
      else st = { status: "ready" };
      const enc = principal !== undefined && evidence
        ? encode(pool, "postPoolTierPrincipal", [principal, evidence], [`${dollars} (USDC base units)`, "POOL_TIER_EVIDENCE: the valuation's evidence hash"])
        : { data: null, functionSignature: "postPoolTierPrincipal(uint256,bytes32)", args: [] };
      push({
        id: `G1-tier-${i + 1}`, stage: "Pool Tier", title: `Post the Pool Tier principal${dollars ? ` (${dollars})` : ""}: valuation signer ${i + 1}`,
        explanation: "Records the Yield Pool's Pool Tier value. Two different valuation signers each send the same value and evidence; the second one makes it count. No Deployment from the pool is possible until then.",
        kind: "wallet", signer: v, signerLabel: `valuation signer ${i + 1}`, to: poolAddress ?? ZERO_ADDRESS, toLabel: "LendingPool (the Yield Pool)", ...enc, dependsOn: [], ...st,
      });
    }
  }

  // ================= The Safe: a second MetaMask owner, and two signatures (before I2 to I4) =================
  {
    const newOwner = addr(env.SAFE_NEW_OWNER);
    const threshold = BigInt(env.SAFE_THRESHOLD && /^\d+$/.test(env.SAFE_THRESHOLD) ? env.SAFE_THRESHOLD : "2");
    const SAFE_ABI = [
      "function getOwners() view returns (address[])",
      "function getThreshold() view returns (uint256)",
      "function addOwnerWithThreshold(address owner, uint256 _threshold)",
      "function changeThreshold(uint256 _threshold)",
    ];
    // The Safes that sign a batch here must each need two signatures (the handovers refuse one that
    // does not). SAFE_NEW_OWNER and SAFE_THRESHOLD are the Clear Financial Safe's day-0 change; any
    // other Safe (the Clear Lending Safe, a separate board Safe) is only read.
    for (const [what, other] of [["Clear Lending Safe", lendingSafe], ["Clear Treasury (board) Safe", addr(env.BOARD_SAFE)]] as [string, string | undefined][]) {
      if (!other || same(other, financialSafe)) continue;
      if (!(await hasCode(other))) throw new Error(`Refusing: the ${what} ${other} has no code on ${network} (chain ${chainId}). Wrong network, or a wrong address in the rollout env?`);
      const o = new ethers.Contract(other, SAFE_ABI, provider);
      const t = BigInt(await o.getThreshold());
      if (t < 2n) notes.push(`The ${what} ${other} needs only ${t} signature(s): the handovers and two-person control want 2 or more.`);
    }
    const safes = financialSafe ? [financialSafe] : [];
    for (const safe of safes) {
      const s = new ethers.Contract(safe, SAFE_ABI, provider);
      const id = "safe-owner";
      if (!(await hasCode(safe))) throw new Error(`Refusing: the Safe ${safe} has no code on ${network} (chain ${chainId}).`);
      const owners: string[] = (await s.getOwners()).map((a: string) => ethers.getAddress(a));
      const now_ = BigInt(await s.getThreshold());
      const isOwner = !!newOwner && owners.some((a) => same(a, newOwner));
      let enc;
      let title;
      let st: { status: StepStatus; reason?: string };
      if (!newOwner || isOwner) {
        enc = encode(s, "changeThreshold", [threshold], ["signatures each transaction will need"]);
        title = `Require ${threshold} signatures on the Safe`;
        st = now_ >= threshold ? { status: "done", reason: `${now_} of ${owners.length}.` } : { status: "ready" };
      } else {
        enc = encode(s, "addOwnerWithThreshold", [newOwner, threshold], [nameOf(newOwner), "signatures each transaction will need"]);
        title = `Add ${short(newOwner)} as an owner of the Safe, and require ${threshold} signatures`;
        st = { status: "ready" };
      }
      push({
        id, stage: "Safe (before I2)", title,
        explanation: `The vault and Earn handovers (I3, I4) refuse a Safe one person can run. Today it needs ${now_} of ${owners.length} (${owners.map(short).join(", ")}). Owners other than the deployer may sign only inside the members app (Privy), so a second MetaMask account becomes an owner and every Safe transaction then needs ${threshold} signatures. Today's owner signs this in the Safe app, just before the credit handover (I2); nothing before it needs it.`,
        kind: "safe", signer: safe, signerLabel: `the Clear Treasury Safe ${short(safe)} (its owners sign in the Safe app)`, to: safe, toLabel: "the Safe itself", ...enc, dependsOn: [], ...st,
      });
    }
  }

  // ================= I3: the Clear Financial Safe accepts CLRUSD's admin and the token pool's ownership =================
  {
    const vaultTimelock = await rec("VaultTimelock");
    const clrusd = await rec("ClearUSDUpgradeable");
    const tokenPool = await rec("CLRUSDTokenPool");
    label(vaultTimelock, "vault timelock");
    label(clrusd, "CLRUSD");
    label(tokenPool, "CLRUSD token pool");
    const calls: { to: string; data: string; label: string; what: string }[] = [];
    const accepted: string[] = [];
    let clrusdSchedule = 0n;
    if (vaultTimelock && clrusd) {
      const t = new ethers.Contract(clrusd, [
        "function defaultAdmin() view returns (address)", "function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)", "function acceptDefaultAdminTransfer()",
      ], provider);
      if (same(await t.defaultAdmin(), vaultTimelock)) accepted.push("CLRUSD");
      else {
        const [pendingAdmin, sched] = await t.pendingDefaultAdmin();
        if (same(pendingAdmin, vaultTimelock)) {
          clrusdSchedule = BigInt(sched);
          calls.push({ to: clrusd, data: t.interface.encodeFunctionData("acceptDefaultAdminTransfer", []), label: "CLRUSD", what: "CLRUSD: the vault timelock accepts DEFAULT_ADMIN_ROLE" });
        }
      }
    }
    if (vaultTimelock && tokenPool) {
      const p = new ethers.Contract(tokenPool, ["function owner() view returns (address)", "function acceptOwnership()"], provider);
      if (same(await p.owner(), vaultTimelock)) accepted.push("the token pool");
      else {
        const data = p.interface.encodeFunctionData("acceptOwnership", []);
        const can = await provider.call({ from: vaultTimelock, to: tokenPool, data }).then(() => true, () => false);
        if (can) calls.push({ to: tokenPool, data, label: "CLRUSD token pool", what: "the CCIP token pool: the vault timelock accepts ownership" });
      }
    }
    const tl = vaultTimelock ? await timelockOf(vaultTimelock) : undefined;
    const salt = ethers.id("signing-plan: I3 vault timelock acceptances");
    const targets = calls.map((c) => c.to);
    const values = calls.map(() => 0n);
    const payloads = calls.map((c) => c.data);
    const delay: bigint = tl ? await tl.getMinDelay() : 604800n;
    const opId: string = tl && calls.length ? await tl.hashOperationBatch(targets, values, payloads, ZERO_HASH, salt) : ZERO_HASH;
    let sSt: { status: StepStatus; reason?: string };
    let xSt: { status: StepStatus; reason?: string };
    if (!vaultTimelock) sSt = xSt = waitingFor("Waits for the vault handover (I3: VAULT_HANDOVER=1 deploy/vault_timelock_handover.ts), which deploys the vault timelock and begins both transfers.");
    else if (!calls.length && accepted.length) sSt = xSt = { status: "done", reason: `Accepted: ${accepted.join(" and ")}.` };
    else if (!calls.length) sSt = xSt = waitingFor("The vault handover (I3) has not begun the transfers to the vault timelock yet.");
    else if (!financialSafe || !(await tl.hasRole(await tl.PROPOSER_ROLE(), financialSafe))) sSt = xSt = waitingFor(`CLEAR_FINANCIAL_SAFE ${financialSafe ?? "(unset)"} is not a proposer on the vault timelock ${vaultTimelock}.`);
    else {
      sSt = (await tl.isOperation(opId)) ? { status: "done" } : { status: "ready" };
      if (await tl.isOperationDone(opId)) xSt = { status: "done" };
      else if (!(await tl.isOperation(opId))) xSt = waitingFor("Waits for the schedule step, then 7 days.");
      else {
        const why: string[] = [];
        if (!(await tl.isOperationReady(opId))) why.push(`the vault timelock's 7 days end at ${new Date(Number(await tl.getTimestamp(opId)) * 1000).toISOString()}`);
        if (clrusdSchedule && now <= clrusdSchedule) why.push(`CLRUSD's admin delay ends at ${new Date(Number(clrusdSchedule) * 1000).toISOString()}`);
        xSt = why.length ? waitingFor(`Not yet: ${why.join("; ")}.`) : { status: "ready" };
      }
    }
    const listed = calls.map((c) => c.what).join("; ");
    push({
      id: "I3-vault-schedule", stage: "I3", title: "Clear Financial Safe: schedule the vault timelock's acceptances",
      explanation: `The vault handover began moving CLRUSD's admin role and the CCIP token pool's ownership to the vault timelock; the timelock must accept them (${listed || "nothing pending"}). This queues the acceptance; it can run 7 days later. Sign it in the Safe app.`,
      kind: "safe", signer: financialSafe ?? ZERO_ADDRESS, signerLabel: "Clear Financial Safe (its owners sign in the Safe app)", to: vaultTimelock ?? ZERO_ADDRESS, toLabel: "vault timelock",
      ...encode(timelockIface, "scheduleBatch", [targets, values, payloads, ZERO_HASH, salt, delay], [calls.map((c) => c.label).join(", "), undefined, "the acceptance calls", "none", "a fixed label for this batch", `${Number(delay) / 86400} days`]),
      dependsOn: [], ...sSt,
    });
    push({
      id: "I3x-vault-execute", stage: "Day 7", title: "Clear Financial Safe: run the vault timelock's acceptances (day 7)",
      explanation: "After the 7 days, the Safe runs the queued acceptances: the vault timelock becomes CLRUSD's admin and the token pool's owner. Only the Safe may run them.",
      kind: "safe", signer: financialSafe ?? ZERO_ADDRESS, signerLabel: "Clear Financial Safe (its owners sign in the Safe app)", to: vaultTimelock ?? ZERO_ADDRESS, toLabel: "vault timelock",
      ...encode(timelockIface, "executeBatch", [targets, values, payloads, ZERO_HASH, salt], [calls.map((c) => c.label).join(", "), undefined, "the acceptance calls", "none", "the same label"]),
      dependsOn: ["I3-vault-schedule"], ...xSt,
    });
  }

  // ================= The Assurance Pool's governed setup: two signers, the board Safe, 7 days =================
  // Each call runs through `_governed()`: only the Assurance timelock may make it, and its exact
  // calldata must carry two different ASSURANCE_SIGNERS' approvals (`approveAction(keccak256(calldata))`;
  // the first records itself, the second completes it, either order). The board Safe is the
  // timelock's only proposer and executor (deploy 08), so it schedules on day 0 and executes on day 7.
  {
    const poolAddress = await rec("AssurancePoolV2");
    const asTimelock = await rec("AssuranceTimelock");
    const board = addr(env.BOARD_SAFE);
    label(poolAddress, "AssurancePool");
    label(asTimelock, "Assurance timelock");
    for (const e of assurance.exposureSources) label(e, same(e, exposureDefault.address) ? "CollateralRegistry" : "exposure source");
    const poolC = await contract("AssurancePool", poolAddress ?? ZERO_ADDRESS);
    const live = poolAddress ? poolC : undefined;

    // What the pool would refuse, from the inputs and (once it exists) the chain.
    const chain: Parameters<typeof assuranceSetupProblems>[2] = {};
    const extra: string[] = [];
    if (live) {
      chain.drawAddress = await live.drawAddress();
      chain.payerTagsOf = { [assurance.draw.toLowerCase()]: BigInt(await live.payerTags(assurance.draw)) };
      const registry = new ethers.Contract(await live.networkRegistry(), ["function isMoneyPath(address) view returns (bool)"], provider);
      chain.moneyPath = {};
      for (const a of [assurance.clFeesPayer, assurance.coopTreasury]) chain.moneyPath[a.toLowerCase()] = await registry.isMoneyPath(a);
      chain.maxExposureSources = Number(await live.MAX_EXPOSURE_SOURCES());
      for (const sgn of assuranceSigners) if (!(await live.isSigner(sgn))) extra.push(`ASSURANCE_SIGNERS lists ${sgn}, which is not one of the AssurancePool's signers.`);
      if (asTimelock && !same(await live.governance(), asTimelock)) extra.push(`The AssurancePool's governance is ${await live.governance()}, not the AssuranceTimelock record ${asTimelock}.`);
    }
    for (const e of assurance.exposureSources) {
      if (!(await hasCode(e))) { extra.push(`The exposure source ${e} has no code.`); continue; }
      const ok = await provider.call({ to: e, data: "0x" + ethers.id("poolExposure()").slice(2, 10) }).then((r: string) => r.length >= 66, () => false);
      if (!ok) extra.push(`The exposure source ${e} does not answer poolExposure().`);
    }
    const problems = [...assuranceSetupProblems(assurance, assuranceSigners, chain), ...extra];
    if (problems.length) throw new Error(`Refusing: the Assurance Pool setup would not go through:\n  - ${problems.join("\n  - ")}`);

    const calls = governedCalls(poolC, assurance);
    const what: Record<string, string> = {
      "payer-clfees": `let Clear Lending's fees wallet pay in (credit enhancement fee, recovery: mask ${CL_FEES_MASK})`,
      "payer-treasury": `let the co-op treasury pay in interchange and board allocations (mask ${BOARD_ALLOCATION_MASK})`,
      lendingco: "register CL Operating as Lending Co.'s draw address and CL Loss Reserve as where draws are paid",
      disbursement: "register the co-op's Assurance disbursement address, where grants are paid",
      exposure: "name the CollateralRegistry as what reports the covered book",
    };
    const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => same(x, b[i]));
    const applied = async (key: string): Promise<boolean> => {
      if (!live) return false;
      if (key === "payer-clfees") return BigInt(await live.payerTags(assurance.clFeesPayer)) === BigInt(CL_FEES_MASK);
      if (key === "payer-treasury") return BigInt(await live.payerTags(assurance.coopTreasury)) === BigInt(BOARD_ALLOCATION_MASK);
      if (key === "lendingco") return same(await live.drawAddress(), assurance.draw) && same(await live.lossReserveAddress(), assurance.lossReserve);
      if (key === "disbursement") return same(await live.assuranceDisbursementAddress(), assurance.disbursement);
      return sameList([...(await live.exposureSourceList())], assurance.exposureSources);
    };
    const keys = ["payer-clfees", "payer-treasury", "lendingco", "disbursement", "exposure"];
    const pending: { key: string; data: string; action: string; approved: boolean }[] = [];
    const approvalIds: string[] = [];
    let blocked: string | undefined = !poolAddress ? "Waits for H1 (ASSURANCE_DEPLOY=1 deploy/08_deploy_AssurancePool.ts), which deploys the AssurancePool." : undefined;
    for (const key of keys) {
      const c = calls.find((x) => x.key === key);
      if (!c && !blocked) blocked = `No exposure source yet: ${exposureDefault.why ?? "set ASSURANCE_EXPOSURE_SOURCES"}.`;
      const isApplied = c ? await applied(key) : false;
      const approved = c && live ? Boolean(await live.approvedAction(c.action)) : false;
      const first: string | undefined = c && live ? ethers.getAddress(await live.proposerOf(approvalKey(c.action))) : undefined;
      if (c && !isApplied) pending.push({ key, data: c.data, action: c.action, approved });
      for (const [i, sgn] of assuranceSigners.slice(0, 2).entries()) {
        const id = `AS-${key}-approve-${i + 1}`;
        let st: { status: StepStatus; reason?: string };
        if (!c) st = waitingFor(`No exposure source yet: ${exposureDefault.why ?? "set ASSURANCE_EXPOSURE_SOURCES"}.`);
        else if (isApplied) st = { status: "done", reason: "The pool already shows it." };
        else if (blocked) st = waitingFor(blocked);
        else if (approved) st = { status: "done", reason: "Both signers approved this exact call." };
        else if (same(first, sgn)) st = { status: "done", reason: "Approved by this signer; waits for the other Assurance signer." };
        else st = { status: "ready" };
        const enc = c
          ? encode(poolC, "approveAction", [c.action], [`keccak256 of the exact call the Assurance timelock will make: ${c.fn}(${c.args.map((a: any) => (Array.isArray(a) ? `[${a.join(", ")}]` : String(a))).join(", ")})`])
          : { data: null, functionSignature: signatureOf(poolC, "approveAction"), args: [] };
        push({
          id, stage: "Assurance", title: `Assurance signer ${i + 1} approves: ${what[key]}`,
          explanation: i === 0
            ? "The Assurance Pool changes a setting only when the Assurance timelock calls it, and only if two of its signers approved that exact call first. This is the first approval; the other Assurance signer sends the same one next. Nothing changes yet: the board Safe schedules it, and runs it 7 days later."
            : "The second approval of the same call, from the other Assurance signer. With both, the Assurance timelock may make the call once.",
          kind: "wallet", signer: sgn, signerLabel: `Assurance signer ${i + 1}`, to: poolAddress ?? ZERO_ADDRESS, toLabel: "AssurancePool", ...enc,
          dependsOn: i === 1 ? [`AS-${key}-approve-1`] : [], ...st,
        });
        if (c && !isApplied) approvalIds.push(id);
      }
    }

    const tl = asTimelock ? await timelockOf(asTimelock) : undefined;
    const salt = ethers.id("signing-plan: Assurance Pool governed setup");
    const targets = pending.map(() => poolAddress ?? ZERO_ADDRESS);
    const values = pending.map(() => 0n);
    const payloads = pending.map((p) => p.data);
    const delay: bigint = tl ? await tl.getMinDelay() : 604800n;
    const opId: string = tl && pending.length && !blocked ? await tl.hashOperationBatch(targets, values, payloads, ZERO_HASH, salt) : ZERO_HASH;
    let sSt: { status: StepStatus; reason?: string };
    let xSt: { status: StepStatus; reason?: string };
    if (blocked) sSt = xSt = waitingFor(blocked);
    else if (!pending.length) sSt = xSt = { status: "done", reason: "The pool shows every setting." };
    else if (!tl || !board) sSt = xSt = waitingFor(!board ? "Waiting for input: BOARD_SAFE." : "No AssuranceTimelock record yet (H1).");
    else if (!(await tl.hasRole(await tl.PROPOSER_ROLE(), board)) || !(await tl.hasRole(await tl.EXECUTOR_ROLE(), board))) {
      sSt = xSt = waitingFor(`BOARD_SAFE ${board} is not the Assurance timelock's proposer and executor (${asTimelock}).`);
    } else {
      if (await tl.isOperation(opId)) sSt = { status: "done" };
      else {
        sSt = { status: "ready" };
        // Each call as the timelock will make it: catches a conflict the pool would revert on.
        if (pending.every((p) => p.approved)) {
          for (const p of pending) {
            try {
              await provider.call({ from: asTimelock, to: poolAddress, data: p.data });
            } catch (e: any) {
              const data: string | undefined = e?.data ?? e?.error?.data ?? e?.info?.error?.data;
              let why = String(e?.shortMessage ?? e?.message ?? e).split("\n")[0];
              try { const q = poolC.interface.parseError(data!); if (q) why = `${q.name}(${q.args.map(String).join(", ")})`; } catch { /* raw */ }
              sSt = waitingFor(`The pool would refuse ${p.key} when the timelock makes it: ${why}. Fix the input before scheduling.`);
            }
          }
        }
      }
      if (await tl.isOperationDone(opId)) xSt = { status: "done" };
      else if (!(await tl.isOperation(opId))) xSt = waitingFor("Waits for the schedule step, then 7 days.");
      else {
        const why: string[] = [];
        if (!(await tl.isOperationReady(opId))) why.push(`the Assurance timelock's 7 days end at ${new Date(Number(await tl.getTimestamp(opId)) * 1000).toISOString()}`);
        for (const p of pending) if (!p.approved) why.push(`${p.key} does not carry both signers' approval`);
        xSt = why.length ? waitingFor(`Not yet: ${why.join("; ")}.`) : { status: "ready" };
      }
    }
    const listed = pending.map((p) => p.key).join(", ");
    push({
      id: "AS-assurance-schedule", stage: "Assurance", title: "Clear Treasury (board) Safe: schedule the Assurance Pool's setup on the Assurance timelock",
      explanation: `Queues the approved call${pending.length === 1 ? "" : "s"} (${listed || "none left"}): the payers, Clear Lending's draw and loss-reserve addresses, the disbursement address and the exposure source. They can run 7 days later. Sign it in the Safe app: Transaction Builder, load the batch file.`,
      kind: "safe", signer: board ?? ZERO_ADDRESS, signerLabel: "Clear Treasury (board) Safe (its owners sign in the Safe app)", to: asTimelock ?? ZERO_ADDRESS, toLabel: "Assurance timelock",
      ...encode(timelockIface, "scheduleBatch", [targets, values, payloads, ZERO_HASH, salt, delay], [pending.length ? "AssurancePool" : "", undefined, "the approved calls", "none", "a fixed label for this batch", `${Number(delay) / 86400} days`]),
      dependsOn: approvalIds, ...sSt,
    });
    push({
      id: "ASx-assurance-execute", stage: "Day 7", title: "Clear Treasury (board) Safe: run the Assurance Pool's setup (day 7)",
      explanation: "After the Assurance timelock's 7 days, the board Safe runs the queued calls; the pool checks each one carries its two approvals. Only the board Safe may run them: it is the timelock's only executor.",
      kind: "safe", signer: board ?? ZERO_ADDRESS, signerLabel: "Clear Treasury (board) Safe (its owners sign in the Safe app)", to: asTimelock ?? ZERO_ADDRESS, toLabel: "Assurance timelock",
      ...encode(timelockIface, "executeBatch", [targets, values, payloads, ZERO_HASH, salt], [pending.length ? "AssurancePool" : "", undefined, "the approved calls", "none", "the same label"]),
      dependsOn: ["AS-assurance-schedule"], ...xSt,
    });

    // ---- The month's floor inputs (13d): two signers, no timelock. Until they are posted the
    // coverage cap is 0 and `approveDraw` refuses every backstop draw; deposits and Member
    // Assurance grants do not need them. The first signer's call proposes, the same call from the
    // other signer applies it (`_pair` on keccak256(abi.encode("floor", shortfall, cap, book, evidence))).
    const units = (k: string) => (env[k] && /^\d+$/.test(env[k]) ? BigInt(env[k]) : undefined);
    const shortfall = units("ASSURANCE_TIMING_SHORTFALL");
    const cap = units("ASSURANCE_COVERAGE_CAP");
    const book = units("ASSURANCE_ATTESTED_BOOK");
    const floorEvidence = env.ASSURANCE_FLOOR_EVIDENCE && /^0x[0-9a-fA-F]{64}$/.test(env.ASSURANCE_FLOOR_EVIDENCE) && BigInt(env.ASSURANCE_FLOOR_EVIDENCE) !== 0n
      ? env.ASSURANCE_FLOOR_EVIDENCE : undefined;
    const floorInputsSet = shortfall !== undefined && cap !== undefined && book !== undefined && floorEvidence !== undefined;
    const usd = (v?: bigint) => (v === undefined ? "" : `$${Number(ethers.formatUnits(v, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    const floorAction = floorInputsSet
      ? ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint256", "uint256", "uint256", "bytes32"], ["floor", shortfall, cap, book, floorEvidence]))
      : undefined;
    let floorApplied = false;
    let floorFirst: string | undefined;
    if (live && floorInputsSet) {
      floorApplied = BigInt(await live.coverageCap()) === cap && BigInt(await live.timingBufferShortfall()) === shortfall
        && BigInt(await live.attestedCoveredBook()) === book && String(await live.floorEvidenceHash()).toLowerCase() === floorEvidence!.toLowerCase();
      floorFirst = ethers.getAddress(await live.proposerOf(floorAction!));
    }
    for (const [i, sgn] of assuranceSigners.slice(0, 2).entries()) {
      let st: { status: StepStatus; reason?: string };
      if (!floorInputsSet) st = waitingFor("Waiting for input: ASSURANCE_TIMING_SHORTFALL, ASSURANCE_COVERAGE_CAP, ASSURANCE_ATTESTED_BOOK and ASSURANCE_FLOOR_EVIDENCE.");
      else if (!poolAddress) st = waitingFor("Waits for H1 (ASSURANCE_DEPLOY=1 deploy/08_deploy_AssurancePool.ts), which deploys the AssurancePool.");
      else if (floorApplied) st = { status: "done", reason: `Posted: coverage cap ${usd(cap)} (both signers).` };
      else if (same(floorFirst, sgn)) st = { status: "done", reason: "Posted by this signer; waits for the other Assurance signer." };
      else st = { status: "ready" };
      const enc = floorInputsSet
        ? encode(poolC, "setFloorInputs", [shortfall, cap, book, floorEvidence], [
            `timing-buffer shortfall ${usd(shortfall)}`, `coverage cap ${usd(cap)}`, `attested covered book ${usd(book)}`, "ASSURANCE_FLOOR_EVIDENCE: the month's evidence hash"])
        : { data: null, functionSignature: signatureOf(poolC, "setFloorInputs"), args: [] };
      push({
        id: `AS-floor-${i + 1}`, stage: "Assurance", title: `Post the month's floor inputs (coverage cap ${usd(cap) || "?"}): Assurance signer ${i + 1}`,
        explanation: i === 0
          ? "Sets how much the Credit Backstop may pay Clear Lending on a draw (the coverage cap), with the month's timing shortfall and attested covered book. Until both signers post the same figures the cap is $0 and every draw is refused; deposits and member grants don't need it. No timelock: it applies as soon as the second signer sends it. Re-post each month."
          : "The same figures from the other Assurance signer; this one makes them count.",
        kind: "wallet", signer: sgn, signerLabel: `Assurance signer ${i + 1}`, to: poolAddress ?? ZERO_ADDRESS, toLabel: "AssurancePool", ...enc,
        dependsOn: i === 1 ? ["AS-floor-1"] : [], ...st,
      });
    }
  }

  // ================= Payout top-ups (decision 51): the one-time setup =================
  // The top-up wallet (a CDP server wallet) gets the fresh PayoutPool's FUNDER_ROLE from the deployer
  // before the credit handover (I2); CL Operating enables Safe's AllowanceModule and gives the wallet
  // a spending limit in USDC. Any of its inputs may be empty: its steps then wait, and nothing else does.
  {
    const wallet = addr(env.PAYOUT_TOPUP_WALLET);
    const operating = addr(env.CLEAR_LENDING_ACCOUNT);
    const moduleAddr = addr(env.PAYOUT_TOPUP_ALLOWANCE_MODULE) ?? CANONICAL_ALLOWANCE_MODULE;
    const cap = parseUsdc(env.PAYOUT_TOPUP_CAP_USDC);
    const periodRaw = Number(env.PAYOUT_TOPUP_RESET_MINUTES ?? "");
    const period = env.PAYOUT_TOPUP_RESET_MINUTES && Number.isInteger(periodRaw) && periodRaw > 0 && periodRaw <= 65535 ? periodRaw : undefined;
    const baseRaw = Number(env.PAYOUT_TOPUP_RESET_BASE_MINUTES || "0");
    const base = Number.isInteger(baseRaw) && baseRaw >= 0 && baseRaw < 2 ** 32 ? baseRaw : undefined;
    label(wallet, "payout top-up wallet");
    label(moduleAddr, "AllowanceModule");
    const payout = await fresh("PayoutPool");
    label(payout.address, "PayoutPool");
    const pp = await contract("PayoutPool", payout.address ?? ZERO_ADDRESS);
    const live = payout.address ? pp : undefined;
    const FUNDER = PAYOUT_POOL_ROLES.FUNDER_ROLE;
    const noWallet = !wallet
      ? waitingFor(env.PAYOUT_TOPUP_WALLET ? `PAYOUT_TOPUP_WALLET is not an address: ${env.PAYOUT_TOPUP_WALLET}.` : "Waiting for input: PAYOUT_TOPUP_WALLET (the CDP wallet payout-topup-base-sepolia; owner to fill in deploy/config/base-sepolia.rollout.env).")
      : undefined;
    if (wallet) {
      const code: string = await provider.getCode(wallet);
      if (code !== "0x" && !code.toLowerCase().startsWith("0xef0100")) notes.push(`PAYOUT_TOPUP_WALLET ${wallet} has contract code: a CDP server wallet (a plain account) was expected.`);
    }

    // The deployer grants FUNDER_ROLE on the fresh PayoutPool: a day-0 step, before I2.
    {
      let st: { status: StepStatus; reason?: string };
      if (noWallet) st = noWallet;
      else if (!deployer) st = waitingFor("Waiting for input: DEPLOYER.");
      else if (!live) st = waitingFor(`Waits for deploy 22 (E4), which deploys the fresh PayoutPool: ${payout.why}.`);
      else if (await live.hasRole(FUNDER, wallet)) st = { status: "done" };
      else if (!(await live.hasRole(ZERO_HASH, deployer))) st = waitingFor("The deployer no longer holds the PayoutPool's admin (the credit handover, I2, moved it to the credit timelock): this grant is now an Ops Safe proposal on the credit timelock, with its 7 days.");
      else st = { status: "ready" };
      if (live && wallet) {
        for (const r of ["DEFAULT_ADMIN_ROLE", "OPERATOR_ROLE", "REDEEMER_ROLE"] as const) {
          if (await live.hasRole(PAYOUT_POOL_ROLES[r], wallet)) notes.push(`The payout top-up wallet ${wallet} holds the PayoutPool's ${r}: it must hold FUNDER_ROLE and nothing else. Revoke it.`);
        }
      }
      push({
        id: "TU-funder", stage: "Payout top-ups", title: "Give the payout top-up wallet the PayoutPool's FUNDER_ROLE (day 0, before I2)",
        explanation: "Lets the top-up wallet fund the PayoutPool (fund pulls the wallet's own USDC), and nothing else. Send it before the credit handover (I2): until then the deployer holds the PayoutPool's admin; afterwards the grant is a 7-day credit timelock proposal. The wallet never calls withdrawCapital (decision 51).",
        kind: "wallet", signer: deployer ?? ZERO_ADDRESS, signerLabel: "the deployer", to: payout.address ?? ZERO_ADDRESS, toLabel: "PayoutPool",
        ...encode(pp, "grantRole", [FUNDER, wallet ?? ZERO_ADDRESS], ["FUNDER_ROLE"]), dependsOn: [], ...st,
      });
    }

    // CL Operating's one-time setup: three calls, signed once as one Transaction Builder batch.
    const opHasCode = !!operating && (await hasCode(operating));
    const modHasCode = await hasCode(moduleAddr);
    const mod = new ethers.Contract(modHasCode ? moduleAddr : ZERO_ADDRESS, ALLOWANCE_MODULE_ABI, provider);
    const safeC = new ethers.Contract(opHasCode ? operating! : ZERO_ADDRESS, SAFE_MODULE_ABI, provider);
    let moduleProblem: string | undefined;
    if (!modHasCode) moduleProblem = `No AllowanceModule at ${moduleAddr} on this chain (PAYOUT_TOPUP_ALLOWANCE_MODULE).`;
    else if ((await mod.NAME().catch(() => "")) !== "Allowance Module") moduleProblem = `${moduleAddr} does not answer as Safe's AllowanceModule (NAME()).`;
    const opProblem = !operating ? "Waiting for input: CLEAR_LENDING_ACCOUNT (CL Operating)." : !opHasCode ? `CL Operating ${operating} has no code on this chain.` : undefined;
    // The token is what the PayoutPool pays in; before the fresh pool exists, the rollout's RESERVE_TOKEN.
    const usdc = live ? ethers.getAddress(await live.reserveToken()) : addr(env.RESERVE_TOKEN);
    if (live && addr(env.RESERVE_TOKEN) && !same(usdc, env.RESERVE_TOKEN)) notes.push(`The PayoutPool's reserveToken is ${usdc}, not RESERVE_TOKEN ${env.RESERVE_TOKEN}: the allowance uses the PayoutPool's.`);
    const capText = cap !== null && cap !== 0n ? formatUsdc(cap) : "?";
    const periodText = period ? (period % 1440 === 0 ? `${period / 1440} day${period === 1440 ? "" : "s"}` : `${period} minutes`) : "?";
    const via = "CL Operating's only owner is the Clear Lending Safe (2 of 2): in the Safe app open CL Operating, load the batch in Transaction Builder, confirm it from the Clear Lending Safe (a nested-Safe confirmation, both owners), then execute.";
    const batchHint = "Sign all three at once: safe-batches/signing-TU-cl-operating-setup.json (written while they are ready).";
    const safeStep = (id: string, title: string, explanation: string, to: string | undefined, enc: any, st: { status: StepStatus; reason?: string }, dependsOn: string[] = []) =>
      push({
        id, stage: "Payout top-ups", title, explanation: `${explanation} ${via} ${batchHint}`,
        kind: "safe", signer: operating ?? ZERO_ADDRESS, signerLabel: "CL Operating (its owner, the Clear Lending Safe, signs in the Safe app)",
        to: to ?? ZERO_ADDRESS, toLabel: to && same(to, operating) ? "CL Operating itself" : "AllowanceModule", ...enc, dependsOn, ...st,
      });
    {
      const st = opProblem ? waitingFor(opProblem) : moduleProblem ? waitingFor(moduleProblem)
        : (await safeC.isModuleEnabled(moduleAddr)) ? { status: "done" as const } : { status: "ready" as const };
      safeStep("TU-safe-module", "CL Operating: enable Safe's AllowanceModule",
        `Lets CL Operating give one wallet a spending limit. The module (Safe's audited AllowanceModule v0.1.1, ${moduleAddr}) moves CL Operating's money only for a delegate CL Operating names, within the limit CL Operating sets for it.`,
        opHasCode ? operating : undefined, encode(safeC, "enableModule", [moduleAddr], ["Safe's AllowanceModule v0.1.1"]), st);
    }
    {
      let delegateAdded = false;
      if (opHasCode && !moduleProblem && wallet) {
        let start = 0n;
        for (let page = 0; page < 20; page++) {
          const [list, next] = await mod.getDelegates(operating, start, 50);
          if ((list as string[]).some((d) => same(d, wallet))) { delegateAdded = true; break; }
          if (BigInt(next) === 0n) break;
          start = BigInt(next);
        }
      }
      const st = noWallet ?? (opProblem ? waitingFor(opProblem) : moduleProblem ? waitingFor(moduleProblem) : delegateAdded ? { status: "done" as const } : { status: "ready" as const });
      safeStep("TU-safe-delegate", "CL Operating: name the payout top-up wallet a spending-limit delegate",
        "The top-up wallet may then spend from CL Operating, but only within the allowance the next call sets.",
        modHasCode ? moduleAddr : undefined, encode(mod, "addDelegate", [wallet ?? ZERO_ADDRESS]), st);
    }
    {
      let st: { status: StepStatus; reason?: string };
      const inputs: string[] = [];
      if (cap === null || cap === 0n) inputs.push("PAYOUT_TOPUP_CAP_USDC (dollars per period)");
      if (!period) inputs.push("PAYOUT_TOPUP_RESET_MINUTES (1 to 65535)");
      if (base === undefined) inputs.push("PAYOUT_TOPUP_RESET_BASE_MINUTES (unix minutes, or 0)");
      if (!usdc) inputs.push("RESERVE_TOKEN (USDC)");
      if (noWallet) st = noWallet;
      else if (inputs.length) st = waitingFor(`Waiting for input: ${inputs.join(", ")}.`);
      else if (opProblem) st = waitingFor(opProblem);
      else if (moduleProblem) st = waitingFor(moduleProblem);
      else if (base! > Number(now / 60n)) st = waitingFor(`PAYOUT_TOPUP_RESET_BASE_MINUTES ${base} is in the future (the module refuses it).`);
      else {
        const al = await mod.getTokenAllowance(operating, wallet, usdc);
        st = BigInt(al[0]) === cap && Number(al[2]) === period ? { status: "done", reason: `${capText} every ${periodText}; ${formatUsdc(BigInt(al[1]))} spent this period.` } : { status: "ready" };
        if (st.status !== "done" && BigInt(al[0]) !== 0n) notes.push(`CL Operating's allowance for the top-up wallet is ${formatUsdc(BigInt(al[0]))} every ${al[2]} minutes; TU-safe-allowance sets it to ${capText} every ${periodText}.`);
      }
      const complete = cap !== null && cap !== 0n && !!period && base !== undefined && !!usdc && !!wallet;
      const enc = complete
        ? encode(mod, "setAllowance", [wallet, usdc, cap, period, base], [undefined, "USDC", `${capText} per period (USDC base units)`, `${periodText}: the limit resets this often`, base ? `periods counted from ${new Date(base * 60000).toISOString()}` : "periods counted from when it is set"])
        : { data: null, functionSignature: signatureOf(mod, "setAllowance"), args: [] };
      safeStep("TU-safe-allowance", `CL Operating: let the payout top-up wallet move up to ${capText} of USDC every ${periodText}`,
        "The spending limit is the most the automatic top-ups can move out of CL Operating in a period, whatever happens to the bot or its key. What a top-up needs beyond it is prepared for CL Operating's owners to sign. Change it the same way.",
        modHasCode ? moduleAddr : undefined, enc, st, ["TU-safe-delegate"]);
    }
  }

  // ================= Settlement Funding (SL, decision 54): the Yield Pool's automated lane =================
  // The LendingPool upgrade that adds the lane is a NEW Earn timelock proposal, scheduled by the Clear
  // Lending Safe only once the E8 batch has run (E8x-earn-execute); its implementation is what
  // scripts/upgrade_settlement_lane.ts recorded. Then two DEPLOYER_ROLE signers register the funding
  // desk's wallet with its cap per period (SL-funder) and set the Settlement Headroom (SL-headroom).
  // Empty inputs make these steps wait; nothing else waits on them.
  {
    const poolAddress = await rec("LendingPool");
    const impl = await rec(SETTLEMENT_LANE_RECORD);
    label(impl, "the LendingPool implementation with the Settlement Funding lane");
    const funder = addr(env.SETTLEMENT_FUNDER);
    const cap = parseUsdc(env.SETTLEMENT_CAP_USDC);
    const daysRaw = Number(env.SETTLEMENT_PERIOD_DAYS ?? "");
    // The AllowanceModule's period is at most 65,535 minutes: about 45 days.
    const days = env.SETTLEMENT_PERIOD_DAYS && Number.isInteger(daysRaw) && daysRaw > 0 && daysRaw <= 45 ? daysRaw : undefined;
    const periodSeconds = days ? BigInt(days * 86400) : undefined;
    const headroom = parseUsdc(env.SETTLEMENT_HEADROOM_USDC);
    label(funder, "settlement funding desk wallet");
    const { poolAbi } = require("../deploy/poolModules");
    const pool = new ethers.Contract(poolAddress ?? ZERO_ADDRESS, await poolAbi(), provider);
    const tl = earnTimelock ? await timelockOf(earnTimelock) : undefined;
    const tlAddress = earnTimelock ?? ZERO_ADDRESS;
    const salt = ethers.id("signing-plan: SL Earn timelock proposal (LendingPool upgrade: the Settlement Funding lane, decision 54)");
    const upgradeData = impl ? pool.interface.encodeFunctionData("upgradeTo", [impl]) : "0x";
    const delay: bigint = tl ? await tl.getMinDelay() : 604800n;
    const opId: string = tl && impl && poolAddress ? await tl.hashOperation(poolAddress, 0n, upgradeData, ZERO_HASH, salt) : ZERO_HASH;
    let running: string | undefined;
    if (poolAddress) running = ethers.getAddress("0x" + (await provider.getStorage(poolAddress, IMPL_SLOT)).slice(-40));
    const upgraded = !!impl && same(running, impl);
    let sSt: { status: StepStatus; reason?: string };
    let xSt: { status: StepStatus; reason?: string };
    if (upgraded) sSt = xSt = { status: "done", reason: "The pool runs the implementation with the lane." };
    else if (!poolAddress) sSt = xSt = waitingFor("No LendingPool record.");
    else if (!impl) {
      const e8 = steps.find((x) => x.id === "E8x-earn-execute");
      const first = e8 && e8.status !== "done" ? "Waits for E8x-earn-execute first (this is a new Earn timelock proposal, scheduled after the E8 batch has run), and " : "Waits ";
      sSt = xSt = waitingFor(`${first}for the new LendingPool implementation: SETTLEMENT_LANE_PREPARE=1 npx hardhat run scripts/upgrade_settlement_lane.ts --network ${network} validates it against the manifest, deploys it and writes deployments/${network}/${SETTLEMENT_LANE_RECORD}.json.`);
    } else if (!tl || !lendingSafe) {
      sSt = xSt = waitingFor(!lendingSafe ? "Waiting for input: CLEAR_LENDING_SAFE." : "No EarnTimelock record yet (deploy 26, E1).");
    } else if (!(await tl.hasRole(await tl.PROPOSER_ROLE(), lendingSafe))) {
      sSt = xSt = waitingFor(`CLEAR_LENDING_SAFE ${lendingSafe} is not a proposer on the Earn timelock ${earnTimelock}.`);
    } else if (!(await pool.hasRole(ZERO_HASH, earnTimelock))) {
      sSt = xSt = waitingFor("The Earn timelock does not hold the LendingPool's admin yet (the Earn handover, I4, gives it).");
    } else {
      sSt = (await tl.isOperation(opId)) ? { status: "done" } : { status: "ready" };
      if (await tl.isOperationDone(opId)) xSt = { status: "done" };
      else if (!(await tl.isOperation(opId))) xSt = waitingFor("Waits for SL-upgrade-schedule, then 7 days.");
      else if (!(await tl.isOperationReady(opId))) xSt = waitingFor(`Not yet: the Earn timelock's 7 days end at ${new Date(Number(await tl.getTimestamp(opId)) * 1000).toISOString()}.`);
      else xSt = { status: "ready" };
    }
    const implNote = impl ? `upgradeTo(${impl}): the LendingPool implementation with the Settlement Funding lane` : "upgradeTo(the new implementation)";
    push({
      id: "SL-upgrade-schedule", stage: "SL", title: "Clear Lending Safe: schedule the Yield Pool upgrade that adds the Settlement Funding lane",
      explanation: "A new Earn timelock proposal (decision 54), scheduled only after the E8 batch has run: it upgrades the LendingPool in place to the implementation scripts/upgrade_settlement_lane.ts validated and deployed. It adds the lane (one registered funder, a cap per period, a Settlement Headroom, an immediate stop) and changes nothing else. It can run 7 days later. Sign it in the Safe app.",
      kind: "safe", signer: lendingSafe ?? ZERO_ADDRESS, signerLabel: "Clear Lending Safe (its owners sign in the Safe app)", to: tlAddress, toLabel: "Earn timelock",
      ...encode(timelockIface, "schedule", [poolAddress ?? ZERO_ADDRESS, 0n, upgradeData, ZERO_HASH, salt, delay], ["LendingPool (the Yield Pool)", undefined, implNote, "none", "a fixed label for this proposal", `${Number(delay) / 86400} days`]),
      dependsOn: ["E8x-earn-execute"], ...sSt,
    });
    push({
      id: "SLx-upgrade-execute", stage: "Day 7", title: "Clear Lending Safe: run the Yield Pool upgrade that adds the Settlement Funding lane (day 7)",
      explanation: "After the Earn timelock's 7 days, the Safe runs the queued upgrade. The lane starts empty: no funder, no headroom, until the SL-funder and SL-headroom steps.",
      kind: "safe", signer: lendingSafe ?? ZERO_ADDRESS, signerLabel: "Clear Lending Safe (its owners sign in the Safe app)", to: tlAddress, toLabel: "Earn timelock",
      ...encode(timelockIface, "execute", [poolAddress ?? ZERO_ADDRESS, 0n, upgradeData, ZERO_HASH, salt], ["LendingPool (the Yield Pool)", undefined, implNote, "none", "the same label"]),
      dependsOn: ["SL-upgrade-schedule", "E8x-earn-execute"], ...xSt,
    });

    // The lane as the pool reports it (only once the pool runs the lane's implementation).
    let lane: { funder: string; capPerPeriod: bigint; periodSeconds: bigint; stopped: boolean; epoch: bigint; headroom: bigint } | undefined;
    if (upgraded) lane = await pool.settlementLane();
    // Each of the two listed deployment signers needs the pool's DEPLOYER_ROLE (owner, Nov 18, 2026: the deployer
    // …7AAA stays deployment signer 1 on testnet). A missing one is granted through its own Earn timelock
    // proposal; it does not wait for E8x or the upgrade, so it can land before SL-funder needs it. A signer that
    // already holds the role shows both steps done.
    {
      const DEPLOYER_R = ethers.id("DEPLOYER_ROLE");
      for (const [i, d] of deploymentSigners.slice(0, 2).entries()) {
        const n = i + 1;
        const grantData = poolAddress ? pool.interface.encodeFunctionData("grantRole", [DEPLOYER_R, d]) : "0x";
        const gSalt = ethers.id(`signing-plan: SL Earn timelock proposal (grant the pool's DEPLOYER_ROLE to ${d})`);
        let gs: { status: StepStatus; reason?: string };
        let gx: { status: StepStatus; reason?: string };
        if (!poolAddress) gs = gx = waitingFor("No LendingPool record.");
        else if (await pool.hasRole(DEPLOYER_R, d)) gs = gx = { status: "done", reason: `Deployment signer ${n} holds the pool's DEPLOYER_ROLE.` };
        else if (!tl || !lendingSafe) gs = gx = waitingFor(!lendingSafe ? "Waiting for input: CLEAR_LENDING_SAFE." : "No EarnTimelock record yet (deploy 26, E1).");
        else if (!(await tl.hasRole(await tl.PROPOSER_ROLE(), lendingSafe))) gs = gx = waitingFor(`CLEAR_LENDING_SAFE ${lendingSafe} is not a proposer on the Earn timelock ${earnTimelock}.`);
        else if (!(await pool.hasRole(ZERO_HASH, earnTimelock))) gs = gx = waitingFor("The Earn timelock does not hold the LendingPool's admin yet (the Earn handover, I4, gives it).");
        else {
          const gId: string = await tl.hashOperation(poolAddress, 0n, grantData, ZERO_HASH, gSalt);
          gs = (await tl.isOperation(gId)) ? { status: "done" } : { status: "ready" };
          if (await tl.isOperationDone(gId)) gs = gx = waitingFor(`This grant ran, but deployment signer ${n} no longer holds the pool's DEPLOYER_ROLE (revoked since). Ask before granting it again.`);
          else if (!(await tl.isOperation(gId))) gx = waitingFor(`Waits for SL-deployer-${n}-schedule, then 7 days.`);
          else if (!(await tl.isOperationReady(gId))) gx = waitingFor(`Not yet: the Earn timelock's 7 days end at ${new Date(Number(await tl.getTimestamp(gId)) * 1000).toISOString()}.`);
          else gx = { status: "ready" };
        }
        push({
          id: `SL-deployer-${n}-schedule`, stage: "SL", title: `Clear Lending Safe: schedule the pool's DEPLOYER_ROLE for deployment signer ${n}`,
          explanation: `Deployment signer ${n} (${d}, deploy/config/earn-roles.json) needs the Yield Pool's DEPLOYER_ROLE for the SL-funder and SL-headroom pairs. This queues LendingPool.grantRole(DEPLOYER_ROLE, ${d}) on the Earn timelock; it can run 7 days later. It does not wait for E8x. Sign it in the Safe app.`,
          kind: "safe", signer: lendingSafe ?? ZERO_ADDRESS, signerLabel: "Clear Lending Safe (its owners sign in the Safe app)", to: tlAddress, toLabel: "Earn timelock",
          ...encode(timelockIface, "schedule", [poolAddress ?? ZERO_ADDRESS, 0n, grantData, ZERO_HASH, gSalt, delay], ["LendingPool (the Yield Pool)", undefined, `grantRole(DEPLOYER_ROLE, ${d})`, "none", "a fixed label for this grant", `${Number(delay) / 86400} days`]),
          dependsOn: [], ...gs,
        });
        push({
          id: `SLx-deployer-${n}-execute`, stage: "Day 7", title: `Clear Lending Safe: run the DEPLOYER_ROLE grant for deployment signer ${n} (7 days after scheduling)`,
          explanation: `After the 7 days, the Safe runs the queued grant: ${d} holds the pool's DEPLOYER_ROLE and can sign the SL pairs and two-person Deployments.`,
          kind: "safe", signer: lendingSafe ?? ZERO_ADDRESS, signerLabel: "Clear Lending Safe (its owners sign in the Safe app)", to: tlAddress, toLabel: "Earn timelock",
          ...encode(timelockIface, "execute", [poolAddress ?? ZERO_ADDRESS, 0n, grantData, ZERO_HASH, gSalt], ["LendingPool (the Yield Pool)", undefined, `grantRole(DEPLOYER_ROLE, ${d})`, "none", "the same label"]),
          dependsOn: [`SL-deployer-${n}-schedule`], ...gx,
        });
      }
    }
    const deployers = deploymentSigners;
    const DEPLOYER = ethers.id("DEPLOYER_ROLE");
    if (deployers.length < 2) notes.push("Waiting for input: the pool's DEPLOYER_ROLE needs two signers in deploy/config/earn-roles.json (the SL steps).");
    deployers.forEach((a, i) => label(a, `deployment signer ${ordinal(i)}`));
    if (poolAddress) {
      for (const [i, d] of deployers.slice(0, 2).entries()) {
        if (!(await pool.hasRole(DEPLOYER, d))) notes.push(`Deployment signer ${i + 1} ${d} (deploy/config/earn-roles.json) does not hold the pool's DEPLOYER_ROLE on chain: SL-deployer-${i + 1}-schedule and SLx-deployer-${i + 1}-execute grant it through the Earn timelock, before the SL-funder and SL-headroom pairs.`);
      }
    }
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const usd = (v: bigint | null | undefined) => (v === null || v === undefined ? "?" : formatUsdc(v));
    const pairStep = async (
      key: "funder" | "headroom", i: number, signer: string, inputs: string | undefined, applied: string | undefined,
      action: string | undefined, enc: { data: string | null; functionSignature: string; args: PlanArg[] }, title: string, explanation: string,
    ) => {
      let st: { status: StepStatus; reason?: string };
      if (inputs) st = waitingFor(inputs);
      else if (!poolAddress) st = waitingFor("No LendingPool record.");
      else if (!lane) st = waitingFor("Waits for SLx-upgrade-execute: the lane is in the new LendingPool implementation.");
      else if (applied) st = { status: "done", reason: applied };
      else if (action && same(await pool.proposerOf(action), signer)) st = { status: "done", reason: "Sent by this signer; waits for the other deployment signer." };
      else if (!(await pool.hasRole(DEPLOYER, signer))) st = waitingFor(`This signer does not hold the pool's DEPLOYER_ROLE on chain (deploy/config/earn-roles.json lists it): the Earn timelock grants it first (SL-deployer-${i + 1}-schedule, then SLx-deployer-${i + 1}-execute).`);
      else st = { status: "ready" };
      push({
        id: `SL-${key}-${i + 1}`, stage: "SL", title: `${title}: deployment signer ${i + 1}`, explanation,
        kind: "wallet", signer, signerLabel: `deployment signer ${i + 1}`, to: poolAddress ?? ZERO_ADDRESS, toLabel: "LendingPool (the Yield Pool)",
        ...enc, dependsOn: ["SLx-upgrade-execute", `SLx-deployer-${i + 1}-execute`], ...st,
      });
    };

    // SL-funder: register the desk's wallet, its cap per period and the period.
    {
      const inputs: string[] = [];
      if (!funder) inputs.push(env.SETTLEMENT_FUNDER ? `SETTLEMENT_FUNDER is not an address: ${env.SETTLEMENT_FUNDER}` : "SETTLEMENT_FUNDER (the funding desk's CDP wallet; the owner creates it)");
      if (cap === null || cap === 0n) inputs.push("SETTLEMENT_CAP_USDC (dollars per period)");
      if (!periodSeconds) inputs.push("SETTLEMENT_PERIOD_DAYS (1 to 45)");
      const missing = inputs.length ? `Waiting for input: ${inputs.join(", ")}.` : undefined;
      const action = lane && !missing
        ? ethers.keccak256(coder.encode(["string", "address", "uint256", "uint64", "uint24"], ["settlementFunder", funder, cap, periodSeconds, lane.epoch]))
        : undefined;
      const applied = lane && !missing && same(lane.funder, funder) && BigInt(lane.capPerPeriod) === cap && BigInt(lane.periodSeconds) === periodSeconds && !lane.stopped
        ? `Set: ${short(funder!)} may deploy up to ${usd(cap)} every ${days} day${days === 1 ? "" : "s"}.` : undefined;
      if (lane?.stopped && !same(lane.funder, ZERO_ADDRESS)) notes.push(`The Settlement Funding lane is STOPPED (funder ${lane.funder}). SL-funder restarts it: two deployment signers.`);
      const enc = missing
        ? { data: null, functionSignature: "setSettlementFunder(address,uint256,uint64)", args: [] }
        : encode(pool, "setSettlementFunder", [funder, cap, periodSeconds], [undefined, `${usd(cap)} per period (USDC base units)`, `${days} day${days === 1 ? "" : "s"}, in seconds`]);
      for (const [i, d] of deployers.slice(0, 2).entries()) {
        await pairStep("funder", i, d, missing, applied, action, enc, `Register the settlement funder (${usd(cap)} per ${days ?? "?"} days)`,
          i === 0
            ? "Registers the funding desk's wallet as the Yield Pool's settlement funder: it may then deploy, alone, up to the cap in each period, only to CL Operating, and only when a two-person Deployment could (no open queue request, no Suspension, no pending loss charge, Utilization at most 90% afterwards). Two different deployment signers send the same call; the second makes it count. It also restarts a stopped lane."
            : "The same call from the other deployment signer; this one makes it count.");
      }
    }
    // SL-headroom: how far above the posted Pool Tier principal the lane alone may go.
    {
      const missing = headroom === null ? "Waiting for input: SETTLEMENT_HEADROOM_USDC (dollars)." : undefined;
      const action = !missing ? ethers.keccak256(coder.encode(["string", "uint256"], ["settlementHeadroom", headroom])) : undefined;
      const applied = lane && !missing && BigInt(lane.headroom) === headroom ? `Set: ${usd(headroom)}.` : undefined;
      const enc = missing
        ? { data: null, functionSignature: "setSettlementHeadroom(uint256)", args: [] }
        : encode(pool, "setSettlementHeadroom", [headroom], [`${usd(headroom)} (USDC base units)`]);
      for (const [i, d] of deployers.slice(0, 2).entries()) {
        await pairStep("headroom", i, d, missing, applied, action, enc, `Set the Settlement Headroom (${usd(headroom)})`,
          i === 0
            ? "Lets the settlement lane, and only the lane, take the Deployed Balance up to the posted Pool Tier principal plus this amount, to cover credit portions authorized and not yet settled. Two-person Deployments stay within the principal alone. Two different deployment signers send the same call."
            : "The same call from the other deployment signer; this one makes it count.");
      }
    }
    // CL Operating's batch for the SettlementForwarder (deploy 28): name it a spending-limit delegate on Safe's
    // AllowanceModule with the lane's cap per period, and set its off-ramp and desk wallet. Four calls, signed
    // once as one Transaction Builder batch by CL Operating's owner (the Clear Lending Safe). Only CL Operating
    // can set the forwarder's off-ramp and desk.
    {
      const operating = addr(env.CLEAR_LENDING_ACCOUNT);
      const forwarderAddr = await rec("SettlementForwarder");
      const offRamp = addr(env.SETTLEMENT_OFFRAMP_ADDRESS);
      const moduleAddr = addr(env.PAYOUT_TOPUP_ALLOWANCE_MODULE) ?? CANONICAL_ALLOWANCE_MODULE;
      label(forwarderAddr, "SettlementForwarder");
      label(offRamp, "settlement off-ramp");
      label(moduleAddr, "AllowanceModule");
      const fwd = await contract("SettlementForwarder", forwarderAddr ?? ZERO_ADDRESS);
      const modHasCode = await hasCode(moduleAddr);
      const mod = new ethers.Contract(modHasCode ? moduleAddr : ZERO_ADDRESS, ALLOWANCE_MODULE_ABI, provider);
      const opHasCode = !!operating && (await hasCode(operating));
      const safeC = new ethers.Contract(opHasCode ? operating! : ZERO_ADDRESS, SAFE_MODULE_ABI, provider);
      const usdc = poolAddress ? ethers.getAddress(await pool.asset()) : addr(env.RESERVE_TOKEN);
      const periodMin = days ? days * 1440 : undefined;
      let problem: string | undefined;
      if (!forwarderAddr) problem = "Waits for deploy 28 (deploy/28_deploy_SettlementForwarder.ts), which deploys the SettlementForwarder.";
      else if (!operating) problem = "Waiting for input: CLEAR_LENDING_ACCOUNT (CL Operating).";
      else if (!opHasCode) problem = `CL Operating ${operating} has no code on this chain.`;
      else if (!modHasCode || (await mod.NAME().catch(() => "")) !== "Allowance Module") problem = `No AllowanceModule at ${moduleAddr} on this chain.`;
      else if (!same(await fwd.safe(), operating)) problem = `The SettlementForwarder ${forwarderAddr} serves ${await fwd.safe()}, not CL Operating ${operating}: redeploy it (deploy 28).`;
      else if (!same(await fwd.allowanceModule(), moduleAddr)) problem = `The SettlementForwarder ${forwarderAddr} calls the module ${await fwd.allowanceModule()}, not ${moduleAddr}.`;
      else if (!usdc || !same(await fwd.token(), usdc)) problem = `The SettlementForwarder ${forwarderAddr} forwards ${await fwd.token()}, not the pool's USDC ${usdc ?? "?"}.`;
      const moduleOn = !problem && (await safeC.isModuleEnabled(moduleAddr));
      const via = "In the Safe app open CL Operating, load the batch in Transaction Builder, confirm it from the Clear Lending Safe (a nested-Safe confirmation, both owners), then execute.";
      const batchHint = "Sign all four at once: safe-batches/signing-SL-cl-operating.json (written while they are ready).";
      const fwdStep = (id: string, title: string, explanation: string, to: string | undefined, enc: any, st: { status: StepStatus; reason?: string }, dependsOn: string[] = []) =>
        push({
          id, stage: "SL", title, explanation: `${explanation} ${via} ${batchHint}`,
          kind: "safe", signer: operating ?? ZERO_ADDRESS, signerLabel: "CL Operating (its owner, the Clear Lending Safe, signs in the Safe app)",
          to: to ?? ZERO_ADDRESS, toLabel: /-(offramp|desk)$/.test(id) ? "SettlementForwarder" : "AllowanceModule", ...enc, dependsOn, ...st,
        });
      const blocked = problem ? waitingFor(problem) : !moduleOn ? waitingFor("Waits for TU-safe-module: the AllowanceModule is not enabled on CL Operating yet.") : undefined;
      const fTo = forwarderAddr && !problem ? forwarderAddr : undefined;
      const mTo = !problem ? moduleAddr : undefined;
      {
        let isDelegate = false;
        if (!problem) {
          let start = 0n;
          for (let page = 0; page < 20; page++) {
            const [found, next] = await mod.getDelegates(operating, start, 50);
            if ((found as string[]).some((d) => same(d, forwarderAddr))) { isDelegate = true; break; }
            if (BigInt(next) === 0n) break;
            start = BigInt(next);
          }
        }
        fwdStep("SL-cl-operating-delegate", "CL Operating: name the SettlementForwarder a spending-limit delegate",
          "The forwarder may then move CL Operating's USDC, but only to its off-ramp and only within the allowance the next call sets.",
          mTo, encode(mod, "addDelegate", [forwarderAddr ?? ZERO_ADDRESS], ["SettlementForwarder"]),
          isDelegate ? { status: "done" } : blocked ?? { status: "ready" });
      }
      {
        const inputs: string[] = [];
        if (cap === null || cap === 0n) inputs.push("SETTLEMENT_CAP_USDC (dollars per period)");
        if (!periodMin) inputs.push("SETTLEMENT_PERIOD_DAYS (1 to 45)");
        let st: { status: StepStatus; reason?: string } = blocked ?? { status: "ready" };
        if (inputs.length) st = waitingFor(`Waiting for input: ${inputs.join(", ")}.`);
        else if (!problem) {
          const al = await mod.getTokenAllowance(operating, forwarderAddr, usdc);
          if (BigInt(al[0]) === cap && Number(al[2]) === periodMin) st = { status: "done", reason: `${usd(cap)} every ${days} day${days === 1 ? "" : "s"}; ${formatUsdc(BigInt(al[1]))} spent this period.` };
          else if (BigInt(al[0]) !== 0n) notes.push(`CL Operating's allowance for the SettlementForwarder is ${formatUsdc(BigInt(al[0]))} every ${al[2]} minutes; SL-cl-operating-allowance sets it to ${usd(cap)} every ${days} days.`);
        }
        const enc = !inputs.length
          ? encode(mod, "setAllowance", [forwarderAddr ?? ZERO_ADDRESS, usdc ?? ZERO_ADDRESS, cap, periodMin, 0], ["SettlementForwarder", "USDC", `${usd(cap)} per period (USDC base units): SETTLEMENT_CAP_USDC, the pool lane's cap`, `${days} days in minutes: SETTLEMENT_PERIOD_DAYS`, "periods counted from when it is set"])
          : { data: null, functionSignature: signatureOf(mod, "setAllowance"), args: [] };
        fwdStep("SL-cl-operating-allowance", `CL Operating: let the SettlementForwarder move up to ${usd(cap)} of USDC every ${days ?? "?"} days`,
          "The most the funding desk can push from CL Operating to the off-ramp in a period, whatever happens to its key: the same cap as the pool lane's.",
          mTo, enc, st, ["SL-cl-operating-delegate"]);
      }
      {
        let st: { status: StepStatus; reason?: string } = blocked ?? { status: "ready" };
        if (!offRamp) st = waitingFor(env.SETTLEMENT_OFFRAMP_ADDRESS ? `SETTLEMENT_OFFRAMP_ADDRESS is not an address: ${env.SETTLEMENT_OFFRAMP_ADDRESS}.` : "Waiting for input: SETTLEMENT_OFFRAMP_ADDRESS (the off-ramp's deposit address bound to the Credit Settlement Account).");
        else if (!problem && same(await fwd.offRamp(), offRamp)) st = { status: "done" };
        fwdStep("SL-cl-operating-offramp", "CL Operating: set the SettlementForwarder's off-ramp",
          "Every forward goes to this address and nowhere else. Only CL Operating can change it.",
          fTo, offRamp ? encode(fwd, "setOffRamp", [offRamp], ["the off-ramp (SETTLEMENT_OFFRAMP_ADDRESS)"]) : { data: null, functionSignature: signatureOf(fwd, "setOffRamp"), args: [] }, st);
      }
      {
        let st: { status: StepStatus; reason?: string } = blocked ?? { status: "ready" };
        if (!funder) st = waitingFor(env.SETTLEMENT_FUNDER ? `SETTLEMENT_FUNDER is not an address: ${env.SETTLEMENT_FUNDER}.` : "Waiting for input: SETTLEMENT_FUNDER (the funding desk's CDP wallet; the owner creates it).");
        else if (!problem && same(await fwd.desk(), funder)) st = { status: "done" };
        fwdStep("SL-cl-operating-desk", "CL Operating: name the funding desk's wallet as the SettlementForwarder's only caller",
          "The same CDP wallet the pool lane registers as its funder. Only CL Operating can change it; zero stops forwarding.",
          fTo, funder ? encode(fwd, "setDesk", [funder], ["the funding desk's wallet (SETTLEMENT_FUNDER)"]) : { data: null, functionSignature: signatureOf(fwd, "setDesk"), args: [] }, st);
      }
    }
  }

  // ================= State attester (SA): the credit operator may attest members' states =================
  // No line or plan opens until a member's state is attested (NetworkRegistry.stateCodeOf), and only
  // STATE_ATTESTER_ROLE attests. Its admin is the CreditTimelock (7 days), whose proposer and executor
  // is the Clear Treasury Safe. scripts/state_attester_grant.ts holds the checks and the calls.
  {
    const attester = addr(env.STATE_ATTESTER);
    const registry = await rec("NetworkRegistry");
    const creditTimelock = await rec("CreditTimelock");
    if (attester && registry && creditTimelock && financialSafe) {
      label(creditTimelock, "credit timelock");
      label(registry, "NetworkRegistry");
      const g = await stateAttesterGrant({ provider, registry, timelock: creditTimelock, safe: financialSafe, attester });
      const signerLabel = "Clear Treasury Safe (its owners sign in the Safe app)";
      const sSt = g.step === "schedule" ? { status: "ready" as StepStatus } : { status: "done" as StepStatus };
      const xSt = g.step === "execute" ? { status: "ready" as StepStatus }
        : g.step === "done" ? { status: "done" as StepStatus, reason: g.reason }
        : waitingFor(g.step === "wait" ? g.reason : "Waits for the schedule step, then 7 days.");
      push({
        id: "SA-attester-schedule", stage: "SA", title: "Clear Treasury Safe: schedule the state attester grant",
        explanation: `Queues NetworkRegistry.grantRole(STATE_ATTESTER_ROLE, ${attester}) on the credit timelock, so the credit operator can attest members' states and their lines can open. It can run 7 days later. Sign it in the Safe app.`,
        kind: "safe", signer: financialSafe, signerLabel, to: creditTimelock, toLabel: "credit timelock",
        ...encode(timelockIface, "schedule", [...timelockIface.interface.decodeFunctionData("schedule", g.schedule.data)], ["NetworkRegistry", undefined, `grantRole(STATE_ATTESTER_ROLE, ${attester})`, "none", "a fixed label for this grant", "7 days"]),
        dependsOn: [], ...sSt,
      });
      push({
        id: "SAx-attester-execute", stage: "Day 7", title: "Clear Treasury Safe: run the state attester grant (7 days after scheduling)",
        explanation: "After the 7 days, the Safe runs the queued grant: the credit operator gets STATE_ATTESTER_ROLE on the NetworkRegistry and nothing else. Then the API's credit onboarding job attests states and opens lines.",
        kind: "safe", signer: financialSafe, signerLabel, to: creditTimelock, toLabel: "credit timelock",
        ...encode(timelockIface, "execute", [...timelockIface.interface.decodeFunctionData("execute", g.execute.data)], ["NetworkRegistry", undefined, `grantRole(STATE_ATTESTER_ROLE, ${attester})`, "none", "the same label"]),
        dependsOn: ["SA-attester-schedule"], ...xSt,
      });
    } else if (attester) {
      notes.push("STATE_ATTESTER is set but the NetworkRegistry, the CreditTimelock or CLEAR_FINANCIAL_SAFE is missing: no state attester steps.");
    }
  }

  // ================= State rates (SR): switch the products on in more states (testnet) =================
  // RateSchedule is owned by the CreditTimelock, and a line or plan opens only where its products are
  // enabled for the member's attested state. RATE_STATES lists the states to switch on with the
  // config's products (deploy/config/rate-schedule.json: CA's rows, the same placeholder rates).
  // Each state takes ~1.4M gas (5 products), and a transaction may use at most 2^24 gas, so the
  // states go in fixed chunks of RATE_STATES_PER_BATCH: one scheduleBatch each, all signed together
  // today, and one executeBatch each after the 7 days.
  {
    const wanted = (env.RATE_STATES ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    const rateAddr = await rec("RateSchedule");
    const creditTimelock = await rec("CreditTimelock");
    if (wanted.length && rateAddr && creditTimelock && financialSafe) {
      label(rateAddr, "RateSchedule");
      label(creditTimelock, "credit timelock");
      const { loadRateTable } = require("../deploy/25_wire_Compliance");
      const table = loadRateTable() as { state: string; product: string; params: any; bands: any[] }[];
      const base = table.filter((r) => ethers.decodeBytes32String(r.state) === ethers.decodeBytes32String(table[0].state));
      const rates = await contract("RateSchedule", rateAddr);
      const tl = await timelockOf(creditTimelock);
      const delay: bigint = await tl.getMinDelay();
      const configured = new Set(table.map((r) => ethers.decodeBytes32String(r.state)));
      const states = wanted.filter((st) => !configured.has(st));
      const per = Math.max(1, Number(env.RATE_STATES_PER_BATCH ?? 8));
      const scheduleIds: string[] = [];
      for (let i = 0; i < states.length; i += per) {
        const chunk = states.slice(i, i + per);
        const n = i / per + 1;
        const calls = chunk.flatMap((st) => base.map((r) => ({
          to: rateAddr,
          data: rates.interface.encodeFunctionData("setProduct", [ethers.encodeBytes32String(st), r.product, r.params, r.bands]),
        })));
        const targets = calls.map((c) => c.to);
        const values = calls.map(() => 0n);
        const payloads = calls.map((c) => c.data);
        const salt = ethers.id(`signing-plan: SR state rates ${chunk.join(",")}`);
        const opId: string = await tl.hashOperationBatch(targets, values, payloads, ZERO_HASH, salt);
        let have = 0;
        for (const st of chunk) if (await rates.hasProduct(ethers.encodeBytes32String(st), base[0].product)) have++;
        let sSt: { status: StepStatus; reason?: string };
        let xSt: { status: StepStatus; reason?: string };
        if (have === chunk.length) sSt = xSt = { status: "done", reason: `Products set for ${chunk.join(", ")}.` };
        else if (have > 0) sSt = xSt = waitingFor(`Only ${have} of ${chunk.join(", ")} are set: products changed outside this plan. Ask before scheduling.`);
        else {
          sSt = (await tl.isOperation(opId)) ? { status: "done" } : { status: "ready" };
          if (await tl.isOperationDone(opId)) xSt = { status: "done" };
          else if (!(await tl.isOperation(opId))) xSt = waitingFor("Waits for its schedule step, then 7 days.");
          else if (!(await tl.isOperationReady(opId))) xSt = waitingFor(`Not yet: the credit timelock's 7 days end at ${new Date(Number(await tl.getTimestamp(opId)) * 1000).toISOString()}.`);
          else xSt = { status: "ready" };
        }
        const list = chunk.join(", ");
        const sid = `SR-rates-schedule-${n}`;
        scheduleIds.push(sid);
        push({
          id: sid, stage: "SR", title: `Clear Treasury Safe: schedule the products for ${list}`,
          explanation: `Queues RateSchedule.setProduct for ${base.length} products (${base.map((r) => ethers.decodeBytes32String(r.product)).join(", ")}) in ${list}, with the same test rates as ${ethers.decodeBytes32String(base[0].state)}, so members there can get a line and plans. Testnet only; every rate is pending counsel. Sign all SR schedule steps at once: safe-batches/signing-SR-rates-schedule.json.`,
          kind: "safe", signer: financialSafe, signerLabel: "Clear Treasury Safe (its owners sign in the Safe app)", to: creditTimelock, toLabel: "credit timelock",
          ...encode(timelockIface, "scheduleBatch", [targets, values, payloads, ZERO_HASH, salt, delay], [`RateSchedule (${calls.length} calls)`, undefined, `setProduct for ${list}`, "none", "a fixed label for this batch", `${Number(delay) / 86400} days`]),
          dependsOn: [], ...sSt,
        });
        push({
          id: `SRx-rates-execute-${n}`, stage: "Day 7", title: `Clear Treasury Safe: run the products for ${list} (7 days after scheduling)`,
          explanation: `After the 7 days, the Safe runs the queued products for ${list}. About ${(1.4 * chunk.length).toFixed(1)}M gas: send each batch as its own Safe transaction.`,
          kind: "safe", signer: financialSafe, signerLabel: "Clear Treasury Safe (its owners sign in the Safe app)", to: creditTimelock, toLabel: "credit timelock",
          ...encode(timelockIface, "executeBatch", [targets, values, payloads, ZERO_HASH, salt], [`RateSchedule (${calls.length} calls)`, undefined, `setProduct for ${list}`, "none", "the same label"]),
          dependsOn: [sid], ...xSt,
        });
      }
    } else if (wanted.length) {
      notes.push("RATE_STATES is set but RateSchedule, the CreditTimelock or CLEAR_FINANCIAL_SAFE is missing: no state rate steps.");
    }
  }

  // ================= dependencies, then a dry run of every ready step =================
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const s of steps) {
    if (s.status !== "ready") continue;
    const open = s.dependsOn.filter((d) => byId.get(d)?.status !== "done");
    if (open.length) {
      s.status = "waiting";
      s.reason = `Waits for ${open.join(", ")} first.`;
    }
  }
  const ifaces = await Promise.all(["AccessManager", "CollateralAgent", "BondVault", "Liquidator", "TermIssuer", "TimelockController", "ESADepositVault", "YieldPoolLedger", "LendingPool", "AssurancePool", "SettlementForwarder"].map(async (n) => new ethers.Interface((await artifacts.readArtifact(n)).abi)));
  const decodeRevert = (e: any): string => {
    const data: string | undefined = e?.data ?? e?.error?.data ?? e?.info?.error?.data;
    if (typeof data === "string" && data.length >= 10) {
      for (const i of ifaces) {
        try {
          const p = i.parseError(data);
          if (p) return `${p.name}(${p.args.map(String).join(", ")})`;
        } catch { /* next */ }
      }
      try {
        if (data.startsWith("0x08c379a0")) return ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + data.slice(10))[0];
      } catch { /* raw */ }
      return data;
    }
    return String(e?.shortMessage ?? e?.message ?? e).split("\n")[0];
  };
  for (const s of steps) {
    if (s.status !== "ready" || !s.data) continue;
    if (!(await hasCode(s.to))) throw new Error(`Refusing: step ${s.id} is to ${s.to}, which has no code on ${network}.`);
    try {
      await provider.call({ from: s.signer, to: s.to, data: s.data });
    } catch (e: any) {
      s.status = "waiting";
      s.reason = `A dry run of this call from ${short(s.signer)} fails: ${decodeRevert(e)}. Re-run the plan once the step before it is done; if it persists, ask before sending.`;
    }
  }
  // Refuse any step whose `to` has no code (a wrong network or a stale record), whatever its status.
  for (const s of steps) {
    if (s.to === ZERO_ADDRESS) {
      if (s.status !== "waiting") throw new Error(`Refusing: step ${s.id} has no target.`);
      continue;
    }
    if (!(await hasCode(s.to))) throw new Error(`Refusing: step ${s.id} is to ${s.to}, which has no code on ${network}.`);
  }

  return {
    format: PLAN_FORMAT,
    generatedAt: new Date().toISOString(),
    network,
    chainId,
    block: Number(head.number),
    blockTime: new Date(Number(head.timestamp) * 1000).toISOString(),
    stepsSha256: stepsSha256(steps),
    notes,
    steps,
  };
}

/** Safe Transaction Builder batch, the shape scripts/vaultUpgrade.ts writes. */
export function safeBatch(chainId: number, name: string, description: string, transactions: { to: string; data: string }[]) {
  return {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: { name, description },
    transactions: transactions.map(({ to, data }) => ({ to, value: "0", data })),
  };
}

/**
 * Writes the plan and, for each Safe step that is ready, its Transaction Builder batch
 * (`safe-batches/signing-<id>.json`). Earlier `signing-*.json` batches are removed first, so the
 * folder never holds a batch the chain has moved past. Returns the paths written.
 */
export function writeSigningPlan(plan: SigningPlan, outDir: string) {
  const batches = path.join(outDir, "safe-batches");
  fs.mkdirSync(batches, { recursive: true });
  for (const f of fs.readdirSync(batches)) if (/^signing-.*\.json$/.test(f)) fs.rmSync(path.join(batches, f));
  const written: string[] = [];
  for (const s of plan.steps) {
    if (s.kind !== "safe" || s.status !== "ready" || !s.data) continue;
    const file = path.join(batches, `signing-${s.id}.json`);
    fs.writeFileSync(file, JSON.stringify(safeBatch(plan.chainId, s.title, `${s.explanation} Generated by scripts/signing_plan.ts at block ${plan.block}. Review every call before signing.`, [{ to: s.to, data: s.data }]), null, 2));
    s.safeBatchFile = path.relative(outDir, file);
    written.push(file);
  }
  // Payout top-ups: CL Operating's three setup calls, as one batch to sign once. Written while one is
  // ready and the rest wait only on each other (setAllowance's dry run needs the delegate added first).
  const setup = plan.steps.filter((s) => s.kind === "safe" && s.id.startsWith("TU-safe-") && s.status !== "done");
  if (
    setup.some((s) => s.status === "ready") &&
    setup.every((s) => s.data && s.to !== ZERO_ADDRESS && (s.status === "ready" || /^Waits for TU-safe-[a-z]+(, TU-safe-[a-z]+)* first\.$/.test(s.reason ?? "")))
  ) {
    const file = path.join(batches, "signing-TU-cl-operating-setup.json");
    fs.writeFileSync(file, JSON.stringify(safeBatch(plan.chainId, "CL Operating: set up the payout top-ups' spending limit",
      `${setup.map((s) => s.title).join("; ")}. Decision 51. Generated by scripts/signing_plan.ts at block ${plan.block}. Review every call before signing.`,
      setup.map((s) => ({ to: s.to, data: s.data! }))), null, 2));
    written.push(file);
    plan.notes.push(`CL Operating's payout top-up setup (${setup.map((s) => s.id).join(", ")}) is one batch: ${path.relative(outDir, file)}.`);
  }
  // Settlement Funding: CL Operating's four forwarder calls, as one batch to sign once (as the top-ups').
  const slSetup = plan.steps.filter((s) => s.kind === "safe" && s.id.startsWith("SL-cl-operating-") && s.status !== "done");
  if (
    slSetup.some((s) => s.status === "ready") &&
    slSetup.every((s) => s.data && s.to !== ZERO_ADDRESS && (s.status === "ready" || /^Waits for SL-cl-operating-[a-z]+(, SL-cl-operating-[a-z]+)* first\.$/.test(s.reason ?? "")))
  ) {
    const file = path.join(batches, "signing-SL-cl-operating.json");
    fs.writeFileSync(file, JSON.stringify(safeBatch(plan.chainId, "CL Operating: install the SettlementForwarder (Settlement Funding)",
      `${slSetup.map((s) => s.title).join("; ")}. Decision 54. Generated by scripts/signing_plan.ts at block ${plan.block}. Review every call before signing.`,
      slSetup.map((s) => ({ to: s.to, data: s.data! }))), null, 2));
    written.push(file);
    plan.notes.push(`CL Operating's SettlementForwarder setup (${slSetup.map((s) => s.id).join(", ")}) is one batch: ${path.relative(outDir, file)}.`);
  }
  // State rates: every ready SR schedule step in one Transaction Builder batch, signed once.
  const srReady = plan.steps.filter((s) => s.kind === "safe" && s.id.startsWith("SR-rates-schedule-") && s.status === "ready" && s.data);
  if (srReady.length) {
    const file = path.join(batches, "signing-SR-rates-schedule.json");
    fs.writeFileSync(file, JSON.stringify(safeBatch(plan.chainId, "Clear Treasury Safe: schedule the state products (testnet)",
      `${srReady.map((s) => s.title).join("; ")}. Generated by scripts/signing_plan.ts at block ${plan.block}. Review every call before signing.`,
      srReady.map((s) => ({ to: s.to, data: s.data! }))), null, 2));
    written.push(file);
    plan.notes.push(`The state products' schedule steps (${srReady.map((s) => s.id).join(", ")}) are one batch: ${path.relative(outDir, file)}.`);
  }
  // The file names are added after the hash: recompute it over what is written.
  plan.stepsSha256 = stepsSha256(plan.steps);
  const planFile = path.join(outDir, "signing-plan.json");
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + "\n");
  return { planFile, batches: written };
}

function summary(plan: SigningPlan) {
  const lines = [`Signing plan for ${plan.network} (chain ${plan.chainId}) at block ${plan.block}, ${plan.blockTime}. Sends nothing.`, ""];
  for (const s of plan.steps) {
    lines.push(`${s.status.toUpperCase().padEnd(7)} ${s.id.padEnd(26)} ${s.kind === "safe" ? "[Safe] " : ""}${s.signerLabel} -> ${s.toLabel}.${s.functionSignature.split("(")[0]}${s.reason ? `\n        ${s.reason}` : ""}`);
  }
  if (plan.notes.length) lines.push("", ...plan.notes.map((n) => `NOTE ${n}`));
  const count = (st: StepStatus) => plan.steps.filter((s) => s.status === st).length;
  lines.push("", `${count("ready")} ready, ${count("waiting")} waiting, ${count("done")} done. steps sha256 ${plan.stepsSha256}`);
  return lines.join("\n");
}

async function main() {
  const hre = require("hardhat");
  const network: string = hre.network.name;
  if (!(network in NETWORK_CHAINS)) throw new Error(`Run this against --network base-sepolia (or base-sepolia-fork), not ${network}.`);
  const env = loadPlanEnv();
  // A plain JSON-RPC reader, never the network's configured accounts: this script needs no key, and
  // Hardhat would refuse to start the base-sepolia network without DEPLOYER_PRIVATE_KEY.
  const url: string | undefined = hre.network.config.url;
  if (!url) throw new Error(`No RPC url for ${network}.`);
  const provider = new hre.ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 });
  const plan = await buildSigningPlan({ network, env, provider });
  const { planFile, batches } = writeSigningPlan(plan, path.join("deployments", network));
  console.log(summary(plan));
  console.log(`\nWrote ${planFile}${batches.length ? ` and ${batches.length} Safe batch(es): ${batches.join(", ")}` : ""}.`);
  console.log(`Open it in tools/signing-page/index.html (see tools/signing-page/README.md). Re-run this after each stage. Live network: ${liveNetworkOf(network)}.`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
