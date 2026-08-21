import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const ONE_YEAR = 365 * 24 * 60 * 60;

const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const ASSET_INTERNAL = ethers.encodeBytes32String("ASSET_INTERNAL");
const INCOME = ethers.encodeBytes32String("INCOME");
const BOOST = ethers.encodeBytes32String("BOOST");

const UNSECURED = 0, SAVINGS_BACKED = 1, ASSET_INT = 3;

describe("LimitCalculator", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let registry: any, issuer: any, limits: any;
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
    await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);

    // The plan's tiers, cheapest first.
    for (const [kind, rate] of [
      [SAVINGS, 0n],
      [ASSET_INTERNAL, 65n],
      [INCOME, 150n],
      [BOOST, 300n],
    ] as [string, bigint][]) {
      await issuer.connect(ctx.operator).addTier(kind, rate, CYCLE);
    }

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );
    // ESA CLRUSD at 100% LTV; a bond at 95% of present value.
    await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
    await registry.registerCollateralType(ASSET_INTERNAL, ASSET_INT, 9_500n, 10n ** 18n);
    await registry.registerCollateralType(INCOME, UNSECURED, 0n, 0n);
    await registry.registerCollateralType(BOOST, UNSECURED, 0n, 0n);

    const LimitCalculator = await ethers.getContractFactory("LimitCalculator");
    limits = await upgrades.deployProxy(
      LimitCalculator,
      [ctx.admin.address, await registry.getAddress(), await issuer.getAddress()],
      { kind: "uups" }
    );
    await ctx.access.grantOperator(await limits.getAddress());
    await registry.grantRole(await registry.OPERATOR_ROLE(), await limits.getAddress());

    // The member has a line open with no capacity yet.
    await issuer
      .connect(ctx.operator)
      .openLine(ctx.member.address, [0n, 0n, 0n, 0n], ONE_YEAR, CYCLE);
  });

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("collateral becomes capacity", function () {
    it("lends the whole of savings, and most of a bond", async function () {
      await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);

      expect(await limits.capacityOf(ctx.member.address, SAVINGS)).to.equal(1_000n * ONE_USDC);
      expect(await limits.capacityOf(ctx.member.address, ASSET_INTERNAL))
        .to.equal(950n * ONE_USDC);
    });

    it("takes effect immediately, because the member caused it", async function () {
      // A member moving collateral expects the causation they just created.
      expect(await limits.capacityOf(ctx.member.address, SAVINGS)).to.equal(0n);
      await registry.pledge(ctx.member.address, SAVINGS, 500n * ONE_USDC);
      expect(await limits.capacityOf(ctx.member.address, SAVINGS)).to.equal(500n * ONE_USDC);
    });

    it("writes the ceiling onto the issuer and the ledger", async function () {
      await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await limits.pushCapacities(ctx.member.address);

      expect(await issuer.capacityOf(ctx.member.address, 0)).to.equal(1_000n * ONE_USDC);
      expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(950n * ONE_USDC);
      expect(await ctx.stableCredit.creditLimitOf(ctx.member.address))
        .to.equal(1_950n * ONE_USDC);
    });

    it("shrinks the ceiling when collateral is marked down", async function () {
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await limits.pushCapacities(ctx.member.address);
      expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(950n * ONE_USDC);

      await registry.setCollateralTerms(ASSET_INTERNAL, 9_500n, 5n * 10n ** 17n);
      await limits.pushCapacities(ctx.member.address);

      expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(475n * ONE_USDC);
    });
  });

  describe("lending to the haircut leaves the pool covering nothing", function () {
    it("shows no exposure on a member drawn to their limit", async function () {
      // The capacity and the exposure haircut are the same number, not two that happen to agree.
      // What the limit refused to lend is exactly the shortfall exposure would have counted.
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await limits.pushCapacities(ctx.member.address);

      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 950n * ONE_USDC);
      await registry.refresh(ctx.member.address);

      expect(await registry.exposureOf(ctx.member.address)).to.equal(0n);
      expect(await registry.poolExposure()).to.equal(0n);
    });

    it("shows exposure only once carry pushes the position past the limit", async function () {
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await limits.pushCapacities(ctx.member.address);
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 950n * ONE_USDC);

      await advance(6 * CYCLE);
      await issuer.materialiseCarry(ctx.member.address);
      await registry.refresh(ctx.member.address);

      // Exposure on a collateralized tier means something specific rather than being normal.
      expect(await registry.exposureOf(ctx.member.address)).to.be.greaterThan(0n);
    });
  });

  describe("attested capacity waits for the boundary", function () {
    it("does not move a ceiling mid-cycle for a change the member did not cause", async function () {
      const boundary = (await now()) + BigInt(CYCLE);
      await limits.attest(ctx.member.address, INCOME, 600n * ONE_USDC, boundary);

      expect(await limits.capacityOf(ctx.member.address, INCOME)).to.equal(0n);
      const [pending, effectiveFrom] =
        await limits.pendingAttestationOf(ctx.member.address, INCOME);
      expect(pending).to.equal(600n * ONE_USDC);
      expect(effectiveFrom).to.equal(boundary);
    });

    it("applies it once the boundary passes", async function () {
      const boundary = (await now()) + BigInt(CYCLE);
      await limits.attest(ctx.member.address, INCOME, 600n * ONE_USDC, boundary);

      await advance(CYCLE + 60);
      expect(await limits.capacityOf(ctx.member.address, INCOME)).to.equal(600n * ONE_USDC);
    });

    it("keeps the figure in force when a new one is scheduled behind it", async function () {
      const first = (await now()) + BigInt(CYCLE);
      await limits.attest(ctx.member.address, INCOME, 600n * ONE_USDC, first);
      await advance(CYCLE + 60);
      expect(await limits.capacityOf(ctx.member.address, INCOME)).to.equal(600n * ONE_USDC);

      const second = (await now()) + BigInt(CYCLE);
      await limits.attest(ctx.member.address, INCOME, 900n * ONE_USDC, second);

      // The 600 stays in force until the new boundary; it is not discarded by the new figure.
      expect(await limits.capacityOf(ctx.member.address, INCOME)).to.equal(600n * ONE_USDC);
      await advance(CYCLE + 60);
      expect(await limits.capacityOf(ctx.member.address, INCOME)).to.equal(900n * ONE_USDC);
    });

    it("carries Boost the same way, opt-in and underwritten off-chain", async function () {
      const boundary = (await now()) + BigInt(CYCLE);
      await limits.attest(ctx.member.address, BOOST, 750n * ONE_USDC, boundary);
      await advance(CYCLE + 60);

      await limits.pushCapacities(ctx.member.address);
      expect(await issuer.capacityOf(ctx.member.address, 3)).to.equal(750n * ONE_USDC);
    });

    it("only lets an attestor write one", async function () {
      await expect(
        limits.connect(ctx.outsider).attest(ctx.member.address, INCOME, 1n, 1n)
      ).to.be.reverted;
    });
  });

  describe("yield-bearing collateral has to cost more than it yields", function () {
    it("refuses to grant capacity against collateral that out-earns its carry", async function () {
      // A bond paying more than it costs to borrow against is a member drawing free money out of
      // the co-op. The cheapest place to refuse it is before the capacity is granted.
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await limits.setCollateralYield(ASSET_INTERNAL, 65n); // equal to the tier's carry

      await expect(limits.pushCapacities(ctx.member.address))
        .to.be.revertedWithCustomError(limits, "LimitCalculatorYieldExceedsCarry");
    });

    it("allows it once the carry is above the yield", async function () {
      await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
      await limits.setCollateralYield(ASSET_INTERNAL, 60n); // bond yields less than it costs

      await limits.pushCapacities(ctx.member.address);
      expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(950n * ONE_USDC);
    });

    it("does not complain about a tier nothing is pledged against", async function () {
      await limits.setCollateralYield(ASSET_INTERNAL, 900n);
      await limits.pushCapacities(ctx.member.address);
      expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(0n);
    });
  });

  describe("the tiered ceiling", function () {
    it("reports each slice, what it costs and what is drawn", async function () {
      await registry.pledge(ctx.member.address, SAVINGS, 500n * ONE_USDC);
      await limits.pushCapacities(ctx.member.address);
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 300n * ONE_USDC);

      const tiers = await limits.tiersOf(ctx.member.address);
      expect(tiers).to.have.lengthOf(4);
      expect(tiers[0].kind).to.equal(SAVINGS);
      expect(tiers[0].capacity).to.equal(500n * ONE_USDC);
      expect(tiers[0].drawn).to.equal(300n * ONE_USDC);
      expect(tiers[0].ratePerCycle).to.equal(0n);
      expect(tiers[3].ratePerCycle).to.equal(300n);
    });

    it("ascends in rate, so cheapest-first falls out of the order", async function () {
      const tiers = await limits.tiersOf(ctx.member.address);
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i].ratePerCycle).to.be.greaterThanOrEqual(tiers[i - 1].ratePerCycle);
      }
    });
  });
});
