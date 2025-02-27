import { expect } from "chai";
import { ethers } from "hardhat";
import { deployContracts, DeployedContracts } from "../helpers/deploy-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ValidatorRegistry } from "../typechain-types";

describe("ValidatorRegistry Contract", function() {
  let contracts: DeployedContracts;
  let validatorRegistry: ValidatorRegistry;
  let deployer: SignerWithAddress, admin: SignerWithAddress, 
      validator1: SignerWithAddress, validator2: SignerWithAddress, user1: SignerWithAddress;
  
  before(async function() {
    // Deploy all contracts
    contracts = await deployContracts();
    validatorRegistry = contracts.validatorRegistry;
    deployer = contracts.deployer;
    admin = contracts.admin;
    validator1 = contracts.validator1;
    validator2 = contracts.validator2;
    user1 = contracts.user1;
  });
  
  describe("Initialization", function() {
    it("should initialize with correct roles", async function() {
      const REGISTRY_ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REGISTRY_ADMIN_ROLE"));
      const DEFAULT_ADMIN_ROLE = ethers.constants.DEFAULT_ADMIN_ROLE;
      
      expect(await validatorRegistry.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await validatorRegistry.hasRole(REGISTRY_ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await validatorRegistry.owner()).to.equal(deployer.address);
    });
  });
  
  describe("Validator Registration", function() {
    it("should allow owner to register a new validator", async function() {
      // Deploy a new validator contract
      const Validator = await ethers.getContractFactory("Validator");
      const newValidator = await Validator.deploy();
      await newValidator.deployed();
      
      // Register the validator
      await validatorRegistry.registerValidator(newValidator.address, "Test Validator");
      
      // Check if registered
      expect(await validatorRegistry.isValidatorRegistered(newValidator.address)).to.be.true;
      expect(await validatorRegistry.getValidatorName(newValidator.address)).to.equal("Test Validator");
    });
    
    it("should prevent non-owners from registering validators", async function() {
      const Validator = await ethers.getContractFactory("Validator");
      const newValidator = await Validator.deploy();
      await newValidator.deployed();
      
      await expect(
        validatorRegistry.connect(user1).registerValidator(newValidator.address, "Unauthorized Validator")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    
    it("should prevent registering the same validator twice", async function() {
      await expect(
        validatorRegistry.registerValidator(contracts.validator.address, "Already Registered")
      ).to.be.revertedWith("ValidatorRegistry: Validator already registered");
    });
  });
  
  describe("Validator Management", function() {
    let testValidator: string;
    
    beforeEach(async function() {
      // Deploy a new validator for each test
      const Validator = await ethers.getContractFactory("Validator");
      const newValidator = await Validator.deploy();
      await newValidator.deployed();
      
      // Register the validator
      await validatorRegistry.registerValidator(newValidator.address, "Management Test");
      testValidator = newValidator.address;
    });
    
    it("should allow updating validator name", async function() {
      await validatorRegistry.updateValidatorName(testValidator, "Updated Name");
      expect(await validatorRegistry.getValidatorName(testValidator)).to.equal("Updated Name");
    });
    
    it("should allow updating validator status", async function() {
      // Default is inactive
      const initialInfo = await validatorRegistry.getValidatorInfo(testValidator);
      expect(initialInfo.isActive).to.be.false;
      
      // Update to active
      await validatorRegistry.updateValidatorStatus(testValidator, true);
      
      // Check updated status
      const updatedInfo = await validatorRegistry.getValidatorInfo(testValidator);
      expect(updatedInfo.isActive).to.be.true;
    });
    
    it("should allow updating supported asset types", async function() {
      const assetTypes = [0, 1, 3]; // Land, Vehicle, CommercialEquipment
      
      await validatorRegistry.updateValidatorAssetTypes(testValidator, assetTypes);
      
      const info = await validatorRegistry.getValidatorInfo(testValidator);
      expect(info.supportedAssetTypes.length).to.equal(3);
      expect(info.supportedAssetTypes[0]).to.equal(0);
      expect(info.supportedAssetTypes[1]).to.equal(1);
      expect(info.supportedAssetTypes[2]).to.equal(3);
    });
    
    it("should allow removing a validator", async function() {
      await validatorRegistry.removeValidator(testValidator);
      expect(await validatorRegistry.isValidatorRegistered(testValidator)).to.be.false;
    });
  });
  
  describe("Asset Type Validators", function() {
    it("should correctly track validators for asset types", async function() {
      // Deploy two new validators
      const Validator = await ethers.getContractFactory("Validator");
      const landValidator = await Validator.deploy();
      await landValidator.deployed();
      
      const vehicleValidator = await Validator.deploy();
      await vehicleValidator.deployed();
      
      // Register validators
      await validatorRegistry.registerValidator(landValidator.address, "Land Validator");
      await validatorRegistry.registerValidator(vehicleValidator.address, "Vehicle Validator");
      
      // Set asset types
      await validatorRegistry.updateValidatorAssetTypes(landValidator.address, [0]); // Land
      await validatorRegistry.updateValidatorAssetTypes(vehicleValidator.address, [1]); // Vehicle
      
      // Activate validators
      await validatorRegistry.updateValidatorStatus(landValidator.address, true);
      await validatorRegistry.updateValidatorStatus(vehicleValidator.address, true);
      
      // Get validators for asset types
      const landValidators = await validatorRegistry.getValidatorsForAssetType(0);
      const vehicleValidators = await validatorRegistry.getValidatorsForAssetType(1);
      
      // Check if validators are correctly assigned
      expect(landValidators).to.include(landValidator.address);
      expect(vehicleValidators).to.include(vehicleValidator.address);
    });
  });
});
