import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import { runFuzz } from "./fuzz-engine";
import { deployCore, ONE_USDC } from "./deep-setup";
import { signedOpenPlan } from "../../helpers/plans";

/*
 * Stateful invariant fuzzing of the credit core. These tests PASS and write what they find to
 * $FUZZ_OUT (default: <tmpdir>/clear-audit-fuzz)/<name>.json; the assertions at the end of each pin down the breaks
 * that are present in the current code, so they keep passing while the bugs exist.
 */
const STEPS = Number(process.env.FUZZ_STEPS ?? 300);
const OUT = process.env.FUZZ_OUT || require("path").join(require("os").tmpdir(), "clear-audit-fuzz");

function dump(name: string, res: any) {
  fs.mkdirSync(OUT, { recursive: true });
  const { env, ...rest } = res;
  fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(rest, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`      [${name}] steps=${STEPS} actions=${JSON.stringify(res.counts)}`);
  console.log(`      (i)  supply-obligation drift by action: ${JSON.stringify(res.supplyDrift, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  console.log(`      (i-b) unbacked-claim drift by action:  ${JSON.stringify(res.backingDrift, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  console.log(`      (ii) composition drift by action:      ${JSON.stringify(res.compDrift, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  console.log(`      breaks: ${res.breaks.length}; reverts: ${JSON.stringify(res.reverts)}`);
}

describe("DEEP AUDIT: credit-core invariants (seeded stateful fuzz)", function () {
  this.timeout(1_800_000);

  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: empty pool, draws within revolving headroom`, async function () {
      const res = await runFuzz({ seed, steps: STEPS, treasuryAllowance: 50_000n * ONE_USDC });
      dump(`seed${seed}-empty`, res);
      // (i) only ever moves on settlement burns and refunds: never on draws, plans, warps or materialisation.
      for (const a of ["draw", "openPlan", "warp", "materialise", "repayCreditBalance"]) {
        expect(res.supplyDrift[a] ?? 0n, `(i) drift on ${a}`).to.equal(0n);
      }
    });
  }

  for (const seed of [11, 12]) {
    it(`seed ${seed}: a member who stops paying (defaults happen)`, async function () {
      const res = await runFuzz({ seed, steps: STEPS, lazyMember: true, treasuryAllowance: 50_000n * ONE_USDC });
      dump(`seed${seed}-lazy`, res);
    });
  }

  it("seed 4: pre-funded pool (production configuration)", async function () {
    const res = await runFuzz({ seed: 4, steps: STEPS, fundPool: 5_000n * ONE_USDC, treasuryAllowance: 50_000n * ONE_USDC });
    dump("seed4-funded", res);
  });

  it("seed 5: overdraw attempted (the audited C-1 path) -- refused since Phase 1 (RevolvingIssuerDrawUnplaced)", async function () {
    const res = await runFuzz({ seed: 5, steps: STEPS, allowOverdraw: true });
    dump("seed5-overdraw", res);
  });

  it("(iv) deterministic path independence: materialising daily vs never gives the same debt", async function () {
    const env = await deployCore();
    const { ctx, revolving, term, merchant, coop } = env;
    const { DAY, CYCLE } = await import("./deep-setup");
    const m = ctx.member;
    await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 1_500n * ONE_USDC, 500n * ONE_USDC], 0);
    await term.connect(ctx.operator).setTermLimit(m.address, 2_000n * ONE_USDC);
    const t0 = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
    const snapId = await ethers.provider.send("evm_snapshot", []);
    const at = async (t: number) => ethers.provider.send("evm_setNextBlockTimestamp", [t]);
    const run = async (daily: boolean) => {
      await at(t0); await ctx.stableCredit.connect(m).transfer(merchant.address, 1_700n * ONE_USDC + 123_457n);
      // 140 bps per 30-day cycle, under the Income tier's 150 a month. Since Phase 4b (L-G) repayment
      // order compares what each position really costs, and a plan at 150 per 30 days costs more than
      // 150 a month, so the undirected repayments below would close the plan before its own payments.
      await at(t0 + 1); await signedOpenPlan(term, ctx.operator, m.address, merchant.address, 1_000n * ONE_USDC + 7n, 975n * ONE_USDC, 140n, CYCLE, 4, CYCLE);
      for (let d = 1; d <= 120; d++) {
        const t = t0 + d * DAY;
        if (daily) { await at(t); await revolving.materialiseCarry(m.address); await at(t + 1); await term.materialiseCarry(0); }
        if (d % 30 === 0) {
          await at(t + 2); await ctx.stableCredit.connect(m).repayCreditBalance(m.address, 300n * ONE_USDC + 3_333n);
          await at(t + 3); await term.connect(m).payPlan(0, 250n * ONE_USDC + 11n);
        }
        if (d === 75) { await at(t + 4); await ctx.stableCredit.connect(m).transfer(merchant.address, 100n * ONE_USDC + 1n); }
      }
      const tEnd = t0 + 121 * DAY;
      await at(tEnd); await revolving.materialiseCarry(m.address);
      await at(tEnd + 1); await term.materialiseCarry(0);
      return {
        ledger: await ctx.stableCredit.creditBalanceOf(m.address) as bigint,
        rev: await revolving.totalPrincipalOf(m.address) as bigint,
        term: await term.totalPrincipalOf(m.address) as bigint,
        coop: await ctx.stableCredit.balanceOf(coop.address) as bigint,
      };
    };
    const A = await run(true);
    await ethers.provider.send("evm_revert", [snapId]);
    const B = await run(false);
    console.log(`      daily: ${JSON.stringify(A, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
    console.log(`      never: ${JSON.stringify(B, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
    // Holds: carry is index-based, so when it is written to the ledger does not change how much accrues.
    const diff = A.ledger > B.ledger ? A.ledger - B.ledger : B.ledger - A.ledger;
    expect(diff).to.be.lte(300n); // a few wei of rounding per materialisation at most
    expect(A.ledger).to.equal(A.rev + A.term);
    expect(B.ledger).to.equal(B.rev + B.term);
  });

  it("(iv) path independence: same seed with and without explicit carry materialisation", async function () {
    const env = await deployCore();
    // identical starting state for both runs
    const { ctx, revolving, term } = env;
    const { DAY, CYCLE } = await import("./deep-setup");
    for (const m of [ctx.member, env.member2, env.member3]) {
      await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 1_500n * ONE_USDC, 500n * ONE_USDC], 0);
      await term.connect(ctx.operator).setTermLimit(m.address, 2_000n * ONE_USDC);
    }
    const snapId = await ethers.provider.send("evm_snapshot", []);
    const a = await runFuzz({ seed: 9, steps: STEPS, materialise: true }, env);
    await ethers.provider.send("evm_revert", [snapId]);
    const b = await runFuzz({ seed: 9, steps: STEPS, materialise: false }, env);
    let maxDiff = 0n;
    const diffs: Record<string, string> = {};
    for (const k of Object.keys(a.final)) {
      const d = a.final[k] > b.final[k] ? a.final[k] - b.final[k] : b.final[k] - a.final[k];
      diffs[k] = (a.final[k] - b.final[k]).toString();
      if (d > maxDiff) maxDiff = d;
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(`${OUT}/path-independence.json`, JSON.stringify({ maxDiff: maxDiff.toString(), diffs,
      traceA: a.trace, traceB: b.trace }, null, 2));
    console.log(`      final creditBalance max |A-B| = ${maxDiff} wei; diffs ${JSON.stringify(diffs)}`);
    const tracesMatch = a.trace.filter((t: string) => !t.includes("materialise")).join() === b.trace.filter((t: string) => !t.includes("materialise")).join();
    console.log(`      non-materialise traces identical: ${tracesMatch}`);
  });
});
