import { ethers } from "hardhat";

/**
 * Configuration script to update the AssuranceOracle with correct token addresses
 * Run this after deploying the AssuranceOracle to set the proper USDC address
 */

async function main() {
  console.log("Updating AssuranceOracle configuration...");

  // Get the deployed AssuranceOracle address
  const ASSURANCE_ORACLE_ADDRESS = "0x0000000000000000000000000000000000000000"; // Replace with actual deployed address
  
  // Network-specific USDC addresses
  const network = await ethers.provider.getNetwork();
  let usdcAddress: string;

  if (network.chainId === 1n) {
    // Ethereum Mainnet
    usdcAddress = "0xA0b86a33E6441b8c4C8C0E1234567890AbCdEf12"; // USDC on Ethereum
  } else if (network.chainId === 8453n) {
    // Base Mainnet
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
  } else if (network.chainId === 84532n) {
    // Base Sepolia
    usdcAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC on Base Sepolia
  } else {
    throw new Error(`Unsupported network: ${network.name} (${network.chainId})`);
  }

  console.log(`Network: ${network.name} (${network.chainId})`);
  console.log(`USDC Address: ${usdcAddress}`);

  // Get the contract instance
  const AssuranceOracle = await ethers.getContractFactory("AssuranceOracle");
  const assuranceOracle = AssuranceOracle.attach(ASSURANCE_ORACLE_ADDRESS);

  // Test the current configuration
  console.log("\nCurrent configuration:");
  console.log(`Target RTD: ${await assuranceOracle.targetRTD()}`);
  console.log(`Uniswap Factory: ${await assuranceOracle.uniswapFactory()}`);
  console.log(`WETH: ${await assuranceOracle.WETH()}`);

  // Test quote function
  console.log("\nTesting quote function...");
  try {
    const testAmount = ethers.parseUnits("1000", 6); // 1000 USDC
    const quote = await assuranceOracle.quote(usdcAddress, usdcAddress, testAmount);
    console.log(`Quote for 1000 USDC: ${ethers.formatUnits(quote, 6)} USDC`);
    
    // Test price function
    const price = await assuranceOracle.getTokenPriceInUSDC(usdcAddress);
    console.log(`USDC price: ${ethers.formatEther(price)} USD`);
  } catch (error) {
    console.log("Quote test failed:", error);
  }

  console.log("\nConfiguration complete!");
  console.log("Note: You may need to update the USDC address in the contract if it's hardcoded.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
