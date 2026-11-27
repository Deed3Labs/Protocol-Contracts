import { ethers } from "ethers";
import { Validator } from "../typechain-types";
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

  // Get ValidatorRegistry and MetadataRenderer addresses from saved deployments
  const validatorRegistryDeployment = getDeployment(network.name, "ValidatorRegistry");
  const metadataRendererDeployment = getDeployment(network.name, "MetadataRenderer");
  
  if (!validatorRegistryDeployment || !metadataRendererDeployment) {
    throw new Error("Required contract deployments not found");
  }
  
  const validatorRegistryAddress = validatorRegistryDeployment.address;
  const metadataRendererAddress = metadataRendererDeployment.address;

  // Deploy Validator as an upgradeable contract
  console.log("Deploying Validator...");
  const Validator = await hre.ethers.getContractFactory("Validator");
  const agreementUri = process.env.DEED_AGREEMENT_URI || "https://api.example.com/agreements/";
  const validator = await hre.upgrades.deployProxy(Validator, ["https://api.example.com/validator/", agreementUri], {
    initializer: "initialize",
    kind: "uups"
  });
  await validator.waitForDeployment();

  const validatorAddress = await validator.getAddress();
  console.log("Validator deployed to:", validatorAddress);

  // initialize() gives the deployer every Validator role and ownership (handed over later with
  // deed_admin_handover.ts, audit D-13). Asset types get real validation criteria, not bare support,
  // and the default agreement is registered by name (audit D-22).
  for (const assetType of [0, 1, 2, 3]) {
    await (await validator.setupValidationCriteria(assetType)).wait();
    console.log(`Validation criteria set for asset type ${assetType}`);
  }
  await (await validator.registerOperatingAgreement(agreementUri, "Deed Trust Agreement")).wait();

  // Register validator in the registry
  const validatorRegistry = await hre.ethers.getContractAt("ValidatorRegistry", validatorRegistryAddress);
  await validatorRegistry.registerValidator(
    validatorAddress,
    "Default Validator",
    "A default validator for deployment",
    [0, 1, 2, 3]
  );
  console.log("Registered validator in ValidatorRegistry");

  // Update validator status
  await validatorRegistry.updateValidatorStatus(validatorAddress, true);
  console.log("Updated validator status to activated");

  // Save deployment information
  const validatorAbi = validator.interface.formatJson();
  saveDeployment(
    network.name,
    "Validator",
    validatorAddress,
    validatorAbi
  );
  console.log("Deployment information saved for Validator");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 