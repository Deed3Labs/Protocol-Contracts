import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

// Remove the import causing the error and use 'any' type instead
describe("ValidatorRegistry Contract", function() {
  // Use 'any' type for contracts to avoid TypeScript errors
  let validatorRegistry: any;
  let validator: any;
  let deedNFT: any;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let VALIDATOR_ADMIN_ROLE: string;
  
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user1 = signers[1];
    validator1 = signers[2]; 
    validator2 = signers[3];
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, ["DeedNFT", "DEED", await validatorRegistry.getAddress()]);
    await deedNFT.waitForDeployment();
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [await deedNFT.getAddress()]);
    await validator.waitForDeployment();
    
    // Get the admin role
    VALIDATOR_ADMIN_ROLE = await validatorRegistry.VALIDATOR_ADMIN_ROLE();
    
    // Grant validator admin role to deployer
    await validatorRegistry.grantRole(VALIDATOR_ADMIN_ROLE, deployer.address);
  });
  
  describe("Initialization", function() {
    it("should initialize with correct roles", async function() {
      expect(await validatorRegistry.hasRole(VALIDATOR_ADMIN_ROLE, deployer.address)).to.be.true;
    });
    
    it("should initialize with no validators", async function() {
      expect(await validatorRegistry.getValidatorCount()).to.equal(0);
    });
  });
  
  describe("Validator Registration", function() {
    it("should register a validator correctly", async function() {
      const validatorAddr = await validator.getAddress();
      const supportedAssetTypes = [0, 1]; // Land, Vehicle
      
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        supportedAssetTypes
      );
      
      // Check if validator is registered
      expect(await validatorRegistry.isValidatorRegistered(validatorAddr)).to.be.true;
      
      // Check validator info
      const validatorInfo = await validatorRegistry.getValidatorInfo(validatorAddr);
      expect(validatorInfo.name).to.equal("Test Validator");
      expect(validatorInfo.description).to.equal("A validator for testing purposes");
      expect(validatorInfo.isActive).to.be.true;
      
      // Check supported asset types
      const assetTypeValidators = await validatorRegistry.getValidatorsForAssetType(0);
      expect(assetTypeValidators).to.include(validatorAddr);
      
      // Check validator count
      expect(await validatorRegistry.getValidatorCount()).to.equal(1);
    });
    
    it("should reject registration if caller is not admin", async function() {
      const validatorAddr = await validator.getAddress();
      await expect(
        validatorRegistry.connect(user1).registerValidator(
          validatorAddr,
          "Invalid Register",
          "Should fail",
          [0, 1]
        )
      ).to.be.revertedWith("AccessControl");
    });
    
    it("should not allow registering the same validator twice", async function() {
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1]
      );
      
      await expect(
        validatorRegistry.registerValidator(
          validatorAddr,
          "Duplicate Validator",
          "This should fail",
          [0, 1]
        )
      ).to.be.revertedWith("ValidatorRegistry: Validator already registered");
    });
    
    it("should check for duplicate asset types in registration", async function() {
      const validatorAddr = await validator.getAddress();
      // Try to register with duplicate asset types [0, 0, 1]
      await expect(
        validatorRegistry.registerValidator(
          validatorAddr,
          "Test Validator",
          "With duplicate asset types",
          [0, 0, 1]
        )
      ).to.be.revertedWith("ValidatorRegistry: Duplicate asset type");
    });
  });
  
  describe("Validator Management", function() {
    beforeEach(async function() {
      // Register a validator for testing
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1]
      );
    });
    
    it("should update validator status correctly", async function() {
      const validatorAddr = await validator.getAddress();
      // Initially active
      expect((await validatorRegistry.getValidatorInfo(validatorAddr)).isActive).to.be.true;
      
      // Deactivate
      await validatorRegistry.updateValidatorStatus(validatorAddr, false);
      expect((await validatorRegistry.getValidatorInfo(validatorAddr)).isActive).to.be.false;
      
      // Reactivate
      await validatorRegistry.updateValidatorStatus(validatorAddr, true);
      expect((await validatorRegistry.getValidatorInfo(validatorAddr)).isActive).to.be.true;
    });
    
    it("should update supported asset types correctly", async function() {
      const validatorAddr = await validator.getAddress();
      // Initially supports [0, 1]
      let validatorInfo = await validatorRegistry.getValidatorInfo(validatorAddr);
      expect(validatorInfo.supportedAssetTypes.length).to.equal(2);
      
      // Update to support all asset types
      await validatorRegistry.updateValidatorAssetTypes(validatorAddr, [0, 1, 2, 3]);
      
      validatorInfo = await validatorRegistry.getValidatorInfo(validatorAddr);
      expect(validatorInfo.supportedAssetTypes.length).to.equal(4);
      
      // Check if validator is listed for new asset type
      const assetTypeValidators = await validatorRegistry.getValidatorsForAssetType(2);
      expect(assetTypeValidators).to.include(validatorAddr);
    });
    
    it("should update validator name correctly", async function() {
      const validatorAddr = await validator.getAddress();
      // Initially "Test Validator"
      expect((await validatorRegistry.getValidatorInfo(validatorAddr)).name).to.equal("Test Validator");
      
      // Update name
      await validatorRegistry.updateValidatorName(validatorAddr, "Updated Validator Name");
      expect((await validatorRegistry.getValidatorInfo(validatorAddr)).name).to.equal("Updated Validator Name");
    });
    
    it("should update validator description correctly", async function() {
      const validatorAddr = await validator.getAddress();
      // Initially "A validator for testing purposes"
      expect((await validatorRegistry.getValidatorInfo(validatorAddr)).description)
        .to.equal("A validator for testing purposes");
      
      // Update description
      await validatorRegistry.updateValidatorDescription(
        validatorAddr, 
        "Updated description for testing"
      );
      expect((await validatorRegistry.getValidatorInfo(validatorAddr)).description)
        .to.equal("Updated description for testing");
    });
    
    it("should reject updates from non-admin accounts", async function() {
      const validatorAddr = await validator.getAddress();
      // Try to update status without admin role
      await expect(
        validatorRegistry.connect(user1).updateValidatorStatus(validatorAddr, false)
      ).to.be.revertedWith("AccessControl");
      
      // Try to update asset types without admin role
      await expect(
        validatorRegistry.connect(user1).updateValidatorAssetTypes(validatorAddr, [0, 1, 2])
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Validator Lookup", function() {
    beforeEach(async function() {
      // Register validators for testing
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Land Validator",
        "Validates land assets",
        [0, 2] // Land, Estate
      );
      
      // Deploy a second validator contract
      const Validator = await ethers.getContractFactory("Validator");
      const validator2Contract = await upgrades.deployProxy(Validator, [await deedNFT.getAddress()]);
      await validator2Contract.waitForDeployment();
      
      await validatorRegistry.registerValidator(
        await validator2Contract.getAddress(),
        "Vehicle Validator",
        "Validates vehicle assets",
        [1, 3] // Vehicle, CommercialEquipment
      );
    });
    
    it("should return correct validators for asset types", async function() {
      const validatorAddr = await validator.getAddress();
      // Check Land validators
      const landValidators = await validatorRegistry.getValidatorsForAssetType(0);
      expect(landValidators.length).to.equal(1);
      expect(landValidators[0]).to.equal(validatorAddr);
      
      // Check Vehicle validators
      const vehicleValidators = await validatorRegistry.getValidatorsForAssetType(1);
      expect(vehicleValidators.length).to.equal(1);
      expect(vehicleValidators[0]).to.not.equal(validatorAddr);
    });
    
    it("should return all registered validators", async function() {
      const allValidators = await validatorRegistry.getAllValidators();
      expect(allValidators.length).to.equal(2);
    });
    
    it("should return only active validators", async function() {
      const validatorAddr = await validator.getAddress();
      // Deactivate first validator
      await validatorRegistry.updateValidatorStatus(validatorAddr, false);
      
      // Check active validators
      const activeValidators = await validatorRegistry.getActiveValidators();
      expect(activeValidators.length).to.equal(1);
      expect(activeValidators[0]).to.not.equal(validatorAddr);
    });
  });
  
  describe("Contract Upgradeability", function() {
    it("should be upgradeable", async function() {
      // Test upgradeability by deploying a new implementation
      const ValidatorRegistryV2 = await ethers.getContractFactory("ValidatorRegistry");
      const upgradedValidatorRegistry = await upgrades.upgradeProxy(
        await validatorRegistry.getAddress(),
        ValidatorRegistryV2
      );
      
      // Verify the upgrade was successful
      expect(await upgradedValidatorRegistry.getAddress()).to.equal(await validatorRegistry.getAddress());
      
      // Verify state was preserved
      expect(await upgradedValidatorRegistry.hasRole(VALIDATOR_ADMIN_ROLE, deployer.address)).to.be.true;
    });
  });
});
