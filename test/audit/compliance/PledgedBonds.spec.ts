import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { ONE_USDC, DAY } from "./rates";
import { pledgeSigned, pledgeItemSigned, signPledgeItem, MATURITY_INSTRUCTION } from "../../helpers/pledge";
import { deployBondStack, grantNoticeRole } from "../../helpers/bonds";
import { deployBarePool } from "../../helpers/yieldPool";

/*
 * Phase 2e, the Earn addendum (pledged bonds) and founder answer G:
 *  - §1 allowlist (a): a bond burns only on settlement, buyback, payPledged or redeemAll;
 *  - §4 payPledged(id): the pledge payment term in the bond (IV-01 §4.9), Earn test 18;
 *  - §4 settle(id) for a pledged bond that does not roll: the Maturity Instruction split
 *    (MB-05 §5.6), Earn test 19;
 *  - §9 advance rates stored per pledge, and the signed Maturity Instruction;
 *  - the Liquidator's seize-and-redeem path is gone, and no role can trigger, price or redirect
 *    either payment.
 *
 * The issuer is MockMissedCycleIssuer: its tiers, principal and computed default are set directly,
 * so these tests read the pledge module's answer from whatever default the credit side computes
 * (the credit agent's calendar-cycle and cure-notice rules) without depending on how.
 */
const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const BOND = ethers.encodeBytes32String("BOND");
const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
const INCOME = ethers.encodeBytes32String("INCOME");
const BOOST = ethers.encodeBytes32String("BOOST");
const [T_SAVINGS, T_BOND, T_POOL, T_INCOME, T_BOOST] = [0, 1, 2, 3, 4];
const [UNSECURED, SAVINGS_BACKED, ASSET_INT] = [0, 1, 3];
const YEAR = 365 * DAY;
const HOUR = 3600;
const U = (n: number | bigint) => BigInt(n) * ONE_USDC;

async function now() {
  return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
}

async function at(timestamp: bigint) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
}

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployStack() {
  const ctx = await deployPhase0Network();
  const signers = await ethers.getSigners();
  const [keeper, stranger, holdA, holdB] = [signers[9], signers[12], signers[13], signers[14]];
  const usdc = ctx.usdc;

  const issuer: any = await (await ethers.getContractFactory("MockMissedCycleIssuer"))
    .deploy(await usdc.getAddress(), [SAVINGS, BOND, POOL_SHARE, INCOME, BOOST]);
  await ctx.networkRegistry.registerIssuer(await issuer.getAddress(), await ctx.stableCredit.getAddress());
  await ctx.networkRegistry.enrolMember(ctx.member.address, await issuer.getAddress());

  const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
    [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
  await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
  // Section 9: 95% of a bond's Present Value, 70% of Pool Share Value.
  await registry.registerCollateralType(BOND, ASSET_INT, 9_500n, 0n);
  await registry.registerCollateralType(POOL_SHARE, ASSET_INT, 7_000n, 10n ** 18n);
  await registry.registerCollateralType(INCOME, UNSECURED, 0n, 0n);
  await registry.registerCollateralType(BOOST, UNSECURED, 0n, 0n);

  // Phase 2f: the Yield Pool, with its valuation module and mock Earn controls (signers 17-19:
  // Clear Lending's lending account and the two Deployment signers).
  const { pool, controls } = await deployBarePool(ctx.admin, usdc, signers[17], [signers[18], signers[19]]);
  await pool.setEncumbranceSource(await registry.getAddress(), POOL_SHARE);

  // Phase 2f: the new collection, sold by quote at the Ladder's yield, compounding (R4, decision 8).
  // 11.11% for a year: $900.00 buys $1,000 (it used to be "ten percent off" on the discount curve).
  const bs = await deployBondStack(ctx.admin, usdc, ctx.tokenRegistry, { registry, kind: BOND, rungs: [[365, 1_111]] });
  const bond: any = bs.bond;
  const bondVault: any = bs.vault;
  const deposit: any = null;
  await grantNoticeRole(bs.controls, ctx.admin, keeper.address);
  const harness: any = await (await ethers.getContractFactory("AccretionHarness")).deploy();
  const valuer = await (await ethers.getContractFactory("BondValuer")).deploy(await bond.getAddress());
  await registry.setCollateralValuer(BOND, await valuer.getAddress());

  const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
    ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
    { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
  const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"),
    [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });

  const liquidator: any = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"),
    [ctx.admin.address, await ctx.stableCredit.getAddress(), await clrusd.getAddress(), await vault.getAddress(),
      await usdc.getAddress(), await registry.getAddress()], { kind: "uups" });
  await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
  await pool.grantRole(await pool.LIQUIDATOR_ROLE(), await liquidator.getAddress());
  // Before any bond exists, so it takes effect at once: the pledge module's enforcement side.
  await bond.setLiquidator(await liquidator.getAddress());
  await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);
  await liquidator.setEarnSources(await pool.getAddress(), await bond.getAddress());
  for (const s of [holdA, holdB]) await liquidator.grantRole(await liquidator.HOLD_ROLE(), s.address);

  return { ctx, usdc, issuer, registry, pool, controls, bond, bondVault, deposit, liquidator, keeper, stranger, holdA, holdB, bs, harness };
}

