import { ethers } from "hardhat";

async function main() {
  console.log("Deploying AssuranceOracle...");

  // Network-specific addresses
  const network = await ethers.provider.getNetwork();
  console.log(`Deploying to network: ${network.name} (${network.chainId})`);

  // Get the contract factory
  const AssuranceOracle = await ethers.getContractFactory("AssuranceOracle");

  // Network-specific configuration
  let uniswapFactoryAddress: string;
  let wethAddress: string;
  let usdcAddress: string;
  let usdtAddress: string;
  let daiAddress: string;

  if (network.chainId === 1n) {
    // Ethereum Mainnet
    uniswapFactoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984"; // Uniswap V3 Factory
    wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH
    usdcAddress = "0xA0b86a33E6441b8c4C8C0E1234567890AbCdEf12"; // USDC
    usdtAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7"; // USDT
    daiAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F"; // DAI
  } else if (network.chainId === 8453n) {
    // Base Mainnet
    uniswapFactoryAddress = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"; // Uniswap V3 Factory on Base
    wethAddress = "0x4200000000000000000000000000000000000006"; // WETH on Base
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
    usdtAddress = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"; // USDT on Base
    daiAddress = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"; // DAI on Base (using USDT as placeholder)
  } else if (network.chainId === 84532n) {
    // Base Sepolia
    uniswapFactoryAddress = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"; // Uniswap V3 Factory on Base Sepolia
    wethAddress = "0x4200000000000000000000000000000000000006"; // WETH on Base Sepolia
    usdcAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC on Base Sepolia
    usdtAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDT on Base Sepolia (using USDC as placeholder)
    daiAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // DAI on Base Sepolia (using USDC as placeholder)
  } else {
    throw new Error(`Unsupported network: ${network.name} (${network.chainId})`);
  }

  // Deploy parameters
  const assurancePoolAddress = "0x0000000000000000000000000000000000000000"; // Replace with actual AssurancePool address
  const targetRTD = ethers.parseEther("1.0"); // 100% reserve to debt ratio

  console.log("Deployment parameters:");
  console.log(`- AssurancePool: ${assurancePoolAddress}`);
  console.log(`- Target RTD: ${targetRTD}`);
  console.log(`- Uniswap Factory: ${uniswapFactoryAddress}`);
  console.log(`- WETH: ${wethAddress}`);
  console.log(`- USDC: ${usdcAddress}`);
  console.log(`- USDT: ${usdtAddress}`);
  console.log(`- DAI: ${daiAddress}`);

  // Deploy the contract
  const assuranceOracle = await AssuranceOracle.deploy(
    assurancePoolAddress,
    targetRTD,
    uniswapFactoryAddress,
    wethAddress,
    usdcAddress,
    usdtAddress,
    daiAddress
  );

  await assuranceOracle.waitForDeployment();
  const address = await assuranceOracle.getAddress();

  console.log(`AssuranceOracle deployed to: ${address}`);

  // Verify the deployment
  console.log("Verifying deployment...");
  console.log(`Target RTD: ${await assuranceOracle.targetRTD()}`);
  console.log(`Uniswap Factory: ${await assuranceOracle.uniswapFactory()}`);
  console.log(`WETH Address: ${await assuranceOracle.WETH_ADDRESS()}`);
  console.log(`USDC Address: ${await assuranceOracle.USDC_ADDRESS()}`);
  console.log(`USDT Address: ${await assuranceOracle.USDT_ADDRESS()}`);
  console.log(`DAI Address: ${await assuranceOracle.DAI_ADDRESS()}`);

  // Test whitelist status
  console.log("\nTesting whitelist status...");
  console.log(`USDC whitelisted: ${await assuranceOracle.isTokenWhitelisted(usdcAddress)}`);
  console.log(`USDT whitelisted: ${await assuranceOracle.isTokenWhitelisted(usdtAddress)}`);
  console.log(`DAI whitelisted: ${await assuranceOracle.isTokenWhitelisted(daiAddress)}`);

  // Test quote function with USDC
  console.log("\nTesting quote function...");
  try {
    const testAmount = ethers.parseUnits("1000", 6); // 1000 USDC (6 decimals)
    const quote = await assuranceOracle.quote(usdcAddress, usdcAddress, testAmount);
    console.log(`Quote for 1000 USDC to USDC: ${ethers.formatUnits(quote, 6)} USDC`);
    
    // Test price functions
    const price = await assuranceOracle.getTokenPriceInUSD(usdcAddress);
    const priceSource = await assuranceOracle.getPriceSource(usdcAddress);
    console.log(`USDC price: ${ethers.formatEther(price)} USD (source: ${priceSource})`);
  } catch (error) {
    console.log("Quote test failed (expected if AssurancePool not set):", error);
  }

  return {
    assuranceOracle: address,
    uniswapFactory: uniswapFactoryAddress,
    weth: wethAddress,
    usdc: usdcAddress,
    usdt: usdtAddress,
    dai: daiAddress,
  };
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
