import { saveDeployment, getDeployment } from "./helpers";

/**
 * Deploys the AssurancePool contract (upgradeable)
 * 
 * This contract:
 * - Manages primary, buffer, and excess reserves
 * - Handles multi-token deposits and withdrawals
 * - Maintains target Reserve-to-Debt (RTD) ratio
 * - Integrates with AssuranceOracle for pricing
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

  // Network-specific configuration
  let reserveTokenAddress: string;
  let stableCreditAddress: string;

  if (network.chainId === 84532n) {
    // Base Sepolia
    reserveTokenAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC on Base Sepolia
    // For testing, we'll use a placeholder for StableCredit
    // In production, this should be the actual StableCredit address
    stableCreditAddress = "0x0000000000000000000000000000000000000000"; // TODO: Replace with actual StableCredit
  } else if (network.chainId === 8453n) {
    // Base Mainnet
    reserveTokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
    stableCreditAddress = "0x0000000000000000000000000000000000000000"; // TODO: Replace with actual StableCredit
  } else {
    throw new Error(`Unsupported network: ${network.name} (${network.chainId})`);
  }

  console.log("\nDeployment parameters:");
  console.log(`- Reserve Token: ${reserveTokenAddress}`);
  console.log(`- StableCredit: ${stableCreditAddress}`);

  // Deploy AssurancePool as an upgradeable contract
  console.log("\nDeploying AssurancePool (upgradeable)...");
  const AssurancePool = await hre.ethers.getContractFactory("AssurancePool");
  
  const assurancePool = await hre.upgrades.deployProxy(
    AssurancePool,
    [stableCreditAddress, reserveTokenAddress],
    {
      initializer: "initialize",
      kind: "uups"
    }
  );
  
  await assurancePool.waitForDeployment();
  const assurancePoolAddress = await assurancePool.getAddress();
  console.log("✓ AssurancePool deployed to:", assurancePoolAddress);

  // Get the implementation address (for verification)
  const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(assurancePoolAddress);
  console.log("✓ Implementation address:", implementationAddress);

  // Set token addresses for withdrawal priority
  console.log("\nConfiguring token addresses...");
  const usdcAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const usdtAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const daiAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  
  await assurancePool.setTokenAddresses(usdcAddress, usdtAddress, daiAddress);
  console.log("✓ Token addresses configured");

  // Verify deployment
  console.log("\nVerifying deployment...");
  const reserveToken = await assurancePool.reserveToken();
  const primaryBalance = await assurancePool.primaryBalance();
  const bufferBalance = await assurancePool.bufferBalance();
  const excessBalance = await assurancePool.excessBalance();
  
  console.log(`- Reserve Token: ${reserveToken}`);
  console.log(`- Primary Balance: ${hre.ethers.formatUnits(primaryBalance, 6)} USDC`);
  console.log(`- Buffer Balance: ${hre.ethers.formatUnits(bufferBalance, 6)} USDC`);
  console.log(`- Excess Balance: ${hre.ethers.formatUnits(excessBalance, 6)} USDC`);

  // Save deployment information
  const assurancePoolAbi = JSON.parse(assurancePool.interface.formatJson());
  saveDeployment(
    network.name,
    "AssurancePool",
    assurancePoolAddress,
    assurancePoolAbi
  );
  console.log("\n✓ Deployment information saved for AssurancePool");

  console.log("\n⚠️  IMPORTANT: Remember to:");
  console.log("1. Set the AssuranceOracle address using setAssuranceOracle() (deploy 09_deploy_AssuranceOracle.ts next)");
  console.log("2. Update StableCredit address if using placeholder");
  console.log("3. Grant necessary roles for pool management");

  return {
    assurancePool: assurancePoolAddress,
    implementation: implementationAddress,
    reserveToken: reserveTokenAddress,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

