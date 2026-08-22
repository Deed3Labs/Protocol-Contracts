import { saveDeployment, getDeployment } from "./helpers";

/**
 * A bond collection for one token, and the valuer that prices it.
 *
 * Collections are per-token because a bond is a claim denominated in something: a USDC bond and a
 * bond in some other reserve asset are different instruments with different redemption. The
 * factory clones one implementation per token rather than deploying the logic again.
 *
 * The valuer is per-collection for the same reason -- it reads one collection's present values --
 * and it is what makes a pledged bond's limit accrete. Without it the registry falls back to a
 * flat per-kind price, which is wrong about every bond that is not exactly average and wrong about
 * all of them tomorrow.
 *
 * Registers BOND as its own collateral kind at 95%: an internal claim on the co-op with known
 * redemption terms, so the cut is for the terms rather than for a market price.
 *
 *   npx hardhat run deploy/23_deploy_BondCollection.ts --network base-sepolia
 */
async function main() {
  const hre = require("hardhat");
  const { ethers } = hre;
  const network = (await ethers.provider.getNetwork()).name;
  const log = (m: string) => console.log(m);

  const factoryRecord = getDeployment(network, "BurnerBondFactory");
  if (!factoryRecord) throw new Error("No BurnerBondFactory. Run deploy/22 first.");
  const factory = await ethers.getContractAt("BurnerBondFactory", factoryRecord.address);

  const token = process.env.BOND_TOKEN ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const symbol = process.env.BOND_TOKEN_SYMBOL ?? "USDC";
  const name = process.env.BOND_TOKEN_NAME ?? "USD Coin";

  let collectionAddress = (await factory.getCollectionInfo(token)).collectionAddress;
  if (collectionAddress === ethers.ZeroAddress) {
    log(`Creating a ${symbol} bond collection…`);
    await (await factory.createCollection(token, symbol, name, process.env.BOND_BASE_URI ?? "ipfs://clear-bonds/")).wait();
    collectionAddress = (await factory.getCollectionInfo(token)).collectionAddress;
    log(`+ BurnerBond (${symbol}) at ${collectionAddress}`);
  } else {
    log(`= BurnerBond (${symbol}) already at ${collectionAddress}`);
  }

  const collection = await ethers.getContractAt("BurnerBond", collectionAddress);
  saveDeployment(network, "BurnerBond", collectionAddress, JSON.parse(collection.interface.formatJson()));

  const depositAddress = await factory.getUnifiedDepositContract();
  const deposit = await ethers.getContractAt("BurnerBondDeposit", depositAddress);
  saveDeployment(network, "BurnerBondDeposit", depositAddress, JSON.parse(deposit.interface.formatJson()));
  log(`= BurnerBondDeposit at ${depositAddress}`);

  // The valuer. Deployed per collection, and pointed at by the registry so a pledged bond is
  // valued at what it is worth today rather than at a number somebody has to keep updating.
  let valuerAddress = getDeployment(network, "BondValuer")?.address;
  if (!valuerAddress) {
    const BondValuer = await ethers.getContractFactory("BondValuer");
    const valuer = await BondValuer.deploy(collectionAddress);
    await valuer.waitForDeployment();
    valuerAddress = await valuer.getAddress();
    saveDeployment(network, "BondValuer", valuerAddress, JSON.parse(valuer.interface.formatJson()));
    log(`+ BondValuer at ${valuerAddress}`);
  } else {
    log(`= BondValuer already at ${valuerAddress}`);
  }

  log("\nWiring:");

  const registryRecord = getDeployment(network, "CollateralRegistry");
  if (!registryRecord) throw new Error("No CollateralRegistry. Run deploy/20 first.");
  const registry = await ethers.getContractAt("CollateralRegistry", registryRecord.address);

  const BOND = ethers.encodeBytes32String("BOND");
  const ASSET_INTERNAL_BACKING = 3;
  if (!(await registry.collateralTypes(BOND)).registered) {
    // Unit price zero on purpose: the valuer answers instead, and leaving a flat price behind it
    // means a misconfiguration reads as nothing pledged rather than as a plausible wrong number.
    await (await registry.registerCollateralType(BOND, ASSET_INTERNAL_BACKING, 9_500n, 0n)).wait();
    log("  collateral BOND at 95%");
  }
  if ((await registry.collateralTypes(BOND)).valuer !== valuerAddress) {
    await (await registry.setCollateralValuer(BOND, valuerAddress)).wait();
    log("  BOND valuer -> BondValuer");
  }

  // A pledged bond must not be able to walk away while credit is drawn on it, and the collection
  // enforces that itself because members self-custody.
  if ((await collection.encumbranceSource()) !== registryRecord.address) {
    await (await collection.setEncumbranceSource(registryRecord.address, BOND)).wait();
    log("  BurnerBond encumbrance -> CollateralRegistry");
  }

  const bondVault = getDeployment(network, "BondVault");
  if (bondVault) {
    const vault = await ethers.getContractAt("BondVault", bondVault.address);
    const bondRole = await vault.BOND_ROLE();
    for (const [label, who] of [["deposit", depositAddress], ["collection", collectionAddress]] as const) {
      if (!(await vault.hasRole(bondRole, who))) {
        await (await vault.grantRole(bondRole, who)).wait();
        log(`  BondVault BOND_ROLE -> ${label}`);
      }
    }
    // Proceeds land in the vault behind its redemption reserve, never in the AssurancePool.
    // Bondholders are creditors and must be senior to loss absorption.
    if ((await deposit.bondVault()) !== bondVault.address) {
      await (await deposit.setBondVault(bondVault.address)).wait();
      log("  BurnerBondDeposit -> BondVault");
    }
    if ((await collection.bondVault()) !== bondVault.address) {
      await (await collection.setBondVault(bondVault.address)).wait();
      log("  BurnerBond -> BondVault");
    }
  }

  log("\nBond collection ready. The asset-backed tier now has something behind it.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
