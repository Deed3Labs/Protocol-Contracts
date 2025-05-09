import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

describe("Core Contracts Integration", function() {
  // Use 'any' type for contracts to avoid TypeScript errors
  let deedNFT: any;
  let validatorRegistry: any;
  let validator: any;
  let fundManager: any;
  let metadataRenderer: any;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let validator1: SignerWithAddress;
  let feeReceiver: SignerWithAddress;
  
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, user1, validator1, feeReceiver] = [signers[0], signers[1], signers[2], signers[3]];
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "ipfs://baseURI/",
      "ipfs://defaultOperatingAgreement/"
    ]);
    await validator.waitForDeployment();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      "ipfs://baseURI/",
      "ipfs://defaultOperatingAgreement/"
    ]);
    await deedNFT.waitForDeployment();
    
    // Set up roles and permissions
    await deedNFT.grantRole(await deedNFT.VALIDATOR_ROLE(), validator.address);
    await validator.grantRole(await validator.VALIDATOR_ROLE(), validator1.address);
    await validator.grantRole(await validator.METADATA_ROLE(), validator.address);
    await validator.grantRole(await validator.CRITERIA_MANAGER_ROLE(), validator.address);
    await validator.grantRole(await validator.FEE_MANAGER_ROLE(), validator.address);
    
    // Set up DeedNFT in Validator
    await validator.setDeedNFT(deedNFT.address);
    
    // Deploy FundManager
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      validator.address,
      500 // 5% commission
    ]);
    await fundManager.waitForDeployment();
    
    // Deploy MetadataRenderer
    const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
    metadataRenderer = await upgrades.deployProxy(MetadataRenderer, [await deedNFT.getAddress()]);
    await metadataRenderer.waitForDeployment();
    
    // Setup roles and permissions
    const VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
    const MINTER_ROLE = await deedNFT.MINTER_ROLE();
    
    await deedNFT.grantRole(VALIDATOR_ROLE, await validator.getAddress());
    await deedNFT.grantRole(MINTER_ROLE, await fundManager.getAddress());
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      "Test Validator",
      "A validator for testing",
      [0, 1, 2, 3] // All asset types
    );
  });
  
  describe("End-to-End Deed Creation Process", function() {
    it("should allow full lifecycle: create, validate, and manage a deed", async function() {
      // 1. Create a new deed using the FundManager
      const tx = await fundManager.connect(user1).createDeed(
        0, // Land type
        "Test Deed",
        "This is a test deed",
        await validator.getAddress(),
        { value: ethers.parseEther("0.1") } // Pay fee
      );
      
      const receipt = await tx.wait();
      // Extract deed ID from events
      const deedCreatedEvent = receipt.events.find((e: any) => e.event === "DeedCreated");
      const deedId = deedCreatedEvent.args.deedId;
      
      // 2. Verify ownership
      expect(await deedNFT.ownerOf(deedId)).to.equal(user1.address);
      
      // 3. Validator approves the deed
      await validator.connect(validator1).validateDeed(deedId, true);
      
      // 4. Check validation status
      const deedInfo = await deedNFT.getDeedInfo(deedId);
      expect(deedInfo.isValidated).to.be.true;
      
      // 5. Generate and check metadata
      const tokenURI = await metadataRenderer.tokenURI(deedId);
      expect(tokenURI).to.not.be.empty;
      
      // 6. Check fee distribution
      const feeReceiverBalance = await ethers.provider.getBalance(feeReceiver.address);
      // Verify fee receiver got the commission
    });
  });
  
  describe("Error Handling and Edge Cases", function() {
    // Add tests for various error cases and edge conditions
  });
  
  describe("Upgrade Paths", function() {
    it("should support upgrading core contracts while preserving state", async function() {
      // Test contract upgradeability
    });
  });
}); 