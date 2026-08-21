import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const ONE_YEAR = 365 * 24 * 60 * 60;
const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const SAVINGS_BACKED = 1;

describe("ClearUSDUpgradeable", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let clrusd: any, registry: any, revolving: any;
  let coop: any, other: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, other] = [signers[8], signers[9]];

    const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
    clrusd = await upgrades.deployProxy(
      ClearUSD,
      ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
      {
        kind: "uups",
        // The contract adds no state that needs initializing: an unset encumbrance source means
        // unrestricted, which is the correct state for a token nothing is wired to yet. So it
        // inherits the base initializer rather than defining one that would only forward.
        unsafeAllow: ["missing-initializer", "missing-initializer-call"],
      }
    );
    await clrusd.grantRole(await clrusd.MINTER_ROLE(), ctx.admin.address);
    await clrusd.grantRole(await clrusd.BURNER_ROLE(), ctx.admin.address);

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    revolving = await RevolvingIssuer.deploy();
    await revolving.initialize(await ctx.stableCredit.getAddress(), coop.address);
    await ctx.networkRegistry.registerIssuer(
      await revolving.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await ctx.access.grantOperator(await revolving.getAddress());
    await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);
    await revolving.connect(ctx.operator).addTier(SAVINGS, 0n, CYCLE);

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );
    await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
    await registry.setClrusdKind(SAVINGS);
    await clrusd.setEncumbranceSource(await registry.getAddress());

    await clrusd.mint(ctx.member.address, 1_000n * ONE_USDC);
    await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
    await revolving
      .connect(ctx.operator)
      .openLine(ctx.member.address, [1_000n * ONE_USDC], ONE_YEAR, CYCLE);
  });

  async function spend(amount: bigint) {
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount);
  }

  describe("what it is", function () {
    it("keeps six decimals, so the reserve is exact rather than nearly exact", async function () {
      // Fully reserved one-for-one against USDC, which has six. Equal decimals make minting and
      // redeeming an identity, so `CLRUSD supply == USDC reserved` needs no rounding to hold.
      expect(await clrusd.decimals()).to.equal(6);
      expect(await ctx.usdc.decimals()).to.equal(6);
      expect(await ctx.stableCredit.decimals()).to.equal(6);
    });

    it("is upgradeable, which the token it replaces was not", async function () {
      const before = await clrusd.getAddress();
      const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
      const upgraded = await upgrades.upgradeProxy(before, ClearUSD, { unsafeAllow: ["missing-initializer", "missing-initializer-call"] });

      expect(await upgraded.getAddress()).to.equal(before);
      expect(await upgraded.balanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);
      expect(await upgraded.decimals()).to.equal(6);
    });

    it("still looks like a CCIP burn-and-mint token", async function () {
      // The bridge keeps working because the base is Chainlink's own, not a hand-rolled one.
      expect(await clrusd.getCCIPAdmin()).to.equal(ctx.admin.address);
      expect(await clrusd.MINTER_ROLE()).to.not.equal(ethers.ZeroHash);
      expect(await clrusd.BURNER_ROLE()).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("the redemption lock", function () {
    it("lets a member move what they have not drawn against", async function () {
      expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);
      await clrusd.connect(ctx.member).transfer(other.address, 400n * ONE_USDC);
      expect(await clrusd.balanceOf(other.address)).to.equal(400n * ONE_USDC);
    });

    it("locks what is standing behind drawn credit", async function () {
      await spend(600n * ONE_USDC);

      expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(400n * ONE_USDC);
      await clrusd.connect(ctx.member).transfer(other.address, 400n * ONE_USDC);
      await expect(clrusd.connect(ctx.member).transfer(other.address, 1n))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
    });

    it("closes redemption once nothing is withdrawable", async function () {
      // There is no pay-back date and no pay button. The lock is the enforcement.
      await spend(1_000n * ONE_USDC);
      expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(0n);

      await clrusd.connect(ctx.member).approve(ctx.admin.address, 1_000n * ONE_USDC);
      await expect(clrusd["burn(address,uint256)"](ctx.member.address, 1n))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
    });

    it("frees the lock as the credit is repaid", async function () {
      await spend(1_000n * ONE_USDC);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 600n * ONE_USDC);

      expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(600n * ONE_USDC);
      await clrusd.connect(ctx.member).transfer(other.address, 600n * ONE_USDC);
    });

    it("does not lock a holder who has drawn nothing", async function () {
      await clrusd.mint(other.address, 500n * ONE_USDC);
      await clrusd.connect(other).transfer(ctx.member.address, 500n * ONE_USDC);
      expect(await clrusd.balanceOf(ctx.member.address)).to.equal(1_500n * ONE_USDC);
    });

    it("still mints to an encumbered holder", async function () {
      // Minting has no sender to encumber, and adding savings is how a member frees themselves.
      await spend(1_000n * ONE_USDC);
      await clrusd.mint(ctx.member.address, 500n * ONE_USDC);

      expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(500n * ONE_USDC);
    });

    it("does not freeze every holder when the source breaks", async function () {
      const Reverting = await ethers.getContractFactory("RevertingEncumbranceSource");
      const broken = await Reverting.deploy();
      await clrusd.setEncumbranceSource(await broken.getAddress());

      await spend(1_000n * ONE_USDC);
      await clrusd.connect(ctx.member).transfer(other.address, 1_000n * ONE_USDC);
    });

    it("only lets an admin change the source", async function () {
      await expect(clrusd.connect(other).setEncumbranceSource(other.address)).to.be.reverted;
    });
  });
});
