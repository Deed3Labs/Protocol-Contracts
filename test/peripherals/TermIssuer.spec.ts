import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const MONTH = 30 * 24 * 60 * 60;
const ONE_YEAR = 365 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;

describe("TermIssuer", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let issuer: any;
  let coop: any, merchant: any, payer: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, merchant, payer] = [signers[8], signers[9], signers[10]];

    const TermIssuer = await ethers.getContractFactory("TermIssuer");
    issuer = await TermIssuer.deploy();
    await issuer.initialize(await ctx.stableCredit.getAddress(), coop.address);

    await ctx.networkRegistry.registerIssuer(
      await issuer.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await ctx.access.grantOperator(await issuer.getAddress());
    for (const who of [coop, merchant]) {
      await ctx.access.connect(ctx.operator).grantMember(who.address);
    }

    // A member has to exist on the ledger before an issuer can allocate them a ceiling.
    await ctx.creditIssuer
      .connect(ctx.operator)
      .initializeCreditLine(ctx.member.address, 0, 0, ONE_YEAR, MONTH);

    // Fund the payer so installments can actually be settled in reserve tokens.
    await ctx.usdc.mint(payer.address, 100_000n * ONE_USDC);
    await ctx.usdc
      .connect(payer)
      .approve(await ctx.stableCredit.getAddress(), 100_000n * ONE_USDC);
  });

  async function setLimit(amount: bigint) {
    await issuer.connect(ctx.operator).setTermLimit(ctx.member.address, amount);
  }

  /// A 12-month plan at 150 bps a cycle.
  async function openPlan(purchase: bigint, payout: bigint, rate = 150n, installments = 12) {
    return issuer
      .connect(ctx.operator)
      .openPlan(
        ctx.member.address, merchant.address, purchase, payout, rate, CYCLE, installments, MONTH
      );
  }

  /// An ELPA-shaped plan: bounded by its collateral, not by the member's term limit.
  async function openAssetBackedPlan(purchase: bigint, payout: bigint, rate = 150n, installments = 12) {
    return issuer
      .connect(ctx.operator)
      .openAssetBackedPlan(
        ctx.member.address, merchant.address, purchase, payout, rate, CYCLE, installments, MONTH
      );
  }

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  /*
   * An ELPA is a mortgage: decades-scale, amortizing, secured by the home it buys. Bounding it by
   * the figure that bounds a tyre repair would mean needing a quarter-million dollar term limit to
   * buy a house -- and that limit would then sit there permitting a quarter-million dollars of
   * unsecured merchant splits.
   */
  describe("a term limit does not bound an asset-backed plan", function () {
    it("opens one far above the member's limit", async function () {
      await setLimit(1_000n * ONE_USDC);
      await expect(openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC)).to.not.be.reverted;
    });

    it("and marks it, so the exemption is legible rather than inferred", async function () {
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      expect(await issuer.assetBacked(0)).to.equal(true);
    });

    it("an ordinary plan is still bounded", async function () {
      await setLimit(1_000n * ONE_USDC);
      await expect(openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC))
        .to.be.revertedWithCustomError(issuer, "TermIssuerExceedsTermLimit");
      expect(await issuer.assetBacked(0)).to.equal(false);
    });

    it("and holding a mortgage does not consume the ordinary limit", async function () {
      // The point of the whole change: a member buying a home can still split a repair.
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      await expect(openPlan(900n * ONE_USDC, 900n * ONE_USDC)).to.not.be.reverted;
    });

    it("but it does not become a way past the limit either", async function () {
      // Exempt from the ceiling, not exempt from being counted. An ordinary plan opened after one
      // still sees every ordinary plan before it.
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      await openPlan(900n * ONE_USDC, 900n * ONE_USDC);
      await expect(openPlan(200n * ONE_USDC, 200n * ONE_USDC))
        .to.be.revertedWithCustomError(issuer, "TermIssuerExceedsTermLimit");
    });
  });

  /*
   * Exempting a plan from `termLimitOf` alone achieves nothing: the ledger refuses an origination
   * past the member's ceiling, and `setTermLimit` sets that ceiling to the same figure. The mint
   * simply failed one layer down, with a StableCreditCeilingExceeded that had nothing to do with
   * term plans. A plan the term limit does not bound has to bring its own headroom.
   */
  describe("an asset-backed plan brings its own ceiling", function () {
    it("raises this issuer's contribution by what it is worth", async function () {
      await setLimit(1_000n * ONE_USDC);
      expect(await issuer.ceilingContributionOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);

      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      expect(await issuer.ceilingContributionOf(ctx.member.address)).to.equal(251_000n * ONE_USDC);
    });

    it("and the ledger agrees, which is what lets the mint through", async function () {
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      expect(await ctx.stableCredit.creditLimitOf(ctx.member.address)).to.equal(251_000n * ONE_USDC);
    });

    it("the headroom is not spendable on ordinary plans", async function () {
      // The whole risk of raising a ceiling. `openPlan` still measures against `termLimitOf`, so a
      // mortgage does not quietly become a quarter-million of merchant splits.
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      await expect(openPlan(1_500n * ONE_USDC, 1_500n * ONE_USDC))
        .to.be.revertedWithCustomError(issuer, "TermIssuerExceedsTermLimit");
    });

    it("and it is read live, so it falls as the plan amortizes", async function () {
      // A member who has paid a mortgage down should not carry its ceiling forever.
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC);
      expect(await issuer.ceilingContributionOf(ctx.member.address)).to.equal(2_000n * ONE_USDC);

      await issuer.connect(payer).payPlan(0, 400n * ONE_USDC);
      // Not exactly 1,600: a payment covers carry before principal, so principal falls by slightly
      // less than what was paid. What matters is that the ceiling followed it down.
      const after = await issuer.ceilingContributionOf(ctx.member.address);
      expect(after).to.be.lessThan(2_000n * ONE_USDC);
      expect(after).to.be.greaterThanOrEqual(1_600n * ONE_USDC);
      expect(after - 1_600n * ONE_USDC).to.be.lessThan(ONE_USDC);
    });
  });

  describe("an asset-backed plan is still debt", function () {
    it("is reported in the member's total principal", async function () {
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(250_000n * ONE_USDC);
    });

    it("but is excluded from what the limit bounds", async function () {
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      expect(await issuer.limitedPrincipalOf(ctx.member.address)).to.equal(0n);
    });

    it("and is reported as debt to the exposure source", async function () {
      // A mortgage is debt. It is just not debt this ceiling is about — so `debtByKind` must not
      // quietly lose it, or the co-op's exposure would understate by the size of a house.
      await setLimit(1_000n * ONE_USDC);
      await openAssetBackedPlan(250_000n * ONE_USDC, 250_000n * ONE_USDC);
      const [, amounts] = await issuer.debtByKind(ctx.member.address);
      expect(amounts[0]).to.equal(250_000n * ONE_USDC);
    });
  });

  describe("origination is a three-party mint", function () {
    it("debits the member, credits the merchant, credits the co-op the difference", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 970n * ONE_USDC); // 3% discount

      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
        .to.equal(1_000n * ONE_USDC);
      expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(970n * ONE_USDC);
      expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(30n * ONE_USDC);
    });

    it("nets to zero", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 970n * ONE_USDC);

      const debit = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      const credits =
        (await ctx.stableCredit.balanceOf(merchant.address)) +
        (await ctx.stableCredit.balanceOf(coop.address));
      expect(debit).to.equal(credits);
      expect(await ctx.stableCredit.totalSupply()).to.equal(debit);
    });

    it("requires no capital: nothing is transferred in at origination", async function () {
      await setLimit(2_000n * ONE_USDC);
      const reserveBefore = await ctx.assurancePool.reserveBalance();
      await openPlan(1_000n * ONE_USDC, 970n * ONE_USDC);
      expect(await ctx.assurancePool.reserveBalance()).to.equal(reserveBefore);
    });

    it("refuses a purchase whose legs do not sum to zero", async function () {
      // Asserted in the mint path, not just in tests. A purchase that does not net either mints
      // claims nobody owes or leaves an obligation nobody holds.
      await setLimit(2_000n * ONE_USDC);
      await expect(
        ctx.stableCredit
          .connect(ctx.operator)
          .originatePurchase(
            ctx.member.address, 1_000n * ONE_USDC, merchant.address, 970n * ONE_USDC,
            coop.address, 40n * ONE_USDC
          )
      ).to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditNotAnIssuer");

      // And through an issuer that is allowed to originate, the netting itself is what refuses.
      await expect(openPlan(1_000n * ONE_USDC, 1_100n * ONE_USDC))
        .to.be.revertedWithCustomError(issuer, "TermIssuerInvalidSchedule");
    });

    it("refuses a plan beyond the member's income-based limit", async function () {
      // Term plans have their own limit, underwritten against what a member earns rather than
      // against what they have pledged.
      await setLimit(1_000n * ONE_USDC);
      await expect(openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC))
        .to.be.revertedWithCustomError(issuer, "TermIssuerExceedsTermLimit");

      await openPlan(600n * ONE_USDC, 600n * ONE_USDC);
      await expect(openPlan(500n * ONE_USDC, 500n * ONE_USDC))
        .to.be.revertedWithCustomError(issuer, "TermIssuerExceedsTermLimit");
    });

    it("refuses a split that is not on the menu", async function () {
      await setLimit(2_000n * ONE_USDC);
      for (const bad of [0, 3, 5, 13]) {
        await expect(openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 150n, bad))
          .to.be.revertedWithCustomError(issuer, "TermIssuerSplitNotOffered");
      }
    });
  });

  describe("each plan keeps its own clock", function () {
    it("accrues per plan, at each plan's own rate", async function () {
      // Two plans at different rates cannot share an index. That is the whole reason term plans
      // are a separate issuer rather than a fifth revolving tier.
      await setLimit(4_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 100n);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 300n);

      await advance(6 * CYCLE);
      const cheap = await issuer.carryOn(0);
      const dear = await issuer.carryOn(1);
      expect(dear).to.be.greaterThan(cheap);
      expect(cheap).to.be.greaterThan(0n);
    });

    it("charges a later plan only for the time it has run", async function () {
      await setLimit(4_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC);
      await advance(6 * CYCLE);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC);
      await advance(6 * CYCLE);

      expect(await issuer.carryOn(0)).to.be.greaterThan(await issuer.carryOn(1));
    });

    it("brings carry onto the ledger, owed to the treasury", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC);
      await advance(6 * CYCLE);

      const owedBefore = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      await issuer.materialiseCarry(0);

      const held = await ctx.stableCredit.balanceOf(coop.address);
      expect(held).to.be.greaterThan(0n);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
        .to.equal(owedBefore + held);
    });
  });

  describe("the split schedule", function () {
    it("amortizes in equal parts on wall-clock time", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);

      expect(await issuer.installmentsDue(0)).to.equal(0n);
      expect(await issuer.scheduledPrincipalDue(0)).to.equal(0n);

      await advance(3 * MONTH + ONE_DAY);
      expect(await issuer.installmentsDue(0)).to.equal(3n);
      expect(await issuer.scheduledPrincipalDue(0)).to.equal(300n * ONE_USDC);

      await advance(9 * MONTH);
      expect(await issuer.installmentsDue(0)).to.equal(12n);
      expect(await issuer.scheduledPrincipalDue(0)).to.equal(1_200n * ONE_USDC);
    });

    it("does not slow down because the member fell behind", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);

      await advance(4 * MONTH + ONE_DAY);
      expect(await issuer.arrearsOf(0)).to.equal(400n * ONE_USDC);
      await advance(2 * MONTH);
      expect(await issuer.arrearsOf(0)).to.equal(600n * ONE_USDC);
    });

    it("sums to the principal exactly, remainder and all", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC + 7n, 1_000n * ONE_USDC + 7n, 0n, 12);

      await advance(12 * MONTH + ONE_DAY);
      expect(await issuer.scheduledPrincipalDue(0)).to.equal(1_000n * ONE_USDC + 7n);
    });
  });

  describe("the quoted payment holds still", function () {
    // What a term plan sells over the revolving line is knowing the number. A schedule derived
    // from carry-so-far is right about what is owed and wrong about what the member was told:
    // the figure climbs all term, and every rise is a support call the co-op loses.

    it("asks the same amount every period", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 65n, 12);

      const steps: bigint[] = [];
      let previous = 0n;
      for (let i = 1; i <= 12; i++) {
        await advance(MONTH);
        const cumulative = await issuer.scheduledPrincipalDue(0);
        steps.push(cumulative - previous);
        previous = cumulative;
      }

      // Every period but the last asks for the quoted figure exactly.
      const [quoted] = await issuer.scheduleOf(0);
      for (let i = 0; i < 11; i++) {
        expect(steps[i]).to.equal(quoted);
      }
      // The last settles the remainder, so it is never larger than the rest.
      expect(steps[11]).to.be.lessThanOrEqual(quoted);
    });

    it("prices the carry in from the first period rather than letting it creep", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 65n, 12);

      // The old schedule read `scheduleBase + carrySoFar`, so the first period asked for exactly
      // principal/12 and later ones asked for more. The fixed schedule charges above that from
      // the start, because it already knows what the term costs.
      const [quoted, total] = await issuer.scheduleOf(0);
      expect(quoted).to.be.greaterThan(100n * ONE_USDC);
      expect(total).to.be.greaterThan(1_200n * ONE_USDC);
    });

    it("collects only the principal when there is no carry", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 0n, 12);

      const [, total] = await issuer.scheduleOf(0);
      expect(total).to.equal(1_000n * ONE_USDC);
      await advance(12 * MONTH + ONE_DAY);
      expect(await issuer.scheduledPrincipalDue(0)).to.equal(1_000n * ONE_USDC);
    });

    it("closes the plan when the member pays what the schedule asked", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 65n, 12);
      const [quoted, total, , scheduleStart] = await issuer.scheduleOf(0);

      // Paid on the day, every time. A member who does everything asked of them must not be left
      // owing a residue -- which is the failure mode of a projected schedule that does not invert
      // the accrual it is projecting.
      for (let i = 1n; i <= 12n; i++) {
        const due = i === 12n ? total - quoted * 11n : quoted;
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          Number(scheduleStart + i * BigInt(MONTH)),
        ]);
        await issuer.connect(payer).payPlan(0, due);
      }

      const [, , outstanding, , , , , , closed] = await issuer.planAt(0);
      expect(outstanding).to.equal(0n);
      expect(closed).to.equal(true);
      expect(await issuer.arrearsOf(0)).to.equal(0n);
    });

    it("still charges a member who pays the schedule late", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 65n, 12);
      const [quoted, total, , scheduleStart] = await issuer.scheduleOf(0);

      // The quoted figure is the on-time schedule. Carry goes on accruing on what is actually
      // outstanding, so a member who pays every installment a week late has paid the whole
      // schedule and still owes the carry their lateness earned. Fixing the quote does not mean
      // fixing the cost of using the money for longer.
      for (let i = 1n; i <= 12n; i++) {
        const due = i === 12n ? total - quoted * 11n : quoted;
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          Number(scheduleStart + i * BigInt(MONTH) + BigInt(7 * ONE_DAY)),
        ]);
        await issuer.connect(payer).payPlan(0, due);
      }

      const [, , outstanding, , , , , , closed] = await issuer.planAt(0);
      expect(outstanding).to.be.greaterThan(0n);
      expect(closed).to.equal(false);
    });

    it("re-quotes rather than carrying the old figure into a new split", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 65n, 12);
      const [twelve] = await issuer.scheduleOf(0);

      await issuer.connect(ctx.member).setSplit(0, 4);
      const [four] = await issuer.scheduleOf(0);

      // The same money over a third of the term is a much larger payment, and quoting the old
      // one would be the drift this exists to remove, arriving by another route.
      expect(four).to.be.greaterThan(twelve * 2n);
    });
  });

  describe("the member chooses the split", function () {
    // Pay in one cycle, or spread over 2, 4, 6 or 12. Changing it moves only the remainder.

    it("offers a fixed menu rather than any number of cycles", async function () {
      for (const n of [1, 2, 4, 6, 12]) {
        expect(await issuer.isOfferedSplit(n)).to.equal(true);
      }
      for (const n of [0, 3, 5, 7, 24]) {
        expect(await issuer.isOfferedSplit(n)).to.equal(false);
      }
      await setLimit(2_000n * ONE_USDC);
      await expect(openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 0n, 3))
        .to.be.revertedWithCustomError(issuer, "TermIssuerSplitNotOffered");
    });

    it("re-spreads only what is left, not what was already paid", async function () {
      // Opened at two cycles, first half paid, then spread the rest over twelve.
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 2);
      await issuer.connect(payer).payPlan(0, 600n * ONE_USDC);

      await issuer.connect(ctx.member).setSplit(0, 12);
      expect(await issuer.arrearsOf(0)).to.equal(0n);

      // The 600 already paid stays paid; the remaining 600 spreads over twelve cycles.
      await advance(MONTH + ONE_DAY);
      expect(await issuer.scheduledPrincipalDue(0)).to.equal(650n * ONE_USDC);
      expect(await issuer.arrearsOf(0)).to.equal(50n * ONE_USDC);

      await advance(11 * MONTH);
      expect(await issuer.scheduledPrincipalDue(0)).to.equal(1_200n * ONE_USDC);
    });

    it("carries what a member is behind by into the new schedule", async function () {
      // Re-splitting changes how the remainder is paid. It does not forgive what was owed --
      // which is also what would otherwise suppress the auto-pull and the delinquency after it.
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);

      await advance(3 * MONTH + ONE_DAY);
      expect(await issuer.arrearsOf(0)).to.equal(300n * ONE_USDC);

      await issuer.connect(ctx.member).setSplit(0, 12);
      expect(await issuer.arrearsOf(0)).to.equal(300n * ONE_USDC);
      expect(await issuer.inCompliance(ctx.member.address)).to.equal(false);
    });

    it("spreads the rest over the new term once the arrears are cleared", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);
      await advance(3 * MONTH + ONE_DAY);
      await issuer.connect(ctx.member).setSplit(0, 6);

      await issuer.connect(payer).payPlan(0, 300n * ONE_USDC);
      expect(await issuer.arrearsOf(0)).to.equal(0n);

      // 900 left over six cycles.
      await advance(MONTH);
      expect(await issuer.arrearsOf(0)).to.equal(150n * ONE_USDC);
    });

    it("still sums to the principal after a re-split", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC + 7n, 1_000n * ONE_USDC + 7n, 0n, 4);
      await issuer.connect(payer).payPlan(0, 250n * ONE_USDC);
      await issuer.connect(ctx.member).setSplit(0, 6);

      await advance(6 * MONTH + ONE_DAY);
      expect(await issuer.scheduledPrincipalDue(0)).to.equal(1_000n * ONE_USDC + 7n);
    });

    it("lets only the member or an operator change it", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 0n, 2);

      await expect(issuer.connect(merchant).setSplit(0, 12))
        .to.be.revertedWithCustomError(issuer, "TermIssuerNotPlanHolder");
      await issuer.connect(ctx.operator).setSplit(0, 12);
      await issuer.connect(ctx.member).setSplit(0, 6);
    });

    it("leaves carry accruing on whatever is outstanding", async function () {
      // Spreading further costs more, which is the point.
      await setLimit(4_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 150n, 2);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 150n, 2);

      await issuer.connect(ctx.member).setSplit(1, 12);
      await advance(6 * CYCLE);

      // Same rate, same balance, near enough the same time: the split changes when a balance is
      // due, not what holding it costs. The two plans were opened a block apart and one of them
      // had its carry materialised by the re-split, so they differ by those seconds and no more.
      const a = await issuer.carryOn(0);
      const b = await issuer.carryOn(1);
      const gap = a > b ? a - b : b - a;
      expect(gap).to.be.lessThan(10_000n);
      expect(a).to.be.greaterThan(0n);
    });
  });

  describe("arrears counts the carry too", function () {
    // Arrears is what an automatic pull is sized from, so it has to include the carry cost. Carry
    // joins the schedule when it is materialised, which happens on a payment rather than with the
    // passing of time -- so the view has to count what has accrued since the last touch.

    it("reports the same whether or not the plan has been touched", async function () {
      await setLimit(4_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 300n, 12);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 300n, 12);
      await advance(6 * MONTH);

      const cold = await issuer.arrearsOf(0);
      await issuer.materialiseCarry(1);
      const warm = await issuer.arrearsOf(1);

      const gap = cold > warm ? cold - warm : warm - cold;
      expect(gap).to.be.lessThan(10_000n);
      expect(cold).to.be.greaterThan(600n * ONE_USDC); // six of twelve, plus carry
    });

    it("is larger than the principal alone would make it", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 300n, 12);
      await advance(6 * MONTH);

      expect(await issuer.pendingCarryOn(0)).to.be.greaterThan(0n);
      // Half the principal has come due, and half the carry with it.
      expect(await issuer.arrearsOf(0)).to.be.greaterThan(600n * ONE_USDC);
    });

    it("charges no carry, and so no extra arrears, at a zero rate", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);
      await advance(6 * MONTH);

      expect(await issuer.pendingCarryOn(0)).to.equal(0n);
      expect(await issuer.arrearsOf(0)).to.equal(600n * ONE_USDC);
    });
  });

  describe("compliance is the schedule, not equilibrium", function () {
    it("holds a member current while they are on schedule", async function () {
      // Carrying a term balance is the product. Only falling behind is a delinquency.
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);

      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
        .to.equal(1_200n * ONE_USDC);
      expect(await issuer.inCompliance(ctx.member.address)).to.equal(true);
    });

    it("marks a member out of compliance once an installment is missed", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);

      await advance(MONTH + ONE_DAY);
      expect(await issuer.inCompliance(ctx.member.address)).to.equal(false);
      expect(await issuer.arrearsOf(0)).to.equal(100n * ONE_USDC);
    });

    it("brings a member back into compliance when they catch up", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);
      await advance(MONTH + ONE_DAY);

      await issuer.connect(payer).payPlan(0, 100n * ONE_USDC);
      expect(await issuer.arrearsOf(0)).to.equal(0n);
      expect(await issuer.inCompliance(ctx.member.address)).to.equal(true);
    });
  });

  describe("payment is directed at a plan", function () {
    it("settles the plan and the member's ledger balance together", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);

      await issuer.connect(payer).payPlan(0, 400n * ONE_USDC);

      expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(800n * ONE_USDC);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
        .to.equal(800n * ONE_USDC);
    });

    it("closes a plan once its principal is settled", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_200n * ONE_USDC, 1_200n * ONE_USDC, 0n, 12);

      await issuer.connect(payer).payPlan(0, 1_200n * ONE_USDC);
      const plan = await issuer.planAt(0);
      expect(plan.closed).to.equal(true);
      expect(await issuer.arrearsOf(0)).to.equal(0n);
      await expect(issuer.connect(payer).payPlan(0, 1n))
        .to.be.revertedWithCustomError(issuer, "TermIssuerPlanClosed");
    });

    it("caps a payment at what the plan owes", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(500n * ONE_USDC, 500n * ONE_USDC, 0n, 12);

      await issuer.connect(payer).payPlan(0, 5_000n * ONE_USDC);
      expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(0n);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
    });

    it("pays only the plan it was directed at", async function () {
      await setLimit(4_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 0n, 12);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 0n, 12);

      await issuer.connect(payer).payPlan(1, 400n * ONE_USDC);

      expect((await issuer.planAt(0)).principalOutstanding).to.equal(1_000n * ONE_USDC);
      expect((await issuer.planAt(1)).principalOutstanding).to.equal(600n * ONE_USDC);
    });
  });

  describe("default", function () {
    it("writes off only what sits in this issuer's plans", async function () {
      await setLimit(2_000n * ONE_USDC);
      await openPlan(1_000n * ONE_USDC, 1_000n * ONE_USDC, 0n, 12);

      await issuer.connect(ctx.operator).updateCreditPeriod(
        ctx.member.address, (await ethers.provider.getBlock("latest"))!.timestamp + MONTH, ONE_DAY
      );
      await advance(MONTH + 2 * ONE_DAY);
      expect(await issuer.inDefault(ctx.member.address)).to.equal(true);

      await issuer.syncCreditPeriod(ctx.member.address);
      expect(await ctx.stableCredit.lostDebt()).to.equal(1_000n * ONE_USDC);
      expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(0n);
    });
  });
});
