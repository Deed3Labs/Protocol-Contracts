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
    
    // Deploy mock token - use 'any' type to avoid TypeScript errors with contract methods
    const mockToken: any = await deployMockToken("Test Token", "TEST");
    
    // Setup token in FundManager
    await fundManager.whitelistToken(await mockToken.getAddress(), true);
    await fundManager.setServiceFee(
      await mockToken.getAddress(),
      ethers.parseEther("100"),
      ethers.parseEther("80")
    );
    
    // Transfer tokens to user
    await mockToken.transfer(user1.address, ethers.parseEther("1000"));
    
    // User approves tokens for FundManager
    await mockToken.connect(user1).approve(
      await fundManager.getAddress(),
      ethers.parseEther("500")
    );
    
    // Mint a deed
    const tx = await fundManager.connect(user1).mintDeedNFT(
      0, // Land
      "ipfs://land1",
      "ipfs://agreement1",
      "valuable land",
      "rectangular plot",
      await validator.getAddress(),
      await mockToken.getAddress(),
      "ipfs://token1"
    );
    
    const receipt = await tx.wait();
    const deedId = receipt.events?.find((e: { event: string }) => e.event === "DeedNFTMinted")?.args?.deedId;
    
    // Verify the deed exists and user1 is the owner
    expect(await deedNFT.ownerOf(deedId)).to.equal(user1.address);
    
    // Get deed info
    const deedInfo = await deedNFT.getDeedInfo(deedId);
    expect(deedInfo.assetType).to.equal(0); // Land
    
    // Approve for fractionalization
    await deedNFT.connect(user1).approve(await fractionalize.getAddress(), deedId);
    
    // Fractionalize the deed
    await fractionalize.connect(user1).fractionalizeAsset(
      deedId,
      "Fractional Land",
      "FLAND",
      ethers.parseEther("1000"), // 1000 fractions
      ethers.parseEther("1"),   // 1 ETH per fraction
      "ipfs://fractions-metadata"
    );
    
    // Check that fractionalize contract owns the deed now
    expect(await deedNFT.ownerOf(deedId)).to.equal(await fractionalize.getAddress());
    
    // Get fraction token address
    const fractionAddress = await fractionalize.deedToFraction(deedId);
    expect(fractionAddress).to.not.equal(ethers.ZeroAddress);
    
    // Check user1 received the fractions
    const fractionToken = await ethers.getContractAt("ERC20", fractionAddress);
    expect(await fractionToken.balanceOf(user1.address)).to.equal(
      ethers.parseEther("1000")
    );
  });
}); 