import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { pledgeSigned, pledgeItemSigned } from "../helpers/pledge";
import { deployBondFactory } from "../helpers/bonds";
import { deployBarePool } from "../helpers/yieldPool";
import { deployEnforcer, fillAndSettle, signEnforcementOrder } from "../helpers/enforcement";

/*
 * Phase 2f stage 2, the enforcement side, at MB-05's figures where it gives them:
 *  - C5 (decisions 7 and 10): PoolShareEnforcer redeems pledged Pool Shares through the Yield Pool's
 *    queue, only the shares still needed; nothing seizes a share.
 *  - C2 (decision 4): a missed cycle takes no collateral at all.
 *  - Decision 9: a pledge secures all of the member's MB-05 secured debt.
 *  - Decision 10: on a default, bonds first, then pool shares; plans paid oldest first; the surplus
 *    to the Holder.
 *  - Decision 20: MB-05 §7.1's order; within bonds, nearest maturity first unless the member set
 *    their own order by signature before any notice.
 *  - Decision 21: one combined Shortfall, pool shares first, then bonds, in the smallest amount that
 *    ends it (MB-05 Schedule 3, example 2: Eli).
 *  - Decision 22: enforcement capped at the Defaulted Amount recorded on chain (MB-05 Schedule 3,
 *    example 1: Dana).
 *  - MB-05 §5.3 (counsel note): the higher of the stored and the current advance rate.
 *  - Pool shares valued by `previewRedeem`, net of the holdback (MB-05 §1.3; plan row 58).
 *  - Phase 2g: a pause blocks every enforcement path.
 *
 * The revolving issuer is MockMissedCycleIssuer and the term issuer MockSecuredTermPlans: their
 * default records are set directly, so these tests read the pledge module's answer from whatever the
 * credit side records.
 */
const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const BOND = ethers.encodeBytes32String("BOND");
const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
const INCOME = ethers.encodeBytes32String("INCOME");
const BOOST = ethers.encodeBytes32String("BOOST");
const [T_SAVINGS, T_BOND, T_POOL, T_INCOME, T_BOOST] = [0, 1, 2, 3, 4];
const [UNSECURED, SAVINGS_BACKED, ASSET_INT] = [0, 1, 3];
const ONE = 10n ** 6n;
const DAY = 24 * 3600;
const HOUR = 3600;
const YEAR = 365 * DAY;
const U = (n: number | bigint) => BigInt(n) * ONE;

async function now() {
  return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
}
async function at(timestamp: bigint) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await ethers.provider.send("evm_mine", []);
}
async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployStack() {
  const ctx = await deployPhase0Network();
  const signers = await ethers.getSigners();
  const [keeper, stranger, holdA, holdB, val1, val2] = [signers[9], signers[12], signers[13], signers[14], signers[15], signers[16]];
  const usdc = ctx.usdc;

  const issuer: any = await (await ethers.getContractFactory("MockMissedCycleIssuer"))
    .deploy(await usdc.getAddress(), [SAVINGS, BOND, POOL_SHARE, INCOME, BOOST]);
  const term: any = await (await ethers.getContractFactory("MockSecuredTermPlans")).deploy(await usdc.getAddress());
  for (const i of [issuer, term]) {
    await ctx.networkRegistry.registerIssuer(await i.getAddress(), await ctx.stableCredit.getAddress());
    await ctx.networkRegistry.enrolMember(ctx.member.address, await i.getAddress());
  }

  const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
    [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
  await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
  await registry.registerCollateralType(BOND, ASSET_INT, 9_500n, 0n);
  await registry.registerCollateralType(POOL_SHARE, ASSET_INT, 7_000n, 10n ** 18n);
  await registry.registerCollateralType(INCOME, UNSECURED, 0n, 0n);
  await registry.registerCollateralType(BOOST, UNSECURED, 0n, 0n);

  const { pool, deploy } = await deployBarePool(ctx.admin, usdc, signers[17], [signers[18], signers[19]]);
  await pool.setEncumbranceSource(await registry.getAddress(), POOL_SHARE);
  for (const v of [val1, val2]) await pool.grantRole(await pool.VALUATION_ROLE(), v.address);

  const factory: any = await deployBondFactory(await ctx.tokenRegistry.getAddress(), "ipfs://bonds");
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
  await registry.setCollateralValuer(BOND, await (await (await ethers.getContractFactory("BondValuer")).deploy(await bond.getAddress())).getAddress());
  await usdc.mint(await bondVault.getAddress(), U(10_000)); // the vault's interest, to pay accretion

  const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
    ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
    { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
  const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"),
    [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
  await clrusd.grantRole(await clrusd.MINTER_ROLE(), await vault.getAddress());
  await clrusd.grantRole(await clrusd.BURNER_ROLE(), await vault.getAddress());
  await vault.setAcceptedToken(await usdc.getAddress(), true);
  await registry.setClrusdKind(SAVINGS);
  await registry.setClrusdToken(await clrusd.getAddress());
  await clrusd.setEncumbranceSource(await registry.getAddress());

  // The term plans are paid through the "ledger" the Liquidator approves (`stableCredit`): here the
  // mock term issuer itself pulls what it is paid.
  const liquidator: any = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"),
    [ctx.admin.address, await term.getAddress(), await clrusd.getAddress(), await vault.getAddress(),
      await usdc.getAddress(), await registry.getAddress()], { kind: "uups" });
  await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), await liquidator.getAddress());
  await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
  await bond.setLiquidator(await liquidator.getAddress());
  for (const i of [issuer, term]) await liquidator.setTrustedSavingsIssuer(await i.getAddress(), true);
  await liquidator.setEarnSources(await pool.getAddress(), await bond.getAddress());
  for (const h of [holdA, holdB]) await liquidator.grantRole(await liquidator.HOLD_ROLE(), h.address);
  const enforcer = await deployEnforcer(ctx.admin, pool, liquidator, registry, POOL_SHARE);

  return { ctx, usdc, issuer, term, registry, pool, deploy, bond, bondVault, deposit, clrusd, vault, liquidator, enforcer, keeper, stranger, holdA, holdB, val1, val2 };
}

