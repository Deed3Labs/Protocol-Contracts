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

  // Deploy Validator as an upgradeable contract
  console.log("Deploying Validator...");
  const baseUri =
    process.env.VALIDATOR_BASE_URI?.trim() || "https://api.useclear.org/validator/";
  const defaultOperatingAgreementUri =
    process.env.DEFAULT_OPERATING_AGREEMENT_URI?.trim() ||
    "ipfs://bafkreie2v4w45kz5p2p4x6xxo6m7o7k7o7m3xk5t5m3w6qj3i5n3o4g5a";

  const Validator = await hre.ethers.getContractFactory("Validator");
  const validator = await hre.upgrades.deployProxy(
    Validator,
    [baseUri, defaultOperatingAgreementUri],
    {
    initializer: "initialize",
    kind: "uups"
    }
  );
  await validator.waitForDeployment();

  const validatorAddress = await validator.getAddress();
  console.log("Validator deployed to:", validatorAddress);

  // Setup initial roles and configuration
  const ADMIN_ROLE = await validator.ADMIN_ROLE();
  const VALIDATOR_ROLE = await validator.VALIDATOR_ROLE();
  const METADATA_ROLE = await validator.METADATA_ROLE();
  const CRITERIA_MANAGER_ROLE = await validator.CRITERIA_MANAGER_ROLE();
  const FEE_MANAGER_ROLE = await validator.FEE_MANAGER_ROLE();

  const rolesToEnsure = [
    ADMIN_ROLE,
    VALIDATOR_ROLE,
    METADATA_ROLE,
    CRITERIA_MANAGER_ROLE,
    FEE_MANAGER_ROLE,
  ];
  for (const role of rolesToEnsure) {
    if (!(await validator.hasRole(role, deployer.address))) {
      await (await validator.grantRole(role, deployer.address)).wait();
    }
  }
  console.log("Ensured deployer roles");

  // Set up supported asset types: Land, Vehicle, Estate, CommercialEquipment
  const assetTypes = [0, 1, 2, 3];

  for (const assetTypeId of assetTypes) {
    await (await validator.setAssetTypeSupport(assetTypeId, true)).wait();
    console.log(`Set asset type ${assetTypeId} as supported`);
  }

  // Register validator in the registry
  const validatorRegistry = await hre.ethers.getContractAt("ValidatorRegistry", validatorRegistryAddress);
  const alreadyRegistered = await validatorRegistry.isValidatorRegistered(validatorAddress);
  if (!alreadyRegistered) {
    await (
      await validatorRegistry.registerValidator(
        validatorAddress,
        "Default Validator",
        "A default validator for deployment",
        [0, 1, 2, 3]
      )
    ).wait();
    console.log("Registered validator in ValidatorRegistry");
  } else {
    console.log("Validator already registered in ValidatorRegistry");
  }

  // Update validator status (non-blocking if a downstream hook reverts)
  try {
    await (await validatorRegistry.updateValidatorStatus(validatorAddress, true)).wait();
    console.log("Updated validator status to activated");
  } catch (error: any) {
    console.warn("Warning: could not update validator status to active:", error?.message || String(error));
  }

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
