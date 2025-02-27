import { expect } from "chai";
import { ethers } from "hardhat";
import { deployContracts, deployMockToken } from "../helpers/deploy-helpers";

describe("End-to-End Integration", function() {
  it("should perform a complete lifecycle: mint, validate, fractionalize", async function() {
    // Deploy all contracts
    const contracts = await deployContracts();
    const {
      deedNFT, fundManager, validator, validatorRegistry,
      fractionalize, user1, validator1, deployer
    } = contracts;
    
    // Deploy mock token
    const mockToken = await deployMockToken("Test Token", "TEST");
    
    // Setup token in FundManager
    await fundManager.whitelistToken(mockToken.address, true);
    await fundManager.setServiceFee(
      mockToken.address,
      ethers.utils.parseEther("100"),
      ethers.utils.parseEther("80")
    );
    
    // Transfer tokens to user
    await mockToken.transfer(user1.address, ethers.utils.parseEther("1000"));
    
    // User approves tokens for FundManager
    await mockToken.connect(user1).approve(
      fundManager.address,
      ethers.utils.parseEther("500")
    );
    
    // Mint a deed
    const tx = await fundManager.connect(user1).mintDeedNFT(
      0, // Land
      "ipfs://land1",
      "ipfs://agreement1",
      "valuable land",
      "rectangular plot",
      validator.address,
      mockToken.address,
      "ipfs://token1"
    );
    
    const receipt = await tx.wait();
    const deedId = receipt.events?.find(e => e.event === "DeedNFTMinted")?.args?.deedId;
    
    // Verify the deed exists and user1 is the owner
    expect(await deedNFT.ownerOf(deedId)).to.equal(user1.address);
    
    // Get deed info
    const deedInfo = await deedNFT.getDeedInfo(deedId);
    expect(deedInfo.assetType).to.equal(0); // Land
    
    // Approve for fractionalization
    await deedNFT.connect(user1).approve(fractionalize.address, deedId);
    
    // Fractionalize the deed
    await fractionalize.connect(user1).fractionalizeAsset(
      deedId,
      "Fractional Land",
      "FLAND",
      ethers.utils.parseEther("1000"), // 1000 fractions
      ethers.utils.parseEther("1"),   // 1 ETH per fraction
      "ipfs://fractions-metadata"
    );
    
    // Check that fractionalize contract owns the deed now
    expect(await deedNFT.ownerOf(deedId)).to.equal(fractionalize.address);
    
    // Get fraction token address
    const fractionAddress = await fractionalize.deedToFraction(deedId);
    expect(fractionAddress).to.not.equal(ethers.constants.AddressZero);
    
    // Check user1 received the fractions
    const fractionToken = await ethers.getContractAt("ERC20", fractionAddress);
    expect(await fractionToken.balanceOf(user1.address)).to.equal(
      ethers.utils.parseEther("1000")
    );
  });
}); 