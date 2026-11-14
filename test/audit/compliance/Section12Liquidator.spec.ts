import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { ONE_USDC, DAY, CA, P, CA_BANDS, params, deployRateSchedule } from "./rates";
import { issuerProxyOptions } from "../../helpers/issuers";

/*
 * Section 12 addendum, the Liquidator side: 12.5 (a missed cycle's excess is settled from Earn,
 * never Savings; Savings only on default), 12.6 (Liquidation Hold) and 12.8 (Earn shortfall).
 * Acceptance 22 (Liquidator half), 23 and 26.
 *
 * The issuer here is MockMissedCycleIssuer: it reports `unsecuredExcessOf` and `missedInRowOf`,
 * which RevolvingIssuer gains in Phase 2b on the parent branch. The parent wires the real one.
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
const Reason = { NONE: 0, BANKRUPTCY: 1, DEATH: 2, BILLING_DISPUTE: 3, LATE_NOTICE: 4 };
const U = (n: number | bigint) => BigInt(n) * ONE_USDC;

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function now() {
  return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
}

let evidenceCount = 0;

async function deployStack(enrolMock = true) {
  const ctx = await deployPhase0Network();
  const signers = await ethers.getSigners();
  const [holdA, holdB, holdC, stranger] = [signers[9], signers[10], signers[11], signers[12]];
  const usdc = ctx.usdc;

  // Savings: CLRUSD minted one-for-one by the vault.
  const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
    ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
    { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
  const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"),
    [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
  await clrusd.grantRole(await clrusd.MINTER_ROLE(), await vault.getAddress());
  await clrusd.grantRole(await clrusd.BURNER_ROLE(), await vault.getAddress());
  await vault.setAcceptedToken(await usdc.getAddress(), true);

  // The issuer after a missed cycle (mock; see the header).
  const issuer: any = await (await ethers.getContractFactory("MockMissedCycleIssuer"))
    .deploy(await usdc.getAddress(), [SAVINGS, BOND, POOL_SHARE, INCOME, BOOST]);
  await ctx.networkRegistry.registerIssuer(await issuer.getAddress(), await ctx.stableCredit.getAddress());
  if (enrolMock) await ctx.networkRegistry.enrolMember(ctx.member.address, await issuer.getAddress());

  const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
    [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
  await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
  await registry.registerCollateralType(POOL_SHARE, ASSET_INT, 7_000n, 10n ** 18n);
  await registry.registerCollateralType(BOND, ASSET_INT, 9_500n, 0n);
  await registry.registerCollateralType(INCOME, UNSECURED, 0n, 0n);
  await registry.registerCollateralType(BOOST, UNSECURED, 0n, 0n);
  await registry.setClrusdKind(SAVINGS);
  await registry.setClrusdToken(await clrusd.getAddress());
  await clrusd.setEncumbranceSource(await registry.getAddress());

  // Earn: the lending pool, and the bond collection with its vault.
  const pool: any = await upgrades.deployProxy(await ethers.getContractFactory("LendingPool"),
    [ctx.admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"], { kind: "uups" });
  await pool.setEncumbranceSource(await registry.getAddress(), POOL_SHARE);

  const factory: any = await (await ethers.getContractFactory("BurnerBondFactory"))
    .deploy(await ctx.tokenRegistry.getAddress(), "ipfs://bonds");
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
  const valuer = await (await ethers.getContractFactory("BondValuer")).deploy(await bond.getAddress());
  await registry.setCollateralValuer(BOND, await valuer.getAddress());
  // The vault's interest to pay early redemptions above the purchase price.
  await usdc.mint(await bondVault.getAddress(), U(10_000));

  const liquidator: any = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"),
    [ctx.admin.address, await ctx.stableCredit.getAddress(), await clrusd.getAddress(), await vault.getAddress(),
      await usdc.getAddress(), await registry.getAddress()], { kind: "uups" });
  await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), await liquidator.getAddress());
  await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
  await pool.grantRole(await pool.LIQUIDATOR_ROLE(), await liquidator.getAddress());
  // Named before any bond exists, so it takes effect at once; the Liquidator answers the
  // collection's seize gate only for its own computed enforcement.
  await bond.setLiquidator(await liquidator.getAddress());
  // BurnerBond's default gate stays the issuer's computed default; the Liquidator is only the
  // narrow settlement gate for section 12's missed-cycle and shortfall paths.
  await bond.setSettlementGate(await liquidator.getAddress());
  await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);
  await liquidator.setEarnSources(await pool.getAddress(), await bond.getAddress());
  for (const s of [holdA, holdB, holdC]) await liquidator.grantRole(await liquidator.HOLD_ROLE(), s.address);

  return { ctx, usdc, clrusd, vault, issuer, registry, pool, bond, bondVault, deposit, liquidator, holdA, holdB, holdC, stranger };
}

describe("COMPLIANCE section 12: Liquidator (12.5, 12.6, 12.8)", function () {
  let s: Awaited<ReturnType<typeof deployStack>>;
  let m: string;

  beforeEach(async function () {
    s = await deployStack();
    m = s.ctx.member.address;
  });

  async function save(amount: bigint) {
    await s.usdc.mint(m, amount);
    await s.usdc.connect(s.ctx.member).approve(await s.vault.getAddress(), amount);
    await s.vault.connect(s.ctx.member).deposit(await s.usdc.getAddress(), amount, m);
    await s.registry.pledge(m, SAVINGS, amount);
  }

  async function poolShares(amount: bigint) {
    await s.usdc.mint(m, amount);
    await s.usdc.connect(s.ctx.member).approve(await s.pool.getAddress(), amount);
    await s.pool.connect(s.ctx.member).deposit(amount, m);
    await s.registry.pledge(m, POOL_SHARE, amount);
  }

  async function buyBond(face: bigint, term = YEAR) {
    const maturity = (await now()) + BigInt(term) + 60n;
    const discount = await s.bond.calculateDiscount(maturity);
    await s.usdc.mint(m, face);
    await s.usdc.connect(s.ctx.member).approve(await s.deposit.getAddress(), face);
    await s.deposit.connect(s.ctx.member).makeDeposit(await s.usdc.getAddress(), face, maturity, discount);
    const ids = await s.bond.getBondIdsByCreator(m);
    const id = ids[ids.length - 1];
    await s.registry.pledgeItem(m, BOND, id);
    return id;
  }

  async function settledBondValue(tx: any, bondId: bigint) {
    const receipt = await tx.wait();
    for (const log of receipt.logs) {
      try {
        const parsed = s.liquidator.interface.parseLog(log);
        if (parsed?.name === "BondRedeemed" && parsed.args.bondId === bondId) return parsed.args.presentValue as bigint;
      } catch { /* other contracts' logs */ }
    }
    throw new Error("no BondRedeemed");
  }

  async function holdOn(reason = Reason.DEATH, duration = 30 * DAY) {
    await s.liquidator.connect(s.holdA).proposeHold(m, reason, duration, ethers.id(`evidence:helper:${evidenceCount++}`));
    await s.liquidator.connect(s.holdB).confirmHold(m);
  }

  describe("12.5 a missed cycle's excess is settled from Earn, never Savings", function () {
    it("acceptance 22 (Liquidator half): settling the excess takes pool shares and leaves Savings unchanged", async function () {
      const { issuer, liquidator, pool, registry, clrusd, stranger } = s;
      await save(U(1_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(300)); // savings-backed drawn: 300 of the CLRUSD is locked
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_INCOME, U(400));
      await issuer.setPrincipal(m, T_BOOST, U(200));
      await issuer.setMissedCycle(m, 1, U(150)); // the halved limit leaves 150 over

      // Nothing is drawn against the pool tier, yet the excess holds 150 of the pledged shares.
      expect(await registry.encumberedOfKind(m, POOL_SHARE)).to.equal(U(150));
      await expect(pool.connect(s.ctx.member).redeem(U(851), m, m)).to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      const savingsBefore = await clrusd.balanceOf(m);

      // Permissionless: a stranger settles it.
      await expect(liquidator.connect(stranger).settleExcess(m, await issuer.getAddress()))
        .to.emit(liquidator, "ExcessSettled").withArgs(m, await issuer.getAddress(), U(150), U(150), U(150));

      expect(await pool.balanceOf(m)).to.equal(U(850));
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(U(850));
      // BOOST first, then INCOME.
      expect(await issuer.principalOf(m, T_BOOST)).to.equal(U(50));
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(400));
      expect(await issuer.unsecuredExcessOf(m)).to.equal(0n);
      // Savings untouched: the balance, the pledge and the savings tier.
      expect(await clrusd.balanceOf(m)).to.equal(savingsBefore);
      expect(await registry.pledgedOf(m, SAVINGS)).to.equal(U(1_000));
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(U(300));
      // The excess lock is gone with the excess: every remaining share is free again.
      expect(await pool.freeSharesOf(m)).to.equal(U(850));
    });

    it("takes pool shares first, then the smallest bond that covers the rest, at its full present value", async function () {
      const { issuer, liquidator, pool, bond, usdc, registry } = s;
      await poolShares(U(100));
      const small = await buyBond(U(500));
      const large = await buyBond(U(1_000));
      await advance(60 * DAY);
      await issuer.setPrincipal(m, T_INCOME, U(2_000));
      await issuer.setPrincipal(m, T_BOOST, U(300));
      await issuer.setMissedCycle(m, 1, U(450));
      // While the excess stands the pledged bonds are held too.
      expect(await registry.isItemEncumbered(m, BOND, large)).to.equal(true);

      const pvBefore = await bond.presentValueOf(small);
      const usdcBefore = await usdc.balanceOf(m);
      const tx = await liquidator.settleExcess(m, await issuer.getAddress());
      const pv = await settledBondValue(tx, small);

      // 100 of pool shares, then 350 from bonds: the $500 bond covers it on its own.
      expect(await pool.balanceOf(m)).to.equal(0n);
      expect(await bond.balanceOf(m, small)).to.equal(0n);
      expect(await bond.balanceOf(m, large)).to.equal(1n);
      // At no less than present value (present value only grows with time).
      expect(pv).to.be.gte(pvBefore);
      expect(await bond.presentValueOf(small)).to.equal(0n); // redeemed
      // BOOST 300 then INCOME 150 settled; the bond's surplus goes back to the member in cash.
      expect(await issuer.principalOf(m, T_BOOST)).to.equal(0n);
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(1_850));
      expect((await usdc.balanceOf(m)) - usdcBefore).to.equal(pv - U(350));
      expect(await registry.isItemEncumbered(m, BOND, large)).to.equal(false);
      await bond.connect(s.ctx.member).safeTransferFrom(m, s.stranger.address, large, 1, "0x");
    });

    it("runs only on a computed miss, only for a trusted issuer, and only against Earn", async function () {
      const { issuer, liquidator, clrusd } = s;
      await save(U(1_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(500));
      await issuer.setPrincipal(m, T_INCOME, U(300));
      await expect(liquidator.settleExcess(m, await issuer.getAddress())).to.be.revertedWithCustomError(liquidator, "LiquidatorNoExcess");
      // An excess with no miss behind it is not one.
      await issuer.setMissedCycle(m, 0, U(100));
      await expect(liquidator.settleExcess(m, await issuer.getAddress())).to.be.revertedWithCustomError(liquidator, "LiquidatorNoExcess");
      await expect(liquidator.settleExcess(m, s.stranger.address)).to.be.revertedWithCustomError(liquidator, "LiquidatorUntrustedIssuer");
      // A member with Savings and no Earn: a missed cycle takes nothing.
      await issuer.setMissedCycle(m, 1, U(100));
      await expect(liquidator.settleExcess(m, await issuer.getAddress())).to.be.revertedWithCustomError(liquidator, "LiquidatorNothingToSeize");
      expect(await clrusd.balanceOf(m)).to.equal(U(1_000));
    });
  });

  describe("12.5 Savings only on default, and only up to Savings-backed drawn", function () {
    it("liquidate takes CLRUSD only on default, only for the savings tier, and never past the savings lock", async function () {
      const { issuer, liquidator, clrusd, stranger } = s;
      await save(U(1_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(400));
      await issuer.setPrincipal(m, T_INCOME, U(300));
      await expect(liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");

      await issuer.setInDefault(m, true);
      // Savings never settle another tier, whatever kind the caller names.
      await expect(liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_INCOME, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNotSavingsTier");
      await expect(liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_SAVINGS, INCOME))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNotSavingsTier");

      await liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_SAVINGS, SAVINGS);
      expect(await clrusd.balanceOf(m)).to.equal(U(600));
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(0n);
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(300));
      // Savings-backed drawn is settled, so nothing more is locked or reachable.
      await expect(liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNothingToSeize");
      expect(await clrusd.freeBalanceOf(m)).to.equal(U(600));
    });
  });

  describe("12.6 Liquidation Hold", function () {
    it("needs two different signers, and while active every enforcement path reverts", async function () {
      const { issuer, liquidator, holdA, holdB, pool } = s;
      await save(U(1_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(300));
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_POOL, U(750));
      await issuer.setPrincipal(m, T_INCOME, U(400));
      await issuer.setMissedCycle(m, 1, U(100));
      await issuer.setInDefault(m, true);
      await liquidator.noticeShortfall(m, await issuer.getAddress()); // a notice is not enforcement
      await advance(72 * HOUR);

      await expect(liquidator.connect(holdA).proposeHold(m, Reason.DEATH, 30 * DAY, ethers.id("evidence:2"))).to.emit(liquidator, "HoldProposed");
      // Proposed is not active, and the proposer cannot confirm their own hold.
      expect((await liquidator.holdOf(m)).active).to.equal(false);
      await expect(liquidator.connect(holdA).confirmHold(m)).to.be.revertedWithCustomError(liquidator, "LiquidatorSameSigner");
      await expect(liquidator.connect(s.stranger).confirmHold(m)).to.be.reverted;
      await expect(liquidator.connect(holdB).confirmHold(m)).to.emit(liquidator, "HoldConfirmed");
      expect((await liquidator.holdOf(m)).active).to.equal(true);

      const I = await issuer.getAddress();
      await expect(liquidator.liquidate(m, I, T_SAVINGS, SAVINGS)).to.be.revertedWithCustomError(liquidator, "LiquidatorOnHold");
      await expect(liquidator.liquidateShares(m, I, T_POOL, POOL_SHARE, await pool.getAddress()))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorOnHold");
      await expect(liquidator.settleExcess(m, I)).to.be.revertedWithCustomError(liquidator, "LiquidatorOnHold");
      await expect(liquidator.settleShortfall(m, I)).to.be.revertedWithCustomError(liquidator, "LiquidatorOnHold");
      // A second hold cannot be stacked on an active one.
      await expect(liquidator.connect(holdA).proposeHold(m, Reason.BANKRUPTCY, DAY, ethers.id("evidence:3")))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorHoldExists");
    });

    it("acceptance 23: the hold delays enforcement, and cannot move or block unencumbered assets", async function () {
      const { issuer, liquidator, holdA, holdB, holdC, pool, clrusd, usdc, registry, stranger } = s;
      await save(U(1_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(300));
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_INCOME, U(400));
      await issuer.setMissedCycle(m, 1, U(150));
      const snapshot = async () => [
        await clrusd.balanceOf(m), await pool.balanceOf(m), await usdc.balanceOf(m),
        await registry.pledgedOf(m, SAVINGS), await registry.pledgedOf(m, POOL_SHARE),
        await issuer.principalOf(m, T_INCOME),
      ];
      const before = await snapshot();

      // Every hold action, by every hold signer: nothing of the member's moves.
      await holdOn(Reason.BILLING_DISPUTE, 20 * DAY);
      await liquidator.connect(holdC).renewHold(m, (await liquidator.holdOf(m)).hold.setAt + BigInt(40 * DAY));
      await liquidator.connect(holdA).clearHold(m); // one signer only proposes the clear
      expect(await snapshot()).to.deep.equal(before);
      expect((await liquidator.holdOf(m)).active).to.equal(true);

      // A hold signer holds no power over the member's assets.
      await expect(clrusd.connect(holdA).seize(m, holdA.address, 1n)).to.be.reverted;
      await expect(pool.connect(holdA).seizeShares(m, holdA.address, 1n)).to.be.reverted;
      await expect(liquidator.connect(holdA).settleRealized(m, await issuer.getAddress(), T_INCOME, 1n)).to.be.reverted;

      // The member's own transfers of what is not encumbered go through during the hold.
      await clrusd.connect(s.ctx.member).transfer(stranger.address, U(700)); // 300 stays locked
      await pool.connect(s.ctx.member).transfer(stranger.address, U(850)); // 150 held by the excess
      await expect(clrusd.connect(s.ctx.member).transfer(stranger.address, 1n)).to.be.reverted; // the lock, not the hold
      expect(await clrusd.balanceOf(m)).to.equal(U(300));
      expect(await pool.balanceOf(m)).to.equal(U(150));

      // Delay only: once it lapses, enforcement proceeds as it would have.
      await expect(liquidator.settleExcess(m, await issuer.getAddress())).to.be.revertedWithCustomError(liquidator, "LiquidatorOnHold");
      const { hold } = await liquidator.holdOf(m);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(hold.until)]);
      await expect(liquidator.settleExcess(m, await issuer.getAddress()))
        .to.emit(liquidator, "HoldLapsed").withArgs(m)
        .and.to.emit(liquidator, "ExcessSettled");
      expect(await pool.balanceOf(m)).to.equal(0n);
      expect(await clrusd.balanceOf(m)).to.equal(U(300));
    });

    it("lapses on its own, and renews only by a different signer and never past the reason's maximum", async function () {
      const { liquidator, holdA, holdB, holdC } = s;
      expect(await liquidator.maxHoldOf(Reason.DEATH)).to.equal(90 * DAY);
      expect(await liquidator.maxHoldOf(Reason.BANKRUPTCY)).to.equal(180 * DAY);
      expect(await liquidator.maxHoldOf(Reason.BILLING_DISPUTE)).to.equal(90 * DAY);
      expect(await liquidator.maxHoldOf(Reason.LATE_NOTICE)).to.equal(30 * DAY);
      await expect(liquidator.connect(holdA).proposeHold(m, Reason.DEATH, 90 * DAY + 1, ethers.id("evidence:4")))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");
      await expect(liquidator.connect(holdA).proposeHold(m, Reason.NONE, DAY, ethers.id("evidence:5")))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");

      await holdOn(Reason.DEATH, 30 * DAY);
      const setAt = (await liquidator.holdOf(m)).hold.setAt;
      const max = setAt + BigInt(90 * DAY);
      // The confirmer was the last signer; they cannot renew.
      await expect(liquidator.connect(holdB).renewHold(m, setAt + BigInt(60 * DAY)))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorSameSigner");
      await expect(liquidator.connect(holdC).renewHold(m, max + 1n))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");
      await expect(liquidator.connect(holdC).renewHold(m, setAt + BigInt(60 * DAY)))
        .to.emit(liquidator, "HoldRenewed").withArgs(m, holdC.address, setAt + BigInt(60 * DAY));
      await expect(liquidator.connect(holdC).renewHold(m, max)).to.be.revertedWithCustomError(liquidator, "LiquidatorSameSigner");
      await liquidator.connect(holdA).renewHold(m, max);

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(max) - 1]);
      await ethers.provider.send("evm_mine", []);
      expect((await liquidator.holdOf(m)).active).to.equal(true);
      await advance(1);
      expect((await liquidator.holdOf(m)).active).to.equal(false);
      // A lapsed hold cannot be renewed back to life.
      await expect(liquidator.connect(holdB).renewHold(m, max)).to.be.revertedWithCustomError(liquidator, "LiquidatorNoHold");
      await expect(liquidator.connect(holdB).clearHold(m)).to.emit(liquidator, "HoldLapsed").withArgs(m);
    });

    it("clears only with two different signers; a proposal nobody confirmed is simply dropped", async function () {
      const { liquidator, holdA, holdB, holdC } = s;
      await holdOn(Reason.BANKRUPTCY, 60 * DAY);
      await expect(liquidator.connect(holdA).clearHold(m)).to.emit(liquidator, "HoldClearProposed").withArgs(m, holdA.address);
      await liquidator.connect(holdA).clearHold(m);
      expect((await liquidator.holdOf(m)).active).to.equal(true);
      await expect(liquidator.connect(holdB).clearHold(m)).to.emit(liquidator, "HoldCleared").withArgs(m, holdB.address);
      expect((await liquidator.holdOf(m)).active).to.equal(false);

      await liquidator.connect(holdA).proposeHold(m, Reason.LATE_NOTICE, 10 * DAY, ethers.id("evidence:6"));
      await expect(liquidator.connect(holdC).clearHold(m)).to.emit(liquidator, "HoldCleared");
      await expect(liquidator.connect(holdB).confirmHold(m)).to.be.revertedWithCustomError(liquidator, "LiquidatorNoHold");
      await expect(liquidator.connect(s.stranger).clearHold(m)).to.be.reverted;
    });

    it("each reason's maximum is governed by the admin, within a ceiling", async function () {
      const { liquidator, holdA } = s;
      await expect(liquidator.connect(holdA).setMaxHold(Reason.DEATH, 60 * DAY)).to.be.reverted;
      await expect(liquidator.setMaxHold(Reason.DEATH, 60 * DAY)).to.emit(liquidator, "MaxHoldUpdated").withArgs(Reason.DEATH, 60 * DAY);
      expect(await liquidator.maxHoldOf(Reason.DEATH)).to.equal(60 * DAY);
      await expect(liquidator.setMaxHold(Reason.DEATH, 366 * DAY)).to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");
      await expect(liquidator.setMaxHold(Reason.NONE, DAY)).to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");
      await expect(liquidator.connect(holdA).proposeHold(m, Reason.DEATH, 61 * DAY, ethers.id("evidence:7")))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");
    });
  });

  describe("12.8 Earn shortfall", function () {
    it("acceptance 26: after 72 hours the redemption is the smallest that closes the gap, pool shares first", async function () {
      const { issuer, liquidator, pool, bond, clrusd, registry, stranger } = s;
      const I = await issuer.getAddress();
      await save(U(500));
      await issuer.setPrincipal(m, T_SAVINGS, U(100));
      await poolShares(U(1_000));
      const bondId = await buyBond(U(500));
      await issuer.setPrincipal(m, T_BOND, U(100)); // well covered by the bond
      await issuer.setPrincipal(m, T_POOL, U(750)); // 1,000 of shares at 70% back 700: a 50 gap
      expect([...(await liquidator.earnGapOf(m, I))]).to.deep.equal([U(50), 0n]);

      await expect(liquidator.settleShortfall(m, I)).to.be.revertedWithCustomError(liquidator, "LiquidatorShortfallNotDue");
      await expect(liquidator.connect(stranger).noticeShortfall(m, I)).to.emit(liquidator, "ShortfallNoticed").withArgs(m, U(50));
      await expect(liquidator.noticeShortfall(m, I)).to.be.revertedWithCustomError(liquidator, "LiquidatorShortfallNoticed");
      const noticedAt = await liquidator.shortfallNoticedAt(m, I);
      expect(await liquidator.shortfallWait()).to.equal(72 * HOUR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(noticedAt) + 72 * HOUR - 1]);
      await expect(liquidator.connect(stranger).settleShortfall(m, I)).to.be.revertedWithCustomError(liquidator, "LiquidatorShortfallNotDue");
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(noticedAt) + 72 * HOUR]);
      await expect(liquidator.connect(stranger).settleShortfall(m, I)).to.emit(liquidator, "ShortfallCleared").withArgs(m, I);

      // Redeeming r of a 70% pledge closes 0.3 r of the gap: r = ceil(50 / 0.3).
      const r = (U(50) * 10_000n + 2_999n) / 3_000n;
      expect(r).to.equal(166_666_667n);
      expect(await pool.balanceOf(m)).to.equal(U(1_000) - r);
      expect(await issuer.principalOf(m, T_POOL)).to.equal(U(750) - r);
      expect([...(await liquidator.earnGapOf(m, I))]).to.deep.equal([0n, 0n]);
      // One unit less would not have closed it.
      const gapAt = (taken: bigint) => (U(750) - taken) - ((U(1_000) - taken) * 7_000n) / 10_000n;
      expect(gapAt(r)).to.equal(0n);
      expect(gapAt(r - 1n)).to.be.greaterThan(0n);
      // Bonds, Savings and the notice.
      expect(await bond.balanceOf(m, bondId)).to.equal(1n);
      expect(await clrusd.balanceOf(m)).to.equal(U(500));
      expect(await registry.pledgedOf(m, SAVINGS)).to.equal(U(500));
      expect(await liquidator.shortfallNoticedAt(m, I)).to.equal(0n);
    });

    it("closes the pool gap with shares, then the bond gap with bonds at present value", async function () {
      const { issuer, liquidator, pool, bond, registry, usdc } = s;
      const I = await issuer.getAddress();
      await poolShares(U(100));
      await issuer.setPrincipal(m, T_POOL, U(100)); // 100 of shares back 70: gap 30, closed only by all 100
      const bondId = await buyBond(U(500));
      await advance(30 * DAY);
      const backing = ((await registry.collateralValueOf(m, BOND)) * 9_500n) / 10_000n;
      await issuer.setPrincipal(m, T_BOND, backing + U(10)); // a 10 gap: about 200 of bond closes it
      await liquidator.noticeShortfall(m, I);
      await advance(72 * HOUR);

      const usdcBefore = await usdc.balanceOf(m);
      const drawnBond = await issuer.principalOf(m, T_BOND);
      const tx = await liquidator.settleShortfall(m, I);
      const pv = await settledBondValue(tx, bondId);

      expect(await pool.balanceOf(m)).to.equal(0n);
      expect(await issuer.principalOf(m, T_POOL)).to.equal(0n);
      // The whole bond goes, so what it realized settles the bond tier it backed first; only what
      // is left after that tier is paid off goes back to the member.
      expect(await bond.balanceOf(m, bondId)).to.equal(0n);
      expect(pv).to.be.greaterThan(drawnBond);
      expect(await issuer.principalOf(m, T_BOND)).to.equal(0n);
      expect((await usdc.balanceOf(m)) - usdcBefore).to.equal(pv - drawnBond);
      expect([...(await liquidator.earnGapOf(m, I))]).to.deep.equal([0n, 0n]);
    });

    it("does nothing and clears the notice if the gap closed meanwhile", async function () {
      const { issuer, liquidator, pool } = s;
      const I = await issuer.getAddress();
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_POOL, U(750));
      await liquidator.noticeShortfall(m, I);
      await issuer.setPrincipal(m, T_POOL, U(600)); // the member paid some down
      await advance(72 * HOUR);
      await expect(liquidator.settleShortfall(m, I))
        .to.emit(liquidator, "ShortfallCleared").withArgs(m, I)
        .and.to.emit(liquidator, "ShortfallSettled").withArgs(m, I, 0n, 0n, 0n);
      expect(await pool.balanceOf(m)).to.equal(U(1_000));
      expect(await liquidator.shortfallNoticedAt(m, I)).to.equal(0n);
      await expect(liquidator.noticeShortfall(m, I)).to.be.revertedWithCustomError(liquidator, "LiquidatorNoShortfall");
    });

    it("the wait is governed, and can only lengthen the addendum's 72 hours", async function () {
      const { liquidator, holdA } = s;
      await expect(liquidator.connect(holdA).setShortfallWait(96 * HOUR)).to.be.reverted;
      await expect(liquidator.setShortfallWait(71 * HOUR)).to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");
      await liquidator.setShortfallWait(96 * HOUR);
      expect(await liquidator.shortfallWait()).to.equal(96 * HOUR);
    });
  });

  it("nobody else can steer what the Earn paths take from", async function () {
    const { liquidator, holdA, stranger } = s;
    await expect(liquidator.connect(holdA).setEarnSources(stranger.address, stranger.address)).to.be.reverted;
    await expect(liquidator.connect(stranger).setEarnSources(stranger.address, stranger.address)).to.be.reverted;
    // The bond gate answers only inside the Liquidator's own call.
    expect(await liquidator.mayTakeBond(m)).to.equal(false);
  });

  it("end to end (12.5) with the real RevolvingIssuer: a missed cycle halves the line, and settleExcess clears the excess from pool shares, Savings untouched", async function () {
    // A fresh stack whose member is not enrolled with the mock: the ledger asks every issuer a
    // member has, and here that is only the real one.
    s = await deployStack(false);
    const { ctx, liquidator, clrusd, stranger } = s;
    const m = ctx.member.address;
    const CYCLE = 30 * DAY, GRACE = 5 * DAY;
    const R = await ethers.getContractFactory("RevolvingIssuer");
    const issuer: any = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), (await ethers.getSigners())[8].address], { ...(await issuerProxyOptions("RevolvingIssuer")),  kind: "uups" });
    await ctx.networkRegistry.registerIssuer(await issuer.getAddress(), await ctx.stableCredit.getAddress());
    await ctx.access.grantOperator(await issuer.getAddress());
    await ctx.access.grantOperator(await liquidator.getAddress()); // settleFromCollateral
    for (const [kind, rate] of [[SAVINGS, 0n], [BOND, 65n], [POOL_SHARE, 75n], [INCOME, 150n], [BOOST, 300n]] as const) {
      await issuer.connect(ctx.operator).addTier(kind, rate, CYCLE);
    }
    const rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
    await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 300 }), CA_BANDS);
    await rates.setProduct(CA, P("REVOLVING"), params(), CA_BANDS);
    await issuer.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
    await issuer.connect(ctx.operator).setTierProduct(3, P("INCOME"));
    await issuer.connect(ctx.operator).setTierProduct(4, P("BOOST"));
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    await ctx.networkRegistry.attestStateCode(m, CA);
    await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);

    await save(U(300));
    await poolShares(U(1_000));
    await issuer.connect(ctx.operator).openLine(m, [0n, 0n, 0n, U(1_000), U(500)], CYCLE, GRACE);
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, U(1_500));

    await advance(CYCLE + GRACE + 1);
    await issuer.connect(stranger).syncCreditPeriod(m); // first missed rebalance
    const excess = await issuer.unsecuredExcessOf(m);
    expect(excess).to.be.gte(U(750));
    const savings = await clrusd.balanceOf(m);

    await liquidator.connect(stranger).settleExcess(m, await issuer.getAddress());
    expect(await issuer.unsecuredExcessOf(m)).to.be.lte(U(1)); // closed, to carry accrued in the call
    expect(await clrusd.balanceOf(m)).to.equal(savings);
    expect(await issuer.inDefault(m)).to.equal(false);
  });

  it("owner decisions: a lapsed hold is proposed again only with new evidence; the bond gate opens only inside a settlement", async function () {
    const { ctx, liquidator, holdA, holdB } = s;
    const m = ctx.member.address;
    await liquidator.connect(holdA).proposeHold(m, 2, DAY, ethers.id("death-report:1"));
    await liquidator.connect(holdB).confirmHold(m);
    await advance(DAY + 1); // lapsed
    await expect(liquidator.connect(holdA).proposeHold(m, 2, DAY, ethers.id("death-report:1")))
      .to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");
    await liquidator.connect(holdA).proposeHold(m, 2, DAY, ethers.id("death-report:2"));
    expect(await liquidator.holdEvidence(m)).to.equal(ethers.id("death-report:2"));
    // Outside its own settlement call the Liquidator lets no bond go.
    expect(await liquidator.mayTakeBond(m)).to.equal(false);
  });
});
