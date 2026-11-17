import { ethers } from "ethers";
import { saveDeployment, getDeployment, requireMainnetConfirmation } from "../helpers";
import { upgradeOptionsFor, verifiesOn } from "./upgradeOptions";

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
  // A bare upgrade of the vault stops every deposit and redemption until its accepted token is set
  // (the slot is new and starts at zero). Its upgrade is one upgradeToAndCall, built only by
  // scripts/migrate_vault_clrusd.ts. LendingPool needs its modules and its one-time initializer:
  // scripts/upgrade_yield_pool.ts.
  if (contractName === "ESADepositVault") {
    throw new Error("Not for ESADepositVault: use scripts/upgrade_vault.ts, then scripts/migrate_vault_clrusd.ts.");
  }
  if (contractName === "LendingPool") {
    throw new Error("Not for LendingPool: use scripts/upgrade_yield_pool.ts.");
  }
  requireMainnetConfirmation((await hre.ethers.provider.getNetwork()).name, `deploy/upgrade/upgradeContract.ts (${contractName})`);

  console.log(`Preparing to upgrade ${contractName}...`);
  console.log(`Proxy address: ${proxyAddress}`);

  // Get the new implementation contract factory
  const ContractFactory = await hre.ethers.getContractFactory(contractName);

  // Validate the upgrade
  console.log("Validating upgrade...");
  const options = upgradeOptionsFor(contractName);
  await hre.upgrades.validateUpgrade(proxyAddress, ContractFactory, options);
  console.log("Upgrade validation passed");

  // Prepare the upgrade
  console.log("Preparing upgrade...");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, ContractFactory, options);
  
  await upgraded.waitForDeployment();
  const upgradedAddress = await upgraded.getAddress();

  console.log("Upgrade complete!");
  console.log("New implementation deployed to:", upgradedAddress);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  
  // Verify the implementation contract if on a supported network
  try {
    if (verifiesOn(network.name)) {
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
  // The parsed ABI, as every other script saves it (a JSON string here broke readers of the record).
  const contractAbi = JSON.parse(upgraded.interface.formatJson());
  
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