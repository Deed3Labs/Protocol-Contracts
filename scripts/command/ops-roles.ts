/**
 * Moves the deployer's OPERATIONAL roles to the wallets that do each job, so the deployer key stops
 * holding every power. The admin roles go to the Ops Safe with scripts/command/safe-handover.ts;
 * this is the rest. Kai runs it; Command never does.
 *
 * The map of role → job is scripts/command/ops-roles.map.json. Each job's wallet address comes from
 * env (made by Kai, never by this script), e.g. CREDIT_OPERATOR_ADDRESS. A role marked "safe" goes to
 * SAFE_ADDRESS; one marked "renounce" is used by nothing off-chain and is simply given up.
 *
 * Dry run (the default): who holds each role now, and what a run would do. No key needed.
 *   DEPLOYER=0x… CREDIT_OPERATOR_ADDRESS=0x… … npx hardhat run scripts/command/ops-roles.ts --network base-sepolia
 *
 * Run: grants each role to its job's wallet, then renounces it from the deployer only once the
 * wallet is seen to hold it. Signed with the deployer's key from your own env.
 *   MODE=run CONFIRM=ops-roles … npx hardhat run scripts/command/ops-roles.ts --network base-sepolia
 *
 * The deployer must still hold each contract's admin role to grant, so run this BEFORE the admin
 * handover to the Safe (or have the Safe grant instead). FIX_CHECKS=1 also grants contracts the roles
 * the "checks" list says they need and don't hold (LendingPool's LIQUIDATOR_ROLE for the Liquidator).
 */
import { readFileSync } from "fs";
import path from "path";
import { ethers } from "hardhat";
import { Contract, getAddress, isAddress, type ContractRunner, type Signer } from "ethers";
import { deployments, roleHash, type Deployed } from "./handover";

export interface RoleJob {
  contract: string;
  role: string;
  /** A job name (its wallet is <JOB>_ADDRESS in env), "safe", or "renounce". */
  to: string;
  why: string;
}

const MAP = JSON.parse(readFileSync(path.join(__dirname, "ops-roles.map.json"), "utf8"));
export const ROLE_MAP: RoleJob[] = MAP.roles;
/** Roles a CONTRACT should hold for the protocol to work: reported, never changed here. */
export const CHECKS: Array<{ contract: string; role: string; holder: string; why: string }> = MAP.checks;

/** Grants a contract a role it should hold and doesn't (FIX_CHECKS=1), as the deployer. */
export async function fixChecks(deployer: Signer, list: Deployed[], log: (s: string) => void = console.log) {
  const byName = new Map(list.map((d) => [d.name, d]));
  for (const k of CHECKS) {
    const d = byName.get(k.contract)!,
      h = byName.get(k.holder)!;
    const c = new Contract(d.address, d.abi, deployer);
    const hash = /_ROLE$/.test(k.role) && d.abi.getFunction(k.role) ? await c[k.role]() : roleHash(k.role);
    if (await c.hasRole(hash, h.address)) continue;
    await (await c.grantRole(hash, h.address)).wait();
    log(`  ${k.contract}: grant ${k.role} → the ${k.holder} contract`);
  }
}
/** Whether each contract that should hold a role does. Reads only. */
export async function checkContracts(runner: ContractRunner, list: Deployed[]) {
  const byName = new Map(list.map((d) => [d.name, d]));
  const out: Array<{ line: string; ok: boolean }> = [];
  for (const k of CHECKS) {
    const d = byName.get(k.contract)!,
      h = byName.get(k.holder)!;
    const c = new Contract(d.address, d.abi, runner);
    const hash = /_ROLE$/.test(k.role) && d.abi.getFunction(k.role) ? await c[k.role]() : roleHash(k.role);
    const ok = await c.hasRole(hash, h.address);
    out.push({ ok, line: `${k.contract}.${k.role} held by ${k.holder}: ${ok ? "yes" : "NO"} (${k.why})` });
  }
  return out;
}

/** Each job's wallet, from env: credit-operator → CREDIT_OPERATOR_ADDRESS. */
export const envName = (job: string) => `${job.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_ADDRESS`;
/** The names the repo's env already uses for some jobs' wallets (the relayers' CDP accounts). */
const ALIASES: Record<string, string[]> = {
  "savings-relayer": ["SAVINGS_RELAYER_ADDRESS_84532", "SAVINGS_CDP_EVM_ACCOUNT_ADDRESS_84532", "SAVINGS_CDP_EVM_ACCOUNT_ADDRESS"],
  "send-relayer": ["SEND_RELAYER_ADDRESS_84532", "SEND_CDP_EVM_ACCOUNT_ADDRESS_84532", "SEND_CDP_EVM_ACCOUNT_ADDRESS"],
  "card-settler": ["CARD_SETTLER_ADDRESS_84532"],
  "credit-operator": ["CREDIT_OPERATOR_ADDRESS_84532"],
  "membership-registrar": ["MEMBERSHIP_REGISTRAR_ADDRESS_84532"],
};
/** Addresses (never keys) the API's own env names, so the script finds the wallets it signs with. */
function apiAddresses(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(path.join(__dirname, "../../apps/api/.env"), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]*ADDRESS[A-Z0-9_]*)=\s*(0x[0-9a-fA-F]{40})\s*$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}
export function walletFor(job: string, env: Record<string, string | undefined> = process.env): string | null {
  if (job === "renounce") return null;
  const all = { ...apiAddresses(), ...env };
  const names = job === "safe" ? ["SAFE_ADDRESS", "COMMAND_SAFE_ADDRESS"] : [envName(job), ...(ALIASES[job] ?? [])];
  const raw = names.map((n) => all[n]?.trim()).find((v) => v && isAddress(v)) ?? (MAP.wallets?.[job] as string | undefined) ?? "";
  return raw ? getAddress(raw) : null;
}

