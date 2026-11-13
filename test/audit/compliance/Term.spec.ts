import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCore, advance } from "../deep/deep-setup";
import { signedOpenPlan, planTerms, signPlanTerms } from "../../helpers/plans";
import { CA, NY, P, CA_BANDS, ONE_USDC, CYCLE, DAY, params, deployRateSchedule, thirtyDays } from "./rates";

/*
 * Compliance spec items 5-9 on term plans: on-chain pricing at opening, free rules, carry on the
 * declining principal under the legal cap, re-split with a signature when the cost rises, Clear
 * Cash's minimum term, and the state gate. Acceptance tests 2, 5, 6, 7, 8 and 10. Figures are
 * recomputed for per-second accrual (DECISIONS #1): 30 days of a monthly rate is 360/365 of it.
 */
describe("COMPLIANCE term plans (spec items 5-9)", function () {
  let core: Awaited<ReturnType<typeof deployCore>>;
  let rates: any;
  const PARTNER = P("PARTNER"), CASH = P("CASH");

  beforeEach(async function () {
    core = await deployCore();
    const { ctx, term, member2 } = core;
    rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, PARTNER, params({ listMonthlyBps: 200, freeBelowAmount: 50n * ONE_USDC }), CA_BANDS);
    await rates.setProduct(CA, CASH, params({ listMonthlyBps: 250, annualCapBps: 3_650 }), CA_BANDS);
    await term.connect(ctx.admin).setRateSchedule(await rates.getAddress());
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    await ctx.networkRegistry.attestStateCode(ctx.member.address, CA);
    await term.connect(ctx.operator).setTermLimit(ctx.member.address, 10_000n * ONE_USDC);
    await term.connect(ctx.operator).setTermLimit(member2.address, 10_000n * ONE_USDC);
  });

  /** Opens a plan the way the app will: the rate and payout the chain will compute, signed. */
  async function open(member: any, purchase: bigint, installments: number, product = PARTNER, len = CYCLE) {
    const { term, merchant, ctx } = core;
    const rate = installments === 1 || purchase < 50n * ONE_USDC
      ? 0n
      : await rates.effectiveMonthlyBps(CA, product, purchase);
    const payout = purchase - (purchase * 250n) / 10_000n; // the merchant's registered discount
    return signedOpenPlan(term, ctx.operator, member.address, merchant.address, purchase, payout, rate, len, installments, len, product);
  }

  async function payDue(planId: number) {
    const { term, ctx } = core;
    const due = (await term.scheduledPrincipalDue(planId)) - (await term.planAt(planId)).repaid;
    if (due > 0n) await term.connect(ctx.member).payPlan(planId, due);
  }

  it("acceptance 2: a partner plan is priced at min(list, cap) on chain, and the member signs exactly that", async function () {
    const { term, merchant, ctx } = core;
    expect(await rates.effectiveMonthlyBps(CA, PARTNER, 1_500n * ONE_USDC)).to.equal(187n);
    // Signing the list rate when the cap is lower is refused: a disclosure must match the charge.
    await expect(signedOpenPlan(term, ctx.operator, ctx.member.address, merchant.address, 1_500n * ONE_USDC, 1_462_500_000n, 200n, CYCLE, 4, CYCLE, PARTNER))
      .to.be.revertedWithCustomError(term, "TermIssuerTermsMismatch");
    await expect(open(ctx.member, 1_500n * ONE_USDC, 4)).to.emit(term, "PlanOpened");
    expect((await term.planAt(0)).ratePerCycle).to.equal(187n);
  });

  it("acceptance 5: $940 in 4 at 2% carries ~$18.54, $13.91, $9.27, $4.64 -- each under the cap on what is left", async function () {
    const { term, ctx } = core;
    await open(ctx.member, 940n * ONE_USDC, 4);
    const expected = [940n, 705n, 470n, 235n].map((p) => thirtyDays(p * ONE_USDC * 2n / 100n));
    const caps = [19_725_000n, 15_225_000n, 10_525_000n, 5_825_000n].map(thirtyDays);
    const carried: bigint[] = [];
    for (let k = 0; k < 4; k++) {
      const before = await term.carryOutstandingOf(0);
      await advance(CYCLE);
      await term.materialiseCarry(0);
      const carry = (await term.carryOutstandingOf(0)) - before;
      carried.push(carry);
      expect(carry).to.be.closeTo(expected[k], 20_000n);
      expect(carry).to.be.lte(caps[k]);
      await payDue(0);
    }
    expect(carried.reduce((a, b) => a + b, 0n)).to.be.closeTo(thirtyDays(47_000_000n), 50_000n); // ~$46.36
  });

  it("acceptance 5: an In-full plan and a plan under freeBelowAmount accrue $0.00 forever, even 60 days past due", async function () {
    const { term, ctx, member2 } = core;
    await ctx.networkRegistry.attestStateCode(member2.address, CA);
    await open(ctx.member, 900n * ONE_USDC, 1);       // In full
    await open(member2, 40n * ONE_USDC, 4);            // under freeBelowAmount ($50)
    expect((await term.pricingOf(0)).free).to.equal(true);
    expect((await term.pricingOf(1)).free).to.equal(true);
    await advance(90 * DAY);                           // well past due
    await term.materialiseCarry(0);
    await term.materialiseCarry(1);
    expect(await term.carryOutstandingOf(0)).to.equal(0n);
    expect(await term.carryOutstandingOf(1)).to.equal(0n);
    expect((await term.planAt(0)).principalOutstanding).to.equal(900n * ONE_USDC);
  });

  it("acceptance 6: In 4 -> In 12 on the remaining $705 needs the member's signature; nothing before the switch is repriced", async function () {
    const { term, ctx } = core;
    await open(ctx.member, 940n * ONE_USDC, 4);
    await advance(CYCLE);
    await payDue(0);
    expect((await term.planAt(0)).principalOutstanding - (await term.carryOutstandingOf(0))).to.be.closeTo(705n * ONE_USDC, 100n);

    await expect(term.connect(ctx.member).setSplit(0, 12)).to.be.revertedWithCustomError(term, "TermIssuerResplitNeedsSignature");

    const rate = await rates.effectiveMonthlyBps(CA, PARTNER, 705n * ONE_USDC);
    const nonce = await term.planNonces(ctx.member.address);
    const { chainId } = await ethers.provider.getNetwork();
    const sig = await ctx.member.signTypedData(
      { name: "Clear TermIssuer", version: "1", chainId, verifyingContract: await term.getAddress() },
      { Resplit: [
        { name: "planId", type: "uint256" }, { name: "installments", type: "uint32" },
        { name: "rateBps", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      { planId: 0n, installments: 12n, rateBps: rate, nonce, deadline: ethers.MaxUint256 });
    const carryBefore = await term.carryOutstandingOf(0);
    await term.connect(ctx.operator).resplitWithSignature(0, 12, rate, ethers.MaxUint256, sig);
    // Accrued to the switch at the old terms; nothing pending, so nothing before it is repriced.
    expect(await term.pendingCarryOn(0)).to.equal(0n);
    expect(await term.carryOutstandingOf(0)).to.be.gte(carryBefore);
    const [, , installments] = await term.scheduleOf(0);
    expect(installments).to.equal(12n);
  });

  it("acceptance 7: Clear Cash $3,000 over 12 x 30 days reverts; over 13 x 30 days (>= 365) at 2.5%/30d succeeds under the annual cap", async function () {
    const { term, ctx } = core;
    await expect(open(ctx.member, 3_000n * ONE_USDC, 12, CASH)).to.be.revertedWithCustomError(term, "TermIssuerTermTooShort");
    await expect(open(ctx.member, 3_000n * ONE_USDC, 13, CASH)).to.emit(term, "PlanOpened");
    expect((await term.planAt(0)).ratePerCycle).to.equal(250n);
    // Under $2,500 the large-loan regime does not apply and 13 is not an offered split.
    await expect(open(ctx.member, 2_000n * ONE_USDC, 13, CASH)).to.be.revertedWithCustomError(term, "TermIssuerSplitNotOffered");
  });

  it("acceptance 8: a member with no stateCode, or in a state without the product, cannot open any credit product", async function () {
    const { term, revolving, ctx, member2, member3 } = core;
    await expect(open(member2, 500n * ONE_USDC, 4)).to.be.revertedWithCustomError(term, "TermIssuerProductNotEnabled");
    await ctx.networkRegistry.attestStateCode(member3.address, NY);
    await term.connect(ctx.operator).setTermLimit(member3.address, 1_000n * ONE_USDC);
    await expect(open(member3, 500n * ONE_USDC, 4)).to.be.revertedWithCustomError(term, "TermIssuerProductNotEnabled");
    // A disabled product refuses even a member in the right state.
    await rates.setProduct(CA, PARTNER, params({ enabled: false, listMonthlyBps: 200 }), CA_BANDS);
    await expect(open(ctx.member, 500n * ONE_USDC, 4)).to.be.revertedWithCustomError(term, "TermIssuerProductNotEnabled");
    // The revolving line is gated the same way.
    await rates.setProduct(CA, P("REVOLVING"), params(), CA_BANDS);
    await revolving.connect(ctx.admin).setPricing(await rates.getAddress(), P("REVOLVING"));
    await expect(revolving.connect(ctx.operator).openLine(member2.address, [0n, 0n, 100n, 0n], 0, CYCLE))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerStateNotEnabled");
    await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 0n, 100n, 0n], 0, CYCLE);
  });

  it("acceptance 10: a full refund after the merchant redeemed leaves it owing the payout; its next payout nets that first", async function () {
    const { term, pool, merchant, ctx, member2 } = core;
    await ctx.networkRegistry.attestStateCode(member2.address, CA);
    await open(ctx.member, 1_000n * ONE_USDC, 1);
    await term.connect(ctx.member).payPlan(0, 1_000n * ONE_USDC);
    await pool.connect(merchant).redeem(975n * ONE_USDC);
    await term.connect(ctx.operator).closePlanForRefund(0, 1_000n * ONE_USDC, merchant.address, 975n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(975n * ONE_USDC);
    await open(member2, 1_000n * ONE_USDC, 1);
    expect(await ctx.stableCredit.creditBalanceOf(merchant.address)).to.equal(0n);
    expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(0n);
  });
});
