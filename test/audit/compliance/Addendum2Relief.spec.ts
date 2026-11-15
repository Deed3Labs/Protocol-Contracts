import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { issuerProxyOptions } from "../../helpers/issuers";
import { attesters, passCycleEnd } from "../../helpers/default";
import { deployCore } from "../deep/deep-setup";
import { signedOpenPlan } from "../../helpers/plans";
import { CA, P, CA_BANDS, ONE_USDC, CYCLE, DAY, params, deployRateSchedule } from "./rates";
import { pledgeItemSigned } from "../../helpers/pledge";
import { deployBondFactory } from "../../helpers/bonds";

/*
 * Phase 2e, the two gaps closed at the owner's request (addendum-2-references.md):
 *  - 12.13 Cycle Assurance (`graceCycle`), and Income Assurance checked against the same text;
 *  - 12.14 default of a term plan secured under MB-05: 60 days past due, a two-person cure-notice
 *    timestamp, 30 days after it with the past-due amount unpaid; fail closed; the Liquidation Hold.
 */
const usd = (n: number | bigint) => BigInt(n) * ONE_USDC;

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}
async function at(t: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [t]);
}
async function now() {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

describe("ADDENDUM 2 references, 12.13: Cycle Assurance (graceCycle) and Income Assurance", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let revolving: any;
  const INCOME = 2;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const s = await ethers.getSigners();
    revolving = await upgrades.deployProxy(await ethers.getContractFactory("RevolvingIssuer"),
      [await ctx.stableCredit.getAddress(), s[8].address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
    await ctx.networkRegistry.registerIssuer(await revolving.getAddress(), await ctx.stableCredit.getAddress());
    await ctx.access.grantOperator(await revolving.getAddress());
    for (const [name, rate] of [["SAVINGS", 0n], ["ASSET_INTERNAL", 65n], ["INCOME", 150n], ["BOOST", 250n]] as const) {
      await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, CYCLE);
    }
    const rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
    await rates.setProduct(CA, P("REVOLVING"), params({ listMonthlyBps: 0 }), CA_BANDS);
    await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
    await revolving.connect(ctx.operator).setTierProduct(INCOME, P("INCOME"));
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    for (const m of [ctx.member, ctx.counterparty]) {
      await ctx.networkRegistry.attestStateCode(m.address, CA);
      await ctx.usdc.mint(m.address, usd(10_000));
      await ctx.usdc.connect(m).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
    }
    await revolving.connect(ctx.operator).setCreditTerms(
      { unsecuredLineCap: 0, cureWindow: 15 * DAY, boostCleanCycles: 0, boostDepositCycles: 0, autoClearOffGlobal: false }, 0, 0);
    await revolving.connect(ctx.operator).setDueTerms(100, ONE_USDC, 0, 3);
  });

  async function openAndDraw(member: any, amount: bigint) {
    await revolving.connect(ctx.operator).openLine(member.address, [0n, 0n, usd(1_000), 0n], 0);
    await ctx.stableCredit.connect(member).transfer(ctx.counterparty.address, amount);
  }
  async function eligible(member: string) {
    const [a, b] = await attesters(revolving);
    await revolving.connect(a).proposeGraceEligibility(member);
    await revolving.connect(b).approveGraceEligibility(member);
  }

  it("eligibility is set only by two signers, can only enable relief, and moves nothing", async function () {
    const [a, b] = await attesters(revolving);
    const m = ctx.member.address;
    await openAndDraw(ctx.member, usd(300));
    const drawn = await revolving.totalPrincipalOf(m);
    await expect(revolving.connect(ctx.outsider).proposeGraceEligibility(m))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
    await expect(revolving.connect(a).approveGraceEligibility(m))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerNoProposal");
    await revolving.connect(a).proposeGraceEligibility(m);
    await expect(revolving.connect(a).approveGraceEligibility(m))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerSameSigner");
    await expect(revolving.connect(b).approveGraceEligibility(m)).to.emit(revolving, "GraceEligibilitySet");
    expect((await revolving.cycleStateOf(m)).graceEligible).to.equal(true);
    // Nothing raised the drawn amount, and there is no way to withdraw eligibility or spend a grace.
    expect(await revolving.totalPrincipalOf(m)).to.equal(drawn);
    const names = revolving.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    // (graceExpirationOf, inGracePeriod and setGraceLengthOf are the base credit period's, and the
    // setter reverts on this line.)
    expect(names.filter((n: string) => /grace/i.test(n) && !/GracePeriod|GraceLength|graceExpiration/.test(n)).sort())
      .to.deep.equal(["approveGraceEligibility", "proposeGraceEligibility", "setGraceTerms"]);
  });

  it("an eligible member's unpaid Rebalance Amount uses a grace automatically, at most once per rolling 365 days: no halving, nothing settles, no count toward default", async function () {
    const m = ctx.member.address;
    await openAndDraw(ctx.member, usd(500));
    await eligible(m);
    await passCycleEnd(revolving, m); // the close: $500 is due
    // Unpaid at its due point: the grace is used, the line untouched.
    const owedBefore = await revolving.principalOnlyOf(m, INCOME);
    const cashBefore = await ctx.usdc.balanceOf(m);
    await expect(passCycleEnd(revolving, m)).to.not.be.reverted;
    expect(await revolving.principalOnlyOf(m, INCOME)).to.equal(owedBefore); // nothing settled or written off
    expect(await ctx.usdc.balanceOf(m)).to.equal(cashBefore); // nothing collected
    expect(await revolving.hasDefaulted(m)).to.equal(false);
    let c = await revolving.cycleOf(m);
    expect(c.missedInRow).to.equal(0n);
    expect(await revolving.capacityOf(m, INCOME)).to.equal(usd(1_000));
    expect(await revolving.unsecuredExcessOf(m)).to.equal(0n);
    expect((await revolving.cycleStateOf(m)).graceUses & ((1n << 64n) - 1n)).to.be.gt(0n);
    // Unpaid again within the window: an ordinary miss now (halved).
    await passCycleEnd(revolving, m);
    c = await revolving.cycleOf(m);
    expect(c.missedInRow).to.equal(1n);
    expect(await revolving.capacityOf(m, INCOME)).to.equal(usd(500));

    // Paid up and clean for a year: a grace is available again.
    for (let i = 0; i < 3 && (await ctx.stableCredit.creditBalanceOf(m)) > 0n; i++) {
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(m, await ctx.stableCredit.creditBalanceOf(m));
    }
    for (let k = 0; k < 13; k++) await passCycleEnd(revolving, m);
    expect((await revolving.cycleOf(m)).missedInRow).to.equal(0n);
    await revolving.connect(ctx.operator).setTierCapacity(m, INCOME, usd(1_000));
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, usd(100));
    await passCycleEnd(revolving, m); // close on $100
    await at(Number((await revolving.cycleStateOf(m)).cycleEnd) + 1);
    await expect(revolving.syncCreditPeriod(m)).to.emit(revolving, "GraceCycleUsed"); // unpaid: a new window's grace
    expect((await revolving.cycleOf(m)).missedInRow).to.equal(0n);
  });

  it("without eligibility the same unpaid cycle is a miss; the governed window and count apply", async function () {
    const m = ctx.member.address;
    await openAndDraw(ctx.member, usd(500));
    await passCycleEnd(revolving, m);
    await passCycleEnd(revolving, m);
    expect((await revolving.cycleOf(m)).missedInRow).to.equal(1n);
    // Two graces per window are governed; more than four is refused (a gas bound).
    await expect(revolving.connect(ctx.outsider).setGraceTerms(2, 365 * DAY))
      .to.be.revertedWithCustomError(revolving, "CreditIssuerMissingRole");
    await expect(revolving.connect(ctx.operator).setGraceTerms(5, 365 * DAY))
      .to.be.revertedWithCustomError(revolving, "RevolvingIssuerPauseTooLong");
    await revolving.connect(ctx.operator).setGraceTerms(2, 365 * DAY);
    expect((await revolving.dueTermsOf()).graceCyclesPerWindow).to.equal(2n);
  });

  it("Income Assurance: a second attestation can only lengthen it; only expiry or the member ends it early", async function () {
    const m = ctx.member.address;
    await openAndDraw(ctx.member, usd(500));
    const [a, b] = await attesters(revolving);
    await revolving.connect(a).proposeIncomePause(m, 3, ethers.id("hardship-1"));
    await revolving.connect(b).approveIncomePause(m, 3, ethers.id("hardship-1"));
    await revolving.connect(a).proposeIncomePause(m, 1, ethers.id("hardship-1"));
    await revolving.connect(b).approveIncomePause(m, 1, ethers.id("hardship-1"));
    expect((await revolving.cycleStateOf(m)).incomePause).to.equal(3n); // not shortened
    await revolving.connect(ctx.operator).endIncomePause(); // the operator's own record only
    expect((await revolving.cycleStateOf(m)).incomePause).to.equal(3n);
    await passCycleEnd(revolving, m);
    expect((await revolving.cycleStateOf(m)).incomePause).to.equal(2n); // falls at each cycle end
    await revolving.connect(ctx.member).endIncomePause();
    expect((await revolving.cycleStateOf(m)).incomePause).to.equal(0n);
  });
});

