import { ethers } from "ethers";
import { MetadataRenderer__factory } from "../typechain-types/factories/contracts/core/MetadataRenderer__factory";
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

  // Get ValidatorRegistry address from saved deployments
  const validatorRegistryDeployment = getDeployment(network.name, "ValidatorRegistry");
  if (!validatorRegistryDeployment) {
    throw new Error("ValidatorRegistry deployment not found");
  }
  const validatorRegistryAddress = validatorRegistryDeployment.address;

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

  // initialize() already gives the deployer ownership and DEFAULT_ADMIN_ROLE. The renderer has no
  // ADMIN_ROLE or REGISTRY_ADMIN_ROLE (the old grants reverted, audit D-22). Hand both to the Deed
  // timelock/Safe with deed_admin_handover.ts (audit D-13).

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