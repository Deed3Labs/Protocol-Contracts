import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { ONE_USDC, DAY } from "./rates";
import { pledgeSigned, pledgeItemSigned, signPledgeItem, MATURITY_INSTRUCTION } from "../../helpers/pledge";
import { deployBondFactory } from "../../helpers/bonds";

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

  const pool: any = await upgrades.deployProxy(await ethers.getContractFactory("LendingPool"),
    [ctx.admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"], { kind: "uups" });
  await pool.setEncumbranceSource(await registry.getAddress(), POOL_SHARE);

  const factory: any = await deployBondFactory(await ctx.tokenRegistry.getAddress(), "ipfs://bonds");
  // Ten percent off a one-year bond: $900 buys $1,000, and half way through it is worth $950.
  await factory.updateGlobalParameters(1_000n, 0n, YEAR);
  const deposit: any = await ethers.getContractAt("BurnerBondDeposit", await factory.getUnifiedDepositContract());
  await factory.createCollection(await usdc.getAddress(), "USDC", "USD Coin", "ipfs://bonds");
  const bond: any = await ethers.getContractAt("BurnerBond",
    (await factory.getCollectionInfo(await usdc.getAddress())).collectionAddress);
  const bondVault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
    [ctx.admin.address, await usdc.getAddress(), 90 * DAY], { kind: "uups" });
  await bondVault.grantRole(await bondVault.BOND_ROLE(), await deposit.getAddress());
  await bondVault.grantRole(await bondVault.BOND_ROLE(), await bond.getAddress());
  await deposit.setBondVault(await bondVault.getAddress());
  await bond.setBondVault(await bondVault.getAddress());
  await bond.setEncumbranceSource(await registry.getAddress(), BOND);
  await registry.grantRole(await registry.ITEM_ROLLER_ROLE(), await bond.getAddress());
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

  return { ctx, usdc, issuer, registry, pool, factory, bond, bondVault, deposit, liquidator, keeper, stranger, holdA, holdB };
}

