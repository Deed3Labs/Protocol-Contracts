import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network, drawCredit } from "../helpers/phase0-fixture";
import { deployAssurancePool, fund as fundAssurance, balances, TAG } from "../helpers/assurance";

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

    // The ledger has to know this pool: it is where repayments are routed, and it is the one
    // contract allowed to say a claim was settled rather than bought.
    await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());

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

    it("moves the position to whoever funded it rather than destroying it", async function () {
      // Paid with capital, so the member still owes it: burning would leave an obligation with
      // nobody holding the matching claim, which is the shape of lost debt even though nothing
      // was lost. The funder holds it until the member repays.
      await ctx.access.connect(ctx.operator).grantMember(funder.address);
      await fund(1_000n * ONE_USDC);
      const supplyBefore = await ctx.stableCredit.totalSupply();

      await pool.connect(merchant).redeem(1_000n * ONE_USDC);

      expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(0n);
      expect(await ctx.stableCredit.balanceOf(funder.address)).to.equal(1_000n * ONE_USDC);
      expect(await ctx.stableCredit.totalSupply()).to.equal(supplyBefore);
      // Still nets: what the member owes is what the funder now holds.
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
        .to.equal(await ctx.stableCredit.balanceOf(funder.address));
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
      // Registered, so the eligibility check passes and the balance is what refuses it.
      await registry.registerMerchant(second.address, NET_30, 50_000n * ONE_USDC, 200n);
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

  // Compliance addendum 12.10 replaced strict claim age with deadline first, claim age second.
  // The tests below used to assert that the older net-30 claim was paid ahead of a newer net-14
  // one; they now assert the net-14 claim, due sooner, goes first (see PHASE-2B-PAYOUT-RESERVE.md).
  describe("order is deadline, then claim age", function () {
    beforeEach(async function () {
      // Two merchants, the second registered on net-14 against the first's net-30.
      await registry.registerMerchant(second.address, NET_14, 50_000n * ONE_USDC, 100n);
      await ctx.creditIssuer
        .connect(ctx.operator)
        .initializeCreditLine(ctx.instrument.address, 500n * ONE_USDC, 0, 365 * DAY, NET_30);
      await ctx.stableCredit.connect(ctx.instrument).transfer(second.address, 500n * ONE_USDC);
      await ctx.stableCredit.connect(second).approve(await pool.getAddress(), ethers.MaxUint256);
    });

    it("pays the claim due sooner first, even when it is newer", async function () {
      // Was "pays the older claim first, whatever the terms". The net-14 claim is due about two
      // weeks before the older net-30 one, so it is paid first.
      await pool.connect(merchant).redeem(1_000n * ONE_USDC); // older, net-30
      await pool.connect(second).redeem(500n * ONE_USDC); // newer, net-14
      expect(await pool.nextUnpaid()).to.equal(1n);

      await fund(500n * ONE_USDC);
      expect(await pool.canPayNext()).to.equal(true);
      await pool.payNext();
      expect(await ctx.usdc.balanceOf(second.address)).to.equal(500n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(0n);

      // Then the net-30 claim, once there is money for it.
      expect(await pool.nextUnpaid()).to.equal(0n);
      await expect(pool.payNext()).to.be.revertedWithCustomError(pool, "PayoutPoolInsufficientFunds");
      await fund(1_000n * ONE_USDC);
      await pool.payNext();
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
    });

    it("has no way to choose whose claim moves", async function () {
      // Was the same test with the net-30 claim moving first. Still nobody picks: payNext takes no
      // argument, and the net-30 merchant calling it moves the net-14 claim.
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await pool.connect(second).redeem(500n * ONE_USDC);
      await fund(2_000n * ONE_USDC);

      await pool.connect(merchant).payNext();
      expect(await ctx.usdc.balanceOf(second.address)).to.equal(500n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(0n);
    });

    it("pays claims due at the same moment oldest first", async function () {
      // Same window, so the same deadline only when queued in the same second; the older id wins.
      await registry.updateTerms(second.address, NET_30, 50_000n * ONE_USDC, 100n);
      await ethers.provider.send("evm_setAutomine", [false]);
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await pool.connect(second).redeem(500n * ONE_USDC);
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_setAutomine", [true]);
      const [, , , dueA] = await pool.claimAt(0);
      const [, , , dueB] = await pool.claimAt(1);
      expect(dueA).to.equal(dueB);

      await fund(500n * ONE_USDC);
      // The older claim is next and the pool cannot cover it; the smaller one does not jump it.
      expect(await pool.nextUnpaid()).to.equal(0n);
      await expect(pool.payNext()).to.be.revertedWithCustomError(pool, "PayoutPoolInsufficientFunds");
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
      // Was: the net-30 claim paid and the net-14 one left queued. In deadline order the net-14
      // claim is paid, and the 700 left cannot cover the net-30 claim, so the queue stops there.
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await pool.connect(second).redeem(500n * ONE_USDC);
      await fund(1_200n * ONE_USDC);

      await pool.payQueue(10);
      expect(await ctx.usdc.balanceOf(second.address)).to.equal(500n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(0n);
      expect(await pool.queuedTotal()).to.equal(1_000n * ONE_USDC);
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

    it("takes a top-up from anybody, through the door meant for capital", async function () {
      // `donate` used to be open to anyone, on the grounds that refusing money is strange. It is
      // now the ledger's alone, because what arrives there decides whether a claim is settled or
      // bought: cash from anyone else would burn claims whose obligations nobody had paid. Giving
      // the pool money still works, through `fund`, which buys the position like any capital.
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await ctx.usdc.mint(second.address, 1_000n * ONE_USDC);
      await ctx.usdc.connect(second).approve(await pool.getAddress(), 1_000n * ONE_USDC);

      await expect(
        pool.connect(second).receiveRepayment(1_000n * ONE_USDC)
      ).to.be.revertedWithCustomError(pool, "PayoutPoolInvalidAddress");

      await pool.grantRole(await pool.FUNDER_ROLE(), second.address);
      await pool.connect(second).fund(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(0n);
    });
  });

  // Section 13: the co-op's AssurancePool is walled off. The payout pool holds no address to call
  // it with, so a funded payout and an unfunded one both leave every compartment where it was.
  describe("it pays merchants without the AssurancePool, which never funds or lends here (section 13)", function () {
    it("pays merchants without any compartment moving", async function () {
      const a = await deployAssurancePool(ctx.usdc, ctx.networkRegistry);
      await fundAssurance(a, ctx.usdc, a.treasury, TAG.BOARD_ALLOCATION, 2_000n * ONE_USDC);
      const before = await balances(a.pool);

      await fund(1_000n * ONE_USDC);
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);

      expect((await balances(a.pool)).byId).to.deep.equal(before.byId);
      expect(await ctx.usdc.balanceOf(await a.pool.getAddress())).to.equal(2_000n * ONE_USDC);
    });

    it("queues a claim it cannot pay rather than reaching for the AssurancePool", async function () {
      const a = await deployAssurancePool(ctx.usdc, ctx.networkRegistry);
      await fundAssurance(a, ctx.usdc, a.treasury, TAG.BOARD_ALLOCATION, 2_000n * ONE_USDC);
      const before = await balances(a.pool);

      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(1_000n * ONE_USDC);

      expect((await balances(a.pool)).byId).to.deep.equal(before.byId);
      // And the payout pool could not pay in either: it is a money path.
      await ctx.networkRegistry.listMoneyPath(await pool.getAddress(), ethers.encodeBytes32String("PAYOUT_POOL"));
      expect(await ctx.networkRegistry.isMoneyPath(await pool.getAddress())).to.equal(true);
    });
  });
});
