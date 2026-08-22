import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const ONE_YEAR = 365 * 24 * 60 * 60;

const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const ASSET_INTERNAL = ethers.encodeBytes32String("ASSET_INTERNAL");
const ASSET_EXTERNAL = ethers.encodeBytes32String("ASSET_EXTERNAL");
const INCOME = ethers.encodeBytes32String("INCOME");

// ExposureMath.Backing
const UNSECURED = 0, SAVINGS_BACKED = 1, ASSET_EXT = 2, ASSET_INT = 3;

describe("CollateralRegistry", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let registry: any, revolving: any;
  let coop: any, counterparty: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    coop = (await ethers.getSigners())[8];
    counterparty = ctx.counterparty;

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    revolving = await RevolvingIssuer.deploy();
    await revolving.initialize(await ctx.stableCredit.getAddress(), coop.address);
    await ctx.networkRegistry.registerIssuer(
      await revolving.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await ctx.access.grantOperator(await revolving.getAddress());
    await ctx.access.connect(ctx.operator).grantMember(coop.address);
    await ctx.access.connect(ctx.operator).grantMember(counterparty.address);

    for (const [kind, rate] of [
      [SAVINGS, 0n],
      [ASSET_INTERNAL, 65n],
      [INCOME, 150n],
    ] as [string, bigint][]) {
      await revolving.connect(ctx.operator).addTier(kind, rate, CYCLE);
    }

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );

    // ESA CLRUSD at par, a bond at 95% of its redemption value, a deed at a market haircut.
    await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
    await registry.registerCollateralType(ASSET_INTERNAL, ASSET_INT, 9_500n, 10n ** 18n);
    await registry.registerCollateralType(ASSET_EXTERNAL, ASSET_EXT, 7_000n, 10n ** 18n);
    await registry.registerCollateralType(INCOME, UNSECURED, 0n, 0n);
  });

  async function openLine(capacities: bigint[]) {
    await revolving
      .connect(ctx.operator)
      .openLine(ctx.member.address, capacities, ONE_YEAR, CYCLE);
  }

  async function spend(amount: bigint) {
    await ctx.stableCredit.connect(ctx.member).transfer(counterparty.address, amount);
  }

  describe("what the pool would pay", function () {
    it("counts nothing against savings-backed credit", async function () {
      // The plan's test: with only savings-backed credit live, reserves needed are exactly zero.
      await openLine([1_000n * ONE_USDC, 0n, 0n]);
      await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
      await spend(1_000n * ONE_USDC);
      await registry.refresh(ctx.member.address);

      expect(await registry.exposureOf(ctx.member.address)).to.equal(0n);
      expect(await registry.poolExposure()).to.equal(0n);
    });

    it("counts the shortfall on an under-collateralized asset-backed position", async function () {
      // 2,600 pledged at 95% realizes 2,470 against 2,600 drawn: a 130 gap.
      await openLine([0n, 2_600n * ONE_USDC, 0n]);
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 2_600n * ONE_USDC);
      await spend(2_600n * ONE_USDC);
      await registry.refresh(ctx.member.address);

      expect(await registry.exposureOf(ctx.member.address)).to.equal(130n * ONE_USDC);
    });

    it("counts an unsecured position in full", async function () {
      await openLine([0n, 0n, 1_200n * ONE_USDC]);
      await spend(1_200n * ONE_USDC);
      await registry.refresh(ctx.member.address);

      expect(await registry.exposureOf(ctx.member.address)).to.equal(1_200n * ONE_USDC);
    });

    it("haircuts an internal claim and an external asset differently", async function () {
      // The same debt against the same value: a bond at 95% and a deed at 70%.
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await registry.pledge(ctx.member.address, ASSET_EXTERNAL, 1_000n * ONE_USDC);

      expect(await registry.collateralValueOf(ctx.member.address, ASSET_INTERNAL))
        .to.equal(1_000n * ONE_USDC);
      expect(await registry.collateralValueOf(ctx.member.address, ASSET_EXTERNAL))
        .to.equal(1_000n * ONE_USDC);

      const internalTerms = await registry.collateralTypes(ASSET_INTERNAL);
      const externalTerms = await registry.collateralTypes(ASSET_EXTERNAL);
      expect(internalTerms.haircutBps).to.equal(9_500n);
      expect(externalTerms.haircutBps).to.equal(7_000n);
    });

    it("adds up a mixed book rather than reaching for either extreme", async function () {
      await openLine([500n * ONE_USDC, 1_000n * ONE_USDC, 400n * ONE_USDC]);
      await registry.pledge(ctx.member.address, SAVINGS, 500n * ONE_USDC);
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await spend(1_900n * ONE_USDC);
      await registry.refresh(ctx.member.address);

      // Savings 500: nothing. Asset 1,000 against 950 realizable: 50. Income 400: all of it.
      expect(await registry.exposureOf(ctx.member.address)).to.equal(450n * ONE_USDC);
      // Neither the whole 1,900 nor the 400 that is strictly unsecured.
      expect(await registry.exposureOf(ctx.member.address)).to.not.equal(1_900n * ONE_USDC);
      expect(await registry.exposureOf(ctx.member.address)).to.not.equal(400n * ONE_USDC);
    });
  });

  describe("the running total", function () {
    it("is maintained rather than iterated", async function () {
      await openLine([0n, 0n, 1_000n * ONE_USDC]);
      expect(await registry.poolExposure()).to.equal(0n);

      await spend(600n * ONE_USDC);
      // Nothing has told the registry yet, so the total is still what was last recorded.
      expect(await registry.poolExposure()).to.equal(0n);

      await registry.refresh(ctx.member.address);
      expect(await registry.poolExposure()).to.equal(600n * ONE_USDC);
    });

    it("folds in the difference, not the whole figure, on every refresh", async function () {
      await openLine([0n, 0n, 1_000n * ONE_USDC]);
      await spend(600n * ONE_USDC);
      await registry.refresh(ctx.member.address);
      await registry.refresh(ctx.member.address);
      await registry.refresh(ctx.member.address);

      expect(await registry.poolExposure()).to.equal(600n * ONE_USDC);
    });

    it("falls again when the debt is repaid", async function () {
      await openLine([0n, 0n, 1_000n * ONE_USDC]);
      await spend(600n * ONE_USDC);
      await registry.refresh(ctx.member.address);

      await ctx.stableCredit
        .connect(counterparty)
        .transfer(ctx.member.address, 600n * ONE_USDC);
      await registry.refresh(ctx.member.address);

      // What is left is the carry that accrued between spending and repaying, which the
      // counterparty was never paid and so could not hand back.
      expect(await registry.poolExposure()).to.be.lessThan(10_000n);
    });

    it("can be corrected by anyone", async function () {
      // Permissionless, so a missed call by whoever caused a change does not leave the figure
      // the AssurancePool reserves against stale.
      await openLine([0n, 0n, 1_000n * ONE_USDC]);
      await spend(600n * ONE_USDC);

      await registry.connect(ctx.outsider).refresh(ctx.member.address);
      expect(await registry.poolExposure()).to.equal(600n * ONE_USDC);
    });

    it("drives the AssurancePool's reserve requirement", async function () {
      // The seam Phase 0 left open, now filled.
      await ctx.assurancePool
        .connect(ctx.admin)
        .setExposureSource(await registry.getAddress());

      await openLine([1_000n * ONE_USDC, 0n, 0n]);
      await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
      await spend(1_000n * ONE_USDC);
      await registry.refresh(ctx.member.address);

      // Credit outstanding, an empty reserve, and nothing needed: it is all savings-backed.
      expect(await ctx.stableCredit.totalSupply()).to.equal(1_000n * ONE_USDC);
      expect(await ctx.assurancePool.poolExposure()).to.equal(0n);
      expect(await ctx.assurancePool.neededReserves()).to.equal(0n);
      expect(await ctx.assurancePool.hasValidRTD()).to.equal(true);
    });
  });

  describe("pledges are locked while they back something", function () {
    it("lets a member release what is not backing anything", async function () {
      await openLine([1_000n * ONE_USDC, 0n, 0n]);
      await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);

      expect(await registry.freeCollateralOf(ctx.member.address, SAVINGS))
        .to.equal(1_000n * ONE_USDC);
      await registry.release(ctx.member.address, SAVINGS, 400n * ONE_USDC);
      expect(await registry.pledgedOf(ctx.member.address, SAVINGS)).to.equal(600n * ONE_USDC);
    });

    it("refuses to release what is holding up drawn credit", async function () {
      await openLine([1_000n * ONE_USDC, 0n, 0n]);
      await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
      await spend(1_000n * ONE_USDC);

      expect(await registry.freeCollateralOf(ctx.member.address, SAVINGS)).to.equal(0n);
      await expect(registry.release(ctx.member.address, SAVINGS, 1n))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryEncumbered");
    });

    it("frees collateral again as the credit is repaid", async function () {
      await openLine([1_000n * ONE_USDC, 0n, 0n]);
      await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
      await spend(1_000n * ONE_USDC);

      await ctx.stableCredit
        .connect(counterparty)
        .transfer(ctx.member.address, 400n * ONE_USDC);

      expect(await registry.freeCollateralOf(ctx.member.address, SAVINGS))
        .to.equal(400n * ONE_USDC);
    });

    it("locks less of a pledge that is haircut above par than one at par", async function () {
      // A bond realizing 95% has to cover 600 of debt with 631.5 of pledge; savings at par
      // covers it with 600.
      await openLine([600n * ONE_USDC, 700n * ONE_USDC, 0n]);
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 700n * ONE_USDC);
      await spend(600n * ONE_USDC); // fills the savings tier first
      await registry.pledge(ctx.member.address, SAVINGS, 600n * ONE_USDC);

      expect(await registry.freeCollateralOf(ctx.member.address, SAVINGS)).to.equal(0n);
      expect(await registry.freeCollateralOf(ctx.member.address, ASSET_INTERNAL))
        .to.equal(700n * ONE_USDC);
    });
  });

  describe("configuration", function () {
    it("refuses a haircut above one hundred percent", async function () {
      await expect(
        registry.registerCollateralType(
          ethers.encodeBytes32String("SILLY"), ASSET_EXT, 10_001n, 10n ** 18n
        )
      ).to.be.revertedWithCustomError(registry, "CollateralRegistryHaircutTooHigh");
    });

    it("refuses to register the same kind twice", async function () {
      await expect(
        registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n)
      ).to.be.revertedWithCustomError(registry, "CollateralRegistryTypeExists");
    });

    it("raises what the pool reserves when collateral is marked down", async function () {
      await openLine([0n, 1_000n * ONE_USDC, 0n]);
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await spend(1_000n * ONE_USDC);
      await registry.refresh(ctx.member.address);
      expect(await registry.poolExposure()).to.equal(50n * ONE_USDC);

      // The claim is worth half what it was.
      await registry.setCollateralTerms(ASSET_INTERNAL, 9_500n, 5n * 10n ** 17n);
      await registry.refresh(ctx.member.address);

      expect(await registry.poolExposure()).to.equal(525n * ONE_USDC);
    });

    it("is operator gated", async function () {
      await expect(
        registry.connect(ctx.outsider).pledge(ctx.member.address, SAVINGS, 1n)
      ).to.be.reverted;
      await expect(
        registry.connect(ctx.outsider).setCollateralTerms(SAVINGS, 1n, 1n)
      ).to.be.reverted;
    });
  });
});
