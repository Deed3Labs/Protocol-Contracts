import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network, drawCredit } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const NET_30 = 30 * DAY;
const NET_14 = 14 * DAY;

// A merchant's positive StableCredit is the payables ledger: what the co-op owes them, on-chain,
// with no parallel record to reconcile against. This is where it becomes money.
describe("PayoutPool", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let registry: any, pool: any;
  let merchant: any, second: any, coop: any, funder: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, second, funder] = [signers[8], signers[9], signers[10]];
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
    await pool.grantRole(await pool.FUNDER_ROLE(), funder.address);

    for (const who of [coop, second]) {
      await ctx.access.connect(ctx.operator).grantMember(who.address);
    }
    await registry.registerMerchant(merchant.address, NET_30, 50_000n * ONE_USDC, 200n);

    // A member spends, so the merchant holds a real positive balance.
    await drawCredit(ctx, 1_000n * ONE_USDC);
    await ctx.stableCredit.connect(merchant).approve(await pool.getAddress(), ethers.MaxUint256);
  });

  async function fund(amount: bigint) {
    await ctx.usdc.mint(funder.address, amount);
    await ctx.usdc.connect(funder).approve(await pool.getAddress(), amount);
    await pool.connect(funder).fund(amount);
  }

  describe("what a merchant can take", function () {
    it("redeems the surplus a member's spending created", async function () {
      await fund(1_000n * ONE_USDC);
      expect(await pool.redeemableOf(merchant.address)).to.equal(1_000n * ONE_USDC);

      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
    });

    it("moves the position to the co-op rather than destroying it", async function () {
      // Burning would leave the member still owing and nobody holding the matching claim, which
      // is the shape of lost debt even though nothing was lost.
      await fund(1_000n * ONE_USDC);
      const supplyBefore = await ctx.stableCredit.totalSupply();

      await pool.connect(merchant).redeem(1_000n * ONE_USDC);

      expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(0n);
      expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(1_000n * ONE_USDC);
      expect(await ctx.stableCredit.totalSupply()).to.equal(supplyBefore);
      // Still nets: what the member owes is what the co-op now holds.
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
        .to.equal(await ctx.stableCredit.balanceOf(coop.address));
    });

    it("pays a merchant by drawdown first, leaving only the surplus redeemable", async function () {
      // A merchant carrying credit of their own has it netted before anything is redeemable, and
      // that falls out of the ledger holding one signed number rather than being enforced here.
      await ctx.creditIssuer
        .connect(ctx.operator)
        .initializeCreditLine(second.address, 800n * ONE_USDC, 0, 365 * DAY, NET_30);
      await ctx.stableCredit.connect(second).transfer(merchant.address, 600n * ONE_USDC);

      // The second merchant drew 600 and then receives 400 back.
      await ctx.stableCredit.connect(merchant).transfer(second.address, 400n * ONE_USDC);

      expect(await ctx.stableCredit.creditBalanceOf(second.address)).to.equal(200n * ONE_USDC);
      expect(await pool.redeemableOf(second.address)).to.equal(0n);
    });

    it("refuses a merchant with nothing owed to them", async function () {
      await expect(pool.connect(second).redeem(1n))
        .to.be.revertedWithCustomError(pool, "PayoutPoolNothingToRedeem");
    });

    it("refuses a merchant who has been deactivated", async function () {
      await registry.setActive(merchant.address, false);
      await expect(pool.connect(merchant).redeem(1n))
        .to.be.revertedWithCustomError(pool, "PayoutPoolMerchantInactive");
    });
  });

  describe("funded beats queued", function () {
    it("pays immediately when the money is there", async function () {
      await fund(1_000n * ONE_USDC);
      const [paidNow] = await pool.connect(merchant).redeem.staticCall(1_000n * ONE_USDC);
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);

      expect(paidNow).to.equal(true);
      expect(await pool.queuedTotal()).to.equal(0n);
    });

    it("queues at the merchant's own terms when it is not", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);

      const [who, amount, claimedAt, dueBy, paid] = await pool.claimAt(0);
      expect(who).to.equal(merchant.address);
      expect(amount).to.equal(1_000n * ONE_USDC);
      expect(dueBy - claimedAt).to.equal(BigInt(NET_30));
      expect(paid).to.equal(false);
      expect(await pool.queuedTotal()).to.equal(1_000n * ONE_USDC);
    });

    it("honours net-14 where that is what was agreed", async function () {
      await registry.updateTerms(merchant.address, NET_14, 50_000n * ONE_USDC, 200n);
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);

      const [, , claimedAt, dueBy] = await pool.claimAt(0);
      expect(dueBy - claimedAt).to.equal(BigInt(NET_14));
    });

    it("pays a queued claim once the money arrives", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await pool.canPayNext()).to.equal(false);

      await fund(1_000n * ONE_USDC);
      expect(await pool.canPayNext()).to.equal(true);

      await pool.payNext();
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
      expect(await pool.queuedTotal()).to.equal(0n);
    });
  });

  describe("order is claim age, always", function () {
    beforeEach(async function () {
      // Two merchants, the second registered on better commercial terms than the first.
      await registry.registerMerchant(second.address, NET_14, 50_000n * ONE_USDC, 100n);
      await ctx.creditIssuer
        .connect(ctx.operator)
        .initializeCreditLine(ctx.instrument.address, 500n * ONE_USDC, 0, 365 * DAY, NET_30);
      await ctx.stableCredit.connect(ctx.instrument).transfer(second.address, 500n * ONE_USDC);
      await ctx.stableCredit.connect(second).approve(await pool.getAddress(), ethers.MaxUint256);
    });

    it("pays the older claim first, whatever the terms", async function () {
      // Better terms are a promise the co-op keeps at its own expense. A better place in the
      // queue is a promise kept at another merchant's expense, so it is not on offer.
      await pool.connect(merchant).redeem(1_000n * ONE_USDC); // older, net-30
      await pool.connect(second).redeem(500n * ONE_USDC); // newer, net-14

      await fund(500n * ONE_USDC);
      // Not enough for the older claim, so nothing moves -- the newer one cannot jump it.
      expect(await pool.canPayNext()).to.equal(false);
      await expect(pool.payNext())
        .to.be.revertedWithCustomError(pool, "PayoutPoolInsufficientFunds");

      await fund(500n * ONE_USDC);
      await pool.payNext();
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(second.address)).to.equal(0n);
    });

    it("has no way to choose whose claim moves", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await pool.connect(second).redeem(500n * ONE_USDC);
      await fund(2_000n * ONE_USDC);

      // payNext takes no argument. Anyone may push the queue along; nobody may pick.
      await pool.connect(second).payNext();
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(second.address)).to.equal(0n);
    });

    it("works down the queue in order when it can", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await pool.connect(second).redeem(500n * ONE_USDC);
      await fund(1_500n * ONE_USDC);

      await pool.payQueue(10);
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(second.address)).to.equal(500n * ONE_USDC);
      expect(await pool.queuedTotal()).to.equal(0n);
    });

    it("stops at the first claim it cannot cover", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await pool.connect(second).redeem(500n * ONE_USDC);
      await fund(1_200n * ONE_USDC);

      await pool.payQueue(10);
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(second.address)).to.equal(0n);
      expect(await pool.queuedTotal()).to.equal(500n * ONE_USDC);
    });
  });

  describe("it reports being short rather than judging it", function () {
    it("says exactly how much is missing", async function () {
      // The manual top-up should be a number somebody reads, not a call somebody makes.
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(1_000n * ONE_USDC);

      await fund(400n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(600n * ONE_USDC);

      await fund(600n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(0n);
    });

    it("takes a top-up from anybody, since refusing money would be strange", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await ctx.usdc.mint(second.address, 1_000n * ONE_USDC);
      await ctx.usdc.connect(second).approve(await pool.getAddress(), 1_000n * ONE_USDC);

      await pool.connect(second).donate(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(0n);
    });
  });

  describe("it never touches the AssurancePool", function () {
    it("pays merchants without the reserve moving", async function () {
      // Redemption there is capped by lost debt outstanding, so paying merchants from it would
      // mean a merchant can only be paid when a member has defaulted.
      await ctx.usdc.mint(ctx.admin.address, 5_000n * ONE_USDC);
      await ctx.usdc.approve(await ctx.assurancePool.getAddress(), 5_000n * ONE_USDC);
      await ctx.assurancePool.depositIntoPrimaryReserve(2_000n * ONE_USDC);

      await fund(1_000n * ONE_USDC);
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);

      expect(await ctx.assurancePool.reserveBalance()).to.equal(2_000n * ONE_USDC);
    });

    it("cannot reach the reserve even when it is short", async function () {
      await ctx.usdc.mint(ctx.admin.address, 5_000n * ONE_USDC);
      await ctx.usdc.approve(await ctx.assurancePool.getAddress(), 5_000n * ONE_USDC);
      await ctx.assurancePool.depositIntoPrimaryReserve(2_000n * ONE_USDC);

      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(1_000n * ONE_USDC);

      // The pool is not, and cannot make itself, a withdrawal caller on the reserve.
      expect(await ctx.assurancePool.withdrawalCallers(await pool.getAddress())).to.equal(false);
      expect(await ctx.assurancePool.reserveBalance()).to.equal(2_000n * ONE_USDC);
    });
  });
});
