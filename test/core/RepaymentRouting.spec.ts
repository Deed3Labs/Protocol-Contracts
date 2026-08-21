import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network, drawCredit } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const NET_30 = 30 * DAY;

// When a member clears their balance, value lands with the co-op -- and that value is what pays
// the merchant holding the positive side of the purchase that created it. It used to go straight
// into the AssurancePool's buffer reserve, which is the one fund forbidden from funding a payout,
// so the working capital for net-30 piled up exactly where it could not be spent.
describe("repayment routing", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let registry: any, pool: any;
  let merchant: any, coop: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    coop = (await ethers.getSigners())[8];
    merchant = ctx.counterparty;

    const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
    registry = await upgrades.deployProxy(MerchantRegistry, [ctx.admin.address, NET_30], {
      kind: "uups",
    });

    const PayoutPool = await ethers.getContractFactory("PayoutPool");
    pool = await upgrades.deployProxy(
      PayoutPool,
      [
        ctx.admin.address,
        await ctx.stableCredit.getAddress(),
        await ctx.usdc.getAddress(),
        await registry.getAddress(),
        coop.address,
      ],
      { kind: "uups" }
    );

    await ctx.access.connect(ctx.operator).grantMember(coop.address);
    await registry.registerMerchant(merchant.address, NET_30, 50_000n * ONE_USDC, 200n);
    await ctx.stableCredit.connect(merchant).approve(await pool.getAddress(), ethers.MaxUint256);

    await drawCredit(ctx, 1_000n * ONE_USDC);
  });

  async function repay(amount: bigint) {
    await ctx.usdc.mint(ctx.admin.address, amount);
    await ctx.usdc.approve(await ctx.stableCredit.getAddress(), amount);
    await ctx.stableCredit.repayCreditBalance(ctx.member.address, amount);
  }

  it("sends everything to the reserve when there is no payout pool", async function () {
    // The inherited behaviour, and the only option before there was anywhere else to send it.
    await repay(1_000n * ONE_USDC);
    expect(await ctx.assurancePool.bufferBalance()).to.equal(1_000n * ONE_USDC);
  });

  describe("with a payout pool", function () {
    beforeEach(async function () {
      await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());
    });

    it("pays the merchant who is waiting before topping up the reserve", async function () {
      // The merchant redeemed and is queued; the member then repays. That repayment is the money
      // the merchant is owed.
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(1_000n * ONE_USDC);

      await repay(1_000n * ONE_USDC);

      expect(await pool.shortfall()).to.equal(0n);
      expect(await pool.held()).to.equal(1_000n * ONE_USDC);
      expect(await ctx.assurancePool.bufferBalance()).to.equal(0n);
    });

    it("lets the queued merchant actually collect", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await repay(1_000n * ONE_USDC);

      await pool.payNext();
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
    });

    it("offers the pool only what it is short, and no more", async function () {
      // A timing buffer, not a place to accumulate. Everything above the claims outstanding
      // carries on to loss absorption, where it does some good.
      await pool.connect(merchant).redeem(400n * ONE_USDC);
      await repay(1_000n * ONE_USDC);

      expect(await pool.held()).to.equal(400n * ONE_USDC);
      expect(await ctx.assurancePool.bufferBalance()).to.equal(600n * ONE_USDC);
    });

    it("sends the lot to the reserve when nobody is waiting", async function () {
      await repay(1_000n * ONE_USDC);

      expect(await pool.held()).to.equal(0n);
      expect(await ctx.assurancePool.bufferBalance()).to.equal(1_000n * ONE_USDC);
    });

    it("covers what it can when the repayment is smaller than the queue", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await repay(300n * ONE_USDC);

      expect(await pool.held()).to.equal(300n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(700n * ONE_USDC);
      expect(await ctx.assurancePool.bufferBalance()).to.equal(0n);
    });

    it("keeps the reserve out of it entirely", async function () {
      // The routing decides where new money lands. It never moves money that has already landed,
      // so the reserve cannot be drained to pay a merchant by this or any other path.
      await ctx.usdc.mint(ctx.admin.address, 2_000n * ONE_USDC);
      await ctx.usdc.approve(await ctx.assurancePool.getAddress(), 2_000n * ONE_USDC);
      await ctx.assurancePool.depositIntoPrimaryReserve(2_000n * ONE_USDC);

      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(1_000n * ONE_USDC);
      expect(await ctx.assurancePool.reserveBalance()).to.equal(2_000n * ONE_USDC);
    });

    it("only lets an admin move where repayments go", async function () {
      await expect(
        ctx.stableCredit.connect(ctx.outsider).setPayoutPool(ethers.ZeroAddress)
      ).to.be.revertedWith("StableCredit: Unauthorized caller");
    });
  });
});
