import { ethers } from "hardhat";

async function main() {
  console.log("🔍 Testing trait decoding...");

  // Get the signer
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);

  // Get deployed contract addresses
  const deedNFTAddress = "0x1a4e89225015200f70e5a06f766399a3de6e21E6";
  const metadataRendererAddress = "0x849e13500658a789311923b86b0eB60a87C870E5";

  // Get contract instances with proper typing
  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
  
  const deedNFT = DeedNFT.attach(deedNFTAddress) as any;
  const metadataRenderer = MetadataRenderer.attach(metadataRendererAddress) as any;

  const tokenId = 1;

  console.log(`\n--- Testing Trait Decoding for Token ${tokenId} ---`);

  try {
    // Get trait keys and values
    const traitKeys = await deedNFT.getTraitKeys(tokenId);
    const traitValues = await deedNFT.getTraitValues(tokenId, traitKeys);
    
    console.log(`Found ${traitKeys.length} traits`);
    
    for (let i = 0; i < traitKeys.length; i++) {
      const key = traitKeys[i];
      const value = traitValues[i];
      
      console.log(`\nTrait ${i + 1}: ${key}`);
      console.log(`  Value length: ${value.length}`);
      console.log(`  Value: ${value}`);
      
      // Try to decode as different types
      try {
        const decodedUint8 = ethers.AbiCoder.defaultAbiCoder().decode(["uint8"], value);
        console.log(`  ✅ Decoded as uint8: ${decodedUint8[0]}`);
      } catch (error) {
        console.log(`  ❌ Failed to decode as uint8: ${(error as Error).message}`);
      }
      
      try {
        const decodedBool = ethers.AbiCoder.defaultAbiCoder().decode(["bool"], value);
        console.log(`  ✅ Decoded as bool: ${decodedBool[0]}`);
      } catch (error) {
        console.log(`  ❌ Failed to decode as bool: ${(error as Error).message}`);
      }
      
      try {
        const decodedAddress = ethers.AbiCoder.defaultAbiCoder().decode(["address"], value);
        console.log(`  ✅ Decoded as address: ${decodedAddress[0]}`);
      } catch (error) {
        console.log(`  ❌ Failed to decode as address: ${(error as Error).message}`);
      }
      
      try {
        const decodedString = ethers.AbiCoder.defaultAbiCoder().decode(["string"], value);
        console.log(`  ✅ Decoded as string: ${decodedString[0]}`);
      } catch (error) {
        console.log(`  ❌ Failed to decode as string: ${(error as Error).message}`);
      }
    }
    
    // Test specific trait decoding that might be causing issues
    console.log(`\n--- Testing Specific Trait Decoding ---`);
    
    const assetTypeKey = ethers.keccak256(ethers.toUtf8Bytes("assetType"));
    const isValidatedKey = ethers.keccak256(ethers.toUtf8Bytes("isValidated"));
    const definitionKey = ethers.keccak256(ethers.toUtf8Bytes("definition"));
    
    try {
      const assetTypeValue = await deedNFT.getTraitValue(tokenId, assetTypeKey);
      console.log(`AssetType value: ${assetTypeValue}`);
      if (assetTypeValue.length > 0) {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["uint8"], assetTypeValue);
        console.log(`✅ AssetType decoded: ${decoded[0]}`);
      }
    } catch (error) {
      console.log(`❌ AssetType error: ${(error as Error).message}`);
    }
    
    try {
      const isValidatedValue = await deedNFT.getTraitValue(tokenId, isValidatedKey);
      console.log(`IsValidated value: ${isValidatedValue}`);
      if (isValidatedValue.length > 0) {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["bool"], isValidatedValue);
        console.log(`✅ IsValidated decoded: ${decoded[0]}`);
      }
    } catch (error) {
      console.log(`❌ IsValidated error: ${(error as Error).message}`);
    }
    
    try {
      const definitionValue = await deedNFT.getTraitValue(tokenId, definitionKey);
      console.log(`Definition value: ${definitionValue}`);
      if (definitionValue.length > 0) {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["string"], definitionValue);
        console.log(`✅ Definition decoded: ${decoded[0]}`);
      }
    } catch (error) {
      console.log(`❌ Definition error: ${(error as Error).message}`);
    }
    
  } catch (error) {
    console.log(`❌ Error testing trait decoding: ${(error as Error).message}`);
  }

  console.log("\n🏁 Trait decoding test complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 