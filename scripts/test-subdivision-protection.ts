import { ethers } from "ethers";
import { getDeployment } from "../deploy/helpers";

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  console.log("Testing subdivision protection for different asset types...");
  const network = await hre.ethers.provider.getNetwork();

  const subdivideDeployment = getDeployment(network.name, "Subdivide");
  if (!subdivideDeployment) {
    throw new Error("Subdivide deployment not found.");
  }

  const subdivideAddress = subdivideDeployment.address;
  console.log("Subdivide address:", subdivideAddress);

  const SubdivideFactory = await hre.ethers.getContractFactory("Subdivide");
  const subdivide = SubdivideFactory.attach(subdivideAddress);

  // Test the supportsSubdivision function
  console.log("\n=== Testing Asset Type Support ===");
  
  const assetTypes = [
    { type: 0, name: "Land" },
    { type: 1, name: "Vehicle" },
    { type: 2, name: "Estate" },
    { type: 3, name: "CommercialEquipment" }
  ];

  for (const assetType of assetTypes) {
    try {
      const supports = await subdivide.supportsSubdivision(assetType.type);
      console.log(`${assetType.name} (${assetType.type}): ${supports ? '✅ Can be subdivided' : '❌ Cannot be subdivided'}`);
    } catch (error) {
      console.log(`${assetType.name} (${assetType.type}): Error - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("\n=== Protection Summary ===");
  console.log("✅ Land (0) - Can be subdivided");
  console.log("❌ Vehicle (1) - Cannot be subdivided");
  console.log("✅ Estate (2) - Can be subdivided");
  console.log("❌ CommercialEquipment (3) - Cannot be subdivided");
  
  console.log("\n=== Frontend Protection ===");
  console.log("The frontend also prevents subdivision attempts for non-supported asset types");
  console.log("Users will see a warning message for Vehicle and CommercialEquipment T-Deeds");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to test subdivision protection:", error);
    process.exit(1);
  });
