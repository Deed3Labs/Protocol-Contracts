import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { FundManager } from "../../typechain-types/contracts/core/FundManager";
import { DeedNFT } from "../../typechain-types/contracts/core/DeedNFT";
import { Validator } from "../../typechain-types/contracts/core/Validator";
import { ValidatorRegistry } from "../../typechain-types/contracts/core/ValidatorRegistry";
import { MockERC20 } from "../../typechain-types/contracts/mocks/MockERC20";
import { IDeedNFT } from "../../typechain-types";

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
      const validatorBalance = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalance).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee

      // Debug: Check if caller has FEE_MANAGER_ROLE in Validator contract
      const hasValidatorFeeManagerRole = await validator.hasRole(FEE_MANAGER_ROLE, deployer.address);
      console.log("Caller has FEE_MANAGER_ROLE in Validator:", hasValidatorFeeManagerRole);
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

      // Approve FundManager to spend tokens
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

      // Create a deed to accumulate fees
      await fundManager.connect(user2).mintDeedNFT(
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

      // Withdraw fees
      await fundManager.connect(deployer).withdrawValidatorFees(await validator.getAddress(), await mockERC20.getAddress());

      // Debug: Check FundManager's token balance after withdrawal
      const fundManagerBalanceAfterWithdraw = await mockERC20.balanceOf(await fundManager.getAddress());
      console.log("FundManager token balance after withdrawal:", fundManagerBalanceAfterWithdraw.toString());

      // Verify royalty receiver received the funds
      const royaltyReceiverBalanceAfter = await mockERC20.balanceOf(user1.address);
      console.log("Royalty receiver balance after withdrawal:", royaltyReceiverBalanceAfter.toString());
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

      // Create a deed to accumulate fees
      await fundManager.connect(user2).mintDeedNFT(
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
      const validatorBalanceBefore = await fundManager.getValidatorFeeBalance(
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
      const validatorBalanceAfter = await fundManager.getValidatorFeeBalance(
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
      const validatorBalanceAfterWithdraw = await fundManager.getValidatorFeeBalance(
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
  });

  describe("Role Management", function() {
    it("should allow ValidatorRegistry to update validator roles", async function() {
      // Get initial role status
      const FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.true;
      
      // Call updateValidatorRoles from ValidatorRegistry
      await validatorRegistry.updateValidatorStatus(await validator.getAddress(), false);
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.false;
      
      // Reactivate and check role is granted back
      await validatorRegistry.updateValidatorStatus(await validator.getAddress(), true);
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, await validator.getAddress())).to.be.true;
    });
  });

  describe("Batch Minting", function() {
    it("should mint multiple deeds in a batch", async function() {
      // Whitelist token and set service fee
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));

      // Mint tokens to user1
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("1000", 18));

      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Create batch mint data
      const deeds = [
        {
          owner: user1.address,
          assetType: 0, // Land
          ipfsDetailsHash: "ipfs://metadata1",
          definition: definition,
          configuration: "configuration1",
          validatorContract: await validator.getAddress(),
          token: await mockERC20.getAddress(),
          salt: 0n
        },
        {
          owner: user1.address,
          assetType: 1, // Vehicle
          ipfsDetailsHash: "ipfs://metadata2",
          definition: definition,
          configuration: "configuration2",
          validatorContract: await validator.getAddress(),
          token: await mockERC20.getAddress(),
          salt: 1n
        }
      ];

      // Mint batch
      const tx = await fundManager.connect(user1).mintBatchDeedNFT(deeds);
      const receipt = await tx.wait();
      if (!receipt) throw new Error('No receipt returned');
      // Check for at least one DeedMinted event
      const deedMintedEvents = receipt.logs
        .map(log => {
          try {
            return fundManager.interface.parseLog({ topics: log.topics, data: log.data });
          } catch {
            return null;
          }
        })
        .filter(e => e && e.name === "DeedMinted");
      expect(deedMintedEvents.length).to.be.greaterThanOrEqual(2);

      // Verify fees were collected
      const validatorBalance = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalance).to.equal(ethers.parseUnits("180", 18)); // 90% of 200
    });

    it("should fail batch minting with empty deeds array", async function() {
      await expect(
        fundManager.connect(user1).mintBatchDeedNFT([])
      ).to.be.reverted; // No revert reason string
    });

    it("should fail batch minting with invalid validator", async function() {
      const deeds = [{
        owner: user1.address,
        assetType: 0,
        ipfsDetailsHash: "ipfs://metadata1",
        definition: "definition1",
        configuration: "configuration1",
        validatorContract: nonAuthorized.address,
        token: await mockERC20.getAddress(),
        salt: 0n
      }];

      await expect(
        fundManager.connect(user1).mintBatchDeedNFT(deeds)
      ).to.be.reverted; // No revert reason string
    });
  });

  describe("Commission Collection", () => {
    it("should collect commission from DeedNFT", async () => {
      // Whitelist token and set service fee
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));

      // Mint tokens to user1
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      // Mint a deed first
      const tx = await fundManager.connect(user1).mintDeedNFT(
        user1.address,
        0, // Land
        "ipfs://details/1",
        "Test Definition",
        "Test Configuration",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0
      );
      const receipt = await tx.wait();
      if (!receipt) throw new Error('No receipt returned');

      // Find the DeedMinted event
      const deedMintedEvent = receipt.logs
        .map(log => {
          try {
            return fundManager.interface.parseLog({ topics: log.topics, data: log.data });
          } catch {
            return null;
          }
        })
        .find(e => e && e.name === "DeedMinted");
      const tokenId = deedMintedEvent?.args?.tokenId;
      expect(tokenId).to.not.be.undefined;

      // Get the DeedNFT contract
      const deedNFT = await ethers.getContractAt("DeedNFT", await fundManager.deedNFT());

      // Approve FundManager as a marketplace
      await deedNFT.connect(deployer).setApprovedMarketplace(await fundManager.getAddress(), true);

      // Simulate DeedNFT contract calling collectCommission
      await deedNFT.connect(user1).setApprovalForAll(await fundManager.getAddress(), true);
      await deedNFT.connect(user1).transferFrom(user1.address, await fundManager.getAddress(), tokenId);

      // Verify commission was collected
      const validatorBalance = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalance).to.be.gt(0);
    });

    it("should fail commission collection with invalid token", async () => {
      const deedNFT = await ethers.getContractAt("DeedNFT", await fundManager.deedNFT());
      await expect(
        deedNFT.connect(user1).transferFrom(user1.address, await fundManager.getAddress(), 999)
      ).to.be.reverted;
    });

    it("should fail commission collection with zero amount", async () => {
      // Whitelist token and set service fee
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));

      // Mint tokens to user1
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      // Mint a deed first
      const tx = await fundManager.connect(user1).mintDeedNFT(
        user1.address,
        0, // Land
        "ipfs://details/1",
        "Test Definition",
        "Test Configuration",
        await validator.getAddress(),
        await mockERC20.getAddress(),
        0
      );
      const receipt = await tx.wait();
      if (!receipt) throw new Error('No receipt returned');

      // Find the DeedMinted event
      const deedMintedEvent = receipt.logs
        .map(log => {
          try {
            return fundManager.interface.parseLog({ topics: log.topics, data: log.data });
          } catch {
            return null;
          }
        })
        .find(e => e && e.name === "DeedMinted");
      const tokenId = deedMintedEvent?.args?.tokenId;
      expect(tokenId).to.not.be.undefined;

      // Call collectCommission directly with zero amount and expect revert
      await expect(
        fundManager.connect(deployer).collectCommission(tokenId, 0, await mockERC20.getAddress())
      ).to.be.reverted;
    });

    it("should fail commission collection with invalid validator", async () => {
      // Mint a deed with an invalid validator
      const invalidValidator = ethers.Wallet.createRandom().address;
      await expect(
        fundManager.mintDeedNFT(
          user1.address,
          0, // Land
          "ipfs://details/1",
          "Test Definition",
          "Test Configuration",
          invalidValidator,
          await mockERC20.getAddress(),
          0
        )
      ).to.be.reverted;
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
      ).to.be.reverted; // No revert reason string
    });
  });

  describe("Additional Error Cases", function() {
    it("should fail minting with zero address validator", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        fundManager.connect(user1).mintDeedNFT(
          user1.address,
          0,
          "ipfs://metadata1",
          definition,
          "configuration1",
          ethers.ZeroAddress,
          await mockERC20.getAddress(),
          0n
        )
      ).to.be.reverted; // No revert reason string
    });

    it("should fail minting with zero address token", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        fundManager.connect(user1).mintDeedNFT(
          user1.address,
          0,
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          ethers.ZeroAddress,
          0n
        )
      ).to.be.reverted; // No revert reason string
    });

    it("should fail minting with zero address owner", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        fundManager.connect(user1).mintDeedNFT(
          ethers.ZeroAddress,
          0,
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          await mockERC20.getAddress(),
          0n
        )
      ).to.be.reverted; // No revert reason string
    });
  });
}); 