export interface Move {
  contract: string;
  address: string;
  role: string;
  hash: string;
  to: string;
  wallet: string | null;
  deployerHolds: boolean;
  walletHolds: boolean;
  why: string;
}

/** Who holds each mapped role now. Reads only. */
export async function surveyMoves(runner: ContractRunner, list: Deployed[], deployer: string, env = process.env): Promise<Move[]> {
  const byName = new Map(list.map((d) => [d.name, d]));
  const out: Move[] = [];
  for (const r of ROLE_MAP) {
    const d = byName.get(r.contract);
    if (!d) throw new Error(`ops-roles.map.json names ${r.contract}, which isn't deployed`);
    const c = new Contract(d.address, d.abi, runner);
    const hash = /_ROLE$/.test(r.role) && d.abi.getFunction(r.role) ? await c[r.role]() : roleHash(r.role);
    const wallet = walletFor(r.to, env);
    const [dep, w] = await Promise.all([c.hasRole(hash, deployer), wallet ? c.hasRole(hash, wallet) : Promise.resolve(false)]);
    out.push({ contract: r.contract, address: d.address, role: r.role, hash, to: r.to, wallet, deployerHolds: dep, walletHolds: w, why: r.why });
  }
  return out;
}

/** Grants first, then renounces, each renounce only once the new holder is seen to hold the role. */
export async function executeMoves(deployer: Signer, list: Deployed[], moves: Move[], log: (s: string) => void = console.log) {
  const byName = new Map(list.map((d) => [d.name, d]));
  const me = await deployer.getAddress();
  for (const m of moves.filter((x) => x.wallet && !x.walletHolds)) {
    const c = new Contract(m.address, byName.get(m.contract)!.abi, deployer);
    await (await c.grantRole(m.hash, m.wallet)).wait();
    if (!(await c.hasRole(m.hash, m.wallet))) throw new Error(`${m.contract}: granting ${m.role} to ${m.to} didn't take`);
    log(`  ${m.contract}: grant ${m.role} → ${m.to} ${m.wallet}`);
  }
  for (const m of moves.filter((x) => x.deployerHolds)) {
    const c = new Contract(m.address, byName.get(m.contract)!.abi, deployer);
    if (m.wallet && !(await c.hasRole(m.hash, m.wallet))) throw new Error(`Refusing to renounce ${m.role} on ${m.contract}: ${m.to} doesn't hold it`);
    await (await c.renounceRole(m.hash, me)).wait();
    log(`  ${m.contract}: renounce ${m.role} from the deployer`);
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  const deployer = getAddress(process.env.DEPLOYER?.trim() || (await signer.getAddress()));
  const list = deployments();
  const moves = await surveyMoves(ethers.provider, list, deployer);
  const missing = [...new Set(moves.filter((m) => m.to !== "renounce" && !m.wallet).map((m) => (m.to === "safe" ? "SAFE_ADDRESS" : envName(m.to))))];
  console.log(`Deployer ${deployer}\n`);
  for (const m of moves) {
    const now = [m.deployerHolds && "deployer", m.walletHolds && m.to].filter(Boolean).join(" + ") || "nobody we know of";
    console.log(`${`${m.contract}.${m.role}`.padEnd(44)} now: ${now.padEnd(28)} → ${m.to === "renounce" ? "renounced (unused off-chain)" : `${m.to}${m.wallet ? " " + m.wallet : " (address not set)"}`}`);
  }
  if (missing.length) console.log(`\nSet these before a run: ${missing.join(", ")}`);
  console.log("\nContracts that should hold a role (reported only, never changed here):");
  for (const k of await checkContracts(ethers.provider, list)) console.log(`  ${k.ok ? "ok " : "!! "} ${k.line}`);
  if ((process.env.MODE ?? "dry") !== "run") return console.log("\nDry run: nothing was sent. MODE=run CONFIRM=ops-roles to carry it out.");
  if (process.env.CONFIRM !== "ops-roles") throw new Error("Set CONFIRM=ops-roles to carry it out.");
  if (missing.length) throw new Error(`Missing wallet addresses: ${missing.join(", ")}`);
  if (getAddress(await signer.getAddress()) !== deployer) throw new Error("The signer isn't the deployer: run it with the deployer's key.");
  console.log("\nRunning:");
  // contracts missing a role they need (FIX_CHECKS=1): granted while the deployer is still admin
  if (process.env.FIX_CHECKS === "1") await fixChecks(signer, list);
  await executeMoves(signer, list, moves);
  const left = (await surveyMoves(ethers.provider, list, deployer)).filter((m) => m.deployerHolds);
  console.log(left.length ? `\nThe deployer still holds ${left.length}: run it again` : "\nDone: the deployer holds none of the mapped roles.");
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
