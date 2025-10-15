//.import { ethers } from "ethers";
import { DeedNFT } from "../typechain-types";
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

  // Get required contract addresses from saved deployments
  const validatorRegistryDeployment = getDeployment(network.name, "ValidatorRegistry");
  const metadataRendererDeployment = getDeployment(network.name, "MetadataRenderer");
  const validatorDeployment = getDeployment(network.name, "Validator");
  
  if (!validatorRegistryDeployment || !metadataRendererDeployment || !validatorDeployment) {
    throw new Error("Required contract deployments not found");
  }
  
  const validatorRegistryAddress = validatorRegistryDeployment.address;
  const metadataRendererAddress = metadataRendererDeployment.address;
  const validatorAddress = validatorDeployment.address;

  // Deploy DeedNFT as an upgradeable contract
  console.log("Deploying DeedNFT...");
  const DeedNFT = await hre.ethers.getContractFactory("DeedNFT");
  const deedNFT = await hre.upgrades.deployProxy(DeedNFT, [validatorAddress, validatorRegistryAddress], {
    initializer: "initialize",
    kind: "uups"
  });
  await deedNFT.waitForDeployment();

  const deedNFTAddress = await deedNFT.getAddress();
  console.log("DeedNFT deployed to:", deedNFTAddress);

  // Setup initial roles
  const ADMIN_ROLE = await deedNFT.ADMIN_ROLE();
  const MINTER_ROLE = await deedNFT.MINTER_ROLE();
  const VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();

  // Grant roles to deployer and validator
  await deedNFT.grantRole(ADMIN_ROLE, deployer.address);
  await deedNFT.grantRole(MINTER_ROLE, deployer.address);
  await deedNFT.grantRole(MINTER_ROLE, validatorAddress);
  await deedNFT.grantRole(VALIDATOR_ROLE, validatorAddress);
  console.log("Granted roles to deployer and validator");

  // Set MetadataRenderer
  await deedNFT.setMetadataRenderer(metadataRendererAddress);
  console.log("Set MetadataRenderer");

  // Save deployment information
  const deedNFTAbi = deedNFT.interface.formatJson();
  saveDeployment(
    network.name,
    "DeedNFT",
    deedNFTAddress,
    deedNFTAbi
  );
  console.log("Deployment information saved for DeedNFT");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 