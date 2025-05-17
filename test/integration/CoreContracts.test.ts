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
    [deployer, user1, validator1, feeReceiver, feeManager] = [signers[0], signers[1], signers[2], signers[3], signers[4]];
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();
    
    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "ipfs://baseURI/",
      "ipfs://defaultOperatingAgreement/"
    ]);
    await validator.waitForDeployment();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      "ipfs://baseURI/",
      "ipfs://defaultOperatingAgreement/"
    ]);
    await deedNFT.waitForDeployment();
    
    // Deploy FundManager
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      await deedNFT.getAddress(),
      await validatorRegistry.getAddress(),
      500, // 5% commission
      feeReceiver.address
    ]);
    await fundManager.waitForDeployment();
    
    // Deploy MetadataRenderer
    const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
    metadataRenderer = await upgrades.deployProxy(MetadataRenderer, [await deedNFT.getAddress()]);
    await metadataRenderer.waitForDeployment();
    
    // Deploy MockERC20 for testing
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MTK", 18);
    await mockERC20.waitForDeployment();
    
    // Set up roles and permissions
    await deedNFT.grantRole(await deedNFT.VALIDATOR_ROLE(), await validator.getAddress());
    await deedNFT.grantRole(await deedNFT.MINTER_ROLE(), await fundManager.getAddress());
    await validator.grantRole(await validator.VALIDATOR_ROLE(), validator1.address);
    await validator.grantRole(await validator.METADATA_ROLE(), await validator.getAddress());
    await validator.grantRole(await validator.CRITERIA_MANAGER_ROLE(), await validator.getAddress());
    await validator.grantRole(await validator.FEE_MANAGER_ROLE(), feeManager.address);
    await validator.grantRole(await validator.ADMIN_ROLE(), feeManager.address);
    
    // Set up DeedNFT in Validator
    await validator.setDeedNFT(await deedNFT.getAddress());
    
    // Register validator
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      "Test Validator"
    );
    
    // Whitelist token and set service fee in validator
    await validator.addWhitelistedToken(await mockERC20.getAddress());
    await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));
  });
  
  describe("End-to-End Deed Creation Process", function() {
    it("should allow full lifecycle: create, validate, and manage a deed", async function() {
      // Mint tokens to user1
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));
      
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });
      
      // 1. Create a new deed using the FundManager
      const tx = await fundManager.connect(user1).mintDeedNFT(
        user1.address,
        0, // Land type
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0n // salt
      );
      
      const receipt = await tx.wait();
      // Extract deed ID from events
      const deedMintedEvent = receipt.events.find((e: any) => e.event === "DeedMinted");
      const deedId = deedMintedEvent.args.tokenId;
      
      // 2. Verify ownership
      expect(await deedNFT.ownerOf(deedId)).to.equal(user1.address);
      
      // 3. Validator approves the deed
      await validator.connect(validator1).validateDeed(deedId, true);
      
      // 4. Check validation status
      const deedInfo = await deedNFT.getDeedInfo(deedId);
      expect(deedInfo.isValidated).to.be.true;
      
      // 5. Generate and check metadata
      const tokenURI = await metadataRenderer.tokenURI(deedId);
      expect(tokenURI).to.not.be.empty;
      
      // 6. Check fee distribution
      const feeReceiverBalance = await mockERC20.balanceOf(feeReceiver.address);
      expect(feeReceiverBalance).to.equal(ethers.parseUnits("10", 18)); // 10% of service fee
      
      // 7. Check validator's commission balance
      const validatorBalance = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalance).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee
      
      // 8. Withdraw validator fees as fee manager
      const feeManagerBalanceBefore = await mockERC20.balanceOf(feeManager.address);
      await fundManager.connect(feeManager).withdrawValidatorFees(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      
      // 9. Verify fee manager received the funds
      const feeManagerBalanceAfter = await mockERC20.balanceOf(feeManager.address);
      expect(feeManagerBalanceAfter - feeManagerBalanceBefore).to.equal(ethers.parseUnits("90", 18));
      
      // 10. Verify validator's commission balance is reset
      const validatorBalanceAfter = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalanceAfter).to.equal(0);
    });
  });
  
  describe("Error Handling and Edge Cases", function() {
    it("should revert if user tries to withdraw validator fees without proper role", async function() {
      await expect(
        fundManager.connect(user1).withdrawValidatorFees(
          await validator.getAddress(),
          await mockERC20.getAddress()
        )
      ).to.be.revertedWith("FundManager: Not authorized to withdraw fees");
    });
    
    it("should revert if trying to withdraw fees when balance is zero", async function() {
      await expect(
        fundManager.connect(feeManager).withdrawValidatorFees(
          await validator.getAddress(),
          await mockERC20.getAddress()
        )
      ).to.be.revertedWith("FundManager: No fees to withdraw");
    });
  });
  
  describe("Upgrade Paths", function() {
    it("should support upgrading core contracts while preserving state", async function() {
      // Deploy new implementation
      const FundManagerV2 = await ethers.getContractFactory("FundManager");
      
      // Upgrade proxy
      await upgrades.upgradeProxy(await fundManager.getAddress(), FundManagerV2);
      
      // Verify state is preserved
      expect(await fundManager.getCommissionPercentage()).to.equal(500);
      expect(await fundManager.feeReceiver()).to.equal(feeReceiver.address);
    });
  });
}); 