describe("PHASE 2F stage 2: enforcement under MB-05 (PoolShareEnforcer and the Liquidator)", function () {
  let s: Awaited<ReturnType<typeof deployStack>>;
  let m: string;
  let I: string;

  beforeEach(async function () {
    s = await deployStack();
    m = s.ctx.member.address;
    I = await s.issuer.getAddress();
  });

  /** Buys a bond of `face` maturing `term` after now, and pledges it. */
  async function buyBond(face: bigint, term = YEAR) {
    const maturity = (await now()) + BigInt(term) - 60n; // within the one-year maximum
    await s.usdc.mint(m, face);
    await s.usdc.connect(s.ctx.member).approve(await s.deposit.getAddress(), face);
    await s.deposit.connect(s.ctx.member).makeDeposit(await s.usdc.getAddress(), face, maturity, await s.bond.calculateDiscount(maturity));
    const ids = await s.bond.getBondIdsByCreator(m);
    const id = ids[ids.length - 1];
    await pledgeItemSigned(s.registry, m, BOND, id);
    return { id, maturity };
  }

  /** Subscribes `amount` to the Yield Pool and pledges the shares. */
  async function poolShares(amount: bigint) {
    await s.usdc.mint(m, amount);
    await s.usdc.connect(s.ctx.member).approve(await s.pool.getAddress(), amount);
    await s.pool.connect(s.ctx.member).deposit(amount, m);
    await pledgeSigned(s.registry, m, POOL_SHARE, amount);
  }

  async function save(amount: bigint) {
    await s.usdc.mint(m, amount);
    await s.usdc.connect(s.ctx.member).approve(await s.vault.getAddress(), amount);
    await s.vault.connect(s.ctx.member).deposit(await s.usdc.getAddress(), amount, m);
    await pledgeSigned(s.registry, m, SAVINGS, amount);
  }

  async function lossCharge(amount: bigint) {
    const ref = ethers.id(`loss:${amount}`);
    await s.pool.connect(s.val1).postLossCharge(amount, ref);
    await s.pool.connect(s.val2).postLossCharge(amount, ref);
  }

  async function pledgePaid(tx: any) {
    const receipt = await tx.wait();
    for (const log of receipt.logs) {
      try {
        const parsed = s.bond.interface.parseLog(log);
        if (parsed?.name === "PledgePaid") return parsed.args;
      } catch { /* other contracts' logs */ }
    }
    throw new Error("no PledgePaid");
  }

  describe("C5 (decisions 7 and 10): pool shares are redeemed through the queue, never seized", function () {
    it("has no seizure: the pool has no seizeShares, LIQUIDATOR_ROLE exempts nothing, and the Liquidator has no share path", async function () {
      const { pool, liquidator, enforcer, ctx, stranger } = s;
      await poolShares(U(1_000));
      await s.issuer.setPrincipal(m, T_POOL, U(700)); // all 1,000 shares behind the draw
      expect(pool.interface.getFunction("seizeShares")).to.equal(null);
      for (const fn of ["liquidateShares", "settleExcess", "settleShortfall", "settleRealized", "earnGapOf"]) {
        expect(liquidator.interface.getFunction(fn)).to.equal(null);
      }
      // A holder of the retired role is not exempt from the lock or the allowlist.
      await pool.grantRole(await pool.LIQUIDATOR_ROLE(), stranger.address);
      await pool.connect(ctx.member).approve(stranger.address, 1n);
      await expect(pool.connect(stranger).transferFrom(m, stranger.address, 1n)).to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      // The enforcer is the only caller of enforcementRedeem, and it has no owner, role or setter.
      await expect(pool.connect(stranger).enforcementRedeem(m, 1n)).to.be.reverted;
      const writes = enforcer.interface.fragments
        .filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
        .map((f: any) => f.name).sort();
      expect(writes).to.deep.equal(["cancelExcess", "enforce", "settle"]);
      expect(await pool.enforcementDestination()).to.equal(await enforcer.getAddress());
    });

    it("redeems only the shares still needed, in the member's name, paid at Share Value when the queue fills; the proceeds pay the Defaulted Amount and the surplus goes to the Holder", async function () {
      const { issuer, pool, enforcer, liquidator, registry, usdc, deploy, stranger } = s;
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_POOL, U(600));
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, U(200), 0n, 1n); // $200 of the Secured Minimum past due
      await deploy(U(600)); // the pool has lent out most of its cash

      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(U(200));
      await expect(enforcer.connect(stranger).enforce(m)).to.emit(enforcer, "EnforcementRequested");
      const queued = await pool.enforcementQueuedOf(m);
      expect(queued).to.be.closeTo(U(200), 2n); // sized by previewWithdraw at today's Share Value
      // Only the shares needed, and nobody else holds them: they wait in the pool's escrow.
      expect(await pool.balanceOf(m)).to.equal(U(1_000) - queued);
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(U(1_000));
      await expect(enforcer.enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");

      // While they wait, the member pays $50 of it themselves. The fill still pays Share Value, the
      // $150 still due is applied, and the $50 left over is the member's, at once (MB-05 §7.6).
      await issuer.notePayment(m, U(50));
      await pool.fillQueue(10);
      const [filled, paid] = await pool.enforcementFilledOf(m);
      expect(filled).to.equal(queued);
      expect(paid).to.be.gte(U(200)); // Share Value at fill: the shares kept earning while queued (C4)
      const before = await usdc.balanceOf(m);
      await expect(enforcer.connect(stranger).settle(m))
        .to.emit(liquidator, "PoolProceedsApplied").withArgs(m, queued, paid, U(150), paid - U(150));
      expect((await usdc.balanceOf(m)) - before).to.equal(paid - U(150));
      expect(await issuer.principalOf(m, T_POOL)).to.equal(U(450));
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(U(1_000) - queued);
      expect(await usdc.balanceOf(await enforcer.getAddress())).to.equal(0n);
      expect(await usdc.balanceOf(await liquidator.getAddress())).to.equal(0n);
      await expect(enforcer.settle(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingToSettle");
    });

    it("gives back queued shares no longer needed: anyone may cancel the excess, and only that", async function () {
      const { issuer, pool, enforcer, stranger } = s;
      await poolShares(U(1_000));
      await issuer.setPrincipal(m, T_POOL, U(300));
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, U(300), 0n, 1n);
      await pool.connect(s.ctx.member).requestWithdrawal(U(100), m); // the member's own request goes first
      await enforcer.enforce(m);
      const id = (await pool.queueLength()) - 1n;
      await expect(enforcer.cancelExcess(m, id)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNotExcess");
      await issuer.notePayment(m, U(120)); // the member cures part of it
      const queued = await pool.enforcementQueuedOf(m);
      await expect(enforcer.connect(stranger).cancelExcess(m, id)).to.emit(enforcer, "EnforcementCancelled");
      const left = await pool.enforcementQueuedOf(m);
      expect(left).to.be.closeTo(U(180), 2n);
      expect(queued - left).to.be.closeTo(U(120), 2n);
      // Not the member's own request, and not twice.
      await expect(enforcer.cancelExcess(m, 0)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNotExcess");
      await expect(enforcer.cancelExcess(m, id)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNotExcess");
    });
  });

  describe("C2 (decision 4): a missed cycle takes no collateral at all", function () {
    it("a missed cycle halves the limit and counts toward default, and takes no pool share, bond or savings", async function () {
      const { issuer, liquidator, enforcer, pool, bond, clrusd, registry, stranger } = s;
      await save(U(1_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(300));
      await poolShares(U(1_000));
      const { id } = await buyBond(U(1_000));
      await issuer.setPrincipal(m, T_INCOME, U(900));
      await issuer.setMissedCycle(m, 1, U(400)); // the halved limit leaves $400 over

      expect(await issuer.missedInRowOf(m)).to.equal(1n);
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(0n);
      expect((await enforcer.sharesNeeded(m))[0]).to.equal(0n);
      await expect(enforcer.connect(stranger).enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      expect((await liquidator.pledgePaymentDue(m, id))[0]).to.equal(false);
      await expect(bond.connect(stranger).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await expect(liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS)).to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");
      // The excess lock keeps $400 of the pool shares pledged, but nothing moves.
      expect(await registry.encumberedOfKind(m, POOL_SHARE)).to.equal(U(400));
      expect(await pool.balanceOf(m)).to.equal(U(1_000));
      expect(await bond.balanceOf(m, id)).to.equal(1n);
      expect(await clrusd.balanceOf(m)).to.equal(U(1_000));
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(900));
    });
  });

  describe("decision 22: capped at the Defaulted Amount recorded on chain", function () {
    it("MB-05 example 1 (Dana): $250 past due on $250 Savings-Backed Drawn redeems $250 of CLRUSD and leaves $2,750", async function () {
      const { issuer, liquidator, clrusd, stranger } = s;
      await save(U(3_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(400));
      await issuer.setPrincipal(m, T_SAVINGS, U(250)); // she repays $150
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, U(250), 0n, 1n);
      await expect(liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS))
        .to.emit(liquidator, "Liquidated").withArgs(m, I, U(250), U(250), U(250));
      expect(await clrusd.balanceOf(m)).to.equal(U(2_750));
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(0n);
      expect(await clrusd.freeBalanceOf(m)).to.equal(U(2_750)); // all of it Withdrawable Capital
    });

    it("the same line with only $100 past due redeems $100 and no more; the rest is not due and stays owed", async function () {
      const { issuer, liquidator, clrusd, stranger } = s;
      await save(U(3_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(250));
      await issuer.setPrincipal(m, T_INCOME, U(500));
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, U(100), U(500), 1n); // $100 Secured Minimum, $500 Rebalance Amount
      await liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS);
      expect(await clrusd.balanceOf(m)).to.equal(U(2_900));
      expect(await issuer.principalOf(m, T_SAVINGS)).to.equal(U(150));
      // The unpaid Rebalance Amount is unsecured debt: CLRUSD never pays it (MB-05 §2.5(a)).
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(500));
      await expect(liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNothingToSeize");
    });

    it("a secured plan: the bond pays what the cure notice concerns less what was repaid, not the whole balance, until the plan's end", async function () {
      const { term, bond, liquidator, usdc, keeper } = s;
      const start = await now();
      // $1,200 owed over 12 monthly installments; the cure notice concerned $300 asked by then.
      await term.addPlan(7, m, U(1_200), start, 12, 30 * DAY);
      const { id: a } = await buyBond(U(1_000));
      const { id: b } = await buyBond(U(1_000), YEAR - DAY);
      await advance(90 * DAY);
      await term.recordDefault(7, U(300));
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(U(300));
      // $50 paid by the member since: $250 is the Defaulted Amount.
      await term.memberPays(7, U(50));
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(U(250));

      // Bond b matures first, so it is the one requested.
      expect((await liquidator.pledgePaymentDue(m, a))[0]).to.equal(false);
      const due = await liquidator.pledgePaymentDue(m, b);
      expect([due[0], due[1], due[2]]).to.deep.equal([true, await term.getAddress(), true]);
      const before = await usdc.balanceOf(m);
      const ev = await pledgePaid(await bond.connect(keeper).payPledged(b));
      expect(ev.toDebt).to.equal(U(250));
      expect(ev.toHolder).to.equal(ev.amount - U(250));
      expect((await usdc.balanceOf(m)) - before).to.equal(ev.amount - U(250));
      expect((await term.plans(7)).owed).to.equal(U(900));
      // Nothing more is due before the plan's end.
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(0n);
      expect((await liquidator.pledgePaymentDue(m, a))[0]).to.equal(false);

      // At its end the whole balance has come due, and bond a pays it.
      await at(start + BigInt(12 * 30 * DAY));
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(U(900));
      const ev2 = await pledgePaid(await bond.connect(keeper).payPledged(a));
      expect(ev2.toDebt).to.equal(U(900));
      expect((await term.plans(7)).owed).to.equal(0n);
    });
  });

  describe("decisions 9 and 10: every secured debt, bonds first, then pool shares, plans oldest first", function () {
    it("a bond pays the defaulted plans oldest first; pool shares are redeemed only for what the bonds leave, and the surplus goes to the Holder", async function () {
      const { term, pool, bond, enforcer, liquidator, usdc, keeper } = s;
      const start = await now();
      // Two plans the member secured by signature (decision 9: no link to any one pledge).
      await term.addPlan(9, m, U(2_000), start, 12, 30 * DAY); // the newer plan, listed first
      await term.addPlan(4, m, U(2_000), start, 12, 30 * DAY); // the older
      await poolShares(U(1_000));
      const { id } = await buyBond(U(500));
      await advance(30 * DAY);
      await term.recordDefault(4, U(300));
      await term.recordDefault(9, U(400));
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(U(700));

      // Bonds first: no pool share is asked for while the bond can pay.
      const pv = await bond.presentValueOf(id);
      const [shares, value] = await enforcer.sharesNeeded(m);
      expect(value).to.equal(U(700) - pv);
      expect(shares).to.equal(U(700) - pv);
      expect((await liquidator.pledgePaymentDue(m, id))[0]).to.equal(true);
      const ev = await pledgePaid(await bond.connect(keeper).payPledged(id));
      // Plan 4 (the older) is paid in full, then plan 9 with the rest.
      expect((await term.plans(4)).owed).to.equal(U(1_700));
      expect((await term.plans(9)).owed).to.equal(U(2_000) - (ev.amount - U(300)));
      expect(ev.toHolder).to.equal(0n);

      // Then pool shares, for exactly what is left of plan 9's Defaulted Amount.
      const left = U(400) - (ev.amount - U(300));
      await enforcer.enforce(m);
      expect(await pool.enforcementQueuedOf(m)).to.equal(left);
      // The member pays $20 of plan 9 meanwhile: that much of the fill is surplus, theirs at once.
      await term.memberPays(9, U(20));
      const before = await usdc.balanceOf(m);
      await expect(fillAndSettle(pool, enforcer, m)).to.emit(liquidator, "PoolProceedsApplied").withArgs(m, left, left, left - U(20), U(20));
      expect((await usdc.balanceOf(m)) - before).to.equal(U(20));
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(0n);
    });

    it("on a revolving default the past-due Secured Minimum is paid on the asset-backed tiers first, then the plans, then the unpaid Rebalance Amount", async function () {
      const { issuer, term, bond, liquidator, keeper } = s;
      await term.addPlan(1, m, U(1_000), await now(), 12, 30 * DAY);
      const { id } = await buyBond(U(2_000));
      await advance(30 * DAY);
      await issuer.setPrincipal(m, T_BOND, U(300));
      await issuer.setPrincipal(m, T_INCOME, U(1_000));
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, U(250), U(600), 1n);
      await term.recordDefault(1, U(400));
      expect((await liquidator.earnDefaultedOf(m))[0]).to.equal(U(1_250));
      const ev = await pledgePaid(await bond.connect(keeper).payPledged(id));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(50)); // $250 past due, not the tier's $300
      expect((await term.plans(1)).owed).to.equal(U(600));
      expect(await issuer.principalOf(m, T_INCOME)).to.equal(U(400)); // the $600 Rebalance Amount, no more
      expect(ev.toHolder).to.equal(ev.amount - U(1_250));
    });
  });

  describe("decision 20: MB-05 §7.1's order among bonds", function () {
    it("the bond nearest maturity first; the member's own order, signed before any notice, instead", async function () {
      const { issuer, registry, liquidator, bond, keeper, stranger, ctx } = s;
      const { id: late } = await buyBond(U(500), YEAR);
      const { id: soon } = await buyBond(U(500), YEAR - 30 * DAY);
      const { id: mid } = await buyBond(U(500), YEAR - 10 * DAY);
      expect([...(await liquidator.nextBondOf(m))]).to.deep.equal([true, soon]);

      // Someone else's signature does not set it.
      const forged = await signEnforcementOrder(registry, stranger, BOND, [late, mid]);
      await expect(registry.setEnforcementOrder(m, BOND, [late, mid], forged.deadline, forged.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryBadSignature");
      // The member's own, submitted by anyone.
      const signed = await signEnforcementOrder(registry, ctx.member, BOND, [late, mid]);
      await expect(registry.connect(stranger).setEnforcementOrder(m, BOND, [late, mid], signed.deadline, signed.signature))
        .to.emit(registry, "EnforcementOrderSet");
      expect([...(await liquidator.nextBondOf(m))]).to.deep.equal([true, late]);

      // On a default the bonds are paid in that order, then nearest maturity for the rest.
      await advance(30 * DAY);
      await issuer.setPrincipal(m, T_BOND, U(1_500));
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, U(1_500), 0n, 1n);
      expect((await liquidator.pledgePaymentDue(m, soon))[0]).to.equal(false);
      await bond.connect(keeper).payPledged(late);
      expect([...(await liquidator.nextBondOf(m))]).to.deep.equal([true, mid]);
      await bond.connect(keeper).payPledged(mid);
      expect([...(await liquidator.nextBondOf(m))]).to.deep.equal([true, soon]);
    });

    it("the member cannot change the order once a Default Notice or a Shortfall notice is recorded", async function () {
      const { issuer, registry, liquidator, ctx, term } = s;
      const { id: a } = await buyBond(U(500), YEAR);
      const { id: b } = await buyBond(U(500), YEAR - DAY);
      // A revolving cure notice (MB-04 §9.2(d)).
      await issuer.setCureNotice(m, Number(await now()));
      let sig = await signEnforcementOrder(registry, ctx.member, BOND, [a, b]);
      await expect(registry.setEnforcementOrder(m, BOND, [a, b], sig.deadline, sig.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryNoticeRecorded");
      await issuer.setCureNotice(m, 0); // paid: cancelled
      // A secured plan's cure notice (MB-06 §13.8), until the past-due amount is paid.
      await term.addPlan(2, m, U(1_000), await now(), 12, 30 * DAY);
      await term.recordNotice(2, U(100));
      sig = await signEnforcementOrder(registry, ctx.member, BOND, [a, b]);
      await expect(registry.setEnforcementOrder(m, BOND, [a, b], sig.deadline, sig.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryNoticeRecorded");
      await term.memberPays(2, U(100));
      // A Shortfall notice.
      await advance(30 * DAY);
      await issuer.setPrincipal(m, T_BOND, (await registry.advancedValueOf(m, BOND, 0)) + U(1));
      await liquidator.noticeShortfall(m);
      sig = await signEnforcementOrder(registry, ctx.member, BOND, [a, b]);
      await expect(registry.setEnforcementOrder(m, BOND, [a, b], sig.deadline, sig.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryNoticeRecorded");
      // Once it is cleared, it can.
      await issuer.setPrincipal(m, T_BOND, 0n);
      await liquidator.noticeShortfall(m);
      await expect(registry.setEnforcementOrder(m, BOND, [a, b], sig.deadline, sig.signature)).to.emit(registry, "EnforcementOrderSet");
      // The notice source is set once.
      await expect(registry.setEnforcementSource(ctx.admin.address)).to.be.revertedWithCustomError(registry, "CollateralRegistryEnforcementSourceSet");
    });
  });

  describe("decision 21: one combined Shortfall, pool shares first", function () {
    it("MB-05 example 2 (Eli): a $20 Shortfall is ended by redeeming $66.67 of Pool Share Value, and no bond", async function () {
      const { issuer, liquidator, enforcer, pool, registry, bond, deploy, stranger } = s;
      const { id, maturity } = await buyBond(U(1_000));
      await poolShares(U(1_000));
      await at(maturity); // Present Value $1,000.00 (Collateral Value $950.00)
      expect(await bond.presentValueOf(id)).to.equal(U(1_000));
      expect(await registry.collateralValueOf(m, POOL_SHARE)).to.equal(U(1_000)); // Pool Share Value
      expect(await registry.advancedValueOf(m, POOL_SHARE, 0)).to.equal(U(700));
      // His Asset-Backed Limit is $1,650.00 and he draws $1,600.00.
      await issuer.setPrincipal(m, T_BOND, U(900));
      await issuer.setPrincipal(m, T_POOL, U(700));
      expect((await liquidator.shortfallOf(m))[0]).to.equal(0n);

      // Pool Share Value falls to $900.00: the limit is $1,580.00 and the Shortfall $20.00.
      await deploy(U(100));
      await lossCharge(U(100));
      expect(await registry.collateralValueOf(m, POOL_SHARE)).to.be.closeTo(U(900), 1n);
      const [gap] = await liquidator.shortfallOf(m);
      expect(gap).to.be.closeTo(U(20), 1n);

      await liquidator.connect(stranger).noticeShortfall(m);
      await advance(72 * HOUR);
      // Pool shares first: all of them would close $270 of it, so no bond is called for.
      expect((await liquidator.pledgePaymentDue(m, id))[0]).to.equal(false);
      const [shares, value] = await enforcer.sharesNeeded(m);
      expect(value).to.be.closeTo(66_666_667n, 3n); // $66.67
      await enforcer.connect(stranger).enforce(m);
      expect(await pool.enforcementQueuedOf(m)).to.equal(shares);
      await expect(fillAndSettle(pool, enforcer, m, stranger)).to.emit(liquidator, "ShortfallCleared").withArgs(m);

      // $66.67 paid off the draw, the limit $46.67 lower: $1,533.33 drawn against $1,533.33.
      const drawn = (await issuer.principalOf(m, T_BOND)) + (await issuer.principalOf(m, T_POOL));
      expect(drawn).to.be.closeTo(1_533_333_333n, 3n);
      const limit = (await registry.advancedValueOf(m, BOND, 0)) + (await registry.advancedValueOf(m, POOL_SHARE, 0));
      expect(limit).to.be.closeTo(1_533_333_333n, 3n);
      expect(drawn).to.be.lte(limit);
      // Nothing else was redeemed or accelerated, and the bond is untouched.
      expect(await bond.balanceOf(m, id)).to.equal(1n);
      expect((await liquidator.shortfallOf(m))[0]).to.equal(0n);
      // (BurnerBonds would have taken $400.00: each dollar of bond closes 5 cents of it.)
      expect((gap * 10_000n) / 500n).to.be.closeTo(U(400), 1_000n);
    });

    it("the 72 hours run longer by paused time, and every enforcement path waits while a pause is in force", async function () {
      const { issuer, liquidator, enforcer, pool, bond, clrusd, stranger, ctx } = s;
      const Mock = await ethers.getContractFactory("MockPauseSource");
      const clrusdPause: any = await Mock.deploy();
      const vaultPause: any = await Mock.deploy();
      const clock = await (await ethers.getContractFactory("PauseClock")).deploy(await clrusdPause.getAddress(), await vaultPause.getAddress());
      await liquidator.setPauseClock(await clock.getAddress());

      await save(U(1_000));
      await issuer.setPrincipal(m, T_SAVINGS, U(300));
      await poolShares(U(1_000));
      const { id } = await buyBond(U(500));
      await issuer.setPrincipal(m, T_POOL, U(500));
      await issuer.setPrincipal(m, T_INCOME, U(500));
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, U(400), U(500), 1n);

      // Paused: no path runs. CLRUSD, the bond, the pool shares, and applying proceeds already filled.
      await enforcer.enforce(m); // queued before the pause
      await pool.fillQueue(10);
      await clrusdPause.pauseAccount(m);
      await expect(liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS)).to.be.revertedWithCustomError(liquidator, "LiquidatorPauseInForce");
      expect((await liquidator.pledgePaymentDue(m, id))[0]).to.equal(false);
      await expect(bond.connect(stranger).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
      await expect(enforcer.connect(stranger).enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerBlocked");
      expect((await enforcer.sharesNeeded(m))[0]).to.equal(0n);
      await expect(enforcer.connect(stranger).settle(m)).to.be.revertedWithCustomError(liquidator, "LiquidatorPauseInForce");
      // A vault-wide pause too.
      await clrusdPause.unpauseAccount(m);
      await vaultPause.pauseAll();
      await expect(enforcer.connect(stranger).settle(m)).to.be.revertedWithCustomError(liquidator, "LiquidatorPauseInForce");
      await expect(liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS)).to.be.revertedWithCustomError(liquidator, "LiquidatorPauseInForce");
      await vaultPause.unpauseAll();

      // Lifted: each runs, within its Defaulted Amount.
      await liquidator.connect(stranger).liquidate(m, I, T_SAVINGS, SAVINGS);
      expect(await clrusd.balanceOf(m)).to.equal(U(700)); // the $300 savings tier, inside the $400 past due
      await enforcer.connect(stranger).settle(m);
      await bond.connect(stranger).payPledged(id);
      void ctx;
    });
  });

  describe("MB-05 §5.3 and §1.3: advance rates and Pool Share Value", function () {
    it("a raise in an advance rate reaches existing pledges, a cut does not, so a cut never causes a Shortfall", async function () {
      const { registry, issuer, liquidator, ctx } = s;
      await poolShares(U(1_000));
      const { id } = await buyBond(U(1_000));
      await issuer.setPrincipal(m, T_POOL, U(700));
      expect(await registry.advancedValueOf(m, POOL_SHARE, 0)).to.equal(U(700));
      await registry.connect(ctx.admin).setCollateralTerms(POOL_SHARE, 8_000n, 10n ** 18n);
      await registry.connect(ctx.admin).setCollateralTerms(BOND, 9_800n, 0n);
      expect(await registry.advanceBpsOf(m, POOL_SHARE)).to.equal(8_000n);
      expect(await registry.itemAdvanceBpsOf(m, BOND, id)).to.equal(9_800n);
      expect(await registry.advancedValueOf(m, POOL_SHARE, 0)).to.equal(U(800));
      await registry.connect(ctx.admin).setCollateralTerms(POOL_SHARE, 6_000n, 10n ** 18n);
      await registry.connect(ctx.admin).setCollateralTerms(BOND, 8_000n, 0n);
      expect(await registry.advanceBpsOf(m, POOL_SHARE)).to.equal(7_000n); // the stored rate
      expect(await registry.itemAdvanceBpsOf(m, BOND, id)).to.equal(9_500n);
      expect((await liquidator.shortfallOf(m))[0]).to.equal(0n);
    });

    it("pool shares are valued by the pool's previewRedeem, net of the holdback, and the lock is sized by previewWithdraw", async function () {
      const { registry, pool, issuer, val1, val2 } = s;
      await poolShares(U(1_000));
      expect(await registry.collateralValueOf(m, POOL_SHARE)).to.equal(await pool.previewRedeem(U(1_000)));
      // A Pool Loss Allowance of $15 on $1,000 of Pool Assets: a 150 bps holdback.
      await pool.connect(val1).postAllowance(U(15), ethers.id("allowance"));
      await pool.connect(val2).postAllowance(U(15), ethers.id("allowance"));
      expect(await pool.holdbackBps()).to.equal(150n);
      expect(await registry.collateralValueOf(m, POOL_SHARE)).to.equal(U(985));
      await issuer.setPrincipal(m, T_POOL, U(350)); // needs $500 of Pool Share Value at 70%
      expect(await registry.encumberedOfKind(m, POOL_SHARE)).to.equal(await pool.previewWithdraw(U(500)));
    });
  });

  describe("decision 34: Pool Shares under a legal hold cannot be pledged (IV-02 §7.5)", function () {
    it("a pledge must fit in the shares the hold leaves; with no hold nothing changes", async function () {
      const { registry, pool, ctx, keeper, stranger } = s;
      await pool.connect(ctx.admin).grantRole(await pool.SUSPENSION_ROLE(), keeper.address);
      await pool.connect(ctx.admin).grantRole(await pool.CCO_ROLE(), stranger.address);
      await s.usdc.mint(m, U(1_000));
      await s.usdc.connect(ctx.member).approve(await pool.getAddress(), U(1_000));
      await pool.connect(ctx.member).deposit(U(1_000), m);
      await pledgeSigned(registry, m, POOL_SHARE, U(200));
      const order = ethers.id("court order");
      await pool.connect(keeper).placeLegalHold(m, U(600), order, 0);
      await pool.connect(stranger).placeLegalHold(m, U(600), order, 0);
      // 1,000 shares, 600 held: at most 400 in all may be pledged, 200 already are.
      await expect(pledgeSigned(registry, m, POOL_SHARE, U(201)))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryEncumbered").withArgs(m, POOL_SHARE, U(400), U(401));
      await pledgeSigned(registry, m, POOL_SHARE, U(200));
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(U(400));
      // Released by two signers, the shares may be pledged again.
      await pool.connect(keeper).releaseLegalHold(0);
      await pool.connect(stranger).releaseLegalHold(0);
      await pledgeSigned(registry, m, POOL_SHARE, U(600));
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(U(1_000));
    });
  });

  describe("decision 19: a pledged bond's share of a distribution round", function () {
    it("goes to the Holder's Defaulted Amounts while enforcement is permitted, else all to the Holder; only the collection or its vault may apply it", async function () {
      const { issuer, liquidator, usdc, bondVault, stranger, holdA, holdB } = s;
      await issuer.setPrincipal(m, T_BOND, U(500));
      await issuer.setInDefault(m, true);
      await issuer.setDefaulted(m, U(300), 0n, 1n);
      await expect(liquidator.connect(stranger).applyDistribution(m, U(1))).to.be.revertedWithCustomError(liquidator, "LiquidatorNotEarnBonds");
      // The vault sends the round's pledged share and asks the Liquidator to apply it.
      const vaultAddress = await bondVault.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [vaultAddress]);
      await ethers.provider.send("hardhat_setBalance", [vaultAddress, "0x56BC75E2D63100000"]);
      const vault = await ethers.getSigner(vaultAddress);
      await usdc.mint(await liquidator.getAddress(), U(400));
      const before = await usdc.balanceOf(m);
      await expect(liquidator.connect(vault).applyDistribution(m, U(400)))
        .to.emit(liquidator, "DistributionApplied").withArgs(m, U(400), U(300), U(100));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(200));
      expect((await usdc.balanceOf(m)) - before).to.equal(U(100));
      // Under a Liquidation Hold it all goes to the Holder, and the round is not stalled.
      await issuer.setDefaulted(m, U(150), 0n, 2n);
      await liquidator.connect(holdA).proposeHold(m, 2, 30 * DAY, ethers.id("evidence:19"));
      await liquidator.connect(holdB).confirmHold(m);
      await usdc.mint(await liquidator.getAddress(), U(50));
      await expect(liquidator.connect(vault).applyDistribution(m, U(50)))
        .to.emit(liquidator, "DistributionApplied").withArgs(m, U(50), 0n, U(50));
      expect(await issuer.principalOf(m, T_BOND)).to.equal(U(200));
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAddress]);
    });
  });

  describe("the Liquidator's module", function () {
    it("is created by the implementation, pinned by kind, and does nothing when called directly", async function () {
      const { liquidator } = s;
      const impl = await ethers.getContractAt("Liquidator", await upgrades.erc1967.getImplementationAddress(await liquidator.getAddress()));
      const moduleAddress = await impl.enforcement();
      const module = await ethers.getContractAt("LiquidatorEnforcement", moduleAddress);
      expect(await module.extensionKind()).to.equal(ethers.id("LiquidatorEnforcement.v1"));
      expect(await liquidator.enforcement()).to.equal(moduleAddress);
      await expect(module.applyPledgePayment(m, I, true, 1n)).to.be.reverted;
      await expect(module.applyPoolProceeds(m, 1n, 1n)).to.be.reverted;
    });
  });
});
