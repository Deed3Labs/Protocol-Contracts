import { ethers } from "ethers";
import { Subdivide } from "../typechain-types";
import { saveDeployment, getDeployment } from "./helpers";

/**
 * Deploy script for Subdivide contract
 * 
 * Dependencies:
 * - DeedNFT (for parent deed validation and asset type inheritance)
 * - ValidatorRegistry (for validator management)
 * 
 * The Subdivide contract allows DeedNFT owners to create subdivisions
 * of their assets into multiple ERC1155 units with validation and trait management.
 */
async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying Subdivide contract with the account:", deployer.address);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying to network:", network.name);

  // Get required contract addresses from saved deployments
  const deedNFTDeployment = getDeployment(network.name, "DeedNFT");
  const validatorRegistryDeployment = getDeployment(network.name, "ValidatorRegistry");
  
  if (!deedNFTDeployment || !validatorRegistryDeployment) {
    throw new Error("Required contract deployments not found. Please deploy DeedNFT and ValidatorRegistry first.");
  }
  
  const deedNFTAddress = deedNFTDeployment.address;
  const validatorRegistryAddress = validatorRegistryDeployment.address;

  console.log("Using DeedNFT at:", deedNFTAddress);
  console.log("Using ValidatorRegistry at:", validatorRegistryAddress);

  // Deploy Subdivide as an upgradeable contract
  console.log("Deploying Subdivide...");
  const Subdivide = await hre.ethers.getContractFactory("Subdivide");
  const subdivide = await hre.upgrades.deployProxy(Subdivide, [deedNFTAddress, validatorRegistryAddress], {
    initializer: "initialize",
    kind: "uups",
    gasLimit: 5000000
  });
  await subdivide.waitForDeployment();

  const subdivideAddress = await subdivide.getAddress();
  console.log("Subdivide deployed to:", subdivideAddress);
  console.log("Transaction hash:", subdivide.deploymentTransaction()?.hash);

  // Setup initial roles
  const ADMIN_ROLE = await subdivide.ADMIN_ROLE();
  const VALIDATOR_ROLE = await subdivide.VALIDATOR_ROLE();

  // Grant roles to deployer with retry logic
  try {
    const grantRoleTx = await subdivide.grantRole(ADMIN_ROLE, deployer.address, {
      gasLimit: 100000
    });
    await grantRoleTx.wait();
    console.log("Granted ADMIN_ROLE to deployer");
  } catch (error) {
    console.log("Warning: Failed to grant ADMIN_ROLE:", error.message);
  }

  // Get validator address from ValidatorRegistry to grant VALIDATOR_ROLE
  const validatorDeployment = getDeployment(network.name, "Validator");
  if (validatorDeployment) {
    try {
      const validatorAddress = validatorDeployment.address;
      const grantValidatorRoleTx = await subdivide.grantRole(VALIDATOR_ROLE, validatorAddress, {
        gasLimit: 100000
      });
      await grantValidatorRoleTx.wait();
      console.log("Granted VALIDATOR_ROLE to validator at:", validatorAddress);
    } catch (error) {
      console.log("Warning: Failed to grant VALIDATOR_ROLE:", error.message);
    }
  } else {
    console.log("Warning: Validator deployment not found. VALIDATOR_ROLE not granted.");
  }

  // Verify deployment
  console.log("\nVerifying deployment...");
  const defaultValidator = await subdivide.defaultValidator();
  const validatorRegistry = await subdivide.validatorRegistry();
  const deedNFT = await subdivide.deedNFT();
  
  console.log("Default validator:", defaultValidator);
  console.log("Validator registry:", validatorRegistry);
  console.log("DeedNFT:", deedNFT);

  // Save deployment information
  const subdivideAbi = subdivide.interface.formatJson();
  saveDeployment(
    network.name,
    "Subdivide",
    subdivideAddress,
    subdivideAbi
  );
  console.log("Deployment information saved for Subdivide");

  console.log("\n✅ Subdivide contract deployed successfully!");
  console.log("Contract address:", subdivideAddress);
  console.log("Network:", network.name);
  
  // Display usage instructions
  console.log("\n📋 Usage Instructions:");
  console.log("1. DeedNFT owners can create subdivisions using createSubdivision()");
  console.log("2. Subdivision units can be minted using mintUnit() or batchMintUnits()");
  console.log("3. Units inherit asset type from parent DeedNFT (Land ↔ Estate only)");
  console.log("4. Units can be validated using the integrated Validator system");
  console.log("5. Units support ERC-7496 dynamic traits and ERC1155 standards");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
