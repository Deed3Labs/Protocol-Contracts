import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

describe("Validator Contract", function() {
  let validator: any;
  let deedNFT: any;
  let validatorRegistry: any;
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let validator1: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
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
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      "Test Validator",
      "A validator for testing",
      [0, 1, 2, 3]
    );
    // Explicitly activate validator after registration
    await validatorRegistry.updateValidatorStatus(await validator.getAddress(), true);
    
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
    await deedNFT.grantRole(DEED_VALIDATOR_ROLE, await validator.target);

    // Grant MINTER_ROLE to users
    await deedNFT.grantRole(await deedNFT.MINTER_ROLE(), user1.address);
    await deedNFT.grantRole(await deedNFT.MINTER_ROLE(), user2.address);
    // Grant VALIDATOR_ROLE to validator contract
    await deedNFT.grantRole(await deedNFT.VALIDATOR_ROLE(), await validator.target);

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
    await validator.grantRole(VALIDATOR_ROLE, await validator1.address);
    await validator.grantRole(METADATA_ROLE, await admin.address);
    await validator.grantRole(CRITERIA_MANAGER_ROLE, await admin.address);
    await validator.grantRole(FEE_MANAGER_ROLE, await admin.address);
  });
  
  describe("Initialization", function() {
    it("should initialize with correct roles", async function() {
      expect(await validator.hasRole(VALIDATOR_ROLE, await validator1.address)).to.be.true;
      expect(await validator.hasRole(METADATA_ROLE, await admin.address)).to.be.true;
      expect(await validator.hasRole(CRITERIA_MANAGER_ROLE, await admin.address)).to.be.true;
      expect(await validator.hasRole(FEE_MANAGER_ROLE, await admin.address)).to.be.true;
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
      await validator.grantRole(VALIDATOR_ROLE, await user1.address);
      expect(await validator.hasRole(VALIDATOR_ROLE, await user1.address)).to.be.true;
    });

    it("should allow admin to revoke roles", async function() {
      await validator.grantRole(VALIDATOR_ROLE, await user1.address);
      await validator.revokeRole(VALIDATOR_ROLE, await user1.address);
      expect(await validator.hasRole(VALIDATOR_ROLE, await user1.address)).to.be.false;
    });

    it("should prevent non-admin from granting roles", async function() {
      await expect(
        validator.connect(user1).grantRole(VALIDATOR_ROLE, await user2.address)
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
        await validator.target,
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
        await validator.target,
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();
      
      await validator.addCompatibleDeedNFT(await newDeedNFT.getAddress());
      expect(await validator.isCompatibleDeedNFT(await newDeedNFT.getAddress())).to.be.true;
    });

    it("should allow admin to remove compatible DeedNFT", async function() {
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.target,
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
      
      // Set up FundManager first
      const FundManager = await ethers.getContractFactory("FundManager");
      const fundManager = await upgrades.deployProxy(FundManager, [
        await validatorRegistry.getAddress(),
        1000, // 10% commission
        admin.address // fee receiver
      ]);
      await fundManager.waitForDeployment();

      // Grant FEE_MANAGER_ROLE to admin in FundManager
      const FEE_MANAGER_ROLE_FM = await fundManager.FEE_MANAGER_ROLE();
      await fundManager.grantRole(FEE_MANAGER_ROLE_FM, admin.address);

      // Set up roles and permissions
      const MINTER_ROLE = await deedNFT.MINTER_ROLE();
      await deedNFT.grantRole(MINTER_ROLE, await fundManager.getAddress());
      await deedNFT.grantRole(MINTER_ROLE, user2.address);

      // Set up validator and deedNFT with fundManager
      await validator.setFundManager(await fundManager.getAddress());
      await deedNFT.setFundManager(await fundManager.getAddress());
      await fundManager.addCompatibleDeedNFT(await deedNFT.getAddress());

      // Set up royalty receiver and fees
      await validator.connect(admin).setRoyaltyReceiver(user1.address);
      await validator.connect(admin).addWhitelistedToken(await token.getAddress());
      await validator.connect(admin).setServiceFee(await token.getAddress(), ethers.parseUnits("100", 18));
      await validator.connect(admin).setAssetTypeSupport(0, true);

      // Set up token balance and approval
      await token.mint(user2.address, ethers.parseUnits("1000", 18));
      await token.connect(user2).approve(await fundManager.getAddress(), ethers.parseUnits("1000", 18));

      // Debug: Check initial balances
      const feeReceiverBalanceBefore = await token.balanceOf(admin.address);
      console.log("Fee receiver balance before mint:", feeReceiverBalanceBefore.toString());
      const fundManagerBalanceBefore = await token.balanceOf(await fundManager.getAddress());
      console.log("FundManager balance before mint:", fundManagerBalanceBefore.toString());

      // Mint deed with token payment
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await deedNFT.connect(user2).mintAsset(
        user1.address,
        0,
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.target,
        await token.getAddress(),
        ethers.parseUnits("100", 18)
      );

      // Debug: Check balances after mint
      const feeReceiverBalanceAfterMint = await token.balanceOf(admin.address);
      console.log("Fee receiver balance after mint:", feeReceiverBalanceAfterMint.toString());
      console.log("Commission received:", (feeReceiverBalanceAfterMint - feeReceiverBalanceBefore).toString());
      const fundManagerBalanceAfterMint = await token.balanceOf(await fundManager.getAddress());
      console.log("FundManager balance after mint:", fundManagerBalanceAfterMint.toString());

      // Debug: Check balances before withdrawal
      const royaltyReceiverBalanceBefore = await token.balanceOf(user1.address);
      console.log("Royalty receiver balance before withdrawal:", royaltyReceiverBalanceBefore.toString());
      const validatorFeeBalanceBefore = await fundManager.getValidatorFeeBalance(
        await validator.target,
        await token.getAddress()
      );
      console.log("Validator fee balance before withdrawal:", validatorFeeBalanceBefore.toString());

      // Withdraw fees via FundManager
      await fundManager.connect(deployer).withdrawValidatorFees(await validator.getAddress(), await token.getAddress());
      
      // Debug: Check balances after withdrawal
      const royaltyReceiverBalanceAfter = await token.balanceOf(user1.address);
      console.log("Royalty receiver balance after withdrawal:", royaltyReceiverBalanceAfter.toString());
      console.log("Royalty amount received:", (royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore).toString());
      const validatorFeeBalanceAfter = await fundManager.getValidatorFeeBalance(
        await validator.target,
        await token.getAddress()
      );
      console.log("Validator fee balance after withdrawal:", validatorFeeBalanceAfter.toString());
      
      // Verify royalty receiver received the funds
      expect(royaltyReceiverBalanceAfter).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee
    });
  });

  describe("Royalty Management", function() {
    let mockERC20: any;
    let fundManager: any;

    beforeEach(async function() {
      // Deploy FundManager first
      const FundManager = await ethers.getContractFactory("FundManager");
      fundManager = await upgrades.deployProxy(FundManager, [
        await validatorRegistry.getAddress(),
        1000, // 10% commission
        admin.address // fee receiver
      ]);
      await fundManager.waitForDeployment();

      // Grant ADMIN_ROLE to admin in FundManager
      const ADMIN_ROLE_FM = await fundManager.ADMIN_ROLE();
      await fundManager.grantRole(ADMIN_ROLE_FM, admin.address);

      // Grant FEE_MANAGER_ROLE to admin in FundManager
      const FEE_MANAGER_ROLE_FM = await fundManager.FEE_MANAGER_ROLE();
      await fundManager.grantRole(FEE_MANAGER_ROLE_FM, admin.address);

      // Set up validator and deedNFT with fundManager
      await validator.setFundManager(await fundManager.getAddress());
      await deedNFT.setFundManager(await fundManager.getAddress());
      await fundManager.addCompatibleDeedNFT(await deedNFT.getAddress());

      // Set up asset type support
      await validator.connect(admin).setAssetTypeSupport(0, true);
      
      // Set up validation criteria (empty array since we don't need traits)
      await validator.connect(admin).setValidationCriteria(
        0,
        [],
        "",
        true, // require operating agreement
        true  // require definition
      );
      
      // Register operating agreement
      await validator.connect(admin).setOperatingAgreementName("ipfs://agreements/1", "Test Agreement");
      
      // Set royalty fee percentage (5%)
      await validator.connect(admin).setRoyaltyFeePercentage(500);
      
      // Set royalty receiver
      await validator.connect(admin).setRoyaltyReceiver(user1.address);
      
      // Deploy MockERC20
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      mockERC20 = await MockERC20.deploy("Test Token", "TT", 18);
      await mockERC20.waitForDeployment();
      
      // Whitelist token in validator and fundManager
      await validator.connect(admin).addWhitelistedToken(await mockERC20.getAddress());
      await fundManager.connect(admin).addWhitelistedToken(await mockERC20.getAddress());
      
      // Mint tokens to users
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      await mockERC20.mint(user2.address, ethers.parseUnits("1000", 18));
    });

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
      await validator.connect(admin).setRoyaltyReceiver(await user1.address);
      expect(await validator.getRoyaltyReceiver()).to.equal(await user1.address);
    });

    it("should prevent setting zero address as royalty receiver", async function() {
      await expect(
        validator.connect(admin).setRoyaltyReceiver(ethers.ZeroAddress)
      ).to.be.reverted;
    });

    it("should track and allow withdrawal of royalties", async function() {
      // Set up royalty fee percentage and receiver
      await validator.connect(admin).setRoyaltyFeePercentage(500); // 5%
      await validator.connect(admin).setRoyaltyReceiver(user1.address);

      // Deploy mock ERC20 token
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      mockERC20 = await MockERC20.deploy("Mock Token", "MTK", 18);
      await mockERC20.waitForDeployment();

      // Whitelist token in validator
      await validator.connect(admin).addWhitelistedToken(await mockERC20.getAddress());

      // Mint tokens to user2
      await mockERC20.mint(user2.address, ethers.parseUnits("100", 18));

      // Debug: Check initial balances
      console.log("Initial validator balance:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("Initial user2 balance:", (await mockERC20.balanceOf(user2.address)).toString());

      // Transfer tokens to validator to simulate royalty accrual
      await mockERC20.connect(user2).transfer(await validator.getAddress(), ethers.parseUnits("5", 18));

      // Debug: Check balances after transfer
      console.log("Validator balance after transfer:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("User2 balance after transfer:", (await mockERC20.balanceOf(user2.address)).toString());

      // Check royalty balance
      const royaltyBalance = await validator.getRoyaltyBalance(await mockERC20.getAddress());
      console.log("Royalty balance:", royaltyBalance.toString());
      expect(royaltyBalance).to.equal(ethers.parseUnits("5", 18));

      // Withdraw royalties
      const royaltyReceiverBalanceBefore = await mockERC20.balanceOf(user1.address);
      const feeReceiverBalanceBefore = await mockERC20.balanceOf(admin.address);
      
      console.log("Royalty receiver balance before withdrawal:", royaltyReceiverBalanceBefore.toString());
      console.log("Fee receiver balance before withdrawal:", feeReceiverBalanceBefore.toString());
      
      await validator.connect(user1).withdrawRoyalties(await mockERC20.getAddress());
      
      const royaltyReceiverBalanceAfter = await mockERC20.balanceOf(user1.address);
      const feeReceiverBalanceAfter = await mockERC20.balanceOf(admin.address);

      console.log("Royalty receiver balance after withdrawal:", royaltyReceiverBalanceAfter.toString());
      console.log("Fee receiver balance after withdrawal:", feeReceiverBalanceAfter.toString());

      // Calculate expected amounts (10% commission)
      const expectedCommission = ethers.parseUnits("0.5", 18); // 10% of 5 tokens
      const expectedReceiverAmount = ethers.parseUnits("4.5", 18); // 90% of 5 tokens

      // Verify royalty receiver received the correct amount
      expect(royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore).to.equal(expectedReceiverAmount);
      
      // Verify fee receiver received the commission
      expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(expectedCommission);

      // Verify validator's royalty balance is zero
      const finalRoyaltyBalance = await validator.getRoyaltyBalance(await mockERC20.getAddress());
      console.log("Final validator royalty balance:", finalRoyaltyBalance.toString());
      expect(finalRoyaltyBalance).to.equal(0);
    });

    it("should prevent unauthorized withdrawal of royalties", async function() {
      // Transfer tokens to validator to simulate royalty accrual
      await mockERC20.connect(user2).transfer(await validator.getAddress(), ethers.parseUnits("5", 18));

      // Debug: Check balances before unauthorized attempt
      console.log("Validator balance before unauthorized attempt:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("User2 balance before unauthorized attempt:", (await mockERC20.balanceOf(user2.address)).toString());

      // Try to withdraw royalties as unauthorized user
      await expect(
        validator.connect(user2).withdrawRoyalties(await mockERC20.getAddress())
      ).to.be.reverted;

      // Debug: Check balances after unauthorized attempt
      console.log("Validator balance after unauthorized attempt:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("User2 balance after unauthorized attempt:", (await mockERC20.balanceOf(user2.address)).toString());
    });

    it("should handle zero balance correctly", async function() {
      // Debug: Check initial balances
      console.log("Initial validator balance:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("Initial royalty receiver balance:", (await mockERC20.balanceOf(user1.address)).toString());

      // Try to withdraw royalties when balance is zero
      await expect(
        validator.connect(user1).withdrawRoyalties(await mockERC20.getAddress())
      ).to.be.reverted;

      // Debug: Check final balances
      console.log("Final validator balance:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("Final royalty receiver balance:", (await mockERC20.balanceOf(user1.address)).toString());
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

      // Set up roles
      const MINTER_ROLE = await deedNFT.MINTER_ROLE();
      await deedNFT.grantRole(MINTER_ROLE, deployer.address);
      await deedNFT.grantRole(MINTER_ROLE, user2.address);

      // Mint a deed with required traits
      const definition = JSON.stringify({ country: "USA", state: "CA" });
      await deedNFT.connect(user2).mintAsset(
        user1.address,
        0,
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.target,
        ethers.ZeroAddress,
        0n
      );
      tokenId = 1;

      // Grant VALIDATOR_ROLE to the validator contract
      await deedNFT.grantRole(await deedNFT.VALIDATOR_ROLE(), validator.getAddress());

      // Set up required traits for the NFT
      await deedNFT.setTrait(tokenId, ethers.toUtf8Bytes("country"), ethers.toUtf8Bytes("USA"), 1);
      await deedNFT.setTrait(tokenId, ethers.toUtf8Bytes("state"), ethers.toUtf8Bytes("California"), 1);
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
        await validator.target,
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
        await validator.target,
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();
      expect(await validator.isCompatibleDeedNFT(await newDeedNFT.getAddress())).to.be.false;
    });
  });
});
