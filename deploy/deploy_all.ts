import { ethers } from "ethers";
import { saveDeployment, getDeployment } from "./helpers";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Main deployment script that deploys and configures all contracts in the correct order:
 * 1. ValidatorRegistry (core registry for all validators)
 * 2. MetadataRenderer (handles NFT metadata)
 * 3. Validator (main validator contract)
 * 4. DeedNFT (NFT contract for deeds)
 * 5. FundManager (handles fund management)
 * 
 * Dependencies:
 * - DeedNFT needs Validator and MetadataRenderer
 * - Validator needs to be registered in ValidatorRegistry
 * - FundManager needs DeedNFT and ValidatorRegistry
 */
async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  
  // Get initial balance
  const initialBalance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Initial account balance:", ethers.formatEther(initialBalance), "ETH");

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying to network:", network.name);

  try {
    // 1. Deploy ValidatorRegistry
    console.log("\n1. Deploying ValidatorRegistry...");
    const ValidatorRegistry = await hre.ethers.getContractFactory("ValidatorRegistry");
    const validatorRegistry = await hre.upgrades.deployProxy(ValidatorRegistry, [], {
      initializer: "initialize",
      kind: "uups"
    });
    await validatorRegistry.waitForDeployment();
    const validatorRegistryAddress = await validatorRegistry.getAddress();
    console.log("ValidatorRegistry deployed to:", validatorRegistryAddress);
    console.log("Transaction hash:", validatorRegistry.deploymentTransaction()?.hash);

    // Setup initial roles for ValidatorRegistry
    const REGISTRY_ADMIN_ROLE = await validatorRegistry.REGISTRY_ADMIN_ROLE();
    const grantRoleTx = await validatorRegistry.grantRole(REGISTRY_ADMIN_ROLE, deployer.address);
    await grantRoleTx.wait();
    console.log("Granted REGISTRY_ADMIN_ROLE to deployer");
    console.log("Role grant transaction hash:", grantRoleTx.hash);

    // Ensure deployer is the owner
    const owner = await validatorRegistry.owner();
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
      const transferTx = await validatorRegistry.transferOwnership(deployer.address);
      await transferTx.wait();
      console.log("Transferred ownership to deployer");
      console.log("Transfer transaction hash:", transferTx.hash);
    }

    // Save ValidatorRegistry deployment
    const validatorRegistryAbi = validatorRegistry.interface.formatJson();
    saveDeployment(network.name, "ValidatorRegistry", validatorRegistryAddress, validatorRegistryAbi);

    // 2. Deploy MetadataRenderer
    console.log("\n2. Deploying MetadataRenderer...");
    const MetadataRenderer = await hre.ethers.getContractFactory("MetadataRenderer");
    const metadataRenderer = await hre.upgrades.deployProxy(MetadataRenderer, ["https://api.example.com/metadata/"], {
      initializer: "initialize",
      kind: "uups"
    });
    await metadataRenderer.waitForDeployment();
    const metadataRendererAddress = await metadataRenderer.getAddress();
    console.log("MetadataRenderer deployed to:", metadataRendererAddress);
    console.log("Transaction hash:", metadataRenderer.deploymentTransaction()?.hash);

    // Setup initial roles for MetadataRenderer
    const VALIDATOR_ROLE = await metadataRenderer.VALIDATOR_ROLE();
    const grantValidatorRoleTx = await metadataRenderer.grantRole(VALIDATOR_ROLE, deployer.address);
    await grantValidatorRoleTx.wait();
    console.log("Granted VALIDATOR_ROLE to deployer in MetadataRenderer");
    console.log("Role grant transaction hash:", grantValidatorRoleTx.hash);

    // Save MetadataRenderer deployment
    const metadataRendererAbi = metadataRenderer.interface.formatJson();
    saveDeployment(network.name, "MetadataRenderer", metadataRendererAddress, metadataRendererAbi);

    // 3. Deploy Validator
    console.log("\n3. Deploying Validator...");
    const Validator = await hre.ethers.getContractFactory("Validator");
    const validator = await hre.upgrades.deployProxy(Validator, [
      "https://api.example.com/validator/",
      "https://api.example.com/agreements/default.pdf"
    ], {
      initializer: "initialize",
      kind: "uups"
    });
    await validator.waitForDeployment();
    const validatorAddress = await validator.getAddress();
    console.log("Validator deployed to:", validatorAddress);
    console.log("Transaction hash:", validator.deploymentTransaction()?.hash);

    // Setup initial roles for Validator
    const VALIDATOR_ROLE_VALIDATOR = await validator.VALIDATOR_ROLE();
    const grantValidatorRoleTxValidator = await validator.grantRole(VALIDATOR_ROLE_VALIDATOR, deployer.address);
    await grantValidatorRoleTxValidator.wait();
    console.log("Granted VALIDATOR_ROLE to deployer in Validator");
    console.log("Role grant transaction hash:", grantValidatorRoleTxValidator.hash);

    // Save Validator deployment
    const validatorAbi = validator.interface.formatJson();
    saveDeployment(network.name, "Validator", validatorAddress, validatorAbi);

    // 4. Deploy DeedNFT
    console.log("\n4. Deploying DeedNFT...");
    const DeedNFT = await hre.ethers.getContractFactory("DeedNFT");
    const deedNFT = await hre.upgrades.deployProxy(DeedNFT, [validatorAddress, validatorRegistryAddress], {
      initializer: "initialize",
      kind: "uups"
    });
    await deedNFT.waitForDeployment();
    const deedNFTAddress = await deedNFT.getAddress();
    console.log("DeedNFT deployed to:", deedNFTAddress);
    console.log("Transaction hash:", deedNFT.deploymentTransaction()?.hash);

    // Save DeedNFT deployment
    const deedNFTAbi = deedNFT.interface.formatJson();
    saveDeployment(network.name, "DeedNFT", deedNFTAddress, deedNFTAbi);

    // Update Validator with DeedNFT address
    console.log("\nUpdating Validator with DeedNFT address...");
    const setDeedNFTTx = await validator.setDeedNFT(deedNFTAddress);
    await setDeedNFTTx.wait();
    console.log("Validator updated with DeedNFT address");
    console.log("Transaction hash:", setDeedNFTTx.hash);

    // Set up MetadataRenderer with DeedNFT
    console.log("\nSetting DeedNFT in MetadataRenderer...");
    const setDeedNFTInRendererTx = await metadataRenderer.setDeedNFT(deedNFTAddress);
    await setDeedNFTInRendererTx.wait();
    console.log("DeedNFT set in MetadataRenderer");
    console.log("Transaction hash:", setDeedNFTInRendererTx.hash);

    // Set MetadataRenderer in DeedNFT
    console.log("\nSetting MetadataRenderer in DeedNFT...");
    const setMetadataRendererTx = await deedNFT.setMetadataRenderer(metadataRendererAddress);
    await setMetadataRendererTx.wait();
    console.log("MetadataRenderer set in DeedNFT");
    console.log("Transaction hash:", setMetadataRendererTx.hash);

    // Set default images for asset types in MetadataRenderer
    console.log("\nSetting default images in MetadataRenderer...");
    const defaultImages = {
      "assetType_0": "ipfs://QmLand",
      "assetType_1": "ipfs://QmVehicle",
      "assetType_2": "ipfs://QmLand", // Estate (uses same as Land)
      "assetType_3": "ipfs://QmEquipment",
      "invalidated": "ipfs://QmInvalidated"
    };
    
    for (const [key, uri] of Object.entries(defaultImages)) {
      const setImageTx = await metadataRenderer.setDefaultImageURI(key, uri);
      await setImageTx.wait();
      console.log(`Set default image for ${key}`);
      console.log("Transaction hash:", setImageTx.hash);
    }

    // 5. Deploy FundManager
    console.log("\n5. Deploying FundManager...");
    const FundManager = await hre.ethers.getContractFactory("FundManager");
    const fundManager = await hre.upgrades.deployProxy(FundManager, [
      deedNFTAddress,
      validatorRegistryAddress,
      500, // 5% initial commission percentage (500 basis points)
      deployer.address // Fee receiver address
    ], {
      initializer: "initialize",
      kind: "uups"
    });
    await fundManager.waitForDeployment();
    const fundManagerAddress = await fundManager.getAddress();
    console.log("FundManager deployed to:", fundManagerAddress);
    console.log("Transaction hash:", fundManager.deploymentTransaction()?.hash);

    // Save FundManager deployment
    const fundManagerAbi = fundManager.interface.formatJson();
    saveDeployment(network.name, "FundManager", fundManagerAddress, fundManagerAbi);

    // 6. Setup Validator in Registry
    console.log("\n6. Setting up Validator in Registry...");
    
    // Ensure deployer has REGISTRY_ADMIN_ROLE
    if (!(await validatorRegistry.hasRole(REGISTRY_ADMIN_ROLE, deployer.address))) {
      const grantAdminRoleTx = await validatorRegistry.grantRole(REGISTRY_ADMIN_ROLE, deployer.address);
      await grantAdminRoleTx.wait();
      console.log("Granted REGISTRY_ADMIN_ROLE to deployer");
      console.log("Role grant transaction hash:", grantAdminRoleTx.hash);
    }

    // Register validator with name
    const registerTx = await validatorRegistry.registerValidator(
      validatorAddress,
      "Default Validator"
    );
    console.log("Registering Validator in Registry...");
    const registerReceipt = await registerTx.wait();
    console.log("Validator registration transaction mined");
    console.log("Transaction hash:", registerReceipt.hash);
    console.log("Gas used:", registerReceipt.gasUsed.toString());

    // Check if validator is registered
    const isRegisteredAfterRegistration = await validatorRegistry.isValidatorRegistered(validatorAddress);
    console.log("Is validator registered after registration?", isRegisteredAfterRegistration);
    
    // Get validator name
    const validatorName = await validatorRegistry.getValidatorName(validatorAddress);
    console.log("Validator name:", validatorName);

    // Set all asset types as supported in Validator
    console.log("\nSetting up asset types in Validator...");
    
    // Ensure deployer has CRITERIA_MANAGER_ROLE in Validator
    const CRITERIA_MANAGER_ROLE = await validator.CRITERIA_MANAGER_ROLE();
    if (!(await validator.hasRole(CRITERIA_MANAGER_ROLE, deployer.address))) {
      const grantCriteriaRoleTx = await validator.grantRole(CRITERIA_MANAGER_ROLE, deployer.address);
      await grantCriteriaRoleTx.wait();
      console.log("Granted CRITERIA_MANAGER_ROLE to deployer");
      console.log("Role grant transaction hash:", grantCriteriaRoleTx.hash);
    }

    const assetTypes = [0, 1, 2, 3]; // Land, Vehicle, Estate, CommercialEquipment

    // Set up asset types in Validator
    for (const assetType of assetTypes) {
      const setAssetTypeTx = await validator.setAssetTypeSupport(assetType, true);
      await setAssetTypeTx.wait();
      console.log(`Asset type ${assetType} configured in Validator`);
      console.log("Transaction hash:", setAssetTypeTx.hash);
    }
    console.log("All asset types configured in Validator");

    // Verify validator is registered
    const isRegistered = await validatorRegistry.isValidatorRegistered(validatorAddress);
    console.log("Is validator registered?", isRegistered);
    
    if (isRegistered) {
      // Set Validator as active in Registry
      console.log("\nActivating Validator in Registry...");
      const activateTx = await validatorRegistry.updateValidatorStatus(validatorAddress, true);
      await activateTx.wait();
      console.log("Validator activated in Registry");
      console.log("Transaction hash:", activateTx.hash);
    } else {
      console.log("Validator is not registered, skipping status update");
    }

    // Set FundManager in Validator
    console.log("\nSetting FundManager in Validator...");
    const setFundManagerTx = await validator.setFundManager(fundManagerAddress);
    await setFundManagerTx.wait();
    console.log("FundManager set in Validator");
    console.log("Transaction hash:", setFundManagerTx.hash);

    console.log("\nAll contracts deployed and configured successfully!");
    console.log("\nDeployment Summary:");
    console.log("-------------------");
    console.log("ValidatorRegistry:", validatorRegistryAddress);
    console.log("MetadataRenderer:", metadataRendererAddress);
    console.log("Validator:", validatorAddress);
    console.log("DeedNFT:", deedNFTAddress);
    console.log("FundManager:", fundManagerAddress);

    // Final balance check
    const finalBalance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("\nFinal account balance:", ethers.formatEther(finalBalance), "ETH");
    console.log("Total gas spent:", ethers.formatEther(initialBalance - finalBalance), "ETH");

    // Generate TypeScript ABIs
    console.log("\nGenerating TypeScript ABIs...");
    try {
      const { stdout, stderr } = await execAsync("npx hardhat run deploy/99_generateTsAbis.ts");
      if (stderr) console.error("ABI generation warnings:", stderr);
      console.log("ABI generation output:", stdout);
      console.log("✅ TypeScript ABIs generated successfully");
    } catch (error) {
      console.error("❌ Failed to generate TypeScript ABIs:", error);
      // Don't throw here, as the deployment was successful
    }

  } catch (error) {
    console.error("\nDeployment failed!");
    console.error("Error:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 