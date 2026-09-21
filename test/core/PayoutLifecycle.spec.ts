import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const CYCLE = 30 * DAY;
const NET_30 = 30 * DAY;
const ONE_YEAR = 365 * DAY;

/*
 * A purchase from the shop to the money, end to end.
 *
 * The parts are tested on their own elsewhere. What this follows is the whole of it -- a member
 * buying on a plan, paying it down, and a merchant being paid -- because the questions worth asking
 * are about the seams: whose money paid the merchant, what happened to the claim, who is owed what
 * afterwards, and who earns the carry the member was charged.
 *
 * Three ways a merchant gets paid, which is the whole of the design:
 *
 *   the member's own repayment   the claim is settled and burned
 *   capital already in the pool  the funder buys the position
 *   capital found when it is due the funder buys the position, same rule, later
 *
 * Note what does NOT appear here: any check on when a merchant may redeem. `dueBy` is recorded and
 * never read. A merchant is paid when it is their turn and the money is there, whether that is the
 * day of the sale or a month after -- so "redeeming early" is not refused, it is simply what a
 * funded pool looks like. Net 30 is when the co-op must FIND the money, not a gate on paying it.
 */
describe("a purchase, from the shop to the money", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let term: any, pool: any, registry: any;
  let coop: any, merchant: any, yieldPool: any;

  const u = (v: bigint) => ethers.formatUnits(v, 6);

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, merchant, yieldPool] = [signers[8], signers[9], signers[10]];

    const TermIssuer = await ethers.getContractFactory("TermIssuer");
    term = await TermIssuer.deploy();
    await term.initialize(await ctx.stableCredit.getAddress(), coop.address);
    await ctx.networkRegistry.registerIssuer(
      await term.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await ctx.access.grantOperator(await term.getAddress());

    const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
    registry = await upgrades.deployProxy(MerchantRegistry, [ctx.admin.address, NET_30], { kind: "uups" });

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

    for (const who of [coop, merchant, yieldPool]) {
      await ctx.access.connect(ctx.operator).grantMember(who.address);
    }
    await registry.registerMerchant(merchant.address, NET_30, 50_000n * ONE_USDC, 200n);
    await ctx.stableCredit.connect(merchant).approve(await pool.getAddress(), ethers.MaxUint256);
    await ctx.stableCredit.connect(coop).approve(await pool.getAddress(), ethers.MaxUint256);

    // Repayments reach the pool rather than loss absorption, which is what this is all about.
    await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());
    // The co-op and the yield pool both put working capital in; neither is named in advance.
    for (const who of [coop, yieldPool]) {
      await pool.connect(ctx.admin).grantRole(await pool.FUNDER_ROLE(), who.address);
    }


    await ctx.creditIssuer
      .connect(ctx.operator)
      .initializeCreditLine(ctx.member.address, 0, 0, ONE_YEAR, CYCLE);
    await term.connect(ctx.operator).setTermLimit(ctx.member.address, 10_000n * ONE_USDC);

    // The member can pay their instalments.
    await ctx.usdc.mint(ctx.member.address, 10_000n * ONE_USDC);
    await ctx.usdc
      .connect(ctx.member)
      .approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
  });

  /** A $100 purchase at the shop, 2.5% to the co-op, split over four cycles. */
  async function buy(purchase = 100n * ONE_USDC) {
    const payout = (purchase * 975n) / 1000n;
    await term
      .connect(ctx.operator)
      .openPlan(ctx.member.address, merchant.address, purchase, payout, 150n, CYCLE, 4, CYCLE);
    return { purchase, payout, discount: purchase - payout };
  }

  async function fundPool(who: any, amount: bigint) {
    await ctx.usdc.mint(who.address, amount);
    await ctx.usdc.connect(who).approve(await pool.getAddress(), amount);
    await pool.connect(who).fund(amount);
  }

  async function elapse(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  it("mints three ways that net to zero when the member buys", async function () {
    const { purchase, payout, discount } = await buy();

    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(purchase);
    expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(payout);
    expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(discount);
    // Nobody lent anything: the three legs are the whole of it.
    expect(await ctx.stableCredit.totalSupply()).to.equal(purchase);
  });

  it("pays the merchant out of the member's own money, and the claim goes", async function () {
    const { purchase, payout } = await buy();

    // The member clears the lot rather than paying it down over four cycles; both arrive the same.
    await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, purchase);
    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
    // Their money went where the merchant is owed from, not into loss absorption.
    expect(await pool.held()).to.equal(purchase);
    expect(await ctx.assurancePool.bufferBalance()).to.equal(0n);
    expect(await pool.memberFunded()).to.equal(purchase);

    await pool.connect(merchant).redeem(payout);

    expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(payout);
    // Settled, not sold: nobody is left holding a claim on a member who owes nothing.
    expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(0n);
    expect(await pool.advancedTotal()).to.equal(0n);
    // What is left standing is the co-op's fee, which the member also paid for.
    expect(await ctx.stableCredit.totalSupply()).to.equal(purchase - payout);
  });

  it("pays a merchant who comes in the same day, out of capital, and the funder holds it", async function () {
    const { payout } = await buy();
    await fundPool(coop, 200n * ONE_USDC);

    // Nothing says a merchant must wait for net 30. The money is there and it is their turn.
    await pool.connect(merchant).redeem(payout);

    expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(payout);
    // The member still owes it, so the claim did not go -- it changed hands.
    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(100n * ONE_USDC);
    // The co-op holds what it funded, on top of the fee it was minted at the sale.
    expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(payout + (100n * ONE_USDC - payout));
    expect(await pool.advancedOf(coop.address)).to.equal(payout);
  });

  it("queues a merchant when there is nothing to pay them with", async function () {
    const { payout } = await buy();

    const [, claimId] = await pool.connect(merchant).redeem.staticCall(payout);
    await pool.connect(merchant).redeem(payout);

    expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(0n);
    expect(await pool.shortfall()).to.equal(payout);
    const claim = await pool.claimAt(claimId);
    expect(claim.paid).to.equal(false);
    // The window is recorded for whoever has to answer for it, and gates nothing here.
    expect(claim.dueBy - claim.claimedAt).to.equal(BigInt(NET_30));
  });

  it("covers a claim that has come due from capital, and pays the carry to whoever bore it", async function () {
    const { purchase, payout } = await buy();
    await pool.connect(merchant).redeem(payout);
    expect(await pool.shortfall()).to.equal(payout);

    // A cycle passes with the member still paying nothing. Now it is due and somebody must find it.
    await elapse(NET_30 + DAY);
    const claim = await pool.claimAt(0);
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    expect(now).to.be.greaterThan(claim.dueBy);

    // The yield pool's unlent cash covers it. Nothing triggers this yet -- that is the step after
    // this one -- so it stands in for the draw the pool will make on its own.
    await fundPool(yieldPool, payout);
    await pool.payNext();

    expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(payout);
    expect(await pool.advancedOf(yieldPool.address)).to.equal(payout);
    // It bought the position: the member still owes, and the yield pool is now who they owe it to.
    expect(await ctx.stableCredit.balanceOf(yieldPool.address)).to.equal(payout);
    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(purchase);

    /*
     * Carry delivered to the pool to be split.
     *
     * Pointed here AFTER the sale on purpose. `carryTreasury` is also where `openPlan` mints the
     * co-op's fee, so an issuer pointed at the pool from the start would deliver the fee there too
     * and this split would hand funders a share of the co-op's income. Separating the two is a
     * contract change and is why carry is not routed here on the deployed issuers yet.
     */
    await term.connect(ctx.operator).setCarryTreasury(await pool.getAddress());
    await term.materialiseCarry(0);
    const carry = await pool.distributableCarry();
    expect(carry).to.be.greaterThan(0n);

    const before = await ctx.stableCredit.balanceOf(yieldPool.address);
    await pool.distributeCarry();
    const earned = (await ctx.stableCredit.balanceOf(yieldPool.address)) - before;

    // It bore 97.50 of the 100 outstanding, so it earns that share and the co-op keeps the rest.
    const float = purchase;
    expect(earned).to.equal((carry * payout) / float);
    expect(earned).to.be.greaterThan((carry * 9n) / 10n);
    console.log(`        carry ${u(carry)} -> yield pool ${u(earned)}, co-op ${u(carry - earned)}`);
  });

  // What the fee and the carry sharing one address cost, and what having two fixes. Pointing
  // carryTreasury at the pool -- the only way carry reaches the split -- used to take the co-op's
  // 2.5% with it, and the split would have handed funders a share of the co-op's income.
  describe("the fee and the carry are not one thing", function () {
    it("keeps minting the fee where it always went, until somebody says otherwise", async function () {
      const { discount } = await buy();
      expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(discount);
    });

    it("leaves the fee with the co-op when carry moves to the pool", async function () {
      await term.connect(ctx.operator).setFeeRecipient(coop.address);
      await term.connect(ctx.operator).setCarryTreasury(await pool.getAddress());

      const { purchase, payout, discount } = await buy();

      // The sale's fee is the co-op's, wherever carry now goes.
      expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(discount);
      expect(await pool.distributableCarry()).to.equal(0n);

      // And carry alone arrives at the pool to be split.
      await fundPool(yieldPool, payout);
      await pool.connect(merchant).redeem(payout);
      await elapse(CYCLE);
      await term.materialiseCarry(0);

      const carry = await pool.distributableCarry();
      expect(carry).to.be.greaterThan(0n);
      const before = await ctx.stableCredit.balanceOf(yieldPool.address);
      await pool.distributeCarry();
      // Its share of the float it bore, and not a cent of the fee.
      expect((await ctx.stableCredit.balanceOf(yieldPool.address)) - before).to.equal(
        (carry * payout) / purchase,
      );
    });

    it("unwinds a refund against the address that holds the fee", async function () {
      // A plan opened before the split and refunded after it: the fee is burned from where it was
      // minted, because the recipient did not move -- only carry did.
      const { purchase, payout, discount } = await buy();
      await term.connect(ctx.operator).setFeeRecipient(coop.address);
      await term.connect(ctx.operator).setCarryTreasury(await pool.getAddress());

      await term.connect(ctx.operator).closePlanForRefund(0, purchase, merchant.address, payout);

      expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(0n);
      expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(0n);
      expect(discount).to.be.greaterThan(0n);
    });

    it("is an operator's call, and never nobody", async function () {
      await expect(term.connect(ctx.outsider).setFeeRecipient(ctx.outsider.address)).to.be.reverted;
      await expect(
        term.connect(ctx.operator).setFeeRecipient(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(term, "TermIssuerNoCarryRecipient");
    });
  });

  it("gives the funder their money back as the member pays, not before", async function () {
    const { payout } = await buy();
    await fundPool(coop, payout);
    await pool.connect(merchant).redeem(payout);

    // Spent capital is not sitting here to be withdrawn; it is a position now.
    expect(await pool.idleCapitalOf(coop.address)).to.equal(0n);
    expect(await pool.advancedOf(coop.address)).to.equal(payout);

    // The member pays an instalment, and the co-op can take that much of its money back.
    await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, 25n * ONE_USDC);
    await pool.connect(coop).redeem(25n * ONE_USDC);

    expect(await ctx.usdc.balanceOf(coop.address)).to.equal(25n * ONE_USDC);
    expect(await pool.advancedOf(coop.address)).to.equal(payout - 25n * ONE_USDC);
  });
});
