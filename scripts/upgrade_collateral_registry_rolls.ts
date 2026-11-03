import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of CollateralRegistry, same proxy address, adding `rollItem` and ITEM_ROLLER_ROLE: a
 * bond collection moves a pledge from a bond it rolls to the bond it issues in its place.
 *
 * Only a collection built from the fixed BurnerBond calls it. The collection on Base Sepolia today
 * is a clone of the old implementation and keeps behaving as it did -- a rolled bond's pledge still
 * lapses there -- because a clone's code is fixed and the factory's implementations are created in
 * its constructor. Getting the fix into a live collection means a new factory and a new collection;
 * this upgrade is the registry's half, and is harmless on its own. No storage changes.
 *
 *   npx hardhat run scripts/upgrade_collateral_registry_rolls.ts --network base-sepolia
 *
 * REGISTRY_UPGRADE_DRY_RUN=1 validates and reports without sending. The upgrade needs
 * DEFAULT_ADMIN_ROLE on CollateralRegistry. If the signer has it, this upgrades. If not -- the Ops
 * Safe holds it once admin has been handed over -- this deploys the implementation and prints the
 * call for the Safe to make. Granting ITEM_ROLLER_ROLE to a new collection is deploy/23's job.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.REGISTRY_UPGRADE_DRY_RUN === "1";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const record = getDeployment(network, "CollateralRegistry");
  if (!record) throw new Error(`No CollateralRegistry recorded for ${network}.`);
  console.log(`network             ${network} (${net.chainId})`);
  console.log(`signer              ${signer.address}`);
  console.log(`CollateralRegistry  ${record.address}`);

  const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
  await upgrades.validateUpgrade(record.address, CollateralRegistry, { kind: "uups" });
  console.log("validates as upgrade-safe against what is deployed");

  if (DRY_RUN) {
    console.log("\nREGISTRY_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const registry = await ethers.getContractAt("CollateralRegistry", record.address);
  const isAdmin: boolean = await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), signer.address);
  const before = await implementationOf(record.address);

  if (!isAdmin) {
    const implementation = (await upgrades.prepareUpgrade(record.address, CollateralRegistry, {
      kind: "uups",
    })) as string;
    const data = CollateralRegistry.interface.encodeFunctionData("upgradeTo", [implementation]);
    console.log("\nThe signer isn't CollateralRegistry's admin, so nothing was upgraded.");
    console.log(`new implementation  ${implementation}`);
    console.log("Have the admin (the Ops Safe) send:");
    console.log(`  to     ${record.address}`);
    console.log(`  value  0`);
    console.log(`  data   ${data}`);
    return;
  }

  console.log("\nupgrading CollateralRegistry…");
  const upgraded = await upgrades.upgradeProxy(record.address, CollateralRegistry, { kind: "uups" });
  await upgraded.waitForDeployment();
  saveDeployment(network, "CollateralRegistry", record.address, JSON.parse(upgraded.interface.formatJson()));

  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(record.address);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  if (implementation === before) throw new Error("CollateralRegistry still runs its old implementation.");
  console.log(`implementation      ${implementation}`);
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
