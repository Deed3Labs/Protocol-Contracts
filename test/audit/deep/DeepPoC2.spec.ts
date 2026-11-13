import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCore, advance, ONE_USDC, CYCLE, DAY, NET_30 } from "./deep-setup";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { signedOpenPlan, signedOpenPlanStatic } from "../../helpers/plans";

describe("DEEP AUDIT PoC 2", function () {
  it("X-8 (fixed): the treasury's positions are not burned as income, and a stale carrier share cannot break the split", async function () {
    const { ctx, revolving, term, pool, merchant, merchant2, coop, member2 } = await deployCore();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    await ctx.usdc.connect(coop).approve(await pool.getAddress(), 10_000n * ONE_USDC);
    await advance(NET_30 + 1);
    await pool.drawForDueClaim();
    expect(await pool.advancedOf(coop.address)).to.equal(975n * ONE_USDC);
    await term.connect(m).payPlan(0, 2_000n * ONE_USDC);
    // Withdrawing "income" takes the 25 fee only; the 975 position stays with what it backs.
    const held = await ctx.stableCredit.balanceOf(coop.address);
    await pool.connect(ctx.admin).withdrawCoopIncome(held);
    expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(975n * ONE_USDC);
    expect(await pool.advancedOf(coop.address)).to.equal(975n * ONE_USDC);

    // Carry arrives and is split without reverting, and never more than there is.
    await revolving.connect(ctx.operator).setTierCarryRecipient(2, await pool.getAddress());
    await revolving.connect(ctx.operator).openLine(member2.address, [0n, 0n, 1_000n * ONE_USDC, 0n], 3650 * DAY, CYCLE);
    await ctx.stableCredit.connect(member2).transfer(merchant2.address, 100n * ONE_USDC);
    await advance(CYCLE);
    await revolving.materialiseCarry(member2.address);
    const carry = await pool.distributableCarry();
    expect(carry).to.be.gt(0n);
    const before = await ctx.stableCredit.balanceOf(coop.address);
    await pool.distributeCarry();
    expect((await ctx.stableCredit.balanceOf(coop.address)) - before).to.equal(carry);
    expect(await pool.distributableCarry()).to.equal(0n);
  });

  it("X-11 (fixed): at the rate ceiling the carry index saturates instead of overflowing; the position stays readable", async function () {
    const H = await ethers.getContractFactory("CarryIndexHarness");
    const h = await H.deploy();
    const key = ethers.encodeBytes32String("k");
    await h.initIndex(key, 5_000n, CYCLE, 0);
    const RAY = 10n ** 27n;
    const MAX_INDEX = RAY * 10n ** 9n;
    expect(await h.currentIndex(key, 30n * BigInt(CYCLE))).to.be.lt(MAX_INDEX);
    expect(await h.currentIndex(key, 131n * BigInt(CYCLE))).to.equal(MAX_INDEX);
    expect(await h.currentIndex(key, 10_000n * BigInt(CYCLE))).to.equal(MAX_INDEX);
  });

  it("X-12 (fixed): a refund is paid only from members' money; funder capital is untouched and stays withdrawable", async function () {
    const { ctx, term, pool, merchant, funder } = await deployCore({ fundPool: 5_000n * ONE_USDC });
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    await term.connect(m).payPlan(0, 1_000n * ONE_USDC);
    await pool.connect(merchant).redeem(975n * ONE_USDC);   // settled out of the member's money
    expect(await pool.capitalOf(funder.address)).to.equal(5_000n * ONE_USDC);
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    // 25 of members' money was here and went back; the other 975 is owed, not taken from capital.
    expect(await pool.refundOwedOf(m.address)).to.equal(975n * ONE_USDC);
    expect(await ctx.usdc.balanceOf(await pool.getAddress())).to.equal(5_000n * ONE_USDC);
    expect(await pool.capitalOf(funder.address)).to.equal(5_000n * ONE_USDC);
    expect(await pool.idleCapitalOf(funder.address)).to.equal(5_000n * ONE_USDC);
    expect(await ctx.stableCredit.balanceOf(funder.address)).to.equal(0n);
  });

  it("X-4b (fixed): a reversal's merchant shortfall is tracked and collected out of the next sale", async function () {
    const { ctx, term, pool, merchant } = await deployCore({ fundPool: 5_000n * ONE_USDC });
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 4, CYCLE);
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(0n);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);
    expect(await ctx.stableCredit.refundReceivableOf(merchant.address)).to.equal(975n * ONE_USDC);
    await term.connect(ctx.operator).setTermLimit(m.address, 2_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 4, CYCLE);
    expect(await pool.redeemableOf(merchant.address)).to.equal(0n);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(0n);
    expect(await ctx.stableCredit.refundReceivableOf(merchant.address)).to.equal(0n);
  });

  it("(observation, holds) a draw at index > RAY books no carry in the same block", async function () {
    const { ctx, revolving, merchant } = await deployCore();
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 3650 * DAY, CYCLE);
    await advance(10 * DAY + 17); // index on the INCOME tier is now > RAY
    await ctx.stableCredit.connect(m).transfer(merchant.address, 1_000_000_001n);
    // same block: no time has passed for this position
    const drawn = await revolving.drawnOf(m.address, 2);
    const principal = await revolving.principalOf(m.address, 2);
    expect(drawn - principal).to.be.lte(1n);
    console.log(`      drawn-principal right after draw: ${drawn - principal} wei`);
  });

  it("X-13 (fixed): a full refund closes the plan whether or not anyone materialised carry first", async function () {
    const { ctx, term, merchant } = await deployCore();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 4, CYCLE);
    await advance(20 * DAY);
    const snap = await ethers.provider.send("evm_snapshot", []);

    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    let [, , , , , , , , closed] = await term.planAt(0);
    expect(closed).to.equal(true);
    const residualB = await term.residualCarryOf(m.address);

    await ethers.provider.send("evm_revert", [snap]);
    await term.connect(ctx.outsider).materialiseCarry(0);
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    [, , , , , , , , closed] = await term.planAt(0);
    expect(closed).to.equal(true);
    // The same carry is left either way (to within the one second the extra call took).
    expect(await term.residualCarryOf(m.address)).to.be.closeTo(residualB, 1_000n);
    expect(await term.arrearsOf(0)).to.equal(0n);
    await advance(3 * CYCLE + 1);
    await expect(term.declareDefault(m.address)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    // And a new plan is not blocked.
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 10n * ONE_USDC, 9n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
  });

  it("X-13 (fixed): a partial refund re-fixes the schedule over what is left", async function () {
    const { ctx, term, merchant } = await deployCore();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 4, CYCLE);
    await term.connect(ctx.operator).closePlanForRefund(0, 400n * ONE_USDC, merchant.address, 390n * ONE_USDC);
    const [installment, total, installments] = await term.scheduleOf(0);
    expect(installments).to.equal(4n);
    // About 600 spread over four, not the old ~257 a period.
    expect(installment).to.be.lt(160n * ONE_USDC);
    expect(total).to.be.gte(600n * ONE_USDC);
    expect(await term.arrearsOf(0)).to.equal(0n);
  });

  it("X-20 (fixed): drawForDueClaim either pays the claim or borrows nothing", async function () {
    const { ctx, term, pool, merchant, coop } = await deployCore();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    // The treasury can put up only part of it.
    await ctx.usdc.connect(coop).approve(await pool.getAddress(), 500n * ONE_USDC);
    await advance(NET_30 + 1);
    await expect(pool.drawForDueClaim()).to.be.revertedWithCustomError(pool, "PayoutPoolInsufficientFunds");
    expect(await pool.capitalOf(coop.address)).to.equal(0n);
    expect(await ctx.usdc.balanceOf(await pool.getAddress())).to.equal(0n);
    // With enough, it pays in full.
    await ctx.usdc.connect(coop).approve(await pool.getAddress(), 975n * ONE_USDC);
    await pool.drawForDueClaim();
    expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000_000n * ONE_USDC + 975n * ONE_USDC);
  });
});
