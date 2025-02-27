const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployContracts } = require("../helpers/deploy-helpers");

describe("Fractionalize Contract", function() {
  let contracts;
  let deployer, user1, user2;
  let deedId;
  
  before(async function() {
    // Deploy all contracts
    const deployment = await deployContracts();
    contracts = deployment;
    deployer = contracts.deployer;
    user1 = contracts.user1;
    user2 = contracts.user2;
    
    // Mint a deed for testing
    await contracts.deedNFT.connect(deployer).setFundManager(deployer.address);
    const tx = await contracts.deedNFT.mintAsset(
      user1.address,
      0, // AssetType.Land
      "ipfs://fractionalizeTest",
      "ipfs://agreement",
      "definition",
      "configuration"
    );
    const receipt = await tx.wait();
    const mintEvent = receipt.events.find(e => e.event === "DeedNFTMinted");
    deedId = mintEvent.args.deedId;
    
    // Approve Fractionalize contract to transfer the NFT
    await contracts.deedNFT.connect(user1).approve(contracts.fractionalize.address, deedId);
  });
  
  describe("Fraction Creation", function() {
    it("should create a fraction collection from a DeedNFT", async function() {
      const fractionParams = {
        assetType: 0, // FractionAssetType.DeedNFT
        originalTokenId: deedId,
        name: "Fractional Land",
        description: "Fractionalized ownership of land deed",
        symbol: "FLAND",
        collectionUri: "ipfs://fractionCollection",
        totalShares: 100,
        burnable: true,
        approvalPercentage: 7500 // 75%
      };
      
      const tx = await contracts.fractionalize.connect(user1).createFraction(fractionParams);
      const receipt = await tx.wait();
      
      // Check for creation event
      const creationEvent = receipt.events.find(e => e.event === "FractionCreated");
      expect(creationEvent).to.not.be.undefined;
      const fractionId = creationEvent.args.fractionId;
      
      // Verify fraction details
      const fractionInfo = await contracts.fractionalize.getFractionInfo(fractionId);
      expect(fractionInfo.name).to.equal("Fractional Land");
      expect(fractionInfo.symbol).to.equal("FLAND");
      expect(fractionInfo.totalShares).to.equal(100);
      
      // Verify the NFT was transferred to the Fractionalize contract
      expect(await contracts.deedNFT.ownerOf(deedId)).to.equal(contracts.fractionalize.address);
      
      // Verify the creator received the shares
      const shareBalance = await contracts.fractionalize.balanceOf(user1.address, fractionId);
      expect(shareBalance).to.equal(100);
    });
    
    it("should allow transferring shares", async function() {
      // Get the fractionId (should be 1)
      const fractionId = 1;
      
      // Transfer shares from user1 to user2
      await contracts.fractionalize.connect(user1).safeTransferFrom(
        user1.address,
        user2.address,
        fractionId,
        20, // Transfer 20 shares
        "0x" // No data
      );
      
      // Check balances
      expect(await contracts.fractionalize.balanceOf(user1.address, fractionId)).to.equal(80);
      expect(await contracts.fractionalize.balanceOf(user2.address, fractionId)).to.equal(20);
    });
    
    it("should allow unlocking with sufficient approval", async function() {
      // Get the fractionId
      const fractionId = 1;
      
      // Both users approve unlocking (80% approval, above the 75% threshold)
      await contracts.fractionalize.connect(user1).approveUnlock(fractionId);
      await contracts.fractionalize.connect(user2).approveUnlock(fractionId);
      
      // Check if unlockable
      expect(await contracts.fractionalize.canUnlock(fractionId)).to.be.true;
      
      // Unlock the NFT back to user1
      await contracts.fractionalize.connect(user1).unlockNFT(fractionId);
      
      // Verify the NFT was returned to user1
      expect(await contracts.deedNFT.ownerOf(deedId)).to.equal(user1.address);
      
      // Verify that shares were burned
      expect(await contracts.fractionalize.balanceOf(user1.address, fractionId)).to.equal(0);
      expect(await contracts.fractionalize.balanceOf(user2.address, fractionId)).to.equal(0);
    });
  });
}); 