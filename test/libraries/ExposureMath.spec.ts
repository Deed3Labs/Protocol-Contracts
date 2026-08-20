import { expect } from "chai";
import { ethers } from "hardhat";

const DOLLARS = 10n ** 6n; // stable credit carries six decimals
const HAIRCUT_70 = 7000n;

describe("ExposureMath", function () {
  let math: any;
  let SAVINGS: string, ASSET: string, INCOME: string, BOOST: string;

  beforeEach(async function () {
    const ExposureMathHarness = await ethers.getContractFactory("ExposureMathHarness");
    math = await ExposureMathHarness.deploy();
    [SAVINGS, ASSET, INCOME, BOOST] = await Promise.all([
      math.SAVINGS(), math.ASSET(), math.INCOME(), math.BOOST(),
    ]);
  });

  describe("savings-backed", function () {
    it("contributes nothing, whatever the collateral", async function () {
      // Liquid, already inside the network, seizable at par. Seizure burns the debt and the pool
      // pays nothing, so the position is excluded rather than offset.
      expect(await math.positionExposure(SAVINGS, 3_000n * DOLLARS, 3_000n * DOLLARS, 10_000n))
        .to.equal(0n);
      expect(await math.positionExposure(SAVINGS, 3_000n * DOLLARS, 0n, 0n)).to.equal(0n);
    });
  });

  describe("asset-backed", function () {
    it("contributes only the shortfall left after the haircut", async function () {
      // Cruz from the worked example: $2,000 owed against $2,600 of collateral at a 70% advance
      // rate. $2,600 x 0.70 = $1,820 realizable, so the pool covers $180.
      expect(await math.positionExposure(ASSET, 2_000n * DOLLARS, 2_600n * DOLLARS, HAIRCUT_70))
        .to.equal(180n * DOLLARS);
    });

    it("contributes nothing once the haircut collateral covers the debt", async function () {
      // debt / haircut = 2000 / 0.7 = 2857.14..., so 2,858 of collateral clears it.
      expect(await math.positionExposure(ASSET, 2_000n * DOLLARS, 2_858n * DOLLARS, HAIRCUT_70))
        .to.equal(0n);
    });

    it("floors at zero rather than offsetting other positions", async function () {
      // An over-collateralized position must not subsidise someone else's shortfall.
      expect(await math.positionExposure(ASSET, 1_000n * DOLLARS, 10_000n * DOLLARS, HAIRCUT_70))
        .to.equal(0n);
    });

    it("contributes the full debt at a zero advance rate", async function () {
      expect(await math.positionExposure(ASSET, 2_000n * DOLLARS, 2_600n * DOLLARS, 0n))
        .to.equal(2_000n * DOLLARS);
    });

    it("rejects an advance rate above one hundred percent", async function () {
      await expect(
        math.positionExposure(ASSET, 2_000n * DOLLARS, 2_600n * DOLLARS, 10_001n)
      ).to.be.revertedWithCustomError(math, "InvalidHaircut");
    });
  });

  describe("unsecured", function () {
    it("contributes the full debt", async function () {
      for (const kind of [INCOME, BOOST]) {
        expect(await math.positionExposure(kind, 1_200n * DOLLARS, 0n, 0n))
          .to.equal(1_200n * DOLLARS);
      }
    });

    it("ignores collateral supplied against an unsecured tier", async function () {
      // Income and Boost are underwritten off-chain against no pledge. If a value ever arrives on
      // one of those positions it must not quietly reduce the reserve requirement.
      expect(await math.positionExposure(INCOME, 1_200n * DOLLARS, 5_000n * DOLLARS, 10_000n))
        .to.equal(1_200n * DOLLARS);
    });

    it("treats an unrecognised tier as unsecured", async function () {
      // Partner credit and Clear Cash live here today. So does any tier added before this mapping
      // is updated: an unknown tier must over-reserve, not contribute nothing.
      const unknown = ethers.encodeBytes32String("GROUND_LEASE");
      expect(await math.positionExposure(unknown, 940n * DOLLARS, 0n, 0n))
        .to.equal(940n * DOLLARS);
      expect(await math.backingOf(unknown)).to.equal(0); // Backing.Unsecured
    });
  });

  describe("the worked example", function () {
    it("reproduces the book in the build plan", async function () {
      // Four members owing $7,140 in total.
      const book: Array<[string, bigint, bigint, bigint, bigint]> = [
        // kind,  debt,   collateral, haircut,   expected exposure
        [SAVINGS, 3_000n, 3_000n, 10_000n, 0n],    // Ana
        [INCOME, 1_200n, 0n, 0n, 1_200n],          // Ben
        [ASSET, 2_000n, 2_600n, HAIRCUT_70, 180n], // Cruz
        [INCOME, 940n, 0n, 0n, 940n],              // Dee, partner credit
      ];

      let total = 0n;
      for (const [kind, debt, collateral, haircut, expected] of book) {
        const exposure = await math.positionExposure(
          kind, debt * DOLLARS, collateral * DOLLARS, haircut
        );
        expect(exposure).to.equal(expected * DOLLARS);
        total += exposure;
      }

      // $2,320, not the $2,321 the plan's table prints: Cruz is $2,000 - $1,820 = $180 exactly.
      expect(total).to.equal(2_320n * DOLLARS);

      // The two formulas the plan rejects, for contrast.
      const totalDebt = 7_140n * DOLLARS;
      const unsecuredOnly = (1_200n + 940n) * DOLLARS;
      expect(total).to.be.lessThan(totalDebt); // counting Ana over-reserves
      expect(total).to.be.greaterThan(unsecuredOnly); // dropping Cruz under-reserves
    });
  });
});
