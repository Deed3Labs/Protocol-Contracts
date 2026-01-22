import { getDeployment } from "./helpers";

/**
 * Verification script to check all BurnerBond system deployments
 * 
 * Verifies:
 * - All contracts are deployed
 * - Contract addresses are valid
 * - Contract relationships are properly configured
 * - Token whitelist is set up
 */
async function main() {
  const hre = require("hardhat");
  
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🔍 BurnerBond System Verification");
  console.log("═══════════════════════════════════════════════════════════\n");

  const network = await hre.ethers.provider.getNetwork();
  console.log("Network:", network.name, "(chainId:", network.chainId, ")\n");

  const deploymentStatus: any = {
    contracts: {},
    relationships: {},
    configuration: {},
    errors: []
  };

  try {
    // ═══════════════════════════════════════════════════════════
    // 1. Check Contract Deployments
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────┐");
    console.log("│ 1️⃣  Checking Contract Deployments                        │");
    console.log("└─────────────────────────────────────────────────────────┘\n");

    const contracts = [
      "TokenRegistry",
      "AssurancePool",
      "AssuranceOracle",
      "BurnerBondFactory",
      "BurnerBondDeposit"
    ];

    for (const contractName of contracts) {
      const deployment = getDeployment(network.name, contractName);
      if (deployment) {
        deploymentStatus.contracts[contractName] = {
          address: deployment.address,
          deployed: true
        };
        console.log(`✓ ${contractName.padEnd(20)} ${deployment.address}`);
      } else {
        deploymentStatus.contracts[contractName] = {
          address: null,
          deployed: false
        };
        deploymentStatus.errors.push(`Missing deployment: ${contractName}`);
        console.log(`✗ ${contractName.padEnd(20)} NOT DEPLOYED`);
      }
    }

    // Check for optional collection deployments
    const collectionDeployment = getDeployment(network.name, "BurnerBond_USDC");
    if (collectionDeployment) {
      deploymentStatus.contracts["BurnerBond_USDC"] = {
        address: collectionDeployment.address,
        deployed: true
      };
      console.log(`✓ ${"BurnerBond_USDC".padEnd(20)} ${collectionDeployment.address}`);
    }

    console.log();

    // ═══════════════════════════════════════════════════════════
    // 2. Verify Contract Relationships
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────┐");
    console.log("│ 2️⃣  Verifying Contract Relationships                     │");
    console.log("└─────────────────────────────────────────────────────────┘\n");

    // Check AssurancePool has AssuranceOracle set
    if (deploymentStatus.contracts.AssurancePool?.deployed && 
        deploymentStatus.contracts.AssuranceOracle?.deployed) {
      try {
        const AssurancePool = await hre.ethers.getContractAt(
          "AssurancePool",
          deploymentStatus.contracts.AssurancePool.address
        );
        const oracleAddress = await AssurancePool.assuranceOracle();
        
        if (oracleAddress === deploymentStatus.contracts.AssuranceOracle.address) {
          console.log("✓ AssurancePool → AssuranceOracle link verified");
          deploymentStatus.relationships.poolToOracle = true;
        } else {
          console.log("✗ AssurancePool oracle mismatch");
          console.log(`  Expected: ${deploymentStatus.contracts.AssuranceOracle.address}`);
          console.log(`  Got:      ${oracleAddress}`);
          deploymentStatus.relationships.poolToOracle = false;
          deploymentStatus.errors.push("AssurancePool oracle mismatch");
        }
      } catch (error: any) {
        console.log("✗ Failed to verify AssurancePool → AssuranceOracle:", error.message);
        deploymentStatus.errors.push("Failed to verify pool-oracle link");
      }
    }

    // Check AssuranceOracle has TokenRegistry
    if (deploymentStatus.contracts.AssuranceOracle?.deployed &&
        deploymentStatus.contracts.TokenRegistry?.deployed) {
      try {
        const AssuranceOracle = await hre.ethers.getContractAt(
          "AssuranceOracle",
          deploymentStatus.contracts.AssuranceOracle.address
        );
        const registryAddress = await AssuranceOracle.tokenRegistry();
        
        if (registryAddress === deploymentStatus.contracts.TokenRegistry.address) {
          console.log("✓ AssuranceOracle → TokenRegistry link verified");
          deploymentStatus.relationships.oracleToRegistry = true;
        } else {
          console.log("✗ AssuranceOracle TokenRegistry mismatch");
          deploymentStatus.relationships.oracleToRegistry = false;
          deploymentStatus.errors.push("AssuranceOracle TokenRegistry mismatch");
        }
      } catch (error: any) {
        console.log("✗ Failed to verify AssuranceOracle → TokenRegistry:", error.message);
        deploymentStatus.errors.push("Failed to verify oracle-registry link");
      }
    }

    // Check BurnerBondFactory references
    if (deploymentStatus.contracts.BurnerBondFactory?.deployed) {
      try {
        const BurnerBondFactory = await hre.ethers.getContractAt(
          "BurnerBondFactory",
          deploymentStatus.contracts.BurnerBondFactory.address
        );
        
        const poolAddress = await BurnerBondFactory.assurancePool();
        const oracleAddress = await BurnerBondFactory.assuranceOracle();
        
        if (poolAddress === deploymentStatus.contracts.AssurancePool?.address) {
          console.log("✓ BurnerBondFactory → AssurancePool link verified");
          deploymentStatus.relationships.factoryToPool = true;
        } else {
          console.log("✗ BurnerBondFactory AssurancePool mismatch");
          deploymentStatus.relationships.factoryToPool = false;
          deploymentStatus.errors.push("BurnerBondFactory pool mismatch");
        }
        
        if (oracleAddress === deploymentStatus.contracts.AssuranceOracle?.address) {
          console.log("✓ BurnerBondFactory → AssuranceOracle link verified");
          deploymentStatus.relationships.factoryToOracle = true;
        } else {
          console.log("✗ BurnerBondFactory AssuranceOracle mismatch");
          deploymentStatus.relationships.factoryToOracle = false;
          deploymentStatus.errors.push("BurnerBondFactory oracle mismatch");
        }
      } catch (error: any) {
        console.log("✗ Failed to verify BurnerBondFactory links:", error.message);
        deploymentStatus.errors.push("Failed to verify factory links");
      }
    }

    console.log();

    // ═══════════════════════════════════════════════════════════
    // 3. Check Configuration
    // ═══════════════════════════════════════════════════════════
    console.log("┌─────────────────────────────────────────────────────────┐");
    console.log("│ 3️⃣  Checking Configuration                               │");
    console.log("└─────────────────────────────────────────────────────────┘\n");

    // Check TokenRegistry has whitelisted tokens
    if (deploymentStatus.contracts.TokenRegistry?.deployed) {
      try {
        const TokenRegistry = await hre.ethers.getContractAt(
          "TokenRegistry",
          deploymentStatus.contracts.TokenRegistry.address
        );
        
        const whitelistedTokens = await TokenRegistry.getWhitelistedTokens();
        deploymentStatus.configuration.whitelistedTokenCount = whitelistedTokens.length;
        
        console.log(`✓ TokenRegistry has ${whitelistedTokens.length} whitelisted tokens`);
        
        for (const token of whitelistedTokens) {
          const tokenInfo = await TokenRegistry.getTokenInfo(token);
          console.log(`  - ${tokenInfo.symbol}: ${token}`);
        }
      } catch (error: any) {
        console.log("✗ Failed to check whitelisted tokens:", error.message);
        deploymentStatus.errors.push("Failed to check whitelisted tokens");
      }
    }

    // Check BurnerBondFactory parameters
    if (deploymentStatus.contracts.BurnerBondFactory?.deployed) {
      try {
        const BurnerBondFactory = await hre.ethers.getContractAt(
          "BurnerBondFactory",
          deploymentStatus.contracts.BurnerBondFactory.address
        );
        
        const maxDiscount = await BurnerBondFactory.getMaxDiscount();
        const maxMaturity = await BurnerBondFactory.getMaxMaturity();
        const collectionCount = await BurnerBondFactory.getCollectionCount();
        
        deploymentStatus.configuration.maxDiscount = maxDiscount.toString();
        deploymentStatus.configuration.maxMaturity = maxMaturity.toString();
        deploymentStatus.configuration.collectionCount = collectionCount.toString();
        
        console.log(`\n✓ BurnerBondFactory Configuration:`);
        console.log(`  - Max Discount: ${Number(maxDiscount) / 100}%`);
        console.log(`  - Max Maturity: ${Number(maxMaturity) / (365 * 24 * 60 * 60)} years`);
        console.log(`  - Collections: ${collectionCount}`);
      } catch (error: any) {
        console.log("✗ Failed to check factory parameters:", error.message);
        deploymentStatus.errors.push("Failed to check factory parameters");
      }
    }

    // Check AssuranceOracle target RTD
    if (deploymentStatus.contracts.AssuranceOracle?.deployed) {
      try {
        const AssuranceOracle = await hre.ethers.getContractAt(
          "AssuranceOracle",
          deploymentStatus.contracts.AssuranceOracle.address
        );
        
        const targetRTD = await AssuranceOracle.targetRTD();
        deploymentStatus.configuration.targetRTD = hre.ethers.formatEther(targetRTD);
        
        console.log(`\n✓ AssuranceOracle Target RTD: ${hre.ethers.formatEther(targetRTD)} (${Number(targetRTD) / 1e16}%)`);
      } catch (error: any) {
        console.log("✗ Failed to check target RTD:", error.message);
        deploymentStatus.errors.push("Failed to check target RTD");
      }
    }

    console.log();

    // ═══════════════════════════════════════════════════════════
    // 4. Summary
    // ═══════════════════════════════════════════════════════════
    console.log("═══════════════════════════════════════════════════════════");
    console.log("📊 Verification Summary");
    console.log("═══════════════════════════════════════════════════════════\n");

    const contractsDeployed = Object.values(deploymentStatus.contracts).filter((c: any) => c.deployed).length;
    const totalContracts = Object.keys(deploymentStatus.contracts).length;
    
    console.log(`Contracts:     ${contractsDeployed}/${totalContracts} deployed`);
    console.log(`Relationships: ${Object.values(deploymentStatus.relationships).filter(Boolean).length} verified`);
    console.log(`Errors:        ${deploymentStatus.errors.length} found`);

    if (deploymentStatus.errors.length > 0) {
      console.log("\n⚠️  Issues Found:");
      deploymentStatus.errors.forEach((error: string) => {
        console.log(`  - ${error}`);
      });
    }

    console.log("\n" + "═══════════════════════════════════════════════════════════");
    
    if (deploymentStatus.errors.length === 0 && contractsDeployed === totalContracts) {
      console.log("✅ All systems operational!");
    } else if (contractsDeployed === totalContracts) {
      console.log("⚠️  Deployment complete but with warnings");
    } else {
      console.log("❌ Deployment incomplete or has errors");
    }
    console.log("═══════════════════════════════════════════════════════════\n");

    return deploymentStatus;

  } catch (error) {
    console.error("\n❌ Verification failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

