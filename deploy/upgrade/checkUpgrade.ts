import { ethers } from "ethers";

async function main() {
  const hre = require("hardhat");

  // Get the contract name from command line arguments
  const contractName = process.env.CONTRACT_NAME;
  const proxyAddress = process.env.PROXY_ADDRESS;

  if (!contractName || !proxyAddress) {
    throw new Error(
      "Please provide CONTRACT_NAME and PROXY_ADDRESS environment variables"
    );
  }

  console.log(`Checking ${contractName} upgrade safety and status...`);
  console.log(`Proxy address: ${proxyAddress}`);

  // Get current implementation address
  const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("Current implementation address:", implementationAddress);

  // Get admin address
  const adminAddress = await hre.upgrades.erc1967.getAdminAddress(proxyAddress);
  console.log("Proxy admin address:", adminAddress);

  // Get the new implementation contract factory
  const ContractFactory = await hre.ethers.getContractFactory(contractName);

  // Check if the contract can be upgraded
  console.log("\nChecking upgrade safety...");
  try {
    await hre.upgrades.validateUpgrade(proxyAddress, ContractFactory, {
      kind: "uups"
    });
    console.log("✅ Contract can be safely upgraded");
  } catch (error) {
    console.log("❌ Upgrade validation failed:");
    console.log(error.message);
  }

  // Get the contract instance
  const contract = await hre.ethers.getContractAt(contractName, proxyAddress);

  // Check if the contract has the correct UUPS interface
  console.log("\nChecking UUPS interface...");
  try {
    const hasUUPS = await contract.supportsInterface("0x52d1902d");
    console.log(hasUUPS ? "✅ Contract supports UUPS" : "❌ Contract does not support UUPS");
  } catch (error) {
    console.log("❌ Error checking UUPS interface:", error.message);
  }

  // Check roles if the contract has them
  console.log("\nChecking roles...");
  try {
    const UPGRADER_ROLE = await contract.UPGRADER_ROLE();
    const DEFAULT_ADMIN_ROLE = await contract.DEFAULT_ADMIN_ROLE();
    
    const [deployer] = await hre.ethers.getSigners();
    const hasUpgraderRole = await contract.hasRole(UPGRADER_ROLE, deployer.address);
    const hasAdminRole = await contract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

    console.log(`Deployer address: ${deployer.address}`);
    console.log(`Has UPGRADER_ROLE: ${hasUpgraderRole ? "✅" : "❌"}`);
    console.log(`Has DEFAULT_ADMIN_ROLE: ${hasAdminRole ? "✅" : "❌"}`);
  } catch (error) {
    console.log("Note: Contract does not have standard role checking");
  }

  console.log("\nCheck complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 