describe("COMPLIANCE Phase 2e: pledged bonds (Earn addendum, founder answer G)", function () {
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
    const issuedAt = (await now()) + 10n;
    const maturity = issuedAt + BigInt(term);
    await s.usdc.mint(m, face);
    await s.usdc.connect(s.ctx.member).approve(await s.deposit.getAddress(), face);
    await at(issuedAt);
    await s.deposit.connect(s.ctx.member).makeDeposit(await s.usdc.getAddress(), face, maturity, await s.bond.calculateDiscount(maturity));
    const ids = await s.bond.getBondIdsByCreator(m);
    const id = ids[ids.length - 1];
    if (pledge) await pledgeItemSigned(s.registry, m, BOND, id);
    return { id, issuedAt, maturity };
  }

  describe("Earn test 18: payPledged", function () {
    it("pays $500 to the debt and $450 to the Holder on a qualifying default with debt $500 and Accreted Value $950, and burns the bond", async function () {
      const { usdc, issuer, registry, bond, bondVault, liquidator, keeper } = s;
      const { id, issuedAt } = await buyBond(U(1_000));
      expect((await bond.getBondInfo(id)).purchasePrice).to.equal(U(900));
      await usdc.mint(await bondVault.getAddress(), U(1_000)); // the vault's interest to pay accretion
      await issuer.setPrincipal(m, T_BOND, U(500));
      await issuer.setInDefault(m, true); // computed by the issuer: default after notice and cure

      const memberBefore = await usdc.balanceOf(m);
      const vaultBefore = await usdc.balanceOf(await bondVault.getAddress());
      const keeperBefore = await usdc.balanceOf(keeper.address);
      // Half way through its year: Accreted Value $950.
      await at(issuedAt + BigInt(YEAR / 2));
      await expect(bond.connect(keeper).payPledged(id))
        .to.emit(bond, "PledgePaid").withArgs(id, m, U(950), U(500), U(450))
        .and.to.emit(liquidator, "PledgePaymentApplied").withArgs(m, I, true, U(950), U(500), U(450));

      expect(await issuer.principalOf(m, T_BOND)).to.equal(0n); // $500 to the debt
      expect((await usdc.balanceOf(m)) - memberBefore).to.equal(U(450)); // $450 to the Holder
      expect(vaultBefore - (await usdc.balanceOf(await bondVault.getAddress()))).to.equal(U(950)); // all of it, no less
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
      expect(value).to.be.gte(U(950));
    });
  });

  describe("Earn test 19: the pledged maturity split", function () {
    /** Bond A ($1,000 Maturity Amount, auto-roll off) and bond B (Present Value $500: already matured). */
    async function twoBonds(drawn: bigint, vaultExtra = U(10_000)) {
      const b = await buyBond(U(500), YEAR / 2);
      const a = await buyBond(U(1_000), YEAR);
      await s.bond.connect(s.ctx.member).setAutoRollOptOut(a.id, true);
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
      expect(await bondVault.settlementOwed(a)).to.equal(0n);
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

    it("with the vault short, the $725 is still applied and only the $275 is subject to SettlementShortfall", async function () {
      const { usdc, issuer, bond, bondVault, stranger, keeper } = s;
      const { a } = await twoBonds(U(1_200), 0n);
      // The vault holds $800: enough for toDebt, $75 of toHolder.
      const vaultAddress = await bondVault.getAddress();
      await usdc.burn(vaultAddress, (await usdc.balanceOf(vaultAddress)) - U(800));
      const before = await usdc.balanceOf(m);
      await expect(bond.connect(stranger).settle(a))
        .to.emit(bond, "PledgedMaturitySplit").withArgs(a, U(725), U(275))
        .and.to.emit(bondVault, "SettlementShortfall").withArgs(a, m, U(275), U(75), U(200));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(475));
      expect((await usdc.balanceOf(m)) - before).to.equal(U(75));
      expect(await bondVault.settlementOwed(a)).to.equal(U(200));
      expect(await bondVault.settlementPayee(a)).to.equal(m);
      // Owed now, so it is reserved ahead of any deployable excess.
      expect(await bondVault.requiredReserve()).to.be.gte(U(200));
      // When money arrives, anyone completes it -- to the Holder only.
      await usdc.mint(vaultAddress, U(200));
      await expect(bondVault.connect(keeper).completeSettlement(a))
        .to.emit(bondVault, "SettlementCompleted").withArgs(a, m, U(200), 0n);
      expect((await usdc.balanceOf(m)) - before).to.equal(U(275));
      expect(await bondVault.totalSettlementOwed()).to.equal(0n);
      await expect(bondVault.completeSettlement(a)).to.be.revertedWithCustomError(bondVault, "BondVaultNothingOwed");
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

    it("a pledged bond that rolls is not settled; one that has not matured is not either", async function () {
      const { bond, stranger } = s;
      const b = await buyBond(U(1_000));
      await expect(bond.connect(stranger).settle(b.id)).to.be.revertedWithCustomError(bond, "BurnerBondNotSettleable");
      await at(b.maturity);
      await expect(bond.connect(stranger).settle(b.id)).to.be.revertedWithCustomError(bond, "BurnerBondNotSettleable");
      // And the holder's own redeemBond refuses a pledged bond: it pays out only under its instruction.
      await expect(bond.connect(s.ctx.member).redeemBond(b.id)).to.be.revertedWithCustomError(bond, "BurnerBondPledged");
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
      await at(maturity);
      await bond.connect(ctx.member).rollBond(id);
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
    it("has no burn entry point but redeemBond, batchRedeemBonds, settle, payPledged and rollBond", async function () {
      const writes = s.bond.interface.fragments
        .filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
        .map((f: any) => f.name)
        .sort();
      // Every state-changing function, so a new way to destroy a bond fails this test.
      expect(writes).to.deep.equal([
        "batchRedeemBonds", "executeLiquidatorChange", "initialize", "mintBond", "payPledged",
        "redeemBond", "removeBondTrait", "renounceOwnership", "rollBond", "safeBatchTransferFrom",
        "safeTransferFrom", "setApprovalForAll", "setAutoRollOptOut", "setBondTrait", "setBondTraitFlexible",
        "setBondVault", "setBurnerBondDeposit", "setDiscountCurve", "setEncumbranceSource", "setFirstBondId",
        "setLiquidator", "setRollTerm", "setURI", "setUnderlyingToken", "settle", "transferOwnership",
        "emergencyRecover",
      ].sort());
      // A transfer to the zero address is not a burn: ERC-1155 refuses it.
      const { id } = await buyBond(U(1_000), YEAR, false);
      await expect(s.bond.connect(s.ctx.member).safeTransferFrom(m, ethers.ZeroAddress, id, 1, "0x")).to.be.reverted;
    });

    it("the module cannot be called on its own, and the implementation pins it by kind", async function () {
      const pledges = await ethers.getContractAt("BurnerBondPledges", await s.bond.pledges());
      expect(await pledges.extensionKind()).to.equal(ethers.id("BurnerBondPledges.v1"));
      await expect(pledges.payPledged(1)).to.be.revertedWithCustomError(pledges, "BurnerBondNotPledgePayable");
      await expect(pledges.settle(1)).to.be.revertedWithCustomError(pledges, "BurnerBondNotSettleable");
      // A module of the wrong kind is refused.
      const Bond = await ethers.getContractFactory("BurnerBond");
      await expect(Bond.deploy(await s.registry.getAddress())).to.be.reverted;
    });
  });
});
