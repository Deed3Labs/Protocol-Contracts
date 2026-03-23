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

  // Setup initial roles and configuration
  const DEFAULT_ADMIN_ROLE = await metadataRenderer.DEFAULT_ADMIN_ROLE();
  const VALIDATOR_ROLE = await metadataRenderer.VALIDATOR_ROLE();

  if (!(await metadataRenderer.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))) {
    await metadataRenderer.grantRole(DEFAULT_ADMIN_ROLE, deployer.address);
  }
  if (!(await metadataRenderer.hasRole(VALIDATOR_ROLE, deployer.address))) {
    await metadataRenderer.grantRole(VALIDATOR_ROLE, deployer.address);
  }
  console.log("Ensured deployer has admin/validator roles");

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
