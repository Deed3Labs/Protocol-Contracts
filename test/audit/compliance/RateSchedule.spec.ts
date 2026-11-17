import { expect } from "chai";
import { ethers } from "hardhat";
import { CA, NY, P, CA_BANDS, ONE_USDC, CYCLE, params, deployRateSchedule, thirtyDays, snapshotOf } from "./rates";

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("COMPLIANCE RateSchedule (spec item 1)", function () {
  let rates: any, owner: any, other: any;

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    rates = await deployRateSchedule(owner.address);
    await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 300 }), CA_BANDS);
    await rates.setProduct(CA, P("PARTNER"), params({ listMonthlyBps: 200 }), CA_BANDS);
  });

  it("acceptance 1 (amended, Addendum 2): Boost at a 2.5% list rate accrues no more than $11.125 per 30 days on $500 (the cap's per-second share, ~$10.97)", async function () {
    await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 250 }), CA_BANDS);
    expect(await rates.capMonthlyBps(CA, P("BOOST"), 500n * ONE_USDC)).to.equal(222n); // 11.125/500 = 2.225%
    const snap = await snapshotOf(rates, CA, P("BOOST"));
    await advance(CYCLE);
    const [list, cap] = await rates.chargesSince(CA, P("BOOST"), 500n * ONE_USDC, snap);
    const expectedCap = thirtyDays(11_125_000n); // $11.125 × 360/365
    expect(cap).to.be.closeTo(expectedCap, 2_000n);
    expect(cap).to.be.lte(11_125_000n);
    expect(list).to.be.closeTo(thirtyDays(12_500_000n), 2_000n); // 2.5% of 500 = $12.50 a month
    // What is charged is the lesser: about $10.97, within $11.125.
    const charged = list < cap ? list : cap;
    expect(charged).to.be.closeTo(10_972_602n, 2_000n);
    expect(charged).to.be.lte(11_125_000n);
  });

  it("acceptance 2: partner credit at 2% is under the cap on $940 and trimmed to it on $1,500; breakeven $1,125", async function () {
    expect(await rates.effectiveMonthlyBps(CA, P("PARTNER"), 940n * ONE_USDC)).to.equal(200n);
    expect(await rates.effectiveMonthlyBps(CA, P("PARTNER"), 1_500n * ONE_USDC)).to.equal(187n); // 28.125/1500
    expect(await rates.capMonthlyBps(CA, P("PARTNER"), 1_125n * ONE_USDC)).to.equal(200n);

    const snap = await snapshotOf(rates, CA, P("PARTNER"));
    await advance(CYCLE);
    const [l940, c940] = await rates.chargesSince(CA, P("PARTNER"), 940n * ONE_USDC, snap);
    expect(l940).to.be.closeTo(thirtyDays(18_800_000n), 2_000n); // ~$18.54
    expect(c940).to.be.closeTo(thirtyDays(19_725_000n), 2_000n); // cap ~$19.46
    expect(l940).to.be.lt(c940);
    const [l1500, c1500] = await rates.chargesSince(CA, P("PARTNER"), 1_500n * ONE_USDC, snap);
    expect(c1500).to.be.closeTo(thirtyDays(28_125_000n), 2_000n); // ~$27.74
    expect(l1500).to.be.gt(c1500); // 2% ($30 a month) is trimmed to the cap
  });

  it("rate changes apply only going forward", async function () {
    const snap = await snapshotOf(rates, CA, P("BOOST"));
    await advance(CYCLE);
    await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 100 }), CA_BANDS);
    await advance(CYCLE);
    const [list] = await rates.chargesSince(CA, P("BOOST"), 1_000n * ONE_USDC, snap);
    // 30 days at 3% then 30 days at 1% on $1,000.
    expect(list).to.be.closeTo(thirtyDays(30_000_000n) + thirtyDays(10_000_000n), 50_000n);
  });

  it("the large-loan regime caps at the annual rate from the threshold up", async function () {
    const snap = await snapshotOf(rates, CA, P("PARTNER"));
    await advance(365 * 24 * 3600);
    const [, cap] = await rates.chargesSince(CA, P("PARTNER"), 3_000n * ONE_USDC, snap);
    expect(cap).to.be.closeTo((3_000n * ONE_USDC * 3_650n) / 10_000n, 1_000n); // 36.5% for a year
  });

  it("is governed: only the owner sets products; bands are fixed once set; unknown and disabled products read as such", async function () {
    await expect(rates.connect(other).setProduct(CA, P("X"), params(), CA_BANDS)).to.be.revertedWith("Ownable: caller is not the owner");
    const moved = CA_BANDS.map((b, i) => (i === 0 ? { ...b, upperBound: 300n * ONE_USDC } : b));
    await expect(rates.setProduct(CA, P("BOOST"), params(), moved)).to.be.revertedWithCustomError(rates, "RateScheduleBandsFixed");
    expect(await rates.isEnabled(NY, P("BOOST"))).to.equal(false);
    await rates.setProduct(CA, P("BOOST"), params({ enabled: false, listMonthlyBps: 300 }), CA_BANDS);
    expect(await rates.isEnabled(CA, P("BOOST"))).to.equal(false);
    await expect(rates.snapshot(NY, P("BOOST"))).to.be.revertedWithCustomError(rates, "RateScheduleUnknownProduct");
  });
});
