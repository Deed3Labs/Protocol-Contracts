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
  let REGISTRY_ADMIN_ROLE: string;
  
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
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "https://api.example.com/metadata/",  // baseUri
      "https://api.example.com/agreements/" // defaultOperatingAgreementUri
    ]);
    await validator.waitForDeployment();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();
    
    // Get the admin role
    REGISTRY_ADMIN_ROLE = await validatorRegistry.REGISTRY_ADMIN_ROLE();
    
    // Grant registry admin role to deployer
    await validatorRegistry.grantRole(REGISTRY_ADMIN_ROLE, await deployer.getAddress());
  });
  
  describe("Initialization", function() {
    it("should initialize with correct roles", async function() {
      expect(await validatorRegistry.hasRole(REGISTRY_ADMIN_ROLE, await deployer.getAddress())).to.be.true;
    });
  });
  
  describe("Validator Registration", function() {
    it("should register a validator correctly", async function() {
      const validatorAddr = await validator.getAddress();
      
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator"
      );
      
      // Check if validator is registered
      const validatorInfo = await validatorRegistry.validators(validatorAddr);
      expect(validatorInfo.name).to.equal("Test Validator");
      expect(validatorInfo.isActive).to.be.true;
    });
    
    it("should reject registration if caller is not admin", async function() {
      const validatorAddr = await validator.getAddress();
      
      await expect(
        validatorRegistry.connect(user1).registerValidator(
          validatorAddr,
          "Invalid Register"
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    
    it("should not allow registering the same validator twice", async function() {
      const validatorAddr = await validator.getAddress();
      
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator"
      );
      
      await expect(
        validatorRegistry.registerValidator(
          validatorAddr,
          "Duplicate Validator"
        )
      ).to.be.revertedWith("ValidatorRegistry: Validator already registered");
    });
  });
  
  describe("Validator Management", function() {
    beforeEach(async function() {
      // Register a validator for testing
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator"
      );
    });
    
    it("should update validator status correctly", async function() {
      const validatorAddr = await validator.getAddress();
      // Initially active
      expect((await validatorRegistry.validators(validatorAddr)).isActive).to.be.true;
      
      // Deactivate
      await validatorRegistry.updateValidatorStatus(validatorAddr, false);
      expect((await validatorRegistry.validators(validatorAddr)).isActive).to.be.false;
      
      // Reactivate
      await validatorRegistry.updateValidatorStatus(validatorAddr, true);
      expect((await validatorRegistry.validators(validatorAddr)).isActive).to.be.true;
    });
    
    it("should update validator name correctly", async function() {
      const validatorAddr = await validator.getAddress();
      // Initially "Test Validator"
      expect((await validatorRegistry.validators(validatorAddr)).name).to.equal("Test Validator");
      
      // Update name
      await validatorRegistry.updateValidatorName(validatorAddr, "Updated Validator Name");
      expect((await validatorRegistry.validators(validatorAddr)).name).to.equal("Updated Validator Name");
    });
  });
});
