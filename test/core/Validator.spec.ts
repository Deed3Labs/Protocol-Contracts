import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

describe("Validator Contract", function() {
  let validator: any;
  let deedNFT: any;
  let validatorRegistry: any;
  let deployer: SignerWithAddress;
  let admin: SignerWithAddress;
  let validator1: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let VALIDATOR_ROLE: string;
  let METADATA_ROLE: string;
  let CRITERIA_MANAGER_ROLE: string;
  let FEE_MANAGER_ROLE: string;
  let ADMIN_ROLE: string;
  
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, admin, validator1, user1, user2] = [
      signers[0], signers[1], signers[2], signers[3], signers[4]
    ];
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    // Deploy Validator first with correct parameters
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "ipfs://metadata/",  // baseUri
      "ipfs://agreements/" // defaultOperatingAgreementUri
    ]);
    await validator.waitForDeployment();
    
    // Register validator in registry
    await validatorRegistry.connect(deployer).registerValidator(
      await validator.getAddress(),
      "Test Validator",
      "A validator for testing",
      [0, 1, 2, 3]
    );
    
    // Deploy DeedNFT with correct parameters
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();
    
    // Set DeedNFT in Validator
    await validator.setDeedNFT(await deedNFT.getAddress());
    
    // Set up roles
    const DEED_VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
    await deedNFT.grantRole(DEED_VALIDATOR_ROLE, await validator.getAddress());

    // Deploy MockERC20 with correct parameters
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockERC20 = await MockERC20.deploy("Test Token", "TT", 18);
    await mockERC20.waitForDeployment();
    
    // Get roles
    VALIDATOR_ROLE = await validator.VALIDATOR_ROLE();
    METADATA_ROLE = await validator.METADATA_ROLE();
    CRITERIA_MANAGER_ROLE = await validator.CRITERIA_MANAGER_ROLE();
    FEE_MANAGER_ROLE = await validator.FEE_MANAGER_ROLE();
    ADMIN_ROLE = await validator.ADMIN_ROLE();
    
    // Set up permissions
    await validator.grantRole(VALIDATOR_ROLE, await validator1.getAddress());
    await validator.grantRole(METADATA_ROLE, await admin.getAddress());
    await validator.grantRole(CRITERIA_MANAGER_ROLE, await admin.getAddress());
    await validator.grantRole(FEE_MANAGER_ROLE, await admin.getAddress());
  });
  
  describe("Initialization", function() {
    it("should initialize with correct roles", async function() {
      expect(await validator.hasRole(VALIDATOR_ROLE, await validator1.getAddress())).to.be.true;
      expect(await validator.hasRole(METADATA_ROLE, await admin.getAddress())).to.be.true;
      expect(await validator.hasRole(CRITERIA_MANAGER_ROLE, await admin.getAddress())).to.be.true;
      expect(await validator.hasRole(FEE_MANAGER_ROLE, await admin.getAddress())).to.be.true;
    });
    
    it("should initialize with correct DeedNFT address", async function() {
      expect(await validator.deedNFT()).to.equal(await deedNFT.getAddress());
    });

    it("should initialize with correct base URI", async function() {
      expect(await validator.getBaseUri()).to.equal("ipfs://metadata/");
    });

    it("should initialize with correct default operating agreement URI", async function() {
      expect(await validator.defaultOperatingAgreement()).to.equal("ipfs://agreements/");
    });
  });

  describe("Role Management", function() {
    it("should allow admin to grant roles", async function() {
      await validator.grantRole(VALIDATOR_ROLE, await user1.getAddress());
      expect(await validator.hasRole(VALIDATOR_ROLE, await user1.getAddress())).to.be.true;
    });

    it("should allow admin to revoke roles", async function() {
      await validator.grantRole(VALIDATOR_ROLE, await user1.getAddress());
      await validator.revokeRole(VALIDATOR_ROLE, await user1.getAddress());
      expect(await validator.hasRole(VALIDATOR_ROLE, await user1.getAddress())).to.be.false;
    });

    it("should prevent non-admin from granting roles", async function() {
      await expect(
        validator.connect(user1).grantRole(VALIDATOR_ROLE, await user2.getAddress())
      ).to.be.reverted;
    });
  });

  describe("Asset Type Support", function() {
    it("should allow criteria manager to set asset type support", async function() {
      await validator.connect(admin).setAssetTypeSupport(0, true);
      expect(await validator.supportsAssetType(0)).to.be.true;
    });

    it("should prevent non-criteria manager from setting asset type support", async function() {
      await expect(
        validator.connect(user1).setAssetTypeSupport(0, true)
      ).to.be.reverted;
    });

    it("should allow setting multiple asset types", async function() {
      await validator.connect(admin).setAssetTypeSupport(0, true);
      await validator.connect(admin).setAssetTypeSupport(1, true);
      expect(await validator.supportsAssetType(0)).to.be.true;
      expect(await validator.supportsAssetType(1)).to.be.true;
    });
  });

  describe("Validation Criteria", function() {
    it("should allow criteria manager to set validation criteria", async function() {
      const requiredTraits = ["trait1", "trait2"];
      const additionalCriteria = "{}";
      
      await validator.connect(admin).setValidationCriteria(
        0,
        requiredTraits,
        additionalCriteria,
        true,
        true
      );

      const [retrievedTraits, retrievedCriteria, requireAgreement, requireDefinition] = 
        await validator.getValidationCriteria(0);

      expect(retrievedTraits).to.deep.equal(requiredTraits);
      expect(retrievedCriteria).to.equal(additionalCriteria);
      expect(requireAgreement).to.be.true;
      expect(requireDefinition).to.be.true;
    });

    it("should prevent non-criteria manager from setting validation criteria", async function() {
      await expect(
        validator.connect(user1).setValidationCriteria(
          0,
          ["trait1"],
          "{}",
          true,
          true
        )
      ).to.be.reverted;
    });
  });

  describe("Operating Agreement Management", function() {
    it("should allow metadata manager to set operating agreement name", async function() {
      const uri = "ipfs://agreement1";
      const name = "Test Agreement";
      
      await validator.connect(admin).setOperatingAgreementName(uri, name);
      expect(await validator.operatingAgreementName(uri)).to.equal(name);
    });

    it("should allow metadata manager to remove operating agreement name", async function() {
      const uri = "ipfs://agreement1";
      const name = "Test Agreement";
      
      await validator.connect(admin).setOperatingAgreementName(uri, name);
      await validator.connect(admin).removeOperatingAgreementName(uri);
      expect(await validator.operatingAgreementName(uri)).to.equal("");
    });

    it("should prevent non-metadata manager from managing operating agreements", async function() {
      await expect(
        validator.connect(user1).setOperatingAgreementName("ipfs://agreement1", "Test")
      ).to.be.reverted;
    });
  });

  describe("DeedNFT Management", function() {
    it("should allow admin to set DeedNFT address", async function() {
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();
      
      await validator.setDeedNFT(await newDeedNFT.getAddress());
      expect(await validator.deedNFT()).to.equal(await newDeedNFT.getAddress());
    });

    it("should prevent setting zero address as DeedNFT", async function() {
      await expect(
        validator.setDeedNFT(ethers.ZeroAddress)
      ).to.be.reverted;
    });

    it("should allow admin to add compatible DeedNFT", async function() {
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();
      
      await validator.addCompatibleDeedNFT(await newDeedNFT.getAddress());
      expect(await validator.isCompatibleDeedNFT(await newDeedNFT.getAddress())).to.be.true;
    });

    it("should allow admin to remove compatible DeedNFT", async function() {
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();
      
      await validator.addCompatibleDeedNFT(await newDeedNFT.getAddress());
      await validator.removeCompatibleDeedNFT(await newDeedNFT.getAddress());
      expect(await validator.isCompatibleDeedNFT(await newDeedNFT.getAddress())).to.be.false;
    });
  });

  describe("Fee Management", function() {
    it("should allow fee manager to set service fee", async function() {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("Test Token", "TT", 18);
      await token.waitForDeployment();
      
      await validator.connect(admin).addWhitelistedToken(await token.getAddress());
      await validator.connect(admin).setServiceFee(await token.getAddress(), 100);
      expect(await validator.getServiceFee(await token.getAddress())).to.equal(100);
    });

    it("should prevent setting service fee for non-whitelisted token", async function() {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("Test Token", "TT", 18);
      await token.waitForDeployment();
      
      await expect(
        validator.connect(admin).setServiceFee(await token.getAddress(), 100)
      ).to.be.reverted;
    });

    it("should allow fee manager to whitelist token", async function() {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("Test Token", "TT", 18);
      await token.waitForDeployment();
      
      await validator.connect(admin).addWhitelistedToken(await token.getAddress());
      expect(await validator.isTokenWhitelisted(await token.getAddress())).to.be.true;
    });

    it("should allow fee manager to remove token from whitelist", async function() {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("Test Token", "TT", 18);
      await token.waitForDeployment();
      
      await validator.connect(admin).addWhitelistedToken(await token.getAddress());
      await validator.connect(admin).removeWhitelistedToken(await token.getAddress());
      expect(await validator.isTokenWhitelisted(await token.getAddress())).to.be.false;
    });

    it("should withdraw service fees to royalty receiver", async function() {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("Test Token", "TT", 18);
      await token.waitForDeployment();
      
      // Set up royalty receiver
      await validator.connect(admin).setRoyaltyReceiver(user1.address);
      
      // Whitelist token and set service fee
      await validator.connect(admin).addWhitelistedToken(await token.getAddress());
      await validator.connect(admin).setServiceFee(await token.getAddress(), 100);
      
      // Ensure asset type 0 is supported
      await validator.connect(admin).setAssetTypeSupport(0, true);
      
      // Set up FundManager
      const FundManager = await ethers.getContractFactory("FundManager");
      const fundManager = await upgrades.deployProxy(FundManager, [
        await deedNFT.getAddress(),
        await validatorRegistry.getAddress(),
        1000, // 10% commission
        admin.address // fee receiver
      ]);
      await fundManager.waitForDeployment();
      
      // Grant MINTER_ROLE to FundManager in DeedNFT
      const MINTER_ROLE = await deedNFT.MINTER_ROLE();
      await deedNFT.grantRole(MINTER_ROLE, await fundManager.getAddress());
      
      await validator.setFundManager(await fundManager.getAddress());
      
      // Mint tokens to user2 and approve FundManager
      await token.mint(user2.address, 1000);
      await token.connect(user2).approve(await fundManager.getAddress(), 100);
      
      // Create a deed to accumulate fees
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });
      
      await fundManager.connect(user2).mintDeedNFT(
        user2.address,
        0, // Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await token.getAddress(),
        0n // salt
      );
      
      // Get initial balances
      const royaltyReceiverBalanceBefore = await token.balanceOf(user1.address);
      console.log('Royalty receiver balance before withdrawal:', royaltyReceiverBalanceBefore.toString());

      // Debug: Check FundManager balance before withdrawal
      const fundManagerBalanceBefore = await token.balanceOf(await fundManager.getAddress());
      console.log('FundManager balance before withdrawal:', fundManagerBalanceBefore.toString());

      // Debug: Check commission balance before withdrawal
      const commissionBalance = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await token.getAddress()
      );
      console.log('Validator service fee balance before withdrawal:', commissionBalance.toString());

      // Debug: Check royalty receiver and FundManager address
      const royaltyReceiver = await validator.getRoyaltyReceiver();
      const fundManagerAddress = await validator.fundManager();
      console.log('Royalty receiver:', royaltyReceiver);
      console.log('FundManager address:', fundManagerAddress);

      // Debug: Check if Validator has FEE_MANAGER_ROLE in FundManager
      const FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();
      const hasRole = await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress());
      console.log('Validator has FEE_MANAGER_ROLE in FundManager:', hasRole);

      // Grant FEE_MANAGER_ROLE to Validator contract itself for FundManager withdrawal
      await fundManager.grantRole(FEE_MANAGER_ROLE, await validator.getAddress());

      // Withdraw fees
      await validator.connect(admin).withdrawServiceFees(await token.getAddress());
      
      // Debug: Check FundManager balance after withdrawal
      const fundManagerBalanceAfter = await token.balanceOf(await fundManager.getAddress());
      console.log('FundManager balance after withdrawal:', fundManagerBalanceAfter.toString());

      // Verify royalty receiver received the funds
      const royaltyReceiverBalanceAfter = await token.balanceOf(user1.address);
      console.log('Royalty receiver balance after withdrawal:', royaltyReceiverBalanceAfter.toString());
      expect(royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore).to.equal(90); // 90% of service fee

      // Debug: Check commission balance after withdrawal
      const commissionBalanceAfter = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await token.getAddress()
      );
      console.log('Validator service fee balance after withdrawal:', commissionBalanceAfter.toString());
    });
  });

  describe("Royalty Management", function() {
    it("should allow fee manager to set royalty fee percentage", async function() {
      await validator.connect(admin).setRoyaltyFeePercentage(500); // 5%
      expect(await validator.getRoyaltyFeePercentage(0)).to.equal(500);
    });

    it("should prevent setting royalty fee percentage above 5%", async function() {
      await expect(
        validator.connect(admin).setRoyaltyFeePercentage(501)
      ).to.be.reverted;
    });

    it("should allow fee manager to set royalty receiver", async function() {
      await validator.connect(admin).setRoyaltyReceiver(await user1.getAddress());
      expect(await validator.getRoyaltyReceiver()).to.equal(await user1.getAddress());
    });

    it("should prevent setting zero address as royalty receiver", async function() {
      await expect(
        validator.connect(admin).setRoyaltyReceiver(ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe("Contract Upgradeability", function() {
    it("should be upgradeable", async function() {
      const ValidatorV2 = await ethers.getContractFactory("Validator");
      await upgrades.upgradeProxy(await validator.getAddress(), ValidatorV2);
      
      // Verify the contract was upgraded by checking if it still has the same functionality
      // Try to set asset type support (a basic function that should still work)
      await validator.connect(admin).setAssetTypeSupport(0, true);
      expect(await validator.supportsAssetType(0)).to.be.true;
    });

    it("should prevent non-owner from upgrading", async function() {
      const ValidatorV2 = await ethers.getContractFactory("Validator");
      await expect(
        upgrades.upgradeProxy(await validator.getAddress(), ValidatorV2.connect(user1))
      ).to.be.reverted;
    });
  });

  describe("Validation Logic", function() {
    let tokenId: number;
    beforeEach(async function() {
      // Set up asset type support and criteria
      await validator.connect(admin).setAssetTypeSupport(0, true);
      await validator.connect(admin).setValidationCriteria(
        0,
        ["country", "state"],
        "",
        true,
        true
      );

      // Register operating agreement in Validator first
      await validator.connect(admin).registerOperatingAgreement("ipfs://agreements/1", "Agreement 1");

      // Mint a deed with required traits
      const definition = JSON.stringify({ country: "USA", state: "CA" });
      await deedNFT.grantRole(await deedNFT.MINTER_ROLE(), deployer.address);
      await deedNFT.mintAsset(
        user1.address,
        0,
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        0n
      );
      tokenId = 1;
      // Set required traits using setTrait as the deed owner
      await deedNFT.connect(user1).setTrait(tokenId, ethers.toUtf8Bytes("country"), ethers.toUtf8Bytes("USA"), 1);
      await deedNFT.connect(user1).setTrait(tokenId, ethers.toUtf8Bytes("state"), ethers.toUtf8Bytes("CA"), 1);
    });

    it("should validate a deed with all required traits", async function() {
      await validator.connect(validator1).validateDeed(tokenId);
      const [isValidated] = await deedNFT.getValidationStatus(tokenId);
      expect(isValidated).to.be.true;
    });

    it("should fail validation if a required trait is missing", async function() {
      // Remove 'state' trait as the deed owner
      await deedNFT.connect(user1).removeTrait(tokenId, "state");
      await validator.connect(validator1).validateDeed(tokenId);
      const [isValidated] = await deedNFT.getValidationStatus(tokenId);
      expect(isValidated).to.be.false;
    });

    it("should fail validation if asset type is not supported", async function() {
      await validator.connect(admin).setAssetTypeSupport(0, false);
      await validator.connect(validator1).validateDeed(tokenId);
      const [isValidated] = await deedNFT.getValidationStatus(tokenId);
      expect(isValidated).to.be.false;
    });

    it("should fail validation if operating agreement is invalid", async function() {
      // Set an invalid operating agreement
      await deedNFT.removeTrait(tokenId, "operatingAgreement");
      await validator.connect(validator1).validateDeed(tokenId);
      const [isValidated] = await deedNFT.getValidationStatus(tokenId);
      expect(isValidated).to.be.false;
    });

    it("should fail validation if definition is missing", async function() {
      await deedNFT.removeTrait(tokenId, "definition");
      await validator.connect(validator1).validateDeed(tokenId);
      const [isValidated] = await deedNFT.getValidationStatus(tokenId);
      expect(isValidated).to.be.false;
    });

    it("should validate deed if no required traits are set in criteria", async function() {
      await validator.connect(admin).setValidationCriteria(
        0,
        [],
        "",
        true,
        true
      );
      await validator.connect(validator1).validateDeed(tokenId);
      const [isValidated] = await deedNFT.getValidationStatus(tokenId);
      expect(isValidated).to.be.true;
    });
  });

  describe("Agreement Registration and Validation", function() {
    it("should register and validate an operating agreement", async function() {
      await validator.connect(admin).registerOperatingAgreement("ipfs://agreementX", "Agreement X");
      expect(await validator.operatingAgreementName("ipfs://agreementX")).to.equal("Agreement X");
      expect(await validator.validateOperatingAgreement("ipfs://agreementX")).to.be.true;
    });
    it("should not validate an unregistered agreement", async function() {
      expect(await validator.validateOperatingAgreement("ipfs://not-registered")).to.be.false;
    });
  });

  describe("Edge Cases and Access Control", function() {
    it("should not allow removing primary DeedNFT as compatible", async function() {
      await expect(
        validator.removeCompatibleDeedNFT(await deedNFT.getAddress())
      ).to.be.reverted;
    });
    it("should not allow setting primary DeedNFT to non-compatible address", async function() {
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();
      await expect(
        validator.setPrimaryDeedNFT(await newDeedNFT.getAddress())
      ).to.be.reverted;
    });
    it("should only allow owner to set base URI and default operating agreement", async function() {
      await expect(validator.connect(user1).setBaseUri("ipfs://newbase/")).to.be.reverted;
      await expect(validator.connect(user1).setDefaultOperatingAgreement("ipfs://newagreement/")).to.be.reverted;
      await validator.setBaseUri("ipfs://newbase/");
      expect(await validator.getBaseUri()).to.equal("ipfs://newbase/");
      await validator.setDefaultOperatingAgreement("ipfs://newagreement/");
      expect(await validator.defaultOperatingAgreement()).to.equal("ipfs://newagreement/");
    });
    it("should return correct compatibility for DeedNFT", async function() {
      expect(await validator.isCompatibleDeedNFT(await deedNFT.getAddress())).to.be.true;
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();
      expect(await validator.isCompatibleDeedNFT(await newDeedNFT.getAddress())).to.be.false;
    });
  });
});
