import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCore, advance, ONE_USDC, CYCLE, DAY } from "./deep-setup";
import { planTerms, signPlanTerms, signedOpenPlan } from "../../helpers/plans";
import { driveToDefault } from "../../helpers/default";

/*
 * Regression tests for audit H-4 (credit side) and M-2: what a leaked server key can still do.
 */
describe("AUDIT H-4 / M-2: credit hot keys", function () {
  const LINES = ethers.id("CREDIT_LINES_ROLE");
  const LIMITS = ethers.id("CREDIT_LIMITS_ROLE");
  const SETTINGS = ethers.id("CREDIT_SETTINGS_ROLE");

  it("H-4 (fixed): the plain operator role opens nothing, raises nothing and configures nothing", async function () {
    const { ctx, revolving, term, attacker } = await deployCore();
    await ctx.access.grantOperator(attacker.address);
    await expect(term.connect(attacker).setTermLimit(attacker.address, 1_000n * ONE_USDC))
      .to.be.revertedWithCustomError(term, "CreditIssuerMissingRole");
    await expect(revolving.connect(attacker).openLine(attacker.address, [0n, 0n, 1n, 0n], 0, CYCLE))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
    await expect(revolving.connect(attacker).setTierCarryRecipient(2, attacker.address))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
  });

  it("H-4 (fixed): each credit role does its own job only", async function () {
    const { ctx, revolving, term, attacker } = await deployCore();
    await ctx.access.grantRole(LINES, attacker.address);
    // A line-opening key cannot raise a limit or change a setting.
    await expect(term.connect(attacker).setTermLimit(ctx.member.address, 1n))
      .to.be.revertedWithCustomError(term, "CreditIssuerMissingRole");
    await expect(revolving.connect(attacker).setCardSettler(attacker.address, true))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
    await ctx.access.revokeRole(LINES, attacker.address);
    await ctx.access.grantRole(LIMITS, attacker.address);
    // A limits key cannot open a plan or change a setting.
    await expect(revolving.connect(attacker).openLine(ctx.member.address, [0n, 0n, 1n, 0n], 0, CYCLE))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
    await expect(term.connect(attacker).setCarryTreasury(attacker.address))
      .to.be.revertedWithCustomError(term, "CreditIssuerMissingRole");
    expect(await ctx.access.hasCreditRole(SETTINGS, ctx.admin.address)).to.equal(true);
  });

  it("H-4 (fixed): a plan needs the member's signature over its terms, once, to an active merchant", async function () {
    const { ctx, term, merchant, attacker, registry } = await deployCore();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 5_000n * ONE_USDC);

    // The operator naming itself merchant and signing for the member: refused twice over.
    const forged = planTerms(m.address, merchant.address, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 0n, CYCLE, 1, CYCLE);
    const operatorSig = await signPlanTerms(term, ctx.operator, forged);
    await expect(term.connect(ctx.operator).openPlan(forged, operatorSig))
      .to.be.revertedWithCustomError(term, "TermIssuerBadSignature");
    await expect(signedOpenPlan(term, ctx.operator, m.address, attacker.address, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 0n, CYCLE, 1, CYCLE))
      .to.be.revertedWithCustomError(term, "TermIssuerMerchantNotActive");

    // A signed plan opens once; the same signature cannot open a second.
    const terms = planTerms(m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 4, CYCLE);
    const sig = await signPlanTerms(term, m, terms);
    await expect(term.connect(ctx.operator).openPlan(terms, sig)).to.emit(term, "PlanTermsSigned");
    await expect(term.connect(ctx.operator).openPlan(terms, sig))
      .to.be.revertedWithCustomError(term, "TermIssuerBadSignature");

    // Signed for a different payout than submitted: refused.
    const tampered = { ...planTerms(m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 4, CYCLE) };
    const sig2 = await signPlanTerms(term, m, tampered);
    await expect(term.connect(ctx.operator).openPlan({ ...tampered, payout: 1_000n * ONE_USDC }, sig2))
      .to.be.revertedWithCustomError(term, "TermIssuerBadSignature");

    // A deactivated merchant gets no new plans.
    await registry.setActive(merchant.address, false);
    await expect(signedOpenPlan(term, ctx.operator, m.address, merchant.address, 100n * ONE_USDC, 97n * ONE_USDC, 150n, CYCLE, 1, CYCLE))
      .to.be.revertedWithCustomError(term, "TermIssuerMerchantNotActive");
  });

  it("H-4 (fixed): daily caps bound new limits, new capacity and new plans", async function () {
    const { ctx, revolving, term, merchant, member2 } = await deployCore();
    await term.connect(ctx.admin).setDailyCaps(1_500n * ONE_USDC, 800n * ONE_USDC);
    await revolving.connect(ctx.admin).setDailyCapacityCap(1_000n * ONE_USDC);

    await term.connect(ctx.operator).setTermLimit(ctx.member.address, 1_000n * ONE_USDC);
    await expect(term.connect(ctx.operator).setTermLimit(member2.address, 1_000n * ONE_USDC))
      .to.be.revertedWithCustomError(term, "CreditIssuerDailyCapExceeded");
    await signedOpenPlan(term, ctx.operator, ctx.member.address, merchant.address, 500n * ONE_USDC, 490n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
    await expect(signedOpenPlan(term, ctx.operator, ctx.member.address, merchant.address, 400n * ONE_USDC, 390n * ONE_USDC, 150n, CYCLE, 1, CYCLE))
      .to.be.revertedWithCustomError(term, "CreditIssuerDailyCapExceeded");

    await revolving.connect(ctx.operator).openLine(member2.address, [0n, 0n, 800n * ONE_USDC, 0n], 0, CYCLE);
    await expect(revolving.connect(ctx.operator).setTierCapacity(member2.address, 2, 1_100n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerDailyCapExceeded");

    // A new day, a new budget.
    await advance(DAY);
    await term.connect(ctx.operator).setTermLimit(member2.address, 1_000n * ONE_USDC);
    await revolving.connect(ctx.operator).setTierCapacity(member2.address, 2, 1_100n * ONE_USDC);
  });

  it("M-2 (fixed): card settlement draws only what was authorized, within caps, and never for a defaulted member", async function () {
    const { ctx, revolving, attacker, member2 } = await deployCore();
    const [settler, float] = [attacker, (await ethers.getSigners())[15]];
    await revolving.connect(ctx.admin).setCardSettler(settler.address, true);
    await revolving.connect(ctx.admin).setCardSettlementAccount(float.address);
    await revolving.connect(ctx.admin).setCardCaps(300n * ONE_USDC, 500n * ONE_USDC);
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 0, CYCLE);

    // No authorization, no settlement: a settler key cannot invent purchases after the fact.
    const R1 = ethers.id("r1");
    await expect(revolving.connect(settler).settleCardSpend(R1, m.address, 100n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerCardNotAuthorized");
    await revolving.connect(settler).authorizeCardSpend(R1, m.address, 100n * ONE_USDC);
    await expect(revolving.connect(settler).settleCardSpend(R1, m.address, 101n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerCardExceedsAuthorization");
    // Authorized for one member, settled against another: refused.
    await expect(revolving.connect(settler).settleCardSpend(R1, member2.address, 100n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerCardNotAuthorized");
    await revolving.connect(settler).settleCardSpend(R1, m.address, 100n * ONE_USDC);

    // Per purchase and per day.
    await expect(revolving.connect(settler).authorizeCardSpend(ethers.id("big"), m.address, 301n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerCardTxCap");
    for (const r of ["r2", "r3"]) {
      await revolving.connect(settler).authorizeCardSpend(ethers.id(r), m.address, 250n * ONE_USDC);
    }
    await revolving.connect(settler).settleCardSpend(ethers.id("r2"), m.address, 250n * ONE_USDC);
    await expect(revolving.connect(settler).settleCardSpend(ethers.id("r3"), m.address, 250n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerDailyCapExceeded");

    // In default: nothing new authorized, nothing outstanding settled.
    // Section 12.5: two missed rebalances in a row, each judged, then the cure window.
    await driveToDefault(revolving, m.address, ctx.admin);
    expect(await revolving.inDefault(m.address)).to.equal(true);
    await expect(revolving.connect(settler).settleCardSpend(ethers.id("r3"), m.address, 250n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerMemberNotInGoodStanding");
    await expect(revolving.connect(settler).authorizeCardSpend(ethers.id("r4"), m.address, 1n))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerMemberNotInGoodStanding");
  });
});
