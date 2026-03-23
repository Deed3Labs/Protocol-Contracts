import { saveDeployment, getDeployment } from "./helpers";

/**
 * Deploys the FundManager contract
 * 
 * This contract:
 * - Manages fund operations and commission handling
 * - Integrates with ValidatorRegistry for role management
 * - Enforces maximum commission percentage (10%)
 * - Initial commission set to 5% (500 basis points)
 */
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
  const deedNFTDeployment = getDeployment(network.name, "DeedNFT");
  
  if (!validatorRegistryDeployment || !deedNFTDeployment) {
    throw new Error("Required contract deployments not found");
  }
  
  const validatorRegistryAddress = validatorRegistryDeployment.address;
  const deedNFTAddress = deedNFTDeployment.address;

  // Deploy FundManager as an upgradeable contract
  console.log("Deploying FundManager...");
  const FundManager = await hre.ethers.getContractFactory("FundManager");
  const fundManager = await hre.upgrades.deployProxy(FundManager, [
    validatorRegistryAddress,
    500, // 5% initial commission percentage (500 basis points) - within 10% max limit
    deployer.address // Fee receiver address
  ], {
    initializer: "initialize",
    kind: "uups"
  });
  await fundManager.waitForDeployment();

  const fundManagerAddress = await fundManager.getAddress();
  console.log("FundManager deployed to:", fundManagerAddress);

  // Setup initial roles
  // Note: Additional roles will be managed through ValidatorRegistry integration
  const ADMIN_ROLE = await fundManager.ADMIN_ROLE();
  const FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();

  // Grant roles to deployer
  if (!(await fundManager.hasRole(ADMIN_ROLE, deployer.address))) {
    await (await fundManager.grantRole(ADMIN_ROLE, deployer.address)).wait();
  }
  if (!(await fundManager.hasRole(FEE_MANAGER_ROLE, deployer.address))) {
    await (await fundManager.grantRole(FEE_MANAGER_ROLE, deployer.address)).wait();
  }
  console.log("Ensured initial roles for deployer");

  // Set ValidatorRegistry and mark DeedNFT as compatible
  await (await fundManager.setValidatorRegistry(validatorRegistryAddress)).wait();
  const isCompatible = await fundManager.isCompatibleDeedNFT(deedNFTAddress);
  if (!isCompatible) {
    await (await fundManager.addCompatibleDeedNFT(deedNFTAddress)).wait();
  }
  console.log("Set ValidatorRegistry and compatible DeedNFT");

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
