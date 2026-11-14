import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCore } from "../deep/deep-setup";
import { prng } from "../deep/fuzz-engine";
import { signedOpenPlan } from "../../helpers/plans";
import { CA, NY, P, CA_BANDS, ONE_USDC, CYCLE, DAY, params, deployRateSchedule } from "../compliance/rates";

/*
 * Phase 4, step 3: the invariant fuzz extended to Phase 2's accrual, with Phase 2b's levelled term
 * schedule, the member-level ceiling and CFL aggregation (DECISIONS #7) all switched on.
 *
 * A seeded random sequence of member, operator, keeper and governance calls runs against a
 * RevolvingIssuer (INCOME and BOOST priced from a RateSchedule, a REVOLVING ceiling product) and a
 * TermIssuer (PARTNER and CASH products), with both issuers aggregated for the cap. After every
 * step, time moves and every position is materialised; the carry each one booked over that
 * interval is checked against an independent off-chain computation of the legal bound:
 *
 *  (a) revolving: the unsecured tiers together never above the graduated (or, from the threshold,
 *      annual) cap on their principal, nor above their pro-rata share of the cap on the member's
 *      aggregate principal, at monthly x 12 / 365 per second; each tier never above its list rate;
 *  (b) term: each plan never above its list rate per 30-day cycle, the graduated cap per 30-day
 *      cycle on its principal and its share of the aggregate's, and never above annualCapBps a year
 *      once the plan or the aggregate is a large loan (M-D);
 *  (c) a free plan never accrues;
 *  (d) no call ever fails with a panic (arithmetic, array bounds): the M-B class of bug;
 *  (e) an unsigned operator re-split never shortens a plan or adds arrears (H-B);
 *  (f) a revolving cycle judged while the member owes nothing on the revolving line is never a
 *      miss (H-C);
 *  (g) the ledger equals revolving plus term principal for a member no refund has touched.
 *
 * Governance changes mid-run: a member is re-attested to a state with no products, and that
 * state's products launch later (M-B).
 */
const STEPS = Number(process.env.FUZZ_STEPS ?? 300);
const PARTNER = P("PARTNER");
const CASH = P("CASH");
const INCOME_T = 2;
const BOOST_T = 3;
const YEAR = 365n * 86_400n;
const MONTH30 = 30n * 86_400n;
const THRESHOLD = 2_500n * ONE_USDC;
const ANNUAL = 3_650n;
const EPS = 10n;

/** The graduated monthly charge on `x` (CA bands), in token units. */
function graduated(x: bigint): bigint {
  let lower = 0n, total = 0n;
  for (const b of CA_BANDS) {
    if (lower >= x) break;
    const upper = b.upperBound;
    const part = (x < upper ? x : upper) - lower;
    total += part * BigInt(b.monthlyBps);
    lower = upper;
  }
  return total / 10_000n;
}
const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

/** Revolving cap over dt seconds on principal x: monthly x 12 / 365 per second, or annual from the threshold. */
function revCap(x: bigint, dt: bigint) {
  return x >= THRESHOLD ? (x * ANNUAL * dt) / (10_000n * YEAR) : (graduated(x) * 12n * dt) / YEAR;
}
/** Term cap over dt: the monthly figure per 30-day cycle, or annual from the threshold. */
function termCap(x: bigint, dt: bigint) {
  return x >= THRESHOLD ? (x * ANNUAL * dt) / (10_000n * YEAR) : (graduated(x) * dt) / MONTH30;
}

async function setup() {
  const core = await deployCore();
  const { ctx, revolving, term, member2, member3 } = core;
  const rates = await deployRateSchedule(ctx.admin.address);
  const prods: [string, string, number][] = [["INCOME", "INCOME", 150], ["BOOST", "BOOST", 300], ["REVOLVING", "REVOLVING", 0]];
  for (const [, name, list] of prods) await rates.setProduct(CA, P(name), params({ listMonthlyBps: list }), CA_BANDS);
  await rates.setProduct(CA, PARTNER, params({ listMonthlyBps: 200, freeBelowAmount: 100n * ONE_USDC }), CA_BANDS);
  await rates.setProduct(CA, CASH, params({ listMonthlyBps: 250 }), CA_BANDS);
  await rates.setCflSources([await revolving.getAddress(), await term.getAddress()]);
  await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
  await revolving.connect(ctx.operator).setTierProduct(INCOME_T, P("INCOME"));
  await revolving.connect(ctx.operator).setTierProduct(BOOST_T, P("BOOST"));
  await term.connect(ctx.admin).setRateSchedule(await rates.getAddress());
  await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
  const members = [ctx.member, member2, member3];
  for (const m of members) {
    await ctx.networkRegistry.attestStateCode(m.address, CA);
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 1_000n * ONE_USDC, 500n * ONE_USDC], 0);
    await term.connect(ctx.operator).setTermLimit(m.address, 10_000n * ONE_USDC);
  }
  return { ...core, rates, members };
}

