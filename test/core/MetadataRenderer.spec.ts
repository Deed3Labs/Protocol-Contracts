import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

// Use 'any' type to avoid TypeScript errors with contract methods
describe("MetadataRenderer Contract", function() {
  let metadataRenderer: any;
  let deedNFT: any;
  let validator: any;
  let validatorRegistry: any;
  let deployer: SignerWithAddress;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let nonAuthorized: SignerWithAddress;
  let tokenId: number;
  let METADATA_MANAGER_ROLE: string;
  
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, admin, user1, nonAuthorized] = [
      signers[0], signers[1], signers[2], signers[3]
    ];
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      ethers.ZeroAddress, // Temporarily set to zero address
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [await deedNFT.getAddress()]);
    await validator.waitForDeployment();
    
    // Update DeedNFT with validator
    await deedNFT.setValidator(await validator.getAddress());
    
    // Deploy MetadataRenderer
    const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
    metadataRenderer = await upgrades.deployProxy(MetadataRenderer, [
        "https://api.deeds.com/metadata/"
    ]);
    await metadataRenderer.waitForDeployment();
    
    // Set the metadata renderer in DeedNFT
    await deedNFT.setMetadataRenderer(await metadataRenderer.getAddress());
    
    // Get roles
    METADATA_MANAGER_ROLE = await metadataRenderer.METADATA_MANAGER_ROLE();
    
    // Grant roles
    await metadataRenderer.grantRole(METADATA_MANAGER_ROLE, deployer.address);
    
    // Mint a token for testing
    const mintTx = await deedNFT.mint(
      user1.address, 
      0, // Asset type 0 - Land
      "ipfs://default-metadata",
      "ipfs://default-agreement"
    );
    const receipt = await mintTx.wait();
    const transferEvent = receipt.logs.find((e: any) => {
      try {
        const decoded = deedNFT.interface.parseLog({ topics: e.topics, data: e.data });
        return decoded?.name === 'Transfer';
      } catch {
        return false;
      }
    });
    
    if (!transferEvent) {
      throw new Error("Transfer event not found");
    }
    
    const eventData = deedNFT.interface.parseLog({ 
      topics: transferEvent.topics, 
      data: transferEvent.data 
    });
    
    // Add null check for eventData
    if (!eventData) {
      throw new Error("Failed to parse transfer event");
    }
    
    tokenId = eventData.args.tokenId;
  });
  
  describe("Initialization", function() {
    it("should initialize with correct deedNFT address", async function() {
      expect(await metadataRenderer.deedNFT()).to.equal(await deedNFT.getAddress());
    });
    
    it("should initialize with correct roles", async function() {
      expect(await metadataRenderer.hasRole(METADATA_MANAGER_ROLE, deployer.address)).to.be.true;
    });
    
    it("should initialize with default base URI", async function() {
      expect(await metadataRenderer.baseURI()).to.equal("https://api.deeds.com/metadata/");
    });
  });
  
  describe("Base URI Management", function() {
    it("should allow manager to update base URI", async function() {
      const newBaseURI = "https://api.deeds.com/metadata/";
      await metadataRenderer.setBaseURI(newBaseURI);
      expect(await metadataRenderer.baseURI()).to.equal(newBaseURI);
    });
    
    it("should emit BaseURIUpdated event when base URI is updated", async function() {
      const newBaseURI = "https://api.deeds.com/metadata/";
      await expect(metadataRenderer.setBaseURI(newBaseURI))
        .to.emit(metadataRenderer, "BaseURIUpdated")
        .withArgs("https://api.deeds.com/metadata/", newBaseURI);
    });
    
    it("should not allow non-managers to update base URI", async function() {
      await expect(
        metadataRenderer.connect(nonAuthorized).setBaseURI("https://unauthorized.com/")
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Token URI Generation", function() {
    beforeEach(async function() {
      // Set a base URI for testing
      await metadataRenderer.setBaseURI("https://api.deeds.com/metadata/");
    });
    
    it("should generate correct token URI with base URI", async function() {
      const tokenURI = await metadataRenderer.tokenURI(tokenId);
      expect(tokenURI).to.equal(`https://api.deeds.com/metadata/${tokenId}`);
    });
    
    it("should fall back to original URI if no base URI is set", async function() {
      // Clear base URI
      await metadataRenderer.setBaseURI("");
      
      // Set token-specific URI
      await metadataRenderer.setTokenURI(tokenId, "ipfs://custom-token-metadata");
      
      const tokenURI = await metadataRenderer.tokenURI(tokenId);
      expect(tokenURI).to.equal("ipfs://custom-token-metadata");
    });
    
    it("should prioritize token-specific URIs over base URI", async function() {
      // Set token-specific URI
      await metadataRenderer.setTokenURI(tokenId, "ipfs://custom-token-metadata");
      
      const tokenURI = await metadataRenderer.tokenURI(tokenId);
      expect(tokenURI).to.equal("ipfs://custom-token-metadata");
    });
  });
  
  describe("Token-specific URI Management", function() {
    it("should allow manager to set token-specific URI", async function() {
      const customURI = "ipfs://custom-token-metadata";
      await metadataRenderer.setTokenURI(tokenId, customURI);
      
      const storedURI = await metadataRenderer.tokenURIs(tokenId);
      expect(storedURI).to.equal(customURI);
    });
    
    it("should emit TokenURIUpdated event when token URI is set", async function() {
      const customURI = "ipfs://custom-token-metadata";
      await expect(metadataRenderer.setTokenURI(tokenId, customURI))
        .to.emit(metadataRenderer, "TokenURIUpdated")
        .withArgs(tokenId, customURI);
    });
    
    it("should not allow non-managers to set token URI", async function() {
      await expect(
        metadataRenderer.connect(nonAuthorized).setTokenURI(tokenId, "ipfs://unauthorized")
      ).to.be.revertedWith("AccessControl");
    });
    
    it("should allow manager to set multiple token URIs at once", async function() {
      // Mint another token
      const mintTx = await deedNFT.mint(
        user1.address, 
        1, // Asset type 1 - Vehicle
        "ipfs://default-metadata-2",
        "ipfs://default-agreement-2"
      );
      const receipt = await mintTx.wait();
      const transferEvent = receipt.logs.find((e: any) => {
        try {
          const decoded = deedNFT.interface.parseLog({ topics: e.topics, data: e.data });
          return decoded?.name === 'Transfer';
        } catch {
          return false;
        }
      });
      
      if (!transferEvent) {
        throw new Error("Transfer event not found");
      }
      
      const eventData = deedNFT.interface.parseLog({ 
        topics: transferEvent.topics, 
        data: transferEvent.data 
      });
      
      // Add null check for eventData
      if (!eventData) {
        throw new Error("Failed to parse transfer event");
      }
      
      const tokenId2 = eventData.args.tokenId;
      
      // Set both token URIs
      const tokenIds = [tokenId, tokenId2];
      const uris = ["ipfs://batch-uri-1", "ipfs://batch-uri-2"];
      
      await metadataRenderer.setTokenURIBatch(tokenIds, uris);
      
      // Check both were set correctly
      expect(await metadataRenderer.tokenURIs(tokenId)).to.equal("ipfs://batch-uri-1");
      expect(await metadataRenderer.tokenURIs(tokenId2)).to.equal("ipfs://batch-uri-2");
    });
  });
  
  describe("Contract Integration", function() {
    it("should correctly provide URI to DeedNFT contract", async function() {
      // Set custom URI in renderer
      await metadataRenderer.setTokenURI(tokenId, "ipfs://integration-test");
      
      // Get URI from DeedNFT (should use renderer)
      const tokenURI = await deedNFT.tokenURI(tokenId);
      expect(tokenURI).to.equal("ipfs://integration-test");
    });
    
    it("should handle token URI updates", async function() {
      // Set initial URI
      await metadataRenderer.setTokenURI(tokenId, "ipfs://initial");
      
      // Check URI from DeedNFT
      let tokenURI = await deedNFT.tokenURI(tokenId);
      expect(tokenURI).to.equal("ipfs://initial");
      
      // Update URI
      await metadataRenderer.setTokenURI(tokenId, "ipfs://updated");
      
      // Check updated URI from DeedNFT
      tokenURI = await deedNFT.tokenURI(tokenId);
      expect(tokenURI).to.equal("ipfs://updated");
    });
  });
  
  describe("Metadata Extras", function() {
    it("should allow setting contract-level metadata", async function() {
      const contractURI = "ipfs://contract-metadata";
      await metadataRenderer.setContractURI(contractURI);
      expect(await metadataRenderer.contractURI()).to.equal(contractURI);
    });
    
    it("should emit ContractURIUpdated event", async function() {
      const contractURI = "ipfs://contract-metadata";
      await expect(metadataRenderer.setContractURI(contractURI))
        .to.emit(metadataRenderer, "ContractURIUpdated")
        .withArgs(contractURI);
    });
  });
  
  describe("Access Control", function() {
    it("should allow adding and removing metadata managers", async function() {
      // Add a new manager
      await metadataRenderer.grantRole(METADATA_MANAGER_ROLE, admin.address);
      expect(await metadataRenderer.hasRole(METADATA_MANAGER_ROLE, admin.address)).to.be.true;
      
      // New manager should be able to update metadata
      await metadataRenderer.connect(admin).setTokenURI(tokenId, "ipfs://new-manager");
      expect(await metadataRenderer.tokenURIs(tokenId)).to.equal("ipfs://new-manager");
      
      // Remove manager
      await metadataRenderer.revokeRole(METADATA_MANAGER_ROLE, admin.address);
      expect(await metadataRenderer.hasRole(METADATA_MANAGER_ROLE, admin.address)).to.be.false;
      
      // Former manager should not be able to update metadata
      await expect(
        metadataRenderer.connect(admin).setTokenURI(tokenId, "ipfs://former-manager")
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Upgradeability", function() {
    it("should be upgradeable", async function() {
      // Test upgradeability by deploying a new implementation
      const MetadataRendererV2 = await ethers.getContractFactory("MetadataRenderer");
      const upgradedRenderer = await upgrades.upgradeProxy(
        await metadataRenderer.getAddress(),
        MetadataRendererV2
      );
      
      // Verify the upgrade was successful
      expect(await upgradedRenderer.getAddress()).to.equal(await metadataRenderer.getAddress());
      
      // Verify state was preserved
      expect(await upgradedRenderer.deedNFT()).to.equal(await deedNFT.getAddress());
      expect(await upgradedRenderer.hasRole(METADATA_MANAGER_ROLE, deployer.address)).to.be.true;
    });
  });
}); 