import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const ONE_YEAR = 365 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;

// The plan's tiers, cheapest first.
const TIERS = [
  { name: "SAVINGS", rate: 0n },
  { name: "ASSET_INTERNAL", rate: 65n },
  { name: "INCOME", rate: 150n },
  { name: "BOOST", rate: 300n },
];

describe("RevolvingIssuer", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let issuer: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    issuer = await RevolvingIssuer.deploy();
    await issuer.initialize(await ctx.stableCredit.getAddress());

    await ctx.networkRegistry.registerIssuer(
      await issuer.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await ctx.access.grantOperator(await issuer.getAddress());

    for (const tier of TIERS) {
      await issuer
        .connect(ctx.operator)
        .addTier(ethers.encodeBytes32String(tier.name), tier.rate, CYCLE);
    }
    await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);
  });

  async function openLine(capacities: bigint[]) {
    await issuer
      .connect(ctx.operator)
      .openLine(ctx.member.address, capacities, ONE_YEAR, CYCLE);
  }

  async function spend(amount: bigint) {
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount);
  }

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("the ceiling is composed of tiers", function () {
    it("sums tier capacities into the member's ledger ceiling", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));

      expect(await issuer.totalCapacityOf(ctx.member.address)).to.equal(1_100n * ONE_USDC);
      expect(await ctx.stableCredit.creditLimitOf(ctx.member.address))
        .to.equal(1_100n * ONE_USDC);
    });

    it("keeps rates ascending across tiers", async function () {
      // Cheapest-first is not enforced as a rule; it falls out of the ordering.
      for (let i = 0; i < TIERS.length; i++) {
        const [, rate] = await issuer.tierAt(i);
        expect(rate).to.equal(TIERS[i].rate);
        if (i > 0) {
          const [, previous] = await issuer.tierAt(i - 1);
          expect(rate).to.be.greaterThanOrEqual(previous);
        }
      }
    });

    it("refuses a tier that would undercut the one before it", async function () {
      await expect(
        issuer.connect(ctx.operator).addTier(ethers.encodeBytes32String("CHEAP"), 100n, CYCLE)
      ).to.be.revertedWithCustomError(issuer, "RevolvingIssuerRatesMustAscend");
    });

    it("refuses a rate change that would break the ordering in either direction", async function () {
      // INCOME sits between ASSET_INTERNAL at 65 and BOOST at 300.
      await expect(issuer.connect(ctx.operator).setTierRate(2, 60n))
        .to.be.revertedWithCustomError(issuer, "RevolvingIssuerRatesMustAscend");
      await expect(issuer.connect(ctx.operator).setTierRate(2, 400n))
        .to.be.revertedWithCustomError(issuer, "RevolvingIssuerRatesMustAscend");

      await issuer.connect(ctx.operator).setTierRate(2, 200n);
      const [, rate] = await issuer.tierAt(2);
      expect(rate).to.equal(200n);
    });

    it("refuses to cut a tier's capacity below what is drawn there", async function () {
      await openLine([300n, 0n, 0n, 0n].map((n) => n * ONE_USDC));
      await spend(300n * ONE_USDC);

      await expect(
        issuer.connect(ctx.operator).setTierCapacity(ctx.member.address, 0, 200n * ONE_USDC)
      ).to.be.revertedWithCustomError(issuer, "RevolvingIssuerCapacityBelowDrawn");
    });
  });

  describe("drawing fills the cheapest tier first", function () {
    it("uses one tier before touching the next", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(300n * ONE_USDC);

      expect(await issuer.drawnOf(ctx.member.address, 0)).to.equal(300n * ONE_USDC);
      expect(await issuer.drawnOf(ctx.member.address, 1)).to.equal(0n);
    });

    it("spills into the next tier only once the cheaper one is full", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(700n * ONE_USDC);

      expect(await issuer.drawnOf(ctx.member.address, 0)).to.equal(300n * ONE_USDC);
      expect(await issuer.drawnOf(ctx.member.address, 1)).to.equal(400n * ONE_USDC);
      expect(await issuer.drawnOf(ctx.member.address, 2)).to.equal(0n);
    });

    it("reaches the most expensive tier last", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(1_100n * ONE_USDC);

      expect(await issuer.drawnOf(ctx.member.address, 3)).to.equal(100n * ONE_USDC);
      expect(await issuer.headroomOf(ctx.member.address, 3)).to.equal(0n);
    });

    it("skips a tier that has been closed to new draws", async function () {
      // Closing does not call in what is drawn; it stops the tier growing.
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await issuer.connect(ctx.operator).setTierActive(1, false);
      await spend(500n * ONE_USDC);

      expect(await issuer.drawnOf(ctx.member.address, 0)).to.equal(300n * ONE_USDC);
      expect(await issuer.drawnOf(ctx.member.address, 1)).to.equal(0n);
      expect(await issuer.drawnOf(ctx.member.address, 2)).to.equal(200n * ONE_USDC);
    });

    it("keeps the tiers summing to the ledger balance", async function () {
      // A member's balance is the sum of their positions, never a second opinion of it.
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(750n * ONE_USDC);

      expect(await issuer.totalPrincipalOf(ctx.member.address))
        .to.equal(await ctx.stableCredit.creditBalanceOf(ctx.member.address));
      expect(await issuer.totalDrawnOf(ctx.member.address)).to.equal(750n * ONE_USDC);
    });
  });

  describe("carry accrues per tier", function () {
    it("charges nothing on the savings-backed tier, ever", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(300n * ONE_USDC);

      await advance(12 * CYCLE);
      expect(await issuer.carryOf(ctx.member.address, 0)).to.equal(0n);
      expect(await issuer.drawnOf(ctx.member.address, 0)).to.equal(300n * ONE_USDC);
    });

    it("charges more on a more expensive tier for the same money and time", async function () {
      await openLine([0n, 500n, 500n, 500n].map((n) => n * ONE_USDC));
      // Fill tier 1 exactly, then tier 2 exactly.
      await spend(1_000n * ONE_USDC);
      await advance(6 * CYCLE);

      const cheaper = await issuer.carryOf(ctx.member.address, 1); // 65 bps
      const dearer = await issuer.carryOf(ctx.member.address, 2); // 150 bps
      expect(dearer).to.be.greaterThan(cheaper);
      expect(cheaper).to.be.greaterThan(0n);
    });

    it("lets carry consume headroom, because the ceiling bounds what is owed", async function () {
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);
      const before = await issuer.headroomOf(ctx.member.address, 2);

      await advance(6 * CYCLE);
      expect(await issuer.headroomOf(ctx.member.address, 2)).to.be.lessThan(before);
    });

    it("does not store an accrued figure against the member", async function () {
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);

      await advance(6 * CYCLE);
      const carry = await issuer.carryOf(ctx.member.address, 2);
      expect(carry).to.be.greaterThan(0n);
      // Reading it repeatedly cannot change it, because nothing was written.
      expect(await issuer.carryOf(ctx.member.address, 2)).to.equal(carry);
    });
  });

  describe("repayment clears the most expensive tier first", function () {
    it("pays down the dearest slice before the cheaper ones", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(1_100n * ONE_USDC);

      // The counterparty sends 300 back, which burns against the member's debt.
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 300n * ONE_USDC);

      expect(await issuer.principalOf(ctx.member.address, 3)).to.equal(0n); // 100, cleared
      expect(await issuer.principalOf(ctx.member.address, 2)).to.equal(0n); // 200, cleared
      expect(await issuer.principalOf(ctx.member.address, 1)).to.equal(500n * ONE_USDC);
      expect(await issuer.principalOf(ctx.member.address, 0)).to.equal(300n * ONE_USDC);
    });

    it("leaves nothing behind to accrue on when a tier is cleared in full", async function () {
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(500n * ONE_USDC);
      await advance(3 * CYCLE);

      // The counterparty holds the principal; the carry above it was never minted to anyone,
      // so the most they can hand back is what they were paid.
      const held = await ctx.stableCredit.balanceOf(ctx.counterparty.address);
      await ctx.stableCredit.connect(ctx.counterparty).transfer(ctx.member.address, held);

      // Principal is settled; only the carry that accrued above it remains.
      expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(0n);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
    });

    it("reduces principal, and leaves the carry above it outstanding", async function () {
      // A repayment arriving through the ledger can only be repaying principal: the ledger's
      // credit balance moves when credit moves, and accrued carry has never moved anywhere.
      // Settling carry first is the intended rule and needs carry materialised onto the ledger.
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);
      await advance(6 * CYCLE);

      const carry = await issuer.carryOf(ctx.member.address, 2);
      expect(carry).to.be.greaterThan(0n);

      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 400n * ONE_USDC);

      // Principal is gone from both the tier and the ledger.
      expect(await issuer.principalOf(ctx.member.address, 2)).to.equal(0n);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);

      // What accrued is still owed, and still reads as carry.
      const remaining = await issuer.carryOf(ctx.member.address, 2);
      expect(remaining).to.be.greaterThan(0n);
      expect(await issuer.drawnOf(ctx.member.address, 2)).to.equal(remaining);
    });

    it("keeps the tiers summing to the ledger balance after repayment", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(900n * ONE_USDC);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 400n * ONE_USDC);

      // Principal reconciles exactly with the ledger. What sits above it is carry, which the
      // ledger does not yet know about -- see totalPrincipalOf.
      expect(await issuer.totalPrincipalOf(ctx.member.address))
        .to.equal(await ctx.stableCredit.creditBalanceOf(ctx.member.address));
      expect(await issuer.totalDrawnOf(ctx.member.address))
        .to.be.greaterThanOrEqual(await issuer.totalPrincipalOf(ctx.member.address));
    });
  });

  describe("default", function () {
    it("writes off only what sits in these tiers", async function () {
      await openLine([300n, 0n, 0n, 0n].map((n) => n * ONE_USDC));
      await spend(300n * ONE_USDC);

      await advance(ONE_YEAR + CYCLE + ONE_DAY);
      expect(await issuer.inDefault(ctx.member.address)).to.equal(true);
      await issuer.syncCreditPeriod(ctx.member.address);

      expect(await ctx.stableCredit.lostDebt()).to.equal(300n * ONE_USDC);
      expect(await issuer.totalDrawnOf(ctx.member.address)).to.equal(0n);
      expect(await issuer.totalCapacityOf(ctx.member.address)).to.equal(0n);
    });
  });
});