async function runAccrualFuzz(seed: number) {
  const e: any = await setup();
  const { ctx, revolving, term, rates, members, merchant, coop } = e;
  const sc = ctx.stableCredit;
  const rnd = prng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const amt = (maxUsd: number) => BigInt(Math.floor(rnd() * maxUsd * 1_000_000)) + 1n;

  const breaks: string[] = [];
  const reverts: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const plans: number[] = [];
  const refunded = new Set<string>();
  const lastRevTs: Record<string, bigint> = {};
  const lastPlanTs: Record<number, bigint> = {};
  let measured = { rev: 0, plans: 0 };
  let nyLaunched = false, nyMoved = false;

  const ts = async (rc: any) => BigInt((await ethers.provider.getBlock(rc.blockNumber))!.timestamp);
  const attempt = async (name: string, fn: () => Promise<any>) => {
    counts[name] = (counts[name] ?? 0) + 1;
    try {
      const tx = await fn();
      return await tx.wait();
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/panic code/i.test(msg)) breaks.push(`(d) ${name}: ${msg.slice(0, 160)}`);
      const key = `${name}: ${(msg.match(/custom error '([A-Za-z]+)/) ?? msg.match(/reverted with reason string '([^']+)/) ?? [, "other"])[1]}`;
      reverts[key] = (reverts[key] ?? 0) + 1;
      return null;
    }
  };

  /** Principal figures the next interval is measured on. */
  type State = { unsecured: bigint; tiers: bigint[]; agg: bigint };
  const state: Record<string, State> = {};
  const record = async () => {
    for (const m of members) {
      const tiers = [await revolving.principalOnlyOf(m.address, INCOME_T), await revolving.principalOnlyOf(m.address, BOOST_T)];
      state[m.address] = { unsecured: tiers[0] + tiers[1], tiers, agg: await rates.aggregatePrincipalOf(m.address) };
    }
  };
  const planPrincipal = async (id: number) => {
    const p = await term.planAt(id);
    return p.closed ? 0n : p.principalOutstanding - (await term.carryOutstandingOf(id));
  };
  const planState: Record<number, { principal: bigint; free: boolean; listBps: bigint; member: string }> = {};

  /** Materialise every position; when `measure`, check each one's carry against its bound. */
  const materialiseAll = async (measure: boolean) => {
    for (const m of members) {
      const rc = await attempt("materialiseRevolving", () => revolving.materialiseCarry(m.address));
      if (!rc) continue;
      const t = await ts(rc);
      if (measure && lastRevTs[m.address] !== undefined) {
        const dt = t - lastRevTs[m.address];
        const s = state[m.address];
        const byTier: Record<number, bigint> = {};
        for (const log of rc.logs) {
          try {
            const ev = revolving.interface.parseLog(log);
            if (ev?.name === "TierCarryMaterialised" && ev.args[0] === m.address) byTier[Number(ev.args[1])] = ev.args[2];
          } catch { /* another contract's log */ }
        }
        const unsecuredCarry = (byTier[INCOME_T] ?? 0n) + (byTier[BOOST_T] ?? 0n);
        let bound = revCap(s.unsecured, dt);
        if (s.agg > s.unsecured && s.unsecured > 0n) bound = min(bound, (revCap(s.agg, dt) * s.unsecured) / s.agg);
        if (unsecuredCarry > bound + EPS) breaks.push(`(a) ${m.address}: unsecured carry ${unsecuredCarry} > ${bound} on ${s.unsecured} (agg ${s.agg}) over ${dt}s`);
        const listBps = [150n, 300n];
        for (const [k, tier] of [INCOME_T, BOOST_T].entries()) {
          const list = (s.tiers[k] * listBps[k] * 12n * dt) / (10_000n * YEAR);
          if ((byTier[tier] ?? 0n) > list + EPS) breaks.push(`(a) ${m.address} tier ${tier}: ${byTier[tier]} > list ${list}`);
        }
        measured.rev++;
      }
      lastRevTs[m.address] = t;
    }
    for (const id of plans) {
      const p = await term.planAt(id);
      if (p.closed) continue;
      const rc = await attempt("materialisePlan", () => term.materialiseCarry(id));
      if (!rc) continue;
      const t = await ts(rc);
      if (measure && lastPlanTs[id] !== undefined && planState[id]) {
        const dt = t - lastPlanTs[id];
        const ps = planState[id];
        let carry = 0n;
        for (const log of rc.logs) {
          try {
            const ev = term.interface.parseLog(log);
            if (ev?.name === "PlanCarryMaterialised" && Number(ev.args[0]) === id) carry += ev.args[1];
          } catch { /* another contract's log */ }
        }
        if (ps.free && carry > 0n) breaks.push(`(c) plan ${id} is free and accrued ${carry}`);
        if (!ps.free && ps.principal > 0n) {
          const agg = state[ps.member].agg;
          let bound = min((ps.principal * ps.listBps * dt) / (10_000n * MONTH30), termCap(ps.principal, dt));
          if (agg > ps.principal) bound = min(bound, (termCap(agg, dt) * ps.principal) / agg);
          if (ps.principal >= THRESHOLD || agg >= THRESHOLD) bound = min(bound, (ps.principal * ANNUAL * dt) / (10_000n * YEAR));
          if (carry > bound + EPS) breaks.push(`(b) plan ${id}: carry ${carry} > ${bound} on ${ps.principal} (agg ${agg}) over ${dt}s`);
        }
        measured.plans++;
      }
      lastPlanTs[id] = t;
    }
  };
  const recordPlans = async () => {
    for (const id of plans) {
      const pricing = await term.pricingOf(id);
      const p = await term.planAt(id);
      const list = pricing.product === CASH ? 250n : 200n;
      planState[id] = { principal: await planPrincipal(id), free: pricing.free, listBps: list, member: p.member };
    }
  };

  const quoteRate = async (member: string, product: string, purchase: bigint, n: number) => {
    const st = await ctx.networkRegistry.stateCodeOf(member);
    if (n === 1 || (product === PARTNER && purchase < 100n * ONE_USDC)) return 0n;
    let r: bigint = await rates.effectiveMonthlyBps(st, product, purchase).catch(() => 0n);
    if (purchase >= THRESHOLD) r = min(r, (ANNUAL * 30n) / 365n);
    return r;
  };

  await materialiseAll(false);
  await record();
  await recordPlans();

  for (let step = 0; step < STEPS; step++) {
    // Time passes, then every position is measured over exactly that interval.
    await ethers.provider.send("evm_increaseTime", [Math.floor(3_600 + rnd() * 20 * 86_400)]);
    await materialiseAll(true);

    const m = pick(members);
    const r = rnd();
    if (r < 0.18) {
      await attempt("draw", () => sc.connect(m).transfer(merchant.address, amt(400)));
    } else if (r < 0.30) {
      const owed: bigint = await sc.creditBalanceOf(m.address);
      if (owed > 0n) await attempt("repay", () => sc.connect(m).repayCreditBalance(m.address, owed < 2n ? owed : (owed * BigInt(Math.floor(rnd() * 1000) + 1)) / 1000n));
    } else if (r < 0.42) {
      const large = rnd() < 0.25;
      const product = large ? CASH : PARTNER;
      const purchase = large ? 2_500n * ONE_USDC + amt(1_000) : amt(1_500);
      const n = large ? 13 : pick([1, 2, 4, 6, 12]);
      const rate = await quoteRate(m.address, product, purchase, n);
      const payout = purchase - (purchase * 250n) / 10_000n;
      const rc = await attempt("openPlan", () => signedOpenPlan(term, ctx.operator, m.address, merchant.address, purchase, payout, rate, CYCLE, n, CYCLE, product));
      if (rc) plans.push(plans.length);
    } else if (r < 0.56 && plans.length) {
      const id = pick(plans);
      const p = await term.planAt(id);
      if (!p.closed) {
        const due: bigint = (await term.scheduledPrincipalDue(id)) - p.repaid;
        const pay = due > 0n && rnd() < 0.8 ? due : amt(200);
        await attempt("payPlan", async () => term.connect(await ethers.getSigner(p.member)).payPlan(id, pay));
      }
    } else if (r < 0.64 && plans.length) {
      // (e) The operator re-splits, unsigned.
      const id = pick(plans);
      const n = pick([1, 2, 4, 6, 12]);
      const before = await term.planAt(id);
      const arrearsBefore: bigint = await term.arrearsOf(id);
      const dueBefore: bigint = before.closed ? 0n : await term.installmentsDue(id);
      const [instBefore] = await term.scheduleOf(id);
      const rc = await attempt("operatorResplit", () => term.connect(ctx.operator).setSplit(id, n));
      if (rc) {
        const remaining = BigInt(before.installments) > dueBefore ? BigInt(before.installments) - dueBefore : 0n;
        const [instAfter] = await term.scheduleOf(id);
        if (BigInt(n) < remaining) breaks.push(`(e) plan ${id}: operator shortened ${remaining} -> ${n}`);
        if (instAfter > instBefore) breaks.push(`(e) plan ${id}: operator raised the installment ${instBefore} -> ${instAfter}`);
        if ((await term.arrearsOf(id)) > arrearsBefore) breaks.push(`(e) plan ${id}: operator re-split added arrears`);
      }
    } else if (r < 0.68 && plans.length) {
      const id = pick(plans);
      const p = await term.planAt(id);
      await attempt("memberResplit", async () => term.connect(await ethers.getSigner(p.member)).setSplit(id, pick([1, 2, 4, 6, 12])));
    } else if (r < 0.72 && plans.length) {
      const id = pick(plans);
      const p = await term.planAt(id);
      const pricing = await term.pricingOf(id);
      const others = members.filter((x: any) => x.address !== p.member).map((x: any) => x.address);
      const before = await Promise.all(others.map((a: string) => sc.creditBalanceOf(a)));
      const rc = await attempt("refund", () => term.connect(ctx.operator).closePlanForRefund(id, amt(Number(p.principal / ONE_USDC) + 1), pricing.merchant, 0n));
      if (rc) {
        refunded.add(p.member);
        const after = await Promise.all(others.map((a: string) => sc.creditBalanceOf(a)));
        if (after.some((v, i) => v > before[i])) breaks.push(`(H-A) refund of plan ${id} raised another member's debt`);
      }
    } else if (r < 0.86) {
      // (f) A keeper judges the member's revolving cycle.
      const revOwed: bigint = await revolving.totalPrincipalOf(m.address);
      const missedBefore = (await revolving.cycleOf(m.address)).missedInRow;
      const rc = await attempt("syncCreditPeriod", () => revolving.connect(coop).syncCreditPeriod(m.address));
      if (rc && revOwed === 0n && (await revolving.cycleOf(m.address)).missedInRow > missedBefore) {
        breaks.push(`(f) ${m.address}: a cycle judged with nothing owed on the line counted as a miss`);
      }
    } else if (r < 0.88 && !nyMoved) {
      // Governance (M-B): a member moves to a state with no products yet.
      nyMoved = true;
      await attempt("attestNY", () => ctx.networkRegistry.attestStateCode(members[1].address, NY));
    } else if (r < 0.90 && nyMoved && !nyLaunched) {
      nyLaunched = true;
      for (const [name, list] of [["INCOME", 150], ["BOOST", 300], ["REVOLVING", 0]] as const) {
        await attempt("launchNY", () => rates.setProduct(NY, P(name), params({ listMonthlyBps: list }), CA_BANDS));
      }
    } else {
      await attempt("materialiseOne", () => revolving.materialiseCarry(m.address));
    }

    await materialiseAll(false);
    await record();
    await recordPlans();

    // (g) The ledger and the issuers agree, for every member no refund has touched.
    for (const mm of members) {
      if (refunded.has(mm.address)) continue;
      const ledger: bigint = await sc.creditBalanceOf(mm.address);
      const held: bigint = (await revolving.totalPrincipalOf(mm.address)) + (await term.totalPrincipalOf(mm.address));
      if (ledger !== held && !(await revolving.hasDefaulted(mm.address)) && !(await term.termSuspended(mm.address))) {
        breaks.push(`(g) step ${step} ${mm.address}: ledger ${ledger} != issuers ${held}`);
      }
    }
  }
  return { breaks, reverts, counts, measured, plans: plans.length };
}

describe("PHASE 4 step 3: accrual invariants (RateSchedule, member ceiling, CFL aggregation, levelled plans)", function () {
  this.timeout(3_600_000);
  // These runs move the chain's clock by years. Put it back afterwards, so later suites in the same
  // Hardhat process (bond maturities are bounded) start where they would have.
  let snap: string;
  beforeEach(async () => { snap = await ethers.provider.send("evm_snapshot", []); });
  afterEach(async () => { await ethers.provider.send("evm_revert", [snap]); });
  for (const seed of [41, 42, 43]) {
    it(`seed ${seed}: every interval's carry is within the legal bound, and nothing panics`, async function () {
      const res = await runAccrualFuzz(seed);
      console.log(`      steps=${STEPS} plans=${res.plans} measured=${JSON.stringify(res.measured)} actions=${JSON.stringify(res.counts)}`);
      console.log(`      reverts: ${JSON.stringify(res.reverts)}`);
      if (res.breaks.length) console.log(`      breaks:\n        ${res.breaks.slice(0, 20).join("\n        ")}`);
      expect(res.measured.rev).to.be.gt(0);
      expect(res.breaks).to.deep.equal([]);
    });
  }
});
