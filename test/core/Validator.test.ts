import { expect } from "chai";
import { ethers } from "hardhat";
import { deployContracts, DeployedContracts } from "../helpers/deploy-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Validator } from "../../typechain-types";

describe("Validator Contract", function() {
  let contracts: DeployedContracts;
  let validator: Validator;
  let deployer: SignerWithAddress, admin: SignerWithAddress, 
      validator1: SignerWithAddress, user1: SignerWithAddress;
  let VALIDATOR_ROLE: string, METADATA_ROLE: string;
  
  before(async function() {
    // Deploy all contracts
    contracts = await deployContracts();
    validator = contracts.validator;
    [deployer, admin, validator1, user1] = await ethers.getSigners();
    // Get role identifiers
    VALIDATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("VALIDATOR_ROLE"));
    METADATA_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("METADATA_ROLE"));
  });
  
  describe("Initialization", function() {
    it("should initialize with correct roles", async function() {
      expect(await validator.hasRole(VALIDATOR_ROLE, deployer.address)).to.be.true;
      expect(await validator.hasRole(METADATA_ROLE, deployer.address)).to.be.true;
      expect(await validator.owner()).to.equal(deployer.address);
    });
    
    it("should initialize with correct DeedNFT address", async function() {
      expect(await validator.deedNFT()).to.equal(contracts.deedNFT.address);
    });
  });
  
  describe("Base URI Management", function() {
    it("should allow owner to set base URI", async function() {
      const newBaseUri = "https://api.deeds.com/metadata/";
      await validator.setBaseUri(newBaseUri);
      expect(await validator.getBaseUri()).to.equal(newBaseUri);
    });
    
    it("should prevent non-owners from setting base URI", async function() {
      await expect(
        validator.connect(user1).setBaseUri("https://unauthorized.com/")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    
    it("should prevent setting empty base URI", async function() {
      await expect(
        validator.setBaseUri("")
      ).to.be.revertedWith("Validator: Base URI cannot be empty");
    });
  });
  
  describe("Operating Agreement Management", function() {
    it("should allow owner to set default operating agreement", async function() {
      const newAgreement = "ipfs://agreements/updated-default.json";
      await validator.setDefaultOperatingAgreement(newAgreement);
      expect(await validator.defaultOperatingAgreement()).to.equal(newAgreement);
    });
    
    it("should allow owner to register operating agreement names", async function() {
      const agreementUri = "ipfs://agreements/commercial.json";
      const agreementName = "Commercial Property Agreement";
      
      await validator.setOperatingAgreementName(agreementUri, agreementName);
      expect(await validator.operatingAgreementName(agreementUri)).to.equal(agreementName);
    });
    
    it("should allow owner to remove operating agreement names", async function() {
      const agreementUri = "ipfs://agreements/temporary.json";
      const agreementName = "Temporary Agreement";
      
      // First add the agreement
      await validator.setOperatingAgreementName(agreementUri, agreementName);
      
      // Then remove it
      await validator.removeOperatingAgreementName(agreementUri);
      
      // Check it's removed
      expect(await validator.operatingAgreementName(agreementUri)).to.equal("");
    });
  });
  
  describe("Asset Type Support", function() {
    it("should allow setting asset type support", async function() {
      // Test with a new asset type
      const assetTypeId = 2; // Estate
      
      // Set support to true
      await validator.setAssetTypeSupport(assetTypeId, true);
      expect(await validator.supportsAssetType(assetTypeId)).to.be.true;
      
      // Set support to false
      await validator.setAssetTypeSupport(assetTypeId, false);
      expect(await validator.supportsAssetType(assetTypeId)).to.be.false;
    });
  });
  
  describe("Token URI Generation", function() {
    it("should generate correct token URI", async function() {
      // Set a known base URI
      const baseUri = "ipfs://metadata/";
      await validator.setBaseUri(baseUri);
      
      // Check token URI for a token ID
      const tokenId = 123;
      expect(await validator.tokenURI(tokenId)).to.equal(`${baseUri}${tokenId}`);
    });
  });
  
  describe("Deed Validation", function() {
    it("should allow validators to validate deeds", async function() {
      // Grant validator role to validator1
      await validator.grantRole(VALIDATOR_ROLE, validator1.address);
      
      // Validate a deed
      const deedId = 1; // Assuming this deed exists
      const tx = await validator.connect(validator1).validateDeed(deedId);
      
      // Check for event emission
      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === "DeedValidated");
      
      expect(event).to.not.be.undefined;
      expect(event?.args?.deedId).to.equal(deedId);
      expect(event?.args?.success).to.be.true;
    });
    
    it("should prevent non-validators from validating deeds", async function() {
      await expect(
        validator.connect(user1).validateDeed(1)
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Role Management", function() {
    it("should allow admin to grant validator role", async function() {
      await validator.grantRole(VALIDATOR_ROLE, user1.address);
      expect(await validator.hasRole(VALIDATOR_ROLE, user1.address)).to.be.true;
    });
    
    it("should allow admin to revoke validator role", async function() {
      await validator.revokeRole(VALIDATOR_ROLE, user1.address);
      expect(await validator.hasRole(VALIDATOR_ROLE, user1.address)).to.be.false;
    });
  });
});
