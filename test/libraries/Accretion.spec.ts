import { expect } from "chai";
import { ethers } from "hardhat";

/*
 * Phase 2f, stage 1: the compounding Accreted Value (Earn §1; IV-01 "Accreted Value"; MB-05
 * Schedule 1 "Present Value"), decisions 1 and 8 (C7).
 *
 * Every figure is checked against a reference computed here with BigInt at 60 decimal places.
 * The fuzz cases come from a fixed seed, so a failure reproduces.
 */
const U = (n: number | string) => ethers.parseUnits(String(n), 6);
const CENT = 10_000n; // USDC base units in a cent
const DAY = 86_400n;
const RAY = 10n ** 27n;
const SCALE = 10n ** 60n;

/* ------------------------------------------------------------ reference */

function powScaled(x: bigint, n: bigint): bigint {
  let r = SCALE;
  while (n > 0n) {
    if (n & 1n) r = (r * x) / SCALE;
    n >>= 1n;
    if (n > 0n) x = (x * x) / SCALE;
  }
  return r;
}

const rootCache = new Map<bigint, bigint>();
/** (1 + y)^(1/365) at 60 decimals. */
function root365(yieldBps: bigint): bigint {
  const hit = rootCache.get(yieldBps);
  if (hit) return hit;
  const base = SCALE + (yieldBps * SCALE) / 10_000n;
  let g = SCALE + (base - SCALE) / 365n;
  for (let i = 0; i < 200; i++) {
    const next = (364n * g + (base * SCALE) / powScaled(g, 364n)) / 365n;
    if (next >= g) break;
    g = next;
  }
  rootCache.set(yieldBps, g);
  return g;
}

/** (1 + y)^(days/365) at 60 decimals. */
function growth(yieldBps: bigint, days: bigint): bigint {
  const base = SCALE + (yieldBps * SCALE) / 10_000n;
  return (powScaled(base, days / 365n) * powScaled(root365(yieldBps), days % 365n)) / SCALE;
}

/** floor of the exact Present Value. */
function pvRef(maturityAmount: bigint, yieldBps: bigint, days: bigint): bigint {
  if (days === 0n || yieldBps === 0n) return maturityAmount;
  return (maturityAmount * SCALE) / growth(yieldBps, days);
}

/** a fixed-seed generator (xorshift64*). */
function rng(seed: bigint) {
  let s = seed;
  const next = () => {
    s ^= s >> 12n;
    s ^= (s << 25n) & 0xffffffffffffffffn;
    s ^= s >> 27n;
    return (s * 0x2545f4914f6cdd1dn) & 0xffffffffffffffffn;
  };
  return (lo: bigint, hi: bigint) => lo + (next() % (hi - lo + 1n));
}

