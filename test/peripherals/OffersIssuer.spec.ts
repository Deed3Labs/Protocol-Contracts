import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const OFFER = 10n * ONE_USDC;

/*
 * The co-op's $10 to a new member, on a capped line of its own.
 *
 * The line goes down by the offer and the member up, so nothing is funded in advance. The member
 * spends it at a shop like any credits; what they leave unspent comes back after the window; and the
 * Safe pays the line down with USDC up to the allowance it has given, which the ledger routes the way
 * it routes every repayment. The line is the co-op owing itself, so the AssurancePool does not
 * reserve against it.
 */
describe("OffersIssuer", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let offers: any, safe: any, shop: any, newcomer: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [safe, shop, newcomer] = [signers[8], signers[9], signers[10]];

    const OffersIssuer = await ethers.getContractFactory("OffersIssuer");
    offers = await OffersIssuer.deploy();
    await offers.initialize(await ctx.stableCredit.getAddress(), safe.address, OFFER, 90 * DAY);
    await ctx.networkRegistry.registerIssuer(
      await offers.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await offers.connect(ctx.operator).setCap(1_000n * ONE_USDC);
    await ctx.access.connect(ctx.operator).grantMember(shop.address);
  });

  async function elapse(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function safeAllows(amount: bigint) {
    await ctx.usdc.mint(safe.address, 1_000n * ONE_USDC);
    await ctx.usdc.connect(safe).approve(await offers.getAddress(), amount);
  }

  describe("giving the offer", function () {
    it("draws it from the line: the line owes it and the member holds it, nothing funded", async function () {
      await expect(offers.connect(ctx.operator).grant(newcomer.address))
        .to.emit(offers, "OfferGranted")
        .withArgs(newcomer.address, OFFER);

      expect(await ctx.stableCredit.balanceOf(newcomer.address)).to.equal(OFFER);
      expect(await offers.owed()).to.equal(OFFER);
      expect(await offers.unspentOf(newcomer.address)).to.equal(OFFER);
      expect(await offers.offersLeft()).to.equal(99n);
      // The member owes nothing for it, and their ceiling is untouched.
      expect(await ctx.stableCredit.creditBalanceOf(newcomer.address)).to.equal(0n);
      expect(await ctx.stableCredit.creditLimitOf(newcomer.address)).to.equal(0n);
    });

    it("gives each member one, ever", async function () {
      await offers.connect(ctx.operator).grant(newcomer.address);
      await expect(offers.connect(ctx.operator).grant(newcomer.address))
        .to.be.revertedWithCustomError(offers, "OffersIssuerAlreadyGranted")
        .withArgs(newcomer.address);
    });

    it("stops at the cap", async function () {
      await offers.connect(ctx.operator).setCap(20n * ONE_USDC);
      const signers = await ethers.getSigners();
      await offers.connect(ctx.operator).grant(signers[11].address);
      await offers.connect(ctx.operator).grant(signers[12].address);
      await expect(offers.connect(ctx.operator).grant(signers[13].address)).to.be.revertedWithCustomError(
        offers,
        "OffersIssuerOverCap"
      );
      expect(await offers.offersLeft()).to.equal(0n);
    });

    it("is the backend's call alone", async function () {
      await expect(offers.connect(ctx.outsider).grant(newcomer.address)).to.be.revertedWith(
        "CreditIssuer: Unauthorized caller"
      );
    });
  });

  describe("spending it", function () {
    it("counts a member's first spends against the offer", async function () {
      await offers.connect(ctx.operator).grant(newcomer.address);

      await expect(ctx.stableCredit.connect(newcomer).transfer(shop.address, 4n * ONE_USDC))
        .to.emit(offers, "OfferSpent")
        .withArgs(newcomer.address, 4n * ONE_USDC, 6n * ONE_USDC);

      expect(await ctx.stableCredit.balanceOf(shop.address)).to.equal(4n * ONE_USDC);
      expect(await offers.unspentOf(newcomer.address)).to.equal(6n * ONE_USDC);
      expect(await offers.totalUnspent()).to.equal(6n * ONE_USDC);
    });
  });

  describe("an offer left unspent", function () {
    beforeEach(async function () {
      await offers.connect(ctx.operator).grant(newcomer.address);
      await ctx.stableCredit.connect(newcomer).transfer(shop.address, 4n * ONE_USDC);
    });

    it("stays the member's until the window has passed", async function () {
      await expect(offers.expire(newcomer.address)).to.be.revertedWithCustomError(offers, "OffersIssuerNotExpired");
    });

    it("comes back off their balance and off the line once it has, at anyone's call", async function () {
      await elapse(90 * DAY + 1);

      await expect(offers.connect(ctx.outsider).expire(newcomer.address))
        .to.emit(offers, "OfferExpired")
        .withArgs(newcomer.address, 6n * ONE_USDC);

      expect(await ctx.stableCredit.balanceOf(newcomer.address)).to.equal(0n);
      // What the shop holds is still owed, and is all the line owes now.
      expect(await offers.owed()).to.equal(4n * ONE_USDC);
      expect(await offers.totalExpired()).to.equal(6n * ONE_USDC);
      expect(await offers.totalUnspent()).to.equal(0n);
      // Once is all.
      expect(await offers.expire.staticCall(newcomer.address)).to.equal(0n);
    });

    it("takes back only what the member still holds", async function () {
      // They moved the rest on before the window closed, so there is less on the shelf.
      await ctx.stableCredit.connect(newcomer).transfer(shop.address, 6n * ONE_USDC);
      await elapse(90 * DAY + 1);

      expect(await offers.expire.staticCall(newcomer.address)).to.equal(0n);
      expect(await offers.owed()).to.equal(OFFER);
    });
  });

  describe("paying the line down", function () {
    beforeEach(async function () {
      await offers.connect(ctx.operator).grant(newcomer.address);
      await ctx.stableCredit.connect(newcomer).transfer(shop.address, OFFER);
    });

    it("takes the Safe's USDC up to its allowance and repays the line", async function () {
      await safeAllows(100n * ONE_USDC);
      const reserveBefore = await ctx.assurancePool.reserveBalance();

      await expect(offers.connect(ctx.outsider).settle())
        .to.emit(offers, "LineSettled")
        .withArgs(OFFER, OFFER, 0n);

      expect(await offers.owed()).to.equal(0n);
      expect(await ctx.usdc.balanceOf(safe.address)).to.equal(1_000n * ONE_USDC - OFFER);
      // Routed as any repayment is: with no payout pool on this ledger, into loss absorption.
      expect(await ctx.assurancePool.reserveBalance()).to.equal(reserveBefore + OFFER);
      expect(await offers.totalSettled()).to.equal(OFFER);
    });

    it("pays down only as much as the allowance reaches", async function () {
      await safeAllows(4n * ONE_USDC);
      await offers.settle();
      expect(await offers.owed()).to.equal(6n * ONE_USDC);
      expect(await offers.treasuryAvailable()).to.equal(0n);
    });

    it("does nothing without an allowance", async function () {
      expect(await offers.settle.staticCall()).to.equal(0n);
      expect(await offers.owed()).to.equal(OFFER);
    });

    it("leaves an offer the line has already paid for with the member", async function () {
      // Granted, unspent, and the line paid down: that ten dollars is backed by cash now.
      const signers = await ethers.getSigners();
      const later = signers[11];
      await offers.connect(ctx.operator).grant(later.address);
      await safeAllows(100n * ONE_USDC);
      await offers.settle();
      await elapse(90 * DAY + 1);

      expect(await offers.expire.staticCall(later.address)).to.equal(0n);
      await offers.expire(later.address);
      expect(await ctx.stableCredit.balanceOf(later.address)).to.equal(OFFER);
    });
  });

  describe("who sets the cap and the terms", function () {
    it("is the owner (the Ops Safe) or an operator, and nobody else", async function () {
      await offers.transferOwnership(safe.address);
      await offers.connect(safe).setCap(2_000n * ONE_USDC);
      expect(await offers.cap()).to.equal(2_000n * ONE_USDC);
      await offers.connect(safe).setTerms(5n * ONE_USDC, 30 * DAY);
      expect(await offers.offerAmount()).to.equal(5n * ONE_USDC);
      // an operator still can, which is how the deployer opened the line
      await offers.connect(ctx.operator).setCap(1_500n * ONE_USDC);
      expect(await offers.cap()).to.equal(1_500n * ONE_USDC);
      await expect(offers.connect(ctx.outsider).setCap(1n)).to.be.revertedWith("CreditIssuer: Unauthorized caller");
      await expect(offers.connect(ctx.outsider).setTerms(1n, 1)).to.be.revertedWith("CreditIssuer: Unauthorized caller");
    });

    it("never lets the cap go under what the line already owes", async function () {
      await offers.connect(ctx.operator).grant(newcomer.address);
      await expect(offers.connect(ctx.operator).setCap(5n * ONE_USDC)).to.be.revertedWith("StableCredit: invalid credit limit");
    });

    it("leaves giving offers to an operator, not the owner", async function () {
      await offers.transferOwnership(safe.address);
      await expect(offers.connect(safe).grant(newcomer.address)).to.be.revertedWith("CreditIssuer: Unauthorized caller");
    });
  });

  describe("not something the AssurancePool reserves against", function () {
    it("reports no position for its own line or for anyone it enrolled", async function () {
      await offers.connect(ctx.operator).grant(newcomer.address);
      const [kinds] = await offers.debtByKind(await offers.getAddress());
      expect(kinds).to.have.length(0);

      const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
      const registry = await upgrades.deployProxy(
        CollateralRegistry,
        [ctx.admin.address, await ctx.networkRegistry.getAddress()],
        { kind: "uups" }
      );
      expect(await registry.exposureOf(await offers.getAddress())).to.equal(0n);
      expect(await registry.exposureOf(newcomer.address)).to.equal(0n);
    });
  });
});
