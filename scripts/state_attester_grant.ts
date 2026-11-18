import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { safeBatch } from "./signing_plan";

/*
 * Grants STATE_ATTESTER_ROLE on the NetworkRegistry to one wallet, through the CreditTimelock.
 *
 * Why: a revolving line or term plan opens only for a member whose state of residence is attested
 * on chain (NetworkRegistry.stateCodeOf), and only STATE_ATTESTER_ROLE may attest. Day 0 left the
 * role ungranted on purpose (base-sepolia.rollout.env). The role's admin is DEFAULT_ADMIN, held by
 * the CreditTimelock (7 days), whose only proposer and executor is the Clear Treasury Safe. So the
 * Safe schedules the grant now and runs it 7 days later. Nothing here signs or sends: it reads the
 * chain, refuses anything that does not match, and writes the two Transaction Builder batches.
 *
 *   STATE_ATTESTER=0x8801… SAFE=0x52e6… NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
 *     npx ts-node scripts/state_attester_grant.ts            # reads https://sepolia.base.org
 *
 * Writes deployments/base-sepolia/safe-batches/state-attester-{schedule,execute}.json while each is
 * signable, and says which step is next.
 */

export const STATE_ATTESTER_ROLE = ethers.id("STATE_ATTESTER_ROLE");
const SALT = ethers.id("state-attester-grant: NetworkRegistry STATE_ATTESTER_ROLE");

const REGISTRY_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
];
const TIMELOCK_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function getMinDelay() view returns (uint256)",
  "function hashOperation(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperation(bytes32 id) view returns (bool)",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function getTimestamp(bytes32 id) view returns (uint256)",
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)",
];

export type GrantStep = "done" | "schedule" | "wait" | "execute";

export interface GrantPlan {
  step: GrantStep;
  /** Why this step, in a sentence. */
  reason: string;
  operation: string;
  readyAt: Date | null;
  schedule: { to: string; data: string };
  execute: { to: string; data: string };
}

/** Reads the chain and says what the Safe signs next. Throws on anything that does not match. */
export async function stateAttesterGrant(o: {
  provider: ethers.Provider;
  registry: string;
  timelock: string;
  safe: string;
  attester: string;
}): Promise<GrantPlan> {
  for (const [k, v] of Object.entries({ registry: o.registry, timelock: o.timelock, safe: o.safe, attester: o.attester }))
    if (!ethers.isAddress(v) || v === ethers.ZeroAddress) throw new Error(`${k} is not an address: ${v}`);
  const registry = new ethers.Contract(o.registry, REGISTRY_ABI, o.provider);
  const tl = new ethers.Contract(o.timelock, TIMELOCK_ABI, o.provider);

  const admin: string = await registry.getRoleAdmin(STATE_ATTESTER_ROLE);
  if (!(await registry.hasRole(admin, o.timelock)))
    throw new Error(`The timelock ${o.timelock} does not hold the role that grants STATE_ATTESTER_ROLE on ${o.registry}.`);
  if (!(await tl.hasRole(await tl.PROPOSER_ROLE(), o.safe)) || !(await tl.hasRole(await tl.EXECUTOR_ROLE(), o.safe)))
    throw new Error(`The Safe ${o.safe} is not both proposer and executor on the timelock ${o.timelock}.`);

  const grant = registry.interface.encodeFunctionData("grantRole", [STATE_ATTESTER_ROLE, o.attester]);
  const delay: bigint = await tl.getMinDelay();
  const schedule = { to: o.timelock, data: tl.interface.encodeFunctionData("schedule", [o.registry, 0n, grant, ethers.ZeroHash, SALT, delay]) };
  const execute = { to: o.timelock, data: tl.interface.encodeFunctionData("execute", [o.registry, 0n, grant, ethers.ZeroHash, SALT]) };
  const operation: string = await tl.hashOperation(o.registry, 0n, grant, ethers.ZeroHash, SALT);
  const base = { operation, schedule, execute };

  if (await registry.hasRole(STATE_ATTESTER_ROLE, o.attester))
    return { ...base, step: "done", reason: `${o.attester} already holds STATE_ATTESTER_ROLE.`, readyAt: null };
  if (!(await tl.isOperation(operation)))
    return { ...base, step: "schedule", reason: `The Safe schedules the grant; it can run ${Number(delay) / 86400} days later.`, readyAt: null };
  const readyAt = new Date(Number(await tl.getTimestamp(operation)) * 1000);
  if (await tl.isOperationDone(operation))
    return { ...base, step: "done", reason: "The grant ran, but the role is not held: it was revoked since. Ask before granting again.", readyAt };
  if (!(await tl.isOperationReady(operation)))
    return { ...base, step: "wait", reason: `Scheduled. The Safe can run it from ${readyAt.toISOString()}.`, readyAt };
  return { ...base, step: "execute", reason: "The wait is over: the Safe runs the grant.", readyAt };
}

async function main() {
  const rpc = process.env.RPC_URL || "https://sepolia.base.org";
  const provider = new ethers.JsonRpcProvider(rpc);
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== 84532) throw new Error(`Expected Base Sepolia (84532), got ${chainId}.`);
  const dir = path.join(__dirname, "..", "deployments", "base-sepolia");
  const at = (n: string) => JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), "utf8")).address as string;
  const attester = process.env.STATE_ATTESTER?.trim() ?? "";
  const safe = process.env.SAFE?.trim() ?? "";
  const plan = await stateAttesterGrant({ provider, registry: at("NetworkRegistry"), timelock: at("CreditTimelock"), safe, attester });

  const batches = path.join(dir, "safe-batches");
  fs.mkdirSync(batches, { recursive: true });
  const what = `NetworkRegistry.grantRole(STATE_ATTESTER_ROLE, ${attester}) through the CreditTimelock (operation ${plan.operation}).`;
  const files = {
    schedule: path.join(batches, "state-attester-schedule.json"),
    execute: path.join(batches, "state-attester-execute.json"),
  };
  for (const f of Object.values(files)) if (fs.existsSync(f)) fs.rmSync(f);
  if (plan.step === "schedule")
    fs.writeFileSync(files.schedule, JSON.stringify(safeBatch(chainId, "Clear Treasury Safe: schedule the state attester grant",
      `Schedules ${what} It can run 7 days later. Review every call before signing.`, [plan.schedule]), null, 2) + "\n");
  if (plan.step === "schedule" || plan.step === "wait" || plan.step === "execute")
    fs.writeFileSync(files.execute, JSON.stringify(safeBatch(chainId, "Clear Treasury Safe: run the state attester grant (after 7 days)",
      `Runs ${what} Only after the 7 days; before that the timelock refuses it. Review every call before signing.`, [plan.execute]), null, 2) + "\n");

  console.log(`Next: ${plan.step}. ${plan.reason}`);
  console.log(`Operation: ${plan.operation}`);
  for (const [k, f] of Object.entries(files)) if (fs.existsSync(f)) console.log(`Wrote the ${k} batch: ${path.relative(process.cwd(), f)}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
