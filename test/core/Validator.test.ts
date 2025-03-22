import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

describe("Validator Contract", function() {
  let validator: any;
  let deedNFT: any;
  let validatorRegistry: any;
  let deployer: SignerWithAddress;
  let admin: SignerWithAddress;
  let validator1: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let VALIDATOR_ROLE: string;
  let METADATA_ROLE: string;
  
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, admin, validator1, user1, user2] = [
      signers[0], signers[1], signers[2], signers[3], signers[4]
    ];
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    // Deploy Validator first with correct parameters
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "https://api.example.com/metadata/",  // baseUri
      "https://api.example.com/agreements/" // defaultOperatingAgreementUri
    ]);
    await validator.waitForDeployment();
    
    // Deploy DeedNFT with correct parameters
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();
    
    // Update Validator with DeedNFT address
    await validator.setDeedNFT(await deedNFT.getAddress());
    
    // Get roles
    VALIDATOR_ROLE = await validator.VALIDATOR_ROLE();
    METADATA_ROLE = await validator.METADATA_ROLE();
    
    // Set up permissions
    await validator.grantRole(VALIDATOR_ROLE, validator1.address);
    
    // Register validator in registry
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      "Test Validator"
    );
    
    // Grant validator role on DeedNFT
    const DEED_VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
    await deedNFT.grantRole(DEED_VALIDATOR_ROLE, await validator.getAddress());
  });
  
  describe("Initialization", function() {
    it("should initialize with correct roles", async function() {
      expect(await validator.hasRole(VALIDATOR_ROLE, validator1.address)).to.be.true;
      expect(await validator.hasRole(METADATA_ROLE, deployer.address)).to.be.true;
    });
    
    it("should initialize with correct DeedNFT address", async function() {
      expect(await validator.deedNFT()).to.equal(await deedNFT.getAddress());
    });
  });
  
  describe("Validation Functionality", function() {
    let deedId: number;
    
    beforeEach(async function() {
      // Create a deed for testing
      // Use mintAsset instead of mint with the correct parameters
      const mintTx = await deedNFT.mintAsset(
        user1.address,
        0, // AssetType.Land
        "ipfs://metadata",
        "land definition",
        "land configuration",
        await validator.getAddress()
      );
      const receipt = await mintTx.wait();
      
      // Extract the token ID from the event
      const transferEvent = receipt.logs.find((e: any) => {
        try {
          const parsedLog = deedNFT.interface.parseLog({
            topics: e.topics,
            data: e.data
          });
          return parsedLog?.name === 'Transfer';
        } catch {
          return false;
        }
      });
      
      if (!transferEvent) {
        throw new Error("Transfer event not found");
      }
      
      const eventData = deedNFT.interface.parseLog({
        topics: transferEvent.topics,
        data: transferEvent.data
      });
      
      deedId = eventData?.args.tokenId;
    });
    
    it("should allow validator to validate a deed", async function() {
      // Validate the deed
      await validator.connect(validator1).validateDeed(deedId, true);
      
      // Check if the deed is validated
      const deedInfo = await deedNFT.getDeedInfo(deedId);
      expect(deedInfo.isValidated).to.be.true;
    });
    
    it("should emit an event when deed is validated", async function() {
      // Validate the deed and check for event
      await expect(validator.connect(validator1).validateDeed(deedId, true))
        .to.emit(validator, "DeedValidated")
        .withArgs(deedId, true, validator1.address);
    });
    
    it("should prevent non-validators from validating deeds", async function() {
      await expect(validator.connect(user1).validateDeed(deedId, true))
        .to.be.revertedWith("AccessControl");
    });
    
    it("should allow invalidating a previously validated deed", async function() {
      // First validate
      await validator.connect(validator1).validateDeed(deedId, true);
      
      // Then invalidate
      await validator.connect(validator1).validateDeed(deedId, false);
      
      // Check if the deed is now invalidated
      const deedInfo = await deedNFT.getDeedInfo(deedId);
      expect(deedInfo.isValidated).to.be.false;
    });
  });
  
  describe("Metadata Management", function() {
    let deedId: number;
    
    beforeEach(async function() {
      // Create a deed for testing
      const mintTx = await deedNFT.mintAsset(
        user1.address,
        0, // AssetType.Land
        "ipfs://metadata",
        "land definition",
        "land configuration",
        await validator.getAddress()
      );
      const receipt = await mintTx.wait();
      
      // Extract the token ID from the event
      const transferEvent = receipt.logs.find((e: any) => {
        try {
          const parsedLog = deedNFT.interface.parseLog({
            topics: e.topics,
            data: e.data
          });
          return parsedLog?.name === 'Transfer';
        } catch {
          return false;
        }
      });
      
      if (!transferEvent) {
        throw new Error("Transfer event not found");
      }
      
      const eventData = deedNFT.interface.parseLog({
        topics: transferEvent.topics,
        data: transferEvent.data
      });
      
      deedId = eventData?.args.tokenId;
    });
    
    it("should allow metadata manager to update deed metadata", async function() {
      const newMetadataURI = "ipfs://updatedMetadata";
      
      await validator.connect(deployer).updateDeedMetadata(deedId, newMetadataURI);
      
      // Verify the metadata was updated
      const deedInfo = await deedNFT.getDeedInfo(deedId);
      expect(deedInfo.metadataURI).to.equal(newMetadataURI);
    });
    
    it("should prevent non-metadata managers from updating metadata", async function() {
      const newMetadataURI = "ipfs://updatedMetadata";
      
      await expect(validator.connect(user1).updateDeedMetadata(deedId, newMetadataURI))
        .to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Contract Upgradeability", function() {
    it("should be upgradeable", async function() {
      // Test upgradeability by deploying a new implementation
      const ValidatorV2 = await ethers.getContractFactory("Validator");
      const upgradedValidator = await upgrades.upgradeProxy(
        await validator.getAddress(),
        ValidatorV2
      );
      
      // Verify the upgrade was successful
      expect(await upgradedValidator.getAddress()).to.equal(await validator.getAddress());
      
      // Verify state was preserved
      expect(await upgradedValidator.deedNFT()).to.equal(await deedNFT.getAddress());
      expect(await upgradedValidator.hasRole(VALIDATOR_ROLE, validator1.address)).to.be.true;
    });
  });
});
