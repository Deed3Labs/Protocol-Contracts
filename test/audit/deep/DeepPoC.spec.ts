import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCore, advance, ONE_USDC, CYCLE, DAY, NET_30 } from "./deep-setup";
import { signedOpenPlan, signedOpenPlanStatic } from "../../helpers/plans";

/*
 * Deep-pass audit proofs of concept. A test titled "(fixed)" is a regression test asserting the
 * attack now fails; one without it still demonstrates its issue and is fixed in a later step.
 */
describe("DEEP AUDIT PoC", function () {
  it("X-1 (fixed): refunding a paid plan never touches the member's other debt; the merchant owes the shortfall itself", async function () {
    const { ctx, revolving, term, pool, merchant } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 365 * DAY, CYCLE);
    await ctx.stableCredit.connect(m).transfer(merchant.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
    await term.connect(m).payPlan(0, 2_000n * ONE_USDC);
    await pool.connect(merchant).redeem(ethers.MaxUint256);

    const owedBefore = await ctx.stableCredit.creditBalanceOf(m.address);
    const revolvingBefore = await revolving.totalPrincipalOf(m.address);
    const usdcBefore = await ctx.usdc.balanceOf(m.address);
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);

    const cashBack = (await ctx.usdc.balanceOf(m.address)) - usdcBefore;
    // The revolving debt is exactly where it was, and the revolving issuer agrees with the ledger.
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(owedBefore);
    expect(await revolving.totalPrincipalOf(m.address)).to.equal(revolvingBefore);
    // The member is made whole for the 1,000 once: paid now or owed by the pool, never both.
    expect(cashBack + (await pool.refundOwedOf(m.address))).to.equal(1_000n * ONE_USDC);
    // The merchant owes its share, tracked as a refund receivable.
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);
    expect(await ctx.stableCredit.refundReceivableOf(merchant.address)).to.equal(975n * ONE_USDC);
  });

  it("X-2 (fixed): a pre-funded pool still takes member repayments, and settles the claim with them instead of selling it to the funder", async function () {
    const { ctx, term, pool, merchant, funder } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    // Section 13: past the payout pool, a repayment now goes to Lending Co.'s operating address.
    const apBefore = await ctx.usdc.balanceOf(ctx.lenderOperating.address);
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
    await term.connect(m).payPlan(0, 2_000n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(0n);

    // The repayment went to the pool as members' money, not past it.
    expect(await pool.memberFunded()).to.be.closeTo(1_000n * ONE_USDC, 100n); // + a few wei of carry
    const apAfter = await ctx.usdc.balanceOf(ctx.lenderOperating.address);
    expect(apAfter - apBefore).to.equal(0n);

    // The merchant is paid out of it and the claim is burned; the funder keeps all its capital.
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    expect(await ctx.stableCredit.balanceOf(funder.address)).to.equal(0n);
    expect(await pool.advancedOf(funder.address)).to.equal(0n);
    expect(await pool.idleCapitalOf(funder.address)).to.equal(20_000n * ONE_USDC);
  });

  it("X-3 (fixed): a refund shortfall mints no claim to the pool, so nothing reaches the carry split", async function () {
    const { ctx, term, pool, merchant, coop } = await deployCore();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    await term.connect(m).payPlan(0, 1_000n * ONE_USDC);
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    const coopBefore = await ctx.stableCredit.balanceOf(coop.address);

    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);
    expect(await ctx.stableCredit.refundReceivableOf(merchant.address)).to.equal(975n * ONE_USDC);
    expect(await ctx.stableCredit.balanceOf(await pool.getAddress())).to.equal(0n);
    expect(await pool.refundOwedOf(m.address)).to.equal(975n * ONE_USDC);
    expect(await pool.distributableCarry()).to.equal(0n);
    await pool.connect(ctx.outsider).distributeCarry();
    // The co-op gave back its 25 fee and gained nothing.
    expect(coopBefore - (await ctx.stableCredit.balanceOf(coop.address))).to.equal(25n * ONE_USDC);
  });

  it("X-4 (fixed): a merchant's refund debt is collected out of its next sale, and that sale's repayment funds the member's refund", async function () {
    const { ctx, term, pool, merchant, member2 } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    await term.connect(m).payPlan(0, 1_000n * ONE_USDC);
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    const merchantUsdc0 = await ctx.usdc.balanceOf(merchant.address);

    const memberUsdc0 = await ctx.usdc.balanceOf(m.address);
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);

    // Next sale: the refund debt is cleared out of it instead of minting it.
    await term.connect(ctx.operator).setTermLimit(member2.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, member2.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(0n);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(0n);
    expect(await ctx.stableCredit.refundReceivableOf(merchant.address)).to.equal(0n);
    expect(await pool.redeemableOf(merchant.address)).to.equal(0n);
    await expect(pool.connect(merchant).redeem(975n * ONE_USDC))
      .to.be.revertedWithCustomError(pool, "PayoutPoolNothingToRedeem");
    expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(merchantUsdc0);

    // The second member repays, and that is what makes the first member whole.
    await term.connect(member2).payPlan(1, 1_000n * ONE_USDC);
    await pool.payRefundsOwed();
    expect((await ctx.usdc.balanceOf(m.address)) - memberUsdc0).to.equal(1_000n * ONE_USDC);
    expect(await pool.refundsOwed()).to.equal(0n);
  });

  it("X-5 (fixed): carry withheld from a refund settles that carry; the member owes nothing after, and the event reports the net cash", async function () {
    const { ctx, term, merchant } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 4, CYCLE);
    await advance(CYCLE);
    await term.connect(m).payPlan(0, 500n * ONE_USDC);
    await advance(CYCLE / 2);
    expect(await term.pendingCarryOn(0)).to.be.gt(0n);

    const usdcBefore = await ctx.usdc.balanceOf(m.address);
    const tx = await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    const rc = await tx.wait();
    const ev = rc!.logs.map((l: any) => { try { return term.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e && e.name === "PlanRefundPaid");
    const [, returned, withheld] = ev!.args;
    const cashBack = (await ctx.usdc.balanceOf(m.address)) - usdcBefore;

    expect(withheld).to.be.gt(0n);
    // X-14: the event reports what actually reached the member.
    expect(returned).to.equal(cashBack);
    // The withheld carry was settled, not left owing.
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(0n);
    expect(await term.residualCarryOf(m.address)).to.equal(0n);
    const [, , , , , , , , closed] = await term.planAt(0);
    expect(closed).to.equal(true);
  });

  it("X-6 (fixed): a term default writes off the term plan only; the revolving tier and the ledger stay in step", async function () {
    const { ctx, revolving, term, merchant } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 0n, 1_000n * ONE_USDC], 3650 * DAY, CYCLE);
    await ctx.stableCredit.connect(m).transfer(merchant.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
    await advance(3 * CYCLE + 1);
    await revolving.materialiseCarry(m.address);
    const revolvingBefore = await revolving.totalPrincipalOf(m.address);
    expect(revolvingBefore).to.be.gt(1_000n * ONE_USDC);

    await term.connect(ctx.outsider).declareDefault(m.address);
    const writtenOff = await term.writtenOffOf(m.address);
    expect(writtenOff).to.be.gt(1_000n * ONE_USDC);

    // The revolving tier is untouched (a few wei of carry in the default block aside)...
    expect(await revolving.totalPrincipalOf(m.address)).to.be.closeTo(revolvingBefore, 1_000n);
    expect(await term.totalPrincipalOf(m.address)).to.equal(0n);
    // ...and the ledger holds exactly what the revolving line tracks: no untracked residual.
    const ledger = await ctx.stableCredit.creditBalanceOf(m.address);
    expect(ledger - (await revolving.totalPrincipalOf(m.address))).to.be.lte(1_000n);
    expect(await term.residualCarryOf(m.address)).to.be.lte(1_000n);
    expect(await revolving.headroomOf(m.address, 3)).to.equal(0n);
  });

});
