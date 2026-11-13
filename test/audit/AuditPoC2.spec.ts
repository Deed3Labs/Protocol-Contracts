import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const SAVINGS = ethers.encodeBytes32String("SAVINGS");

describe("AUDIT PoC 2 — savings-backed credit without savings", function () {
  it("C-2: member pledges, withdraws the CLRUSD while nothing is drawn, then draws the savings tier unbacked", async function () {
    const ctx = await deployPhase0Network();
    const [coop, merchant, outside] = (await ethers.getSigners()).slice(8, 11);

    const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
    const clrusd: any = await upgrades.deployProxy(ClearUSD,
      ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
    await clrusd.grantRole(await clrusd.MINTER_ROLE(), ctx.admin.address);

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    const revolving: any = await upgrades.deployProxy(RevolvingIssuer,
      [await ctx.stableCredit.getAddress(), coop.address], { kind: "uups" });
    await ctx.networkRegistry.registerIssuer(await revolving.getAddress(), await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(), await ctx.assuranceOracle.getAddress());
    await ctx.access.grantOperator(await revolving.getAddress());
    await revolving.connect(ctx.operator).addTier(SAVINGS, 0n, CYCLE);

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    const registry: any = await upgrades.deployProxy(CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
    await registry.registerCollateralType(SAVINGS, 1 /* SAVINGS_BACKED */, 10_000n, 10n ** 18n);
    await registry.setClrusdKind(SAVINGS);
    await clrusd.setEncumbranceSource(await registry.getAddress());
    await revolving.connect(ctx.operator).setExposureSource(await registry.getAddress());
    await ctx.assurancePool.setExposureSource(await registry.getAddress());

    const LimitCalculator = await ethers.getContractFactory("LimitCalculator");
    const limits: any = await upgrades.deployProxy(LimitCalculator,
      [ctx.admin.address, await registry.getAddress(), await revolving.getAddress()], { kind: "uups" });
    await ctx.access.grantOperator(await limits.getAddress());

    // 1. Member deposits $3,000 savings; the operator sync pledges it; capacity is pushed.
    const m = ctx.member;
    await clrusd.mint(m.address, 3_000n * ONE_USDC);
    await revolving.connect(ctx.operator).openLine(m.address, [0n], 0, CYCLE);
    await registry.pledge(m.address, SAVINGS, 3_000n * ONE_USDC);
    await limits.pushCapacities(m.address);
    expect(await revolving.capacityOf(m.address, 0)).to.equal(3_000n * ONE_USDC);

    // 2. Nothing drawn => nothing encumbered => the member moves (or redeems) all of it.
    await clrusd.connect(m).transfer(outside.address, 3_000n * ONE_USDC);
    expect(await clrusd.balanceOf(m.address)).to.equal(0n);

    // 3. Member now draws the full savings tier.
    await ctx.access.connect(ctx.operator).grantMember(merchant.address);
    await ctx.stableCredit.connect(m).transfer(merchant.address, 3_000n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(3_000n * ONE_USDC);

    // The system still believes the debt is fully collateralised: zero exposure, zero reserve needed.
    await registry.refresh(m.address);
    expect(await registry.exposureOf(m.address)).to.equal(0n);
    expect(await ctx.assurancePool.neededReserves()).to.equal(0n);
    // ...and there is nothing to seize.
    expect(await clrusd.balanceOf(m.address)).to.equal(0n);
  });
});
