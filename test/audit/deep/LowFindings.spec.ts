import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCore, advance, ONE_USDC, CYCLE } from "./deep-setup";
import { signedOpenPlan } from "../../helpers/plans";
import { issuerProxyOptions } from "../../helpers/issuers";

/*
 * Regression tests for the credit core's Low findings fixed in Phase 1 step 8.
 */
describe("AUDIT credit Lows: L-1, L-2, L-7, L-8", function () {
  it("L-1 (fixed): the bare implementations of the ledger and the issuers cannot be initialized", async function () {
    const { ctx } = await deployCore();
    for (const [name, args] of [
      ["ClearCredit", ["x", "x", ctx.admin.address]],
      ["RevolvingIssuer", [await ctx.stableCredit.getAddress(), ctx.admin.address]],
      ["TermIssuer", [await ctx.stableCredit.getAddress(), ctx.admin.address]],
      ["OffersIssuer", [await ctx.stableCredit.getAddress(), ctx.admin.address, 1n, 1n]],
      ["AssurancePool", [await ctx.stableCredit.getAddress(), await ctx.usdc.getAddress()]],
    ] as [string, any[]][]) {
      const F = await ethers.getContractFactory(name);
      // The issuers take their delegatecall modules as constructor arguments (EIP-3860).
      const ctorArgs = name === "TermIssuer" || name === "RevolvingIssuer"
        ? (await issuerProxyOptions(name)).constructorArgs
        : [];
      const impl: any = await F.deploy(...ctorArgs);
      await expect(impl.initialize(...args)).to.be.revertedWith("Initializable: contract is already initialized");
    }
  });

  it("L-2 (fixed): a holder cannot burn a claim", async function () {
    const { ctx, revolving, merchant } = await deployCore();
    await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 0n, 1_000n * ONE_USDC, 0n], 0, CYCLE);
    await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 100n * ONE_USDC);
    await expect(ctx.stableCredit.connect(merchant).burn(1n))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditBurnDisabled");
    await ctx.stableCredit.connect(merchant).approve(ctx.member.address, 1n);
    await expect(ctx.stableCredit.connect(ctx.member).burnFrom(merchant.address, 1n))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditBurnDisabled");
  });

  it("L-7 (fixed): closed plans drop out of the member's open-plan index", async function () {
    const { ctx, term, merchant } = await deployCore();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 10_000n * ONE_USDC);
    for (let i = 0; i < 5; i++) {
      await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 100n * ONE_USDC, 97n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    }
    expect((await term.openPlansOf(m.address)).length).to.equal(5);
    for (const id of [0, 2, 4]) await term.connect(m).payPlan(id, 100n * ONE_USDC);
    const open = (await term.openPlansOf(m.address)).map((x: bigint) => Number(x)).sort();
    expect(open).to.deep.equal([1, 3]);
    expect(await term.totalPrincipalOf(m.address)).to.equal(200n * ONE_USDC);
  });

  it("L-7 (fixed): refunds owed can be paid a page at a time", async function () {
    const { ctx, term, pool, merchant, member2, member3 } = await deployCore();
    for (const m of [ctx.member, member2, member3]) {
      await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
    }
    let id = 0;
    for (const m of [ctx.member, member2, member3]) {
      await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 100n * ONE_USDC, 100n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
      await term.connect(m).payPlan(id, 100n * ONE_USDC);
      await pool.connect(merchant).redeem(100n * ONE_USDC);
      id++;
    }
    for (let i = 0; i < 3; i++) {
      await term.connect(ctx.operator).closePlanForRefund(i, 100n * ONE_USDC, merchant.address, 100n * ONE_USDC);
    }
    expect(await pool.refundsOwed()).to.equal(300n * ONE_USDC);
    // Members' money arrives: the merchant pays back what it owes.
    await ctx.stableCredit.connect(merchant).repayCreditBalance(merchant.address, 300n * ONE_USDC);
    await pool.payRefundsOwedUpTo(1);
    expect(await pool.refundsOwed()).to.equal(200n * ONE_USDC);
    await pool.payRefundsOwedUpTo(5);
    expect(await pool.refundsOwed()).to.equal(0n);
  });

  it("L-8 (fixed): the ledger refuses a zero address where zero is not an off switch", async function () {
    const { ctx, pool } = await deployCore();
    for (const fn of ["setAccessManager", "setAssurancePool", "setNetworkRegistry", "setMerchantRegistry"]) {
      await expect((ctx.stableCredit.connect(ctx.admin) as any)[fn](ethers.ZeroAddress))
        .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditInvalidAddress");
    }
    // And the payout pool's money-routing settings are the admin's, not an operator key's (H-4).
    const op = (await ethers.getSigners())[16];
    await pool.grantRole(await pool.OPERATOR_ROLE(), op.address);
    await expect(pool.connect(op).setCoopTreasury(op.address)).to.be.reverted;
    await expect(pool.connect(op).setCoopIncomeRecipient(op.address)).to.be.reverted;
    await expect(pool.connect(op).setLenders(op.address, op.address)).to.be.reverted;
  });

  it("X-11 (fixed): a position at the rate ceiling for years can still be touched", async function () {
    const { ctx, revolving, merchant } = await deployCore();
    await revolving.connect(ctx.admin).setTierRate(3, 5_000n);
    await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 0n, 0n, 100n * ONE_USDC], 3650 * 24 * 3600, CYCLE);
    await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 1n);
    await advance(140 * CYCLE);
    await revolving.materialiseCarry(ctx.member.address);
    expect(await revolving.drawnOf(ctx.member.address, 3)).to.be.gt(0n);
  });
});