describe("COMPLIANCE Phase 2e: pledged bonds (Earn addendum, founder answer G)", function () {
  // The chain's clock is shared by every spec in a run, and these tests travel years (12- to
  // 36-month terms, rolls). Each test runs in a snapshot that is reverted afterwards, so it leaves the
  // clock where it found it and later specs stay inside the BondVault's maturity buckets (to 2109).
  let clockSnapshot: string;
  beforeEach(async function () {
    clockSnapshot = await ethers.provider.send("evm_snapshot", []);
  });
  afterEach(async function () {
    await ethers.provider.send("evm_revert", [clockSnapshot]);
  });

  let s: Awaited<ReturnType<typeof deployStack>>;
  let m: string;
  let I: string;

  beforeEach(async function () {
    s = await deployStack();
    m = s.ctx.member.address;
    I = await s.issuer.getAddress();
  });

  /** Buys a bond of `face` maturing `term` after the purchase block, and pledges it if asked. */
  async function buyBond(face: bigint, term = YEAR, pledge = true) {
    const { id } = await s.bs.buy(s.ctx.member, face, term / DAY);
    const info = await s.bond.getBondInfo(id);
    if (pledge) await pledgeItemSigned(s.registry, m, BOND, id);
    return { id: id as bigint, issuedAt: info.issuedAt as bigint, maturity: info.maturityDate as bigint };
  }

  /** The Holder confirms a Roll Notice on `id` and holds an attestation in force at maturity. */
  async function confirmRoll(id: bigint, maturity: bigint) {
    await at(maturity - BigInt(21 * DAY));
    await s.bond.connect(s.keeper).postRollNotice(id, ethers.id("notice"), await s.bond.latestRollDeadline(maturity), 365, 1_111);
    await s.bond.connect(s.stranger).confirmRoll(id, ethers.id("notice"), await s.bs.confirmSig(s.ctx.member, id));
    await s.bs.attest(s.ctx.member);
  }

  describe("Earn test 18: payPledged", function () {
    // Phase 2f (R4, decision 8): Accreted Value compounds at the Issue Yield, so half way through a
    // $1,000 one-year bond bought for $900 it is $948.55 (straight-line it was $950). The split is
    // the same rule: $500 to the debt, the rest of the Accreted Value to the Holder.
    it("pays $500 to the debt and the rest of the Accreted Value to the Holder on a qualifying default with debt $500, and burns the bond", async function () {
      const { usdc, issuer, registry, bond, bondVault, liquidator, keeper } = s;
      const { id, issuedAt } = await buyBond(U(1_000));
      expect((await bond.getBondInfo(id)).purchasePrice).to.equal(U(900));
      await usdc.mint(await bondVault.getAddress(), U(1_000)); // the vault's interest to pay accretion
      await issuer.setPrincipal(m, T_BOND, U(500));
      await issuer.setInDefault(m, true); // computed by the issuer: default after notice and cure

      const memberBefore = await usdc.balanceOf(m);
      const vaultBefore = await usdc.balanceOf(await bondVault.getAddress());
      const keeperBefore = await usdc.balanceOf(keeper.address);
      // Half way through its year.
      const half = issuedAt + BigInt(YEAR / 2);
      const av = await s.harness.accretedValue(U(1_000), 1_111, (await bond.getBondInfo(id)).maturityDate, half);
      expect(av).to.be.closeTo(948_550_000n, 10_000n);
      await at(half);
      await expect(bond.connect(keeper).payPledged(id))
        .to.emit(bond, "PledgePaid").withArgs(id, m, av, U(500), av - U(500))
        .and.to.emit(liquidator, "PledgePaymentApplied").withArgs(m, I, true, av, U(500), av - U(500));

      expect(await issuer.principalOf(m, T_BOND)).to.equal(0n); // $500 to the debt
      expect((await usdc.balanceOf(m)) - memberBefore).to.equal(av - U(500)); // the rest to the Holder
      expect(vaultBefore - (await usdc.balanceOf(await bondVault.getAddress()))).to.equal(av); // all of it, no less
      expect(await usdc.balanceOf(await liquidator.getAddress())).to.equal(0n); // nothing kept
      expect(await usdc.balanceOf(keeper.address)).to.equal(keeperBefore); // nothing to the caller
      // The bond burns and its pledge is released.
      expect(await bond.balanceOf(m, id)).to.equal(0n);
      expect(await bond.accretedValue(id)).to.equal(0n);
      expect(await registry.isItemPledged(m, BOND, id)).to.equal(false);
      expect((await bondVault.obligations(id)).settled).to.equal(true);
      await expect(bond.connect(keeper).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
    });

    it("reverts on an unpledged bond, with no recorded enforcement condition, on a Shortfall under 72 hours, and before the cure date", async function () {
      const { issuer, bond, liquidator, stranger } = s;
      // Unpledged: even in default.
      const { id: free } = await buyBond(U(1_000), YEAR, false);
      await issuer.setPrincipal(m, T_BOND, U(500));
      await issuer.setInDefault(m, true);
      await expect(bond.connect(stranger).payPledged(free))
        .to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable").withArgs(free);
      await issuer.setInDefault(m, false);

      const { id } = await buyBond(U(1_000));
      await advance(30 * DAY);
      // No recorded enforcement condition: debt, but no default and no shortfall notice.
      await expect(bond.connect(stranger).payPledged(id))
        .to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable").withArgs(id);

      // A Shortfall: drawn above what the bond backs at 95%. Under 72 hours from the notice, no.
      const backing = await s.registry.advancedValueOf(m, BOND, 0);
      await issuer.setPrincipal(m, T_BOND, backing + U(10));
      await liquidator.connect(stranger).noticeShortfall(m, I);
      const noticedAt = await liquidator.shortfallNoticedAt(m, I);
      await at(noticedAt + BigInt(72 * HOUR) - 1n);
      await expect(bond.connect(stranger).payPledged(id))
        .to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable").withArgs(id);

      // Before the cure date the issuer computes no default, and with the shortfall gone (the
      // member paid it down) nothing is payable however long one waits.
      await issuer.setPrincipal(m, T_BOND, U(100));
      await advance(30 * DAY);
      expect((await liquidator.pledgePaymentDue(m, id))[0]).to.equal(false);
      await expect(bond.connect(stranger).payPledged(id))
        .to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable").withArgs(id);
      // Once the cure date passes and the issuer computes the default, it is.
      await issuer.setInDefault(m, true);
      expect([...(await liquidator.pledgePaymentDue(m, id))]).to.deep.equal([true, I, true]);
      await expect(bond.connect(stranger).payPledged(id)).to.emit(bond, "PledgePaid");
    });

    it("after 72 hours a Shortfall pays the bond the module requests, to the bond tier only, the rest to the Holder", async function () {
      const { usdc, issuer, bond, liquidator, stranger } = s;
      const { id } = await buyBond(U(1_000));
      await usdc.mint(await s.bondVault.getAddress(), U(1_000));
      await advance(30 * DAY);
      const backing = await s.registry.advancedValueOf(m, BOND, 0);
      await issuer.setPrincipal(m, T_BOND, backing + U(10));
      await issuer.setPrincipal(m, T_BOOST, U(300)); // unsecured: not a Shortfall's to pay
      await liquidator.noticeShortfall(m, I);
      await advance(72 * HOUR);

      const before = await usdc.balanceOf(m);
      const drawn = await issuer.principalOf(m, T_BOND);
      const receipt = await (await bond.connect(stranger).payPledged(id)).wait();
      const paid = receipt.logs.map((l: any) => { try { return bond.interface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "PledgePaid").args.amount;
      expect(await issuer.principalOf(m, T_BOND)).to.equal(0n);
      expect(await issuer.principalOf(m, T_BOOST)).to.equal(U(300));
      expect((await usdc.balanceOf(m)) - before).to.equal(paid - drawn);
      expect(await liquidator.shortfallNoticedAt(m, I)).to.equal(0n); // the gap closed
    });

    it("acts only on as many bonds as the module requests: the smallest that covers the need, then no more", async function () {
      const { usdc, issuer, bond, liquidator, keeper } = s;
      const { id: big } = await buyBond(U(2_000));
      const { id: small } = await buyBond(U(1_000));
      const { id: spare } = await buyBond(U(600));
      await usdc.mint(await s.bondVault.getAddress(), U(5_000));
      await advance(30 * DAY);
      await issuer.setPrincipal(m, T_BOND, U(700));
      await issuer.setInDefault(m, true);

      // $700 owed: the $1,000 bond covers it on its own; the $2,000 and $600 bonds are not asked for.
      expect((await liquidator.pledgePaymentDue(m, big))[0]).to.equal(false);
      expect((await liquidator.pledgePaymentDue(m, spare))[0]).to.equal(false);
      await expect(bond.connect(keeper).payPledged(big)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await expect(bond.connect(keeper).payPledged(spare)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await bond.connect(keeper).payPledged(small);
      // The debt is paid: nothing more is requested.
      expect(await issuer.principalOf(m, T_BOND)).to.equal(0n);
      for (const id of [big, spare]) {
        await expect(bond.connect(keeper).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
        expect(await bond.balanceOf(m, id)).to.equal(1n);
      }
    });

    it("on a default, applies in the module's order: the bond's tier, pool shares' tier, BOOST, INCOME; never Savings", async function () {
      const { usdc, issuer, bond, keeper } = s;
      const { id } = await buyBond(U(2_000));
      await usdc.mint(await s.bondVault.getAddress(), U(5_000));
      await advance(30 * DAY);
      await issuer.setPrincipal(m, T_SAVINGS, U(400));
      await issuer.setPrincipal(m, T_BOND, U(300));
      await issuer.setPrincipal(m, T_POOL, U(200));
      await issuer.setPrincipal(m, T_BOOST, U(500));
      await issuer.setPrincipal(m, T_INCOME, U(2_000));
      await issuer.setInDefault(m, true);
      const value = await bond.accretedValue(id);
      await bond.connect(keeper).payPledged(id);
      // value is about $1,830: BOND 300, POOL 200, BOOST 500, then INCOME takes the rest.
      expect(await issuer.principalOf(m, T_BOND)).to.equal(0n);
      expect(await issuer.principalOf(m, T_POOL)).to.equal(0n);
      expect(await issuer.principalOf(m, T_BOOST)).to.equal(0n);
      expect(await issuer.principalOf(m, T_INCOME)).to.be.closeTo(U(2_000) - (value - U(1_000)), U(1));
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(U(400));
    });

    it("no call can pay less than accretedValue(id) or send any amount elsewhere", async function () {
      const { usdc, issuer, bond, bondVault, liquidator, ctx, stranger, keeper } = s;
      const { id } = await buyBond(U(1_000));
      await advance(YEAR / 2);
      await issuer.setPrincipal(m, T_BOND, U(500));
      await issuer.setInDefault(m, true);

      // The only argument is the id: no amount, price, destination or debt to choose.
      const fn = bond.interface.getFunction("payPledged")!;
      expect(fn.inputs.map((x: any) => x.type)).to.deep.equal(["uint256"]);
      // The vault cannot pay the whole Accreted Value (it holds only the $900 purchase price and
      // has no treasury): it pays nothing, rather than less.
      expect(await usdc.balanceOf(await bondVault.getAddress())).to.equal(U(900));
      await expect(bond.connect(keeper).payPledged(id)).to.be.revertedWithCustomError(bondVault, "BondVaultInsufficientFunds");
      expect(await bond.balanceOf(m, id)).to.equal(1n);

      // Nobody but the collection can make the vault pay early, or make the Liquidator apply a
      // bond payment -- the admin, who holds every role, included.
      for (const who of [ctx.admin, stranger]) {
        await expect(bondVault.connect(who).settleEarly(id, who.address, 1n)).to.be.reverted;
        await expect(bondVault.connect(who).settlePledged(id, who.address, 0n, who.address)).to.be.reverted;
        await expect(liquidator.connect(who).applyPledgePayment(m, I, true, 1n))
          .to.be.revertedWithCustomError(liquidator, "LiquidatorNotEarnBonds");
        await expect(liquidator.connect(who).applyMaturityInstruction(m, 1n))
          .to.be.revertedWithCustomError(liquidator, "LiquidatorNotEarnBonds");
      }
      // A Liquidation Hold stops it like any enforcement.
      await usdc.mint(await bondVault.getAddress(), U(1_000));
      await s.liquidator.connect(s.holdA).proposeHold(m, 2, 30 * DAY, ethers.id("evidence:2e"));
      await s.liquidator.connect(s.holdB).confirmHold(m);
      await expect(bond.connect(keeper).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await advance(30 * DAY + 1);
      const value = await bond.accretedValue(id);
      await expect(bond.connect(keeper).payPledged(id)).to.emit(bond, "PledgePaid");
      expect(value).to.be.gte(U(950)); // about seven months in, compounding
    });
  });

  describe("Addendum 4, 10c (decision 6): payPledged and the Shortfall wait under a pause", function () {
    let clrusdPause: any, vaultPause: any;

    beforeEach(async function () {
      const Mock = await ethers.getContractFactory("MockPauseSource");
      clrusdPause = await Mock.deploy();
      vaultPause = await Mock.deploy();
      const clock = await (await ethers.getContractFactory("PauseClock"))
        .deploy(await clrusdPause.getAddress(), await vaultPause.getAddress());
      await expect(s.liquidator.connect(s.stranger).setPauseClock(await clock.getAddress())).to.be.reverted;
      await s.liquidator.connect(s.ctx.admin).setPauseClock(await clock.getAddress());
    });

    it("payPledged and every enforcement path revert while a pause affecting the Holder is in force, and pay once it lifts", async function () {
      const { usdc, issuer, bond, bondVault, liquidator, keeper } = s;
      const { id } = await buyBond(U(1_000));
      await usdc.mint(await bondVault.getAddress(), U(1_000));
      await issuer.setPrincipal(m, T_BOND, U(500));
      await issuer.setInDefault(m, true);
      await clrusdPause.pauseAccount(m); // the Holder's own CLRUSD account
      expect((await liquidator.pledgePaymentDue(m, id))[0]).to.equal(false);
      await expect(bond.connect(keeper).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await expect(liquidator.liquidate(m, I, T_SAVINGS, SAVINGS)).to.be.revertedWithCustomError(liquidator, "LiquidatorPauseInForce");
      await clrusdPause.unpauseAccount(m);
      await vaultPause.pauseAll(); // a vault-wide pause reaches every Holder
      expect((await liquidator.pledgePaymentDue(m, id))[0]).to.equal(false);
      await expect(bond.connect(keeper).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await vaultPause.unpauseAll();
      await expect(bond.connect(keeper).payPledged(id)).to.emit(bond, "PledgePaid");
    });

    it("the 72-hour Shortfall wait runs longer by the paused time since the notice", async function () {
      const { usdc, issuer, bond, liquidator, stranger } = s;
      const { id } = await buyBond(U(1_000));
      await usdc.mint(await s.bondVault.getAddress(), U(1_000));
      await advance(30 * DAY);
      const backing = await s.registry.advancedValueOf(m, BOND, 0);
      await issuer.setPrincipal(m, T_BOND, backing + U(10));
      await liquidator.noticeShortfall(m, I);
      const noticedAt = await liquidator.shortfallNoticedAt(m, I);
      await at(noticedAt + BigInt(10 * HOUR));
      await clrusdPause.pauseAccount(m);
      await at(noticedAt + BigInt(16 * HOUR));
      await clrusdPause.unpauseAccount(m); // six hours paused
      await at(noticedAt + BigInt(72 * HOUR));
      await expect(bond.connect(stranger).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await at(noticedAt + BigInt(78 * HOUR) - 1n);
      await expect(bond.connect(stranger).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await at(noticedAt + BigInt(78 * HOUR));
      await expect(bond.connect(stranger).payPledged(id)).to.emit(bond, "PledgePaid");
    });
  });

  describe("Earn test 19: the pledged maturity split", function () {
    /** Bond A ($1,000 Maturity Amount, no Roll Confirmation) and bond B (Present Value $500: already matured). */
    async function twoBonds(drawn: bigint, vaultExtra = U(10_000)) {
      // Phase 2f: terms are 12 to 36 months (decision 41), so B is bought first and matures first.
      const b = await buyBond(U(500), YEAR);
      await advance(30 * DAY);
      const a = await buyBond(U(1_000), YEAR);
      await s.usdc.mint(await s.bondVault.getAddress(), vaultExtra);
      await s.issuer.setPrincipal(m, T_BOND, drawn);
      await at(a.maturity);
      await ethers.provider.send("evm_mine", []);
      expect(await s.bond.accretedValue(b.id)).to.equal(U(500));
      expect(await s.registry.advancedValueOf(m, BOND, a.id)).to.equal(U(475)); // Collateral Value $475
      return { a: a.id, b: b.id };
    }

    it("Drawn $1,200: a random caller's settle applies $725, pays $275 with no lock, releases the pledge and burns the bond", async function () {
      const { usdc, issuer, registry, bond, bondVault, liquidator, stranger } = s;
      const { a, b } = await twoBonds(U(1_200));
      const before = await usdc.balanceOf(m);
      await expect(bond.connect(stranger).settle(a))
        .to.emit(bond, "PledgedMaturitySplit").withArgs(a, U(725), U(275))
        .and.to.emit(liquidator, "MaturityInstructionApplied").withArgs(m, U(725), U(725))
        .and.to.emit(bondVault, "SettledPledged").withArgs(a, m, U(725), U(275));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(475));
      expect((await usdc.balanceOf(m)) - before).to.equal(U(275));
      // No lock: the Holder's USDC moves freely, and no pledge or hold is left on anything of theirs.
      await usdc.connect(s.ctx.member).transfer(stranger.address, U(275));
      expect(await registry.isItemPledged(m, BOND, a)).to.equal(false);
      expect(await registry.pledgedItemsOf(m, BOND)).to.deep.equal([b]);
      expect(await bond.balanceOf(m, a)).to.equal(0n);
      expect(await usdc.balanceOf(await liquidator.getAddress())).to.equal(0n);
      expect((await bondVault.pendingSettlement(a)).holderOwed).to.equal(0n);
      expect(await bondVault.totalSettlementOwed()).to.equal(0n);
    });

    it("Drawn $400: toDebt $0 and the Holder gets $1,000", async function () {
      const { usdc, issuer, bond, stranger } = s;
      const { a } = await twoBonds(U(400));
      const before = await usdc.balanceOf(m);
      await expect(bond.connect(stranger).settle(a)).to.emit(bond, "PledgedMaturitySplit").withArgs(a, 0n, U(1_000));
      expect((await usdc.balanceOf(m)) - before).to.equal(U(1_000));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(400));
    });

    it("Drawn $1,600: toDebt $1,000, and the $125 above the limit goes to the Shortfall rules", async function () {
      const { usdc, issuer, bond, liquidator, stranger } = s;
      const { a, b } = await twoBonds(U(1_600));
      const before = await usdc.balanceOf(m);
      await expect(bond.connect(stranger).settle(a)).to.emit(bond, "PledgedMaturitySplit").withArgs(a, U(1_000), 0n);
      expect(await usdc.balanceOf(m)).to.equal(before);
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(600));
      expect((await liquidator.earnGapOf(m, I))[1]).to.equal(U(125));
      await expect(liquidator.connect(stranger).noticeShortfall(m, I)).to.emit(liquidator, "ShortfallNoticed").withArgs(m, U(125));
      // The Shortfall rules: bond B becomes payable only once the notice is 72 hours old.
      await expect(bond.connect(stranger).payPledged(b)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await advance(72 * HOUR);
      await expect(bond.connect(stranger).payPledged(b)).to.emit(bond, "PledgePaid").withArgs(b, m, U(500), U(500), 0n);
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(100));
    });

    /** Leaves the bond vault holding exactly `amount` (it has no treasury in this stack). */
    async function vaultHolds(amount: bigint) {
      const vaultAddress = await s.bondVault.getAddress();
      await s.usdc.burn(vaultAddress, await s.usdc.balanceOf(vaultAddress));
      if (amount > 0n) await s.usdc.mint(vaultAddress, amount);
    }

    /** What the vault still owes on a settled pledged bond, and in total. */
    async function owed(id: bigint) {
      const p = await s.bondVault.pendingSettlement(id);
      return { debt: p.debtOwed as bigint, holder: p.holderOwed as bigint, total: (await s.bondVault.totalSettlementOwed()) as bigint };
    }

    it("with the vault short, the $725 is still applied and only the $275 is subject to SettlementShortfall", async function () {
      const { usdc, issuer, registry, bond, bondVault, liquidator, stranger, keeper } = s;
      const { a } = await twoBonds(U(1_200), 0n);
      await vaultHolds(U(800)); // enough for toDebt and $75 of toHolder
      const before = await usdc.balanceOf(m);
      await expect(bond.connect(stranger).settle(a))
        .to.emit(bond, "PledgedMaturitySplit").withArgs(a, U(725), U(275))
        .and.to.emit(bondVault, "SettledPledged").withArgs(a, m, U(725), U(75))
        .and.to.emit(bondVault, "SettlementShortfall").withArgs(a, m, 0n, U(200));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(475));
      expect((await usdc.balanceOf(m)) - before).to.equal(U(75));
      expect(await owed(a)).to.deep.equal({ debt: 0n, holder: U(200), total: U(200) });
      const pending = await bondVault.pendingSettlement(a);
      expect([pending.holder, pending.debtTo]).to.deep.equal([m, await liquidator.getAddress()]);
      expect(await bond.balanceOf(m, a)).to.equal(0n);
      expect(await registry.isItemPledged(m, BOND, a)).to.equal(false);
      // Owed now, so it is reserved ahead of any deployable excess.
      expect(await bondVault.requiredReserve()).to.be.gte(U(200));
      // When money arrives, anyone completes it -- to the Holder only.
      await usdc.mint(await bondVault.getAddress(), U(200));
      await expect(bondVault.connect(keeper).completeSettlement(a))
        .to.emit(bondVault, "SettlementCompleted").withArgs(a, m, 0n, U(200), 0n, 0n);
      expect((await usdc.balanceOf(m)) - before).to.equal(U(275));
      expect(await owed(a)).to.deep.equal({ debt: 0n, holder: 0n, total: 0n });
      await expect(bondVault.completeSettlement(a)).to.be.revertedWithCustomError(bondVault, "BondVaultNothingOwed");
    });

    it("with the vault below toDebt, settle still runs: what it holds goes to the debt, both remainders are recorded, and completion pays debt first, then the Holder", async function () {
      const { usdc, issuer, registry, bond, bondVault, liquidator, stranger, keeper } = s;
      const { a, b } = await twoBonds(U(1_200), 0n);
      const vaultAddress = await bondVault.getAddress();
      await vaultHolds(U(500)); // $500 against toDebt $725
      const before = await usdc.balanceOf(m);
      await expect(bond.connect(stranger).settle(a))
        .to.emit(bond, "PledgedMaturitySplit").withArgs(a, U(725), U(275))
        .and.to.emit(bondVault, "SettledPledged").withArgs(a, m, U(500), 0n)
        .and.to.emit(bondVault, "SettlementShortfall").withArgs(a, m, U(225), U(275))
        .and.to.emit(liquidator, "MaturityInstructionApplied").withArgs(m, U(500), U(500));
      // Step 0: $500 applied, the bond burned and its pledge released, both remainders recorded.
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(700));
      expect(await usdc.balanceOf(m)).to.equal(before);
      expect(await owed(a)).to.deep.equal({ debt: U(225), holder: U(275), total: U(500) });
      expect(await bond.balanceOf(m, a)).to.equal(0n);
      expect(await registry.isItemPledged(m, BOND, a)).to.equal(false);
      expect(await registry.pledgedItemsOf(m, BOND)).to.deep.equal([b]);
      expect(await usdc.balanceOf(await liquidator.getAddress())).to.equal(0n);
      // Nothing to pay with: completion reverts and changes nothing.
      await expect(bondVault.connect(keeper).completeSettlement(a)).to.be.revertedWithCustomError(bondVault, "BondVaultInsufficientFunds");

      // Step 1: $300 arrives. The rest of toDebt ($225) first, applied to the debt; then $75 to the Holder.
      await usdc.mint(vaultAddress, U(300));
      await expect(bondVault.connect(keeper).completeSettlement(a))
        .to.emit(bondVault, "SettlementCompleted").withArgs(a, m, U(225), U(75), 0n, U(200))
        .and.to.emit(liquidator, "MaturityInstructionApplied").withArgs(m, U(225), U(225));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(475)); // the full $725 applied
      expect((await usdc.balanceOf(m)) - before).to.equal(U(75));
      expect(await owed(a)).to.deep.equal({ debt: 0n, holder: U(200), total: U(200) });

      // Step 2: $50 arrives, all of it to the Holder.
      await usdc.mint(vaultAddress, U(50));
      await expect(bondVault.connect(stranger).completeSettlement(a))
        .to.emit(bondVault, "SettlementCompleted").withArgs(a, m, 0n, U(50), 0n, U(150));
      expect((await usdc.balanceOf(m)) - before).to.equal(U(125));
      expect(await owed(a)).to.deep.equal({ debt: 0n, holder: U(150), total: U(150) });
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(475));

      // Step 3: enough arrives; only what is owed is paid.
      await usdc.mint(vaultAddress, U(1_000));
      await expect(bondVault.connect(keeper).completeSettlement(a))
        .to.emit(bondVault, "SettlementCompleted").withArgs(a, m, 0n, U(150), 0n, 0n);
      expect((await usdc.balanceOf(m)) - before).to.equal(U(275));
      expect(await owed(a)).to.deep.equal({ debt: 0n, holder: 0n, total: 0n });
      expect(await usdc.balanceOf(vaultAddress)).to.equal(U(850));
      expect(await usdc.balanceOf(await liquidator.getAddress())).to.equal(0n);
      await expect(bondVault.completeSettlement(a)).to.be.revertedWithCustomError(bondVault, "BondVaultNothingOwed");
    });

    it("with the vault empty, settle still runs and records the whole split; a debt repaid meanwhile sends its part to the Holder", async function () {
      const { usdc, issuer, registry, bond, bondVault, liquidator, stranger, keeper } = s;
      const { a } = await twoBonds(U(1_200), 0n);
      await vaultHolds(0n);
      const before = await usdc.balanceOf(m);
      await expect(bond.connect(stranger).settle(a))
        .to.emit(bond, "PledgedMaturitySplit").withArgs(a, U(725), U(275))
        .and.to.emit(bondVault, "SettlementShortfall").withArgs(a, m, U(725), U(275))
        .and.not.to.emit(liquidator, "MaturityInstructionApplied");
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(1_200));
      expect(await owed(a)).to.deep.equal({ debt: U(725), holder: U(275), total: U(1_000) });
      expect(await bond.balanceOf(m, a)).to.equal(0n);
      expect(await registry.isItemPledged(m, BOND, a)).to.equal(false);

      // The member pays the tier down to $500 in the meantime: only $25 is still needed above the
      // $475 limit, so of the $725 debt part, $25 is applied and $700 goes to the Holder.
      await issuer.setPrincipal(m, T_BOND, U(500));
      await usdc.mint(await bondVault.getAddress(), U(1_000));
      await expect(bondVault.connect(keeper).completeSettlement(a))
        .to.emit(bondVault, "SettlementCompleted").withArgs(a, m, U(725), U(275), 0n, 0n)
        .and.to.emit(liquidator, "MaturityInstructionApplied").withArgs(m, U(725), U(500));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(0n);
      expect((await usdc.balanceOf(m)) - before).to.equal(U(500));
    });

    it("nobody can redirect a recorded remainder: completion takes only the id, and only the vault or the collection may apply it", async function () {
      const { bond, bondVault, liquidator, ctx, stranger } = s;
      const { a } = await twoBonds(U(1_200), 0n);
      await vaultHolds(0n);
      await bond.connect(stranger).settle(a);
      expect(bondVault.interface.getFunction("completeSettlement")!.inputs.map((x: any) => x.type)).to.deep.equal(["uint256"]);
      for (const who of [ctx.admin, stranger]) {
        await expect(liquidator.connect(who).applyMaturityInstruction(m, U(1)))
          .to.be.revertedWithCustomError(liquidator, "LiquidatorNotEarnBonds");
      }
      expect(await owed(a)).to.deep.equal({ debt: U(725), holder: U(275), total: U(1_000) });
    });

    it("no caller can change toDebt or send it elsewhere, and no role reprices it after pledging", async function () {
      const { issuer, registry, bond, ctx, stranger, keeper } = s;
      const { a } = await twoBonds(U(1_200));
      // The only argument is the id.
      expect(bond.interface.getFunction("settle")!.inputs.map((x: any) => x.type)).to.deep.equal(["uint256"]);
      // The operator lowers the bond advance rate: it reaches new pledges, not these (section 9).
      await registry.connect(ctx.admin).setCollateralTerms(BOND, 5_000n, 0n);
      expect(await registry.advancedValueOf(m, BOND, a)).to.equal(U(475));
      // A Liquidation Hold does not stop it: this is the Holder's own instruction, not enforcement.
      await s.liquidator.connect(s.holdA).proposeHold(m, 2, 30 * DAY, ethers.id("evidence:2e:19"));
      await s.liquidator.connect(s.holdB).confirmHold(m);
      // Whoever calls -- the admin, who holds every role, included -- the same split.
      await expect(bond.connect(ctx.admin).settle(a)).to.emit(bond, "PledgedMaturitySplit").withArgs(a, U(725), U(275));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(475));
    });

    // Test 16, second half (Phase 2f, Earn §4A): a confirmed pledged bond is not settled but rolled,
    // and its replacement is re-pledged in the same transaction. Replaces "a pledged bond that rolls"
    // under auto-roll; `redeemBond` is gone (decision 8).
    it("an unmatured bond is not settled; a confirmed pledged bond rolls and its replacement is re-pledged at once (test 16)", async function () {
      const { bond, stranger, registry } = s;
      const b = await buyBond(U(1_000));
      await expect(bond.connect(stranger).settle(b.id)).to.be.revertedWithCustomError(bond, "BurnerBondNotSettleable");
      await confirmRoll(b.id, b.maturity);
      await at(b.maturity);
      const tx = await bond.connect(stranger).settle(b.id);
      await expect(tx).to.emit(bond, "BondRolled").and.not.to.emit(bond, "PledgedMaturitySplit");
      const replacement = (await bond.getBondIdsByCreator(m)).slice(-1)[0];
      await expect(tx).to.emit(registry, "ItemCollateralChanged");
      expect(await registry.isItemPledged(m, BOND, replacement)).to.equal(true);
      expect(await registry.isItemPledged(m, BOND, b.id)).to.equal(false);
      expect(bond.interface.getFunction("redeemBond")).to.equal(null);
    });
  });

  describe("§9 advance rates and the Maturity Instruction", function () {
    it("a bond pledge without the Holder's signature over a Maturity Instruction reverts; with one, its hash and 95% are stored", async function () {
      const { registry, stranger } = s;
      const { id } = await buyBond(U(1_000), YEAR, false);
      const none = await signPledgeItem(registry, s.ctx.member, BOND, id, undefined, ethers.ZeroHash);
      await expect(registry.pledgeItem(m, BOND, id, ethers.ZeroHash, none.deadline, none.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryNoMaturityInstruction");
      // Signed over one instruction, submitted with another: not the Holder's.
      const signed = await signPledgeItem(registry, s.ctx.member, BOND, id);
      await expect(registry.pledgeItem(m, BOND, id, ethers.id("another instruction"), signed.deadline, signed.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryBadSignature");
      // Signed by somebody else.
      const forged = await signPledgeItem(registry, stranger, BOND, id);
      await expect(registry.pledgeItem(m, BOND, id, MATURITY_INSTRUCTION, forged.deadline, forged.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryBadSignature");

      await expect(registry.pledgeItem(m, BOND, id, MATURITY_INSTRUCTION, signed.deadline, signed.signature))
        .to.emit(registry, "ItemPledgeTerms").withArgs(m, BOND, id, 9_500n, MATURITY_INSTRUCTION);
      expect(await registry.maturityInstructionOf(m, BOND, id)).to.equal(MATURITY_INSTRUCTION);
      expect(await registry.itemAdvanceBpsOf(m, BOND, id)).to.equal(9_500n);
    });

    it("advance rates are stored per pledge: 95% of Present Value and 70% of Pool Share Value, kept through a later change", async function () {
      const { registry, usdc, pool, ctx } = s;
      const { id } = await buyBond(U(1_000));
      await usdc.mint(m, U(1_000));
      await usdc.connect(ctx.member).approve(await pool.getAddress(), U(1_000));
      await pool.connect(ctx.member).deposit(U(1_000), m);
      await pledgeSigned(registry, m, POOL_SHARE, U(1_000));
      expect(await registry.advanceBpsOf(m, POOL_SHARE)).to.equal(7_000n);
      expect(await registry.advancedValueOf(m, POOL_SHARE, 0)).to.equal(U(700));
      const pv = await s.bond.presentValueOf(id);
      expect(await registry.advancedValueOf(m, BOND, 0)).to.equal((pv * 9_500n) / 10_000n);

      // The operator lowers both rates. Existing pledges keep theirs.
      await registry.connect(ctx.admin).setCollateralTerms(BOND, 8_000n, 0n);
      await registry.connect(ctx.admin).setCollateralTerms(POOL_SHARE, 6_000n, 10n ** 18n);
      expect(await registry.itemAdvanceBpsOf(m, BOND, id)).to.equal(9_500n);
      expect(await registry.advancedValueOf(m, POOL_SHARE, 0)).to.equal(U(700));
      // A new bond pledge takes today's rate; more pool shares blend by units.
      const { id: next } = await buyBond(U(1_000));
      expect(await registry.itemAdvanceBpsOf(m, BOND, next)).to.equal(8_000n);
      await usdc.mint(m, U(1_000));
      await usdc.connect(ctx.member).approve(await pool.getAddress(), U(1_000));
      await pool.connect(ctx.member).deposit(U(1_000), m);
      await pledgeSigned(registry, m, POOL_SHARE, U(1_000));
      expect(await registry.advanceBpsOf(m, POOL_SHARE)).to.equal(6_500n);
    });

    it("a rolled bond's replacement keeps its advance rate and Maturity Instruction", async function () {
      const { registry, bond, ctx } = s;
      const { id, maturity } = await buyBond(U(1_000));
      await registry.connect(ctx.admin).setCollateralTerms(BOND, 8_000n, 0n);
      await confirmRoll(id, maturity);
      await at(maturity);
      await bond.connect(s.stranger).settle(id); // Phase 2f: a confirmed roll, settled by anyone
      const replacement = (await bond.getBondIdsByCreator(m)).slice(-1)[0];
      expect(await registry.isItemPledged(m, BOND, replacement)).to.equal(true);
      expect(await registry.itemAdvanceBpsOf(m, BOND, replacement)).to.equal(9_500n);
      expect(await registry.maturityInstructionOf(m, BOND, replacement)).to.equal(MATURITY_INSTRUCTION);
      expect(await registry.maturityInstructionOf(m, BOND, id)).to.equal(ethers.ZeroHash);
    });

    it("pledged positions exit only through MB-05: no transfer, no redeemBond, no seize; payPledged and settle are the bond's exits", async function () {
      const { bond, liquidator, stranger, ctx } = s;
      const { id } = await buyBond(U(1_000));
      await expect(bond.connect(ctx.member).safeTransferFrom(m, stranger.address, id, 1, "0x"))
        .to.be.revertedWithCustomError(bond, "BurnerBondPledged");
      expect(liquidator.interface.getFunction("mayTakeBond")).to.equal(null);
      for (const fn of ["seizeBond", "redeemEarly"]) expect(bond.interface.getFunction(fn)).to.equal(null);
    });
  });

  describe("§1 allowlist (a): a bond burns only on settlement, payPledged, and a roll", function () {
    // Phase 2f: the new collection's state-changing functions. Exits: settle (a payout, the pledged
    // split or a confirmed roll), payPledged, buyback, redeemUnderWindDown and burnPaid (the
    // Collateral Agent's distributions, through the BondVault only). No Holder redemption, no
    // auto-roll, no discount curve, no operator approvals (setApprovalForAll reverts).
    it("has no burn entry point but settle, payPledged, buyback, redeemUnderWindDown and burnPaid", async function () {
      const writes = s.bond.interface.fragments
        .filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
        .map((f: any) => f.name)
        .sort();
      // Every state-changing function, so a new way to destroy a bond fails this test.
      expect(writes).to.deep.equal([
        "burnPaid", "buyback", "confirmRoll", "confirmRolls", "emergencyRecover", "executeLiquidatorChange",
        "initialize", "payPledged", "postRollNotice", "purchase", "redeemAll", "redeemUnderWindDown",
        "renounceOwnership", "safeBatchTransferFrom", "safeTransferFrom", "setBondTrait", "setFirstBondId",
        "setLiquidator", "setSources", "setURI", "setWindDown", "settle", "transferOwnership",
        "withdrawRollConfirmation",
      ].sort());
      // A transfer to the zero address is not a burn: ERC-1155 refuses it.
      const { id } = await buyBond(U(1_000), YEAR, false);
      await expect(s.bond.connect(s.ctx.member).safeTransferFrom(m, ethers.ZeroAddress, id, 1, "0x")).to.be.reverted;
    });

    it("the module cannot be called on its own, and the implementation pins it by kind", async function () {
      const pledges = await ethers.getContractAt("BurnerBondPledges", await s.bond.pledges());
      expect(await pledges.extensionKind()).to.equal(ethers.id("BurnerBondPledges.v2"));
      await expect(pledges.payPledged(1)).to.be.revertedWithCustomError(pledges, "BurnerBondNotPledgePayable");
      await expect(pledges.settle(1)).to.be.revertedWithCustomError(pledges, "BurnerBondUnknown");
      // A module of the wrong kind is refused.
      const Bond = await ethers.getContractFactory("BurnerBond");
      await expect(Bond.deploy(await s.registry.getAddress())).to.be.reverted;
    });
  });
});
