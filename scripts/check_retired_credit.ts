import { getDeployment } from "../deploy/helpers";
import { RETIRED_ROLE_CHECKS, roleHash } from "../deploy/creditWiring";
import { REFUSED_RECORDS } from "../deploy/earnWiring";
import { RETIRED_SUFFIX, retiredContracts } from "../deploy/retire_credit_stack";

/*
 * Decision 48 (b): is every retired credit and bond contract disconnected from what we keep?
 *
 * Read-only. It sends nothing, needs no key, and reads each contract through the ABI in its
 * deployment record (the compiled ABI fills a function a stale record lacks). It prints a PASS / FAIL
 * list and exits non-zero on any FAIL, so it can gate a run:
 *
 * - The retired contracts: every `*PreAudit` credit-stack record (`deploy/retire_credit_stack.ts`),
 *   every `*Pre2f` and `*Legacy` bond record, and every collection and deposit contract of a retired
 *   bond factory. A retired address equal to a live record's is skipped (WARN), never treated as retired.
 * - For each, every role it still holds on a contract we keep (FAIL): LendingPool (the Yield Pool),
 *   ClearUSDUpgradeable, ESADepositVault, BondVault, ClaimEscrow, EarnControls and the fresh
 *   AccessManager, with the roles in `RETIRED_ROLE_CHECKS` (`deploy/creditWiring.ts`).
 * - Every source or link on a kept contract that still names a retired contract (FAIL): the pool's
 *   encumbrance source, CLRUSD's encumbrance, membership and intent-factory sources, the vault's state
 *   source, the BondVault's `payoutPool` and encumbrance source, ClaimEscrow's payout treasury,
 *   EarnControls' sources and the AccessManager's membership registry.
 * - EarnControls: each retired contract on its refused list (`REFUSED_RECORDS`, and every factory
 *   clone) must be refused (FAIL if not). The rest hold no funds and are left off by decision 46(c)
 *   (INFO), unless one holds a balance (FAIL).
 * - Each retired contract's USDC and CLRUSD balances (WARN when not zero: money for the owner to
 *   decide on, not a connection).
 * - The retired PayoutPool: `borrowedFromVault` and `borrowedFromYield` (FAIL while a loan is open),
 *   and its `yieldPool` and `bondVault` legs (FAIL while either is still on), with the BondVault's
 *   `lentToPayoutPool`.
 *
 * Where it runs (DEPLOY-RUNBOOK §2.2): on Base Sepolia before the fresh deploy with CHECK_BASELINE=1,
 * which takes the records about to be retired under their current names (the list of what the later
 * steps must disconnect, so it is expected to FAIL); after the fresh deploy and the I-steps; and as
 * the gate before the held app PRs merge, which must PASS. On a network with nothing retired (Base
 * mainnet) it says so and passes.
 *
 *   npx hardhat run scripts/check_retired_credit.ts --network base-sepolia
 *   CHECK_BASELINE=1 npx hardhat run scripts/check_retired_credit.ts --network base-sepolia
 *
 * RESERVE_TOKEN overrides the USDC address (Base Sepolia's and Base's are known).
 */

export type Status = "PASS" | "FAIL" | "WARN" | "INFO";

export interface Finding {
  status: Status;
  /** The retired contract, kept contract or link it is about. */
  subject: string;
  what: string;
}

export const KNOWN_RESERVE_TOKEN: Record<string, string> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

/** The contracts we keep, the roles a retired contract must not hold on each, and the links that must not name one. */
export const KEPT_CONTRACTS: { record: keyof typeof RETIRED_ROLE_CHECKS; links: string[] }[] = [
  { record: "LendingPool", links: ["encumbranceSource", "earnControls", "deploymentAccount", "enforcementDestination"] },
  { record: "ClearUSDUpgradeable", links: ["encumbranceSource", "membershipSource", "intentFactory"] },
  { record: "ESADepositVault", links: ["stateSource", "clrusd"] },
  { record: "BondVault", links: ["payoutPool", "encumbranceSource", "treasury", "agent", "controls"] },
  { record: "ClaimEscrow", links: ["PAYOUT_TREASURY"] },
  { record: "EarnControls", links: ["membership", "yieldPool", "reserveStatus", "collateralAgent", "reserveHook"] },
  { record: "AccessManager", links: ["membershipRegistry"] },
];

export interface CheckOptions {
  /** The records' network (deployments/<network>/); defaults to the connected one. */
  network?: string;
  /** Check the records about to be retired, under their current names (Base Sepolia, before step D1). */
  baseline?: boolean;
  reserveToken?: string;
  log?: (m: string) => void;
}

