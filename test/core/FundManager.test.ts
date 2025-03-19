import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("FundManager Contract", function() {
  let deedNFT: Contract;
  let validatorRegistry: Contract;
  let fundManager: Contract;
  let mockERC20: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeReceiver: SignerWithAddress;
  let validator1: SignerWithAddress;
  
  beforeEach(async function() {
    [deployer, user1, user2, feeReceiver, validator1] = await ethers.getSigners();
    
    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.deployed();
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, ["DeedNFT", "DEED", validatorRegistry.address]);
    await deedNFT.deployed();
    
    // Deploy FundManager
    const FundManager = await ethers.getContractFactory("FundManager");
    fundManager = await upgrades.deployProxy(FundManager, [
      deedNFT.address,
      validatorRegistry.address,
      feeReceiver.address
    ]);
    await fundManager.deployed();
    
    // Deploy Mock ERC20 for testing
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", ethers.utils.parseEther("1000000"));
    await mockERC20.deployed();
    
    // Setup roles
    const VALIDATOR_ROLE = await deedNFT.VALIDATOR_ROLE();
    const MINTER_ROLE = await deedNFT.MINTER_ROLE();
    const FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();
    
    // Grant roles
    await deedNFT.grantRole(VALIDATOR_ROLE, deployer.address);
    await deedNFT.grantRole(VALIDATOR_ROLE, validator1.address);
    await deedNFT.grantRole(MINTER_ROLE, fundManager.address);
    await fundManager.grantRole(FEE_MANAGER_ROLE, deployer.address);
    
    // Set FundManager in DeedNFT
    await deedNFT.setFundManager(fundManager.address);
    
    // Whitelist token and set fees
    await fundManager.whitelistToken(mockERC20.address, true);
    await fundManager.setServiceFee(mockERC20.address, ethers.utils.parseEther("10"));
    await fundManager.setCommissionPercentage(1000); // 10%
    
    // Transfer tokens to users for testing
    await mockERC20.transfer(user1.address, ethers.utils.parseEther("1000"));
    await mockERC20.transfer(user2.address, ethers.utils.parseEther("1000"));
  });
  
  describe("Initialization", function() {
    it("should initialize with correct values", async function() {
      expect(await fundManager.deedNFT()).to.equal(deedNFT.address);
      expect(await fundManager.validatorRegistry()).to.equal(validatorRegistry.address);
      expect(await fundManager.feeReceiver()).to.equal(feeReceiver.address);
    });
    
    it("should set up roles correctly", async function() {
      const FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();
      const DEFAULT_ADMIN_ROLE = await fundManager.DEFAULT_ADMIN_ROLE();
      
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, deployer.address)).to.be.true;
      expect(await fundManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
    });
  });
  
  describe("Token Management", function() {
    it("should whitelist tokens correctly", async function() {
      expect(await fundManager.isWhitelisted(mockERC20.address)).to.be.true;
      
      // Unwhitelist the token
      await fundManager.whitelistToken(mockERC20.address, false);
      expect(await fundManager.isWhitelisted(mockERC20.address)).to.be.false;
    });
    
    it("should set service fees correctly", async function() {
      const fee = ethers.utils.parseEther("10");
      expect(await fundManager.serviceFee(mockERC20.address)).to.equal(fee);
      
      // Update fee
      const newFee = ethers.utils.parseEther("20");
      await fundManager.setServiceFee(mockERC20.address, newFee);
      expect(await fundManager.serviceFee(mockERC20.address)).to.equal(newFee);
    });
  });
  
  describe("Minting with Payment", function() {
    it("should mint a deed after payment", async function() {
      // Approve tokens for FundManager
      await mockERC20.connect(user1).approve(fundManager.address, ethers.utils.parseEther("100"));
      
      // Register a validator
      await validatorRegistry.registerValidator(
        validator1.address,
        deployer.address,
        "Test Validator",
        "Test validator for unit tests",
        [0, 1, 2, 3] // Support all asset types
      );
      
      // Mint with payment
      const tx = await fundManager.connect(user1).mintAssetWithPayment(
        0, // AssetType.Land
        "ipfs://metadata-paid",
        "ipfs://agreement-paid",
        "paid-definition",
        "paid-configuration",
        validator1.address,
        mockERC20.address
      );
      
      const receipt = await tx.wait();
      
      // Verify token balances
      const fee = ethers.utils.parseEther("10");
      const serviceFeeBalance = await fundManager.serviceFeesBalance(mockERC20.address);
      expect(serviceFeeBalance).to.equal(fee);
      
      // Verify deed was minted
      const deedCount = await deedNFT.balanceOf(user1.address);
      expect(deedCount).to.be.gt(0);
    });
  });
  
  describe("Fee Withdrawal", function() {
    it("should allow admin to withdraw service fees", async function() {
      // First mint a deed with payment to generate fees
      await mockERC20.connect(user1).approve(fundManager.address, ethers.utils.parseEther("100"));
      
      await validatorRegistry.registerValidator(
        validator1.address,
        deployer.address,
        "Test Validator",
        "Test validator for unit tests",
        [0, 1, 2, 3]
      );
      
      await fundManager.connect(user1).mintAssetWithPayment(
        0,
        "ipfs://metadata-fee-test",
        "ipfs://agreement-fee-test",
        "fee-test-definition",
        "fee-test-configuration",
        validator1.address,
        mockERC20.address
      );
      
      // Check initial balances
      const initialFeeReceiverBalance = await mockERC20.balanceOf(feeReceiver.address);
      const initialServiceFeeBalance = await fundManager.serviceFeesBalance(mockERC20.address);
      expect(initialServiceFeeBalance).to.be.gt(0);
      
      // Withdraw fees
      await fundManager.connect(deployer).withdrawServiceFees(mockERC20.address);
      
      // Check final balances
      const finalFeeReceiverBalance = await mockERC20.balanceOf(feeReceiver.address);
      const finalServiceFeeBalance = await fundManager.serviceFeesBalance(mockERC20.address);
      
      expect(finalServiceFeeBalance).to.equal(0);
      expect(finalFeeReceiverBalance).to.equal(initialFeeReceiverBalance.add(initialServiceFeeBalance));
    });
  });
}); 
}); 