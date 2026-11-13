import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { CA, P, CA_BANDS, ONE_USDC, CYCLE, DAY, params, deployRateSchedule, thirtyDays } from "./rates";
import { issuerProxyOptions } from "../../helpers/issuers";

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/*
 * Section 12 (credit agreements addendum, with the owner's correction to 12.1 and 12.2) on the
 * revolving line: auto-clear from Spendable, the unsecured cap, Boost earned by Clean Cycles and
 * deposits, a missed cycle halving the limit, default after two misses and the cure window, and
 * Savings drawn by card only with the member's own authorization. Acceptance 18-22, 24, 25.
 */
describe("COMPLIANCE section 12: the revolving line", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let revolving: any, rates: any, coop: any, settler: any, float: any;
  const SAVINGS = 0, INCOME = 1, BOOST = 2;
  const GRACE = 5 * DAY;
  const TERMS = {
    unsecuredLineCap: 2_499n * ONE_USDC,
    cureWindow: 15 * DAY,
    boostCleanCycles: 6,
    boostDepositCycles: 5,
    autoClearOffGlobal: false,
  };

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    coop = signers[8];
    settler = signers[9];
    float = signers[10];
    const R = await ethers.getContractFactory("RevolvingIssuer");
    revolving = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")),  kind: "uups" });
    await ctx.networkRegistry.registerIssuer(
      await revolving.getAddress(), await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(), await ctx.assuranceOracle.getAddress());
    await ctx.access.grantOperator(await revolving.getAddress());
    for (const [name, rate] of [["SAVINGS", 0n], ["INCOME", 150n], ["BOOST", 300n]] as const) {
      await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, CYCLE);
    }
    rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
    await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 300 }), CA_BANDS);
    await rates.setProduct(CA, P("REVOLVING"), params({ listMonthlyBps: 0 }), CA_BANDS);
    await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
    await revolving.connect(ctx.operator).setTierProduct(INCOME, P("INCOME"));
    await revolving.connect(ctx.operator).setTierProduct(BOOST, P("BOOST"));
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    await ctx.networkRegistry.attestStateCode(ctx.member.address, CA);
    await revolving.connect(ctx.operator).setCreditTerms(TERMS, 500n * ONE_USDC, 750n * ONE_USDC);
    await revolving.connect(ctx.operator).setCardSettler(settler.address, true);
    await revolving.connect(ctx.operator).setCardSettlementAccount(float.address);
  });

  async function open(savings: bigint, income: bigint, boost: bigint) {
    await revolving.connect(ctx.operator).openLine(ctx.member.address, [savings, income, boost].map((n) => n * ONE_USDC), CYCLE, GRACE);
  }
  async function spend(amount: bigint) {
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount * ONE_USDC);
  }
  /** Ends the cycle and its grace window, and has the chain judge it. Anyone may. */
  async function judge() {
    await advance(CYCLE + GRACE + 1);
    await revolving.connect(coop).syncCreditPeriod(ctx.member.address);
  }
  async function fundSettler() {
    await ctx.usdc.mint(settler.address, 10_000n * ONE_USDC);
    await ctx.usdc.connect(settler).approve(await revolving.getAddress(), ethers.MaxUint256);
  }

  it("acceptance 20: the unsecured line never exceeds $2,499; Boost is capped at $500 until earned", async function () {
    await expect(open(0n, 2_000n, 500n)).to.be.revertedWithCustomError(revolving, "RevolvingIssuerUnsecuredCap");
    await open(0n, 1_999n, 500n);
    await expect(revolving.connect(ctx.operator).setTierCapacity(ctx.member.address, INCOME, 2_000n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerUnsecuredCap");
    await revolving.connect(ctx.operator).setTierCapacity(ctx.member.address, INCOME, 1_000n * ONE_USDC);
    await expect(revolving.connect(ctx.operator).setTierCapacity(ctx.member.address, BOOST, 600n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerBoostCap");
    // Carry on income-backed and Boost together stays within the graduated cap on the combined
    // principal (the member ceiling, acceptance 3): $1,500 drawn is capped at $28.125 a month.
    await spend(1_500n);
    await advance(CYCLE);
    await revolving.materialiseCarry(ctx.member.address);
    const both = (await revolving.carryOf(ctx.member.address, INCOME)) + (await revolving.carryOf(ctx.member.address, BOOST));
    expect(both).to.be.lte(thirtyDays(28_125_000n) + 5_000n);
  });

  it("12.4: Boost rises to $750 only after 6 Clean Cycles with ESA deposits in at least 5 of the last 6", async function () {
    const Source = await ethers.getContractFactory("MockDepositSource");
    const source: any = await Source.deploy();
    await revolving.connect(ctx.operator).setDepositSource(await source.getAddress());
    await open(0n, 1_000n, 500n);
    for (let cycle = 0; cycle < 6; cycle++) {
      if (cycle !== 2) await source.deposit(ctx.member.address); // 5 of 6
      await judge();
      if (cycle < 5) expect(await revolving.boostCapOf(ctx.member.address)).to.equal(500n * ONE_USDC);
    }
    expect((await revolving.cycleOf(ctx.member.address)).cleanStreak).to.equal(6n);
    expect(await revolving.boostCapOf(ctx.member.address)).to.equal(750n * ONE_USDC);
    await revolving.connect(ctx.operator).setTierCapacity(ctx.member.address, BOOST, 750n * ONE_USDC);
  });

  it("12.4: four deposits in six cycles is not enough", async function () {
    const Source = await ethers.getContractFactory("MockDepositSource");
    const source: any = await Source.deploy();
    await revolving.connect(ctx.operator).setDepositSource(await source.getAddress());
    await open(0n, 1_000n, 500n);
    for (let cycle = 0; cycle < 6; cycle++) {
      if (cycle % 3 !== 0) await source.deposit(ctx.member.address); // 4 of 6
      await judge();
    }
    expect(await revolving.boostCapOf(ctx.member.address)).to.equal(500n * ONE_USDC);
  });

  it("acceptance 21: nothing in any contract reads or stores Acceleration", async function () {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.endsWith(".sol")) files.push(p);
      }
    };
    walk(path.join(__dirname, "../../../contracts"));
    const hits = files.filter((f) => /accelerat/i.test(fs.readFileSync(f, "utf8")));
    expect(hits).to.deep.equal([]);
    // And the Boost cap is a function of judged cycles and deposits alone.
    expect(revolving.interface.getFunction("boostCapOf")!.inputs.length).to.equal(1);
  });

  it("acceptance 22 (issuer): a missed cycle halves the unsecured limit and leaves Savings alone; default needs a second miss and the cure window", async function () {
    await open(200n, 1_000n, 500n);
    await spend(1_700n); // savings 200, income 1,000, boost 500
    const savingsDrawn = await revolving.drawnOf(ctx.member.address, SAVINGS);
    await expect(judge()).to.not.be.reverted;
    const c1 = await revolving.cycleOf(ctx.member.address);
    expect(c1.missedInRow).to.equal(1n);
    expect(await revolving.capacityOf(ctx.member.address, INCOME)).to.equal(500n * ONE_USDC);
    expect(await revolving.capacityOf(ctx.member.address, BOOST)).to.equal(250n * ONE_USDC);
    expect(await revolving.capacityOf(ctx.member.address, SAVINGS)).to.equal(200n * ONE_USDC);
    expect(await revolving.drawnOf(ctx.member.address, SAVINGS)).to.equal(savingsDrawn);
    expect(await revolving.unsecuredExcessOf(ctx.member.address)).to.be.gte(750n * ONE_USDC);
    expect(await revolving.inDefault(ctx.member.address)).to.equal(false);
    // The halved ceiling holds: capacity can't be pushed back up until a Clean Cycle.
    await expect(revolving.connect(ctx.operator).setTierCapacity(ctx.member.address, INCOME, 1_100n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerUnsecuredCap");

    // Second miss in a row: the chain dates the cure notice; still no default for 15 days.
    await advance(CYCLE + GRACE + 1);
    await expect(revolving.connect(coop).syncCreditPeriod(ctx.member.address)).to.emit(revolving, "CureNotice");
    expect(await revolving.inDefault(ctx.member.address)).to.equal(false);
    await advance(15 * DAY - 60);
    expect(await revolving.inDefault(ctx.member.address)).to.equal(false);
    await advance(61);
    expect(await revolving.inDefault(ctx.member.address)).to.equal(true);
    await revolving.connect(coop).syncCreditPeriod(ctx.member.address);
    expect(await revolving.hasDefaulted(ctx.member.address)).to.equal(true);
  });

  it("12.5: rebalancing during the cure window clears the record; a Clean Cycle lifts the halved ceiling", async function () {
    await open(0n, 1_000n, 500n);
    await spend(600n);
    await judge(); // first miss
    await ctx.usdc.mint(ctx.member.address, 1_000n * ONE_USDC);
    await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
    // Repay to zero: a repayment brings carry on first, so a second pass clears the seconds' dust.
    for (let i = 0; i < 3 && (await ctx.stableCredit.creditBalanceOf(ctx.member.address)) > 0n; i++) {
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, await ctx.stableCredit.creditBalanceOf(ctx.member.address));
    }
    await judge(); // clean
    const c = await revolving.cycleOf(ctx.member.address);
    expect(c.missedInRow).to.equal(0n);
    expect(c.unsecuredCeiling).to.equal(0n);
    await revolving.connect(ctx.operator).setTierCapacity(ctx.member.address, INCOME, 1_000n * ONE_USDC);
  });

  it("acceptance 18: auto-clear ON, UNSECURED_ONLY: a Spendable deposit clears Boost then income-backed and stops; secured tiers unchanged, the rest stays spendable", async function () {
    await open(200n, 1_000n, 500n);
    await spend(1_700n);
    await revolving.connect(ctx.member).setAutoClear(true, 0);
    await fundSettler();
    await ctx.usdc.mint(ctx.member.address, 300n * ONE_USDC); // Ready to allocate: never swept
    const savingsBefore = await revolving.drawnOf(ctx.member.address, SAVINGS);
    const unsecured = (await revolving.drawnOf(ctx.member.address, INCOME)) + (await revolving.drawnOf(ctx.member.address, BOOST));
    const deposit = 1_600n * ONE_USDC;
    const tx = revolving.connect(settler).repayForMember(ethers.id("receipt:1"), ctx.member.address, deposit);
    await expect(tx).to.emit(revolving, "AutoCleared");
    expect(await revolving.drawnOf(ctx.member.address, BOOST)).to.equal(0n);
    expect(await revolving.drawnOf(ctx.member.address, INCOME)).to.equal(0n);
    expect(await revolving.drawnOf(ctx.member.address, SAVINGS)).to.equal(savingsBefore);
    // What was not needed stays spendable: the settler delivered only what cleared the line.
    expect(await ctx.usdc.balanceOf(settler.address)).to.be.closeTo(10_000n * ONE_USDC - unsecured, 50_000n);
    expect(await ctx.usdc.balanceOf(ctx.member.address)).to.equal(300n * ONE_USDC);
  });

  it("acceptance 19: auto-clear OFF: a deposit changes nothing; a member-signed Repay clears most-expensive-first", async function () {
    await open(0n, 1_000n, 500n);
    await spend(1_500n);
    await fundSettler();
    await expect(revolving.connect(settler).repayForMember(ethers.id("receipt:2"), ctx.member.address, 500n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerAutoRepayNotEnabled");
    const income = await revolving.drawnOf(ctx.member.address, INCOME);
    const boost = await revolving.drawnOf(ctx.member.address, BOOST);
    await ctx.usdc.mint(ctx.member.address, 300n * ONE_USDC);
    await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
    await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, 300n * ONE_USDC);
    expect(await revolving.drawnOf(ctx.member.address, BOOST)).to.be.closeTo(boost - 300n * ONE_USDC, 50_000n);
    expect(await revolving.drawnOf(ctx.member.address, INCOME)).to.be.closeTo(income, 50_000n);
  });

  it("12.2: onboarding turns auto-clear on by the member's signature; a replay or anyone else's signature fails; only the member changes it", async function () {
    const { chainId } = await ethers.provider.getNetwork();
    const domain = { name: "Clear RevolvingIssuer", version: "1", chainId, verifyingContract: await revolving.getAddress() };
    const types = { AutoClear: [
      { name: "member", type: "address" }, { name: "on", type: "bool" }, { name: "scope", type: "uint8" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    const value = { member: ctx.member.address, on: true, scope: 0, nonce: 0n, deadline: ethers.MaxUint256 };
    const sig = await ctx.member.signTypedData(domain, types, value);
    await revolving.connect(ctx.operator).setAutoClearWithSignature(ctx.member.address, true, 0, ethers.MaxUint256, sig);
    expect(await revolving.autoRepayEnabled(ctx.member.address)).to.equal(true);
    await expect(revolving.connect(ctx.operator).setAutoClearWithSignature(ctx.member.address, true, 0, ethers.MaxUint256, sig))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerBadSignature");
    const forged = await ctx.counterparty.signTypedData(domain, types, { ...value, on: false, nonce: 1n });
    await expect(revolving.connect(ctx.operator).setAutoClearWithSignature(ctx.member.address, false, 0, ethers.MaxUint256, forged))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerBadSignature");
    await revolving.connect(ctx.member).setAutoClear(false, 0);
    expect(await revolving.autoRepayEnabled(ctx.member.address)).to.equal(false);
    // The network-wide switch (governed) stops it for everyone.
    await revolving.connect(ctx.member).setAutoClear(true, 0);
    await revolving.connect(ctx.operator).setCreditTerms({ ...TERMS, autoClearOffGlobal: true }, 500n * ONE_USDC, 750n * ONE_USDC);
    await expect(revolving.connect(settler).repayForMember(ethers.id("r"), ctx.member.address, ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerAutoClearOff");
  });

  it("acceptance 24: card spending draws on Savings only as far as the member authorized; no admin write raises Savings drawn", async function () {
    await open(500n, 0n, 0n);
    await expect(revolving.connect(settler).authorizeCardSpend(ethers.id("c1"), ctx.member.address, 100n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerCardHeadroom");
    await revolving.connect(ctx.member).setSavingsDrawAllowance(100n * ONE_USDC);
    await revolving.connect(settler).authorizeCardSpend(ethers.id("c1"), ctx.member.address, 100n * ONE_USDC);
    await revolving.connect(settler).settleCardSpend(ethers.id("c1"), ctx.member.address, 100n * ONE_USDC);
    expect(await revolving.drawnOf(ctx.member.address, SAVINGS)).to.equal(100n * ONE_USDC);
    expect(await revolving.savingsDrawAllowance(ctx.member.address)).to.equal(0n);
    // An admin raising capacity raises no drawn amount, and does not restore the allowance.
    await revolving.connect(ctx.operator).setTierCapacity(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
    expect(await revolving.drawnOf(ctx.member.address, SAVINGS)).to.equal(100n * ONE_USDC);
    await expect(revolving.connect(settler).authorizeCardSpend(ethers.id("c2"), ctx.member.address, 50n * ONE_USDC))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerCardHeadroom");
    // Only the member, or their signature, sets it.
    const { chainId } = await ethers.provider.getNetwork();
    const domain = { name: "Clear RevolvingIssuer", version: "1", chainId, verifyingContract: await revolving.getAddress() };
    const types = { SavingsDrawAllowance: [
      { name: "member", type: "address" }, { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    const nonce = await revolving.memberNonces(ctx.member.address);
    const bad = await ctx.operator.signTypedData(domain, types, { member: ctx.member.address, amount: 10n ** 30n, nonce, deadline: ethers.MaxUint256 });
    await expect(revolving.connect(ctx.operator).setSavingsDrawAllowanceWithSignature(ctx.member.address, 10n ** 30n, ethers.MaxUint256, bad))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerBadSignature");
    const good = await ctx.member.signTypedData(domain, types, { member: ctx.member.address, amount: 50n * ONE_USDC, nonce, deadline: ethers.MaxUint256 });
    await revolving.connect(ctx.operator).setSavingsDrawAllowanceWithSignature(ctx.member.address, 50n * ONE_USDC, ethers.MaxUint256, good);
    await revolving.connect(settler).authorizeCardSpend(ethers.id("c2"), ctx.member.address, 50n * ONE_USDC);
  });

  it("acceptance 25: a full 30-day cycle accrues no more than the monthly cap on any position", async function () {
    await open(0n, 1_000n, 500n);
    await spend(1_500n);
    await advance(CYCLE);
    await revolving.materialiseCarry(ctx.member.address);
    // Income-backed and Boost are ONE loan for the cap (12.3), so the position is the two together;
    // each tier's own list carry also stays within the cap on its own principal where it is the dearer.
    const capOn = (p: bigint) => p <= 900n * ONE_USDC
      ? 5_625_000n + ((p - 225n * ONE_USDC) * 200n) / 10_000n
      : 19_125_000n + ((p - 900n * ONE_USDC) * 150n) / 10_000n;
    const income = await revolving.carryOf(ctx.member.address, INCOME);
    const boost = await revolving.carryOf(ctx.member.address, BOOST);
    expect(income + boost).to.be.lte(capOn(1_500n * ONE_USDC));
    expect(income).to.be.lte(capOn(1_000n * ONE_USDC));
  });
});
