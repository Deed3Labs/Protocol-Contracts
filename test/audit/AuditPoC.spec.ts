import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { signedOpenPlan, signedOpenPlanStatic } from "../helpers/plans";

/*
 * Audit proofs of concept, flipped into regression tests once each finding was fixed. A test
 * still titled as a proof (no "(fixed)") still demonstrates its bug and is fixed in a later step.
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

  /*
   * Regression tests. Each started life as a proof that PASSED while its bug existed; they now
   * assert the attack fails. The ledger is wired to the merchant registry, as deploy/22 does.
   */
  async function wireLedgerToRegistry() {
    await ctx.stableCredit.connect(ctx.admin).setMerchantRegistry(await registry.getAddress());
  }

  it("C-1a (fixed): a term limit cannot be drawn by plain transfer, to anyone; only openPlan uses it", async function () {
    await wireLedgerToRegistry();
    const m = ctx.member;
    await term.connect(ctx.operator).setTermLimit(m.address, 5_000n * ONE_USDC);

    // To a wallet of their own: refused by the recipient rule.
    await expect(ctx.stableCredit.connect(m).transfer(attackerWallet.address, 5_000n * ONE_USDC))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditRecipientNotEligible");
    // Even to an active merchant: the term allocation is locked to the scheduled path.
    await expect(ctx.stableCredit.connect(m).transfer(merchant.address, 1n * ONE_USDC))
      .to.be.revertedWith("MutualCredit: Insufficient credit");
    expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(0n);

    // The scheduled path still works, and what it creates can default.
    await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 1, CYCLE);
    await advance(3 * CYCLE + 1);
    await expect(term.declareDefault(m.address)).to.emit(term, "TermDefaulted");
  });

  it("C-1b (fixed): a revolving draw to an unregistered wallet is refused, with or without the registry wired", async function () {
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 1_000n * ONE_USDC], 0, CYCLE);
    // Registry not yet wired to the ledger: the issuer's draw check fails closed.
    await expect(ctx.stableCredit.connect(m).transfer(attackerWallet.address, 3_000n * ONE_USDC))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditTransactionInvalid");
    await wireLedgerToRegistry();
    await expect(ctx.stableCredit.connect(m).transfer(attackerWallet.address, 3_000n * ONE_USDC))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditRecipientNotEligible");
    // And a holder that is not a merchant or a named co-op address cannot redeem at all.
    await expect(pool.connect(attackerWallet).redeem(1n))
      .to.be.revertedWithCustomError(pool, "PayoutPoolNotEligible");

    // Paying an active merchant still works, and the merchant redeems it.
    await ctx.stableCredit.connect(m).transfer(merchant.address, 3_000n * ONE_USDC);
    await ctx.stableCredit.connect(merchant).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(merchant).redeem(3_000n * ONE_USDC);
    expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(3_000n * ONE_USDC);
  });

  it("C-1c (fixed): with nothing redeemable by the attacker, an unfunded pool has no claim to draw for", async function () {
    await pool.connect(funder).withdrawCapital(20_000n * ONE_USDC, funder.address);
    await wireLedgerToRegistry();
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 0, CYCLE);
    await expect(ctx.stableCredit.connect(m).transfer(attackerWallet.address, 2_000n * ONE_USDC))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditRecipientNotEligible");
    await expect(pool.connect(attackerWallet).redeem(2_000n * ONE_USDC))
      .to.be.revertedWithCustomError(pool, "PayoutPoolNotEligible");

    await ctx.usdc.mint(coop.address, 10_000n * ONE_USDC);
    await ctx.usdc.connect(coop).approve(await pool.getAddress(), 10_000n * ONE_USDC);
    await advance(NET_30 + 1);
    await expect(pool.connect(attackerWallet).drawForDueClaim())
      .to.be.revertedWithCustomError(pool, "PayoutPoolNothingToRedeem");
    expect(await ctx.usdc.balanceOf(attackerWallet.address)).to.equal(0n);
  });

  it("H-1 (fixed): a deactivated merchant cannot move its balance to another wallet, merchant or not", async function () {
    await wireLedgerToRegistry();
    await term.connect(ctx.operator).setTermLimit(ctx.member.address, 1_000n * ONE_USDC);
    await signedOpenPlan(term, ctx.operator, ctx.member.address, merchant.address, 1_000n * ONE_USDC, 975n * ONE_USDC, 150n, CYCLE, 4, CYCLE);
    await registry.setActive(merchant.address, false);
    await ctx.stableCredit.connect(merchant).approve(await pool.getAddress(), ethers.MaxUint256);
    await expect(pool.connect(merchant).redeem(1n)).to.be.revertedWithCustomError(pool, "PayoutPoolMerchantInactive");

    await expect(ctx.stableCredit.connect(merchant).transfer(attackerWallet.address, 975n * ONE_USDC))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditMerchantMayOnlyRedeem");
    // An accomplice that is itself an active merchant does not help either.
    await registry.registerMerchant(member2.address, NET_30, 50_000n * ONE_USDC, 250n);
    await expect(ctx.stableCredit.connect(merchant).transfer(member2.address, 975n * ONE_USDC))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditMerchantMayOnlyRedeem");
    expect(await ctx.usdc.balanceOf(attackerWallet.address)).to.equal(0n);
    expect(await ctx.usdc.balanceOf(member2.address)).to.equal(0n);
  });

  it("M-1 (fixed): welcome-offer credit can be spent at an active merchant but not sent to a wallet to redeem", async function () {
    await wireLedgerToRegistry();
    const OffersIssuer = await ethers.getContractFactory("OffersIssuer");
    const offers = await upgrades.deployProxy(
      OffersIssuer, [await ctx.stableCredit.getAddress(), coop.address, 10n * ONE_USDC, 90 * DAY], { kind: "uups" });
    await ctx.networkRegistry.registerIssuer(
      await offers.getAddress(), await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(), await ctx.assuranceOracle.getAddress());
    await offers.connect(ctx.operator).setCap(1_000n * ONE_USDC);
    await offers.connect(ctx.operator).grant(member2.address);

    await expect(ctx.stableCredit.connect(member2).transfer(attackerWallet.address, 10n * ONE_USDC))
      .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditRecipientNotEligible");
    await ctx.stableCredit.connect(member2).transfer(merchant.address, 10n * ONE_USDC);
    expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(10n * ONE_USDC);
  });

  it("H-2 (fixed): syncing a compliant member at expiry rolls the period forward, and the line can still default", async function () {
    await wireLedgerToRegistry();
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 0, CYCLE);
    // Cycle and grace run out while compliant (balance zero).
    await advance(CYCLE + CYCLE + 1);
    // Permissionless, as before -- but now it renews instead of deleting.
    await revolving.connect(attackerWallet).syncCreditPeriod(m.address);
    const [issuedAt, expiration] = await revolving.creditPeriods(m.address);
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    expect(issuedAt).to.equal(now);
    expect(expiration).to.equal(now + BigInt(CYCLE));

    // Draw the whole line and sit on it: the period runs out, grace runs out, and it defaults.
    await ctx.stableCredit.connect(m).transfer(merchant.address, 2_000n * ONE_USDC);
    await advance(365 * DAY);
    expect(await revolving.inDefault(m.address)).to.equal(true);
    await revolving.syncCreditPeriod(m.address);
    expect(await revolving.hasDefaulted(m.address)).to.equal(true);
    expect(await ctx.access.isMember(m.address)).to.equal(false);
    expect(await ctx.stableCredit.lostDebt()).to.be.greaterThan(0n);
  });

  it("H-2 (fixed): operators may extend or pause a period, never bring a deadline closer", async function () {
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 2_000n * ONE_USDC, 0n], 0, CYCLE);
    const [, expiration, grace] = await revolving.creditPeriods(m.address);
    await expect(revolving.connect(ctx.operator).setPeriodExpirationOf(m.address, expiration - 1n))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerPeriodMayOnlyExtend");
    await expect(revolving.connect(ctx.operator).setGraceLengthOf(m.address, grace - 1n))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerPeriodMayOnlyExtend");
    await expect(revolving.connect(ctx.operator).updateCreditPeriod(m.address, expiration - 1n, grace))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerPeriodMayOnlyExtend");
    await revolving.connect(ctx.operator).setPeriodExpirationOf(m.address, expiration + 10n);
    await revolving.connect(ctx.operator).setGraceLengthOf(m.address, grace + 10n);

    // A pause that outlasts the period does not turn into a default the moment it is lifted.
    await ctx.stableCredit.connect(m).transfer(ctx.counterparty.address, 100n * ONE_USDC);
    await revolving.connect(ctx.operator).pausePeriodOf(m.address);
    await advance(4 * CYCLE);
    await revolving.connect(ctx.operator).unpausePeriodOf(m.address);
    expect(await revolving.inDefault(m.address)).to.equal(false);
    expect(await revolving.isFrozen(m.address)).to.equal(true);
  });
});
