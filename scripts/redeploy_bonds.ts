import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * Replaces the bond factory and its USDC collection with ones built from the current source, and
 * moves everything that pointed at the old ones. BondVault, the money in it and the bonds already
 * sold stay where they are.
 *
 * Why a new factory: BurnerBond, BurnerBondDeposit, BondDiscountCurve and BondTraits are made in the
 * factory's constructor and cloned or deployed from there, so no fix to them reaches a collection
 * that already exists. This script does, in order:
 *
 *   1. upgrades CollateralRegistry for `rollItem` if it doesn't have it yet
 *   2. records the old factory, collection, deposit contract and valuer as *Legacy
 *   3. deploys the new factory, creates the USDC collection, and starts its bond ids at
 *      FIRST_BOND_ID (default 1001): BondVault and CollateralRegistry key a bond by id alone, so the
 *      new collection must never issue an id the old one has, or will by rolling
 *   4. points the new collection and deposit contract at BondVault, and grants them BOND_ROLE
 *   5. deploys a BondValuer for the new collection
 *   6. releases the old collection's bonds as collateral -- the BOND kind has one valuer, and it is
 *      about to value the new collection -- refusing if any of them is backing drawn credit
 *   7. points the BOND kind at the new valuer, and the new collection at the registry, with
 *      ITEM_ROLLER_ROLE so a rolled bond keeps its pledge
 *   8. stops the old collection selling: BOND_ROLE comes off its deposit contract, so a purchase
 *      there reverts at the vault. The old collection keeps its role, so its bonds still redeem and
 *      roll, paid from the same vault.
 *
 * Idempotent: every step checks before it sends.
 *
 *   npx hardhat run scripts/redeploy_bonds.ts --network base-sepolia
 *
 * Rehearse on a fork first -- nothing touches the real chain, no records are written, and the
 * deployer is impersonated -- and it finishes by buying a bond in the new collection:
 *
 *   FORK_RPC_URL=https://sepolia.base.org npx hardhat run scripts/redeploy_bonds.ts
 *
 * Needs the key that owns the old factory and holds DEFAULT_ADMIN_ROLE on BondVault and
 * CollateralRegistry (on Base Sepolia, still the deployer).
 */
const { ethers, upgrades, network } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const USDC = process.env.BOND_TOKEN ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_URI = process.env.BOND_BASE_URI ?? "ipfs://clear-bonds/";
const FIRST_BOND_ID = BigInt(process.env.FIRST_BOND_ID ?? "1001");
const BOND = ethers.encodeBytes32String("BOND");
const RECORDS = process.env.RECORDS_NETWORK ?? "base-sepolia";

