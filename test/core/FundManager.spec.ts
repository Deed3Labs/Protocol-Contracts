import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Direct access to upgrades from hardhat runtime environment
const hre = require("hardhat");
const upgrades = hre.upgrades;

describe("FundManager Contract", function() {
  // Use 'any' type for contracts to avoid TypeScript errors
  let fundManager: any;
  let deedNFT: any;
  let validatorRegistry: any;
  let validator: any;
  let mockERC20: any;
  let deployer: SignerWithAddress;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeReceiver: SignerWithAddress;
  let FEE_MANAGER_ROLE: string;
  
  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, admin, user1, user2, feeReceiver] = [
      signers[0], signers[1], signers[2], signers[3], signers[4]
    ];
    
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
    
    // Update Validator with DeedNFT address
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
    
    // Setup for testing
    FEE_MANAGER_ROLE = await fundManager.FEE_MANAGER_ROLE();
    
    // Grant roles
    await fundManager.grantRole(FEE_MANAGER_ROLE, admin.address);
    
    // Register validator
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      "Test Validator",
      "A validator for testing",
      [0, 1, 2, 3] // All asset types
    );
    
    // Grant minter role to FundManager
    const MINTER_ROLE = await deedNFT.MINTER_ROLE();
    await deedNFT.grantRole(MINTER_ROLE, await fundManager.getAddress());
  });
  
  describe("Initialization", function() {
    it("should initialize with correct values", async function() {
      expect(await fundManager.deedNFT()).to.equal(await deedNFT.getAddress());
      expect(await fundManager.validatorRegistry()).to.equal(await validatorRegistry.getAddress());
      expect(await fundManager.commissionPercentage()).to.equal(1000); // 10%
      expect(await fundManager.feeReceiver()).to.equal(feeReceiver.address);
    });
    
    it("should set up roles correctly", async function() {
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, admin.address)).to.be.true;
    });
  });
  
  describe("Creating Deeds with ETH", function() {
    it("should create a deed and collect fees in ETH", async function() {
      const initialBalance = await ethers.provider.getBalance(feeReceiver.address);
      
      // Set a creation fee
      await fundManager.connect(admin).setCreationFee(ethers.parseEther("0.01"));
      
      // Create a deed with ETH payment
      const tx = await fundManager.connect(user1).createDeed(
        0, // AssetType.Land
        "ipfs://metadata1",
        "ipfs://agreement1",
        await validator.getAddress(),
        { value: ethers.parseEther("0.01") }
      );
      
      const receipt = await tx.wait();
      
      // Check fee receiver balance increased
      const newBalance = await ethers.provider.getBalance(feeReceiver.address);
      expect(newBalance).to.be.gt(initialBalance);
      
      // Check the deed was created
      // Find transfer event to get the token ID
      const transferEvent = receipt.logs.find((log: any) => {
        try {
          const parsedLog = deedNFT.interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          return parsedLog?.name === "Transfer";
        } catch {
          return false;
        }
      });
      
      if (!transferEvent) {
        throw new Error("Transfer event not found");
      }
      
      const parsedEvent = deedNFT.interface.parseLog({
        topics: transferEvent.topics,
        data: transferEvent.data
      });
      
      if (!parsedEvent) {
        throw new Error("Failed to parse transfer event");
      }
      
      const tokenId = parsedEvent.args.tokenId;
      
      // Check the deed ownership
      expect(await deedNFT.ownerOf(tokenId)).to.equal(user1.address);
    });
  });
  
  describe("Creating Deeds with ERC20", function() {
    it("should create a deed and collect fees in ERC20", async function() {
      // Set a creation fee
      await fundManager.connect(admin).setCreationFee(ethers.parseEther("10"));
      
      // Set payment token
      await fundManager.connect(admin).setPaymentToken(await mockERC20.getAddress(), true);
      
      // Mint tokens to user
      await mockERC20.mint(user1.address, ethers.parseEther("100"));
      
      // Approve tokens for FundManager
      await mockERC20.connect(user1).approve(
        await fundManager.getAddress(), 
        ethers.parseEther("10")
      );
      
      // Create a deed with ERC20 payment
      const tx = await fundManager.connect(user1).createDeedWithERC20(
        0, // AssetType.Land
        "ipfs://metadata-erc20",
        "ipfs://agreement-erc20",
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      
      const receipt = await tx.wait();
      
      // Check the fee receiver received tokens
      expect(await mockERC20.balanceOf(feeReceiver.address)).to.equal(ethers.parseEther("10"));
      
      // Find transfer event to get the token ID
      const transferEvent = receipt.logs.find((log: any) => {
        try {
          const parsedLog = deedNFT.interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          return parsedLog?.name === "Transfer";
        } catch {
          return false;
        }
      });
      
      if (!transferEvent) {
        throw new Error("Transfer event not found");
      }
      
      const parsedEvent = deedNFT.interface.parseLog({
        topics: transferEvent.topics,
        data: transferEvent.data
      });
      
      if (!parsedEvent) {
        throw new Error("Failed to parse transfer event");
      }
      
      const tokenId = parsedEvent.args.tokenId;
      
      // Check the deed ownership
      expect(await deedNFT.ownerOf(tokenId)).to.equal(user1.address);
    });
  });
  
  describe("Fee Management", function() {
    it("should allow fee manager to withdraw accumulated fees", async function() {
      // Create a deed with ETH payment to accumulate fees
      await fundManager.connect(admin).setCreationFee(ethers.parseEther("0.01"));
      
      await fundManager.connect(user1).createDeed(
        0,
        "ipfs://metadata",
        "ipfs://agreement",
        await validator.getAddress(),
        { value: ethers.parseEther("0.01") }
      );
      
      // Check contract balance
      const contractBalance = await ethers.provider.getBalance(await fundManager.getAddress());
      expect(contractBalance).to.equal(ethers.parseEther("0.01"));
      
      // Withdraw fees
      await fundManager.connect(admin).withdrawServiceFees();
      
      // Check contract balance is zero
      const newContractBalance = await ethers.provider.getBalance(await fundManager.getAddress());
      expect(newContractBalance).to.equal(0);
    });
  });
}); 