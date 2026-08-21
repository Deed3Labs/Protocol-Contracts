import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;
const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const INCOME = ethers.encodeBytes32String("INCOME");
const SAVINGS_BACKED = 1, UNSECURED = 0;

// The plan's claim is that there is far less lost debt here than in the ledger this forked from,
// because a default fires liquidation first and the collateral covers the position. These are the
// tests of that claim.
describe("Liquidator", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let clrusd: any, vault: any, registry: any, issuer: any, liquidator: any;
  let coop: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    coop = (await ethers.getSigners())[8];

    const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
    clrusd = await upgrades.deployProxy(
      ClearUSD,
      ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] }
    );

    const ESADepositVault = await ethers.getContractFactory("ESADepositVault");
    vault = await upgrades.deployProxy(
      ESADepositVault,
      [await clrusd.getAddress(), ctx.admin.address],
      { kind: "uups" }
    );
    await clrusd.grantRole(await clrusd.MINTER_ROLE(), await vault.getAddress());
    await clrusd.grantRole(await clrusd.BURNER_ROLE(), await vault.getAddress());
    await vault.setAcceptedToken(await ctx.usdc.getAddress(), true);

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
    await issuer.connect(ctx.operator).addTier(SAVINGS, 0n, CYCLE);
    await issuer.connect(ctx.operator).addTier(INCOME, 150n, CYCLE);

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );
    await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
    await registry.registerCollateralType(INCOME, UNSECURED, 0n, 0n);
    await registry.setClrusdKind(SAVINGS);
    await clrusd.setEncumbranceSource(await registry.getAddress());
    await issuer.connect(ctx.operator).setExposureSource(await registry.getAddress());
    await ctx.assurancePool.connect(ctx.admin).setExposureSource(await registry.getAddress());

    const Liquidator = await ethers.getContractFactory("Liquidator");
    liquidator = await upgrades.deployProxy(
      Liquidator,
      [
        ctx.admin.address,
        await ctx.stableCredit.getAddress(),
        await clrusd.getAddress(),
        await vault.getAddress(),
        await ctx.usdc.getAddress(),
        await registry.getAddress(),
      ],
      { kind: "uups" }
    );
    await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), await liquidator.getAddress());
    await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
    await ctx.access.grantOperator(await liquidator.getAddress());
  });

  /// The member saves USDC, receives CLRUSD, pledges it, and opens a line against it.
  async function save(amount: bigint) {
    await ctx.usdc.mint(ctx.member.address, amount);
    await ctx.usdc.connect(ctx.member).approve(await vault.getAddress(), amount);
    await vault.connect(ctx.member).deposit(await ctx.usdc.getAddress(), amount, ctx.member.address);
    await registry.pledge(ctx.member.address, SAVINGS, amount);
  }

  async function openLine(savingsCap: bigint, incomeCap: bigint, periodLength: number) {
    await issuer
      .connect(ctx.operator)
      .openLine(ctx.member.address, [savingsCap, incomeCap], periodLength, CYCLE);
  }

  async function spend(amount: bigint) {
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount);
  }

  async function intoDefault(periodLength: number) {
    await ethers.provider.send("evm_increaseTime", [periodLength + CYCLE + ONE_DAY]);
    await ethers.provider.send("evm_mine", []);
  }

  it("covers a defaulted position out of the member's own savings", async function () {
    await save(1_000n * ONE_USDC);
    await openLine(1_000n * ONE_USDC, 0n, CYCLE);
    await spend(1_000n * ONE_USDC);
    await registry.refresh(ctx.member.address);

    await intoDefault(CYCLE);
    expect(await issuer.inDefault(ctx.member.address)).to.equal(true);

    await liquidator.liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);

    // The member's debt is settled and their savings are gone, which is the trade they made.
    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
    expect(await clrusd.balanceOf(ctx.member.address)).to.equal(0n);
    expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(0n);
  });

  it("reports no lost debt for an ordinary repayment", async function () {
    // Lost debt is claims with no promise behind them. A member who repays leaves the supply
    // backed by the USDC that just arrived, so nothing was orphaned -- and redemption capacity
    // equals lost debt, so counting it here would open a draw on the AssurancePool for supply
    // that is fully covered.
    await save(1_000n * ONE_USDC);
    await openLine(1_000n * ONE_USDC, 0n, 365 * ONE_DAY);
    await spend(1_000n * ONE_USDC);

    await ctx.usdc.mint(ctx.admin.address, 1_000n * ONE_USDC);
    await ctx.usdc.approve(await ctx.stableCredit.getAddress(), 1_000n * ONE_USDC);
    await ctx.stableCredit.repayCreditBalance(ctx.member.address, 1_000n * ONE_USDC);

    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
    expect(await ctx.assurancePool.bufferBalance()).to.equal(1_000n * ONE_USDC);
    expect(await ctx.stableCredit.lostDebt()).to.equal(0n);
  });

  it("creates no lost debt when the position was collateralized", async function () {
    // The adversarial test the plan asks for. A default normally orphans supply: the credits are
    // in someone else's hands and the obligation is written off. Liquidation covers it instead.
    await save(1_000n * ONE_USDC);
    await openLine(1_000n * ONE_USDC, 0n, CYCLE);
    await spend(1_000n * ONE_USDC);
    await registry.refresh(ctx.member.address);

    await intoDefault(CYCLE);
    await liquidator.liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);
    await issuer.syncCreditPeriod(ctx.member.address);

    expect(await ctx.stableCredit.lostDebt()).to.equal(0n);
    // The counterparty still holds what they were paid; nothing was orphaned.
    expect(await ctx.stableCredit.balanceOf(ctx.counterparty.address))
      .to.equal(1_000n * ONE_USDC);
  });

  it("orphans only the part collateral never reached", async function () {
    // Lost debt arises on the unsecured shortfall and nowhere else, which is the whole
    // justification for RTD counting only what collateral does not cover.
    await save(600n * ONE_USDC);
    await openLine(600n * ONE_USDC, 400n * ONE_USDC, CYCLE);
    await spend(1_000n * ONE_USDC);
    await registry.refresh(ctx.member.address);

    await intoDefault(CYCLE);
    await liquidator.liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);
    await issuer.syncCreditPeriod(ctx.member.address);

    // The 600 of savings settled its own tier; the 400 in the income tier had nothing behind it,
    // plus the carry that accrued on it while the member was in default.
    const orphaned = await ctx.stableCredit.lostDebt();
    expect(orphaned).to.be.greaterThanOrEqual(400n * ONE_USDC);
    expect(orphaned).to.be.lessThan(430n * ONE_USDC);
    expect(await issuer.principalOf(ctx.member.address, 0)).to.equal(0n);
  });

  it("does not strand the collateral when the write-off runs first", async function () {
    // The safe order is not a rule anybody follows. A write-off never claims the collateralized
    // share, so running it first cannot leave the pledge backing nothing.
    await save(1_000n * ONE_USDC);
    await openLine(1_000n * ONE_USDC, 0n, CYCLE);
    await spend(1_000n * ONE_USDC);
    await registry.refresh(ctx.member.address);
    await intoDefault(CYCLE);

    await issuer.syncCreditPeriod(ctx.member.address);
    expect(await ctx.stableCredit.lostDebt()).to.equal(0n);
    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address))
      .to.equal(1_000n * ONE_USDC);

    // Liquidation still settles it afterwards.
    await liquidator.liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);
    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
  });

  it("takes no more than is owed", async function () {
    // A default is not a forfeiture of everything a member saved.
    await save(1_000n * ONE_USDC);
    await openLine(1_000n * ONE_USDC, 0n, CYCLE);
    await spend(400n * ONE_USDC);
    await registry.refresh(ctx.member.address);

    await intoDefault(CYCLE);
    await liquidator.liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);

    expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
    expect(await clrusd.balanceOf(ctx.member.address)).to.equal(600n * ONE_USDC);
  });

  it("refuses to liquidate a member who has not defaulted", async function () {
    await save(1_000n * ONE_USDC);
    await openLine(1_000n * ONE_USDC, 0n, 365 * ONE_DAY);
    await spend(1_000n * ONE_USDC);

    await expect(liquidator.liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS))
      .to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");
  });

  it("cannot reach a member's free savings", async function () {
    // The seizure is bounded by what is encumbered, so it cannot touch what is not pledged
    // against drawn credit even when the caller holds the role.
    await save(1_000n * ONE_USDC);
    await openLine(1_000n * ONE_USDC, 0n, CYCLE);
    await spend(300n * ONE_USDC);
    await intoDefault(CYCLE);

    await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), ctx.admin.address);
    await expect(
      clrusd.seize(ctx.member.address, ctx.admin.address, 1_000n * ONE_USDC)
    ).to.be.revertedWithCustomError(clrusd, "ClearUSDSeizureExceedsEncumbrance");

    // Only the encumbered 300 is reachable.
    await clrusd.seize(ctx.member.address, ctx.admin.address, 300n * ONE_USDC);
    expect(await clrusd.balanceOf(ctx.admin.address)).to.equal(300n * ONE_USDC);
  });

  it("is operator gated", async function () {
    await expect(
      liquidator
        .connect(ctx.outsider)
        .liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS)
    ).to.be.reverted;
  });
});
