import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { issuerProxyOptions } from "../../helpers/issuers";
import { attesters, passCycleEnd, driveToSecondMiss } from "../../helpers/default";
import { deployCore } from "../deep/deep-setup";
import { signedOpenPlan } from "../../helpers/plans";
import { pledgeSigned } from "../../helpers/pledge";
import { CA, P, CA_BANDS, ONE_USDC, CYCLE, DAY, params, deployRateSchedule } from "./rates";

/*
 * Phase 2g, the credit half: Addendum 4 (`docs/audit/specs/addendum-4.md`), 12.17 and 12.18, as the
 * owner decided them (`addendum-4-decisions.md`, items 3-6, 14 and 16-32).
 *
 *  - 10c on the credit side (decisions 3-6): the pause clock lengthens 12.5's grace period and
 *    12.14's cure period, pushes a due point back, and holds every default trigger while a pause is
 *    in force. Tests 50 and 51. (`payPledged` and the Shortfall wait: PledgedBonds.spec.ts.)
 *  - 12.13 Income Assurance per hardshipRef (decision 14). Test 55.
 *  - 12.17 statement data (decisions 16-23). Test 56.
 *  - 12.18 workout states (decisions 24-32). Test 57.
 *
 * The pause sources are MockPauseSource, with the view signatures CLRUSD and the vault expose (the
 * de-listing half tests those); one test reads PauseClock over the real contracts.
 */
const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const usd = (n: number | bigint) => BigInt(n) * ONE_USDC;
const RAY = 10n ** 27n;

async function at(t: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [t]);
}
async function mineAt(t: number) {
  await at(t);
  await ethers.provider.send("evm_mine", []);
}
async function now() {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}
async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}
async function stamp(tx: any): Promise<number> {
  const r = await (await tx).wait();
  return (await ethers.provider.getBlock(r!.blockNumber))!.timestamp;
}
function eventsOf(contract: any, receipt: any, name: string) {
  return receipt.logs
    .map((l: any) => { try { return contract.interface.parseLog(l); } catch { return null; } })
    .filter((e: any) => e && e.name === name);
}

const SAVINGS = 0, ASSET = 1, INCOME = 2, BOOST = 3, WORKOUT = 4;
const DEFERRAL = 1, REDUCED = 2, PLAN = 3;
const TERMS = {
  unsecuredLineCap: usd(2_499),
  cureWindow: 15 * DAY,
  boostCleanCycles: 6,
  boostDepositCycles: 5,
  autoClearOffGlobal: false,
};

/**
 * A revolving line with the four tiers and the workout plan's 0% position, a pause clock over two
 * mock sources (CLRUSD's account pauses and the vault-wide pause), and, when `priced`, CA pricing
 * from RateSchedule as Addendum 2's tests price it. Otherwise each tier runs on its own rate.
 */
async function deployCredit(priced: boolean) {
  const ctx = await deployPhase0Network();
  const s = await ethers.getSigners();
  const [coop, m2, m3, m4] = [s[8], s[12], s[13], s[14]];
  const revolving: any = await upgrades.deployProxy(await ethers.getContractFactory("RevolvingIssuer"),
    [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
  const wk: any = await ethers.getContractAt("RevolvingIssuerWorkouts", await revolving.getAddress());
  await ctx.networkRegistry.registerIssuer(await revolving.getAddress(), await ctx.stableCredit.getAddress());
  await ctx.access.grantOperator(await revolving.getAddress());
  const added: number[] = [];
  for (const [name, rate] of [["SAVINGS", 0n], ["ASSET_INTERNAL", 65n], ["INCOME", 150n], ["BOOST", 250n], ["WORKOUT", 0n]] as const) {
    added.push(await stamp(revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, CYCLE)));
  }
  if (priced) {
    const rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
    await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 250 }), CA_BANDS);
    await rates.setProduct(CA, P("REVOLVING"), params({ listMonthlyBps: 0 }), CA_BANDS);
    await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
    await revolving.connect(ctx.operator).setTierProduct(INCOME, P("INCOME"));
    await revolving.connect(ctx.operator).setTierProduct(BOOST, P("BOOST"));
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
  }
  for (const m of [ctx.member, m2, m3, m4]) {
    if (priced) await ctx.networkRegistry.attestStateCode(m.address, CA);
    await ctx.usdc.mint(m.address, usd(100_000));
    await ctx.usdc.connect(m).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
  }
  await revolving.connect(ctx.operator).setCreditTerms(TERMS, usd(500), usd(750));
  await revolving.connect(ctx.operator).setDueTerms(100, usd(1), 0, 3);
  const Mock = await ethers.getContractFactory("MockPauseSource");
  const clrusdPause: any = await Mock.deploy();
  const vaultPause: any = await Mock.deploy();
  const clock: any = await (await ethers.getContractFactory("PauseClock"))
    .deploy(await clrusdPause.getAddress(), await vaultPause.getAddress());
  await wk.connect(ctx.operator).setPauseClock(await clock.getAddress());
  return { ctx, revolving, wk, clrusdPause, vaultPause, clock, coop, m2, m3, m4, incomeTierAt: added[INCOME] };
}

