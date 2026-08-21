import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const MONTH = CYCLE;
const ONE_YEAR = 365 * 24 * 60 * 60;

// A member holding both a revolving line and a term plan shares one signed number between two
// issuers. The ledger is the only party that knows the total, so it is the only one that can
// decide whose debt a payment reduced.
describe("a balance shared between issuers", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let revolving: any, term: any;
  let coop: any, merchant: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, merchant] = [signers[8], signers[9]];

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    revolving = await RevolvingIssuer.deploy();
    await revolving.initialize(await ctx.stableCredit.getAddress(), coop.address);

    const TermIssuer = await ethers.getContractFactory("TermIssuer");
    term = await TermIssuer.deploy();
    await term.initialize(await ctx.stableCredit.getAddress(), coop.address);

    for (const issuer of [revolving, term]) {
      await ctx.networkRegistry.registerIssuer(
        await issuer.getAddress(),
        await ctx.stableCredit.getAddress(),
        await ctx.assurancePool.getAddress(),
        await ctx.assuranceOracle.getAddress()
      );
      await ctx.access.grantOperator(await issuer.getAddress());
    }
    for (const who of [coop, merchant]) {
      await ctx.access.connect(ctx.operator).grantMember(who.address);
    }

    await revolving
      .connect(ctx.operator)
      .addTier(ethers.encodeBytes32String("INCOME"), 0n, CYCLE);
    await revolving
      .connect(ctx.operator)
      .openLine(ctx.member.address, [500n * ONE_USDC], ONE_YEAR, MONTH);

    await term.connect(ctx.operator).setTermLimit(ctx.member.address, 2_000n * ONE_USDC);
  });

  /// The member's obligation as the ledger sees it, against what the issuers claim to hold.
  async function reconcile() {
    const ledger = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
    const held =
      (await revolving.totalPrincipalOf(ctx.member.address)) +
      (await term.totalPrincipalOf(ctx.member.address));
    return { ledger, held };
  }

  it("keeps the ledger and the issuers agreeing after an undirected payment", async function () {
    // The case that used to drift: a member with a term plan and no revolving balance receives
    // credit that names no plan. The ledger burns their balance either way.
    await term
      .connect(ctx.operator)
      .openPlan(
        ctx.member.address, merchant.address, 1_000n * ONE_USDC, 1_000n * ONE_USDC,
        0n, CYCLE, 12, MONTH
      );

    await ctx.stableCredit.connect(merchant).transfer(ctx.member.address, 400n * ONE_USDC);

    const { ledger, held } = await reconcile();
    expect(ledger).to.equal(600n * ONE_USDC);
    expect(held).to.equal(ledger);
    expect(await term.totalPrincipalOf(ctx.member.address)).to.equal(600n * ONE_USDC);
  });

  it("does not let two issuers each claim the same payment", async function () {
    // Both hold debt. A 400 payment must reduce 400 of debt in total, not 400 of each.
    await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 300n * ONE_USDC);
    await term
      .connect(ctx.operator)
      .openPlan(
        ctx.member.address, merchant.address, 1_000n * ONE_USDC, 1_000n * ONE_USDC,
        0n, CYCLE, 12, MONTH
      );

    const before = await reconcile();
    expect(before.ledger).to.equal(1_300n * ONE_USDC);
    expect(before.held).to.equal(before.ledger);

    await ctx.stableCredit.connect(merchant).transfer(ctx.member.address, 400n * ONE_USDC);

    const after = await reconcile();
    expect(after.ledger).to.equal(900n * ONE_USDC);
    expect(after.held).to.equal(after.ledger);
  });

  it("offers the revolving line first, as the demand obligation", async function () {
    await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 300n * ONE_USDC);
    await term
      .connect(ctx.operator)
      .openPlan(
        ctx.member.address, merchant.address, 1_000n * ONE_USDC, 1_000n * ONE_USDC,
        0n, CYCLE, 12, MONTH
      );

    await ctx.stableCredit.connect(merchant).transfer(ctx.member.address, 200n * ONE_USDC);

    // The revolving balance took it; the plan is untouched and still on schedule.
    expect(await revolving.totalPrincipalOf(ctx.member.address)).to.equal(100n * ONE_USDC);
    expect(await term.totalPrincipalOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);
  });

  it("spills into the plans once the revolving line is clear", async function () {
    await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 300n * ONE_USDC);
    await term
      .connect(ctx.operator)
      .openPlan(
        ctx.member.address, merchant.address, 1_000n * ONE_USDC, 1_000n * ONE_USDC,
        0n, CYCLE, 12, MONTH
      );

    await ctx.stableCredit.connect(merchant).transfer(ctx.member.address, 500n * ONE_USDC);

    expect(await revolving.totalPrincipalOf(ctx.member.address)).to.equal(0n);
    expect(await term.totalPrincipalOf(ctx.member.address)).to.equal(800n * ONE_USDC);
    const { ledger, held } = await reconcile();
    expect(held).to.equal(ledger);
  });

  it("leaves the revolving line alone when a plan is named", async function () {
    // A directed payment records itself and the ledger stays quiet, so the revolving line does
    // not also take it.
    await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 300n * ONE_USDC);
    const planId = await term
      .connect(ctx.operator)
      .openPlan.staticCall(
        ctx.member.address, merchant.address, 1_000n * ONE_USDC, 1_000n * ONE_USDC,
        0n, CYCLE, 12, MONTH
      );
    await term
      .connect(ctx.operator)
      .openPlan(
        ctx.member.address, merchant.address, 1_000n * ONE_USDC, 1_000n * ONE_USDC,
        0n, CYCLE, 12, MONTH
      );

    const payer = (await ethers.getSigners())[10];
    await ctx.usdc.mint(payer.address, 10_000n * ONE_USDC);
    await ctx.usdc
      .connect(payer)
      .approve(await ctx.stableCredit.getAddress(), 10_000n * ONE_USDC);

    await term.connect(payer).payPlan(planId, 400n * ONE_USDC);

    expect(await revolving.totalPrincipalOf(ctx.member.address)).to.equal(300n * ONE_USDC);
    expect(await term.totalPrincipalOf(ctx.member.address)).to.equal(600n * ONE_USDC);
    const { ledger, held } = await reconcile();
    expect(held).to.equal(ledger);
  });

  it("reconciles when a payment clears everything", async function () {
    await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 300n * ONE_USDC);
    await term
      .connect(ctx.operator)
      .openPlan(
        ctx.member.address, merchant.address, 500n * ONE_USDC, 500n * ONE_USDC,
        0n, CYCLE, 12, MONTH
      );

    await ctx.stableCredit.connect(merchant).transfer(ctx.member.address, 800n * ONE_USDC);

    const { ledger, held } = await reconcile();
    expect(ledger).to.equal(0n);
    expect(held).to.equal(0n);
  });
});
