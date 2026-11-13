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

  it("X-9: reserves deposited in DAI/USDT are booked as USDC; reimburse() pays only USDC and reverts -> burnLostDebt bricked", async function () {
    const ctx = await deployPhase0Network();
    const { creditIssuer, stableCredit, operator, member, counterparty, access, assurancePool, dai } = ctx;
    // 10,000 of assurance in DAI (permissionless deposit, priced at a hard-coded $1).
    await dai.mint(counterparty.address, 10_000n * 10n ** 18n);
    await dai.connect(counterparty).approve(await assurancePool.getAddress(), ethers.MaxUint256);
    await assurancePool.connect(counterparty).depositTokenIntoPrimary(await dai.getAddress(), 10_000n * 10n ** 18n);
    expect(await assurancePool.primaryBalance()).to.equal(10_000n * ONE_USDC);

    // A member defaults: lost debt is created.
    await creditIssuer.connect(operator).initializeCreditLine(member.address, 1_000n * ONE_USDC, 0, 30 * DAY, 10 * DAY);
    await access.connect(operator).grantMember(counterparty.address);
    await stableCredit.connect(member).transfer(counterparty.address, 1_000n * ONE_USDC);
    await advance(41 * DAY);
    await creditIssuer.syncCreditPeriod(member.address);
    expect(await stableCredit.lostDebt()).to.equal(1_000n * ONE_USDC);

    // The holder of the orphaned claims asks the reserve to cover them: the pool "has" 10,000 but cannot pay.
    await expect(stableCredit.connect(counterparty).burnLostDebt(counterparty.address, 1_000n * ONE_USDC))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    // With USDC in the pool instead, the same call succeeds:
    await ctx.usdc.mint(await assurancePool.getAddress(), 1_000n * ONE_USDC);
    await stableCredit.connect(counterparty).burnLostDebt(counterparty.address, 1_000n * ONE_USDC);
  });

  it("X-10: every outstanding bond adds an unbounded loop iteration to every RTD read (repayment path gas grows linearly)", async function () {
    const ctx = await deployPhase0Network();
    const { admin, operator, usdc, assurancePool, assuranceOracle, outsider } = ctx;
    const Factory = await ethers.getContractFactory("BurnerBondFactory");
    const factory: any = await Factory.deploy(await assurancePool.getAddress(), await assuranceOracle.getAddress(), "ipfs://x");
    const deposit: any = await ethers.getContractAt("BurnerBondDeposit", await factory.burnerBondDeposit());
    const BondVault = await ethers.getContractFactory("BondVault");
    const vault: any = await upgrades.deployProxy(BondVault, [admin.address, await usdc.getAddress(), 90 * DAY], { kind: "uups" });
    await deposit.setBondVault(await vault.getAddress());
    await vault.grantRole(await vault.BOND_ROLE(), await deposit.getAddress());
    await assurancePool.connect(operator).setBondVault(await vault.getAddress());

    await usdc.mint(outsider.address, 10_000_000n * ONE_USDC);
    await usdc.connect(outsider).approve(await deposit.getAddress(), ethers.MaxUint256);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;

    const gasAt: bigint[] = [];
    const measure = async () => gasAt.push(await assurancePool.depositRepayment.estimateGas(1n).catch(async () => {
      // depositRepayment needs an allowance; measure the view it is dominated by instead.
      return await assurancePool.neededReserves.estimateGas();
    }));
    await measure();
    const N = 60;
    for (let i = 0; i < N; i++) {
      // Minimum face value, maturity inside the 90-day reserve window, from an anonymous wallet.
      await deposit.connect(outsider).makeDeposit(await usdc.getAddress(), 100n * ONE_USDC, now + 60 * DAY + i, 0);
    }
    await measure();
    const perBond = (gasAt[1] - gasAt[0]) / BigInt(N);
    console.log(`      neededReserves gas: ${gasAt[0]} -> ${gasAt[1]} with ${N} bonds (~${perBond}/bond)`);
    console.log(`      bonds to exceed a 16.7M tx cap: ~${16_777_216n / perBond}, i.e. ~$${(16_777_216n / perBond) * 100n} of $100 bonds`);
    expect(perBond).to.be.gt(1_500n);
    expect(await vault.outstandingCount()).to.equal(BigInt(N));
  });

  it("X-11: CarryIndex.rpow overflows at the 50%/cycle cap after 131 cycles (~10.8y) -> every touch of that position reverts", async function () {
    const H = await ethers.getContractFactory("CarryIndexHarness");
    const h: any = await H.deploy();
    const key = ethers.encodeBytes32String("k");
    await h.initIndex(key, 5_000n, CYCLE, 0);
    await h.currentIndex(key, 130n * BigInt(CYCLE)); // fine
    await expect(h.currentIndex(key, 131n * BigInt(CYCLE))).to.be.revertedWithPanic(0x11);
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
