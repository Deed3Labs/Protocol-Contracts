//.import { ethers } from "ethers";
import { DeedNFT } from "../typechain-types";
import { saveDeployment, getDeployment } from "./helpers";

async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying to network:", network.name);

  // Get required contract addresses from saved deployments
  const validatorRegistryDeployment = getDeployment(network.name, "ValidatorRegistry");
  const metadataRendererDeployment = getDeployment(network.name, "MetadataRenderer");
  const validatorDeployment = getDeployment(network.name, "Validator");
  
  if (!validatorRegistryDeployment || !metadataRendererDeployment || !validatorDeployment) {
    throw new Error("Required contract deployments not found");
  }
  
  const validatorRegistryAddress = validatorRegistryDeployment.address;
  const metadataRendererAddress = metadataRendererDeployment.address;
  const validatorAddress = validatorDeployment.address;

  // Deploy DeedNFT as an upgradeable contract. Trust agreement v5: its two delegatecall extensions are
  // deployed first and passed to the implementation's constructor (EIP-3860 caps init code, so DeedNFT
  // cannot create them itself). They are pinned as immutables: changing them is an upgrade.
  console.log("Deploying DeedNFT extensions...");
  const mintExt = await (await hre.ethers.getContractFactory("DeedNFTMintExtension")).deploy();
  const trustExt = await (await hre.ethers.getContractFactory("DeedTrustExtension")).deploy();
  await mintExt.waitForDeployment();
  await trustExt.waitForDeployment();
  console.log("Deploying DeedNFT...");
  const DeedNFT = await hre.ethers.getContractFactory("DeedNFT");
  const deedNFT = await hre.upgrades.deployProxy(DeedNFT, [validatorAddress, validatorRegistryAddress], {
    initializer: "initialize",
    kind: "uups",
    constructorArgs: [await mintExt.getAddress(), await trustExt.getAddress()],
    unsafeAllow: ["constructor", "delegatecall", "state-variable-immutable"],
  });
  await deedNFT.waitForDeployment();

  const deedNFTAddress = await deedNFT.getAddress();
  console.log("DeedNFT deployed to:", deedNFTAddress);

  // initialize() gives the deployer DEFAULT_ADMIN_ROLE and MINTER_ROLE only. There is no ADMIN_ROLE
  // (the old call reverted, audit D-22). The validator receives VALIDATOR_ROLE from the registry when
  // it is activated, and never MINTER_ROLE.

  // Wire registry, validator and renderer to this DeedNFT
  const validatorRegistry = await hre.ethers.getContractAt("ValidatorRegistry", validatorRegistryAddress);
  const validator = await hre.ethers.getContractAt("Validator", validatorAddress);
  const metadataRenderer = await hre.ethers.getContractAt("MetadataRenderer", metadataRendererAddress);
  await (await validatorRegistry.setDeedNFT(deedNFTAddress)).wait();
  await (await validator.setDeedNFT(deedNFTAddress)).wait();
  await (await metadataRenderer.setDeedNFT(deedNFTAddress)).wait();
  await (await deedNFT.setMetadataRenderer(metadataRendererAddress)).wait();
  // Re-sync the validator's DeedNFT role now that the registry knows the DeedNFT
  if (await validatorRegistry.isValidatorActive(validatorAddress)) {
    await (await validatorRegistry.updateValidatorStatus(validatorAddress, true)).wait();
  }
  console.log("Wired ValidatorRegistry, Validator and MetadataRenderer to DeedNFT");

  // Save deployment information. The ABI includes IDeedTrust, which DeedNFT's fallback serves.
  // The FunctionalContractRegistry, CoopTransferAgent, Deed timelock and setTrustRegistries are wired by
  // deploy_all.ts (Phase 3); this per-step script leaves them unset.
  const trust = await hre.ethers.getContractAt("IDeedTrust", deedNFTAddress);
  const deedNFTAbi = [...JSON.parse(deedNFT.interface.formatJson()), ...JSON.parse(trust.interface.formatJson())];
  saveDeployment(
    network.name,
    "DeedNFT",
    deedNFTAddress,
    deedNFTAbi
  );
  console.log("Deployment information saved for DeedNFT");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 