import { expect } from "chai";
import { ethers } from "hardhat";
import { deployContracts, DeployedContracts } from "../helpers/deploy-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DeedNFT } from "../typechain-types";

describe("DeedNFT Contract", function() {
  let contracts: DeployedContracts;
  let deployer: SignerWithAddress, admin: SignerWithAddress, 
      validator1: SignerWithAddress, user1: SignerWithAddress;
  let deedNFT: DeedNFT;
  let VALIDATOR_ROLE: string, ADMIN_ROLE: string;
  
  before(async function() {
    // Deploy all contracts
    contracts = await deployContracts();
    deedNFT = contracts.deedNFT;
    deployer = contracts.deployer;
    admin = contracts.admin;
    validator1 = contracts.validator1;
    user1 = contracts.user1;
    
    // Get role identifiers
    VALIDATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("VALIDATOR_ROLE"));
    ADMIN_ROLE = ethers.constants.DEFAULT_ADMIN_ROLE;
  });
  
  describe("Initialization", function() {
    it("should initialize with correct name and symbol", async function() {
      expect(await deedNFT.name()).to.equal("DeedNFT");
      expect(await deedNFT.symbol()).to.equal("DEED");
    });
    
    it("should set the deployer as admin and validator", async function() {
      expect(await deedNFT.hasRole(ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, deployer.address)).to.be.true;
    });
    
    it("should correctly set the fundManager address", async function() {
      expect(await deedNFT.fundManager()).to.equal(contracts.fundManager.address);
    });
  });
  
  describe("Role Management", function() {
    it("should allow admin to grant validator role", async function() {
      await deedNFT.grantRole(VALIDATOR_ROLE, validator1.address);
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validator1.address)).to.be.true;
    });
    
    it("should deny non-admin from granting roles", async function() {
      await expect(
        deedNFT.connect(user1).grantRole(VALIDATOR_ROLE, user1.address)
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Asset Minting", function() {
    it("should only allow FundManager to mint assets", async function() {
      // User tries to mint directly - should fail
      await expect(
        deedNFT.connect(user1).mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata",
          "ipfs://agreement",
          "definition",
          "configuration"
        )
      ).to.be.revertedWith("DeedNFT: Caller is not FundManager");
      
      // For testing purposes, we'll set deployer as FundManager temporarily
      await deedNFT.connect(deployer).setFundManager(deployer.address);
      
      const tx = await deedNFT.mintAsset(
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
      const mintEvent = receipt.events?.find(e => e.event === "DeedNFTMinted");
      expect(mintEvent).to.not.be.undefined;
      expect(mintEvent?.args?.deedId).to.equal(1);
      
      // Reset FundManager address
      await deedNFT.connect(deployer).setFundManager(contracts.fundManager.address);
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
      deedId = mintEvent?.args?.deedId;
      
      // Reset FundManager address
      await deedNFT.connect(deployer).setFundManager(contracts.fundManager.address);
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
  
  describe("Asset Data", function() {
    it("should return correct asset data", async function() {
      const deedInfo = await deedNFT.getDeedInfo(1);
      expect(deedInfo.assetType).to.equal(0); // AssetType.Land
      expect(deedInfo.definition).to.equal("definition");
      expect(deedInfo.configuration).to.equal("configuration");
    });
    
    it("should determine if asset can be subdivided", async function() {
      // Asset type Land should be subdividable
      expect(await deedNFT.canSubdivide(1)).to.be.true;
      
      // Set deployer as FundManager temporarily for minting
      await deedNFT.connect(deployer).setFundManager(deployer.address);
      
      // Mint a non-subdividable asset (Vehicle)
      const tx = await deedNFT.mintAsset(
        user1.address,
        1, // AssetType.Vehicle
        "ipfs://vehicle",
        "ipfs://agreement3",
        "vehicle-def",
        "vehicle-config"
      );
      
      const receipt = await tx.wait();
      const mintEvent = receipt.events?.find(e => e.event === "DeedNFTMinted");
      const vehicleDeedId = mintEvent?.args?.deedId;
      
      // Reset FundManager address
      await deedNFT.connect(deployer).setFundManager(contracts.fundManager.address);
      
      // Vehicle should not be subdividable
      expect(await deedNFT.canSubdivide(vehicleDeedId)).to.be.false;
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
  
  describe("Burning", function() {
    it("should allow owner to burn their deed", async function() {
      // Set deployer as FundManager temporarily for minting
      await deedNFT.connect(deployer).setFundManager(deployer.address);
      
      // Mint a new deed to burn
      const tx = await deedNFT.mintAsset(
        user1.address,
        0, // AssetType.Land
        "ipfs://to-burn",
        "ipfs://agreement-burn",
        "burn-definition",
        "burn-configuration"
      );
      
      const receipt = await tx.wait();
      const mintEvent = receipt.events?.find(e => e.event === "DeedNFTMinted");
      const burnDeedId = mintEvent?.args?.deedId;
      
      // Reset FundManager address
      await deedNFT.connect(deployer).setFundManager(contracts.fundManager.address);
      
      // Burn the deed
      await deedNFT.connect(user1).burnAsset(burnDeedId);
      
      // Verify the deed no longer exists
      await expect(deedNFT.ownerOf(burnDeedId)).to.be.revertedWith(
        "ERC721: invalid token ID"
      );
    });
  });
}); 