import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  BPS, DAY, EVIDENCE, HOUR, LOSS_EVENT, U, VALUATION_PENDING, WAD,
  deployYieldPool, increase, latest, postTierCap, setNext,
} from "../helpers/yieldPool";
import { LOW_UTILIZATION_RULE, withRealControls } from "../helpers/earnControls";
import { poolAt, poolProxyOptions } from "../../deploy/poolModules";

/*
 * Phase 2f, Yield Pool IV-02 conformance: the owner's decisions 24-29 and the spec fixes found in
 * the section-by-section pass (docs/audit/PHASE-2F-POOL-CONFORMANCE.md). IV-02 is the binding
 * instrument: docs/audit/specs/IV-02-yield-pool-subscription-and-pool-share-terms.md.
 */

/* ---------- Pacific calendar, as the pool reads it (PacificCalendar.sol) ---------- */

/** Day of the month of the n-th Sunday. */
function nthSunday(y: number, m: number, n: number) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
function daylight(y: number, m: number, d: number) {
  const t = Date.UTC(y, m - 1, d);
  return t >= Date.UTC(y, 2, nthSunday(y, 3, 2)) && t < Date.UTC(y, 10, nthSunday(y, 11, 1));
}
/** 23:59:59 Pacific on a date, as a UTC timestamp. */
function endOfDay(y: number, m: number, d: number) {
  return Date.UTC(y, m - 1, d, 23, 59, 59) / 1000 + (daylight(y, m, d) ? 7 : 8) * HOUR;
}
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEnd = (y: number, m: number) => endOfDay(y, m, lastDay(y, m));
/** The end of the 5th weekday after month `m`'s last day: Business Days taken as weekdays. */
function dueAfter(y: number, m: number) {
  let t = Date.UTC(y, m - 1, lastDay(y, m));
  for (let n = 0; n < 5;) {
    t += DAY * 1000;
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  const d = new Date(t);
  return endOfDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
async function at(ts: number) {
  await setNext(ts);
  await ethers.provider.send("evm_mine", []);
}
async function nextYear() {
  return new Date((await latest()) * 1000).getUTCFullYear() + 1;
}
function events(pool: any, rc: any, name: string) {
  return rc.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
    .filter((e: any) => e?.name === name);
}

const LEGEND = "These Pool Shares have not been registered under the Securities Act of 1933 or any state securities law. " +
  "They may not be transferred except to Clear Lending Co. or by operation of law, as IV-02 permits.";

describe("Yield Pool IV-02 conformance (decisions 24-29, §§1.2, 2.6, 4.3, 5.6, 6.5, 7.3, 8.5, Exh. A)", function () {
  let f: Awaited<ReturnType<typeof deployYieldPool>>;
  let pool: any, usdc: any;

  beforeEach(async function () {
    f = await deployYieldPool();
    pool = f.pool;
    usdc = f.usdc;
  });

  /* ------------------------------------------------------------ decision 24 */
  describe("Pool Interest: monthly billing and capitalization (§4.6, decision 24)", function () {
    let y: number;
    beforeEach(async function () {
      y = await nextYear();
      await setNext(Date.UTC(y, 0, 10, 20) / 1000); // 10 January
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(5_000));
    });

    it("bills the month's interest at the Pacific month end, due at the end of the 5th weekday after", async function () {
      const [, , periodEnd0] = await pool.billedInterest();
      expect(periodEnd0).to.equal(BigInt(monthEnd(y, 1)));
      await at(monthEnd(y, 1) - 10);
      expect((await pool.billedInterest()).amount).to.equal(0n);
      await at(monthEnd(y, 1) + HOUR);
      const [amount, dueAt, periodEnd] = await pool.billedInterest();
      expect(dueAt).to.equal(BigInt(dueAfter(y, 1)));
      expect(periodEnd).to.equal(BigInt(monthEnd(y, 2)));
      // Everything accrued to the month end is billed; an hour more is accruing for February.
      const hour = (U(5_000) * ethers.parseUnits("0.03875", 18) * 3600n) / (365n * 86400n * WAD);
      expect(await pool.accruedInterest() - amount).to.be.closeTo(hour, 2n);
      expect(amount).to.be.greaterThan(U(10));
      // A new booking records it.
      await expect(pool.connect(f.outsider).accrue()).to.emit(pool, "InterestBilled").withArgs(amount, dueAt);
    });

    it("capitalizes only what is unpaid when due, after the due time, and it then earns interest", async function () {
      await at(monthEnd(y, 1) + HOUR);
      const billed: bigint = (await pool.billedInterest()).amount;
      // Half is paid: Returns pay the billed interest first.
      const half = billed / 2n;
      await pool.connect(f.lending).returnFunds(half);
      expect((await pool.billedInterest()).amount).to.equal(billed - half);
      expect(await pool.deployedBalance()).to.equal(U(5_000));

      const due = dueAfter(y, 1);
      await at(due);
      expect(await pool.deployedBalance()).to.equal(U(5_000)); // not yet: due through its last second
      await setNext(due + 1);
      const tx = await pool.connect(f.outsider).accrue(); // anyone may capitalize
      await expect(tx).to.emit(pool, "InterestCapitalized").withArgs(billed - half, U(5_000) + billed - half);
      expect(await pool.deployedBalance()).to.equal(U(5_000) + billed - half);
      expect((await pool.billedInterest()).amount).to.equal(0n);
      expect(await pool.totalCapitalized()).to.equal(billed - half);

      // The capitalized interest earns interest: a day's accrual is on the larger balance.
      const i0: bigint = await pool.accruedInterest();
      const d: bigint = await pool.deployedBalance();
      const rate: bigint = await pool.fundingRate();
      await increase(DAY);
      const expected = (d * rate * 86400n) / (365n * 86400n * WAD);
      expect(await pool.accruedInterest() - i0).to.be.closeTo(expected, 3n);
    });

    it("capitalizes nothing when the month's interest is paid on time", async function () {
      await at(monthEnd(y, 1) + HOUR);
      const billed: bigint = (await pool.billedInterest()).amount;
      await pool.connect(f.lending).returnFunds(billed);
      await at(dueAfter(y, 1) + DAY);
      await pool.accrue();
      expect(await pool.deployedBalance()).to.equal(U(5_000));
      expect(await pool.totalCapitalized()).to.equal(0n);
    });

    it("projects between bookings exactly what a booking records, across month ends and due dates", async function () {
      await at(dueAfter(y, 2) + DAY); // two month ends and two due dates later, untouched
      const d: bigint = await pool.deployedBalance();
      const i: bigint = await pool.accruedInterest();
      const assets: bigint = await pool.totalAssets();
      expect(d).to.be.greaterThan(U(5_000)); // January's and February's interest were capitalized
      await pool.accrue();
      const second = (U(5_100) * ethers.parseUnits("0.04", 18)) / (365n * 86400n * WAD) + 1n;
      expect(await pool.deployedBalance()).to.equal(d);
      expect(await pool.accruedInterest()).to.be.closeTo(i, second);
      expect(await pool.totalAssets()).to.be.closeTo(assets, second);
    });
  });

  /* ------------------------------------------------------------ utilization */
  describe("Utilization and the Funding Rate (§1.2, Schedule 2)", function () {
    it("is the Deployed Balance over it plus Vault Cash; interest does not move it; the rate follows the table", async function () {
      const p = (x: string) => ethers.parseUnits(x, 18);
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      expect(await pool.utilization()).to.equal(0n);
      expect(await pool.fundingRate()).to.equal(p("0.02")); // 0%: 2.00%
      await f.deploy(U(5_000));
      expect(await pool.utilization()).to.equal(p("0.5"));
      expect(await pool.fundingRate()).to.equal(p("0.03875")); // 50%: 3.88%
      await f.deploy(U(3_000));
      expect(await pool.utilization()).to.equal(p("0.8"));
      expect(await pool.fundingRate()).to.equal(p("0.05")); // 80%: 5.00%
      await f.deploy(U(1_000));
      expect(await pool.utilization()).to.equal(p("0.9"));
      expect(await pool.fundingRate()).to.equal(p("0.075")); // 90%: 7.50%
      await increase(10 * DAY);
      expect(await pool.accruedInterest()).to.be.greaterThan(0n);
      expect(await pool.utilization()).to.equal(p("0.9"));
      // Redeeming (nearly all) the Vault Cash takes Utilization to 100%: 10.00%. The maximum read
      // a block earlier is trimmed, since interest raises the Share Value by the next block.
      const most = ((await pool.maxRedeem(f.alice.address)) * 99_999n) / 100_000n;
      await pool.connect(f.alice).redeem(most, f.alice.address, f.alice.address);
      expect(await pool.fundingRate()).to.be.closeTo(p("0.10"), p("0.0001"));
      expect(await pool.fundingRateAt(WAD)).to.equal(p("0.10"));
    });
  });

  /* ------------------------------------------------------------ decision 25 */
  describe("Recoveries (§5.4, decision 25)", function () {
    beforeEach(async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(5_000));
      await f.lossCharge(U(1_000));
    });

    it("add back to the Deployed Balance, two-person with evidence, capped at the unrestored charges", async function () {
      expect(await pool.unrestoredCharges()).to.equal(U(1_000));
      const d0: bigint = await pool.deployedBalance();
      const sv0: bigint = await pool.shareValue();
      await expect(pool.connect(f.v1).postRecovery(U(400), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await pool.connect(f.v1).postRecovery(U(400), EVIDENCE);
      expect(await pool.deployedBalance()).to.equal(d0); // one signer proposes only
      await expect(pool.connect(f.v1).postRecovery(U(400), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      await expect(pool.connect(f.outsider).postRecovery(U(400), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      await expect(pool.connect(f.v2).postRecovery(U(400), EVIDENCE))
        .to.emit(pool, "RecoveryPosted").withArgs(U(400), U(600), EVIDENCE, f.v1.address, f.v2.address);
      expect(await pool.deployedBalance()).to.be.closeTo(d0 + U(400), U(0.01));
      expect(await pool.unrestoredCharges()).to.equal(U(600));
      expect(await pool.shareValue()).to.be.greaterThan(sv0 + ethers.parseUnits("0.039", 18));
      // No cash moved: a recovery is an accounting entry; cash follows as Returns.
      expect(await pool.vaultCash()).to.equal(U(5_000));

      const more = ethers.id("more");
      await pool.connect(f.v1).postRecovery(U(601), more);
      await expect(pool.connect(f.v2).postRecovery(U(601), more))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await f.two(f.v1, f.v2, "postRecovery", U(600), more);
      expect(await pool.unrestoredCharges()).to.equal(0n);
    });

    it("follow a loss charge's posting rules: none while a charge is being applied", async function () {
      await f.allowance(U(100));
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address); // opens a holdback
      await f.lossCharge(U(100));
      expect((await pool.pendingLossCharge()).pending).to.equal(true);
      expect(await pool.unrestoredCharges()).to.equal(U(1_100));
      await expect(pool.connect(f.v1).postRecovery(U(10), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolChargePending");
      await pool.applyHoldbacks(10);
      await f.two(f.v1, f.v2, "postRecovery", U(1_100), EVIDENCE);
      expect(await pool.unrestoredCharges()).to.equal(0n);
    });
  });

  /* ------------------------------------------------------------ decision 26 */
  describe("Valuation Event and the VALUATION_PENDING Suspension (Exh. A4, §7.1(d), decision 26)", function () {
    it("allows one VALUATION_PENDING Suspension per recorded event, ended by the allowance posting", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await expect(pool.connect(f.s1).suspend(VALUATION_PENDING, EVIDENCE, ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolNoValuationEvent");

      const event = ethers.id("Equity status");
      await expect(pool.connect(f.v1).recordValuationEvent(ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await pool.connect(f.v1).recordValuationEvent(event);
      expect((await pool.valuationEvent()).pending).to.equal(false); // two people
      await expect(pool.connect(f.v2).recordValuationEvent(event))
        .to.emit(pool, "ValuationEventRecorded").withArgs(event, f.v1.address, f.v2.address);
      expect((await pool.valuationEvent()).pending).to.equal(true);

      await pool.connect(f.s1).suspend(VALUATION_PENDING, EVIDENCE, ethers.ZeroHash);
      await pool.connect(f.cco).suspend(VALUATION_PENDING, EVIDENCE, ethers.ZeroHash);
      expect(await pool.isSuspended()).to.equal(true);
      const s = await pool.suspension();
      expect(s.expiresAt - s.startedAt).to.equal(BigInt(48 * HOUR)); // two Business Days at most
      await pool.connect(f.s2).liftSuspension();
      // Once per event, whatever the evidence.
      await expect(pool.connect(f.s1).suspend(VALUATION_PENDING, ethers.id("other"), ethers.id("resolution")))
        .to.be.revertedWithCustomError(pool, "LendingPoolNoValuationEvent");

      // A new event, a new Suspension; the allowance posting answers it and ends the Suspension.
      await f.two(f.v1, f.v2, "postAllowance", U(100), ethers.id("allowance")); // clears the first event
      expect((await pool.valuationEvent()).pending).to.equal(false);
      await f.two(f.v1, f.v2, "recordValuationEvent", ethers.id("second"));
      await f.two(f.s1, f.cco, "suspend", VALUATION_PENDING, ethers.id("second facts"), ethers.ZeroHash);
      expect(await pool.isSuspended()).to.equal(true);
      await pool.connect(f.v1).postAllowance(U(150), ethers.id("update"));
      const tx = await pool.connect(f.v2).postAllowance(U(150), ethers.id("update"));
      await expect(tx).to.emit(pool, "ValuationEventCleared");
      await expect(tx).to.emit(pool, "SuspensionLifted");
      expect(await pool.isSuspended()).to.equal(false);
      expect((await pool.valuationEvent()).pending).to.equal(false);
    });
  });

  /* ------------------------------------------------------------ decision 27 */
  describe("Legend (§8.4, decision 27)", function () {
    it("is written once at setup, and changed only after 7 days, by the admin (the Earn timelock)", async function () {
      expect(await pool.legend()).to.equal("");
      await expect(pool.connect(f.outsider).setLegend(LEGEND)).to.be.reverted;
      await expect(pool.setLegend("")).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await expect(pool.setLegend(LEGEND)).to.emit(pool, "LegendSet").withArgs(ethers.id(LEGEND), LEGEND);
      expect(await pool.legend()).to.equal(LEGEND);
      expect(await pool.legendHash()).to.equal(ethers.id(LEGEND));

      const next = LEGEND + " (amended)";
      await expect(pool.setLegend(next)).to.emit(pool, "LegendScheduled");
      expect(await pool.legend()).to.equal(LEGEND);
      const [text, effectiveAt] = await pool.pendingLegend();
      expect(text).to.equal(next);
      expect(effectiveAt).to.equal(BigInt(await latest()) + BigInt(7 * DAY));
      await increase(7 * DAY - 5);
      await expect(pool.applyLegend()).to.be.revertedWithCustomError(pool, "LendingPoolNotYet");
      await increase(5);
      await pool.connect(f.outsider).applyLegend();
      expect(await pool.legend()).to.equal(next);
      await expect(pool.applyLegend()).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
    });
  });

  /* ------------------------------------------------------------ decision 28 */
  describe("Direct USDC transfers (decision 28)", function () {
    it("count as Vault Cash and raise the Share Value at once, ratably for every Holder", async function () {
      await pool.connect(f.alice).deposit(U(6_000), f.alice.address);
      await pool.connect(f.bob).deposit(U(4_000), f.bob.address);
      const cash: bigint = await pool.vaultCash();
      await usdc.connect(f.outsider).transfer(f.poolAddress, U(1_000));
      expect(await pool.vaultCash()).to.equal(cash + U(1_000));
      expect(await pool.shareValue()).to.be.closeTo(ethers.parseUnits("1.1", 18), 10n ** 8n);
      expect(await pool.previewRedeem(U(6_000))).to.be.closeTo(U(6_600), 2n);
      expect(await pool.previewRedeem(U(4_000))).to.be.closeTo(U(4_400), 2n);
    });
  });

  /* ------------------------------------------------------------ decision 29 */
  describe("An empty pool restarts at $1.00 (decision 29)", function () {
    it("a donation into an empty pool is set aside, not captured by the first subscriber, and recognized over 30 days", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address);
      expect(await pool.totalSupply()).to.equal(0n);
      await usdc.connect(f.outsider).transfer(f.poolAddress, U(5_000));
      expect(await pool.shareValue()).to.equal(WAD);
      expect(await pool.previewDeposit(U(1_000))).to.equal(U(1_000));

      const tx = await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
      const start = BigInt(await latest());
      await expect(tx).to.emit(pool, "LeftoverSetAside").withArgs(U(5_000), start + BigInt(30 * DAY));
      expect(await pool.balanceOf(f.bob.address)).to.equal(U(1_000)); // exactly $1.00 a share
      expect(await pool.totalAssets()).to.equal(U(1_000));
      expect(await pool.shareValue()).to.equal(WAD);
      expect((await pool.leftover()).unrecognized).to.equal(U(5_000));

      // Leaving at once takes back the subscription and a second's recognition, no more.
      const b0: bigint = await usdc.balanceOf(f.bob.address);
      await pool.connect(f.bob).redeem(U(400), f.bob.address, f.bob.address);
      const got = (await usdc.balanceOf(f.bob.address)) - b0;
      expect(got).to.be.lessThan(U(400.01));

      // Recognized linearly: half at 15 days, all at 30, to whoever holds shares meanwhile.
      await setNext(Number(start) + 15 * DAY);
      await ethers.provider.send("evm_mine", []);
      const [, , half] = await pool.leftover();
      expect(half).to.be.closeTo(U(2_500), 2n);
      const sv15: bigint = await pool.shareValue();
      // A later subscriber pays the Share Value then, recognized part included.
      await pool.connect(f.carol).deposit(U(1_000), f.carol.address);
      expect(await pool.convertToAssets(await pool.balanceOf(f.carol.address))).to.be.closeTo(U(1_000), 2n);
      expect(sv15).to.be.greaterThan(ethers.parseUnits("4", 18));
      await setNext(Number(start) + 30 * DAY);
      await ethers.provider.send("evm_mine", []);
      expect((await pool.leftover()).unrecognized).to.equal(0n);
      expect(await pool.totalAssets()).to.be.closeTo(U(600) + U(1_000) + U(5_000) - got + U(400), U(0.01));
    });

    it("never counts Holdback Amounts, queued shares or unclaimed payments as leftover", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.allowance(U(100)); // 1%
      await pool.connect(f.alice).redeem(U(10_000), f.alice.address, f.alice.address);
      expect(await pool.totalSupply()).to.equal(0n);
      expect(await pool.totalHoldback()).to.equal(U(100));
      await usdc.connect(f.outsider).transfer(f.poolAddress, U(500));
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address))
        .to.emit(pool, "LeftoverSetAside").withArgs(U(500), BigInt(await latest()) + 1n + BigInt(30 * DAY));
      expect(await pool.balanceOf(f.bob.address)).to.equal(U(1_000));
      // The holdback stays Alice's.
      await f.allowance(0n);
      const a0: bigint = await usdc.balanceOf(f.alice.address);
      await pool.releaseHoldbacks(10);
      expect((await usdc.balanceOf(f.alice.address)) - a0).to.equal(U(100));
    });
  });

  /* ------------------------------------------------------------ §4.3 */
  describe("Deployment cap at the Pool Tier principal (§4.3)", function () {
    it("fails closed until the ceiling is posted, and refuses a Deployed Balance above it", async function () {
      const [admin, , , , v1, v2, d1, d2, , , , , lending] = await ethers.getSigners();
      const proxy: any = await upgrades.deployProxy(await ethers.getContractFactory("LendingPool"),
        [admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"], await poolProxyOptions());
      const p: any = await poolAt(await proxy.getAddress(), admin);
      await p.setEarnControls(await f.controls.getAddress());
      await p.setDeploymentAccount(lending.address);
      for (const s of [v1, v2]) await p.grantRole(await p.VALUATION_ROLE(), s.address);
      for (const s of [d1, d2]) await p.grantRole(await p.DEPLOYER_ROLE(), s.address);
      await usdc.connect(f.alice).approve(await p.getAddress(), ethers.MaxUint256);
      await p.connect(f.alice).deposit(U(10_000), f.alice.address);

      await p.connect(d1).deploy(U(1_000), ethers.ZeroHash);
      await expect(p.connect(d2).deploy(U(1_000), ethers.ZeroHash))
        .to.be.revertedWithCustomError(p, "LendingPoolTierCap").withArgs(U(1_000), 0n);
      await postTierCap(p, v1, v2, U(3_000));
      expect((await p.poolTierPrincipal()).value).to.equal(U(3_000));
      await p.connect(d2).deploy(U(1_000), ethers.ZeroHash);
      await p.connect(d1).deploy(U(2_000), ethers.id("2"));
      await p.connect(d2).deploy(U(2_000), ethers.id("2"));
      expect(await p.deployedBalance()).to.equal(U(3_000));
      await p.connect(d1).deploy(1n, ethers.id("3"));
      await expect(p.connect(d2).deploy(1n, ethers.id("3")))
        .to.be.revertedWithCustomError(p, "LendingPoolTierCap").withArgs(U(3_000) + 1n, U(3_000));
    });
  });

  /* ------------------------------------------------------------ §2.6 */
  describe("Low-Utilization clock (§2.6)", function () {
    it("records since when Utilization has stayed below 50%, and EarnControls pauses subscriptions after 30 days", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      const t0 = BigInt(await latest());
      expect(await pool.lowUtilizationSince()).to.equal(t0);
      await f.deploy(U(5_000)); // exactly 50%: not below
      expect(await pool.lowUtilizationSince()).to.equal(0n);
      await pool.connect(f.lending).returnFunds(U(1_000) + (await pool.accruedInterest()) + U(0.01));
      const t1 = BigInt(await latest());
      expect(await pool.lowUtilizationSince()).to.equal(t1);
      await increase(DAY);
      await pool.connect(f.alice).redeem(U(10), f.alice.address, f.alice.address);
      expect(await pool.lowUtilizationSince()).to.equal(t1); // still below: the clock keeps running

      const c = await withRealControls(f);
      await c.two(c.p1, c.p2, "setPauseFlag", LOW_UTILIZATION_RULE, true, ethers.id("2.9(c)"));
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address); // under 30 days
      await setNext(Number(t1) + 30 * DAY);
      await ethers.provider.send("evm_mine", []);
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolSubscriptionsPaused");
      // Utilization back at 50% or more ends the pause.
      await f.deploy(U(2_000));
      expect(await pool.lowUtilizationSince()).to.equal(0n);
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
    });
  });

  /* ------------------------------------------------------------ §6.5 */
  describe("Proceeds only to the Smart Account that held the shares (§6.5)", function () {
    it("refuses any other receiver, on demand or queued", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      for (const call of [
        pool.connect(f.alice).redeem(U(1), f.bob.address, f.alice.address),
        pool.connect(f.alice).withdraw(U(1), f.bob.address, f.alice.address),
        pool.connect(f.alice).requestWithdrawal(U(1), f.bob.address),
        pool.connect(f.alice).redeemOrQueue(U(1), f.bob.address),
      ]) await expect(call).to.be.revertedWithCustomError(pool, "LendingPoolReceiverNotOwner");
      // An approved spender may redeem for the Holder, paid to the Holder.
      await pool.connect(f.alice).approve(f.outsider.address, U(1));
      const a0: bigint = await usdc.balanceOf(f.alice.address);
      await pool.connect(f.outsider).redeem(U(1), f.alice.address, f.alice.address);
      expect((await usdc.balanceOf(f.alice.address)) - a0).to.equal(U(1));
    });
  });

  /* ------------------------------------------------------------ §7.3 */
  describe("Suspension time limits count the total for the same facts (§7.3)", function () {
    it("counts earlier suspensions on the same evidence toward 10 Business Days and 30 days", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await increase(70 * HOUR);
      await pool.connect(f.cco).renewSuspension(ethers.ZeroHash, ethers.ZeroHash);
      await increase(70 * HOUR);
      await pool.connect(f.s1).liftSuspension(); // 140 hours used
      await increase(DAY);
      // Same facts within 30 days: a resolution, and the clock resumes at 140 hours.
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.id("resolution"));
      const s = await pool.suspension();
      expect(BigInt(await latest()) - s.startedAt).to.be.closeTo(BigInt(140 * HOUR), 3n);
      await increase(70 * HOUR); // 210 hours; a renewal would reach 282
      await expect(pool.connect(f.cco).renewSuspension(ethers.ZeroHash, ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolResolutionRequired");
      await pool.connect(f.cco).renewSuspension(ethers.id("resolution"), ethers.ZeroHash);
      expect((await pool.suspension()).expiresAt).to.be.lessThanOrEqual(s.startedAt + BigInt(30 * DAY));
    });

    it("refuses a new suspension on facts that have used up their 30 days", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      const signers = [f.cco, f.s1];
      for (let i = 0; ; i++) {
        await increase(70 * HOUR);
        const s = await pool.suspension();
        if (s.expiresAt === s.startedAt + BigInt(30 * DAY)) break;
        await pool.connect(signers[i % 2]).renewSuspension(ethers.id("r"), ethers.ZeroHash);
      }
      await increase(3 * DAY);
      expect(await pool.isSuspended()).to.equal(false);
      await pool.connect(f.s1).suspend(LOSS_EVENT, EVIDENCE, ethers.id("r"));
      await expect(pool.connect(f.cco).suspend(LOSS_EVENT, EVIDENCE, ethers.id("r")))
        .to.be.revertedWithCustomError(pool, "LendingPoolSuspensionCeiling");
    });
  });

  /* ------------------------------------------------------------ §8.5 */
  describe("No Clear Lending key can move, burn or freeze a Pool Share (§8.5)", function () {
    it("only the admin (the Earn timelock) sets the encumbrance source, which decides what is locked", async function () {
      await pool.grantRole(await pool.OPERATOR_ROLE(), f.outsider.address);
      await expect(pool.connect(f.outsider).setEncumbranceSource(f.outsider.address, ethers.id("POOL_SHARE")))
        .to.be.reverted;
      await pool.setEncumbranceSource(ethers.ZeroAddress, ethers.ZeroHash);
    });

    it("the ledger's functions cannot be reached to move shares: its fallback has no share path", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      // Every role-holder in the fixture, trying a transfer of Alice's shares: refused.
      for (const who of [f.admin, f.v1, f.d1, f.s1, f.cco, f.lending]) {
        await expect(pool.connect(who).transferFrom(f.alice.address, who.address, 1n)).to.be.reverted;
      }
      // The view entry serves only the pool itself.
      await expect(pool.connect(f.admin).ledgerView(pool.interface.encodeFunctionData("utilization")))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
    });
  });

  /* ------------------------------------------------------------ §5.6, A6 */
  describe("Holdback Percentage at full precision (§1.2, §5.6(a), A6)", function () {
    it("rounds each Holdback Amount once, up, never by a percentage rounded to a basis point", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.allowance(U(150.5)); // 1.505%
      expect(await pool.holdbackRate()).to.equal(ethers.parseUnits("0.01505", 18));
      expect(await pool.holdbackBps()).to.equal(151n); // the rounded-up view kept for the apps
      const a0: bigint = await usdc.balanceOf(f.alice.address);
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address);
      expect(await pool.totalHoldback()).to.equal(U(15.05)); // not $15.10
      expect((await usdc.balanceOf(f.alice.address)) - a0).to.equal(U(984.95));
    });
  });

  /* ------------------------------------------------------------ Exhibit A, A10 */
  describe("Exhibit A, A10 worked example, as written: Utilization 80%, Funding Rate 5.00%", function () {
    // §5.6(d) and A2 as corrected (decision 33): the $52 applied from the holdback is added to Vault
    // Cash and the whole $900 charge reduces the Deployed Balance, so Pool Assets fall by $848 and
    // the remaining shares bear $848, as A10 says.
    it("holds $156, releases $104, applies the capped $52 of a $900 charge, takes $900 off the Deployed Balance, and the remaining shares bear $848", async function () {
      const cent = U(0.005);
      const { alice, lending } = f;
      // Pool Assets $100,000 at $1.04: Vault Cash $20,000 and Deployed Balance $80,000.
      await pool.connect(alice).deposit(96_153_846_153n, alice.address);
      await pool.connect(lending).returnFunds(3_846_153_847n);
      await f.deploy(U(80_000));
      expect(await pool.vaultCash()).to.equal(U(20_000));
      expect(await pool.deployedBalance()).to.equal(U(80_000));
      expect(await pool.utilization()).to.equal(ethers.parseUnits("0.8", 18));
      expect(await pool.fundingRate()).to.equal(ethers.parseUnits("0.05", 18));
      expect(await pool.shareValue()).to.be.closeTo(ethers.parseUnits("1.04", 18), ethers.parseUnits("0.000001", 18));

      // Loss Estimate $24,000 less Senior Loss Capacity $22,500: a $1,500 allowance, 1.5%.
      await f.allowance(U(1_500));
      expect(await pool.holdbackRate()).to.be.closeTo(ethers.parseUnits("0.015", 18), ethers.parseUnits("0.0000001", 18));
      const sv: bigint = await pool.shareValue();
      expect(sv).to.be.closeTo(ethers.parseUnits("1.04", 18), ethers.parseUnits("0.000001", 18)); // unchanged

      const before: bigint = await usdc.balanceOf(alice.address);
      const rc = await (await pool.connect(alice).redeem(U(10_000), alice.address, alice.address)).wait();
      const [recorded] = events(pool, rc, "HoldbackRecorded");
      expect(recorded.args.gross).to.be.closeTo(U(10_400), cent);
      expect(recorded.args.held).to.be.closeTo(U(156), cent);
      expect((await usdc.balanceOf(alice.address)) - before).to.be.closeTo(U(10_244), cent);
      expect(await pool.totalAssets()).to.be.closeTo(U(89_600), U(0.05));

      // Next month 0.5%: the Holdback Amount falls to $52 and $104 is paid to the Holder.
      await f.allowance(((await pool.totalAssets()) * 50n) / BPS);
      const b2: bigint = await usdc.balanceOf(alice.address);
      await pool.connect(f.outsider).releaseHoldbacks(10);
      expect((await usdc.balanceOf(alice.address)) - b2).to.be.closeTo(U(104), cent);
      expect((await pool.holdbackAt(0)).held).to.be.closeTo(U(52), cent);

      // The month after: a $900 charge on Pool Assets of about $89,600. Ratable $93.60, capped at $52.
      const assets: bigint = await pool.totalAssets();
      const tx = await f.lossCharge(U(900));
      const [posted] = events(pool, await tx.wait(), "LossChargePosted");
      expect((recorded.args.gross * U(900)) / posted.args.denominator).to.be.closeTo(U(93.6), cent);
      const done = await (await pool.applyHoldbacks(10)).wait();
      const [applied] = events(pool, done, "HoldbackApplied");
      const [completed] = events(pool, done, "LossChargeCompleted");
      expect(applied.args.amount).to.be.closeTo(U(52), cent);
      expect(completed.args.toDeployed).to.equal(U(900)); // the whole charge (decision 33)
      expect(completed.args.toInterest).to.equal(0n);
      expect(completed.args.paidOut).to.equal(0n);
      // Pool Assets fall by $848 (= $900 − $52): the remaining shares bear $848.
      expect(assets - (await pool.totalAssets())).to.be.closeTo(U(848), U(0.05));
      expect(await pool.holdbackOf(alice.address)).to.equal(0n);
    });
  });
});
