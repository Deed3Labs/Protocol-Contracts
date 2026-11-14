import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { issuerProxyOptions } from "../helpers/issuers";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const SAVINGS = ethers.encodeBytes32String("SAVINGS");

describe("AUDIT PoC 2 — savings-backed credit without savings", function () {
  it("C-2 (fixed): savings moved away while nothing is drawn stop backing the savings tier; only what is held can be drawn", async function () {
    const ctx = await deployPhase0Network();
    const [coop, merchant, outside] = (await ethers.getSigners()).slice(8, 11);

    const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
    const clrusd: any = await upgrades.deployProxy(ClearUSD,
      ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
    await clrusd.grantRole(await clrusd.MINTER_ROLE(), ctx.admin.address);

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    const revolving: any = await upgrades.deployProxy(RevolvingIssuer,
      [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")),  kind: "uups" });
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
    // It sets tier capacity, which is the limits role (audit H-4).
    await ctx.access.grantRole(ethers.id("CREDIT_LIMITS_ROLE"), await limits.getAddress());

    await registry.setClrusdToken(await clrusd.getAddress());
    await ctx.stableCredit.setSystemRecipient(merchant.address, true);
    await ctx.access.connect(ctx.operator).grantMember(merchant.address);

    // 1. Member deposits $3,000 savings; the operator sync pledges it; capacity is pushed.
    const m = ctx.member;
    await clrusd.mint(m.address, 3_000n * ONE_USDC);
    await revolving.connect(ctx.operator).openLine(m.address, [0n], 0, CYCLE);
    await registry.pledge(m.address, SAVINGS, 3_000n * ONE_USDC);
    await limits.pushCapacities(m.address);
    expect(await revolving.capacityOf(m.address, 0)).to.equal(3_000n * ONE_USDC);

    // 2. Nothing drawn => nothing encumbered => the member may still move it (no pledge lock,
    // DECISIONS #2)...
    await clrusd.connect(m).transfer(outside.address, 2_000n * ONE_USDC);
    expect(await clrusd.balanceOf(m.address)).to.equal(1_000n * ONE_USDC);

    // ...but the pledge is now worth only what is left, and the tier can only be drawn that far.
    expect(await registry.collateralValueOf(m.address, SAVINGS)).to.equal(1_000n * ONE_USDC);
    expect(await revolving.headroomOf(m.address, 0)).to.equal(1_000n * ONE_USDC);
    await expect(ctx.stableCredit.connect(m).transfer(merchant.address, 3_000n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerDrawUnplaced");

    // 3. Drawing what is really backed works, and locks the CLRUSD behind it at the token.
    await ctx.stableCredit.connect(m).transfer(merchant.address, 1_000n * ONE_USDC);
    await expect(clrusd.connect(m).transfer(outside.address, 1n)).to.be.reverted;
    await registry.refresh(m.address);
    expect(await registry.exposureOf(m.address)).to.equal(0n);
    expect(await clrusd.balanceOf(m.address)).to.equal(1_000n * ONE_USDC);
  });
});