describe("ADDENDUM 2 references, 12.14: default of a term plan secured under MB-05", function () {
  let core: Awaited<ReturnType<typeof deployCore>>;
  let liquidator: any;
  let holdA: any, holdB: any;
  const PARTNER = P("PARTNER");

  beforeEach(async function () {
    await build(true);
  });

  async function build(withHoldSource: boolean) {
    core = await deployCore();
    const { ctx, term } = core;
    const s = await ethers.getSigners();
    [holdA, holdB] = [s[13], s[14]];
    const rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, PARTNER, params({ listMonthlyBps: 200 }), CA_BANDS);
    await term.connect(ctx.admin).setRateSchedule(await rates.getAddress());
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    await ctx.networkRegistry.attestStateCode(ctx.member.address, CA);
    await term.connect(ctx.operator).setTermLimit(ctx.member.address, usd(10_000));
    const u = await ctx.usdc.getAddress();
    liquidator = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"),
      [ctx.admin.address, await ctx.stableCredit.getAddress(), u, u, u, u], { kind: "uups" });
    for (const h of [holdA, holdB]) await liquidator.grantRole(await liquidator.HOLD_ROLE(), h.address);
    if (withHoldSource) await term.connect(ctx.operator).setHoldSource(await liquidator.getAddress());
    const rate = await rates.effectiveMonthlyBps(CA, PARTNER, usd(1_000));
    await signedOpenPlan(term, ctx.operator, ctx.member.address, core.merchant.address, usd(1_000), usd(975), rate, CYCLE, 4, CYCLE, PARTNER);
  }

  async function secure(planId = 0, signer?: any) {
    const { term, ctx } = core;
    const { chainId } = await ethers.provider.getNetwork();
    const nonce = await term.planNonces(ctx.member.address);
    const sig = await (signer ?? ctx.member).signTypedData(
      { name: "Clear TermIssuer", version: "1", chainId, verifyingContract: await term.getAddress() },
      { SecurePlan: [{ name: "planId", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      { planId, nonce, deadline: ethers.MaxUint256 });
    if (signer) {
      await expect(term.connect(ctx.operator).securePlanWithSignature(planId, ethers.MaxUint256, sig))
        .to.be.revertedWithCustomError(term, "TermIssuerBadSignature");
      return;
    }
    await expect(term.connect(ctx.operator).securePlanWithSignature(planId, ethers.MaxUint256, sig)).to.emit(term, "PlanSecured");
  }
  async function notice(planId = 0) {
    const [a, b] = await attesters(core.term);
    await core.term.connect(a).proposePlanNotice(planId);
    await core.term.connect(b).approvePlanNotice(planId);
  }

  it("60 days past due, a cure notice, and 30 days after it: the trigger reverts until then, then succeeds for anyone; it fails closed without a notice; the installment rule no longer applies", async function () {
    const { term, ctx } = core;
    await secure(0, ctx.operator); // a signature not the member's cannot secure a plan
    await secure();
    const due = Number(await term.planAt(0).then((p: any) => p.openedAt)) + CYCLE;
    await advance(CYCLE + 61 * DAY); // the first payment is 61 days past due
    expect(await term.delinquentSince(0)).to.equal(BigInt(due));
    // The old rule (two installments overdue) would have defaulted it; it does not apply.
    expect(await term.defaultableAt(0)).to.equal(0n);
    await expect(term.connect(ctx.outsider).declareDefault(ctx.member.address))
      .to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    // Fail closed: no notice, no default, whoever asks.
    for (const who of [ctx.outsider, ctx.operator, ctx.admin]) {
      await expect(term.connect(who).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    }
    expect(await term.inDefault(ctx.member.address)).to.equal(false);
    // The notice: recorded at approval, never earlier than the approval itself.
    const [a, b] = await attesters(term);
    await term.connect(a).proposePlanNotice(0);
    await advance(2 * DAY);
    await expect(term.connect(a).approvePlanNotice(0)).to.be.revertedWithCustomError(term, "TermIssuerSameSigner");
    await expect(term.connect(b).approvePlanNotice(0)).to.emit(term, "PlanNoticeRecorded");
    const recorded = Number((await term.securedPlans(0)).noticeAt);
    expect(recorded).to.equal(await now()); // the approval's block, not the proposal's
    await at(recorded + 30 * DAY - 1);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    await at(recorded + 30 * DAY);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.emit(term, "SecuredPlanDefaulted");
    expect(await term.hasDefaultedOnCurrentLine(ctx.member.address)).to.equal(true);
    expect(await term.hasDefaulted(ctx.member.address)).to.equal(true);
    // Nothing is written off: the plan stays owed, for the collateral that secures it.
    expect((await term.planAt(0)).closed).to.equal(false);
    expect(await ctx.stableCredit.lostDebt()).to.equal(0n);
  });

  it("the 60 days run from the due date: a notice early only waits for them", async function () {
    const { term, ctx } = core;
    await secure();
    const due = Number((await term.planAt(0)).openedAt) + CYCLE;
    await at(due + 5 * DAY);
    await notice(); // past due by 5 days: may be recorded
    await at(due + 59 * DAY);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    await at(due + 60 * DAY);
    await term.connect(ctx.outsider).declarePlanDefault(0);
  });

  it("a notice can be recorded only while the payment is past due, and only for a secured plan; paying the past-due amount cancels it", async function () {
    const { term, ctx } = core;
    const [a] = await attesters(term);
    await advance(CYCLE + DAY);
    await expect(term.connect(a).proposePlanNotice(0)).to.be.revertedWithCustomError(term, "TermIssuerNotSecured");
    await secure();
    await notice();
    // The member pays what is past due: the notice no longer counts, and a default never comes.
    const owed = (await term.scheduledPrincipalDue(0)) - (await term.planAt(0)).repaid;
    await term.connect(ctx.member).payPlan(0, owed);
    await advance(90 * DAY);
    // ... until the next payment falls behind: it needs its own notice.
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerNotDefaultable");
    // On time, nothing can be recorded at all.
    await term.connect(ctx.member).payPlan(0, (await term.scheduledPrincipalDue(0)) - (await term.planAt(0)).repaid);
    await expect(term.connect(a).proposePlanNotice(0)).to.be.revertedWithCustomError(term, "TermIssuerNotPastDue");
  });

  it("the Liquidation Hold blocks the trigger until it lapses, and the hold source is set once", async function () {
    const { term, ctx } = core;
    await secure();
    await advance(CYCLE + 61 * DAY);
    await notice();
    await liquidator.connect(holdA).proposeHold(ctx.member.address, 1, 60 * DAY, ethers.id("bankruptcy-notice"));
    await liquidator.connect(holdB).confirmHold(ctx.member.address);
    await advance(31 * DAY);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerOnHold");
    await advance(30 * DAY); // the hold lapses on its own
    await term.connect(ctx.outsider).declarePlanDefault(0);
    // The hold source is set once.
    await expect(term.connect(ctx.operator).setHoldSource(ctx.operator.address))
      .to.be.revertedWithCustomError(term, "TermIssuerHoldSourceSet");
  });

  it("with no hold source to ask, a plan meeting every other condition still cannot default", async function () {
    await build(false);
    const { term, ctx } = core;
    expect(await term.holdSource()).to.equal(ethers.ZeroAddress);
    await secure();
    await advance(CYCLE + 61 * DAY);
    await notice();
    await advance(31 * DAY);
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.be.revertedWithCustomError(term, "TermIssuerOnHold");
    expect(await term.hasDefaultedOnCurrentLine(ctx.member.address)).to.equal(false);
    // Naming the Liquidator (once) is what lets it through.
    await term.connect(ctx.operator).setHoldSource(await liquidator.getAddress());
    await expect(term.connect(ctx.outsider).declarePlanDefault(0)).to.emit(term, "SecuredPlanDefaulted");
  });

  it("a recorded 12.14 default makes payPledged pay a bond pledged by the member into the defaulted secured plan, and nothing before it", async function () {
    await build(false);
    const { term, ctx } = core;
    const m = ctx.member.address;
    const s = await ethers.getSigners();
    const keeper = s[15];
    const BOND = ethers.encodeBytes32String("BOND");
    const u = await ctx.usdc.getAddress();
    // The Earn side, as the pledged-bond tests build it: a registry, a bond collection and its vault.
    const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
      [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
    await registry.registerCollateralType(BOND, 3, 9_500n, 0n);
    const factory: any = await deployBondFactory(await ctx.tokenRegistry.getAddress(), "ipfs://bonds");
    await factory.updateGlobalParameters(1_000n, 0n, 365 * DAY);
    const deposit: any = await ethers.getContractAt("BurnerBondDeposit", await factory.getUnifiedDepositContract());
    await factory.createCollection(u, "USDC", "USD Coin", "ipfs://bonds");
    const bond: any = await ethers.getContractAt("BurnerBond", (await factory.getCollectionInfo(u)).collectionAddress);
    const bondVault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
      [ctx.admin.address, u, 90 * DAY], { kind: "uups" });
    await bondVault.grantRole(await bondVault.BOND_ROLE(), await deposit.getAddress());
    await bondVault.grantRole(await bondVault.BOND_ROLE(), await bond.getAddress());
    await deposit.setBondVault(await bondVault.getAddress());
    await bond.setBondVault(await bondVault.getAddress());
    await bond.setEncumbranceSource(await registry.getAddress(), BOND);
    await registry.grantRole(await registry.ITEM_ROLLER_ROLE(), await bond.getAddress());
    await registry.setCollateralValuer(BOND, await (await (await ethers.getContractFactory("BondValuer")).deploy(await bond.getAddress())).getAddress());
    const enforcer: any = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"),
      [ctx.admin.address, await ctx.stableCredit.getAddress(), u, u, u, await registry.getAddress()], { kind: "uups" });
    await registry.grantRole(await registry.OPERATOR_ROLE(), await enforcer.getAddress());
    await bond.setLiquidator(await enforcer.getAddress());
    await enforcer.setEarnSources(ethers.ZeroAddress, await bond.getAddress());
    await term.connect(ctx.operator).setHoldSource(await enforcer.getAddress());
    // The term issuer is trusted (the operator's existing switch). The member is enrolled with it
    // already: `setTermLimit` opened their line.
    await enforcer.setTrustedSavingsIssuer(await term.getAddress(), true);
    expect(await ctx.networkRegistry.isEnrolled(m, await term.getAddress())).to.equal(true);

    // The member buys a $1,000 one-year bond for $900 and pledges it; the vault holds the accretion.
    const maturity = BigInt(await now()) + BigInt(365 * DAY);
    await ctx.usdc.mint(m, usd(1_000));
    await ctx.usdc.connect(ctx.member).approve(await deposit.getAddress(), usd(1_000));
    await deposit.connect(ctx.member).makeDeposit(u, usd(1_000), maturity, await bond.calculateDiscount(maturity));
    const ids = await bond.getBondIdsByCreator(m);
    const id = ids[ids.length - 1];
    await pledgeItemSigned(registry, m, BOND, id);
    await ctx.usdc.mint(await bondVault.getAddress(), usd(1_000));

    // A trusted term issuer opens no tier path: no CLRUSD, Savings or pool-share enforcement.
    await expect(enforcer.liquidate(m, await term.getAddress(), 0, BOND))
      .to.be.revertedWithCustomError(enforcer, "LiquidatorUntrustedIssuer");
    await expect(enforcer.connect(ctx.member).settleFromSavings(await term.getAddress(), 0, 1n))
      .to.be.revertedWithCustomError(enforcer, "LiquidatorUntrustedIssuer");
    await expect(enforcer.settleExcess(m, await term.getAddress()))
      .to.be.revertedWithCustomError(enforcer, "LiquidatorUntrustedIssuer");
    await expect(enforcer.noticeShortfall(m, await term.getAddress()))
      .to.be.revertedWithCustomError(enforcer, "LiquidatorUntrustedIssuer");

    // Secured, 61 days past due, notice recorded: still no default, so the bond cannot be paid.
    await secure();
    await advance(CYCLE + 61 * DAY);
    await notice();
    expect((await enforcer.pledgePaymentDue(m, id)).due).to.equal(false);
    await expect(bond.connect(keeper).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");
    await advance(31 * DAY);
    // Defaultable but not recorded: still nothing.
    await expect(bond.connect(keeper).payPledged(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable");

    await term.connect(ctx.outsider).declarePlanDefault(0);
    const due = await enforcer.pledgePaymentDue(m, id);
    expect(due.due).to.equal(true);
    expect(due.issuer).to.equal(await term.getAddress());
    expect(due.onDefault).to.equal(true);
    const repaidBefore = (await term.planAt(0)).repaid;
    const cashBefore = await ctx.usdc.balanceOf(m);
    const tx = await bond.connect(keeper).payPledged(id);
    const ev = (await tx.wait()).logs.map((l: any) => { try { return bond.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e && e.name === "PledgePaid");
    const [, , amount, toDebt, toHolder] = ev.args;
    expect(amount).to.be.gt(usd(900));
    // The plan owes more than the bond is worth: all of it goes to the defaulted secured plan.
    expect(toDebt).to.equal(amount);
    expect(toHolder).to.equal(0n);
    expect((await term.planAt(0)).repaid - repaidBefore).to.equal(toDebt);
    expect(await ctx.usdc.balanceOf(m)).to.equal(cashBefore);
    expect(await bond.balanceOf(m, id)).to.equal(0n);
    expect(await registry.isItemPledged(m, BOND, id)).to.equal(false);
    // With the default recorded, the operator's share path still cannot act on the term issuer: it
    // has no tiers to read or settle.
    expect(await ctx.usdc.balanceOf(m)).to.be.gt(0n); // a "pool" balance the path would read
    await expect(enforcer.liquidateShares(m, await term.getAddress(), 0, BOND, u)).to.be.reverted;
  });

  it("unsecured plans keep the installment rule; no role can declare a secured plan's default", async function () {
    const { term, ctx } = core;
    // Plan 0 stays unsecured: two installments overdue, anyone may declare, and it is written off.
    await advance(3 * CYCLE + DAY);
    expect(await term.defaultableAt(0)).to.be.gt(0n);
    await term.connect(ctx.outsider).declareDefault(ctx.member.address);
    expect((await term.planAt(0)).closed).to.equal(true);
    // No function lets a role set a plan's default or its notice time.
    const names = term.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    expect(names.filter((n: string) => /notice|planDefault|secure/i.test(n)).sort())
      .to.deep.equal(["approvePlanNotice", "declarePlanDefault", "proposePlanNotice", "securePlanWithSignature", "securedPlans"].sort());
  });
});
