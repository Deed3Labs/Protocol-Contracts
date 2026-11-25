import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE = 10n ** 6n;
const DAY = 24 * 60 * 60;

/*
 * P0 spike: can a second StableCredit
 * instance carry Clear Credits -- non-transferable points -- by configuration alone?
 *
 * The Credits Ledger here is a fresh `ClearCredit` proxy that shares only the AccessManager with the
 * credit ledger. It has a merchant registry with nobody in it, no payout pool, no reserve token and
 * no lender operating account, and exactly one system recipient: the issuer. OffersIssuer stands in
 * for the Points Issuer -- an issuer that holds a line and hands credits to members from it -- so
 * nothing here is new contract code.
 *
 * The five things the spike must show:
 *   1. an issuer with a line can give credits to an enrolled member;
 *   2. a member can send credits only to the issuer, by transfer or by transferFrom;
 *   3. a member's credits sent to the issuer close that much of its line, and nothing routes value;
 *   4. nothing else can create credits or turn them into a token;
 *   5. an upgrade of the ledger keeps 1-4.
 */
describe("P0 spike: a Credits Ledger on a second StableCredit instance", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let credits: any, registry: any, merchants: any, issuer: any;
  let member: any, other: any, merchant: any, spender: any;

  const GRANT = 10n * ONE;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const s = await ethers.getSigners();
    [member, other, merchant, spender] = [s[10], s[11], s[12], s[13]];

    // A second ledger: same code, same AccessManager, nothing else shared.
    const ClearCredit = await ethers.getContractFactory("ClearCredit");
    credits = await upgrades.deployProxy(ClearCredit, ["Clear Credits", "CREDITS", await ctx.access.getAddress()], {
      kind: "uups",
    });
    await ctx.access.grantOperator(await credits.getAddress());

    const NetworkRegistry = await ethers.getContractFactory("NetworkRegistry");
    registry = await upgrades.deployProxy(NetworkRegistry, [ctx.admin.address], { kind: "uups" });
    await credits.setNetworkRegistry(await registry.getAddress());

    // An empty merchant registry, so the ledger applies its transfer policy.
    const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
    merchants = await upgrades.deployProxy(MerchantRegistry, [ctx.admin.address, 30], { kind: "uups" });
    await credits.setMerchantRegistry(await merchants.getAddress());

    // The issuer: OffersIssuer standing in for the Points Issuer (a line, and grants from it).
    const OffersIssuer = await ethers.getContractFactory("OffersIssuer");
    issuer = await upgrades.deployProxy(
      OffersIssuer,
      [await credits.getAddress(), ctx.admin.address, GRANT, 3650 * DAY],
      { kind: "uups" }
    );
    await registry.registerIssuer(await issuer.getAddress(), await credits.getAddress());
    await issuer.connect(ctx.operator).setCap(1_000n * ONE);
    // The only place a member may send credits.
    await credits.setSystemRecipient(await issuer.getAddress(), true);

    await ctx.access.connect(ctx.operator).grantMember(other.address);
    await ctx.access.connect(ctx.operator).grantMember(merchant.address);
  });

  describe("1. issuing", function () {
    it("gives credits from the issuer's line to an enrolled member", async function () {
      await issuer.connect(ctx.operator).grant(member.address);
      expect(await credits.balanceOf(member.address)).to.equal(GRANT);
      expect(await credits.creditBalanceOf(await issuer.getAddress())).to.equal(GRANT);
      expect(await credits.creditBalanceOf(member.address)).to.equal(0n);
      expect(await credits.creditLimitOf(member.address)).to.equal(0n);
    });
  });

  describe("2. a member can send credits only to the issuer", function () {
    beforeEach(async function () {
      await issuer.connect(ctx.operator).grant(member.address);
    });

    it("refuses another member", async function () {
      await expect(credits.connect(member).transfer(other.address, ONE)).to.be.revertedWithCustomError(
        credits,
        "StableCreditRecipientNotEligible"
      );
    });

    it("refuses a non-member wallet, the credit ledger and the zero address", async function () {
      await expect(credits.connect(member).transfer(ctx.outsider.address, ONE)).to.be.reverted;
      await expect(credits.connect(member).transfer(await ctx.stableCredit.getAddress(), ONE)).to.be.reverted;
      await expect(credits.connect(member).transfer(ethers.ZeroAddress, ONE)).to.be.reverted;
    });

    it("refuses the same moves through an allowance", async function () {
      await credits.connect(member).approve(spender.address, GRANT);
      await expect(
        credits.connect(spender).transferFrom(member.address, other.address, ONE)
      ).to.be.revertedWithCustomError(credits, "StableCreditRecipientNotEligible");
    });

    it("refuses a member going negative: a member's limit on this ledger is zero", async function () {
      await expect(credits.connect(other).transfer(await issuer.getAddress(), ONE)).to.be.reverted;
    });

    it("FINDING: a merchant the registry's admin registers becomes a place credits can be spent", async function () {
      // The registry is only empty while its admin keeps it so. Production needs one nobody can add
      // to (spec 1.2, FIXED): a never-registered stub, or this registry with its admin renounced.
      await merchants.registerMerchant(merchant.address, 30, 0, 0);
      expect(await credits.isActiveMerchant(merchant.address)).to.equal(true);
      await expect(credits.connect(member).transfer(merchant.address, ONE)).not.to.be.reverted;
    });

    it("with the registry's admin role renounced, nobody can register a merchant", async function () {
      const ADMIN = await merchants.DEFAULT_ADMIN_ROLE();
      const OPERATOR = await merchants.OPERATOR_ROLE();
      await merchants.renounceRole(OPERATOR, ctx.admin.address);
      await merchants.renounceRole(ADMIN, ctx.admin.address);
      await expect(merchants.registerMerchant(merchant.address, 30, 0, 0)).to.be.reverted;
      await expect(merchants.grantRole(OPERATOR, ctx.admin.address)).to.be.reverted;
      await expect(credits.connect(member).transfer(merchant.address, ONE)).to.be.revertedWithCustomError(
        credits,
        "StableCreditRecipientNotEligible"
      );
    });
  });

  describe("3. sending credits to the issuer", function () {
    it("closes that much of the issuer's line and moves no value anywhere", async function () {
      await issuer.connect(ctx.operator).grant(member.address);
      const usdcBefore = await ctx.usdc.balanceOf(await credits.getAddress());

      await expect(credits.connect(member).transfer(await issuer.getAddress(), 4n * ONE)).not.to.be.reverted;

      expect(await credits.balanceOf(member.address)).to.equal(6n * ONE);
      expect(await credits.creditBalanceOf(await issuer.getAddress())).to.equal(6n * ONE);
      expect(await credits.totalSupply()).to.equal(6n * ONE);
      expect(await ctx.usdc.balanceOf(await credits.getAddress())).to.equal(usdcBefore);
    });
  });

  describe("4. nothing else creates credits or turns them into a token", function () {
    it("has no burn and no burnFrom", async function () {
      await issuer.connect(ctx.operator).grant(member.address);
      await expect(credits.connect(member).burn(ONE)).to.be.reverted;
      await expect(credits.connect(member).burnFrom(member.address, ONE)).to.be.reverted;
    });

    it("refuses credit lines, limits and purchases from anyone but a registered issuer", async function () {
      await expect(credits.connect(ctx.outsider).createCreditLine(ctx.outsider.address, ONE, 0)).to.be.reverted;
      await expect(credits.connect(ctx.operator).updateCreditLimit(member.address, ONE)).to.be.reverted;
      await expect(
        credits.connect(ctx.outsider).originatePurchase(member.address, ONE, other.address, ONE, other.address, 0)
      ).to.be.reverted;
    });

    it("cannot be repaid in, or redeemed for, any token: no reserve token is set", async function () {
      await issuer.connect(ctx.operator).grant(member.address);
      await ctx.usdc.mint(member.address, ONE);
      await ctx.usdc.connect(member).approve(await credits.getAddress(), ONE);
      await expect(credits.connect(member).repayCreditBalance(await issuer.getAddress(), ONE)).to.be.reverted;
      await expect(credits.connect(member).settleClaim(member.address, ONE)).to.be.reverted;
      expect(await credits.isEligibleRecipient(ethers.ZeroAddress)).to.equal(false);
    });
  });

  describe("5. an upgrade keeps it", function () {
    it("still refuses member-to-member after the ledger is upgraded", async function () {
      await issuer.connect(ctx.operator).grant(member.address);
      const ClearCredit = await ethers.getContractFactory("ClearCredit");
      credits = await upgrades.upgradeProxy(await credits.getAddress(), ClearCredit, { kind: "uups" });
      await expect(credits.connect(member).transfer(other.address, ONE)).to.be.revertedWithCustomError(
        credits,
        "StableCreditRecipientNotEligible"
      );
      await expect(credits.connect(member).transfer(await issuer.getAddress(), ONE)).not.to.be.reverted;
    });
  });
});
