import { ethers } from "ethers";
import { ValidatorRegistry } from "../typechain-types";
import { saveDeployment } from "./helpers";

/**
 * Deploys the ValidatorRegistry contract
 * 
 * This contract:
 * - Manages validator registration and capabilities
 * - Integrates with FundManager for role management
 * - Handles asset type validation
 */
async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying to network:", network.name);

  // Deploy ValidatorRegistry as an upgradeable contract
  console.log("Deploying ValidatorRegistry...");
  const ValidatorRegistry = await hre.ethers.getContractFactory("ValidatorRegistry");
  const validatorRegistry = await hre.upgrades.deployProxy(ValidatorRegistry, [], {
    initializer: "initialize",
    kind: "uups"
  });
  await validatorRegistry.waitForDeployment();

  const validatorRegistryAddress = await validatorRegistry.getAddress();
  console.log("ValidatorRegistry deployed to:", validatorRegistryAddress);

  // ValidatorRegistry initializes REGISTRY_ADMIN_ROLE + DEFAULT_ADMIN_ROLE
  // for the deployer in initialize(), so no extra role wiring is required here.
  const REGISTRY_ADMIN_ROLE = await validatorRegistry.REGISTRY_ADMIN_ROLE();
  const hasRegistryAdmin = await validatorRegistry.hasRole(REGISTRY_ADMIN_ROLE, deployer.address);
  console.log("Deployer has REGISTRY_ADMIN_ROLE:", hasRegistryAdmin);

  // Save deployment information
  const validatorRegistryAbi = validatorRegistry.interface.formatJson();
  saveDeployment(
    network.name,
    "ValidatorRegistry",
    validatorRegistryAddress,
    validatorRegistryAbi
  );
  console.log("Deployment information saved for ValidatorRegistry");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
