import { expect } from "chai";
import { ethers } from "hardhat";
import { deployContracts, deployMockToken, DeployedContracts } from "../helpers/deploy-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { FundManager, MockERC20 } from "../typechain-types";

describe("FundManager Contract", function() {
  let contracts: DeployedContracts;
  let fundManager: FundManager;
  let deployer: SignerWithAddress, admin: SignerWithAddress, 
      validator1: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress;
  let mockToken: MockERC20;
  let FEE_MANAGER_ROLE: string;
  
  before(async function() {
    // Deploy all contracts
    contracts = await deployContracts();
    fundManager = contracts.fundManager;
    deployer = contracts.deployer;
    admin = contracts.admin;
    validator1 = contracts.validator1;
    user1 = contracts.user1;
    user2 = contracts.user2;
    
    // Get role identifiers
    FEE_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FEE_MANAGER_ROLE"));
    
    // Deploy mock ERC20 token
    mockToken = await deployMockToken("Mock Token", "MOCK");
    
    // Whitelist token and set fees
    await fundManager.whitelistToken(mockToken.address, true);
    await fundManager.setServiceFee(
      mockToken.address, 
      ethers.utils.parseEther("100"), // Regular fee
      ethers.utils.parseEther("80")   // Validator fee
    );
    
    // Transfer tokens to users for testing
    await mockToken.transfer(user1.address, ethers.utils.parseEther("1000"));
    await mockToken.transfer(user2.address, ethers.utils.parseEther("1000"));
    await mockToken.transfer(validator1.address, ethers.utils.parseEther("1000"));
  });
  
  describe("Initialization", function() {
    it("should initialize with correct parameters", async function() {
      expect(await fundManager.commissionPercentageRegular()).to.equal(500); // 5%
      expect(await fundManager.commissionPercentageValidator()).to.equal(300); // 3%
      expect(await fundManager.feeReceiver()).to.equal(deployer.address);
      expect(await fundManager.validatorRegistry()).to.equal(contracts.validatorRegistry.address);
      expect(await fundManager.deedNFT()).to.equal(contracts.deedNFT.address);
    });
    
    it("should set the deployer as admin and fee manager", async function() {
      expect(await fundManager.hasRole(ethers.constants.DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await fundManager.hasRole(FEE_MANAGER_ROLE, deployer.address)).to.be.true;
    });
  });
  
  describe("Token Whitelisting", function() {
    it("should allow admin to whitelist tokens", async function() {
      const newToken = await deployMockToken("New Token", "NEW");
      
      await fundManager.whitelistToken(newToken.address, true);
      expect(await fundManager.isTokenWhitelisted(newToken.address)).to.be.true;
    });
    
    it("should allow admin to remove tokens from whitelist", async function() {
      const tempToken = await deployMockToken("Temp Token", "TEMP");
      
      // First whitelist
      await fundManager.whitelistToken(tempToken.address, true);
      expect(await fundManager.isTokenWhitelisted(tempToken.address)).to.be.true;
      
      // Then remove from whitelist
      await fundManager.whitelistToken(tempToken.address, false);
      expect(await fundManager.isTokenWhitelisted(tempToken.address)).to.be.false;
    });
    
    it("should prevent non-admin from whitelisting tokens", async function() {
      const nonAdminToken = await deployMockToken("Non-Admin Token", "NAT");
      
      await expect(
        fundManager.connect(user1).whitelistToken(nonAdminToken.address, true)
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Service Fee Management", function() {
    it("should allow fee manager to set service fees", async function() {
      const newToken = await deployMockToken("Fee Token", "FEE");
      await fundManager.whitelistToken(newToken.address, true);
      
      const regularFee = ethers.utils.parseEther("150");
      const validatorFee = ethers.utils.parseEther("120");
      
      await fundManager.setServiceFee(newToken.address, regularFee, validatorFee);
      
      expect(await fundManager.getServiceFee(newToken.address, false)).to.equal(regularFee);
      expect(await fundManager.getServiceFee(newToken.address, true)).to.equal(validatorFee);
    });
    
    it("should prevent setting fees for non-whitelisted tokens", async function() {
      const nonWhitelistedToken = await deployMockToken("Non-Whitelisted", "NWT");
      
      await expect(
        fundManager.setServiceFee(
          nonWhitelistedToken.address,
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("80")
        )
      ).to.be.revertedWith("FundManager: Token not whitelisted");
    });
    
    it("should prevent non-fee managers from setting fees", async function() {
      await expect(
        fundManager.connect(user1).setServiceFee(
          mockToken.address,
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("80")
        )
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Commission Percentage Management", function() {
    it("should allow admin to update commission percentages", async function() {
      // Update commission percentages
      await fundManager.updateCommissionPercentages(600, 400); // 6% and 4%
      
      expect(await fundManager.getCommissionPercentage(false)).to.equal(600);
      expect(await fundManager.getCommissionPercentage(true)).to.equal(400);
      
      // Reset to original values for other tests
      await fundManager.updateCommissionPercentages(500, 300);
    });
    
    it("should prevent setting commission percentages above 100%", async function() {
      await expect(
        fundManager.updateCommissionPercentages(10001, 300)
      ).to.be.revertedWith("FundManager: Commission percentage cannot exceed 100%");
      
      await expect(
        fundManager.updateCommissionPercentages(500, 10001)
      ).to.be.revertedWith("FundManager: Commission percentage cannot exceed 100%");
    });
  });
  
  describe("Fee Receiver Management", function() {
    it("should allow admin to update fee receiver", async function() {
      await fundManager.updateFeeReceiver(admin.address);
      expect(await fundManager.feeReceiver()).to.equal(admin.address);
      
      // Reset to original value
      await fundManager.updateFeeReceiver(deployer.address);
    });
    
    it("should prevent setting fee receiver to zero address", async function() {
      await expect(
        fundManager.updateFeeReceiver(ethers.constants.AddressZero)
      ).to.be.revertedWith("FundManager: Fee receiver cannot be zero address");
    });
  });
  
  describe("Minting DeedNFT with Fees", function() {
    it("should mint a deed and handle fees correctly", async function() {
      // First, approve tokens for FundManager
      await mockToken.connect(user1).approve(
        fundManager.address, 
        ethers.utils.parseEther("1000")
      );
      
      // Prepare mint data
      const assetType = 0; // Land
      const ipfsDetailsHash = "ipfs://details1";
      const operatingAgreement = "ipfs://agreements/default.json";
      const definition = "test definition";
      const configuration = "test config";
      const validatorContract = contracts.validator.address;
      const token = mockToken.address;
      const ipfsTokenURI = "ipfs://token1";
      
      // Get balances before mint
      const userBalanceBefore = await mockToken.balanceOf(user1.address);
      const serviceFeeBalanceBefore = await fundManager.getServiceFeesBalance(token);
      
      // Get validator owner
      const validatorOwner = await contracts.validatorRegistry.getValidatorOwner(validatorContract);
      const commissionBalanceBefore = await fundManager.getCommissionBalance(validatorOwner, token);
      
      // Mint the deed
      const tx = await fundManager.connect(user1).mintDeedNFT(
        assetType,
        ipfsDetailsHash,
        operatingAgreement,
        definition,
        configuration,
        validatorContract,
        token,
        ipfsTokenURI
      );
      
      // Wait for transaction
      const receipt = await tx.wait();
      
      // Find the DeedNFTMinted event
      const mintEvent = receipt.events?.find(e => e.event === "DeedNFTMinted");
      expect(mintEvent).to.not.be.undefined;
      const deedId = mintEvent?.args?.deedId;
      
      // Check deed ownership
      expect(await contracts.deedNFT.ownerOf(deedId)).to.equal(user1.address);
      
      // Check balances after mint
      const userBalanceAfter = await mockToken.balanceOf(user1.address);
      const serviceFeeBalanceAfter = await fundManager.getServiceFeesBalance(token);
      const commissionBalanceAfter = await fundManager.getCommissionBalance(validatorOwner, token);
      
      // Regular fee should be deducted from user
      const regularFee = await fundManager.getServiceFee(token, false);
      expect(userBalanceBefore.sub(userBalanceAfter)).to.equal(regularFee);
      
      // Service fee balance should increase
      expect(serviceFeeBalanceAfter.sub(serviceFeeBalanceBefore)).to.equal(regularFee);
      
      // Commission should be allocated to validator owner
      const commissionPercentage = await fundManager.getCommissionPercentage(false);
      const expectedCommission = regularFee.mul(commissionPercentage).div(10000);
      expect(commissionBalanceAfter.sub(commissionBalanceBefore)).to.equal(expectedCommission);
    });
    
    it("should apply validator fee discount when validator mints", async function() {
      // Grant validator role to validator1
      const VALIDATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("VALIDATOR_ROLE"));
      await contracts.deedNFT.grantRole(VALIDATOR_ROLE, validator1.address);
      
      // Approve tokens for FundManager
      await mockToken.connect(validator1).approve(
        fundManager.address, 
        ethers.utils.parseEther("1000")
      );
      
      // Get balances before mint
      const validatorBalanceBefore = await mockToken.balanceOf(validator1.address);
      
      // Mint the deed as validator
      const tx = await fundManager.connect(validator1).mintDeedNFT(
        0, // Land
        "ipfs://validator-details",
        "ipfs://agreements/default.json",
        "validator definition",
        "validator config",
        contracts.validator.address,
        mockToken.address,
        "ipfs://validator-token"
      );
      
      // Wait for transaction
      const receipt = await tx.wait();
      
      // Check balances after mint
      const validatorBalanceAfter = await mockToken.balanceOf(validator1.address);
      
      // Validator fee should be deducted
      const validatorFee = await fundManager.getServiceFee(mockToken.address, true);
      expect(validatorBalanceBefore.sub(validatorBalanceAfter)).to.equal(validatorFee);
      
      // Validator fee should be less than regular fee
      const regularFee = await fundManager.getServiceFee(mockToken.address, false);
      expect(validatorFee).to.be.lt(regularFee);
    });
  });
  
  describe("Fee Withdrawal", function() {
    it("should allow admin to withdraw service fees", async function() {
      // First, mint a deed to generate some fees
      await mockToken.connect(user2).approve(
        fundManager.address, 
        ethers.utils.parseEther("1000")
      );
      
      await fundManager.connect(user2).mintDeedNFT(
        0, // Land
        "ipfs://details4",
        "ipfs://agreements/default.json",
        "test definition",
        "test config",
        contracts.validator.address,
        mockToken.address,
        "ipfs://token4"
      );
      
      // Get balances before withdrawal
      const feeReceiverBalanceBefore = await mockToken.balanceOf(deployer.address);
      const serviceFeeBalance = await fundManager.getServiceFeesBalance(mockToken.address);
      
      // Withdraw fees
      await fundManager.withdrawServiceFees(mockToken.address);
      
      // Check balances after withdrawal
      const feeReceiverBalanceAfter = await mockToken.balanceOf(deployer.address);
      const serviceFeeBalanceAfter = await fundManager.getServiceFeesBalance(mockToken.address);
      
      // Fee receiver should have received the fees
      expect(feeReceiverBalanceAfter.sub(feeReceiverBalanceBefore)).to.equal(serviceFeeBalance);
      
      // Service fee balance should be zero
      expect(serviceFeeBalanceAfter).to.equal(0);
    });
    
    it("should allow validator to withdraw commission", async function() {
      // Get validator owner
      const validatorOwner = await contracts.validatorRegistry.getValidatorOwner(contracts.validator.address);
      
      // Get balances before withdrawal
      const validatorOwnerBalanceBefore = await mockToken.balanceOf(validatorOwner);
      const commissionBalance = await fundManager.getCommissionBalance(validatorOwner, mockToken.address);
      
      // Withdraw commission
      await fundManager.connect(deployer).withdrawCommission(mockToken.address);
      
      // Check balances after withdrawal
      const validatorOwnerBalanceAfter = await mockToken.balanceOf(validatorOwner);
      const commissionBalanceAfter = await fundManager.getCommissionBalance(validatorOwner, mockToken.address);
      
      // Validator owner should have received the commission
      expect(validatorOwnerBalanceAfter.sub(validatorOwnerBalanceBefore)).to.equal(commissionBalance);
      
      // Commission balance should be zero
      expect(commissionBalanceAfter).to.equal(0);
    });
    
    it("should prevent withdrawal when no fees are available", async function() {
      // Try to withdraw again after balance is zero
      await expect(
        fundManager.withdrawServiceFees(mockToken.address)
      ).to.be.revertedWith("FundManager: No service fees to withdraw");
      
      // Try to withdraw commission again after balance is zero
      await expect(
        fundManager.connect(deployer).withdrawCommission(mockToken.address)
      ).to.be.revertedWith("FundManager: No commissions to withdraw");
    });
  });
}); 