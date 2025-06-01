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
  let mockERC20: any;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let validator1: SignerWithAddress;
  let feeReceiver: SignerWithAddress;
  let feeManager: SignerWithAddress;
  
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, user1, validator1, feeReceiver, feeManager] = signers;
    
    // 1. Deploy contracts
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "ipfs://baseURI/",
      "ipfs://defaultOperatingAgreement/"
    ]);
    await validator.waitForDeployment();
    
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();
    
    const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
    metadataRenderer = await upgrades.deployProxy(MetadataRenderer, []);
    await metadataRenderer.waitForDeployment();
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MTK", 18);
    await mockERC20.waitForDeployment();
    
    // 2. Grant roles
    await deedNFT.grantRole(await deedNFT.VALIDATOR_ROLE(), await validator.getAddress());
    await validator.grantRole(await validator.VALIDATOR_ROLE(), validator1.address);
    await validator.grantRole(await validator.METADATA_ROLE(), await validator.getAddress());
    await validator.grantRole(await validator.CRITERIA_MANAGER_ROLE(), await validator.getAddress());
    await validator.grantRole(await validator.FEE_MANAGER_ROLE(), feeManager.address);
    await validator.grantRole(await validator.ADMIN_ROLE(), feeManager.address);
    
    // 3. Set up DeedNFT in Validator (if needed)
    await validator.setDeedNFT(await deedNFT.getAddress());
    
    // 4. Register validator in registry
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      "Test Validator",
      "A validator for testing",
      [0, 1, 2, 3]
    );
    
    // Set up asset types in validator
    await validator.setAssetTypeSupport(0, true); // Land
    await validator.setAssetTypeSupport(1, true); // Vehicle
    await validator.setAssetTypeSupport(2, true); // Estate
    await validator.setAssetTypeSupport(3, true); // Equipment
    
    // 5. Whitelist token and set service fee in validator
    await validator.addWhitelistedToken(await mockERC20.getAddress());
    await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));
    
    // Set royalty receiver in Validator contract
    await validator.setRoyaltyReceiver(feeReceiver.address);
    
    // 6. Deploy FundManager after validator is registered
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      await validatorRegistry.getAddress(),
      1000, // 10% commission
      feeReceiver.address
    ]);
    await fundManager.waitForDeployment();
    
    // 7. Set FundManager in DeedNFT and Validator
    await deedNFT.setFundManager(await fundManager.getAddress());
    await validator.setFundManager(await fundManager.getAddress());
    await deedNFT.grantRole(await deedNFT.MINTER_ROLE(), await fundManager.getAddress());
    await deedNFT.grantRole(await deedNFT.MINTER_ROLE(), user1.address);

    // Add DeedNFT as compatible in FundManager
    await fundManager.addCompatibleDeedNFT(await deedNFT.getAddress());
    
    // 8. Set MetadataRenderer in DeedNFT
    await deedNFT.setMetadataRenderer(await metadataRenderer.getAddress());
    
    // 9. Mint tokens to user and approve FundManager
    const mintAmount = ethers.parseUnits("1000", 18);
    await mockERC20.mint(user1.address, mintAmount);
    await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

    // Set FundManager in ValidatorRegistry
    await validatorRegistry.setFundManager(await fundManager.getAddress());

    // 10. Set asset type support and royalty receiver before minting
    await validator.setAssetTypeSupport(0, true);
    await validator.setRoyaltyReceiver(feeReceiver.address);
  });
  
  describe("End-to-End Deed Creation Process", function() {
    it("should allow full lifecycle: create, validate, and manage a deed", async function() {
      // Verify token balance
      const balance = await mockERC20.balanceOf(user1.address);
      expect(balance).to.equal(ethers.parseUnits("1000", 18));
      
      // Verify approval
      const allowance = await mockERC20.allowance(user1.address, await fundManager.getAddress());
      expect(allowance).to.equal(ethers.parseUnits("100", 18));

      // Verify validator is registered
      const isRegistered = await validatorRegistry.isValidatorRegistered(await validator.getAddress());
      expect(isRegistered).to.be.true;

      // Verify token is whitelisted
      const isWhitelisted = await validator.isTokenWhitelisted(await mockERC20.getAddress());
      expect(isWhitelisted).to.be.true;

      // Verify service fee is set
      const serviceFee = await validator.getServiceFee(await mockERC20.getAddress());
      expect(serviceFee).to.equal(ethers.parseUnits("100", 18));

      // Verify DeedNFT roles and permissions
      const hasValidatorRole = await deedNFT.hasRole(await deedNFT.VALIDATOR_ROLE(), await validator.getAddress());
      expect(hasValidatorRole).to.be.true;

      const hasMinterRole = await deedNFT.hasRole(await deedNFT.MINTER_ROLE(), await fundManager.getAddress());
      expect(hasMinterRole).to.be.true;

      const fundManagerAddress = await deedNFT.fundManager();
      expect(fundManagerAddress).to.equal(await fundManager.getAddress());
      
      // Verify supported asset types
      const supportedTypes = await validatorRegistry.getSupportedAssetTypes(await validator.getAddress());
      expect(supportedTypes).to.include(0n); // Use BigInt for asset type
      
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });
      
      // 1. Create a new deed using the DeedNFT
      await expect(
        deedNFT.connect(user1).mintAsset(
          user1.address,
          0, // Land type (AssetType.LAND)
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          await mockERC20.getAddress(),
          0n // salt
        )
      ).to.not.be.reverted;
      
      // Get the latest deed ID (assuming it's the next one after deployment)
      const deedId = 1; // Since this is the first mint after deployment
      
      // 2. Verify ownership
      expect(await deedNFT.ownerOf(deedId)).to.equal(user1.address);
      
      // 3. Validator approves the deed
      await expect(
        validator.connect(validator1).validateDeed(deedId)
      ).to.not.be.reverted;
      
      // 4. Check validation status
      const [isValidated] = await deedNFT.getValidationStatus(deedId);
      expect(isValidated).to.be.true;
      
      // 5. Generate and check metadata
      const tokenURI = await deedNFT.tokenURI(deedId);
      expect(tokenURI).to.not.be.empty;
      
      // 6. Check fee distribution
      const feeReceiverBalance = await mockERC20.balanceOf(feeReceiver.address);
      expect(feeReceiverBalance).to.equal(ethers.parseUnits("10", 18)); // 10% of service fee
      
      // 7. Check validator's fee balance
      const validatorBalance = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalance).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee

      // Debug: Check if caller has FEE_MANAGER_ROLE in Validator contract
      const hasValidatorFeeManagerRole = await validator.hasRole(await validator.FEE_MANAGER_ROLE(), feeManager.address);
      console.log("Caller has FEE_MANAGER_ROLE in Validator:", hasValidatorFeeManagerRole);
      
      // 8. Withdraw validator fees as fee manager
      const royaltyReceiverBalanceBefore = await mockERC20.balanceOf(feeReceiver.address);
      const validatorFeeBalanceBefore = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      console.log("Royalty receiver balance before withdrawal:", royaltyReceiverBalanceBefore.toString());
      console.log("Validator fee balance before withdrawal:", validatorFeeBalanceBefore.toString());
      
      await expect(
        fundManager.connect(feeManager).withdrawValidatorFees(
          await validator.getAddress(),
          await mockERC20.getAddress()
        )
      ).to.not.be.reverted;
      
      // 9. Verify royalty receiver received the funds
      const royaltyReceiverBalanceAfter = await mockERC20.balanceOf(feeReceiver.address);
      const validatorFeeBalanceAfter = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      console.log("Royalty receiver balance after withdrawal:", royaltyReceiverBalanceAfter.toString());
      console.log("Validator fee balance after withdrawal:", validatorFeeBalanceAfter.toString());
      console.log("Balance difference:", (royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore).toString());
      
      expect(royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore).to.equal(ethers.parseUnits("90", 18));
    });

    it("should support multiple compatible DeedNFTs", async function() {
      // Deploy a new DeedNFT
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();

      // Add as compatible
      await fundManager.addCompatibleDeedNFT(await newDeedNFT.getAddress());

      // Set up new DeedNFT
      await newDeedNFT.setFundManager(await fundManager.getAddress());
      await newDeedNFT.grantRole(await newDeedNFT.MINTER_ROLE(), await fundManager.getAddress());
      await newDeedNFT.grantRole(await newDeedNFT.VALIDATOR_ROLE(), await validator.getAddress());
      await newDeedNFT.grantRole(await newDeedNFT.MINTER_ROLE(), user1.address);

      // Verify both DeedNFTs are compatible
      expect(await fundManager.isCompatibleDeedNFT(await deedNFT.getAddress())).to.be.true;
      expect(await fundManager.isCompatibleDeedNFT(await newDeedNFT.getAddress())).to.be.true;

      // Get all compatible DeedNFTs
      const compatibleDeedNFTs = await fundManager.getCompatibleDeedNFTs();
      expect(compatibleDeedNFTs).to.include(await deedNFT.getAddress());
      expect(compatibleDeedNFTs).to.include(await newDeedNFT.getAddress());
      expect(compatibleDeedNFTs.length).to.equal(2);

      // Mint a deed using the new DeedNFT
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Approve tokens for the new DeedNFT
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      await expect(
        newDeedNFT.connect(user1).mintAsset(
          user1.address,
          0, // Land type
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          await mockERC20.getAddress(),
          0n // salt
        )
      ).to.not.be.reverted;

      // Verify the deed was minted on the new DeedNFT
      expect(await newDeedNFT.ownerOf(1)).to.equal(user1.address);
    });
  });
  
  describe("Error Handling and Edge Cases", function() {
    it("should revert if user tries to withdraw validator fees without proper role", async function() {
      await expect(
        fundManager.connect(user1).withdrawValidatorFees(
          await validator.getAddress(),
          await mockERC20.getAddress()
        )
      ).to.be.reverted;
    });
    
    it("should revert if trying to withdraw fees when balance is zero", async function() {
      await expect(
        fundManager.connect(feeManager).withdrawValidatorFees(
          await validator.getAddress(),
          await mockERC20.getAddress()
        )
      ).to.be.reverted;
    });
  });
  
  describe("Upgrade Paths", function() {
    it("should support upgrading core contracts while preserving state", async function() {
      // Deploy new implementation
      const FundManagerV2 = await ethers.getContractFactory("FundManager");
      
      // Upgrade proxy
      await upgrades.upgradeProxy(await fundManager.getAddress(), FundManagerV2);
      
      // Verify state is preserved
      expect(await fundManager.getCommissionPercentage()).to.equal(1000);
      expect(await fundManager.feeReceiver()).to.equal(feeReceiver.address);
    });
  });

  describe("Role Management", function() {
    it("should automatically assign FEE_MANAGER_ROLE to active validators", async function() {
      // Verify validator has FEE_MANAGER_ROLE in FundManager
      const FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();
      const hasRole = await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress());
      expect(hasRole).to.be.true;

      // Deploy a new validator
      const Validator2 = await ethers.getContractFactory("Validator");
      const validator2 = await upgrades.deployProxy(Validator2, [
        "ipfs://metadata2/",
        "ipfs://agreements2/"
      ]);
      await validator2.waitForDeployment();

      // Register the new validator
      await validatorRegistry.registerValidator(
        await validator2.getAddress(),
        "Test Validator 2",
        "Another validator for testing",
        [0, 1, 2, 3]
      );

      // Update validator roles in FundManager
      await fundManager.updateValidatorRoles();

      // Verify new validator has FEE_MANAGER_ROLE
      const hasRole2 = await fundManager.hasRole(FEE_MANAGER_ROLE, await validator2.getAddress());
      expect(hasRole2).to.be.true;
    });

    it("should automatically revoke FEE_MANAGER_ROLE when validator is removed or deactivated", async function() {
      const FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();
      // Initially, validator has FEE_MANAGER_ROLE
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.true;
      
      // Deactivate validator
      await validatorRegistry.updateValidatorStatus(await validator.getAddress(), false);
      // Verify role is revoked
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.false;
      
      // Reactivate validator
      await validatorRegistry.updateValidatorStatus(await validator.getAddress(), true);
      // Verify role is re-granted
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.true;
      
      // Remove validator
      await validatorRegistry.removeValidator(await validator.getAddress());
      // Verify role is revoked
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.false;
    });
  });
}); 