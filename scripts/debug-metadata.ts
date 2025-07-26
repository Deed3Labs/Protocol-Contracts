import { ethers } from "hardhat";

async function main() {
  console.log("🔍 Debugging MetadataRenderer and DeedNFT integration...");

  // Get the signer
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);

  // Get deployed contract addresses from deployment files
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === "unknown" ? "base-sepolia" : network.name;
  
  console.log("Network:", networkName);

  // Try to get deployed addresses
  let deedNFTAddress: string;
  let metadataRendererAddress: string;
  
  try {
    const fs = require("fs");
    const path = require("path");
    
    const deedNFTDeployment = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../deployments", networkName, "DeedNFT.json")
      )
    );
    deedNFTAddress = deedNFTDeployment.address;
    
    const metadataRendererDeployment = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../deployments", networkName, "MetadataRenderer.json")
      )
    );
    metadataRendererAddress = metadataRendererDeployment.address;
    
    console.log("📋 Found deployed contracts:");
    console.log("  DeedNFT:", deedNFTAddress);
    console.log("  MetadataRenderer:", metadataRendererAddress);
  } catch (error) {
    console.log("❌ Could not read deployment files:", error);
    return;
  }

  // Get contract instances with proper typing
  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
  
  const deedNFT = DeedNFT.attach(deedNFTAddress) as any;
  const metadataRenderer = MetadataRenderer.attach(metadataRendererAddress) as any;

  console.log("\n🔍 Testing contract configuration...");

  // Check if MetadataRenderer is set in DeedNFT
  try {
    const rendererAddress = await deedNFT.metadataRenderer();
    console.log("✅ MetadataRenderer address in DeedNFT:", rendererAddress);
    console.log("   Expected:", metadataRendererAddress);
    console.log("   Match:", rendererAddress.toLowerCase() === metadataRendererAddress.toLowerCase());
  } catch (error) {
    console.log("❌ Error getting MetadataRenderer from DeedNFT:", error);
  }

  // Check if DeedNFT is set in MetadataRenderer
  try {
    const deedNFTAddressInRenderer = await metadataRenderer.deedNFT();
    console.log("✅ DeedNFT address in MetadataRenderer:", deedNFTAddressInRenderer);
    console.log("   Expected:", deedNFTAddress);
    console.log("   Match:", deedNFTAddressInRenderer.toLowerCase() === deedNFTAddress.toLowerCase());
  } catch (error) {
    console.log("❌ Error getting DeedNFT from MetadataRenderer:", error);
  }

  // Check if there are any minted tokens
  try {
    const totalSupply = await deedNFT.totalSupply();
    console.log("📊 Total supply:", totalSupply.toString());
    
    if (totalSupply > 0) {
      console.log("🔍 Testing metadata rendering for existing tokens...");
      
      // Test first few tokens
      const maxTokensToTest = Math.min(3, Number(totalSupply));
      
      for (let i = 0; i < maxTokensToTest; i++) {
        const tokenId = i + 1;
        console.log(`\n--- Testing Token ${tokenId} ---`);
        
        try {
          // Check if token exists
          const owner = await deedNFT.ownerOf(tokenId);
          console.log(`  Owner: ${owner}`);
          
          // Get token URI from DeedNFT
          const tokenURI = await deedNFT.tokenURI(tokenId);
          console.log(`  Token URI: ${tokenURI}`);
          
          // Try to decode the metadata
          if (tokenURI.startsWith('data:application/json;base64,')) {
            try {
              const base64Data = tokenURI.replace('data:application/json;base64,', '');
              const jsonData = Buffer.from(base64Data, 'base64').toString();
              const metadata = JSON.parse(jsonData);
              console.log(`  ✅ Metadata decoded successfully:`);
              console.log(`    Name: ${metadata.name}`);
              console.log(`    Description: ${metadata.description}`);
              console.log(`    Image: ${metadata.image}`);
              if (metadata.attributes) {
                console.log(`    Attributes: ${metadata.attributes.length} found`);
                metadata.attributes.forEach((attr: any, index: number) => {
                  console.log(`      ${index + 1}. ${attr.trait_type}: ${attr.value}`);
                });
              }
            } catch (decodeError) {
              console.log(`  ❌ Failed to decode metadata:`, decodeError);
            }
          }
          
          // Test direct MetadataRenderer call
          try {
            const rendererURI = await metadataRenderer.tokenURI(tokenId);
            console.log(`  MetadataRenderer URI: ${rendererURI}`);
            
            // Compare with DeedNFT URI
            if (rendererURI === tokenURI) {
              console.log(`  ✅ URIs match`);
            } else {
              console.log(`  ❌ URIs don't match`);
            }
          } catch (rendererError) {
            console.log(`  ❌ MetadataRenderer.tokenURI failed:`, rendererError);
          }
          
          // Test trait retrieval
          try {
            const traitKeys = await deedNFT.getTraitKeys(tokenId);
            console.log(`  Trait keys found: ${traitKeys.length}`);
            traitKeys.forEach((key: string, index: number) => {
              console.log(`    ${index + 1}. ${key}`);
            });
          } catch (traitError) {
            console.log(`  ❌ Error getting trait keys:`, traitError);
          }
          
        } catch (tokenError) {
          console.log(`  ❌ Error testing token ${tokenId}:`, tokenError);
        }
      }
    } else {
      console.log("📝 No tokens minted yet. Testing with a new mint...");
      
      // Try to mint a test token
      try {
        const Validator = await ethers.getContractFactory("Validator");
        const validatorAddress = "0x0000000000000000000000000000000000000000"; // Placeholder
        
        console.log("🔧 Attempting to mint test token...");
        
        // Check if deployer has MINTER_ROLE
        const MINTER_ROLE = await deedNFT.MINTER_ROLE();
        const hasMinterRole = await deedNFT.hasRole(MINTER_ROLE, deployer.address);
        console.log(`  Deployer has MINTER_ROLE: ${hasMinterRole}`);
        
        if (hasMinterRole) {
          const mintTx = await deedNFT.mintAsset(
            deployer.address,
            0, // Land type
            "ipfs://test-metadata",
            "Test definition",
            "Test configuration",
            validatorAddress,
            ethers.ZeroAddress, // token address
            0n // salt
          );
          
          console.log("  Mint transaction hash:", mintTx.hash);
          const receipt = await mintTx.wait();
          console.log("  Mint successful! Gas used:", receipt.gasUsed.toString());
          
          // Test the new token
          const newTokenId = 1;
          console.log(`\n--- Testing New Token ${newTokenId} ---`);
          
          const tokenURI = await deedNFT.tokenURI(newTokenId);
          console.log(`  Token URI: ${tokenURI}`);
          
          if (tokenURI.startsWith('data:application/json;base64,')) {
            try {
              const base64Data = tokenURI.replace('data:application/json;base64,', '');
              const jsonData = Buffer.from(base64Data, 'base64').toString();
              const metadata = JSON.parse(jsonData);
              console.log(`  ✅ New token metadata:`);
              console.log(`    Name: ${metadata.name}`);
              console.log(`    Description: ${metadata.description}`);
              console.log(`    Image: ${metadata.image}`);
            } catch (decodeError) {
              console.log(`  ❌ Failed to decode new token metadata:`, decodeError);
            }
          }
        } else {
          console.log("  ❌ Deployer doesn't have MINTER_ROLE");
        }
      } catch (mintError) {
        console.log("  ❌ Failed to mint test token:", mintError);
      }
    }
    
  } catch (error) {
    console.log("❌ Error checking total supply:", error);
  }

  console.log("\n🔍 Testing trait functionality...");
  
  // Test trait setting and retrieval
  try {
    const testTokenId = 1;
    
    // Check if token exists
    try {
      const owner = await deedNFT.ownerOf(testTokenId);
      console.log(`✅ Token ${testTokenId} exists, owner: ${owner}`);
      
      // Test trait setting
      console.log("🔧 Testing trait setting...");
      
      const traitName = "testTrait";
      const traitValue = "testValue";
      
      await deedNFT.setTrait(
        testTokenId,
        ethers.toUtf8Bytes(traitName),
        ethers.toUtf8Bytes(traitValue),
        1 // string type
      );
      
      console.log("✅ Trait set successfully");
      
      // Test trait retrieval
      const traitKey = ethers.keccak256(ethers.toUtf8Bytes(traitName));
      const retrievedValue = await deedNFT.getTraitValue(testTokenId, traitKey);
      
      if (retrievedValue.length > 0) {
        const decodedValue = ethers.AbiCoder.defaultAbiCoder().decode(["string"], retrievedValue)[0];
        console.log(`✅ Trait retrieved: ${decodedValue}`);
        console.log(`   Expected: ${traitValue}`);
        console.log(`   Match: ${decodedValue === traitValue}`);
      } else {
        console.log("❌ Trait value is empty");
      }
      
    } catch (tokenError) {
      console.log(`❌ Token ${testTokenId} doesn't exist or error:`, tokenError);
    }
    
  } catch (traitError) {
    console.log("❌ Error testing traits:", traitError);
  }

  console.log("\n🏁 Debug complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 