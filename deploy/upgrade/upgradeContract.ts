import { ethers } from "ethers";
import { saveDeployment, getDeployment } from "../helpers";

async function main() {
  const hre = require("hardhat");
  
  // Get the contract name and address from command line arguments
  const contractName = process.env.CONTRACT_NAME;
  const proxyAddress = process.env.PROXY_ADDRESS;

  if (!contractName || !proxyAddress) {
    throw new Error(
      "Please provide CONTRACT_NAME and PROXY_ADDRESS environment variables"
    );
  }

  console.log(`Preparing to upgrade ${contractName}...`);
  console.log(`Proxy address: ${proxyAddress}`);

  // Get the new implementation contract factory
  const ContractFactory = await hre.ethers.getContractFactory(contractName);

  // Validate the upgrade
  console.log("Validating upgrade...");
  await hre.upgrades.validateUpgrade(proxyAddress, ContractFactory);
  console.log("Upgrade validation passed");

  // Prepare the upgrade
  console.log("Preparing upgrade...");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, ContractFactory);
  
  await upgraded.waitForDeployment();
  const upgradedAddress = await upgraded.getAddress();

  console.log("Upgrade complete!");
  console.log("New implementation deployed to:", upgradedAddress);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  
  // Verify the implementation contract if on a supported network
  try {
    if (network.name !== "hardhat" && network.name !== "localhost") {
      console.log("Verifying implementation contract...");
      const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
      await hre.run("verify:verify", {
        address: implementationAddress,
        constructorArguments: []
      });
      console.log("Implementation contract verified");
    }
  } catch (error) {
    console.log("Verification failed:", error.message);
  }

  // Save the upgraded contract information
  const contractAbi = upgraded.interface.formatJson();
  
  // Save deployment info
  saveDeployment(
    network.name,
    contractName,
    upgradedAddress,
    contractAbi
  );
  
  console.log(`Deployment information saved for ${contractName} on ${network.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 