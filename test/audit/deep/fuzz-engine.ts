import { ethers } from "hardhat";
import { deployCore, ONE_USDC, CYCLE, DAY } from "./deep-setup";
import { signedOpenPlan, signedOpenPlanStatic } from "../../helpers/plans";

/*
 * Seeded stateful fuzzer for the credit core: ClearCredit + RevolvingIssuer + TermIssuer + PayoutPool.
 * After every step it measures four invariants and attributes every change in them to the action
 * that caused it, so a break is reported with the action that produced it and a replayable trace.
 */

export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FuzzConfig = {
  seed: number;
  steps: number;
  fundPool?: bigint;          // pre-fund the PayoutPool (production does)
  allowOverdraw?: boolean;    // draws beyond revolving headroom (the known C-1 path)
  materialise?: boolean;      // include explicit materialise actions (false = run B of the path test)
  treasuryAllowance?: bigint; // co-op Safe allowance to the pool (drawForDueClaim)
  revolvingRefunds?: boolean;
  lazyMember?: boolean;       // member3 never pays: drives plans into default
};

type Plan = { id: number; member: string; merchant: string; principal: bigint };

export type Break = { step: number; action: string; detail: string };

export async function runFuzz(cfg: FuzzConfig, env?: any) {
  const rnd = prng(cfg.seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const randAmt = (max: bigint) => {
    if (max <= 0n) return 0n;
    // random fraction with random low digits, so rounding paths are exercised
    const f = BigInt(Math.floor(rnd() * 1_000_000));
    const v = (max * f) / 1_000_000n + BigInt(Math.floor(rnd() * 997));
    return v > max ? max : (v === 0n ? 1n : v);
  };

  const e = env ?? (await deployCore({ fundPool: cfg.fundPool ?? 0n }));
  const { ctx, revolving, term, pool, coop, merchant, merchant2, funder, member2, member3 } = e;
  const sc = ctx.stableCredit;
  const ledger = await sc.getAddress();
  const poolAddr = await pool.getAddress();
  const members = [ctx.member, member2, member3];
  const merchants = [merchant, merchant2];
  const all = [...members, ...merchants, coop, funder, { address: poolAddr }, { address: ledger }];

  if (!env) {
    for (const m of members) {
      await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 1_500n * ONE_USDC, 500n * ONE_USDC], 0);
      await term.connect(ctx.operator).setTermLimit(m.address, 2_000n * ONE_USDC);
    }
    if (cfg.treasuryAllowance) await ctx.usdc.connect(coop).approve(poolAddr, cfg.treasuryAllowance);
  }

  // A fixed virtual clock so two runs of the same seed see identical timestamps.
  let clock = (await ethers.provider.getBlock("latest"))!.timestamp + 100;
  const tick = async (dt = 1) => {
    const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
    clock = (clock > latest ? clock : latest) + dt;
    await ethers.provider.send("evm_setNextBlockTimestamp", [clock]);
  };

  const plans: Plan[] = [];
  const breaks: Break[] = [];
  const reverts: Record<string, number> = {};
  const counts: Record<string, number> = {};
  // drift attribution
  const supplyDrift: Record<string, bigint> = {};
  const backingDrift: Record<string, bigint> = {};
  const compDrift: Record<string, { up: bigint; down: bigint }> = {};
  const trace: string[] = [];
  let maxZeroDtCarry = 0n;

  const snap = async () => {
    const supply: bigint = await sc.totalSupply();
    let owed = 0n, owedNonLedger = 0n;
    const cb: Record<string, bigint> = {};
    for (const a of all) {
      const c: bigint = await sc.creditBalanceOf(a.address);
      cb[a.address] = c;
      owed += c;
      if (a.address !== ledger) owedNonLedger += c;
    }
    const comp: Record<string, bigint> = {};
    for (const m of members) {
      const r: bigint = await revolving.totalPrincipalOf(m.address);
      const t: bigint = await term.totalPrincipalOf(m.address);
      comp[m.address] = cb[m.address] - r - t; // >0 residual on ledger, <0 phantom issuer principal
    }
    const memberFunded: bigint = await pool.memberFunded();
    const lostDebt: bigint = await sc.lostDebt();
    const held: bigint = await ctx.usdc.balanceOf(poolAddr);
    const refundsOwed: bigint = await pool.refundsOwed();
    const queued: bigint = await pool.queuedTotal();
    const inFlight: bigint = await pool.inFlight();
    const capCoop: bigint = await pool.capitalOf(coop.address);
    const capFunder: bigint = await pool.capitalOf(funder.address);
    const poolCredits: bigint = await sc.balanceOf(poolAddr);
    const advPool: bigint = await pool.advancedOf(poolAddr);
    const carryEarned: bigint = await pool.carryEarned();
    return { supply, owed, owedNonLedger, cb, comp, memberFunded, lostDebt, held, refundsOwed, queued, inFlight,
      capCoop, capFunder, poolCredits, advPool, carryEarned,
      // claims not backed by an obligation, by cash already received for them, or by recognised lost debt
      unbacked: supply > owedNonLedger + memberFunded + lostDebt ? supply - owedNonLedger + 0n - memberFunded - lostDebt : 0n };
  };

  const record = (step: number, action: string, detail: string) => {
    if (breaks.filter((b) => b.detail.split(":")[0] === detail.split(":")[0] && b.action === action).length < 3) {
      breaks.push({ step, action, detail });
    }
  };

  let prev = await snap();
  for (let step = 0; step < cfg.steps; step++) {
    const r = rnd();
    let action = "";
    let fn: (() => Promise<any>) | null = null;
    const m = pick(members);
    const mer = pick(merchants);
    const lazy = cfg.lazyMember && m.address === member3.address;

    if (r < 0.16) {
      // revolving draw by transfer to a registered merchant
      let head = 0n;
      for (let i = 0; i < 4; i++) head += await revolving.headroomOf(m.address, i);
      const left: bigint = await sc.creditLimitLeftOf(m.address);
      const cap = cfg.allowOverdraw && rnd() < 0.3 ? left : (head < left ? head : left);
      const amt = randAmt(cap);
      action = "draw";
      if (amt > 0n) fn = () => sc.connect(m).transfer(mer.address, amt);
    } else if (r < 0.28) {
      const tp: bigint = await term.totalPrincipalOf(m.address);
      const lim: bigint = await term.termLimitOf(m.address);
      const amt = randAmt(lim > tp ? lim - tp : 0n);
      const rate = pick([0n, 65n, 150n, 300n]);
      const inst = pick([1, 2, 4]);
      action = "openPlan";
      if (amt > 0n) fn = async () => {
        const id = Number(await term.planCount());
        const tx = await signedOpenPlan(term, ctx.operator, m.address, mer.address, amt, (amt * 975n) / 1000n, rate, CYCLE, inst, CYCLE);
        plans.push({ id, member: m.address, merchant: mer.address, principal: amt });
        return tx;
      };
    } else if (r < 0.40) {
      const mine = plans.filter((p) => p.member === m.address);
      action = "payPlan";
      if (mine.length && !lazy) {
        const p = pick(mine);
        const owed: bigint = await term.owedOn(p.id);
        const amt = randAmt(owed + owed / 10n);
        fn = () => term.connect(m).payPlan(p.id, amt);
      }
    } else if (r < 0.50) {
      const owed: bigint = await sc.creditBalanceOf(m.address);
      const amt = randAmt(owed);
      action = "repayCreditBalance";
      if (amt > 0n && !lazy) fn = () => sc.connect(m).repayCreditBalance(m.address, amt);
    } else if (r < 0.60) {
      action = "warp";
      const dt = Math.floor(rnd() * 20 * DAY) + 1;
      fn = async () => { await tick(dt); await ethers.provider.send("evm_mine", []); return null; };
    } else if (r < 0.66) {
      action = "materialise";
      // consume the same randomness in both runs of the path-independence test
      const which = rnd();
      const p = plans.length ? pick(plans) : undefined;
      if (cfg.materialise !== false) {
        if (which < 0.5 || !p) fn = () => revolving.materialiseCarry(m.address);
        else fn = () => term.materialiseCarry(p.id);
      }
    } else if (r < 0.73) {
      const who = rnd() < 0.8 ? mer : coop;
      const bal: bigint = await sc.balanceOf(who.address);
      const amt = randAmt(bal);
      action = "redeem";
      if (amt > 0n) fn = () => pool.connect(who).redeem(amt);
    } else if (r < 0.77) {
      action = "payQueue"; fn = () => pool.payQueue(5);
    } else if (r < 0.83) {
      action = "refund";
      if (plans.length) {
        const p = pick(plans);
        const amt = randAmt(p.principal);
        fn = () => term.connect(ctx.operator).closePlanForRefund(p.id, amt, p.merchant, (amt * 975n) / 1000n);
      }
    } else if (r < 0.87) {
      action = "distributeCarry"; fn = () => pool.distributeCarry();
    } else if (r < 0.90) {
      const bal: bigint = await sc.balanceOf(coop.address);
      action = "withdrawCoopIncome";
      if (bal > 0n) { const amt = randAmt(bal); fn = () => pool.connect(ctx.admin).withdrawCoopIncome(amt); }
    } else if (r < 0.93) {
      action = "payRefundsOwed"; fn = () => pool.payRefundsOwed();
    } else if (r < 0.96) {
      action = "drawForDueClaim"; fn = () => pool.drawForDueClaim();
    } else {
      action = "declareDefault"; fn = () => term.declareDefault(m.address);
    }

    counts[action] = (counts[action] ?? 0) + 1;
    if (!fn) { trace.push(`${step}:${action}:skip`); continue; }
    let ok = true;
    try {
      if (action !== "warp") await tick(1);
      const tx = await fn();
      if (tx && tx.wait) await tx.wait();
    } catch (err: any) {
      ok = false;
      const msg = String(err?.message ?? err);
      const key = `${action}: ${(msg.match(/reverted with (?:custom error |reason string |panic code )?'?([^'\n(]+)/)?.[1] ?? msg.slice(0, 80)).trim()}`;
      reverts[key] = (reverts[key] ?? 0) + 1;
    }
    trace.push(`${step}:${action}:${ok ? "ok" : "rev"}`);
    if (!ok) { continue; }

    const cur = await snap();
    // (i) strict: supply == sum of obligations (incl. the ledger's own line)
    const d1 = (cur.supply - cur.owed) - (prev.supply - prev.owed);
    if (d1 !== 0n) {
      supplyDrift[action] = (supplyDrift[action] ?? 0n) + d1;
      record(step, action, `(i) supply-obligations moved by ${d1}`);
    }
    // (i-b) backing: every claim is backed by an obligation, member cash in the pool, or recognised lost debt
    const d1b = cur.unbacked - prev.unbacked;
    if (d1b !== 0n) {
      backingDrift[action] = (backingDrift[action] ?? 0n) + d1b;
      if (d1b > 0n) record(step, action, `(i-b) unbacked claims grew by ${d1b} (now ${cur.unbacked})`);
    }
    // (ii) composition per member
    for (const mm of members) {
      const dd = cur.comp[mm.address] - prev.comp[mm.address];
      if (dd !== 0n) {
        const k = compDrift[action] ?? { up: 0n, down: 0n };
        if (dd > 0n) k.up += dd; else k.down += dd;
        compDrift[action] = k;
        record(step, action, `(ii) ledger-(rev+term) for ${mm.address.slice(0, 8)} moved by ${dd} (now ${cur.comp[mm.address]})`);
      }
    }
    // merchants should never owe anything an issuer does not know about
    for (const mm of merchants) {
      if (cur.cb[mm.address] !== prev.cb[mm.address]) {
        record(step, action, `(ii-m) merchant ${mm.address.slice(0, 8)} untracked obligation now ${cur.cb[mm.address]}`);
      }
    }
    // (iii) payout pool cash
    if (cur.held < cur.refundsOwed) record(step, action, `(iii) held ${cur.held} < refundsOwed ${cur.refundsOwed}`);
    if (cur.held < cur.memberFunded + cur.capCoop + cur.capFunder) {
      record(step, action, `(iii-b) held ${cur.held} < memberFunded+capital ${cur.memberFunded + cur.capCoop + cur.capFunder}`);
    }
    if (cur.inFlight !== cur.queued) record(step, action, `(iii-c) inFlight ${cur.inFlight} != queuedTotal ${cur.queued}`);
    if (cur.poolCredits < cur.inFlight + cur.advPool + cur.carryEarned) {
      record(step, action, `(iii-d) pool credits ${cur.poolCredits} < inFlight+advanced+carryEarned ${cur.inFlight + cur.advPool + cur.carryEarned}`);
    }
    try {
      if (await pool.canPayNext()) await pool.payNext.staticCall();
    } catch { record(step, action, `(iii-e) canPayNext() true but payNext reverts`); }
    // (iv) carry: phantom issuer principal earns carry the member does not owe
    for (const mm of members) {
      if (cur.comp[mm.address] < 0n) record(step, action, `(iv) phantom principal ${-cur.comp[mm.address]} accruing carry`);
    }
    if (action === "draw") {
      // drawing must not create carry in the same second
      const rcy: bigint = await revolving.carryOf(m.address, 2) + await revolving.carryOf(m.address, 3);
      if (rcy > maxZeroDtCarry) maxZeroDtCarry = rcy;
    }
    prev = cur;
  }

  const final: Record<string, bigint> = {};
  for (const a of all) final[a.address] = await sc.creditBalanceOf(a.address);
  return { breaks, reverts, counts, supplyDrift, backingDrift, compDrift, trace, final, maxZeroDtCarry, last: prev, env: e };
}
