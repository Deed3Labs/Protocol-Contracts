import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Deploying updated MetadataRenderer...");

  // Get the hardhat runtime environment
  const hre = require("hardhat");
  
  // Get the signer
  const [deployer] = await hre.ethers.getSigners();
  console.log("Using account:", deployer.address);

  // Get deployed contract addresses
  const deedNFTAddress = "0x1a4e89225015200f70e5a06f766399a3de6e21E6";
  const validatorRegistryAddress = "0x18c53c0d046f98322954f971c21125e4443c79b9";

  try {
    // 1. Deploy updated MetadataRenderer
    console.log("\n1. Deploying updated MetadataRenderer...");
    const MetadataRenderer = await hre.ethers.getContractFactory("MetadataRenderer");
    const metadataRenderer = await hre.upgrades.deployProxy(MetadataRenderer, [], {
      initializer: "initialize",
      kind: "uups"
    });
    await metadataRenderer.waitForDeployment();
    const metadataRendererAddress = await metadataRenderer.getAddress();
    console.log("✅ Updated MetadataRenderer deployed to:", metadataRendererAddress);
    console.log("Transaction hash:", metadataRenderer.deploymentTransaction()?.hash);

    // 2. Setup initial roles for MetadataRenderer
    console.log("\n2. Setting up roles for MetadataRenderer...");
    const VALIDATOR_ROLE = await metadataRenderer.VALIDATOR_ROLE();
    const grantValidatorRoleTx = await metadataRenderer.grantRole(VALIDATOR_ROLE, deployer.address);
    await grantValidatorRoleTx.wait();
    console.log("✅ Granted VALIDATOR_ROLE to deployer");

    // 3. Set DeedNFT in MetadataRenderer
    console.log("\n3. Setting DeedNFT in MetadataRenderer...");
    const setDeedNFTInRendererTx = await metadataRenderer.setDeedNFT(deedNFTAddress);
    await setDeedNFTInRendererTx.wait();
    console.log("✅ DeedNFT set in MetadataRenderer");

    // 4. Set default images for asset types in MetadataRenderer
    console.log("\n4. Setting default images in MetadataRenderer...");
    
    // Using real IPFS hashes for placeholder images
    const defaultImages = {
      land: "ipfs://bafkreihdwdcbvm3ph3hg4bxplmyqhybmuwgiaroxnqmup76ixlqy4pf6gi", // Simple land image
      vehicle: "ipfs://bafkreig42cjzl6gn4w7q4sltmildfyh3m3wojrjp4egoqvfnxqcrmv5z3i", // Simple vehicle image
      equipment: "ipfs://bafkreifo4ugpkguglxwalzrznhvip5gqvgzqyqcqvz2lecwubsu7t4qhyq", // Simple equipment image
      invalidated: "ipfs://bafkreiabag3ztnhe5pg7js4bj6sxuvkz3sdf34utvoyk7q7bhngrgxqxym" // Invalid/placeholder image
    };
    
    // Set asset type images
    await metadataRenderer.setAssetTypeImageURI(0, defaultImages.land);
    console.log("✅ Set default image for Land (type 0)");
    
    await metadataRenderer.setAssetTypeImageURI(1, defaultImages.vehicle);
    console.log("✅ Set default image for Vehicle (type 1)");
    
    await metadataRenderer.setAssetTypeImageURI(2, defaultImages.land); // Estate uses same as Land
    console.log("✅ Set default image for Estate (type 2)");
    
    await metadataRenderer.setAssetTypeImageURI(3, defaultImages.equipment);
    console.log("✅ Set default image for Equipment (type 3)");
    
    // Set invalidated image
    await metadataRenderer.setInvalidatedImageURI(defaultImages.invalidated);
    console.log("✅ Set default image for invalidated tokens");

    // 5. Update DeedNFT to use new MetadataRenderer
    console.log("\n5. Updating DeedNFT to use new MetadataRenderer...");
    const DeedNFT = await hre.ethers.getContractFactory("DeedNFT");
    const deedNFT = DeedNFT.attach(deedNFTAddress);
    
    const setMetadataRendererTx = await deedNFT.setMetadataRenderer(metadataRendererAddress);
    await setMetadataRendererTx.wait();
    console.log("✅ MetadataRenderer updated in DeedNFT");
    console.log("Transaction hash:", setMetadataRendererTx.hash);

    // 6. Test the updated name generation
    console.log("\n6. Testing updated name generation...");
    
    // Test Token 2 (should now show "Land #2" instead of "Asset #2")
    try {
      const tokenURI2 = await deedNFT.tokenURI(2);
      console.log("Token 2 URI:", tokenURI2);
      
      if (tokenURI2.startsWith("data:application/json;base64,")) {
        const base64Data = tokenURI2.substring(29);
        const jsonData = Buffer.from(base64Data, 'base64').toString();
        const metadata = JSON.parse(jsonData);
        console.log("Token 2 name:", metadata.name);
        console.log("✅ Expected: 'Land #2', Got:", metadata.name);
      }
    } catch (error) {
      console.log("❌ Error testing Token 2:", (error as Error).message);
    }

    // Test Token 3 (should now show "Vehicle #3" instead of "Asset #3")
    try {
      const tokenURI3 = await deedNFT.tokenURI(3);
      console.log("Token 3 URI:", tokenURI3);
      
      if (tokenURI3.startsWith("data:application/json;base64,")) {
        const base64Data = tokenURI3.substring(29);
        const jsonData = Buffer.from(base64Data, 'base64').toString();
        const metadata = JSON.parse(jsonData);
        console.log("Token 3 name:", metadata.name);
        console.log("✅ Expected: 'Vehicle #3', Got:", metadata.name);
      }
    } catch (error) {
      console.log("❌ Error testing Token 3:", (error as Error).message);
    }

    console.log("\n🎉 Deployment Summary:");
    console.log("========================");
    console.log("Updated MetadataRenderer:", metadataRendererAddress);
    console.log("DeedNFT:", deedNFTAddress);
    console.log("ValidatorRegistry:", validatorRegistryAddress);

  } catch (error) {
    console.error("\n❌ Deployment failed!");
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