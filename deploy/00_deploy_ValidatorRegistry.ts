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

  // initialize() already gives the deployer DEFAULT_ADMIN_ROLE, REGISTRY_ADMIN_ROLE and ownership.
  // The registry has no VALIDATOR_ROLE or OPERATOR_ROLE (the old grants reverted, audit D-22).
  // Hand these to the Deed timelock/Safe with deed_admin_handover.ts once wiring is done (audit D-13).

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
