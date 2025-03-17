import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DeedNFT Contract", function() {
  let deedNFT: Contract;
  let validator: Contract;
  let validatorRegistry: Contract;
  let fundManager: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let contracts: any = {};

  beforeEach(async function() {
    [deployer, user1, user2, validator1, validator2] = await ethers.getSigners() as unknown as SignerWithAddress[];
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.deployed();
    contracts.validatorRegistry = validatorRegistry;
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, ["DeedNFT", "DEED", validatorRegistry.address]);
    await deedNFT.deployed();
    contracts.deedNFT = deedNFT;
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [deedNFT.address]);
    await validator.deployed();
    contracts.validator = validator;
    
    // Deploy FundManager
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      deedNFT.address,
      validatorRegistry.address,
      deployer.address // fee receiver
    ]);
    await fundManager.deployed();
    contracts.fundManager = fundManager;
    
    // Setup roles
    const VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
    const MINTER_ROLE = await deedNFT.MINTER_ROLE();
    
    // Grant roles
    await deedNFT.grantRole(VALIDATOR_ROLE, deployer.address);
    await deedNFT.grantRole(VALIDATOR_ROLE, validator1.address);
    await deedNFT.grantRole(VALIDATOR_ROLE, validator2.address);
    await deedNFT.grantRole(MINTER_ROLE, fundManager.address);
    
    // Set FundManager in DeedNFT
    await deedNFT.setFundManager(fundManager.address);
    
    // Register validator in registry
    await validatorRegistry.registerValidator(
      validator.address,
      deployer.address,
      "Test Validator",
      "Test validator for unit tests",
      [0, 1, 2, 3] // Support all asset types
    );
    // Mint initial deed for testing
    await deedNFT.setFundManager(deployer.address);
    await deedNFT.mintAsset(
      user1.address,
      0, // AssetType.Land
      "ipfs://metadata1",
      "ipfs://agreement1",
      "definition1",
      "configuration1"
    );
    await deedNFT.setFundManager(fundManager.address);
  });
  
  describe("Initialization", function() {
    it("should initialize with correct values", async function() {
      expect(await deedNFT.name()).to.equal("DeedNFT");
      expect(await deedNFT.symbol()).to.equal("DEED");
      expect(await deedNFT.validatorRegistry()).to.equal(validatorRegistry.address);
    });
    
    it("should set up roles correctly", async function() {
      const VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
      const MINTER_ROLE = await deedNFT.MINTER_ROLE();
      const DEFAULT_ADMIN_ROLE = await deedNFT.DEFAULT_ADMIN_ROLE();
      
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, deployer.address)).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validator1.address)).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validator2.address)).to.be.true;
      expect(await deedNFT.hasRole(MINTER_ROLE, fundManager.address)).to.be.true;
      expect(await deedNFT.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
    });
  });
  
  describe("Minting", function() {
    it("should mint a new deed with correct properties", async function() {
      // Set deployer as FundManager temporarily for minting
      await deedNFT.setFundManager(deployer.address);
      
      const tx = await deedNFT.mintAsset(
        user2.address,
        1, // AssetType.Vehicle
        "ipfs://metadata-vehicle",
        "ipfs://agreement-vehicle",
        "vehicle-definition",
        "vehicle-configuration"
      );
      
      const receipt = await tx.wait();
      const mintEvent = receipt.events?.find(e => e.event === "DeedNFTMinted");
      const deedId = mintEvent?.args?.tokenId;
      
      // Reset FundManager address
      await deedNFT.connect(deployer).setFundManager(fundManager.address);
      
      // Check ownership
      expect(await deedNFT.ownerOf(deedId)).to.equal(user2.address);
      
      // Check deed info
      const deedInfo = await deedNFT.getDeedInfo(deedId);
      expect(deedInfo.assetType).to.equal(1); // Vehicle
      expect(deedInfo.ipfsDetailsHash).to.equal("ipfs://metadata-vehicle");
      expect(deedInfo.operatingAgreement).to.equal("ipfs://agreement-vehicle");
      expect(deedInfo.isValidated).to.be.true; // Minted by validator
    });
  });
  
  describe("Validation", function() {
    let deedId: number;
    
    beforeEach(async function() {
      // Set deployer as FundManager temporarily for minting
      await deedNFT.connect(deployer).setFundManager(deployer.address);
      
      // Mint a deed for testing
      const tx = await deedNFT.mintAsset(
        user1.address,
        0, // AssetType.Land
        "ipfs://metadata2",
        "ipfs://agreement2",
        "definition2",
        "configuration2"
      );
      
      const receipt = await tx.wait();
      const mintEvent = receipt.events?.find(e => e.event === "DeedNFTMinted");
      deedId = mintEvent?.args?.tokenId;
      
      // Reset FundManager address
      await deedNFT.connect(deployer).setFundManager(fundManager.address);
    });
    
    it("should allow validators to validate assets", async function() {
      // Initial validation should be true (minted by validator deployer)
      const deedInfo = await deedNFT.getDeedInfo(deedId);
      expect(deedInfo.isValidated).to.be.true;
      
      // Invalidate the deed using validator1
      await deedNFT.connect(validator1).validateAsset(deedId, false);
      
      // Check that the deed is now invalidated
      const updatedDeedInfo = await deedNFT.getDeedInfo(deedId);
      expect(updatedDeedInfo.isValidated).to.be.false;
      
      // Validate again
      await deedNFT.connect(validator1).validateAsset(deedId, true);
      
      // Check that the deed is now validated
      const finalDeedInfo = await deedNFT.getDeedInfo(deedId);
      expect(finalDeedInfo.isValidated).to.be.true;
    });
  });
  
  describe("Burning", function() {
    it("should allow owner to burn their deed", async function() {
      // Check that token 1 exists
      expect(await deedNFT.ownerOf(1)).to.equal(user1.address);
      
      // Burn the token
      await deedNFT.connect(user1).burnAsset(1);
      
      // Check that token no longer exists
      await expect(deedNFT.ownerOf(1)).to.be.revertedWith("ERC721: invalid token ID");
    });
    
    it("should not allow non-owners to burn deeds", async function() {
      await expect(deedNFT.connect(user2).burnAsset(1))
        .to.be.revertedWith("DeedNFT: caller is not owner nor approved");
    });
  });
  
  describe("Metadata Updates", function() {
    it("should allow owner to update metadata", async function() {
      // Get the first deed info before update
      const beforeInfo = await deedNFT.getDeedInfo(1);
      
      // Update metadata as owner
      await deedNFT.connect(user1).updateMetadata(
        1,
        "ipfs://updated-metadata",
        "ipfs://updated-agreement",
        "updated-definition",
        "updated-configuration"
      );
      
      // Get updated info
      const afterInfo = await deedNFT.getDeedInfo(1);
      
      // Verify changes
      expect(afterInfo.operatingAgreement).to.equal("ipfs://updated-agreement");
      expect(afterInfo.definition).to.equal("updated-definition");
      expect(afterInfo.configuration).to.equal("updated-configuration");
      
      // When updated by non-validator, isValidated should be false
      expect(afterInfo.isValidated).to.be.false;
    });
    
    it("should maintain validation status when updated by validator", async function() {
      // First validate the deed
      await deedNFT.connect(validator1).validateAsset(1, true);
      
      // Update metadata as validator
      await deedNFT.connect(deployer).updateMetadata(
        1,
        "ipfs://validator-update",
        "ipfs://validator-agreement",
        "validator-definition",
        "validator-configuration"
      );
      
      // Get updated info
      const info = await deedNFT.getDeedInfo(1);
      
      // Validation status should still be true
      expect(info.isValidated).to.be.true;
    });
  });
  
  describe("Transfers", function() {
    it("should allow owner to transfer deed", async function() {
      // Transfer from user1 to user2
      await deedNFT.connect(user1).transferFrom(user1.address, user2.address, 1);
      
      // Check new owner
      expect(await deedNFT.ownerOf(1)).to.equal(user2.address);
    });
    
    it("should not affect validation status on transfer", async function() {
      // Get validation status before transfer
      const beforeInfo = await deedNFT.getDeedInfo(1);
      const beforeValidation = beforeInfo.isValidated;
      
      // Transfer from user1 to user2
      await deedNFT.connect(user1).transferFrom(user1.address, user2.address, 1);
      
      // Check validation status after transfer
      const afterInfo = await deedNFT.getDeedInfo(1);
      expect(afterInfo.isValidated).to.equal(beforeValidation);
    });
  });
  
  describe("Pausing", function() {
    it("should allow admin to pause and unpause", async function() {
      // Pause the contract
      await deedNFT.connect(deployer).pause();
      expect(await deedNFT.paused()).to.be.true;
      
      // Try to transfer while paused
      await expect(
        deedNFT.connect(user1).transferFrom(user1.address, user2.address, 1)
      ).to.be.revertedWith("ERC721Pausable: token transfer while paused");
      
      // Unpause
      await deedNFT.connect(deployer).unpause();
      expect(await deedNFT.paused()).to.be.false;
      
      // Transfer should work now
      await deedNFT.connect(user1).transferFrom(user1.address, user2.address, 1);
      expect(await deedNFT.ownerOf(1)).to.equal(user2.address);
    });
  });
  
  describe("Token URI", function() {
    it("should return the correct token URI from validator", async function() {
      // Set deployer as FundManager temporarily for minting
      await deedNFT.connect(deployer).setFundManager(deployer.address);
      
      // Mint a new deed
      const tx = await deedNFT.mintAsset(
        user1.address,
        0, // AssetType.Land
        "ipfs://uri-test",
        "ipfs://agreements/default.json",
        "uri-def",
        "uri-config"
      );
      
      const receipt = await tx.wait();
      const mintEvent = receipt.events?.find(e => e.event === "DeedNFTMinted");
      const deedId = mintEvent?.args?.tokenId;
      
      // Reset FundManager address
      await deedNFT.connect(deployer).setFundManager(fundManager.address);
      
      // Get token URI
      const tokenURI = await deedNFT.tokenURI(deedId);
      
      // The validator's baseURI is "ipfs://metadata/" and it appends the token ID
      expect(tokenURI).to.equal(`ipfs://metadata/${deedId}`);
    });
  });
}); 