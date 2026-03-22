import { saveDeployment } from "./helpers";
import { assertChainHasTokenAddresses, requireChainConfigById } from "../config/chain-manifest-loader";

/**
 * Deploys the TokenRegistry contract
 * 
 * This contract:
 * - Manages whitelisted tokens for the protocol
 * - Stores token metadata and chain addresses
 * - Provides fallback pricing for tokens
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

  // Deploy TokenRegistry
  console.log("Deploying TokenRegistry...");
  const TokenRegistry = await hre.ethers.getContractFactory("TokenRegistry");
  const tokenRegistry = await TokenRegistry.deploy();
  await tokenRegistry.waitForDeployment();

  const tokenRegistryAddress = await tokenRegistry.getAddress();
  console.log("TokenRegistry deployed to:", tokenRegistryAddress);

  const chainConfig = requireChainConfigById(Number(network.chainId));
  assertChainHasTokenAddresses(chainConfig, ["usdc", "usdt", "dai", "weth"]);

  const usdcAddress = chainConfig.tokens.usdc;
  const usdtAddress = chainConfig.tokens.usdt;
  const daiAddress = chainConfig.tokens.dai;
  const wethAddress = chainConfig.tokens.weth;

  console.log("\nSetting up initial token configuration...");
  
  // Register USDC as stablecoin
  console.log("Registering USDC...");
  await tokenRegistry.setStablecoin(usdcAddress, true);
  await tokenRegistry.setTokenMetadata(usdcAddress, "USDC", "USD Coin", 6);
  await tokenRegistry.registerToken(
    usdcAddress,
    Number(network.chainId),
    usdcAddress,
    hre.ethers.parseEther("1") // $1 fallback price
  );
  console.log("✓ USDC registered");

  // Register USDT as stablecoin
  console.log("Registering USDT...");
  await tokenRegistry.setStablecoin(usdtAddress, true);
  await tokenRegistry.setTokenMetadata(usdtAddress, "USDT", "Tether USD", 6);
  await tokenRegistry.registerToken(
    usdtAddress,
    Number(network.chainId),
    usdtAddress,
    hre.ethers.parseEther("1") // $1 fallback price
  );
  console.log("✓ USDT registered");

  // Register DAI as stablecoin
  console.log("Registering DAI...");
  await tokenRegistry.setStablecoin(daiAddress, true);
  await tokenRegistry.setTokenMetadata(daiAddress, "DAI", "Dai Stablecoin", 18);
  await tokenRegistry.registerToken(
    daiAddress,
    Number(network.chainId),
    daiAddress,
    hre.ethers.parseEther("1") // $1 fallback price
  );
  console.log("✓ DAI registered");

  // Register WETH (not a stablecoin)
  console.log("Registering WETH...");
  await tokenRegistry.setTokenMetadata(wethAddress, "WETH", "Wrapped Ether", 18);
  await tokenRegistry.registerToken(
    wethAddress,
    Number(network.chainId),
    wethAddress,
    hre.ethers.parseEther("3000") // $3000 fallback price (approximate)
  );
  console.log("✓ WETH registered");

  // Verify configuration
  console.log("\nVerifying token configuration...");
  const whitelistedTokens = await tokenRegistry.getWhitelistedTokens();
  console.log(`Total whitelisted tokens: ${whitelistedTokens.length}`);
  
  for (const token of whitelistedTokens) {
    const isWhitelisted = await tokenRegistry.getIsWhitelisted(token);
    const isStablecoin = await tokenRegistry.getIsStablecoin(token);
    const tokenInfo = await tokenRegistry.getTokenInfo(token);
    const fallbackPrice = await tokenRegistry.getFallbackPrice(token);
    
    console.log(`\n  Token: ${token}`);
    console.log(`  - Whitelisted: ${isWhitelisted}`);
    console.log(`  - Stablecoin: ${isStablecoin}`);
    console.log(`  - Symbol: ${tokenInfo.symbol}`);
    console.log(`  - Name: ${tokenInfo.name}`);
    console.log(`  - Decimals: ${tokenInfo.decimals}`);
    console.log(`  - Fallback Price: ${hre.ethers.formatEther(fallbackPrice)} USD`);
  }

  // Save deployment information
  const tokenRegistryAbi = JSON.parse(tokenRegistry.interface.formatJson());
  saveDeployment(
    network.name,
    "TokenRegistry",
    tokenRegistryAddress,
    tokenRegistryAbi
  );
  console.log("\n✓ Deployment information saved for TokenRegistry");

  return {
    tokenRegistry: tokenRegistryAddress,
    tokens: {
      usdc: usdcAddress,
      usdt: usdtAddress,
      dai: daiAddress,
      weth: wethAddress,
    }
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
