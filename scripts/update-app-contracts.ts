import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🔄 Updating app contract files...");

  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // New MetadataRenderer address
  const newMetadataRendererAddress = "0xAc50869E89004aa25A8c1044195AC760A7FC48BE";
  
  try {
    // 1. Read the new ABI from artifacts
    console.log("\n1. Reading new MetadataRenderer ABI...");
    const artifactPath = path.join(__dirname, "../artifacts/contracts/core/MetadataRenderer.sol/MetadataRenderer.json");
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const newAbi = JSON.stringify(artifact.abi);
    
    console.log("✅ New ABI loaded");

    // 2. Update the app MetadataRenderer.json file
    console.log("\n2. Updating app MetadataRenderer.json...");
    const appMetadataRendererPath = path.join(__dirname, "../app/src/contracts/base-sepolia/MetadataRenderer.json");
    
    const appMetadataRenderer = {
      address: newMetadataRendererAddress,
      abi: newAbi,
      blockNumber: 0
    };
    
    fs.writeFileSync(appMetadataRendererPath, JSON.stringify(appMetadataRenderer, null, 2));
    console.log("✅ Updated app MetadataRenderer.json");

    // 3. Check if there are any other contract files that need updating
    console.log("\n3. Checking for other contract files...");
    const contractsDir = path.join(__dirname, "../app/src/contracts/base-sepolia");
    const files = fs.readdirSync(contractsDir);
    
    console.log("Contract files in app:", files);

    // 4. Update networks.ts if it contains hardcoded addresses
    console.log("\n4. Checking networks.ts for hardcoded addresses...");
    const networksPath = path.join(__dirname, "../app/src/config/networks.ts");
    
    if (fs.existsSync(networksPath)) {
      let networksContent = fs.readFileSync(networksPath, "utf8");
      
      // Check if it contains the old MetadataRenderer address
      const oldAddress = "0x849e13500658a789311923b86b0eB60a87C870E5";
      if (networksContent.includes(oldAddress)) {
        networksContent = networksContent.replace(new RegExp(oldAddress, "g"), newMetadataRendererAddress);
        fs.writeFileSync(networksPath, networksContent);
        console.log("✅ Updated networks.ts with new MetadataRenderer address");
      } else {
        console.log("ℹ️  No hardcoded MetadataRenderer address found in networks.ts");
      }
    }

    // 5. Check for any TypeScript files that might reference the old address
    console.log("\n5. Checking for TypeScript files with hardcoded addresses...");
    const srcDir = path.join(__dirname, "../app/src");
    
    function updateAddressesInFile(filePath: string) {
      if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, "utf8");
        const oldAddress = "0x849e13500658a789311923b86b0eB60a87C870E5";
        
        if (content.includes(oldAddress)) {
          content = content.replace(new RegExp(oldAddress, "g"), newMetadataRendererAddress);
          fs.writeFileSync(filePath, content);
          console.log(`✅ Updated ${path.relative(__dirname, filePath)}`);
          return true;
        }
      }
      return false;
    }

    // Check common files that might contain addresses
    const filesToCheck = [
      "app/src/hooks/useDeedNFTData.ts",
      "app/src/components/DeedNFTViewer.tsx",
      "app/src/components/MintForm.tsx",
      "app/src/App.tsx"
    ];

    let updatedFiles = 0;
    for (const file of filesToCheck) {
      if (updateAddressesInFile(path.join(__dirname, "..", file))) {
        updatedFiles++;
      }
    }

    if (updatedFiles > 0) {
      console.log(`✅ Updated ${updatedFiles} TypeScript files`);
    } else {
      console.log("ℹ️  No TypeScript files found with hardcoded addresses");
    }

    console.log("\n🎉 Update Summary:");
    console.log("==================");
    console.log("New MetadataRenderer Address:", newMetadataRendererAddress);
    console.log("Updated files:");
    console.log("  - app/src/contracts/base-sepolia/MetadataRenderer.json");
    console.log("  - app/src/config/networks.ts (if contained old address)");
    console.log("  - TypeScript files (if contained old address)");

  } catch (error) {
    console.error("\n❌ Update failed!");
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