async function main() {
  const fork = network.name === "hardhat";
  const recordsNet = fork ? RECORDS : network.name;
  const log = (m: string) => console.log(m);

  let signer = (await ethers.getSigners())[0];
  if (fork) {
    // Hardhat has no hardfork history for Base Sepolia, so it can't execute at the fork block
    // itself; one local block on top and everything runs there.
    await network.provider.send("evm_mine", []);
    const deployer = process.env.DEPLOYER ?? "0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA";
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [deployer] });
    await network.provider.request({ method: "hardhat_setBalance", params: [deployer, "0x56BC75E2D63100000"] });
    signer = await ethers.getSigner(deployer);
    log(`FORK of ${recordsNet}: impersonating ${deployer}; nothing is written.\n`);
  }
  const save = (name: string, address: string, abi: unknown) => {
    if (!fork) saveDeployment(recordsNet, name, address, abi);
  };
  const at = (name: string, address: string) => ethers.getContractAt(name, address, signer);
  const send = async (label: string, tx: Promise<{ wait: () => Promise<unknown> }>) => {
    await (await tx).wait();
    log(`  ${label}`);
  };

  const rec = (name: string) => getDeployment(recordsNet, name);
  const vaultRec = rec("BondVault");
  const registryRec = rec("CollateralRegistry");
  if (!vaultRec || !registryRec) throw new Error("No BondVault or CollateralRegistry on record.");
  const vault = await at("BondVault", vaultRec.address);
  const ADMIN = await vault.DEFAULT_ADMIN_ROLE();
  if (!(await vault.hasRole(ADMIN, signer.address))) throw new Error("The signer isn't BondVault's admin.");
  log(`signer ${signer.address}  ${ethers.formatEther(await ethers.provider.getBalance(signer.address))} ETH`);

  // 1. The registry has to know `rollItem` before a collection that calls it exists.
  const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry", signer);
  let registry = await at("CollateralRegistry", registryRec.address);
  const hasRollItem = await registry.ITEM_ROLLER_ROLE().then(() => true, () => false);
  if (!hasRollItem) {
    log("\n1. Upgrading CollateralRegistry for rollItem…");
    if (fork) {
      // A fork has no upgrade history to validate against, and `forceImport` with the new code
      // would record the OLD implementation as already being it -- the "upgrade" then changes
      // nothing. Deploy the implementation and point the proxy at it directly.
      const impl = await CollateralRegistry.deploy();
      await impl.waitForDeployment();
      await (await registry.upgradeTo(await impl.getAddress())).wait();
    } else {
      const upgraded = await upgrades.upgradeProxy(registryRec.address, CollateralRegistry, { kind: "uups" });
      await upgraded.waitForDeployment();
      save("CollateralRegistry", registryRec.address, JSON.parse(upgraded.interface.formatJson()));
    }
    registry = await at("CollateralRegistry", registryRec.address);
    // Whatever reported success, the proxy must now answer the new function.
    for (let i = 0; i < 20 && !(await registry.ITEM_ROLLER_ROLE().then(() => true, () => false)); i++) {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await registry.ITEM_ROLLER_ROLE();
    log("  upgraded");
  } else {
    log("\n1. CollateralRegistry already has rollItem");
  }

  // 2. The old ones, kept on record under their own names.
  log("\n2. Legacy records");
  const legacy = {
    factory: rec("BurnerBondFactoryLegacy") ?? rec("BurnerBondFactory"),
    collection: rec("BurnerBondLegacy") ?? rec("BurnerBond"),
    deposit: rec("BurnerBondDepositLegacy") ?? rec("BurnerBondDeposit"),
    valuer: rec("BondValuerLegacy") ?? rec("BondValuer"),
  };
  if (!legacy.factory || !legacy.collection || !legacy.deposit || !legacy.valuer) {
    throw new Error("The old factory, collection, deposit contract and valuer must all be on record.");
  }
  if (!rec("BurnerBondFactoryLegacy")) {
    save("BurnerBondFactoryLegacy", legacy.factory.address, legacy.factory.abi);
    save("BurnerBondLegacy", legacy.collection.address, legacy.collection.abi);
    save("BurnerBondDepositLegacy", legacy.deposit.address, legacy.deposit.abi);
    save("BondValuerLegacy", legacy.valuer.address, legacy.valuer.abi);
  }
  log(`  factory ${legacy.factory.address}  collection ${legacy.collection.address}`);

  // 3. The new factory and collection.
  log("\n3. New factory and collection");
  const current = rec("BurnerBondFactory");
  let factoryAddress = current && current.address !== legacy.factory.address ? current.address : null;
  if (!factoryAddress) {
    // Section 13: the factory gates collections on the TokenRegistry and takes no AssurancePool.
    const tokenRegistry = rec("TokenRegistry")!.address;
    const Factory = await ethers.getContractFactory("BurnerBondFactory", signer);
    const factory = await Factory.deploy(tokenRegistry, BASE_URI);
    await factory.waitForDeployment();
    factoryAddress = await factory.getAddress();
    save("BurnerBondFactory", factoryAddress, JSON.parse(factory.interface.formatJson()));
    log(`  + BurnerBondFactory ${factoryAddress}`);
  } else {
    log(`  = BurnerBondFactory ${factoryAddress}`);
  }
  const factory = await at("BurnerBondFactory", factoryAddress);
  let collectionAddress = (await factory.getCollectionInfo(USDC)).collectionAddress;
  if (collectionAddress === ethers.ZeroAddress) {
    await send("created the USDC collection", factory.createCollection(USDC, "USDC", "USD Coin", BASE_URI));
    collectionAddress = (await factory.getCollectionInfo(USDC)).collectionAddress;
  }
  const collection = await at("BurnerBond", collectionAddress);
  const depositAddress = await factory.getUnifiedDepositContract();
  const deposit = await at("BurnerBondDeposit", depositAddress);
  save("BurnerBond", collectionAddress, JSON.parse(collection.interface.formatJson()));
  save("BurnerBondDeposit", depositAddress, JSON.parse(deposit.interface.formatJson()));
  log(`  BurnerBond ${collectionAddress}\n  BurnerBondDeposit ${depositAddress}`);
  const [minted] = await collection.getBondStatistics();
  if (minted === 0n) await send(`bond ids start at ${FIRST_BOND_ID}`, collection.setFirstBondId(FIRST_BOND_ID));

  // 4. The vault.
  log("\n4. BondVault");
  if ((await collection.bondVault()) !== vaultRec.address) await send("collection -> BondVault", collection.setBondVault(vaultRec.address));
  if ((await deposit.bondVault()) !== vaultRec.address) await send("deposit -> BondVault", deposit.setBondVault(vaultRec.address));
  const BOND_ROLE = await vault.BOND_ROLE();
  for (const [label, who] of [["collection", collectionAddress], ["deposit", depositAddress]] as const) {
    if (!(await vault.hasRole(BOND_ROLE, who))) await send(`BOND_ROLE -> ${label}`, vault.grantRole(BOND_ROLE, who));
  }

  // 5. The valuer.
  log("\n5. BondValuer");
  let valuerAddress = rec("BondValuer")?.address;
  if (!valuerAddress || valuerAddress === legacy.valuer.address) {
    const Valuer = await ethers.getContractFactory("BondValuer", signer);
    const valuer = await Valuer.deploy(collectionAddress);
    await valuer.waitForDeployment();
    valuerAddress = await valuer.getAddress();
    save("BondValuer", valuerAddress, JSON.parse(valuer.interface.formatJson()));
    log(`  + BondValuer ${valuerAddress}`);
  }

  // 6. The old collection's bonds stop counting as collateral.
  log("\n6. Releasing the old collection's pledges");
  const oldCollection = await at("BurnerBond", legacy.collection.address);
  const [oldMinted] = await oldCollection.getBondStatistics();
  const lastOldId = oldMinted; // ids from 1; rolls add more, but none have happened while selling
  const holders = new Set<string>();
  for (let id = 1n; id <= lastOldId; id++) holders.add((await oldCollection.getBondInfo(id)).creator);
  for (const holder of holders) {
    for (const id of await registry.pledgedItemsOf(holder, BOND)) {
      if (id >= FIRST_BOND_ID) continue;
      if (await registry.isItemEncumbered(holder, BOND, id)) {
        throw new Error(`Bond ${id} of ${holder} is backing drawn credit; it can't be released. Stopping.`);
      }
      await send(`released bond ${id} of ${holder}`, registry.releaseItem(holder, BOND, id));
    }
  }

  // 7. The BOND kind and the new collection's pledges.
  log("\n7. Collateral");
  if ((await registry.collateralTypes(BOND)).valuer !== valuerAddress) {
    await send("BOND valuer -> new BondValuer", registry.setCollateralValuer(BOND, valuerAddress));
  }
  if ((await collection.encumbranceSource()) !== registryRec.address) {
    await send("collection encumbrance -> CollateralRegistry", collection.setEncumbranceSource(registryRec.address, BOND));
  }
  const ROLLER = await registry.ITEM_ROLLER_ROLE();
  if (!(await registry.hasRole(ROLLER, collectionAddress))) await send("ITEM_ROLLER_ROLE -> collection", registry.grantRole(ROLLER, collectionAddress));

  // 8. The old collection stops selling.
  log("\n8. Old collection");
  if (await vault.hasRole(BOND_ROLE, legacy.deposit.address)) {
    await send("BOND_ROLE off the old deposit contract (no more sales)", vault.revokeRole(BOND_ROLE, legacy.deposit.address));
  }
  const oldFactory = await at("BurnerBondFactory", legacy.factory.address);
  if ((await oldFactory.getCollectionInfo(USDC)).isActive) {
    await send("old collection marked inactive", oldFactory.deactivateCollection(USDC));
  }

  if (fork) await rehearse(signer, vault, deposit, collection, registry, legacy.deposit.address, lastOldId);
  log("\ndone");
}

