import { ethers } from "hardhat";
import { getDeployment } from "../deploy/helpers";

async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("Checking with account:", deployer.address);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Network:", network.name);

  // Get the ValidatorRegistry address from saved deployment
  const validatorRegistryDeployment = getDeployment(network.name, "ValidatorRegistry");
  if (!validatorRegistryDeployment) {
    throw new Error("ValidatorRegistry deployment not found");
  }

  const validatorRegistryAddress = validatorRegistryDeployment.address;
  console.log("ValidatorRegistry address:", validatorRegistryAddress);

  // Get the ValidatorRegistry contract
  const ValidatorRegistry = await hre.ethers.getContractFactory("ValidatorRegistry");
  const validatorRegistry = ValidatorRegistry.attach(validatorRegistryAddress);

  // Check the owner
  const owner = await validatorRegistry.owner();
  console.log("Owner of ValidatorRegistry:", owner);
  console.log("Is deployer the owner?", owner.toLowerCase() === deployer.address.toLowerCase());

  // Check if deployer has REGISTRY_ADMIN_ROLE
  const REGISTRY_ADMIN_ROLE = await validatorRegistry.REGISTRY_ADMIN_ROLE();
  const hasAdminRole = await validatorRegistry.hasRole(REGISTRY_ADMIN_ROLE, deployer.address);
  console.log("Does deployer have REGISTRY_ADMIN_ROLE?", hasAdminRole);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 