describe("Accretion (compounding Accreted Value)", function () {
  let acc: any;

  before(async function () {
    acc = await (await ethers.getContractFactory("AccretionHarness")).deploy();
  });

  describe("the spec's worked figures", function () {
    it("IV-01 §7.3: a $2,500 bond at 5% for two years is bought for $2,267.57; at 30% the reserve is $750.00 and $1,517.57 may go", async function () {
      const price: bigint = await acc.purchasePrice(U(2_500), 500, 730);
      // 2,500 / 1.05^2 = 2,267.573696...: the exact value, to the micro-dollar, rounded down.
      expect(price).to.equal(2_267_573_696n);
      const toCent = price - (price % CENT);
      expect(toCent).to.equal(U("2267.57"));
      const reserve = (U(2_500) * 3_000n) / 10_000n;
      expect(reserve).to.equal(U(750));
      expect(toCent - reserve).to.equal(U("1517.57"));
    });

    it("MB-05 Schedule 1: face ÷ (1 + issue yield)^(years to maturity), on whole years", async function () {
      expect(await acc.presentValue(U(1_000), 500, 365)).to.equal(952_380_952n); // 1,000 / 1.05
      expect(await acc.presentValue(U(1_050), 500, 365)).to.equal(U(1_000));
      expect(await acc.presentValue(U(1_000), 0, 3_650)).to.equal(U(1_000));
    });
  });

  describe("properties", function () {
    it("equals the Purchase Price at issue and the Maturity Amount on and after maturity", async function () {
      const r = rng(0x5eedn);
      for (let i = 0; i < 40; i++) {
        const m = r(U(250), U(5_000_000));
        const y = r(0n, 5_000n);
        const term = r(1n, 10_950n);
        const issue = r(1_700_000_000n, 2_000_000_000n);
        const maturity = issue + term * DAY;
        const price: bigint = await acc.purchasePrice(m, y, term);
        expect(await acc.accretedValue(m, y, maturity, issue)).to.equal(price);
        expect(await acc.accretedValue(m, y, maturity, maturity)).to.equal(m);
        expect(await acc.accretedValue(m, y, maturity, maturity + r(1n, 10n ** 9n))).to.equal(m);
      }
    });

    it("never decreases with time, and steps up only at day boundaries", async function () {
      const r = rng(0xacc0de5n);
      for (let i = 0; i < 12; i++) {
        const m = r(U(250), U(5_000_000));
        const y = r(1n, 5_000n);
        const term = r(1n, 3_650n);
        const issue = 1_800_000_000n;
        const maturity = issue + term * DAY;
        let last = 0n;
        const times = Array.from({ length: 10 }, () => r(issue, maturity + DAY)).sort((a, b) => (a < b ? -1 : 1));
        for (const t of [issue, ...times, maturity - 1n, maturity]) {
          const v: bigint = await acc.accretedValue(m, y, maturity, t);
          expect(v).to.be.greaterThanOrEqual(last);
          last = v;
        }
        // Within a day the value does not move; across the boundary it rises.
        const t = issue + DAY;
        expect(await acc.accretedValue(m, y, maturity, t + 1n)).to.equal(await acc.accretedValue(m, y, maturity, t + DAY - 1n));
        if (term > 1n) {
          expect(await acc.accretedValue(m, y, maturity, t + DAY)).to.be.greaterThan(await acc.accretedValue(m, y, maturity, t));
        }
      }
    });

    it("rounds down: never above the exact value, and never more than one base unit below it", async function () {
      const r = rng(0xf00dn);
      for (let i = 0; i < 120; i++) {
        const m = r(1n, 10n ** 15n);
        const y = r(0n, 5_000n);
        const days = r(0n, 10_950n);
        const v: bigint = await acc.presentValue(m, y, days);
        const ref = pvRef(m, y, days);
        expect(v <= ref && v >= ref - 1n, `pv(${m}, ${y}, ${days}) = ${v}, exact floor ${ref}`).to.equal(true);
      }
    });

    it("bounds the growth factor from above and below, as the rounding needs", async function () {
      const r = rng(0xbeefn);
      for (let i = 0; i < 40; i++) {
        const y = r(1n, 5_000n);
        const days = r(1n, 10_950n);
        const exact = growth(y, days);
        const up: bigint = await acc.growthUp(y, days);
        const down: bigint = await acc.growthDown(y, days);
        const slack = 10n ** 30n; // the reference's own error, far below one RAY unit (10^33 here)
        expect(up * 10n ** 33n + slack >= exact).to.equal(true);
        expect(down * 10n ** 33n <= exact + slack).to.equal(true);
        // Tight: within a millionth of a millionth of a cent on a $1bn bond.
        expect((up - down) * 10n ** 18n < RAY).to.equal(true);
      }
    });

    it("rolls by IV-01 §5.2: the new Maturity Amount rounded down to the cent, no more USDC than the old bond, the rest paid out", async function () {
      const r = rng(0x5011n);
      for (let i = 0; i < 40; i++) {
        const old = r(U(250), U(5_000_000));
        const y = r(0n, 5_000n);
        const term = r(1n, 3_650n);
        const [newM, price, remainder] = await acc.rollTerms(old, y, term, CENT);
        expect(newM % CENT).to.equal(0n);
        expect(price <= old).to.equal(true);
        expect(price + remainder).to.equal(old);
        // Exactly old × (1 + y)^(t/365), rounded down to the cent (one cent less only at a boundary).
        const exact = (old * growth(y, term)) / SCALE;
        const floorCent = exact - (exact % CENT);
        expect(newM === floorCent || newM === floorCent - CENT).to.equal(true);
        // The remainder is under what a cent (two at a boundary) of Maturity Amount would cost.
        expect(remainder <= 2n * pvRef(CENT, y, term) + 2n).to.equal(true);
      }
    });
  });

  it("refuses yields and terms outside the bounds its error analysis covers", async function () {
    await expect(acc.presentValue(U(1_000), 5_001, 365)).to.be.revertedWithCustomError(acc, "AccretionOutOfRange");
    await expect(acc.presentValue(U(1_000), 500, 10_951)).to.be.revertedWithCustomError(acc, "AccretionOutOfRange");
    expect(await acc.daysRemaining(1_000_000n, 1_000_000n - 1n)).to.equal(1n);
    expect(await acc.daysRemaining(1_000_000n, 1_000_000n - DAY)).to.equal(1n);
    expect(await acc.daysRemaining(1_000_000n, 1_000_000n - DAY - 1n)).to.equal(2n);
  });

  it("costs a bounded amount of gas", async function () {
    const [, gas] = await acc.accretedValueGas(U(10_000), 500, 1_800_000_000n + 3_700n * DAY, 1_800_000_000n);
    expect(gas).to.be.lessThan(100_000n);
    console.log(`      Accreted Value, 3,700 days at 5% (a part year, so a root): ${gas} gas`);
  });
});
