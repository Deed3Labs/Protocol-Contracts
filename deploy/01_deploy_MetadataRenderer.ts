import { ethers } from "ethers";
import { MetadataRenderer } from "../typechain-types";
import { saveDeployment } from "./helpers";

async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying to network:", network.name);

  // Deploy MetadataRenderer as an upgradeable contract
  console.log("Deploying MetadataRenderer...");
  const MetadataRenderer = await hre.ethers.getContractFactory("MetadataRenderer");
  const metadataRenderer = await hre.upgrades.deployProxy(MetadataRenderer, [], {
    initializer: "initialize",
    kind: "uups"
  });
  await metadataRenderer.waitForDeployment();

  const metadataRendererAddress = await metadataRenderer.getAddress();
  console.log("MetadataRenderer deployed to:", metadataRendererAddress);

  // Setup initial roles and configuration
  const ADMIN_ROLE = await metadataRenderer.ADMIN_ROLE();
  await metadataRenderer.grantRole(ADMIN_ROLE, deployer.address);
  console.log("Granted ADMIN_ROLE to deployer");

  // Set base URI (replace with your actual base URI)
  await metadataRenderer.setBaseURI("https://your-base-uri.com/");
  console.log("Base URI set");

  // Save deployment information
  const metadataRendererAbi = metadataRenderer.interface.formatJson();
  saveDeployment(
    network.name,
    "MetadataRenderer",
    metadataRendererAddress,
    metadataRendererAbi
  );
  console.log("Deployment information saved for MetadataRenderer");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 