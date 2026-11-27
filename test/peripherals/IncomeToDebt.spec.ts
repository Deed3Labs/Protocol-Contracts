import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPhase0Network, drawCredit } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const MONTH = 30 * 24 * 60 * 60;
const ONE_YEAR = 365 * 24 * 60 * 60;

// ITD = (credits received from members + external deposits received) / average balance carried.
// One formula for both phases and both member classes: today the first term is zero for a
// consumer and the second carries it; when B2B ships the first dominates for a merchant.
describe("income to debt", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
  });

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function repay(member: string, amount: bigint) {
    await ctx.usdc.mint(ctx.admin.address, amount);
    await ctx.usdc.approve(await ctx.stableCredit.getAddress(), amount);
    await ctx.stableCredit.repayCreditBalance(member, amount);
  }

  describe("average balance carried", function () {
    it("measures over time, not at a moment", async function () {
      // A member who clears their balance the day before anyone looks has carried it all the same.
      await drawCredit(ctx, 1_000n * ONE_USDC);
      expect(await ctx.creditIssuer.averageBalanceCarriedOf(ctx.member.address)).to.equal(0n);

      await advance(MONTH);
      await ctx.creditIssuer.syncCreditPeriod(ctx.member.address);

      const carried = await ctx.creditIssuer.averageBalanceCarriedOf(ctx.member.address);
      expect(carried).to.be.greaterThan(900n * ONE_USDC);
      expect(carried).to.be.lessThanOrEqual(1_000n * ONE_USDC);
    });

    it("halves when the balance is held for half the window", async function () {
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await advance(MONTH);
      await repay(ctx.member.address, 1_000n * ONE_USDC);
      await advance(MONTH);
      await ctx.creditIssuer.syncCreditPeriod(ctx.member.address);

      const carried = await ctx.creditIssuer.averageBalanceCarriedOf(ctx.member.address);
      expect(carried).to.be.greaterThan(450n * ONE_USDC);
      expect(carried).to.be.lessThan(550n * ONE_USDC);
    });

    it("is nothing for a member who has never drawn", async function () {
      expect(await ctx.creditIssuer.averageBalanceCarriedOf(ctx.counterparty.address))
        .to.equal(0n);
    });
  });

  describe("the ratio", function () {
    it("counts an external deposit as income for a consumer", async function () {
      // Today the first term is zero for a consumer and the second carries it.
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await advance(MONTH);
      await repay(ctx.member.address, 1_000n * ONE_USDC);
      await advance(MONTH);

      const record = await ctx.creditIssuer.incomeOf(ctx.member.address);
      expect(record.depositsReceived).to.equal(1_000n * ONE_USDC);
      expect(record.creditsReceived).to.equal(0n);

      // Roughly 1,000 of income against roughly 500 carried: about 200%.
      const itd = await ctx.creditIssuer.itdOf(ctx.member.address);
      expect(itd).to.be.greaterThan(ethers.parseEther("1.7"));
      expect(itd).to.be.lessThan(ethers.parseEther("2.3"));
    });

    it("counts credits handed over by another member, which is the merchant's case", async function () {
      // When B2B ships the first term dominates. No rule change and no migration, because the
      // formula never distinguished them.
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await advance(MONTH);

      // The counterparty hands credits back: income arriving from inside the ledger.
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 400n * ONE_USDC);

      const record = await ctx.creditIssuer.incomeOf(ctx.member.address);
      expect(record.creditsReceived).to.equal(400n * ONE_USDC);
      expect(record.depositsReceived).to.equal(0n);
    });

    it("adds the two rather than choosing between them", async function () {
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await advance(MONTH);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 400n * ONE_USDC);
      await repay(ctx.member.address, 200n * ONE_USDC);

      const record = await ctx.creditIssuer.incomeOf(ctx.member.address);
      expect(record.creditsReceived + record.depositsReceived).to.equal(600n * ONE_USDC);
    });

    it("has no ratio for a member who carried nothing, rather than a perfect one", async function () {
      // A ratio over an empty denominator is not a good score, it is no score.
      expect(await ctx.creditIssuer.hasBalanceToMeasure(ctx.counterparty.address))
        .to.equal(false);
      expect(await ctx.creditIssuer.itdOf(ctx.counterparty.address)).to.equal(0n);
      // And a member with no measurable history is not failed by a threshold.
      expect(await ctx.creditIssuer.meetsITD(ctx.counterparty.address, ethers.parseEther("5")))
        .to.equal(true);
    });

    it("fails a threshold a real position does not reach", async function () {
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await advance(MONTH);
      await ctx.creditIssuer.syncCreditPeriod(ctx.member.address);

      expect(await ctx.creditIssuer.hasBalanceToMeasure(ctx.member.address)).to.equal(true);
      // Carried a balance, took in nothing.
      expect(await ctx.creditIssuer.itdOf(ctx.member.address)).to.equal(0n);
      expect(await ctx.creditIssuer.meetsITD(ctx.member.address, ethers.parseEther("0.5")))
        .to.equal(false);
    });

    it("is exposed rather than enforced", async function () {
      // What ITD a line requires differs by tier and by member class. Burying one threshold in
      // the ledger would make every future policy a contract change.
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await advance(MONTH);

      // Nothing about a poor ratio stops the member transacting; that is the policy layer's call.
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 0n);
      expect(await ctx.creditIssuer.itdOf(ctx.member.address)).to.equal(0n);
    });
  });

  describe("the equilibrium rule", function () {
    it("treats zero or above as compliant, not zero exactly", async function () {
      // Reading the rule as "to zero" would fail every member the network owes money to, which
      // in Phase 1 is every merchant.
      await drawCredit(ctx, 1_000n * ONE_USDC);

      // The counterparty holds a positive balance and has never owed anything.
      expect(await ctx.stableCredit.balanceOf(ctx.counterparty.address))
        .to.equal(1_000n * ONE_USDC);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.counterparty.address)).to.equal(0n);
      expect(await ctx.creditIssuer.inCompliance(ctx.counterparty.address)).to.equal(true);

      // The member carrying the negative is not.
      expect(await ctx.creditIssuer.inCompliance(ctx.member.address)).to.equal(false);
    });
  });

  describe("the window", function () {
    it("opens fresh when new terms are set", async function () {
      // A member is measured over the terms they are on, not over everything they have ever done.
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await advance(MONTH);
      await repay(ctx.member.address, 1_000n * ONE_USDC);
      expect((await ctx.creditIssuer.incomeOf(ctx.member.address)).depositsReceived)
        .to.equal(1_000n * ONE_USDC);

      const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
      await ctx.creditIssuer
        .connect(ctx.operator)
        .updateCreditPeriod(ctx.member.address, latest + ONE_YEAR, MONTH);

      const record = await ctx.creditIssuer.incomeOf(ctx.member.address);
      expect(record.depositsReceived).to.equal(0n);
      expect(record.creditsReceived).to.equal(0n);
      expect(record.debtSeconds).to.equal(0n);
    });
  });
});
