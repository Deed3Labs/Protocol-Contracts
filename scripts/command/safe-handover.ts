/**
 * Hands the contracts' admin from the deployer wallet to the Ops Safe (Phase 4c). Kai runs it, once
 * the Safe exists; nothing in Command does.
 *
 * Dry run (the default): reads every deployed contract and prints who holds each admin role and
 * owner() now, and exactly what a run would do. Needs no key.
 *
 *   SAFE_ADDRESS=0x… DEPLOYER=0x… npx hardhat run scripts/command/safe-handover.ts --network base-sepolia
 *
 * Run: grants each admin role to the Safe, transfers ownership, grants the Safe the operational roles
 * its own proposals need, then renounces each admin role from the deployer, refusing any the Safe
 * doesn't hold yet. Signed by the deployer's key in your own env. Rehearse it first on a fork:
 * scripts/command/drill_safe_handover.ts.
 *
 *   SAFE_ADDRESS=0x… MODE=run CONFIRM=handover npx hardhat run scripts/command/safe-handover.ts --network base-sepolia
 *
 * INCLUDE_ROLES=OPERATOR_ROLE,… also moves those operational roles (normally they stay put).
 */
import { ethers } from "hardhat";
import { getAddress, isAddress } from "ethers";
import { deployments, execute, plan, survey } from "./handover";

async function main() {
  const safe = process.env.SAFE_ADDRESS?.trim() ?? "";
  if (!isAddress(safe)) throw new Error("Set SAFE_ADDRESS to the Ops Safe.");
  const mode = (process.env.MODE ?? "dry").trim();
  const [signer] = await ethers.getSigners();
  const deployer = getAddress(process.env.DEPLOYER?.trim() || (await signer.getAddress()));
  const include = (process.env.INCLUDE_ROLES ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const code = await ethers.provider.getCode(safe);
  if (code === "0x") throw new Error(`${safe} has no code on this network: is that the Safe, and the right network?`);

  const list = deployments();
  console.log(`Safe      ${getAddress(safe)}\nDeployer  ${deployer}\nContracts ${list.length}\n`);
  const s = await survey(ethers.provider, list, deployer, safe, include);
  for (const c of s) {
    const held = c.roles.filter((r) => r.deployer || r.safe).map((r) => `${r.role}${r.admin ? "*" : ""}[${[r.deployer && "deployer", r.safe && "safe"].filter(Boolean).join("+")}]`);
    const own = c.owner ? `owner ${c.owner === deployer ? "deployer" : c.owner === getAddress(safe) ? "safe" : c.owner}${c.pendingOwner && c.pendingOwner !== ethers.ZeroAddress ? ` (pending ${c.pendingOwner})` : ""}` : "";
    console.log(`${c.name.padEnd(24)} ${[own, ...held].filter(Boolean).join("  ") || "nothing here held by the deployer or the Safe"}`);
  }
  const { steps, kept } = plan(s, deployer, safe);
  console.log(`\n* admin role\n\nPlan (${steps.length} steps):`);
  for (const st of steps) console.log(`  ${st.contract}: ${st.action}${st.role ? " " + st.role : ""}`);
  if (kept.length) console.log(`\nStays put:\n  ${kept.join("\n  ")}`);

  if (mode !== "run") return console.log("\nDry run: nothing was sent. MODE=run CONFIRM=handover to carry it out.");
  if (process.env.CONFIRM !== "handover") throw new Error("Set CONFIRM=handover to carry it out.");
  if (getAddress(await signer.getAddress()) !== deployer) throw new Error("The signer isn't the deployer: run it with the deployer's key.");
  console.log("\nRunning:");
  await execute(signer, list, steps, safe);
  const after = plan(await survey(ethers.provider, list, deployer, safe, include), deployer, safe);
  console.log(after.steps.filter((x) => !x.action.startsWith("acceptOwnership")).length ? `\nStill to do: ${after.steps.length} steps (run it again)` : "\nDone: the deployer holds no admin role.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
