import { saveDeployment, getDeployment } from "./helpers";
import { bondAbi } from "./bondModules";
import { earnControlsAt } from "./earnModules";

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

  // Phase 2f: the collection's functions run in two modules reached through its fallback; the
  // saved ABI is the joined one. BurnerBondDeposit's discount-curve path does not serve it (decision 8).
  const abi = await bondAbi();
  const collection = new ethers.Contract(collectionAddress, abi, (await ethers.getSigners())[0]);
  saveDeployment(network, "BurnerBond", collectionAddress, abi);

  // A collection replacing a pre-2f one (deploy 22, REPLACE_BOND_FACTORY) shares the BondVault and
  // the CollateralRegistry, which key a bond by its id alone: it must start above every id the
  // older collections issued, before its first sale. This replaces the retired
  // scripts/redeploy_bonds.ts.
  if ((await collection.totalBondsMinted()) === 0n) {
    const firstId = process.env.FIRST_BOND_ID;
    if (firstId) {
      await (await collection.setFirstBondId(BigInt(firstId))).wait();
      log(`  bond ids start at ${firstId}`);
    } else if (getDeployment(network, "BurnerBondPre2f") || getDeployment(network, "BurnerBondLegacy")) {
      throw new Error("An older collection is on record: set FIRST_BOND_ID above every id it issued before the first sale.");
    }
  }

  // The valuer. Deployed per collection, and pointed at by the registry so a pledged bond is
  // valued at what it is worth today rather than at a number somebody has to keep updating.
  let valuerAddress = getDeployment(network, "BondValuer")?.address;
  if (valuerAddress) {
    // A valuer recorded for an older collection is not this one's.
    const recorded = await ethers.getContractAt("BondValuer", valuerAddress);
    if ((await recorded.collection()).toLowerCase() !== collectionAddress.toLowerCase()) valuerAddress = undefined;
  }
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
  // enforces that itself because members self-custody: its sources (the registry among them) are
  // named below with the vault, in one co-signed call (`setSources`).
  // Rolling a pledged bond moves its pledge to the replacement, which the collection does in the
  // registry as it rolls. Without the role, every roll of a collection with an encumbrance source
  // reverts.
  const rollerRole = await registry.ITEM_ROLLER_ROLE();
  if (!(await registry.hasRole(rollerRole, collectionAddress))) {
    await (await registry.grantRole(rollerRole, collectionAddress)).wait();
    log("  CollateralRegistry ITEM_ROLLER_ROLE -> collection");
  }

  // ---- Phase 2f stage 2: the vault, the Earn controls and the Collateral Agent ----
  //
  // Order matters. Once the Collateral Agent is named on the BondVault, every role grant and
  // setting there is a change needing two treasury signers, the Agent's co-signature and 7 days
  // (IV-10 §4.5), so the vault's grants and the Earn timelock's admin come first.
  const bondVault = getDeployment(network, "BondVault");
  const controlsRecord = getDeployment(network, "EarnControls");
  const agentRecord = getDeployment(network, "CollateralAgent");
  const earnTimelock = getDeployment(network, "EarnTimelock")?.address;
  const resolution = process.env.EARN_RESOLUTION ?? "";
  if (bondVault) {
    const vault = await ethers.getContractAt("BondVault", bondVault.address);
    const agentNamed = (await vault.agent()) !== ethers.ZeroAddress;
    const bondRole = await vault.BOND_ROLE();
    if (!(await vault.hasRole(bondRole, collectionAddress))) {
      if (agentNamed) log("  ! BondVault BOND_ROLE -> collection needs a co-signed change (the Agent is named)");
      else {
        await (await vault.grantRole(bondRole, collectionAddress)).wait();
        log("  BondVault BOND_ROLE -> collection");
      }
    }
    // The vault refuses to pay an unpledged settlement on a bond still backing drawn credit.
    if (!agentNamed && (await vault.encumbranceSource()) !== registryRecord.address) {
      await (await vault.setEncumbranceSource(registryRecord.address, BOND)).wait();
      log("  BondVault encumbrance -> CollateralRegistry");
    }
    // Decision 2: the Earn timelock takes the vault before the Agent is named (earn_timelock_handover.ts).
    if (earnTimelock && !agentNamed && !(await vault.hasRole(ethers.ZeroHash, earnTimelock))) {
      await (await vault.grantRole(ethers.ZeroHash, earnTimelock)).wait();
      log("  BondVault DEFAULT_ADMIN_ROLE -> Earn timelock");
    }
    if (controlsRecord && agentRecord && !agentNamed) {
      await (await vault.setEarnSources(agentRecord.address, controlsRecord.address)).wait();
      log("  BondVault -> CollateralAgent and EarnControls (later changes are co-signed)");
    }
    if (controlsRecord && (await collection.bondVault()) === ethers.ZeroAddress) {
      await (await collection.setSources(bondVault.address, registryRecord.address, BOND, controlsRecord.address,
        agentRecord?.address ?? ethers.ZeroAddress)).wait();
      log("  BurnerBond -> BondVault, CollateralRegistry, EarnControls, CollateralAgent");
    }
  }

  // The Earn controls: the collection checks purchases and records exits (BOND_ROLE); the vault is
  // the reserve status, the reserve hook and the Funding Limit's bond book; the Ladder (decision 41:
  // terms of 12 to 36 months; IV-01 Schedule 2's illustration until the Lending Board sets it); and
  // the stage 2 roles, each granted with the Lending Board resolution.
  if (controlsRecord && bondVault) {
    const controls = await earnControlsAt(controlsRecord.address);
    const grant = async (role: string, who: string, label: string) => {
      if (!who || !ethers.isAddress(who) || (await controls.hasRole(role, who))) return;
      if (!/^0x[0-9a-fA-F]{64}$/.test(resolution)) {
        log(`  ! ${label} -> ${who}: set EARN_RESOLUTION (the Lending Board resolution hash)`);
        return;
      }
      await (await controls.grantRoleByResolution(role, who, resolution)).wait();
      log(`  EarnControls ${label} -> ${who}`);
    };
    await grant(await controls.BOND_ROLE(), collectionAddress, "BOND_ROLE");
    const list = (name: string) => (process.env[name] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    for (const who of list("ROLL_NOTICE_SIGNERS")) await grant(ethers.id("ROLL_NOTICE_ROLE"), who, "ROLL_NOTICE_ROLE");
    for (const who of list("WIND_DOWN_SIGNERS")) await grant(ethers.id("WIND_DOWN_ROLE"), who, "WIND_DOWN_ROLE");
    for (const who of list("FUNDING_SIGNERS")) await grant(await controls.FUNDING_ROLE(), who, "FUNDING_ROLE");
    for (const who of list("EXCLUDED_HOLDERS")) await grant(ethers.id("EXCLUDED_HOLDER_ROLE"), who, "EXCLUDED_HOLDER_ROLE");
    if ((await controls.reserveStatus()) !== bondVault.address) {
      await (await controls.setSources(await controls.membership(), await controls.yieldPool(), bondVault.address,
        agentRecord?.address ?? ethers.ZeroAddress, bondVault.address)).wait();
      log("  EarnControls reserve status and hook -> BondVault");
    }
    const books: string[] = await controls.bondBooks();
    if (!books.includes(bondVault.address)) {
      await (await controls.setBondBooks([...books, bondVault.address])).wait();
      log("  EarnControls bond books += BondVault");
    }
    const cfg = require("./config/earn-controls.json");
    for (const r of cfg.ladder ?? []) {
      if (!(await controls.isTermOffered(r.termDays))) {
        await (await controls.setRung(r.termDays, r.yieldBps, true)).wait();
        log(`  Ladder ${r.termDays} days at ${r.yieldBps / 100}%`);
      }
    }
  }

  // Decision 30: Required-Holder Directions, signed by the Holders and counted against the bond
  // register. No admin; the Agent takes it only through a co-signed `setHolderDirections`.
  if (bondVault && controlsRecord && agentRecord && !getDeployment(network, "HolderDirections")) {
    const D = await ethers.getContractFactory("HolderDirections");
    const d = await D.deploy(bondVault.address, agentRecord.address, controlsRecord.address);
    await d.waitForDeployment();
    saveDeployment(network, "HolderDirections", await d.getAddress(), JSON.parse(D.interface.formatJson()));
    log(`+ HolderDirections at ${await d.getAddress()}`);
    log("  ! Propose and co-sign CollateralAgent.setVault/setBondBook(BondVault) and setHolderDirections(HolderDirections)");
  }

  // No discount curve any more (decision 8, C7): a bond is priced from the Ladder's Issue Yield by
  // compounding (R4). The yield-below-carry invariant below still guards the Ladder.

  // Arm the invariant rather than trusting the tuning above to stay true. The calculator refuses
  // to grant capacity on a kind whose yield meets or exceeds the tier's carry, so a later retune
  // that crosses the line fails loudly instead of quietly minting free money.
  const limitsRecord = getDeployment(network, "LimitCalculator");
  if (limitsRecord) {
    const limits = await ethers.getContractAt("LimitCalculator", limitsRecord.address);
    const bondYieldPerCycle = BigInt(process.env.BOND_YIELD_BPS ?? 60);
    if ((await limits.collateralYieldOf(BOND)) !== bondYieldPerCycle) {
      await (await limits.setCollateralYield(BOND, bondYieldPerCycle)).wait();
      log(`  BOND yield -> ${bondYieldPerCycle} bps/cycle (tier charges 65)`);
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
