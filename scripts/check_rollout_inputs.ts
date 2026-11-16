import * as path from "path";
import { assuranceSetupFromEnv, assuranceSetupProblems, ASSURANCE_SETUP_ENV } from "../deploy/assurance_timelock_handover";

/*
 * Preflight for the Base Sepolia rollout (docs/audit/SEPOLIA-RUN-HANDOFF.md): are the Clear Lending
 * Safe split and the Assurance Pool's inputs in deploy/config/base-sepolia.rollout.env filled in, and
 * does the chain show what they should be? READ-ONLY: views and eth_getCode only, no key, sends nothing.
 *
 *   npx hardhat run scripts/check_rollout_inputs.ts --network base-sepolia
 *
 * Inputs: the rollout env file (ROLLOUT_ENV=<file> for another), then the process environment (it wins).
 * Exits 1 on any FAIL. Checks:
 *   - every input below is set and an address (nothing falls back to the Clear Treasury Safe);
 *   - the Clear Lending Safe is a contract that needs two signatures or more, and is not the Clear
 *     Financial Safe;
 *   - CL Operating (CLEAR_LENDING_ACCOUNT = LENDER_OPERATING = ASSURANCE_DRAW_ADDRESS) and CL Loss
 *     Reserve (ASSURANCE_LOSS_RESERVE) are contracts, one signature, owned only by the Clear Lending Safe;
 *   - the two CDP wallets (ASSURANCE_CL_FEES_PAYER, ASSURANCE_DISBURSEMENT) are plain accounts;
 *   - nothing the Assurance Pool would refuse (a payer or Lending Co. address that is a signer, a payer
 *     that is the draw address, two of the five the same).
 */

export const ROLLOUT_INPUTS = [
  "CLEAR_FINANCIAL_SAFE", "BOARD_SAFE", "COOP_TREASURY",
  "CLEAR_LENDING_SAFE", "CLEAR_LENDING_ACCOUNT", "LENDER_OPERATING",
  ...Object.values(ASSURANCE_SETUP_ENV).filter((k) => k !== "COOP_TREASURY"),
];

const SAFE_ABI = ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)", "function VERSION() view returns (string)"];

export interface InputCheck {
  status: "PASS" | "FAIL" | "WARN";
  what: string;
}

