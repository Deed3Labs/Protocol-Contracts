/**
 * Handing the contracts' admin to the Ops Safe (docs/command-center-plan.md, Phase 4c).
 *
 * Shared by the script (scripts/command/safe-handover.ts) and its fork drill
 * (scripts/command/drill_safe_handover.ts). Three steps, always in this order:
 *
 *   survey   who holds each admin role and each owner() today: the deployer, the Safe, or neither
 *   grant    each admin role the deployer holds goes to the Safe too; each owner() is transferred
 *   renounce the deployer gives up each role, but only once the Safe is seen to hold it
 *
 * A contract with OpenZeppelin's AccessControlDefaultAdminRules (ClearUSDUpgradeable) won't grant its
 * default admin directly: the deployer begins a transfer, and the Safe accepts once its delay has
 * passed, which ends the deployer's admin there.
 *
 * Only admin roles move by default. Operational roles (minters, settlers, the relayer's roles) are
 * reported and stay where they are, unless named in INCLUDE_ROLES. Ownership moves in one step,
 * except where a contract wants it accepted (Ownable2Step): the Safe accepts in a transaction of
 * its own, which the survey lists.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Contract, Interface, encodeBytes32String, getAddress, id as keccakId, type ContractRunner, type Signer } from "ethers";

export const ADMIN_ROLES = ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE", "UPGRADER_ROLE", "REGISTRY_ADMIN_ROLE", "PAUSER_ROLE"];
const ZERO_ROLE = "0x" + "00".repeat(32);

/**
 * Operational roles the Safe needs for what Command proposes to it (Phase 4b's builders): shop terms
 * and on/off need MerchantRegistry's OPERATOR_ROLE, a top-up needs PayoutPool's FUNDER_ROLE
 * (payQueue needs none). The Safe is granted these as well; whoever holds them now keeps them.
 */
export const SAFE_NEEDS: Record<string, string[]> = { MerchantRegistry: ["OPERATOR_ROLE"], PayoutPool: ["FUNDER_ROLE"] };

/** AccessManager names its roles as plain strings rather than *_ROLE constants. */
const EXTRA_ROLES: Record<string, string[]> = { AccessManager: ["OPERATOR", "MEMBER"] };

export interface Deployed {
  name: string;
  address: string;
  abi: Interface;
}

export function deployments(dir = path.join(__dirname, "../../deployments/base-sepolia")): Deployed[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      const abi = typeof j.abi === "string" ? JSON.parse(j.abi) : j.abi;
      return j.address && Array.isArray(abi) ? [{ name: f.replace(/\.json$/, ""), address: getAddress(j.address), abi: new Interface(abi) }] : [];
    });
}

export interface RoleHolding {
  role: string;
  hash: string;
  admin: boolean;
  deployer: boolean;
  safe: boolean;
}
export interface Survey {
  name: string;
  address: string;
  kind: "roles" | "owner" | "both" | "none";
  roles: RoleHolding[];
  owner: string | null;
  twoStep: boolean;
  pendingOwner: string | null;
  /** AccessControlDefaultAdminRules: the default admin moves by a timed transfer. */
  adminRules: { admin: string; pending: string | null; delaySeconds: number } | null;
}

const has = (abi: Interface, name: string) => !!abi.getFunction(name);

/** Who holds what on one contract. Reads only. */
export async function surveyOne(runner: ContractRunner, d: Deployed, deployer: string, safe: string, include: string[] = []): Promise<Survey> {
  const c = new Contract(d.address, d.abi, runner);
  const roleNames = [
    ...d.abi.fragments.filter((f: any) => f.type === "function" && /_ROLE$/.test(f.name) && f.inputs.length === 0).map((f: any) => f.name),
    ...(EXTRA_ROLES[d.name] ?? []),
  ];
  const roles: RoleHolding[] = [];
  if (has(d.abi, "hasRole")) {
    for (const role of roleNames) {
      const hash = role === "DEFAULT_ADMIN_ROLE" ? ZERO_ROLE : /_ROLE$/.test(role) ? await c[role]() : encodeBytes32String(role);
      const [dep, sf] = await Promise.all([c.hasRole(hash, deployer), c.hasRole(hash, safe)]);
      roles.push({ role, hash, admin: ADMIN_ROLES.includes(role) || include.includes(role), deployer: dep, safe: sf });
    }
  }
  // owner() alone isn't ownership: with AccessControlDefaultAdminRules it only reports the default admin
  const owner = has(d.abi, "owner") && has(d.abi, "transferOwnership") ? getAddress(await c.owner()) : null;
  const twoStep = has(d.abi, "acceptOwnership");
  const pendingOwner = twoStep && has(d.abi, "pendingOwner") ? getAddress(await c.pendingOwner()) : null;
  const kind = roles.length && owner ? "both" : roles.length ? "roles" : owner ? "owner" : "none";
  let adminRules: Survey["adminRules"] = null;
  if (has(d.abi, "beginDefaultAdminTransfer")) {
    const [admin, [pending], delay] = await Promise.all([c.defaultAdmin(), c.pendingDefaultAdmin(), c.defaultAdminDelay()]);
    adminRules = { admin: getAddress(admin), pending: pending === "0x0000000000000000000000000000000000000000" ? null : getAddress(pending), delaySeconds: Number(delay) };
  }
  return { name: d.name, address: d.address, kind, roles, owner, twoStep, pendingOwner, adminRules };
}

