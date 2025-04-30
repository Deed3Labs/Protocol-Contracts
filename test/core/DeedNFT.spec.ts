import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract, BaseContract } from "ethers";

// Import TypeChain types
import { DeedNFT } from "../../typechain-types/contracts/core/DeedNFT";
import { Validator } from "../../typechain-types/contracts/core/Validator";
import { ValidatorRegistry } from "../../typechain-types/contracts/core/ValidatorRegistry";
import { MetadataRenderer } from "../../typechain-types/contracts/core/MetadataRenderer";
import { FundManager } from "../../typechain-types/contracts/core/FundManager";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

// Using 'any' type to bypass TypeScript checking for contract methods
describe("DeedNFT Comprehensive Tests", function() {
  // Contract instances with proper typing
  let deedNFT: DeedNFT;
  let validator: Validator;
  let validatorRegistry: ValidatorRegistry;
  let fundManager: FundManager;
  let metadataRenderer: MetadataRenderer;
  let mockERC20: BaseContract;
  let mockMarketplace: BaseContract;
  
  // Signers
  let deployer: SignerWithAddress;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let feeReceiver: SignerWithAddress;
  let nonAuthorized: SignerWithAddress;
  
  // Constants
  const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  
  // Trait keys
  const ASSET_TYPE_KEY = ethers.keccak256(ethers.toUtf8Bytes("assetType"));
  const IS_VALIDATED_KEY = ethers.keccak256(ethers.toUtf8Bytes("isValidated"));
  const OPERATING_AGREEMENT_KEY = ethers.keccak256(ethers.toUtf8Bytes("operatingAgreement"));
  const DEFINITION_KEY = ethers.keccak256(ethers.toUtf8Bytes("definition"));
  const CONFIGURATION_KEY = ethers.keccak256(ethers.toUtf8Bytes("configuration"));
  const VALIDATOR_KEY = ethers.keccak256(ethers.toUtf8Bytes("validator"));

  beforeEach(async function() {
    [deployer, admin, user1, user2, validator1, validator2, feeReceiver, nonAuthorized] = 
      await ethers.getSigners();
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []) as ValidatorRegistry;
    await validatorRegistry.waitForDeployment();
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "ipfs://metadata/",
      "ipfs://agreements/"
    ]) as Validator;
    await validator.waitForDeployment();
    
    // Deploy MetadataRenderer
    const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
    metadataRenderer = await upgrades.deployProxy(MetadataRenderer, []) as MetadataRenderer;
    await metadataRenderer.waitForDeployment();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]) as DeedNFT;
    await deedNFT.waitForDeployment();
    
    // Update DeedNFT address in Validator
    await validator.setDeedNFT(await deedNFT.getAddress());
    
    // Deploy FundManager
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      await deedNFT.getAddress(),
      await validatorRegistry.getAddress(),
      1000, // 10% commission
      await feeReceiver.getAddress()
    ]) as FundManager;
    await fundManager.waitForDeployment();
    
    // Deploy MockERC20
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", ethers.parseEther("1000000"));
    await mockERC20.waitForDeployment();
    
    // Set the metadata renderer in DeedNFT
    await deedNFT.setMetadataRenderer(await metadataRenderer.getAddress());
    
    // Deploy MockMarketplace
    const MockMarketplace = await ethers.getContractFactory("MockMarketplace");
    mockMarketplace = await MockMarketplace.deploy();
    await mockMarketplace.waitForDeployment();
    
    // Setup roles
    await deedNFT.grantRole(VALIDATOR_ROLE, await validator1.getAddress());
    await deedNFT.grantRole(VALIDATOR_ROLE, await validator2.getAddress());
    await deedNFT.grantRole(MINTER_ROLE, await fundManager.getAddress());
    
    // Register validator in registry
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      "Test Validator"
    );
    
    // Set up validator
    await validator.setBaseUri("ipfs://metadata/");
    
    // Set up validation criteria for Land
    await validator.setValidationCriteria(0, JSON.stringify({
      requiresCountry: true,
      requiresState: true,
      requiresCounty: true,
      requiresParcelNumber: true
    }));
    
    // Set up validation criteria for Vehicle
    await validator.setValidationCriteria(1, JSON.stringify({
      requiresMake: true,
      requiresModel: true,
      requiresYear: true,
      requiresVin: true
    }));
    
    // Mint initial deed for testing
    const definition = JSON.stringify({
      country: "USA",
      state: "California",
      county: "Los Angeles",
      parcelNumber: "12345"
    });
    
    await deedNFT.mintAsset(
      await user1.getAddress(),
      0, // AssetType.Land
      "ipfs://metadata1",
      "ipfs://agreement1",
      definition,
      "configuration1",
      await validator.getAddress()
    );
  });

  describe("Initialization", function() {
    it("should initialize with correct values", async function() {
      expect(await deedNFT.name()).to.equal("DeedNFT");
      expect(await deedNFT.symbol()).to.equal("DEED");
      expect(await deedNFT.nexttokenId()).to.equal(2n); // After minting one token
    });
    
    it("should set up roles correctly", async function() {
      expect(await deedNFT.hasRole(DEFAULT_ADMIN_ROLE, await deployer.getAddress())).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, await deployer.getAddress())).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, await validator1.getAddress())).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, await validator2.getAddress())).to.be.true;
      expect(await deedNFT.hasRole(MINTER_ROLE, await fundManager.getAddress())).to.be.true;
    });
    
    it("should initialize traits correctly", async function() {
      // Check trait names
      expect(await deedNFT.getTraitName(ASSET_TYPE_KEY)).to.equal("Asset Type");
      expect(await deedNFT.getTraitName(IS_VALIDATED_KEY)).to.equal("Validation Status");
      expect(await deedNFT.getTraitName(OPERATING_AGREEMENT_KEY)).to.equal("Operating Agreement");
      expect(await deedNFT.getTraitName(DEFINITION_KEY)).to.equal("Definition");
      expect(await deedNFT.getTraitName(CONFIGURATION_KEY)).to.equal("Configuration");
      expect(await deedNFT.getTraitName(VALIDATOR_KEY)).to.equal("Validator");
      
      // Check trait metadata URI is not empty
      const metadataURI = await deedNFT.getTraitMetadataURI();
      expect(metadataURI).to.not.be.empty;
      expect(metadataURI.startsWith("data:application/json;charset=utf-8;base64,")).to.be.true;
    });
  });
  
  describe("Minting", function() {
    it("should mint a new deed with correct properties", async function() {
      const definition = JSON.stringify({
        make: "Toyota",
        model: "Camry",
        year: "2020",
        vin: "1HGCM82633A123456"
      });
      
      const tx = await deedNFT.mintAsset(
        user2.address,
        1, // AssetType.Vehicle
        "ipfs://metadata-vehicle",
        "ipfs://agreement-vehicle",
        definition,
        "vehicle-configuration",
        await validator.getAddress()
      );
      
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction receipt is null");
      
      // Find the transfer event to get the token ID
      const transferEvents = receipt.logs.filter((log: any) => {
        try {
          const parsedLog = deedNFT.interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          return parsedLog?.name === "Transfer";
        } catch (e) {
          return false;
        }
      });
      
      if (transferEvents.length === 0) {
        throw new Error("Transfer event not found");
      }
      
      const transferEvent = deedNFT.interface.parseLog({
        topics: transferEvents[0].topics,
        data: transferEvents[0].data
      });
      
      const tokenId = transferEvent?.args.tokenId;
      
      // Check ownership
      expect(await deedNFT.ownerOf(tokenId)).to.equal(user2.address);
      
      // Check trait values
      const assetTypeBytes = await deedNFT.getTraitValue(tokenId, ASSET_TYPE_KEY);
      const assetType = Buffer.from(assetTypeBytes.slice(2), 'hex')
                              .toString('utf8')
                              .trim()
                              .replace(/\0/g, '');
      expect(assetType).to.equal("1"); // Vehicle
      
      const isValidatedBytes = await deedNFT.getTraitValue(tokenId, IS_VALIDATED_KEY);
      const isValidated = isValidatedBytes.toString() !== '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(isValidated).to.be.false; // Should be false initially
      
      const validatorBytes = await deedNFT.getTraitValue(tokenId, VALIDATOR_KEY);
      const validatorAddress = ethers.getAddress('0x' + validatorBytes.slice(26));
      expect(validatorAddress).to.equal(await validator.getAddress());
      
      // Check definition trait
      const definitionBytes = await deedNFT.getTraitValue(tokenId, DEFINITION_KEY);
      const storedDefinition = Buffer.from(definitionBytes.slice(2), 'hex')
                                    .toString('utf8')
                                    .trim()
                                    .replace(/\0/g, '');
      expect(storedDefinition).to.equal(definition);
    });
    
    it("should revert when non-minter tries to mint", async function() {
      await expect(
        deedNFT.connect(nonAuthorized).mintAsset(
          user2.address,
          1,
          "ipfs://metadata",
          "ipfs://agreement",
          "definition",
          "configuration",
          await validator.getAddress()
        )
      ).to.be.revertedWith(/AccessControl/);
    });
    
    it("should revert when minting with invalid definition", async function() {
      const invalidDefinition = JSON.stringify({
        make: "Toyota",
        model: "Camry"
        // Missing year and VIN
      });
      
      await expect(
        deedNFT.mintAsset(
          user2.address,
          1, // Vehicle
          "ipfs://metadata",
          "ipfs://agreement",
          invalidDefinition,
          "configuration",
          await validator.getAddress()
        )
      ).to.be.revertedWith(/ValidationError/);
    });
  });
  
  describe("Validation", function() {
    it("should properly validate deeds using Validator contract", async function() {
      const tokenId = 1n; // From initial mint
      
      // Validate the deed
      await validator.connect(validator1).validateDeed(tokenId);
      
      // Check validation status
      const [isValidated, validatorAddr] = await deedNFT.getValidationStatus(tokenId);
      expect(isValidated).to.be.true;
      expect(validatorAddr).to.equal(await validator1.getAddress());
      
      // Check trait values
      const isValidatedBytes = await deedNFT.getTraitValue(tokenId, IS_VALIDATED_KEY);
      const isValidatedTrait = isValidatedBytes.toString() !== '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(isValidatedTrait).to.be.true;
      
      const validatorBytes = await deedNFT.getTraitValue(tokenId, VALIDATOR_KEY);
      const validatorAddress = ethers.getAddress('0x' + validatorBytes.slice(26));
      expect(validatorAddress).to.equal(await validator1.getAddress());
    });
    
    it("should revert when validating with invalid definition", async function() {
      const tokenId = 1n;
      
      // Update definition to be invalid
      const invalidDefinition = JSON.stringify({
        country: "USA"
        // Missing required fields
      });
      
      await deedNFT.updateMetadata(
        tokenId,
        "ipfs://metadata",
        "ipfs://agreement",
        invalidDefinition,
        "configuration"
      );
      
      await expect(
        validator.connect(validator1).validateDeed(tokenId)
      ).to.be.revertedWith(/ValidationError/);
    });
    
    it("should allow invalidating a validated deed", async function() {
      const tokenId = 1n;
      
      // First validate
      await validator.connect(validator1).validateDeed(tokenId);
      
      // Then invalidate
      await validator.connect(validator1).validateDeed(tokenId);
      
      // Check validation status
      const [isValidated, validatorAddr] = await deedNFT.getValidationStatus(tokenId);
      expect(isValidated).to.be.false;
      expect(validatorAddr).to.equal(ethers.ZeroAddress);
    });
  });
  
  describe("Metadata Rendering", function() {
    it("should properly render metadata through MetadataRenderer", async function() {
      const tokenId = 1n;
      
      // Validate the deed first
      await validator.connect(validator1).validateDeed(tokenId);
      
      // Get rendered metadata
      const metadataURI = await deedNFT.tokenURI(tokenId);
      
      // Check metadata format
      expect(metadataURI).to.not.be.empty;
      expect(metadataURI.startsWith("data:application/json;base64,")).to.be.true;
      
      // Decode and parse metadata
      const base64Data = metadataURI.split(",")[1];
      const jsonData = Buffer.from(base64Data, "base64").toString();
      const metadata = JSON.parse(jsonData);
      
      // Check metadata content
      expect(metadata.name).to.not.be.empty;
      expect(metadata.description).to.not.be.empty;
      expect(metadata.image).to.not.be.empty;
      expect(metadata.attributes).to.be.an("array");
      expect(metadata.properties).to.be.an("object");
    });
    
    it("should update metadata when traits change", async function() {
      const tokenId = 1n;
      
      // Update definition
      const newDefinition = JSON.stringify({
        country: "USA",
        state: "New York",
        county: "Manhattan",
        parcelNumber: "67890"
      });
      
      await deedNFT.updateMetadata(
        tokenId,
        "ipfs://metadata",
        "ipfs://agreement",
        newDefinition,
        "configuration"
      );
      
      // Get updated metadata
      const metadataURI = await deedNFT.tokenURI(tokenId);
      const base64Data = metadataURI.split(",")[1];
      const jsonData = Buffer.from(base64Data, "base64").toString();
      const metadata = JSON.parse(jsonData);
      
      // Check that definition was updated
      expect(metadata.properties.definition).to.equal(newDefinition);
    });
  });
  
  describe("Royalty Enforcement", function() {
    it("should enforce royalties on transfers", async function() {
      const tokenId = 1n;
      
      // Enable royalty enforcement
      await deedNFT.setRoyaltyEnforcement(true);
      
      // Try to transfer to non-approved marketplace
      await expect(
        deedNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId)
      ).to.be.revertedWith(/!mkt/);
      
      // Approve marketplace
      await deedNFT.setApprovedMarketplace(await mockMarketplace.getAddress(), true);
      
      // Transfer should now succeed
      await expect(
        deedNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId)
      ).to.not.be.reverted;
    });
    
    it("should calculate correct royalty amounts", async function() {
      const tokenId = 1n;
      const salePrice = ethers.parseEther("1.0");
      
      // Get royalty info
      const [receiver, amount] = await deedNFT.royaltyInfo(tokenId, salePrice);
      
      // Check royalty calculation (5% of sale price)
      expect(receiver).to.equal(await feeReceiver.getAddress());
      expect(amount).to.equal(salePrice * 5n / 100n);
    });

    it("should handle royalty enforcement state changes", async function() {
      // Initially royalties should be enforced
      expect(await deedNFT.isRoyaltyEnforced()).to.be.true;
      
      // Disable royalty enforcement
      await deedNFT.setRoyaltyEnforcement(false);
      expect(await deedNFT.isRoyaltyEnforced()).to.be.false;
      
      // Enable royalty enforcement
      await deedNFT.setRoyaltyEnforcement(true);
      expect(await deedNFT.isRoyaltyEnforced()).to.be.true;
    });

    it("should handle marketplace approvals correctly", async function() {
      const marketplace = await mockMarketplace.getAddress();
      
      // Initially marketplace should not be approved
      expect(await deedNFT.isApprovedMarketplace(marketplace)).to.be.false;
      
      // Approve marketplace
      await deedNFT.setApprovedMarketplace(marketplace, true);
      expect(await deedNFT.isApprovedMarketplace(marketplace)).to.be.true;
      
      // Revoke marketplace approval
      await deedNFT.setApprovedMarketplace(marketplace, false);
      expect(await deedNFT.isApprovedMarketplace(marketplace)).to.be.false;
    });

    it("should enforce marketplace restrictions on approvals", async function() {
      const tokenId = 1n;
      const marketplace = await mockMarketplace.getAddress();
      
      // Enable royalty enforcement
      await deedNFT.setRoyaltyEnforcement(true);
      
      // Try to approve non-approved marketplace
      await expect(
        deedNFT.connect(user1).approve(marketplace, tokenId)
      ).to.be.revertedWith(/!mkt/);
      
      // Try to set approval for all with non-approved marketplace
      await expect(
        deedNFT.connect(user1).setApprovalForAll(marketplace, true)
      ).to.be.revertedWith(/!mkt/);
      
      // Approve marketplace
      await deedNFT.setApprovedMarketplace(marketplace, true);
      
      // Approvals should now succeed
      await expect(
        deedNFT.connect(user1).approve(marketplace, tokenId)
      ).to.not.be.reverted;
      
      await expect(
        deedNFT.connect(user1).setApprovalForAll(marketplace, true)
      ).to.not.be.reverted;
    });
  });
  
  describe("FundManager Integration", function() {
    it("should handle service fees correctly", async function() {
      const tokenId = 1n;
      
      // Set up service fee
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseEther("0.1"));
      
      // Approve marketplace
      await deedNFT.setApprovedMarketplace(await mockMarketplace.getAddress(), true);
      
      // Transfer token
      await deedNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId);
      
      // Check service fee balance
      const balance = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(balance).to.equal(ethers.parseEther("0.1"));
    });

    it("should handle FundManager updates", async function() {
      // Deploy new FundManager
      const NewFundManager = await ethers.getContractFactory("FundManager");
      const newFundManager = await upgrades.deployProxy(NewFundManager, [
        await deedNFT.getAddress(),
        await validatorRegistry.getAddress(),
        2000, // 20% commission
        await feeReceiver.getAddress()
      ]) as FundManager;
      await newFundManager.waitForDeployment();
      
      // Update FundManager
      await deedNFT.setFundManager(await newFundManager.getAddress());
      
      // Verify update
      expect(await deedNFT.fundManager()).to.equal(await newFundManager.getAddress());
    });

    it("should handle royalty distribution with FundManager commission", async function() {
      const tokenId = 1n;
      const salePrice = ethers.parseEther("1.0");
      
      // Get royalty info
      const [receiver, amount] = await deedNFT.royaltyInfo(tokenId, salePrice);
      
      // Calculate expected amounts
      const fullRoyalty = salePrice * 5n / 100n; // 5% royalty
      const commission = fullRoyalty * 10n / 100n; // 10% commission
      const expectedAmount = fullRoyalty - commission;
      
      expect(receiver).to.equal(await feeReceiver.getAddress());
      expect(amount).to.equal(expectedAmount);
    });
  });

  describe("Transfer Validator", function() {
    it("should handle transfer validator updates", async function() {
      // Initially transfer validator should be zero address
      expect(await deedNFT.getTransferValidator()).to.equal(ethers.ZeroAddress);
      
      // Set new transfer validator
      await deedNFT.setTransferValidator(await validator1.getAddress());
      expect(await deedNFT.getTransferValidator()).to.equal(await validator1.getAddress());
    });

    it("should return correct transfer validation function", async function() {
      const [functionSignature, isViewFunction] = await deedNFT.getTransferValidationFunction();
      
      // Verify function signature
      expect(functionSignature).to.equal(
        ethers.keccak256(ethers.toUtf8Bytes("validateTransfer(address,address,address,uint256)"))
      );
      expect(isViewFunction).to.be.true;
    });
  });

  describe("Trait Management", function() {
    it("should handle trait removal", async function() {
      const tokenId = 1n;
      const traitName = "definition";
      
      // Remove trait
      await deedNFT.removeTrait(tokenId, traitName);
      
      // Verify trait is removed
      const traitValue = await deedNFT.getTraitValue(tokenId, ethers.keccak256(ethers.toUtf8Bytes(traitName)));
      expect(traitValue).to.equal("0x");
    });

    it("should handle different trait value types", async function() {
      const tokenId = 1n;
      const traitName = "testTrait";
      
      // Test string value
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes(traitName),
        ethers.toUtf8Bytes("testValue"),
        1 // string type
      );
      
      // Test numeric value
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("numericTrait"),
        ethers.toBeArray(ethers.toBigInt(123)),
        2 // uint256 type
      );
      
      // Test boolean value
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("booleanTrait"),
        ethers.toBeArray(ethers.toBigInt(1)),
        3 // boolean type
      );
      
      // Verify values
      const stringValue = await deedNFT.getTraitValue(tokenId, ethers.keccak256(ethers.toUtf8Bytes(traitName)));
      expect(ethers.decodeBytes32String(stringValue)).to.equal("testValue");
      
      const numericValue = await deedNFT.getTraitValue(tokenId, ethers.keccak256(ethers.toUtf8Bytes("numericTrait")));
      expect(ethers.toBigInt(numericValue)).to.equal(123n);
      
      const booleanValue = await deedNFT.getTraitValue(tokenId, ethers.keccak256(ethers.toUtf8Bytes("booleanTrait")));
      expect(ethers.toBigInt(booleanValue)).to.equal(1n);
    });

    it("should handle multiple trait operations", async function() {
      const tokenId = 1n;
      const traitKeys = [
        ethers.keccak256(ethers.toUtf8Bytes("assetType")),
        ethers.keccak256(ethers.toUtf8Bytes("isValidated")),
        ethers.keccak256(ethers.toUtf8Bytes("definition"))
      ];
      
      // Get multiple trait values
      const values = await deedNFT.getTraitValues(tokenId, traitKeys);
      expect(values.length).to.equal(3);
      
      // Get all trait keys for token
      const allKeys = await deedNFT.getTraitKeys(tokenId);
      expect(allKeys.length).to.be.greaterThan(0);
    });
  });

  describe("Contract URI", function() {
    it("should handle contract URI updates", async function() {
      const newURI = "ipfs://new-contract-uri";
      
      // Initially contract URI should be empty
      expect(await deedNFT.contractURI()).to.equal("");
      
      // Set new contract URI
      await deedNFT.setContractURI(newURI);
      expect(await deedNFT.contractURI()).to.equal(newURI);
    });
  });

  describe("Token URI", function() {
    it("should handle token URI fallback", async function() {
      const tokenId = 1n;
      
      // Set token URI through minting
      const tokenURI = "ipfs://token-uri";
      await deedNFT.mintAsset(
        await user1.getAddress(),
        0, // AssetType.Land
        tokenURI,
        "ipfs://agreement1",
        "definition",
        "configuration1",
        await validator.getAddress()
      );
      
      // Get token URI
      const retrievedURI = await deedNFT.tokenURI(tokenId);
      expect(retrievedURI).to.equal(tokenURI);
    });

    it("should handle metadata renderer integration", async function() {
      const tokenId = 1n;
      
      // Set metadata renderer
      await deedNFT.setMetadataRenderer(await metadataRenderer.getAddress());
      
      // Get token URI through metadata renderer
      const renderedURI = await deedNFT.tokenURI(tokenId);
      expect(renderedURI).to.not.be.empty;
    });
  });

  describe("Pausable", function() {
    it("should handle contract pausing", async function() {
      const tokenId = 1n;
      
      // Initially contract should not be paused
      expect(await deedNFT.paused()).to.be.false;
      
      // Pause contract
      await deedNFT.pause();
      expect(await deedNFT.paused()).to.be.true;
      
      // Try to perform operations while paused
      await expect(
        deedNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId)
      ).to.be.revertedWith(/Pausable: paused/);
      
      // Unpause contract
      await deedNFT.unpause();
      expect(await deedNFT.paused()).to.be.false;
      
      // Operations should work again
      await expect(
        deedNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId)
      ).to.not.be.reverted;
    });
  });

  describe("Role Management", function() {
    it("should handle role grants and revokes", async function() {
      // Initially admin should have all roles
      expect(await deedNFT.hasRole(DEFAULT_ADMIN_ROLE, await deployer.getAddress())).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, await deployer.getAddress())).to.be.true;
      expect(await deedNFT.hasRole(MINTER_ROLE, await deployer.getAddress())).to.be.true;
      
      // Grant MINTER_ROLE to user1
      await deedNFT.addMinter(await user1.getAddress());
      expect(await deedNFT.hasRole(MINTER_ROLE, await user1.getAddress())).to.be.true;
      
      // Revoke MINTER_ROLE from user1
      await deedNFT.removeMinter(await user1.getAddress());
      expect(await deedNFT.hasRole(MINTER_ROLE, await user1.getAddress())).to.be.false;
    });
  });
});