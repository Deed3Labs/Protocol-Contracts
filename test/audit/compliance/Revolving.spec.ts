import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { CA, P, CA_BANDS, ONE_USDC, CYCLE, DAY, params, deployRateSchedule, thirtyDays } from "./rates";
import { issuerProxyOptions } from "../../helpers/issuers";
import { deployAssurancePool } from "../../helpers/assurance";
import { pledgeSigned } from "../../helpers/pledge";

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/*
 * Compliance spec items 2-4 on the revolving line: principal and carry kept apart, simple
 * per-second accrual on principal only, unsecured tiers priced from RateSchedule, and the
 * member-level ceiling across unsecured tiers. Acceptance tests 3, 4 and 11.
 */
describe("COMPLIANCE revolving pricing (spec items 2-4)", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let revolving: any, rates: any, coop: any;
  const SAVINGS = 0, INCOME = 1, BOOST = 2;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    coop = (await ethers.getSigners())[8];
    const R = await ethers.getContractFactory("RevolvingIssuer");
    revolving = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")),  kind: "uups" });
    await ctx.networkRegistry.registerIssuer(
      await revolving.getAddress(), await ctx.stableCredit.getAddress()
);
    await ctx.access.grantOperator(await revolving.getAddress());
    for (const [name, rate] of [["SAVINGS", 0n], ["INCOME", 150n], ["BOOST", 300n]] as const) {
      await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, CYCLE);
    }

    rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
    await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 300 }), CA_BANDS);
    await rates.setProduct(CA, P("REVOLVING"), params({ listMonthlyBps: 0 }), CA_BANDS);
    await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
    await revolving.connect(ctx.operator).setTierProduct(INCOME, P("INCOME"));
    await revolving.connect(ctx.operator).setTierProduct(BOOST, P("BOOST"));

    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    await ctx.networkRegistry.attestStateCode(ctx.member.address, CA);
  });

  async function spend(amount: bigint) {
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount);
  }

  it("acceptance 3: Boost $500 at 3% plus income $1,000 at 1.5% is trimmed to the $28.125 ceiling on $1,500, Boost first", async function () {
    await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 1_000n * ONE_USDC, 500n * ONE_USDC], 0);
    await spend(1_500n * ONE_USDC); // cheapest first: income 1,000, then Boost 500
    await advance(CYCLE);
    await revolving.materialiseCarry(ctx.member.address);

    const income = await revolving.carryOf(ctx.member.address, INCOME);
    const boost = await revolving.carryOf(ctx.member.address, BOOST);
    // The ceiling on $1,500 is $28.125 a month; 30 days of it at per-second accrual is ~$27.74.
    expect(income + boost).to.be.closeTo(thirtyDays(28_125_000n), 5_000n);
    // Income is charged its list rate in full; the whole trim comes out of Boost.
    expect(income).to.be.closeTo(thirtyDays(15_000_000n), 5_000n);
    expect(boost).to.be.closeTo(thirtyDays(28_125_000n) - thirtyDays(15_000_000n), 5_000n);
    // And the ledger agrees with the tiers.
    expect(await revolving.totalPrincipalOf(ctx.member.address)).to.equal(await ctx.stableCredit.creditBalanceOf(ctx.member.address));
  });

  it("acceptance 4: no interest on interest -- three untouched cycles charge three times one cycle, on principal alone", async function () {
    await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 1_000n * ONE_USDC, 0n], 0);
    await spend(1_000n * ONE_USDC);
    const snap = await ethers.provider.send("evm_snapshot", []);

    // Path A: untouched for three cycles.
    await advance(3 * CYCLE);
    await revolving.materialiseCarry(ctx.member.address);
    const untouched = await revolving.carryOf(ctx.member.address, INCOME);
    expect(untouched).to.be.closeTo(3n * thirtyDays(15_000_000n), 10_000n);

    // Path B: touched every cycle. Same carry: cycles 2 and 3 were charged on principal only.
    await ethers.provider.send("evm_revert", [snap]);
    for (let i = 0; i < 3; i++) {
      await advance(CYCLE);
      await revolving.materialiseCarry(ctx.member.address);
    }
    const touched = await revolving.carryOf(ctx.member.address, INCOME);
    expect(touched).to.be.closeTo(untouched, 1_000n);
    expect(await revolving.principalOnlyOf(ctx.member.address, INCOME)).to.equal(1_000n * ONE_USDC);
  });

  it("a payment inside a tier clears carry before principal", async function () {
    await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, 1_000n * ONE_USDC, 0n], 0);
    await spend(1_000n * ONE_USDC);
    await advance(CYCLE);
    await revolving.materialiseCarry(ctx.member.address);
    const carry = await revolving.carryOf(ctx.member.address, INCOME);
    await ctx.usdc.mint(ctx.member.address, 100n * ONE_USDC);
    await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), 100n * ONE_USDC);
    await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, 10n * ONE_USDC);
    expect(await revolving.carryOf(ctx.member.address, INCOME)).to.be.closeTo(carry - 10n * ONE_USDC, 100n);
    expect(await revolving.principalOnlyOf(ctx.member.address, INCOME)).to.equal(1_000n * ONE_USDC);
  });

  // Section 13 restates acceptance 11 for the compartment pool: the reserve needed is the Credit
  // Backstop's floor, and with no unsecured credit live it is exactly zero.
  it("acceptance 11: with only savings-backed credit live, backstopFloor() is exactly zero", async function () {
    const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
    const clrusd: any = await upgrades.deployProxy(ClearUSD,
      ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
    await clrusd.grantRole(await clrusd.MINTER_ROLE(), ctx.admin.address);
    const Registry = await ethers.getContractFactory("CollateralRegistry");
    const registry: any = await upgrades.deployProxy(Registry, [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
    const SAV = ethers.encodeBytes32String("SAVINGS");
    await registry.registerCollateralType(SAV, 1, 10_000n, 10n ** 18n);
    await registry.setClrusdKind(SAV);
    await registry.setClrusdToken(await clrusd.getAddress());
    await clrusd.setEncumbranceSource(await registry.getAddress());
    await revolving.connect(ctx.operator).setExposureSource(await registry.getAddress());
    const assurance = await deployAssurancePool(ctx.usdc, ctx.networkRegistry, {
      exposureSources: [await registry.getAddress()],
    });

    await clrusd.mint(ctx.member.address, 2_000n * ONE_USDC);
    await revolving.connect(ctx.operator).openLine(ctx.member.address, [2_000n * ONE_USDC, 0n, 0n], 0);
    await pledgeSigned(registry, ctx.member.address, SAV, 2_000n * ONE_USDC);
    await spend(1_500n * ONE_USDC);
    await advance(CYCLE);
    await revolving.materialiseCarry(ctx.member.address);
    await registry.refresh(ctx.member.address);
    expect(await registry.exposureOf(ctx.member.address)).to.equal(0n);
    expect(await assurance.pool.coveredBookPrincipal()).to.equal(0n);
    expect(await assurance.pool.backstopFloor()).to.equal(0n);
    // Savings-backed is a 0% tier: no carry at all.
    expect(await revolving.carryOf(ctx.member.address, SAVINGS)).to.equal(0n);
  });
});
