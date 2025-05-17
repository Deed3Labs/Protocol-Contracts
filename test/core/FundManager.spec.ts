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
      "Test Validator"
    );

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
      await deedNFT.getAddress(),
      await validatorRegistry.getAddress(),
      1000, // 10% commission
      deployer.address // fee receiver
    ]);
    await fundManager.waitForDeployment();

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

    // Set up contract connections
    await validator.setDeedNFT(await deedNFT.getAddress());
    await validator.setFundManager(await fundManager.getAddress());
    await deedNFT.setFundManager(await fundManager.getAddress());

    // Set up asset types in validator
    await validator.setAssetTypeSupport(0, true); // Land
    await validator.setAssetTypeSupport(1, true); // Vehicle
    await validator.setAssetTypeSupport(2, true); // Estate
    await validator.setAssetTypeSupport(3, true); // Equipment

    // Remove the whitelisting from here since we'll do it in the test cases
  });

  describe("Initialization", function() {
    it("should initialize with correct values", async function() {
      expect(await fundManager.deedNFTContract()).to.equal(await deedNFT.getAddress());
      expect(await fundManager.validatorRegistry()).to.equal(await validatorRegistry.getAddress());
    });

    it("should set up roles correctly", async function() {
      expect(await deedNFT.hasRole(MINTER_ROLE, await fundManager.getAddress())).to.be.true;
    });
  });

  describe("Creating Deeds with ERC20", function() {
    it("should create a deed and collect fees in ERC20", async function() {
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

      // Create a deed to accumulate fees
      await fundManager.connect(user1).mintDeedNFT(
        user1.address,
        0, // Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0n // salt
      );

      // Check validator balance in FundManager
      const validatorBalance = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalance).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee
    });
  });

  describe("Fee Management", function() {
    it("should allow fee manager to withdraw accumulated fees", async function() {
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

      // Create a deed to accumulate fees
      await fundManager.connect(user1).mintDeedNFT(
        user1.address,
        0, // Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0n // salt
      );

      // Debug: Check validator balance before withdrawal
      const validatorBalanceBeforeWithdraw = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      console.log("Validator commission balance before withdrawal:", validatorBalanceBeforeWithdraw.toString());
      expect(validatorBalanceBeforeWithdraw).to.be.gt(0);

      const feeManagerBalanceBefore = await mockERC20.balanceOf(feeManager.address);

      // Debug: Check FundManager's token balance before withdrawal
      const fundManagerBalanceBeforeWithdraw = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager token balance before withdrawal:", fundManagerBalanceBeforeWithdraw.toString());

      // Get deployer's balance before withdrawal
      const deployerBalanceBefore = await mockERC20.balanceOf(deployer.address);

      // Withdraw fees
      await fundManager.connect(deployer).withdrawValidatorFees(await validator.getAddress(), await mockERC20.getAddress());

      // Debug: Check FundManager's token balance after withdrawal
      const fundManagerBalanceAfterWithdraw = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager token balance after withdrawal:", fundManagerBalanceAfterWithdraw.toString());

      // Check validator's commission balance after withdrawal
      const validatorBalanceAfterWithdraw = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalanceAfterWithdraw).to.equal(0);

      // Check deployer's balance after withdrawal
      const deployerBalanceAfter = await mockERC20.balanceOf(deployer.address);
      expect(deployerBalanceAfter - deployerBalanceBefore).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee
    });
  });

  describe("Commission Management", function() {
    it("should set commission percentage correctly", async function() {
      await fundManager.setCommissionPercentage(2000); // 20%
      expect(await fundManager.getCommissionPercentage()).to.equal(2000);
    });

    it("should not allow setting commission percentage above maximum", async function() {
      await expect(
        fundManager.setCommissionPercentage(10001) // 100.01%
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

      await expect(
        fundManager.connect(user1).mintDeedNFT(
          user1.address,
          0, // Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          nonAuthorized.address, // unregistered validator
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
        fundManager.connect(user1).mintDeedNFT(
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

  describe("Fee Distribution", function() {
    it("should distribute fees correctly between validator and fund manager", async function() {
      // Whitelist token and set service fee in validator (100 tokens)
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

      // Get initial balances
      const feeReceiverBalanceBefore = await mockERC20.balanceOf(await fundManager.feeReceiver());
      const validatorBalanceBefore = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );

      // Create a deed to accumulate fees
      await fundManager.connect(user1).mintDeedNFT(
        user1.address,
        0, // Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0n // salt
      );

      // Verify total service fee was collected by FundManager
      const fundManagerBalance = await mockERC20.balanceOf(await fundManager.getAddress());
      expect(fundManagerBalance).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee

      // Verify commission was sent to feeReceiver (10% of service fee)
      const feeReceiverBalanceAfter = await mockERC20.balanceOf(await fundManager.feeReceiver());
      expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(ethers.parseUnits("10", 18));

      // Verify validator's commission balance was updated
      const validatorBalanceAfter = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalanceAfter - validatorBalanceBefore).to.equal(ethers.parseUnits("90", 18));

      // Get validator admin's balance before withdrawal
      const validatorAdminBalanceBefore = await mockERC20.balanceOf(deployer.address);

      // Withdraw fees as validator admin
      await fundManager.connect(deployer).withdrawValidatorFees(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );

      // Verify validator's commission balance is reset
      const validatorBalanceAfterWithdraw = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalanceAfterWithdraw).to.equal(0);

      // Verify validator admin received the funds
      const validatorAdminBalanceAfter = await mockERC20.balanceOf(deployer.address);
      expect(validatorAdminBalanceAfter - validatorAdminBalanceBefore).to.equal(ethers.parseUnits("90", 18));

      // Verify FundManager's balance is now 0
      const fundManagerBalanceAfter = await mockERC20.balanceOf(await fundManager.getAddress());
      expect(fundManagerBalanceAfter).to.equal(0);
    });

    it("should allow fee manager to withdraw validator fees", async function() {
      // Whitelist token and set service fee in validator (100 tokens)
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

      // Create a deed to accumulate fees
      await fundManager.connect(user1).mintDeedNFT(
        user1.address,
        0, // Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0n // salt
      );

      // Get fee manager's balance before withdrawal
      const feeManagerBalanceBefore = await mockERC20.balanceOf(feeManager.address);

      // Withdraw fees as fee manager
      await fundManager.connect(feeManager).withdrawValidatorFees(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );

      // Verify fee manager received the funds
      const feeManagerBalanceAfter = await mockERC20.balanceOf(feeManager.address);
      expect(feeManagerBalanceAfter - feeManagerBalanceBefore).to.equal(ethers.parseUnits("90", 18));

      // Verify validator's commission balance is reset
      const validatorBalanceAfterWithdraw = await fundManager.getCommissionBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalanceAfterWithdraw).to.equal(0);
    });
  });
}); 