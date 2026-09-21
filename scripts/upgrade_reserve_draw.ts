import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of AssurancePool and PayoutPool, same proxy addresses, for the draw: finding the
 * money for a claim whose turn has come and whose terms have run out.
 *
 * The reserve first, because the pool calls it. Upgrading the pool first would leave
 * `drawForDueClaim` calling a method the reserve does not have -- though only for a claim already
 * past its terms, and only once somebody has named the reserve as a lender, so the window is
 * narrow rather than dangerous. The order costs nothing and removes it.
 *
 * Nothing draws on anybody until the configuration below is done, so each intermediate state
 * behaves exactly as today.
 *
 *   npx hardhat run scripts/upgrade_reserve_draw.ts --network base-sepolia
 *
 * Add --dry-run (as RESERVE_DRAW_UPGRADE_DRY_RUN=1) to validate and report without sending.
 * Needs operator on the AssurancePool and DEFAULT_ADMIN_ROLE on the PayoutPool and LendingPool.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.RESERVE_DRAW_UPGRADE_DRY_RUN === "1";
const CONFIGURE = process.env.RESERVE_DRAW_CONFIGURE !== "0";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const reserve = getDeployment(network, "AssurancePool");
  const pool = getDeployment(network, "PayoutPool");
  const lending = getDeployment(network, "LendingPool");
  if (!reserve || !pool) throw new Error(`Missing a deployment record for ${network}.`);

  console.log(`network        ${network} (${net.chainId})`);
  console.log(`signer         ${signer.address}`);
  console.log(`AssurancePool  ${reserve.address}`);
  console.log(`PayoutPool     ${pool.address}`);
  console.log(`LendingPool    ${lending?.address ?? "not deployed — the yield half stays unset"}`);

  const AssurancePool = await ethers.getContractFactory("AssurancePool");
  const PayoutPool = await ethers.getContractFactory("PayoutPool");
  await upgrades.validateUpgrade(reserve.address, AssurancePool, { kind: "uups" });
  await upgrades.validateUpgrade(pool.address, PayoutPool, { kind: "uups" });
  console.log("both validate as upgrade-safe against what is deployed");

  if (DRY_RUN) {
    console.log("\nRESERVE_DRAW_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const was = {
    reserve: await implementationOf(reserve.address),
    pool: await implementationOf(pool.address),
  };

  console.log("\nupgrading AssurancePool…");
  const r = await upgrades.upgradeProxy(reserve.address, AssurancePool, { kind: "uups" });
  await r.waitForDeployment();
  saveDeployment(network, "AssurancePool", reserve.address, JSON.parse(r.interface.formatJson()));

  console.log("upgrading PayoutPool…");
  const p = await upgrades.upgradeProxy(pool.address, PayoutPool, { kind: "uups" });
  await p.waitForDeployment();
  saveDeployment(network, "PayoutPool", pool.address, JSON.parse(p.interface.formatJson()));

  console.log("");
  await confirm("AssurancePool", reserve.address, "lendToPayoutPool(uint256)", was.reserve);
  await confirm("PayoutPool", pool.address, "drawForDueClaim()", was.pool);

  if (!CONFIGURE) {
    console.log("\nRESERVE_DRAW_CONFIGURE=0: upgraded, nothing wired. Nothing draws on anybody.");
    return;
  }

  /*
   * Three wires, and a due claim waits on all of them. Unset, the pool draws on nobody and the
   * behaviour is exactly what it was.
   */
  console.log("\nwiring…");
  const reserveContract = await ethers.getContractAt(
    ["function payoutPool() view returns (address)", "function setPayoutPool(address) external"],
    reserve.address,
  );
  if ((await reserveContract.payoutPool()).toLowerCase() !== pool.address.toLowerCase()) {
    await (await reserveContract.getFunction("setPayoutPool")(pool.address)).wait(1);
    console.log("  reserve lends to the pool");
  }

  const poolContract = await ethers.getContractAt(
    [
      "function yieldPool() view returns (address)",
      "function reserve() view returns (address)",
      "function setLenders(address,address) external",
    ],
    pool.address,
  );
  const yieldAddress = lending?.address ?? ethers.ZeroAddress;
  if ((await poolContract.reserve()).toLowerCase() !== reserve.address.toLowerCase()) {
    await (await poolContract.getFunction("setLenders")(yieldAddress, reserve.address)).wait(1);
    console.log("  pool draws on the yield pool, then the reserve");
  }

  if (lending) {
    const lendingContract = await ethers.getContractAt(
      [
        "function BORROWER_ROLE() view returns (bytes32)",
        "function hasRole(bytes32,address) view returns (bool)",
        "function grantRole(bytes32,address) external",
      ],
      lending.address,
    );
    const role = await lendingContract.BORROWER_ROLE();
    if (!(await lendingContract.hasRole(role, pool.address))) {
      await (await lendingContract.getFunction("grantRole")(role, pool.address)).wait(1);
      console.log("  pool may borrow from the yield pool");
    }
  }
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

/** Confirm against the chain, waiting for it to agree with itself. */
async function confirm(label: string, proxy: string, signature: string, before: string) {
  const selector = ethers.id(signature).slice(2, 10);
  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(proxy);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  const code = await ethers.provider.getCode(implementation);
  const present = code.includes(selector);
  console.log(`${label.padEnd(14)} implementation ${implementation}${implementation === before ? "  (unchanged)" : ""}`);
  console.log(`${"".padEnd(14)} ${signature.split("(")[0]} in deployed code: ${present}`);
  if (!present) throw new Error(`${label} at ${proxy} does not carry ${signature} after the upgrade.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
