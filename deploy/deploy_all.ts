import { ethers } from "ethers";
import { saveDeployment } from "./helpers";
import { handOverDeedAdmin } from "./deed_admin_handover";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Deploys and wires the whole Deed track:
 * 1. ValidatorRegistry   2. MetadataRenderer   3. Validator   4. DeedNFT   5. FundManager
 * 6. Subdivide   7. FractionTokenFactory + Fractionalize   8. admin handover
 *
 * Environment:
 * - DEED_ADMIN (required on every network except hardhat/localhost): the address that receives every
 *   admin, upgrade and settings power. Use the Deed TimelockController whose proposer is the Foundation
 *   multisig Safe (7-day delay, DECISIONS #10). The deployer renounces everything (audit D-13).
 * - DEED_MINTER (optional): DeedNFT MINTER_ROLE holder; defaults to DEED_ADMIN.
 * - DEED_VALIDATOR_SIGNER (optional): VALIDATOR_ROLE inside the default Validator (validates and corrects
 *   the deeds that name it); defaults to DEED_ADMIN.
 * - DEED_FEE_TOKEN + DEED_SERVICE_FEE (optional): wire FundManager into DeedNFT with this mint fee. Without
 *   them DeedNFT mints charge no fee (setting a FundManager makes every mint require a fee).
 * - DEED_AGREEMENT_URI (optional): default operating agreement base, registered by name.
 *
 * Trust agreement v5 (Phase 3):
 * - FOUNDATION_SAFE: the Foundation multisig. When DEED_ADMIN is not set, a Deed TimelockController
 *   (OpenZeppelin's, unmodified) is deployed with this Safe as proposer and executor and a 7-day minimum
 *   delay, and becomes DEED_ADMIN (DECISIONS #8, #10). The Safe also gets the Functional Contract registry's
 *   REMOVER_ROLE (immediate removals). On a live network DEED_ADMIN must be a timelock with >= 7 days.
 * - DEED_TIMELOCK_DELAY (optional, seconds): the timelock's minimum delay; never below 7 days.
 * - DEED_AGREEMENT_V5_HASH + DEED_AGREEMENT_V5_URI (optional): adopt the trust agreement version for Land
 *   and Estate on the default validator.
 * - MEMBERSHIP_REGISTRY (optional): the MembershipRegistry the Verified policy reads. Set once; if left out,
 *   the admin (timelock) can set it later with setTrustRegistries, once.
 * - SEAPORT_CONDUIT (optional, item 11, only if partnering with Fabrica): approved as a marketplace.
 * DeedNFT is deployed with its two extensions (DeedNFTMintExtension, DeedTrustExtension) as constructor
 * arguments, plus the FunctionalContractRegistry (Subdivide, Fractionalize, CoopTransferAgent registered)
 * and the CoopTransferAgent. The saved DeedNFT ABI includes IDeedTrust, which its fallback serves.
 *
 * Audit D-22: this script used to leave every role with the deployer, never approve Fractionalize as a
 * marketplace, never wire FundManager, never make the Validator compatible with Subdivide, and switch on
 * all four asset types with no validation criteria (so every deed passed validateDeed).
 */
async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  // Decide "local" from Hardhat's network name, never from the chain's reported name ("unknown" for any custom chain)
  const local = hre.network.name === "hardhat" || hre.network.name === "localhost";
  console.log("Deploying contracts with the account:", deployer.address, "to", network.name);

  const SEVEN_DAYS = 7 * 24 * 60 * 60;
  const foundationSafe = process.env.FOUNDATION_SAFE;
  if (foundationSafe && !ethers.isAddress(foundationSafe)) throw new Error("FOUNDATION_SAFE is not an address");
  let adminEnv = process.env.DEED_ADMIN;
  if (!adminEnv && !foundationSafe && !local) {
    throw new Error("Set FOUNDATION_SAFE (a Deed timelock is deployed for it) or DEED_ADMIN (an existing Deed timelock); refusing to leave the deployer as admin");
  }
  if (adminEnv && !ethers.isAddress(adminEnv)) throw new Error("DEED_ADMIN is not an address");
  if (!adminEnv && foundationSafe) {
    const delay = Number(process.env.DEED_TIMELOCK_DELAY || SEVEN_DAYS);
    if (delay < SEVEN_DAYS) throw new Error("DEED_TIMELOCK_DELAY must be at least 7 days (DECISIONS #10)");
    const TL = await hre.ethers.getContractFactory("TimelockController");
    // Proposer and executor: the Foundation Safe. Admin: none (the timelock administers itself).
    const timelock = await TL.deploy(delay, [foundationSafe], [foundationSafe], ethers.ZeroAddress);
    await timelock.waitForDeployment();
    adminEnv = await timelock.getAddress();
    console.log(`Deed TimelockController deployed to: ${adminEnv} (min delay ${delay}s, proposer ${foundationSafe})`);
    saveDeployment(network.name, "DeedTimelock", adminEnv, timelock.interface.formatJson());
  }
  const agreementUri = process.env.DEED_AGREEMENT_URI || "https://api.example.com/agreements/";

  const initialBalance = await hre.ethers.provider.getBalance(deployer.address);
  const deploy = async (name: string, args: any[]) => {
    const F = await hre.ethers.getContractFactory(name);
    const c = await hre.upgrades.deployProxy(F, args, { initializer: "initialize", kind: "uups" });
    await c.waitForDeployment();
    const addr = await c.getAddress();
    console.log(`${name} deployed to: ${addr}`);
    saveDeployment(network.name, name, addr, c.interface.formatJson());
    return c;
  };
  const send = async (label: string, txp: Promise<any>) => {
    const tx = await txp;
    await tx.wait();
    console.log(`  ${label}`);
  };

  // 1-3. Registry, renderer, validator
  const validatorRegistry = await deploy("ValidatorRegistry", []);
  const metadataRenderer = await deploy("MetadataRenderer", []);
  const validator = await deploy("Validator", ["https://api.example.com/validator/", agreementUri]);

  // 4. DeedNFT, with its two delegatecall extensions as constructor arguments (EIP-3860 caps init code, so
  //    DeedNFT cannot create them itself). Each checks in as the right kind in DeedNFT's constructor.
  const mintExt = await (await hre.ethers.getContractFactory("DeedNFTMintExtension")).deploy();
  const trustExt = await (await hre.ethers.getContractFactory("DeedTrustExtension")).deploy();
  await mintExt.waitForDeployment();
  await trustExt.waitForDeployment();
  const deedNFT = await hre.upgrades.deployProxy(
    await hre.ethers.getContractFactory("DeedNFT"),
    [await validator.getAddress(), await validatorRegistry.getAddress()],
    {
      initializer: "initialize",
      kind: "uups",
      constructorArgs: [await mintExt.getAddress(), await trustExt.getAddress()],
      unsafeAllow: ["constructor", "delegatecall", "state-variable-immutable"],
    }
  );
  await deedNFT.waitForDeployment();
  const deedAddr = await deedNFT.getAddress();
  const trust = await hre.ethers.getContractAt("IDeedTrust", deedAddr);
  console.log(`DeedNFT deployed to: ${deedAddr} (mint extension ${await mintExt.getAddress()}, trust extension ${await trustExt.getAddress()})`);
  saveDeployment(network.name, "DeedNFT", deedAddr, [
    ...JSON.parse(deedNFT.interface.formatJson()),
    ...JSON.parse(trust.interface.formatJson()),
  ]);
  await send("registry -> DeedNFT", validatorRegistry.setDeedNFT(deedAddr));
  await send("validator -> DeedNFT", validator.setDeedNFT(deedAddr));
  await send("renderer -> DeedNFT", metadataRenderer.setDeedNFT(deedAddr));
  await send("DeedNFT -> renderer", deedNFT.setMetadataRenderer(await metadataRenderer.getAddress()));

  const images = {
    land: "ipfs://bafkreihdwdcbvm3ph3hg4bxplmyqhybmuwgiaroxnqmup76ixlqy4pf6gi",
    vehicle: "ipfs://bafkreig42cjzl6gn4w7q4sltmildfyh3m3wojrjp4egoqvfnxqcrmv5z3i",
    equipment: "ipfs://bafkreifo4ugpkguglxwalzrznhvip5gqvgzqyqcqvz2lecwubsu7t4qhyq",
    invalidated: "ipfs://bafkreiabag3ztnhe5pg7js4bj6sxuvkz3sdf34utvoyk7q7bhngrgxqxym",
  };
  await send("image Land", metadataRenderer.setAssetTypeImageURI(0, images.land));
  await send("image Vehicle", metadataRenderer.setAssetTypeImageURI(1, images.vehicle));
  await send("image Estate", metadataRenderer.setAssetTypeImageURI(2, images.land));
  await send("image Equipment", metadataRenderer.setAssetTypeImageURI(3, images.equipment));
  await send("image invalidated", metadataRenderer.setInvalidatedImageURI(images.invalidated));

  // 5. FundManager
  const fundManager = await deploy("FundManager", [await validatorRegistry.getAddress(), 500, deployer.address]);
  const fmAddr = await fundManager.getAddress();
  await send("registry -> FundManager", validatorRegistry.setFundManager(fmAddr));
  await send("FundManager accepts DeedNFT", fundManager.addCompatibleDeedNFT(deedAddr));
  await send("validator -> FundManager", validator.setFundManager(fmAddr));

  // Validator: real criteria per asset type (not bare support), and a registered agreement
  for (const t of [0, 1, 2, 3]) await send(`criteria for asset type ${t}`, validator.setupValidationCriteria(t));
  await send("register default agreement", validator.registerOperatingAgreement(agreementUri, "Deed Trust Agreement"));
  // v5: the trust agreement version, by content hash, for Land (0) and Estate (2) only
  const v5Hash = process.env.DEED_AGREEMENT_V5_HASH;
  const v5Uri = process.env.DEED_AGREEMENT_V5_URI;
  if (v5Hash && v5Uri) {
    for (const t of [0, 2]) {
      await send(`adopt trust agreement v5 for asset type ${t}`, validator.adoptAgreementVersion(t, v5Hash, v5Uri, "Deed Trust Agreement v5"));
    }
  } else {
    console.log("  DEED_AGREEMENT_V5_HASH/URI not set: no agreement version adopted; Land and Estate deeds cannot be minted yet");
  }

  // Register and activate the validator (activation grants it DeedNFT VALIDATOR_ROLE via the registry)
  const validatorAddr = await validator.getAddress();
  await send("register validator", validatorRegistry.registerValidator(validatorAddr, "Default Validator", "Default deed validator", [0, 1, 2, 3]));
  await send("activate validator", validatorRegistry.updateValidatorStatus(validatorAddr, true));

  // Mint fee: wiring FundManager into DeedNFT makes every mint require a fee, so only with one configured
  const feeToken = process.env.DEED_FEE_TOKEN;
  const serviceFee = process.env.DEED_SERVICE_FEE;
  if (feeToken && serviceFee) {
    await send("whitelist fee token", validator.addWhitelistedToken(feeToken));
    await send("set service fee", validator.setServiceFee(feeToken, BigInt(serviceFee)));
    await send("DeedNFT -> FundManager", deedNFT.setFundManager(fmAddr));
  } else {
    console.log("  DEED_FEE_TOKEN/DEED_SERVICE_FEE not set: DeedNFT mints charge no fee (FundManager not wired into DeedNFT)");
  }

  // 6. Subdivide (takes custody of parent deeds, so it must be an approved marketplace on DeedNFT)
  const subdivide = await deploy("Subdivide", [deedAddr, await validatorRegistry.getAddress()]);
  const subAddr = await subdivide.getAddress();
  await send("Subdivide VALIDATOR_ROLE -> validator", subdivide.grantRole(await subdivide.VALIDATOR_ROLE(), validatorAddr));
  await send("validator accepts Subdivide units", validator.addCompatibleDeedNFT(subAddr));
  await send("DeedNFT approves Subdivide (custody)", deedNFT.setApprovedMarketplace(subAddr, true));

  // 7. Fractionalize
  const FTF = await hre.ethers.getContractFactory("FractionTokenFactory");
  const fractionTokenFactory = await hre.upgrades.deployProxy(FTF, [deployer.address], { initializer: "initialize", kind: "uups" });
  await fractionTokenFactory.waitForDeployment();
  const ftfAddr = await fractionTokenFactory.getAddress();
  saveDeployment(network.name, "FractionTokenFactory", ftfAddr, fractionTokenFactory.interface.formatJson());
  console.log("FractionTokenFactory deployed to:", ftfAddr);
  const fractionalize = await deploy("Fractionalize", [deedAddr, subAddr, ftfAddr]);
  const frAddr = await fractionalize.getAddress();
  await send("factory -> Fractionalize", fractionTokenFactory.updateFractionalizeContract(frAddr));
  await send("DeedNFT approves Fractionalize (custody)", deedNFT.setApprovedMarketplace(frAddr, true));
  await send("Subdivide approves Fractionalize (custody)", subdivide.setApprovedMarketplace(frAddr, true));

  // 7b. Trust agreement v5: Functional Contract registry, Coop transfer agent, trust registries.
  //     The deployer registers the initial set, then the handover moves REGISTRAR_ROLE to the timelock.
  const FCR = await hre.ethers.getContractFactory("FunctionalContractRegistry");
  const functionalContractRegistry = await FCR.deploy(deployer.address, foundationSafe || deployer.address);
  await functionalContractRegistry.waitForDeployment();
  const fcrAddr = await functionalContractRegistry.getAddress();
  saveDeployment(network.name, "FunctionalContractRegistry", fcrAddr, functionalContractRegistry.interface.formatJson());
  const coopAgent = await (await hre.ethers.getContractFactory("CoopTransferAgent")).deploy(deedAddr);
  await coopAgent.waitForDeployment();
  const agentAddr = await coopAgent.getAddress();
  saveDeployment(network.name, "CoopTransferAgent", agentAddr, coopAgent.interface.formatJson());
  console.log(`FunctionalContractRegistry: ${fcrAddr}; CoopTransferAgent: ${agentAddr}`);
  await send("FC: Subdivide (custody)", functionalContractRegistry.register(subAddr, 1));
  await send("FC: Fractionalize (custody)", functionalContractRegistry.register(frAddr, 1));
  await send("FC: CoopTransferAgent (custody + Coop agent)", functionalContractRegistry.register(agentAddr, 3));
  const membershipRegistry = process.env.MEMBERSHIP_REGISTRY || ethers.ZeroAddress;
  if (!ethers.isAddress(membershipRegistry)) throw new Error("MEMBERSHIP_REGISTRY is not an address");
  await send("DeedNFT trust registries", trust.setTrustRegistries(fcrAddr, membershipRegistry));
  if (membershipRegistry === ethers.ZeroAddress) {
    console.log("  MEMBERSHIP_REGISTRY not set: Verified-policy deeds move only by (a)-(c) until the timelock sets it");
  }
  const conduit = process.env.SEAPORT_CONDUIT;
  if (conduit) await send("approve Seaport conduit (item 11)", deedNFT.setApprovedMarketplace(conduit, true));

  // 8. Handover: no single EOA keeps admin or upgrade power (audit D-13); on a live network the admin must
  //    be a timelock with at least the 7-day delay (trust agreement v5 item 6, DECISIONS #10).
  const contracts = {
    validatorRegistry, metadataRenderer, validator, deedNFT, fundManager, subdivide, fractionalize, fractionTokenFactory,
    functionalContractRegistry,
  };
  if (adminEnv) {
    console.log("\nHanding every Deed-track power to DEED_ADMIN:", adminEnv);
    await handOverDeedAdmin(contracts, deployer, {
      admin: adminEnv,
      minter: process.env.DEED_MINTER || undefined,
      validatorSigner: process.env.DEED_VALIDATOR_SIGNER || undefined,
      remover: foundationSafe || undefined,
      requireTimelockDelay: local ? undefined : SEVEN_DAYS,
      log: (m) => console.log("  " + m),
    });
    console.log("Handover complete; the deployer holds no Deed-track role or ownership.");
  } else {
    console.log("\nWARNING: local network and no DEED_ADMIN: the deployer keeps every role. Never do this on a live network.");
  }

  console.log("\nDeployment Summary:");
  for (const [name, c] of Object.entries(contracts)) console.log(`  ${name}: ${await (c as any).getAddress()}`);
  const finalBalance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Total gas spent:", ethers.formatEther(initialBalance - finalBalance), "ETH");

  if (process.env.SKIP_TS_ABIS === "true") return;
  try {
    const { stdout, stderr } = await execAsync("npx hardhat run deploy/99_generateTsAbis.ts");
    if (stderr) console.error("ABI generation warnings:", stderr);
    console.log("ABI generation output:", stdout);
  } catch (error) {
    console.error("Failed to generate TypeScript ABIs:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed!", error);
    process.exit(1);
  });
