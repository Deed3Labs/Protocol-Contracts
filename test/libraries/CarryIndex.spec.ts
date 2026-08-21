import { expect } from "chai";
import { ethers } from "hardhat";

const DOLLARS = 10n ** 6n;
const RAY = 10n ** 27n;
const CYCLE = 30n * 24n * 60n * 60n; // thirty days
const T0 = 1_800_000_000n;

const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const INCOME = ethers.encodeBytes32String("INCOME");
const BOOST = ethers.encodeBytes32String("BOOST");

describe("CarryIndex", function () {
  let carry: any;
  let member: any, other: any;

  beforeEach(async function () {
    [member, other] = await ethers.getSigners();
    const CarryIndexHarness = await ethers.getContractFactory("CarryIndexHarness");
    carry = await CarryIndexHarness.deploy();
  });

  async function openTier(key: string, ratePerCycle: bigint) {
    await carry.initIndex(key, ratePerCycle, CYCLE, T0);
  }

  describe("the accrual invariant", function () {
    // The build plan calls for this test first, and says it catches most of what can go wrong
    // with lazy accrual. It does: it fails against an index that compounds itself on every touch,
    // and it fails against positions that rebase a stored principal.

    it("reads the same carry untouched for six cycles as touched every cycle", async function () {
      await openTier(INCOME, 150n); // 150 bps per cycle
      const sixCycles = T0 + 6n * CYCLE;

      // Untouched: drawn once, never interacted with again.
      await carry.draw(INCOME, member.address, 1_000n * DOLLARS, T0);
      // Touched every cycle: the same draw, then a real interaction at each boundary.
      await carry.draw(INCOME, other.address, 1_000n * DOLLARS, T0);
      for (let i = 1n; i <= 6n; i++) {
        await carry.draw(INCOME, other.address, 0n, T0 + i * CYCLE);
      }

      const untouched = await carry.accruedCarry(INCOME, member.address, sixCycles);
      const touched = await carry.accruedCarry(INCOME, other.address, sixCycles);

      expect(untouched).to.equal(touched);
      expect(untouched).to.be.greaterThan(0n);
    });

    it("loses a little carry every time a position is rebased", async function () {
      // Why positions are stored normalized and never rebased. The index itself is exact, but
      // re-deriving a stored amount from it truncates, and the truncation runs in the member's
      // favour -- so a position that is interacted with often would quietly owe less than an
      // identical one left alone. Small here, and a leak that scales with interaction count.
      await openTier(BOOST, 300n);
      const sixCycles = T0 + 6n * CYCLE;

      await carry.draw(BOOST, member.address, 1_000n * DOLLARS, T0);
      await carry.draw(BOOST, other.address, 1_000n * DOLLARS, T0);
      for (let i = 1n; i <= 6n; i++) {
        await carry.rebase(BOOST, other.address, T0 + i * CYCLE);
      }

      const normalized = await carry.accruedCarry(BOOST, member.address, sixCycles);
      const rebased = await carry.accruedCarry(BOOST, other.address, sixCycles);

      expect(rebased).to.be.lessThanOrEqual(normalized);
      expect(normalized - rebased).to.be.lessThanOrEqual(6n); // at most one wei per rebase
    });

    it("does not depend on how often the index itself is read", async function () {
      await openTier(INCOME, 150n);
      const sixCycles = T0 + 6n * CYCLE;

      const direct = await carry.currentIndex(INCOME, sixCycles);
      for (let i = 1n; i <= 6n; i++) await carry.currentIndex(INCOME, T0 + i * CYCLE);
      expect(await carry.currentIndex(INCOME, sixCycles)).to.equal(direct);
    });
  });

  describe("accrual shape", function () {
    it("starts at par and does not accrue before its start", async function () {
      await openTier(INCOME, 150n);
      expect(await carry.currentIndex(INCOME, T0)).to.equal(RAY);
      expect(await carry.currentIndex(INCOME, T0 - 1_000n)).to.equal(RAY);
    });

    it("compounds across cycles rather than accruing simple interest", async function () {
      await openTier(INCOME, 150n);
      const oneCycle = await carry.currentIndex(INCOME, T0 + CYCLE);
      const twoCycles = await carry.currentIndex(INCOME, T0 + 2n * CYCLE);

      // 1.015 after one cycle, 1.015^2 = 1.030225 after two -- not 1.03.
      expect(oneCycle).to.equal(RAY + (15n * RAY) / 1000n);
      expect(twoCycles).to.be.greaterThan(oneCycle + (oneCycle - RAY) - 1n);
      expect(twoCycles).to.be.greaterThan(RAY + (30n * RAY) / 1000n); // beats simple interest
    });

    it("worsens a position with every second held, not at cycle boundaries", async function () {
      // Carry accrues continuously. A member who looks at their balance mid-cycle should see it
      // move, rather than sitting flat and stepping on a boundary.
      await openTier(INCOME, 150n);
      await carry.draw(INCOME, member.address, 1_000n * DOLLARS, T0);

      const atStart = await carry.owed(INCOME, member.address, T0);
      const midCycle = await carry.owed(INCOME, member.address, T0 + CYCLE / 2n);
      const atBoundary = await carry.owed(INCOME, member.address, T0 + CYCLE);

      expect(midCycle).to.be.greaterThan(atStart);
      expect(atBoundary).to.be.greaterThan(midCycle);
    });

    it("never accrues on a zero rate", async function () {
      // Savings-backed draws at 0 bps. The tier still has an index; it just never moves.
      await openTier(SAVINGS, 0n);
      await carry.draw(SAVINGS, member.address, 3_000n * DOLLARS, T0);

      expect(await carry.currentIndex(SAVINGS, T0 + 100n * CYCLE)).to.equal(RAY);
      expect(await carry.owed(SAVINGS, member.address, T0 + 100n * CYCLE))
        .to.equal(3_000n * DOLLARS);
      expect(await carry.accruedCarry(SAVINGS, member.address, T0 + 100n * CYCLE)).to.equal(0n);
    });
  });

  describe("draws", function () {
    it("charges a later draw only for the time it was actually held", async function () {
      await openTier(INCOME, 150n);
      await carry.draw(INCOME, member.address, 1_000n * DOLLARS, T0);
      await carry.draw(INCOME, member.address, 1_000n * DOLLARS, T0 + 3n * CYCLE);

      // A member who drew the whole 2,000 up front owes strictly more.
      await carry.draw(INCOME, other.address, 2_000n * DOLLARS, T0);

      const staggered = await carry.owed(INCOME, member.address, T0 + 6n * CYCLE);
      const upfront = await carry.owed(INCOME, other.address, T0 + 6n * CYCLE);

      expect(staggered).to.be.lessThan(upfront);
      expect(staggered).to.be.greaterThan(2_000n * DOLLARS);
    });

    it("derives carry rather than storing it", async function () {
      // The stored value is a normalized amount and the principal drawn. No accrued figure is
      // written anywhere, so nothing can drift from the index.
      await openTier(INCOME, 150n);
      await carry.draw(INCOME, member.address, 1_000n * DOLLARS, T0);

      const [normalizedBefore, principalBefore] = await carry.positionOf(INCOME, member.address);
      await carry.accruedCarry(INCOME, member.address, T0 + 6n * CYCLE);
      const [normalizedAfter, principalAfter] = await carry.positionOf(INCOME, member.address);

      expect(normalizedAfter).to.equal(normalizedBefore);
      expect(principalAfter).to.equal(principalBefore);
      expect(principalAfter).to.equal(1_000n * DOLLARS);
    });
  });

  describe("rate changes", function () {
    it("applies a new rate forward, never retroactively", async function () {
      await openTier(INCOME, 150n);
      const atChange = await carry.currentIndex(INCOME, T0 + 3n * CYCLE);

      await carry.setRate(INCOME, 300n, T0 + 3n * CYCLE);

      // The index does not jump at the moment the rate changes.
      expect(await carry.currentIndex(INCOME, T0 + 3n * CYCLE)).to.equal(atChange);
      // And the three cycles already accrued are untouched by the higher rate.
      const after = await carry.currentIndex(INCOME, T0 + 6n * CYCLE);
      expect(after).to.be.greaterThan(atChange);
    });

    it("rejects a rate above the sanity ceiling", async function () {
      await openTier(INCOME, 150n);
      await expect(carry.setRate(INCOME, 5_001n, T0)).to.be.revertedWithCustomError(
        carry, "RateTooHigh"
      );
    });

    it("rejects a zero cycle length", async function () {
      await expect(carry.initIndex(INCOME, 150n, 0n, T0)).to.be.revertedWithCustomError(
        carry, "InvalidCycleLength"
      );
    });
  });

  describe("separate clocks", function () {
    it("keeps tiers at different rates independent", async function () {
      // One index per tier for revolving, one per plan for term. Two plans at different rates
      // cannot share an index, which is the whole reason these are separate mechanisms.
      await openTier(INCOME, 150n);
      await openTier(BOOST, 300n);

      await carry.draw(INCOME, member.address, 1_000n * DOLLARS, T0);
      await carry.draw(BOOST, member.address, 1_000n * DOLLARS, T0);

      const income = await carry.accruedCarry(INCOME, member.address, T0 + 6n * CYCLE);
      const boost = await carry.accruedCarry(BOOST, member.address, T0 + 6n * CYCLE);

      expect(boost).to.be.greaterThan(income);
      expect(income).to.be.greaterThan(0n);
    });
  });
});
