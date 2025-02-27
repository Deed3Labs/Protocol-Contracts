const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployContracts } = require("../helpers/deploy-helpers");

describe("FundManager Contract", function() {
  let contracts;
  let deployer, admin, validator1, user1;
  let mockToken;
  
  before(async function() {
    // Deploy all contracts
    const deployment = await deployContracts();
    contracts = deployment;
    deployer = contracts.deployer;
    admin = contracts.admin;
    validator1 = contracts.validator1;
    user1 = contracts.user1;
    
    // Deploy a mock ERC20 token for testing
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock Token", "MOCK", ethers.utils.parseEther("1000000"));
    await mockToken.deployed();
    
    // Transfer tokens to test users
    await mockToken.transfer(user1.address, ethers.utils.parseEther("10000"));
    await mockToken.transfer(validator1.address, ethers.utils.parseEther("10000"));
    
    // Whitelist token in FundManager
    await contracts.fundManager.whitelistToken(mockToken.address, true);
    
    // Set service fees
    await contracts.fundManager.setServiceFee(
      mockToken.address, 
      ethers.utils.parseEther("100"), // Regular fee
      ethers.utils.parseEther("50")   // Validator fee
    );
    
    // Set commission percentages
    await contracts.fundManager.setCommissionPercentage(500, 300); // 5% for regular, 3% for validators
    
    // Set fee receiver
    await contracts.fundManager.setFeeReceiver(admin.address);
  });
  
  describe("Token Management", function() {
    it("should correctly whitelist tokens", async function() {
      expect(await contracts.fundManager.isWhitelisted(mockToken.address)).to.be.true;
      
      // Test removing from whitelist
      await contracts.fundManager.whitelistToken(mockToken.address, false);
      expect(await contracts.fundManager.isWhitelisted(mockToken.address)).to.be.false;
      
      // Add back to whitelist for further tests
      await contracts.fundManager.whitelistToken(mockToken.address, true);
    });
  });
  
  describe("Fee Management", function() {
    it("should correctly set and retrieve service fees", async function() {
      expect(await contracts.fundManager.serviceFeeRegular(mockToken.address))
        .to.equal(ethers.utils.parseEther("100"));
      
      expect(await contracts.fundManager.serviceFeeValidator(mockToken.address))
        .to.equal(ethers.utils.parseEther("50"));
    });
    
    it("should correctly set and retrieve commission percentages", async function() {
      expect(await contracts.fundManager.commissionPercentageRegular()).to.equal(500);
      expect(await contracts.fundManager.commissionPercentageValidator()).to.equal(300);
    });
  });
  
  describe("Minting DeedNFT with Fees", function() {
    it("should mint a deed and handle fees correctly", async function() {
      // First, approve tokens for FundManager
      await mockToken.connect(user1).approve(
        contracts.fundManager.address, 
        ethers.utils.parseEther("1000")
      );
      
      // Prepare mint data
      const deedData = {
        assetType: 0, // Land
        ipfsDetailsHash: "ipfs://details1",
        operatingAgreement: "ipfs://agreement1",
        definition: "test definition",
        configuration: "test config",
        token: mockToken.address,
        validatorContract: contracts.validator.address
      };
      
      // Mint a deed
      const tx = await contracts.fundManager.connect(user1).mintDeedNFT(deedData);
      const receipt = await tx.wait();
      
      // Check that fees were correctly collected
      const depositEvent = receipt.events.find(e => e.event === "FundsDeposited");
      expect(depositEvent).to.not.be.undefined;
      
      // Check accumulated fees
      const serviceFeesBalance = await contracts.fundManager.serviceFeesBalance(mockToken.address);
      expect(serviceFeesBalance).to.equal(ethers.utils.parseEther("100"));
      
      // Validator owner's commission
      const validatorOwner = await contracts.validatorRegistry.getValidatorOwner(
        contracts.validator.address
      );
      const commission = await contracts.fundManager.commissionBalances(
        validatorOwner,
        mockToken.address
      );
      expect(commission).to.equal(ethers.utils.parseEther("5")); // 5% of 100
    });
    
    it("should allow validator to withdraw commission", async function() {
      // Get validator owner
      const validatorOwner = await contracts.validatorRegistry.getValidatorOwner(
        contracts.validator.address
      );
      
      // Validator owner withdraws commission
      const balanceBefore = await mockToken.balanceOf(validatorOwner);
      await contracts.fundManager.connect(ethers.provider.getSigner(validatorOwner))
        .withdrawCommission(mockToken.address);
      const balanceAfter = await mockToken.balanceOf(validatorOwner);
      
      // Should have received 5 tokens commission
      expect(balanceAfter.sub(balanceBefore)).to.equal(ethers.utils.parseEther("5"));
    });
    
    it("should allow admin to withdraw service fees", async function() {
      const balanceBefore = await mockToken.balanceOf(admin.address);
      await contracts.fundManager.connect(deployer).withdrawServiceFees(mockToken.address);
      const balanceAfter = await mockToken.balanceOf(admin.address);
      
      // Should have received 95 tokens (100 - 5 commission)
      expect(balanceAfter.sub(balanceBefore)).to.equal(ethers.utils.parseEther("95"));
    });
  });
}); 