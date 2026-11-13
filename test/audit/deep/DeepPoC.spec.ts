import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCore, advance, ONE_USDC, CYCLE, DAY, NET_30 } from "./deep-setup";

/*
 * Deep-pass audit proofs of concept. Every test PASSES while the issue it describes exists.
 */
describe("DEEP AUDIT PoC", function () {
  it("X-1: a refund of a paid plan also forgives the member's unrelated revolving debt (double refund)", async function () {
    const { ctx, revolving, term, pool, merchant } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    // An ordinary member: a revolving INCOME line, used at a registered merchant...
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 365 * DAY, CYCLE);
    await ctx.stableCredit.connect(m).transfer(merchant.address, 1_000n * ONE_USDC);
    // ...and a 1,000 term purchase, paid off in full.
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).openPlan(m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
    await term.connect(m).payPlan(0, 2_000n * ONE_USDC); // capped at what is owed: closes the plan
    // Merchant redeems everything it holds (the normal case before a refund arrives).
    await pool.connect(merchant).redeem(ethers.MaxUint256);
    expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(0n);

    const owedBefore = await ctx.stableCredit.creditBalanceOf(m.address);
    expect(owedBefore).to.be.closeTo(1_000n * ONE_USDC, 100n); // the revolving debt (+ a few wei of carry)
    const usdcBefore = await ctx.usdc.balanceOf(m.address);

    // The merchant accepts a return; the operator processes the refund of the paid plan.
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);

    const cashBack = (await ctx.usdc.balanceOf(m.address)) - usdcBefore;
    const owedAfter = await ctx.stableCredit.creditBalanceOf(m.address);
    // Member got the full 1,000 in cash...
    expect(cashBack).to.equal(1_000n * ONE_USDC);
    // ...AND 975 of their unrelated revolving debt moved onto the merchant.
    expect(owedAfter).to.equal(owedBefore - 975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);
    // The revolving issuer was never told: it still books 1,000 of principal and keeps charging carry on it.
    expect(await revolving.totalPrincipalOf(m.address)).to.be.gte(1_000n * ONE_USDC);
    // Total relief: 1,975 for a 1,000 purchase.
    expect(cashBack + (owedBefore - owedAfter)).to.equal(1_975n * ONE_USDC);
  });

  it("X-2: a pre-funded PayoutPool diverts member repayments to the AssurancePool; funders end up holding claims nobody owes", async function () {
    const { ctx, term, pool, merchant, funder } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    const apBefore = (await ctx.assurancePool.primaryBalance()) + (await ctx.assurancePool.bufferBalance());

    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).openPlan(m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
    // Member pays the plan in full, in cash.
    await term.connect(m).payPlan(0, 2_000n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(0n);

    // _payoutPoolNeeds() = totalSupply - held = 1,000 - 20,000 -> 0: the whole repayment skipped the pool.
    expect(await pool.memberFunded()).to.equal(0n);
    const apAfter = (await ctx.assurancePool.primaryBalance()) + (await ctx.assurancePool.bufferBalance());
    expect(apAfter - apBefore).to.be.closeTo(1_000n * ONE_USDC, 100n);

    // Merchant redeems: paid out of the funder's capital, so the position is "sold" to the funder.
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    expect(await ctx.stableCredit.balanceOf(funder.address)).to.equal(975n * ONE_USDC);
    expect(await pool.advancedOf(funder.address)).to.equal(975n * ONE_USDC);
    // ...a claim on a member who owes nothing. Nobody will ever repay it.
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(0n);
    // The funder can only take back 19,025 of its 20,000.
    expect(await pool.idleCapitalOf(funder.address)).to.equal(19_025n * ONE_USDC);
    // The funder is not a ledger member, so it cannot even redeem the dead position.
    await expect(pool.connect(funder).redeem(975n * ONE_USDC)).to.be.reverted;

    // Same flow with an EMPTY pool settles cleanly (claim burned, nothing stranded) -- the funding is the trigger.
  });

  it("X-3: a refund shortfall minted to the PayoutPool is untracked and is handed out as 'carry'", async function () {
    const { ctx, term, pool, merchant, coop } = await deployCore();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).openPlan(m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    await term.connect(m).payPlan(0, 1_000n * ONE_USDC);       // empty pool: the cash lands as memberFunded
    expect(await pool.memberFunded()).to.equal(1_000n * ONE_USDC);
    await pool.connect(merchant).redeem(975n * ONE_USDC);       // settled out of the member's cash, claim burned
    expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(0n);
    const coopBefore = await ctx.stableCredit.balanceOf(coop.address); // the 25 fee

    // Full refund. Merchant already paid -> _takeBack mints 975 to the PayoutPool against a new merchant obligation.
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);
    expect(await ctx.stableCredit.balanceOf(await pool.getAddress())).to.equal(975n * ONE_USDC);
    // The pool paid what cash it had (25) and owes the member the rest.
    expect(await pool.refundOwedOf(m.address)).to.equal(975n * ONE_USDC);
    // That 975 claim is the pool's own IOU for the refund it fronted -- but nothing tracks it, so it reads as carry.
    expect(await pool.inFlight()).to.equal(0n);
    expect(await pool.carryEarned()).to.equal(0n);
    expect(await pool.distributableCarry()).to.equal(975n * ONE_USDC);
    await pool.connect(ctx.outsider).distributeCarry();          // permissionless
    // ...and the co-op now holds it as income, redeemable for USDC like any claim.
    expect((await ctx.stableCredit.balanceOf(coop.address)) - coopBefore).to.equal(950n * ONE_USDC); // 975 carry - 25 fee taken back
    expect(await ctx.stableCredit.balanceOf(await pool.getAddress())).to.equal(0n);
    // The member's refund (975) and the co-op's new claim (975) are both "backed" by the same merchant obligation.
    expect(await pool.refundOwedOf(m.address)).to.equal(975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);
  });

  it("X-4: merchant refund obligations never net: purchases mint to the merchant, so it keeps redeeming while it owes", async function () {
    const { ctx, term, pool, merchant, member2 } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).openPlan(m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    await term.connect(m).payPlan(0, 1_000n * ONE_USDC);
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    const merchantUsdc0 = await ctx.usdc.balanceOf(merchant.address);
    expect(merchantUsdc0).to.equal(1_000_000n * ONE_USDC + 975n * ONE_USDC);

    // Goods returned; member is refunded in cash from the pool. The merchant is left owing 975 on the ledger,
    // which the code relies on being "netted from what they are paid next" (_afterTransfer).
    const memberUsdc0 = await ctx.usdc.balanceOf(m.address);
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    expect((await ctx.usdc.balanceOf(m.address)) - memberUsdc0).to.equal(1_000n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);

    // Next sale. originatePurchase -> _accrueCredit -> _mint: no _afterTransfer, no netting.
    await term.connect(ctx.operator).setTermLimit(member2.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).openPlan(member2.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC); // still owes
    expect(await pool.redeemableOf(merchant.address)).to.equal(975n * ONE_USDC);
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    // The merchant has been paid 975 twice, the member refunded 1,000, and the obligation is never collected:
    expect((await ctx.usdc.balanceOf(merchant.address)) - merchantUsdc0).to.equal(975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);
    // No issuer tracks it, it accrues nothing and nothing can default it.
  });

  it("X-5: carry withheld from a refund is never settled against the ledger -- the member pays it twice", async function () {
    const { ctx, term, merchant } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).openPlan(m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 4, CYCLE);
    await advance(CYCLE);
    await term.connect(m).payPlan(0, 500n * ONE_USDC);
    await advance(CYCLE / 2);
    const pendingCarry = await term.pendingCarryOn(0);
    expect(pendingCarry).to.be.gt(0n);

    const usdcBefore = await ctx.usdc.balanceOf(m.address);
    const tx = await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    const rc = await tx.wait();
    const ev = rc!.logs.map((l: any) => { try { return term.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e && e.name === "PlanRefundPaid");
    const [, returned, withheld] = ev!.args;
    const cashBack = (await ctx.usdc.balanceOf(m.address)) - usdcBefore;

    // NB: the event's "returned" field is the GROSS cash, before the withholding.
    expect(withheld).to.be.gt(0n);
    // Withheld from the cash...
    expect(cashBack + withheld).to.equal(returned);
    // ...and STILL owed on the ledger, as residual carry that no plan tracks.
    const owed = await ctx.stableCredit.creditBalanceOf(m.address);
    expect(owed).to.equal(withheld);
    expect(await term.residualCarryOf(m.address)).to.equal(withheld);
    const [, , , , , , , , closed] = await term.planAt(0);
    expect(closed).to.equal(true);
  });

  it("X-6: a (permissionless) term default is written off against the revolving BOOST tier first", async function () {
    const { ctx, revolving, term, merchant } = await deployCore({ fundPool: 20_000n * ONE_USDC });
    const m = ctx.member;
    // Revolving BOOST line (300 bps), long rebalance period so the revolving side stays in good standing.
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 0n, 1_000n * ONE_USDC], 3650 * DAY, CYCLE);
    await ctx.stableCredit.connect(m).transfer(merchant.address, 1_000n * ONE_USDC);
    // A cheaper (150 bps) term plan the member then stops paying.
    await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).openPlan(m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
    await advance(3 * CYCLE + 1);
    await revolving.materialiseCarry(m.address);
    const revolvingBefore = await revolving.totalPrincipalOf(m.address);
    expect(revolvingBefore).to.be.gt(1_000n * ONE_USDC);

    await term.connect(ctx.outsider).declareDefault(m.address);
    const writtenOff = await term.writtenOffOf(m.address);

    // The write-off was meant to clear the TERM plan. It cleared the revolving BOOST tier instead.
    const revolvingAfter = await revolving.totalPrincipalOf(m.address);
    expect(revolvingAfter).to.be.closeTo(revolvingBefore - writtenOff, 1_000n); // a few wei of carry in the default block
    expect(await term.totalPrincipalOf(m.address)).to.equal(0n);
    // The ledger still holds (roughly) the revolving debt -- now tracked by NO issuer: no carry, no default sizing.
    const ledger = await ctx.stableCredit.creditBalanceOf(m.address);
    expect(ledger).to.be.gt(1_000n * ONE_USDC);
    expect(ledger - revolvingAfter).to.be.closeTo(writtenOff, 1_000n); // untracked residual == the misdirected write-off
    console.log("      revolving principal before:", revolvingBefore, "term written off:", writtenOff, "ledger after:", ledger);
    expect(await term.residualCarryOf(m.address)).to.be.closeTo(writtenOff, 1_000n);
    // Revolving headroom is "free" again from the issuer's point of view.
    expect(await revolving.headroomOf(m.address, 3)).to.be.gt(900n * ONE_USDC);
    // Later, when the revolving period ends, its own write-off sizes from drawn: only revolvingAfter is
    // written off; `writtenOff` of real debt never enters lostDebt and the claims it backs stay outstanding.
    expect(await revolving.totalDrawnOf(m.address)).to.be.closeTo(revolvingAfter, 10n);
  });

  it("X-7: LendingPool depositors front-run a loss by queueing a withdrawal and push it onto the others", async function () {
    const [admin, a, b, borrower, reporter] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc: any = await MockERC20.deploy("USDC", "USDC", 6);
    const LP = await ethers.getContractFactory("LendingPool");
    const lp: any = await upgrades.deployProxy(LP, [admin.address, await usdc.getAddress(), "Yield", "yUSDC"], { kind: "uups" });
    await lp.grantRole(await lp.BORROWER_ROLE(), borrower.address);
    await lp.grantRole(await lp.LOSS_REPORTER_ROLE(), reporter.address);
    for (const w of [a, b]) {
      await usdc.mint(w.address, 1_000n * ONE_USDC);
      await usdc.connect(w).approve(await lp.getAddress(), ethers.MaxUint256);
      await lp.connect(w).deposit(1_000n * ONE_USDC, w.address);
    }
    await lp.connect(borrower).borrow(1_500n * ONE_USDC, borrower.address); // only 500 cash left
    // A sees a default coming (TermIssuer.declareDefault / CreditIssuer expiry are public) and queues first.
    // No cash is needed to queue: the request just locks today's share price.
    await lp.connect(a).requestWithdrawal(await lp.balanceOf(a.address), a.address);
    await lp.connect(reporter).absorbLoss(1_000n * ONE_USDC);
    // B absorbs the WHOLE 1,000 loss; A's claim is still 1,000.
    const [, , aAssets] = await lp.requestAt(0);
    expect(aAssets).to.be.closeTo(1_000n * ONE_USDC, 1n);
    expect(await lp.previewRedeem(await lp.balanceOf(b.address))).to.equal(0n);
    // and A is paid out of the cash B left in the pool.
    await usdc.mint(await lp.getAddress(), 500n * ONE_USDC); // e.g. a later repayment
    await lp.connect(a).claimWithdrawal(0);
    expect(await usdc.balanceOf(a.address)).to.be.closeTo(1_000n * ONE_USDC, 1n);
  });
});