/** On a fork: what the redeploy must leave true, checked by using it. */
async function rehearse(signer: any, vault: any, deposit: any, collection: any, registry: any, oldDeposit: string, lastOldId: bigint) {
  console.log("\nRehearsal checks");
  const usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", USDC, signer);
  // Somebody's USDC to buy with: the vault's own, moved to the deployer on the fork only.
  const vaultAddress = await vault.getAddress();
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [vaultAddress] });
  await network.provider.request({ method: "hardhat_setBalance", params: [vaultAddress, "0xDE0B6B3A7640000"] });
  const asVault = await ethers.getSigner(vaultAddress);
  await (await usdc.connect(asVault).transfer(signer.address, 200n * 10n ** 6n)).wait();

  const heldBefore = await vault.held();
  const face = 100n * 10n ** 6n;
  const maturity = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 400n * 86400n;
  const discount = await collection.calculateDiscount(maturity);
  await (await usdc.approve(await deposit.getAddress(), face)).wait();
  await (await deposit.makeDeposit(USDC, face, maturity, discount)).wait();
  const [minted] = await collection.getBondStatistics();
  const id = FIRST_BOND_ID;
  const check = (ok: boolean, what: string) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) process.exitCode = 1;
  };
  check(minted === 1n && (await collection.balanceOf(signer.address, id)) === 1n, `bought bond ${id} in the new collection`);
  check((await vault.obligations(id)).faceValue === face, "BondVault recorded it under its own id");
  check((await vault.held()) > heldBefore - 200n * 10n ** 6n, "proceeds landed in the same BondVault");
  for (let old = 1n; old <= lastOldId; old++) {
    check(!(await vault.obligations(old)).settled && (await vault.obligations(old)).faceValue > 0n, `old bond ${old} still owed by the vault`);
  }
  const old = await ethers.getContractAt("BurnerBondDeposit", oldDeposit, signer);
  await (await usdc.approve(oldDeposit, face)).wait();
  const oldSells = await old.makeDeposit(USDC, face, maturity, 0n).then(() => true, () => false);
  check(!oldSells, "the old deposit contract can no longer sell");
  // Re-review L-I: a pledge carries the member's EIP-712 signature. Here the signer is both the bond's
  // holder and the operator submitting it.
  const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3600n;
  const pledgeSignature = await signer.signTypedData(
    { name: "Clear CollateralRegistry", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await registry.getAddress() },
    { PledgeItem: [
      { name: "member", type: "address" }, { name: "kind", type: "bytes32" }, { name: "itemId", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    { member: signer.address, kind: BOND, itemId: id, nonce: await registry.pledgeNonces(signer.address), deadline }
  );
  await (await registry.pledgeItem(signer.address, BOND, id, deadline, pledgeSignature)).wait();
  check((await registry.collateralValueOf(signer.address, BOND)) > 0n, "a new bond pledges and is valued");
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
