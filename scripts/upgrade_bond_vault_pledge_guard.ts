import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of BondVault, same proxy address, so it refuses to pay a bond that is pledged and
 * backing drawn credit. A collection exempts burns from its own pledge check, so a holder could
 * redeem a matured bond still holding up their credit line; every redemption pays through
 * `settle`, which now asks the CollateralRegistry first. Then it names the registry and the BOND
 * kind as the vault's encumbrance source -- until that is set, nothing is checked.
 *
 * Two storage slots come from the gap (encumbranceSource, collateralKind). No other contract
 * changes.
 *
 *   npx hardhat run scripts/upgrade_bond_vault_pledge_guard.ts --network base-sepolia
 *
 * VAULT_UPGRADE_DRY_RUN=1 validates and reports without sending. Needs DEFAULT_ADMIN_ROLE on the
 * vault for the upgrade and OPERATOR_ROLE for the setting. Without admin -- the Ops Safe holds it
 * once admin has been handed over -- this deploys the implementation and prints both calls for
 * the Safe to make.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.VAULT_UPGRADE_DRY_RUN === "1";
const BOND = ethers.encodeBytes32String("BOND");

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const record = getDeployment(network, "BondVault");
  const registry = getDeployment(network, "CollateralRegistry");
  if (!record || !registry) throw new Error(`No BondVault or CollateralRegistry recorded for ${network}.`);
  console.log(`network             ${network} (${net.chainId})`);
  console.log(`signer              ${signer.address}`);
  console.log(`BondVault           ${record.address}`);
  console.log(`CollateralRegistry  ${registry.address}`);

  const BondVault = await ethers.getContractFactory("BondVault");
  await upgrades.validateUpgrade(record.address, BondVault, { kind: "uups" });
  console.log("validates as upgrade-safe against what is deployed");
  if (DRY_RUN) {
    console.log("\nVAULT_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const vault = await ethers.getContractAt("BondVault", record.address);
  const isAdmin: boolean = await vault.hasRole(await vault.DEFAULT_ADMIN_ROLE(), signer.address);
  if (!isAdmin) {
    const implementation = (await upgrades.prepareUpgrade(record.address, BondVault, { kind: "uups" })) as string;
    console.log("\nThe signer isn't BondVault's admin, so nothing was upgraded.");
    console.log(`new implementation  ${implementation}`);
    console.log("Have the admin (the Ops Safe) send, in order:");
    console.log(`  to ${record.address}  data ${BondVault.interface.encodeFunctionData("upgradeTo", [implementation])}`);
    console.log(`  to ${record.address}  data ${BondVault.interface.encodeFunctionData("setEncumbranceSource", [registry.address, BOND])}`);
    return;
  }

  const before = await implementationOf(record.address);
  console.log("\nupgrading BondVault…");
  const upgraded = await upgrades.upgradeProxy(record.address, BondVault, { kind: "uups" });
  await upgraded.waitForDeployment();
  saveDeployment(network, "BondVault", record.address, JSON.parse(upgraded.interface.formatJson()));
  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(record.address);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  if (implementation === before) throw new Error("BondVault still runs its old implementation.");
  console.log(`implementation      ${implementation}`);

  const live = await ethers.getContractAt("BondVault", record.address);
  if ((await live.encumbranceSource()) !== registry.address) {
    await (await live.setEncumbranceSource(registry.address, BOND)).wait();
  }
  console.log(`encumbranceSource   ${await live.encumbranceSource()}  kind ${ethers.decodeBytes32String(await live.collateralKind())}`);
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
