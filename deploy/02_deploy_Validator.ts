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
  const validator = await hre.upgrades.deployProxy(Validator, [], {
    initializer: "initialize",
    kind: "uups"
  });
  await validator.waitForDeployment();

  const validatorAddress = await validator.getAddress();
  console.log("Validator deployed to:", validatorAddress);

  // Setup initial roles and configuration
  const ADMIN_ROLE = await validator.ADMIN_ROLE();
  const REGISTRY_ADMIN_ROLE = await validator.REGISTRY_ADMIN_ROLE();
  const VALIDATOR_ROLE = await validator.VALIDATOR_ROLE();
  const OPERATOR_ROLE = await validator.OPERATOR_ROLE();

  // Grant roles to deployer
  await validator.grantRole(ADMIN_ROLE, deployer.address);
  await validator.grantRole(REGISTRY_ADMIN_ROLE, deployer.address);
  await validator.grantRole(VALIDATOR_ROLE, deployer.address);
  await validator.grantRole(OPERATOR_ROLE, deployer.address);
  console.log("Granted roles to deployer");

  // Set up asset types
  const assetTypes = [
    "RESIDENTIAL",
    "COMMERCIAL",
    "INDUSTRIAL",
    "LAND"
  ];

  for (const assetType of assetTypes) {
    await validator.setAssetTypeSupported(assetType, true);
    console.log(`Set asset type ${assetType} as supported`);
  }

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