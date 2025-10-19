import { ethers } from "ethers";
import { Fractionalize, FractionTokenFactory } from "../typechain-types";
import { saveDeployment, getDeployment } from "./helpers";

/**
 * Deploy script for Fractionalize and FractionTokenFactory contracts
 * 
 * This script handles the circular dependency between Fractionalize and FractionToken
 * by deploying them in the correct order:
 * 1. Deploy FractionTokenFactory (creates tokens for Fractionalize)
 * 2. Deploy Fractionalize (uses factory to create tokens)
 * 
 * Dependencies:
 * - DeedNFT (for DeedNFT asset fractionalization)
 * - Subdivide (for subdivision asset fractionalization)
 */
async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying Fractionalize contracts with the account:", deployer.address);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying to network:", network.name);

  // Get required contract addresses from saved deployments
  const deedNFTDeployment = getDeployment(network.name, "DeedNFT");
  const subdivideDeployment = getDeployment(network.name, "Subdivide");
  
  if (!deedNFTDeployment || !subdivideDeployment) {
    throw new Error("Required contract deployments not found. Please deploy DeedNFT and Subdivide first.");
  }
  
  const deedNFTAddress = deedNFTDeployment.address;
  const subdivideAddress = subdivideDeployment.address;

  console.log("Using DeedNFT at:", deedNFTAddress);
  console.log("Using Subdivide at:", subdivideAddress);

  // 1. Deploy FractionTokenFactory first (with temporary address)
  console.log("\n1. Deploying FractionTokenFactory...");
  const FractionTokenFactory = await hre.ethers.getContractFactory("FractionTokenFactory");
  const fractionTokenFactory = await hre.upgrades.deployProxy(FractionTokenFactory, [deployer.address], {
    initializer: "initialize",
    kind: "uups"
  });
  await fractionTokenFactory.waitForDeployment();

  const fractionTokenFactoryAddress = await fractionTokenFactory.getAddress();
  console.log("FractionTokenFactory deployed to:", fractionTokenFactoryAddress);
  console.log("Transaction hash:", fractionTokenFactory.deploymentTransaction()?.hash);

  // 2. Deploy Fractionalize contract
  console.log("\n2. Deploying Fractionalize...");
  const Fractionalize = await hre.ethers.getContractFactory("Fractionalize");
  const fractionalize = await hre.upgrades.deployProxy(Fractionalize, [
    deedNFTAddress,
    subdivideAddress,
    fractionTokenFactoryAddress
  ], {
    initializer: "initialize",
    kind: "uups"
  });
  await fractionalize.waitForDeployment();

  const fractionalizeAddress = await fractionalize.getAddress();
  console.log("Fractionalize deployed to:", fractionalizeAddress);
  console.log("Transaction hash:", fractionalize.deploymentTransaction()?.hash);

  // 3. Update the factory with the correct Fractionalize contract address
  console.log("\n3. Updating FractionTokenFactory with Fractionalize address...");
  const updateFactoryTx = await fractionTokenFactory.updateFractionalizeContract(fractionalizeAddress);
  await updateFactoryTx.wait();
  console.log("FractionTokenFactory updated with Fractionalize address");

  // 4. Setup roles and permissions
  console.log("\n4. Setting up roles and permissions...");
  
  // Grant necessary roles to the Fractionalize contract
  const ADMIN_ROLE = await fractionalize.ADMIN_ROLE();
  
  // Grant admin role to deployer (already granted during initialization)
  console.log("ADMIN_ROLE already granted to deployer during initialization");

  // 5. Verify deployment
  console.log("\n5. Verifying deployment...");
  const deedNFT = await fractionalize.deedNFT();
  const subdivideNFT = await fractionalize.subdivideNFT();
  const factory = await fractionalize.fractionTokenFactory();
  
  console.log("DeedNFT reference:", deedNFT);
  console.log("Subdivide reference:", subdivideNFT);
  console.log("Factory reference:", factory);

  // Verify factory is properly connected
  const factoryFractionalizeContract = await fractionTokenFactory.fractionalizeContract();
  console.log("Factory's Fractionalize reference:", factoryFractionalizeContract);

  // 6. Save deployment information
  console.log("\n6. Saving deployment information...");
  
  // Save FractionTokenFactory deployment
  const fractionTokenFactoryAbi = fractionTokenFactory.interface.formatJson();
  saveDeployment(
    network.name,
    "FractionTokenFactory",
    fractionTokenFactoryAddress,
    fractionTokenFactoryAbi
  );
  console.log("FractionTokenFactory deployment saved");

  // Save Fractionalize deployment
  const fractionalizeAbi = fractionalize.interface.formatJson();
  saveDeployment(
    network.name,
    "Fractionalize",
    fractionalizeAddress,
    fractionalizeAbi
  );
  console.log("Fractionalize deployment saved");

  console.log("\n✅ Fractionalize contracts deployed successfully!");
  console.log("FractionTokenFactory address:", fractionTokenFactoryAddress);
  console.log("Fractionalize address:", fractionalizeAddress);
  console.log("Network:", network.name);
  
  // Display usage instructions
  console.log("\n📋 Usage Instructions:");
  console.log("1. DeedNFT and Subdivision owners can create fractions using createFraction()");
  console.log("2. Fraction shares can be minted using mintShares() or batchMintShares()");
  console.log("3. Shares can be burned if burnable is enabled using burnShares()");
  console.log("4. Assets can be unlocked using unlockAsset() with proper approvals");
  console.log("5. Each fraction gets its own ERC-20 token created by the factory");
  console.log("6. Factory uses clone pattern for gas-efficient token deployment");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
