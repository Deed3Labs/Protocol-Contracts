import { saveDeployment } from "./helpers";

/**
 * Comprehensive deployment script for the entire BurnerBond system
 * 
 * Deploys in order:
 * 1. TokenRegistry - Token whitelist and pricing
 * 2. BurnerBondFactory - Bond collection factory (also deploys BurnerBondDeposit), gated on the
 *    TokenRegistry's whitelist
 *
 * Section 13: bond principal never enters the co-op's AssurancePool, and the bond contracts hold no
 * address for it. The AssurancePool is deployed by 08_deploy_AssurancePool.ts on its own, and the
 * AssuranceOracle is retired.
 */
async function main() {
  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer from hardhat
  const [deployer] = await hre.ethers.getSigners();
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🚀 BurnerBond System Deployment");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  // Get the network
  const network = await hre.ethers.provider.getNetwork();
  console.log("Network:", network.name, "(chainId:", network.chainId, ")");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Network-specific configuration
  let uniswapFactoryAddress: string;
  let wethAddress: string;
  let usdcAddress: string;
  let usdtAddress: string;
  let daiAddress: string;
  let reserveTokenAddress: string;
  let stableCreditAddress: string;

  if (network.chainId === 84532n) {
    // Base Sepolia
    uniswapFactoryAddress = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
    wethAddress = "0x4200000000000000000000000000000000000006";
    usdcAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    usdtAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    daiAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    reserveTokenAddress = usdcAddress;
    stableCreditAddress = "0x0000000000000000000000000000000000000000"; // Placeholder
  } else if (network.chainId === 8453n) {
    // Base Mainnet
    uniswapFactoryAddress = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
    wethAddress = "0x4200000000000000000000000000000000000006";
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    usdtAddress = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
    daiAddress = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
    reserveTokenAddress = usdcAddress;
    stableCreditAddress = "0x0000000000000000000000000000000000000000"; // Placeholder
  } else {
    throw new Error(`Unsupported network: ${network.name} (${network.chainId})`);
  }

  const deployedContracts: any = {};

  try {
    // ═══════════════════════════════════════════════════════════
    // 1. Deploy TokenRegistry
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────┐");
    console.log("│ 1️⃣  Deploying TokenRegistry                              │");
    console.log("└─────────────────────────────────────────────────────────┘");
    
    const TokenRegistry = await hre.ethers.getContractFactory("TokenRegistry");
    const tokenRegistry = await TokenRegistry.deploy();
    await tokenRegistry.waitForDeployment();
    const tokenRegistryAddress = await tokenRegistry.getAddress();
    deployedContracts.tokenRegistry = tokenRegistryAddress;
    
    console.log("✓ TokenRegistry deployed:", tokenRegistryAddress);
    
    // Register tokens
    console.log("\n  Registering tokens...");
    await tokenRegistry.setStablecoin(usdcAddress, true);
    await tokenRegistry.setTokenMetadata(usdcAddress, "USDC", "USD Coin", 6);
    await tokenRegistry.registerToken(usdcAddress, Number(network.chainId), usdcAddress, hre.ethers.parseEther("1"));
    console.log("  ✓ USDC registered");
    
    await tokenRegistry.setStablecoin(usdtAddress, true);
    await tokenRegistry.setTokenMetadata(usdtAddress, "USDT", "Tether USD", 6);
    await tokenRegistry.registerToken(usdtAddress, Number(network.chainId), usdtAddress, hre.ethers.parseEther("1"));
    console.log("  ✓ USDT registered");
    
    await tokenRegistry.setStablecoin(daiAddress, true);
    await tokenRegistry.setTokenMetadata(daiAddress, "DAI", "Dai Stablecoin", 18);
    await tokenRegistry.registerToken(daiAddress, Number(network.chainId), daiAddress, hre.ethers.parseEther("1"));
    console.log("  ✓ DAI registered");
    
    await tokenRegistry.setTokenMetadata(wethAddress, "WETH", "Wrapped Ether", 18);
    await tokenRegistry.registerToken(wethAddress, Number(network.chainId), wethAddress, hre.ethers.parseEther("3000"));
    console.log("  ✓ WETH registered");
    
    saveDeployment(network.name, "TokenRegistry", tokenRegistryAddress, JSON.parse(tokenRegistry.interface.formatJson()));
    console.log("  ✓ Deployment saved\n");

    // ═══════════════════════════════════════════════════════════
    // 4. Deploy BurnerBondFactory (and BurnerBondDeposit)
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────┐");
    console.log("│ 4️⃣  Deploying BurnerBondFactory                          │");
    console.log("└─────────────────────────────────────────────────────────┘");
    
    const baseURI = "https://protocol.com/api/bonds";
    const BurnerBondFactory = await hre.ethers.getContractFactory("BurnerBondFactory");
    const burnerBondFactory = await BurnerBondFactory.deploy(tokenRegistryAddress, baseURI);
    await burnerBondFactory.waitForDeployment();
    const burnerBondFactoryAddress = await burnerBondFactory.getAddress();
    deployedContracts.factory = burnerBondFactoryAddress;
    
    console.log("✓ BurnerBondFactory deployed:", burnerBondFactoryAddress);
    
    const burnerBondDepositAddress = await burnerBondFactory.getUnifiedDepositContract();
    deployedContracts.deposit = burnerBondDepositAddress;
    console.log("✓ BurnerBondDeposit deployed:", burnerBondDepositAddress);
    
    const maxDiscount = await burnerBondFactory.getMaxDiscount();
    const maxMaturity = await burnerBondFactory.getMaxMaturity();
    console.log(`  Max Discount: ${Number(maxDiscount) / 100}%`);
    console.log(`  Max Maturity: ${Number(maxMaturity) / (365 * 24 * 60 * 60)} years`);
    
    saveDeployment(network.name, "BurnerBondFactory", burnerBondFactoryAddress, JSON.parse(burnerBondFactory.interface.formatJson()));
    
    const BurnerBondDeposit = await hre.ethers.getContractAt("BurnerBondDeposit", burnerBondDepositAddress);
    saveDeployment(network.name, "BurnerBondDeposit", burnerBondDepositAddress, JSON.parse(BurnerBondDeposit.interface.formatJson()));
    console.log("  ✓ Deployments saved\n");

    // ═══════════════════════════════════════════════════════════
    // 5. Create Initial Collections
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────┐");
    console.log("│ 5️⃣  Creating Initial Bond Collections                   │");
    console.log("└─────────────────────────────────────────────────────────┘");
    
    try {
      console.log("Creating USDC collection...");
      const tx = await burnerBondFactory.createCollection(usdcAddress, "USDC", "USD Coin", baseURI);
      await tx.wait();
      const usdcCollectionAddress = await burnerBondFactory.getCollectionAddress(usdcAddress);
      deployedContracts.usdcCollection = usdcCollectionAddress;
      console.log("✓ USDC BurnerBond collection:", usdcCollectionAddress);
      
      const BurnerBond = await hre.ethers.getContractAt("BurnerBond", usdcCollectionAddress);
      saveDeployment(network.name, "BurnerBond_USDC", usdcCollectionAddress, JSON.parse(BurnerBond.interface.formatJson()));
      console.log("  ✓ Collection saved\n");
    } catch (error: any) {
      console.log("⚠️  Could not create USDC collection:", error.message);
      console.log("   Collections will be created automatically on first deposit\n");
    }

    // ═══════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════
    console.log("═══════════════════════════════════════════════════════════");
    console.log("✅ Deployment Complete!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("\n📋 Deployed Contracts:");
    console.log("─────────────────────────────────────────────────────────");
    console.log("TokenRegistry:        ", deployedContracts.tokenRegistry);
    console.log("BurnerBondFactory:    ", deployedContracts.factory);
    console.log("BurnerBondDeposit:    ", deployedContracts.deposit);
    if (deployedContracts.usdcCollection) {
      console.log("USDC Collection:      ", deployedContracts.usdcCollection);
    }
    console.log("─────────────────────────────────────────────────────────");
    
    console.log("\n📝 Next Steps:");
    console.log("1. Verify contracts on block explorer");
    console.log("2. Update frontend with new contract addresses");
    console.log("3. Configure additional permissions if needed");
    console.log("4. Create additional bond collections for other tokens");
    console.log("5. Test bond creation with small amounts");
    
    console.log("\n💡 Usage:");
    console.log("Users can now:");
    console.log("- Deposit whitelisted tokens via BurnerBondDeposit");
    console.log("- Receive BurnerBond NFTs automatically");
    console.log("- Redeem mature bonds for face value");
    console.log("═══════════════════════════════════════════════════════════\n");

    return deployedContracts;

  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