export async function survey(runner: ContractRunner, list: Deployed[], deployer: string, safe: string, include: string[] = []) {
  const out: Survey[] = [];
  for (const d of list) out.push(await surveyOne(runner, d, deployer, safe, include));
  return out;
}

export interface Step {
  contract: string;
  address: string;
  action: "grantRole" | "renounceRole" | "transferOwnership" | "acceptOwnership (by the Safe)" | "beginDefaultAdminTransfer" | "acceptDefaultAdminTransfer (by the Safe, after the delay)";
  role?: string;
  hash?: string;
}

/** What the handover would do, from a survey. Grants and transfers first; renounces last, the default admin role last of all. */
export function plan(s: Survey[], deployer: string, safe: string): { steps: Step[]; kept: string[] } {
  const grants: Step[] = [],
    renounces: Step[] = [],
    kept: string[] = [];
  for (const c of s) {
    for (const r of c.roles) {
      // what Command's own proposals need the Safe to hold: granted, never taken from anyone
      if ((SAFE_NEEDS[c.name] ?? []).includes(r.role) && !r.safe && !r.admin) grants.push({ contract: c.name, address: c.address, action: "grantRole", role: r.role, hash: r.hash });
      if (!r.deployer) continue;
      if (!r.admin) {
        kept.push(`${c.name} · ${r.role} stays with the deployer (operational; name it in INCLUDE_ROLES to move it)`);
        continue;
      }
      if (r.role === "DEFAULT_ADMIN_ROLE" && c.adminRules) {
        // the timed transfer: begun now, accepted by the Safe later; accepting ends the deployer's admin
        if (c.adminRules.pending !== getAddress(safe)) grants.push({ contract: c.name, address: c.address, action: "beginDefaultAdminTransfer", role: r.role, hash: r.hash });
        grants.push({ contract: c.name, address: c.address, action: "acceptDefaultAdminTransfer (by the Safe, after the delay)", role: r.role, hash: r.hash });
        continue;
      }
      if (!r.safe) grants.push({ contract: c.name, address: c.address, action: "grantRole", role: r.role, hash: r.hash });
      renounces.push({ contract: c.name, address: c.address, action: "renounceRole", role: r.role, hash: r.hash });
    }
    if (c.owner && c.owner === getAddress(deployer)) {
      grants.push({ contract: c.name, address: c.address, action: "transferOwnership" });
      if (c.twoStep) grants.push({ contract: c.name, address: c.address, action: "acceptOwnership (by the Safe)" });
    }
  }
  // a contract's default admin goes last, so its other roles can still be renounced before it
  renounces.sort((a, b) => Number(a.role === "DEFAULT_ADMIN_ROLE") - Number(b.role === "DEFAULT_ADMIN_ROLE"));
  void safe;
  return { steps: [...grants, ...renounces], kept };
}

/**
 * Carries out a plan as the deployer. Before each renounce it reads the role again and refuses
 * unless the Safe holds it; ownership the Safe has to accept is left for the Safe.
 */
export async function execute(deployerSigner: Signer, list: Deployed[], steps: Step[], safe: string, log: (s: string) => void = console.log) {
  const byName = new Map(list.map((d) => [d.name, d]));
  for (const st of steps) {
    const d = byName.get(st.contract)!;
    const c = new Contract(d.address, d.abi, deployerSigner);
    if (st.action === "acceptOwnership (by the Safe)" || st.action === "acceptDefaultAdminTransfer (by the Safe, after the delay)") {
      log(`  ${st.contract}: the Safe ${st.action.startsWith("acceptOwnership") ? "accepts ownership" : "accepts the default admin, once the delay has passed,"} in its own transaction`);
      continue;
    }
    if (st.action === "beginDefaultAdminTransfer") {
      await (await c.beginDefaultAdminTransfer(safe)).wait();
      log(`  ${st.contract}: beginDefaultAdminTransfer to the Safe`);
      continue;
    }
    if (st.action === "renounceRole") {
      if (!(await c.hasRole(st.hash, safe))) throw new Error(`Refusing to renounce ${st.role} on ${st.contract}: the Safe doesn't hold it`);
      await (await c.renounceRole(st.hash, await deployerSigner.getAddress())).wait();
    } else if (st.action === "grantRole") {
      await (await c.grantRole(st.hash, safe)).wait();
      if (!(await c.hasRole(st.hash, safe))) throw new Error(`${st.contract}: granting ${st.role} to the Safe didn't take`);
    } else {
      await (await c.transferOwnership(safe)).wait();
    }
    log(`  ${st.contract}: ${st.action}${st.role ? " " + st.role : ""}`);
  }
}

/** A role's hash the way a contract names it, for people reading the survey. */
export const roleHash = (role: string) => (role === "DEFAULT_ADMIN_ROLE" ? ZERO_ROLE : /_ROLE$/.test(role) ? keccakId(role) : encodeBytes32String(role));
