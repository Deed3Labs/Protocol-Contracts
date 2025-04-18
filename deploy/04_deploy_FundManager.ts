import { ethers } from "ethers";
import { FundManager } from "../typechain-types";
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

  // Get the DeedNFT address from saved deployment
  const deedNFTDeployment = getDeployment(network.name, "DeedNFT");
  if (!deedNFTDeployment) {
    throw new Error("DeedNFT deployment not found");
  }
  const deedNFTAddress = deedNFTDeployment.address;
  console.log("Using DeedNFT at:", deedNFTAddress);

  // Deploy FundManager as an upgradeable contract
  console.log("Deploying FundManager...");
  const FundManager = await hre.ethers.getContractFactory("FundManager");
  const fundManager = await hre.upgrades.deployProxy(FundManager, [deedNFTAddress], {
    initializer: "initialize",
    kind: "uups"
  });
  await fundManager.waitForDeployment();

  const fundManagerAddress = await fundManager.getAddress();
  console.log("FundManager deployed to:", fundManagerAddress);

  // Setup initial roles
  const ADMIN_ROLE = await fundManager.ADMIN_ROLE();
  const OPERATOR_ROLE = await fundManager.OPERATOR_ROLE();
  await fundManager.grantRole(ADMIN_ROLE, deployer.address);
  await fundManager.grantRole(OPERATOR_ROLE, deployer.address);
  console.log("Granted ADMIN_ROLE and OPERATOR_ROLE to deployer");

  // Save deployment information
  const fundManagerAbi = fundManager.interface.formatJson();
  saveDeployment(
    network.name,
    "FundManager",
    fundManagerAddress,
    fundManagerAbi
  );
  console.log("Deployment information saved for FundManager");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 