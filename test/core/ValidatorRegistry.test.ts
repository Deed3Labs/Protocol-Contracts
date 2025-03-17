import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("ValidatorRegistry Contract", function() {
  let validatorRegistry: Contract;
  let validator: Contract;
  let deedNFT: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user1 = signers[1];
    validator1 = signers[2]; 
    validator2 = signers[3];
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.deployed();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, ["DeedNFT", "DEED", validatorRegistry.address]);
    await deedNFT.deployed();
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [deedNFT.address]);
    await validator.deployed();
  });
  
  describe("Validator Registration", function() {
    it("should register a validator correctly", async function() {
      const supportedAssetTypes = [0, 1]; // Land, Vehicle
      
      await validatorRegistry.registerValidator(
        validator.address,
        validator1.address,
        "Test Validator",
        "A validator for testing purposes",
        supportedAssetTypes
      );
      
      // Check if validator is registered
      expect(await validatorRegistry.isValidatorRegistered(validator.address)).to.be.true;
      
      // Check validator info
      const validatorInfo = await validatorRegistry.getValidatorInfo(validator.address);
      expect(validatorInfo.name).to.equal("Test Validator");
      expect(validatorInfo.isActive).to.be.true;
      
      // Check supported asset types
      const assetTypeValidators = await validatorRegistry.getValidatorsForAssetType(0);
      expect(assetTypeValidators).to.include(validator.address);
    });
    
    it("should not allow registering the same validator twice", async function() {
      await validatorRegistry.registerValidator(
        validator.address,
        validator1.address,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1]
      );
      
      await expect(
        validatorRegistry.registerValidator(
          validator.address,
          validator1.address,
          "Duplicate Validator",
          "This should fail",
          [0, 1]
        )
      ).to.be.revertedWith("ValidatorRegistry: Validator already registered");
    });
  });
  
  describe("Validator Management", function() {
    beforeEach(async function() {
      // Register a validator for testing
      await validatorRegistry.registerValidator(
        validator.address,
        validator1.address,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1]
      );
    });
    
    it("should update validator status correctly", async function() {
      // Initially active
      expect((await validatorRegistry.getValidatorInfo(validator.address)).isActive).to.be.true;
      
      // Deactivate
      await validatorRegistry.updateValidatorStatus(validator.address, false);
      expect((await validatorRegistry.getValidatorInfo(validator.address)).isActive).to.be.false;
      
      // Reactivate
      await validatorRegistry.updateValidatorStatus(validator.address, true);
      expect((await validatorRegistry.getValidatorInfo(validator.address)).isActive).to.be.true;
    });
    
    it("should update supported asset types correctly", async function() {
      // Initially supports [0, 1]
      let validatorInfo = await validatorRegistry.getValidatorInfo(validator.address);
      expect(validatorInfo.supportedAssetTypes.length).to.equal(2);
      
      // Update to support all asset types
      await validatorRegistry.updateValidatorAssetTypes(validator.address, [0, 1, 2, 3]);
      
      validatorInfo = await validatorRegistry.getValidatorInfo(validator.address);
      expect(validatorInfo.supportedAssetTypes.length).to.equal(4);
      
      // Check if validator is listed for new asset type
      const assetTypeValidators = await validatorRegistry.getValidatorsForAssetType(2);
      expect(assetTypeValidators).to.include(validator.address);
    });
    
    it("should update validator name correctly", async function() {
      // Initially "Test Validator"
      expect((await validatorRegistry.getValidatorInfo(validator.address)).name).to.equal("Test Validator");
      
      // Update name
      await validatorRegistry.updateValidatorName(validator.address, "Updated Validator Name");
      expect((await validatorRegistry.getValidatorInfo(validator.address)).name).to.equal("Updated Validator Name");
    });
  });
  
  describe("Validator Lookup", function() {
    beforeEach(async function() {
      // Register validators for testing
      await validatorRegistry.registerValidator(
        validator.address,
        validator1.address,
        "Land Validator",
        "Validates land assets",
        [0, 2] // Land, Estate
      );
      
      // Deploy a second validator contract
      const Validator = await ethers.getContractFactory("Validator");
      const validator2Contract = await upgrades.deployProxy(Validator, [deedNFT.address]);
      await validator2Contract.deployed();
      
      await validatorRegistry.registerValidator(
        validator2Contract.address,
        validator2.address,
        "Vehicle Validator",
        "Validates vehicle assets",
        [1, 3] // Vehicle, CommercialEquipment
      );
    });
    
    it("should return correct validators for asset types", async function() {
      // Check Land validators
      const landValidators = await validatorRegistry.getValidatorsForAssetType(0);
      expect(landValidators.length).to.equal(1);
      expect(landValidators[0]).to.equal(validator.address);
      
      // Check Vehicle validators
      const vehicleValidators = await validatorRegistry.getValidatorsForAssetType(1);
      expect(vehicleValidators.length).to.equal(1);
      expect(vehicleValidators[0]).to.not.equal(validator.address);
    });
    
    it("should return validator owner correctly", async function() {
      const owner = await validatorRegistry.getValidatorOwner(validator.address);
      expect(owner).to.equal(validator1.address);
    });
  });
});
