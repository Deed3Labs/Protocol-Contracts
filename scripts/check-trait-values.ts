import { ethers } from "hardhat";

async function main() {
  console.log("🔍 Checking actual trait values...");

  // Get the signer
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);

  // Get deployed contract addresses
  const deedNFTAddress = "0x1a4e89225015200f70e5a06f766399a3de6e21E6";

  // Get contract instances with proper typing
  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  const deedNFT = DeedNFT.attach(deedNFTAddress) as any;

  // Test tokens 2 and 3
  for (const tokenId of [2, 3]) {
    console.log(`\n--- Checking Token ${tokenId} Trait Values ---`);
    
    try {
      // Get all trait keys
      const traitKeys = await deedNFT.getTraitKeys(tokenId);
      console.log(`Found ${traitKeys.length} traits`);
      
      for (let i = 0; i < traitKeys.length; i++) {
        const key = traitKeys[i];
        const value = await deedNFT.getTraitValue(tokenId, key);
        
        console.log(`\nTrait ${i + 1}: ${key}`);
        console.log(`  Raw value: ${value}`);
        console.log(`  Length: ${value.length}`);
        console.log(`  Hex: ${ethers.hexlify(value)}`);
        
        if (value.length > 0) {
          // Try to decode as different types
          try {
            const decodedString = ethers.AbiCoder.defaultAbiCoder().decode(["string"], value);
            console.log(`  ✅ Decoded as string: "${decodedString[0]}"`);
          } catch (error) {
            console.log(`  ❌ Failed to decode as string: ${(error as Error).message}`);
          }
          
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
        }
      }
      
    } catch (error) {
      console.log(`❌ Error analyzing token ${tokenId}: ${(error as Error).message}`);
    }
  }

  console.log("\n🏁 Trait value check complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 