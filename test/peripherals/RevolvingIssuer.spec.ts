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
  let coop: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    coop = (await ethers.getSigners())[8];

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    issuer = await RevolvingIssuer.deploy();
    await issuer.initialize(await ctx.stableCredit.getAddress(), coop.address);

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
    // Carry is owed to whoever funded the draw. The co-op treasury by default; the LendingPool
    // once the unsecured tiers are funded from it.
    await ctx.access.connect(ctx.operator).grantMember(coop.address);
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
      expect(await issuer.carryOf(ctx.member.address, 2)).to.equal(carry);
    });
  });

  describe("the network's cycle", function () {
    // What sets a member's cycle used to be "whatever the caller passed". Nothing supplied a
    // default and nothing said what it should be, so two members could sit on different clocks
    // with the contracts looking identical.

    it("takes its cycle from the tiers, since that is where the clock lives", async function () {
      expect(await issuer.cycleLength()).to.equal(CYCLE);
    });

    it("refuses a tier that would run on a different clock", async function () {
      // Two tiers accruing on different periods make "cheapest first" meaningless -- the rates
      // stop being comparable, and draw order is priced off exactly that comparison.
      await expect(
        issuer.connect(ctx.operator).addTier(ethers.encodeBytes32String("ODD"), 400n, 7 * 24 * 60 * 60),
      ).to.be.revertedWithCustomError(issuer, "RevolvingIssuerCycleMismatch");
    });

    it("opens a line on the network's cycle when asked for no particular one", async function () {
      await issuer
        .connect(ctx.operator)
        .openLine(ctx.member.address, [100n * ONE_USDC], 0, CYCLE);

      const [issuedAt, expiration] = await issuer.creditPeriods(ctx.member.address);
      expect(expiration - issuedAt).to.equal(BigInt(CYCLE));
    });

    it("still allows a longer period, because that is a policy choice", async function () {
      // The rebalance period and the carry cycle answer different questions: how long a member has
      // to return to zero, and how often carry compounds. They coincide at thirty days by policy,
      // not by arithmetic.
      await issuer
        .connect(ctx.operator)
        .openLine(ctx.member.address, [100n * ONE_USDC], ONE_YEAR, CYCLE);

      const [issuedAt, expiration] = await issuer.creditPeriods(ctx.member.address);
      expect(expiration - issuedAt).to.equal(BigInt(ONE_YEAR));
    });
  });

  describe("carry lands on the ledger", function () {
    // Carry deepens the member's negative balance. Until it is on the ledger it is a figure this
    // contract derives and nothing can repay, because the balance a payment burns against does
    // not include it.

    it("deepens the negative balance and mints the claim to whoever funded the draw", async function () {
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);
      await advance(6 * CYCLE);

      const owedBefore = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      const supplyBefore = await ctx.stableCredit.totalSupply();

      await issuer.materialiseCarry(ctx.member.address);

      // Carry accrues every second, including the one between reading a figure and writing it,
      // so the amounts are compared against each other rather than against an earlier read.
      const minted = await ctx.stableCredit.balanceOf(coop.address);
      expect(minted).to.be.greaterThan(0n);
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
        .to.equal(owedBefore + minted);
      expect(await ctx.stableCredit.totalSupply()).to.equal(supplyBefore + minted);
    });

    it("nets to zero, like every other movement on the ledger", async function () {
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);
      await advance(6 * CYCLE);
      await issuer.materialiseCarry(ctx.member.address);

      // What the member owes equals what everyone else holds.
      const owed = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      const held =
        (await ctx.stableCredit.balanceOf(ctx.counterparty.address)) +
        (await ctx.stableCredit.balanceOf(coop.address));
      expect(owed).to.equal(held);
    });

    it("does not accrue the same carry twice", async function () {
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);
      await advance(6 * CYCLE);

      await issuer.materialiseCarry(ctx.member.address);
      const afterFirst = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      expect(afterFirst - 400n * ONE_USDC).to.be.greaterThan(ONE_USDC); // six cycles' worth

      await issuer.materialiseCarry(ctx.member.address);
      const afterSecond = await ctx.stableCredit.creditBalanceOf(ctx.member.address);

      // The second call takes only the seconds since the first, not the six cycles again.
      expect(afterSecond - afterFirst).to.be.lessThan(1_000n);
    });

    it("keeps the tiers summing to the ledger balance once carry is on it", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(900n * ONE_USDC);
      await advance(6 * CYCLE);
      await issuer.materialiseCarry(ctx.member.address);

      expect(await issuer.totalPrincipalOf(ctx.member.address))
        .to.equal(await ctx.stableCredit.creditBalanceOf(ctx.member.address));
      expect(await issuer.totalDrawnOf(ctx.member.address))
        .to.equal(await issuer.totalPrincipalOf(ctx.member.address));
    });

    it("materialises on the next interaction without being asked", async function () {
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(300n * ONE_USDC);
      await advance(6 * CYCLE);
      expect(await issuer.carryOf(ctx.member.address, 2)).to.be.greaterThan(0n);

      await spend(10n * ONE_USDC);
      // Cleared but for the seconds since the spend settled.
      expect(await issuer.carryOf(ctx.member.address, 2)).to.be.lessThan(1_000n);
      expect(await ctx.stableCredit.balanceOf(coop.address)).to.be.greaterThan(ONE_USDC);
    });

    it("can carry a member past their ceiling, and then they cannot draw", async function () {
      // Carry is what makes headroom shrink. A ceiling that stopped it accruing once reached
      // would make standing still free.
      await openLine([0n, 0n, 100n, 0n].map((n) => n * ONE_USDC));
      await spend(100n * ONE_USDC);
      await advance(11 * CYCLE); // inside the credit period, so this is the ceiling and not default

      await issuer.materialiseCarry(ctx.member.address);
      const owed = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      expect(owed).to.be.greaterThan(100n * ONE_USDC);
      expect(await ctx.stableCredit.creditLimitLeftOf(ctx.member.address)).to.equal(0n);

      await expect(spend(1n * ONE_USDC)).to.be.revertedWith("MutualCredit: Insufficient credit");
    });

    it("lets a member repay carry once it is on the ledger", async function () {
      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);
      await advance(6 * CYCLE);
      await issuer.materialiseCarry(ctx.member.address);

      const owed = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      // The counterparty holds the principal and the co-op holds the carry; together they are
      // exactly what is owed.
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 400n * ONE_USDC);
      await ctx.stableCredit
        .connect(coop)
        .transfer(ctx.member.address, owed - 400n * ONE_USDC);

      // A few wei accrued between the two payments, which is the mechanism working rather than
      // failing. What matters is that the tiers and the ledger still agree.
      const left = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      expect(left).to.be.lessThan(1_000n);
      expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(left);
    });
  });

  describe("carry always has somewhere to go", function () {
    // Carry accrues on every interaction, so a recipient that cannot be resolved does not lose
    // the carry -- it reverts the transfer that triggered the accrual, and members stop being
    // able to spend. The treasury is the backstop that makes that unreachable.

    it("falls back to the treasury when a tier names nobody", async function () {
      for (let i = 0; i < TIERS.length; i++) {
        expect(await issuer.carryRecipientOf(i)).to.equal(coop.address);
      }
    });

    it("pays a tier's own recipient when it has one", async function () {
      const pool = (await ethers.getSigners())[9];
      await ctx.access.connect(ctx.operator).grantMember(pool.address);
      await issuer.connect(ctx.operator).setTierCarryRecipient(2, pool.address);

      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);
      await advance(6 * CYCLE);
      await issuer.materialiseCarry(ctx.member.address);

      expect(await ctx.stableCredit.balanceOf(pool.address)).to.be.greaterThan(0n);
      expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(0n);
    });

    it("returns a tier to the treasury when its funding source is retired", async function () {
      // Carry keeps accruing and keeps landing somewhere. What landed with the retired pool in
      // the meantime is still on the ledger and can be settled by hand.
      const pool = (await ethers.getSigners())[9];
      await ctx.access.connect(ctx.operator).grantMember(pool.address);
      await issuer.connect(ctx.operator).setTierCarryRecipient(2, pool.address);

      await openLine([0n, 0n, 500n, 0n].map((n) => n * ONE_USDC));
      await spend(400n * ONE_USDC);
      await advance(3 * CYCLE);
      await issuer.materialiseCarry(ctx.member.address);
      const toPool = await ctx.stableCredit.balanceOf(pool.address);
      expect(toPool).to.be.greaterThan(0n);

      await issuer.connect(ctx.operator).setTierCarryRecipient(2, ethers.ZeroAddress);
      expect(await issuer.carryRecipientOf(2)).to.equal(coop.address);

      await advance(3 * CYCLE);
      await issuer.materialiseCarry(ctx.member.address);

      // The pool keeps what it was owed; everything since goes to the treasury.
      expect(await ctx.stableCredit.balanceOf(pool.address)).to.equal(toPool);
      expect(await ctx.stableCredit.balanceOf(coop.address)).to.be.greaterThan(0n);
    });

    it("refuses to deploy or leave itself without a treasury", async function () {
      const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
      const orphan = await RevolvingIssuer.deploy();
      await expect(
        orphan.initialize(await ctx.stableCredit.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(orphan, "RevolvingIssuerNoCarryRecipient");

      await expect(
        issuer.connect(ctx.operator).setCarryTreasury(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(issuer, "RevolvingIssuerNoCarryRecipient");
    });
  });

  describe("repayment clears the most expensive tier first", function () {
    it("pays down the dearest slice before the cheaper ones", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(1_100n * ONE_USDC);

      // Bring carry onto the ledger, then hand back exactly the two dearest tiers.
      await issuer.materialiseCarry(ctx.member.address);
      const boost = await issuer.principalOf(ctx.member.address, 3);
      const income = await issuer.principalOf(ctx.member.address, 2);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, boost + income);

      expect(await issuer.principalOf(ctx.member.address, 3)).to.equal(0n);
      expect(await issuer.principalOf(ctx.member.address, 2)).to.be.lessThan(1_000n);
      expect(await issuer.principalOf(ctx.member.address, 1)).to.be.greaterThan(499n * ONE_USDC);
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

      // The principal is settled; what remains on the ledger is the carry, now owed to the co-op.
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
        .to.equal(await ctx.stableCredit.balanceOf(coop.address));
      expect(await issuer.totalPrincipalOf(ctx.member.address))
        .to.equal(await ctx.stableCredit.creditBalanceOf(ctx.member.address));
    });

    it("settles the dearest tier first, carry included", async function () {
      // Carry is materialised before the repayment is allocated, so by the time the payment is
      // placed there is no separate carry to settle -- it is debt in the tier that accrued it,
      // and the most expensive tier clears first.
      await openLine([0n, 0n, 300n, 300n].map((n) => n * ONE_USDC));
      await spend(600n * ONE_USDC);
      await advance(6 * CYCLE);

      await issuer.materialiseCarry(ctx.member.address);
      const boost = await issuer.principalOf(ctx.member.address, 3);
      // Boost accrued at 300 bps and income at 150, so the dearest slice is the larger one.
      expect(boost).to.be.greaterThan(await issuer.principalOf(ctx.member.address, 2));

      await ctx.stableCredit.connect(ctx.counterparty).transfer(ctx.member.address, boost);

      // Boost, the dearest, is gone but for the seconds since; income still carries its balance.
      expect(await issuer.principalOf(ctx.member.address, 3)).to.be.lessThan(1_000n);
      expect(await issuer.principalOf(ctx.member.address, 2)).to.be.greaterThan(299n * ONE_USDC);
    });

    it("keeps the tiers summing to the ledger balance after repayment", async function () {
      await openLine([300n, 500n, 200n, 100n].map((n) => n * ONE_USDC));
      await spend(900n * ONE_USDC);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 400n * ONE_USDC);

      expect(await issuer.totalPrincipalOf(ctx.member.address))
        .to.equal(await ctx.stableCredit.creditBalanceOf(ctx.member.address));
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
