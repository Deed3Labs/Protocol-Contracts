import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { FundManager } from "../../typechain-types/contracts/core/FundManager";
import { DeedNFT } from "../../typechain-types/contracts/core/DeedNFT";
import { Validator } from "../../typechain-types/contracts/core/Validator";
import { ValidatorRegistry } from "../../typechain-types/contracts/core/ValidatorRegistry";
import { MockERC20 } from "../../typechain-types/contracts/mocks/MockERC20";

describe("FundManager Contract", function() {
  let fundManager: FundManager;
  let deedNFT: DeedNFT;
  let validator: Validator;
  let validatorRegistry: ValidatorRegistry;
  let mockERC20: MockERC20;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeManager: SignerWithAddress;
  let nonAuthorized: SignerWithAddress;

  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
  const FEE_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FEE_MANAGER_ROLE"));
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));

  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, user1, user2, feeManager, nonAuthorized] = signers;

    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();

    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "ipfs://metadata/",
      "ipfs://agreements/"
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

    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();

    // Deploy FundManager
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      await validatorRegistry.getAddress(),
      1000, // 10% commission
      deployer.address // fee receiver
    ]);
    await fundManager.waitForDeployment();

    // Set FundManager in ValidatorRegistry
    await validatorRegistry.setFundManager(await fundManager.getAddress());

    // Deploy MockERC20
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MTK", 18);
    await mockERC20.waitForDeployment();

    // Set up roles
    await validator.grantRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await validator.grantRole(VALIDATOR_ROLE, deployer.address);
    await validator.grantRole(FEE_MANAGER_ROLE, deployer.address);
    await validator.grantRole(FEE_MANAGER_ROLE, feeManager.address);
    await validator.grantRole(ADMIN_ROLE, feeManager.address);

    await deedNFT.grantRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await deedNFT.grantRole(VALIDATOR_ROLE, deployer.address);
    await deedNFT.grantRole(MINTER_ROLE, deployer.address);
    await deedNFT.grantRole(MINTER_ROLE, await fundManager.getAddress());
    await deedNFT.grantRole(MINTER_ROLE, user1.address);
    await deedNFT.grantRole(MINTER_ROLE, user2.address);

    // Set up contract connections
    await validator.setDeedNFT(await deedNFT.getAddress());
    await validator.setFundManager(await fundManager.getAddress());
    await deedNFT.setFundManager(await fundManager.getAddress());

    // Set up asset types in validator
    await validator.setAssetTypeSupport(0, true); // Land
    await validator.setAssetTypeSupport(1, true); // Vehicle
    await validator.setAssetTypeSupport(2, true); // Estate
    await validator.setAssetTypeSupport(3, true); // Equipment

    // Add DeedNFT as compatible
    await fundManager.addCompatibleDeedNFT(await deedNFT.getAddress());
  });

  describe("Initialization", function() {
    it("should initialize with correct values", async function() {
      expect(await fundManager.validatorRegistry()).to.equal(await validatorRegistry.getAddress());
      expect(await fundManager.getCommissionPercentage()).to.equal(1000); // 10%
      expect(await fundManager.feeReceiver()).to.equal(deployer.address);
    });

    it("should set up roles correctly", async function() {
      expect(await fundManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await fundManager.hasRole(ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, deployer.address)).to.be.true;
    });
  });

  describe("Payment Processing", function() {
    it("should process payment and distribute fees correctly", async function() {
      // Whitelist token and set service fee in validator (100 tokens)
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));

      // Mint tokens to user1
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));

      // Approve FundManager to spend tokens
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Get initial balances
      const feeReceiverBalanceBefore = await mockERC20.balanceOf(await fundManager.feeReceiver());
      console.log("Fee receiver balance before mint:", feeReceiverBalanceBefore.toString());

      // Create a deed through DeedNFT
      await deedNFT.connect(user1).mintAsset(
        user1.address,
        0, // Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0n // salt
      );

      // Debug: Check fee receiver balance after mint
      const feeReceiverBalanceAfter = await mockERC20.balanceOf(await fundManager.feeReceiver());
      console.log("Fee receiver balance after mint:", feeReceiverBalanceAfter.toString());
      expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(ethers.parseUnits("10", 18)); // 10% commission

      // Check validator balance in FundManager
      const validatorBalance = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalance).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee
    });

    it("should not process payment from non-compatible DeedNFT", async function() {
      // Deploy a new DeedNFT that's not compatible
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();

      // Whitelist token and set service fee
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));

      // Mint tokens to user1
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Try to mint through non-compatible DeedNFT
      await expect(
        newDeedNFT.connect(user1).mintAsset(
          user1.address,
          0,
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          await mockERC20.getAddress(),
          0n
        )
      ).to.be.reverted;
    });
  });

  describe("Fee Management", function() {
    it("should collect and distribute service fees correctly", async function() {
      // Whitelist token and set service fee in validator (100 tokens)
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));

      // Set royalty receiver
      await validator.setRoyaltyReceiver(user1.address);

      // Mint tokens to user2
      await mockERC20.mint(user2.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user2).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Debug: Check initial balances
      const feeReceiverBalanceBefore = await mockERC20.balanceOf(await fundManager.feeReceiver());
      console.log("Fee receiver balance before mint:", feeReceiverBalanceBefore.toString());
      const fundManagerBalanceBefore = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager balance before mint:", fundManagerBalanceBefore.toString());

      // Create a deed through DeedNFT
      await deedNFT.connect(user2).mintAsset(
        user2.address,
        0, // Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0n // salt
      );

      // Debug: Check balances after mint
      const feeReceiverBalanceAfterMint = await mockERC20.balanceOf(await fundManager.feeReceiver());
      console.log("Fee receiver balance after mint:", feeReceiverBalanceAfterMint.toString());
      console.log("Commission received:", (feeReceiverBalanceAfterMint - feeReceiverBalanceBefore).toString());
      const fundManagerBalanceAfterMint = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager balance after mint:", fundManagerBalanceAfterMint.toString());

      // Get initial balances for withdrawal
      const royaltyReceiverBalanceBefore = await mockERC20.balanceOf(user1.address);
      console.log("Royalty receiver balance before withdrawal:", royaltyReceiverBalanceBefore.toString());

      // Debug: Check validator service fee balance before withdrawal
      const validatorServiceFeeBalanceBefore = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      console.log("Validator service fee balance before withdrawal:", validatorServiceFeeBalanceBefore.toString());
      expect(validatorServiceFeeBalanceBefore).to.be.gt(0);

      // Debug: Check FundManager's token balance before withdrawal
      const fundManagerBalanceBeforeWithdraw = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager token balance before withdrawal:", fundManagerBalanceBeforeWithdraw.toString());

      // Withdraw fees
      await fundManager.connect(deployer).withdrawValidatorFees(await validator.getAddress(), await mockERC20.getAddress());

      // Debug: Check FundManager's token balance after withdrawal
      const fundManagerBalanceAfterWithdraw = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager token balance after withdrawal:", fundManagerBalanceAfterWithdraw.toString());

      // Verify royalty receiver received the funds
      const royaltyReceiverBalanceAfter = await mockERC20.balanceOf(user1.address);
      console.log("Royalty receiver balance after withdrawal:", royaltyReceiverBalanceAfter.toString());
      console.log("Royalty amount received:", (royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore).toString());
      expect(royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee

      // Verify validator's service fee balance is reset
      const validatorServiceFeeBalanceAfter = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      console.log("Validator service fee balance after withdrawal:", validatorServiceFeeBalanceAfter.toString());
      expect(validatorServiceFeeBalanceAfter).to.equal(0);
    });

    it("should allow validator fee manager to withdraw service fees", async function() {
      // Whitelist token and set service fee in validator (100 tokens)
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));

      // Set royalty receiver
      await validator.setRoyaltyReceiver(user1.address);

      // Mint tokens to user2
      await mockERC20.mint(user2.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user2).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Get initial balances
      const feeReceiverBalanceBefore = await mockERC20.balanceOf(await fundManager.feeReceiver());
      console.log("Fee receiver balance before mint:", feeReceiverBalanceBefore.toString());

      // Create a deed through DeedNFT
      await deedNFT.connect(user2).mintAsset(
        user2.address,
        0, // Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0n // salt
      );

      // Debug: Check fee receiver balance after mint
      const feeReceiverBalanceAfter = await mockERC20.balanceOf(await fundManager.feeReceiver());
      console.log("Fee receiver balance after mint:", feeReceiverBalanceAfter.toString());
      expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(ethers.parseUnits("10", 18)); // 10% commission

      // Get initial balances for withdrawal
      const royaltyReceiverBalanceBefore = await mockERC20.balanceOf(user1.address);
      console.log("Royalty receiver balance before withdrawal:", royaltyReceiverBalanceBefore.toString());

      // Debug: Check validator service fee balance before withdrawal
      const validatorServiceFeeBalanceBefore = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      console.log("Validator service fee balance before withdrawal:", validatorServiceFeeBalanceBefore.toString());
      expect(validatorServiceFeeBalanceBefore).to.be.gt(0);

      // Debug: Check FundManager's token balance before withdrawal
      const fundManagerBalanceBeforeWithdraw = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager token balance before withdrawal:", fundManagerBalanceBeforeWithdraw.toString());

      // Get validator fee manager's balance before withdrawal
      const validatorFeeManagerBalanceBefore = await mockERC20.balanceOf(deployer.address);
      console.log("Validator fee manager balance before withdrawal:", validatorFeeManagerBalanceBefore.toString());

      // Withdraw fees as validator fee manager
      await fundManager.connect(deployer).withdrawValidatorFees(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );

      // Debug: Check FundManager's token balance after withdrawal
      const fundManagerBalanceAfterWithdraw = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager token balance after withdrawal:", fundManagerBalanceAfterWithdraw.toString());

      // Debug: Check validator fee manager's balance after withdrawal
      const validatorFeeManagerBalanceAfter = await mockERC20.balanceOf(deployer.address);
      console.log("Validator fee manager balance after withdrawal:", validatorFeeManagerBalanceAfter.toString());

      // Verify royalty receiver received the funds
      const royaltyReceiverBalanceAfter = await mockERC20.balanceOf(user1.address);
      console.log("Royalty receiver balance after withdrawal:", royaltyReceiverBalanceAfter.toString());
      expect(royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore).to.equal(ethers.parseUnits("90", 18));

      // Verify validator's service fee balance is reset
      const validatorServiceFeeBalanceAfter = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      console.log("Validator service fee balance after withdrawal:", validatorServiceFeeBalanceAfter.toString());
      expect(validatorServiceFeeBalanceAfter).to.equal(0);
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

  describe("Commission Management", function() {
    it("should set commission percentage correctly", async function() {
      await fundManager.setCommissionPercentage(500); // 5%
      expect(await fundManager.getCommissionPercentage()).to.equal(500);
    });

    it("should not allow setting commission percentage above maximum", async function() {
      await expect(
        fundManager.setCommissionPercentage(1001) // 10.01%
      ).to.be.reverted;
    });

    it("should set fee receiver correctly", async function() {
      await fundManager.setFeeReceiver(feeManager.address);
      expect(await fundManager.feeReceiver()).to.equal(feeManager.address);
    });

    it("should not allow setting fee receiver to zero address", async function() {
      await expect(
        fundManager.setFeeReceiver(ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe("Error Cases", function() {
    it("should not allow non-admin to set commission percentage", async function() {
      await expect(
        fundManager.connect(user1).setCommissionPercentage(2000)
      ).to.be.reverted;
    });

    it("should not allow non-admin to set fee receiver", async function() {
      await expect(
        fundManager.connect(user1).setFeeReceiver(user2.address)
      ).to.be.reverted;
    });

    it("should not allow minting with unregistered validator", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Mint tokens to user1
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      // Deploy a new validator that's not registered
      const Validator = await ethers.getContractFactory("Validator");
      const newValidator = await upgrades.deployProxy(Validator, [
        "ipfs://metadata/",
        "ipfs://agreements/"
      ]);
      await newValidator.waitForDeployment();

      await expect(
        deedNFT.connect(user1).mintAsset(
          user1.address,
          0, // Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          await newValidator.getAddress(), // unregistered validator
          await mockERC20.getAddress(),
          0n // salt
        )
      ).to.be.reverted;
    });

    it("should not allow minting with insufficient token approval", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Mint tokens to user1 but don't approve
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));

      await expect(
        deedNFT.connect(user1).mintAsset(
          user1.address,
          0, // Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          await mockERC20.getAddress(),
          0n // salt
        )
      ).to.be.reverted;
    });
  });

  describe("DeedNFT Management", function() {
    it("should allow adding compatible DeedNFTs", async function() {
      // Deploy a new DeedNFT
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();

      // Add as compatible
      await fundManager.addCompatibleDeedNFT(await newDeedNFT.getAddress());
      expect(await fundManager.isCompatibleDeedNFT(await newDeedNFT.getAddress())).to.be.true;
    });

    it("should not allow adding zero address as compatible DeedNFT", async function() {
      await expect(
        fundManager.addCompatibleDeedNFT(ethers.ZeroAddress)
      ).to.be.reverted;
    });

    it("should not allow adding already compatible DeedNFT", async function() {
      await expect(
        fundManager.addCompatibleDeedNFT(await deedNFT.getAddress())
      ).to.be.reverted;
    });

    it("should allow removing compatible DeedNFT", async function() {
      // Deploy a new DeedNFT
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();

      // Add as compatible
      await fundManager.addCompatibleDeedNFT(await newDeedNFT.getAddress());

      // Remove from compatible list
      await fundManager.removeCompatibleDeedNFT(await newDeedNFT.getAddress());
      expect(await fundManager.isCompatibleDeedNFT(await newDeedNFT.getAddress())).to.be.false;
    });

    it("should get all compatible DeedNFTs", async function() {
      // Deploy a new DeedNFT
      const DeedNFT = await ethers.getContractFactory("DeedNFT");
      const newDeedNFT = await upgrades.deployProxy(DeedNFT, [
        await validator.getAddress(),
        await validatorRegistry.getAddress()
      ]);
      await newDeedNFT.waitForDeployment();

      // Add as compatible
      await fundManager.addCompatibleDeedNFT(await newDeedNFT.getAddress());

      const compatibleDeedNFTs = await fundManager.getCompatibleDeedNFTs();
      expect(compatibleDeedNFTs).to.include(await deedNFT.getAddress());
      expect(compatibleDeedNFTs).to.include(await newDeedNFT.getAddress());
      expect(compatibleDeedNFTs.length).to.equal(2);
    });
  });

  describe("Role Management", function() {
    it("should allow admin to grant roles", async function() {
      await fundManager.grantRole(await fundManager.FEE_MANAGER_ROLE(), user1.address);
      expect(await fundManager.hasRole(await fundManager.FEE_MANAGER_ROLE(), user1.address)).to.be.true;
    });

    it("should allow admin to revoke roles", async function() {
      await fundManager.grantRole(await fundManager.FEE_MANAGER_ROLE(), user1.address);
      await fundManager.revokeRole(await fundManager.FEE_MANAGER_ROLE(), user1.address);
      expect(await fundManager.hasRole(await fundManager.FEE_MANAGER_ROLE(), user1.address)).to.be.false;
    });

    it("should prevent non-admin from granting roles", async function() {
      await expect(
        fundManager.connect(user1).grantRole(await fundManager.FEE_MANAGER_ROLE(), user2.address)
      ).to.be.reverted;
    });
  });

  describe("Royalty Management", function() {
    it("should allow FundManager to withdraw royalties with commission", async function() {
      // Set up royalty fee percentage and receiver in validator
      await validator.connect(deployer).setRoyaltyFeePercentage(500); // 5%
      await validator.connect(deployer).setRoyaltyReceiver(user1.address);

      // Whitelist token in validator
      await validator.connect(deployer).addWhitelistedToken(await mockERC20.getAddress());

      // Mint tokens to user2
      await mockERC20.mint(user2.address, ethers.parseUnits("100", 18));

      // Debug: Check initial balances
      console.log("Initial validator balance:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("Initial user2 balance:", (await mockERC20.balanceOf(user2.address)).toString());
      console.log("Initial royalty receiver balance:", (await mockERC20.balanceOf(user1.address)).toString());
      console.log("Initial fee receiver balance:", (await mockERC20.balanceOf(await fundManager.feeReceiver())).toString());

      // Transfer tokens to validator to simulate royalty accrual
      await mockERC20.connect(user2).transfer(await validator.getAddress(), ethers.parseUnits("5", 18));

      // Debug: Check balances after transfer
      console.log("Validator balance after transfer:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("User2 balance after transfer:", (await mockERC20.balanceOf(user2.address)).toString());

      // Check royalty balance
      const royaltyBalance = await validator.getRoyaltyBalance(await mockERC20.getAddress());
      console.log("Royalty balance:", royaltyBalance.toString());
      expect(royaltyBalance).to.equal(ethers.parseUnits("5", 18));

      // Withdraw royalties through FundManager
      const validatorAddress = await validator.getAddress();
      const tokenAddress = await mockERC20.getAddress();
      const royaltyReceiverBalanceBefore = await mockERC20.balanceOf(user1.address);
      const feeReceiverBalanceBefore = await mockERC20.balanceOf(await fundManager.feeReceiver());
      console.log("Royalty receiver balance before withdrawal:", royaltyReceiverBalanceBefore.toString());
      console.log("Fee receiver balance before withdrawal:", feeReceiverBalanceBefore.toString());
      await fundManager.connect(deployer).withdrawRoyaltyCommission(
        validatorAddress,
        tokenAddress
      );
      
      const royaltyReceiverBalanceAfter = await mockERC20.balanceOf(user1.address);
      const feeReceiverBalanceAfter = await mockERC20.balanceOf(await fundManager.feeReceiver());

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

    it("should prevent unauthorized users from withdrawing royalties", async function() {
      // Set up royalty fee percentage and receiver
      await validator.connect(deployer).setRoyaltyFeePercentage(500); // 5%
      await validator.connect(deployer).setRoyaltyReceiver(user1.address);

      // Whitelist token in validator
      await validator.connect(deployer).addWhitelistedToken(await mockERC20.getAddress());

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

      // Try to withdraw royalties as unauthorized user
      const validatorAddress2 = await validator.getAddress();
      const tokenAddress2 = await mockERC20.getAddress();
      await expect(
        fundManager.connect(user2).withdrawRoyaltyCommission(
          validatorAddress2,
          tokenAddress2
        )
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
      const validatorAddress3 = await validator.getAddress();
      const tokenAddress3 = await mockERC20.getAddress();
      await expect(
        fundManager.connect(deployer).withdrawRoyaltyCommission(
          validatorAddress3,
          tokenAddress3
        )
      ).to.be.reverted;

      // Debug: Check final balances
      console.log("Final validator balance:", (await mockERC20.balanceOf(await validator.getAddress())).toString());
      console.log("Final royalty receiver balance:", (await mockERC20.balanceOf(user1.address)).toString());
    });
  });
}); 