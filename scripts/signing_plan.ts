import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { liveNetworkOf } from "../deploy/helpers";
import { RETIRED_SUFFIX } from "../deploy/retire_credit_stack";
import { parseEnvFile } from "./rehearse_sepolia_fork";

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
        for (const c of pending) {
          const r = (c as any).record;
          if (!r || same(r.confirmer, ZERO_ADDRESS) || !r.agentApproved) why.push(`the change "${c.what}" is not confirmed and approved yet`);
          else if (now < BigInt(r.confirmedAt) + 7n * 86400n) why.push(`the Collateral Agent's 7 days for "${c.what}" end at ${new Date((Number(r.confirmedAt) + 7 * 86400) * 1000).toISOString()}`);
          const tc = await contract("BondVault", c.target!); // DEFAULT_ADMIN_ROLE is 0 on every AccessControl contract
          if (!(await tc.hasRole(ZERO_HASH, earnTimelock))) why.push(`the Earn timelock does not hold the ${c.targetLabel}'s admin yet (the Earn handover, I4, gives it)`);
        }
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
    const safes = [...new Map([financialSafe, lendingSafe].filter(Boolean).map((s) => [s!.toLowerCase(), s!])).values()];
    for (const [i, safe] of safes.entries()) {
      const s = new ethers.Contract(safe, SAFE_ABI, provider);
      const id = safes.length > 1 ? `safe-owner-${i + 1}` : "safe-owner";
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
        kind: "safe", signer: safe, signerLabel: `the Safe ${short(safe)} (its owners sign in the Safe app)`, to: safe, toLabel: "the Safe itself", ...enc, dependsOn: [], ...st,
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
  const ifaces = await Promise.all(["AccessManager", "CollateralAgent", "BondVault", "Liquidator", "TermIssuer", "TimelockController", "ESADepositVault", "YieldPoolLedger", "LendingPool"].map(async (n) => new ethers.Interface((await artifacts.readArtifact(n)).abi)));
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
