import { saveDeployment, getDeployment } from "./helpers";

/**
 * Deploys the BurnerBondFactory contract
 * 
 * This contract:
 * - Creates token-specific BurnerBond collections
 * - Manages unified BurnerBondDeposit contract
 * - Sets global parameters for all collections
 * - Validates tokens via AssuranceOracle
 */
async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying to network:", network.name, "(chainId:", network.chainId, ")");

  // Get AssurancePool deployment
  const assurancePoolDeployment = getDeployment(network.name, "AssurancePool");
  if (!assurancePoolDeployment) {
    throw new Error("AssurancePool not found. Please deploy it first using 08_deploy_AssurancePool.ts");
  }
  console.log("Found AssurancePool at:", assurancePoolDeployment.address);

  // Get AssuranceOracle deployment
  const assuranceOracleDeployment = getDeployment(network.name, "AssuranceOracle");
  if (!assuranceOracleDeployment) {
    throw new Error("AssuranceOracle not found. Please deploy it first using 09_deploy_AssuranceOracle.ts");
  }
  console.log("Found AssuranceOracle at:", assuranceOracleDeployment.address);

  // Base URI for bond metadata
  const baseURI = "https://protocol.com/api/bonds";

  console.log("\nDeployment parameters:");
  console.log(`- AssurancePool: ${assurancePoolDeployment.address}`);
  console.log(`- AssuranceOracle: ${assuranceOracleDeployment.address}`);
  console.log(`- Base URI: ${baseURI}`);

  // Deploy BurnerBondFactory
  console.log("\nDeploying BurnerBondFactory...");
  const BurnerBondFactory = await hre.ethers.getContractFactory("BurnerBondFactory");
  const burnerBondFactory = await BurnerBondFactory.deploy(
    assurancePoolDeployment.address,
    assuranceOracleDeployment.address,
    baseURI
  );

  await burnerBondFactory.waitForDeployment();
  const burnerBondFactoryAddress = await burnerBondFactory.getAddress();
  console.log("✓ BurnerBondFactory deployed to:", burnerBondFactoryAddress);

  // Get the unified BurnerBondDeposit address (deployed by factory)
  const burnerBondDepositAddress = await burnerBondFactory.getUnifiedDepositContract();
  console.log("✓ Unified BurnerBondDeposit deployed to:", burnerBondDepositAddress);

  // Verify deployment
  console.log("\nVerifying deployment...");
  const assurancePool = await burnerBondFactory.assurancePool();
  const assuranceOracle = await burnerBondFactory.assuranceOracle();
  const collectionCount = await burnerBondFactory.getCollectionCount();
  
  console.log(`- AssurancePool: ${assurancePool} (${assurancePool === assurancePoolDeployment.address ? "✓" : "✗"})`);
  console.log(`- AssuranceOracle: ${assuranceOracle} (${assuranceOracle === assuranceOracleDeployment.address ? "✓" : "✗"})`);
  console.log(`- Collection Count: ${collectionCount}`);

  // Display global parameters
  console.log("\nGlobal parameters:");
  const maxDiscount = await burnerBondFactory.getMaxDiscount();
  const minDiscount = await burnerBondFactory.getMinDiscount();
  const maxMaturity = await burnerBondFactory.getMaxMaturity();
  const minMaturity = await burnerBondFactory.getMinMaturity();
  const minFaceValue = await burnerBondFactory.getMinFaceValue();
  const maxFaceValue = await burnerBondFactory.getMaxFaceValue();
  
  console.log(`- Max Discount: ${Number(maxDiscount) / 100}% (${maxDiscount} basis points)`);
  console.log(`- Min Discount: ${Number(minDiscount) / 100}% (${minDiscount} basis points)`);
  console.log(`- Max Maturity: ${Number(maxMaturity) / (365 * 24 * 60 * 60)} years`);
  console.log(`- Min Maturity: ${Number(minMaturity) / (24 * 60 * 60)} days`);
  console.log(`- Min Face Value: $${hre.ethers.formatUnits(minFaceValue, 6)}`);
  console.log(`- Max Face Value: $${hre.ethers.formatUnits(maxFaceValue, 6)}`);

  // Save deployment information
  const burnerBondFactoryAbi = JSON.parse(burnerBondFactory.interface.formatJson());
  saveDeployment(
    network.name,
    "BurnerBondFactory",
    burnerBondFactoryAddress,
    burnerBondFactoryAbi
  );
  console.log("\n✓ Deployment information saved for BurnerBondFactory");

  // Also save BurnerBondDeposit deployment
  const BurnerBondDeposit = await hre.ethers.getContractAt("BurnerBondDeposit", burnerBondDepositAddress);
  const burnerBondDepositAbi = JSON.parse(BurnerBondDeposit.interface.formatJson());
  saveDeployment(
    network.name,
    "BurnerBondDeposit",
    burnerBondDepositAddress,
    burnerBondDepositAbi
  );
  console.log("✓ Deployment information saved for BurnerBondDeposit");

  console.log("\n✅ BurnerBondFactory deployment complete!");
  console.log("\n📝 Next steps:");
  console.log("1. Create collections for specific tokens using createCollection()");
  console.log("2. Users can now deposit tokens to create bonds automatically");
  console.log("3. Bonds will be minted immediately upon successful deposit");

  // Example: Create a USDC collection
  console.log("\n💡 Example: Creating USDC collection...");
  try {
    const usdcAddress = network.chainId === 84532n 
      ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e" 
      : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    
    console.log(`Creating collection for USDC at ${usdcAddress}...`);
    const tx = await burnerBondFactory.createCollection(
      usdcAddress,
      "USDC",
      "USD Coin",
      baseURI
    );
    await tx.wait();
    
    const collectionAddress = await burnerBondFactory.getCollectionAddress(usdcAddress);
    console.log("✓ USDC BurnerBond collection created at:", collectionAddress);
    
    // Save USDC collection deployment
    const BurnerBond = await hre.ethers.getContractAt("BurnerBond", collectionAddress);
    const burnerBondAbi = JSON.parse(BurnerBond.interface.formatJson());
    saveDeployment(
      network.name,
      "BurnerBond_USDC",
      collectionAddress,
      burnerBondAbi
    );
    console.log("✓ USDC BurnerBond collection deployment saved");
    
  } catch (error: any) {
    console.log("⚠️  Failed to create USDC collection:", error.message);
    console.log("   This may be because USDC is not whitelisted in AssuranceOracle");
    console.log("   Collections will be created automatically on first deposit for whitelisted tokens");
  }

  return {
    factory: burnerBondFactoryAddress,
    deposit: burnerBondDepositAddress,
    assurancePool: assurancePoolDeployment.address,
    assuranceOracle: assuranceOracleDeployment.address,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