/** The record's functions, with the compiled ABI filling any it lacks. Functions only, each once. */
async function abiFor(record: { abi?: any } | null | undefined, artifact: string): Promise<any[]> {
  const hre = require("hardhat");
  const { ethers } = hre;
  let fallback: any[] = [];
  if (artifact === "LendingPool") fallback = await require("../deploy/poolModules").poolAbi();
  else if (artifact === "EarnControls") fallback = await require("../deploy/earnModules").earnControlsAbi();
  else fallback = await hre.artifacts.readArtifact(artifact).then((a: any) => a.abi, () => []);
  const out: any[] = [];
  const seen = new Set<string>();
  for (const frag of [...(Array.isArray(record?.abi) ? record!.abi : []), ...fallback]) {
    try {
      const f = ethers.Fragment.from(frag);
      if (f.type !== "function") continue;
      const key = (f as any).format("sighash");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    } catch {
      // not a fragment this ABI parser reads; skip it
    }
  }
  return out;
}

/** Runs the check and returns every finding; `failures` is what gates. Sends nothing. */
export async function checkRetiredCredit(options: CheckOptions = {}) {
  const { ethers } = require("hardhat");
  const network = options.network ?? (await ethers.provider.getNetwork()).name;
  const log = options.log ?? console.log;
  const lookup = (name: string) => getDeployment(network, name);
  const findings: Finding[] = [];
  const add = (status: Status, subject: string, what: string) => findings.push({ status, subject, what });

  const { contracts: retired, skipped } = await retiredContracts(lookup, { baseline: options.baseline });
  const retiredBy = new Map(retired.map((r) => [r.address.toLowerCase(), r]));
  for (const s of skipped) add("WARN", s.name, `${s.address} is also the live ${s.liveAs} record: not checked as retired`);

  if (retired.length === 0) {
    add("INFO", network, options.baseline ? "no credit-stack or bond records to check" : "nothing retired on record: nothing to check");
    return report(network, options, findings, retired.length, log);
  }

  // ---- roles and links on each kept contract ----
  const clean = new Map<string, string[]>(retired.map((r) => [r.address, []]));
  for (const spec of KEPT_CONTRACTS) {
    const record = lookup(spec.record);
    if (!record) {
      add(options.baseline ? "INFO" : "WARN", spec.record, "not recorded on this network: not checked");
      continue;
    }
    if (retiredBy.has(record.address.toLowerCase())) continue; // being retired itself (baseline)
    const ct = new ethers.Contract(record.address, await abiFor(record, spec.record), ethers.provider);
    for (const r of retired) {
      const held: string[] = [];
      for (const role of RETIRED_ROLE_CHECKS[spec.record]) {
        const has = await ct.hasRole(roleHash(role), r.address).catch(() => null);
        if (has === null) add("FAIL", r.name, `could not read ${spec.record}.hasRole(${role})`);
        else if (has) held.push(role);
      }
      if (held.length === 0) clean.get(r.address)!.push(spec.record);
      for (const role of held) add("FAIL", r.name, `holds ${spec.record} ${role} (${r.address})`);
    }
    for (const link of spec.links) {
      if (ct.interface.getFunction(link) === null) continue;
      const value: string | null = await ct[link]().catch(() => null);
      if (value === null) {
        add("INFO", `${spec.record}.${link}()`, "not answered (the contract predates it): names nothing");
        continue;
      }
      const hit = retiredBy.get(String(value).toLowerCase());
      if (hit) add("FAIL", `${spec.record}.${link}()`, `names the retired ${hit.name} ${hit.address}`);
      else add("PASS", `${spec.record}.${link}()`, value === ethers.ZeroAddress ? "unset" : `${value}, not a retired contract`);
    }
  }
  for (const r of retired) {
    const none = clean.get(r.address)!;
    if (none.length > 0) add("PASS", r.name, `no role on ${none.join(", ")}`);
  }

  // ---- balances ----
  const reserveToken = options.reserveToken ?? process.env.RESERVE_TOKEN ?? KNOWN_RESERVE_TOKEN[network];
  const tokens: { label: string; address: string; abi: any[] }[] = [];
  const ERC20 = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];
  if (reserveToken) tokens.push({ label: "USDC", address: reserveToken, abi: ERC20 });
  else add("WARN", network, "no reserve token known: set RESERVE_TOKEN to check USDC balances");
  for (const [label, name] of [["CLRUSD", "ClearUSDUpgradeable"], ["legacy CLRUSD", "ClearUSD"]]) {
    const rec = lookup(name);
    if (rec && !retiredBy.has(rec.address.toLowerCase())) tokens.push({ label, address: rec.address, abi: await abiFor(rec, name) });
  }
  const holding = new Set<string>();
  for (const r of retired) {
    const empty: string[] = [];
    for (const t of tokens) {
      const token = new ethers.Contract(t.address, t.abi, ethers.provider);
      const balance: bigint | null = await token.balanceOf(r.address).catch(() => null);
      if (balance === null) add("WARN", r.name, `could not read its ${t.label} balance`);
      else if (balance === 0n) empty.push(t.label);
      else {
        holding.add(r.address);
        const decimals = await token.decimals().catch(() => null);
        const shown = decimals === null ? `${balance}` : ethers.formatUnits(balance, decimals);
        add("WARN", r.name, `holds ${shown} ${t.label} (owner to decide where it goes)`);
      }
    }
    if (empty.length > 0) add("PASS", r.name, `holds no ${empty.join(" or ")}`);
  }

  // ---- EarnControls' refused list ----
  const controlsRecord = lookup("EarnControls");
  const mustRefuse = new Set(REFUSED_RECORDS.map((x) => x.name));
  if (!controlsRecord) {
    add(options.baseline ? "INFO" : "FAIL", "EarnControls", "not recorded: the refusals cannot be confirmed (deploy 26 refuses them)");
  } else {
    const controls = new ethers.Contract(controlsRecord.address, await abiFor(controlsRecord, "EarnControls"), ethers.provider);
    for (const r of retired) {
      const required = mustRefuse.has(r.name) || / (collection|deposit contract) /.test(r.name);
      const refused: boolean | null = await controls.refused(r.address).catch(() => null);
      if (refused === null) add("FAIL", r.name, "could not read EarnControls.refused");
      else if (refused) add("PASS", r.name, "refused by EarnControls");
      else if (required) add("FAIL", r.name, "not refused by EarnControls: run deploy 26 again (it refuses every REFUSED_RECORDS entry)");
      else if (holding.has(r.address)) add("FAIL", r.name, "holds funds but is not refused by EarnControls (decision 46(c) leaves out only contracts that hold none)");
      else add("INFO", r.name, "not on the refused list: it holds no funds (decision 46(c))");
    }
  }

  // ---- the retired PayoutPool's loans and legs ----
  const payoutName = options.baseline ? "PayoutPool" : `PayoutPool${RETIRED_SUFFIX}`;
  const payoutRecord = lookup(payoutName);
  if (payoutRecord) {
    const payout = new ethers.Contract(payoutRecord.address, await abiFor(payoutRecord, "PayoutPool"), ethers.provider);
    const read = async (fn: string): Promise<any> =>
      payout.interface.getFunction(fn) === null ? undefined : payout[fn]().catch(() => undefined);
    for (const [fn, lender] of [["borrowedFromVault", "the BondVault"], ["borrowedFromYield", "the Yield Pool"]]) {
      const owed = await read(fn);
      if (owed === undefined) add("INFO", `${payoutName}.${fn}()`, "not answered: no such loan");
      else if (owed !== 0n) add("FAIL", `${payoutName}.${fn}()`, `${owed} still owed to ${lender}: an open loan keeps it connected`);
      else add("PASS", `${payoutName}.${fn}()`, "0");
    }
    for (const [fn, fix] of [
      ["yieldPool", "deploy 27 (and deploy 22) switch it off once borrowedFromYield is 0"],
      ["bondVault", "deploy 22 and deploy 27 switch it off once borrowedFromVault is 0"],
    ]) {
      const leg = await read(fn);
      if (leg === undefined) add("INFO", `${payoutName}.${fn}()`, "not answered: no such leg");
      else if (leg !== ethers.ZeroAddress) add("FAIL", `${payoutName}.${fn}()`, `still ${leg}: ${fix}`);
      else add("PASS", `${payoutName}.${fn}()`, "off");
    }
    const reserveOwed = await read("borrowedFromReserve");
    if (reserveOwed !== undefined && reserveOwed !== 0n) {
      add("WARN", `${payoutName}.borrowedFromReserve()`, `${reserveOwed} owed to its old reserve ${await read("reserve")} (the retired AssurancePool, not a contract we keep)`);
    }
    const vaultRecord = lookup("BondVault");
    if (vaultRecord) {
      const vault = new ethers.Contract(vaultRecord.address, await abiFor(vaultRecord, "BondVault"), ethers.provider);
      const lent: bigint | null = await vault.lentToPayoutPool().catch(() => null);
      if (lent !== null && lent !== 0n) {
        add("FAIL", "BondVault.lentToPayoutPool()", `${lent}: the old PayoutPool must repay through repayFromPayoutPool before the backstop can be cleared (decision 48 (a))`);
      } else if (lent === 0n) add("PASS", "BondVault.lentToPayoutPool()", "0");
    }
  }

  return report(network, options, findings, retired.length, log);
}

function report(network: string, options: CheckOptions, findings: Finding[], retiredCount: number, log: (m: string) => void) {
  const order: Status[] = ["FAIL", "WARN", "PASS", "INFO"];
  log(`Retired credit check on ${network}${options.baseline ? " (baseline: the records about to be retired)" : ""}: ${retiredCount} retired contract(s). Sends nothing.\n`);
  for (const status of order) {
    for (const f of findings.filter((x) => x.status === status)) log(`${f.status.padEnd(4)}  ${f.subject}: ${f.what}`);
  }
  const failures = findings.filter((f) => f.status === "FAIL");
  const warnings = findings.filter((f) => f.status === "WARN");
  log(`\n${failures.length} FAIL, ${warnings.length} WARN.${failures.length > 0 ? " Still connected: see each FAIL." : " Nothing retired is still connected."}`);
  return { network, findings, failures, warnings };
}

async function main() {
  const { failures } = await checkRetiredCredit({ baseline: process.env.CHECK_BASELINE === "1" });
  return failures.length > 0 ? 1 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
