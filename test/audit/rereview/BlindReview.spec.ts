import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCore, advance } from "../deep/deep-setup";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { issuerProxyOptions } from "../../helpers/issuers";
import { signedOpenPlan } from "../../helpers/plans";
import { CA, NY, P, CA_BANDS, ONE_USDC, CYCLE, DAY, params, deployRateSchedule } from "../compliance/rates";

/*
 * Phase 4 re-review: the findings of the blind review (`docs/audit/rereview/BLIND-REVIEW.md`)
 * that were confirmed and fixed. Each test was first run against `dev` at 8bd2f75, where it
 * failed the way the finding describes (the reproduction); it passes on the fix.
 */

const PARTNER = P("PARTNER");
const CASH = P("CASH");
const GRACE = 5 * DAY;

/** Term plans priced from a RateSchedule, as Term.spec sets them up. */
async function termWithPricing(over: Partial<Record<string, any>> = {}) {
  const core = await deployCore();
  const { ctx, term, member2 } = core;
  const rates = await deployRateSchedule(ctx.admin.address);
  await rates.setProduct(CA, PARTNER, params({ listMonthlyBps: 200, freeBelowAmount: 50n * ONE_USDC }), CA_BANDS);
  await rates.setProduct(CA, CASH, params({ listMonthlyBps: 250, annualCapBps: 2_000, ...over }), CA_BANDS);
  await term.connect(ctx.admin).setRateSchedule(await rates.getAddress());
  await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
  for (const m of [ctx.member, member2]) {
    await ctx.networkRegistry.attestStateCode(m.address, CA);
    await term.connect(ctx.operator).setTermLimit(m.address, 10_000n * ONE_USDC);
  }
  return { ...core, rates };
}

/** Opens a plan at the rate and payout the chain computes, signed by the member. */
async function openPriced(core: any, member: any, purchase: bigint, installments: number, rate: bigint, product = PARTNER) {
  const { term, merchant, ctx } = core;
  const payout = purchase - (purchase * 250n) / 10_000n; // the merchant's registered discount
  return signedOpenPlan(term, ctx.operator, member.address, merchant.address, purchase, payout, rate, CYCLE, installments, CYCLE, product);
}

async function payDue(term: any, member: any, planId: number) {
  const due = (await term.scheduledPrincipalDue(planId)) - (await term.planAt(planId)).repaid;
  if (due > 0n) await term.connect(member).payPlan(planId, due);
}

