import { saveDeployment, getDeployment } from "./helpers";

/**
 * Deploys the AssuranceOracle contract
 * 
 * This contract:
 * - Provides token price quotes using Uniswap V3 pools
 * - Manages token whitelist via TokenRegistry
 * - Provides fallback pricing when Uniswap unavailable
 * - Sets target Reserve-to-Debt (RTD) ratio
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

  // Get TokenRegistry deployment
  const tokenRegistryDeployment = getDeployment(network.name, "TokenRegistry");
  if (!tokenRegistryDeployment) {
    throw new Error("TokenRegistry not found. Please deploy it first using 07_deploy_TokenRegistry.ts");
  }
  console.log("Found TokenRegistry at:", tokenRegistryDeployment.address);

  // Network-specific addresses
  let uniswapFactoryAddress: string;
  let wethAddress: string;
  let usdcAddress: string;
  let usdtAddress: string;
  let daiAddress: string;

  if (network.chainId === 84532n) {
    // Base Sepolia
    uniswapFactoryAddress = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"; // Uniswap V3 Factory on Base Sepolia
    wethAddress = "0x4200000000000000000000000000000000000006"; // WETH on Base Sepolia
    usdcAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC on Base Sepolia
    usdtAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Using USDC as placeholder
    daiAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Using USDC as placeholder
  } else if (network.chainId === 8453n) {
    // Base Mainnet
    uniswapFactoryAddress = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"; // Uniswap V3 Factory on Base
    wethAddress = "0x4200000000000000000000000000000000000006"; // WETH on Base
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
    usdtAddress = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"; // USDT on Base
    daiAddress = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"; // DAI on Base
  } else {
    throw new Error(`Unsupported network: ${network.name} (${network.chainId})`);
  }

  // Deploy parameters
  const targetRTD = hre.ethers.parseEther("1.0"); // 100% reserve to debt ratio

  console.log("\nDeployment parameters:");
  console.log(`- AssurancePool: ${assurancePoolDeployment.address}`);
  console.log(`- TokenRegistry: ${tokenRegistryDeployment.address}`);
  console.log(`- Target RTD: ${hre.ethers.formatEther(targetRTD)} (100%)`);
  console.log(`- Uniswap Factory: ${uniswapFactoryAddress}`);
  console.log(`- WETH: ${wethAddress}`);
  console.log(`- USDC: ${usdcAddress}`);
  console.log(`- USDT: ${usdtAddress}`);
  console.log(`- DAI: ${daiAddress}`);

  // Deploy the contract
  console.log("\nDeploying AssuranceOracle...");
  const AssuranceOracle = await hre.ethers.getContractFactory("AssuranceOracle");
  const assuranceOracle = await AssuranceOracle.deploy(
    assurancePoolDeployment.address,
    targetRTD,
    uniswapFactoryAddress,
    wethAddress,
    usdcAddress,
    usdtAddress,
    daiAddress,
    tokenRegistryDeployment.address
  );

  await assuranceOracle.waitForDeployment();
  const assuranceOracleAddress = await assuranceOracle.getAddress();
  console.log("✓ AssuranceOracle deployed to:", assuranceOracleAddress);

  // Verify the deployment
  console.log("\nVerifying deployment...");
  const targetRTDValue = await assuranceOracle.targetRTD();
  const uniswapFactory = await assuranceOracle.uniswapFactory();
  const weth = await assuranceOracle.WETH_ADDRESS();
  const usdc = await assuranceOracle.USDC_ADDRESS();
  
  console.log(`- Target RTD: ${hre.ethers.formatEther(targetRTDValue)} (${targetRTDValue === targetRTD ? "✓" : "✗"})`);
  console.log(`- Uniswap Factory: ${uniswapFactory} (${uniswapFactory === uniswapFactoryAddress ? "✓" : "✗"})`);
  console.log(`- WETH: ${weth} (${weth === wethAddress ? "✓" : "✗"})`);
  console.log(`- USDC: ${usdc} (${usdc === usdcAddress ? "✓" : "✗"})`);

  // Test whitelist status
  console.log("\nTesting token whitelist...");
  const usdcWhitelisted = await assuranceOracle.isTokenWhitelisted(usdcAddress);
  const usdtWhitelisted = await assuranceOracle.isTokenWhitelisted(usdtAddress);
  const daiWhitelisted = await assuranceOracle.isTokenWhitelisted(daiAddress);
  
  console.log(`- USDC whitelisted: ${usdcWhitelisted ? "✓" : "✗"}`);
  console.log(`- USDT whitelisted: ${usdtWhitelisted ? "✓" : "✗"}`);
  console.log(`- DAI whitelisted: ${daiWhitelisted ? "✓" : "✗"}`);

  // Test price functions
  console.log("\nTesting price functions...");
  try {
    const usdcPrice = await assuranceOracle.getTokenPriceInUSD(usdcAddress);
    const usdcPriceSource = await assuranceOracle.getPriceSource(usdcAddress);
    console.log(`- USDC price: $${hre.ethers.formatEther(usdcPrice)} (source: ${usdcPriceSource})`);
    
    const wethPrice = await assuranceOracle.getTokenPriceInUSD(wethAddress);
    const wethPriceSource = await assuranceOracle.getPriceSource(wethAddress);
    console.log(`- WETH price: $${hre.ethers.formatEther(wethPrice)} (source: ${wethPriceSource})`);
  } catch (error: any) {
    console.log("Price query failed:", error.message);
  }

  // Now set the oracle in AssurancePool
  console.log("\nConfiguring AssurancePool...");
  try {
    const AssurancePoolContract = await hre.ethers.getContractAt("AssurancePool", assurancePoolDeployment.address);
    await AssurancePoolContract.setAssuranceOracle(assuranceOracleAddress);
    console.log("✓ AssuranceOracle set in AssurancePool");
  } catch (error: any) {
    console.log("⚠️  Failed to set oracle in AssurancePool:", error.message);
    console.log("   You may need to set it manually with proper permissions");
  }

  // Save deployment information
  const assuranceOracleAbi = JSON.parse(assuranceOracle.interface.formatJson());
  saveDeployment(
    network.name,
    "AssuranceOracle",
    assuranceOracleAddress,
    assuranceOracleAbi
  );
  console.log("\n✓ Deployment information saved for AssuranceOracle");

  console.log("\n✅ AssuranceOracle deployment complete!");

  return {
    assuranceOracle: assuranceOracleAddress,
    assurancePool: assurancePoolDeployment.address,
    tokenRegistry: tokenRegistryDeployment.address,
    uniswapFactory: uniswapFactoryAddress,
    tokens: {
      weth: wethAddress,
      usdc: usdcAddress,
      usdt: usdtAddress,
      dai: daiAddress,
    }
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