export async function checkRolloutInputs(env: Record<string, string | undefined>, provider: any): Promise<InputCheck[]> {
  const { ethers } = require("ethers");
  const out: InputCheck[] = [];
  const push = (status: InputCheck["status"], what: string) => out.push({ status, what });
  const val = (k: string) => env[k]?.trim() ?? "";
  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

  for (const k of ROLLOUT_INPUTS) {
    if (!val(k)) push("FAIL", `${k} is empty: owner to fill in deploy/config/base-sepolia.rollout.env`);
    else if (!ethers.isAddress(val(k))) push("FAIL", `${k} is not an address: ${val(k)}`);
    else push("PASS", `${k} is set: ${ethers.getAddress(val(k))}`);
  }
  const signers = (env.ASSURANCE_SIGNERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (signers.length < 2 || !signers.every((x) => ethers.isAddress(x))) push("FAIL", "ASSURANCE_SIGNERS must list two addresses");
  const a = (k: string) => (ethers.isAddress(val(k)) ? ethers.getAddress(val(k)) : undefined);

  const operating = a("CLEAR_LENDING_ACCOUNT");
  for (const k of ["LENDER_OPERATING", "ASSURANCE_DRAW_ADDRESS"]) {
    if (a(k) && operating) push(same(a(k), operating) ? "PASS" : "FAIL", `${k} is CL Operating (CLEAR_LENDING_ACCOUNT)${same(a(k), operating) ? "" : `: it is ${a(k)}, not ${operating}`}`);
  }
  const lending = a("CLEAR_LENDING_SAFE");
  if (lending && a("CLEAR_FINANCIAL_SAFE")) {
    push(same(lending, a("CLEAR_FINANCIAL_SAFE")) ? "FAIL" : "PASS", "CLEAR_LENDING_SAFE is its own Safe, not the Clear Financial (Treasury) Safe");
  }

  const safeInfo = async (address: string) => {
    if ((await provider.getCode(address)) === "0x") return undefined;
    const s = new ethers.Contract(address, SAFE_ABI, provider);
    const owners: string[] = (await s.getOwners()).map((o: string) => ethers.getAddress(o));
    const threshold = Number(await s.getThreshold());
    const version: string = await s.VERSION().catch(() => "?");
    return { owners, threshold, version };
  };
  if (lending) {
    try {
      const s = await safeInfo(lending);
      if (!s) push("FAIL", `the Clear Lending Safe ${lending} has no code on this chain`);
      else push(s.threshold >= 2 ? "PASS" : "FAIL", `the Clear Lending Safe ${lending} (Safe ${s.version}) needs ${s.threshold} of ${s.owners.length} (${s.owners.join(", ")}): two or more wanted`);
    } catch (e: any) {
      push("FAIL", `the Clear Lending Safe ${lending} does not answer as a Safe: ${String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]}`);
    }
  }
  for (const [what, k] of [["CL Operating", "CLEAR_LENDING_ACCOUNT"], ["CL Loss Reserve", "ASSURANCE_LOSS_RESERVE"]]) {
    const address = a(k);
    if (!address) continue;
    try {
      const s = await safeInfo(address);
      if (!s) push("FAIL", `${what} (${k}) ${address} has no code on this chain`);
      else {
        const ok = s.threshold === 1 && s.owners.length === 1 && same(s.owners[0], lending);
        push(ok ? "PASS" : "FAIL", `${what} (${k}) ${address} (Safe ${s.version}): ${s.threshold} of ${s.owners.length}, owners ${s.owners.join(", ")}; wanted 1 of 1, owned by the Clear Lending Safe`);
      }
    } catch (e: any) {
      push("FAIL", `${what} (${k}) ${address} does not answer as a Safe: ${String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]}`);
    }
  }
  for (const [what, k] of [["CL fees payer", "ASSURANCE_CL_FEES_PAYER"], ["Assurance disbursement", "ASSURANCE_DISBURSEMENT"]]) {
    const address = a(k);
    if (!address) continue;
    const code: string = await provider.getCode(address);
    // A plain account, or one with an EIP-7702 delegation (code 0xef0100…), as a CDP wallet may be.
    if (code === "0x" || code.toLowerCase().startsWith("0xef0100")) push("PASS", `${what} (${k}) ${address} is a plain account (a CDP wallet)`);
    else push("WARN", `${what} (${k}) ${address} has contract code: a CDP wallet was expected`);
  }

  try {
    const setup = assuranceSetupFromEnv(env);
    const problems = assuranceSetupProblems(setup, signers.filter((x) => ethers.isAddress(x)));
    for (const p of problems) push("FAIL", `Assurance Pool: ${p}`);
    if (!problems.length) push("PASS", "Assurance Pool: no input the pool would refuse, and the five addresses differ");
  } catch {
    // The empty ones are listed above.
  }
  return out;
}

async function main() {
  const hre = require("hardhat");
  const { loadPlanEnv } = require("./signing_plan");
  const env = loadPlanEnv();
  // A plain JSON-RPC reader, never the network's accounts: this needs no key.
  const url: string | undefined = hre.network.config.url;
  const provider = url ? new hre.ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 }) : hre.ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  if (![84532, 31337].includes(chainId)) throw new Error(`Refusing: this preflight is for Base Sepolia (84532) or its fork; ${hre.network.name} is chain ${chainId}.`);
  console.log(`Rollout inputs preflight on ${hre.network.name} (chain ${chainId}), from ${process.env.ROLLOUT_ENV || path.join("deploy", "config", "base-sepolia.rollout.env")}. Sends nothing.\n`);
  const results = await checkRolloutInputs(env, provider);
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.what}`);
  const fails = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${results.filter((r) => r.status === "PASS").length} PASS, ${fails} FAIL, ${results.filter((r) => r.status === "WARN").length} WARN.`);
  if (fails) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