describe("PHASE 4 re-review: blind-review findings (fixed)", function () {
  describe("H-A: a refund is taken back from the plan's own merchant, at the payout recorded when it opened", function () {
    it("a paid plan cannot be refunded against a stranger: no debt is created on them and no cash leaves", async function () {
      const core = await termWithPricing();
      const { term, ctx, attacker, pool } = core;
      await openPriced(core, ctx.member, 1_000n * ONE_USDC, 1, 0n); // In full: free
      await term.connect(ctx.member).payPlan(0, 1_000n * ONE_USDC);
      const poolUsdc = await ctx.usdc.balanceOf(await pool.getAddress());
      await expect(term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, attacker.address, 1_000n * ONE_USDC))
        .to.be.revertedWithCustomError(term, "TermIssuerRefundTermsMismatch");
      expect(await ctx.stableCredit.creditBalanceOf(attacker.address)).to.equal(0n);
      expect(await ctx.usdc.balanceOf(await pool.getAddress())).to.equal(poolUsdc);
    });

    it("an unpaid plan's obligation cannot be moved onto a stranger", async function () {
      const core = await termWithPricing();
      const { term, ctx, attacker } = core;
      await openPriced(core, ctx.member, 1_000n * ONE_USDC, 1, 0n);
      await expect(term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, attacker.address, 1_000n * ONE_USDC))
        .to.be.revertedWithCustomError(term, "TermIssuerRefundTermsMismatch");
      expect(await ctx.stableCredit.creditBalanceOf(attacker.address)).to.equal(0n);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);
    });

    it("the split comes from the recorded payout: a caller passing payout = 0 cannot push the merchant's share onto the co-op", async function () {
      const core = await termWithPricing();
      const { term, ctx, merchant, coop } = core;
      await openPriced(core, ctx.member, 1_000n * ONE_USDC, 1, 0n);
      const merchantBefore = await ctx.stableCredit.balanceOf(merchant.address);
      const coopBefore = await ctx.stableCredit.balanceOf(coop.address);
      await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 0n);
      // The merchant gives back its $975 payout and the co-op its $25 discount -- and nobody is
      // left owing anything.
      expect(merchantBefore - (await ctx.stableCredit.balanceOf(merchant.address))).to.equal(975n * ONE_USDC);
      expect(coopBefore - (await ctx.stableCredit.balanceOf(coop.address))).to.equal(25n * ONE_USDC);
      expect(await ctx.stableCredit.creditBalanceOf(coop.address)).to.equal(0n);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
      expect((await term.pricingOf(0)).payout).to.equal(975n * ONE_USDC);
    });
  });

  describe("H-B: an unsigned operator re-split can only lengthen a plan, never at a higher installment", function () {
    it("the operator cannot shorten a charged In-12 plan to In full and set up a default", async function () {
      const core = await termWithPricing();
      const { term, ctx, rates } = core;
      const purchase = 1_200n * ONE_USDC;
      const rate = await rates.effectiveMonthlyBps(CA, PARTNER, purchase);
      await openPriced(core, ctx.member, purchase, 12, rate);
      await advance(CYCLE);
      await payDue(term, ctx.member, 0);
      expect(await term.arrearsOf(0)).to.equal(0n);
      await expect(term.connect(ctx.operator).setSplit(0, 1)).to.be.revertedWithCustomError(term, "TermIssuerResplitShortens");
      await expect(term.connect(ctx.operator).setSplit(0, 6)).to.be.revertedWithCustomError(term, "TermIssuerResplitShortens");
      // A cycle later the member is still current and owes one ordinary installment.
      await advance(CYCLE);
      await payDue(term, ctx.member, 0);
      expect(await term.arrearsOf(0)).to.equal(0n);
    });

    it("on a free plan the operator may spread the rest further (lower installment, no new arrears), never squeeze it", async function () {
      const core = await termWithPricing();
      const { term, ctx } = core;
      await openPriced(core, ctx.member, 40n * ONE_USDC, 4, 0n); // under freeBelowAmount: free
      await advance(CYCLE);
      await payDue(term, ctx.member, 0);
      const [before] = await term.scheduleOf(0);
      await expect(term.connect(ctx.operator).setSplit(0, 2)).to.be.revertedWithCustomError(term, "TermIssuerResplitShortens");
      await term.connect(ctx.operator).setSplit(0, 12);
      const [after] = await term.scheduleOf(0);
      expect(after).to.be.lt(before);
      expect(await term.arrearsOf(0)).to.equal(0n);
      await advance(CYCLE - DAY);
      expect(await term.arrearsOf(0)).to.equal(0n);
    });

    it("the member may still choose a shorter split themselves", async function () {
      const core = await termWithPricing();
      const { term, ctx } = core;
      await openPriced(core, ctx.member, 40n * ONE_USDC, 4, 0n);
      await term.connect(ctx.member).setSplit(0, 1);
      expect((await term.scheduleOf(0))[2]).to.equal(1n);
    });
  });

  describe("H-C: the revolving line is judged on its own positions", function () {
    it("a member current on a term plan, who never drew the revolving line, earns Clean Cycles and never defaults", async function () {
      const core = await deployCore();
      const { ctx, revolving, term, merchant, coop } = core;
      await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 0n, 1_000n * ONE_USDC, 0n], CYCLE, GRACE);
      await term.connect(ctx.operator).setTermLimit(ctx.member.address, 2_000n * ONE_USDC);
      await signedOpenPlan(term, ctx.operator, ctx.member.address, merchant.address, 1_200n * ONE_USDC, 1_170n * ONE_USDC, 150n, CYCLE, 12, CYCLE);
      for (let cycle = 1; cycle <= 3; cycle++) {
        await advance(CYCLE + GRACE + 1);
        await payDue(term, ctx.member, 0);
        expect(await term.arrearsOf(0)).to.equal(0n);
        await revolving.connect(coop).syncCreditPeriod(ctx.member.address);
        const c = await revolving.cycleOf(ctx.member.address);
        expect(c.missedInRow, `cycle ${cycle}`).to.equal(0n);
        expect(c.cleanStreak, `cycle ${cycle}`).to.equal(BigInt(cycle));
      }
      expect(await revolving.hasDefaulted(ctx.member.address)).to.equal(false);
      expect(await revolving.inCompliance(ctx.member.address)).to.equal(true);
      // The line is still the member's: capacity untouched, membership intact.
      expect(await revolving.headroomOf(ctx.member.address, 2)).to.equal(1_000n * ONE_USDC);
    });

    it("an undrawn revolving balance still has to be rebalanced: a revolving draw left unpaid misses the cycle", async function () {
      const core = await deployCore();
      const { ctx, revolving, merchant, coop } = core;
      await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 0n, 1_000n * ONE_USDC, 0n], CYCLE, GRACE);
      await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 100n * ONE_USDC);
      await advance(CYCLE + GRACE + 1);
      await revolving.connect(coop).syncCreditPeriod(ctx.member.address);
      expect((await revolving.cycleOf(ctx.member.address)).missedInRow).to.equal(1n);
    });
  });

  describe("M-A: one signer cannot keep a pause going, and the window has a ceiling", function () {
    async function clrusdStack() {
      const ctx = await deployPhase0Network();
      const [, , , , , , , , , fraudA, fraudB] = await ethers.getSigners();
      const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
      const clrusd: any = await upgrades.deployProxy(ClearUSD,
        ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      await clrusd.grantRole(await clrusd.MINTER_ROLE(), ctx.admin.address);
      await clrusd.mint(ctx.member.address, 100n * ONE_USDC);
      for (const role of [await clrusd.FRAUD_ROLE(), await clrusd.SECURITY_ROLE()]) {
        await clrusd.grantRole(role, fraudA.address);
        await clrusd.grantRole(role, fraudB.address);
      }
      const Vault = await ethers.getContractFactory("ESADepositVault");
      const vault: any = await upgrades.deployProxy(Vault, [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
      await vault.grantRole(await vault.PAUSER_ROLE(), fraudA.address);
      await vault.grantRole(await vault.PAUSER_ROLE(), fraudB.address);
      return { ctx, clrusd, vault, fraudA, fraudB };
    }

    it("CLRUSD account pause: the same signer cannot re-pause after a lapse, or unpause and pause again", async function () {
      const { ctx, clrusd, fraudA, fraudB } = await clrusdStack();
      const m = ctx.member.address;
      await clrusd.connect(fraudA).pauseAccount(m, 1);
      await advance(72 * 3600 + 1);
      expect(await clrusd.pausedUntil(m)).to.equal(0n);
      await expect(clrusd.connect(fraudA).pauseAccount(m, 1)).to.be.revertedWithCustomError(clrusd, "ClearUSDSameSigner");
      // A second signer may.
      await clrusd.connect(fraudB).pauseAccount(m, 2);
      await clrusd.connect(fraudB).unpauseAccount(m);
      await expect(clrusd.connect(fraudB).pauseAccount(m, 2)).to.be.revertedWithCustomError(clrusd, "ClearUSDSameSigner");
      await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 1n);
      // After the cool-down a signer may act alone again.
      await advance(Number(await clrusd.REPAUSE_COOLDOWN()));
      await clrusd.connect(fraudA).pauseAccount(m, 3);
    });

    it("CLRUSD security pause follows the same rule", async function () {
      const { clrusd, fraudA, fraudB } = await clrusdStack();
      await clrusd.connect(fraudA).pauseForSecurity(1);
      await advance(72 * 3600 + 1);
      await expect(clrusd.connect(fraudA).pauseForSecurity(1)).to.be.revertedWithCustomError(clrusd, "ClearUSDSameSigner");
      await clrusd.connect(fraudB).pauseForSecurity(2);
      await clrusd.connect(fraudB).unpauseSecurity();
      await expect(clrusd.connect(fraudB).pauseForSecurity(2)).to.be.revertedWithCustomError(clrusd, "ClearUSDSameSigner");
    });

    it("the pause window is capped at 72 hours, on CLRUSD and on the vault", async function () {
      const { clrusd, vault } = await clrusdStack();
      for (const c of [clrusd, vault]) {
        const err = c === clrusd ? "ClearUSDPauseWindowTooLong" : "ESADepositVaultPauseWindowTooLong";
        await expect(c.setPauseWindow(100n * 365n * 86_400n)).to.be.revertedWithCustomError(c, err);
        await expect(c.setPauseWindow(72 * 3600 + 1)).to.be.revertedWithCustomError(c, err);
        await c.setPauseWindow(24 * 3600);
        await c.setPauseWindow(72 * 3600);
      }
    });

    it("vault pause: the same signer cannot re-pause after a lapse, or unpause and pause again", async function () {
      const { vault, fraudA, fraudB } = await clrusdStack();
      await vault.connect(fraudA).pause();
      await advance(72 * 3600 + 1);
      expect(await vault.paused()).to.equal(false);
      await expect(vault.connect(fraudA).pause()).to.be.revertedWithCustomError(vault, "ESADepositVaultSameSigner");
      await vault.connect(fraudB).pause();
      expect(await vault.paused()).to.equal(true);
      await vault.connect(fraudB).unpause();
      await expect(vault.connect(fraudB).pause()).to.be.revertedWithCustomError(vault, "ESADepositVaultSameSigner");
      // An active pause is extended only by a second signer's renewal.
      await vault.connect(fraudA).pause();
      await expect(vault.connect(fraudA).pause()).to.be.revertedWithCustomError(vault, "ESADepositVaultSameSigner");
      await vault.connect(fraudB).renewPause();
    });
  });

  describe("M-B: pricing turned on, or a state's products launched, under open positions", function () {
    async function revolvingStack(priced: boolean) {
      const ctx = await deployPhase0Network();
      const coop = (await ethers.getSigners())[8];
      const R = await ethers.getContractFactory("RevolvingIssuer");
      const revolving: any = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
      await ctx.networkRegistry.registerIssuer(await revolving.getAddress(), await ctx.stableCredit.getAddress());
      await ctx.access.grantOperator(await revolving.getAddress());
      for (const [name, rate] of [["SAVINGS", 0n], ["INCOME", 150n], ["BOOST", 300n]] as const) {
        await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, CYCLE);
      }
      const rates = await deployRateSchedule(ctx.admin.address);
      await rates.setProduct(CA, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
      await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 300 }), CA_BANDS);
      await rates.setProduct(CA, P("REVOLVING"), params({ listMonthlyBps: 0 }), CA_BANDS);
      await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
      await ctx.networkRegistry.attestStateCode(ctx.member.address, CA);
      const price = async () => {
        await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
        await revolving.connect(ctx.operator).setTierProduct(1, P("INCOME"));
        await revolving.connect(ctx.operator).setTierProduct(2, P("BOOST"));
      };
      if (priced) await price();
      await ctx.usdc.mint(ctx.member.address, 10_000n * ONE_USDC);
      await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
      return { ctx, revolving, rates, price };
    }

    it("pricing set while members hold balances: positions stay readable and repayable, and carry is never over the cap", async function () {
      const { ctx, revolving, price } = await revolvingStack(false);
      await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 1_000n * ONE_USDC, 500n * ONE_USDC], 365 * DAY, CYCLE);
      await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, 1_500n * ONE_USDC);
      await advance(10 * DAY);
      await price();
      await advance(CYCLE);
      await revolving.drawnOf(ctx.member.address, 1);
      await revolving.drawnOf(ctx.member.address, 2);
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, 100n * ONE_USDC);
      // Re-snapshotted on that touch: from now on the schedule prices it, under the member ceiling.
      await advance(CYCLE);
      await revolving.materialiseCarry(ctx.member.address);
      const carry = (await revolving.carryOf(ctx.member.address, 1)) + (await revolving.carryOf(ctx.member.address, 2));
      expect(carry).to.be.gt(0n);
      expect(carry).to.be.lte(30_000_000n); // under the graduated cap on $1,500 for two months of carry at most
      expect(await revolving.totalPrincipalOf(ctx.member.address)).to.equal(await ctx.stableCredit.creditBalanceOf(ctx.member.address));
    });

    it("a member re-attested to a state whose products launch later can still repay", async function () {
      const { ctx, revolving, rates } = await revolvingStack(true);
      await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 1_000n * ONE_USDC, 0n], 365 * DAY, CYCLE);
      await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, 500n * ONE_USDC);
      await advance(CYCLE);
      await ctx.networkRegistry.attestStateCode(ctx.member.address, NY);
      await revolving.materialiseCarry(ctx.member.address); // snapshotted under NY, which has no products yet
      await advance(CYCLE);
      await rates.setProduct(NY, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
      await rates.setProduct(NY, P("REVOLVING"), params({ listMonthlyBps: 0 }), CA_BANDS);
      await advance(CYCLE);
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, 100n * ONE_USDC);
      await revolving.materialiseCarry(ctx.member.address);
      expect(await revolving.totalPrincipalOf(ctx.member.address)).to.equal(await ctx.stableCredit.creditBalanceOf(ctx.member.address));
    });

    it("the RateSchedule an issuer prices from is set once (it upgrades in place instead)", async function () {
      const { ctx, revolving, rates } = await revolvingStack(true);
      const other = await deployRateSchedule(ctx.admin.address);
      // Naming the same schedule again is a no-op; another schedule, or another ceiling, is refused.
      await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
      await expect(revolving.connect(ctx.operator).setPricing(await other.getAddress(), P("REVOLVING")))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPricingSet");
      await expect(revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("OTHER")))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPricingSet");
      const core = await termWithPricing();
      await core.term.connect(core.ctx.admin).setRateSchedule(await core.rates.getAddress());
      await expect(core.term.connect(core.ctx.admin).setRateSchedule(await other.getAddress()))
        .to.be.revertedWithCustomError(core.term, "TermIssuerRateScheduleSet");
    });
  });

  describe("M-D: a large term plan never accrues above annualCapBps", function () {
    it("$3,000 Clear Cash over 13 cycles with a 20% annual cap: a year of carry is at most 20%, and the disclosed rate is under it", async function () {
      const core = await termWithPricing();
      const { term, ctx } = core;
      const purchase = 3_000n * ONE_USDC;
      // A 30-day cycle at the annual cap: 2,000 x 30 / 365 = 164 bps (2,000 / 12 = 166 would be 20.2% a year).
      const rate = (2_000n * 30n) / 365n;
      await openPriced(core, ctx.member, purchase, 13, rate, CASH);
      expect((await term.planAt(0)).ratePerCycle).to.equal(rate);
      expect((rate * 365n) / 30n).to.be.lte(2_000n);
      await advance(365 * DAY);
      await term.materialiseCarry(0);
      const carry = await term.carryOutstandingOf(0);
      // The cap for exactly the time elapsed (a year, plus the seconds the test's blocks took).
      const elapsed = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) - (await term.planAt(0)).openedAt;
      expect(carry).to.be.lte((purchase * 2_000n * elapsed) / (10_000n * 365n * 86_400n));
      expect(carry).to.be.closeTo((purchase * 2_000n) / 10_000n, 10_000n);
    });

    it("below the large-loan threshold a term plan is still charged the monthly rate per 30-day cycle (section 12.9)", async function () {
      const core = await termWithPricing();
      const { term, ctx, rates } = core;
      const purchase = 940n * ONE_USDC;
      await openPriced(core, ctx.member, purchase, 4, await rates.effectiveMonthlyBps(CA, PARTNER, purchase));
      await advance(CYCLE);
      await term.materialiseCarry(0);
      expect(await term.carryOutstandingOf(0)).to.be.closeTo((purchase * 2n) / 100n, 2_000n);
    });
  });

  describe("L-H: queued share proceeds settle only the member they were seized from", function () {
    it("the operator cannot apply pooled cash to a member with nothing queued", async function () {
      const ctx = await deployPhase0Network();
      const coop = (await ethers.getSigners())[8];
      const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
      const clrusd: any = await upgrades.deployProxy(ClearUSD,
        ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"), [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
      const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"), [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
      const R = await ethers.getContractFactory("RevolvingIssuer");
      const issuer: any = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
      const liquidator: any = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"), [ctx.admin.address, await ctx.stableCredit.getAddress(),
        await clrusd.getAddress(), await vault.getAddress(), await ctx.usdc.getAddress(), await registry.getAddress()], { kind: "uups" });
      // Cash sitting in the Liquidator that belongs to somebody else's queued redemption.
      await ctx.usdc.mint(await liquidator.getAddress(), 500n * ONE_USDC);
      expect(await liquidator.realizedPendingOf(ctx.member.address)).to.equal(0n);
      await expect(liquidator.settleRealized(ctx.member.address, await issuer.getAddress(), 0, 500n * ONE_USDC))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNothingToSeize");
    });
  });

  describe("L-A: an unlimited Savings allowance", function () {
    it("does not overflow card settlement once Savings is drawn", async function () {
      const ctx = await deployPhase0Network();
      const [, , , , , , , , coop, settler, float] = await ethers.getSigners();
      const R = await ethers.getContractFactory("RevolvingIssuer");
      const revolving: any = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
      await ctx.networkRegistry.registerIssuer(await revolving.getAddress(), await ctx.stableCredit.getAddress());
      await ctx.access.grantOperator(await revolving.getAddress());
      await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String("SAVINGS"), 0n, CYCLE);
      await revolving.connect(ctx.operator).setCardSettler(settler.address, true);
      await revolving.connect(ctx.operator).setCardSettlementAccount(float.address);
      await revolving.connect(ctx.operator).openLine(ctx.member.address, [500n * ONE_USDC], CYCLE, GRACE);
      await revolving.connect(ctx.member).setSavingsDrawAllowance(ethers.MaxUint256);
      for (const [ref, amount] of [["c1", 100n], ["c2", 50n]] as const) {
        await revolving.connect(settler).authorizeCardSpend(ethers.id(ref), ctx.member.address, amount * ONE_USDC);
        await revolving.connect(settler).settleCardSpend(ethers.id(ref), ctx.member.address, amount * ONE_USDC);
      }
      expect(await revolving.drawnOf(ctx.member.address, 0)).to.equal(150n * ONE_USDC);
      expect(await revolving.savingsDrawAllowance(ctx.member.address)).to.equal(ethers.MaxUint256);
    });
  });
});
