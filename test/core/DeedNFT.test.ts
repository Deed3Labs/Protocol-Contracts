import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

// Using 'any' type to bypass TypeScript checking for contract methods
describe("DeedNFT Comprehensive Tests", function() {
  // Contract instances
  let deedNFT: any; // Use 'any' type to avoid TypeScript errors
  let validator: any;
  let validatorRegistry: any;
  let fundManager: any;
  let mockERC20: any;
  let mockRenderer: any;
  let mockMarketplace: any;
  
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
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [ethers.ZeroAddress]);
    await validator.waitForDeployment();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();
    
    // Update DeedNFT address in Validator
    await validator.setDeedNFT(await deedNFT.getAddress());
    
    // Deploy FundManager
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      await deedNFT.getAddress(),
      await validatorRegistry.getAddress(),
      1000, // 10% commission
      feeReceiver.address
    ]);
    await fundManager.waitForDeployment();
    
    // Deploy MockERC20
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", ethers.parseEther("1000000"));
    await mockERC20.waitForDeployment();
    
    // Deploy MockRenderer (for ERC-7572)
    const MockRenderer = await ethers.getContractFactory("MockRenderer");
    mockRenderer = await MockRenderer.deploy();
    await mockRenderer.waitForDeployment();
    
    // Deploy MockMarketplace
    const MockMarketplace = await ethers.getContractFactory("MockMarketplace");
    mockMarketplace = await MockMarketplace.deploy();
    await mockMarketplace.waitForDeployment();
    
    // Setup roles
    await deedNFT.grantRole(VALIDATOR_ROLE, validator1.address);
    await deedNFT.grantRole(VALIDATOR_ROLE, validator2.address);
    await deedNFT.grantRole(MINTER_ROLE, await fundManager.getAddress());
    
    // Register validator in registry
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      deployer.address,
      "Test Validator",
      "Test validator for unit tests",
      [0, 1, 2, 3] // Support all asset types
    );
    
    // Set up validator
    await validator.setBaseUri("ipfs://metadata/");
    await validator.setRoyaltyInfo(feeReceiver.address, 500); // 5% royalty
    
    // Mint initial deed for testing
    await deedNFT.mintAsset(
      user1.address,
      0, // AssetType.Land
      "ipfs://metadata1",
      "ipfs://agreement1",
      "definition1",
      "configuration1",
      await validator.getAddress()
    );
  });

  describe("Initialization", function() {
    it("should initialize with correct values", async function() {
      expect(await deedNFT.name()).to.equal("DeedNFT");
      expect(await deedNFT.symbol()).to.equal("DEED");
      expect(await deedNFT.nexttokenId()).to.equal(2); // After minting one token
    });
    
    it("should set up roles correctly", async function() {
      expect(await deedNFT.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, deployer.address)).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validator1.address)).to.be.true;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, validator2.address)).to.be.true;
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
      const tx = await deedNFT.mintAsset(
        user2.address,
        1, // AssetType.Vehicle
        "ipfs://metadata-vehicle",
        "ipfs://agreement-vehicle",
        "vehicle-definition",
        "vehicle-configuration",
        await validator.getAddress()
      );
      
      const receipt = await tx.wait();
      
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
      // Use proper ethers v6 methods for bytes decoding
      const assetType = Buffer.from(assetTypeBytes.slice(2), 'hex')
                              .toString('utf8')
                              .trim()
                              .replace(/\0/g, '');
      expect(assetType).to.equal("1"); // Vehicle
      
      const isValidatedBytes = await deedNFT.getTraitValue(tokenId, IS_VALIDATED_KEY);
      // Use proper ethers v6 syntax for boolean decoding
      const isValidated = isValidatedBytes.toString() !== '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(isValidated).to.be.true;
      
      const validatorBytes = await deedNFT.getTraitValue(tokenId, VALIDATOR_KEY);
      // Use proper ethers v6 syntax for address decoding
      const validatorAddress = ethers.getAddress('0x' + validatorBytes.slice(26));
      expect(validatorAddress).to.equal(await validator.getAddress());
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
  });
  
  describe("Validation", function() {
    it("should allow validators to validate assets", async function() {
      // First invalidate the deed
      await deedNFT.connect(validator1).validateAsset(1, false);
      
      // Check that the deed is now invalidated
      const [isValidated, validatorAddr] = await deedNFT.getValidationStatus(1);
      expect(isValidated).to.be.false;
      expect(validatorAddr).to.equal(validator1.address);
      
      // Validate again
      await deedNFT.connect(validator2).validateAsset(1, true);
      
      // Check that the deed is now validated
      const [finalValidation, finalValidator] = await deedNFT.getValidationStatus(1);
      expect(finalValidation).to.be.true;
      expect(finalValidator).to.equal(validator2.address);
    });
    
    it("should emit TokenValidated event when validation status changes", async function() {
      await expect(deedNFT.connect(validator1).validateAsset(1, false))
        .to.emit(deedNFT, "TokenValidated")
        .withArgs(1, false, validator1.address);
    });
    
    it("should not allow non-validators to validate assets", async function() {
      await expect(
        deedNFT.connect(nonAuthorized).validateAsset(1, true)
      ).to.be.revertedWith(/AccessControl/);
    });
  });
  
  describe("Metadata Updates", function() {
    it("should allow owner to update metadata", async function() {
      // Update metadata as owner
      await deedNFT.connect(user1).updateMetadata(
        1,
        "ipfs://updated-metadata",
        "ipfs://updated-agreement",
        "updated-definition",
        "updated-configuration"
      );
      
      // Get updated trait values
      const agreementBytes = await deedNFT.getTraitValue(1, OPERATING_AGREEMENT_KEY);
      // Use proper ethers v6 method for string decoding
      const agreement = Buffer.from(agreementBytes.slice(2), 'hex').toString('utf8').replace(/\0/g, '');
      expect(agreement).to.equal("ipfs://updated-agreement");
      
      const definitionBytes = await deedNFT.getTraitValue(1, DEFINITION_KEY);
      const definition = Buffer.from(definitionBytes.slice(2), 'hex').toString('utf8').replace(/\0/g, '');
      expect(definition).to.equal("updated-definition");
      
      const configBytes = await deedNFT.getTraitValue(1, CONFIGURATION_KEY);
      const config = Buffer.from(configBytes.slice(2), 'hex').toString('utf8').replace(/\0/g, '');
      expect(config).to.equal("updated-configuration");
      
      // When updated by non-validator, isValidated should be false
      const isValidatedBytes = await deedNFT.getTraitValue(1, IS_VALIDATED_KEY);
      const isValidated = isValidatedBytes.toString() !== '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(isValidated).to.be.false;
    });
    
    it("should maintain validation status when updated by validator", async function() {
      // First validate the deed
      await deedNFT.connect(validator1).validateAsset(1, true);
      
      // Update metadata as validator
      await deedNFT.connect(validator1).updateMetadata(
        1,
        "ipfs://validator-update",
        "ipfs://validator-agreement",
        "validator-definition",
        "validator-configuration"
      );
      
      // Validation status should still be true
      const isValidatedBytes = await deedNFT.getTraitValue(1, IS_VALIDATED_KEY);
      const isValidated = isValidatedBytes.toString() !== '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(isValidated).to.be.true;
    });
    
    it("should not allow non-owners/non-validators to update metadata", async function() {
      await expect(
        deedNFT.connect(nonAuthorized).updateMetadata(
          1,
          "ipfs://unauthorized",
          "ipfs://unauthorized",
          "unauthorized",
          "unauthorized"
        )
      ).to.be.revertedWith("DeedNFT: Caller is not validator or owner");
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
    
    it("should emit DeedNFTBurned event when a deed is burned", async function() {
      await expect(deedNFT.connect(user1).burnAsset(1))
        .to.emit(deedNFT, "DeedNFTBurned")
        .withArgs(1);
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
      const [beforeValidation, _] = await deedNFT.getValidationStatus(1);
      
      // Transfer from user1 to user2
      await deedNFT.connect(user1).transferFrom(user1.address, user2.address, 1);
      
      // Check validation status after transfer
      const [afterValidation, __] = await deedNFT.getValidationStatus(1);
      expect(afterValidation).to.equal(beforeValidation);
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
    
    it("should not allow non-admins to pause", async function() {
      await expect(deedNFT.connect(nonAuthorized).pause())
        .to.be.revertedWith(/AccessControl/);
    });
  });
  
  describe("Token URI", function() {
    it("should return the correct token URI from validator", async function() {
      // Get token URI
      const tokenURI = await deedNFT.tokenURI(1);
      
      // The validator's baseURI is "ipfs://metadata/" and it appends the token ID
      expect(tokenURI).to.equal(`ipfs://metadata/1`);
    });
    
    it("should use metadata renderer when set", async function() {
      // Set metadata renderer
      await deedNFT.setMetadataRenderer(await mockRenderer.getAddress());
      
      // Set mock renderer to return a specific URI
      await mockRenderer.setTokenURI(await deedNFT.getAddress(), 1, "https://custom-renderer/1");
      
      // Get token URI
      const tokenURI = await deedNFT.tokenURI(1);
      
      // Should use the renderer's URI
      expect(tokenURI).to.equal("https://custom-renderer/1");
    });
  });
  
  describe("Royalty Enforcement", function() {
    it("should return correct royalty information", async function() {
      const salePrice = ethers.parseEther("1");
      const [receiver, amount] = await deedNFT.royaltyInfo(1, salePrice);
      
      // Validator has 5% royalty
      expect(receiver).to.equal(feeReceiver.address);
      expect(amount).to.equal(ethers.parseEther("0.05")); // 5% of 1 ETH
    });
    
    it("should enforce royalties by default", async function() {
      expect(await deedNFT.isRoyaltyEnforced()).to.be.true;
    });
    
    it("should allow approved marketplaces", async function() {
      // Approve marketplace
      await deedNFT.setApprovedMarketplace(await mockMarketplace.getAddress(), true);
      expect(await deedNFT.isApprovedMarketplace(await mockMarketplace.getAddress())).to.be.true;
      
      // Should allow approval for approved marketplace
      await deedNFT.connect(user1).approve(await mockMarketplace.getAddress(), 1);
      expect(await deedNFT.getApproved(1)).to.equal(await mockMarketplace.getAddress());
    });
    
    it("should block non-approved marketplaces when royalties enforced", async function() {
      // Try to approve non-approved marketplace
      await expect(
        deedNFT.connect(user1).approve(nonAuthorized.address, 1)
      ).to.be.revertedWith("DeedNFT: Marketplace not approved for royalty enforcement");
      
      // Try to setApprovalForAll for non-approved marketplace
      await expect(
        deedNFT.connect(user1).setApprovalForAll(nonAuthorized.address, true)
      ).to.be.revertedWith("DeedNFT: Marketplace not approved for royalty enforcement");
    });
    
    it("should allow disabling royalty enforcement", async function() {
      // Disable royalty enforcement
      await deedNFT.setRoyaltyEnforcement(false);
      expect(await deedNFT.isRoyaltyEnforced()).to.be.false;
      
      // Should now allow approval for any marketplace
      await deedNFT.connect(user1).approve(nonAuthorized.address, 1);
      expect(await deedNFT.getApproved(1)).to.equal(nonAuthorized.address);
    });
  });
  
  describe("ERC-7496 Dynamic Traits", function() {
    it("should return all trait keys for a token", async function() {
      const traitKeys = await deedNFT.getTraitKeys(1);
      expect(traitKeys.length).to.equal(6); // All 6 trait keys defined in _initializeTraits
    });
    
    it("should return multiple trait values", async function() {
      const traitValues = await deedNFT.getTraitValues(1, [
        ASSET_TYPE_KEY,
        IS_VALIDATED_KEY,
        VALIDATOR_KEY
      ]);
      
      expect(traitValues.length).to.equal(3);
      
      // Check asset type
      const assetType = Buffer.from(traitValues[0].slice(2), 'hex')
                              .toString('utf8')
                              .trim()
                              .replace(/\0/g, '');
      expect(assetType).to.equal("0"); // Land
      
      // Check validation status
      const isValidated = traitValues[1].toString() !== '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(isValidated).to.be.true;
      
      // Check validator
      const validatorAddress = ethers.getAddress('0x' + traitValues[2].slice(26));
      expect(validatorAddress).to.equal(await validator.getAddress());
    });
  });
  
  describe("Contract Metadata", function() {
    it("should allow setting contract URI", async function() {
      const newURI = "ipfs://collection-metadata";
      await deedNFT.setContractURI(newURI);
      expect(await deedNFT.contractURI()).to.equal(newURI);
    });
    
    it("should emit ContractURIUpdated event", async function() {
      const newURI = "ipfs://collection-metadata";
      await expect(deedNFT.setContractURI(newURI))
        .to.emit(deedNFT, "ContractURIUpdated")
        .withArgs(newURI);
    });
  });
  
  describe("Transfer Validator", function() {
    it("should allow setting transfer validator", async function() {
      await deedNFT.setTransferValidator(await validator.getAddress());
      expect(await deedNFT.getTransferValidator()).to.equal(await validator.getAddress());
    });
    
    it("should emit TransferValidatorUpdated event", async function() {
      await expect(deedNFT.setTransferValidator(await validator.getAddress()))
        .to.emit(deedNFT, "TransferValidatorUpdated")
        .withArgs(ethers.ZeroAddress, await validator.getAddress());
    });
    
    it("should return correct transfer validation function", async function() {
      const [functionSignature, isViewFunction] = await deedNFT.getTransferValidationFunction();
      expect(functionSignature).to.equal("0x0d30e81e"); // bytes4(keccak256("validateTransfer(address,address,address,uint256)"))
      expect(isViewFunction).to.be.true;
    });
  });
  
  describe("Interface Support", function() {
    it("should support ERC721 interface", async function() {
      const ERC721_INTERFACE_ID = "0x80ac58cd";
      expect(await deedNFT.supportsInterface(ERC721_INTERFACE_ID)).to.be.true;
    });
    
    it("should support ERC2981 royalty interface", async function() {
      const ERC2981_INTERFACE_ID = "0x2a55205a";
      expect(await deedNFT.supportsInterface(ERC2981_INTERFACE_ID)).to.be.true;
    });
    
    it("should support ERC7496 dynamic traits interface", async function() {
      const ERC7496_INTERFACE_ID = "0xaf332f3e";
      expect(await deedNFT.supportsInterface(ERC7496_INTERFACE_ID)).to.be.true;
    });
  });
});