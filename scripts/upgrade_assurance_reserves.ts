import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of AssurancePool and ClearCredit, same proxy addresses, so the primary reserve can
 * hold what the pool has:
 *
 *  - AssurancePool gains `moveBufferToPrimary` (operator), and `depositRepayment`, which fills the
 *    primary reserve to the target RTD before the buffer. Its rebalance reprices without moving
 *    anything between tiers (it used to turn the whole pool into excess), and the public rebalance
 *    only ever tops the primary reserve up.
 *  - ClearCredit sends a repayment's remainder through `depositRepayment` instead of straight into
 *    the buffer.
 *
 * The pool first, because ClearCredit calls it: ClearCredit upgraded alone would call a method the
 * pool does not have, and every repayment that reached the reserve would revert.
 *
 *   npx hardhat run scripts/upgrade_assurance_reserves.ts --network base-sepolia
 *
 * ASSURANCE_UPGRADE_DRY_RUN=1 validates and reports without sending. MOVE_BUFFER_TO_PRIMARY moves
 * buffer into primary after the upgrade: an amount in the reserve token ("125.03"), or "all".
 * Needs the AssurancePool's owner, admin on the AccessManager (ClearCredit's upgrade authority)
 * and, to move the buffer, operator access.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.ASSURANCE_UPGRADE_DRY_RUN === "1";
const MOVE = process.env.MOVE_BUFFER_TO_PRIMARY?.trim() ?? "";

const POOL_ABI = [
  "function primaryBalance() view returns (uint256)",
  "function bufferBalance() view returns (uint256)",
  "function excessBalance() view returns (uint256)",
  "function reserveToken() view returns (address)",
  "function moveBufferToPrimary(uint256) external",
];

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const reserve = getDeployment(network, "AssurancePool");
  const credit = getDeployment(network, "ClearCredit");
  if (!reserve || !credit) throw new Error(`Missing a deployment record for ${network}.`);

  console.log(`network        ${network} (${net.chainId})`);
  console.log(`signer         ${signer.address}`);
  console.log(`AssurancePool  ${reserve.address}`);
  console.log(`ClearCredit    ${credit.address}`);

  const pool = await ethers.getContractAt(POOL_ABI, reserve.address);
  const decimals = Number(await (await ethers.getContractAt(["function decimals() view returns (uint8)"], await pool.reserveToken())).decimals());
  const tiers = async () =>
    `primary ${ethers.formatUnits(await pool.primaryBalance(), decimals)} · buffer ${ethers.formatUnits(await pool.bufferBalance(), decimals)} · excess ${ethers.formatUnits(await pool.excessBalance(), decimals)}`;
  console.log(`reserves       ${await tiers()}`);

  const AssurancePool = await ethers.getContractFactory("AssurancePool");
  const ClearCredit = await ethers.getContractFactory("ClearCredit");
  await upgrades.validateUpgrade(reserve.address, AssurancePool, { kind: "uups" });
  await upgrades.validateUpgrade(credit.address, ClearCredit, { kind: "uups" });
  console.log("both validate as upgrade-safe against what is deployed");

  if (DRY_RUN) {
    console.log("\nASSURANCE_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const was = { reserve: await implementationOf(reserve.address), credit: await implementationOf(credit.address) };

  console.log("\nupgrading AssurancePool…");
  const r = await upgrades.upgradeProxy(reserve.address, AssurancePool, { kind: "uups" });
  await r.waitForDeployment();
  saveDeployment(network, "AssurancePool", reserve.address, JSON.parse(r.interface.formatJson()));
  await confirm("AssurancePool", reserve.address, "depositRepayment(uint256)", was.reserve);

  console.log("upgrading ClearCredit…");
  const c = await upgrades.upgradeProxy(credit.address, ClearCredit, { kind: "uups" });
  await c.waitForDeployment();
  saveDeployment(network, "ClearCredit", credit.address, JSON.parse(c.interface.formatJson()));
  // ClearCredit only calls depositRepayment, and built with viaIR the selector isn't a plain run of
  // bytes in its code (it was not found in a correct upgrade), so it is confirmed by a new
  // implementation alone
  await confirm("ClearCredit", credit.address, null, was.credit);

  if (!MOVE) {
    console.log("\nMOVE_BUFFER_TO_PRIMARY unset: upgraded, the reserves stay where they are.");
    return;
  }
  const buffer = await pool.bufferBalance();
  const amount = MOVE === "all" ? buffer : ethers.parseUnits(MOVE, decimals);
  if (amount === 0n) {
    console.log("\nthe buffer is empty: nothing to move.");
    return;
  }
  console.log(`\nmoving ${ethers.formatUnits(amount, decimals)} from the buffer into primary…`);
  await (await pool.getFunction("moveBufferToPrimary")(amount)).wait(1);
  console.log(`reserves       ${await tiers()}`);
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

/** Confirm against the chain, waiting for it to agree with itself. */
async function confirm(label: string, proxy: string, signature: string | null, before: string) {
  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(proxy);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`${label.padEnd(14)} implementation ${implementation}${implementation === before ? "  (unchanged)" : ""}`);
  if (!signature) {
    if (implementation === before) throw new Error(`${label} at ${proxy} still runs its old implementation.`);
    return;
  }
  const present = (await ethers.provider.getCode(implementation)).includes(ethers.id(signature).slice(2, 10));
  console.log(`${"".padEnd(14)} ${signature.split("(")[0]} in deployed code: ${present}`);
  if (!present) throw new Error(`${label} at ${proxy} does not carry ${signature} after the upgrade.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
