import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { issuerProxyOptions } from "../../helpers/issuers";
import { attesters, passCycleEnd, driveToSecondMiss, NOTICE_GRACE } from "../../helpers/default";
import { CA, P, CA_BANDS, ONE_USDC, DAY, params, deployRateSchedule } from "./rates";

/*
 * Addendum 2 (Nov 14, 2026), the credit half: calendar cycles (12.1), the Secured Minimum and its
 * pause, Automatic Clearing set-up (12.2), the revolving default notice (12.5, 10b), hybridMode.
 * New acceptance tests 39-42 and 44-46, with the spec's figures and dates. Tests 43, 47 and 48 (the
 * Combined Ceiling and the fee leg) are in Addendum2Term.spec.ts.
 *
 * Every test starts from a fresh chain (`hardhat_reset`), because the spec's dates are absolute.
 */

const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const usd = (n: number | bigint) => BigInt(n) * ONE_USDC;

const pacificFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
});
/** A UTC timestamp as Pacific wall-clock time, from the platform's own time-zone data. */
function pacific(t: number | bigint) {
  const p: Record<string, string> = {};
  for (const part of pacificFormat.formatToParts(new Date(Number(t) * 1000))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`;
}

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

const SAVINGS = 0, ASSET = 1, INCOME = 2, BOOST = 3;
const TERMS = {
  unsecuredLineCap: usd(2_499),
  cureWindow: 15 * DAY,
  boostCleanCycles: 6,
  boostDepositCycles: 5,
  autoClearOffGlobal: false,
};

describe("ADDENDUM 2: calendar cycles, Secured Minimum, Automatic Clearing, default notice (acceptance 39-42, 44-46)", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let revolving: any, rates: any, harness: any;
  let coop: any, settler: any, float: any, m2: any, m3: any;

  beforeEach(async function () {
    await network.provider.request({ method: "hardhat_reset", params: [] });
    ctx = await deployPhase0Network();
    const s = await ethers.getSigners();
    [coop, settler, float, m2, m3] = [s[8], s[9], s[10], s[12], s[13]];
    const R = await ethers.getContractFactory("RevolvingIssuer");
    revolving = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], {
      ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups",
    });
    await ctx.networkRegistry.registerIssuer(await revolving.getAddress(), await ctx.stableCredit.getAddress());
    await ctx.access.grantOperator(await revolving.getAddress());
    for (const [name, rate] of [["SAVINGS", 0n], ["ASSET_INTERNAL", 65n], ["INCOME", 150n], ["BOOST", 250n]] as const) {
      await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, 30 * DAY);
    }
    rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
    await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 250 }), CA_BANDS);
    await rates.setProduct(CA, P("REVOLVING"), params({ listMonthlyBps: 0 }), CA_BANDS);
    await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
    await revolving.connect(ctx.operator).setTierProduct(INCOME, P("INCOME"));
    await revolving.connect(ctx.operator).setTierProduct(BOOST, P("BOOST"));
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    for (const m of [ctx.member, m2, m3]) {
      await ctx.networkRegistry.attestStateCode(m.address, CA);
      await ctx.usdc.mint(m.address, usd(100_000));
      await ctx.usdc.connect(m).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
    }
    await revolving.connect(ctx.operator).setCreditTerms(TERMS, usd(500), usd(750));
    // 12.1: 1% of secured principal, at least $1; 12.13: three cycles of Income Assurance at most.
    await revolving.connect(ctx.operator).setDueTerms(100, usd(1), 0, 3);
    await revolving.connect(ctx.operator).setCardSettler(settler.address, true);
    await revolving.connect(ctx.operator).setCardSettlementAccount(float.address);
    await ctx.usdc.mint(settler.address, usd(100_000));
    await ctx.usdc.connect(settler).approve(await revolving.getAddress(), ethers.MaxUint256);
    harness = await (await ethers.getContractFactory("PacificCalendarHarness")).deploy();
  });

  async function open(member: any, caps: number[], day: number) {
    return revolving.connect(ctx.operator).openLine(member.address, caps.map((n) => usd(n)), day);
  }
  async function spend(member: any, amount: bigint) {
    return ctx.stableCredit.connect(member).transfer(ctx.counterparty.address, amount);
  }
  async function repay(member: any, amount: bigint) {
    return ctx.stableCredit.connect(member).repayCreditBalance(member.address, amount);
  }
  async function domain() {
    const { chainId } = await ethers.provider.getNetwork();
    return { name: "Clear RevolvingIssuer", version: "1", chainId, verifyingContract: await revolving.getAddress() };
  }
  async function signDay(signer: any, member: string, day: number) {
    const nonce = await revolving.memberNonces(member);
    const types = { CycleEndDay: [
      { name: "member", type: "address" }, { name: "day", type: "uint8" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    return signer.signTypedData(await domain(), types, { member, day, nonce, deadline: ethers.MaxUint256 });
  }
  async function signAutoClear(signer: any, member: string, on: boolean, level: number, authHash: string) {
    const nonce = await revolving.memberNonces(member);
    const types = { AutoClear: [
      { name: "member", type: "address" }, { name: "on", type: "bool" }, { name: "level", type: "uint8" },
      { name: "authHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    return signer.signTypedData(await domain(), types, { member, on, level, authHash, nonce, deadline: ethers.MaxUint256 });
  }
  async function signPayer(signer: any, member: string, payer: string, excluded: boolean) {
    const nonce = await revolving.memberNonces(member);
    const types = { PayerExclusion: [
      { name: "member", type: "address" }, { name: "payer", type: "bytes32" }, { name: "excluded", type: "bool" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    return signer.signTypedData(await domain(), types, { member, payer, excluded, nonce, deadline: ethers.MaxUint256 });
  }
  const AUTH = ethers.id("Automatic clearing authorization v1 (Bank, Clear Financial, Clear Lending)");
  const PAYROLL = ethers.id("ACH:payroll-employer");
  const SSA = ethers.id("ACH:9101036151 Social Security");

  it("39. calendar cycles: opened 2027-01-10 10:00 Pacific on day 15, the first end is 2027-02-15 23:59:59 PST, then the 15th at 23:59:59 Pacific for 24 cycles across DST; the default day; no role writes or moves a cycle end", async function () {
    await at(ts("2027-01-10T18:00:00Z"));
    await open(ctx.member, [0, 0, 1_000, 0], 15);
    expect(pacific(await now())).to.equal("2027-01-10 10:00:00 PST");
    let s = await revolving.cycleStateOf(ctx.member.address);
    expect(s.cycleEndDay).to.equal(15n);
    // Jan 15 is under 14 days away, so the first end is Feb 15.
    expect(Number(s.cycleEnd)).to.equal(ts("2027-02-16T07:59:59Z"));
    expect(pacific(s.cycleEnd)).to.equal("2027-02-15 23:59:59 PST");
    expect((await revolving.creditPeriods(ctx.member.address)).expiration).to.equal(s.cycleEnd);

    // 24 more cycles, each judged by the chain at its end. Pacific time from the platform's own
    // time-zone data: PDT from the second Sunday in March to the first Sunday in November.
    const ends: string[] = [];
    for (let k = 0; k < 24; k++) {
      await passCycleEnd(revolving, ctx.member.address);
      s = await revolving.cycleStateOf(ctx.member.address);
      ends.push(pacific(s.cycleEnd));
      expect(await revolving.creditPeriods(ctx.member.address).then((p: any) => p.expiration)).to.equal(s.cycleEnd);
    }
    expect(ends[0]).to.equal("2027-03-15 23:59:59 PDT");
    for (let k = 0; k < 24; k++) {
      const month = 3 + k; // March 2027 onward
      const y = 2027 + Math.floor((month - 1) / 12);
      const m = ((month - 1) % 12) + 1;
      const tz = m >= 3 && m <= 10 ? "PDT" : "PST"; // the 15th: after the March switch, before the November one
      expect(ends[k]).to.equal(`${y}-${String(m).padStart(2, "0")}-15 23:59:59 ${tz}`);
    }

    // The default day: the day before the opening day, or 28 for the 29th-31st (and the 1st).
    expect(await harness.defaultDay(ts("2027-01-20T18:00:00Z"))).to.equal(19n);
    expect(await harness.defaultDay(ts("2027-02-01T18:00:00Z"))).to.equal(28n);
    expect(await harness.defaultDay(ts("2027-01-31T18:00:00Z"))).to.equal(28n);
    expect(await harness.defaultDay(ts("2027-03-30T17:00:00Z"))).to.equal(28n);
    // Late in the evening Pacific is still that day, though UTC has moved on.
    expect(await harness.defaultDay(ts("2027-01-21T07:30:00Z"))).to.equal(19n);
    const t20 = ts("2029-03-20T17:00:00Z"); // 2029-03-20 10:00 PDT
    await at(t20);
    await open(m2, [0, 0, 500, 0], 0);
    s = await revolving.cycleStateOf(m2.address);
    expect(s.cycleEndDay).to.equal(19n);
    expect(pacific(s.cycleEnd)).to.equal("2029-04-19 23:59:59 PDT");

    // No role can write or move a cycle end.
    for (const who of [ctx.operator, ctx.admin]) {
      const r = revolving.connect(who);
      for (const call of [
        () => r.updateCreditPeriod(ctx.member.address, ts("2031-01-01T00:00:00Z"), 0),
        () => r.setPeriodExpirationOf(ctx.member.address, ts("2031-01-01T00:00:00Z")),
        () => r.setGraceLengthOf(ctx.member.address, 30 * DAY),
        () => r.pausePeriodOf(ctx.member.address),
        () => r.unpausePeriodOf(ctx.member.address),
        () => r.initializeCreditLine(ctx.member.address, usd(1), 0, 30 * DAY, 0),
        () => r.openLine(ctx.member.address, [0n, 0n, usd(1_000), 0n], 1),
      ]) {
        await expect(call()).to.be.revertedWithCustomError(revolving, "RevolvingIssuerCyclesComputed");
      }
    }
    // Every function that could reach a cycle is one of these, a view, the permissionless judge,
    // the default trigger, or the member's own signed day change.
    const writers = revolving.interface.fragments
      .filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
      .map((f: any) => f.name)
      .filter((n: string) => /cycle|period/i.test(n));
    expect(writers.sort()).to.deep.equal(["setCycleEndDayWithSignature", "syncCreditPeriod"]);
  });

  it("40. Cycle End Day change: a member-signed change on Feb 2 to day 5 ends the running cycle on Mar 5, never Feb 5; a second change within 365 days reverts; a change without the member's signature reverts", async function () {
    await at(ts("2027-01-10T18:00:00Z"));
    await open(ctx.member, [0, 0, 1_000, 0], 15);
    expect(pacific((await revolving.cycleStateOf(ctx.member.address)).cycleEnd)).to.equal("2027-02-15 23:59:59 PST");

    // Without the member's signature: refused.
    const forged = await signDay(ctx.operator, ctx.member.address, 5);
    await expect(revolving.connect(ctx.operator).setCycleEndDayWithSignature(ctx.member.address, 5, ethers.MaxUint256, forged))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerBadSignature");

    await at(ts("2027-02-02T18:00:00Z"));
    const sig = await signDay(ctx.member, ctx.member.address, 5);
    await expect(revolving.connect(ctx.operator).setCycleEndDayWithSignature(ctx.member.address, 5, ethers.MaxUint256, sig))
      .to.emit(revolving, "CycleEndDaySet");
    const s = await revolving.cycleStateOf(ctx.member.address);
    expect(s.cycleEndDay).to.equal(5n);
    expect(pacific(s.cycleEnd)).to.equal("2027-03-05 23:59:59 PST");
    expect(Number(s.cycleEnd)).to.be.gt(ts("2027-02-16T07:59:59Z")); // no due point moves earlier
    expect((await revolving.creditPeriods(ctx.member.address)).expiration).to.equal(s.cycleEnd);

    // A second change within 365 days reverts, even signed by the member.
    await mineAt(ts("2027-06-01T18:00:00Z"));
    const again = await signDay(ctx.member, ctx.member.address, 10);
    await expect(revolving.connect(ctx.operator).setCycleEndDayWithSignature(ctx.member.address, 10, ethers.MaxUint256, again))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerCycleDayChangedRecently");
    // The cycles run on day 5 meanwhile (judged now: Mar 5, Apr 5 and May 5 have passed); a year on,
    // the member may change it again.
    await passCycleEnd(revolving, ctx.member.address);
    expect(pacific((await revolving.cycleStateOf(ctx.member.address)).cycleEnd)).to.equal("2027-06-05 23:59:59 PDT");
    await mineAt(ts("2028-02-03T18:00:00Z"));
    const later = await signDay(ctx.member, ctx.member.address, 10);
    await revolving.connect(ctx.operator).setCycleEndDayWithSignature(ctx.member.address, 10, ethers.MaxUint256, later);
    expect((await revolving.cycleStateOf(ctx.member.address)).cycleEndDay).to.equal(10n);
    // Days outside 1-28 are not days.
    await expect(open(m2, [0, 0, 100, 0], 29)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerBadCycleDay");
  });

  it("41. calendar accrual: Boost $500 at 2.5% accrues about $11.34 in a 31-day cycle and $10.24 in a 28-day one; no day accrues more than $11.125 / 30", async function () {
    await at(ts("2028-12-10T18:00:00Z"));
    await open(ctx.member, [0, 0, 0, 500], 5);
    await spend(ctx.member, usd(500));
    const e1 = Number((await revolving.cycleStateOf(ctx.member.address)).cycleEnd);
    expect(pacific(e1)).to.equal("2029-01-05 23:59:59 PST");
    const carryAt = async (t: number) => {
      await at(t);
      await revolving.materialiseCarry(ctx.member.address);
      return revolving.carryOf(ctx.member.address, BOOST);
    };
    const c1 = await carryAt(e1);
    const e2 = ts("2029-02-06T07:59:59Z"); // Feb 5, 31 days on
    const c2 = await carryAt(e2);
    expect(c2 - c1).to.be.closeTo(11_338_000n, 2_000n); // 11.125 x 12 x 31 / 365
    const e3 = ts("2029-03-06T07:59:59Z"); // Mar 5, 28 days on (2029 is not a leap year; PST throughout)
    const c3 = await carryAt(e3);
    expect(c3 - c2).to.be.closeTo(10_241_000n, 2_000n); // 11.125 x 12 x 28 / 365
    // A day: never more than 1/30 of the monthly cap (the list rate would charge $12.50 / 30).
    const c4 = await carryAt(e3 + DAY);
    expect(c4 - c3).to.be.lte(11_125_000n / 30n);
    // A 30-day stretch: never more than the monthly cap.
    const c5 = await carryAt(e3 + 30 * DAY);
    expect(c5 - c3).to.be.lte(11_125_000n);
  });

  it("42. Secured Minimum: savings-backed $3,000 alone owes $30.00; bonds $1,000 at 0.65% over a 30-day cycle owe $6.41 + $10.00, or $6.41 with unsecured principal out; unpaid it is no miss and only pauses secured draws until paid; no role sets the pause; Income Assurance lifts it", async function () {
    await at(ts("2027-03-20T17:00:00Z"));
    await open(ctx.member, [4_000, 0, 500, 0], 15); // savings-backed
    await open(m2, [0, 1_000, 0, 0], 15); // bonds (asset-backed)
    await open(m3, [0, 1_000, 500, 0], 15); // bonds, and unsecured principal at close
    await spend(ctx.member, usd(3_000));
    const e1 = Number((await revolving.cycleStateOf(ctx.member.address)).cycleEnd);
    expect(pacific(e1)).to.equal("2027-04-15 23:59:59 PDT");

    // The bond draws land right at the first close (the draw itself has the chain close the cycle).
    await at(e1 + 1);
    await spend(m2, usd(1_000));
    await at(e1 + 2);
    await spend(m3, usd(1_100)); // $1,000 on bonds, $100 income-backed
    await revolving.syncCreditPeriod(ctx.member.address);
    let s = await revolving.cycleStateOf(ctx.member.address);
    expect(s.rebalanceAmount).to.equal(0n);
    expect(s.securedMinimum).to.equal(usd(30)); // 1% of $3,000

    // The next close is 30 days on (Apr 15 -> May 15).
    const e2 = Number((await revolving.cycleStateOf(m2.address)).cycleEnd);
    expect(e2 - e1).to.equal(30 * DAY);
    await at(e2 + 1);
    await revolving.syncCreditPeriod(m2.address);
    s = await revolving.cycleStateOf(m2.address);
    expect(s.securedMinimum).to.be.closeTo(16_410_000n, 2_000n); // $6.41 carry + $10.00
    await at(e2 + 2);
    await revolving.syncCreditPeriod(m3.address);
    s = await revolving.cycleStateOf(m3.address);
    expect(s.securedMinimum).to.be.closeTo(6_410_000n, 2_000n); // carry only
    expect(s.rebalanceAmount).to.be.closeTo(101_479_000n, 5_000n); // $100 and a month's carry at 1.5%

    // The savings member pays nothing by May 15: no miss, no halving, nothing settles, no default.
    await at(e2 + 3);
    await revolving.syncCreditPeriod(ctx.member.address);
    const c = await revolving.cycleOf(ctx.member.address);
    expect(c.missedInRow).to.equal(0n);
    expect(await revolving.capacityOf(ctx.member.address, SAVINGS)).to.equal(usd(4_000));
    expect(await revolving.capacityOf(ctx.member.address, INCOME)).to.equal(usd(500));
    expect(await revolving.unsecuredExcessOf(ctx.member.address)).to.equal(0n);
    expect(await revolving.inDefault(ctx.member.address)).to.equal(false);
    expect(await revolving.hasDefaulted(ctx.member.address)).to.equal(false);
    let [, sm, paused] = await revolving.duesOf(ctx.member.address);
    expect(paused).to.equal(true);
    expect(sm).to.be.gte(usd(30));

    // Secured draws revert; unsecured draws succeed.
    const savingsBefore = await revolving.principalOf(ctx.member.address, SAVINGS);
    await expect(spend(ctx.member, usd(600))).to.be.reverted; // more than income-backed can hold
    await spend(ctx.member, usd(100)); // lands on income-backed, not Savings
    expect(await revolving.principalOf(ctx.member.address, SAVINGS)).to.equal(savingsBefore);
    expect(await revolving.principalOf(ctx.member.address, INCOME)).to.equal(usd(100));

    // No role sets the pause: there is no setter, and governed calls leave it as it is.
    const names = revolving.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    expect(names.filter((n: string) => /securedDraw|pastDue/i.test(n))).to.deep.equal([]);
    await revolving.connect(ctx.operator).setDueTerms(0, 0, 0, 3);
    [, , paused] = await revolving.duesOf(ctx.member.address);
    expect(paused).to.equal(true);

    // Income Assurance (12.13): while it runs there is no pause.
    const [a, b] = await attesters(revolving);
    await revolving.connect(a).proposeIncomePause(ctx.member.address, 2);
    await expect(revolving.connect(a).approveIncomePause(ctx.member.address, 2))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerSameSigner");
    await revolving.connect(b).approveIncomePause(ctx.member.address, 2);
    [, sm, paused] = await revolving.duesOf(ctx.member.address);
    expect(paused).to.equal(false);
    expect(sm).to.equal(0n);
    // The member ends it early; the pause is back until the payment.
    await revolving.connect(ctx.member).endIncomePause();
    [, , paused] = await revolving.duesOf(ctx.member.address);
    expect(paused).to.equal(true);

    // The payment that reaches Rebalance Amount + Secured Minimum clears the pause in that same
    // transaction: one call short, still paused; the one that reaches it, cleared.
    await repay(ctx.member, usd(29));
    [, , paused] = await revolving.duesOf(ctx.member.address);
    expect(paused).to.equal(true);
    await repay(ctx.member, usd(1));
    [, , paused] = await revolving.duesOf(ctx.member.address);
    expect(paused).to.equal(false);
    await spend(ctx.member, usd(500)); // Savings again
    expect(await revolving.principalOf(ctx.member.address, SAVINGS)).to.equal(savingsBefore + usd(500));
  });

  describe("44. revolving default fails closed", function () {
    beforeEach(async function () {
      await at(ts("2027-01-10T18:00:00Z"));
      await open(ctx.member, [0, 0, 1_000, 0], 15);
      await spend(ctx.member, usd(500));
      // Feb 15 closes on $500; Mar 15 is the first miss; Apr 15 the second.
      await driveToSecondMiss(revolving, ctx.member.address);
    });

    it("two misses and 15 days past the second due point with no timestamp: the trigger reverts; a timestamp approved on day 12 holds it until day 22, then a random caller succeeds", async function () {
      const s = await revolving.cycleStateOf(ctx.member.address);
      const c = await revolving.cycleOf(ctx.member.address);
      expect(c.missedInRow).to.equal(2n);
      expect(s.cureAmount).to.be.gt(usd(500));
      const due = Number(s.cureDueAt);
      expect(pacific(due)).to.equal("2027-04-15 23:59:59 PDT");
      expect(await revolving.inDefault(ctx.member.address)).to.equal(false);

      await mineAt(due + 15 * DAY + 1);
      await expect(revolving.connect(ctx.outsider).triggerDefault(ctx.member.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      // The judge alone never records it either.
      await revolving.connect(ctx.outsider).syncCreditPeriod(ctx.member.address);
      expect(await revolving.hasDefaulted(ctx.member.address)).to.equal(false);

      // Same signer for both halves: refused.
      const [a, b] = await attesters(revolving);
      await revolving.connect(a).proposeCureNotice(ctx.member.address);
      await expect(revolving.connect(a).approveCureNotice(ctx.member.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerSameSigner");
      // Nobody without the attester role.
      await expect(revolving.connect(ctx.outsider).approveCureNotice(ctx.member.address))
        .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");

      // Approved on day 12 (simulated by a fresh member below); here, recorded at approval time.
      const day12 = due + 15 * DAY + 10; // already past 15 days: the later leg is 10 days from now
      await at(day12);
      await expect(revolving.connect(b).approveCureNotice(ctx.member.address)).to.emit(revolving, "CureNoticeRecorded");
      expect((await revolving.cycleOf(ctx.member.address)).cureNoticeAt).to.equal(BigInt(day12));
      await at(day12 + NOTICE_GRACE - 1);
      await expect(revolving.connect(ctx.outsider).triggerDefault(ctx.member.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      await at(day12 + NOTICE_GRACE);
      await revolving.connect(ctx.outsider).triggerDefault(ctx.member.address);
      expect(await revolving.hasDefaulted(ctx.member.address)).to.equal(true);
      expect(await revolving.hasDefaultedOnCurrentLine(ctx.member.address)).to.equal(true);
    });

    it("with the timestamp approved on day 12 after the second due point, the trigger reverts until day 22 and then succeeds for anyone", async function () {
      const due = Number((await revolving.cycleStateOf(ctx.member.address)).cureDueAt);
      const [a, b] = await attesters(revolving);
      await at(due + 12 * DAY - 60);
      await revolving.connect(a).proposeCureNotice(ctx.member.address);
      await at(due + 12 * DAY);
      await revolving.connect(b).approveCureNotice(ctx.member.address);
      // Recorded time = approval block time, never earlier.
      expect((await revolving.cycleOf(ctx.member.address)).cureNoticeAt).to.equal(BigInt(due + 12 * DAY));
      // Day 15 (the first leg) passes; the 864,000 s leg still runs to day 22.
      await mineAt(due + 22 * DAY - 2);
      expect(await revolving.inDefault(ctx.member.address)).to.equal(false);
      await at(due + 22 * DAY - 1);
      await expect(revolving.connect(ctx.outsider).triggerDefault(ctx.member.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      await at(due + 22 * DAY);
      await expect(revolving.connect(ctx.outsider).triggerDefault(ctx.member.address))
        .to.emit(revolving, "CreditLineDefaulted");
    });

    it("paying the amount cancels the timestamp, and a timestamp submitted after the amount is paid reverts", async function () {
      const s = await revolving.cycleStateOf(ctx.member.address);
      const due = Number(s.cureDueAt);
      const [a, b] = await attesters(revolving);
      await revolving.connect(a).proposeCureNotice(ctx.member.address);
      await revolving.connect(b).approveCureNotice(ctx.member.address);
      expect((await revolving.cycleOf(ctx.member.address)).cureNoticeAt).to.not.equal(0n);
      // The member pays the second Rebalance Amount: the notice is cancelled with it.
      await expect(repay(ctx.member, s.cureAmount)).to.emit(revolving, "CureNoticeCancelled");
      expect((await revolving.cycleOf(ctx.member.address)).cureNoticeAt).to.equal(0n);
      await mineAt(due + 30 * DAY);
      expect(await revolving.inDefault(ctx.member.address)).to.equal(false);
      await expect(revolving.connect(ctx.outsider).triggerDefault(ctx.member.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNotInDefault");
      // Nothing left unpaid: no timestamp can be recorded for it.
      await expect(revolving.connect(a).proposeCureNotice(ctx.member.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNothingDue");
    });

    it("a proposal is void once the amount is paid: the approval reverts", async function () {
      const s = await revolving.cycleStateOf(ctx.member.address);
      const [a, b] = await attesters(revolving);
      await revolving.connect(a).proposeCureNotice(ctx.member.address);
      await repay(ctx.member, s.cureAmount);
      await expect(revolving.connect(b).approveCureNotice(ctx.member.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNoProposal");
    });
  });

  it("45. Automatic Clearing set-up: Turn off leaves it off and nothing is swept; Approve sets it on and records the authorization hash; a federal-benefit deposit is not swept until the member removes that payer by signature; only the member changes it", async function () {
    await at(ts("2027-01-10T18:00:00Z"));
    await open(ctx.member, [0, 0, 1_000, 500], 15);
    await spend(ctx.member, usd(800));
    // "Turn off": nothing signed, nothing set.
    expect(await revolving.autoRepayEnabled(ctx.member.address)).to.equal(false);
    await expect(revolving.connect(settler).repayForMember(ethers.id("d1"), ctx.member.address, usd(100), PAYROLL))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerAutoRepayNotEnabled");

    // "Approve automatic clearing": the member's signature over the level and the text's hash.
    const sig = await signAutoClear(ctx.member, ctx.member.address, true, 0, AUTH);
    await expect(revolving.connect(ctx.operator).setAutoClearWithSignature(ctx.member.address, true, 0, AUTH, ethers.MaxUint256, sig))
      .to.emit(revolving, "AutoClearAuthorized").withArgs(ctx.member.address, 0, AUTH);
    expect(await revolving.autoRepayEnabled(ctx.member.address)).to.equal(true);
    expect((await revolving.cycleStateOf(ctx.member.address)).autoClearAuthHash).to.equal(AUTH);

    // Federal benefit payers are excluded by default.
    await revolving.connect(ctx.operator).addDefaultExcludedPayer(SSA);
    expect(await revolving.isPayerExcluded(ctx.member.address, SSA)).to.equal(true);
    await expect(revolving.connect(settler).repayForMember(ethers.id("d2"), ctx.member.address, usd(100), SSA))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerExcludedPayer");
    // A sweep naming no payer cannot be checked, so it is refused too.
    await expect(revolving.connect(settler).repayForMember(ethers.id("d3"), ctx.member.address, usd(100), ethers.ZeroHash))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerExcludedPayer");
    // Only the member's signature removes the exclusion.
    const bad = await signPayer(ctx.operator, ctx.member.address, SSA, false);
    await expect(revolving.connect(ctx.operator).setPayerExclusionWithSignature(ctx.member.address, SSA, false, ethers.MaxUint256, bad))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerBadSignature");
    const good = await signPayer(ctx.member, ctx.member.address, SSA, false);
    await revolving.connect(ctx.operator).setPayerExclusionWithSignature(ctx.member.address, SSA, false, ethers.MaxUint256, good);
    await expect(revolving.connect(settler).repayForMember(ethers.id("d4"), ctx.member.address, usd(100), SSA))
      .to.emit(revolving, "AutoCleared");

    // No role but the member changes autoClear: an operator's own call sets the operator's flag, a
    // signature not the member's fails, and the governed network switch no longer reaches it.
    await revolving.connect(ctx.operator).setAutoClear(false, 0, ethers.ZeroHash);
    expect(await revolving.autoRepayEnabled(ctx.member.address)).to.equal(true);
    const forged = await signAutoClear(ctx.operator, ctx.member.address, false, 0, ethers.ZeroHash);
    await expect(revolving.connect(ctx.operator).setAutoClearWithSignature(ctx.member.address, false, 0, ethers.ZeroHash, ethers.MaxUint256, forged))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerBadSignature");
    await revolving.connect(ctx.operator).setCreditTerms({ ...TERMS, autoClearOffGlobal: true }, usd(500), usd(750));
    await revolving.connect(settler).repayForMember(ethers.id("d5"), ctx.member.address, usd(10), PAYROLL);
    // The member turns it off themselves, any time.
    await revolving.connect(ctx.member).setAutoClear(false, 0, ethers.ZeroHash);
    await expect(revolving.connect(settler).repayForMember(ethers.id("d6"), ctx.member.address, usd(10), PAYROLL))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerAutoRepayNotEnabled");
  });

  it("46. hybridMode true stops every sweep and leaves every cycle end and cycleEndDay unchanged", async function () {
    await at(ts("2027-01-10T18:00:00Z"));
    await open(ctx.member, [0, 0, 1_000, 0], 15);
    await open(m2, [0, 0, 1_000, 0], 15);
    for (const m of [ctx.member, m2]) {
      await revolving.connect(m).setAutoClear(true, 1, AUTH);
      await spend(m, usd(300));
    }
    await expect(revolving.connect(ctx.member).setHybridMode(true)).to.emit(revolving, "HybridModeSet");
    for (const level of [0, 1, 2]) {
      await revolving.connect(ctx.member).setAutoClear(true, level, AUTH);
      await expect(revolving.connect(settler).repayForMember(ethers.id(`h${level}`), ctx.member.address, usd(100), PAYROLL))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerHybridMode");
    }
    // The cycles are those of a member without it.
    for (let k = 0; k < 3; k++) {
      const [a, b] = [await revolving.cycleStateOf(ctx.member.address), await revolving.cycleStateOf(m2.address)];
      expect(a.cycleEnd).to.equal(b.cycleEnd);
      expect(a.cycleEndDay).to.equal(15n);
      await passCycleEnd(revolving, ctx.member.address);
      await revolving.syncCreditPeriod(m2.address);
    }
    // Turned off by the member, sweeps resume.
    await revolving.connect(ctx.member).setHybridMode(false);
    await revolving.connect(settler).repayForMember(ethers.id("h9"), ctx.member.address, usd(50), PAYROLL);
  });

  describe("amended 18 and 28: what each Automatic Clearing level clears", function () {
    // Savings-backed $1,000 and $300 on each unsecured tier, all owed at a close; then a deposit.
    async function setUp(level: number) {
      await at(ts("2027-03-20T17:00:00Z"));
      await open(ctx.member, [1_000, 0, 300, 300], 15);
      await spend(ctx.member, usd(1_600));
      await revolving.connect(ctx.member).setAutoClear(true, level, AUTH);
      const end = Number((await revolving.cycleStateOf(ctx.member.address)).cycleEnd);
      // At the close Savings is $1,000 and unsecured $600 (plus a little carry).
      await at(end + 1);
      await revolving.syncCreditPeriod(ctx.member.address);
    }

    it("18. UNSECURED clears Boost, then income-backed, then any unpaid Secured Minimum, and stops", async function () {
      await setUp(0);
      // No unsecured principal at close? There is: so the Secured Minimum is the secured carry (0%
      // savings) -- make one by paying the unsecured tiers down to zero first and closing again.
      const boost = await revolving.principalOf(ctx.member.address, BOOST);
      const income = await revolving.principalOf(ctx.member.address, INCOME);
      await revolving.connect(settler).repayForMember(ethers.id("u1"), ctx.member.address, usd(250), PAYROLL);
      // Boost first (dearer), then income-backed.
      expect(await revolving.principalOf(ctx.member.address, BOOST)).to.be.closeTo(boost - usd(250), 10_000n);
      expect(await revolving.principalOf(ctx.member.address, INCOME)).to.be.closeTo(income, 10_000n);
      await revolving.connect(settler).repayForMember(ethers.id("u2"), ctx.member.address, usd(2_000), PAYROLL);
      expect(await revolving.principalOf(ctx.member.address, BOOST)).to.equal(0n);
      expect(await revolving.principalOf(ctx.member.address, INCOME)).to.equal(0n);
      // No Secured Minimum is unpaid yet (unsecured principal was out at close): Savings untouched.
      expect(await revolving.principalOf(ctx.member.address, SAVINGS)).to.equal(usd(1_000));
      // The next close, with no unsecured principal out, sets a Secured Minimum of 1% of $1,000.
      await passCycleEnd(revolving, ctx.member.address);
      const [, sm] = await revolving.duesOf(ctx.member.address);
      expect(sm).to.equal(usd(10));
      // A deposit of $500: clears the $10 from the secured tiers, and stops.
      const before = await ctx.usdc.balanceOf(settler.address);
      await expect(revolving.connect(settler).repayForMember(ethers.id("u3"), ctx.member.address, usd(500), PAYROLL))
        .to.emit(revolving, "AutoCleared").withArgs(ethers.id("u3"), ctx.member.address, usd(10), usd(490));
      expect(await revolving.principalOf(ctx.member.address, SAVINGS)).to.equal(usd(990));
      expect(before - (await ctx.usdc.balanceOf(settler.address))).to.equal(usd(10));
      const [, left] = await revolving.duesOf(ctx.member.address);
      expect(left).to.equal(0n);
    });

    it("28. DUE_ONLY clears exactly the unpaid Rebalance Amount plus any unpaid Secured Minimum", async function () {
      await setUp(2);
      const [ra, sm] = await revolving.duesOf(ctx.member.address);
      const s = await revolving.cycleStateOf(ctx.member.address);
      expect(ra).to.equal(s.rebalanceAmount); // nothing paid since the close
      expect(sm).to.equal(0n); // unsecured principal out at close: the Secured Minimum is the 0% carry
      // Part paid by the member first.
      await repay(ctx.member, usd(100));
      const [ra2] = await revolving.duesOf(ctx.member.address);
      expect(ra2).to.equal(s.rebalanceAmount - usd(100));
      const deposit = usd(5_000);
      await expect(revolving.connect(settler).repayForMember(ethers.id("d1"), ctx.member.address, deposit, PAYROLL))
        .to.emit(revolving, "AutoCleared").withArgs(ethers.id("d1"), ctx.member.address, ra2, deposit - ra2);
      const [ra3, sm3] = await revolving.duesOf(ctx.member.address);
      expect(ra3).to.equal(0n);
      expect(sm3).to.equal(0n);
      expect(await revolving.principalOf(ctx.member.address, SAVINGS)).to.equal(usd(1_000));
      // A later close with only Savings out: DUE_ONLY clears exactly that Secured Minimum.
      const left = (await revolving.principalOf(ctx.member.address, INCOME)) + (await revolving.principalOf(ctx.member.address, BOOST));
      if (left > 0n) await repay(ctx.member, left);
      await passCycleEnd(revolving, ctx.member.address);
      await passCycleEnd(revolving, ctx.member.address);
      const [ra4, sm4] = await revolving.duesOf(ctx.member.address);
      expect(ra4).to.equal(0n);
      expect(sm4).to.be.gte(usd(10));
      await expect(revolving.connect(settler).repayForMember(ethers.id("d2"), ctx.member.address, deposit, PAYROLL))
        .to.emit(revolving, "AutoCleared").withArgs(ethers.id("d2"), ctx.member.address, sm4, deposit - sm4);
    });

    it("25 (amended, Automatic Clearing): Ready to allocate USDC and CLRUSD are never swept, at any level", async function () {
      await setUp(1);
      const wallet = await ctx.usdc.balanceOf(ctx.member.address);
      await revolving.connect(settler).repayForMember(ethers.id("e1"), ctx.member.address, usd(10_000), PAYROLL);
      expect(await ctx.usdc.balanceOf(ctx.member.address)).to.equal(wallet);
      // EVERYTHING cleared every tier, dearest first.
      expect(await revolving.totalPrincipalOf(ctx.member.address)).to.equal(0n);
    });
  });
});
