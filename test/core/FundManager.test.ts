import { expect } from "chai";
import { ethers } from "hardhat";
import { deployContracts, deployMockToken, DeployedContracts } from "../helpers/deploy-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { FundManager, MockERC20 } from "../typechain-types";

describe("FundManager Contract", function() {
  let contracts: DeployedContracts;
  let fundManager: FundManager;
  let deployer: SignerWithAddress, admin: SignerWithAddress, 
      validator1: SignerWithAddress, user1: SignerWithAddress;
  let mockToken: MockERC20;
  
  before(async function() {
    // Deploy all contracts
    contracts = await deployContracts();
    fundManager = contracts.fundManager;
    deployer = contracts.deployer;
    admin = contracts.admin;
    validator1 = contracts.validator1;
    user1 = contracts.user1;
    
    // Deploy mock ERC20 token
    mockToken = await deployMockToken("Mock Token", "MOCK");
    
    // Whitelist token and set fees
    await fundManager.whitelistToken(mockToken.address, true);
    await fundManager.setServiceFee(
      mockToken.address, 
      ethers.utils.parseEther("100"), // Regular fee
      ethers.utils.parseEther("80")   // Validator fee
    );
    
    // Transfer tokens to user1 for testing
    await mockToken.transfer(user1.address, ethers.utils.parseEther("1000"));
  });
  
  describe("Initialization", function() {
    it("should initialize with correct parameters", async function() {
      expect(await fundManager.commissionPercentageRegular()).to.equal(500); // 5%
      expect(await fundManager.commissionPercentageValidator()).to.equal(300); // 3%
      expect(await fundManager.feeReceiver()).to.equal(deployer.address);
      expect(await fundManager.validatorRegistry()).to.equal(contracts.validatorRegistry.address);
      expect(await fundManager.deedNFT()).to.equal(contracts.deedNFT.address);
    });
  });
  
  describe("Token Management", function() {
    it("should correctly manage whitelisted tokens", async function() {
      expect(await fundManager.isWhitelisted(mockToken.address)).to.be.true;
      
      // Revoke whitelist
      await fundManager.whitelistToken(mockToken.address, false);
      expect(await fundManager.isWhitelisted(mockToken.address)).to.be.false;
      
      // Whitelist again for further tests
      await fundManager.whitelistToken(mockToken.address, true);
    });
    
    it("should not allow non-admins to whitelist tokens", async function() {
      await expect(
        fundManager.connect(user1).whitelistToken(mockToken.address, true)
      ).to.be.revertedWith("AccessControl");
    });
  });
  
  describe("Fee Management", function() {
    it("should correctly set and retrieve service fees", async function() {
      expect(await fundManager.serviceFeeRegular(mockToken.address)).to.equal(
        ethers.utils.parseEther("100")
      );
      expect(await fundManager.serviceFeeValidator(mockToken.address)).to.equal(
        ethers.utils.parseEther("80")
      );
      
      // Update fees
      await fundManager.setServiceFee(
        mockToken.address,
        ethers.utils.parseEther("120"),
        ethers.utils.parseEther("90")
      );
      
      expect(await fundManager.serviceFeeRegular(mockToken.address)).to.equal(
        ethers.utils.parseEther("120")
      );
      expect(await fundManager.serviceFeeValidator(mockToken.address)).to.equal(
        ethers.utils.parseEther("90")
      );
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
      const operatingAgreement = "ipfs://agreement1";
      const definition = "test definition";
      const configuration = "test config";
      const validatorContract = contracts.validator.address;
      const token = mockToken.address;
      const ipfsTokenURI = "ipfs://token1";
      
      // Get balances before mint
      const userBalanceBefore = await mockToken.balanceOf(user1.address);
      
      // Mint a deed
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
      
      const receipt = await tx.wait();
      
      // Check service fee transfer
      const userBalanceAfter = await mockToken.balanceOf(user1.address);
      expect(userBalanceBefore.sub(userBalanceAfter)).to.equal(
        ethers.utils.parseEther("120")
      );
      
      // Check accumulated fees
      const serviceFeesBalance = await fundManager.serviceFeesBalance(token);
      expect(serviceFeesBalance).to.equal(ethers.utils.parseEther("120"));
      
      // Validator owner's commission (5% of 120 = 6)
      const validatorOwner = await contracts.validatorRegistry.getValidatorOwner(
        validatorContract
      );
      const commission = await fundManager.commissionBalances(
        validatorOwner,
        token
      );
      expect(commission).to.equal(ethers.utils.parseEther("6")); // 5% of 120
    });
  });
  
  describe("Commission Withdrawal", function() {
    it("should allow validator owner to withdraw commission", async function() {
      const validatorOwner = await contracts.validatorRegistry.getValidatorOwner(
        contracts.validator.address
      );
      
      // Get balances before withdrawal
      const ownerBalanceBefore = await mockToken.balanceOf(validatorOwner);
      const commissionBefore = await fundManager.commissionBalances(
        validatorOwner,
        mockToken.address
      );
      
      // Withdraw commission
      await fundManager.connect(deployer).withdrawCommission(
        mockToken.address
      );
      
      // Check balances after withdrawal
      const ownerBalanceAfter = await mockToken.balanceOf(validatorOwner);
      const commissionAfter = await fundManager.commissionBalances(
        validatorOwner,
        mockToken.address
      );
      
      expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(commissionBefore);
      expect(commissionAfter).to.equal(0);
    });
  });
}); 