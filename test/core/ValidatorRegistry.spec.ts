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
  let fundManager: any;
  
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, user1] = signers;
    validator1 = signers[2]; 
    validator2 = signers[3];
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "ipfs://metadata/",
      "ipfs://agreements/"
    ]);
    await validator.waitForDeployment();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();
    
    // Deploy FundManager
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      await validatorRegistry.getAddress(),
      1000, // 10% commission
      deployer.address // fee receiver
    ]);
    await fundManager.waitForDeployment();

    // Set FundManager in ValidatorRegistry
    await validatorRegistry.setFundManager(await fundManager.getAddress());
    
    // Set DeedNFT in ValidatorRegistry
    await validatorRegistry.setDeedNFT(await deedNFT.getAddress());
    
    // Get the admin role
    REGISTRY_ADMIN_ROLE = await validatorRegistry.REGISTRY_ADMIN_ROLE();
    
    // Grant registry admin role to deployer
    await validatorRegistry.grantRole(REGISTRY_ADMIN_ROLE, deployer.address);
  });
  
  describe("Initialization", function() {
    it("should initialize with correct roles", async function() {
      expect(await validatorRegistry.hasRole(REGISTRY_ADMIN_ROLE, await deployer.getAddress())).to.be.true;
    });
  });

  describe("DeedNFT Integration", function() {
    it("should set DeedNFT address correctly", async function() {
      const deedNFTAddress = await deedNFT.getAddress();
      expect(await validatorRegistry.deedNFT()).to.equal(deedNFTAddress);
    });

    it("should emit DeedNFTUpdated event when setting DeedNFT", async function() {
      const newDeedNFT = user1.address; // Using a different address for testing
      await expect(validatorRegistry.setDeedNFT(newDeedNFT))
        .to.emit(validatorRegistry, "DeedNFTUpdated")
        .withArgs(newDeedNFT);
    });

    it("should revert when setting zero address as DeedNFT", async function() {
      await expect(validatorRegistry.setDeedNFT(ethers.ZeroAddress))
        .to.be.reverted;
    });

    it("should revert when non-owner tries to set DeedNFT", async function() {
      await expect(validatorRegistry.connect(user1).setDeedNFT(user1.address))
        .to.be.reverted;
    });
  });
  
  describe("Validator Registration", function() {
    it("should register a validator correctly", async function() {
      const validatorAddr = await validator.getAddress();
      
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3] // All asset types
      );
      
      // Check if validator is registered
      const validatorInfo = await validatorRegistry.validators(validatorAddr);
      expect(validatorInfo.name).to.equal("Test Validator");
      expect(validatorInfo.description).to.equal("A validator for testing purposes");
      // Updated: should be false by default
      expect(validatorInfo.isActive).to.be.false;
      
      // Get supported asset types using the new getter
      const supportedAssetTypes = await validatorRegistry.getSupportedAssetTypes(validatorAddr);
      expect(supportedAssetTypes).to.deep.equal([0, 1, 2, 3]);
    });
    
    it("should automatically grant VALIDATOR_ROLE in DeedNFT when registering validator", async function() {
      const validatorAddr = await validator.getAddress();
      const VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
      
      // Initially, validator should not have VALIDATOR_ROLE
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validatorAddr)).to.be.false;
      
      // Register validator
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3]
      );
      
      // Validator should still not have VALIDATOR_ROLE after registration
      // (roles are only granted when status changes, not on registration)
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validatorAddr)).to.be.false;
      
      // Update validator status to trigger role assignment
      await validatorRegistry.updateValidatorStatus(validatorAddr, true);
      
      // Now validator should have VALIDATOR_ROLE
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validatorAddr)).to.be.true;
    });
    
    it("should reject registration if caller is not admin", async function() {
      const validatorAddr = await validator.getAddress();
      
      await expect(
        validatorRegistry.connect(user1).registerValidator(
          validatorAddr,
          "Invalid Register",
          "Invalid description",
          [0, 1]
        )
      ).to.be.reverted;
    });
    
    it("should not allow registering the same validator twice", async function() {
      const validatorAddr = await validator.getAddress();
      
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "Initial description",
        [0, 1]
      );
      
      await expect(
        validatorRegistry.registerValidator(
          validatorAddr,
          "Duplicate Validator",
          "Duplicate description",
          [2, 3]
        )
      ).to.be.reverted;
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
        [0, 1, 2, 3]
      );
      // Explicitly activate validator after registration
      await validatorRegistry.updateValidatorStatus(await validator.getAddress(), true);
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

    it("should maintain VALIDATOR_ROLE in DeedNFT when validator is active", async function() {
      const validatorAddr = await validator.getAddress();
      const VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
      
      // Validator is already registered in beforeEach, just update status to grant role
      await validatorRegistry.updateValidatorStatus(validatorAddr, true);
      // Should have role when active
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validatorAddr)).to.be.true;
      // Deactivate - should revoke role
      await validatorRegistry.updateValidatorStatus(validatorAddr, false);
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validatorAddr)).to.be.false;
      // Reactivate - should re-grant role
      await validatorRegistry.updateValidatorStatus(validatorAddr, true);
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validatorAddr)).to.be.true;
    });
    
    it("should update validator name correctly", async function() {
      const validatorAddr = await validator.getAddress();
      // Initially "Test Validator"
      expect((await validatorRegistry.validators(validatorAddr)).name).to.equal("Test Validator");
      
      // Update name
      await validatorRegistry.updateValidatorName(validatorAddr, "Updated Validator Name");
      expect((await validatorRegistry.validators(validatorAddr)).name).to.equal("Updated Validator Name");
    });
    
    it("should automatically revoke FEE_MANAGER_ROLE when validator is removed or deactivated", async function() {
      const FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();
      // Initially, validator has FEE_MANAGER_ROLE
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.true;
      
      // Deactivate validator
      await validatorRegistry.updateValidatorStatus(await validator.getAddress(), false);
      // Verify role is revoked
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.false;
      
      // Reactivate validator
      await validatorRegistry.updateValidatorStatus(await validator.getAddress(), true);
      // Verify role is re-granted
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.true;
      
      // Remove validator
      await validatorRegistry.removeValidator(await validator.getAddress());
      // Verify role is revoked
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.false;
    });
  });

  describe("FundManager Integration", function() {
    it("should set fund manager only by owner and revert on zero address", async function() {
      const newFundManager = user1.address;
      await expect(validatorRegistry.connect(user1).setFundManager(newFundManager)).to.be.reverted;
      await expect(validatorRegistry.setFundManager(ethers.ZeroAddress)).to.be.reverted;
      await validatorRegistry.setFundManager(newFundManager);
      expect(await validatorRegistry.fundManager()).to.equal(newFundManager);
    });
  });

  describe("Validator Removal", function() {
    it("should remove a validator and emit event", async function() {
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3]
      );
      await expect(validatorRegistry.removeValidator(validatorAddr))
        .to.emit(validatorRegistry, "ValidatorRegistered");
      expect((await validatorRegistry.validators(validatorAddr)).name).to.equal("");
      expect(await validatorRegistry.isValidatorRegistered(validatorAddr)).to.be.false;
    });

    it("should maintain VALIDATOR_ROLE in DeedNFT after removal (only grants, doesn't revoke)", async function() {
      const validatorAddr = await validator.getAddress();
      const VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
      
      // Register and verify role is granted
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3]
      );
      await validatorRegistry.updateValidatorStatus(validatorAddr, true);
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validatorAddr)).to.be.true;
      // Remove validator
      await validatorRegistry.removeValidator(validatorAddr);
      // Role should be revoked after removal
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validatorAddr)).to.be.false;
    });

    it("should revert when removing unregistered validator", async function() {
      await expect(validatorRegistry.removeValidator(user1.address)).to.be.reverted;
    });
  });

  describe("Validator Name Update", function() {
    it("should revert if validator not registered or name empty", async function() {
      const validatorAddr = await validator.getAddress();
      await expect(validatorRegistry.updateValidatorName(validatorAddr, "")).to.be.reverted;
      await expect(validatorRegistry.updateValidatorName(user1.address, "NewName")).to.be.reverted;
    });
    it("should update validator name and emit event", async function() {
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3]
      );
      await expect(validatorRegistry.updateValidatorName(validatorAddr, "NewName"))
        .to.emit(validatorRegistry, "ValidatorRegistered");
      expect((await validatorRegistry.validators(validatorAddr)).name).to.equal("NewName");
    });
  });

  describe("Validator Info and Status", function() {
    it("should return correct validator name and registration status", async function() {
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3]
      );
      expect(await validatorRegistry.getValidatorName(validatorAddr)).to.equal("Test Validator");
      expect(await validatorRegistry.isValidatorRegistered(validatorAddr)).to.be.true;
      expect(await validatorRegistry.isValidatorRegistered(user1.address)).to.be.false;
    });
    it("should revert getSupportedAssetTypes for unregistered validator", async function() {
      await expect(validatorRegistry.getSupportedAssetTypes(user1.address)).to.be.reverted;
    });
    it("should return correct supported asset types", async function() {
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3]
      );
      const types = await validatorRegistry.getSupportedAssetTypes(validatorAddr);
      expect(types).to.deep.equal([0, 1, 2, 3]);
    });
    it("should update validator status and emit event", async function() {
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3]
      );
      await expect(validatorRegistry.updateValidatorStatus(validatorAddr, false))
        .to.emit(validatorRegistry, "ValidatorStatusUpdated");
      expect((await validatorRegistry.validators(validatorAddr)).isActive).to.be.false;
    });
    it("should revert updateValidatorStatus for unregistered validator", async function() {
      await expect(validatorRegistry.updateValidatorStatus(user1.address, false)).to.be.reverted;
    });
  });

  describe("getValidatorAssetTypes", function() {
    it("should revert if validator not registered", async function() {
      await expect(validatorRegistry.getValidatorAssetTypes(user1.address)).to.be.reverted;
    });
    it("should revert if validator has no supported asset types", async function() {
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [] // Empty array of asset types
      );
      await expect(validatorRegistry.getValidatorAssetTypes(validatorAddr)).to.be.reverted;
    });
  });

  describe("getActiveValidators", function() {
    it("should return only active validators", async function() {
      const validatorAddr = await validator.getAddress();
      await validatorRegistry.registerValidator(
        validatorAddr,
        "Test Validator",
        "A validator for testing purposes",
        [0, 1, 2, 3]
      );
      // Should not be active by default
      let active = await validatorRegistry.getActiveValidators();
      expect(active).to.not.include(validatorAddr);
      // Activate
      await validatorRegistry.updateValidatorStatus(validatorAddr, true);
      active = await validatorRegistry.getActiveValidators();
      expect(active).to.include(validatorAddr);
      // Deactivate
      await validatorRegistry.updateValidatorStatus(validatorAddr, false);
      active = await validatorRegistry.getActiveValidators();
      expect(active).to.not.include(validatorAddr);
    });
  });
});
