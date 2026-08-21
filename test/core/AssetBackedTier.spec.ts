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
const SAVINGS_BACKED = 1, ASSET_EXT = 2, ASSET_INT = 3, UNSECURED = 0;

// Phase 4's wiring: bonds and pool shares register as collateral, LimitCalculator picks them up,
// and the asset-backed tier lights up. A bond and a pool share are both claims on the co-op
// itself, so they are haircut on redemption terms; a tokenised deed is haircut on a market.
describe("the asset-backed tier", function () {
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

    // The plan's tiers: savings free, a bond at 65 bps, a deed above it, income above that.
    for (const [kind, rate] of [
      [SAVINGS, 0n],
      [ASSET_INTERNAL, 65n],
      [ASSET_EXTERNAL, 75n],
      [INCOME, 150n],
    ] as [string, bigint][]) {
      await issuer.connect(ctx.operator).addTier(kind, rate, CYCLE);
    }

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );
    // ESA CLRUSD at par; a bond at 95% of present value; a deed at a market haircut.
    await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
    await registry.registerCollateralType(ASSET_INTERNAL, ASSET_INT, 9_500n, 10n ** 18n);
    await registry.registerCollateralType(ASSET_EXTERNAL, ASSET_EXT, 7_000n, 10n ** 18n);
    await registry.registerCollateralType(INCOME, UNSECURED, 0n, 0n);

    const LimitCalculator = await ethers.getContractFactory("LimitCalculator");
    limits = await upgrades.deployProxy(
      LimitCalculator,
      [ctx.admin.address, await registry.getAddress(), await issuer.getAddress()],
      { kind: "uups" }
    );
    await ctx.access.grantOperator(await limits.getAddress());
    await registry.grantRole(await registry.OPERATOR_ROLE(), await limits.getAddress());
    await ctx.assurancePool.connect(ctx.admin).setExposureSource(await registry.getAddress());

    await issuer
      .connect(ctx.operator)
      .openLine(ctx.member.address, [0n, 0n, 0n, 0n], ONE_YEAR, CYCLE);
  });

  it("lights the tier up when a bond is pledged", async function () {
    // Before: nothing. The tier exists but the member has no capacity in it.
    expect(await limits.capacityOf(ctx.member.address, ASSET_INTERNAL)).to.equal(0n);

    // A bond worth 10,000 at 95% of present value.
    await registry.pledge(ctx.member.address, ASSET_INTERNAL, 10_000n * ONE_USDC);
    await limits.pushCapacities(ctx.member.address);

    expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(9_500n * ONE_USDC);
    expect(await ctx.stableCredit.creditLimitOf(ctx.member.address)).to.equal(9_500n * ONE_USDC);
  });

  it("haircuts a pool share harder than a bond, for correlation not volatility", async function () {
    // Pool NAV is backed by the same loan book, so it falls exactly when credit lines impair.
    await registry.registerCollateralType(
      ethers.encodeBytes32String("POOL_SHARE"), ASSET_INT, 7_000n, 10n ** 18n
    );

    const bondTerms = await registry.collateralTypes(ASSET_INTERNAL);
    const shareTerms = await registry.collateralTypes(ethers.encodeBytes32String("POOL_SHARE"));
    expect(bondTerms.haircutBps).to.equal(9_500n);
    expect(shareTerms.haircutBps).to.equal(7_000n);
  });

  it("keeps a deed on market terms and a bond on redemption terms", async function () {
    await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
    await registry.pledge(ctx.member.address, ASSET_EXTERNAL, 1_000n * ONE_USDC);
    await limits.pushCapacities(ctx.member.address);

    // The same value pledged, lent against differently, because it would be realised differently.
    expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(950n * ONE_USDC);
    expect(await issuer.capacityOf(ctx.member.address, 2)).to.equal(700n * ONE_USDC);
  });

  it("draws the cheap tiers before the dear ones, across collateral types", async function () {
    await registry.pledge(ctx.member.address, SAVINGS, 500n * ONE_USDC);
    await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
    await limits.pushCapacities(ctx.member.address);

    await ctx.stableCredit
      .connect(ctx.member)
      .transfer(ctx.counterparty.address, 700n * ONE_USDC);

    // Savings first at nothing per cycle, then the bond tier at 65.
    expect(await issuer.principalOf(ctx.member.address, 0)).to.equal(500n * ONE_USDC);
    expect(await issuer.principalOf(ctx.member.address, 1)).to.equal(200n * ONE_USDC);
    expect(await issuer.principalOf(ctx.member.address, 2)).to.equal(0n);
  });

  it("leaves the pool covering nothing while the member is inside their limit", async function () {
    await registry.pledge(ctx.member.address, ASSET_INTERNAL, 10_000n * ONE_USDC);
    await limits.pushCapacities(ctx.member.address);

    await ctx.stableCredit
      .connect(ctx.member)
      .transfer(ctx.counterparty.address, 9_500n * ONE_USDC);
    await registry.refresh(ctx.member.address);

    expect(await ctx.assurancePool.poolExposure()).to.equal(0n);
    expect(await ctx.assurancePool.neededReserves()).to.equal(0n);
  });

  it("contracts the limit when a bond is marked down", async function () {
    await registry.pledge(ctx.member.address, ASSET_INTERNAL, 10_000n * ONE_USDC);
    await limits.pushCapacities(ctx.member.address);
    expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(9_500n * ONE_USDC);

    // The bond is revalued at three quarters of what it was.
    await registry.setCollateralTerms(ASSET_INTERNAL, 9_500n, 75n * 10n ** 16n);
    await limits.pushCapacities(ctx.member.address);

    expect(await issuer.capacityOf(ctx.member.address, 1)).to.equal(7_125n * ONE_USDC);
  });

  it("shows the whole ceiling as the tiers it is made of", async function () {
    await registry.pledge(ctx.member.address, SAVINGS, 500n * ONE_USDC);
    await registry.pledge(ctx.member.address, ASSET_INTERNAL, 1_000n * ONE_USDC);
    await registry.pledge(ctx.member.address, ASSET_EXTERNAL, 2_000n * ONE_USDC);
    await limits.pushCapacities(ctx.member.address);

    const tiers = await limits.tiersOf(ctx.member.address);
    expect(tiers[0].capacity).to.equal(500n * ONE_USDC); // savings, at par
    expect(tiers[1].capacity).to.equal(950n * ONE_USDC); // bond, 95%
    expect(tiers[2].capacity).to.equal(1_400n * ONE_USDC); // deed, 70%
    expect(await limits.totalCapacityOf(ctx.member.address)).to.equal(2_850n * ONE_USDC);
  });
});
