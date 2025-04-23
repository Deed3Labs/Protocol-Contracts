import { ethers } from "ethers";
import { Validator } from "../typechain-types";
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

  // Get the ValidatorRegistry address from the saved deployment
  const validatorRegistryDeployment = getDeployment(network.name, "ValidatorRegistry");
  if (!validatorRegistryDeployment) {
    throw new Error("ValidatorRegistry deployment not found");
  }
  const validatorRegistryAddress = validatorRegistryDeployment.address;
  console.log("Using ValidatorRegistry at:", validatorRegistryAddress);

  // Deploy Validator as an upgradeable contract
  console.log("Deploying Validator...");
  const Validator = await hre.ethers.getContractFactory("Validator");
  const validator = await hre.upgrades.deployProxy(Validator, [validatorRegistryAddress], {
    initializer: "initialize",
    kind: "uups"
  });
  await validator.waitForDeployment();

  const validatorAddress = await validator.getAddress();
  console.log("Validator deployed to:", validatorAddress);

  // Setup initial roles
  const VALIDATOR_ROLE = await validator.VALIDATOR_ROLE();
  await validator.grantRole(VALIDATOR_ROLE, deployer.address);
  console.log("Granted VALIDATOR_ROLE to deployer");

  // Save deployment information
  const validatorAbi = validator.interface.formatJson();
  saveDeployment(
    network.name,
    "Validator",
    validatorAddress,
    validatorAbi
  );
  console.log("Deployment information saved for Validator");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 