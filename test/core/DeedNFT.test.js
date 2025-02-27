const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployContracts } = require("../helpers/deploy-helpers");

describe("DeedNFT Contract", function() {
  let contracts;
  let deployer, admin, validator1, user1;
  let VALIDATOR_ROLE, ADMIN_ROLE;
  
  before(async function() {
    // Deploy all contracts
    const deployment = await deployContracts();
    contracts = deployment;
    deployer = contracts.deployer;
    admin = contracts.admin;
    validator1 = contracts.validator1;
    user1 = contracts.user1;
    
    // Get role identifiers
    VALIDATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("VALIDATOR_ROLE"));
    ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("DEFAULT_ADMIN_ROLE"));
  });
  
  describe("Initialization", function() {
    it("should initialize with correct name and symbol", async function() {
      expect(await contracts.deedNFT.name()).to.equal("DeedNFT");
      expect(await contracts.deedNFT.symbol()).to.equal("DEED");
    });
    
    it("should set the deployer as admin and validator", async function() {
      expect(await contracts.deedNFT.hasRole(ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await contracts.deedNFT.hasRole(VALIDATOR_ROLE, deployer.address)).to.be.true;
    });
    
    it("should correctly set the fundManager address", async function() {
      expect(await contracts.deedNFT.fundManager()).to.equal(contracts.fundManager.address);
    });
  });
  
  describe("Role Management", function() {
    it("should allow admin to grant validator role", async function() {
      await contracts.deedNFT.grantRole(VALIDATOR_ROLE, validator1.address);
      expect(await contracts.deedNFT.hasRole(VALIDATOR_ROLE, validator1.address)).to.be.true;
    });
    
    it("should deny non-admin from granting roles", async function() {
      await expect(
        contracts.deedNFT.connect(user1).grantRole(VALIDATOR_ROLE, user1.address)
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Asset Minting", function() {
    it("should only allow FundManager to mint assets", async function() {
      // User tries to mint directly - should fail
      await expect(
        contracts.deedNFT.connect(user1).mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata",
          "ipfs://agreement",
          "definition",
          "configuration"
        )
      ).to.be.revertedWith("DeedNFT: Caller is not FundManager");
      
      // Mock a mint through FundManager (this would typically be done via FundManager tests)
      // First get FundManager role
      const FUND_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUND_MANAGER_ROLE"));
      
      // For testing purposes, we'll use the deployer to mint through the function directly
      await contracts.deedNFT.connect(deployer).setFundManager(deployer.address);
      
      const tx = await contracts.deedNFT.mintAsset(
        user1.address,
        0, // AssetType.Land
        "ipfs://metadata",
        "ipfs://agreement",
        "definition",
        "configuration"
      );
      
      // Wait for the transaction
      const receipt = await tx.wait();
      
      // Find the DeedNFTMinted event
      const mintEvent = receipt.events.find(e => e.event === "DeedNFTMinted");
      expect(mintEvent).to.not.be.undefined;
      expect(mintEvent.args.deedId).to.equal(1);
    });
  });
  
  describe("Validation", function() {
    it("should allow validators to validate assets", async function() {
      // Mint a deed for testing
      await contracts.deedNFT.connect(deployer).mintAsset(
        user1.address,
        0, // AssetType.Land
        "ipfs://metadata2",
        "ipfs://agreement2",
        "definition2",
        "configuration2"
      );
      
      // Initial validation should be false (minted by non-validator)
      const deedInfo = await contracts.deedNFT.getDeedInfo(2);
      expect(deedInfo.isValidated).to.be.false;
      
      // Validate the deed using validator1
      await contracts.deedNFT.connect(validator1).validateAsset(2, true);
      
      // Check that the deed is now validated
      const updatedDeedInfo = await contracts.deedNFT.getDeedInfo(2);
      expect(updatedDeedInfo.isValidated).to.be.true;
    });
  });
  
  describe("Asset Data", function() {
    it("should return correct asset data", async function() {
      const deedInfo = await contracts.deedNFT.getDeedInfo(1);
      expect(deedInfo.assetType).to.equal(0); // AssetType.Land
      expect(deedInfo.definition).to.equal("definition");
      expect(deedInfo.configuration).to.equal("configuration");
    });
    
    it("should determine if asset can be subdivided", async function() {
      // Asset type Land should be subdividable
      expect(await contracts.deedNFT.canSubdivide(1)).to.be.true;
      
      // Mint a non-subdividable asset (Vehicle)
      await contracts.deedNFT.connect(deployer).mintAsset(
        user1.address,
        1, // AssetType.Vehicle
        "ipfs://vehicle",
        "ipfs://agreement3",
        "vehicle-def",
        "vehicle-config"
      );
      
      // Vehicle should not be subdividable
      expect(await contracts.deedNFT.canSubdivide(3)).to.be.false;
    });
  });
}); 