import { expect } from "chai";
import { ethers } from "hardhat";
import { AssuranceOracle } from "../../typechain-types";

describe("AssuranceOracle", function () {
  let assuranceOracle: AssuranceOracle;
  let owner: any;
  let user: any;

  // Test addresses (Base Sepolia)
  const UNISWAP_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
  const WETH = "0x4200000000000000000000000000000000000006";
  const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const AssuranceOracleFactory = await ethers.getContractFactory("AssuranceOracle");
    assuranceOracle = await AssuranceOracleFactory.deploy(
      ethers.ZeroAddress, // Mock AssurancePool address
      ethers.parseEther("1.0"), // 100% target RTD
      UNISWAP_FACTORY,
      WETH
    );
  });

  describe("Deployment", function () {
    it("Should set the correct initial values", async function () {
      expect(await assuranceOracle.targetRTD()).to.equal(ethers.parseEther("1.0"));
      expect(await assuranceOracle.uniswapFactory()).to.equal(UNISWAP_FACTORY);
      expect(await assuranceOracle.WETH()).to.equal(WETH);
    });

    it("Should set the correct owner", async function () {
      expect(await assuranceOracle.owner()).to.equal(owner.address);
    });
  });

  describe("Quote Function", function () {
    it("Should reject reserve token deposits", async function () {
      const amount = ethers.parseUnits("1000", 6); // 1000 USDC
      await expect(assuranceOracle.quote(USDC, USDC, amount))
        .to.be.revertedWith("Cannot deposit reserve token");
    });

    it("Should handle USDC to different reserve token conversion", async function () {
      const depositAmount = ethers.parseUnits("1000", 6); // 1000 USDC
      const reserveToken = "0x1234567890123456789012345678901234567890"; // Mock reserve token
      const quote = await assuranceOracle.quote(USDC, reserveToken, depositAmount);
      
      // Should be approximately 1000 reserve tokens (1:1 for stablecoins)
      const expectedAmount = ethers.parseUnits("1000", 6);
      const tolerance = ethers.parseUnits("1", 6); // 1 token tolerance
      
      expect(quote).to.be.closeTo(expectedAmount, tolerance);
    });
  });

  describe("Price Functions", function () {
    it("Should return 1 USD for USDC", async function () {
      const price = await assuranceOracle.getTokenPriceInUSDC(USDC);
      expect(price).to.equal(ethers.parseEther("1.0")); // 1 USD in 18 decimals
    });

    it("Should return 1:1 ratio for same tokens", async function () {
      const ratio = await assuranceOracle.getPriceRatio(USDC, USDC);
      expect(ratio).to.equal(ethers.parseEther("1.0"));
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to set target RTD", async function () {
      const newTargetRTD = ethers.parseEther("1.5");
      await expect(assuranceOracle.setTargetRTD(newTargetRTD))
        .to.emit(assuranceOracle, "TargetRTDUpdated")
        .withArgs(newTargetRTD);
      
      expect(await assuranceOracle.targetRTD()).to.equal(newTargetRTD);
    });

    it("Should not allow non-owner to set target RTD", async function () {
      const newTargetRTD = ethers.parseEther("1.5");
      await expect(
        assuranceOracle.connect(user).setTargetRTD(newTargetRTD)
      ).to.be.revertedWithCustomError(assuranceOracle, "OwnableUnauthorizedAccount");
    });
  });

  describe("Token Validation", function () {
    it("Should identify whitelisted tokens", async function () {
      expect(await assuranceOracle.isTokenWhitelisted(USDC)).to.be.true;
      expect(await assuranceOracle.isTokenWhitelisted(USDT)).to.be.true;
      expect(await assuranceOracle.isTokenWhitelisted(DAI)).to.be.true;
    });

    it("Should check if token can be deposited", async function () {
      // USDC should be depositable (whitelisted and not reserve token in this test)
      expect(await assuranceOracle.canDepositToken(USDC)).to.be.true;
    });

    it("Should reject non-whitelisted tokens", async function () {
      const nonWhitelistedToken = "0x1234567890123456789012345678901234567890";
      expect(await assuranceOracle.isTokenWhitelisted(nonWhitelistedToken)).to.be.false;
      expect(await assuranceOracle.canDepositToken(nonWhitelistedToken)).to.be.false;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero amount", async function () {
      const reserveToken = "0x1234567890123456789012345678901234567890";
      const quote = await assuranceOracle.quote(USDC, reserveToken, 0);
      expect(quote).to.equal(0);
    });

    it("Should handle very small amounts", async function () {
      const smallAmount = 1; // 1 wei
      const reserveToken = "0x1234567890123456789012345678901234567890";
      const quote = await assuranceOracle.quote(USDC, reserveToken, smallAmount);
      expect(quote).to.equal(smallAmount);
    });
  });
});
