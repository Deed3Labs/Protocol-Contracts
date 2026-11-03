import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of LendingPool, same proxy address, so pledged shares can't be burned on the way
 * out. `withdraw`, `redeem` and `requestWithdrawal` all burn the holder's shares, and the pledge
 * check waved every burn through: a member could take shares backing drawn credit out as cash.
 * Now only a mint skips it. No storage changes; nothing else changes.
 *
 *   npx hardhat run scripts/upgrade_lending_pool_burn_lock.ts --network base-sepolia
 *
 * POOL_UPGRADE_DRY_RUN=1 validates and reports without sending. Needs DEFAULT_ADMIN_ROLE on the
 * pool; without it -- the Ops Safe holds it once admin has been handed over -- this deploys the
 * implementation and prints the call for the Safe to make.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.POOL_UPGRADE_DRY_RUN === "1";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();
  const record = getDeployment(network, "LendingPool");
  if (!record) throw new Error(`No LendingPool recorded for ${network}.`);
  console.log(`network      ${network} (${net.chainId})`);
  console.log(`signer       ${signer.address}`);
  console.log(`LendingPool  ${record.address}`);

  const LendingPool = await ethers.getContractFactory("LendingPool");
  await upgrades.validateUpgrade(record.address, LendingPool, { kind: "uups" });
  console.log("validates as upgrade-safe against what is deployed");
  if (DRY_RUN) {
    console.log("\nPOOL_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const pool = await ethers.getContractAt("LendingPool", record.address);
  if (!(await pool.hasRole(await pool.DEFAULT_ADMIN_ROLE(), signer.address))) {
    const implementation = (await upgrades.prepareUpgrade(record.address, LendingPool, { kind: "uups" })) as string;
    console.log("\nThe signer isn't LendingPool's admin, so nothing was upgraded.");
    console.log(`new implementation  ${implementation}`);
    console.log(`Have the admin (the Ops Safe) send to ${record.address}:`);
    console.log(`  data ${LendingPool.interface.encodeFunctionData("upgradeTo", [implementation])}`);
    return;
  }

  const before = await implementationOf(record.address);
  console.log("\nupgrading LendingPool…");
  const upgraded = await upgrades.upgradeProxy(record.address, LendingPool, { kind: "uups" });
  await upgraded.waitForDeployment();
  saveDeployment(network, "LendingPool", record.address, JSON.parse(upgraded.interface.formatJson()));
  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(record.address);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  if (implementation === before) throw new Error("LendingPool still runs its old implementation.");
  console.log(`implementation ${implementation}`);
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
