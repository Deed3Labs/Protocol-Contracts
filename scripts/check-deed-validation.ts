import { ethers } from "ethers";
import { getDeployment } from "../deploy/helpers";

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  console.log("Checking DeedNFT validation status...");
  const network = await hre.ethers.provider.getNetwork();

  const deedNFTDeployment = getDeployment(network.name, "DeedNFT");
  if (!deedNFTDeployment) {
    throw new Error("DeedNFT deployment not found.");
  }

  const deedNFTAddress = deedNFTDeployment.address;
  console.log("DeedNFT address:", deedNFTAddress);

  const DeedNFTFactory = await hre.ethers.getContractFactory("DeedNFT");
  const deedNFT = DeedNFTFactory.attach(deedNFTAddress);

  // Check if canSubdivide function exists
  try {
    // Try to call canSubdivide function
    const canSubdivide = await deedNFT.canSubdivide(1);
    console.log("canSubdivide function exists and returned:", canSubdivide);
  } catch (error) {
    console.log("canSubdivide function does not exist or failed:", error instanceof Error ? error.message : String(error));
  }

  // Check validation status for token ID 1
  try {
    const validationStatus = await deedNFT.getValidationStatus(1);
    console.log("Validation status for token 1:", validationStatus);
  } catch (error) {
    console.log("Failed to get validation status:", error instanceof Error ? error.message : String(error));
  }

  // Check if token exists
  try {
    const exists = await deedNFT._exists(1);
    console.log("Token 1 exists:", exists);
  } catch (error) {
    console.log("Failed to check if token exists:", error instanceof Error ? error.message : String(error));
  }

  // Check asset type
  try {
    const assetTypeBytes = await deedNFT.getTraitValue(1, ethers.keccak256(ethers.toUtf8Bytes("assetType")));
    if (assetTypeBytes.length > 0) {
      const assetType = ethers.getBytes(assetTypeBytes)[0];
      console.log("Asset type for token 1:", assetType);
      console.log("Can be subdivided (Land=0, Estate=2):", assetType === 0 || assetType === 2);
    } else {
      console.log("No asset type found for token 1");
    }
  } catch (error) {
    console.log("Failed to get asset type:", error instanceof Error ? error.message : String(error));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to check DeedNFT validation:", error);
    process.exit(1);
  });