describe("ADDENDUM 4, credit half: pauses, Income Assurance per hardship, statement data, workouts (tests 50, 51, 55-57)", function () {
  let c: Awaited<ReturnType<typeof deployCredit>>;
  let revolving: any, wk: any;

  async function open(member: any, caps: number[], day: number) {
    return revolving.connect(c.ctx.operator).openLine(member.address, caps.map((n) => usd(n)), day);
  }
  async function spend(member: any, amount: bigint) {
    return c.ctx.stableCredit.connect(member).transfer(c.ctx.counterparty.address, amount);
  }
  async function repay(member: any, amount: bigint) {
    return c.ctx.stableCredit.connect(member).repayCreditBalance(member.address, amount);
  }

  /* ─────────────────────────── 10c: pauses on the revolving line ─────────────────────────── */

  describe("10c on the revolving line (decisions 3-6)", function () {
    beforeEach(async function () {
      await network.provider.request({ method: "hardhat_reset", params: [] });
      c = await deployCredit(true);
      ({ revolving, wk } = c);
    });

    it("50. with a cure-notice timestamp and grace ending on day 22, a 5-day pause during grace moves the end to day 27; the trigger reverts on day 26 and while any pause is in force, and succeeds for a random caller after day 27 with no pause", async function () {
      const m = c.ctx.member.address;
      await at(ts("2027-01-10T18:00:00Z"));
      await open(c.ctx.member, [0, 0, 1_000, 0], 15);
      await spend(c.ctx.member, usd(500));
      await driveToSecondMiss(revolving, m);
      const due = Number((await revolving.cycleStateOf(m)).cureDueAt);
      const [a, b] = await attesters(revolving);
      await at(due + 12 * DAY - 60);
      await revolving.connect(a).proposeCureNotice(m);
      await at(due + 12 * DAY);
      await revolving.connect(b).approveCureNotice(m); // the grace period ends on day 22

      // A 5-day pause of the member's own CLRUSD account, from day 20 to day 25.
      await at(due + 20 * DAY);
      await c.clrusdPause.pauseAccount(m);
      await at(due + 22 * DAY + 60); // past day 22, the pause in force
      await expect(revolving.connect(c.ctx.outsider).triggerDefault(m))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      await at(due + 25 * DAY);
      await c.clrusdPause.unpauseAccount(m);
      expect(await c.clock.pausedSeconds(m)).to.equal(BigInt(5 * DAY));

      await at(due + 26 * DAY);
      await expect(revolving.connect(c.ctx.outsider).triggerDefault(m))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      await at(due + 27 * DAY - 1);
      await expect(revolving.connect(c.ctx.outsider).triggerDefault(m))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      // Any pause in force holds it, the vault-wide one included, and lengthens it by its own time.
      await at(due + 27 * DAY);
      await c.vaultPause.pauseAll();
      await at(due + 27 * DAY + 60);
      await expect(revolving.connect(c.ctx.outsider).triggerDefault(m))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      await at(due + 27 * DAY + 120);
      await c.vaultPause.unpauseAll(); // two more minutes: the end is day 27 + 120 s
      expect(await revolving.inDefault(m)).to.equal(true);
      await at(due + 27 * DAY + 121);
      await expect(revolving.connect(c.ctx.outsider).triggerDefault(m)).to.emit(revolving, "CreditLineDefaulted");
      expect(await revolving.hasDefaulted(m)).to.equal(true);
    });

    it("Phase 2f decision 37: the line's closing is recorded by two people, only while the Objective Default stands and no pause is in force, once per line", async function () {
      const m = c.ctx.member.address;
      await open(c.ctx.member, [0, 0, 1_000, 0], 15);
      await spend(c.ctx.member, usd(500));
      await driveToSecondMiss(revolving, m);
      const [a, b] = await attesters(revolving);
      // A second miss is not yet a default: nothing can be recorded.
      await expect(wk.connect(a).proposeLineClosing(m)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      await revolving.connect(a).proposeCureNotice(m);
      const noticeAt = await stamp(revolving.connect(b).approveCureNotice(m));
      const due = Number((await revolving.cycleStateOf(m)).cureDueAt);
      await mineAt(Math.max(due + 15 * DAY, noticeAt + 864_000));
      expect(await revolving.inDefault(m)).to.equal(true);

      // Only the credit attester role; one proposes, a different one approves.
      await expect(wk.connect(c.ctx.outsider).proposeLineClosing(m)).to.be.reverted;
      await expect(wk.connect(b).approveLineClosing(m)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerNoProposal");
      await expect(wk.connect(a).proposeLineClosing(m)).to.emit(revolving, "LineClosingProposed").withArgs(m, a.address);
      await expect(wk.connect(a).approveLineClosing(m)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerSameSigner");
      // A pause in force holds it (10c), as it holds the default.
      await c.clrusdPause.pauseAccount(m);
      await expect(wk.connect(b).approveLineClosing(m)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      await c.clrusdPause.unpauseAccount(m);
      await advance(60);
      expect(await wk.lineClosedAt(m)).to.equal(0n);
      const closedAt = await stamp(wk.connect(b).approveLineClosing(m));
      expect(await wk.lineClosedAt(m)).to.equal(BigInt(closedAt));
      // Recorded once for the line; the default it rests on stays recorded.
      await expect(wk.connect(a).proposeLineClosing(m)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerNothingDue");
      await revolving.connect(c.ctx.outsider).triggerDefault(m);
      expect(await revolving.hasDefaultedOnCurrentLine(m)).to.equal(true);
      expect(await wk.lineClosedAt(m)).to.equal(BigInt(closedAt));
    });

    it("decision 5: paused time between a close and its due point pushes the due point back; nothing is judged while a pause is in force, the next close is still recorded at its own end, and a payment inside the pushed window is no miss", async function () {
      const m = c.ctx.member.address;
      const m2 = c.m2.address;
      await at(ts("2027-01-10T18:00:00Z"));
      await open(c.ctx.member, [0, 0, 1_000, 0], 15);
      await open(c.m2, [0, 0, 1_000, 0], 15);
      await spend(c.ctx.member, usd(500));
      await spend(c.m2, usd(500));
      await passCycleEnd(revolving, m); // Feb 15 closes on the $500
      await revolving.syncCreditPeriod(m2);
      const feb = Number((await revolving.cycleStateOf(m)).closedAt);
      const mar = Number((await revolving.cycleStateOf(m)).cycleEnd);
      const ra = (await revolving.cycleStateOf(m)).rebalanceAmount;
      const ra2 = (await revolving.cycleStateOf(m2)).rebalanceAmount;

      // The member's account is paused from two days before the due point to three days after it.
      await at(mar - 2 * DAY);
      await c.clrusdPause.pauseAccount(m);
      await at(mar + 1);
      const r = await (await revolving.syncCreditPeriod(m)).wait();
      // Not judged: no CycleJudged. But the March cycle closes at its own end (12.17).
      expect(eventsOf(revolving, r, "CycleJudged")).to.have.length(0);
      const st = eventsOf(revolving, r, "CycleStatement");
      expect(st).to.have.length(1);
      expect(st[0].args.cycleEnd).to.equal(BigInt(mar));
      let s = await revolving.cycleStateOf(m);
      expect(s.heldClosedAt).to.equal(BigInt(feb));
      expect(s.heldRA).to.equal(ra);
      expect(s.closedAt).to.equal(BigInt(mar));
      expect((await revolving.cycleOf(m)).missedInRow).to.equal(0n);
      // Still not judged while the pause is in force, however late.
      await at(mar + 2 * DAY);
      await revolving.syncCreditPeriod(m);
      expect((await revolving.cycleStateOf(m)).heldClosedAt).to.equal(BigInt(feb));
      await at(mar + 3 * DAY);
      await c.clrusdPause.unpauseAccount(m); // 5 days paused: the due point is now Mar 15 + 5 days

      // Both pay on day 4 after the due point. The member's payment is inside the pushed window; the
      // unpaused member's is late, and that cycle is judged a miss before the payment lands.
      await at(mar + 4 * DAY);
      await repay(c.ctx.member, ra);
      await at(mar + 4 * DAY + 10);
      await expect(repay(c.m2, ra2)).to.emit(revolving, "CycleJudged").withArgs(m2, false, 1, 0, false);
      expect((await revolving.cycleOf(m2)).missedInRow).to.equal(1n);

      await at(mar + 5 * DAY - 1);
      await revolving.syncCreditPeriod(m);
      expect((await revolving.cycleStateOf(m)).heldClosedAt).to.equal(BigInt(feb)); // one second early
      await at(mar + 5 * DAY);
      await expect(revolving.syncCreditPeriod(m)).to.emit(revolving, "CycleJudged").withArgs(m, true, 0, 1, false);
      s = await revolving.cycleStateOf(m);
      expect(s.heldClosedAt).to.equal(0n);
      expect((await revolving.cycleOf(m)).missedInRow).to.equal(0n);
      // The March close stays open, with the payment counted toward it too.
      expect(s.closedAt).to.equal(BigInt(mar));
      expect(s.paidSinceClose).to.equal(ra);
    });

    it("PauseClock reads CLRUSD's and the vault's own clocks: any account pause, plus any CLRUSD-wide or vault-wide pause", async function () {
      const s = await ethers.getSigners();
      const [keyA, keyB] = [s[18], s[19]];
      const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
        ["Clear USD", "CLRUSD", 6, 0, 0, c.ctx.admin.address, c.ctx.admin.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"),
        [await clrusd.getAddress(), c.ctx.admin.address], { kind: "uups" });
      for (const k of [keyA, keyB]) {
        await vault.grantRole(await vault.PAUSER_ROLE(), k.address);
        await clrusd.grantRole(await clrusd.FRAUD_ROLE(), k.address);
      }
      const clock: any = await (await ethers.getContractFactory("PauseClock"))
        .deploy(await clrusd.getAddress(), await vault.getAddress());
      const m = c.ctx.member.address;
      expect(await clock.pausedSeconds(m)).to.equal(0n);
      await clrusd.connect(keyA).pauseAccount(m, 1);
      const p = await stamp(clrusd.connect(keyB).pauseAccount(m, 1));
      expect(await clock.inForce(m)).to.equal(true);
      expect(await clock.inForce(c.m2.address)).to.equal(false); // another member's account
      await advance(3600);
      await vault.connect(keyA).pause();
      const v = await stamp(vault.connect(keyB).pause());
      expect(await clock.inForce(c.m2.address)).to.equal(true); // the vault-wide pause reaches everyone
      await advance(3600);
      const t = await now();
      expect(await clock.pausedSeconds(m)).to.equal(BigInt((t - p) + (t - v)));
      expect(await clock.pausedSeconds(c.m2.address)).to.equal(BigInt(t - v));
    });

    it("the pause clock is set once, by the settings role", async function () {
      await expect(wk.connect(c.ctx.outsider).setPauseClock(c.ctx.outsider.address))
        .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
      await expect(wk.connect(c.ctx.operator).setPauseClock(c.ctx.outsider.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPauseClockSet");
    });
  });

  /* ───────────────────────────── 12.13: Income Assurance (test 55) ───────────────────────────── */

  describe("12.13 Income Assurance per hardshipRef (decision 14)", function () {
    beforeEach(async function () {
      await network.provider.request({ method: "hardhat_reset", params: [] });
      c = await deployCredit(true);
      ({ revolving, wk } = c);
    });

    it("55. a two-person attestation with any hardshipRef succeeds; a single-signer one reverts; a fourth consecutive cycle for the same hardshipRef reverts; while it runs no miss, securedDrawPause or default arises, and carry accrues on principal only", async function () {
      const m = c.ctx.member.address;
      const H1 = ethers.id("hardship: illness, case 1");
      const H2 = ethers.id("hardship: disaster, case 2");
      await at(ts("2027-01-10T18:00:00Z"));
      await open(c.ctx.member, [3_000, 0, 1_000, 0], 15);
      await spend(c.ctx.member, usd(500)); // Savings-backed
      await passCycleEnd(revolving, m);
      const [a, b] = await attesters(revolving);
      // No hardshipRef, too many cycles, a non-attester, the same signer: all refused.
      await expect(revolving.connect(a).proposeIncomePause(m, 3, ethers.ZeroHash))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPauseTooLong");
      await expect(revolving.connect(a).proposeIncomePause(m, 4, H1))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPauseTooLong");
      await expect(revolving.connect(c.ctx.outsider).proposeIncomePause(m, 3, H1))
        .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
      await revolving.connect(a).proposeIncomePause(m, 3, H1);
      await expect(revolving.connect(a).approveIncomePause(m, 3, H1))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerSameSigner");
      // The second signer approves the same terms: a different hardshipRef is not the proposal.
      await expect(revolving.connect(b).approveIncomePause(m, 3, H2))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNoProposal");
      await expect(revolving.connect(b).approveIncomePause(m, 3, H1))
        .to.emit(revolving, "IncomePauseHardship").withArgs(m, H1, 3);
      // Another hardship cannot replace a running one.
      await revolving.connect(a).proposeIncomePause(m, 1, H2);
      await expect(revolving.connect(b).approveIncomePause(m, 1, H2))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerHardshipActive");

      // Three cycle ends, nothing paid: no miss, no secured-draw pause, no default; carry runs on
      // principal alone (the principal-seconds of each closed cycle are the same principal x its length).
      const principal = await revolving.principalOnlyOf(m, SAVINGS);
      for (let i = 0; i < 3; i++) {
        const before = Number((await revolving.cycleStateOf(m)).cycleEnd);
        const prior = Number((await revolving.cycleStateOf(m)).lastCycleEnd);
        await passCycleEnd(revolving, m);
        expect((await revolving.cycleOf(m)).missedInRow).to.equal(0n);
        const [, sm, paused] = await revolving.duesOf(m);
        expect(paused).to.equal(false);
        // Nothing is due at the first three due points; the close at the third, once the pause has
        // run out, fixes ordinary dues for the next.
        if (i < 2) expect(sm).to.equal(0n);
        expect(await revolving.inDefault(m)).to.equal(false);
        expect(await revolving.principalOnlyOf(m, SAVINGS)).to.equal(principal);
        expect((await wk.positionStatOf(m, SAVINGS)).lastPrincipalSeconds).to.equal(principal * BigInt(before - prior));
      }
      expect((await revolving.cycleStateOf(m)).incomePause).to.equal(0n);
      // A fourth consecutive cycle for the same hardship: refused.
      await revolving.connect(a).proposeIncomePause(m, 1, H1);
      await expect(revolving.connect(b).approveIncomePause(m, 1, H1))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPauseTooLong").withArgs(4, 3);
      // A separate documented hardship may start a fresh pause straight after.
      await revolving.connect(a).proposeIncomePause(m, 3, H2);
      await expect(revolving.connect(b).approveIncomePause(m, 3, H2))
        .to.emit(revolving, "IncomePauseHardship").withArgs(m, H2, 3);
      expect((await revolving.cycleStateOf(m)).hardshipRef).to.equal(H2);
    });
  });

  /* ──────────────────────────────── 12.17: statement data (test 56) ──────────────────────────────── */

  describe("12.17 statement data (decisions 17-22)", function () {
    beforeEach(async function () {
      await network.provider.request({ method: "hardhat_reset", params: [] });
      c = await deployCredit(true);
      ({ revolving, wk } = c);
    });

    it("56. every 12.17 value of a closed cycle is readable as at its end, even when recorded late, from the close event and the stored snapshot; payments break out carry and principal per position", async function () {
      const m = c.ctx.member.address;
      await at(ts("2027-01-10T18:00:00Z"));
      await open(c.ctx.member, [0, 0, 1_000, 500], 15);
      const end1 = Number((await revolving.cycleStateOf(m)).cycleEnd);
      const drawAt = ts("2027-01-11T18:00:00Z");
      await at(drawAt);
      await expect(spend(c.ctx.member, usd(500))).to.emit(revolving, "TierDrawn").withArgs(m, INCOME, usd(500));
      // Carry as at the cycle end, read in a block at exactly that second.
      await mineAt(end1);
      const carryAtEnd = await revolving.carryOf(m, INCOME);
      expect(carryAtEnd).to.be.gt(0n);

      // A payment a day after the end, before anyone closed the cycle: the close is recorded first, as
      // at the end, then the payment lands, broken out into carry and principal.
      await at(end1 + DAY);
      const r = await (await repay(c.ctx.member, usd(100))).wait();
      const [st] = eventsOf(revolving, r, "CycleStatement");
      expect(st.args.member).to.equal(m);
      expect(st.args.cycleEnd).to.equal(BigInt(end1));
      expect(st.args.recordedAt).to.equal(BigInt(end1 + DAY));
      expect(st.args.startPrincipal[INCOME]).to.equal(0n);
      expect(st.args.endPrincipal[INCOME]).to.equal(usd(500));
      expect(st.args.endCarry[INCOME]).to.equal(carryAtEnd);
      expect(st.args.cycleCarry[INCOME]).to.equal(carryAtEnd);
      expect(st.args.principalSeconds[INCOME]).to.equal(usd(500) * BigInt(end1 - drawAt));
      expect(st.args.rebalanceAmount).to.equal(usd(500) + carryAtEnd);
      expect(st.args.securedMinimum).to.equal(0n);
      expect(st.args.statementRequired).to.equal(true);
      expect(st.args.workoutState).to.equal(0n);
      const [split] = eventsOf(revolving, r, "TierPaymentSplit");
      expect(split.args.tierId).to.equal(BigInt(INCOME));
      expect(split.args.carry).to.be.gt(carryAtEnd); // the end's carry and a day's more
      expect(split.args.carry + split.args.principal).to.equal(usd(100));

      // The snapshot of the last close, for views.
      const s = await revolving.cycleStateOf(m);
      expect(s.lastCycleEnd).to.equal(BigInt(end1));
      expect(s.lastRecordedAt).to.equal(BigInt(end1 + DAY));
      expect(s.lastStatementRequired).to.equal(true);
      const p = await wk.positionStatOf(m, INCOME);
      expect(p.endPrincipal).to.equal(usd(500));
      expect(p.endCarry).to.equal(carryAtEnd);
      expect(p.lastCycleCarry).to.equal(carryAtEnd);
      expect(p.lastPrincipalSeconds).to.equal(usd(500) * BigInt(end1 - drawAt));

      // The next close starts from those figures.
      const end2 = Number(s.cycleEnd);
      await at(end2 + 5);
      const r2 = await (await revolving.syncCreditPeriod(m)).wait();
      const [st2] = eventsOf(revolving, r2, "CycleStatement");
      expect(st2.args.startPrincipal[INCOME]).to.equal(usd(500));
      expect(st2.args.startCarry[INCOME]).to.equal(carryAtEnd);
      expect(st2.args.cycleEnd).to.equal(BigInt(end2));
    });

    it("56. a cycle ending with a balance of $0.50 is marked statement-required (no threshold), and one ending at zero is not", async function () {
      const [m2, m3] = [c.m2, c.m3];
      await at(ts("2027-01-10T18:00:00Z"));
      await open(m2, [0, 0, 1_000, 0], 15);
      await open(m3, [0, 0, 1_000, 0], 15);
      await spend(m2, usd(100));
      await spend(m3, usd(100));
      const end1 = Number((await revolving.cycleStateOf(m2.address)).cycleEnd);
      await at(end1 - 2 * DAY);
      await revolving.materialiseCarry(m2.address);
      await revolving.materialiseCarry(m3.address);
      await repay(m2, (await revolving.principalOf(m2.address, INCOME)) - usd(1) / 2n);
      await repay(m3, await revolving.principalOf(m3.address, INCOME));
      // The second's carry accrued on the way in: paid too, so nothing is left at all.
      await repay(m3, await c.ctx.stableCredit.creditBalanceOf(m3.address));
      expect(await revolving.drawnOf(m3.address, INCOME)).to.equal(0n);
      await at(end1 + 1);
      const r2 = await (await revolving.syncCreditPeriod(m2.address)).wait();
      const [st2] = eventsOf(revolving, r2, "CycleStatement");
      expect(st2.args.endPrincipal[INCOME] + st2.args.endCarry[INCOME]).to.be.gte(usd(1) / 2n);
      expect(st2.args.endPrincipal[INCOME] + st2.args.endCarry[INCOME]).to.be.lt(usd(1) / 2n + 1_000n);
      expect(st2.args.statementRequired).to.equal(true);
      const r3 = await (await revolving.syncCreditPeriod(m3.address)).wait();
      expect(eventsOf(revolving, r3, "CycleStatement")[0].args.statementRequired).to.equal(false);
      expect((await revolving.cycleStateOf(m3.address)).lastStatementRequired).to.equal(false);
    });

    it("56. a cycle with an Earn release shows it, with the member, time and amount, in its collateral-change events", async function () {
      const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
      const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
        [c.ctx.admin.address, await c.ctx.networkRegistry.getAddress()], { kind: "uups" });
      await registry.registerCollateralType(POOL_SHARE, 3, 7_000n, 10n ** 18n);
      const m = c.ctx.member.address;
      await expect(pledgeSigned(registry, c.ctx.member, POOL_SHARE, usd(400)))
        .to.emit(registry, "Pledged").withArgs(m, POOL_SHARE, usd(400));
      const r = await (await registry.release(m, POOL_SHARE, usd(150))).wait();
      const [released] = eventsOf(registry, r, "Released");
      expect(released.args.member).to.equal(m);
      expect(released.args.kind).to.equal(POOL_SHARE);
      expect(released.args.amount).to.equal(usd(150));
      expect((await ethers.provider.getBlock(r.blockNumber))!.timestamp).to.be.gt(0);
    });
  });

  /* ──────────────────────────────── 12.18: workouts (test 57) ──────────────────────────────── */

  describe("12.18 workout states (decisions 24-32)", function () {
    beforeEach(async function () {
      await network.provider.request({ method: "hardhat_reset", params: [] });
      c = await deployCredit(false); // each tier on its own rate: the plan's figures come out exact
      ({ revolving, wk } = c);
    });

    async function workout(member: string, state: number, cycles: number, reduced: bigint, ref: string) {
      const [a, b] = await attesters(revolving);
      await wk.connect(a).proposeWorkout(member, state, cycles, reduced, ref);
      return wk.connect(b).approveWorkout(member, state, cycles, reduced, ref);
    }

    it("57. a single-signer attestation reverts; a third DEFERRAL cycle reverts; a second workout within 365 days needs its own two-person approval", async function () {
      const m = c.ctx.member.address;
      await open(c.ctx.member, [0, 0, 1_000, 0], 0);
      await spend(c.ctx.member, usd(200));
      const [a, b] = await attesters(revolving);
      const ref = ethers.id("workout 1");
      await expect(wk.connect(c.ctx.outsider).proposeWorkout(m, DEFERRAL, 2, 0, ref))
        .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
      await expect(wk.connect(a).proposeWorkout(m, DEFERRAL, 3, 0, ref))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerWorkoutTerms");
      await expect(wk.connect(a).proposeWorkout(m, REDUCED, 4, usd(40), ref))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerWorkoutTerms");
      await expect(wk.connect(a).proposeWorkout(m, PLAN, 13, 0, ref))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerWorkoutTerms");
      await expect(wk.connect(a).proposeWorkout(m, DEFERRAL, 2, 0, ethers.ZeroHash))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerWorkoutTerms");
      await wk.connect(a).proposeWorkout(m, DEFERRAL, 1, 0, ref);
      await expect(wk.connect(a).approveWorkout(m, DEFERRAL, 1, 0, ref))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerSameSigner");
      await expect(wk.connect(b).approveWorkout(m, DEFERRAL, 2, 0, ref))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNoProposal");
      await expect(wk.connect(b).approveWorkout(m, DEFERRAL, 1, 0, ref))
        .to.emit(revolving, "WorkoutStarted").withArgs(m, DEFERRAL, 1, 0, ref);
      // The member ends it early with their own call; nobody else can.
      await expect(wk.connect(a).endWorkout()).to.be.revertedWithCustomError(revolving, "RevolvingIssuerNothingDue");
      await expect(wk.connect(c.ctx.member).endWorkout()).to.emit(revolving, "WorkoutEnded").withArgs(m, DEFERRAL);
      // A second workout within 365 days: refused without the separate approval, with its own hash.
      const ref2 = ethers.id("workout 2");
      await wk.connect(a).proposeWorkout(m, REDUCED, 2, usd(40), ref2);
      await expect(wk.connect(b).approveWorkout(m, REDUCED, 2, usd(40), ref2))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerWorkoutTooSoon");
      await expect(wk.connect(a).proposeSecondWorkout(m, ref)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerWorkoutTerms");
      await wk.connect(a).proposeSecondWorkout(m, ref2);
      await expect(wk.connect(a).approveSecondWorkout(m, ref2)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerSameSigner");
      await expect(wk.connect(b).approveSecondWorkout(m, ref2)).to.emit(revolving, "SecondWorkoutApproved").withArgs(m, ref2);
      await wk.connect(a).proposeWorkout(m, REDUCED, 2, usd(40), ref2);
      await expect(wk.connect(b).approveWorkout(m, REDUCED, 2, usd(40), ref2)).to.emit(revolving, "WorkoutStarted");
      // A third needs a fresh approval again: the second one was used.
      await wk.connect(c.ctx.member).endWorkout();
      await wk.connect(a).proposeWorkout(m, DEFERRAL, 1, 0, ethers.id("workout 3"));
      await expect(wk.connect(b).approveWorkout(m, DEFERRAL, 1, 0, ethers.id("workout 3")))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerWorkoutTooSoon");
    });

    it("57. DEFERRAL: no unsecured carry and no Rebalance Amount for 2 cycles and no miss; unsecured draws revert; it ends at the close after", async function () {
      const m = c.ctx.member.address;
      await open(c.ctx.member, [0, 0, 1_000, 0], 0);
      await spend(c.ctx.member, usd(300));
      await passCycleEnd(revolving, m); // the first close fixes a Rebalance Amount of $300 + carry
      const ref = ethers.id("deferral");
      await workout(m, DEFERRAL, 2, 0n, ref);
      const income = await revolving.principalOf(m, INCOME);
      expect((await revolving.cycleStateOf(m)).rebalanceAmount).to.equal(0n);
      await expect(spend(c.ctx.member, usd(10))).to.be.revertedWithCustomError(revolving, "RevolvingIssuerDrawUnplaced");
      for (let i = 0; i < 2; i++) {
        await passCycleEnd(revolving, m);
        expect((await revolving.cycleOf(m)).missedInRow).to.equal(0n);
        expect(await revolving.principalOf(m, INCOME)).to.equal(income); // no carry
      }
      // The deferral ended at the second close; that close is ordinary and carry runs again.
      const w = await wk.workoutStateOf(m);
      expect(w.state).to.equal(0n);
      expect((await revolving.cycleStateOf(m)).rebalanceAmount).to.equal(income);
      await advance(DAY);
      expect(await revolving.drawnOf(m, INCOME)).to.be.gt(income);
    });

    it("57. REDUCED $40 against a normal $120: paying $40 records no miss; after 3 qualifying payments the miss count resets, and a second re-age within 365 days does not occur", async function () {
      const m = c.ctx.member.address;
      await open(c.ctx.member, [0, 0, 1_000, 0], 0);
      await spend(c.ctx.member, usd(120));
      await passCycleEnd(revolving, m); // close 0: $120 + carry due
      await passCycleEnd(revolving, m); // unpaid: the first miss
      expect((await revolving.cycleOf(m)).missedInRow).to.equal(1n);
      const normal = (await revolving.cycleStateOf(m)).rebalanceAmount;
      expect(normal).to.be.gt(usd(120));
      await workout(m, REDUCED, 3, usd(40), ethers.id("reduced 1"));
      expect((await revolving.cycleStateOf(m)).rebalanceAmount).to.equal(usd(40));
      for (let i = 0; i < 3; i++) {
        await repay(c.ctx.member, usd(40));
        const end = Number((await revolving.cycleStateOf(m)).cycleEnd);
        await at(end + 1);
        const r = await (await revolving.syncCreditPeriod(m)).wait();
        const [judged] = eventsOf(revolving, r, "CycleJudged");
        expect(judged.args.clean).to.equal(true); // paying $40 is no miss
        if (i < 2) {
          expect((await revolving.cycleOf(m)).missedInRow).to.equal(1n); // the run stands until the re-age
          expect((await revolving.cycleStateOf(m)).rebalanceAmount).to.be.lte(usd(40));
        } else {
          expect(eventsOf(revolving, r, "WorkoutReaged")).to.have.length(1);
          expect((await revolving.cycleOf(m)).missedInRow).to.equal(0n);
          expect(eventsOf(revolving, r, "WorkoutEnded")).to.have.length(1); // the close after the third
        }
      }
      const reagedAt = (await wk.workoutStateOf(m)).reagedAt;
      expect(reagedAt).to.not.equal(0n);

      // A later miss, a second workout (separately approved), three more qualifying cycles: no
      // second re-age within 365 days.
      await spend(c.ctx.member, usd(120));
      await passCycleEnd(revolving, m); // the ordinary close's dues are not paid: a miss
      expect((await revolving.cycleOf(m)).missedInRow).to.equal(1n);
      const [a, b] = await attesters(revolving);
      const ref2 = ethers.id("reduced 2");
      await wk.connect(a).proposeSecondWorkout(m, ref2);
      await wk.connect(b).approveSecondWorkout(m, ref2);
      await workout(m, REDUCED, 3, usd(40), ref2);
      for (let i = 0; i < 3; i++) {
        await repay(c.ctx.member, usd(40));
        const end = Number((await revolving.cycleStateOf(m)).cycleEnd);
        await at(end + 1);
        const r = await (await revolving.syncCreditPeriod(m)).wait();
        expect(eventsOf(revolving, r, "WorkoutReaged")).to.have.length(0);
      }
      expect((await revolving.cycleOf(m)).missedInRow).to.equal(1n);
      expect((await wk.workoutStateOf(m)).reagedAt).to.equal(reagedAt);
    });

    it("57. PLAN: $900 principal + $12 carry becomes a 0% plan of 12 x $76, the unsecured positions go to zero, an unsecured draw reverts, and the plan ends when paid off", async function () {
      const m = c.ctx.member.address;
      await open(c.ctx.member, [0, 0, 1_000, 500], 0);
      // Find a draw time and a later time at which $900 at 1.5% a month has accrued exactly $12.00
      // on the tier's own accumulator (as RevolvingIssuer computes it).
      const T0 = BigInt(c.incomeTierAt);
      const acc = (x: bigint) => (150n * RAY * 12n * (x - T0)) / (10_000n * 31_536_000n);
      const start = BigInt(await now()) + 10n;
      let draw = 0n, then = 0n;
      for (let d = start; d < start + 20_000n && draw === 0n; d++) {
        for (let t = 2_335_990n; t < 2_336_010n; t++) {
          if ((usd(900) * (acc(d + t) - acc(d))) / RAY === usd(12)) { draw = d; then = d + t; break; }
        }
      }
      expect(draw).to.not.equal(0n);
      expect(Number(then)).to.be.lt(Number((await revolving.cycleStateOf(m)).cycleEnd));
      await at(Number(draw));
      await spend(c.ctx.member, usd(900));
      expect(await revolving.principalOf(m, INCOME)).to.equal(usd(900));
      const ref = ethers.id("plan");
      const [a, b] = await attesters(revolving);
      await wk.connect(a).proposeWorkout(m, PLAN, 12, 0, ref);
      await at(Number(then));
      await expect(wk.connect(b).approveWorkout(m, PLAN, 12, 0, ref))
        .to.emit(revolving, "WorkoutPlanStarted").withArgs(m, ref, usd(900), usd(12), 12, usd(76))
        .and.to.emit(revolving, "WorkoutBalanceMoved").withArgs(m, INCOME, usd(912));
      expect(await revolving.principalOf(m, INCOME)).to.equal(0n);
      expect(await revolving.principalOf(m, BOOST)).to.equal(0n);
      expect(await revolving.principalOf(m, WORKOUT)).to.equal(usd(912));
      const w = await wk.workoutStateOf(m);
      expect(w.planTotal).to.equal(usd(912));
      expect(w.planInstallment).to.equal(usd(76));
      // 0%: nothing accrues on it, and nothing unsecured can be drawn.
      await advance(20 * DAY);
      expect(await revolving.drawnOf(m, WORKOUT)).to.equal(usd(912));
      await expect(spend(c.ctx.member, usd(10))).to.be.revertedWithCustomError(revolving, "RevolvingIssuerDrawUnplaced");
      // The plan's position can never be priced or given a rate.
      await expect(revolving.connect(c.ctx.operator).setTierRate(WORKOUT, 10))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerWorkoutTerms");
      await expect(revolving.connect(c.ctx.operator).setTierProduct(WORKOUT, P("INCOME")))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerTierProductSet");
      // Twelve payments of $76, the last ending it.
      await c.ctx.usdc.connect(c.ctx.member).approve(await c.ctx.stableCredit.getAddress(), ethers.MaxUint256);
      for (let i = 0; i < 11; i++) await wk.connect(c.ctx.member).payWorkoutPlan(m, usd(76));
      expect((await wk.workoutPlanOf(m)).owed).to.equal(usd(76));
      await expect(wk.connect(c.ctx.member).payWorkoutPlan(m, usd(76))).to.emit(revolving, "WorkoutEnded").withArgs(m, PLAN);
      expect(await revolving.principalOf(m, WORKOUT)).to.equal(0n);
      expect(await c.ctx.stableCredit.creditBalanceOf(m)).to.equal(0n);
    });

    it("57. the workout plan's default follows 12.14's timing (60 days past due, a two-person notice, 30 days), held by a pause, and writes off only the plan's position", async function () {
      const m = c.ctx.member.address;
      await open(c.ctx.member, [0, 0, 1_000, 0], 0);
      await spend(c.ctx.member, usd(600));
      const ref = ethers.id("plan");
      await workout(m, PLAN, 6, 0n, ref);
      const total = (await wk.workoutStateOf(m)).planTotal;
      const [a, b] = await attesters(revolving);
      await expect(wk.connect(a).proposeWorkoutNotice(m)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerNothingDue");
      await passCycleEnd(revolving, m); // the first close under the plan
      await passCycleEnd(revolving, m); // its due point: the first installment is unpaid
      const pastDue = Number((await wk.workoutStateOf(m)).planPastDueSince);
      expect(pastDue).to.not.equal(0);
      await wk.connect(a).proposeWorkoutNotice(m);
      await expect(wk.connect(a).approveWorkoutNotice(m)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerSameSigner");
      const noticeAt = await stamp(wk.connect(b).approveWorkoutNotice(m));
      // A 2-day pause inside the 30 days lengthens them.
      await at(noticeAt + 5 * DAY);
      await c.clrusdPause.pauseAccount(m);
      await at(noticeAt + 7 * DAY);
      await c.clrusdPause.unpauseAccount(m);
      const end = Math.max(noticeAt + 32 * DAY, pastDue + 60 * DAY);
      await at(end - 1);
      await expect(wk.connect(c.ctx.outsider).declareWorkoutDefault(m))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPlanNotDefaultable");
      // A pause in force holds it too.
      await at(end);
      await c.vaultPause.pauseAll();
      await expect(wk.connect(c.ctx.outsider).declareWorkoutDefault(m))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPlanNotDefaultable");
      await c.vaultPause.unpauseAll();
      await advance(60);
      const lost = await c.ctx.stableCredit.lostDebt();
      await expect(wk.connect(c.ctx.outsider).declareWorkoutDefault(m))
        .to.emit(revolving, "WorkoutPlanDefaulted").withArgs(m, total);
      expect(await revolving.principalOf(m, WORKOUT)).to.equal(0n);
      expect((await c.ctx.stableCredit.lostDebt()) - lost).to.equal(total);
      // No default of the line is recorded: the Liquidator reaches nothing through it.
      expect(await revolving.hasDefaulted(m)).to.equal(false);
      expect(await revolving.inDefault(m)).to.equal(false);
      // Nor can the line's closing be recorded on it (Phase 2f, decision 37; owner decision 35 kept).
      await expect(wk.connect(a).proposeLineClosing(m)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
    });

    it("Combined Ceiling (decision 30): the plan's principal is not unsecured revolving principal", async function () {
      const m = c.ctx.member.address;
      await open(c.ctx.member, [0, 0, 1_000, 0], 0);
      await spend(c.ctx.member, usd(500));
      await workout(m, PLAN, 3, 0n, ethers.id("plan"));
      const inputs = await revolving.combinedInputsOf(m);
      expect(inputs[2]).to.equal(0n); // the revolving principal the ceiling counts
      expect(await wk.cflPrincipalOf(m)).to.equal(0n);
    });
  });
});

/* ───────────────────────── 12.14 with the pause clock (test 51) ───────────────────────── */

describe("ADDENDUM 4, 10c on term plans: test 51 and the installment rule", function () {
  let core: Awaited<ReturnType<typeof deployCore>>;
  let liquidator: any, clrusdPause: any, vaultPause: any, clock: any;

  beforeEach(async function () {
    core = await deployCore();
    const { ctx, term } = core;
    const PARTNER = P("PARTNER");
    const rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, PARTNER, params({ listMonthlyBps: 200 }), CA_BANDS);
    await term.connect(ctx.admin).setRateSchedule(await rates.getAddress());
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    await ctx.networkRegistry.attestStateCode(ctx.member.address, CA);
    await term.connect(ctx.operator).setTermLimit(ctx.member.address, usd(10_000));
    const u = await ctx.usdc.getAddress();
    liquidator = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"),
      [ctx.admin.address, await ctx.stableCredit.getAddress(), u, u, u, u], { kind: "uups" });
    await term.connect(ctx.operator).setHoldSource(await liquidator.getAddress());
    const Mock = await ethers.getContractFactory("MockPauseSource");
    clrusdPause = await Mock.deploy();
    vaultPause = await Mock.deploy();
    clock = await (await ethers.getContractFactory("PauseClock"))
      .deploy(await clrusdPause.getAddress(), await vaultPause.getAddress());
    await expect(liquidator.connect(ctx.outsider).setPauseClock(await clock.getAddress())).to.be.reverted;
    await liquidator.connect(ctx.admin).setPauseClock(await clock.getAddress());
    await expect(liquidator.connect(ctx.admin).setPauseClock(await clock.getAddress()))
      .to.be.revertedWithCustomError(liquidator, "LiquidatorPauseClockSet");
    const rate = await rates.effectiveMonthlyBps(CA, PARTNER, usd(1_000));
    await signedOpenPlan(term, ctx.operator, ctx.member.address, core.merchant.address, usd(1_000), usd(975), rate, CYCLE, 4, CYCLE, PARTNER);
  });

  async function secure(planId = 0) {
    const { term, ctx } = core;
    const { chainId } = await ethers.provider.getNetwork();
    const nonce = await term.planNonces(ctx.member.address);
    const sig = await ctx.member.signTypedData(
      { name: "Clear TermIssuer", version: "1", chainId, verifyingContract: await term.getAddress() },
      { SecurePlan: [{ name: "planId", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      { planId, nonce, deadline: ethers.MaxUint256 });
    await term.connect(ctx.operator).securePlanWithSignature(planId, ethers.MaxUint256, sig);
  }
  async function notice(planId = 0) {
    const [a, b] = await attesters(core.term);
    await core.term.connect(a).proposePlanNotice(planId);
    return stamp(core.term.connect(b).approvePlanNotice(planId));
  }

  it("51. a 4-day pause during the 30-day cure makes the trigger revert until 34 days after the timestamp", async function () {
    const { term, ctx } = core;
    const m = ctx.member.address;
    await secure();
    await advance(CYCLE + 61 * DAY);
    const T = await notice();
    await at(T + 10 * DAY);
    await clrusdPause.pauseAccount(m);
    await at(T + 14 * DAY);
    await clrusdPause.unpauseAccount(m);
    await at(T + 30 * DAY);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    await at(T + 34 * DAY - 1);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    await at(T + 34 * DAY);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.emit(term, "SecuredPlanDefaulted");
  });

  it("51. no 12.14 default while any pause affecting the member is in force, however late", async function () {
    const { term, ctx } = core;
    await secure();
    await advance(CYCLE + 61 * DAY);
    const T = await notice();
    await at(T + 40 * DAY);
    await vaultPause.pauseAll();
    await at(T + 41 * DAY);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    await vaultPause.unpauseAll();
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.emit(term, "SecuredPlanDefaulted");
  });

  it("owner decision 34: a pause that began after the plan fell behind and has already ended still pushes the installment default back by its length", async function () {
    const { term, ctx } = core;
    const m = ctx.member.address;
    await advance(CYCLE + DAY); // the first installment is a day late
    const since = Number(await term.delinquentSince(0));
    expect(since).to.be.gt(0);
    const before = Number(await term.defaultableAt(0));
    expect(before).to.equal(since + 2 * CYCLE); // DEFAULT_AFTER_INSTALLMENTS installments after it
    // A 6-day pause of the member's account, after the plan fell behind, long over by the deadline.
    await advance(10 * DAY);
    await clrusdPause.pauseAccount(m);
    await advance(6 * DAY);
    await clrusdPause.unpauseAccount(m);
    const paused = Number(await clock.pausedSeconds(m));
    expect(paused).to.be.gte(6 * DAY);
    const after = Number(await term.defaultableAt(0));
    expect(after).to.equal(before + paused);
    await at(before + DAY);
    await expect(term.connect(ctx.outsider).declareDefault(m)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    await at(after - 1);
    await expect(term.connect(ctx.outsider).declareDefault(m)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    await at(after);
    await expect(term.connect(ctx.outsider).declareDefault(m)).to.emit(term, "TermDefaulted");
  });

  it("owner decision 34: a payment that leaves the plan on time takes a new reading, so a pause while it was on time does not count against a later arrears", async function () {
    const { term, ctx } = core;
    const m = ctx.member.address;
    await clrusdPause.pauseAccount(m);
    await advance(3 * DAY);
    await clrusdPause.unpauseAccount(m); // paused while the plan was on time
    await advance(CYCLE);
    // Pay what is due: on time again, and the reading moves up to now.
    const due = (await term.scheduledPrincipalDue(0)) - (await term.planAt(0)).repaid;
    await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
    await term.connect(ctx.member).payPlan(0, due);
    expect(await term.delinquentSince(0)).to.equal(0n);
    await advance(CYCLE + DAY); // the next installment is missed
    const since = Number(await term.delinquentSince(0));
    expect(Number(await term.defaultableAt(0))).to.equal(since + 2 * CYCLE);
  });

  it("an unsecured plan's installment default is not declared while a pause is in force", async function () {
    const { term, ctx } = core;
    const m = ctx.member.address;
    await advance(3 * CYCLE + DAY);
    expect(await term.defaultableAt(0)).to.be.gt(0n);
    await clrusdPause.pauseAccount(m);
    await expect(term.connect(ctx.outsider).declareDefault(m)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    await clrusdPause.unpauseAccount(m);
    await term.connect(ctx.outsider).declareDefault(m);
    expect((await term.planAt(0)).closed).to.equal(true);
  });
});
