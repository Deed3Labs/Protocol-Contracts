import * as fs from "fs";
import * as path from "path";
/*
 * Decision 52 (owner, Nov 17, 2026): on a testnet, a link to a retired contract whose clearing change
 * is already scheduled in a timelock does not hold the apps back; it only waits out the delay.
 *
 * Today that is one link: the BondVault's `payoutPool` backstop, cleared by `BondVault.setBackstops(
 * treasury, 0)` in the Earn timelock batch the signing plan writes (step "E8-earn-schedule",
 * scripts/signing_plan.ts). This reads that step from the plan file, finds the setBackstops call in
 * it, and asks the Earn timelock whether exactly that batch is scheduled and not yet run.
 * Read-only: views only, sends nothing. No plan file, no such call, or no pending operation: null,
 * and the caller keeps the FAIL.
 */
const TIMELOCK_ABI = [
  "function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function hashOperationBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperationPending(bytes32 id) view returns (bool)",
  "function getTimestamp(bytes32 id) view returns (uint256)",
];
const SET_BACKSTOPS = "function setBackstops(address _treasury, address _payoutPool)";

export interface ScheduledClear {
  /** The Earn timelock operation that clears it. */
  operation: string;
  /** When it may run (the timelock's ready time). */
  readyAt: Date;
  /** The payoutPool the scheduled call sets (zero: none). */
  payoutPool: string;
}

export async function scheduledBackstopClear(o: {
  provider: any;
  /** deployments/<network>/signing-plan.json unless given. */
  planFile?: string;
  network?: string;
  bondVault: string;
  /** The Earn timelock record's address: the plan's step must target it. */
  earnTimelock: string;
  /** Addresses the scheduled payoutPool must not be (the retired contracts). */
  retired: string[];
}): Promise<ScheduledClear | null> {
  const { ethers } = require("ethers");
  const file = o.planFile ?? path.join("deployments", o.network ?? "", "signing-plan.json");
  if (!fs.existsSync(file)) return null;
  let plan: any;
  try {
    plan = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const step = (plan?.steps ?? []).find((s: any) => s?.id === "E8-earn-schedule");
  if (!step || typeof step.data !== "string" || typeof step.to !== "string") return null;
  if (step.to.toLowerCase() !== o.earnTimelock.toLowerCase()) return null;

  const tlIface = new ethers.Interface(TIMELOCK_ABI);
  let args: any;
  try {
    args = tlIface.decodeFunctionData("scheduleBatch", step.data);
  } catch {
    return null;
  }
  const [targets, values, payloads, predecessor, salt] = args as [string[], bigint[], string[], string, string];
  const bvIface = new ethers.Interface([SET_BACKSTOPS]);
  const selector = bvIface.getFunction("setBackstops")!.selector;
  let payoutPool: string | null = null;
  targets.forEach((t: string, i: number) => {
    if (payoutPool !== null || t.toLowerCase() !== o.bondVault.toLowerCase()) return;
    if (!String(payloads[i]).toLowerCase().startsWith(selector)) return;
    try {
      payoutPool = String(bvIface.decodeFunctionData("setBackstops", payloads[i])[1]);
    } catch {
      /* not decodable: not ours */
    }
  });
  if (payoutPool === null) return null;
  if (o.retired.some((r) => r.toLowerCase() === String(payoutPool).toLowerCase())) return null;

  const tl = new ethers.Contract(o.earnTimelock, TIMELOCK_ABI, o.provider);
  const id: string = await tl.hashOperationBatch([...targets], [...values], [...payloads], predecessor, salt);
  if (!(await tl.isOperationPending(id))) return null;
  const ts = BigInt(await tl.getTimestamp(id));
  return { operation: id, readyAt: new Date(Number(ts) * 1000), payoutPool };
}
