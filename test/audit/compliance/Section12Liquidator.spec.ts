import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { ONE_USDC, DAY, CA, P, CA_BANDS, params, deployRateSchedule } from "./rates";
import { passCycleEnd } from "../../helpers/default";
import { issuerProxyOptions } from "../../helpers/issuers";
import { pledgeSigned, pledgeItemSigned } from "../../helpers/pledge";
import { deployBondFactory } from "../../helpers/bonds";
import { deployBarePool } from "../../helpers/yieldPool";
import { deployEnforcer, fillAndSettle } from "../../helpers/enforcement";

/*
 * Section 12 addendum, the Liquidator side: 12.5 (since Phase 2f, C2: a missed cycle takes no
 * collateral at all; Savings only on default), 12.6 (Liquidation Hold) and 12.8 (the Shortfall,
 * since Phase 2f one combined figure, decision 21, with pool shares redeemed through the queue by
 * PoolShareEnforcer, C5). Acceptance 22 (Liquidator half), 23 and 26.
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
  // Phase 2f: the Yield Pool, with its valuation module and mock Earn controls (signers 17-19:
  // Clear Lending's lending account and the two Deployment signers).
  const { pool, controls } = await deployBarePool(ctx.admin, usdc, signers[17], [signers[18], signers[19]]);
  await pool.setEncumbranceSource(await registry.getAddress(), POOL_SHARE);

  const factory: any = await deployBondFactory(await ctx.tokenRegistry.getAddress(), "ipfs://bonds");
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
  // Phase 2f, C5 (decision 7): no LIQUIDATOR_ROLE on the pool. Pledged shares are redeemed through
  // the queue by PoolShareEnforcer, never seized.
  // Named before any bond exists, so it takes effect at once. Since Phase 2e the Liquidator is the
  // pledge module's enforcement side: it takes no bond; the bond's own `payPledged` asks it.
  await bond.setLiquidator(await liquidator.getAddress());
  // The collection releases a paid bond's pledge itself, with the role it rolls pledges with.
  await registry.grantRole(await registry.ITEM_ROLLER_ROLE(), await bond.getAddress());
  await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);
  await liquidator.setEarnSources(await pool.getAddress(), await bond.getAddress());
  for (const s of [holdA, holdB, holdC]) await liquidator.grantRole(await liquidator.HOLD_ROLE(), s.address);
  const enforcer = await deployEnforcer(ctx.admin, pool, liquidator, registry, POOL_SHARE);

  return { ctx, usdc, clrusd, vault, issuer, registry, pool, controls, bond, bondVault, deposit, liquidator, enforcer, holdA, holdB, holdC, stranger };
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
    await pledgeSigned(s.registry, m, SAVINGS, amount);
  }

  async function poolShares(amount: bigint) {
    await s.usdc.mint(m, amount);
    await s.usdc.connect(s.ctx.member).approve(await s.pool.getAddress(), amount);
    // Phase 2f: a subscription is at least $250 (Earn §6, FIXED). A smaller holding is a $250
    // subscription with the rest redeemed before anything is pledged.
    const floor = U(250);
    if (amount < floor) {
      await s.usdc.mint(m, floor - amount);
      await s.usdc.connect(s.ctx.member).approve(await s.pool.getAddress(), floor);
      await s.pool.connect(s.ctx.member).deposit(floor, m);
      await s.pool.connect(s.ctx.member).redeem(floor - amount, m, m);
    } else {
      await s.pool.connect(s.ctx.member).deposit(amount, m);
    }
    await pledgeSigned(s.registry, m, POOL_SHARE, amount);
  }

  async function buyBond(face: bigint, term = YEAR) {
    const maturity = (await now()) + BigInt(term) + 60n;
    const discount = await s.bond.calculateDiscount(maturity);
    await s.usdc.mint(m, face);
    await s.usdc.connect(s.ctx.member).approve(await s.deposit.getAddress(), face);
    await s.deposit.connect(s.ctx.member).makeDeposit(await s.usdc.getAddress(), face, maturity, discount);
    const ids = await s.bond.getBondIdsByCreator(m);
    const id = ids[ids.length - 1];
    await pledgeItemSigned(s.registry, m, BOND, id);
    return id;
  }

  async function pledgePaid(tx: any, bondId: bigint) {
    const receipt = await tx.wait();
    for (const log of receipt.logs) {
      try {
        const parsed = s.bond.interface.parseLog(log);
        if (parsed?.name === "PledgePaid" && parsed.args.bondId === bondId) return parsed.args.amount as bigint;
      } catch { /* other contracts' logs */ }
    }
    throw new Error("no PledgePaid");
  }

  async function holdOn(reason = Reason.DEATH, duration = 30 * DAY) {
    await s.liquidator.connect(s.holdA).proposeHold(m, reason, duration, ethers.id(`evidence:helper:${evidenceCount++}`));
    await s.liquidator.connect(s.holdB).confirmHold(m);
  }

  // Phase 2f, C2 (decision 4) reverses the Phase 2e answer: a missed cycle takes no collateral at
  // all, pool shares included (MB-05 §6.1). It still halves the limit and counts toward default, and
  // the registry's excess lock keeps the Earn pledge in place. `settleExcess` is gone.
  describe("12.5 a missed cycle takes no collateral (Phase 2f, C2)", function () {
    it("acceptance 22 (Liquidator half), as decision 4 has it: a missed cycle takes nothing, pool shares included, and leaves Savings unchanged", async function () {
      const { issuer, liquidator, enforcer, pool, registry, clrusd, stranger } = s;
      await save(U(1_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(300)); // savings-backed drawn: 300 of the CLRUSD is locked
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_INCOME, U(400));
      await issuer.setPrincipal(m, T_BOOST, U(200));
      await issuer.setMissedCycle(m, 1, U(150)); // the halved limit leaves 150 over

      // The excess lock (kept): nothing is drawn against the pool tier, yet 150 of the shares stay
      // pledged behind the excess.
      expect(await registry.encumberedOfKind(m, POOL_SHARE)).to.equal(U(150));
      await expect(pool.connect(s.ctx.member).redeem(U(851), m, m)).to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      const savingsBefore = await clrusd.balanceOf(m);

      // No path takes anything for it: there is no excess settlement, the enforcer has nothing to
      // ask for, and Savings are reachable only on a default.
      expect(liquidator.interface.getFunction("settleExcess")).to.equal(null);
      expect((await enforcer.sharesNeeded(m))[0]).to.equal(0n);
      await expect(enforcer.connect(stranger).enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      await expect(liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");

      expect(await pool.balanceOf(m)).to.equal(U(1_000));
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(U(1_000));
      expect(await issuer.principalOf(m, T_BOOST)).to.equal(U(200));
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(400));
      expect(await issuer.missedInRowOf(m)).to.equal(1n); // it still counts toward default
      expect(await clrusd.balanceOf(m)).to.equal(savingsBefore);
      expect(await registry.pledgedOf(m, SAVINGS)).to.equal(U(1_000));
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(U(300));
      // The rest of the shares stay free.
      expect(await pool.freeSharesOf(m)).to.equal(U(850));
    });

    it("never reaches a pledged bond or a pool share (MB-05 §6.1)", async function () {
      const { issuer, liquidator, enforcer, pool, bond, usdc, stranger } = s;
      await poolShares(U(100));
      const small = await buyBond(U(500));
      const large = await buyBond(U(1_000));
      await advance(60 * DAY);
      await issuer.setPrincipal(m, T_INCOME, U(2_000));
      await issuer.setPrincipal(m, T_BOOST, U(300));
      await issuer.setMissedCycle(m, 1, U(450));

      const usdcBefore = await usdc.balanceOf(m);
      await expect(enforcer.connect(stranger).enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      for (const id of [small, large]) {
        expect((await liquidator.pledgePaymentDue(m, id))[0]).to.equal(false);
        await expect(bond.connect(stranger).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
        expect(await bond.balanceOf(m, id)).to.equal(1n);
      }
      expect(await pool.balanceOf(m)).to.equal(U(100));
      expect(await issuer.principalOf(m, T_BOOST)).to.equal(U(300));
      expect(await usdc.balanceOf(m)).to.equal(usdcBefore);
    });
  });

  describe("12.5 Savings only on default, and only up to Savings-backed drawn", function () {
    // Phase 2f, decision 22: CLRUSD is applied only up to the Defaulted Amount of Savings-Backed
    // Drawn the issuer recorded (MB-05 §7.2), here the past-due Secured Minimum, not the whole tier.
    it("liquidate takes CLRUSD only on default, only for the savings tier, never past the savings lock, and only up to the Defaulted Amount", async function () {
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
      // Only an unpaid (unsecured) Rebalance Amount is past due: CLRUSD never pays it (MB-05 §2.5(a)).
      await issuer.setDefaulted(m, 0n, U(300), 1n);
      await expect(liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNothingToSeize");

      // $150 of the Secured Minimum is past due: $150 of CLRUSD, and no more.
      await issuer.setDefaulted(m, U(150), U(300), 1n);
      await liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_SAVINGS, SAVINGS);
      expect(await clrusd.balanceOf(m)).to.equal(U(850));
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(U(250));
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(300));
      await expect(liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNothingToSeize");
      // The rest of the savings tier is not due: it stays owed and stays locked.
      expect(await clrusd.freeBalanceOf(m)).to.equal(U(600));
    });
  });

  describe("Phase 2f decision 37: a recorded line closing makes the whole balance a Defaulted Amount (MB-04 §9.3)", function () {
    it("MB-05 example 1 (Dana): with the line closed, the whole $250.00 of Savings-Backed Drawn is redeemed from CLRUSD, leaving $2,750.00", async function () {
      const { issuer, liquidator, clrusd, stranger } = s;
      const I = await issuer.getAddress();
      // $3,000.00 of ESA capital; $400.00 drawn savings-backed, $150.00 repaid: $250.00 owed.
      await save(U(3_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(250));
      await issuer.setPrincipal(m, T_INCOME, U(300));
      await issuer.setInDefault(m, true);
      // The default turned on the unsecured Rebalance Amount: no Secured Minimum is past due.
      await issuer.setDefaulted(m, 0n, U(300), 1n);
      await expect(liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNothingToSeize");

      await issuer.setLineClosed(m, await now());
      await liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS);
      expect(await clrusd.balanceOf(m)).to.equal(U(2_750));
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(0n);
      // CLRUSD never pays the unsecured tier (MB-05 §2.5(a)).
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(300));
      expect(await clrusd.freeBalanceOf(m)).to.equal(U(2_750));
      await expect(liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNothingToSeize");
    });

    it("never more than the Savings-Backed Position, and nothing once the default no longer stands", async function () {
      const { issuer, liquidator, clrusd, stranger } = s;
      const I = await issuer.getAddress();
      await save(U(300));
      await issuer.setPrincipal(m, T_SAVINGS, U(400));
      await issuer.setLineClosed(m, await now());
      await issuer.setDefaulted(m, 0n, U(100), 1n);
      // The record alone, with no default standing, reaches nothing.
      await expect(liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");
      await issuer.setInDefault(m, true);
      await liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS);
      expect(await clrusd.balanceOf(m)).to.equal(0n); // the $300.00 position, not the $400.00 owed
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(U(100));
    });

    it("for pledged Earn Positions, the whole asset-backed and unsecured balance, never Savings", async function () {
      const { issuer, liquidator } = s;
      await issuer.setPrincipal(m, T_SAVINGS, U(250));
      await issuer.setPrincipal(m, T_POOL, U(700));
      await issuer.setPrincipal(m, T_INCOME, U(300));
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, 0n, U(100), 1n);
      // Without the record: only what is past due, the $100.00 Rebalance Amount.
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(U(100));
      await issuer.setLineClosed(m, await now());
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(U(1_000));
      // Only while the default stands.
      await issuer.setInDefault(m, false);
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(0n);
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
      await issuer.setDefaulted(m, U(100), U(100), 1n); // decision 22
      await liquidator.noticeShortfall(m); // a notice is not enforcement
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
      // Phase 2f: the pool-share path is PoolShareEnforcer's, and it waits too.
      await expect(s.enforcer.enforce(m)).to.be.revertedWithCustomError(s.enforcer, "PoolShareEnforcerBlocked");
      expect((await s.enforcer.sharesNeeded(m))[0]).to.equal(0n);
      expect(await pool.enforcementQueuedOf(m)).to.equal(0n);
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

      // A hold signer holds no power over the member's assets. (Phase 2f, C5: the pool has no
      // seizure at all any more, and the Liquidator no queued-proceeds settlement.)
      await expect(clrusd.connect(holdA).seize(m, holdA.address, 1n)).to.be.reverted;
      expect(pool.interface.getFunction("seizeShares")).to.equal(null);
      expect(liquidator.interface.getFunction("settleRealized")).to.equal(null);

      // The member's own transfers of what is not encumbered go through during the hold.
      await clrusd.connect(s.ctx.member).transfer(stranger.address, U(700)); // 300 stays locked
      // (Phase 2f: Pool Shares move only between one Holder's accounts, so "stranger" is linked
      // as the member's other account here.)
      await s.controls.link(m, stranger.address);
      await pool.connect(s.ctx.member).transfer(stranger.address, U(850)); // 150 held by the excess
      await expect(clrusd.connect(s.ctx.member).transfer(stranger.address, 1n)).to.be.reverted; // the lock, not the hold
      expect(await clrusd.balanceOf(m)).to.equal(U(300));
      expect(await pool.balanceOf(m)).to.equal(U(150));

      // Delay only: once it lapses, enforcement proceeds as it would have. (Phase 2f, C2: the
      // missed cycle alone takes nothing, so the member defaults first; decision 22: the $150
      // Rebalance Amount is what is past due.)
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, 0n, U(150), 1n);
      await expect(s.enforcer.enforce(m)).to.be.revertedWithCustomError(s.enforcer, "PoolShareEnforcerBlocked");
      const { hold } = await liquidator.holdOf(m);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(hold.until)]);
      await expect(s.enforcer.enforce(m)).to.emit(s.enforcer, "EnforcementRequested");
      await expect(fillAndSettle(pool, s.enforcer, m)).to.emit(liquidator, "PoolProceedsApplied").withArgs(m, U(150), U(150), U(150), 0n);
      expect(await pool.balanceOf(m)).to.equal(0n);
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(250));
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

  // Phase 2f, decision 21: one combined Shortfall (Asset-Backed Drawn above the total Asset-Backed
  // Limit), settled after 72 hours from pool shares first, through the queue (C5), then bonds, in
  // the smallest amount that ends it. It replaces Phase 2e's per-kind gaps and `settleShortfall`.
  describe("12.8 Earn shortfall", function () {
    it("acceptance 26: after 72 hours the redemption is the smallest that closes the gap, pool shares first", async function () {
      const { issuer, liquidator, enforcer, pool, clrusd, registry, stranger } = s;
      await save(U(500));
      await issuer.setPrincipal(m, T_SAVINGS, U(100));
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_POOL, U(750)); // 1,000 of shares at 70% back 700: a 50 gap
      expect((await liquidator.shortfallOf(m))[0]).to.equal(U(50));

      await expect(enforcer.enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      await expect(liquidator.connect(stranger).noticeShortfall(m)).to.emit(liquidator, "ShortfallNoticed").withArgs(m, U(50));
      await expect(liquidator.noticeShortfall(m)).to.be.revertedWithCustomError(liquidator, "LiquidatorShortfallNoticed");
      const noticedAt = await liquidator.shortfallNoticedAt(m, ethers.ZeroAddress);
      expect(await liquidator.shortfallWait()).to.equal(72 * HOUR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(noticedAt) + 72 * HOUR - 1]);
      await expect(enforcer.connect(stranger).enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(noticedAt) + 72 * HOUR]);
      await enforcer.connect(stranger).enforce(m);

      // Redeeming r of a 70% pledge closes 0.3 r of the gap: r = ceil(50 / 0.3).
      const r = (U(50) * 10_000n + 2_999n) / 3_000n;
      expect(r).to.equal(166_666_667n);
      expect(await pool.enforcementQueuedOf(m)).to.equal(r);
      // The shares wait in the queue in the member's name, never seized, and are paid at fill.
      await expect(fillAndSettle(pool, enforcer, m, stranger)).to.emit(liquidator, "ShortfallCleared").withArgs(m);
      expect(await pool.balanceOf(m)).to.equal(U(1_000) - r);
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(U(1_000) - r);
      expect(await issuer.principalOf(m, T_POOL)).to.equal(U(750) - r);
      expect((await liquidator.shortfallOf(m))[0]).to.equal(0n);
      // One unit less would not have closed it.
      const gapAt = (taken: bigint) => (U(750) - taken) - ((U(1_000) - taken) * 7_000n) / 10_000n;
      expect(gapAt(r)).to.equal(0n);
      expect(gapAt(r - 1n)).to.be.greaterThan(0n);
      // Savings and the notice.
      expect(await clrusd.balanceOf(m)).to.equal(U(500));
      expect(await registry.pledgedOf(m, SAVINGS)).to.equal(U(500));
      expect(await liquidator.shortfallNoticedAt(m, ethers.ZeroAddress)).to.equal(0n);
    });

    it("the Shortfall is one combined figure: a bond's spare backing covers a pool-share gap", async function () {
      const { issuer, liquidator } = s;
      await poolShares(U(1_000));
      await buyBond(U(500));
      await issuer.setPrincipal(m, T_BOND, U(100)); // well covered by the bond
      await issuer.setPrincipal(m, T_POOL, U(750)); // 50 above what the shares back on their own
      // Phase 2e measured a 50 pool gap; MB-05 §1.3 (decision 21) measures the total: none.
      expect((await liquidator.shortfallOf(m))[0]).to.equal(0n);
      await expect(liquidator.noticeShortfall(m)).to.be.revertedWithCustomError(liquidator, "LiquidatorNoShortfall");
    });

    it("pool shares first; a bond is paid only for what they cannot close, and then the queued shares no longer needed go back", async function () {
      const { issuer, liquidator, enforcer, pool, bond, registry, usdc, stranger } = s;
      await poolShares(U(100));
      await issuer.setPrincipal(m, T_POOL, U(100)); // 100 of shares back 70
      const bondId = await buyBond(U(500));
      await advance(30 * DAY);
      const backing = ((await registry.collateralValueOf(m, BOND)) * 9_500n) / 10_000n;
      await issuer.setPrincipal(m, T_BOND, backing + U(10)); // a combined gap of 40
      await liquidator.noticeShortfall(m);
      // Before the wait, nothing is payable or redeemable.
      await expect(bond.connect(stranger).payPledged(bondId)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await expect(enforcer.enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      await advance(72 * HOUR);

      // All 100 shares would close only 30 of the 40: they are queued, and the bond is due for the rest.
      await enforcer.enforce(m);
      expect(await pool.enforcementQueuedOf(m)).to.equal(U(100));
      expect((await liquidator.pledgePaymentDue(m, bondId))[0]).to.equal(true);

      const usdcBefore = await usdc.balanceOf(m);
      const tx = await bond.connect(stranger).payPledged(bondId);
      const paid = await pledgePaid(tx, bondId);
      // A bond is paid whole, and all of it goes to ending the Shortfall: the bond tier, then the
      // pool tier. It is about $460, so it cannot end it alone and nothing is left for the member.
      expect(await issuer.principalOf(m, T_BOND)).to.equal(0n);
      const poolDrawn = U(100) - (paid - backing - U(10));
      expect(await issuer.principalOf(m, T_POOL)).to.equal(poolDrawn);
      expect(await usdc.balanceOf(m)).to.equal(usdcBefore);
      expect(await registry.pledgedItemsOf(m, BOND)).to.deep.equal([]);
      const [gap] = await liquidator.shortfallOf(m);
      expect(gap).to.equal(poolDrawn - U(70));

      // Fewer of the queued shares are needed now: anyone may send the rest back to the member.
      const needed = (gap * 10_000n + 2_999n) / 3_000n;
      await expect(enforcer.connect(stranger).cancelExcess(m, 0))
        .to.emit(enforcer, "EnforcementCancelled").withArgs(m, 0, U(100) - needed);
      expect(await pool.balanceOf(m)).to.equal(U(100) - needed);
      expect(await pool.enforcementQueuedOf(m)).to.equal(needed);
      await expect(enforcer.connect(stranger).cancelExcess(m, 0)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNotExcess");

      // The rest fill and end it.
      await expect(fillAndSettle(pool, enforcer, m)).to.emit(liquidator, "ShortfallCleared").withArgs(m);
      expect((await liquidator.shortfallOf(m))[0]).to.equal(0n);
      expect(await liquidator.shortfallNoticedAt(m, ethers.ZeroAddress)).to.equal(0n);
    });

    it("does nothing and clears the notice if the gap closed meanwhile", async function () {
      const { issuer, liquidator, enforcer, pool } = s;
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_POOL, U(750));
      await liquidator.noticeShortfall(m);
      await issuer.setPrincipal(m, T_POOL, U(600)); // the member paid some down
      await advance(72 * HOUR);
      await expect(enforcer.enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      await expect(liquidator.noticeShortfall(m)).to.emit(liquidator, "ShortfallCleared").withArgs(m);
      expect(await pool.balanceOf(m)).to.equal(U(1_000));
      expect(await liquidator.shortfallNoticedAt(m, ethers.ZeroAddress)).to.equal(0n);
      await expect(liquidator.noticeShortfall(m)).to.be.revertedWithCustomError(liquidator, "LiquidatorNoShortfall");
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
    await expect(liquidator.connect(stranger).setPoolShareEnforcer(stranger.address)).to.be.reverted;
    await expect(liquidator.connect(stranger).applyPoolProceeds(m, 1n, 1n))
      .to.be.revertedWithCustomError(liquidator, "LiquidatorNotPoolShareEnforcer");
    // Phase 2e: the seize gate is gone with the seize path.
    expect(liquidator.interface.getFunction("mayTakeBond")).to.equal(null);
  });

  // Phase 2f, C2 (decision 4): with the real RevolvingIssuer, a missed cycle halves the line and
  // counts toward default, and takes nothing: no pool share, no bond, no Savings.
  it("end to end (12.5) with the real RevolvingIssuer: a missed cycle halves the line and takes no collateral, Savings untouched", async function () {
    // A fresh stack whose member is not enrolled with the mock: the ledger asks every issuer a
    // member has, and here that is only the real one.
    s = await deployStack(false);
    const { ctx, liquidator, clrusd, stranger, enforcer, pool } = s;
    const m = ctx.member.address;
    const CYCLE = 30 * DAY;
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
    await issuer.connect(ctx.operator).openLine(m, [0n, 0n, 0n, U(1_000), U(500)], 0);
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, U(1_500));

    await passCycleEnd(issuer.connect(stranger), m); // the close: $1,500 is the Rebalance Amount
    await passCycleEnd(issuer.connect(stranger), m); // first missed rebalance
    const excess = await issuer.unsecuredExcessOf(m);
    expect(excess).to.be.gte(U(750));
    const savings = await clrusd.balanceOf(m);

    expect((await issuer.cycleOf(m)).missedInRow).to.equal(1n); // it counts toward default
    await expect(enforcer.connect(stranger).enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
    expect(liquidator.interface.getFunction("settleExcess")).to.equal(null);
    expect(await issuer.unsecuredExcessOf(m)).to.be.gte(excess); // still owed (plus carry), not settled from collateral
    expect(await pool.balanceOf(m)).to.equal(U(1_000));
    expect(await clrusd.balanceOf(m)).to.equal(savings);
    expect(await issuer.inDefault(m)).to.equal(false);
  });

  it("owner decisions: a lapsed hold is proposed again only with new evidence", async function () {
    const { ctx, liquidator, holdA, holdB } = s;
    const m = ctx.member.address;
    await liquidator.connect(holdA).proposeHold(m, 2, DAY, ethers.id("death-report:1"));
    await liquidator.connect(holdB).confirmHold(m);
    await advance(DAY + 1); // lapsed
    await expect(liquidator.connect(holdA).proposeHold(m, 2, DAY, ethers.id("death-report:1")))
      .to.be.revertedWithCustomError(liquidator, "LiquidatorBadParameter");
    await liquidator.connect(holdA).proposeHold(m, 2, DAY, ethers.id("death-report:2"));
    expect(await liquidator.holdEvidence(m)).to.equal(ethers.id("death-report:2"));
  });
});
